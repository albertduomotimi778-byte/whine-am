
import React, { useRef } from 'react';
import { useLanguage } from '../utils/LanguageContext';
import { Keyframe } from '../types';
import { motion } from 'motion/react';

interface KeyframeTimelineProps {
  duration: number;
  keyframes: Keyframe[];
  selectedKeyframeId: string | null;
  onSelectKeyframe: (id: string | null) => void;
  onAddKeyframe: (time: number) => void;
  onUpdateKeyframe: (id: string, updates: Partial<Keyframe>) => void;
  onRemoveKeyframe: (id: string) => void;
  onEditKeyframe?: (id: string, e: React.MouseEvent) => void;
  onCopyKeyframe?: (id: string) => void;
  onPasteKeyframe?: (time: number) => void;
  hasClipboard?: boolean;
  zoomLevel: number;
  height?: number;
  theme?: 'light' | 'dark';
  label?: string;
}

export const KeyframeTimeline = React.memo(({
  duration,
  keyframes,
  selectedKeyframeId,
  onSelectKeyframe,
  onAddKeyframe,
  onUpdateKeyframe,
  onRemoveKeyframe,
  onEditKeyframe,
  zoomLevel,
  height = 32,
  theme = 'light',
}: KeyframeTimelineProps) => {
  const containerRef = useRef<HTMLDivElement>(null);

  const handlePointerDown = (e: React.PointerEvent) => {
      // Background click -> Deselect
      if (e.button === 0) {
          onSelectKeyframe(null);
      }
  };
  
  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation(); 
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const width = rect.width;
    const time = (x / width) * duration;
    
    // Check if near existing to edit easing
    const threshold = 15 / width * duration;
    const existing = keyframes.find(k => Math.abs(k.time - time) < threshold);
    
    if (existing) {
        if (onEditKeyframe) onEditKeyframe(existing.id, e);
    } else {
        onAddKeyframe(time);
    }
  };

  const getKeyframeStyle = (kf: Keyframe, isSelected: boolean) => {
      // Default Animation -> Orange (Amber)
      return isSelected 
        ? 'bg-amber-400 border-2 border-white scale-125 md:scale-150 shadow-[0_0_10px_rgba(251,191,36,0.8)]' 
        : 'bg-amber-500 border border-amber-300 hover:scale-125 hover:bg-amber-300';
  };

  return (
    <div 
        ref={containerRef}
        className="relative w-full overflow-visible pointer-events-auto" 
        style={{ height, touchAction: 'none' }}
        onDoubleClick={handleDoubleClick}
        onPointerDown={handlePointerDown}
    >
      {/* Render Keyframes */}
      {keyframes.map(kf => {
          const position = (kf.time / duration) * 100;
          const isSelected = selectedKeyframeId === kf.id;
          const styleClass = getKeyframeStyle(kf, isSelected);
          
          return (
              <div
                key={kf.id}
                className={`absolute top-0 bottom-0 w-px z-30 group pointer-events-auto`} 
                style={{ left: `${position}%` }}
              >
                  {/* Keyframe Diamond */}
                  <motion.div
                    initial={{ scale: 0, rotate: 45 }}
                    animate={{ scale: 1, rotate: 45 }}
                    whileHover={{ scale: 1.5 }}
                    whileTap={{ scale: 0.9 }}
                    className={`
                        absolute top-1/2 -translate-y-1/2 -translate-x-1/2 cursor-pointer
                        w-4 h-4 md:w-3 md:h-3 shadow-sm z-30
                        ${styleClass}
                    `}
                    onPointerDown={(e) => { 
                        e.stopPropagation(); 
                        onSelectKeyframe(kf.id);
                    }}
                    onClick={(e) => e.stopPropagation()} // Prevent bubble to container
                  >
                      {/* Inner dot for detail */}
                      <div className="absolute inset-0 m-auto w-0.5 h-0.5 bg-black/50 rounded-full"></div>
                  </motion.div>
                  
                  {/* Tooltip on Hover */}
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-3 hidden md:group-hover:flex flex-col items-center pointer-events-none z-50 animate-in fade-in slide-in-from-bottom-1">
                       <div className={`text-[9px] px-2 py-1.5 rounded-lg border font-mono font-bold whitespace-nowrap mb-1 shadow-xl flex flex-col items-center gap-0.5 ${theme === 'light' ? 'bg-white border-gray-200 text-gray-800' : 'bg-[#151515] border-white/20 text-gray-200'}`}>
                           <span className="text-amber-500">{Object.keys(kf.properties).length} PROPS</span>
                           <span className="text-[8px] opacity-60 uppercase tracking-wider">{kf.easing.replace('Ease', '')}</span>
                       </div>
                       <div className={`w-0 h-0 border-l-[4px] border-l-transparent border-r-[4px] border-r-transparent border-t-[4px] ${theme === 'light' ? 'border-t-white' : 'border-t-[#151515]'}`}></div>
                  </div>
              </div>
          );
      })}

      {/* Connecting Lines Overlay - Subtle */}
      <svg className="absolute inset-0 pointer-events-none w-full h-full z-0 opacity-40 overflow-visible">
         <polyline 
            points={keyframes
                .sort((a,b) => a.time - b.time)
                .map((k) => {
                    const x = (k.time / duration) * 100;
                    return `${x},${height/2}`; 
                }).join(' ')}
            fill="none"
            stroke={theme === 'light' ? '#f59e0b' : '#fbbf24'} // Amber stroke
            strokeWidth="2"
            strokeDasharray="4 2"
         />
      </svg>
    </div>
  );
});
