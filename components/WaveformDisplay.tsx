
import React, { useRef, useEffect, useState, useCallback } from 'react';
import { useLanguage } from '../utils/LanguageContext';

interface WaveformDisplayProps {
  buffer: AudioBuffer | null;
  color: string;
  progress: number; // 0 to 1
  duration: number; // Timeline duration in seconds
  onSeek: (progress: number) => void;
  onSelect: (start: number, end: number) => void;
  selection: { start: number, end: number } | null;
  isEditMode: boolean; // Kept for compatibility but ignored for visibility logic
  isActiveTrack: boolean;
  height?: number;
  zoomLevel?: number;
  verticalZoom?: number;
  theme?: 'light' | 'dark';
  isLooping?: boolean; 
  playheadPosition?: number; // 0 to 1
  frameDuration?: number; // Seconds per frame
  currentFrameIndex?: number;
}

export const WaveformDisplay = React.memo<WaveformDisplayProps>(({ 
  buffer, 
  color, 
  progress, 
  duration,
  onSeek, 
  onSelect,
  selection,
  isEditMode,
  isActiveTrack,
  height = 80,
  zoomLevel = 1,
  verticalZoom = 1,
  theme = 'light',
  isLooping = false,
  playheadPosition = 0,
  frameDuration,
  currentFrameIndex
}) => {
  const { t } = useLanguage();

  const waveformCanvasRef = useRef<HTMLCanvasElement>(null); 
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  
  // Interaction State for Crop Handles
  const [cropDragMode, setCropDragMode] = useState<'LEFT' | 'RIGHT' | null>(null);
  const dragStartXRef = useRef<number>(0);
  const initialTimeRef = useRef<number>(0);

  // 1. Draw Static Waveform - OPTIMIZED: Only triggers on data change, not loop
  const drawWaveform = useCallback(() => {
    if (!waveformCanvasRef.current || !containerRef.current) return;

    const canvas = waveformCanvasRef.current;
    const ctx = canvas.getContext('2d', { alpha: true });
    
    // Virtual width based on zoom
    const containerWidth = containerRef.current.clientWidth;
    const width = containerWidth * zoomLevel; 
    
    const dpr = window.devicePixelRatio || 1;
    // Resize checks
    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        ctx?.scale(dpr, dpr);
    }

    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);
    
    if (!buffer) return;

    const timelineDuration = Math.max(duration, 1);
    const audioDuration = buffer.duration;
    const audioWidth = (audioDuration / timelineDuration) * width;
    
    // Performance: Don't draw if audio is completely off-screen (though typical zoom puts it in view)
    if (audioWidth < 1) return;

    const data = buffer.getChannelData(0);
    // Downsampling logic for mobile performance
    const step = Math.ceil(data.length / audioWidth);
    const amp = height / 2;

    ctx.fillStyle = isActiveTrack 
        ? color 
        : (theme === 'light' ? `${color}B3` : `${color}CC`);
        
    ctx.beginPath();
    
    const drawLimit = Math.min(width, Math.ceil(audioWidth));
    
    for (let i = 0; i < drawLimit; i++) {
      let min = 1.0;
      let max = -1.0;
      
      // Optimized peak finding
      if (step >= 1) {
          const skip = Math.max(1, Math.floor(step / 10)); // Skip samples for speed on mobile
          for (let j = 0; j < step; j += skip) { 
            const index = Math.floor(i * step + j);
            if (index < data.length) {
                const datum = data[index];
                if (datum < min) min = datum;
                if (datum > max) max = datum;
            }
          }
      } else {
           const index = Math.floor(i * (data.length / audioWidth));
           if (index < data.length) {
               min = data[index];
               max = data[index];
           }
      }

      if (min > max) { min = 0; max = 0; }
      
      min *= verticalZoom;
      max *= verticalZoom;
      
      // Clamp
      if (max > 1) max = 1;
      if (min < -1) min = -1;

      const y = (1 + min) * amp;
      const h = Math.max(1, (max - min) * amp);
      ctx.fillRect(i, y, 1, h);
    }

    // --- DRAW FRAME MARKERS ---
    if (frameDuration && frameDuration > 0) {
        ctx.strokeStyle = theme === 'light' ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)';
        ctx.lineWidth = 1;
        const pixelsPerSecond = width / (buffer?.duration || duration);
        const frameWidthPixels = frameDuration * pixelsPerSecond;
        
        // Only draw if markers are visible (not too dense)
        if (frameWidthPixels > 4) {
            ctx.beginPath();
            for (let x = 0; x < width; x += frameWidthPixels) {
                ctx.moveTo(x, 0);
                ctx.lineTo(x, height);
            }
            ctx.stroke();

            // Highlight active frame region
            if (typeof currentFrameIndex === 'number') {
                const activeFrameStart = (currentFrameIndex * (frameDuration || 0)) * pixelsPerSecond;
                ctx.fillStyle = theme === 'light' ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.15)';
                ctx.fillRect(activeFrameStart, 0, frameWidthPixels, height);
                
                // Add a stronger border for the current frame
                ctx.strokeStyle = '#06b6d4';
                ctx.lineWidth = 2;
                ctx.strokeRect(activeFrameStart, 0, frameWidthPixels, height);
            }
        }
    }
  }, [buffer, color, height, isActiveTrack, verticalZoom, theme, duration, zoomLevel, frameDuration, currentFrameIndex]); 

  // Trigger Static Draw
  useEffect(() => {
     drawWaveform();
  }, [drawWaveform]);

  // Smooth Scrolling Logic
  useEffect(() => {
    if (!scrollContainerRef.current || !containerRef.current || zoomLevel <= 1) return;
    
    const containerWidth = containerRef.current.clientWidth;
    const virtualWidth = containerWidth * zoomLevel;
    const playheadX = playheadPosition * virtualWidth;
    
    // Center the playhead
    const scrollX = playheadX - containerWidth / 2;
    scrollContainerRef.current.style.transform = `translateX(${-Math.max(0, Math.min(virtualWidth - containerWidth, scrollX))}px)`;
  }, [playheadPosition, zoomLevel]);

  // --- CROP HANDLE LOGIC ---
  const handleCropStart = (e: React.MouseEvent | React.TouchEvent, mode: 'LEFT' | 'RIGHT') => {
      e.stopPropagation();
      e.preventDefault(); // Prevent scroll
      setCropDragMode(mode);
      
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      dragStartXRef.current = clientX;
      
      // Store initial time for delta calculation
      if (selection) {
          initialTimeRef.current = mode === 'LEFT' ? selection.start : selection.end;
      } else {
          // If no selection, initialize it
          initialTimeRef.current = mode === 'LEFT' ? 0 : duration;
          // Also trigger initial selection if null
          onSelect(0, duration);
      }
  };

  // --- MAIN POINTER HANDLER (Background) ---
  const handleSeek = (e: React.PointerEvent) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const p = Math.max(0, Math.min(1, x / rect.width));
    onSeek(p);
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    // If clicking a handle, don't trigger seek
    if (cropDragMode) return;
    
    e.preventDefault();
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    handleSeek(e);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (e.buttons > 0 && !cropDragMode) {
      handleSeek(e);
    }
  };

  // Global Move/Up listeners for dragging handles outside container
  useEffect(() => {
      const handleGlobalMove = (e: MouseEvent | TouchEvent) => {
          if (!cropDragMode || !containerRef.current || !selection) return;
          
          const clientX = 'touches' in e ? e.touches[0].clientX : (e as MouseEvent).clientX;
          const rect = containerRef.current.getBoundingClientRect();
          const pixelsPerSecond = rect.width / duration;
          
          // Delta in seconds
          const deltaX = clientX - dragStartXRef.current;
          const deltaSeconds = deltaX / pixelsPerSecond;
          
          let newTime = initialTimeRef.current + deltaSeconds;
          
          // Constraints
          if (cropDragMode === 'LEFT') {
              // Left cannot go < 0 or > Right
              newTime = Math.max(0, Math.min(newTime, selection.end - 0.1));
              onSelect(newTime, selection.end);
          } else {
              // Right cannot go > {t('duration or')} < Left
              newTime = Math.min(duration, Math.max(newTime, selection.start + 0.1));
              onSelect(selection.start, newTime);
          }
      };

      const handleGlobalUp = () => {
          setCropDragMode(null);
      };

      if (cropDragMode) {
          window.addEventListener('mousemove', handleGlobalMove);
          window.addEventListener('touchmove', handleGlobalMove);
          window.addEventListener('mouseup', handleGlobalUp);
          window.addEventListener('touchend', handleGlobalUp);
      }

      return () => {
          window.removeEventListener('mousemove', handleGlobalMove);
          window.removeEventListener('touchmove', handleGlobalMove);
          window.removeEventListener('mouseup', handleGlobalUp);
          window.removeEventListener('touchend', handleGlobalUp);
      };
  }, [cropDragMode, duration, selection, onSelect]);

  // Calculate percentages for UI
  const leftPct = selection ? (selection.start / duration) * 100 : 0;
  const rightPct = selection ? (selection.end / duration) * 100 : 100;
  const widthPct = rightPct - leftPct;

  // STRICT VISIBILITY: Only show crop handles if LOOPING is active
  const showCropUI = isLooping && selection;

  return (
    <div 
      ref={containerRef} 
      className={`relative w-full h-full select-none group transition-colors duration-300 overflow-hidden ${theme === 'dark' ? 'bg-black/20' : ''}`}
      style={{ height, touchAction: 'none' }} 
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
    >
      <div 
        ref={scrollContainerRef}
        className="absolute inset-0 w-full h-full transition-transform duration-300 ease-out"
        style={{ width: `${zoomLevel * 100}%` }}
      >
        <canvas ref={waveformCanvasRef} className="absolute inset-0 block w-full h-full pointer-events-none" />
        
        {/* Playhead */}
        <div 
            className="absolute top-0 bottom-0 w-[2px] bg-white z-30 shadow-[0_0_10px_rgba(255,255,255,0.8)] pointer-events-none"
            style={{ left: `${playheadPosition * 100}%` }}
        />

        { !buffer && (
            <div className={`absolute inset-0 flex items-center justify-center text-xs font-mono border border-dashed rounded m-2 pointer-events-none ${theme === 'light' ? 'text-gray-600 border-gray-800' : 'text-gray-400 border-gray-600'}`}>
                {t('NO SIGNAL')}
            </div>
        )}

        {/* --- CROP VISUALIZATION --- */}
        {showCropUI && (
            <>
                {/* Dimming Overlay Left */}
                <div 
                    className="crop-dim-left absolute top-0 bottom-0 left-0 bg-black/60 pointer-events-none -[1px] transition-all duration-75" 
                    style={{ width: `${leftPct}%`, zIndex: 15 }} 
                />
                
                {/* Dimming Overlay Right */}
                <div 
                    className="crop-dim-right absolute top-0 bottom-0 right-0 bg-black/60 pointer-events-none -[1px] transition-all duration-75" 
                    style={{ width: `${100 - rightPct}%`, zIndex: 15 }} 
                />

                {/* Crop Handle Left */}
                <div 
                    className="crop-handle-left absolute top-0 bottom-0 w-[10px] cursor-ew-resize hover:brightness-125 transition-filter z-20 group/handle"
                    style={{ left: `${leftPct}%`, transform: 'translateX(-50%)' }}
                    onMouseDown={(e) => handleCropStart(e, 'LEFT')}
                    onTouchStart={(e) => handleCropStart(e, 'LEFT')}
                >
                    <div className="w-[2px] h-full mx-auto bg-cyan-400 shadow-[0_0_10px_cyan]"></div>
                    <div className="absolute top-0 left-1/2 -translate-x-1/2 w-3 h-3 bg-cyan-400 rounded-b-sm"></div>
                    <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-3 h-3 bg-cyan-400 rounded-t-sm"></div>
                </div>

                {/* Crop Handle Right */}
                <div 
                    className="crop-handle-right absolute top-0 bottom-0 w-[10px] cursor-ew-resize hover:brightness-125 transition-filter z-20 group/handle"
                    style={{ left: `${rightPct}%`, transform: 'translateX(-50%)' }}
                    onMouseDown={(e) => handleCropStart(e, 'RIGHT')}
                    onTouchStart={(e) => handleCropStart(e, 'RIGHT')}
                >
                    <div className="w-[2px] h-full mx-auto bg-cyan-400 shadow-[0_0_10px_cyan]"></div>
                    <div className="absolute top-0 left-1/2 -translate-x-1/2 w-3 h-3 bg-cyan-400 rounded-b-sm"></div>
                    <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-3 h-3 bg-cyan-400 rounded-t-sm"></div>
                </div>
                
                {/* Active Region Highlight Border */}
                <div 
                    id="loop-overlay"
                    className="absolute top-0 bottom-0 border-t-2 border-b-2 border-cyan-500/30 pointer-events-none z-10"
                    style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                />
            </>
        )}
      </div>
    </div>
  );
});
