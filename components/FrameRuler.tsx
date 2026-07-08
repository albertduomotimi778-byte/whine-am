
import React, { useRef, useState, useEffect, useCallback } from 'react';
import { useLanguage } from '../utils/LanguageContext';

interface FrameRulerProps {
  duration: number;
  zoomLevel: number;
  height?: number;
  theme?: 'light' | 'dark';
  selection: { start: number, end: number } | null;
  onSelectionChange: (start: number, end: number) => void;
  onSeek: (time: number) => void;
  isLooping?: boolean;
}

export const FrameRuler = React.memo<FrameRulerProps>(({ 
    duration, 
    zoomLevel, 
    height = 24, 
    theme = 'light', 
    selection,
    onSelectionChange,
    onSeek,
    isLooping = false
}) => {
  const { t } = useLanguage();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Interaction State
  const [dragMode, setDragMode] = useState<'START' | 'END' | 'MOVE' | null>(null);
  const dragStartRef = useRef<{ x: number, initialStart: number, initialEnd: number } | null>(null);
  const [hoverState, setHoverState] = useState<'START' | 'END' | 'MOVE' | null>(null);

  // Constants for Hit Testing & Visuals
  // significantly increased for mobile touch accuracy
  const HANDLE_HIT_WIDTH = 40; 
  const VISUAL_HANDLE_SIZE = 14; 

  const getMetrics = useCallback(() => {
      if (!containerRef.current) return { width: 0, pixelsPerSecond: 0 };
      const width = containerRef.current.clientWidth;
      const pixelsPerSecond = width / (duration || 1);
      return { width, pixelsPerSecond };
  }, [duration, zoomLevel]); 

  const draw = useCallback(() => {
    if (!canvasRef.current || !containerRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const { width, pixelsPerSecond } = getMetrics();

    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx?.scale(dpr, dpr);
    }

    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);
    
    // --- 1. Draw Loop/Selection Background (Behind Ticks) ---
    // STRICT VISIBILITY: Only show if selection exists AND looping is active
    if (selection && isLooping) {
        const startX = selection.start * pixelsPerSecond;
        const endX = selection.end * pixelsPerSecond;
        const loopWidth = endX - startX;
        
        // Colors
        const baseColor = '34, 197, 94'; // Green-500 (Loop is active)
        const fillColor = `rgba(${baseColor}, 0.1)`;
        const activeFill = `rgba(${baseColor}, 0.2)`;

        ctx.fillStyle = (hoverState === 'MOVE' || dragMode === 'MOVE') ? activeFill : fillColor;
        ctx.fillRect(startX, 0, loopWidth, height);
    }

    // --- 2. Draw Ticks (Middle Layer) ---
    ctx.strokeStyle = theme === 'light' ? '#9ca3af' : '#4b5563';
    ctx.fillStyle = theme === 'light' ? '#6b7280' : '#9ca3af';
    ctx.lineWidth = 1;
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';

    let step = 1;
    if (pixelsPerSecond < 15) step = 10;
    else if (pixelsPerSecond < 40) step = 5;
    else if (pixelsPerSecond < 100) step = 1;
    else if (pixelsPerSecond < 200) step = 0.5;
    else if (pixelsPerSecond < 500) step = 0.1;
    else step = 0.05;

    ctx.beginPath();
    for (let t = 0; t <= duration + step/2; t += step) {
        const time = Math.round(t * 100) / 100;
        const x = time * pixelsPerSecond;
        
        const isSecond = time % 1 === 0;
        let tickHeight = height * 0.25;
        let showLabel = false;

        if (step >= 1) {
            if (time % step === 0) { tickHeight = height * 0.5; showLabel = true; }
        } else {
            if (isSecond) { tickHeight = height * 0.7; showLabel = true; } 
            else if (step === 0.5 && time % 0.5 === 0) { tickHeight = height * 0.4; showLabel = pixelsPerSecond > 150; } 
            else { tickHeight = height * 0.25; }
        }

        ctx.moveTo(x + 0.5, height);
        ctx.lineTo(x + 0.5, height - tickHeight);

        if (showLabel && x >= 0) {
            let label = `${time}s`;
            if (time >= 60) {
                const m = Math.floor(time / 60);
                const s = (time % 60).toFixed(step < 1 ? 1 : 0);
                label = `${m}:${s.padStart(step < 1 ? 4 : 2, '0')}`;
            }
            ctx.fillText(label, x + 4, 10);
        }
    }
    ctx.stroke();

    // --- 3. Draw Loop Brace & Handles (Top Layer) ---
    // STRICT VISIBILITY: Only show if selection exists AND looping is active
    if (selection && isLooping) {
        const startX = selection.start * pixelsPerSecond;
        const endX = selection.end * pixelsPerSecond;
        
        const strokeColor = '#22c55e'; // Green
        
        // Loop Brace (The "Bar" at the top)
        ctx.beginPath();
        ctx.lineWidth = 3; 
        ctx.strokeStyle = strokeColor;
        ctx.moveTo(startX, 1.5);
        ctx.lineTo(endX, 1.5);
        ctx.stroke();

        // Vertical Boundary Lines
        ctx.beginPath();
        ctx.lineWidth = 1;
        ctx.moveTo(startX, 0); ctx.lineTo(startX, height);
        ctx.moveTo(endX, 0); ctx.lineTo(endX, height);
        ctx.stroke();

        // Draw Triangle Handles
        const drawHandle = (x: number, isLeft: boolean, isHovered: boolean) => {
             ctx.fillStyle = isHovered ? '#ffffff' : strokeColor;
             ctx.beginPath();
             if (isLeft) {
                 ctx.moveTo(x, 0);
                 ctx.lineTo(x + VISUAL_HANDLE_SIZE, 0);
                 ctx.lineTo(x, VISUAL_HANDLE_SIZE);
             } else {
                 ctx.moveTo(x, 0);
                 ctx.lineTo(x - VISUAL_HANDLE_SIZE, 0);
                 ctx.lineTo(x, VISUAL_HANDLE_SIZE);
             }
             ctx.closePath();
             ctx.fill();
        };

        const isStartHover = hoverState === 'START' || dragMode === 'START';
        const isEndHover = hoverState === 'END' || dragMode === 'END';

        drawHandle(startX, true, isStartHover);
        drawHandle(endX, false, isEndHover);
    }

  }, [duration, height, theme, selection, hoverState, dragMode, getMetrics, isLooping]);

  useEffect(() => {
    const rAf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rAf);
  }, [draw]);

  // --- INTERACTION LOGIC ---
  const getTimeFromEvent = (e: React.PointerEvent) => {
      const { width, pixelsPerSecond } = getMetrics();
      if (!containerRef.current || width === 0) return 0;
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      return Math.max(0, Math.min(duration, x / pixelsPerSecond));
  };

  const handlePointerDown = (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);

      const time = getTimeFromEvent(e);
      const { pixelsPerSecond } = getMetrics();
      
      // Calculate tolerance in seconds based on pixel hit width
      const timeTolerance = HANDLE_HIT_WIDTH / pixelsPerSecond;

      // STRICT INTERACTION: Only interact with handles if looping is active
      if (selection && isLooping) {
          const distStart = Math.abs(time - selection.start);
          const distEnd = Math.abs(time - selection.end);

          // Priority: Start/End Handles > Body > Seek
          if (distStart < timeTolerance) {
              setDragMode('START');
              dragStartRef.current = { x: e.clientX, initialStart: selection.start, initialEnd: selection.end };
              return;
          } else if (distEnd < timeTolerance) {
              setDragMode('END');
              dragStartRef.current = { x: e.clientX, initialStart: selection.start, initialEnd: selection.end };
              return;
          } else if (time > selection.start && time < selection.end) {
              setDragMode('MOVE');
              dragStartRef.current = { x: e.clientX, initialStart: selection.start, initialEnd: selection.end };
              return;
          }
      }
      
      // If clicking in empty space (or loop inactive), treat as seek
      onSeek(time);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
      const time = getTimeFromEvent(e);
      const { pixelsPerSecond } = getMetrics();
      const timeTolerance = HANDLE_HIT_WIDTH / pixelsPerSecond;

      // 1. Hover State (Cursor Feedback)
      if (!dragMode) {
          let newHover: 'START' | 'END' | 'MOVE' | null = null;
          // Only show hover state if looping is active
          if (selection && isLooping) {
              if (Math.abs(time - selection.start) < timeTolerance) newHover = 'START';
              else if (Math.abs(time - selection.end) < timeTolerance) newHover = 'END';
              else if (time > selection.start && time < selection.end) newHover = 'MOVE';
          }
          if (newHover !== hoverState) setHoverState(newHover);
      }

      // 2. Dragging Logic
      if (dragMode && dragStartRef.current && selection && isLooping) {
          const deltaPixels = e.clientX - dragStartRef.current.x;
          const deltaTime = deltaPixels / pixelsPerSecond;
          
          let newStart = selection.start;
          let newEnd = selection.end;

          if (dragMode === 'START') {
              // Clamp to 0 and ensure start < end
              newStart = Math.min(Math.max(0, dragStartRef.current.initialStart + deltaTime), selection.end - 0.05);
          } else if (dragMode === 'END') {
              // Clamp to duration and ensure end > start
              newEnd = Math.max(Math.min(duration, dragStartRef.current.initialEnd + deltaTime), selection.start + 0.05);
          } else if (dragMode === 'MOVE') {
              const span = dragStartRef.current.initialEnd - dragStartRef.current.initialStart;
              // Clamp entire span within 0 and duration
              newStart = Math.max(0, Math.min(duration - span, dragStartRef.current.initialStart + deltaTime));
              newEnd = newStart + span;
          }

          onSelectionChange(newStart, newEnd);
      }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
      setDragMode(null);
      dragStartRef.current = null;
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  };

  // --- CURSOR STYLE ---
  let cursor = 'cursor-pointer'; 
  if (hoverState === 'START' || hoverState === 'END' || dragMode === 'START' || dragMode === 'END') cursor = 'cursor-ew-resize';
  else if (hoverState === 'MOVE' || dragMode === 'MOVE') cursor = 'cursor-grab active:cursor-grabbing';

  return (
    <div 
        ref={containerRef} 
        className={`w-full relative shrink-0 ${cursor} touch-none select-none`} 
        style={{ height }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
    >
      <canvas ref={canvasRef} className="block w-full h-full" />
    </div>
  );
});
