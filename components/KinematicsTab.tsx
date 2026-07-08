import React, { useState, useRef, useEffect } from 'react';
import { Move, RotateCcw, Maximize, Edit3 } from 'lucide-react';
import { KinematicSkeleton } from './KinematicSkeleton';
import { compensateAnchorShift } from '../utils/animationUtils';

const CircularKnob = ({ value, onChange, onPointerDown, onPointerUp }: any) => {
  const containerRef = useRef<HTMLDivElement>(null);
  
  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    if (onPointerDown) onPointerDown(e);

    const abortController = new AbortController();

    const handlePointerMove = (moveEvent: PointerEvent) => {
      moveEvent.preventDefault();
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const angle = Math.atan2(moveEvent.clientY - centerY, moveEvent.clientX - centerX);
      let deg = angle * (180 / Math.PI) + 90; // offset so 0 is top
      if (deg > 180) deg -= 360;
      if (onChange) onChange({ target: { value: deg.toString() } });
    };

    const handlePointerUp = (upEvent: PointerEvent) => {
      abortController.abort();
      if (onPointerUp) onPointerUp(upEvent);
    };

    window.addEventListener('pointermove', handlePointerMove, { signal: abortController.signal, passive: false });
    window.addEventListener('pointerup', handlePointerUp, { signal: abortController.signal, passive: false });
  };

  return (
    <div 
      ref={containerRef}
      onPointerDown={handlePointerDown}
      className="relative w-24 h-24 rounded-full bg-[#111] border-2 border-white/10 flex items-center justify-center cursor-pointer touch-none shadow-inner mx-auto my-4"
    >
      <div 
        className="absolute w-full h-full rounded-full transition-transform duration-75"
        style={{ transform: `rotate(${value}deg)` }}
      >
        <div className="absolute top-1 left-1/2 -translate-x-1/2 w-3 h-3 bg-cyan-500 rounded-full shadow-[0_0_10px_rgba(6,182,212,0.8)]" />
      </div>
      <div className="absolute inset-4 rounded-full bg-black/50 flex items-center justify-center border border-white/5 pointer-events-none">
        <span className="text-[10px] font-mono text-cyan-400">{Math.round(value)}°</span>
      </div>
    </div>
  );
};

interface KinematicsTabProps {
  activeSceneCharacterId: string | null;
  setActiveSceneCharacterId?: (id: string) => void;
  characters?: any[];
  character: any;
  setCharacter: (updater: any) => void;
  propertyTarget: string | null;
  setPropertyTarget: (val: string | null) => void;
  setSelectedPartIds: (ids: string[]) => void;
  setShouldRecordHistory: (val: boolean) => void;
  isAnchorMode: boolean;
  setIsAnchorMode: (val: boolean) => void;
  t: (key: string) => string;
  handleAutoKey?: (updates: Record<string, number>) => void;
  autoKeyEnabled?: boolean;
  handleSaveToStorage?: () => void;
}

const logicalTree: Record<string, string[]> = {
  body: ['head', 'l_biceps', 'r_biceps', 'l_hips', 'r_hips'],
  head: [],
  l_biceps: ['l_arm'],
  l_arm: ['l_hand'],
  l_hand: [],
  r_biceps: ['r_arm'],
  r_arm: ['r_hand'],
  r_hand: [],
  l_hips: ['l_knee'],
  l_knee: ['l_leg_feet'],
  l_leg_feet: [],
  r_hips: ['r_knee'],
  r_knee: ['r_leg_feet'],
  r_leg_feet: [],
};

const detectSideKinematics = (part: any, char: any): 'left' | 'right' | 'unknown' => {
    let current = part;
    while (current) {
        const label = (current.label || '').toLowerCase();
        
        if (
            label.includes('right') ||
            label.startsWith('r_') ||
            label.startsWith('r ') ||
            label.endsWith('_r') ||
            label.endsWith(' r') ||
            label.includes('_r_') ||
            label.includes(' r ') ||
            /\br\b/i.test(label)
        ) {
            return 'right';
        }
        
        if (
            label.includes('left') ||
            label.startsWith('l_') ||
            label.startsWith('l ') ||
            label.endsWith('_l') ||
            label.endsWith(' l') ||
            label.includes('_l_') ||
            label.includes(' l ') ||
            /\bl\b/i.test(label)
        ) {
            return 'left';
        }
        
        if (current.parentId && char[current.parentId]) {
            current = char[current.parentId];
        } else {
            break;
        }
    }
    return 'unknown';
};

const isLayerInVisibleView = (char: any, partId: string) => {
    if (!char || !char[partId]) return true;
    let currentId: string | undefined = partId;
    while (currentId && currentId !== 'root') {
        const curr = char[currentId];
        if (!curr) break;
        const isViewNode = curr.tags?.includes('View') || curr.label?.toLowerCase().includes('view');
        if (isViewNode && (curr.isVisible === false || curr.opacity === 0)) return false;
        currentId = curr.parentId;
    }
    return true;
};

const getLogicalMap = (char: any) => {
    const parts = Object.values(char || {}).filter((p: any) => isLayerInVisibleView(char, p.id));
    
    const getBestPart = (
        keywords: string[],
        negativeKeywords: string[],
        sideContext?: 'left' | 'right'
    ) => {
        let bestPart: any = null;
        let bestScore = -999;
        
        for (const p of parts) {
            const partCast = p as any;
            const l = (partCast.label || '').toLowerCase();
            if (l.includes('anchor point')) continue;
            
            if (sideContext) {
                const side = detectSideKinematics(partCast, char);
                if (side !== 'unknown' && side !== sideContext) {
                    continue;
                }
            }
            
            let score = 0;
            const hasNeg = negativeKeywords.some(neg => l.includes(neg));
            if (hasNeg) {
                score -= 100;
            }
            
            keywords.forEach(kw => {
                if (l.includes(kw)) {
                    score += 10;
                    if (l === kw) {
                        score += 50;
                    } else if (new RegExp(`\\b${kw.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i').test(l)) {
                        score += 30;
                    }
                }
            });
            
            if (score > bestScore && score > 0) {
                bestScore = score;
                bestPart = p;
            }
        }
        
        return bestPart ? bestPart.id : null;
    };

    return {
      head: getBestPart(['head', 'face', 'skull'], ['hand', 'arm', 'leg', 'foot', 'feet']),
      body: 'root',
      l_biceps: getBestPart(['bicep', 'biceps', 'upper arm', 'upperarm', 'shoulder'], ['lower', 'forearm', 'elbow', 'hand', 'knee', 'hip', 'leg', 'foot', 'feet', 'palm', 'wrist'], 'left') || getBestPart(['arm'], ['lower', 'forearm', 'elbow', 'hand', 'knee', 'hip', 'leg', 'foot', 'feet', 'palm', 'wrist', 'upper_arm', 'upperarm'], 'left'),
      l_arm: getBestPart(['lower arm', 'lowerarm', 'forearm', 'elbow', 'arm_lower'], ['upper', 'bicep', 'shoulder', 'hand', 'hips', 'knee', 'leg', 'foot', 'feet', 'palm', 'wrist'], 'left') || getBestPart(['arm'], ['upper', 'bicep', 'shoulder', 'hand', 'hips', 'knee', 'leg', 'foot', 'feet', 'palm', 'wrist'], 'left'),
      l_hand: getBestPart(['hand', 'hands', 'palm', 'finger', 'fingers', 'wrist', 'hand swap', 'hand_swap', 'hands_swap'], ['arm', 'bicep', 'shoulder', 'elbow', 'forearm', 'leg', 'foot', 'feet', 'knee', 'hip'], 'left'),
      r_biceps: getBestPart(['bicep', 'biceps', 'upper arm', 'upperarm', 'shoulder'], ['lower', 'forearm', 'elbow', 'hand', 'knee', 'hip', 'leg', 'foot', 'feet', 'palm', 'wrist'], 'right') || getBestPart(['arm'], ['lower', 'forearm', 'elbow', 'hand', 'knee', 'hip', 'leg', 'foot', 'feet', 'palm', 'wrist', 'upper_arm', 'upperarm'], 'right'),
      r_arm: getBestPart(['lower arm', 'lowerarm', 'forearm', 'elbow', 'arm_lower'], ['upper', 'bicep', 'shoulder', 'hand', 'hips', 'knee', 'leg', 'foot', 'feet', 'palm', 'wrist'], 'right') || getBestPart(['arm'], ['upper', 'bicep', 'shoulder', 'hand', 'hips', 'knee', 'leg', 'foot', 'feet', 'palm', 'wrist'], 'right'),
      r_hand: getBestPart(['hand', 'hands', 'palm', 'finger', 'fingers', 'wrist', 'hand swap', 'hand_swap', 'hands_swap'], ['arm', 'bicep', 'shoulder', 'elbow', 'forearm', 'leg', 'foot', 'feet', 'knee', 'hip'], 'right'),
      l_hips: getBestPart(['hip', 'hips', 'thigh', 'upper leg', 'upperleg'], ['arm', 'bicep', 'shoulder', 'elbow', 'forearm', 'knee', 'calf', 'shin', 'foot', 'feet', 'toe', 'hand', 'head'], 'left'),
      l_knee: getBestPart(['knee', 'calf', 'shin', 'lower leg', 'lowerleg'], ['hip', 'hips', 'thigh', 'upper', 'foot', 'feet', 'toe', 'hand', 'head', 'arm'], 'left') || getBestPart(['leg'], ['hip', 'hips', 'thigh', 'upper', 'foot', 'feet', 'toe', 'hand', 'head', 'arm'], 'left'),
      l_leg_feet: getBestPart(['foot', 'feet', 'toe', 'toes', 'ankle'], ['hip', 'hips', 'thigh', 'knee', 'calf', 'shin', 'upper', 'lower', 'arm', 'hand', 'head'], 'left'),
      r_hips: getBestPart(['hip', 'hips', 'thigh', 'upper leg', 'upperleg'], ['arm', 'bicep', 'shoulder', 'elbow', 'forearm', 'knee', 'calf', 'shin', 'foot', 'feet', 'toe', 'hand', 'head'], 'right'),
      r_knee: getBestPart(['knee', 'calf', 'shin', 'lower leg', 'lowerleg'], ['hip', 'hips', 'thigh', 'upper', 'foot', 'feet', 'toe', 'hand', 'head', 'arm'], 'right') || getBestPart(['leg'], ['hip', 'hips', 'thigh', 'upper', 'foot', 'feet', 'toe', 'hand', 'head', 'arm'], 'right'),
      r_leg_feet: getBestPart(['foot', 'feet', 'toe', 'toes', 'ankle'], ['hip', 'hips', 'thigh', 'knee', 'calf', 'shin', 'upper', 'lower', 'arm', 'hand', 'head'], 'right'),
    };
};

const getAllDescendants = (partId: string, char: any) => {
    const map = getLogicalMap(char);
    let abstractName = '';
    for (const [key, val] of Object.entries(map)) {
        if (val === partId) {
            abstractName = key; break;
        }
    }
    if (!abstractName) return [];
    
    const descendants: string[] = [];
    const traverse = (nodeName: string) => {
        const children = logicalTree[nodeName] || [];
        for (const childName of children) {
            const childId = (map as any)[childName];
            if (childId) {
                descendants.push(childId);
                traverse(childName);
            }
        }
    };
    traverse(abstractName);
    return descendants;
};

const getRecursiveDescendantsAndChildren = (partId: string, char: any): string[] => {
    const ids = new Set<string>();
    
    if (partId === 'root') {
        Object.keys(char).forEach(id => {
            if (id !== 'root') ids.add(id);
        });
        return Array.from(ids);
    }

    const logical = getAllDescendants(partId, char);
    logical.forEach(id => ids.add(id));
    
    const collectNatural = (currId: string) => {
        const part = char[currId];
        if (part && part.children) {
            for (const childId of part.children) {
                if (!ids.has(childId)) {
                    ids.add(childId);
                    collectNatural(childId);
                }
            }
        }
    };
    
    collectNatural(partId);
    logical.forEach(id => collectNatural(id));
    
    // Explicitly add backhair if we are moving the head
    const map = getLogicalMap(char);
    if (map.head === partId) {
        const parts = Object.values(char);
        parts.forEach((p: any) => {
            let curr = p;
            const visited = new Set<string>();
            let isBH = false;
            while (curr) {
                if (visited.has(curr.id)) break;
                visited.add(curr.id);
                const labelLower = (curr.label || '').toLowerCase();
                const isBack = labelLower.includes('back');
                const isHair = labelLower.includes('hair') || labelLower.includes('here') || labelLower.includes('hair_swap');
                if (
                    labelLower === 'back' ||
                    labelLower.includes('backhair') ||
                    labelLower.includes('back_hair') ||
                    labelLower.includes('back-hair') ||
                    (isBack && isHair)
                ) {
                    isBH = true;
                    break;
                }
                curr = curr.parentId ? char[curr.parentId] : null;
            }
            if (isBH) {
                ids.add(p.id);
            }
        });
    }

    return Array.from(ids);
};

export const KinematicsTab: React.FC<KinematicsTabProps> = ({
  activeSceneCharacterId,
  setActiveSceneCharacterId,
  characters,
  character,
  setCharacter,
  propertyTarget,
  setPropertyTarget,
  setSelectedPartIds,
  setShouldRecordHistory,
  isAnchorMode,
  setIsAnchorMode,
  t,
  handleAutoKey,
  autoKeyEnabled,
  handleSaveToStorage
}) => {
  const [activeRigTool, setActiveRigTool] = useState<"BONE" | "MOVE" | "SCALE">("BONE");
  const [anchorBackup, setAnchorBackup] = useState<Record<string, { x: number, y: number }> | null>(null);
  const [anchorRangeX, setAnchorRangeX] = useState({ min: -200, max: 300 });
  const [anchorRangeY, setAnchorRangeY] = useState({ min: -200, max: 300 });
  const [posRangeX, setPosRangeX] = useState({ min: -1000, max: 1000 });
  const [posRangeY, setPosRangeY] = useState({ min: -1000, max: 1000 });

  React.useEffect(() => {
      if (isAnchorMode && character && !anchorBackup) {
          const backup: Record<string, {x: number, y: number}> = {};
          Object.keys(character).forEach(k => {
              backup[k] = { x: character[k].transform.anchorX ?? 50, y: character[k].transform.anchorY ?? 50 };
          });
          setAnchorBackup(backup);
      } else if (!isAnchorMode) {
          setAnchorBackup(null);
      }
  }, [isAnchorMode, character]);

  const handleSaveAnchors = () => {
      setShouldRecordHistory(true);
      setIsAnchorMode(false);
      if (handleSaveToStorage) {
          setTimeout(handleSaveToStorage, 50);
      }
  };

  const handleCancelAnchors = () => {
      if (anchorBackup && character) {
          setCharacter((prev: any) => {
              const next = { ...prev };
              Object.keys(anchorBackup).forEach(k => {
                  if (next[k]) {
                      next[k] = {
                          ...next[k],
                          transform: {
                              ...next[k].transform,
                              anchorX: anchorBackup[k].x,
                              anchorY: anchorBackup[k].y
                          }
                      };
                  }
              });
              return next;
          });
      }
      setIsAnchorMode(false);
  };

  const logicalMap = getLogicalMap(character);
  const partList = Object.keys(logicalMap).map(key => ({
      key,
      partId: (logicalMap as any)[key],
      label: (logicalMap as any)[key] && character?.[(logicalMap as any)[key]] ? character[(logicalMap as any)[key]].label : key
  })).filter(p => p.partId);

  return (
    <div className="w-full h-full flex flex-col overflow-y-auto p-4 custom-scrollbar text-gray-300 pointer-events-auto">
      <div className="mb-4">
        <select
          value={activeSceneCharacterId || ""}
          onChange={(e) => {
            if (setActiveSceneCharacterId) setActiveSceneCharacterId(e.target.value);
            setPropertyTarget("root");
          }}
          className="w-full bg-[#111] border border-white/10 rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-cyan-500 uppercase font-black tracking-widest cursor-pointer"
        >
          <option value="ALL">GLOBAL / ENVIRONMENTAL</option>
          {characters?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      {!activeSceneCharacterId || activeSceneCharacterId === "ALL" ? (
        <div className="h-full flex flex-col items-center justify-center text-center p-8 gap-4 grayscale opacity-50">
          <Move size={48} className="text-gray-700" />
          <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
            {t("Select a character")}
            <br />
            {t("for kinematics")}
          </p>
        </div>
      ) : isAnchorMode ? (
        <div className="space-y-4 pb-12 animate-in fade-in zoom-in-95">
            <div className="bg-[#1a1a1a] p-4 rounded-lg border border-white/5 space-y-4">
              <div className="flex items-center justify-between">
                  <div className="text-[12px] font-black text-cyan-500 uppercase tracking-widest">{t("EDIT ANCHORS")}</div>
                  <div className="flex gap-2">
                      <button onClick={handleCancelAnchors} className="text-[10px] font-bold bg-white/5 hover:bg-white/10 text-gray-400 px-3 py-1 rounded">
                          {t("CANCEL")}
                      </button>
                      <button onClick={handleSaveAnchors} className="text-[10px] font-bold bg-cyan-600 hover:bg-cyan-500 text-white px-3 py-1 rounded">
                          {t("SAVE")}
                      </button>
                  </div>
              </div>
              <p className="text-[10px] text-gray-400">{t("Select a part below to set its pivot point using the sliders or drag on the canvas.")}</p>
              <div className="flex flex-col gap-1 max-h-48 overflow-y-auto custom-scrollbar">
                  {partList.map(p => (
                      <button 
                        key={p.partId}
                        onClick={() => {
                            setSelectedPartIds([p.partId]);
                            setPropertyTarget(p.partId);
                        }}
                        className={`text-left px-3 py-2 text-[10px] font-bold rounded ${propertyTarget === p.partId ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30' : 'bg-black/40 text-gray-400 border border-transparent hover:bg-white/5'}`}
                      >
                          {p.label.substring(0,25)}
                      </button>
                  ))}
              </div>
              
              {propertyTarget && character?.[propertyTarget] && (
                <div className="space-y-4 pt-4 border-t border-white/5">
                  <div className="space-y-3">
                    <div className="flex justify-between items-center text-[9px] font-bold text-gray-500 uppercase">
                      <label>{t("Pivot X")}</label>
                      <span className="font-mono text-cyan-400">{Math.round(character[propertyTarget].transform.anchorX ?? 50)}%</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <input 
                            type="number" 
                            className="w-12 bg-white/5 border border-white/10 rounded px-1 py-1 text-[9px] text-center text-gray-400 focus:text-white"
                            value={anchorRangeX.min}
                            onChange={e => setAnchorRangeX(p => ({...p, min: Number(e.target.value)}))}
                        />
                        <input 
                          type="range" min={anchorRangeX.min} max={anchorRangeX.max} step="0.5"
                          value={character[propertyTarget].transform.anchorX ?? 50}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value);
                            setCharacter((prev: any) => {
                              if (!prev || !prev[propertyTarget]) return prev;
                              const p = prev[propertyTarget];
                              const t = p.transform;
                              const oldX = t.anchorX ?? 50;
                              const pos = compensateAnchorShift(
                                t.x, t.y, t.rotation, t.scaleX, t.scaleY, !!t.flipX, !!t.flipY,
                                oldX, t.anchorY ?? 50, val, t.anchorY ?? 50,
                                p.width || 150, p.height || 150
                              );
                              
                              if (autoKeyEnabled && handleAutoKey) {
                                  handleAutoKey({
                                      [`part:${activeSceneCharacterId}:${propertyTarget}:anchorX`]: val,
                                      [`part:${activeSceneCharacterId}:${propertyTarget}:x`]: pos.x,
                                      [`part:${activeSceneCharacterId}:${propertyTarget}:y`]: pos.y
                                  });
                              }
                              
                              return { ...prev, [propertyTarget]: { ...p, transform: { ...p.transform, anchorX: val, x: pos.x, y: pos.y } } };
                            });
                          }}
                          className="flex-1 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer cancel-drag [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-cyan-500 [&::-webkit-slider-thumb]:rounded-full"
                          style={{ touchAction: 'none' }}
                        />
                        <input 
                            type="number" 
                            className="w-12 bg-white/5 border border-white/10 rounded px-1 py-1 text-[9px] text-center text-gray-400 focus:text-white"
                            value={anchorRangeX.max}
                            onChange={e => setAnchorRangeX(p => ({...p, max: Number(e.target.value)}))}
                        />
                    </div>
                  </div>
                  <div className="space-y-3">
                    <div className="flex justify-between items-center text-[9px] font-bold text-gray-500 uppercase">
                      <label>{t("Pivot Y")}</label>
                      <span className="font-mono text-cyan-400">{Math.round(character[propertyTarget].transform.anchorY ?? 50)}%</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <input 
                            type="number" 
                            className="w-12 bg-white/5 border border-white/10 rounded px-1 py-1 text-[9px] text-center text-gray-400 focus:text-white"
                            value={anchorRangeY.min}
                            onChange={e => setAnchorRangeY(p => ({...p, min: Number(e.target.value)}))}
                        />
                        <input 
                          type="range" min={anchorRangeY.min} max={anchorRangeY.max} step="0.5"
                          value={character[propertyTarget].transform.anchorY ?? 50}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value);
                            setCharacter((prev: any) => {
                              if (!prev || !prev[propertyTarget]) return prev;
                              const p = prev[propertyTarget];
                              const t = p.transform;
                              const oldY = t.anchorY ?? 50;
                              const pos = compensateAnchorShift(
                                t.x, t.y, t.rotation, t.scaleX, t.scaleY, !!t.flipX, !!t.flipY,
                                t.anchorX ?? 50, oldY, t.anchorX ?? 50, val,
                                p.width || 150, p.height || 150
                              );
                              
                              if (autoKeyEnabled && handleAutoKey) {
                                  handleAutoKey({
                                      [`part:${activeSceneCharacterId}:${propertyTarget}:anchorY`]: val,
                                      [`part:${activeSceneCharacterId}:${propertyTarget}:x`]: pos.x,
                                      [`part:${activeSceneCharacterId}:${propertyTarget}:y`]: pos.y
                                  });
                              }
                              
                              return { ...prev, [propertyTarget]: { ...p, transform: { ...p.transform, anchorY: val, x: pos.x, y: pos.y } } };
                            });
                          }}
                          className="flex-1 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer cancel-drag [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-cyan-500 [&::-webkit-slider-thumb]:rounded-full"
                          style={{ touchAction: 'none' }}
                        />
                        <input 
                            type="number" 
                            className="w-12 bg-white/5 border border-white/10 rounded px-1 py-1 text-[9px] text-center text-gray-400 focus:text-white"
                            value={anchorRangeY.max}
                            onChange={e => setAnchorRangeY(p => ({...p, max: Number(e.target.value)}))}
                        />
                    </div>
                  </div>
                </div>
              )}
            </div>
        </div>
      ) : (
        <div className="space-y-2 pb-12">
          <div className="bg-[#1a1a1a] p-2 rounded-lg border border-white/5 space-y-2">
            <div className="flex bg-[#050505] p-1 rounded-md border border-white/5">
              <button 
                onClick={() => setActiveRigTool("BONE")} 
                className={`flex-1 flex items-center justify-center gap-1 py-1 rounded text-[10px] font-bold transition-all ${activeRigTool === "BONE" ? 'bg-cyan-500 text-black shadow-md shadow-cyan-500/20' : 'text-gray-500 hover:text-white'}`}
              >
                <RotateCcw size={12} /> {t("ROTATE")}
              </button>
              <button 
                onClick={() => setActiveRigTool("MOVE")} 
                className={`flex-1 flex items-center justify-center gap-1 py-1 rounded text-[10px] font-bold transition-all ${activeRigTool === "MOVE" ? 'bg-cyan-500 text-black shadow-md shadow-cyan-500/20' : 'text-gray-500 hover:text-white'}`}
              >
                <Move size={12} /> {t("MOVE")}
              </button>
              <button 
                onClick={() => setActiveRigTool("SCALE")} 
                className={`flex-1 flex items-center justify-center gap-1 py-1 rounded text-[10px] font-bold transition-all ${activeRigTool === "SCALE" ? 'bg-cyan-500 text-black shadow-md shadow-cyan-500/20' : 'text-gray-500 hover:text-white'}`}
              >
                <Maximize size={12} /> {t("SCALE")}
              </button>
            </div>
            
            <button
                onClick={() => setIsAnchorMode(true)}
                className="w-full py-2 bg-gradient-to-br from-cyan-900 to-blue-900 text-cyan-100 hover:text-white text-[10px] font-bold uppercase tracking-widest rounded transition-colors shadow-inner"
            >
                {t("+ Set Pivot / Anchor Points")}
            </button>

            <div className="text-[10px] text-gray-500 font-bold uppercase tracking-widest text-center mt-1">
              {t("Click on joints to select parts")}
            </div>

            <div className="w-full flex justify-center py-2 h-[180px]">
              <KinematicSkeleton
                character={character || {}}
                selectedPartId={propertyTarget}
                onSelectPart={(id: string) => { 
                  setSelectedPartIds([id]); 
                  setPropertyTarget(id); 
                }}
              />
            </div>
          </div>

          {propertyTarget && character?.[propertyTarget] && (
            <div className="bg-[#1a1a1a] p-3 rounded-lg border border-white/5 space-y-3 animate-in slide-in-from-bottom-2 fade-in duration-200">
              <div className="flex items-center justify-between gap-2 text-white text-[10px] uppercase font-bold tracking-widest mb-1">
                <div className="flex gap-2 items-center">
                  <Edit3 size={12} className="text-cyan-500"/> 
                  {character[propertyTarget].label}
                </div>
                {(character[propertyTarget].transform.anchorX !== 50 || character[propertyTarget].transform.anchorY !== 50) && (
                  <span className="text-[8px] bg-amber-500/10 text-amber-500 px-2 py-0.5 rounded-full">Anchored</span>
                )}
              </div>
              {activeRigTool === "BONE" ? (
                <div className="space-y-4 flex flex-col items-center">
                  <div className="flex w-full justify-between items-center text-[9px] font-bold text-gray-500 uppercase">
                    <label>{t("Rotation")}</label>
                    <span className="font-mono text-cyan-400">{Math.round(character[propertyTarget].transform.rotation)}°</span>
                  </div>
                  <CircularKnob 
                      value={((character[propertyTarget].transform.rotation % 360) + 360) % 360 > 180 ? ((character[propertyTarget].transform.rotation % 360) + 360) % 360 - 360 : ((character[propertyTarget].transform.rotation % 360) + 360) % 360}
                      onPointerDown={(e: React.PointerEvent) => {
                          const p = character[propertyTarget!];
                          if (!p) return;
                          
                          const localX = (p.width || 0) * (((p.transform.anchorX ?? 50) / 100) - 0.5);
                          const localY = (p.height || 0) * (((p.transform.anchorY ?? 50) / 100) - 0.5);
                          const pOriginX = p.transform.x + localX;
                          const pOriginY = p.transform.y + localY;
                          
                          const descendants = getRecursiveDescendantsAndChildren(propertyTarget!, character);
                          const descendantInitials: Record<string, { pivotX: number, pivotY: number, rotation: number, dLocalX: number, dLocalY: number }> = {};
                          descendants.forEach(id => {
                              const dPart = character[id];
                              if (dPart) {
                                  const dLocalX = (dPart.width || 0) * (((dPart.transform.anchorX ?? 50) / 100) - 0.5);
                                  const dLocalY = (dPart.height || 0) * (((dPart.transform.anchorY ?? 50) / 100) - 0.5);
                                  const dOriginX = dPart.transform.x + dLocalX;
                                  const dOriginY = dPart.transform.y + dLocalY;
                                  descendantInitials[id] = {
                                      pivotX: dOriginX,
                                      pivotY: dOriginY,
                                      rotation: dPart.transform.rotation,
                                      dLocalX,
                                      dLocalY
                                  };
                              }
                          });

                          (window as any).__rigDragState = {
                              initialRotation: p.transform.rotation,
                              pOriginX,
                              pOriginY,
                              descendants,
                              descendantInitials
                          };
                      }}
                      onChange={(e: any) => {
                          const state = (window as any).__rigDragState;
                          if (!state) return;
                          
                          let newVal = parseFloat(e.target.value);
                          // Calculate delta based on initial rotation mapped to -180...180
                          let mappedInitial = ((state.initialRotation % 360) + 360) % 360;
                          if (mappedInitial > 180) mappedInitial -= 360;
                          
                          let deltaAngle = newVal - mappedInitial;
                          if (deltaAngle > 180) deltaAngle -= 360;
                          if (deltaAngle < -180) deltaAngle += 360;
                          
                          const deltaRad = deltaAngle * (Math.PI / 180);
                          const cosA = Math.cos(deltaRad);
                          const sinA = Math.sin(deltaRad);
                          
                          setCharacter((prev: any) => {
                            if (!prev) return prev;
                            const next = { ...prev };
                            const targetPart = next[propertyTarget!];
                            if (!targetPart) return prev;
                            
                            next[propertyTarget!] = {
                                ...targetPart,
                                transform: {
                                    ...targetPart.transform,
                                    rotation: state.initialRotation + deltaAngle
                                }
                            };
                            
                            const autoKeyProps: Record<string, number> = {};
                            autoKeyProps[`part:${activeSceneCharacterId}:${propertyTarget!}:rotation`] = state.initialRotation + deltaAngle;
                            
                            if (state.descendants && state.descendantInitials) {
                                state.descendants.forEach((id: string) => {
                                    const initial = state.descendantInitials[id];
                                    const childPart = next[id];
                                    if (initial && childPart) {
                                        const dx = initial.pivotX - state.pOriginX;
                                        const dy = initial.pivotY - state.pOriginY;
                                        const newPivotX = state.pOriginX + dx * cosA - dy * sinA;
                                        const newPivotY = state.pOriginY + dx * sinA + dy * cosA;
                                        
                                        const newX = newPivotX - initial.dLocalX;
                                        const newY = newPivotY - initial.dLocalY;
                                        const newRotation = initial.rotation + deltaAngle;
                                        
                                        next[id] = {
                                            ...childPart,
                                            transform: {
                                                ...childPart.transform,
                                                x: newX,
                                                y: newY,
                                                rotation: newRotation
                                            }
                                        };
                                        
                                        autoKeyProps[`part:${activeSceneCharacterId}:${id}:x`] = newX;
                                        autoKeyProps[`part:${activeSceneCharacterId}:${id}:y`] = newY;
                                        autoKeyProps[`part:${activeSceneCharacterId}:${id}:rotation`] = newRotation;
                                    }
                                });
                            }

                            if (autoKeyEnabled && handleAutoKey) {
                                handleAutoKey(autoKeyProps);
                            }

                            return next;
                          });
                      }}
                      onPointerUp={(e: any) => {
                          setShouldRecordHistory(true);
                          delete (window as any).__rigDragState;
                      }}
                  />
                </div>
              ) : activeRigTool === "MOVE" ? (
                <div className="space-y-4">
                  <div className="space-y-3">
                    <div className="flex justify-between items-center text-[9px] font-bold text-gray-500 uppercase">
                      <label>{t("Position X")}</label>
                      <span className="font-mono text-cyan-400">{Math.round(character[propertyTarget].transform.x)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <input 
                            type="number" 
                            className="w-16 bg-white/5 border border-white/10 rounded px-1 py-1 text-[9px] text-center text-gray-400 focus:text-white"
                            value={posRangeX.min}
                            onChange={e => setPosRangeX(p => ({...p, min: Number(e.target.value)}))}
                        />
                        <input 
                          type="range" min={posRangeX.min} max={posRangeX.max} 
                          value={character[propertyTarget].transform.x}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value);
                            setCharacter((prev: any) => {
                              if (!prev) return prev;
                              const p = prev[propertyTarget];
                              const deltaX = val - p.transform.x;
                              const next = { ...prev, [propertyTarget]: { ...p, transform: { ...p.transform, x: val } } };
                              const autoKeyProps: Record<string, number> = {};
                              autoKeyProps[`part:${activeSceneCharacterId}:${propertyTarget}:x`] = val;

                              const descendants = getRecursiveDescendantsAndChildren(propertyTarget, prev);
                              descendants.forEach((id) => {
                                  const childPart = prev[id];
                                  if (childPart) {
                                      const newX = childPart.transform.x + deltaX;
                                      next[id] = {
                                          ...childPart,
                                          transform: {
                                              ...childPart.transform,
                                              x: newX
                                          }
                                      };
                                      autoKeyProps[`part:${activeSceneCharacterId}:${id}:x`] = newX;
                                  }
                              });

                              if (autoKeyEnabled && handleAutoKey) {
                                  handleAutoKey(autoKeyProps);
                              }

                              return next;
                            });
                            setShouldRecordHistory(true);
                          }}
                          className="flex-1 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer cancel-drag [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-cyan-500 [&::-webkit-slider-thumb]:rounded-full"
                          style={{ touchAction: 'none' }}
                        />
                        <input 
                            type="number" 
                            className="w-16 bg-white/5 border border-white/10 rounded px-1 py-1 text-[9px] text-center text-gray-400 focus:text-white"
                            value={posRangeX.max}
                            onChange={e => setPosRangeX(p => ({...p, max: Number(e.target.value)}))}
                        />
                    </div>
                  </div>
                  <div className="space-y-3">
                    <div className="flex justify-between items-center text-[9px] font-bold text-gray-500 uppercase">
                      <label>{t("Position Y")}</label>
                      <span className="font-mono text-cyan-400">{Math.round(character[propertyTarget].transform.y)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <input 
                            type="number" 
                            className="w-16 bg-white/5 border border-white/10 rounded px-1 py-1 text-[9px] text-center text-gray-400 focus:text-white"
                            value={posRangeY.min}
                            onChange={e => setPosRangeY(p => ({...p, min: Number(e.target.value)}))}
                        />
                        <input 
                          type="range" min={posRangeY.min} max={posRangeY.max} 
                          value={character[propertyTarget].transform.y}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value);
                            setCharacter((prev: any) => {
                              if (!prev) return prev;
                              const p = prev[propertyTarget];
                              const deltaY = val - p.transform.y;
                              const next = { ...prev, [propertyTarget]: { ...p, transform: { ...p.transform, y: val } } };
                              const autoKeyProps: Record<string, number> = {};
                              autoKeyProps[`part:${activeSceneCharacterId}:${propertyTarget}:y`] = val;

                              const descendants = getRecursiveDescendantsAndChildren(propertyTarget, prev);
                              descendants.forEach((id) => {
                                  const childPart = prev[id];
                                  if (childPart) {
                                      const newY = childPart.transform.y + deltaY;
                                      next[id] = {
                                          ...childPart,
                                          transform: {
                                              ...childPart.transform,
                                              y: newY
                                          }
                                      };
                                      autoKeyProps[`part:${activeSceneCharacterId}:${id}:y`] = newY;
                                  }
                              });

                              if (autoKeyEnabled && handleAutoKey) {
                                  handleAutoKey(autoKeyProps);
                              }

                              return next;
                            });
                            setShouldRecordHistory(true);
                          }}
                          className="flex-1 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer cancel-drag [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-cyan-500 [&::-webkit-slider-thumb]:rounded-full"
                          style={{ touchAction: 'none' }}
                        />
                        <input 
                            type="number" 
                            className="w-16 bg-white/5 border border-white/10 rounded px-1 py-1 text-[9px] text-center text-gray-400 focus:text-white"
                            value={posRangeY.max}
                            onChange={e => setPosRangeY(p => ({...p, max: Number(e.target.value)}))}
                        />
                    </div>
                  </div>
                </div>
              ) : activeRigTool === "SCALE" ? (
                <div className="space-y-4">
                  <div className="space-y-3">
                    <div className="flex justify-between items-center text-[9px] font-bold text-gray-500 uppercase">
                      <label>{t("Uniform Scale")}</label>
                      <span className="font-mono text-cyan-400">{(character[propertyTarget].transform.scaleX || 1).toFixed(2)}x</span>
                    </div>
                    <input 
                      type="range" min="0.1" max="5" step="0.1"
                      value={character[propertyTarget].transform.scaleX || 1}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        setCharacter((prev: any) => {
                          if (!prev) return prev;
                          const p = prev[propertyTarget];
                          
                          if (autoKeyEnabled && handleAutoKey) {
                              handleAutoKey({
                                  [`part:${activeSceneCharacterId}:${propertyTarget}:scaleX`]: val,
                                  [`part:${activeSceneCharacterId}:${propertyTarget}:scaleY`]: val
                              });
                          }

                          return { ...prev, [propertyTarget]: { ...p, transform: { ...p.transform, scaleX: val, scaleY: val } } };
                        });
                        setShouldRecordHistory(true);
                      }}
                      className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer cancel-drag [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-cyan-500 [&::-webkit-slider-thumb]:rounded-full"
                      style={{ touchAction: 'none' }}
                    />
                  </div>
                  <div className="space-y-3">
                    <div className="flex justify-between items-center text-[9px] font-bold text-gray-500 uppercase">
                      <label>{t("Scale X")}</label>
                      <span className="font-mono text-cyan-400">{(character[propertyTarget].transform.scaleX || 1).toFixed(2)}x</span>
                    </div>
                      <input 
                      type="range" min="0.1" max="5" step="0.1"
                      value={character[propertyTarget].transform.scaleX || 1}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        setCharacter((prev: any) => {
                          if (!prev) return prev;
                          const p = prev[propertyTarget];
                          
                          if (autoKeyEnabled && handleAutoKey) {
                              handleAutoKey({
                                  [`part:${activeSceneCharacterId}:${propertyTarget}:scaleX`]: val
                              });
                          }

                          return { ...prev, [propertyTarget]: { ...p, transform: { ...p.transform, scaleX: val } } };
                        });
                        setShouldRecordHistory(true);
                      }}
                      className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer cancel-drag [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-cyan-500 [&::-webkit-slider-thumb]:rounded-full"
                      style={{ touchAction: 'none' }}
                    />
                  </div>
                  <div className="space-y-3">
                    <div className="flex justify-between items-center text-[9px] font-bold text-gray-500 uppercase">
                      <label>{t("Scale Y")}</label>
                      <span className="font-mono text-cyan-400">{(character[propertyTarget].transform.scaleY || 1).toFixed(2)}x</span>
                    </div>
                      <input 
                      type="range" min="0.1" max="5" step="0.1"
                      value={character[propertyTarget].transform.scaleY || 1}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        setCharacter((prev: any) => {
                          if (!prev) return prev;
                          const p = prev[propertyTarget];
                          
                          if (autoKeyEnabled && handleAutoKey) {
                              handleAutoKey({
                                  [`part:${activeSceneCharacterId}:${propertyTarget}:scaleY`]: val
                              });
                          }

                          return { ...prev, [propertyTarget]: { ...p, transform: { ...p.transform, scaleY: val } } };
                        });
                        setShouldRecordHistory(true);
                      }}
                      className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer cancel-drag [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-cyan-500 [&::-webkit-slider-thumb]:rounded-full"
                      style={{ touchAction: 'none' }}
                    />
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
