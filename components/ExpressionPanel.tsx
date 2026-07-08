import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { CharacterComposition, CharacterPart, TransformState } from '../types';
import { Save, Smile, Eye, User, Layers, ChevronDown, ChevronRight } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export interface ExpressionLayerState {
  isVisible?: boolean;
  textureOverride?: string;
  rotation?: number;
}

export interface ExpressionPreset {
  id: string;
  name: string;
  category: string;
  icon?: string;
  layerModifications: Record<string, ExpressionLayerState>;
}

export interface ActiveExpression {
  presetId: string;
  intensity: number;
}

export interface ExpressionPanelProps {
  character: CharacterComposition | null;
  onUpdateCharacter: (newChar: CharacterComposition) => void;
  onAddKeyframes: (properties: Record<string, number>) => void;
}

export const ExpressionPanel: React.FC<ExpressionPanelProps> = ({
  character,
  onUpdateCharacter,
  onAddKeyframes,
}) => {
  const [presets, setPresets] = useState<ExpressionPreset[]>([]);
  const [activeExpressions, setActiveExpressions] = useState<Record<string, ActiveExpression>>({});
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({
    'Full presets': true,
    'Eyes': true,
    'Mouths': true,
    'Extras': true,
  });

  // Load presets from local storage
  useEffect(() => {
    try {
      const saved = localStorage.getItem('animato_expression_presets');
      if (saved) {
        setPresets(JSON.parse(saved));
      }
    } catch (e) {
      console.error('Failed to load presets', e);
    }
  }, []);

  // Save presets to local storage
  useEffect(() => {
    localStorage.setItem('animato_expression_presets', JSON.stringify(presets));
  }, [presets]);

  const toggleCategory = (cat: string) => {
    setExpandedCategories(prev => ({
      ...prev,
      [cat]: !prev[cat]
    }));
  };

  const applyExpression = useCallback((preset: ExpressionPreset, intensity: number = 1.0) => {
    if (!character) return;
    
    const newChar: CharacterComposition = JSON.parse(JSON.stringify(character));
    const kfProperties: Record<string, number> = {};
    const activatedGroupParents = new Set<string>();
    
    // First pass: apply modifications from the preset
    for (const [partId, mod] of Object.entries(preset.layerModifications)) {
      const part = newChar[partId];
      if (!part) continue;

      // Visibility with threshold (step at > 0.5)
      if (mod.isVisible !== undefined) {
        const isVis = intensity > 0.5 ? mod.isVisible : part.isVisible;
        part.isVisible = isVis;
        kfProperties[`char:${partId}:isVisible`] = isVis ? 1 : 0;
        
        if (isVis && part.parentId) {
          activatedGroupParents.add(part.parentId);
        }
      }

      // Texture override 
      if (mod.textureOverride !== undefined) {
        part.imageUrl = intensity > 0.5 ? mod.textureOverride : part.imageUrl;
      }

      // Continuous rotation blending
      if (mod.rotation !== undefined) {
        const baseRot = part.baseTransform?.rotation || 0;
        const targetRot = mod.rotation;
        const currentRot = baseRot + (targetRot - baseRot) * intensity;
        
        if (!part.transform) {
          part.transform = { ...part.baseTransform } as TransformState;
        }
        
        part.transform.rotation = currentRot;
        kfProperties[`char:${partId}:rotation`] = currentRot;
      }
    }

    // Second pass: Group Isolation
    // Hide sibling layers in the same group that were NOT activated by this expression
    activatedGroupParents.forEach(parentId => {
      const parent = newChar[parentId];
      if (parent && parent.children) {
        parent.children.forEach(childId => {
          const childPart = newChar[childId];
          const childMod = preset.layerModifications[childId];
          const isActivatedByExpression = childMod && childMod.isVisible;
          
          if (!isActivatedByExpression && childPart && childPart.isVisible !== false) {
            childPart.isVisible = false;
            kfProperties[`char:${childId}:isVisible`] = 0;
          }
        });
      }
    });

    onUpdateCharacter(newChar);
    
    if (Object.keys(kfProperties).length > 0) {
      onAddKeyframes(kfProperties);
    }
  }, [character, onUpdateCharacter, onAddKeyframes]);

  const handleTogglePreset = (preset: ExpressionPreset) => {
    setActiveExpressions(prev => {
      const next = { ...prev };
      const isActive = next[preset.category]?.presetId === preset.id;

      if (isActive) {
        // Turning expression off
        delete next[preset.category];
        // We revert intensity back to 0 so the baseline restores (applies inverse logic implicitly)
        // Alternatively, rely on default base poses logic external to this method if needed.
        applyExpression(preset, 0.0);
      } else {
        // Toggling expression on, overwrite any active one in this category
        next[preset.category] = { presetId: preset.id, intensity: 1.0 };
        applyExpression(preset, 1.0);
      }
      return next;
    });
  };

  const handleIntensityChange = (preset: ExpressionPreset, intensity: number) => {
    setActiveExpressions(prev => ({
      ...prev,
      [preset.category]: { presetId: preset.id, intensity }
    }));
    applyExpression(preset, intensity);
  };

  const handleSaveCurrentState = () => {
    if (!character) return;
    
    const newModifications: Record<string, ExpressionLayerState> = {};
    
    for (const [id, _part] of Object.entries(character)) {
        const part = _part as CharacterPart;
        const baseRot = part.baseTransform?.rotation || 0;
        const curRot = part.transform?.rotation || 0;
        
        let added = false;
        const mod: ExpressionLayerState = {};
        
        // Check for non-default rotation
        if (Math.abs(curRot - baseRot) > 0.01) {
            mod.rotation = curRot;
            added = true;
        }
        
        // Save visibility exactly as it is for robust restores
        if (part.isVisible !== undefined) {
             mod.isVisible = part.isVisible;
             added = true;
        }
        
        if (added) {
            newModifications[id] = mod;
        }
    }
    
    const newPreset: ExpressionPreset = {
        id: `preset_${Date.now()}`,
        name: `Custom Expression ${presets.length + 1}`,
        category: 'Full presets',
        layerModifications: newModifications
    };
    
    setPresets(prev => [...prev, newPreset]);
    
    // Auto-activate it
    setActiveExpressions(prev => ({
      ...prev,
      [newPreset.category]: { presetId: newPreset.id, intensity: 1.0 }
    }));
  };

  const categories = useMemo(() => {
    const cats = new Set(presets.map(p => p.category));
    ['Full presets', 'Eyes', 'Mouths', 'Extras'].forEach(c => cats.add(c));
    return Array.from(cats);
  }, [presets]);

  const getCategoryIcon = (category: string) => {
      switch(category) {
          case 'Eyes': return <Eye size={16} className="mr-2 text-blue-400" />;
          case 'Mouths': return <Smile size={16} className="mr-2 text-pink-400" />;
          case 'Full presets': return <User size={16} className="mr-2 text-yellow-400" />;
          default: return <Layers size={16} className="mr-2 text-purple-400" />;
      }
  };

  return (
    <div className="w-80 h-full bg-gray-900 border-l border-white/10 flex flex-col text-gray-200 overflow-hidden font-sans">
      {/* Header */}
      <div className="p-4 border-b border-white/10 flex items-center justify-between shrink-0 bg-gray-950/50">
        <h2 className="text-sm font-semibold tracking-wide uppercase text-gray-300 flex items-center">
            <Smile size={18} className="mr-2 text-blue-500" />
            Expression Panel
        </h2>
      </div>

      {/* Internal Scrollable Content */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-4">
        
        <button 
            onClick={handleSaveCurrentState}
            className="w-full flex items-center justify-center py-2.5 px-4 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl transition-all text-xs font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/50"
        >
            <Save size={16} className="mr-2 text-blue-400" />
            Save Current State as Expression
        </button>

        {/* Accordions */}
        {categories.map(category => {
          const categoryPresets = presets.filter(p => p.category === category);
          const isExpanded = expandedCategories[category];
          
          return (
            <div key={category} className="space-y-2">
                <button 
                    onClick={() => toggleCategory(category)}
                    className="w-full flex items-center justify-between text-xs font-semibold text-gray-400 hover:text-gray-200 transition-colors uppercase tracking-wider py-1 select-none focus:outline-none focus:ring-2 focus:ring-blue-500/20 rounded"
                >
                    <div className="flex items-center">
                        {getCategoryIcon(category)}
                        {category}
                        <span className="ml-2 bg-gray-800 text-gray-500 px-1.5 py-0.5 rounded-full text-[10px]">
                            {categoryPresets.length}
                        </span>
                    </div>
                    {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </button>
                
                <AnimatePresence initial={false}>
                    {isExpanded && (
                        <motion.div 
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="overflow-hidden"
                        >
                            {categoryPresets.length === 0 ? (
                                <div className="text-xs text-gray-600 italic py-3 text-center bg-gray-800/30 rounded-xl border border-gray-800/50">
                                    No presets saved in {category}
                                </div>
                            ) : (
                                <div className="grid grid-cols-2 gap-2 pt-1 pb-2">
                                    {categoryPresets.map(preset => {
                                        const activeContext = activeExpressions[category];
                                        const isActive = activeContext?.presetId === preset.id;
                                        
                                        return (
                                            <div key={preset.id} className="flex flex-col gap-1">
                                                <button
                                                    onClick={() => handleTogglePreset(preset)}
                                                    className={`relative aspect-square flex flex-col items-center justify-center rounded-xl transition-all duration-200 group overflow-hidden ${
                                                        isActive 
                                                        ? 'ring-2 ring-blue-500 bg-blue-500/20 border-transparent shadow-[0_0_15px_rgba(59,130,246,0.15)]' 
                                                        : 'border border-white/10 bg-gray-800/50 hover:bg-gray-800 hover:border-white/20'
                                                    }`}
                                                >
                                                    <div className={`p-3 rounded-full mb-2 transition-colors ${isActive ? 'bg-blue-500/20' : 'bg-gray-700/50 group-hover:bg-gray-700'}`}>
                                                        <User size={24} className={isActive ? 'text-blue-400' : 'text-gray-400'} />
                                                    </div>
                                                    <span className={`text-[11px] font-medium text-center px-2 line-clamp-2 leading-tight ${isActive ? 'text-blue-300' : 'text-gray-300'}`}>
                                                        {preset.name}
                                                    </span>
                                                    
                                                    {/* Active Indicator Dot */}
                                                    {isActive && (
                                                        <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-blue-400 shadow-[0_0_8px_rgba(59,130,246,1)]"></div>
                                                    )}
                                                </button>
                                                
                                                {/* Intensity Slider */}
                                                {isActive && (
                                                    <div className="px-1 py-1">
                                                        <input 
                                                            type="range" 
                                                            min="0" 
                                                            max="1" 
                                                            step="0.01"
                                                            value={activeContext.intensity}
                                                            onChange={(e) => handleIntensityChange(preset, parseFloat(e.target.value))}
                                                            className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                                                        />
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
          );
        })}
      </div>
    </div>
  );
};
