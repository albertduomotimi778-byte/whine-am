
import React, { useRef, useEffect, useState, useCallback } from 'react';
import { useLanguage } from '../utils/LanguageContext';
import { X, Check, Pipette, Plus, Trash2 } from 'lucide-react';

interface AdvancedColorPickerProps {
    initialColor: string; // Hex
    onChange: (color: string) => void;
    onClose: () => void;
    onActivatePicker?: () => void;
    dragProps?: {
        onPointerDown: (e: React.PointerEvent) => void;
        onPointerMove: (e: React.PointerEvent) => void;
        onPointerUp: (e: React.PointerEvent) => void;
    };
}

// Helpers
const hexToHsv = (hex: string) => {
    let r = parseInt(hex.substring(1, 3), 16) / 255;
    let g = parseInt(hex.substring(3, 5), 16) / 255;
    let b = parseInt(hex.substring(5, 7), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0, v = max;
    const d = max - min;
    s = max === 0 ? 0 : d / max;
    if (max !== min) {
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
    }
    return { h, s, v };
};

const hsvToRgb = (h: number, s: number, v: number) => {
    let r, g, b;
    const i = Math.floor(h * 6);
    const f = h * 6 - i;
    const p = v * (1 - s);
    const q = v * (1 - f * s);
    const t = v * (1 - (1 - f) * s);
    switch (i % 6) {
        case 0: r = v; g = t; b = p; break;
        case 1: r = q; g = v; b = p; break;
        case 2: r = p; g = v; b = t; break;
        case 3: r = p; g = q; b = v; break;
        case 4: r = t; g = p; b = v; break;
        case 5: r = v; g = p; b = q; break;
        default: r=0; g=0; b=0;
    }
    return { 
        r: Math.round(r * 255), 
        g: Math.round(g * 255), 
        b: Math.round(b * 255) 
    };
};

const rgbToHex = (r: number, g: number, b: number) => {
    return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
};

export const AdvancedColorPicker: React.FC<AdvancedColorPickerProps> = ({ initialColor, onChange, onClose, onActivatePicker, dragProps }) => {
  const { t } = useLanguage();

    const svCanvasRef = useRef<HTMLCanvasElement>(null);
    const hueCanvasRef = useRef<HTMLCanvasElement>(null);
    
    // HEX & PREVIEW
    const [hsv, setHsv] = useState(() => hexToHsv(initialColor));
    const [isDraggingSV, setIsDraggingSV] = useState(false);
    const [isDraggingHue, setIsDraggingHue] = useState(false);

    // PALETTE
    const [savedColors, setSavedColors] = useState<string[]>(() => {
        const stored = localStorage.getItem('animato-saved-colors');
        return stored ? JSON.parse(stored) : [];
    });

    useEffect(() => {
        setHsv(hexToHsv(initialColor));
    }, [initialColor]);

    // Initial Draw
    useEffect(() => {
        drawHueCanvas();
        drawSVCanvas();
    }, []);

    // Redraw SV when Hue changes
    useEffect(() => {
        drawSVCanvas();
    }, [hsv.h]);

    const drawHueCanvas = () => {
        const canvas = hueCanvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const w = canvas.width;
        const h = canvas.height;
        ctx.clearRect(0, 0, w, h);

        const grad = ctx.createLinearGradient(0, 0, w, 0);
        grad.addColorStop(0, '#ff0000');
        grad.addColorStop(0.16, '#ffff00');
        grad.addColorStop(0.33, '#00ff00');
        grad.addColorStop(0.5, '#00ffff');
        grad.addColorStop(0.66, '#0000ff');
        grad.addColorStop(0.83, '#ff00ff');
        grad.addColorStop(1, '#ff0000');

        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
    };

    const drawSVCanvas = () => {
        const canvas = svCanvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const w = canvas.width;
        const h = canvas.height;
        ctx.clearRect(0, 0, w, h);

        // 1. Solid Color Base (Current Hue)
        const rgb = hsvToRgb(hsv.h, 1, 1);
        ctx.fillStyle = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
        ctx.fillRect(0, 0, w, h);

        // 2. White Gradient (Horizontal)
        const whiteGrad = ctx.createLinearGradient(0, 0, w, 0);
        whiteGrad.addColorStop(0, 'rgba(255,255,255,1)');
        whiteGrad.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = whiteGrad;
        ctx.fillRect(0, 0, w, h);

        // 3. Black Gradient (Vertical)
        const blackGrad = ctx.createLinearGradient(0, 0, 0, h);
        blackGrad.addColorStop(0, 'rgba(0,0,0,0)');
        blackGrad.addColorStop(1, 'rgba(0,0,0,1)');
        ctx.fillStyle = blackGrad;
        ctx.fillRect(0, 0, w, h);
    };

    const handleSVMove = (e: React.PointerEvent) => {
        if (!svCanvasRef.current) return;
        const rect = svCanvasRef.current.getBoundingClientRect();
        const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
        const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
        
        const s = x / rect.width;
        const v = 1 - (y / rect.height);
        
        const newHsv = { ...hsv, s, v };
        setHsv(newHsv);
        emitChange(newHsv);
    };

    const handleHueMove = (e: React.PointerEvent) => {
        if (!hueCanvasRef.current) return;
        const rect = hueCanvasRef.current.getBoundingClientRect();
        const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
        const h = x / rect.width;
        
        const newHsv = { ...hsv, h };
        setHsv(newHsv);
        emitChange(newHsv);
    };

    const emitChange = (val: {h: number, s: number, v: number}) => {
        const rgb = hsvToRgb(val.h, val.s, val.v);
        onChange(rgbToHex(rgb.r, rgb.g, rgb.b));
    };

    const currentColorHex = rgbToHex(hsvToRgb(hsv.h, hsv.s, hsv.v).r, hsvToRgb(hsv.h, hsv.s, hsv.v).g, hsvToRgb(hsv.h, hsv.s, hsv.v).b);

    const saveColor = () => {
        if (!savedColors.includes(currentColorHex)) {
            const newColors = [currentColorHex, ...savedColors].slice(0, 14); // Limit to 14
            setSavedColors(newColors);
            localStorage.setItem('animato-saved-colors', JSON.stringify(newColors));
        }
    };

    const removeColor = (color: string) => {
        const newColors = savedColors.filter(c => c !== color);
        setSavedColors(newColors);
        localStorage.setItem('animato-saved-colors', JSON.stringify(newColors));
    };

    return (
        <div 
            className="bg-[#111] border border-white/10 p-4 rounded-xl shadow-2xl w-64 animate-in fade-in zoom-in-95 cursor-default touch-none"
        >
            <div 
                className={`flex justify-between items-center mb-4 ${dragProps ? 'cursor-move' : ''}`}
                {...dragProps}
            >
                <span className="text-xs font-bold text-gray-400 select-none">{t('COLOR SPECTRUM')}</span>
                <button onClick={onClose} onPointerDown={e => e.stopPropagation()}><X size={14} className="text-gray-500 hover:text-white"/></button>
            </div>

            {/* SATURATION / VALUE BOX */}
            <div 
                className="relative w-full h-48 rounded-lg overflow-hidden cursor-crosshair mb-4 ring-1 ring-white/10"
                onPointerDown={(e) => { setIsDraggingSV(true); handleSVMove(e); (e.target as HTMLElement).setPointerCapture(e.pointerId); }}
                onPointerMove={(e) => { if (isDraggingSV) handleSVMove(e); }}
                onPointerUp={(e) => { setIsDraggingSV(false); (e.target as HTMLElement).releasePointerCapture(e.pointerId); }}
            >
                <canvas ref={svCanvasRef} width={256} height={192} className="w-full h-full" />
                {/* Cursor */}
                <div 
                    className="absolute w-4 h-4 border-2 border-white rounded-full shadow-[0_0_5px_black] pointer-events-none transform -translate-x-1/2 -translate-y-1/2"
                    style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, backgroundColor: currentColorHex }}
                />
            </div>

            {/* HUE SLIDER */}
            <div 
                className="relative w-full h-4 rounded-full overflow-hidden cursor-pointer mb-4 ring-1 ring-white/10"
                onPointerDown={(e) => { setIsDraggingHue(true); handleHueMove(e); (e.target as HTMLElement).setPointerCapture(e.pointerId); }}
                onPointerMove={(e) => { if (isDraggingHue) handleHueMove(e); }}
                onPointerUp={(e) => { setIsDraggingHue(false); (e.target as HTMLElement).releasePointerCapture(e.pointerId); }}
            >
                <canvas ref={hueCanvasRef} width={256} height={16} className="w-full h-full" />
                {/* Thumb */}
                <div 
                    className="absolute top-0 bottom-0 w-2 bg-white border border-black shadow-sm pointer-events-none transform -translate-x-1/2"
                    style={{ left: `${hsv.h * 100}%` }}
                />
            </div>

            {/* HEX & PREVIEW & EYEDROPPER & SAVE */}
            <div className="flex items-center gap-2">
                <div className="w-10 h-10 rounded border border-white/10 shadow-inner flex-shrink-0" style={{backgroundColor: currentColorHex}}></div>
                <div className="flex-1 bg-[#050505] border border-white/10 rounded px-2 py-1 flex items-center justify-between min-w-0">
                    <span className="text-gray-500 text-[10px] font-mono">{t('HEX')}</span>
                    <span className="text-white text-xs font-mono uppercase truncate ml-1">{currentColorHex}</span>
                </div>
                <div className="flex items-center gap-1">
                    {onActivatePicker && (
                        <button 
                            onClick={onActivatePicker}
                            className="p-1.5 bg-[#18181b] hover:bg-[#202020] border border-white/10 rounded text-gray-400 hover:text-cyan-400 transition-colors"
                            title={t('Pick color from stage')}
                        >
                            <Pipette size={16}/>
                        </button>
                    )}
                    <button 
                        onClick={saveColor}
                        className="p-1.5 bg-[#18181b] hover:bg-[#202020] border border-white/10 rounded text-gray-400 hover:text-green-400 transition-colors"
                        title={t('Save current color')}
                    >
                        <Plus size={16}/>
                    </button>
                </div>
            </div>
            
            {/* SAVED COLORS PALETTE */}
            {savedColors.length > 0 && (
                <div className="mt-4 pt-3 border-t border-white/5">
                    <div className="flex justify-between items-center mb-2">
                        <span className="text-[9px] font-bold text-gray-500 uppercase tracking-widest">{t('PALETTE')}</span>
                        <button 
                            onClick={() => { setSavedColors([]); localStorage.removeItem('animato-saved-colors'); }}
                            className="text-[9px] text-gray-700 hover:text-red-500 transition-colors"
                        >
                            {t('CLEAR ALL')}
                        </button>
                    </div>
                    <div className="grid grid-cols-7 gap-1.5">
                        {savedColors.map((color, idx) => (
                            <div key={`${color}-${idx}`} className="group relative">
                                <button 
                                    onClick={() => onChange(color)}
                                    className="w-6 h-6 rounded border border-white/10 shadow-sm transition-transform hover:scale-110 active:scale-95"
                                    style={{ backgroundColor: color }}
                                    title={color}
                                />
                                <button 
                                    onClick={(e) => { e.stopPropagation(); removeColor(color); }}
                                    className="absolute -top-1 -right-1 w-3 h-3 bg-red-600 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-sm z-10"
                                >
                                    <X size={8} className="text-white"/>
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div className="mt-2 text-[9px] text-gray-600 text-center">
                {t('10,000+ Variations')}
            </div>
        </div>
    );
};
