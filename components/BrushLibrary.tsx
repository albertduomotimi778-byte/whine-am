
import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useLanguage } from '../utils/LanguageContext';
import { BrushPreset } from '../types';
import { PenTool, Highlighter, Sparkles, SprayCan, X, Search, Pencil, Pen, Brush, Star, Heart, Cloud, Zap, Grid, Eraser, Feather, Droplets, Leaf, Check } from 'lucide-react';

interface BrushLibraryProps {
    onSelect: (brush: BrushPreset) => void;
    onClose: () => void;
    currentBrushId: string;
}

// --- CURATED BRUSH PRESETS (Clip Studio Paint Style) ---
const ALL_BRUSHES: BrushPreset[] = [
    // --- PEN (Crisp, Inking) ---
    {
        id: 'pen_g',
        name: 'G-Pen',
        category: 'PEN',
        engine: 'INK_G_PEN',
        size: 4,
        opacity: 1.0,
        spacing: 0.1,
        hardness: 1.0,
        pressureSensitive: true,
        icon: Pen,
        description: 'Classic crisp manga inking pen with high pressure sensitivity for thick and thin lines.'
    },
    {
        id: 'pen_mapping',
        name: 'Mapping Pen',
        category: 'PEN',
        engine: 'INK_MAPPING',
        size: 2,
        opacity: 1.0,
        spacing: 0.05,
        hardness: 1.0,
        pressureSensitive: true,
        icon: Pen,
        description: 'Ultra-thin, precise pen for fine details and small lettering.'
    },
    {
        id: 'marker_flat',
        name: 'Flat Marker',
        category: 'PEN',
        engine: 'MARKER_FLAT',
        size: 15,
        opacity: 0.8,
        spacing: 0.05,
        hardness: 1.0,
        blendMode: 'multiply',
        icon: Highlighter,
        description: 'Bold, flat-tipped marker ideal for flat coloring, cell shading, and thick outlines.'
    },

    // --- PENCIL (Textured, Sketching) ---
    {
        id: 'pencil_real',
        name: 'Real Pencil',
        category: 'PENCIL',
        engine: 'PENCIL_REAL',
        size: 4,
        opacity: 0.8,
        spacing: 0.25,
        texture: true,
        pressureSensitive: true,
        icon: Pencil,
        description: 'Graphite-textured pencil that feels like sketching on paper for rough layouts and initial drafts.'
    },
    {
        id: 'pencil_mechanical',
        name: 'Mechanical Pencil',
        category: 'PENCIL',
        engine: 'PENCIL_MECHANICAL',
        size: 1,
        opacity: 0.7,
        spacing: 0.1,
        hardness: 0.8,
        icon: Pencil,
        description: 'Consistent, clean mechanical pencil for detailed construction lines.'
    },
    {
        id: 'pencil_design',
        name: 'Design Pencil',
        category: 'PENCIL',
        engine: 'PENCIL_REAL',
        size: 8,
        opacity: 0.5,
        spacing: 0.1,
        texture: true,
        icon: Pencil,
        description: 'Soft, wide pencil brush designed for filling large areas with light, sketchy shading.'
    },

    // --- PAINT (Blending, Soft) ---
    {
        id: 'paint_watercolor',
        name: 'Transparent Watercolor',
        category: 'PAINT',
        engine: 'PAINT_WATERCOLOR',
        size: 20,
        opacity: 0.4,
        spacing: 0.15,
        hardness: 0.5,
        blendMode: 'multiply',
        icon: Brush,
        description: 'Transparent, buildable watercolor brush that blends colors with every stroke.'
    },
    {
        id: 'paint_oil',
        name: 'Oil Paint',
        category: 'PAINT',
        engine: 'PAINT_OIL',
        size: 15,
        opacity: 1.0,
        spacing: 0.1,
        hardness: 0.9,
        icon: Brush,
        description: 'Thick, creamy oil brush for textured, painterly strokes with strong pigment.'
    },
    {
        id: 'paint_gouache',
        name: 'Gouache',
        category: 'PAINT',
        engine: 'PAINT_OIL',
        size: 12,
        opacity: 0.9,
        spacing: 0.1,
        hardness: 1.0,
        icon: Brush,
        description: 'Opaque gouache brush providing flat coverage and clean, matte color transitions.'
    },

    // --- AIRBRUSH (Gradients) ---
    {
        id: 'air_soft',
        name: 'Soft Airbrush',
        category: 'AIRBRUSH',
        engine: 'AIRBRUSH_SOFT',
        size: 40,
        opacity: 0.3,
        spacing: 0.1,
        hardness: 0.0,
        icon: SprayCan,
        description: 'Ultra-soft airbrush for smooth gradients, glows, and subtle environmental lighting.'
    },
    {
        id: 'air_highlight',
        name: 'Highlight Spray',
        category: 'AIRBRUSH',
        engine: 'AIRBRUSH_SOFT',
        size: 25,
        opacity: 0.6,
        spacing: 0.1,
        hardness: 0.2,
        blendMode: 'screen',
        icon: SprayCan,
        description: 'Lightweight airbrush set to screen blend mode for glowing, luminous highlights.'
    },
    {
        id: 'air_droplet',
        name: 'Droplet Spray',
        category: 'AIRBRUSH',
        engine: 'AIRBRUSH_DROPLET',
        size: 30,
        opacity: 0.8,
        spacing: 0.5,
        jitter: 0.8,
        icon: Droplets,
        description: 'Scatter brush for texture-rich droplet effects, splatter, or surface noise.'
    },

    // --- DECORATION (Stamps, FX) ---
    {
        id: 'decor_sparkle',
        name: 'Sparkle Brush',
        category: 'DECOR',
        engine: 'STAMP_SPARKLE',
        size: 25,
        opacity: 1.0,
        spacing: 1.5,
        rotationMode: 'RANDOM',
        blendMode: 'screen',
        icon: Sparkles,
        description: 'Magic sparkle stamp with shimmering, randomized distribution.'
    },
    {
        id: 'decor_star',
        name: 'Star Scatter',
        category: 'DECOR',
        engine: 'STAMP_STAR',
        size: 15,
        opacity: 1.0,
        spacing: 1.2,
        jitter: 0.5,
        rotationMode: 'RANDOM',
        icon: Star,
        description: 'Scattered star shapes for celestial backgrounds and magical effects.'
    },
    {
        id: 'decor_heart',
        name: 'Heart Ribbon',
        category: 'DECOR',
        engine: 'STAMP_HEART',
        size: 20,
        opacity: 0.9,
        spacing: 0.8,
        rotationMode: 'FOLLOW',
        icon: Heart,
        description: 'Continuous heart-shaped ribbon for adorable, flowing decorations.'
    },
    {
        id: 'decor_leaf',
        name: 'Falling Leaves',
        category: 'DECOR',
        engine: 'STAMP_LEAF',
        size: 18,
        opacity: 0.9,
        spacing: 1.0,
        jitter: 0.6,
        rotationMode: 'RANDOM',
        icon: Leaf,
        description: 'Autumnal leaf stamps that fall into place with randomized rotation.'
    },
    {
        id: 'decor_lace',
        name: 'Lace Pattern',
        category: 'DECOR',
        engine: 'STAMP_LACE',
        size: 30,
        opacity: 1.0,
        spacing: 0.6,
        rotationMode: 'FOLLOW',
        icon: Feather,
        description: 'Intricate, repetitive lace brush designed to follow the path of your stroke.'
    },

    // --- ERASERS ---
    {
        id: 'eraser_hard',
        name: 'Hard Eraser',
        category: 'ERASER',
        engine: 'ERASER_HARD',
        size: 10,
        opacity: 1.0,
        spacing: 0.1,
        hardness: 1.0,
        icon: Eraser,
        description: 'Solid eraser for sharp, surgical removal of parts of your drawing.'
    },
    {
        id: 'eraser_soft',
        name: 'Soft Eraser',
        category: 'ERASER',
        engine: 'ERASER_SOFT',
        size: 25,
        opacity: 0.5,
        spacing: 0.1,
        hardness: 0.0,
        icon: Eraser,
        description: 'Soft-edged eraser for creating smooth, feathered transparency gradients.'
    },
    {
        id: 'eraser_kneaded',
        name: 'Kneaded Eraser',
        category: 'ERASER',
        engine: 'ERASER_KNEADED',
        size: 20,
        opacity: 0.3,
        spacing: 0.2,
        texture: true,
        icon: Eraser,
        description: 'Subtle, pencil-textured eraser for gently lifting pigment or creating highlights.'
    },
    
    // --- SPECIAL ---
    {
        id: 'pixel_pen',
        name: 'Dot Pen',
        category: 'PEN',
        engine: 'PIXEL',
        size: 1,
        opacity: 1.0,
        spacing: 0.0,
        icon: Grid,
        description: 'Hard-pixelated pen for pixel art or perfectly continuous line, non-aliased drawing.'
    }
];

export const BrushLibrary: React.FC<BrushLibraryProps> = ({ onSelect, onClose, currentBrushId }) => {
  const { t } = useLanguage();

    const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
    const [search, setSearch] = useState('');

    const filteredBrushes = useMemo(() => {
        return ALL_BRUSHES.filter(b => {
            const matchCat = selectedCategory === 'ALL' || b.category === selectedCategory;
            const matchSearch = b.name.toLowerCase().includes(search.toLowerCase());
            return matchCat && matchSearch;
        });
    }, [selectedCategory, search]);

    const categories = ['ALL', 'PEN', 'PENCIL', 'PAINT', 'AIRBRUSH', 'DECOR', 'ERASER'];

    return (
        <div className="fixed inset-0 z-[100] bg-black/80  flex items-center justify-center p-4 animate-in zoom-in-95 duration-200">
            <div className="bg-[#111111] border border-white/10 rounded-2xl w-full max-w-3xl h-[70vh] flex flex-col overflow-hidden shadow-2xl">
                
                {/* Header & Controls */}
                <div className="px-5 py-4 border-b border-white/5 flex flex-col gap-4 bg-[#111] shrink-0">
                    <div className="flex justify-between items-center">
                        <div className="flex items-center gap-2">
                            <Brush size={18} className="text-gray-400" />
                            <h2 className="text-sm font-semibold text-white tracking-tight">{t('Brush Library')}</h2>
                            <span className="text-[10px] text-gray-500 ml-2 bg-white/5 px-2 py-0.5 rounded-full">{ALL_BRUSHES.length}</span>
                        </div>
                        <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors opacity-70 hover:opacity-100"><X size={18}/></button>
                    </div>

                    <div className="flex items-center gap-3">
                        <div className="relative w-48 shrink-0">
                            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"/>
                            <input 
                                type="text" 
                                placeholder={t('Search...')} 
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                                className="w-full bg-[#1a1a1a] border border-white/5 focus:border-cyan-500/50 rounded-lg pl-9 pr-4 py-1.5 text-xs text-white outline-none transition-all placeholder:text-gray-600"
                            />
                        </div>
                        <div className="flex-1 flex items-center gap-1.5 overflow-x-auto custom-scrollbar pb-1">
                            {categories.map(cat => (
                                <button
                                    key={cat}
                                    onClick={() => setSelectedCategory(cat)}
                                    className={`px-3 py-1.5 rounded-lg text-[10px] font-medium tracking-wide whitespace-nowrap transition-colors ${selectedCategory === cat ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20' : 'text-gray-400 hover:bg-white/5 border border-transparent'}`}
                                >
                                    {cat === 'ALL' ? t('ALL') : t(cat)}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Brush List */}
                <div className="flex-1 overflow-y-auto bg-[#0a0a0a] p-3 custom-scrollbar scroll-smooth">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {filteredBrushes.map(brush => {
                            const Icon = brush.icon || PenTool;
                            const isSelected = brush.id === currentBrushId;
                            
                            return (
                                <button 
                                    key={brush.id}
                                    onClick={() => onSelect(brush)}
                                    className={`
                                        flex items-center gap-4 p-3 rounded-xl border text-left transition-all duration-200 group
                                        ${isSelected ? 'bg-cyan-900/10 border-cyan-500/30' : 'bg-[#141414] border-white/5 hover:bg-[#1a1a1a] hover:border-white/10'}
                                    `}
                                >
                                    <div className={`w-10 h-10 shrink-0 rounded-lg flex items-center justify-center transition-colors ${isSelected ? 'bg-cyan-500 text-black' : 'bg-black/50 text-gray-500 group-hover:text-white group-hover:bg-black'}`}>
                                        <Icon size={18} strokeWidth={1.5} />
                                    </div>

                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center justify-between gap-2 mb-0.5">
                                            <span className={`text-xs font-semibold truncate ${isSelected ? 'text-cyan-400' : 'text-white'}`}>{brush.name}</span>
                                            <span className="text-[9px] font-mono text-gray-600 bg-black/40 px-1.5 py-0.5 rounded shrink-0">{brush.category}</span>
                                        </div>
                                        <div className="text-[10px] text-gray-500 truncate">{brush.description}</div>
                                        
                                        {/* Specs */}
                                        <div className="flex items-center gap-3 mt-1.5 opacity-80 group-hover:opacity-100 transition-opacity">
                                            <div className="flex items-center gap-1 text-[9px] text-gray-400 font-mono">
                                                <div className="w-1.5 h-1.5 rounded-full bg-cyan-700/50" /> {brush.size}px
                                            </div>
                                            <div className="flex items-center gap-1 text-[9px] text-gray-400 font-mono">
                                                <div className="w-1.5 h-1.5 rounded-full bg-gray-700" /> OP: {Math.round(brush.opacity * 100)}%
                                            </div>
                                            {brush.pressureSensitive && (
                                                <span className="text-[9px] text-cyan-600/80 font-mono border border-cyan-900/40 px-1 rounded">Pressure</span>
                                            )}
                                        </div>
                                    </div>
                                    
                                    {isSelected && (
                                        <div className="shrink-0 text-cyan-500 mr-1">
                                            <Check size={16} strokeWidth={2} />
                                        </div>
                                    )}
                                </button>
                            );
                        })}
                        {filteredBrushes.length === 0 && (
                            <div className="col-span-1 md:col-span-2 flex flex-col items-center justify-center py-20 text-gray-500">
                                <Search size={24} className="mb-3 opacity-20" />
                                <p className="text-xs">No brushes found.</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};