
import React, { useRef, useEffect } from 'react';
import { LipSyncKeyframe, VisemeShape } from '../types';

interface LipSyncTimelineProps {
    keyframes: LipSyncKeyframe[];
    duration: number;
    zoomLevel: number;
    height?: number;
    onKeyframeClick: (id: string, e: React.MouseEvent) => void;
}

export const LipSyncTimeline = React.memo<LipSyncTimelineProps>(({ 
    keyframes, duration, zoomLevel, height = 24, onKeyframeClick 
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // Hit detection mapping
    const hitMapRef = useRef<Map<string, {x: number, width: number}>>(new Map());

    const draw = () => {
        if (!canvasRef.current || !containerRef.current) return;
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        const width = containerRef.current.clientWidth;
        const dpr = window.devicePixelRatio || 1;

        if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
            canvas.width = width * dpr;
            canvas.height = height * dpr;
            ctx?.scale(dpr, dpr);
        }

        if (!ctx) return;
        ctx.clearRect(0, 0, width, height);
        hitMapRef.current.clear();

        const pixelsPerSecond = width / (duration || 1);
        
        // LOD Logic
        const LOD = pixelsPerSecond < 50 ? 0 : (pixelsPerSecond < 150 ? 1 : 2);

        keyframes.forEach(kf => {
            const x = kf.time * pixelsPerSecond;
            const isManual = kf.isManual;
            
            // Store hit area
            const hitW = LOD === 2 ? 20 : 8;
            hitMapRef.current.set(kf.id, { x, width: hitW });

            if (LOD === 0) {
                // Dots
                ctx.beginPath();
                ctx.fillStyle = isManual ? '#fbbf24' : '#06b6d4'; // Amber vs Cyan
                ctx.arc(x, height / 2, 1.5, 0, Math.PI * 2);
                ctx.fill();
            } else if (LOD === 1) {
                // Small Diamonds
                ctx.beginPath();
                ctx.moveTo(x, height/2 - 4);
                ctx.lineTo(x + 4, height/2);
                ctx.lineTo(x, height/2 + 4);
                ctx.lineTo(x - 4, height/2);
                ctx.closePath();
                ctx.fillStyle = isManual ? '#fbbf24' : '#06b6d4';
                ctx.fill();
                // Shine
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(x - 1, height/2 - 1, 2, 2);
            } else {
                // Detailed Diamonds with Text
                const size = 10;
                ctx.beginPath();
                ctx.moveTo(x, height/2 - size);
                ctx.lineTo(x + size, height/2);
                ctx.lineTo(x, height/2 + size);
                ctx.lineTo(x - size, height/2);
                ctx.closePath();
                
                // Gradient Fill
                const grad = ctx.createLinearGradient(x, height/2 - size, x, height/2 + size);
                if (isManual) {
                    grad.addColorStop(0, '#fef3c7');
                    grad.addColorStop(1, '#f59e0b');
                } else {
                    grad.addColorStop(0, '#cffafe');
                    grad.addColorStop(1, '#06b6d4');
                }
                ctx.fillStyle = grad;
                ctx.fill();
                
                // Outline
                ctx.strokeStyle = '#000000';
                ctx.lineWidth = 1;
                ctx.stroke();

                // Text
                ctx.fillStyle = '#000000';
                ctx.font = 'bold 8px sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                const label = kf.shape === VisemeShape.REST ? '-' : kf.shape.substring(0, 2);
                ctx.fillText(label, x, height/2);
            }
        });
    };

    useEffect(() => {
        requestAnimationFrame(draw);
    }, [keyframes, duration, zoomLevel]);

    const handlePointerDown = (e: React.PointerEvent) => {
        const rect = containerRef.current!.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        
        // Check hits
        for (const [id, area] of hitMapRef.current.entries()) {
            if (Math.abs(clickX - area.x) < area.width) {
                e.stopPropagation();
                onKeyframeClick(id, e);
                return;
            }
        }
    };

    return (
        <div ref={containerRef} className="absolute inset-0 w-full h-full pointer-events-auto" onPointerDown={handlePointerDown}>
            <canvas ref={canvasRef} className="w-full h-full block" />
        </div>
    );
});
