
import React, { useRef, useState, useEffect, useCallback, memo, useLayoutEffect, useMemo } from 'react';
import { toast } from 'sonner';
import { showAppToast } from '../utils/toastHelper';
import { createPortal } from 'react-dom';
import { useLanguage } from '../utils/LanguageContext';
import { motion, AnimatePresence, Reorder, useDragControls } from 'motion/react';
import { FrameData, BrushPreset, FrameLayer, Bone } from '../types';
import { triggerDownload } from '../utils/downloadHelper';
import { FrameSettings } from '../utils/storage';
import { safeDeepClone } from '../utils/cloneUtils';
import { PenTool, Eraser, Play, Pause, Plus, Trash2, Copy, ClipboardPaste, Layers, Image as ImageIcon, ChevronLeft, ChevronRight, Save, Palette, ChevronDown, ChevronUp, Brush, Sliders, X, Ratio, Monitor, Smartphone, LayoutGrid, Instagram, Youtube, PaintBucket, Eye, EyeOff, Edit2, GripHorizontal, Bone as BoneIcon, Check, Move, Hand, Wind, Pipette, Undo, RotateCcw, RotateCw, Scissors, Sparkles, Download, Video, Music, AudioWaveform, Ruler, MoreVertical, Loader2, FlipHorizontal, FlipVertical, GripVertical, FolderTree, FolderOpen, Search, Type, Film, Gamepad2 } from 'lucide-react';
import { AdvancedColorPicker } from './AdvancedColorPicker';
import { BrushLibrary } from './BrushLibrary';
import { PuppetWarp, PUPPET_PADDING, drawWarpedImage } from './PuppetWarp';
import { WaveformDisplay } from './WaveformDisplay';
import { Logo } from './Logo';
import { AudioImportManager } from './AudioImportManager';
import { audioBufferToWavBase64 } from '../utils/audioUtils';
import { removeBackground as imglyRemoveBackground } from '@imgly/background-removal';
import { fastInpaint } from '../utils/inpaint';
import { readPsd } from 'ag-psd';
import { VirtuosoGrid } from 'react-virtuoso';
import { get as idbGet, set as idbSet } from 'idb-keyval';


// --- GLOBAL EDITOR IMAGE CACHE ---
const EDITOR_IMAGE_CACHE = new Map<string, HTMLImageElement>();


const trimImage = async (dataUri: string): Promise<{ trimmedDataUri: string, width: number, height: number, x: number, y: number }> => {
    return new Promise((resolve) => {
        const img = new Image();
        img.src = dataUri;
        img.onload = () => {
            // Downscale giant images to a safe size for mobile devices & canvas memory boundaries
            let width = img.width;
            let height = img.height;
            const MAX_ALLOWED_DIM = 8192; // safe max dimension for canvas manipulation
            
            let scalingCanvas = document.createElement('canvas');
            if (width > MAX_ALLOWED_DIM || height > MAX_ALLOWED_DIM) {
                const ratio = Math.min(MAX_ALLOWED_DIM / width, MAX_ALLOWED_DIM / height);
                width = Math.round(width * ratio);
                height = Math.round(height * ratio);
            }
            
            scalingCanvas.width = width;
            scalingCanvas.height = height;
            const ctx = scalingCanvas.getContext('2d');
            if (!ctx) {
                resolve({ trimmedDataUri: dataUri, width: img.width, height: img.height, x: 0, y: 0 });
                return;
            }
            
            // Draw possibly scaled image
            ctx.drawImage(img, 0, 0, width, height);
            
            // Now, get image data to check if trimming is needed
            let imageData: ImageData;
            try {
                imageData = ctx.getImageData(0, 0, width, height);
            } catch (err) {
                // security or out of memory exception
                resolve({ trimmedDataUri: dataUri, width: img.width, height: img.height, x: 0, y: 0 });
                return;
            }
            
            // Fast bounding-box detection (doing step-based check if huge, or quick scan)
            let tMinX = width, tMinY = height, tMaxX = 0, tMaxY = 0;
            let found = false;
            
            // Optimization: check if image is fully opaque (common for camera JPEGs/photos)
            const data = imageData.data;
            const len = data.length;
            
            // First pass: check if there's any transparency at all
            let hasAlpha = false;
            for (let i = 3; i < len; i += 4) {
                if (data[i] < 255) {
                    hasAlpha = true;
                    break;
                }
            }
            
            // If the image has absolutely no transparency (e.g. standard JPEG photograph), 
            // no trimming is needed at all! Resolve instantly to save tons of CPU cycles!
            if (!hasAlpha) {
                resolve({ trimmedDataUri: scalingCanvas.toDataURL('image/jpeg', 0.85), width, height, x: 0, y: 0 });
                return;
            }
            
            // If it has alpha, find the true boundaries
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const alpha = data[(y * width + x) * 4 + 3];
                    if (alpha > 0) {
                        found = true;
                        if (x < tMinX) tMinX = x;
                        if (x > tMaxX) tMaxX = x;
                        if (y < tMinY) tMinY = y;
                        if (y > tMaxY) tMaxY = y;
                    }
                }
            }
            
            if (!found) {
                resolve({ trimmedDataUri: scalingCanvas.toDataURL(), width, height, x: 0, y: 0 });
                return;
            }
            
            const newW = tMaxX - tMinX + 1;
            const newH = tMaxY - tMinY + 1;
            const trimmedCanvas = document.createElement('canvas');
            trimmedCanvas.width = newW;
            trimmedCanvas.height = newH;
            const tCtx = trimmedCanvas.getContext('2d');
            if (tCtx) {
                tCtx.drawImage(scalingCanvas, tMinX, tMinY, newW, newH, 0, 0, newW, newH);
            }
            resolve({ trimmedDataUri: trimmedCanvas.toDataURL('image/png'), width: newW, height: newH, x: tMinX, y: tMinY });
        };
        img.onerror = () => {
            resolve({ trimmedDataUri: dataUri, width: img.width, height: img.height, x: 0, y: 0 });
        };
    });
};

const extractLineArt = (
    img: HTMLImageElement, 
    threshold: number, 
    smoothness: number, 
    infillJointGaps: boolean, 
    inkColorMode: 'preserve' | 'black' | 'current' | 'monochrome',
    currentColor: string = '#000000'
): string => {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return img.src;
    
    ctx.drawImage(img, 0, 0);
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imgData.data;
    const len = data.length;
    const w = canvas.width;
    const h = canvas.height;
    
    // Step 1: Compute luminance and extract alpha mask
    const alphaMask = new Uint8ClampedArray(w * h);
    
    // Standard white point and black point from parameters
    const whitePoint = threshold;
    const blackPoint = Math.max(0, threshold - smoothness * 2);
    
    for (let i = 0; i < len; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const a = data[i + 3];
        
        // Luminance L = 0.299R + 0.587G + 0.114B
        const L = 0.299 * r + 0.587 * g + 0.114 * b;
        
        let alpha = 255;
        if (a === 0) {
            alpha = 0;
        } else if (L >= whitePoint) {
            alpha = 0;
        } else if (L <= blackPoint) {
            alpha = 255;
        } else {
            // Smooth step interpolation
            const t = (L - blackPoint) / (whitePoint - blackPoint);
            alpha = Math.round(255 * (1.0 - t));
        }
        
        alphaMask[i / 4] = alpha;
    }
    
    // Step 2: Infill Joint Gaps (Morphological Closing: Dilation then Erosion)
    let processedMask = alphaMask;
    if (infillJointGaps) {
        const dilated = new Uint8ClampedArray(w * h);
        const eroded = new Uint8ClampedArray(w * h);
        
        // Use a circular or cross-shaped neighborhood (radius 2 is optimal for general sketch resolutions)
        const radius = 2;
        for (let y = 0; y < h; y++) {
            const yOffset = y * w;
            const minY = Math.max(0, y - radius);
            const maxY = Math.min(h - 1, y + radius);
            for (let x = 0; x < w; x++) {
                let maxVal = 0;
                const minX = Math.max(0, x - radius);
                const maxX = Math.min(w - 1, x + radius);
                
                for (let ny = minY; ny <= maxY; ny++) {
                    const nYOffset = ny * w;
                    for (let nx = minX; nx <= maxX; nx++) {
                        const val = alphaMask[nYOffset + nx];
                        if (val > maxVal) maxVal = val;
                    }
                }
                dilated[yOffset + x] = maxVal;
            }
        }
        
        // Erosion: Min in neighborhood
        for (let y = 0; y < h; y++) {
            const yOffset = y * w;
            const minY = Math.max(0, y - radius);
            const maxY = Math.min(h - 1, y + radius);
            for (let x = 0; x < w; x++) {
                let minVal = 255;
                const minX = Math.max(0, x - radius);
                const maxX = Math.min(w - 1, x + radius);
                
                for (let ny = minY; ny <= maxY; ny++) {
                    const nYOffset = ny * w;
                    for (let nx = minX; nx <= maxX; nx++) {
                        const val = dilated[nYOffset + nx];
                        if (val < minVal) minVal = val;
                    }
                }
                eroded[yOffset + x] = minVal;
            }
        }
        processedMask = eroded;
    }
    
    // Parse current tool color if required
    let targetR = 0, targetG = 0, targetB = 0;
    if (inkColorMode === 'current') {
        const hex = currentColor.replace('#', '');
        if (hex.length === 6) {
            targetR = parseInt(hex.substring(0, 2), 16);
            targetG = parseInt(hex.substring(2, 4), 16);
            targetB = parseInt(hex.substring(4, 6), 16);
        } else if (hex.length === 3) {
            targetR = parseInt(hex[0] + hex[0], 16);
            targetG = parseInt(hex[1] + hex[1], 16);
            targetB = parseInt(hex[2] + hex[2], 16);
        }
    }
    
    for (let i = 0; i < len; i += 4) {
        const idx = i / 4;
        const finalAlpha = processedMask[idx];
        
        if (finalAlpha === 0) {
            data[i + 3] = 0;
        } else {
            data[i + 3] = finalAlpha;
            
            if (inkColorMode === 'black') {
                data[i] = 0;
                data[i + 1] = 0;
                data[i + 2] = 0;
            } else if (inkColorMode === 'current') {
                data[i] = targetR;
                data[i + 1] = targetG;
                data[i + 2] = targetB;
            } else if (inkColorMode === 'monochrome') {
                const L = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
                const ink = L < 128 ? 0 : L;
                data[i] = ink;
                data[i + 1] = ink;
                data[i + 2] = ink;
            }
        }
    }
    
    ctx.putImageData(imgData, 0, 0);
    return canvas.toDataURL('image/png');
};

// --- OPTIMIZED LAYER RENDERER (MEMOIZED) ---
const LayerRenderer = memo(({ 
    layer, 
    isActiveFrame, 
    activeLayerId, 
    isPlaying, 
    canvasSize,
    getDynamicTransforms,
    isTransforming,
    isLassoExtraction,
    isRiggingMode,
    isLowPerformanceMode
}: {
    layer: FrameLayer,
    isActiveFrame: boolean,
    activeLayerId: string | null,
    isPlaying: boolean,
    canvasSize: { width: number, height: number },
    getDynamicTransforms?: () => any,
    isTransforming?: boolean,
    isLassoExtraction?: boolean,
    isRiggingMode?: boolean,
    isLowPerformanceMode?: boolean
}) => {
    const hasBones = layer.bones && layer.bones.length > 0;
    const isEditingThisLayer = !isPlaying && layer.id === activeLayerId;
    
    // If not playing and this is the active layer, it's rendered by the canvas/rigging tools.
    // So we don't want to double-render it, even if it has bones!
    if (!isPlaying && isEditingThisLayer) {
        if (hasBones) {
            return (
                <div className="absolute inset-0 w-full h-full pointer-events-none">
                    <PuppetWarp 
                        layerId={layer.id}
                        opacity={layer.opacity}
                        imageUri={layer.dataUri} 
                        width={canvasSize.width} 
                        height={canvasSize.height}
                        bones={layer.bones}
                        boneTransforms={layer.boneTransforms}
                        getDynamicTransforms={getDynamicTransforms}
                        mode="PLAY"
                        showSkeleton={false}
                        isActive={isActiveFrame}
                        rigType={layer.rigType || 'MESH'}
                        isLowPerformanceMode={isLowPerformanceMode}
                    />
                </div>
            );
        }
        return null;
    }

    if (isRiggingMode) {
        return (
            <div className="absolute inset-0 w-full h-full pointer-events-none opacity-30 blur-[12px] saturate-50 grayscale-[50%] transition-all duration-500 scale-[1.05]">
                {hasBones ? (
                    <PuppetWarp 
                        layerId={layer.id}
                        opacity={layer.opacity}
                        imageUri={layer.dataUri} 
                        width={canvasSize.width} 
                        height={canvasSize.height}
                        bones={layer.bones}
                        boneTransforms={layer.boneTransforms}
                        getDynamicTransforms={getDynamicTransforms}
                        mode="PLAY"
                        showSkeleton={false}
                        isActive={isActiveFrame}
                        rigType={layer.rigType || 'MESH'}
                        isLowPerformanceMode={true}
                    />
                ) : (
                    layer.dataUri ? <img src={layer.dataUri} style={{ opacity: layer.opacity !== undefined ? layer.opacity : 1 }} className="w-full h-full object-contain" referrerPolicy="no-referrer" /> : null
                )}
            </div>
        );
    }

    return (
        <div className="absolute inset-0 w-full h-full pointer-events-none">
            {hasBones ? (
                <PuppetWarp 
                    layerId={layer.id}
                    opacity={layer.opacity}
                    imageUri={layer.dataUri} 
                    width={canvasSize.width} 
                    height={canvasSize.height}
                    bones={layer.bones}
                    boneTransforms={layer.boneTransforms}
                    getDynamicTransforms={getDynamicTransforms}
                    mode="PLAY"
                    showSkeleton={false}
                    isActive={isActiveFrame}
                    rigType={layer.rigType || 'MESH'}
                    isLowPerformanceMode={isLowPerformanceMode}
                />
            ) : (
                layer.dataUri ? <img src={layer.dataUri} style={{ opacity: layer.opacity !== undefined ? layer.opacity : 1 }} className="w-full h-full object-contain" referrerPolicy="no-referrer" /> : null
            )}
        </div>
    );
}, (prev, next) => {
    // Optimized equality check: skip expensive JSON.stringify
    if (prev.layer.dataUri !== next.layer.dataUri ||
        prev.layer.visible !== next.layer.visible ||
        prev.layer.opacity !== next.layer.opacity ||
        prev.layer.bones !== next.layer.bones ||
        prev.layer.boneTransforms !== next.layer.boneTransforms ||
        prev.layer.rigType !== next.layer.rigType ||
        prev.isActiveFrame !== next.isActiveFrame ||
        prev.isPlaying !== next.isPlaying ||
        prev.activeLayerId !== next.activeLayerId ||
        prev.isTransforming !== next.isTransforming ||
        prev.isLassoExtraction !== next.isLassoExtraction ||
        prev.isRiggingMode !== next.isRiggingMode ||
        prev.isLowPerformanceMode !== next.isLowPerformanceMode ||
        prev.canvasSize.width !== next.canvasSize.width ||
        prev.canvasSize.height !== next.canvasSize.height) {
        return false;
    }
    
    return true;
});

// --- OPTIMIZED TIMELINE THUMBNAIL (MEMOIZED) ---
const TimelineThumbnail = memo(({ 
    frame, 
    index, 
    isSelected, 
    onClick,
    onMoveLeft,
    onMoveRight,
    totalFrames,
    t
}: { 
    frame: FrameData, 
    index: number, 
    isSelected: boolean, 
    onClick: () => void,
    onMoveLeft?: (index: number, e: React.MouseEvent) => void,
    onMoveRight?: (index: number, e: React.MouseEvent) => void,
    totalFrames?: number,
    t?: any
}) => {
    return (
        <div 
            onClick={onClick}
            className={`
                shrink-0 group relative aspect-video rounded-lg border-2 overflow-hidden cursor-pointer transition-all h-full
                ${isSelected ? 'border-cyan-500 shadow-[0_0_15px_rgba(6,182,212,0.4)] z-10' : 'border-white/5 hover:border-white/20 bg-black'}
            `}
        >
            <div className="absolute top-1 left-1 z-10 bg-cyan-500 text-black text-[9px] font-black px-1.5 rounded">{index + 1}</div>
            {frame.dataUri ? (
                <img src={frame.dataUri} loading="lazy" className="w-full h-full object-contain bg-white/5" draggable={false} referrerPolicy="no-referrer" />
            ) : (
                <div className="w-full h-full flex items-center justify-center opacity-20"><ImageIcon size={16}/></div>
            )}

            {/* Rearrange Action Buttons Overlaid on each Frame - Permanently Visible & Professional */}
            {onMoveLeft && onMoveRight && totalFrames !== undefined && t && (
                <div className="absolute inset-x-1 bottom-1 flex justify-between items-center bg-black/85 backdrop-blur-[1px] rounded border border-white/10 p-0.5 z-20 pointer-events-none">
                    <button 
                        onClick={(e) => onMoveLeft(index, e)}
                        disabled={index === 0}
                        className={`w-5 h-5 rounded bg-zinc-900 hover:bg-cyan-500 hover:text-black flex items-center justify-center text-white transition-all active:scale-90 disabled:opacity-20 disabled:pointer-events-none border border-white/5 pointer-events-auto`}
                        title={t('Move Left')}
                    >
                        <ChevronLeft size={10} strokeWidth={2.5} />
                    </button>
                    <span className="text-[8px] font-black font-mono text-cyan-400 select-none">
                        {index + 1}
                    </span>
                    <button 
                        onClick={(e) => onMoveRight(index, e)}
                        disabled={index === totalFrames - 1}
                        className={`w-5 h-5 rounded bg-zinc-900 hover:bg-cyan-500 hover:text-black flex items-center justify-center text-white transition-all active:scale-90 disabled:opacity-20 disabled:pointer-events-none border border-white/5 pointer-events-auto`}
                        title={t('Move Right')}
                    >
                        <ChevronRight size={10} strokeWidth={2.5} />
                    </button>
                </div>
            )}
        </div>
    );
}, (prev, next) => {
    return prev.frame.dataUri === next.frame.dataUri && 
           prev.isSelected === next.isSelected && 
           prev.index === next.index &&
           prev.totalFrames === next.totalFrames;
});

const DraggableFrameItem = memo(({ frame, index, isSelected, onClick, onMoveLeft, onMoveRight, totalFrames, t }: any) => {
    const controls = useDragControls();
    
    // logic for long press to drag
    const timerRef = useRef<NodeJS.Timeout | null>(null);

    const handlePointerDown = (e: React.PointerEvent) => {
        // Stop bubbling so that the strip doesn't immediately try to scroll if we are long pressing
        const nativeEvent = e.nativeEvent;
        timerRef.current = setTimeout(() => {
            try {
                controls.start(nativeEvent);
                if (navigator.vibrate) navigator.vibrate(50);
            } catch (err) {}
        }, 500); // 500ms long press to drag
    };

    const handlePointerUp = () => {
         if (timerRef.current) clearTimeout(timerRef.current);
    };

    return (
        <Reorder.Item 
            value={frame}
            dragListener={false}
            dragControls={controls}
            className="shrink-0 h-full flex items-center group relative origin-center"
            style={{ touchAction: 'pan-x' }}
            onPointerDown={handlePointerDown}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onPointerLeave={handlePointerUp}
        >
            <TimelineThumbnail 
                frame={frame}
                index={index}
                isSelected={isSelected}
                onClick={onClick}
                onMoveLeft={onMoveLeft}
                onMoveRight={onMoveRight}
                totalFrames={totalFrames}
                t={t}
            />
        </Reorder.Item>
    );
});

const DraggableLayerItem = memo(({
    layer,
    activeLayerId,
    editingLayerId,
    setEditingLayerId,
    setActiveLayerId,
    renameLayer,
    updateFrameLayerOpacity,
    toggleLayerVisibility,
    duplicateLayer,
    deleteLayer,
    pushToUndoHistory,
    framesRef,
    t,
    onMoveUp,
    onMoveDown,
    isFirst,
    isLast,
    isSelectionMode = false,
    isSelected = false,
    onToggleSelect = () => {},
    onStartSelectionMode = () => {}
}: {
    layer: FrameLayer;
    activeLayerId: string | null;
    editingLayerId: string | null;
    setEditingLayerId: (id: string | null) => void;
    setActiveLayerId: (id: string | null) => void;
    renameLayer: (id: string, name: string) => void;
    updateFrameLayerOpacity: (id: string, opacity: number, flag: boolean) => void;
    toggleLayerVisibility: (id: string) => void;
    duplicateLayer: (id: string) => void;
    deleteLayer: (id: string) => void;
    pushToUndoHistory: (history: any) => void;
    framesRef: any;
    t: (s: string) => string;
    onMoveUp: () => void;
    onMoveDown: () => void;
    isFirst: boolean;
    isLast: boolean;
    isSelectionMode?: boolean;
    isSelected?: boolean;
    onToggleSelect?: (id: string) => void;
    onStartSelectionMode?: (id: string) => void;
}) => {
    const controls = useDragControls();
    const longPressTimer = useRef<NodeJS.Timeout | null>(null);
    const hasLongPressed = useRef(false);

    const handlePointerDown = (e: React.PointerEvent) => {
        if (isSelectionMode) return;
        if (e.button !== 0) return; // primary click/touch only
        hasLongPressed.current = false;
        longPressTimer.current = setTimeout(() => {
            hasLongPressed.current = true;
            onStartSelectionMode(layer.id);
        }, 600); // 600ms long press threshold
    };

    const handlePointerUp = (e: React.PointerEvent) => {
        if (longPressTimer.current) {
            clearTimeout(longPressTimer.current);
            longPressTimer.current = null;
        }
        if (hasLongPressed.current) {
            e.preventDefault();
            e.stopPropagation();
            return;
        }
        
        // Handle standard click/tap action
        if (isSelectionMode) {
            onToggleSelect(layer.id);
        } else {
            setActiveLayerId(layer.id);
        }
    };

    const handlePointerCancel = () => {
        if (longPressTimer.current) {
            clearTimeout(longPressTimer.current);
            longPressTimer.current = null;
        }
    };

    return (
        <Reorder.Item 
            value={layer}
            dragListener={false}
            dragControls={controls}
            onPointerDown={handlePointerDown}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
            className={`relative p-3 rounded-lg flex items-center justify-between cursor-pointer border-l-4 transition-all ${
                isSelectionMode 
                    ? (isSelected ? 'border-l-blue-500 bg-blue-500/10' : 'border-l-transparent hover:bg-white/5') 
                    : (activeLayerId === layer.id ? 'border-l-red-500 bg-white/5' : 'border-l-transparent hover:bg-white/5')
            }`}
            style={{ userSelect: 'none' }}
        >
            {/* Left element: selection checkbox OR drag handles */}
            {isSelectionMode ? (
                <div className="mr-3 shrink-0 flex items-center justify-center" onPointerDown={e => e.stopPropagation()}>
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${isSelected ? 'bg-blue-500 border-blue-500 text-white' : 'border-gray-600 hover:border-gray-400'}`}>
                        {isSelected && <Check size={12} strokeWidth={3} />}
                    </div>
                </div>
            ) : (
                /* Drag Handle & Reorder Buttons */
                <div className="flex items-center gap-1.5 shrink-0 mr-2">
                    <div 
                        onPointerDown={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            controls.start(e);
                        }}
                        className="text-gray-600 cursor-grab active:cursor-grabbing p-1 hover:text-gray-400 shrink-0"
                        title={t("Drag to reorder")}
                    >
                        <GripHorizontal size={14}/>
                    </div>
                    <div className="flex flex-col gap-0.5" onPointerDown={e => e.stopPropagation()}>
                        <button 
                            disabled={isFirst}
                            onClick={(e) => { e.stopPropagation(); onMoveUp(); }} 
                            className={`p-0.5 rounded transition-colors ${isFirst ? 'text-white/10 cursor-not-allowed' : 'text-gray-400 hover:text-white hover:bg-white/10'}`}
                            title={t("Move layer up")}
                        >
                            <ChevronUp size={10}/>
                        </button>
                        <button 
                            disabled={isLast}
                            onClick={(e) => { e.stopPropagation(); onMoveDown(); }} 
                            className={`p-0.5 rounded transition-colors ${isLast ? 'text-white/10 cursor-not-allowed' : 'text-gray-400 hover:text-white hover:bg-white/10'}`}
                            title={t("Move layer down")}
                        >
                            <ChevronDown size={10}/>
                        </button>
                    </div>
                </div>
            )}

            {/* Preview Thumbnail */}
            <div className="w-8 h-8 bg-white rounded border border-white/20 overflow-hidden shrink-0 mr-3" onPointerDown={e => e.stopPropagation()}>
                {layer.dataUri ? <img src={layer.dataUri} className="w-full h-full object-cover" referrerPolicy="no-referrer"/> : null}
            </div>

            <div className="flex-1 min-w-0 pr-2">
                {editingLayerId === layer.id ? (
                    <input 
                        autoFocus
                        type="text" 
                        defaultValue={layer.name}
                        onBlur={(e) => { renameLayer(layer.id, e.target.value); setEditingLayerId(null); }}
                        onKeyDown={(e) => { if(e.key === 'Enter') { renameLayer(layer.id, e.currentTarget.value); setEditingLayerId(null); } }}
                        className="bg-[#050505] border border-white/20 rounded px-1 text-xs text-white w-full outline-none"
                        onClick={(e) => e.stopPropagation()}
                        onPointerDown={e => e.stopPropagation()}
                    />
                ) : (
                    <div 
                        className="flex items-center gap-2 group/title"
                        onDoubleClick={(e) => { e.stopPropagation(); setEditingLayerId(layer.id); }}
                    >
                        <div className={`text-xs font-bold truncate ${activeLayerId === layer.id ? 'text-white' : 'text-gray-400'}`}>
                            {layer.name}
                        </div>
                        {!isSelectionMode && (
                            <button 
                                onClick={(e) => { e.stopPropagation(); setEditingLayerId(layer.id); }}
                                onPointerDown={e => e.stopPropagation()}
                                className="opacity-0 group-hover/title:opacity-100 p-1 text-gray-500 hover:text-white transition-all shrink-0"
                                title={t("Rename Layer")}
                            >
                                <Edit2 size={10} />
                            </button>
                        )}
                    </div>
                )}
                <div className="flex items-center gap-2 mt-1" onPointerDown={e => e.stopPropagation()}>
                    <input 
                        type="range"
                        min="0" max="1" step="0.05"
                        disabled={isSelectionMode}
                        value={layer.opacity !== undefined ? layer.opacity : 1}
                        onChange={(e) => {
                            updateFrameLayerOpacity(layer.id, parseFloat(e.target.value), true);
                        }}
                        onPointerUp={() => {
                            pushToUndoHistory(framesRef.current);
                        }}
                        className="w-full h-1 bg-white/10 rounded-full appearance-none outline-none cursor-pointer accent-red-500 disabled:opacity-30 disabled:cursor-not-allowed"
                    />
                    <span className="text-[10px] text-gray-500 font-mono shrink-0">{Math.round((layer.opacity !== undefined ? layer.opacity : 1) * 100)}%</span>
                </div>
            </div>

            {/* Quick Actions */}
            {!isSelectionMode && (
                <div className="flex flex-col gap-1 shrink-0" onPointerDown={e => e.stopPropagation()}>
                    <button onClick={(e) => { e.stopPropagation(); toggleLayerVisibility(layer.id); }} className={`p-1 rounded ${layer.visible ? 'text-gray-400 hover:text-white' : 'text-red-500'}`}>
                        {layer.visible ? <Eye size={12}/> : <EyeOff size={12}/>}
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); duplicateLayer(layer.id); }} className="p-1 text-gray-600 hover:text-blue-400" title={t("Duplicate Layer")}><Copy size={12}/></button>
                    <button onClick={(e) => { e.stopPropagation(); deleteLayer(layer.id); }} className="p-1 text-gray-600 hover:text-red-400" title={t("Delete Layer")}><Trash2 size={12}/></button>
                </div>
            )}
        </Reorder.Item>
    );
});

interface FrameByFrameEditorProps {
    onBack: () => void;
    frames: FrameData[];
    setFrames: React.Dispatch<React.SetStateAction<FrameData[]>>;
    onSave: (thumb?: string, audioData?: any, extraSettings?: any) => void;
    onLoadAudio: (file: File, type: 'vocal' | 'inst') => void;
    settings?: FrameSettings;
    canvasBgColor?: string;
    setCanvasBgColor?: (color: string) => void;
    isCanvasTransparent?: boolean;
    setIsCanvasTransparent?: (transparent: boolean) => void;
    vocalTrack?: any;
    instTrack?: any;
    isLowPerformanceMode?: boolean;
}

const PRESET_RATIOS = [
    { id: 'yt', name: 'YouTube', width: 1920, height: 1080, icon: Youtube },
    { id: 'tik', name: 'TikTok', width: 1080, height: 1920, icon: Smartphone },
    { id: 'sq', name: 'Square', width: 1080, height: 1080, icon: Instagram },
    { id: '4k', name: '4K Ultra', width: 3840, height: 2160, icon: Monitor },
    { id: 'film', name: 'Cinema', width: 2048, height: 858, icon: LayoutGrid },
];

// --- HELPER: ROBUST DRAGGABLE HOOK (DELTA BASED) ---
// Uses delta position changes rather than absolute client offsets
// This prevents "jumping" when touch coordinates differ from element coordinates
const useDraggable = (initialX: number, initialY: number, width: number = 200, height: number = 200) => {
    const [pos, setPos] = useState({ x: initialX, y: initialY });
    const draggingRef = useRef<{ isDragging: boolean, el: HTMLElement | null }>({ isDragging: false, el: null });
    const dragStartRef = useRef({ x: 0, y: 0 }); // Pointer start
    const initialPosRef = useRef({ x: 0, y: 0 }); // Element start position at drag start

    // Handle initialization clamping and window resize
    useEffect(() => {
        const clampPos = (p: { x: number, y: number }) => {
            const clampedX = Math.max(10, Math.min(p.x, window.innerWidth - width - 10));
            const clampedY = Math.max(10, Math.min(p.y, window.innerHeight - height - 10));
            return { x: clampedX, y: clampedY };
        };

        setPos(current => clampPos(current));

        const handleResize = () => {
            setPos(current => clampPos(current));
        };

        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, [width, height]);

    const onPointerDown = (e: React.PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();
        
        const panel = (e.currentTarget as HTMLElement).closest('.draggable-panel') as HTMLElement || e.currentTarget as HTMLElement;
        draggingRef.current = { isDragging: true, el: panel };
        dragStartRef.current = { x: e.clientX, y: e.clientY };
        initialPosRef.current = { x: pos.x, y: pos.y };
        
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    };

    const onPointerMove = (e: React.PointerEvent) => {
        if (!draggingRef.current.isDragging || !draggingRef.current.el) return;
        e.preventDefault();
        e.stopPropagation();
        
        const dx = e.clientX - dragStartRef.current.x;
        const dy = e.clientY - dragStartRef.current.y;
        
        let newX = initialPosRef.current.x + dx;
        let newY = initialPosRef.current.y + dy;

        // Keep partially on screen
        newX = Math.max(10, Math.min(newX, window.innerWidth - width - 10));
        newY = Math.max(10, Math.min(newY, window.innerHeight - height - 10));

        draggingRef.current.el.style.left = `${newX}px`;
        draggingRef.current.el.style.top = `${newY}px`;
    };

    const onPointerUp = (e: React.PointerEvent) => {
        if (!draggingRef.current.isDragging) return;
        draggingRef.current.isDragging = false;
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
        
        if (draggingRef.current.el) {
            setPos({
                x: parseFloat(draggingRef.current.el.style.left) || 0,
                y: parseFloat(draggingRef.current.el.style.top) || 0
            });
            draggingRef.current.el = null;
        }
    };

    // Provide a proxy object that evaluates draggingRef.current.isDragging on the fly
    const draggingProxy = useMemo(() => ({
        get current() { return draggingRef.current.isDragging; }
    }), []);
    
    return { pos, setPos, onPointerDown, onPointerMove, onPointerUp, draggingRef: draggingProxy, dragStartRef };
};


const VirtualTimeline = ({ frames, currentFrameIndex, setCurrentFrameIndex, addFrame, saveActiveLayer, audioBuffer, scrubAudio, playbackSpeed, onMoveLeft, onMoveRight, t }: any) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [scrollLeft, setScrollLeft] = useState(0);
    const ITEM_WIDTH = 136; // 120 + 16 gap
    
    // Jump to current frame roughly when it changes and is out of bounds
    useEffect(() => {
        if (!containerRef.current) return;
        const width = containerRef.current.clientWidth;
        const minVisible = Math.floor(containerRef.current.scrollLeft / ITEM_WIDTH);
        const maxVisible = Math.floor((containerRef.current.scrollLeft + width) / ITEM_WIDTH);
        
        if (currentFrameIndex < minVisible || currentFrameIndex > maxVisible - 1) {
            containerRef.current.scrollTo({ left: Math.max(0, (currentFrameIndex - 1) * ITEM_WIDTH), behavior: 'smooth' });
        }
    }, [currentFrameIndex]);

    const handleScroll = () => {
        if (containerRef.current) setScrollLeft(containerRef.current.scrollLeft);
    };

    const width = containerRef.current?.clientWidth || 1000;
    const startIndex = Math.max(0, Math.floor(scrollLeft / ITEM_WIDTH) - 4);
    const endIndex = Math.min(frames.length - 1, Math.floor((scrollLeft + width) / ITEM_WIDTH) + 4);

    const visibleItems = [];
    for (let i = startIndex; i <= endIndex; i++) {
        visibleItems.push({ frame: frames[i], index: i });
    }

    return (
        <div 
            ref={containerRef}
            className="flex-1 overflow-y-hidden overflow-x-auto custom-scrollbar p-2 relative"
            onScroll={handleScroll}
            onWheel={(e) => e.stopPropagation()}
        >
            <div style={{ width: (frames.length * ITEM_WIDTH) + 120, height: 68, position: 'relative' }}>
                {visibleItems.map(({ frame, index }) => (
                    <div key={frame.id} style={{ position: 'absolute', left: index * ITEM_WIDTH, top: 0 }}>
                        <div
                            onClick={() => {
                                if (index !== currentFrameIndex) {
                                    saveActiveLayer();
                                    setCurrentFrameIndex(index);
                                    if (audioBuffer) scrubAudio(index / playbackSpeed);
                                }
                            }}
                            className={`w-[120px] h-[68px] cursor-pointer rounded-lg border-2 overflow-hidden bg-black transition-all relative ${index === currentFrameIndex ? 'border-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.4)] scale-[1.02] z-10' : 'border-white/10 hover:border-white/30'}`}
                        >
                            <div className="w-full h-full relative" style={{ backgroundImage: 'repeating-conic-gradient(#333 0% 25%, transparent 0% 50%)', backgroundSize: '16px 16px' }}>
                                <img src={frame.dataUri || undefined} className="w-full h-full object-contain pointer-events-none" alt="" />
                            </div>

                            {/* Rearrange Action Buttons Overlaid on each Frame - Permanently Visible & Professional */}
                            {onMoveLeft && onMoveRight && t && (
                                <div className="absolute inset-x-1 bottom-1 flex justify-between items-center bg-black/85 backdrop-blur-[1px] rounded border border-white/10 p-0.5 z-20 pointer-events-none">
                                    <button 
                                        onClick={(e) => onMoveLeft(index, e)}
                                        disabled={index === 0}
                                        className={`w-5 h-5 rounded bg-zinc-900 hover:bg-cyan-500 hover:text-black flex items-center justify-center text-white transition-all active:scale-90 disabled:opacity-20 disabled:pointer-events-none border border-white/5 pointer-events-auto`}
                                        title={t('Move Left')}
                                    >
                                        <ChevronLeft size={10} strokeWidth={2.5} />
                                    </button>
                                    <span className="text-[8px] font-black font-mono text-cyan-400 select-none">
                                        {index + 1}
                                    </span>
                                    <button 
                                        onClick={(e) => onMoveRight(index, e)}
                                        disabled={index === frames.length - 1}
                                        className={`w-5 h-5 rounded bg-zinc-900 hover:bg-cyan-500 hover:text-black flex items-center justify-center text-white transition-all active:scale-90 disabled:opacity-20 disabled:pointer-events-none border border-white/5 pointer-events-auto`}
                                        title={t('Move Right')}
                                    >
                                        <ChevronRight size={10} strokeWidth={2.5} />
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                ))}
                <button 
                    onClick={addFrame} 
                    style={{ position: 'absolute', left: frames.length * ITEM_WIDTH, top: 0 }}
                    className="w-[120px] h-[68px] rounded-lg border-2 border-dashed border-white/10 hover:border-cyan-500/50 hover:bg-cyan-500/5 flex items-center justify-center text-gray-600 hover:text-cyan-400 transition-all"
                >
                    <Plus size={24}/>
                </button>
            </div>
        </div>
    );
};

const ClipWaveform = ({ clip, width }: { clip: any, width: number }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        
        const roundedWidth = Math.max(10, Math.floor(width));
        const height = 46; // fixed clip height
        const dpr = window.devicePixelRatio || 1;
        
        // Match the canvas's internal draw dimensions exactly to the physical layout width
        canvas.width = roundedWidth * dpr;
        canvas.height = height * dpr;
        ctx.scale(dpr, dpr);
        
        ctx.clearRect(0, 0, roundedWidth, height);

        const buffer = clip.buffer;
        if (!buffer) return;

        const data = buffer.getChannelData(0);
        const startSample = Math.floor(clip.startTrim * buffer.sampleRate);
        const durationSamples = Math.floor((clip.playDuration * (clip.speed || 1.0)) * buffer.sampleRate);
        const endSample = Math.min(data.length, startSample + durationSamples);
        const segmentLength = endSample - startSample;
        
        if (segmentLength <= 0) return;

        const samplesPerPixel = segmentLength / roundedWidth;
        const amp = height / 2;
        
        ctx.fillStyle = '#22d3ee'; // cyan-400
        
        const verticalZoom = 1.3; // boost the waveform a bit

        for (let i = 0; i < roundedWidth; i++) {
            let min = 1.0;
            let max = -1.0;
            
            if (samplesPerPixel >= 1) {
                const startIdx = startSample + Math.floor(i * samplesPerPixel);
                const endIdx = startSample + Math.floor((i + 1) * samplesPerPixel);
                const skip = Math.max(1, Math.floor((endIdx - startIdx) / 15)); // optimize sample searching
                
                let found = false;
                for (let j = startIdx; j < endIdx; j += skip) {
                    if (j < data.length) {
                        found = true;
                        const datum = data[j];
                        if (datum < min) min = datum;
                        if (datum > max) max = datum;
                    }
                }
                if (!found) { min = 0; max = 0; }
            } else {
                 const index = startSample + Math.floor(i * samplesPerPixel);
                 if (index < data.length) {
                     min = data[index];
                     max = data[index];
                 } else {
                     min = 0; max = 0;
                 }
            }
            
            if (min > max) { min = 0; max = 0; }
            
            min *= verticalZoom;
            max *= verticalZoom;

            if (max > 1) max = 1;
            if (min < -1) min = -1;

            const y = (1 + min) * amp;
            const h = Math.max(1.5, (max - min) * amp); // Guarantee at least 1.5px bar height

            ctx.fillRect(i, y, 1, h);
        }
    }, [clip.buffer, clip.startTrim, clip.playDuration, clip.speed, width]);

    return <canvas ref={canvasRef} style={{ width: `${width}px`, height: '46px' }} className="absolute inset-0 pointer-events-none opacity-60 z-0" />;
};

export const FrameByFrameEditor: React.FC<FrameByFrameEditorProps> = ({ 
    onBack, 
    frames, 
    setFrames, 
    onSave, 
    onLoadAudio,
    settings,
    canvasBgColor = '#ffffff',
    setCanvasBgColor,
    isCanvasTransparent = true,
    setIsCanvasTransparent,
    vocalTrack,
    instTrack,
    isLowPerformanceMode = false
}) => {
  const { t } = useLanguage();

    // --- STATE ---
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [referenceVideoUrl, setReferenceVideoUrl] = useState<string | null>(null);
    const [videoOpacity, setVideoOpacity] = useState<number>(0.5);
    const previewCanvasRef = useRef<HTMLCanvasElement>(null);
    const drawingCanvasRef = useRef<HTMLCanvasElement>(null);
    const rulerCanvasRef = useRef<HTMLCanvasElement>(null);
    const beforeDrawStateRef = useRef<ImageData | null>(null);
    const onionSkinRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasWrapperRef = useRef<HTMLDivElement>(null);
    const rulerCanvasCtxRef = useRef<CanvasRenderingContext2D | null>(null);
    const isSpaceDownRef = useRef(false);
    
    // Texture Pattern Cache
    const texturePatternRef = useRef<CanvasPattern | null>(null);
    
    const [showCompactFrames, setShowCompactFrames] = useState(false);
    const [currentFrameIndex, setCurrentFrameIndex] = useState(0);
    const [showMagicOptions, setShowMagicOptions] = useState(false);
    
    // Local Canvas Size State
    const [canvasSize, setCanvasSize] = useState({ 
        width: settings?.width || 1920, 
        height: settings?.height || 1080 
    });

    const canvasTransformRef = useRef({ scale: 1, x: 0, y: 0, rotation: 0 });
    const transformRafRef = useRef<number | null>(null);

    const applyTransform = (x: number, y: number, scale: number, rot: number = canvasTransformRef.current.rotation) => {
        const newScale = Math.max(0.1, Math.min(10, scale));
        canvasTransformRef.current = { x, y, scale: newScale, rotation: rot };
        
        if (canvasWrapperRef.current) {
            canvasWrapperRef.current.style.transformOrigin = 'center center';
            canvasWrapperRef.current.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${newScale}) rotate(${rot}deg)`;
        }
    };

    // Layer State
    const [activeLayerId, setActiveLayerId] = useState<string | null>(null);
    const [showLayersPanel, setShowLayersPanel] = useState(false);
    const [editingLayerId, setEditingLayerId] = useState<string | null>(null);

    // Panels Position State - Initialized safely
    const layerPanel = useDraggable(window.innerWidth - 280, 100, 256, 400);
    const settingsPanel = useDraggable(80, 100, 256, 350);
    const bonePanel = useDraggable(window.innerWidth - 240, window.innerHeight - 340, 192, 260);
    const transformPanel = useDraggable(window.innerWidth / 2 - 150, window.innerHeight - 100, 300, 60);
    const textColorPickerPanel = useDraggable(window.innerWidth / 2 - 128, 100, 256, 300);
    const borderColorPickerPanel = useDraggable(window.innerWidth / 2 - 128, 100, 256, 300);
    const mainColorPickerPanel = useDraggable(window.innerWidth / 2 - 128, 100, 256, 300);
    const bgColorPickerPanel = useDraggable(window.innerWidth / 2 - 128, 100, 256, 300);
    // Remove riggingToolsPanel draggable if no longer needed
    // const riggingToolsPanel = useDraggable(100, 100);

    const [orientation, setOrientation] = useState<'portrait' | 'landscape'>(
        window.innerWidth > window.innerHeight ? 'landscape' : 'portrait'
    );
    const [isDesktopLike, setIsDesktopLike] = useState(window.innerWidth >= 1024);

    useEffect(() => {
        const handleResize = () => {
            setOrientation(window.innerWidth > window.innerHeight ? 'landscape' : 'portrait');
            setIsDesktopLike(window.innerWidth >= 1024);
        };
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    const [timelineHeight, setTimelineHeight] = useState(orientation === 'landscape' ? 120 : 160);

    // Sync timeline height on orientation change
    useEffect(() => {
        if (orientation === 'landscape') {
            setTimelineHeight(h => Math.min(h, 120));
        } else {
            setTimelineHeight(h => Math.max(h, 160));
        }
    }, [orientation]);

    // Rigging State
    const [isRiggingMode, setIsRiggingMode] = useState(false);
    const [showRiggingPrompt, setShowRiggingPrompt] = useState(false);
    const [activeRigType, setActiveRigType] = useState<'MESH' | 'HUMAN'>('MESH');

    // Advanced Background Removal State
    const [isBgRemovalModalOpen, setIsBgRemovalModalOpen] = useState(false);
    const [bgRemovalOrigUri, setBgRemovalOrigUri] = useState<string | null>(null);
    const [bgRemovalPreviewUri, setBgRemovalPreviewUri] = useState<string | null>(null);
    const [bgRemovalMode, setBgRemovalMode] = useState<'ai' | 'lineart'>('lineart');
    const [bgRemovalThreshold, setBgRemovalThreshold] = useState<number>(220);
    const [bgRemovalSmoothness, setBgRemovalSmoothness] = useState<number>(15);
    const [bgRemovalInfillJoints, setBgRemovalInfillJoints] = useState<boolean>(true);
    const [bgRemovalInkColorMode, setBgRemovalInkColorMode] = useState<'preserve' | 'black' | 'current'>('preserve');
    const [isProcessingBgRemoval, setIsProcessingBgRemoval] = useState(false);

    const [isShowingPreview, setIsShowingPreview] = useState(false);
    const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
    const [isExporting, setIsExporting] = useState(false);
    const [exportProgress, setExportProgress] = useState<number | null>(null);
    const [isImportingVideo, setIsImportingVideo] = useState(false);
    const [importVideoProgress, setImportVideoProgress] = useState<number | null>(null);
    const [extractingFrameUri, setExtractingFrameUri] = useState<string | null>(null);
    const originalVideoRef = useRef<{ file: File, lastFps: number } | null>(null);
    const [localToast, setLocalToast] = useState<string | null>(null);
    const triggerLocalToast = (msg: string) => {
        toast(msg);
    };
    const [exportedFile, setExportedFile] = useState<{ url: string, type: 'video' | 'gif' | 'zip' | 'game', blob?: Blob, extension?: string } | null>(null);
    const [exportFormat, setExportFormat] = useState<'video' | 'gif' | 'zip' | 'game'>('video');
    const [videoCodec, setVideoCodec] = useState<'webm' | 'mp4'>('webm');
    const [useInterpolation, setUseInterpolation] = useState(true);
    // Keyed by layer name for cross-frame matching
    const interpTransformsGlobalRef = useRef<Record<string, Record<string, {rotation: number, scaleX: number, scaleY: number}>>>({}); 
    const [riggingBones, setRiggingBones] = useState<Bone[]>([]);
    const [riggingTool, setRiggingTool] = useState<'BONE' | 'HAND' | 'DELETE'>('BONE');
    const [riggingSnapshot, setRiggingSnapshot] = useState<string | null>(null);
    
    const [activeTool, setActiveTool] = useState<'PEN' | 'ERASER' | 'FILL' | 'LASSO' | 'BONES' | 'RULER'>('PEN');
    const activeToolRef = useRef(activeTool);
    useEffect(() => { activeToolRef.current = activeTool; }, [activeTool]);
    
    // Bone Deformation State
    const [boneTransforms, setBoneTransforms] = useState<Record<string, { rotation: number, scaleX: number, scaleY: number }>>({});
    const [activeBoneId, setActiveBoneId] = useState<string | null>(null);

    // Default Brush
    const [activeBrush, setActiveBrush] = useState<BrushPreset>({
        id: 'pen_g',
        name: 'G-Pen',
        category: 'PEN',
        engine: 'INK_G_PEN',
        size: settings?.brushSettings?.size || 4,
        opacity: settings?.brushSettings?.opacity || 1.0,
        spacing: 0.1,
        hardness: settings?.brushSettings?.hardness || 1.0,
        icon: PenTool
    });
    
    const [penColor, setPenColor] = useState('#000000');
    const [fillColor, setFillColor] = useState('#ff0000');
    
    const currentColor = activeBrush.category === 'FILL' ? fillColor : penColor;
    const setCurrentColor = (c: string) => activeBrush.category === 'FILL' ? setFillColor(c) : setPenColor(c);

    // Dynamic real-time preview update for Advanced Background Removal
    useEffect(() => {
        if (!isBgRemovalModalOpen || !bgRemovalOrigUri) return;
        
        if (bgRemovalMode === 'ai') {
            setBgRemovalPreviewUri(bgRemovalOrigUri);
            return;
        }
        
        const img = new Image();
        img.onload = () => {
            const resultUri = extractLineArt(
                img, 
                bgRemovalThreshold, 
                bgRemovalSmoothness, 
                bgRemovalInfillJoints, 
                bgRemovalInkColorMode,
                penColor
            );
            setBgRemovalPreviewUri(resultUri);
        };
        img.src = bgRemovalOrigUri;
    }, [isBgRemovalModalOpen, bgRemovalOrigUri, bgRemovalMode, bgRemovalThreshold, bgRemovalSmoothness, bgRemovalInfillJoints, bgRemovalInkColorMode, penColor]);

    const [smoothing, setSmoothing] = useState(settings?.smoothing || 0.5);
    const smoothPointsRef = useRef<{x: number, y: number}[]>([]);
    
    // Magic Eraser state
    const [magicEraserThreshold, setMagicEraserThreshold] = useState(60);
    const [magicEraserContiguous, setMagicEraserContiguous] = useState(false);

    // Selection / Lasso Move State
    const [lassoPoints, setLassoPoints] = useState<{x: number, y: number}[]>([]);
    const lassoPointsRef = useRef<{x: number, y: number}[]>([]);
    const [isLassoDrawing, setIsLassoDrawing] = useState(false);

    // Transform State
    const [isTransforming, setIsTransforming] = useState(false);
    const [transformImageUri, setTransformImageUri] = useState<string | null>(null);
    const [transformState, setTransformState] = useState({ x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1, rotation: 0, flipX: false, flipY: false, originX: 50, originY: 50 });
    const [transformMode, setTransformMode] = useState<'move' | 'rotate' | 'scale'>('move');
    const transformRef = useRef({ x: 0, y: 0, scale: 1 }); // For fast dragging
    const [transformNaturalSize, setTransformNaturalSize] = useState({ width: 1, height: 1 });
    const [isLassoMode, setIsLassoMode] = useState(false);

    // Rule Tool State
    const [activeRuler, setActiveRuler] = useState<'CIRCLE' | 'BOX' | 'LINE' | 'SYMMETRY' | null>(null);
    const [showRulerMenu, setShowRulerMenu] = useState(true);
    const [isDraggingRulerKnob, setIsDraggingRulerKnob] = useState(false);
    const [isDraggingRulerBody, setIsDraggingRulerBody] = useState(false);
    
    const applyRulerPath = (ctx: CanvasRenderingContext2D) => {
        if (!activeRuler) return;
        
        ctx.beginPath();
        const {x, y} = rulerPosRef.current;
        const radiusX = (150 * rulerScaleXRef.current) / 2;
        const radiusY = (150 * rulerScaleYRef.current) / 2;
        
        if (activeRuler === 'BOX') {
            ctx.rect(x - radiusX, y - radiusY, radiusX * 2, radiusY * 2);
        } else if (activeRuler === 'CIRCLE') {
            ctx.ellipse(x, y, radiusX, radiusY, 0, 0, Math.PI * 2);
        } else if (activeRuler === 'LINE') {
            ctx.rect(x - radiusX, y - 5, radiusX * 2, 10);
        }
    };
    
    // Check if pointer is on ruler knob
    const isPointerOnRulerKnob = (x: number, y: number) => {
        if (!activeRuler) return false;
        
        const { x: rx, y: ry } = rulerPosRef.current;
        const radiusX = (150 * rulerScaleXRef.current) / 2;
        const radiusY = (150 * rulerScaleYRef.current) / 2;
        
        let knobX = rx + radiusX;
        let knobY = ry - radiusY;
        
        if (activeRuler === 'LINE') {
            knobY = ry;
        } else if (activeRuler === 'SYMMETRY') {
            knobX = rx;
            knobY = ry;
        }
        
        const dist = Math.sqrt(Math.pow(x - knobX, 2) + Math.pow(y - knobY, 2));
        return dist < 60; // Increased knob hit zone radius
    };

    const snapPointToRuler = (x: number, y: number) => {
        if (!activeRuler) return { x, y };

        const { x: rx, y: ry } = rulerPosRef.current;
        const radiusX = (150 * rulerScaleXRef.current) / 2;
        const radiusY = (150 * rulerScaleYRef.current) / 2;

        if (activeRuler === 'BOX') {
            const left = rx - radiusX;
            const right = rx + radiusX;
            const top = ry - radiusY;
            const bottom = ry + radiusY;

            const dl = Math.abs(x - left);
            const dr = Math.abs(x - right);
            const dt = Math.abs(y - top);
            const db = Math.abs(y - bottom);

            const minD = Math.min(dl, dr, dt, db);

            if (minD === dl) return { x: left, y: Math.max(top, Math.min(bottom, y)) };
            if (minD === dr) return { x: right, y: Math.max(top, Math.min(bottom, y)) };
            if (minD === dt) return { x: Math.max(left, Math.min(right, x)), y: top };
            if (minD === db) return { x: Math.max(left, Math.min(right, x)), y: bottom };

        } else if (activeRuler === 'CIRCLE') {
            const dx = x - rx;
            const dy = y - ry;
            const dist = Math.sqrt(Math.pow(dx / radiusX, 2) + Math.pow(dy / radiusY, 2));
            if (dist === 0) return { x: rx + radiusX, y: ry };
            return {
                x: rx + (dx / dist),
                y: ry + (dy / dist)
            };
        } else if (activeRuler === 'LINE') {
            return { x, y: ry };
        }
        return { x, y };
    };

    // Check if pointer is on ruler body
    const isPointerOnRulerBody = (x: number, y: number) => {
        if (!activeRuler) return false;
        
        const { x: rx, y: ry } = rulerPosRef.current;
        const radiusX = (150 * rulerScaleXRef.current) / 2;
        const radiusY = (150 * rulerScaleYRef.current) / 2;
        
        if (activeRuler === 'BOX') {
            return Math.abs(x - rx) <= radiusX && Math.abs(y - ry) <= radiusY;
        } else if (activeRuler === 'CIRCLE') {
            const dist = Math.sqrt(Math.pow((x - rx)/radiusX, 2) + Math.pow((y - ry)/radiusY, 2));
            return dist <= 1;
        } else if (activeRuler === 'LINE') {
            return Math.abs(y - ry) <= 10 && Math.abs(x - rx) <= radiusX;
        } else if (activeRuler === 'SYMMETRY') {
            return Math.abs(x - rx) <= 40; // 80px hit area around the line
        }
        return false;
    };
    const rulerScaleXRef = useRef(2);
    const rulerScaleYRef = useRef(2);
    const rulerRotationRef = useRef(0);
    const rulerPosRef = useRef({ x: 500, y: 500 });
    const [isLassoExtraction, setIsLassoExtraction] = useState(false);
    const [lastCanvasColor, setLastCanvasColor] = useState('#ffffff');
    const [clipboardContent, setClipboardContent] = useState<{
        dataUri: string;
        width: number;
        height: number;
        x: number;
        y: number;
        scale: number;
        scaleX: number;
        scaleY: number;
        rotation: number;
        flipX: boolean;
        flipY: boolean;
        originX: number;
        originY: number;
        sourceLayerId?: string;
    } | null>(null);

    const startTransformation = useCallback(async (dataUri: string, originalX: number, originalY: number, initialState?: Partial<{ scale: number, scaleX: number, scaleY: number, rotation: number, flipX: boolean, flipY: boolean, originX: number, originY: number }>, forceLassoExtraction: boolean = false) => {
        setIsLassoExtraction(forceLassoExtraction);
        isImportModeRef.current = false;
        const { trimmedDataUri, width, height, x, y } = await trimImage(dataUri);
        setTransformImageUri(trimmedDataUri);
        setTransformNaturalSize({ width, height });
        setTransformState({
            x: originalX + x,
            y: originalY + y,
            scale: 1,
            scaleX: 1,
            scaleY: 1,
            rotation: 0,
            flipX: false,
            flipY: false,
            originX: 50,
            originY: 50,
            ...initialState
        });
        setIsTransforming(true);
    }, []);

    // Automatically manage canvas background color when entering/leaving magic eraser
    useEffect(() => {
        if (activeBrush.id === 'magic_eraser') {
            if (canvasBgColor !== '#000000') {
                setLastCanvasColor(canvasBgColor || '#ffffff');
                setCanvasBgColor?.('#000000');
            }
        } else {
            if (canvasBgColor === '#000000' && lastCanvasColor !== '#000000') {
                setCanvasBgColor?.(lastCanvasColor);
            }
        }
    }, [activeBrush.id, canvasBgColor, lastCanvasColor, setCanvasBgColor]);

    const [isDrawing, setIsDrawing] = useState(false);
    const isDrawingRef = useRef(false);
    const isImportModeRef = useRef(false);
    const [isPanning, setIsPanning] = useState(false);
    const panStartRef = useRef({ x: 0, y: 0 });
    const canvasRenderedDataUriRef = useRef<string | null>(null);
    const activePointersRef = useRef<Set<number>>(new Set());
    const audioContextRef = useRef<AudioContext | null>(null);
    const audioStartTimeRef = useRef<number>(0);
    const audioOffsetRef = useRef<number>(0);
    const isDraggingPlayheadRef = useRef<boolean>(false);
    const [isPlaying, setIsPlaying] = useState(false);
    const [onionSkinEnabled, setOnionSkinEnabled] = useState(true);
    const [onionSkinSettings, setOnionSkinSettings] = useState(settings?.onionSkinSettings || { prev: 1, next: 0, opacity: 0.3 });
    const [showOnionSkinMenu, setShowOnionSkinMenu] = useState(false);
    const [playbackSpeed, setPlaybackSpeed] = useState(settings?.fps || 12);

    // UI Toggles
    const [showColorPicker, setShowColorPicker] = useState(false);
    const [showTextModal, setShowTextModal] = useState(false);
    const [showTextColorPicker, setShowTextColorPicker] = useState(false);
    const [showBorderColorPicker, setShowBorderColorPicker] = useState(false);
    const [textInputData, setTextInputData] = useState({ text: '', font: 'Arial', color: '#ffffff', borderColor: '#000000', borderWidth: 0, styleTemplate: 'none' });
    const [showLayerMagicOptions, setShowLayerMagicOptions] = useState(false);
    const [showBgColorPicker, setShowBgColorPicker] = useState(false);
    const [showBrushLibrary, setShowBrushLibrary] = useState(false);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [waveformZoom, setWaveformZoom] = useState(3);
    const [playheadProgress, setPlayheadProgress] = useState(0);
    const [showHeaderMenu, setShowHeaderMenu] = useState(false);

    // Audio State
    interface AudioClip {
        id: string;
        buffer: AudioBuffer;
        name: string;
        startOffset: number; // position on timeline
        startTrim: number; // offset into original file
        playDuration: number; // playing length
        volume: number; // clip gain
        speed: number; // clip speed multiplier (0.25 to 2.0)
    }

    const [audioClips, setAudioClips] = useState<AudioClip[]>([]);
    const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
    const [audioSpeed, setAudioSpeed] = useState<number>(1.0); // Selected audio speed
    const [isAudioLongPressed, setIsAudioLongPressed] = useState<boolean>(false);
    const [showClipEditDrawer, setShowClipEditDrawer] = useState<boolean>(false);

    // Custom Naming Modal State
    const [isNamingModalOpen, setIsNamingModalOpen] = useState<boolean>(false);
    const [namingModalValue, setNamingModalValue] = useState<string>("");
    const [namingModalExtension, setNamingModalExtension] = useState<string>("");

    const handleConfirmDownload = async () => {
        if (!exportedFile) return;
        const ext = namingModalExtension;
        const userInput = namingModalValue.trim();
        if (!userInput) return;

        const filename = `${userInput.replace(new RegExp(`\\.${ext}$`, 'i'), '')}.${ext}`;
        
        triggerLocalToast("DOWNLOADING...");
        if (exportedFile.blob) {
            await triggerDownload(exportedFile.blob, filename);
        } else {
            await triggerDownload(exportedFile.url, filename);
        }
        
        setIsNamingModalOpen(false);
        
        setTimeout(() => {
            triggerLocalToast("ANIMATION SAVED TO DEVICE / DOWNLOADING");
        }, 2000);
    };

    const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
    const [audioFileName, setAudioFileName] = useState<string>("");
    const [audioModified, setAudioModified] = useState<boolean>(false);
    const [audioStartOffset, setAudioStartOffset] = useState<number>(0); // legacy view
    const [audioStartTrim, setAudioStartTrim] = useState<number>(0); // legacy view
    const [audioPlayDuration, setAudioPlayDuration] = useState<number>(10); // legacy view
    const [audioVolume, setAudioVolume] = useState<number>(1.0); // legacy view
    const [showAdvancedAudioTimeline, setShowAdvancedAudioTimeline] = useState<boolean>(false);
    const [isDraggingAudio, setIsDraggingAudio] = useState<'move' | 'trim-start' | 'trim-end' | null>(null);

    const dragStartClientX = useRef<number>(0);
    const dragStartStartOffset = useRef<number>(0);
    const dragStartStartTrim = useRef<number>(0);
    const dragStartDuration = useRef<number>(0);
    const dragStartedRef = useRef<boolean>(false);
    const longPressTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    const FRAME_WIDTH = 90; // width of each frame in pixels

    const handleAudioPointerDown = (e: React.PointerEvent<HTMLDivElement>, clipId: string, type: 'move' | 'trim-start' | 'trim-end') => {
        e.preventDefault();
        e.stopPropagation();
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        
        setSelectedClipId(clipId);
        const clip = audioClips.find(c => c.id === clipId);
        if (!clip) return;

        dragStartClientX.current = e.clientX;
        dragStartStartOffset.current = clip.startOffset;
        dragStartStartTrim.current = clip.startTrim;
        dragStartDuration.current = clip.playDuration;
        dragStartedRef.current = false;

        if (type === 'move') {
            setIsAudioLongPressed(false);
            if (longPressTimeoutRef.current) clearTimeout(longPressTimeoutRef.current);
            longPressTimeoutRef.current = setTimeout(() => {
                setIsAudioLongPressed(true);
                if (navigator.vibrate) {
                    navigator.vibrate(50);
                }
            }, 400);
            setIsDraggingAudio('move');
        } else {
            setIsAudioLongPressed(true);
            setIsDraggingAudio(type);
        }
    };

    const handleAudioPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
        if (!isDraggingAudio || !selectedClipId) return;
        
        const clip = audioClips.find(c => c.id === selectedClipId);
        if (!clip) return;

        e.preventDefault();
        e.stopPropagation();

        const dx = e.clientX - dragStartClientX.current;
        const dt = (dx / FRAME_WIDTH) / Math.max(1, playbackSpeed);

        if (Math.abs(dx) > 5) {
            dragStartedRef.current = true;
        }

        if (isDraggingAudio === 'move') {
            if (!isAudioLongPressed) return;
            const newOffset = Math.max(0, dragStartStartOffset.current + dt);
            setAudioClips(prev => prev.map(c => c.id === selectedClipId ? { ...c, startOffset: newOffset } : c));
            setAudioStartOffset(newOffset);
        } else if (isDraggingAudio === 'trim-start') {
            const maxTrim = clip.buffer.duration - 0.2;
            const newTrim = Math.max(0, Math.min(maxTrim, dragStartStartTrim.current + dt));
            const actualDelta = newTrim - dragStartStartTrim.current;
            
            const newOffset = Math.max(0, dragStartStartOffset.current + actualDelta);
            const newDuration = Math.max(0.2, dragStartDuration.current - actualDelta);
            
            setAudioClips(prev => prev.map(c => c.id === selectedClipId ? { 
                ...c, 
                startTrim: newTrim, 
                startOffset: newOffset, 
                playDuration: newDuration 
            } : c));
            
            setAudioStartTrim(newTrim);
            setAudioStartOffset(newOffset);
            setAudioPlayDuration(newDuration);
        } else if (isDraggingAudio === 'trim-end') {
            const maxDur = clip.buffer.duration - clip.startTrim;
            const newDuration = Math.max(0.2, Math.min(maxDur, dragStartDuration.current + dt));
            
            setAudioClips(prev => prev.map(c => c.id === selectedClipId ? { 
                ...c, 
                playDuration: newDuration 
            } : c));
            
            setAudioPlayDuration(newDuration);
        }
    };

    const handleAudioPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
        if (longPressTimeoutRef.current) {
            clearTimeout(longPressTimeoutRef.current);
            longPressTimeoutRef.current = null;
        }

        const wasLongPressed = isAudioLongPressed;
        setIsAudioLongPressed(false);

        if (!isDraggingAudio) return;
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
        setIsDraggingAudio(null);
        setAudioModified(true);

        if (!dragStartedRef.current && !wasLongPressed) {
            setShowClipEditDrawer(true);
        }
    };

    const handleMoveFrameLeft = (index: number, e: React.MouseEvent) => {
        e.stopPropagation();
        if (index === 0) return;
        const newFrames = [...frames];
        const temp = newFrames[index];
        newFrames[index] = newFrames[index - 1];
        newFrames[index - 1] = temp;
        setFrames(newFrames);
        setCurrentFrameIndex(index - 1);
    };

    const handleMoveFrameRight = (index: number, e: React.MouseEvent) => {
        e.stopPropagation();
        if (index === frames.length - 1) return;
        const newFrames = [...frames];
        const temp = newFrames[index];
        newFrames[index] = newFrames[index + 1];
        newFrames[index + 1] = temp;
        setFrames(newFrames);
        setCurrentFrameIndex(index + 1);
    };

    const handleSliceAudioAtPlayhead = () => {
        if (audioClips.length === 0) return;
        const playheadTime = currentFrameIndex / playbackSpeed;
        
        const clipToSliceIdx = audioClips.findIndex(clip => 
            playheadTime >= clip.startOffset && 
            playheadTime < clip.startOffset + clip.playDuration
        );
        
        if (clipToSliceIdx !== -1) {
            const clip = audioClips[clipToSliceIdx];
            const elapsed = playheadTime - clip.startOffset;
            
            if (elapsed > 0.1 && (clip.playDuration - elapsed) > 0.1) {
                const clip1: AudioClip = {
                    ...clip,
                    id: Math.random().toString(36).substr(2, 9),
                    playDuration: elapsed
                };
                
                const clip2: AudioClip = {
                    ...clip,
                    id: Math.random().toString(36).substr(2, 9),
                    startOffset: playheadTime,
                    startTrim: clip.startTrim + elapsed * (clip.speed || 1.0),
                    playDuration: clip.playDuration - elapsed
                };
                
                const newClips = [...audioClips];
                newClips.splice(clipToSliceIdx, 1, clip1, clip2);
                setAudioClips(newClips);
                setSelectedClipId(clip2.id);
                setAudioModified(true);
                showAppToast(t("Audio sliced at playhead"));
            }
        }
    };

    const mixAllClipsToBuffer = (): AudioBuffer | null => {
        if (audioClips.length === 0) return null;
        
        const sampleRate = audioClips[0].buffer.sampleRate;
        const totalDuration = frames.length / playbackSpeed;
        const totalSamples = Math.max(1000, Math.round(totalDuration * sampleRate));
        
        const ctx = audioContextRef.current || new (window.AudioContext || (window as any).webkitAudioContext)();
        const outputBuffer = ctx.createBuffer(2, totalSamples, sampleRate);
        
        const outChannels = 2;
        
        for (let ch = 0; ch < outChannels; ch++) {
            const outData = outputBuffer.getChannelData(ch);
            
            audioClips.forEach(clip => {
                const clipChans: Float32Array[] = [];
                for (let c = 0; c < clip.buffer.numberOfChannels; c++) {
                    clipChans.push(clip.buffer.getChannelData(c));
                }
                const srcChan = ch < clipChans.length ? ch : 0;
                const srcData = clipChans[srcChan];
                
                const clipStartSample = Math.round(clip.startOffset * sampleRate);
                const clipDurationSamples = Math.round(clip.playDuration * sampleRate);
                
                for (let s = 0; s < clipDurationSamples; s++) {
                    const outSampleIdx = clipStartSample + s;
                    if (outSampleIdx >= totalSamples) break;
                    
                    const timelineSec = outSampleIdx / sampleRate;
                    const elapsed = timelineSec - clip.startOffset;
                    const srcSec = clip.startTrim + elapsed * (clip.speed || 1.0);
                    const srcSampleIdx = Math.round(srcSec * clip.buffer.sampleRate);
                    
                    if (srcSampleIdx >= 0 && srcSampleIdx < srcData.length) {
                        outData[outSampleIdx] += srcData[srcSampleIdx] * clip.volume;
                    }
                }
            });
            
            for (let i = 0; i < totalSamples; i++) {
                outData[i] = Math.max(-1.0, Math.min(1.0, outData[i]));
            }
        }
        
        return outputBuffer;
    };

    const clipsDependencyKey = audioClips.map(c => `${c.id}_${c.startOffset}_${c.playDuration}_${c.volume}_${c.speed}`).join(',');

    useEffect(() => {
        if (audioClips.length === 0) {
            setAudioBuffer(null);
            setAudioFileName("");
        } else {
            try {
                const mixed = mixAllClipsToBuffer();
                if (mixed) {
                    setAudioBuffer(mixed);
                }
            } catch (e) {
                console.error("Error updating audioBuffer from clips:", e);
            }
        }
    }, [clipsDependencyKey, frames.length, playbackSpeed]);

    const activeAudioSourcesRef = useRef<{ source: AudioBufferSourceNode; gainNode: GainNode; clipId: string }[]>([]);

    const importAudioFile = async (e: React.ChangeEvent<HTMLInputElement> | File) => {
        const file = e instanceof File ? e : e.target.files?.[0];
        if (!file) return;
        setAudioFileName(file.name);
        
        try {
            if (!audioContextRef.current) {
                audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
            }
            
            const arrayBuffer = await file.arrayBuffer();
            const buffer = await audioContextRef.current.decodeAudioData(arrayBuffer);
            setAudioBuffer(buffer);
            
            const newClipId = Math.random().toString(36).substr(2, 9);
            const newClip: AudioClip = {
                id: newClipId,
                buffer: buffer,
                name: file.name,
                startOffset: 0,
                startTrim: 0,
                playDuration: buffer.duration,
                volume: 1.0,
                speed: 1.0
            };
            
            setAudioClips(prev => [...prev, newClip]);
            setSelectedClipId(newClipId);
            setAudioSpeed(1.0);
            
            setAudioPlayDuration(buffer.duration);
            setAudioStartTrim(0);
            setAudioStartOffset(0);
            setAudioVolume(1.0);
            setAudioModified(true);
        } catch (err) {
            console.error("Error importing audio:", err);
        }
    };

    const stopAudio = () => {
        activeAudioSourcesRef.current.forEach(item => {
            try {
                item.source.stop();
            } catch (e) {}
        });
        activeAudioSourcesRef.current = [];
    };

    const playAudioFrom = (startTime: number) => {
        if (audioClips.length === 0) return;
        if (!audioContextRef.current) {
            audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        }
        stopAudio();
        
        const ctx = audioContextRef.current;
        if (ctx.state === 'suspended') {
            ctx.resume().catch(() => {});
        }

        const loopDuration = frames.length / playbackSpeed;
        const normalizedStartTime = startTime % Math.max(0.1, loopDuration);

        audioClips.forEach(clip => {
            const clipEnd = clip.startOffset + clip.playDuration;
            
            if (clip.startOffset > normalizedStartTime) {
                const delay = clip.startOffset - normalizedStartTime;
                
                const source = ctx.createBufferSource();
                source.buffer = clip.buffer;
                source.playbackRate.value = clip.speed || 1.0;
                
                const gainNode = ctx.createGain();
                gainNode.gain.value = clip.volume;
                
                source.connect(gainNode);
                gainNode.connect(ctx.destination);
                
                const originalBufferDuration = clip.playDuration * (clip.speed || 1.0);
                source.start(ctx.currentTime + delay, clip.startTrim, originalBufferDuration);
                
                activeAudioSourcesRef.current.push({ source, gainNode, clipId: clip.id });
            } else if (normalizedStartTime >= clip.startOffset && normalizedStartTime < clipEnd) {
                const elapsed = normalizedStartTime - clip.startOffset;
                const sourceOffset = clip.startTrim + elapsed * (clip.speed || 1.0);
                const remainingTimelineDuration = clipEnd - normalizedStartTime;
                const remainingBufferDuration = remainingTimelineDuration * (clip.speed || 1.0);
                
                if (remainingBufferDuration > 0.01) {
                    const source = ctx.createBufferSource();
                    source.buffer = clip.buffer;
                    source.playbackRate.value = clip.speed || 1.0;
                    
                    const gainNode = ctx.createGain();
                    gainNode.gain.value = clip.volume;
                    
                    source.connect(gainNode);
                    gainNode.connect(ctx.destination);
                    
                    source.start(0, sourceOffset, remainingBufferDuration);
                    
                    activeAudioSourcesRef.current.push({ source, gainNode, clipId: clip.id });
                }
            }
        });
        
        audioStartTimeRef.current = ctx.currentTime;
        audioOffsetRef.current = normalizedStartTime;
    };

    const scrubAudio = (time: number) => {
        if (audioClips.length === 0) return;
        if (!audioContextRef.current) {
            audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        }
        if (isPlaying) return;
        stopAudio();
        
        const ctx = audioContextRef.current;
        if (ctx.state === 'suspended') {
            ctx.resume().catch(() => {});
        }
        
        const loopDuration = frames.length / playbackSpeed;
        const normalizedTime = time % Math.max(0.1, loopDuration);
        
        audioClips.forEach(clip => {
            const clipEnd = clip.startOffset + clip.playDuration;
            if (normalizedTime >= clip.startOffset && normalizedTime < clipEnd) {
                const elapsed = normalizedTime - clip.startOffset;
                const sourceOffset = clip.startTrim + elapsed * (clip.speed || 1.0);
                
                const source = ctx.createBufferSource();
                source.buffer = clip.buffer;
                source.playbackRate.value = clip.speed || 1.0;
                
                const gainNode = ctx.createGain();
                gainNode.gain.value = clip.volume * 0.3;
                
                source.connect(gainNode);
                gainNode.connect(ctx.destination);
                
                const previewDuration = Math.min(0.2, (clipEnd - normalizedTime) * (clip.speed || 1.0));
                if (previewDuration > 0.01) {
                    source.start(0, sourceOffset, previewDuration);
                    
                    const now = ctx.currentTime;
                    gainNode.gain.setValueAtTime(clip.volume * 0.3, now);
                    gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
                    
                    setTimeout(() => {
                        try {
                            source.stop();
                        } catch (e) {}
                    }, 250);
                }
            }
        });
    };

    // Custom Canvas Inputs
    const [customWidth, setCustomWidth] = useState(canvasSize.width);
    const [customHeight, setCustomHeight] = useState(canvasSize.height);

    // Drawing Refs for Engine (Interpolation)
    const pointsRef = useRef<{x: number, y: number}[]>([]);
    const lastPosRef = useRef<{x: number, y: number} | null>(null);
    const accumulatedDistRef = useRef(0);
    const strokeTargetRectRef = useRef<{ left: number, top: number, width: number, height: number } | null>(null);
    const containerRectRef = useRef<DOMRect | null>(null);
    const drawingSessionCacheRef = useRef<{ cx: number, cy: number, W: number, H: number } | null>(null);

    const [undoStack, setUndoStack] = useState<FrameData[][]>([]);
    const [redoStack, setRedoStack] = useState<FrameData[][]>([]);
    
    // Tools
    const previousBrushRef = useRef<BrushPreset | null>(null);

    // --- INITIALIZATION ---
    const isInitializedRef = useRef(false);
    useEffect(() => {
        if (isInitializedRef.current) return;
        
        if (frames.length === 0) {
            const initialLayer: FrameLayer = { id: `layer_${Date.now()}`, name: 'Layer 1', dataUri: '', visible: true, opacity: 1 };
            setFrames([{ id: `frm_${Date.now()}`, dataUri: '', layers: [initialLayer] }]);
            setActiveLayerId(initialLayer.id);
            isInitializedRef.current = true;
        } else {
            const currentFrame = frames[currentFrameIndex];
            if (!currentFrame.layers || currentFrame.layers.length === 0) {
                const migratedLayer: FrameLayer = { 
                    id: `layer_${Date.now()}`, 
                    name: 'Layer 1', 
                    dataUri: currentFrame.dataUri || '', 
                    visible: true, 
                    opacity: 1 
                };
                updateFrameLayers(currentFrameIndex, [migratedLayer]);
                setActiveLayerId(migratedLayer.id);
                isInitializedRef.current = true;
            } else if (!activeLayerId) {
                setActiveLayerId(currentFrame.layers[0].id);
                isInitializedRef.current = true;
            } else {
                isInitializedRef.current = true;
            }
        }
    }, [frames, currentFrameIndex, activeLayerId]);

    const getCurrentFrame = () => frames[currentFrameIndex] || { id: 'dummy', dataUri: '', layers: [] };
    const getActiveLayer = () => {
        const frame = getCurrentFrame();
        const layer = frame.layers?.find(l => l.id === activeLayerId);
        if (layer) return layer;
        
        // Robust fallback: if ID mismatch (e.g. just switched frames but ID hasn't synced yet)
        const prevLayer = framesRef.current.flatMap(f => f.layers || []).find(l => l.id === activeLayerId);
        if (prevLayer) {
            const matching = frame.layers?.find(l => l.name === prevLayer.name);
            if (matching) return matching;
        }
        
        return frame.layers?.[0] || null;
    };

    // --- TEXTURE GENERATION ---
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.code === 'Space' && e.target === document.body) {
                isSpaceDownRef.current = true;
                e.preventDefault(); // Prevent page scroll
            }
        };
        const handleKeyUp = (e: KeyboardEvent) => {
            if (e.code === 'Space') {
                isSpaceDownRef.current = false;
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
        };
    }, []);

    useEffect(() => {
        const noiseCanvas = document.createElement('canvas');
        noiseCanvas.width = 64;
        noiseCanvas.height = 64;
        const ctx = noiseCanvas.getContext('2d');
        if (ctx) {
            const imgData = ctx.createImageData(64, 64);
            for (let i = 0; i < imgData.data.length; i += 4) {
                const alpha = Math.random() * 200; 
                imgData.data[i] = 0;
                imgData.data[i+1] = 0;
                imgData.data[i+2] = 0;
                imgData.data[i+3] = alpha;
            }
            ctx.putImageData(imgData, 0, 0);
        }
    }, []);

    const getTexture = (ctx: CanvasRenderingContext2D) => {
        if (!texturePatternRef.current) {
            const noiseCanvas = document.createElement('canvas');
            noiseCanvas.width = 64; noiseCanvas.height = 64;
            const nCtx = noiseCanvas.getContext('2d');
            if (nCtx) {
                const imgData = nCtx.createImageData(64, 64);
                for (let i = 0; i < imgData.data.length; i += 4) {
                    const val = Math.random() * 255;
                    imgData.data[i] = val; imgData.data[i+1] = val; imgData.data[i+2] = val; imgData.data[i+3] = 120;
                }
                nCtx.putImageData(imgData, 0, 0);
                texturePatternRef.current = ctx.createPattern(noiseCanvas, 'repeat');
            }
        }
        return texturePatternRef.current;
    };

    // --- CANVAS MANAGEMENT & GESTURES ---

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        let isPanning = false;
        let lastPanX = 0;
        let lastPanY = 0;
        let initialPinchDist = 0;
        let initialPinchScale = 1;
        let lastPinchAngle = 0;

        const handleWheel = (e: WheelEvent) => {
            if (isDrawingRef.current) {
                // Prevent drawing jargons if user zooms/pans with wheel while drawing
                setIsDrawing(false);
                isDrawingRef.current = false;
                pointsRef.current = [];
                lastPosRef.current = null;
            }

            if (e.ctrlKey || e.metaKey) {
                // Zoom
                e.preventDefault();
                const zoomFactor = -e.deltaY * 0.01;
                const prev = canvasTransformRef.current;
                const targetScale = Math.max(0.1, Math.min(10, prev.scale + zoomFactor));
                
                const rect = containerRectRef.current || (containerRectRef.current = container.getBoundingClientRect());
                const mouseX = e.clientX - rect.left;
                const mouseY = e.clientY - rect.top;
                
                const scaleRatio = targetScale / prev.scale;
                const OriginX = rect.width / 2;
                const OriginY = rect.height / 2;
                const newX = mouseX - OriginX - (mouseX - OriginX - prev.x) * scaleRatio;
                const newY = mouseY - OriginY - (mouseY - OriginY - prev.y) * scaleRatio;

                applyTransform(newX, newY, targetScale, prev.rotation);
            } else if (e.altKey) {
                // Rotate
                e.preventDefault();
                const rotFactor = e.deltaY * 0.5;
                const prev = canvasTransformRef.current;
                applyTransform(prev.x, prev.y, prev.scale, prev.rotation + rotFactor);
            } else {
                // Pan
                const prev = canvasTransformRef.current;
                // If shiftKey is pressed, we scroll horizontally for deltaY
                const panX = e.shiftKey ? e.deltaY : e.deltaX;
                const panY = e.shiftKey ? e.deltaX : e.deltaY;
                applyTransform(prev.x - panX, prev.y - panY, prev.scale, prev.rotation);
            }
        };

        const handleTouchStart = (e: TouchEvent) => {
            if (e.touches.length === 2 && !isDrawing) {
                isPanning = true;
                const dx = e.touches[0].clientX - e.touches[1].clientX;
                const dy = e.touches[0].clientY - e.touches[1].clientY;
                initialPinchDist = Math.hypot(dx, dy);
                initialPinchScale = canvasTransformRef.current.scale;
                lastPinchAngle = Math.atan2(dy, dx);
                lastPanX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
                lastPanY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
            } else if (e.touches.length === 3) {
                // Reset on 3 fingers
                applyTransform(0, 0, 1, 0);
            }
        };

        const handleTouchMove = (e: TouchEvent) => {
            if (isPanning && e.touches.length === 2) {
                e.preventDefault();
                const dx = e.touches[0].clientX - e.touches[1].clientX;
                const dy = e.touches[0].clientY - e.touches[1].clientY;
                const dist = Math.hypot(dx, dy);
                const angle = Math.atan2(dy, dx);

                const currentX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
                const currentY = (e.touches[0].clientY + e.touches[1].clientY) / 2;

                const panX = currentX - lastPanX;
                const panY = currentY - lastPanY;

                lastPanX = currentX;
                lastPanY = currentY;

                const prev = canvasTransformRef.current;
                let angleDiff = angle - lastPinchAngle;
                if (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
                if (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
                
                const newRotation = prev.rotation + (angleDiff * 180 / Math.PI);
                lastPinchAngle = angle;

                const targetScale = Math.max(0.1, Math.min(10, initialPinchScale * (dist / initialPinchDist)));
                const scaleRatio = targetScale / prev.scale;
                
                const rect = container.getBoundingClientRect();
                const mouseX = currentX - rect.left;
                const mouseY = currentY - rect.top;

                const OriginX = rect.width / 2;
                const OriginY = rect.height / 2;

                const newX = mouseX - OriginX - (mouseX - OriginX - (prev.x + panX)) * scaleRatio;
                const newY = mouseY - OriginY - (mouseY - OriginY - (prev.y + panY)) * scaleRatio;

                applyTransform(
                    newX, 
                    newY, 
                    targetScale,
                    newRotation
                );
            }
        };

        const handleTouchEnd = (e: TouchEvent) => {
            if (e.touches.length < 2) {
                isPanning = false;
            }
        };

        container.addEventListener('wheel', handleWheel, { passive: false });
        container.addEventListener('touchstart', handleTouchStart, { passive: false });
        container.addEventListener('touchmove', handleTouchMove, { passive: false });
        container.addEventListener('touchend', handleTouchEnd);

        return () => {
            container.removeEventListener('wheel', handleWheel);
            container.removeEventListener('touchstart', handleTouchStart);
            container.removeEventListener('touchmove', handleTouchMove);
            container.removeEventListener('touchend', handleTouchEnd);
        };
    }, [isDrawing]); 

    // --- EFFECT: SYNC ACTIVE LAYER ID ACROSS FRAMES ---
    // When switching frames, we want the "active layer" to stay consistent 
    // by matching the layer name, since layer IDs are unique per frame.
    useEffect(() => {
        const currentFrame = frames[currentFrameIndex];
        if (!currentFrame || !currentFrame.layers) return;

        // Try to find a layer in the new frame with the same name as the previously active one
        const prevLayer = frames.flatMap(f => f.layers || []).find(l => l.id === activeLayerId);
        
        if (prevLayer) {
            const matchingLayer = currentFrame.layers.find(l => l.name === prevLayer.name);
            if (matchingLayer && matchingLayer.id !== activeLayerId) {
                setActiveLayerId(matchingLayer.id);
            } else if (!matchingLayer && currentFrame.layers.length > 0) {
                // If no name match, fallback to the first layer of the frame
                const alreadySelected = currentFrame.layers.some(l => l.id === activeLayerId);
                if (!alreadySelected) {
                    setActiveLayerId(currentFrame.layers[0].id);
                }
            }
        } else if (currentFrame.layers.length > 0) {
            // Initial selection
            setActiveLayerId(currentFrame.layers[0].id);
        }
    }, [currentFrameIndex, frames]);

    const loadActiveLayerToCanvas = useCallback(() => {
        if (isRiggingMode || isPlaying || isTransforming || isDrawingRef.current) return; // Don't overwrite if drawing is in progress

        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (!canvas || !ctx) return;

        if (canvas.width !== canvasSize.width || canvas.height !== canvasSize.height) {
            canvas.width = canvasSize.width;
            canvas.height = canvasSize.height;
            if (previewCanvasRef.current) {
                previewCanvasRef.current.width = canvasSize.width;
                previewCanvasRef.current.height = canvasSize.height;
            }
            canvasRenderedDataUriRef.current = null; // Forces redraw if size changes
        }

        const layer = getActiveLayer();
        const bonesHash = layer?.bones ? JSON.stringify(layer.bones) + JSON.stringify(layer.boneTransforms || {}) : '';
        const currentRenderKey = `${layer?.dataUri}_${bonesHash}`;

        if (currentRenderKey === canvasRenderedDataUriRef.current) {
            return; // Canvas already reflects this layer and its rig state
        }

        if (layer && layer.dataUri) {
            canvasRenderedDataUriRef.current = currentRenderKey;
            
            const drawImgOnCanvas = (img: HTMLImageElement) => {
                if (isDrawingRef.current) return; 
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                if (layer.bones && layer.bones.length > 0) {
                     // Since LayerRenderer is drawing the warped image using PuppetWarp (with proper margins/padding),
                     // we clear canvasRef to avoid double-rendering or misalignment/clipping.
                     // The drawing canvas remains blank so the user can see the PuppetWarp rendering perfectly.
                } else {
                     ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                }
            };

            if (EDITOR_IMAGE_CACHE.has(layer.dataUri)) {
                const cached = EDITOR_IMAGE_CACHE.get(layer.dataUri)!;
                if (cached.complete) {
                    drawImgOnCanvas(cached);
                    return;
                }
            }

            const img = new Image();
            img.onload = () => {
                if (EDITOR_IMAGE_CACHE.size > 150) {
                    const firstKey = EDITOR_IMAGE_CACHE.keys().next().value;
                    if (firstKey) EDITOR_IMAGE_CACHE.delete(firstKey);
                }
                EDITOR_IMAGE_CACHE.set(layer.dataUri!, img);
                drawImgOnCanvas(img);
            };
            img.src = layer.dataUri;
        } else {
            // No layer or no data, just clear
            canvasRenderedDataUriRef.current = currentRenderKey;
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
    }, [frames, currentFrameIndex, activeLayerId, canvasSize, isRiggingMode, isPlaying, isTransforming]);

    const thumbnailTimeoutRef = useRef<number | null>(null);

    const updateFrameThumbnail = useCallback(() => {
        const frameIdx = currentFrameIndexRef.current;
        const frame = framesRef.current[frameIdx];
        if (!frame || !frame.layers) return;
        const targetFrameId = frame.id;
        
        const layers = frame.layers.filter(l => l.visible);
        if (layers.length === 0) {
            setFrames(prev => prev.map(f => f.id === targetFrameId ? { ...f, dataUri: '' } : f));
            return;
        }

        // Optimized stacking: Load all images first, then draw in sequence using cache lookup
        const loadImages = layers.map(l => {
            if (!l.dataUri) return Promise.resolve({ layer: l, img: null });
            
            if (EDITOR_IMAGE_CACHE.has(l.dataUri)) {
                const img = EDITOR_IMAGE_CACHE.get(l.dataUri)!;
                if (img.complete) {
                    return Promise.resolve({ layer: l, img });
                }
            }
            
            return new Promise<{ layer: FrameLayer, img: HTMLImageElement | null }>((resolve) => {
                const img = new Image();
                img.onload = () => {
                    if (EDITOR_IMAGE_CACHE.size > 150) {
                        const firstKey = EDITOR_IMAGE_CACHE.keys().next().value;
                        if (firstKey) EDITOR_IMAGE_CACHE.delete(firstKey);
                    }
                    EDITOR_IMAGE_CACHE.set(l.dataUri!, img);
                    resolve({ layer: l, img });
                };
                img.onerror = () => resolve({ layer: l, img: null });
                img.src = l.dataUri!;
            });
        });

        Promise.all(loadImages).then(loadedLayerItems => {
            const canvas = document.createElement('canvas');
            const s = 160 / Math.max(canvasSize.width, canvasSize.height);
            canvas.width = Math.max(1, canvasSize.width * s);
            canvas.height = Math.max(1, canvasSize.height * s);
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (!ctx) return;

            if (canvasBgColor !== 'transparent') {
                ctx.fillStyle = canvasBgColor;
                ctx.fillRect(0, 0, canvas.width, canvas.height);
            } else {
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
            }

            loadedLayerItems.forEach(({ layer, img }) => {
                if (!img) return;
                ctx.globalAlpha = layer.opacity;
                if (layer.bones && layer.bones.length > 0) {
                    ctx.save();
                    ctx.scale(s, s);
                    drawWarpedImage(ctx, img, canvasSize.width, canvasSize.height, layer.bones, layer.boneTransforms || {}, layer.rigType || 'MESH');
                    ctx.restore();
                } else {
                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                }
            });

            const newDataUri = canvas.toDataURL('image/webp', 0.5);
            setFrames(prev => prev.map(f => f.id === targetFrameId ? { ...f, dataUri: newDataUri } : f));
        });
    }, [canvasSize, canvasBgColor]);

    const activeLayerIdRef = useRef(activeLayerId);
    const hasUnsavedStrokesRef = useRef(false);
    
    useEffect(() => { activeLayerIdRef.current = activeLayerId; }, [activeLayerId]);

    useEffect(() => {
        if (vocalTrack?.buffer && audioClips.length === 0) {
            setAudioBuffer(vocalTrack.buffer);
            setAudioFileName(vocalTrack.name || "imported_track.wav");
            setAudioPlayDuration(vocalTrack.buffer.duration);
            setAudioStartTrim(0);
            setAudioStartOffset(0);
            setAudioVolume(1.0);
            
            const newClipId = "init-vocal";
            setAudioClips([{
                id: newClipId,
                buffer: vocalTrack.buffer,
                name: vocalTrack.name || "imported_track.wav",
                startOffset: 0,
                startTrim: 0,
                playDuration: vocalTrack.buffer.duration,
                volume: 1.0,
                speed: 1.0
            }]);
            setSelectedClipId(newClipId);
        } else if (instTrack?.buffer && audioClips.length === 0) {
            setAudioBuffer(instTrack.buffer);
            setAudioFileName(instTrack.name || "instrumental_track.wav");
            setAudioPlayDuration(instTrack.buffer.duration);
            setAudioStartTrim(0);
            setAudioStartOffset(0);
            setAudioVolume(1.0);
            
            const newClipId = "init-inst";
            setAudioClips([{
                id: newClipId,
                buffer: instTrack.buffer,
                name: instTrack.name || "instrumental_track.wav",
                startOffset: 0,
                startTrim: 0,
                playDuration: instTrack.buffer.duration,
                volume: 1.0,
                speed: 1.0
            }]);
            setSelectedClipId(newClipId);
        }
    }, [vocalTrack, instTrack]);

    const saveActiveLayer = () => {
        const canvas = canvasRef.current;
        if (!canvas || !activeLayerId || isPlaying) return null;
        
        const frameIdx = currentFrameIndexRef.current;
        const currentFrame = framesRef.current[frameIdx];
        if (!currentFrame) return null;

        const currentDataUri = currentFrame.layers?.find(l => l.id === activeLayerId)?.dataUri || null;

        if (!hasUnsavedStrokesRef.current) {
            return currentDataUri; // Skip expensive serialization if no strokes occurred!
        }

        // Fast serialization using png for reliable alpha transparency
        const newDataUri = canvas.toDataURL('image/png');
        hasUnsavedStrokesRef.current = false;
        
        // Update the render key so loadActiveLayerToCanvas knows it is already up to date
        // Note: we clear bones on save in line 824 which matches the empty bonesHash in loadActiveLayerToCanvas
        canvasRenderedDataUriRef.current = `${newDataUri}_`;

        // Optimized Undo: store via pushToUndoHistory
        pushToUndoHistory(framesRef.current);
        
        setFrames(prev => {
            const newFrames = [...prev];
            const frame = {...newFrames[frameIdx]};
            
            const newLayers = frame.layers?.map(l => (l.id === activeLayerId) ? 
                { ...l, dataUri: newDataUri } : l
            ) || [];
            
            frame.layers = newLayers;
            newFrames[frameIdx] = frame;
            return newFrames;
        });

        // Trigger thumbnail update on next available frame to avoid stuttering the pointer release
        if (thumbnailTimeoutRef.current) cancelAnimationFrame(thumbnailTimeoutRef.current);
        thumbnailTimeoutRef.current = requestAnimationFrame(updateFrameThumbnail);
        return newDataUri;
    };

    const pushToUndoHistory = (framesToSave: FrameData[] = frames) => {
        setUndoStack(prev => {
            const next = [...prev, safeDeepClone(framesToSave)];
            if (next.length > 50) next.shift(); // Keep last 50 states
            return next;
        });
        setRedoStack([]); // Clear redo stack on new action
    };

    const handleUndo = () => {
        if (undoStack.length === 0) return;
        saveActiveLayer(); // Flush any pending strokes first
        
        const lastState = undoStack[undoStack.length - 1];
        setUndoStack(prev => prev.slice(0, -1));
        
        setRedoStack(prev => [...prev, safeDeepClone(frames)]);
        setFrames(lastState);
        
        // Ensure index doesn't go out of bounds
        if (currentFrameIndex >= lastState.length) {
            setCurrentFrameIndex(lastState.length - 1);
        }
        setTimeout(updateFrameThumbnail, 100);
    };

    const handleRedo = () => {
        if (redoStack.length === 0) return;
        
        const nextState = redoStack[redoStack.length - 1];
        setRedoStack(prev => prev.slice(0, -1));
        
        setUndoStack(prev => [...prev, safeDeepClone(frames)]);
        setFrames(nextState);
        
        if (currentFrameIndex >= nextState.length) {
            setCurrentFrameIndex(nextState.length - 1);
        }
        setTimeout(updateFrameThumbnail, 100);
    };

    const updateFrameLayerOpacity = (layerId: string, opacity: number, skipUndo = false) => {
        if (!skipUndo) pushToUndoHistory(framesRef.current);
        setFrames(prev => {
            const next = [...prev];
            const frameIdx = currentFrameIndexRef.current;
            if (next[frameIdx] && next[frameIdx].layers) {
                const newLayers = next[frameIdx].layers!.map(l => l.id === layerId ? { ...l, opacity } : l);
                next[frameIdx] = { ...next[frameIdx], layers: newLayers };
            }
            return next;
        });
    };

    const updateFrameLayers = (frameIdx: number, newLayers: FrameLayer[], skipUndo = false) => {
        if (!skipUndo) pushToUndoHistory(framesRef.current);
        setFrames(prev => {
            const next = [...prev];
            if (next[frameIdx]) {
                next[frameIdx] = { ...next[frameIdx], layers: newLayers };
            }
            return next;
        });
    };

    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        if (isPlaying) return; // Prevent heavy re-renders during playback loop
        loadActiveLayerToCanvas();
    }, [currentFrameIndex, activeLayerId, canvasSize, loadActiveLayerToCanvas, isRiggingMode, isPlaying]); 

    const handleSave = async () => {
        if (isSaving) return;
        setIsSaving(true);
        let thumbStr = "";
        let audioData = undefined;
        let extraSettings = {
            brushSettings: {
                size: activeBrush.size,
                opacity: activeBrush.opacity,
                hardness: activeBrush.hardness
            },
            smoothing,
            onionSkinSettings,
            fps: playbackSpeed
        };

        try {
            const firstFrame = frames[0];
            if (firstFrame && firstFrame.layers) {
                const tempCanvas = document.createElement('canvas');
                tempCanvas.width = canvasSize.width;
                tempCanvas.height = canvasSize.height;
                const tempCtx = tempCanvas.getContext('2d');
                if (tempCtx) {
                    if (!isCanvasTransparent) {
                        tempCtx.fillStyle = canvasBgColor !== 'transparent' ? canvasBgColor : '#ffffff';
                        tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
                    }
                    for (const layer of firstFrame.layers) {
                        if (!layer.visible || !layer.dataUri) continue;
                        await new Promise<void>((resolve) => {
                            let isResolved = false;
                            const timeout = setTimeout(() => {
                                if (!isResolved) {
                                    isResolved = true;
                                    resolve();
                                }
                            }, 500);

                            const img = new Image();
                            img.onload = () => {
                                if (isResolved) return;
                                isResolved = true;
                                clearTimeout(timeout);
                                tempCtx.globalAlpha = layer.opacity !== undefined ? layer.opacity : 1;
                                if (layer.bones && layer.bones.length > 0) {
                                    drawWarpedImage(tempCtx, img, tempCanvas.width, tempCanvas.height, layer.bones, layer.boneTransforms || {}, layer.rigType || 'MESH');
                                } else {
                                    tempCtx.drawImage(img, 0, 0);
                                }
                                resolve();
                            };
                            img.onerror = () => {
                                if (isResolved) return;
                                isResolved = true;
                                clearTimeout(timeout);
                                resolve();
                            };
                            img.src = layer.dataUri as string;
                        });
                    }
                    thumbStr = tempCanvas.toDataURL('image/jpeg', 0.8);
                }
            }

            if (audioClips.length > 0 && audioModified) {
                try {
                    const mixed = mixAllClipsToBuffer();
                    if (mixed) {
                        const url = await audioBufferToWavBase64(mixed);
                        audioData = { url, name: audioFileName || 'frame_audio.wav' };
                    }
                } catch (e) {
                    console.error("Failed to convert frame audio to base64", e);
                }
            }
        } catch (e) {
            console.warn("Generating save data failed", e);
        } finally {
            try {
                onSave(thumbStr, audioData, extraSettings);
            } catch (e) {}
            onBack();
        }
    };

    const handleCanvasSizeChange = async (newW: number, newH: number) => {
        const oldW = canvasSize.width;
        const oldH = canvasSize.height;
        const dx = (newW - oldW) / 2;
        const dy = (newH - oldH) / 2;

        const resizedFrames = await Promise.all(frames.map(async (frame) => {
            const resizedLayers = await Promise.all((frame.layers || []).map(async (layer) => {
                const newBones = layer.bones?.map(b => ({
                    ...b, 
                    startX: b.startX + dx, startY: b.startY + dy,
                    endX: b.endX + dx, endY: b.endY + dy
                }));
                
                if (!layer.dataUri) return { ...layer, bones: newBones };
                return new Promise<FrameLayer>((resolve) => {
                    const img = new Image();
                    img.onload = () => {
                        const c = document.createElement('canvas');
                        c.width = newW;
                        c.height = newH;
                        const ctx = c.getContext('2d');
                        if (ctx) {
                            const imgDx = (newW - img.naturalWidth) / 2;
                            const imgDy = (newH - img.naturalHeight) / 2;
                            ctx.drawImage(img, imgDx, imgDy);
                        }
                        resolve({ ...layer, dataUri: c.toDataURL(), bones: newBones });
                    };
                    img.onerror = () => resolve({ ...layer, bones: newBones });
                    img.src = layer.dataUri;
                });
            }));
            
            let newThumbnail = frame.dataUri;
            if (frame.dataUri) {
                newThumbnail = await new Promise<string>((resolve) => {
                    const img = new Image();
                    img.onload = () => {
                        const c = document.createElement('canvas');
                        c.width = newW; c.height = newH;
                        const ctx = c.getContext('2d');
                        if (ctx) {
                            const imgDx = (newW - img.naturalWidth) / 2;
                            const imgDy = (newH - img.naturalHeight) / 2;
                            ctx.drawImage(img, imgDx, imgDy);
                        }
                        resolve(c.toDataURL());
                    };
                    img.onerror = () => resolve(frame.dataUri || '');
                    img.src = frame.dataUri;
                });
            }
            
            return { ...frame, layers: resizedLayers, dataUri: newThumbnail };
        }));

        pushToUndoHistory(framesRef.current);
        setFrames(resizedFrames);
        setCanvasSize({ width: newW, height: newH });
        setCustomWidth(newW);
        setCustomHeight(newH);
    };

    // --- FLOOD FILL TOOL ---
    const floodFill = (startX: number, startY: number, fColor: string) => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d', { willReadFrequently: true });
        if (!canvas || !ctx) return;

        const w = canvas.width;
        const h = canvas.height;
        
        const imageData = ctx.getImageData(0, 0, w, h);
        const data = imageData.data;

        const r = parseInt(fColor.slice(1, 3), 16);
        const g = parseInt(fColor.slice(3, 5), 16);
        const b = parseInt(fColor.slice(5, 7), 16);
        const a = 255; 

        const startPos = (startY * w + startX) * 4;
        const startR = data[startPos];
        const startG = data[startPos + 1];
        const startB = data[startPos + 2];
        const startA = data[startPos + 3];

        if (startR === r && startG === g && startB === b && startA === a) return;

        const isTransparentFill = startA < 50;

        const match = (pos: number) => {
            if (isTransparentFill) {
                // If the user clicked in a transparent/semi-transparent area (background removed)
                // We match pixels that are transparent/semi-transparent and not solid line art
                const alpha = data[pos + 3];
                if (alpha < 75) {
                    return true;
                }
                // Also match very light pixels (light paper texture, faint gray background artifacts)
                const rVal = data[pos];
                const gVal = data[pos + 1];
                const bVal = data[pos + 2];
                const brightness = (rVal * 299 + gVal * 587 + bVal * 114) / 1000;
                return brightness > 210;
            } else {
                // High-tolerance color match for opaque background/textured areas
                const dr = data[pos] - startR;
                const dg = data[pos + 1] - startG;
                const db = data[pos + 2] - startB;
                const da = data[pos + 3] - startA;
                return (dr*dr + dg*dg + db*db + da*da) < 3600; 
            }
        };

        const filled = new Uint8Array(w * h);
        const colorPixel = (pos: number, idx: number) => {
            data[pos] = r; 
            data[pos + 1] = g; 
            data[pos + 2] = b; 
            data[pos + 3] = a;
            filled[idx] = 1;
        };

        const stack: [number, number][] = [[startX, startY]];
        while (stack.length) {
            const pop = stack.pop();
            if (!pop) continue;
            let x = pop[0];
            let y = pop[1];
            
            let pixelPos = (y * w + x) * 4;
            let idx = y * w + x;
            while (y >= 0 && match(pixelPos)) { 
                y--; 
                pixelPos -= w * 4; 
                idx -= w;
            }
            pixelPos += w * 4; 
            y++;
            idx += w;
            
            let reachLeft = false; let reachRight = false;
            while (y < h && match(pixelPos)) {
                colorPixel(pixelPos, idx);
                if (x > 0) {
                    if (match(pixelPos - 4)) { 
                        if (!reachLeft) { 
                            stack.push([x - 1, y]); 
                            reachLeft = true; 
                        } 
                    } 
                    else if (reachLeft) { 
                        reachLeft = false; 
                    }
                }
                if (x < w - 1) {
                    if (match(pixelPos + 4)) { 
                        if (!reachRight) { 
                            stack.push([x + 1, y]); 
                            reachRight = true; 
                        } 
                    } 
                    else if (reachRight) { 
                        reachRight = false; 
                    }
                }
                y++; 
                pixelPos += w * 4;
                idx += w;
            }
        }

        // --- LINE ART HALO ELIMINATION DILATION PASS ---
        // We expand the filled region by 1-2 pixels to tuck the fill perfectly underneath the lines,
        // while preserving any solid opaque line art.
        const isSolidLine = (pos: number) => {
            const alpha = data[pos + 3];
            if (alpha > 150) {
                const dr = data[pos] - r;
                const dg = data[pos + 1] - g;
                const db = data[pos + 2] - b;
                return (dr*dr + dg*dg + db*db) > 2500; // distinct from fill color
            }
            return false;
        };

        const dilatePass = (pixelsToDilate: Set<number>, targetAlpha: number) => {
            const nextDilated = new Set<number>();
            for (const idx of pixelsToDilate) {
                const x = idx % w;
                const y = Math.floor(idx / w);
                
                const neighbors = [
                    [x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]
                ];
                
                for (const [nx, ny] of neighbors) {
                    if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
                        const nIdx = ny * w + nx;
                        if (filled[nIdx] === 0) {
                            const dIdx = nIdx * 4;
                            if (!isSolidLine(dIdx)) {
                                data[dIdx] = r;
                                data[dIdx + 1] = g;
                                data[dIdx + 2] = b;
                                data[dIdx + 3] = Math.max(data[dIdx + 3], targetAlpha);
                                filled[nIdx] = 1;
                                nextDilated.add(nIdx);
                            }
                        }
                    }
                }
            }
            return nextDilated;
        };

        const initialDilateSet = new Set<number>();
        for (let i = 0; i < w * h; i++) {
            if (filled[i]) {
                initialDilateSet.add(i);
            }
        }
        
        // Run a 2-pixel dilation to ensure completely gap-free fill underneath line art transitions
        const dilated1 = dilatePass(initialDilateSet, a);
        dilatePass(dilated1, a);

        ctx.putImageData(imageData, 0, 0);
        saveActiveLayer();
    };

    // --- SMOOTH DRAWING ENGINE ---

    const [showAudioImportManager, setShowAudioImportManager] = useState(false);

    const pickStageColor = (x: number, y: number) => {
        const frame = getCurrentFrame();
        if (!frame || !frame.dataUri) return;
        
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
            const c = document.createElement('canvas');
            c.width = canvasSize.width;
            c.height = canvasSize.height;
            const ctx = c.getContext('2d');
            if (ctx) {
                // Background
                ctx.fillStyle = canvasBgColor !== 'transparent' ? canvasBgColor : '#ffffff';
                if (!isCanvasTransparent) ctx.fillRect(0, 0, c.width, c.height);
                
                ctx.drawImage(img, 0, 0, c.width, c.height);
                
                const pixel = ctx.getImageData(x, y, 1, 1).data;
                const r = pixel[0].toString(16).padStart(2, '0');
                const g = pixel[1].toString(16).padStart(2, '0');
                const b = pixel[2].toString(16).padStart(2, '0');
                setCurrentColor(`#${r}${g}${b}`);
            }
        };
        img.src = frame.dataUri;
    };

    const getPointerPos = (e: React.PointerEvent | PointerEvent) => {
        const canvas = canvasRef.current;
        const wrapper = canvasWrapperRef.current;
        if (!canvas || !wrapper) return { x: 0, y: 0 };

        const clientX = (e as any).clientX;
        const clientY = (e as any).clientY;

        const parent = wrapper.parentElement;
        if (!parent) return { x: 0, y: 0 };

        const vRect = parent.getBoundingClientRect();
        const layoutW = wrapper.clientWidth || canvasSize.width;
        const layoutH = wrapper.clientHeight || canvasSize.height;

        const centerX = vRect.left + vRect.width / 2;
        const centerY = vRect.top + vRect.height / 2;

        const tx = canvasTransformRef.current.x;
        const ty = canvasTransformRef.current.y;
        const visualCenterX = centerX + tx;
        const visualCenterY = centerY + ty;

        const dx = clientX - visualCenterX;
        const dy = clientY - visualCenterY;

        const rad = -canvasTransformRef.current.rotation * Math.PI / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        const rotatedDx = dx * cos - dy * sin;
        const rotatedDy = dx * sin + dy * cos;

        const s = canvasTransformRef.current.scale || 1;
        const unscaledDx = rotatedDx / s;
        const unscaledDy = rotatedDy / s;

        const localX = unscaledDx + layoutW / 2;
        const localY = unscaledDy + layoutH / 2;

        const x = (localX / layoutW) * canvasSize.width;
        const y = (localY / layoutH) * canvasSize.height;

        return { x, y };
    };

    const cachedGradientRef = useRef<{ id: string, color: string, size: number, gradient: CanvasGradient } | null>(null);

    const importImageFromDataUri = async (dataUri: string) => {
        try {
            // Enter interactive transform mode with trimmed image centered perfectly
            const { trimmedDataUri, width: trimmedW, height: trimmedH, x: trimmedX, y: trimmedY } = await trimImage(dataUri);
            
            // Keep full original scale as requested ("the image scaling should not be scaled down. The image should be imported properly.")
            const fitScale = 1.0; 
            
            // Center the visible (trimmed) box on the canvas
            const targetX = (canvasSize.width - trimmedW * fitScale) / 2;
            const targetY = (canvasSize.height - trimmedH * fitScale) / 2;

            setIsLassoExtraction(false);
            isImportModeRef.current = true; // Mark as import so confirmTransform creates a new layer
            setTransformImageUri(trimmedDataUri);
            setTransformNaturalSize({ width: trimmedW, height: trimmedH });
            setTransformState({
                x: targetX,
                y: targetY,
                scale: fitScale,
                scaleX: 1,
                scaleY: 1,
                rotation: 0,
                flipX: false,
                flipY: false,
                originX: 50,
                originY: 50
            });
            setIsTransforming(true);
        } catch (err) {
            console.error("Failed to import image", err);
        }
    };

    const importImageFile = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (event) => {
            const dataUri = event.target?.result as string;
            await importImageFromDataUri(dataUri);
        };
        reader.readAsDataURL(file);
    };

    const confirmTransform = () => {
        if (!transformImageUri) return;
        
        const canvas = document.createElement('canvas');
        canvas.width = canvasSize.width;
        canvas.height = canvasSize.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const currentLayer = getCurrentFrame().layers?.find(l => l.id === activeLayerId);
        
        const cutoutImg = new Image();
        cutoutImg.onload = () => {
            const isExistingLayer = (getCurrentFrame().layers || []).some(l => l.id === activeLayerId);
            
            if (isExistingLayer && currentLayer && currentLayer.dataUri && isLassoExtraction) {
                const baseImg = new Image();
                baseImg.onload = () => {
                    ctx.drawImage(baseImg, 0, 0, canvas.width, canvas.height);
                    renderTransformedPart(false);
                };
                baseImg.src = currentLayer.dataUri;
            } else {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                renderTransformedPart(isImportModeRef.current);
            }
        };
        cutoutImg.src = transformImageUri;

        function renderTransformedPart(createNewLayerForce: boolean = false) {
            if (!ctx) return;
            ctx.save();
            
            const px = transformState.x + (transformState.originX / 100) * (transformNaturalSize.width * transformState.scale * transformState.scaleX);
            const py = transformState.y + (transformState.originY / 100) * (transformNaturalSize.height * transformState.scale * transformState.scaleY);
            
            ctx.translate(px, py);
            ctx.rotate((transformState.rotation * Math.PI) / 180);
            
            const scaleX = transformState.scale * transformState.scaleX * (transformState.flipX ? -1 : 1);
            const scaleY = transformState.scale * transformState.scaleY * (transformState.flipY ? -1 : 1);
            ctx.scale(scaleX, scaleY);
            
            const ox_nat = (transformState.originX / 100) * transformNaturalSize.width;
            const oy_nat = (transformState.originY / 100) * transformNaturalSize.height;
            ctx.drawImage(cutoutImg, -ox_nat, -oy_nat);
            ctx.restore();

            const bakedUri = canvas.toDataURL();
            
            const isExistingLayer = (getCurrentFrame().layers || []).some(l => l.id === activeLayerId);
            
            if (isExistingLayer && activeLayerId && !createNewLayerForce) {
                // Update existing layer (for regular transforms/imports)
                const newLayers = (getCurrentFrame().layers || []).map(l => 
                    l.id === activeLayerId ? { 
                        ...l, 
                        dataUri: bakedUri,
                        bones: undefined,
                        boneTransforms: undefined
                    } : l
                );
                updateFrameLayers(currentFrameIndex, newLayers);
            } else {
                // Create a NEW layer (for lasso extractions or new imports)
                const layerId = `layer_${Date.now()}`;
                const newLayer: FrameLayer = {
                    id: layerId,
                    name: isLassoExtraction ? `Cutout` : `Imported Image`,
                    dataUri: bakedUri,
                    visible: true,
                    opacity: 1
                };
                updateFrameLayers(currentFrameIndex, [...(getCurrentFrame().layers || []), newLayer]);
                setActiveLayerId(layerId);
            }

            setIsTransforming(false);
            setIsLassoMode(false);
            setIsLassoExtraction(false);
            setTransformImageUri(null);
        }
    };

    const runMagicEraser = (startX: number, startY: number) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return;

        const width = canvas.width;
        const height = canvas.height;
        const imageData = ctx.getImageData(0, 0, width, height);
        const data = imageData.data;

        const targetIdx = (Math.floor(startY) * width + Math.floor(startX)) * 4;
        const tr = data[targetIdx];
        const tg = data[targetIdx + 1];
        const tb = data[targetIdx + 2];
        const ta = data[targetIdx + 3];

        // If clicking on already transparent pixel
        if (ta === 0) return;

        const threshold = magicEraserThreshold;
        const erasedIndices = new Set<number>();

        if (!magicEraserContiguous) {
            for (let i = 0; i < (width * height); i++) {
                const dIdx = i * 4;
                const dr = data[dIdx];
                const dg = data[dIdx + 1];
                const db = data[dIdx + 2];
                const da = data[dIdx + 3];

                if (da > 0) {
                    const diff = Math.sqrt(
                        Math.pow(dr - tr, 2) + 
                        Math.pow(dg - tg, 2) + 
                        Math.pow(db - tb, 2)
                    );
                    
                    if (diff <= threshold) {
                        data[dIdx + 3] = 0; // Erase
                        erasedIndices.add(i);
                    }
                }
            }
        } else {
            const visited = new Uint8Array(width * height);
            const stack: [number, number][] = [[Math.floor(startX), Math.floor(startY)]];

            while (stack.length > 0) {
                const [x, y] = stack.pop()!;
                const idx = (y * width + x);
                
                if (visited[idx]) continue;
                visited[idx] = 1;

                const dIdx = idx * 4;
                const dr = data[dIdx];
                const dg = data[dIdx + 1];
                const db = data[dIdx + 2];
                const da = data[dIdx + 3];

                // Color similarity check
                const diff = Math.sqrt(
                    Math.pow(dr - tr, 2) + 
                    Math.pow(dg - tg, 2) + 
                    Math.pow(db - tb, 2)
                );

                if (diff <= threshold && da > 0) {
                    data[dIdx + 3] = 0; // Erase
                    erasedIndices.add(idx);

                    if (x > 0) stack.push([x - 1, y]);
                    if (x < width - 1) stack.push([x + 1, y]);
                    if (y > 0) stack.push([x, y - 1]);
                    if (y < height - 1) stack.push([x, y + 1]);
                }
            }
        }

        // --- CLEANUP PASS: Remove thin halos/fringes by eroding 2px border ---
        const fringeIndices: number[] = [];
        erasedIndices.forEach(idx => {
            const x = idx % width;
            const y = Math.floor(idx / width);
            
            // Check neighbors of erased pixels with extended reach
            const neighbors = [
                [x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1],
                [x - 1, y - 1], [x + 1, y - 1], [x - 1, y + 1], [x + 1, y + 1],
                [x - 2, y], [x + 2, y], [x, y - 2], [x, y + 2] 
            ];

            neighbors.forEach(([nx, ny]) => {
                if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                    const nIdx = ny * width + nx;
                    if (!erasedIndices.has(nIdx) && data[nIdx * 4 + 3] > 0) {
                        const dIdx = nIdx * 4;
                        const diff = Math.sqrt(
                            Math.pow(data[dIdx] - tr, 2) + 
                            Math.pow(data[dIdx + 1] - tg, 2) + 
                            Math.pow(data[dIdx + 2] - tb, 2)
                        );
                        // Aggressive threshold for fringe removal
                        if (diff <= threshold + 40) {
                            fringeIndices.push(nIdx);
                        }
                    }
                }
            });
        });

        fringeIndices.forEach(idx => {
            data[idx * 4 + 3] = 0; // Erase fringe
        });

        // --- ARTIFACT REMOVAL PASS: Multi-pass cleaning for zero artifacts ---
        const cleanedData = new Uint8ClampedArray(data);
        const artifactThreshold = 4; // Even more aggressive cleanup

        // Pass 1: Island detection & Low Alpha Purge
        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                const idx = (y * width + x) * 4;
                if (data[idx + 3] > 0) {
                    // Remove "ghost" pixels with extremely low alpha
                    if (data[idx + 3] < 5) {
                        cleanedData[idx + 3] = 0;
                        continue;
                    }

                    let neighbors = 0;
                    for (let ny = -1; ny <= 1; ny++) {
                        for (let nx = -1; nx <= 1; nx++) {
                            if (nx === 0 && ny === 0) continue;
                            if (data[((y + ny) * width + (x + nx)) * 4 + 3] > 10) neighbors++;
                        }
                    }
                    if (neighbors < artifactThreshold) cleanedData[idx + 3] = 0;
                }
            }
        }
        data.set(cleanedData);

        // Pass 2: Progressive Soft Erosion for "all traces" removal
        const finalData = new Uint8ClampedArray(data);
        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                const idx = (y * width + x) * 4;
                if (data[idx + 3] > 0) {
                    let minNeighborAlpha = 255;
                    for (let ny = -1; ny <= 1; ny++) {
                        for (let nx = -1; nx <= 1; nx++) {
                            minNeighborAlpha = Math.min(minNeighborAlpha, data[((y + ny) * width + (x + nx)) * 4 + 3]);
                        }
                    }
                    
                    if (minNeighborAlpha === 0) {
                        // This pixel is on an absolute edge, erode it aggressively
                        finalData[idx + 3] = data[idx + 3] * 0.15; 
                    } else if (minNeighborAlpha < 100) {
                        // Near an edge, soften it
                        finalData[idx + 3] = data[idx + 3] * 0.6;
                    }
                }
            }
        }
        data.set(finalData);

        ctx.putImageData(imageData, 0, 0);
        hasUnsavedStrokesRef.current = true;
        saveActiveLayer();
    };

    const drawStar = (ctx: CanvasRenderingContext2D, x: number, y: number, size: number) => {
        const spikes = 5;
        const outerRadius = size / 2;
        const innerRadius = size / 4;
        let rot = Math.PI / 2 * 3;
        const step = Math.PI / spikes;

        ctx.beginPath();
        for (let i = 0; i < spikes; i++) {
            ctx.lineTo(x + Math.cos(rot) * outerRadius, y + Math.sin(rot) * outerRadius);
            rot += step;
            ctx.lineTo(x + Math.cos(rot) * innerRadius, y + Math.sin(rot) * innerRadius);
            rot += step;
        }
        ctx.lineTo(x, y - outerRadius);
        ctx.closePath();
    };

    const drawHeart = (ctx: CanvasRenderingContext2D, x: number, y: number, size: number) => {
        const w = size;
        const h = size;
        ctx.beginPath();
        ctx.moveTo(x, y + h / 4);
        ctx.bezierCurveTo(x, y, x - w / 2, y, x - w / 2, y + h / 4);
        ctx.bezierCurveTo(x - w / 2, y + h / 2, x, y + h * 0.75, x, y + h);
        ctx.bezierCurveTo(x, y + h * 0.75, x + w / 2, y + h / 2, x + w / 2, y + h / 4);
        ctx.bezierCurveTo(x + w / 2, y, x, y, x, y + h / 4);
        ctx.closePath();
    };

    const drawSparkle = (ctx: CanvasRenderingContext2D, x: number, y: number, size: number) => {
        ctx.beginPath();
        for (let i = 0; i < 4; i++) {
            const angle = (i * Math.PI) / 2;
            ctx.moveTo(x, y);
            ctx.lineTo(x + Math.cos(angle) * (size / 2), y + Math.sin(angle) * (size / 2));
            const sideAngle1 = angle + Math.PI / 8;
            const sideAngle2 = angle - Math.PI / 8;
            ctx.lineTo(x + Math.cos(sideAngle1) * (size / 4), y + Math.sin(sideAngle1) * (size / 4));
            ctx.lineTo(x + Math.cos(sideAngle2) * (size / 4), y + Math.sin(sideAngle2) * (size / 4));
            ctx.closePath();
        }
    };

    const drawLeaf = (ctx: CanvasRenderingContext2D, x: number, y: number, size: number) => {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(x + size / 2, y - size / 2, x + size, y);
        ctx.quadraticCurveTo(x + size / 2, y + size / 2, x, y);
        ctx.closePath();
        // Stem
        ctx.moveTo(x, y);
        ctx.lineTo(x - size / 4, y + size / 4);
    };

    const startDrawing = (e: React.PointerEvent) => {
        if (isPlaying || isRiggingMode) return;
        
        // If drawing on a rigged layer, we clear the bones to edit the flat layer texture properly
        const activeLayer = getActiveLayer();
        if (activeLayer && activeLayer.bones && activeLayer.bones.length > 0) {
            setFrames(prev => {
                const newFrames = [...prev];
                const idx = currentFrameIndexRef.current;
                const tFrame = { ...newFrames[idx] };
                tFrame.layers = tFrame.layers?.map(l => 
                    l.id === activeLayerId ? { ...l, bones: undefined, boneTransforms: undefined } : l
                );
                newFrames[idx] = tFrame;
                return newFrames;
            });
            
            // Sync currentFrameRef and ref states immediately for synchronous drawing pipeline
            if (activeLayerId) {
                const currentFrame = getCurrentFrame();
                if (currentFrame && currentFrame.layers) {
                    const lIdx = currentFrame.layers.findIndex(l => l.id === activeLayerId);
                    if (lIdx !== -1) {
                        currentFrame.layers[lIdx] = {
                            ...currentFrame.layers[lIdx],
                            bones: undefined,
                            boneTransforms: undefined
                        };
                    }
                }
            }

            // Draw unwarped base image onto canvasRef before any new strokes can be made
            const canvas = canvasRef.current;
            const ctx = canvas?.getContext('2d');
            if (canvas && ctx && activeLayer.dataUri) {
                const img = new Image();
                img.onload = () => {
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                };
                img.src = activeLayer.dataUri;
            }
        }
        
        const target = e.currentTarget as HTMLElement;
        if (target) {
            const rect = target.getBoundingClientRect();
            strokeTargetRectRef.current = {
                left: rect.left,
                top: rect.top,
                width: target.offsetWidth || rect.width,
                height: target.offsetHeight || rect.height
            };
            drawingSessionCacheRef.current = {
                cx: rect.left,
                cy: rect.top,
                W: rect.width || 1,
                H: rect.height || 1
            };
        }
        
        let { x, y } = getPointerPos(e);

        if (activeTool === 'RULER' && isPointerOnRulerKnob(x, y)) {
            setIsDraggingRulerKnob(true);
            return;
        }
        
        if (activeTool === 'RULER' && isPointerOnRulerBody(x, y)) {
            setIsDraggingRulerBody(true);
            return;
        }

        if (activeTool === 'RULER') {
            const snapped = snapPointToRuler(x, y);
            x = snapped.x;
            y = snapped.y;
        }

        activePointersRef.current.add(e.pointerId);

        if (e.button === 1 || e.button === 2 || isSpaceDownRef.current) {
            setIsPanning(true);
            panStartRef.current = { x: e.clientX, y: e.clientY };
            return;
        }

        if (activePointersRef.current.size > 1) {
            if (isDrawingRef.current) {
                // Cancel drawing if second finger placed
                setIsDrawing(false);
                isDrawingRef.current = false;
                pointsRef.current = [];
                lastPosRef.current = null;
                if (beforeDrawStateRef.current && canvasRef.current) {
                    const ctx = canvasRef.current.getContext('2d');
                    if (ctx) ctx.putImageData(beforeDrawStateRef.current as ImageData, 0, 0);
                }
            }
            return;
        }

        if (!e.isPrimary) {
            setIsDrawing(false);
            return;
        }


        if (isLassoMode) {
            setIsLassoDrawing(true);
            lassoPointsRef.current = [{ x, y }];
            setLassoPoints([{ x, y }]);
            return;
        }

        if (activeBrush.id === 'magic_eraser' || activeBrush.category === 'PICKER' || activeBrush.category === 'FILL') {
            setIsDrawing(true);
            isDrawingRef.current = true;
            pointsRef.current = [{ x, y }];
            return;
        }

        hasUnsavedStrokesRef.current = true;
        setIsDrawing(true);
        isDrawingRef.current = true;
        
        const mainCanvas = canvasRef.current;
        const previewCanvas = previewCanvasRef.current;
        if (!mainCanvas || !previewCanvas) return;

        // Snapshot current state for multi-touch rollback
        const mCtxBase = mainCanvas.getContext('2d');
        if (mCtxBase) {
            beforeDrawStateRef.current = mCtxBase.getImageData(0, 0, mainCanvas.width, mainCanvas.height) as any;
        }

        // Ensure sizes match
        if (previewCanvas.width !== mainCanvas.width) previewCanvas.width = mainCanvas.width;
        if (previewCanvas.height !== mainCanvas.height) previewCanvas.height = mainCanvas.height;
        
        const pCtx = previewCanvas.getContext('2d');
        if (pCtx) pCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);

        pointsRef.current = [{ x, y }];
        smoothPointsRef.current = [{ x, y }];
        accumulatedDistRef.current = 0; 
        
        // Initial dot on appropriate canvas
        if (activeBrush.category === 'ERASER') {
            const mCtx = mainCanvas.getContext('2d');
            if (mCtx) {
                mCtx.save();
                mCtx.beginPath();
                mCtx.globalCompositeOperation = 'destination-out';
                mCtx.arc(x, y, activeBrush.size / 2, 0, Math.PI * 2);
                mCtx.fill();
                mCtx.restore();
            }
        } else if (pCtx) {
            pCtx.save();
            pCtx.translate(x, y);
            pCtx.fillStyle = currentColor;
            pCtx.globalAlpha = activeBrush.opacity;
            if (activeBrush.blendMode) pCtx.globalCompositeOperation = activeBrush.blendMode;
            
            if (activeBrush.engine.startsWith('AIRBRUSH')) {
                const grad = pCtx.createRadialGradient(0, 0, 0, 0, 0, activeBrush.size);
                grad.addColorStop(0, currentColor); 
                grad.addColorStop(1, 'transparent');
                pCtx.fillStyle = grad;
                pCtx.beginPath(); pCtx.arc(0, 0, activeBrush.size, 0, Math.PI*2); pCtx.fill();
            } else if (activeBrush.engine === 'STAMP_STAR') {
                drawStar(pCtx, 0, 0, activeBrush.size);
                pCtx.fill();
            } else if (activeBrush.engine === 'STAMP_HEART') {
                drawHeart(pCtx, 0, 0, activeBrush.size);
                pCtx.fill();
            } else if (activeBrush.engine === 'STAMP_SPARKLE') {
                drawSparkle(pCtx, 0, 0, activeBrush.size);
                pCtx.fill();
            } else if (activeBrush.engine === 'STAMP_LEAF') {
                drawLeaf(pCtx, 0, 0, activeBrush.size);
                pCtx.fill();
            } else if (activeBrush.engine === 'STAMP_LACE') {
                 pCtx.beginPath();
                 pCtx.arc(0, 0, activeBrush.size / 2, 0, Math.PI * 2);
                 pCtx.strokeStyle = currentColor;
                 pCtx.lineWidth = 2;
                 pCtx.stroke();
                 pCtx.beginPath();
                 pCtx.arc(0, 0, activeBrush.size / 4, 0, Math.PI * 2);
                 pCtx.stroke();
            } else {
                pCtx.beginPath(); pCtx.arc(0, 0, activeBrush.size / 2, 0, Math.PI * 2); pCtx.fill();
            }
            pCtx.restore();
        }
        
        lastPosRef.current = { x, y };
    };

    const drawMove = (e: React.PointerEvent) => {
        if (isPlaying || (isRiggingMode)) return;

            if (isDraggingRulerKnob) {
                const { x: rx, y: ry } = rulerPosRef.current;
                const { x, y } = getPointerPos(e);
                
                if (activeRuler === 'SYMMETRY') {
                    rulerPosRef.current = { ...rulerPosRef.current, x };
                    drawRuler();
                    return;
                }
                
                // Scaling logic based on distance
                const dx = x - rx;
                const dy = y - ry;
                
                rulerScaleXRef.current = Math.max(0.5, Math.abs(dx) / 75);
                if (activeRuler !== 'LINE') {
                    rulerScaleYRef.current = Math.max(0.5, Math.abs(dy) / 75);
                }
                
                // Rotation logic based on angle
                const angle = Math.atan2(dy, dx);
                rulerRotationRef.current = angle;
                
                drawRuler();
                return;
            }
        
        if (isDraggingRulerBody) {
            const { x, y } = getPointerPos(e);
            rulerPosRef.current = { x, y };
            drawRuler();
            return;
        }

        if (activePointersRef.current.size > 1) {
            return; // let the touch handlers handle panning
        }

        if (isPanning) {
            const dx = e.clientX - panStartRef.current.x;
            const dy = e.clientY - panStartRef.current.y;
            panStartRef.current = { x: e.clientX, y: e.clientY };
            
            const prev = canvasTransformRef.current;
            if (e.altKey) {
                // Rotate
                applyTransform(prev.x, prev.y, prev.scale, prev.rotation + dx * 0.5);
            } else if (e.shiftKey) {
                // Zoom
                const s_new = Math.max(0.1, Math.min(10, prev.scale - dy * 0.01));
                const s_old = prev.scale;
                const factor = s_new / s_old;
                
                // Get mouse position relative to window
                const { x: mx, y: my } = getPointerPos(e);
                
                // Adjust translation to keep mouse point at same screen position
                const newX = mx - (mx - prev.x) * factor;
                const newY = my - (my - prev.y) * factor;
                
                applyTransform(newX, newY, s_new, prev.rotation);
            } else {
                applyTransform(prev.x + dx, prev.y + dy, prev.scale, prev.rotation);
            }
            return;
        }

        if (isSpaceDownRef.current && isDrawingRef.current) {
            // Switch to panning dynamically 
            setIsDrawing(false);
            isDrawingRef.current = false;
            setIsPanning(true);
            panStartRef.current = { x: e.clientX, y: e.clientY };
            return;
        }

        if (isLassoDrawing) {
            const { x, y } = getPointerPos(e);
            lassoPointsRef.current.push({ x, y });
            
            // Draw a temporary visual line on the preview canvas so user sees the lasso drawing in real-time
            const previewCanvas = previewCanvasRef.current;
            if (previewCanvas) {
                const previewCtx = previewCanvas.getContext('2d');
                if (previewCtx) {
                    previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
                    previewCtx.beginPath();
                    previewCtx.strokeStyle = '#06b6d4'; // Cyan matching layout highlights
                    previewCtx.lineWidth = 1.5;
                    previewCtx.setLineDash([4, 4]);
                    const pts = lassoPointsRef.current;
                    if (pts.length > 0) {
                        previewCtx.moveTo(pts[0].x, pts[0].y);
                        for (let i = 1; i < pts.length; i++) {
                            previewCtx.lineTo(pts[i].x, pts[i].y);
                        }
                    }
                    previewCtx.stroke();
                }
            }
            return;
        }

        if (!isDrawingRef.current || !lastPosRef.current || activeBrush.category === 'FILL' || activeBrush.id === 'magic_eraser') return;
        
        // Handle high-precision input if available (Coalesced events for smoother lines)
        const mainCanvas = canvasRef.current;
        const previewCanvas = previewCanvasRef.current;
        if (!mainCanvas || !previewCanvas) return;
        
        const mainCtx = mainCanvas.getContext('2d');
        const previewCtx = previewCanvas.getContext('2d');
        if (!mainCtx || !previewCtx) return;

        let requiresPreviewRedraw = false;
        let requiresMainDraw = false;

        const nativeE = e.nativeEvent;
        const events = (nativeE as any).getCoalescedEvents ? (nativeE as any).getCoalescedEvents() : [e];

        events.forEach((ev: any) => {
            let { x, y } = getPointerPos(ev);

            // --- RULER CONSTRAINT ---
            if (activeTool === 'RULER') {
                const snapped = snapPointToRuler(x, y);
                x = snapped.x;
                y = snapped.y;
            }

            // --- SMOOTHING / STABILIZATION ---
            if (smoothing > 0) {
                const weight = 1 - (smoothing * 0.9);
                const lastSmooth = smoothPointsRef.current[smoothPointsRef.current.length - 1];
                x = lastSmooth.x + (x - lastSmooth.x) * weight;
                y = lastSmooth.y + (y - lastSmooth.y) * weight;
                smoothPointsRef.current.push({ x, y });
            }

            if (activeBrush.category === 'PICKER') {
                pickStageColor(x, y);
                return;
            }

            pointsRef.current.push({ x, y });

            if (activeBrush.category === 'ERASER') {
                // Draw directly on main canvas for erasing
                const lastTwoPoints = pointsRef.current.slice(-2);
                if (lastTwoPoints.length < 2) return;
                
                const prevPos = { ...lastPosRef.current };
                let nextPos = prevPos;
                
                if (activeTool === 'RULER') {
                    nextPos = lastTwoPoints[1];
                } else {
                    const controlPoint = lastTwoPoints[0];
                    nextPos = {
                        x: (controlPoint.x + lastTwoPoints[1].x) / 2,
                        y: (controlPoint.y + lastTwoPoints[1].y) / 2,
                    };
                }

                const passes = activeRuler === 'SYMMETRY' ? [1, -1] : [1];

                passes.forEach(pass => {
                    mainCtx.save();
                    if (pass === -1) {
                        mainCtx.translate(rulerPosRef.current.x * 2, 0);
                        mainCtx.scale(-1, 1);
                    }
                    
                    mainCtx.beginPath();
                    if (activeTool === 'RULER') {
                        mainCtx.moveTo(lastTwoPoints[0].x, lastTwoPoints[0].y);
                        mainCtx.lineTo(lastTwoPoints[1].x, lastTwoPoints[1].y);
                    } else {
                        const controlPoint = lastTwoPoints[0];
                        mainCtx.moveTo(prevPos.x, prevPos.y);
                        mainCtx.quadraticCurveTo(controlPoint.x, controlPoint.y, nextPos.x, nextPos.y);
                    }
                    
                    mainCtx.lineCap = 'round';
                    mainCtx.lineJoin = 'round';
                    mainCtx.lineWidth = activeBrush.size;
                    mainCtx.globalCompositeOperation = 'destination-out';
                    mainCtx.stroke();
                    mainCtx.restore();
                });
                lastPosRef.current = nextPos;
            } else if (['PEN', 'PENCIL', 'MARKER'].includes(activeBrush.category)) {
                // Incremental drawing on preview canvas
                const lastTwoPoints = pointsRef.current.slice(-2);
                if (lastTwoPoints.length < 2) return;
                
                const prevPos = { ...lastPosRef.current };
                let nextPos = prevPos;
                
                if (activeTool === 'RULER') {
                    nextPos = lastTwoPoints[1];
                } else {
                    const controlPoint = lastTwoPoints[0];
                    nextPos = {
                        x: (controlPoint.x + lastTwoPoints[1].x) / 2,
                        y: (controlPoint.y + lastTwoPoints[1].y) / 2,
                    };
                }

                const passes = activeRuler === 'SYMMETRY' ? [1, -1] : [1];

                passes.forEach(pass => {
                    previewCtx.save();
                    if (pass === -1) {
                        previewCtx.translate(rulerPosRef.current.x * 2, 0);
                        previewCtx.scale(-1, 1);
                    }
                    
                    previewCtx.beginPath();
                    if (activeTool === 'RULER') {
                        previewCtx.moveTo(lastTwoPoints[0].x, lastTwoPoints[0].y);
                        previewCtx.lineTo(lastTwoPoints[1].x, lastTwoPoints[1].y);
                    } else {
                        const controlPoint = lastTwoPoints[0];
                        previewCtx.moveTo(prevPos.x, prevPos.y);
                        previewCtx.quadraticCurveTo(controlPoint.x, controlPoint.y, nextPos.x, nextPos.y);
                    }
                    
                    previewCtx.lineCap = 'round';
                    previewCtx.lineJoin = 'round';
                    previewCtx.lineWidth = activeBrush.size;
                    previewCtx.strokeStyle = currentColor;
                    previewCtx.globalAlpha = activeBrush.opacity;
                    if (activeBrush.blendMode) previewCtx.globalCompositeOperation = activeBrush.blendMode;
                    previewCtx.stroke();
                    previewCtx.restore();
                });
                lastPosRef.current = nextPos;
            } else {
                // Stamp-based (Airbrush etc) on preview canvas
                const dist = Math.sqrt(Math.pow(x - lastPosRef.current.x, 2) + Math.pow(y - lastPosRef.current.y, 2));
                const spacing = Math.max(0.5, (activeBrush.spacing || 0.1) * activeBrush.size);
                let currentDist = spacing - accumulatedDistRef.current;
                
                const passes = activeRuler === 'SYMMETRY' ? [1, -1] : [1];
                
                while (currentDist <= dist) {
                    const ratio = currentDist / dist;
                    const ix = lastPosRef.current.x + (x - lastPosRef.current.x) * ratio;
                    const iy = lastPosRef.current.y + (y - lastPosRef.current.y) * ratio;
                    
                    passes.forEach(pass => {
                        previewCtx.save();
                        if (pass === -1) {
                            previewCtx.translate(rulerPosRef.current.x * 2, 0);
                            previewCtx.scale(-1, 1);
                        }
                        previewCtx.translate(ix, iy);
                        previewCtx.globalAlpha = activeBrush.opacity;
                        if (activeBrush.blendMode) previewCtx.globalCompositeOperation = activeBrush.blendMode;

                        if (activeBrush.engine.startsWith('AIRBRUSH')) {
                            const grad = previewCtx.createRadialGradient(0, 0, 0, 0, 0, activeBrush.size);
                            grad.addColorStop(0, currentColor); 
                            grad.addColorStop(1, 'transparent');
                            previewCtx.fillStyle = grad;
                            previewCtx.beginPath(); previewCtx.arc(0, 0, activeBrush.size, 0, Math.PI*2); previewCtx.fill();
                        } else if (activeBrush.engine === 'STAMP_STAR') {
                            drawStar(previewCtx, 0, 0, activeBrush.size);
                            previewCtx.fillStyle = currentColor;
                            previewCtx.fill();
                        } else if (activeBrush.engine === 'STAMP_HEART') {
                            drawHeart(previewCtx, 0, 0, activeBrush.size);
                            previewCtx.fillStyle = currentColor;
                            previewCtx.fill();
                        } else if (activeBrush.engine === 'STAMP_SPARKLE') {
                            drawSparkle(previewCtx, 0, 0, activeBrush.size);
                            previewCtx.fillStyle = currentColor;
                            previewCtx.fill();
                        } else if (activeBrush.engine === 'STAMP_LEAF') {
                            drawLeaf(previewCtx, 0, 0, activeBrush.size);
                            previewCtx.fillStyle = currentColor;
                            previewCtx.fill();
                        } else if (activeBrush.engine === 'STAMP_LACE') {
                             // Lace pattern
                             previewCtx.beginPath();
                             previewCtx.arc(0, 0, activeBrush.size / 2, 0, Math.PI * 2);
                             previewCtx.strokeStyle = currentColor;
                             previewCtx.lineWidth = 2;
                             previewCtx.stroke();
                             previewCtx.beginPath();
                             previewCtx.arc(0, 0, activeBrush.size / 4, 0, Math.PI * 2);
                             previewCtx.stroke();
                        } else {
                            previewCtx.fillStyle = currentColor;
                            previewCtx.beginPath(); previewCtx.arc(0, 0, activeBrush.size / 2, 0, Math.PI*2); previewCtx.fill();
                        }
                        previewCtx.restore();
                    });
                    currentDist += spacing;
                }
                accumulatedDistRef.current = dist - (currentDist - spacing);
                lastPosRef.current = { x, y };
            }
        });

        if (requiresPreviewRedraw) {
            previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
            const passes = activeRuler === 'SYMMETRY' ? [1, -1] : [1];
            
            passes.forEach(pass => {
                previewCtx.save();
                if (pass === -1) {
                    previewCtx.translate(rulerPosRef.current.x * 2, 0);
                    previewCtx.scale(-1, 1);
                }
                
                previewCtx.beginPath();
                if (pointsRef.current.length > 0) {
                    previewCtx.moveTo(pointsRef.current[0].x, pointsRef.current[0].y);
                    if (activeTool === 'RULER') {
                        for (let i = 1; i < pointsRef.current.length; i++) {
                            previewCtx.lineTo(pointsRef.current[i].x, pointsRef.current[i].y);
                        }
                    } else {
                        for (let i = 1; i < pointsRef.current.length - 1; i++) {
                            const cp = pointsRef.current[i];
                            const ep = {
                                x: (pointsRef.current[i].x + pointsRef.current[i+1].x) / 2,
                                y: (pointsRef.current[i].y + pointsRef.current[i+1].y) / 2,
                            };
                            previewCtx.quadraticCurveTo(cp.x, cp.y, ep.x, ep.y);
                        }
                        previewCtx.lineTo(pointsRef.current[pointsRef.current.length-1].x, pointsRef.current[pointsRef.current.length-1].y);
                    }
                }
                
                previewCtx.lineCap = 'round';
                previewCtx.lineJoin = 'round';
                previewCtx.lineWidth = activeBrush.size;
                previewCtx.strokeStyle = currentColor;
                previewCtx.globalAlpha = activeBrush.opacity;
                if (activeBrush.blendMode) previewCtx.globalCompositeOperation = activeBrush.blendMode;
                previewCtx.stroke();
                previewCtx.restore();
            });
        }
    };

    const stopDrawing = (e?: React.PointerEvent) => {
        strokeTargetRectRef.current = null;
        drawingSessionCacheRef.current = null;
        if (e) {
            activePointersRef.current.delete(e.pointerId);
        }

        setIsDraggingRulerKnob(false);
        setIsDraggingRulerBody(false);

        if (isPanning) {
            setIsPanning(false);
            if (activePointersRef.current.size === 0) {
                // Done panning completely
            } else {
                // One finger still down, cancel any lingering draw state
                setIsDrawing(false);
                isDrawingRef.current = false;
                lastPosRef.current = null;
                pointsRef.current = [];
                smoothPointsRef.current = [];
                // Restore canvas if we had started drawing (e.g. Eraser dot)
                if (beforeDrawStateRef.current && canvasRef.current) {
                    const ctx = canvasRef.current.getContext('2d');
                    if (ctx) ctx.putImageData(beforeDrawStateRef.current as ImageData, 0, 0);
                }
            }
            return;
        }

        if (isLassoDrawing) {
            setIsLassoDrawing(false);
            const previewCanvas = previewCanvasRef.current;
            if (previewCanvas) {
                const previewCtx = previewCanvas.getContext('2d');
                if (previewCtx) {
                    previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
                }
            }
            const pts = lassoPointsRef.current;
            if (pts.length > 5) {
                setLassoPoints(pts);
                extractLassoSelection(pts);
            } else {
                setLassoPoints([]);
                lassoPointsRef.current = [];
            }
            return;
        }

        if (isDrawingRef.current) {
            if (activeBrush.id === 'magic_eraser' || activeBrush.category === 'PICKER' || activeBrush.category === 'FILL') {
                if (pointsRef.current.length > 0) {
                    const { x, y } = pointsRef.current[0];
                    if (activeBrush.id === 'magic_eraser') {
                        runMagicEraser(x, y);
                    } else if (activeBrush.category === 'PICKER') {
                        pickStageColor(x, y);
                    } else if (activeBrush.category === 'FILL') {
                        hasUnsavedStrokesRef.current = true;
                        floodFill(Math.floor(x), Math.floor(y), currentColor);
                        saveActiveLayer();
                    }
                }
            } else {
                // MERGE STROKE: Draw preview canvas onto main canvas
                const mainCanvas = canvasRef.current;
                const previewCanvas = previewCanvasRef.current;
                if (mainCanvas && previewCanvas) {
                    const mainCtx = mainCanvas.getContext('2d');
                    if (mainCtx) {
                        mainCtx.save();
                        mainCtx.globalAlpha = 1.0;
                        mainCtx.globalCompositeOperation = 'source-over';
                        mainCtx.drawImage(previewCanvas, 0, 0);
                        mainCtx.restore();
                    }
                    const previewCtx = previewCanvas.getContext('2d');
                    if (previewCtx) {
                        previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
                    }
                }

                if (activeBrush.category !== 'PICKER') {
                    saveActiveLayer();
                }
            }
            
            setIsDrawing(false);
            isDrawingRef.current = false;
            pointsRef.current = [];
            smoothPointsRef.current = [];
            beforeDrawStateRef.current = null;
            lastPosRef.current = null;
            if (previousBrushRef.current) {
                setActiveBrush(previousBrushRef.current);
                previousBrushRef.current = null;
            }
        }
    };

    const extractLassoSelection = (pts?: {x: number, y: number}[]) => {
        const pointsToUse = pts || lassoPoints;
        if (pointsToUse.length < 3 || !canvasRef.current) return;
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const currentLayer = getCurrentFrame().layers?.find(l => l.id === activeLayerId);
        const isRigged = currentLayer?.bones && currentLayer.bones.length > 0;

        // Calculate bounding box
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        pointsToUse.forEach(p => {
            minX = Math.min(minX, p.x);
            minY = Math.min(minY, p.y);
            maxX = Math.max(maxX, p.x);
            maxY = Math.max(maxY, p.y);
        });

        const w = (maxX - minX);
        const h = (maxY - minY);
        if (w < 2 || h < 2) { setLassoPoints([]); return; }

        // Create temp canvas for the selection
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = canvas.width;
        tempCanvas.height = canvas.height;
        const tCtx = tempCanvas.getContext('2d');
        if (!tCtx) return;

        // Source for selection (Warped state if rigged)
        const sourceCanvas = document.createElement('canvas');
        sourceCanvas.width = canvas.width;
        sourceCanvas.height = canvas.height;
        const sCtx = sourceCanvas.getContext('2d');
        
        if (sCtx && currentLayer) {
            if (isRigged) {
                const img = new Image();
                img.onload = () => {
                    drawWarpedImage(sCtx, img, canvas.width, canvas.height, currentLayer.bones!, currentLayer.boneTransforms || {}, currentLayer.rigType || 'MESH');
                    continueExtract();
                };
                img.src = currentLayer.dataUri;
            } else {
                sCtx.drawImage(canvas, 0, 0);
                continueExtract();
            }
        }

        function continueExtract() {
            if (!sCtx || !tCtx) return;
            // Clip and draw selection to temp canvas
            tCtx.beginPath();
            tCtx.moveTo(pointsToUse[0].x, pointsToUse[0].y);
            pointsToUse.forEach(p => tCtx.lineTo(p.x, p.y));
            tCtx.closePath();
            tCtx.clip();
            tCtx.drawImage(sourceCanvas, 0, 0);

            // Crop the result
            const cropCanvas = document.createElement('canvas');
            cropCanvas.width = w;
            cropCanvas.height = h;
            const cCtx = cropCanvas.getContext('2d');
            if (cCtx) {
                cCtx.drawImage(tempCanvas, minX, minY, w, h, 0, 0, w, h);
                const imageData = cCtx.getImageData(0, 0, w, h);
                let tMinX = w, tMinY = h, tMaxX = 0, tMaxY = 0;
                let found = false;
                for (let y = 0; y < h; y++) {
                    for (let x = 0; x < w; x++) {
                        if (imageData.data[(y * w + x) * 4 + 3] > 0) {
                            found = true;
                            if (x < tMinX) tMinX = x;
                            if (x > tMaxX) tMaxX = x;
                            if (y < tMinY) tMinY = y;
                            if (y > tMaxY) tMaxY = y;
                        }
                    }
                }
                const newW = found ? (tMaxX - tMinX + 1) : w;
                const newH = found ? (tMaxY - tMinY + 1) : h;
                const newCropCanvas = document.createElement('canvas');
                newCropCanvas.width = newW;
                newCropCanvas.height = newH;
                const nCtx = newCropCanvas.getContext('2d');
                if (nCtx && found) {
                    nCtx.drawImage(cropCanvas, tMinX, tMinY, newW, newH, 0, 0, newW, newH);
                }
                const finalDataUri = (found ? newCropCanvas : cropCanvas).toDataURL();
                
                // Clear selected area in original
                ctx.save();
                ctx.beginPath();
                ctx.moveTo(pointsToUse[0].x, pointsToUse[0].y);
                pointsToUse.forEach(p => ctx.lineTo(p.x, p.y));
                ctx.closePath();
                ctx.clip();
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.restore();
                
                // CRITICAL: Flag that the canvas has been modified so saveActiveLayer creates a new dataUri WITH THE HOLE
                hasUnsavedStrokesRef.current = true;
                saveActiveLayer();
                setIsLassoExtraction(true);
                // Enter Transform Mode
                startTransformation(finalDataUri, minX + (found ? tMinX : 0), minY + (found ? tMinY : 0), undefined, true);
            }
            setLassoPoints([]);
        }
    };

    // --- BONE RIGGING ---
    const startRigging = (selectedType: 'MESH' | 'HUMAN') => {
        const layer = getActiveLayer();
        if (layer) {
            // ALWAYS rig the stage view (dataUri) in FrameByFrame to ensure coordinate consistency 
            // with the final render. Using sourceUri (the untransformed part) causes space mismatches.
            setRiggingSnapshot(layer.dataUri);
            setRiggingBones(layer.bones ? safeDeepClone(layer.bones) : []);
            setBoneTransforms(layer.boneTransforms ? safeDeepClone(layer.boneTransforms) : {});
            setActiveRigType(selectedType || layer.rigType || 'MESH');
        } else {
            setRiggingSnapshot('');
            setRiggingBones([]);
            setBoneTransforms({});
            setActiveRigType(selectedType || 'MESH');
        }

        // Rigging tools are now handled via contextual label
        setIsRiggingMode(true);
        setActiveBoneId(null);
        setRiggingTool('BONE');
    };

    const updateBoneTransform = (key: 'rotation' | 'scaleX' | 'scaleY', value: number) => {
        if (!activeBoneId) return;
        setBoneTransforms(prev => ({
            ...prev,
            [activeBoneId]: {
                ...(prev[activeBoneId] || { rotation: 0, scaleX: 1, scaleY: 1 }),
                [key]: value
            }
        }));
    };

    const applyRigging = async () => {
        saveActiveLayer();
        pushToUndoHistory(framesRef.current);
        
        setFrames(prev => {
            const newFrames = [...prev];
            const idx = currentFrameIndexRef.current;
            const tFrame = { ...newFrames[idx] };
            const newLayers = tFrame.layers?.map(l => 
                l.id === activeLayerId ? { 
                    ...l, 
                    bones: riggingBones ? riggingBones.map(b => ({...b})) : [], 
                    boneTransforms: boneTransforms ? { ...boneTransforms } : {},
                    rigType: activeRigType
                } : l
            ) || [];
            tFrame.layers = newLayers;
            newFrames[idx] = tFrame;
            return newFrames;
        });
        








        setIsRiggingMode(false);
        setActiveBoneId(null);
        setRiggingBones([]);
        setBoneTransforms({});
        
        // Minor delay to ensure state propagates before thumbnail update
        setTimeout(updateFrameThumbnail, 100);
    };

    // --- TIMELINE & UTILS ---

    const addFrame = () => {
        saveActiveLayer();
        pushToUndoHistory(framesRef.current);
        const currentLayers = getCurrentFrame().layers?.map(l => ({
            ...l,
            id: `layer_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            dataUri: '',
            bones: undefined,
            boneTransforms: undefined
        })) || [];
        
        if (currentLayers.length === 0) {
           currentLayers.push({ id: `layer_${Date.now()}`, name: 'Layer 1', dataUri: '', visible: true, opacity: 1 });
        }

        const newFrame: FrameData = { id: `frm_${Date.now()}`, dataUri: '', layers: currentLayers };
        setFrames(prev => {
            const next = [...prev];
            next.splice(currentFrameIndex + 1, 0, newFrame);
            return next;
        });
        setCurrentFrameIndex(prev => prev + 1);
        setTimeout(updateFrameThumbnail, 100);
    };

    const deleteFrame = () => {
        if (frames.length <= 1) return; 
        saveActiveLayer();
        pushToUndoHistory(framesRef.current);
        setFrames(prev => prev.filter((_, i) => i !== currentFrameIndex));
        setCurrentFrameIndex(prev => Math.max(0, prev - 1));
    };

    const copyFrame = () => {
        const newDataUri = saveActiveLayer();
        pushToUndoHistory(framesRef.current);
        const currentLayers = getCurrentFrame().layers?.map(l => ({ 
            ...l, 
            id: `layer_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            dataUri: (l.id === activeLayerId && newDataUri) ? newDataUri : l.dataUri,
            bones: l.bones ? safeDeepClone(l.bones) : undefined,
            boneTransforms: l.boneTransforms ? safeDeepClone(l.boneTransforms) : undefined
        })) || [];
        const newFrame: FrameData = { 
            id: `frm_${Date.now()}`, 
            dataUri: newDataUri || getCurrentFrame().dataUri, // Thumbnail
            layers: currentLayers 
        };
        setFrames(prev => {
            const next = [...prev];
            next.splice(currentFrameIndex + 1, 0, newFrame);
            return next;
        });
        setCurrentFrameIndex(prev => prev + 1);
        
        // Trigger thumbnail update after duplication
        setTimeout(updateFrameThumbnail, 100);
    };

    const extractVideoFrames = async (file: File, fps: number) => {
        setIsImportingVideo(true);
        setImportVideoProgress(0);
        let tempVideoElement: HTMLVideoElement | null = null;
        
        try {
            const url = URL.createObjectURL(file);
            const video = document.createElement('video');
            tempVideoElement = video;
            video.src = url;
            video.muted = true;
            video.playsInline = true;
            video.preload = 'auto';
            video.crossOrigin = 'anonymous';
            video.style.position = 'absolute';
            video.style.top = '-9999px';
            video.style.left = '-9999px';
            video.style.width = '100px';
            video.style.height = '100px';
            video.style.opacity = '0';
            video.style.pointerEvents = 'none';
            document.body.appendChild(video);
            
            const seekTo = (v: HTMLVideoElement, time: number): Promise<void> => {
                return new Promise((resolve) => {
                    let isResolved = false;
                    const done = () => {
                        if (isResolved) return;
                        isResolved = true;
                        v.removeEventListener('seeked', done);
                        v.removeEventListener('error', done);
                        resolve();
                    };
                    
                    v.addEventListener('seeked', done);
                    v.addEventListener('error', done);
                    v.currentTime = time;
                    
                    if (!v.seeking) {
                        done();
                        return;
                    }
                    
                    const interval = setInterval(() => {
                        if (!v.seeking || isResolved) {
                            clearInterval(interval);
                            done();
                        }
                    }, 20);
                    
                    setTimeout(() => {
                        clearInterval(interval);
                        done();
                    }, 1000);
                });
            };

            await new Promise((resolve, reject) => {
                let isDone = false;
                const done = (val: any) => {
                    if (isDone) return;
                    isDone = true;
                    resolve(val);
                };
                const fail = (err: any) => {
                    if (isDone) return;
                    isDone = true;
                    reject(err);
                };
                
                video.onloadedmetadata = () => {
                    if (video.duration) done(null);
                };
                video.onloadeddata = () => done(null);
                video.onerror = () => fail(new Error("Video format not supported or codec error. Please try converting to a standard MP4 (H.264/AAC)."));
                
                if (video.readyState >= 2) {
                    done(null);
                } else {
                    video.load();
                }

                setTimeout(() => {
                    if (!isDone) {
                        if (video.duration || video.readyState >= 1) {
                            done(null);
                        } else {
                            fail(new Error("Video loading timed out. The file format may be unsupported by your browser. Prefer standard MP4 or WebM files."));
                        }
                    }
                }, 8000);
            });

            // Ensure video duration is available
            let attempts = 0;
            while (isNaN(video.duration) || video.duration === 0) {
                await new Promise(r => setTimeout(r, 100));
                attempts++;
                if (attempts > 30) break; // 3 seconds timeout
            }

            // Handle Infinity duration (common in webm)
            if (!isFinite(video.duration) || video.duration === 0 || isNaN(video.duration)) {
                await seekTo(video, Number.MAX_SAFE_INTEGER);
                await seekTo(video, 0);
            }

            const rawDuration = video.duration;
            let duration = (isFinite(rawDuration) && rawDuration > 0) ? rawDuration : (originalVideoRef.current?.file?.size ? 10 : 1); // fallback slightly longer if totally broken
            
            // Adaptively downsample FPS to prevent OOM crash for long videos and make it lightning fast!
            // We want total frames to be at most ~350 frames.
            let targetFps = fps;
            if (duration * targetFps > 350) {
                targetFps = Math.max(1, 350 / duration);
            }

            // Generate exact frame timestamps to capture absolutely everything
            const frameTimes: number[] = [];
            const timeStep = 1 / targetFps;
            const safeDuration = duration;
            
            for (let t = 0; t <= safeDuration; t += timeStep) {
                frameTimes.push(t);
            }
            // Ensure the very last frame is captured if it's not perfectly aligned
            if (frameTimes.length > 0 && safeDuration - frameTimes[frameTimes.length - 1] > 0.05) {
                frameTimes.push(safeDuration);
            }
            if (frameTimes.length === 0) frameTimes.push(0);
            
            const totalFrames = frameTimes.length;
            
            let extWidth = canvasSize.width;
            let extHeight = canvasSize.height;
            
            // Extreme optimization for long videos to prevent browser OOM (Out Of Memory)
            // Even with Blob URLs, we must throttle canvas dimension if frame count is massive
            if (totalFrames > 10000) {
                 extWidth = Math.floor(canvasSize.width / 4);
                 extHeight = Math.floor(canvasSize.height / 4);
            } else if (totalFrames > 5000) {
                 extWidth = Math.floor(canvasSize.width / 3);
                 extHeight = Math.floor(canvasSize.height / 3);
            } else if (totalFrames > 2000) {
                 extWidth = Math.floor(canvasSize.width / 2);
                 extHeight = Math.floor(canvasSize.height / 2);
            }
            
            // Heavily throttle dimensions for huge frame loops
            const MAX_DIM = totalFrames > 5000 ? 240 : (totalFrames > 1500 ? 400 : 720); 
            if (extWidth > MAX_DIM || extHeight > MAX_DIM) {
                 const ratio = Math.max(extWidth / MAX_DIM, extHeight / MAX_DIM);
                 extWidth = Math.floor(extWidth / ratio);
                 extHeight = Math.floor(extHeight / ratio);
            }

            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, extWidth);
            canvas.height = Math.max(1, extHeight);
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            
            const newVideoFrames: FrameData[] = [];
            
            // Calculate letterboxing dimensions safely
            let lastPercent = -1;
            
            for (let i = 0; i < totalFrames; i++) {
                // Safeguard seek target slightly below duration to prevent Safari freezing
                const targetTime = Math.min(frameTimes[i], duration - 0.001);
                
                if (Math.abs(video.currentTime - targetTime) > 0.01) {
                    await seekTo(video, Math.max(0, targetTime));
                    // Additional micro-yield to allow browser paint pipeline to settle and guarantee frame-accurate rendering
                    await new Promise(r => requestAnimationFrame(() => setTimeout(r, 16)));
                }
                
                let scale = 1, dw = canvas.width, dh = canvas.height, dx = 0, dy = 0;
                if (video.videoWidth && video.videoHeight) {
                    scale = Math.min(canvas.width / video.videoWidth, canvas.height / video.videoHeight);
                    dw = video.videoWidth * scale;
                    dh = video.videoHeight * scale;
                    dx = (canvas.width - dw) / 2;
                    dy = (canvas.height - dh) / 2;
                } else {
                    dw = canvas.width;
                    dh = canvas.height;
                }
                
                if (ctx) {
                    ctx.clearRect(0,0,canvas.width, canvas.height);
                    ctx.drawImage(video, dx, dy, dw, dh);
                }

                // Compress frames heavily (JPEG is extremely light for continuous video frames without transparency)
                const quality = totalFrames > 350 ? 0.35 : (totalFrames > 150 ? 0.55 : 0.75);
                const dataUri = canvas.toDataURL('image/jpeg', quality);

                newVideoFrames.push({
                    id: `frm_${Date.now()}_v${i}`,
                    dataUri: dataUri,
                    layers: [{
                        id: `layer_${Date.now()}_v${i}`,
                        name: 'Video',
                        dataUri: dataUri,
                        visible: true,
                        opacity: 1
                    }]
                });
                
                const percent = Math.round(((i + 1) / totalFrames) * 100);
                if (percent !== lastPercent || i % 5 === 0) {
                    setImportVideoProgress(percent);
                    setExtractingFrameUri(dataUri);
                    lastPercent = percent;
                    await new Promise(r => setTimeout(r, 0)); // Yield to UI thread
                }
            }

            pushToUndoHistory(framesRef.current);
            setFrames(newVideoFrames); // REPLACE ALL FRAMES WITH VIDEO
            setCurrentFrameIndex(0);
            setActiveLayerId(newVideoFrames[0]?.layers?.[0]?.id || null);
            URL.revokeObjectURL(url);
            
            originalVideoRef.current = { file, lastFps: fps };
            triggerLocalToast(`Imported ${totalFrames} frames!`);
        } catch (e) {
            console.error('Video import error:', e);
            triggerLocalToast('Error importing video');
        } finally {
            if (tempVideoElement && tempVideoElement.parentNode) {
                tempVideoElement.parentNode.removeChild(tempVideoElement);
            }
            setExtractingFrameUri(null);
            setIsImportingVideo(false);
            setImportVideoProgress(null);
            setIsLassoMode(false);
            setIsTransforming(false);
            setIsRiggingMode(false);
            isDrawingRef.current = false;
            setLassoPoints([]);
            // Force rendering canvas
            setTimeout(() => {
                loadActiveLayerToCanvas();
            }, 100);
        }
    };

    // We no longer automatically recalculate frames on playbackSpeed change in order to preserve drawings
    // and prevent dual-trigger / race condition browser crashes during active import loops.

    // --- GLOBAL LAYER OPERATIONS ---
    const handleAddTextToCanvas = () => {
        if (!textInputData.text) return;
        
        const canvas = document.createElement('canvas');
        canvas.width = 1500; // Large enough for high quality text
        canvas.height = 1500;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        let fontStr = `bold 120px ${textInputData.font}`;
        let textColor = textInputData.color;
        let bColor = textInputData.borderColor;
        let bWidth = textInputData.borderWidth;
        
        if (textInputData.styleTemplate === 'meme') {
            fontStr = `bold 150px Impact, sans-serif`;
            textColor = '#ffffff';
            bColor = '#000000';
            bWidth = 6;
        } else if (textInputData.styleTemplate === 'subtitle') {
            fontStr = `bold 100px Arial, sans-serif`;
            textColor = '#ffff00';
            bColor = '#000000';
            bWidth = 4;
        } else if (textInputData.styleTemplate === 'comic') {
            fontStr = `bold 120px "Comic Sans MS", cursive, sans-serif`;
            textColor = '#000000';
            bColor = '#ffffff';
            bWidth = 6;
        }

        ctx.font = fontStr;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        const x = canvas.width / 2;
        const y = canvas.height / 2;
        
        const lines = textInputData.text.split('\n');
        const lineHeight = parseInt(fontStr.match(/\d+/)![0]) * 1.2;
        const startY = y - (lines.length - 1) * lineHeight / 2;

        lines.forEach((line, index) => {
            const lineY = startY + index * lineHeight;
            if (bWidth > 0) {
                ctx.strokeStyle = bColor;
                ctx.lineWidth = bWidth;
                ctx.lineJoin = 'round';
                ctx.strokeText(line, x, lineY);
            }
            ctx.fillStyle = textColor;
            ctx.fillText(line, x, lineY);
        });

        const textDataUri = canvas.toDataURL();
        
        setShowTextModal(false);
        setTextInputData({ ...textInputData, text: '' });
        startTransformation(textDataUri, 0, 0, { scale: 1, rotation: 0, flipX: false, flipY: false }, true);
    };

    const addLayer = () => {
        saveActiveLayer();
        const baseName = `Layer ${Math.max(...frames.map(f => f.layers?.length || 0), 0) + 1}`;
        let fallbackActiveId = '';
        
        pushToUndoHistory(framesRef.current);
        const newFrames = frames.map((f, i) => {
            const newLayer: FrameLayer = {
                id: `l_${Date.now()}_${Math.random()}`,
                name: baseName,
                dataUri: '',
                visible: true,
                opacity: 1
            };
            if (i === currentFrameIndex) fallbackActiveId = newLayer.id;
            return {
                ...f,
                layers: [...(f.layers || []), newLayer]
            };
        });
        setFrames(newFrames);
        if (fallbackActiveId) setActiveLayerId(fallbackActiveId);
    };

    const handleReorderFrames = (newFrames: FrameData[]) => {
        pushToUndoHistory(framesRef.current);
        const currentFrameId = frames[currentFrameIndex]?.id;
        setFrames(newFrames);
        // Sync current frame selection to follow the moved item
        if (currentFrameId) {
            const newIdx = newFrames.findIndex(f => f.id === currentFrameId);
            if (newIdx !== -1 && newIdx !== currentFrameIndex) {
                setCurrentFrameIndex(newIdx);
            }
        }
    };

    // Ensure Layer panel doesn't glitch by keeping stable visual order reference during drag
    const [visualLayers, setVisualLayers] = useState<FrameLayer[]>([]);
    
    // Multi-selection states for layer merging
    const [isSelectionMode, setIsSelectionMode] = useState<boolean>(false);
    const [selectedLayerIds, setSelectedLayerIds] = useState<string[]>([]);

    const handleStartSelectionMode = useCallback((id: string) => {
        setIsSelectionMode(true);
        setSelectedLayerIds([id]);
    }, []);

    const handleToggleSelectLayer = useCallback((id: string) => {
        setSelectedLayerIds(prev => {
            if (prev.includes(id)) {
                return prev.filter(x => x !== id);
            } else {
                return [...prev, id];
            }
        });
    }, []);

    const mergeSelectedLayers = useCallback(async () => {
        if (selectedLayerIds.length < 2) return;
        
        const currentFrame = getCurrentFrame();
        if (!currentFrame || !currentFrame.layers) return;
        
        // Sort selected layers in their original index order (bottom to top)
        const sortedLayersToMerge = currentFrame.layers.filter(l => selectedLayerIds.includes(l.id));
        if (sortedLayersToMerge.length < 2) return;
        
        // Save current active layer edits first
        saveActiveLayer();
        
        // Push current state to undo history
        pushToUndoHistory(frames);
        
        // Create offscreen canvas
        const mergeCanvas = document.createElement('canvas');
        mergeCanvas.width = canvasSize.width;
        mergeCanvas.height = canvasSize.height;
        const ctx = mergeCanvas.getContext('2d');
        if (!ctx) return;
        
        ctx.clearRect(0, 0, mergeCanvas.width, mergeCanvas.height);
        
        try {
            // Load all layer images sequentially in correct order (bottom to top)
            const loadedImages = await Promise.all(
                sortedLayersToMerge.map(layer => {
                    return new Promise<{ layer: FrameLayer, img: HTMLImageElement | null }>((resolve) => {
                        if (!layer.dataUri) {
                            resolve({ layer, img: null });
                            return;
                        }
                        const img = new Image();
                        img.onload = () => resolve({ layer, img });
                        img.onerror = () => resolve({ layer, img: null });
                        img.src = layer.dataUri;
                    });
                })
            );
            
            // Render visible layers onto offscreen canvas
            for (const { layer, img } of loadedImages) {
                if (!img || !layer.visible) continue;
                
                ctx.save();
                ctx.globalAlpha = layer.opacity !== undefined ? layer.opacity : 1;
                
                if (layer.bones && layer.bones.length > 0) {
                    drawWarpedImage(
                        ctx,
                        img,
                        mergeCanvas.width,
                        mergeCanvas.height,
                        layer.bones,
                        layer.boneTransforms || {},
                        layer.rigType || 'MESH'
                    );
                } else {
                    ctx.drawImage(img, 0, 0, mergeCanvas.width, mergeCanvas.height);
                }
                ctx.restore();
            }
            
            const mergedDataUri = mergeCanvas.toDataURL('image/png');
            
            // Create a brand new merged layer
            const mergedLayerId = 'layer_' + Math.random().toString(36).substr(2, 9);
            const mergedName = `Merged (${sortedLayersToMerge.map(l => l.name).join(' + ')})`;
            const safeMergedName = mergedName.length > 40 ? mergedName.substring(0, 37) + '...' : mergedName;
            
            const mergedLayer: FrameLayer = {
                id: mergedLayerId,
                name: safeMergedName,
                dataUri: mergedDataUri,
                visible: true,
                opacity: 1
            };
            
            // We want to find the index of the highest selected layer to place the merged layer there
            const indices = sortedLayersToMerge.map(l => currentFrame.layers!.findIndex(x => x.id === l.id));
            const insertIndex = Math.max(...indices);
            
            // Reconstruct the new layers list: remove all selected, and insert mergedLayer at insertIndex
            let inserted = false;
            const resultLayers: FrameLayer[] = [];
            for (let i = 0; i < currentFrame.layers.length; i++) {
                const currentL = currentFrame.layers[i];
                if (selectedLayerIds.includes(currentL.id)) {
                    if (i === insertIndex) {
                        resultLayers.push(mergedLayer);
                        inserted = true;
                    }
                } else {
                    resultLayers.push(currentL);
                }
            }
            if (!inserted) {
                resultLayers.push(mergedLayer);
            }
            
            // Update frames state globally
            const updatedFrames = frames.map((f, idx) => {
                if (idx === currentFrameIndex) {
                    return { ...f, layers: resultLayers };
                }
                return f;
            });
            
            setFrames(updatedFrames);
            setActiveLayerId(mergedLayerId);
            
            // Reset selection mode
            setIsSelectionMode(false);
            setSelectedLayerIds([]);
            
            toast.success(t('Layers merged successfully!'));
        } catch (error) {
            console.error("Error merging layers:", error);
            toast.error(t('Failed to merge layers.'));
        }
    }, [selectedLayerIds, frames, currentFrameIndex, canvasSize, t, setFrames]);
    
    useEffect(() => {
         // Sync local visual state when underlying data updates
         setVisualLayers([...(getCurrentFrame().layers || [])].reverse());
    }, [frames, currentFrameIndex]);

    const handleReorderLayers = (newLayers: FrameLayer[]) => {
        setVisualLayers(newLayers);
        // UI visual order is Top-to-Bottom (reversed internal storage)
        const reordered = [...newLayers].reverse();
        
        // Make layer reorder global across all frames
        const currentLayers = getCurrentFrame().layers || [];
        if (currentLayers.length !== reordered.length) {
            updateFrameLayers(currentFrameIndex, reordered);
            return;
        }
        
        pushToUndoHistory(framesRef.current);
        const nameOrder = reordered.map(l => l.name);
        
        const newFrames = frames.map(f => {
            if (!f.layers) return f;
            const reorderedForFrame = nameOrder.map(name => {
                return f.layers!.find(l => l.name === name);
            }).filter(Boolean) as FrameLayer[];
            
            // If mismatch in this frame, just fallback to local to avoid breaking
            if (reorderedForFrame.length !== f.layers.length) return f;
            return { ...f, layers: reorderedForFrame };
        });
        setFrames(newFrames);
    };

    const moveLayerUp = (id: string) => {
        const index = visualLayers.findIndex(l => l.id === id);
        if (index === -1 || index === 0) return;
        const newLayers = [...visualLayers];
        const temp = newLayers[index];
        newLayers[index] = newLayers[index - 1];
        newLayers[index - 1] = temp;
        handleReorderLayers(newLayers);
    };

    const moveLayerDown = (id: string) => {
        const index = visualLayers.findIndex(l => l.id === id);
        if (index === -1 || index === visualLayers.length - 1) return;
        const newLayers = [...visualLayers];
        const temp = newLayers[index];
        newLayers[index] = newLayers[index + 1];
        newLayers[index + 1] = temp;
        handleReorderLayers(newLayers);
    };

    const duplicateLayer = (id: string) => {
        const activeFrame = frames[currentFrameIndex];
        const layerIdx = activeFrame.layers?.findIndex(l => l.id === id);
        if (layerIdx === undefined || layerIdx === -1) return;
        const targetLayerName = activeFrame.layers![layerIdx].name;
        
        saveActiveLayer();
        pushToUndoHistory(framesRef.current);
        
        let fallbackActiveId = '';
        const newFrames = frames.map((f, i) => {
            const matchIdx = f.layers?.findIndex(l => l.name === targetLayerName);
            if (matchIdx !== undefined && matchIdx !== -1) {
                const sourceLayer = f.layers![matchIdx];
                const newLayer: FrameLayer = {
                    ...sourceLayer,
                    id: `l_${Date.now()}_${Math.random()}`,
                    name: `${sourceLayer.name} copy`
                    // In other frames, we literally duplicate the pixels of THAT frame's layer version
                };
                if (i === currentFrameIndex) fallbackActiveId = newLayer.id;
                const newLayersList = [...(f.layers || [])];
                newLayersList.splice(matchIdx + 1, 0, newLayer);
                return { ...f, layers: newLayersList };
            }
            return f;
        });
        setFrames(newFrames);
        if (fallbackActiveId) setActiveLayerId(fallbackActiveId);
    };

    const deleteLayer = (id: string) => {
        const activeFrame = frames[currentFrameIndex];
        const layerIdx = activeFrame.layers?.findIndex(l => l.id === id);
        if (layerIdx === undefined || layerIdx === -1 || (activeFrame.layers && activeFrame.layers.length <= 1)) return;
        
        const targetLayerName = activeFrame.layers[layerIdx].name;
        saveActiveLayer();
        pushToUndoHistory(framesRef.current);
        
        const newFrames = frames.map(f => {
            const matchIdx = f.layers?.findIndex(l => l.name === targetLayerName);
            if (matchIdx !== undefined && matchIdx !== -1 && f.layers && f.layers.length > 1) {
                const newL = [...f.layers];
                newL.splice(matchIdx, 1);
                return { ...f, layers: newL };
            }
            return f;
        });
        setFrames(newFrames);
        if (activeLayerId === id) {
            const activeNewL = newFrames[currentFrameIndex]?.layers;
            if (activeNewL && activeNewL.length > 0) {
                setActiveLayerId(activeNewL[activeNewL.length - 1].id);
            }
        }
    };

    const toggleLayerVisibility = (id: string) => {
        const activeFrame = frames[currentFrameIndex];
        const layerIdx = activeFrame.layers?.findIndex(l => l.id === id);
        if (layerIdx === undefined || layerIdx === -1) return;
        
        const targetLayerName = activeFrame.layers[layerIdx].name;
        // Global toggle
        const newFrames = frames.map(f => {
            const newL = f.layers?.map(l => l.name === targetLayerName ? { ...l, visible: !l.visible } : l);
            return { ...f, layers: newL };
        });
        setFrames(newFrames);
    };

    const renameLayer = (id: string, newName: string) => {
        const activeFrame = frames[currentFrameIndex];
        const layerIdx = activeFrame.layers?.findIndex(l => l.id === id);
        if (layerIdx === undefined || layerIdx === -1) return;
        
        const targetLayerName = activeFrame.layers[layerIdx].name;
        // Check if name exists
        const exists = activeFrame.layers.some(l => l.name === newName);
        if(exists && newName !== targetLayerName) return; // Prevent duplicate names

        saveActiveLayer();
        // Global rename
        const newFrames = frames.map(f => {
            const newL = f.layers?.map(l => l.name === targetLayerName ? { ...l, name: newName } : l);
            return { ...f, layers: newL };
        });
        setFrames(newFrames);
    };

    const handleVideoImport = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        
        setIsPlaying(false);
        const fps = Number.isNaN(playbackSpeed) || playbackSpeed <= 0 ? (settings?.fps || 24) : playbackSpeed;
        extractVideoFrames(file, fps);
        
        if (fileInputRef.current) {
            fileInputRef.current.value = "";
        }
    };

    // Keep video in sync with timeline
    useEffect(() => {
        if (videoRef.current && referenceVideoUrl) {
            const fps = Number.isNaN(playbackSpeed) || playbackSpeed <= 0 ? (settings?.fps || 24) : playbackSpeed;
            if (fps > 0) {
                const targetTime = currentFrameIndex / fps;
                // Prevent excessive seeking
                if (Math.abs(videoRef.current.currentTime - targetTime) > 0.1) {
                    videoRef.current.currentTime = targetTime;
                }
            }
        }
    }, [currentFrameIndex, referenceVideoUrl, settings?.fps, playbackSpeed]);

    useEffect(() => {
        return () => {
            if (referenceVideoUrl && referenceVideoUrl.startsWith("blob:")) {
                URL.revokeObjectURL(referenceVideoUrl);
            }
        };
    }, []);

    // Ruler Canvas Clearing
    useEffect(() => {
        if (activeTool !== 'RULER' && rulerCanvasCtxRef.current && rulerCanvasRef.current) {
            rulerCanvasCtxRef.current.clearRect(0, 0, rulerCanvasRef.current.width, rulerCanvasRef.current.height);
        }
    }, [activeTool]);

    // Ruler Rendering
    const drawRuler = useCallback(() => {
        if (!rulerCanvasRef.current || !rulerCanvasCtxRef.current) return;
        
        const ctx = rulerCanvasCtxRef.current;
        ctx.clearRect(0, 0, rulerCanvasRef.current.width, rulerCanvasRef.current.height);
        
        if (!activeRuler) return;
        
        ctx.save();
        ctx.strokeStyle = '#22d3ee'; // Cyan-400
        ctx.lineWidth = 3; // Thicker line
        
        const {x, y} = rulerPosRef.current;
        const radiusX = (150 * rulerScaleXRef.current) / 2;
        const radiusY = (150 * rulerScaleYRef.current) / 2;

        if (activeRuler === 'BOX') {
            ctx.strokeRect(x - radiusX, y - radiusY, radiusX * 2, radiusY * 2);
            // Draw Knob
            ctx.fillStyle = '#164e63'; // Custom styling for large knob
            ctx.strokeStyle = '#22d3ee';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(x + radiusX, y - radiusY, 16, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        } else if (activeRuler === 'CIRCLE') {
            ctx.beginPath();
            ctx.ellipse(x, y, radiusX, radiusY, 0, 0, Math.PI * 2);
            ctx.stroke();
            // Draw Knob
            ctx.fillStyle = '#164e63';
            ctx.beginPath();
            ctx.arc(x + radiusX, y - radiusY, 16, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        } else if (activeRuler === 'LINE') {
            ctx.beginPath();
            ctx.moveTo(x - radiusX, y);
            ctx.lineTo(x + radiusX, y);
            ctx.stroke();
            // Draw Knob
            ctx.fillStyle = '#164e63';
            ctx.beginPath();
            ctx.arc(x + radiusX, y, 16, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        } else if (activeRuler === 'SYMMETRY') {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, canvasSize.height);
            ctx.stroke();
            // Draw Knob
            ctx.fillStyle = '#164e63';
            ctx.beginPath();
            ctx.arc(x, y, 16, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        }
        
        ctx.restore();
    }, [activeRuler, canvasSize]);

    useLayoutEffect(() => {
        if (rulerCanvasRef.current) {
            rulerCanvasCtxRef.current = rulerCanvasRef.current.getContext('2d');
            rulerCanvasRef.current.width = canvasSize.width;
            rulerCanvasRef.current.height = canvasSize.height;
            drawRuler();
        }
    }, [canvasSize, drawRuler]);
    const playbackFrameId = useRef<number>(0);
    const lastLoopedTimeRef = useRef<number>(0);
    const lastTick = useRef<number>(0);
    const currentFrameIndexRef = useRef(currentFrameIndex);
    const framesRef = useRef(frames);
    
    useEffect(() => { currentFrameIndexRef.current = currentFrameIndex; }, [currentFrameIndex]);
    useEffect(() => {
        if (videoRef.current && referenceVideoUrl && !Number.isNaN(playbackSpeed) && playbackSpeed > 0) {
            videoRef.current.currentTime = currentFrameIndex / playbackSpeed;
        }
    }, [currentFrameIndex, playbackSpeed, referenceVideoUrl]);
    useEffect(() => { framesRef.current = frames; }, [frames]);

    useEffect(() => {
        if (!isPlaying) {
            interpTransformsGlobalRef.current = {};
            stopAudio();
            return;
        }

        // Start audio when playback starts
        if (audioClips.length > 0) {
            const frameTime = 1 / playbackSpeed;
            const startTime = currentFrameIndex * frameTime;
            playAudioFrom(startTime);
        }

        const runPlayback = (time: number) => {
            if (!lastTick.current) lastTick.current = time;
            const frameTime = 1000 / Math.max(1, playbackSpeed);
            const length = Math.max(1, framesRef.current.length);
            
            let currentFrameProgress = 0;

            if (audioClips.length > 0 && audioContextRef.current && activeAudioSourcesRef.current.length > 0) {
                // Audio master clock logic
                const audioElapsed = audioContextRef.current.currentTime - audioStartTimeRef.current;
                const totalElapsed = audioElapsed + audioOffsetRef.current;
                
                // Duration of one full animation loop in seconds
                const loopDuration = length / Math.max(1, playbackSpeed);
                const loopedTime = totalElapsed % loopDuration;
                const targetFrame = Math.floor(loopedTime * playbackSpeed) % length;
                currentFrameProgress = (loopedTime * playbackSpeed) % 1;

                if (targetFrame < currentFrameIndexRef.current || loopedTime < lastLoopedTimeRef.current) {
                    // Animation looped, restart audio to maintain sync
                    if (audioClips.length > 0) {
                        playAudioFrom(0);
                    }
                }
                lastLoopedTimeRef.current = loopedTime;

                if (targetFrame !== currentFrameIndexRef.current) {
                    setCurrentFrameIndex(targetFrame);
                    currentFrameIndexRef.current = targetFrame;
                    interpTransformsGlobalRef.current = {};
                }
                
                setPlayheadProgress(loopedTime / loopDuration);
            } else {
                // Fallback to time-based clock
                const delta = time - lastTick.current;
                if (delta >= frameTime) {
                    const framesToAdvance = Math.floor(delta / frameTime);
                    
                    setCurrentFrameIndex(prev => {
                        const next = (prev + framesToAdvance) % length;
                        currentFrameIndexRef.current = next; 
                        return next;
                    });
                    
                    lastTick.current += framesToAdvance * frameTime;
                    interpTransformsGlobalRef.current = {};
                    setPlayheadProgress(currentFrameIndexRef.current / length);
                }
                currentFrameProgress = (time - lastTick.current) / frameTime;
            }
            
            if (useInterpolation) {
                const progress = Math.min(1, Math.max(0, currentFrameProgress));
                const cIdx = currentFrameIndexRef.current;
                const nextIdx = (cIdx + 1) % length;
                const currentFrame = framesRef.current[cIdx];
                const nextFrame = framesRef.current[nextIdx];

                if (currentFrame && nextFrame) {
                    const easeInOutQuad = (t: number) => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
                    const easedProgress = easeInOutQuad(progress);

                    let hasInterp = false;
                    const newInterp: Record<string, any> = {};
                    currentFrame.layers?.forEach(l => {
                        const nextLayer = nextFrame.layers?.find(nl => nl.name === l.name);
                        if (l.bones && l.bones.length > 0 && nextLayer?.bones && l.boneTransforms && nextLayer.boneTransforms) {
                            hasInterp = true;
                            const layerInterp: any = {};
                            l.bones.forEach(b => {
                                const bt = l.boneTransforms![b.id] || { rotation: 0, scaleX: 1, scaleY: 1 };
                                const nbt = nextLayer.boneTransforms![b.id] || { rotation: 0, scaleX: 1, scaleY: 1 };
                                layerInterp[b.id] = {
                                    rotation: bt.rotation + (nbt.rotation - bt.rotation) * easedProgress,
                                    scaleX: bt.scaleX + (nbt.scaleX - bt.scaleX) * easedProgress,
                                    scaleY: bt.scaleY + (nbt.scaleY - bt.scaleY) * easedProgress
                                };
                            });
                            newInterp[l.name] = layerInterp;
                        }
                    });
                    
                    // Set the ref directly without triggering a UI root update
                    interpTransformsGlobalRef.current = newInterp;
                }
            }
            playbackFrameId.current = requestAnimationFrame(runPlayback);
        };

        playbackFrameId.current = requestAnimationFrame(runPlayback);
        return () => {
            cancelAnimationFrame(playbackFrameId.current);
            lastTick.current = 0;
        };
    }, [isPlaying, playbackSpeed, useInterpolation]);

    const openExportMenu = () => {
        if (frames.length === 0) return;
        setIsExportMenuOpen(true);
    };

    const handleExport = async () => {
        if (frames.length === 0) return;
        setIsExportMenuOpen(false);
        setIsShowingPreview(true);
        setExportedFile(null);
        setIsExporting(true);
        setExportProgress(0);
        setIsPlaying(false);

        let imageCache: Map<string, HTMLImageElement> | null = null;

        try {
            const fps = Math.max(1, typeof playbackSpeed === 'number' && playbackSpeed > 0 ? playbackSpeed : (settings?.fps || 12));
            // OPTIMIZATION: Prevent OOM (Out Of Memory) crashes on low-end mobile devices!
            // Never exceed ~1920px on the longest edge, calculate exact safest scale
            const maxDimension = 1920; 
            const longestEdge = Math.max(canvasSize.width, canvasSize.height);
            let safeScale = exportFormat === 'video' ? 2 : 1;
            
            if (longestEdge * safeScale > maxDimension) {
                safeScale = maxDimension / longestEdge;
            }

            let exportWidth = Math.round(canvasSize.width * safeScale);
            let exportHeight = Math.round(canvasSize.height * safeScale);
            // H.264 / MP4 requires width and height to be even (divisible by 4 for maximum hardware compatibility)
            exportWidth = Math.floor(exportWidth / 4) * 4;
            exportHeight = Math.floor(exportHeight / 4) * 4;

            const renderCanvas = document.createElement('canvas');
            renderCanvas.width = exportWidth;
            renderCanvas.height = exportHeight;
            const rCtx = renderCanvas.getContext('2d', { willReadFrequently: true });
            if (!rCtx) throw new Error("Could not create rendering context");

            let muxer: any = null;
            let videoEncoder: any = null;
            let encoderError: any = null;
            let actualVideoCodec = videoCodec;
            let gifFrames: { delay: number, data: Uint8ClampedArray }[] = [];
            let zip: any = null;

            // PRE-FLIGHT CAPABILITY CHECKS FOR AUDIO CODEC
            let selectedAudioCodec: string | null = null;
            let muxerAudioCodec: 'aac' | 'opus' | null = null;

            if (audioBuffer && typeof AudioEncoder !== 'undefined') {
                const audioSampleRate = audioBuffer.sampleRate;
                const audioChannels = 2; // Normalize to stereo for native compatibility

                if (exportFormat === 'video' && videoCodec === 'mp4') {
                    // 1. Try AAC first
                    try {
                        const aacSupport = await AudioEncoder.isConfigSupported({
                            codec: 'mp4a.40.2',
                            sampleRate: audioSampleRate,
                            numberOfChannels: audioChannels,
                            bitrate: 128000
                        });
                        if (aacSupport.supported) {
                            const testEncoder = new AudioEncoder({
                                output: () => {},
                                error: () => {}
                            });
                            testEncoder.configure({
                                codec: 'mp4a.40.2',
                                sampleRate: audioSampleRate,
                                numberOfChannels: audioChannels,
                                bitrate: 128000
                            });
                            testEncoder.close();
                            selectedAudioCodec = 'mp4a.40.2';
                            muxerAudioCodec = 'aac';
                        }
                    } catch (e) {}

                    // 2. Fallback to Opus in MP4 if AAC is not supported
                    if (!selectedAudioCodec) {
                        try {
                            const opusSupport = await AudioEncoder.isConfigSupported({
                                codec: 'opus',
                                sampleRate: audioSampleRate,
                                numberOfChannels: audioChannels,
                                bitrate: 128000
                            });
                            if (opusSupport.supported) {
                                const testEncoder = new AudioEncoder({
                                    output: () => {},
                                    error: () => {}
                                });
                                testEncoder.configure({
                                    codec: 'opus',
                                    sampleRate: audioSampleRate,
                                    numberOfChannels: audioChannels,
                                    bitrate: 128000
                                });
                                testEncoder.close();
                                selectedAudioCodec = 'opus';
                                muxerAudioCodec = 'opus';
                            }
                        } catch (e) {}
                    }
                } else if (exportFormat === 'video') {
                    // For WebM, use Opus
                    try {
                        const opusSupport = await AudioEncoder.isConfigSupported({
                            codec: 'opus',
                            sampleRate: audioSampleRate,
                            numberOfChannels: audioChannels,
                            bitrate: 128000
                        });
                        if (opusSupport.supported) {
                            const testEncoder = new AudioEncoder({
                                output: () => {},
                                error: () => {}
                            });
                            testEncoder.configure({
                                codec: 'opus',
                                sampleRate: audioSampleRate,
                                numberOfChannels: audioChannels,
                                bitrate: 128000
                            });
                            testEncoder.close();
                            selectedAudioCodec = 'opus';
                            muxerAudioCodec = 'opus';
                        }
                    } catch (e) {}
                }
            }

            if (exportFormat === 'video') {
                const frameDurationMicro = Math.round(1000000 / fps);

                // Pre-flight codec checker to see if a configuration genuinely works without throwing async error callbacks
                const testCodec = async (codec: string, isWebm: boolean): Promise<boolean> => {
                    if (typeof VideoEncoder === 'undefined') return false;
                    
                    try {
                        const config = {
                            codec,
                            width: exportWidth,
                            height: exportHeight,
                            displayWidth: exportWidth,
                            displayHeight: exportHeight,
                            bitrate: 5_000_000,
                            framerate: fps,
                            hardwareAcceleration: "no-preference" as HardwareAcceleration,
                            alpha: (isWebm && isCanvasTransparent) ? 'keep' as AlphaOption : 'discard' as AlphaOption
                        };
                        const support = await VideoEncoder.isConfigSupported(config);
                        if (!support.supported) return false;
                    } catch (e) {
                        return false;
                    }

                    return new Promise((resolve) => {
                        let resolved = false;
                        let encoder: VideoEncoder | null = null;

                        const cleanup = () => {
                            if (encoder) {
                                try { encoder.close(); } catch {}
                                encoder = null;
                            }
                        };
                        const handleSuccess = () => {
                            if (!resolved) {
                                resolved = true;
                                resolve(true);
                            }
                            cleanup();
                        };
                        const handleFailure = () => {
                            if (!resolved) {
                                resolved = true;
                                resolve(false);
                            }
                            cleanup();
                        };

                        try {
                            encoder = new VideoEncoder({
                                output: () => {},
                                error: (e) => {
                                    handleFailure();
                                }
                            });

                            encoder.configure({
                                codec,
                                width: exportWidth,
                                height: exportHeight,
                                displayWidth: exportWidth,
                                displayHeight: exportHeight,
                                bitrate: 5_000_000,
                                framerate: fps,
                                hardwareAcceleration: "no-preference",
                                alpha: (isWebm && isCanvasTransparent) ? 'keep' : 'discard'
                            });

                            // Give it a tiny bit of time to verify if it throws an error during/after configure
                            setTimeout(() => {
                                handleSuccess();
                            }, 30);
                        } catch (e) {
                            handleFailure();
                        }
                    });
                };

                let selectedCodec = '';
                if (actualVideoCodec === 'mp4') {
                    const mp4Candidates = [
                        'avc1.64002a', // H.264 High Profile, Level 4.2
                        'avc1.640028', // H.264 High Profile, Level 4.0
                        'avc1.4d402a', // H.264 Main Profile, Level 4.2
                        'avc1.4d401f', // H.264 Main Profile, Level 3.1
                        'avc1.42e02a', // H.264 Baseline Profile, Level 4.2
                        'avc1.42e01f',  // H.264 Baseline Profile, Level 3.1
                        'av01.0.04M.08', // AV1 Profile 0, Level 3.0, Main tier, 8-bit
                        'vp09.00.10.08'  // VP9 Profile 0, 8-bit
                    ];
                    for (const codec of mp4Candidates) {
                        const isOk = await testCodec(codec, false);
                        if (isOk) {
                            selectedCodec = codec;
                            break;
                        }
                    }

                    if (!selectedCodec) {
                        console.warn("No MP4/AVC codecs supported. Defaulting to avc1.4d402a.");
                        selectedCodec = 'avc1.4d402a';
                    }
                }

                if (actualVideoCodec === 'webm') {
                    const webmCandidates = [
                        'vp09.00.10.08', // VP9 Profile 0, 8-bit
                        'vp8',           // VP8
                        'av01.0.04M.08'  // AV1 Profile 0, Level 3.0, Main tier, 8-bit
                    ];
                    for (const codec of webmCandidates) {
                        const isOk = await testCodec(codec, true);
                        if (isOk) {
                            selectedCodec = codec;
                            break;
                        }
                    }

                    if (!selectedCodec) {
                        selectedCodec = 'vp8'; // Default fallback
                    }
                }

                if (actualVideoCodec === 'mp4') {
                    const { Muxer: Mp4Muxer, ArrayBufferTarget } = await import('mp4-muxer');
                    muxer = new Mp4Muxer({
                        target: new ArrayBufferTarget(),
                        video: {
                            codec: selectedCodec.startsWith('vp09') ? 'vp9' : (selectedCodec.startsWith('av01') ? 'av1' : 'avc'),
                            width: exportWidth,
                            height: exportHeight
                        },
                        audio: muxerAudioCodec ? {
                            codec: muxerAudioCodec,
                            numberOfChannels: 2,
                            sampleRate: audioBuffer!.sampleRate
                        } : undefined,
                        fastStart: 'in-memory',
                        firstTimestampBehavior: 'strict'
                    });
                    if (typeof VideoEncoder !== 'undefined') {
                         videoEncoder = new VideoEncoder({
                            output: (chunk: any, meta: any) => {
                                const chunkProxy = new Proxy(chunk, {
                                    get(target, prop) {
                                        if (prop === 'duration') {
                                            return frameDurationMicro;
                                        }
                                        const val = Reflect.get(target, prop);
                                        return typeof val === 'function' ? val.bind(target) : val;
                                    }
                                });
                                muxer.addVideoChunk(chunkProxy, meta);
                            },
                            error: (e: any) => {
                                console.error("Video encoder error callback active:", e);
                                encoderError = e;
                            }
                        });
                        try {
                            await videoEncoder.configure({
                                codec: selectedCodec,
                                width: exportWidth,
                                height: exportHeight,
                                displayWidth: exportWidth,
                                displayHeight: exportHeight,
                                bitrate: 5_000_000, 
                                framerate: fps,
                                hardwareAcceleration: "no-preference",
                                alpha: 'discard'
                             });
                             await new Promise(r => setTimeout(r, 20));
                        } catch (err) {
                            console.warn("Configure failed during actual setup:", err);
                            throw err;
                        }
                    } else {
                         throw new Error('VideoEncoder not supported in this browser.');
                    }
                } else {
                    const { Muxer, ArrayBufferTarget } = await import('webm-muxer');

                    let webmMuxerCodec: 'V_VP9' | 'V_VP8' | 'V_AV1' = 'V_VP9';
                    if (selectedCodec === 'vp8') {
                        webmMuxerCodec = 'V_VP8';
                    } else if (selectedCodec.startsWith('av01')) {
                        webmMuxerCodec = 'V_AV1';
                    }

                    muxer = new Muxer({
                        target: new ArrayBufferTarget(),
                        video: {
                            codec: webmMuxerCodec,
                            width: exportWidth,
                            height: exportHeight,
                            frameRate: fps
                        },
                        audio: selectedAudioCodec ? {
                            codec: 'A_OPUS',
                            numberOfChannels: 2,
                            sampleRate: audioBuffer!.sampleRate
                        } : undefined
                    });

                    if (typeof VideoEncoder !== 'undefined') {
                         videoEncoder = new VideoEncoder({
                            output: (chunk: any, meta: any) => {
                                const chunkProxy = new Proxy(chunk, {
                                    get(target, prop) {
                                        if (prop === 'duration') {
                                            return frameDurationMicro;
                                        }
                                        const val = Reflect.get(target, prop);
                                        return typeof val === 'function' ? val.bind(target) : val;
                                    }
                                });
                                muxer.addVideoChunk(chunkProxy, meta);
                            },
                            error: (e: any) => {
                                console.error("Video encoder error callback active:", e);
                                encoderError = e;
                            }
                        });
                        try {
                            await videoEncoder.configure({
                                codec: selectedCodec,
                                width: exportWidth,
                                height: exportHeight,
                                displayWidth: exportWidth,
                                displayHeight: exportHeight,
                                bitrate: 5_000_000, 
                                framerate: fps,
                                hardwareAcceleration: "no-preference",
                                alpha: isCanvasTransparent ? 'keep' : 'discard'
                            });
                            await new Promise(r => setTimeout(r, 20));
                        } catch (err) {
                            console.warn("VP9 configure failed during actual setup:", err);
                            throw err;
                        }
                    } else {
                         throw new Error('VideoEncoder not supported in this browser.');
                    }
                }
            }
            
            let gameFrames: string[] = [];
            if (exportFormat === 'gif') {
                gifFrames = [];
            } else if (exportFormat === 'zip') {
                const JSZip = (await import('jszip')).default;
                zip = new JSZip();
            } else if (exportFormat === 'game') {
                gameFrames = [];
            }

            // Set up audio encoder and variables before the frame loop for interleaved, synchronized rendering
            let audioEncoder: AudioEncoder | null = null;
            const hasAudio = !!audioBuffer && audioBuffer.length > 0;
            const sampleRate = audioBuffer ? audioBuffer.sampleRate : 48000;
            const audioChans: Float32Array[] = [];
            const frameTime = 1 / fps;
            const audioBlockSize = Math.ceil(frameTime * sampleRate) + 10;
            const pData = new Float32Array(audioBlockSize * 2);

            if (exportFormat === 'video' && hasAudio && selectedAudioCodec) {
                try {
                    audioEncoder = new AudioEncoder({
                        output: (chunk: any, meta: any) => muxer.addAudioChunk(chunk, meta),
                        error: (e: any) => console.error("Audio Encoder async error:", e)
                    });
                    audioEncoder.configure({
                        codec: selectedAudioCodec,
                        sampleRate: sampleRate,
                        numberOfChannels: 2,
                        bitrate: 128000
                    });

                    for (let c = 0; c < audioBuffer.numberOfChannels; c++) {
                        audioChans.push(audioBuffer.getChannelData(c));
                    }
                } catch (audioSetupErr) {
                    console.error("Failed to setup audio encoder:", audioSetupErr);
                    audioEncoder = null;
                }
            }

            // Wait for preview modal to mount and render fully
            await new Promise(r => setTimeout(r, 600));

            // Compute scaling
            const scaleX = exportWidth / canvasSize.width;
            const scaleY = exportHeight / canvasSize.height;

            // Image cache for ultra high speed rendering and 0 memory leaks during export
            imageCache = new Map<string, HTMLImageElement>();

            for (let i = 0; i < frames.length; i++) {
                const frame = frames[i];
                setCurrentFrameIndex(i); // Still update timeline for visual feedback in UI
                
                if (encoderError) {
                    throw new Error("Video encoding failed: " + (encoderError.message || encoderError));
                }

                // Clear and draw background
                rCtx.globalAlpha = 1.0;
                rCtx.clearRect(0, 0, exportWidth, exportHeight);
                if (exportFormat !== 'game' && (!isCanvasTransparent || exportFormat !== 'zip')) {
                    // Force background for video/gif to avoid artifacts
                    rCtx.fillStyle = (canvasBgColor && canvasBgColor !== 'transparent') ? canvasBgColor : '#ffffff';
                    rCtx.fillRect(0, 0, exportWidth, exportHeight);
                }

                rCtx.save();
                rCtx.scale(scaleX, scaleY);

                if (frame.layers) {
                    const visibleLayers = frame.layers.filter(l => l.visible && l.dataUri);
                    const loadedImages = await Promise.all(visibleLayers.map(layer => {
                        return new Promise<{ layer: any, img: HTMLImageElement }>((resolve) => {
                            const uri = layer.dataUri!;
                            if (imageCache.has(uri)) {
                                resolve({ layer, img: imageCache.get(uri)! });
                                return;
                            }
                            const img = new Image();
                            img.crossOrigin = "anonymous";
                            img.onload = () => {
                                imageCache.set(uri, img);
                                resolve({ layer, img });
                            };
                            img.onerror = () => {
                                resolve({ layer, img });
                            };
                            img.src = uri;
                        });
                    }));

                    for (const { layer, img } of loadedImages) {
                        rCtx.globalAlpha = layer.opacity !== undefined ? layer.opacity : 1;
                        
                        const hasBones = layer.bones && layer.bones.length > 0;
                        if (hasBones) {
                            const currentTransforms = layer.boneTransforms || {};
                            drawWarpedImage(rCtx, img, canvasSize.width, canvasSize.height, layer.bones!, currentTransforms, layer.rigType || 'MESH');
                        } else {
                            rCtx.drawImage(img, 0, 0, canvasSize.width, canvasSize.height);
                        }
                    }
                }
                
                rCtx.restore();

                if (exportFormat === 'video') {
                    // Convert HTMLCanvas to VideoFrame
                    const frameDurationMicro = Math.round(1000000 / fps);
                    const timestamp = Math.round((i * 1000000) / fps);
                    const vf = new VideoFrame(renderCanvas, { 
                        timestamp,
                        duration: frameDurationMicro
                    });
                    videoEncoder.encode(vf, { keyFrame: i % 30 === 0 });
                    vf.close();

                    // Encode corresponding audio chunk for this frame to maintain interleaving and high performance!
                    if (audioEncoder && audioBuffer) {
                        const start = Math.floor((i * frameTime) * sampleRate);
                        const end = Math.min(audioBuffer.length, Math.floor(((i + 1) * frameTime) * sampleRate));
                        const actualLen = end - start;
                        if (actualLen > 0) {
                            for (let ch = 0; ch < 2; ch++) {
                                const chanIdx = ch < audioChans.length ? ch : 0;
                                const sub = audioChans[chanIdx].subarray(start, end);
                                pData.set(sub, ch * actualLen);
                            }
                            const aPack = new AudioData({ 
                                format: 'f32-planar', 
                                sampleRate, 
                                numberOfFrames: actualLen, 
                                numberOfChannels: 2, 
                                timestamp: timestamp, 
                                data: pData.subarray(0, actualLen * 2) 
                            });
                            audioEncoder.encode(aPack);
                            aPack.close();
                        }
                    }

                    // Throttle to avoid memory exhaustion! Keep queue tiny to prevent RAM crash on low end devices.
                    while (videoEncoder.state === 'configured' && videoEncoder.encodeQueueSize > 2) {
                        if (encoderError) break;
                        await new Promise(r => setTimeout(r, 5));
                    }
                } else if (exportFormat === 'gif') {
                    const imgData = rCtx.getImageData(0, 0, exportWidth, exportHeight);
                    gifFrames.push({
                        delay: 1000 / fps,
                        data: new Uint8ClampedArray(imgData.data)
                    });
                } else if (exportFormat === 'zip') {
                    const blob = await new Promise<Blob | null>(res => renderCanvas.toBlob(res, "image/png"));
                    if (blob) {
                        const frameNum = String(i + 1).padStart(4, '0');
                        zip.file(`frame_${frameNum}.png`, blob);
                    }
                } else if (exportFormat === 'game') {
                    const dataUrl = renderCanvas.toDataURL("image/png");
                    gameFrames.push(dataUrl);
                }

                setExportProgress(((i + 1) / frames.length) * 100);
                
                // Yield to main thread briefly so UI updates
                await new Promise(r => setTimeout(r, 0)); 
            }

            if (exportFormat === 'video') {
                if (audioEncoder) {
                    try {
                        await Promise.race([
                            audioEncoder.flush(),
                            new Promise((_, reject) => setTimeout(() => reject(new Error("Audio flush timeout")), 10000))
                        ]);
                        audioEncoder.close();
                    } catch (e) {
                        console.warn("AudioEncoder flush failed:", e);
                    }
                }

                try {
                    await Promise.race([
                        videoEncoder.flush(),
                        new Promise((_, reject) => setTimeout(() => reject(new Error("Video flush timeout")), 10000))
                    ]);
                    videoEncoder.close();
                } catch (e) {
                    console.warn("VideoEncoder flush failed:", e);
                }

                muxer.finalize();
                const buffer = muxer.target.buffer;
                const blob = new Blob([buffer], { type: actualVideoCodec === 'mp4' ? 'video/mp4' : 'video/webm' });
                const url = URL.createObjectURL(blob);
                setExportedFile({ url, type: 'video', blob, extension: actualVideoCodec === 'mp4' ? 'mp4' : 'webm' });
            } else if (exportFormat === 'gif') {
                const modernGif = await import('modern-gif');
                setExportProgress(99); // Indicate encoding phase
                const buffer = await modernGif.encode({
                    width: exportWidth,
                    height: exportHeight,
                    frames: gifFrames
                });
                const blob = new Blob([buffer], { type: 'image/gif' });
                const url = URL.createObjectURL(blob);
                setExportedFile({ url, type: 'gif', blob, extension: 'gif' });
            } else if (exportFormat === 'zip') {
                const content = await zip.generateAsync({ type: 'blob' });
                const url = URL.createObjectURL(content);
                setExportedFile({ url, type: 'zip', blob: content, extension: 'zip' });
            } else if (exportFormat === 'game') {
                const gameProj = {
                    type: "anim_game",
                    version: "1.0",
                    name: settings?.name || "Game Animation",
                    fps: fps,
                    frames: gameFrames
                };
                const content = new Blob([JSON.stringify(gameProj, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(content);
                setExportedFile({ url, type: 'game', blob: content, extension: 'anim_game' });
            }
            
        } catch (e) {
            console.error(e);
            showAppToast("Export failed: " + (e as Error).message);
        } finally {
            setIsExporting(false);
            setExportProgress(null);
            if (imageCache) {
                imageCache.clear();
            }
        }
    };

    const handleCopy = () => {
        if (!transformImageUri) return;
        setClipboardContent({
            dataUri: transformImageUri,
            width: transformNaturalSize.width,
            height: transformNaturalSize.height,
            x: transformState.x,
            y: transformState.y,
            scale: transformState.scale,
            scaleX: transformState.scaleX,
            scaleY: transformState.scaleY,
            rotation: transformState.rotation,
            flipX: transformState.flipX,
            flipY: transformState.flipY,
            originX: transformState.originX,
            originY: transformState.originY,
            sourceLayerId: activeLayerId || undefined
        });
        triggerLocalToast("Copied to clipboard");
    };

    const handleCut = () => {
        if (!transformImageUri) return;
        setClipboardContent({
            dataUri: transformImageUri,
            width: transformNaturalSize.width,
            height: transformNaturalSize.height,
            x: transformState.x,
            y: transformState.y,
            scale: transformState.scale,
            scaleX: transformState.scaleX,
            scaleY: transformState.scaleY,
            rotation: transformState.rotation,
            flipX: transformState.flipX,
            flipY: transformState.flipY,
            originX: transformState.originX,
            originY: transformState.originY,
            sourceLayerId: activeLayerId || undefined
        });
        setIsTransforming(false);
        setIsLassoMode(false);
        setTransformImageUri(null);
        triggerLocalToast("Cut to clipboard");
    };

    const handleRemoveBackground = async () => {
        const activeLayer = getActiveLayer();
        if (!activeLayer || !activeLayer.dataUri) return;
        
        setBgRemovalOrigUri(activeLayer.dataUri);
        setBgRemovalPreviewUri(activeLayer.dataUri);
        setBgRemovalMode('lineart'); // Default to high-performance line art extractor
        setBgRemovalThreshold(220);
        setBgRemovalSmoothness(15);
        setBgRemovalInfillJoints(true);
        setBgRemovalInkColorMode('preserve');
        setIsBgRemovalModalOpen(true);
    };

    const applyAdvancedBgRemoval = async () => {
        const activeLayer = getActiveLayer();
        if (!activeLayer || !bgRemovalOrigUri) return;
        
        setIsProcessingBgRemoval(true);
        try {
            saveActiveLayer();
            pushToUndoHistory(framesRef.current);
            
            let finalUri = "";
            if (bgRemovalMode === 'ai') {
                triggerLocalToast(t('Removing background using AI...'));
                const foregroundBlob = await imglyRemoveBackground(bgRemovalOrigUri, {
                    publicPath: 'https://cdn.jsdelivr.net/npm/@imgly/background-removal-data@1.4.5/dist/',
                    debug: true
                });
                finalUri = await new Promise<string>((resolve) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result as string);
                    reader.readAsDataURL(foregroundBlob);
                });
            } else {
                finalUri = bgRemovalPreviewUri || bgRemovalOrigUri;
            }
            
            setFrames(prev => {
                const next = [...prev];
                const frameIdx = currentFrameIndexRef.current;
                if (!next[frameIdx] || !next[frameIdx].layers) return next;
                
                const frame = { ...next[frameIdx] };
                const layers = [...frame.layers!];
                
                const activeLayerIdx = layers.findIndex(l => l.id === activeLayer.id);
                if (activeLayerIdx === -1) return next;
                
                layers[activeLayerIdx] = { ...layers[activeLayerIdx], dataUri: finalUri };
                
                frame.layers = layers;
                next[frameIdx] = frame;
                
                setTimeout(() => {
                    loadActiveLayerToCanvas();
                    triggerLocalToast(t('Background removed!'));
                }, 100);
                
                return next;
            });
            
            setIsBgRemovalModalOpen(false);
        } catch (error: any) {
            console.error("Background Removal Failed", error);
            triggerLocalToast(t(`Failed to remove background: ${error.message || error}`));
        } finally {
            setIsProcessingBgRemoval(false);
        }
    };

    const handleSeparateSubject = async () => {
        const activeLayer = getActiveLayer();
        if (!activeLayer || !activeLayer.dataUri) return;
        
        triggerLocalToast(t('Separating character & filling background...'));
        try {
            saveActiveLayer();
            pushToUndoHistory(framesRef.current);
            
            const originalUri = activeLayer.dataUri;
            
            const foregroundBlob = await imglyRemoveBackground(originalUri, {
                publicPath: 'https://cdn.jsdelivr.net/npm/@imgly/background-removal-data@1.4.5/dist/',
                debug: true
            });
            const foregroundUri = await new Promise<string>((resolve) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result as string);
                reader.readAsDataURL(foregroundBlob);
            });

            // Auto-fill background hole
            triggerLocalToast(t('Inpainting background...'));
            const inpaintedUri = await fastInpaint(originalUri, foregroundUri);
            
            setFrames(prev => {
                const next = [...prev];
                const frameIdx = currentFrameIndexRef.current;
                if (!next[frameIdx] || !next[frameIdx].layers) return next;
                
                const frame = { ...next[frameIdx] };
                const layers = [...frame.layers!];
                
                const activeLayerIdx = layers.findIndex(l => l.id === activeLayer.id);
                if (activeLayerIdx === -1) return next;
                
                // Replace current layer with inpainted background
                layers[activeLayerIdx] = { ...layers[activeLayerIdx], dataUri: inpaintedUri };

                const newLayer: FrameLayer = {
                    id: `layer_${Date.now()}_${Math.random().toString(36).substring(7)}`,
                    name: 'Subject',
                    dataUri: foregroundUri,
                    visible: true,
                    opacity: 1
                };
                
                layers.splice(activeLayerIdx + 1, 0, newLayer);
                
                frame.layers = layers;
                next[frameIdx] = frame;
                
                setTimeout(() => {
                    setActiveLayerId(newLayer.id);
                    triggerLocalToast(t('Separation complete!'));
                }, 100);
                
                return next;
            });
            
        } catch (error: any) {
            console.error("Auto Separation Failed", error);
            triggerLocalToast(t(`Failed to separate: ${error.message || error}`));
        }
    };

    const handlePaste = () => {
        if (!clipboardContent) return;
        
        // Check if user selected a different layer from the source layer
        const hasSelectedNewLayer = clipboardContent.sourceLayerId && activeLayerId !== clipboardContent.sourceLayerId;
        
        startTransformation(clipboardContent.dataUri, clipboardContent.x, clipboardContent.y, {
            scale: clipboardContent.scale,
            scaleX: clipboardContent.scaleX,
            scaleY: clipboardContent.scaleY,
            rotation: clipboardContent.rotation,
            flipX: clipboardContent.flipX,
            flipY: clipboardContent.flipY,
            originX: clipboardContent.originX,
            originY: clipboardContent.originY,
        }, true);
        
        setIsLassoMode(false); // Disable lasso/selection tool to avoid double transformation/pasting loops
        setIsLassoExtraction(true); // Ensures the pasted element is composited properly over the target background
        
        if (hasSelectedNewLayer) {
            triggerLocalToast("Pasted to selected layer");
        } else {
            triggerLocalToast("Pasted in the same layer");
        }
        
        // Set clipboard to null so it can only be pasted once and the paste button/logic disappears
        setClipboardContent(null);
    };

    const PenButtonIcon = (activeBrush.category !== 'ERASER' && activeBrush.category !== 'FILL' && activeBrush.category !== 'PICKER' && activeBrush.icon) ? activeBrush.icon : PenTool;

    return (
        <>
            <div className={`fixed inset-0 bg-[#121214] flex flex-col font-sans text-gray-200 transition-all duration-700 ${isShowingPreview ? 'p-0' : ''}`}>
            {isSaving && (
                <div className="absolute inset-0 z-[99999] bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center">
                    <Loader2 size={48} className="text-cyan-500 animate-spin mb-4" />
                    <span className="text-white font-bold tracking-widest uppercase">{t('Saving Project...')}</span>
                </div>
            )}
            <div className={`flex flex-col h-full w-full transition-all duration-700 ${isShowingPreview ? 'blur-2xl scale-95 opacity-30 pointer-events-none' : ''}`}>
                {showBrushLibrary && (
                    <BrushLibrary 
                        currentBrushId={activeBrush.id}
                        onSelect={(brush) => { setActiveBrush(brush); setShowBrushLibrary(false); setIsSettingsOpen(true); }}
                        onClose={() => setShowBrushLibrary(false)}
                    />
                )}
                {showAudioImportManager && (
                    <AudioImportManager 
                        onClose={() => setShowAudioImportManager(false)}
                        onLoad={(file) => {
                            importAudioFile(file);
                            setShowAudioImportManager(false);
                            triggerLocalToast(t('Audio Imported'));
                        }}
                    />
                )}

                <div className="h-14 bg-black/40  border-b border-white/5 flex items-center justify-between px-3 md:px-6 shrink-0 z-[200]">
                <div className="flex items-center gap-2 md:gap-4 overflow-hidden">
                    <button 
                        type="button"
                        onClick={handleSave} 
                        title="Save & Go Back"
                        className="p-2 hover:bg-white/5 rounded-full text-gray-400 hover:text-white transition-colors active:scale-90"
                    >
                        <ChevronLeft size={20}/>
                    </button>
                    <div className="w-px h-6 bg-white/10 hidden md:block"></div>
                    <div className="flex items-center gap-3">
                        <Logo size={24} showText={false} />
                        <div className="flex flex-col truncate">
                            <span className="text-[10px] font-black tracking-widest text-[#ec4899] uppercase leading-none mb-0.5">{t('ANIMATO')}</span>
                            <h2 className="text-xs font-bold text-gray-200 truncate max-w-[120px] md:max-w-xs">{settings?.name || "Untitled"}</h2>
                        </div>
                    </div>
                </div>

                <div className="flex-1 flex items-center justify-start md:justify-center px-1 mx-2 h-full min-w-0 overflow-x-auto overflow-y-hidden custom-scrollbar no-scrollbar">
                    <div 
                        className="flex items-center gap-1 bg-black/80 p-1 rounded-2xl border border-white/10 shadow-inner pointer-events-auto shrink-0 md:mx-auto"
                        onWheel={(e) => e.stopPropagation()}
                    >
                        <button 
                            onClick={() => {
                                if (activeBrush.category === 'ERASER' || activeBrush.category === 'FILL') {
                                    setActiveBrush({ 
                                        id: 'pen_g', name: 'G-Pen', category: 'PEN', engine: 'INK_G_PEN', 
                                        size: 4, opacity: 1, spacing: 0.1, hardness: 1, icon: PenTool 
                                    });
                                }
                                setIsSettingsOpen(true);
                            }}
                            onDoubleClick={() => setShowBrushLibrary(true)}
                            className={`relative p-3 rounded-2xl transition-all duration-300 shadow-sm ${activeBrush.category !== 'ERASER' && activeBrush.category !== 'FILL' && activeBrush.category !== 'PICKER' ? 'text-white bg-cyan-600 shadow-[0_0_15px_rgba(6,182,212,0.4)]' : 'text-gray-400 hover:bg-white/5 hover:text-white'}`}
                        >
                            <PenButtonIcon size={20}/>
                        </button>
                        <button 
                            onClick={() => {
                                setActiveBrush({ 
                                    id: 'eraser_hard', name: 'Eraser', category: 'ERASER', engine: 'ERASER_HARD', 
                                    size: 20, opacity: 1, spacing: 0.1, icon: Eraser 
                                });
                                setIsSettingsOpen(true);
                            }} 
                            className={`relative p-3 rounded-2xl transition-all duration-300 shadow-sm ${activeBrush.category === 'ERASER' ? 'text-white bg-red-600 shadow-[0_0_15px_rgba(220,38,38,0.4)]' : 'text-gray-400 hover:bg-white/5 hover:text-white'}`}
                        >
                            <Eraser size={20}/>
                        </button>
                        <button 
                            onClick={() => {
                                setActiveBrush({
                                    id: 'bucket', name: 'Fill Bucket', category: 'FILL', engine: 'INK_G_PEN',
                                    size: 0, opacity: 1, icon: PaintBucket
                                });
                                setIsSettingsOpen(true);
                            }}
                            className={`relative p-3 rounded-2xl transition-all duration-300 shadow-sm ${activeBrush.category === 'FILL' ? 'text-white bg-amber-600 shadow-[0_0_15px_rgba(217,119,6,0.4)]' : 'text-gray-400 hover:bg-white/5 hover:text-white'}`}
                        >
                            <PaintBucket size={20}/>
                        </button>
                        <div className="w-[2px] h-6 bg-white/5 mx-2 rounded-full"></div>
                        {/* RULER TOOL UI */}
                        <div className="relative">
                            <button
                                onClick={() => { 
                                    if(activeTool !== 'RULER') { 
                                        setActiveTool('RULER'); 
                                        setShowRulerMenu(true); 
                                    } else { 
                                        if (!showRulerMenu) {
                                            setShowRulerMenu(true);
                                        } else {
                                            setActiveTool('PEN'); 
                                            setShowRulerMenu(false); 
                                        }
                                    } 
                                }}
                                className={`relative p-3 rounded-xl transition-all ${activeTool === 'RULER' 
                                    ? 'text-white bg-cyan-500/20' 
                                    : 'text-gray-400 bg-white/5 hover:text-white'}`}
                                title={t('Ruler Tool')}
                            >
                                <Ruler size={20} />
                                {activeTool === 'RULER' && (
                                    <motion.div layoutId="tool-active" className="absolute inset-0 bg-cyan-500/20 rounded-xl -z-10 shadow-[0_0_15px_rgba(6,182,212,0.4)]" />
                                )}
                            </button>
                        </div>

                        {activeTool === 'RULER' && showRulerMenu && createPortal(
                            <motion.div 
                                drag
                                dragMomentum={false}
                                dragConstraints={{ left: -300, right: 300, top: -500, bottom: 50 }}
                                className="fixed top-20 left-20 bg-[#0a0a0a]/90 backdrop-blur-md border border-cyan-500/30 p-3 rounded-2xl shadow-2xl flex flex-col gap-2 z-[999999] min-w-[160px] cursor-grab active:cursor-grabbing ring-1 ring-white/10 pointer-events-auto"
                            >
                                <div className="flex items-center justify-between px-2 py-1">
                                    <div className="text-[10px] font-black text-cyan-400 uppercase tracking-widest">Ruler Mode</div>
                                    <button onClick={() => setShowRulerMenu(false)} className="text-gray-500 hover:text-white"><X size={14}/></button>
                                </div>
                                {['CIRCLE', 'BOX', 'LINE', 'SYMMETRY'].map(type => (
                                    <button 
                                        key={type}
                                        onClick={() => setActiveRuler(type as any)}
                                        className={`px-4 py-2.5 rounded-xl text-sm font-medium text-left flex items-center justify-between transition-all ${
                                            activeRuler === type 
                                            ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-lg' 
                                            : 'text-gray-300 bg-white/5 hover:bg-white/10'
                                        }`}
                                    >
                                        {type}
                                        {activeRuler === type && <Check size={14} className="ml-2"/>}
                                    </button>
                                ))}
                            </motion.div>,
                            document.body
                        )}
                        <div className="w-[2px] h-6 bg-white/5 mx-2 rounded-full"></div>

                        <button 
                            onClick={() => applyTransform(canvasTransformRef.current.x, canvasTransformRef.current.y, 1)}
                            className="p-3 text-gray-500 hover:text-white hover:bg-white/5 rounded-xl transition-all"
                            title={t('Reset Zoom')}
                        >
                            <Ratio size={20}/>
                        </button>
                        <div className="w-[2px] h-6 bg-white/5 mx-2 rounded-full"></div>
                        
                        {/* TRANSFORM / SELECT TOOL */}
                        <div className="flex gap-1">
                            <button 
                                onClick={() => {
                                    const currentLayer = getCurrentFrame().layers?.find(l => l.id === activeLayerId);
                                    if (currentLayer && currentLayer.dataUri) {
                                        const isRigged = currentLayer.bones && currentLayer.bones.length > 0;
                                        const img = new Image();
                                        img.onload = () => {
                                            setIsLassoExtraction(false);
                                            if (isRigged) {
                                                // Create a baked version of the warped state
                                                const bakeCanvas = document.createElement('canvas');
                                                bakeCanvas.width = canvasSize.width;
                                                bakeCanvas.height = canvasSize.height;
                                                const bCtx = bakeCanvas.getContext('2d');
                                                if (bCtx) {
                                                    drawWarpedImage(bCtx, img, canvasSize.width, canvasSize.height, currentLayer.bones!, currentLayer.boneTransforms || {}, currentLayer.rigType || 'MESH');
                                                    startTransformation(bakeCanvas.toDataURL(), 0, 0);
                                                }
                                            } else {
                                                startTransformation(currentLayer.dataUri, 0, 0);
                                            }
                                        };
                                        img.src = currentLayer.dataUri;
                                    }
                                }}
                                className={`p-3 rounded-xl transition-all ${isTransforming && !isLassoMode ? 'text-amber-500 bg-amber-500/10' : 'text-gray-500 hover:bg-white/5'}`}
                                title={t('Free Transform (Move/Scale Active Layer)')}
                            >
                                <Move size={20}/>
                            </button>
                            <div className="relative group">
                                <button 
                                    onClick={() => {
                                        const nextLassoMode = !isLassoMode;
                                        setIsLassoMode(nextLassoMode);
                                        if (nextLassoMode) {
                                            setIsTransforming(false);
                                            setLastCanvasColor(canvasBgColor || '#ffffff');
                                            setCanvasBgColor?.('#000000');
                                        } else {
                                            setCanvasBgColor?.(lastCanvasColor);
                                        }
                                    }}
                                    className={`p-3 rounded-xl transition-all ${isLassoMode ? 'text-pink-500 bg-cyan-500/20 shadow-[0_0_15px_rgba(6,182,212,0.3)]' : 'text-gray-500 hover:bg-white/5'}`}
                                    title={t('Move Drawn Object (Lasso)')}
                                >
                                    <Scissors size={20}/>
                                </button>
                                {clipboardContent && isLassoMode && (
                                    <button 
                                        onClick={handlePaste}
                                        className="absolute -bottom-12 left-1/2 -translate-x-1/2 px-3 py-1.5 bg-cyan-600 text-white text-[10px] font-bold rounded-lg shadow-xl animate-in fade-in slide-in-from-top-2 whitespace-nowrap z-[1001] flex items-center gap-2 border border-white/20 hover:bg-cyan-500 transition-colors"
                                    >
                                        <ClipboardPaste size={12}/> {t('PASTE')}
                                    </button>
                                )}
                            </div>
                        </div>

                        <div className="w-[2px] h-6 bg-white/5 mx-2 rounded-full"></div>

                        {/* SMOOTHING CONTROL */}
                        <div className="flex flex-col gap-1 px-3 min-w-[100px] hidden landscape:flex sm:flex">
                            <span className="text-[8px] font-black text-gray-500 uppercase tracking-tighter">{t('SMOOTHING')}</span>
                            <div className="flex items-center gap-2">
                                <input 
                                    type="range" min="0" max="0.95" step="0.05"
                                    value={smoothing}
                                    onChange={(e) => setSmoothing(parseFloat(e.target.value))}
                                    className="w-20 h-1 bg-white/10 rounded-full appearance-none accent-cyan-500"
                                />
                                <span className="text-[9px] font-mono text-cyan-500">{(smoothing * 100).toFixed(0)}</span>
                            </div>
                        </div>

                        <div className="w-px h-6 bg-white/10 mx-1.5 opacity-40 hidden landscape:block sm:block"></div>

                        {/* IMPORT & MAGIC TOOLS */}
                        <button 
                            onClick={() => {
                                const input = document.createElement('input');
                                input.type = 'file';
                                input.accept = 'image/*';
                                input.onchange = (e) => importImageFile(e as unknown as React.ChangeEvent<HTMLInputElement>);
                                input.click();
                            }}
                            className="p-3 text-gray-500 hover:text-white hover:bg-white/5 rounded-xl transition-all flex flex-col items-center gap-1"
                            title={t('Import Image (Offline)')}
                        >
                            <ImageIcon size={20}/>
                        </button>

                        <div className="relative group">
                            <button 
                                onClick={() => {
                                    if (showMagicOptions) {
                                        // Menu is open, close it and reset brush
                                        setShowMagicOptions(false);
                                        if (activeBrush.id === 'magic_eraser') {
                                            setActiveBrush({
                                                id: 'pen_g',
                                                name: 'G-Pen',
                                                category: 'PEN',
                                                engine: 'INK_G_PEN',
                                                size: 4,
                                                opacity: 1.0,
                                                spacing: 0.1,
                                                hardness: 1.0,
                                                icon: PenTool
                                            });
                                            if (lastCanvasColor) setCanvasBgColor?.(lastCanvasColor);
                                        }
                                    } else {
                                        // Menu is closed, open it and set brush
                                        setShowMagicOptions(true);
                                        if (activeBrush.id !== 'magic_eraser') {
                                            setLastCanvasColor(canvasBgColor || '#ffffff');
                                            setCanvasBgColor?.('#000000');
                                            setActiveBrush({
                                                id: 'magic_eraser',
                                                name: 'Magic Eraser',
                                                category: 'ERASER',
                                                engine: 'SPECIAL',
                                                size: 1, opacity: 1, icon: Sparkles
                                            });
                                        }
                                    }
                                }}
                                className={`p-3 rounded-xl transition-all ${activeBrush.id === 'magic_eraser' ? 'text-amber-500 bg-amber-500/10' : 'text-gray-500 hover:bg-white/5'}`}
                                title={t('Magic Eraser (Remove Background)')}
                            >
                                <Sparkles size={20}/>
                            </button>
                            
                            {showMagicOptions && (
                                <div className="absolute top-full left-1/2 -translate-x-1/2 mt-4 bg-black/90 border border-white/10 p-2 rounded-xl shadow-[0_20px_60px_rgba(0,0,0,0.8)] flex flex-col gap-1 min-w-[180px] animate-in slide-in-from-top-2 z-[9999]" onPointerDown={e => e.stopPropagation()}>
                                    <div className="flex items-center gap-2 px-2 pt-1 pb-2 border-b border-white/5 mb-1">
                                        <Sparkles size={12} className="text-amber-400"/>
                                        <span className="text-[10px] font-black text-white uppercase tracking-widest">{t('AI Magic')}</span>
                                    </div>
                                    <button 
                                        onClick={() => {
                                            handleRemoveBackground();
                                            setShowMagicOptions(false);
                                            setActiveBrush({...activeBrush, id: 'basic_pen', category: 'PEN'});
                                        }}
                                        className="w-full text-left px-3 py-2.5 rounded-lg text-xs font-bold text-gray-300 hover:text-white hover:bg-white/10 transition-colors flex items-center justify-between group"
                                    >
                                        <span>{t('Remove Background')}</span>
                                        <Scissors size={12} className="opacity-0 group-hover:opacity-100 transition-opacity"/>
                                    </button>
                                    <button 
                                        onClick={() => {
                                            handleSeparateSubject();
                                            setShowMagicOptions(false);
                                            setActiveBrush({...activeBrush, id: 'basic_pen', category: 'PEN'});
                                        }}
                                        className="w-full text-left px-3 py-2.5 rounded-lg text-xs font-bold text-amber-500 hover:text-amber-400 hover:bg-amber-500/10 transition-colors flex items-center justify-between group"
                                    >
                                        <span>{t('Separate Subject')}</span>
                                        <Layers size={12} className="opacity-0 group-hover:opacity-100 transition-opacity"/>
                                    </button>
                                    
                                    <div className="mt-2 pt-2 border-t border-white/5 space-y-2">
                                        <div className="flex justify-between items-center px-1">
                                            <span className="text-[10px] text-gray-400 font-medium">Tolerance</span>
                                            <span className="text-[10px] text-amber-500 font-bold">{magicEraserThreshold}</span>
                                        </div>
                                        <input
                                            type="range"
                                            min="0"
                                            max="150"
                                            value={magicEraserThreshold}
                                            onChange={(e) => setMagicEraserThreshold(Number(e.target.value))}
                                            className="w-full accent-amber-500 h-1 bg-white/10 rounded-full appearance-none"
                                        />
                                        <label className="flex items-center gap-2 px-1 cursor-pointer group">
                                            <div className={`w-3 h-3 rounded flex items-center justify-center border transition-colors ${magicEraserContiguous ? 'bg-amber-500 border-amber-500 text-black' : 'border-white/20 bg-black'}`}>
                                                {magicEraserContiguous && <Check size={10} />}
                                            </div>
                                            <span className="text-[10px] font-medium text-gray-400 group-hover:text-gray-300">Contiguous Area</span>
                                            <input
                                                type="checkbox"
                                                className="hidden"
                                                checked={magicEraserContiguous}
                                                onChange={(e) => setMagicEraserContiguous(e.target.checked)}
                                            />
                                        </label>
                                    </div>

                                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-b-[6px] border-b-black/90"></div>
                                </div>
                            )}
                        </div>

                        <div className="w-[2px] h-6 bg-white/5 mx-2 rounded-full"></div>
                        <div className="flex bg-[#18181b] p-1 rounded-2xl border border-white/5 shadow-inner">
                            <button 
                                onClick={() => { setActiveBrush({...activeBrush, category: 'PEN'}); setShowColorPicker(!showColorPicker); }}
                                className={`w-10 h-10 rounded-xl relative transition-all flex items-center justify-center border font-bold text-[8px] bg-black hover:scale-105 duration-300 ${activeBrush.category === 'PEN' ? 'border-cyan-500 shadow-[0_0_15px_rgba(6,182,212,0.4)] z-10' : 'border-white/5 text-gray-500'}`}
                            >
                                <div className="absolute inset-x-1.5 bottom-1.5 h-1.5 rounded-full" style={{ backgroundColor: penColor }}></div>
                                <PenTool size={14} className={`mb-2 ${activeBrush.category === 'PEN' ? 'text-white' : 'text-gray-500'}`}/>
                            </button>
                            <button 
                                onClick={() => { setActiveBrush({...activeBrush, category: 'FILL'}); setShowColorPicker(!showColorPicker); }}
                                className={`w-10 h-10 rounded-xl relative transition-all flex items-center justify-center border font-bold text-[8px] bg-black hover:scale-105 duration-300 ${activeBrush.category === 'FILL' ? 'border-purple-500 shadow-[0_0_15px_rgba(168,85,247,0.4)] z-10' : 'border-transparent text-gray-500'}`}
                            >
                                <div className="absolute inset-x-1.5 bottom-1.5 h-1.5 rounded-full" style={{ backgroundColor: fillColor }}></div>
                                <PaintBucket size={14} className={`mb-2 ${activeBrush.category === 'FILL' ? 'text-white' : 'text-gray-500'}`}/>
                            </button>
                            <button 
                                onClick={() => { setShowTextModal(true); }}
                                className={`w-10 h-10 rounded-xl relative transition-all flex items-center justify-center border font-bold text-[8px] bg-black hover:scale-105 duration-300 border-transparent text-gray-500 hover:text-white`}
                            >
                                <Type size={14} className="mb-2"/>
                            </button>
                        </div>
                        <div className="w-[2px] h-6 bg-white/5 mx-2 rounded-full"></div>
                        <button 
                            onClick={() => {
                                if (isRiggingMode) {
                                    setIsRiggingMode(false);
                                } else if (getActiveLayer()) {
                                    setIsTransforming(false);
                                    setIsLassoMode(false);
                                    setShowRiggingPrompt(true);
                                }
                            }} 
                            disabled={!getActiveLayer()}
                            className={`relative p-3 rounded-xl transition-all ${isRiggingMode ? 'text-black' : 'text-gray-500 hover:bg-white/5 opacity-100'} ${!getActiveLayer() ? 'opacity-20 cursor-not-allowed' : ''}`}
                            title={t('Bone Rigging')}
                        >
                            <BoneIcon size={20}/>
                            {isRiggingMode && (
                                <motion.div layoutId="tool-active" className="absolute inset-0 bg-amber-500 rounded-xl -z-10" />
                            )}
                        </button>
                        
                        <div className="relative">
                            <button 
                                onClick={() => setOnionSkinEnabled(!onionSkinEnabled)} 
                                onDoubleClick={() => setShowOnionSkinMenu(true)}
                                className={`relative p-3 rounded-xl transition-all ${onionSkinEnabled ? 'text-cyan-400 bg-cyan-500/10 border-cyan-500/30' : 'text-gray-500 hover:bg-white/5 border-transparent'} border font-black`}
                                title={t('Onion Skin (Double Tap for Settings)')}
                            >
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <rect x="4" y="4" width="12" height="12" rx="2" ry="2" />
                                    <rect x="8" y="8" width="12" height="12" rx="2" ry="2" />
                                </svg>
                            </button>
                        </div>

                        <div className="w-[2px] h-6 bg-white/5 mx-2 rounded-full"></div>
                        
                        <button 
                            onClick={() => setShowLayersPanel(!showLayersPanel)} 
                            className={`relative p-3 rounded-xl transition-all ${showLayersPanel ? 'text-pink-400 bg-pink-500/10 border-pink-500/30 shadow-[0_0_15px_rgba(244,63,94,0.3)]' : 'text-gray-500 hover:bg-white/5 border-transparent'} border font-black`}
                            title={t('Layers Panel')}
                        >
                            <Layers size={20}/>
                        </button>
            </div>
        </div>


                <div className="relative shrink-0">
                    <button 
                        onClick={() => setShowHeaderMenu(!showHeaderMenu)}
                        className="p-2 hover:bg-white/5 rounded-full text-gray-400 hover:text-white transition-colors bg-white/5 border border-white/10"
                    >
                        <MoreVertical size={20}/>
                    </button>

                    {showHeaderMenu && (
                        <div className="absolute right-0 top-full mt-2 bg-[#111] border border-white/10 p-3 rounded-2xl shadow-2xl flex flex-col gap-3 z-[9999] min-w-[200px]" onPointerDown={e => e.stopPropagation()}>
                            <div className="flex items-center justify-between border-b border-white/5 pb-2">
                                <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{t('Menu')}</span>
                                <button onClick={() => setShowHeaderMenu(false)} className="text-gray-500 hover:text-white"><X size={14}/></button>
                            </div>
                            
                            <div className="flex flex-col gap-2">
                                <div className="flex flex-col gap-2 w-full">
                    {setCanvasBgColor && (
                        <button 
                            onClick={() => setShowBgColorPicker(true)}
                            className="p-2 mr-2 rounded-full border border-white/10 hover:border-white/30 transition-all flex items-center justify-center relative active:scale-95"
                            title={t('Canvas Background Color')}
                        >
                            <div className="w-5 h-5 rounded-full border border-white/20 shadow-inner" style={{ backgroundColor: canvasBgColor === 'transparent' ? '#fff' : canvasBgColor }}>
                                {canvasBgColor === 'transparent' && (
                                    <div className="absolute inset-0 rounded-full" style={{ backgroundImage: 'conic-gradient(#333 90deg, #444 90deg 180deg, #333 180deg 270deg, #444 270deg)', backgroundSize: '10px 10px' }} />
                                )}
                            </div>
                        </button>
                    )}

                    <div className="hidden landscape:flex sm:flex items-center bg-white/5 px-3 py-1.5 rounded-full border border-white/5 mr-2">
                        <span className="text-[9px] font-black text-gray-500 mr-2 uppercase tracking-tighter">{t('FRAME')}</span>
                        <span className="text-[10px] font-bold text-white">{currentFrameIndex + 1} / {frames.length}</span>
                    </div>
                    
                    <div className="flex flex-col items-stretch bg-black/80 light:bg-white/90 p-1 rounded-xl gap-1">
                        <button 
                            onClick={() => {
                                if (!isPlaying) saveActiveLayer();
                                setIsPlaying(!isPlaying);
                            }}
                            className={`p-2.5 rounded-lg transition-all active:scale-90 flex items-center justify-center gap-2 text-xs font-bold ${isPlaying ? 'bg-red-500/20 text-red-500' : 'bg-cyan-500 text-black shadow-lg shadow-cyan-900/20'}`}
                        >
                            {isPlaying ? <Pause size={16}/> : <Play size={16}/>}
                            {isPlaying ? t('PAUSE') : t('PLAY')}
                        </button>
                        <button 
                            onClick={() => {
                                setIsShowingPreview(true);
                                if (!isPlaying) {
                                    saveActiveLayer();
                                    setIsPlaying(true);
                                }
                            }}
                            className="px-4 py-2.5 rounded-lg bg-purple-500/10 text-purple-400 font-bold text-xs uppercase transition-all hover:bg-purple-500 hover:text-white active:scale-95 flex items-center justify-center gap-2"
                        >
                            <Monitor size={14}/> {t('PREVIEW')}
                        </button>
                        <button 
                            onClick={openExportMenu}
                            className="px-4 py-2.5 rounded-lg bg-green-500/10 text-green-400 font-bold text-xs uppercase transition-all hover:bg-green-500 hover:text-black active:scale-95 flex items-center justify-center gap-2"
                        >
                            <Download size={14}/> {t('EXPORT')}
                        </button>
                        <button 
                            onClick={handleSave}
                            className="px-4 py-2.5 rounded-lg bg-[#111] text-white font-bold text-xs uppercase border border-white/10 hover:border-cyan-500/30 transition-all active:scale-95 flex items-center justify-center gap-2" 
                        >
                            <Save size={14}/> {t('SAVE')}
                        </button>
                    </div>
                </div>
            
                            </div>
                        </div>
                    )}
                </div>

            </div>

            {/* WORKSPACE */}
            <div className="flex-1 flex relative overflow-hidden bg-[#0a0a0a]">
                {/* --- QUICK ACTION BUTTONS (Undo/Redo) --- */}
                <div className="absolute left-6 bottom-6 z-50 flex gap-2">
                    <button 
                        onClick={handleUndo} 
                        disabled={undoStack.length === 0}
                        className={`w-12 h-12 rounded-full flex items-center justify-center bg-[#18181b]/90 backdrop-blur-md border border-white/10 shadow-2xl transition-all ${undoStack.length === 0 ? 'text-gray-700 opacity-50' : 'text-gray-300 hover:text-white hover:bg-white/10 active:scale-95'}`}
                        title={t('Undo')}
                    >
                        <Undo size={24}/>
                    </button>
                    <button 
                        onClick={handleRedo} 
                        disabled={redoStack.length === 0}
                        className={`w-12 h-12 rounded-full flex items-center justify-center bg-[#18181b]/90 backdrop-blur-md border border-white/10 shadow-2xl transition-all ${redoStack.length === 0 ? 'text-gray-700 opacity-50' : 'text-gray-300 hover:text-white hover:bg-white/10 active:scale-95'}`}
                        title={t('Redo')}
                    >
                        <RotateCw size={24}/>
                    </button>
                </div>
                
                

                {/* --- COMPACT RIGGING MODE INDICATOR --- */}
                {isRiggingMode && (
                    <div className="absolute top-10 left-1/2 -translate-x-1/2 z-[300] flex flex-col items-center pointer-events-none">
                        <div className="bg-black/80  border border-white/10 rounded-full px-4 py-1 flex items-center gap-3 shadow-2xl animate-in zoom-in-95 duration-200">
                            <div className={`w-2 h-2 rounded-full animate-pulse ${riggingTool === 'BONE' ? 'bg-cyan-400' : riggingTool === 'HAND' ? 'bg-amber-400' : 'bg-red-500'}`} />
                            <span className="text-[10px] font-black text-white uppercase tracking-[0.2em] select-none">
                                {riggingTool === 'BONE' ? 'Job Bone' : riggingTool === 'HAND' ? 'Move Bone' : 'Delete Bone'}
                            </span>
                        </div>
                    </div>
                )}

                {/* --- FLOATING BONE INSPECTOR (Mini) --- */}
                {isRiggingMode && (activeBoneId || riggingTool === 'HAND') && (
                    <div 
                        className="draggable-panel absolute z-[250] bg-[#111]/95 border border-white/10 rounded-xl shadow-2xl w-48 overflow-hidden"
                        style={{ left: bonePanel.pos.x, top: bonePanel.pos.y }}
                        onPointerDown={(e) => e.stopPropagation()} 
                    >
                        <div 
                            className="px-3 py-2 border-b border-white/5 flex justify-between items-center bg-white/5 cursor-move touch-none"
                            onPointerDown={bonePanel.onPointerDown} 
                            onPointerMove={bonePanel.onPointerMove} 
                            onPointerUp={bonePanel.onPointerUp}
                        >
                            <span className="text-[8px] font-black text-cyan-400 tracking-wider uppercase">{t('BONE EDITOR')}</span>
                            <div className="flex gap-2">
                                <button onClick={() => setIsRiggingMode(false)} className="text-gray-500 hover:text-red-400"><X size={10}/></button>
                                <button onClick={applyRigging} className="text-green-500 hover:text-green-400"><Check size={10}/></button>
                            </div>
                        </div>

                        {!activeBoneId ? (
                            <div className="p-4 text-center text-gray-600 text-[8px] font-bold uppercase tracking-widest">
                                {t('Tap bone to edit')}
                            </div>
                        ) : (
                            <div className="p-3 space-y-2">
                                <div className="space-y-0.5">
                                    <div className="flex justify-between text-[7px] font-bold text-gray-500 uppercase tracking-tight">
                                        <span>{t('BEND')}</span>
                                        <span className="text-cyan-400 font-mono">{(boneTransforms[activeBoneId]?.rotation || 0).toFixed(0)}°</span>
                                    </div>
                                    <input 
                                        type="range" min="-180" max="180" 
                                        value={boneTransforms[activeBoneId]?.rotation || 0} 
                                        onChange={(e) => updateBoneTransform('rotation', parseFloat(e.target.value))}
                                        className="w-full h-1 bg-white/10 rounded appearance-none cursor-pointer accent-cyan-500"
                                    />
                                </div>
                                <div className="space-y-0.5">
                                    <div className="flex justify-between text-[7px] font-bold text-gray-500 uppercase tracking-tight">
                                        <span>{t('STRETCH')}</span>
                                        <span className="text-cyan-400 font-mono">{(boneTransforms[activeBoneId]?.scaleX || 1).toFixed(2)}x</span>
                                    </div>
                                    <input 
                                        type="range" min="0.5" max="2.0" step="0.05"
                                        value={boneTransforms[activeBoneId]?.scaleX || 1} 
                                        onChange={(e) => updateBoneTransform('scaleX', parseFloat(e.target.value))}
                                        className="w-full h-1 bg-white/10 rounded appearance-none cursor-pointer accent-cyan-500"
                                    />
                                </div>
                                <div className="space-y-0.5">
                                    <div className="flex justify-between text-[7px] font-bold text-gray-500 uppercase tracking-tight">
                                        <span>{t('WIDTH')}</span>
                                        <span className="text-cyan-400 font-mono">{(boneTransforms[activeBoneId]?.scaleY || 1).toFixed(2)}x</span>
                                    </div>
                                    <input 
                                        type="range" min="0.5" max="2.0" step="0.05"
                                        value={boneTransforms[activeBoneId]?.scaleY || 1} 
                                        onChange={(e) => updateBoneTransform('scaleY', parseFloat(e.target.value))}
                                        className="w-full h-1 bg-white/10 rounded appearance-none cursor-pointer accent-cyan-500"
                                    />
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* --- SETTINGS BUBBLE WHEN CLOSED --- */}
                {!isSettingsOpen && (
                    <div 
                        className={`draggable-panel absolute z-50 w-11 h-11 border rounded-full shadow-2xl flex items-center justify-center cursor-move touch-none transition-colors ${
                            activeBrush.category === 'ERASER' 
                                ? 'bg-red-950/40 border-red-500/30 text-red-400 hover:bg-red-900/60 shadow-red-500/20' 
                                : activeBrush.category === 'FILL'
                                ? 'bg-amber-950/40 border-amber-500/30 text-amber-400 hover:bg-amber-900/60 shadow-amber-500/20'
                                : 'bg-black/60 backdrop-blur-md'
                        }`}
                        style={{ 
                            left: settingsPanel.pos.x, 
                            top: settingsPanel.pos.y,
                            ...(activeBrush.category !== 'ERASER' && activeBrush.category !== 'FILL' 
                                ? { 
                                    borderColor: `${penColor}60`, // 60 is alpha in hex
                                    color: penColor,
                                    boxShadow: `0 0 20px ${penColor}30` 
                                  } 
                                : {})
                        }}
                        onPointerDown={settingsPanel.onPointerDown} 
                        onPointerMove={settingsPanel.onPointerMove} 
                        onPointerUp={settingsPanel.onPointerUp}
                        onClick={() => {
                            if (!settingsPanel.draggingRef.current && 
                                Math.abs(settingsPanel.pos.x - (settingsPanel.dragStartRef.current?.x || 0)) < 5 &&
                                Math.abs(settingsPanel.pos.y - (settingsPanel.dragStartRef.current?.y || 0)) < 5) {
                                // Due to implementation, delta from start pos can be checked
                            } 
                            // fallback just toggle
                            setIsSettingsOpen(true);
                        }}
                    >
                        {activeBrush.category === 'ERASER' ? (
                            <Eraser size={20} />
                        ) : activeBrush.category === 'FILL' ? (
                            <PaintBucket size={20} />
                        ) : (
                            <div className="flex items-center justify-center relative">
                                <PenButtonIcon size={20} className="text-white opacity-100" />
                                <div className="absolute -bottom-1 -right-1 w-2.5 h-2.5 rounded-full border border-[#18181b]" style={{ backgroundColor: penColor }}></div>
                            </div>
                        )}
                    </div>
                )}

                {/* --- FLOATING BRUSH SETTINGS PANEL (Draggable & High Z-Index) --- */}
                {isSettingsOpen && (
                    <div 
                        className="draggable-panel absolute z-50 bg-[#18181b]/95 backdrop-blur-xl border border-white/20 rounded-xl shadow-2xl w-64 overflow-hidden flex flex-col"
                        style={{ left: settingsPanel.pos.x, top: settingsPanel.pos.y, maxHeight: '80vh' }}
                        onPointerDown={(e) => e.stopPropagation()} 
                    >
                        <div 
                            className="p-3 border-b border-white/5 flex justify-between items-center bg-[#111] cursor-move touch-none"
                            onPointerDown={settingsPanel.onPointerDown} 
                            onPointerMove={settingsPanel.onPointerMove} 
                            onPointerUp={settingsPanel.onPointerUp}
                        >
                            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-2">
                                <GripHorizontal size={12}/> 
                                {activeBrush.category === 'PEN' ? t('BRUSH STUDIO') : activeBrush.category === 'ERASER' ? t('ERASER SETTINGS') : t('FILL SETTINGS')}
                            </span>
                            <button onClick={() => setIsSettingsOpen(false)}><X size={14} className="text-gray-500 hover:text-white"/></button>
                        </div>

                        <div className="p-4 max-h-[60vh] overflow-y-auto custom-scrollbar">
                            {/* BRUSH STUDIO LAUNCHER */}
                            {activeBrush.category === 'PEN' && (
                                <button 
                                    onClick={() => { setIsSettingsOpen(false); setShowBrushLibrary(true); }}
                                    className="w-full mb-4 py-2 border border-cyan-500/30 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 rounded-lg flex items-center justify-center gap-2 text-[10px] font-bold uppercase tracking-wider transition-colors shadow-sm"
                                >
                                    <PenTool size={14} />
                                    {t('OPEN BRUSH STUDIO')}
                                </button>
                            )}

                            {/* BRUSH PREVIEW */}
                            {activeBrush.category === 'PEN' && (
                                <div className="h-12 w-full bg-[#0a0a0a] rounded mb-4 flex items-center justify-center overflow-hidden border border-white/5">
                                    <div className="w-full h-1 bg-white/20 rounded-full mx-4 relative">
                                        <div 
                                            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
                                            style={{ 
                                                width: activeBrush.size, 
                                                height: activeBrush.size, 
                                                backgroundColor: currentColor,
                                                opacity: activeBrush.opacity,
                                                filter: activeBrush.texture ? 'url(#noise)' : 'none'
                                            }}
                                        />
                                    </div>
                                </div>
                            )}

                            {/* SLIDERS */}
                            {activeBrush.category !== 'FILL' && (
                                <div className="space-y-4">
                                    <div className="space-y-1">
                                        <div className="flex justify-between text-[9px] font-bold text-gray-500">
                                            <span>{t('SIZE')}</span>
                                            <span>{activeBrush.size}px</span>
                                        </div>
                                        <input 
                                            type="range" min="1" max="100" 
                                            value={activeBrush.size} 
                                            onChange={(e) => setActiveBrush({...activeBrush, size: parseInt(e.target.value)})}
                                            className="w-full h-1 bg-white/10 rounded appearance-none cursor-pointer accent-cyan-500"
                                        />
                                    </div>

                                    <div className="space-y-1">
                                        <div className="flex justify-between text-[9px] font-bold text-gray-500">
                                            <span>{t('OPACITY')}</span>
                                            <span>{(activeBrush.opacity * 100).toFixed(0)}%</span>
                                        </div>
                                        <input 
                                            type="range" min="0.1" max="1.0" step="0.1"
                                            value={activeBrush.opacity} 
                                            onChange={(e) => setActiveBrush({...activeBrush, opacity: parseFloat(e.target.value)})}
                                            className="w-full h-1 bg-white/10 rounded appearance-none cursor-pointer accent-cyan-500"
                                        />
                                    </div>

                                        <div className="space-y-1">
                                            <div className="flex justify-between text-[9px] font-bold text-gray-500">
                                                <span>{t('SPACING')}</span>
                                                <span>{((activeBrush.spacing || 0.1) * 100).toFixed(0)}%</span>
                                            </div>
                                            <input 
                                                type="range" min="0.05" max="3.0" step="0.05"
                                                value={activeBrush.spacing || 0.1} 
                                                onChange={(e) => setActiveBrush({...activeBrush, spacing: parseFloat(e.target.value)})}
                                                className="w-full h-1 bg-white/10 rounded appearance-none cursor-pointer accent-cyan-500"
                                            />
                                        </div>
                                </div>
                            )}

                            {(activeBrush.category !== 'FILL' && activeBrush.category !== 'ERASER') && (
                                <div className="h-px bg-white/5 my-4"></div>
                            )}

                            {/* COLOR TRIGGER */}
                            {activeBrush.category !== 'ERASER' && (
                                <div className="flex items-center gap-2">
                                    <button 
                                        onClick={() => setShowColorPicker(!showColorPicker)}
                                        className="flex-1 h-8 rounded border border-white/20 shadow-sm relative group transition-transform active:scale-95 flex items-center justify-center gap-2 mt-2"
                                        style={{ backgroundColor: currentColor }}
                                    >
                                        <Palette size={12} className="text-white mix-blend-difference"/>
                                        <span className="text-[9px] font-bold text-white mix-blend-difference">{t('PICK COLOR')}</span>
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* --- FLIPACLIP STYLE LAYERS PANEL (Draggable & Vertical) --- */}
                {showLayersPanel && (
                    <div 
                        className="draggable-panel absolute z-50 bg-[#111] border border-white/10 rounded-xl shadow-2xl flex flex-col w-64 overflow-hidden animate-in fade-in slide-in-from-right-4"
                        style={{ left: layerPanel.pos.x, top: layerPanel.pos.y, maxHeight: '60vh' }}
                        onPointerDown={(e) => e.stopPropagation()} 
                    >
                        {isSelectionMode ? (
                            <div 
                                className="p-3 border-b border-blue-500/30 flex justify-between items-center bg-[#0d1b2a] cursor-move touch-none"
                                onPointerDown={layerPanel.onPointerDown} 
                                onPointerMove={layerPanel.onPointerMove} 
                                onPointerUp={layerPanel.onPointerUp}
                            >
                                <span className="text-[10px] font-bold text-blue-400 uppercase tracking-widest flex items-center gap-2 animate-pulse">
                                    <Layers size={12}/> {t('SELECTING')} ({selectedLayerIds.length})
                                </span>
                                <button 
                                    onClick={() => { setIsSelectionMode(false); setSelectedLayerIds([]); }} 
                                    className="text-gray-400 hover:text-white text-[10px] font-black uppercase bg-white/10 px-2 py-1 rounded transition-colors"
                                >
                                    {t('Cancel')}
                                </button>
                            </div>
                        ) : (
                            <div 
                                className="p-3 border-b border-white/5 flex justify-between items-center bg-[#181818] cursor-move touch-none"
                                onPointerDown={layerPanel.onPointerDown} 
                                onPointerMove={layerPanel.onPointerMove} 
                                onPointerUp={layerPanel.onPointerUp}
                            >
                                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2">
                                    <GripHorizontal size={12}/> {t('LAYERS')}
                                </span>
                                <button onClick={() => setShowLayersPanel(false)}><X size={14} className="text-gray-500 hover:text-white"/></button>
                            </div>
                        )}
                        <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
                            {!isSelectionMode && (
                                <div className="relative mb-2 group">
                                    <button
                                        onClick={() => setShowLayerMagicOptions(!showLayerMagicOptions)}
                                        disabled={!getActiveLayer()?.dataUri}
                                        className="w-full flex items-center justify-center gap-2 bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 rounded-xl py-2 text-[10px] font-black uppercase tracking-widest transition-all disabled:opacity-50"
                                    >
                                        <Sparkles size={12} /> {t('MAGIC TOOLS')}
                                    </button>
                                    {showLayerMagicOptions && (
                                        <div className="absolute top-full left-0 z-[9999] mt-1 bg-black/90 border border-white/10 p-2 rounded-xl shadow-[0_20px_60px_rgba(0,0,0,0.8)] flex flex-col gap-1 min-w-[180px] animate-in slide-in-from-top-2" onPointerDown={e => e.stopPropagation()}>
                                            <button 
                                                onClick={() => {
                                                    handleRemoveBackground();
                                                    setShowLayerMagicOptions(false);
                                                }}
                                                className="w-full text-left px-3 py-2.5 rounded-lg text-xs font-bold text-gray-300 hover:text-white hover:bg-white/10 transition-colors flex items-center justify-between group"
                                            >
                                                <span>{t('Remove Background')}</span>
                                                <Scissors size={12} className="opacity-0 group-hover:opacity-100 transition-opacity"/>
                                            </button>
                                            <button 
                                                onClick={() => {
                                                    handleSeparateSubject();
                                                    setShowLayerMagicOptions(false);
                                                }}
                                                className="w-full text-left px-3 py-2.5 rounded-lg text-xs font-bold text-amber-500 hover:text-amber-400 hover:bg-amber-500/10 transition-colors flex items-center justify-between group"
                                            >
                                                <span>{t('Separate Subject')}</span>
                                                <Layers size={12} className="opacity-0 group-hover:opacity-100 transition-opacity"/>
                                            </button>
                                        </div>
                                    )}
                                </div>
                            )}
                            <Reorder.Group 
                                axis="y" 
                                values={visualLayers} 
                                onReorder={isSelectionMode ? () => {} : handleReorderLayers}
                                className="space-y-1"
                            >
                                {visualLayers.map((layer, index) => (
                                    <DraggableLayerItem 
                                        key={layer.id}
                                        layer={layer}
                                        activeLayerId={activeLayerId}
                                        editingLayerId={editingLayerId}
                                        setEditingLayerId={setEditingLayerId}
                                        setActiveLayerId={setActiveLayerId}
                                        renameLayer={renameLayer}
                                        updateFrameLayerOpacity={updateFrameLayerOpacity}
                                        toggleLayerVisibility={toggleLayerVisibility}
                                        duplicateLayer={duplicateLayer}
                                        deleteLayer={deleteLayer}
                                        pushToUndoHistory={pushToUndoHistory}
                                        framesRef={framesRef}
                                        t={t}
                                        onMoveUp={() => moveLayerUp(layer.id)}
                                        onMoveDown={() => moveLayerDown(layer.id)}
                                        isFirst={index === 0}
                                        isLast={index === visualLayers.length - 1}
                                        isSelectionMode={isSelectionMode}
                                        isSelected={selectedLayerIds.includes(layer.id)}
                                        onToggleSelect={handleToggleSelectLayer}
                                        onStartSelectionMode={handleStartSelectionMode}
                                    />
                                ))}
                            </Reorder.Group>
                        </div>

                        <div className="p-3 border-t border-white/5 bg-[#141414]">
                            {isSelectionMode ? (
                                <button 
                                    disabled={selectedLayerIds.length < 2}
                                    onClick={mergeSelectedLayers} 
                                    className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-800 disabled:text-gray-500 disabled:cursor-not-allowed text-white rounded-lg py-3 text-xs font-black tracking-wide shadow-lg shadow-blue-900/20 transition-all active:scale-95"
                                >
                                    <Layers size={14}/> {t('MERGE LAYERS')}
                                </button>
                            ) : (
                                <button onClick={addLayer} className="w-full flex items-center justify-center gap-2 bg-red-600 hover:bg-red-500 text-white rounded-lg py-3 text-xs font-black tracking-wide shadow-lg shadow-red-900/20 transition-all active:scale-95">
                                    <Plus size={14}/> {t('NEW LAYER')}
                                </button>
                            )}
                        </div>
                    </div>
                )}

                {/* COLOR PICKER POPOVER - FIXED Z-INDEX & POSITIONING */}
                {showColorPicker && (
                    <>
                        <div className="fixed inset-0 z-[999] bg-black/20" onClick={() => setShowColorPicker(false)}></div>
                        <div className="draggable-panel fixed z-[1002] animate-in zoom-in-95 duration-200" style={{ left: mainColorPickerPanel.pos.x, top: mainColorPickerPanel.pos.y }}>
                            <div className="relative">
                                <AdvancedColorPicker 
                                    initialColor={currentColor}
                                    onChange={setCurrentColor}
                                    onClose={() => setShowColorPicker(false)}
                                    onActivatePicker={() => {
                                        previousBrushRef.current = activeBrush;
                                        setActiveBrush({
                                            id: 'picker', name: 'Eyedropper', category: 'PICKER', engine: 'INK_G_PEN',
                                            size: 0, opacity: 1, icon: Pipette
                                        });
                                        setShowColorPicker(false);
                                    }}
                                    dragProps={{
                                        onPointerDown: mainColorPickerPanel.onPointerDown,
                                        onPointerMove: mainColorPickerPanel.onPointerMove,
                                        onPointerUp: mainColorPickerPanel.onPointerUp
                                    }}
                                />
                            </div>
                        </div>
                    </>
                )}

                {/* TEXT INPUT MODAL */}
                {showTextModal && (
                    <div className="fixed inset-0 z-[999] flex items-center justify-center">
                        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowTextModal(false)}></div>
                        <div className="relative z-[1000] w-full max-w-md bg-[#18181b] border border-white/10 p-6 rounded-3xl shadow-2xl animate-in zoom-in-95 duration-200">
                            <h3 className="text-white font-bold text-lg mb-4 flex items-center gap-2">
                                <Type size={18} className="text-cyan-400"/> {t('Add Text')}
                            </h3>
                            
                            <div className="space-y-4">
                                <textarea
                                    value={textInputData.text}
                                    onChange={(e) => setTextInputData({...textInputData, text: e.target.value})}
                                    placeholder={t('Type something...')}
                                    className="w-full bg-black/50 border border-white/10 rounded-xl p-3 text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500 min-h-[100px] resize-none"
                                />

                                <div className="grid grid-cols-2 gap-3">
                                    <div className="space-y-1">
                                        <label className="text-[10px] font-bold text-gray-500 uppercase">{t('Style Template')}</label>
                                        <select 
                                            value={textInputData.styleTemplate}
                                            onChange={(e) => setTextInputData({...textInputData, styleTemplate: e.target.value})}
                                            className="w-full bg-black/50 border border-white/10 rounded-lg p-2 text-white text-xs focus:outline-none focus:border-cyan-500"
                                        >
                                            <option value="none">{t('Custom')}</option>
                                            <option value="meme">{t('Meme (Impact)')}</option>
                                            <option value="subtitle">{t('Subtitle (Yellow)')}</option>
                                            <option value="comic">{t('Comic Bubble')}</option>
                                        </select>
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-[10px] font-bold text-gray-500 uppercase">{t('Font')}</label>
                                        <select 
                                            value={textInputData.font}
                                            onChange={(e) => setTextInputData({...textInputData, font: e.target.value})}
                                            disabled={textInputData.styleTemplate !== 'none'}
                                            className="w-full bg-black/50 border border-white/10 rounded-lg p-2 text-white text-xs focus:outline-none focus:border-cyan-500 disabled:opacity-50"
                                        >
                                            {["Arial", "Courier New", "Georgia", "Times New Roman", "Impact", "Comic Sans MS", "Verdana", "Trebuchet MS", "Tahoma", "Palatino Linotype", "Lucida Sans Unicode", "Garamond", "Bookman Old Style", "Century Gothic", "Arial Black", "Brush Script MT", "Consolas", "Didot", "Futura", "Geneva", "Helvetica", "Lucida Console", "Monaco", "Optima", "Rockwell", "Segoe UI", "Baskerville", "Bodoni MT", "Calibri", "Cambria", "Candara", "Corbel", "Franklin Gothic Medium", "Gill Sans", "Franklin Gothic Book", "Avenir", "Avenir Next", "Helvetica Neue", "Menlo", "PT Sans", "PT Serif", "Ubuntu", "Roboto", "Open Sans", "Lato", "Oswald", "Source Sans Pro", "Montserrat", "Raleway", "Merriweather", "Noto Sans", "Nunito", "Playfair Display", "Poppins", "Rubik", "Work Sans", "Fira Sans", "Quicksand", "Karla", "Inconsolata", "Bitter", "Oxygen", "Dosis", "Cabin", "Anton", "Josefin Sans", "Libre Baskerville", "Arvo", "Varela Round", "Fjalla One", "Crimson Text", "Signika", "Asap", "Hind", "Vollkorn", "Merriweather Sans", "Yanone Kaffeesatz", "Titimillium Web", "Archivo Narrow", "Muli", "Bree Serif", "Abel", "Questrial", "Kreon", "Monda", "Gudea", "Amaranth", "Rokkitt", "Hammersmith One", "Cousine", "Alegreya", "Istok Web", "Coda", "Francois One", "Cuprum", "Ruda", "Copse", "Doppio One", "Jura", "Voltaire", "Cantarell", "Exo", "Carrois Gothic", "Sintony", "Enriqueta", "Duru Sans", "Tauri", "Marmelad", "Alegreya Sans", "Rosario", "Economica", "Julius Sans One", "Changa One", "Antic", "Glegoo", "Scada", "Oranienbaum", "Tenor Sans", "Capriola", "Viga", "Actor", "Michroma", "Jockey One", "Nobile", "Squada One", "Rambla", "Oleo Script", "Spinnaker", "Gafata", "Linden Hill", "Candal", "Basic", "Numans", "Anaheim", "Andika", "Judson", "Gruppo", "Kite One", "Imprima", "Belgrano", "Salsa", "Coustard", "Ruluko", "Radley", "Pompiere", "Puritan", "Smythe", "Stoke", "Port Lligat Sans", "Gorditas", "Orienta", "Chau Philomene One", "Carme", "Kotta One", "Tienne", "Zeyada", "Macondo", "Aladin", "Milonga", "Stint Ultra Expanded", "Ribeye Marrow", "Nova Flat", "Geostar Fill", "Fugaz One", "Poller One", "Galdeano", "Uncial Antiqua", "Glass Antiqua", "Smokum", "Sancreek", "Ewert", "Frijole", "Nosifer", "Ribeye", "Miniver", "Shojumaru", "Vast Shadow", "Piedra", "Fasthand", "Irish Grover", "Underdog", "Rye", "New Rocker", "Trade Winds", "Bigelow Rules", "Mystery Quest", "Metal Mania", "Aclonica", "Creepster", "Eater", "Bungee", "Bungee Inline", "Bungee Outline", "Bungee Shade", "Bungee Hairline", "Monoton", "Fascinate", "Fascinate Inline", "Faster One", "Vampiro One", "Rubik Mono One", "Sigmar One", "Luckiest Guy", "Titan One", "Freckle Face", "Bangers", "Boogaloo", "Spicy Rice", "Chewy", "Black Ops One", "Russo One", "Kelly Slab", "Teko"].sort().map(font => (
                                                <option key={font} value={font} style={{ fontFamily: font }}>{font}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>

                                {textInputData.styleTemplate === 'none' && (
                                    <div className="grid grid-cols-3 gap-3">
                                        <div className="space-y-1">
                                            <label className="text-[10px] font-bold text-gray-500 uppercase">{t('Text Color')}</label>
                                            <div className="flex items-center gap-2 relative">
                                                <button 
                                                    onClick={() => setShowTextColorPicker(!showTextColorPicker)}
                                                    className="w-8 h-8 rounded border border-white/20 shadow-sm relative group transition-transform active:scale-95"
                                                    style={{ backgroundColor: textInputData.color }}
                                                />
                                                {showTextColorPicker && (
                                                    <div className="draggable-panel fixed z-[1002] animate-in zoom-in-95 duration-200" style={{ left: textColorPickerPanel.pos.x, top: textColorPickerPanel.pos.y }}>
                                                        <div className="relative">
                                                            <AdvancedColorPicker 
                                                                initialColor={textInputData.color}
                                                                onChange={(c) => setTextInputData({...textInputData, color: c})}
                                                                onClose={() => setShowTextColorPicker(false)}
                                                                dragProps={{
                                                                    onPointerDown: textColorPickerPanel.onPointerDown,
                                                                    onPointerMove: textColorPickerPanel.onPointerMove,
                                                                    onPointerUp: textColorPickerPanel.onPointerUp
                                                                }}
                                                            />
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-[10px] font-bold text-gray-500 uppercase">{t('Border Color')}</label>
                                            <div className="flex items-center gap-2 relative">
                                                <button 
                                                    onClick={() => setShowBorderColorPicker(!showBorderColorPicker)}
                                                    className="w-8 h-8 rounded border border-white/20 shadow-sm relative group transition-transform active:scale-95"
                                                    style={{ backgroundColor: textInputData.borderColor }}
                                                />
                                                {showBorderColorPicker && (
                                                    <div className="draggable-panel fixed z-[1002] animate-in zoom-in-95 duration-200" style={{ left: borderColorPickerPanel.pos.x, top: borderColorPickerPanel.pos.y }}>
                                                        <div className="relative">
                                                            <AdvancedColorPicker 
                                                                initialColor={textInputData.borderColor}
                                                                onChange={(c) => setTextInputData({...textInputData, borderColor: c})}
                                                                onClose={() => setShowBorderColorPicker(false)}
                                                                dragProps={{
                                                                    onPointerDown: borderColorPickerPanel.onPointerDown,
                                                                    onPointerMove: borderColorPickerPanel.onPointerMove,
                                                                    onPointerUp: borderColorPickerPanel.onPointerUp
                                                                }}
                                                            />
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-[10px] font-bold text-gray-500 uppercase">{t('Border Size')}</label>
                                            <input 
                                                type="number" 
                                                min="0" max="20"
                                                value={textInputData.borderWidth}
                                                onChange={(e) => setTextInputData({...textInputData, borderWidth: parseInt(e.target.value) || 0})}
                                                className="w-full bg-black/50 border border-white/10 rounded-lg p-1.5 text-white text-xs focus:outline-none focus:border-cyan-500 text-center"
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>
                            
                            <div className="flex gap-2 mt-6">
                                <button 
                                    onClick={() => setShowTextModal(false)}
                                    className="flex-1 py-2 rounded-xl border border-white/10 text-gray-400 hover:bg-white/5 hover:text-white transition-all text-xs font-bold"
                                >
                                    {t('CANCEL')}
                                </button>
                                <button 
                                    onClick={handleAddTextToCanvas}
                                    disabled={!textInputData.text.trim()}
                                    className="flex-1 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-black transition-all text-xs font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {t('ADD TO CANVAS')}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* BACKGROUND COLOR PICKER POPOVER */}
                {showBgColorPicker && setCanvasBgColor && (
                    <>
                        <div className="fixed inset-0 z-[999] bg-black/20" onClick={() => setShowBgColorPicker(false)}></div>
                        <div className="draggable-panel fixed z-[1002] animate-in zoom-in-95 duration-200" style={{ left: bgColorPickerPanel.pos.x, top: bgColorPickerPanel.pos.y }}>
                            <div className="relative">
                                <AdvancedColorPicker 
                                    initialColor={canvasBgColor}
                                    onChange={(color) => setCanvasBgColor(color)}
                                    onClose={() => setShowBgColorPicker(false)}
                                    dragProps={{
                                        onPointerDown: bgColorPickerPanel.onPointerDown,
                                        onPointerMove: bgColorPickerPanel.onPointerMove,
                                        onPointerUp: bgColorPickerPanel.onPointerUp
                                    }}
                                />
                            </div>
                        </div>
                    </>
                )}

                {/* CANVAS AREA */}
                <div 
                    ref={containerRef}
                    className="flex-1 bg-[#0c0c0e] relative p-4 md:p-8 py-10 md:py-12 overflow-hidden touch-none min-h-0 min-w-0 outline-none"
                    onContextMenu={e => e.preventDefault()}
                    tabIndex={0}
                    onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
                    onDrop={(e) => {
                        e.preventDefault();
                        const file = e.dataTransfer.files?.[0];
                        if (!file) {
                            const textData = e.dataTransfer.getData("text/plain") || e.dataTransfer.getData("text");
                            if (textData && (textData.startsWith("data:image/") || textData.startsWith("http"))) {
                                importImageFromDataUri(textData);
                            }
                            return;
                        }
                        if (file.type.startsWith('video/')) {
                             extractVideoFrames(file, Number.isNaN(playbackSpeed) || playbackSpeed <= 0 ? (settings?.fps || 24) : playbackSpeed);
                        } else if (file.type.startsWith('image/')) {
                             const reader = new FileReader();
                             reader.onload = async (ev) => {
                                 if (ev.target?.result && typeof ev.target.result === 'string') {
                                     await importImageFromDataUri(ev.target.result);
                                 }
                             };
                             reader.readAsDataURL(file);
                        }
                    }}
                >
                    <div style={{ containerType: 'size' }} className="w-full h-full flex items-center justify-center relative">
                        <div 
                            ref={canvasWrapperRef}
                            className="relative bg-white ring-1 ring-white/10 origin-center flex shrink-0" 
                            style={{ 
                                transform: `translate3d(${canvasTransformRef.current.x}px, ${canvasTransformRef.current.y}px, 0) scale(${canvasTransformRef.current.scale}) rotate(${canvasTransformRef.current.rotation}deg)`,
                                width: `min(100cqw, 100cqh * ${canvasSize.width / canvasSize.height})`,
                                height: `min(100cqh, 100cqw / ${canvasSize.width / canvasSize.height})`,
                                background: isCanvasTransparent ? 'transparent' : (canvasBgColor !== 'transparent' ? canvasBgColor : '#ffffff'),
                                cursor: isPanning ? 'grabbing' : 'crosshair'
                            }}
                        >
                        {isCanvasTransparent && (
                            <div className="absolute inset-0 z-0 opacity-10 pointer-events-none" style={{
                                backgroundImage: 'conic-gradient(#333 90deg, #444 90deg 180deg, #333 180deg 270deg, #444 270deg)',
                                backgroundSize: '20px 20px'
                            }}/>
                        )}

                        {referenceVideoUrl && (
                            <video
                                src={referenceVideoUrl}
                                ref={videoRef}
                                muted
                                playsInline
                                className="absolute inset-0 w-full h-full object-contain pointer-events-none"
                                style={{ opacity: videoOpacity, zIndex: 1 }}
                            />
                        )}
                        
                        {/* RENDER INACTIVE LAYERS / PLAYBACK CACHE / ONION SKIN */}
                        {(() => {
                            let indices = [currentFrameIndex];
                            if (isPlaying) {
                                const nextIdx = (currentFrameIndex + 1) % Math.max(1, frames.length);
                                const prevIdx = (currentFrameIndex - 1 + frames.length) % Math.max(1, frames.length);
                                indices.push(nextIdx, prevIdx);
                            } else if (onionSkinEnabled) {
                                for (let i = 1; i <= onionSkinSettings.prev; i++) {
                                    if (currentFrameIndex - i >= 0) indices.push(currentFrameIndex - i);
                                }
                                for (let i = 1; i <= onionSkinSettings.next; i++) {
                                    if (currentFrameIndex + i < frames.length) indices.push(currentFrameIndex + i);
                                }
                            }
                            return Array.from(new Set(indices));
                        })().map(frameIdx => {
                            const frame = frames[frameIdx];
                            if (!frame) return null;
                            const isCurrentFrame = frameIdx === currentFrameIndex;
                            
                            const isOnionSkinPrev = onionSkinEnabled && !isPlaying && frameIdx >= currentFrameIndex - onionSkinSettings.prev && frameIdx < currentFrameIndex;
                            const isOnionSkinNext = onionSkinEnabled && !isPlaying && frameIdx <= currentFrameIndex + onionSkinSettings.next && frameIdx > currentFrameIndex;
                            const isOnionSkin = isOnionSkinPrev || isOnionSkinNext;

                            const isVisible = isCurrentFrame || isOnionSkin;
                            const distance = Math.abs(frameIdx - currentFrameIndex);
                            
                            // Optimization: Keep stack fully visible during transformation
                            const transformOverlayOpacity = 1.0;
                            const finalOpacity = (isOnionSkin ? onionSkinSettings.opacity / distance : 1) * transformOverlayOpacity;

                            return (
                                <div 
                                    key={frame.id} 
                                    className="absolute inset-0 w-full h-full pointer-events-none transition-opacity duration-150"
                                    style={{ 
                                        visibility: isVisible ? 'visible' : 'hidden',
                                        zIndex: isCurrentFrame ? 10 : (isOnionSkin ? 5 : 0),
                                        opacity: finalOpacity,
                                    }}
                                >
                                    <div className={`w-full h-full ${isOnionSkin ? 'saturate-200' : ''} ${isOnionSkinPrev ? 'sepia hue-rotate-[-50deg]' : (isOnionSkinNext ? 'sepia hue-rotate-[50deg]' : '')}`}>
                                        {frame.layers?.filter(l => l.visible).map((layer, index) => (
                                            <React.Fragment key={layer.id}>
                                                <div style={{ zIndex: index * 10, position: 'absolute', inset: 0 }}>
                                                    <LayerRenderer 
                                                        layer={layer}
                                                        isActiveFrame={isCurrentFrame}
                                                        activeLayerId={isCurrentFrame ? activeLayerId : null}
                                                        isPlaying={isPlaying}
                                                        canvasSize={canvasSize}
                                                        getDynamicTransforms={isPlaying ? (() => interpTransformsGlobalRef.current?.[layer.name]) : undefined}
                                                        isTransforming={isTransforming}
                                                        isLassoExtraction={isLassoExtraction}
                                                        isRiggingMode={isRiggingMode}
                                                        isLowPerformanceMode={isLowPerformanceMode}
                                                    />
                                                </div>
                                                {isCurrentFrame && activeLayerId === layer.id && !isPlaying && !isRiggingMode && (!isTransforming || isLassoExtraction) && (
                                                    <div className={`absolute inset-0 w-full h-full ${isTransforming ? 'pointer-events-none' : 'pointer-events-auto'}`} style={{ zIndex: index * 10 + 5, opacity: layer.opacity !== undefined ? layer.opacity : 1 }}>
                                                        <canvas 
                                                            ref={canvasRef}
                                                            className="absolute inset-0 w-full h-full touch-none"
                                                        />
                                                        {!isTransforming && (
                                                            <>
                                                                <canvas 
                                                                    ref={previewCanvasRef}
                                                                    onPointerDown={startDrawing}
                                                                    onPointerMove={drawMove}
                                                                    onPointerUp={stopDrawing}
                                                                    onPointerLeave={stopDrawing}
                                                                    className={`absolute inset-0 w-full h-full touch-none ${activeBrush.category === 'ERASER' ? 'cursor-cell' : 'cursor-crosshair'}`}
                                                                />
                                                                <canvas 
                                                                    ref={rulerCanvasRef}
                                                                    className="absolute inset-0 w-full h-full touch-none pointer-events-none"
                                                                />
                                                                {clipboardContent && (
                                                                    <button 
                                                                        onClick={handlePaste}
                                                                        className="absolute top-4 right-4 p-2.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl shadow-2xl z-[500] flex items-center gap-2 animate-in fade-in zoom-in slide-in-from-top-4 transition-all active:scale-95 border border-white/20 group pointer-events-auto"
                                                                        title={t('PASTE TO NEW LAYER')}
                                                                    >
                                                                        <ClipboardPaste size={20} className="text-white"/>
                                                                        <span className="text-[10px] font-black uppercase tracking-tight pr-1">{t('PASTE')}</span>
                                                                    </button>
                                                                )}
                                                            </>
                                                        )}
                                                    </div>
                                                )}
                                            </React.Fragment>
                                        ))}
                                    </div>
                                </div>
                            );
                        })}

                        {/* LASSO PREVIEW */}
                        {isLassoDrawing && lassoPoints.length > 1 && (
                            <svg className="absolute inset-0 w-full h-full pointer-events-none z-[400]" viewBox={`0 0 ${canvasSize.width} ${canvasSize.height}`}>
                                <defs>
                                    <filter id="lassoGlow" x="-20%" y="-20%" width="140%" height="140%">
                                        <feGaussianBlur stdDeviation="4" result="blur" />
                                        <feComposite in="SourceGraphic" in2="blur" operator="over" />
                                    </filter>
                                </defs>
                                <polyline 
                                    points={lassoPoints.map(p => `${p.x},${p.y}`).join(' ')}
                                    fill="rgba(6, 182, 212, 0.15)"
                                    stroke="rgb(6, 182, 212)"
                                    strokeWidth="3"
                                    strokeDasharray="6 4"
                                    filter="url(#lassoGlow)"
                                />
                                <polyline 
                                    points={lassoPoints.map(p => `${p.x},${p.y}`).join(' ')}
                                    fill="none"
                                    stroke="white"
                                    strokeWidth="1.5"
                                    strokeDasharray="6 4"
                                />
                            </svg>
                        )}

                        {/* ACTIVE LAYER (Interactive) or RIGGING VIEW or TRANSFORM VIEW */}                        {!isPlaying && isTransforming && transformImageUri ? (
                            <>
                                <div className="absolute inset-0 w-full h-full z-[300] bg-transparent pointer-events-none">                                    <div 
                                        className={`absolute border-2 border-dashed border-cyan-500 group p-1 select-none pointer-events-auto shadow-[0_0_15px_rgba(6,182,212,0.3)] ${transformMode === 'rotate' ? 'cursor-alias' : 'cursor-move'}`}
                                        style={{
                                            left: `${(transformState.x / canvasSize.width) * 100}%`,
                                            top: `${(transformState.y / canvasSize.height) * 100}%`,
                                            width: `${(transformState.scale * transformState.scaleX * (transformNaturalSize.width || 1) / canvasSize.width) * 100}%`,
                                            height: `${(transformState.scale * transformState.scaleY * (transformNaturalSize.height || 1) / canvasSize.height) * 100}%`,
                                            transformOrigin: `${transformState.originX}% ${transformState.originY}%`,
                                            transform: `rotate(${transformState.rotation}deg) scale(${transformState.flipX ? -1 : 1}, ${transformState.flipY ? -1 : 1}) translateX(-0.5%) translateY(-0.5%)`
                                        }}
                                        onPointerDown={(e) => {
                                            // Make sure we didn't click on a handle
                                            if ((e.target as HTMLElement).closest('.transform-handle')) return;
                                            
                                            e.preventDefault();
                                            const target = e.currentTarget;
                                            const container = target.parentElement;
                                            
                                            if (transformMode === 'rotate') {
                                                const rect = target.getBoundingClientRect();
                                                const centerX = rect.left + rect.width * (transformState.originX / 100);
                                                const centerY = rect.top + rect.height * (transformState.originY / 100);
                                                const startAngle = Math.atan2(e.clientY - centerY, e.clientX - centerX);
                                                const initialRotation = transformState.rotation;
                                                let currentRotation = initialRotation;
                                                
                                                const handleMove = (moveEvent: PointerEvent) => {
                                                    const currentAngle = Math.atan2(moveEvent.clientY - centerY, moveEvent.clientX - centerX);
                                                    const angleDiff = ((currentAngle - startAngle) * 180) / Math.PI;
                                                    currentRotation = (initialRotation + angleDiff) % 360;
                                                    target.style.transform = `rotate(${currentRotation}deg) scale(${transformState.flipX ? -1 : 1}, ${transformState.flipY ? -1 : 1}) translateX(-0.5%) translateY(-0.5%)`;
                                                };
                                                
                                                const handleUp = () => {
                                                    window.removeEventListener('pointermove', handleMove);
                                                    window.removeEventListener('pointerup', handleUp);
                                                    setTransformState(prev => ({
                                                        ...prev,
                                                        rotation: currentRotation
                                                    }));
                                                };
                                                
                                                window.addEventListener('pointermove', handleMove);
                                                window.addEventListener('pointerup', handleUp);
                                            } else {
                                                const startX = e.clientX;
                                                const startY = e.clientY;
                                                const initialX = transformState.x;
                                                const initialY = transformState.y;
                                                let currentBoxX = initialX;
                                                let currentBoxY = initialY;
                                                
                                                let rafId: number;
                                                const handleMove = (moveEvent: PointerEvent) => {
                                                    const crect = container?.getBoundingClientRect();
                                                    if (!crect) return;
                                                    const ratioX = canvasSize.width / crect.width;
                                                    const ratioY = canvasSize.height / crect.height;
          
                                                    currentBoxX = initialX + (moveEvent.clientX - startX) * ratioX;
                                                    currentBoxY = initialY + (moveEvent.clientY - startY) * ratioY;
          
                                                    if (rafId) cancelAnimationFrame(rafId);
                                                    rafId = requestAnimationFrame(() => {
                                                        target.style.left = `${(currentBoxX / canvasSize.width) * 100}%`;
                                                        target.style.top = `${(currentBoxY / canvasSize.height) * 100}%`;
                                                    });
                                                };
                                                
                                                const handleUp = () => {
                                                    if (rafId) cancelAnimationFrame(rafId);
                                                    window.removeEventListener('pointermove', handleMove);
                                                    window.removeEventListener('pointerup', handleUp);
                                                    setTransformState(prev => ({
                                                        ...prev, x: currentBoxX, y: currentBoxY
                                                    }));
                                                };
                                                
                                                window.addEventListener('pointermove', handleMove);
                                                window.addEventListener('pointerup', handleUp);
                                            }
                                        }}
                                    >
                                        {transformImageUri ? <img 
                                            src={transformImageUri} 
                                            alt="Transform" 
                                            className="w-full h-full object-fill pointer-events-none select-none max-w-none" 
                                            style={{ display: 'block', width: '100%', height: '100%', objectFit: 'fill', visibility: transformNaturalSize.width > 1 ? 'visible' : 'hidden' }} 
                                            onLoad={(e) => {
                                                const img = e.target as HTMLImageElement;
                                                setTransformNaturalSize({ width: img.naturalWidth, height: img.naturalHeight });
                                            }}
                                        /> : null}

                                        {/* Origin / Anchor Handle */}
                                        <div 
                                            className="transform-handle absolute w-10 h-10 -ml-5 -mt-5 flex items-center justify-center cursor-move z-40 group"
                                            style={{ 
                                                left: `${transformState.originX}%`, 
                                                top: `${transformState.originY}%` 
                                            }}
                                            onPointerDown={(e) => {
                                                e.stopPropagation();
                                                e.preventDefault();
                                                const startXLoc = e.clientX;
                                                const startYLoc = e.clientY;
                                                const initialOriginX = transformState.originX;
                                                const initialOriginY = transformState.originY;
                                                const initialX = transformState.x;
                                                const initialY = transformState.y;
                                                const theta_rad = (transformState.rotation * Math.PI) / 180;
                                                const sx = transformState.flipX ? -1 : 1;
                                                const sy = transformState.flipY ? -1 : 1;
                                                const W = transformState.scale * transformState.scaleX * (transformNaturalSize.width || 1);
                                                const H = transformState.scale * transformState.scaleY * (transformNaturalSize.height || 1);

                                                const targetLoc = e.currentTarget;
                                                const parentLoc = targetLoc.parentElement;
                                                
                                                const rectLoc = parentLoc?.getBoundingClientRect();
                                                if (!rectLoc) return;
                                                
                                                let currentOriginX = initialOriginX;
                                                let currentOriginY = initialOriginY;
                                                let currentX = initialX;
                                                let currentY = initialY;
                                                
                                                const handleMoveLoc = (moveEvent: PointerEvent) => {
                                                    const dx = moveEvent.clientX - startXLoc;
                                                    const dy = moveEvent.clientY - startYLoc;
                                                    const pctX = (dx / rectLoc.width) * 100;
                                                    const pctY = (dy / rectLoc.height) * 100;
                                                    
                                                    currentOriginX = Math.max(0, Math.min(100, initialOriginX + pctX));
                                                    currentOriginY = Math.max(0, Math.min(100, initialOriginY + pctY));
                                                    
                                                    const dO_x = ((initialOriginX - currentOriginX) / 100) * W;
                                                    const dO_y = ((initialOriginY - currentOriginY) / 100) * H;
                                                    
                                                    const dO_x_flipped = dO_x * sx;
                                                    const dO_y_flipped = dO_y * sy;
                                                    
                                                    const rx = dO_x_flipped * Math.cos(theta_rad) - dO_y_flipped * Math.sin(theta_rad);
                                                    const ry = dO_x_flipped * Math.sin(theta_rad) + dO_y_flipped * Math.cos(theta_rad);
                                                    
                                                     currentX = initialX + dO_x - rx;
                                                     currentY = initialY + dO_y - ry;
                                                     
                                                     targetLoc.style.left = `${currentOriginX}%`;
                                                     targetLoc.style.top = `${currentOriginY}%`;
                                                     if (parentLoc) {
                                                         parentLoc.style.transformOrigin = `${currentOriginX}% ${currentOriginY}%`;
                                                         parentLoc.style.left = `${(currentX / canvasSize.width) * 100}%`;
                                                         parentLoc.style.top = `${(currentY / canvasSize.height) * 100}%`;
                                                     }
                                                 };
                                                 
                                                 const handleUpLoc = () => {
                                                     window.removeEventListener('pointermove', handleMoveLoc);
                                                     window.removeEventListener('pointerup', handleUpLoc);
                                                     setTransformState(prev => ({
                                                         ...prev,
                                                         x: currentX,
                                                         y: currentY,
                                                         originX: currentOriginX,
                                                         originY: currentOriginY,
                                                     }));
                                                 };
                                                 
                                                 window.addEventListener('pointermove', handleMoveLoc);
                                                 window.addEventListener('pointerup', handleUpLoc);
                                             }}
                                        >
                                            {/* Extremely tiny visual anchor dot at center of character */}
                                            <div className="w-2.5 h-2.5 border border-pink-500 rounded-full flex items-center justify-center bg-pink-500/80 shadow-lg group-hover:scale-125 transition-transform">
                                                <div className="w-1 h-1 bg-white rounded-full"></div>
                                            </div>
                                        </div>

                                        {/* Scale Handles */}
                                        {[
                                            { type: 'uniform', cursor: 'nwse-resize', pos: '-top-3 -left-3', style: 'w-4 h-4 bg-white border-2 border-cyan-500 rounded-full shadow-md group-hover:scale-125 transition-transform' },
                                            { type: 'uniform', cursor: 'nesw-resize', pos: '-top-3 -right-3', style: 'w-4 h-4 bg-white border-2 border-cyan-500 rounded-full shadow-md group-hover:scale-125 transition-transform' },
                                            { type: 'uniform', cursor: 'nesw-resize', pos: '-bottom-3 -left-3', style: 'w-4 h-4 bg-white border-2 border-cyan-500 rounded-full shadow-md group-hover:scale-125 transition-transform' },
                                            { type: 'uniform', cursor: 'nwse-resize', pos: '-bottom-3 -right-3', style: 'w-4 h-4 bg-white border-2 border-cyan-500 rounded-full shadow-md group-hover:scale-125 transition-transform' },
                                            { type: 'vertical', cursor: 'ns-resize', pos: '-top-3 left-1/2 -translate-x-1/2', style: 'w-6 h-2 bg-cyan-500 border border-white rounded shadow-md group-hover:scale-110 transition-transform' },
                                            { type: 'vertical', cursor: 'ns-resize', pos: '-bottom-3 left-1/2 -translate-x-1/2', style: 'w-6 h-2 bg-cyan-500 border border-white rounded shadow-md group-hover:scale-110 transition-transform' },
                                            { type: 'horizontal', cursor: 'ew-resize', pos: 'top-1/2 -left-3 -translate-y-1/2', style: 'w-2 h-6 bg-cyan-500 border border-white rounded shadow-md group-hover:scale-110 transition-transform' },
                                            { type: 'horizontal', cursor: 'ew-resize', pos: 'top-1/2 -right-3 -translate-y-1/2', style: 'w-2 h-6 bg-cyan-500 border border-white rounded shadow-md group-hover:scale-110 transition-transform' }
                                        ].map((handle, i) => (
                                            <div 
                                                key={i}
                                                className={`transform-handle absolute ${handle.pos} w-6 h-6 flex items-center justify-center z-40 group cursor-${handle.cursor}`}
                                                style={{ cursor: handle.cursor }}
                                                onPointerDown={(e) => {
                                                    e.stopPropagation();
                                                    e.preventDefault();
                                                                                                        const box = e.currentTarget.parentElement;
                                                    if (!box || !box.parentElement) return;
                                                    
                                                    const stageRect = box.parentElement.getBoundingClientRect();
                                                    const canvasScaleX = stageRect.width / canvasSize.width;
                                                    const canvasScaleY = stageRect.height / canvasSize.height;
                                                    
                                                    const initialScale = transformState.scale;
                                                    const initialScaleX = transformState.scaleX;
                                                    const initialScaleY = transformState.scaleY;
                                                    
                                                    const px = transformState.x + (transformState.originX / 100) * (transformNaturalSize.width * initialScale * initialScaleX);
                                                    const py = transformState.y + (transformState.originY / 100) * (transformNaturalSize.height * initialScale * initialScaleY);
                                                    
                                                    const centerX = stageRect.left + px * canvasScaleX;
                                                    const centerY = stageRect.top + py * canvasScaleY;
                                                    
                                                    const startX = e.clientX;
                                                    const startY = e.clientY;
                                                    const dxStart = startX - centerX;
                                                    const dyStart = startY - centerY;
                                                    const theta = (transformState.rotation * Math.PI) / 180;
                                                    const localXStart = dxStart * Math.cos(-theta) - dyStart * Math.sin(-theta);
                                                    const localYStart = dxStart * Math.sin(-theta) + dyStart * Math.cos(-theta);
                                                    const distStart = Math.sqrt(dxStart * dxStart + dyStart * dyStart);
                                                    
                                                    let currentScale = initialScale;
                                                    let currentScaleX = initialScaleX;
                                                    let currentScaleY = initialScaleY;
                                                    let currentX = transformState.x;
                                                    let currentY = transformState.y;
                                                    
                                                    let rafId: number;
                                                    const handleMoveScale = (moveEvent: PointerEvent) => {
                                                        const dxCur = moveEvent.clientX - centerX;
                                                        const dyCur = moveEvent.clientY - centerY;
                                                        const localXCur = dxCur * Math.cos(-theta) - dyCur * Math.sin(-theta);
                                                        const localYCur = dxCur * Math.sin(-theta) + dyCur * Math.cos(-theta);
                                                        const distCur = Math.sqrt(dxCur * dxCur + dyCur * dyCur);
                                                        
                                                        if (handle.type === 'uniform') {
                                                            const scaleRatio = distStart > 0.1 ? (distCur / distStart) : 1;
                                                            currentScale = Math.max(0.01, initialScale * scaleRatio);
                                                        } else if (handle.type === 'horizontal') {
                                                            // Stretch horizontally using absolute coordinates for smoother scaling across center
                                                            const scaleRatio = Math.abs(localXStart) > 1 ? (Math.abs(localXCur) / Math.abs(localXStart)) : 1;
                                                            currentScaleX = Math.max(0.01, initialScaleX * scaleRatio);
                                                        } else if (handle.type === 'vertical') {
                                                            // Stretch vertically using absolute coordinates for smoother scaling across center
                                                            const scaleRatio = Math.abs(localYStart) > 1 ? (Math.abs(localYCur) / Math.abs(localYStart)) : 1;
                                                            currentScaleY = Math.max(0.01, initialScaleY * scaleRatio);
                                                        }
                                                        
                                                        currentX = px - (transformState.originX / 100) * (transformNaturalSize.width * currentScale * currentScaleX);
                                                        currentY = py - (transformState.originY / 100) * (transformNaturalSize.height * currentScale * currentScaleY);
                                                        
                                                        if (rafId) cancelAnimationFrame(rafId);
                                                        rafId = requestAnimationFrame(() => {
                                                            box.style.left = `${(currentX / canvasSize.width) * 100}%`;
                                                            box.style.top = `${(currentY / canvasSize.height) * 100}%`;
                                                            box.style.width = `${(currentScale * currentScaleX * (transformNaturalSize.width || 1) / canvasSize.width) * 100}%`;
                                                            box.style.height = `${(currentScale * currentScaleY * (transformNaturalSize.height || 1) / canvasSize.height) * 100}%`;
                                                        });
                                                    };
                                                    
                                                    const handleUpScale = () => {
                                                        if (rafId) cancelAnimationFrame(rafId);
                                                        window.removeEventListener('pointermove', handleMoveScale);
                                                        window.removeEventListener('pointerup', handleUpScale);
                                                        setTransformState(prev => ({ 
                                                            ...prev, 
                                                            scale: currentScale, 
                                                            scaleX: currentScaleX, 
                                                            scaleY: currentScaleY,
                                                            x: currentX,
                                                            y: currentY
                                                        }));
                                                    };
                                                    
                                                    window.addEventListener('pointermove', handleMoveScale);
                                                    window.addEventListener('pointerup', handleUpScale);
                                                }}
                                            >
                                                <div className={handle.style} />
                                            </div>
                                        ))}

                                        {/* Rotate Handle */}
                                        <div 
                                            className="transform-handle absolute -top-12 left-1/2 -translate-x-1/2 w-8 h-8 flex items-center justify-center cursor-ew-resize z-40 group"
                                            onPointerDown={(e) => {
                                                e.stopPropagation();
                                                e.preventDefault();
                                                
                                                const box = e.currentTarget.parentElement;
                                                if (!box || !box.parentElement) return;
                                                
                                                const stageRect = box.parentElement.getBoundingClientRect();
                                                const canvasScaleX = stageRect.width / canvasSize.width;
                                                const canvasScaleY = stageRect.height / canvasSize.height;
                                                
                                                const initialScale = transformState.scale;
                                                const initialScaleX = transformState.scaleX;
                                                const initialScaleY = transformState.scaleY;
                                                
                                                const px = transformState.x + (transformState.originX / 100) * (transformNaturalSize.width * initialScale * initialScaleX);
                                                const py = transformState.y + (transformState.originY / 100) * (transformNaturalSize.height * initialScale * initialScaleY);
                                                
                                                const centerX = stageRect.left + px * canvasScaleX;
                                                const centerY = stageRect.top + py * canvasScaleY;
                                                
                                                const startX = e.clientX;
                                                const startY = e.clientY;
                                                const dxStart = startX - centerX;
                                                const dyStart = startY - centerY;
                                                const startAngle = Math.atan2(dyStart, dxStart);
                                                
                                                const initialRotation = transformState.rotation;
                                                let currentRotation = initialRotation;
                                                
                                                let rafId: number;
                                                const handleMoveRotate = (moveEvent: PointerEvent) => {
                                                    const dxCur = moveEvent.clientX - centerX;
                                                    const dyCur = moveEvent.clientY - centerY;
                                                    const curAngle = Math.atan2(dyCur, dxCur);
                                                    
                                                    const deltaAngle = (curAngle - startAngle) * 180 / Math.PI;
                                                    currentRotation = initialRotation + deltaAngle;
                                                    
                                                    if (rafId) cancelAnimationFrame(rafId);
                                                    rafId = requestAnimationFrame(() => {
                                                        box.style.transform = `rotate(${currentRotation}deg) scale(${transformState.flipX ? -1 : 1}, ${transformState.flipY ? -1 : 1}) translateX(-0.5%) translateY(-0.5%)`;
                                                    });
                                                };
                                                
                                                const handleUpRotate = () => {
                                                    if (rafId) cancelAnimationFrame(rafId);
                                                    window.removeEventListener('pointermove', handleMoveRotate);
                                                    window.removeEventListener('pointerup', handleUpRotate);
                                                    setTransformState(prev => ({ ...prev, rotation: currentRotation }));
                                                };
                                                
                                                window.addEventListener('pointermove', handleMoveRotate);
                                                window.addEventListener('pointerup', handleUpRotate);
                                            }}
                                        >
                                            <div className="w-8 h-8 bg-cyan-500 rounded-full border-2 border-white flex items-center justify-center shadow-xl group-hover:scale-110 transition-transform">
                                                <RotateCw size={14} className="text-black font-bold" />
                                            </div>
                                            <div className="absolute top-full left-1/2 -translate-x-1/2 w-0.5 h-4 bg-cyan-500"></div>
                                        </div>
                                    </div>
                                </div>
                            </>
                    ) : !isPlaying && isRiggingMode ? (
                            <div 
                                id="active-rigging-stage" 
                                className="absolute inset-0 w-full h-full z-[200] bg-black/70 backdrop-blur-[12px] cursor-pointer animate-in fade-in duration-300 transition-all shadow-[inset_0_0_100px_rgba(0,0,0,0.5)]"
                                onDoubleClick={() => {
                                    if (riggingTool === 'BONE') setRiggingTool('HAND');
                                    else if (riggingTool === 'HAND') setRiggingTool('DELETE');
                                    else setRiggingTool('BONE');
                                }}
                            >
                                <PuppetWarp 
                                    imageUri={riggingSnapshot} 
                                    width={canvasSize.width} 
                                    height={canvasSize.height} 
                                    bones={riggingBones} 
                                    onBonesChange={(newBones) => {
                                        setRiggingBones(newBones);
                                        if (activeBoneId && !newBones.find(b => b.id === activeBoneId)) {
                                            setActiveBoneId(null);
                                        }
                                    }} 
                                    mode='EDIT'
                                    tool={riggingTool}
                                    boneTransforms={boneTransforms}
                                    activeBoneId={activeBoneId}
                                    onBoneSelect={setActiveBoneId}
                                    showSkeleton={true}
                                    rigType={activeRigType}
                                    isLowPerformanceMode={isLowPerformanceMode}
                                />
                            </div>
                        ) : null}
                    </div>
                </div>
                </div>
            </div>
            {/* TIMELINE STRIP */}
            <div 
                className={`relative bg-[#18181b] border-t border-white/10 flex flex-col z-20 shrink-0 select-none pb-2 sm:pb-0 transition-all duration-300 ${orientation === 'landscape' ? 'h-[100px]' : ''}`}
                style={{ height: orientation === 'landscape' ? 100 : (showAdvancedAudioTimeline ? 'auto' : timelineHeight) }}
            >
                <div className="min-h-12 sm:h-10 shrink-0 border-b border-white/5 flex flex-wrap sm:flex-nowrap items-center justify-between gap-y-2 px-4 py-2 sm:py-0 bg-[#0c0c0e]">
                    <div className="flex items-center gap-2 sm:gap-4 overflow-x-auto custom-scrollbar no-scrollbar">
                        <button onClick={addFrame} className="flex items-center gap-1.5 text-[10px] sm:text-[11px] font-black text-gray-300 hover:text-white bg-white/5 hover:bg-white/10 px-3 py-1.5 rounded-lg border border-white/5 transition-all whitespace-nowrap active:scale-95">
                            <Plus size={14}/> {t('NEW FRAME')}
                        </button>
                        <button onClick={copyFrame} className="flex items-center gap-1.5 text-[10px] sm:text-[11px] font-black text-gray-300 hover:text-white bg-white/5 hover:bg-white/10 px-3 py-1.5 rounded-lg border border-white/5 transition-all whitespace-nowrap active:scale-95">
                            <Copy size={14}/> {t('DUPLICATE')}
                        </button>
                        <button onClick={deleteFrame} className="flex items-center gap-1.5 text-[10px] sm:text-[11px] font-black text-red-400 hover:text-red-300 bg-red-900/10 hover:bg-red-900/20 px-3 py-1.5 rounded-lg border border-red-500/10 transition-all whitespace-nowrap active:scale-95">
                            <Trash2 size={14}/> {t('DELETE')}
                        </button>
                        <div className="w-px h-4 bg-white/10 mx-1"></div>
                        <input type="file" ref={fileInputRef} accept="video/*" className="hidden" onChange={handleVideoImport} />
                        {isImportingVideo ? (
                            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-purple-500/30 bg-purple-900/20 text-purple-400 text-[10px] font-black shrink-0 animate-in fade-in zoom-in-95 duration-300">
                                <Loader2 size={12} className="animate-spin text-purple-400" />
                                <span className="tracking-widest uppercase">{t('EXTRACTING')}: </span>
                                <span className="font-mono">{importVideoProgress}%</span>
                                <div className="w-16 h-1.5 bg-black rounded-full overflow-hidden shrink-0 hidden sm:block border border-white/5">
                                    <div className="h-full bg-purple-500 transition-all duration-300" style={{ width: `${importVideoProgress}%` }}></div>
                                </div>
                            </div>
                        ) : (
                            <button 
                                onClick={() => fileInputRef.current?.click()}
                                className="flex items-center gap-1.5 text-[10px] sm:text-[11px] font-black text-purple-400 hover:text-purple-300 bg-purple-900/10 hover:bg-purple-900/20 px-3 py-1.5 rounded-lg border border-purple-500/20 transition-all whitespace-nowrap active:scale-95 shrink-0 group"
                            >
                                <Video size={14} className="group-hover:scale-110 transition-transform"/> {t('IMPORT VIDEO')}
                            </button>
                        )}
                        {referenceVideoUrl && (
                            <div className="flex items-center gap-2 bg-white/5 px-2 py-1.5 rounded-lg border border-white/5 shrink-0" title="Video Opacity">
                                <Video size={12} className="text-gray-500" />
                                <input 
                                    type="range" min="0" max="1" step="0.05"
                                    value={videoOpacity}
                                    onChange={(e) => setVideoOpacity(parseFloat(e.target.value))}
                                    className="w-16 h-1.5 bg-white/10 rounded-full appearance-none cursor-pointer accent-cyan-500"
                                />
                            </div>
                        )}
                        <button 
                            onClick={() => setShowAudioImportManager(true)}
                            className="flex items-center gap-2 text-[10px] sm:text-[11px] font-black text-cyan-400 hover:text-cyan-300 bg-cyan-900/10 hover:bg-cyan-900/20 px-4 py-2 rounded-xl border border-cyan-500/20 transition-all whitespace-nowrap active:scale-95 shadow-lg shadow-cyan-500/5 group"
                        >
                            <Music size={16} className="group-hover:scale-110 transition-transform"/> {t('IMPORT AUDIO')}
                        </button>
                        
                        <button 
                            onClick={() => {
                                const nextState = !showAdvancedAudioTimeline;
                                setShowAdvancedAudioTimeline(nextState);
                                if (nextState) {
                                    setTimelineHeight(Math.max(timelineHeight, 320));
                                } else {
                                    setTimelineHeight(160);
                                }
                            }}
                            className={`flex items-center gap-2 text-[10px] sm:text-[11px] font-black px-4 py-2 rounded-xl border transition-all whitespace-nowrap active:scale-95 shadow-lg group ${
                                showAdvancedAudioTimeline 
                                ? "text-cyan-400 bg-cyan-950/40 border-cyan-500/50 shadow-cyan-500/10" 
                                : "text-gray-300 bg-white/5 border-white/5 hover:bg-white/10 hover:text-white"
                            }`}
                        >
                            <Sliders size={16} className={`${showAdvancedAudioTimeline ? "text-cyan-400 rotate-90" : "text-gray-400"} transition-all duration-300`}/>
                            {showAdvancedAudioTimeline ? t('COLLAPSE TIMELINE') : t('CAPCUT AUDIO EDIT')}
                        </button>
                    </div>
                    <div className="flex items-center gap-4 w-full sm:w-auto justify-between sm:justify-end border-t border-white/5 sm:border-0 pt-2 sm:pt-0">
                        <div className="flex items-center gap-3 bg-white/5 px-3 py-1.5 rounded-full border border-white/5 flex-1 sm:flex-initial max-w-[200px]">
                            <LayoutGrid size={12} className="text-cyan-500 opacity-50"/>
                            <input 
                                type="range" min="80" max="400" 
                                value={timelineHeight} 
                                onChange={(e) => setTimelineHeight(parseInt(e.target.value))} 
                                className="w-full h-1.5 bg-white/10 rounded-full appearance-none cursor-pointer accent-cyan-500"
                            />
                        </div>
                        <div className="flex items-center gap-2 bg-black border border-white/10 rounded-lg px-2 py-1">
                             <span className="text-[9px] font-black text-gray-500 uppercase tracking-tighter">{t('FPS')}</span>
                             <input type="number" min="1" max="60" value={playbackSpeed || ""} onChange={(e) => setPlaybackSpeed(parseInt(e.target.value) || "" as any)} className="w-8 bg-transparent text-center text-[11px] font-bold text-white outline-none"/>
                        </div>
                    </div>
                </div>
                                {showAdvancedAudioTimeline ? (
                    <div className="flex flex-col flex-1 bg-black/80 rounded-xl border border-white/5 p-4 mx-2 my-1 animate-in fade-in duration-300">
                        {/* Selected Clip Edit Drawer / Properties Panel */}
                        {showClipEditDrawer && selectedClipId && (
                            <div className="mb-3 bg-zinc-950/90 border border-cyan-500/20 p-3.5 rounded-xl animate-in slide-in-from-bottom-3 duration-300 relative">
                                <button 
                                    onClick={() => setShowClipEditDrawer(false)}
                                    className="absolute top-2.5 right-2.5 w-6 h-6 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-gray-400 hover:text-white transition-all"
                                >
                                    <X size={12} />
                                </button>
                                
                                {(() => {
                                    const clip = audioClips.find(c => c.id === selectedClipId);
                                    if (!clip) return null;
                                    return (
                                        <div className="flex flex-col gap-3">
                                            <div className="flex items-center justify-between border-b border-white/5 pb-2">
                                                <div className="flex items-center gap-2">
                                                    <Music size={14} className="text-cyan-400" />
                                                    <span className="text-xs font-black text-white truncate max-w-[180px] sm:max-w-xs">{clip.name}</span>
                                                    <span className="text-[9px] bg-cyan-950 text-cyan-400 border border-cyan-500/10 px-1.5 py-0.5 rounded-full font-mono font-bold">
                                                        x{(clip.speed || 1.0).toFixed(2)}
                                                    </span>
                                                </div>
                                                <button 
                                                    onClick={() => {
                                                        setAudioClips(prev => prev.filter(c => c.id !== selectedClipId));
                                                        setSelectedClipId(null);
                                                        setShowClipEditDrawer(false);
                                                        setAudioModified(true);
                                                        showAppToast(t("Clip deleted"));
                                                    }}
                                                    className="flex items-center gap-1 text-[10px] font-bold text-red-400 hover:text-red-300 bg-red-950/20 hover:bg-red-950/40 px-2.5 py-1 rounded-lg border border-red-500/10 transition-all active:scale-95"
                                                >
                                                    <Trash2 size={12} />
                                                    {t('Delete Clip')}
                                                </button>
                                            </div>

                                            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-center">
                                                {/* Speed Control (0.25x to 2.0x) */}
                                                <div className="flex flex-col gap-1.5 bg-white/5 p-2 rounded-lg border border-white/5">
                                                    <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest flex items-center justify-between">
                                                        <span>{t('Playback Speed')}</span>
                                                        <span className="text-cyan-400 font-mono">{(clip.speed || 1.0).toFixed(2)}x</span>
                                                    </span>
                                                    <div className="flex items-center gap-2">
                                                        <input 
                                                            type="range" 
                                                            min="0.25" 
                                                            max="2.0" 
                                                            step="0.05"
                                                            value={clip.speed || 1.0}
                                                            onChange={(e) => {
                                                                const newSpeed = parseFloat(e.target.value);
                                                                setAudioClips(prev => prev.map(c => {
                                                                    if (c.id === selectedClipId) {
                                                                        const oldSpeed = c.speed || 1.0;
                                                                        const durationScale = oldSpeed / newSpeed;
                                                                        const newDuration = Math.min(
                                                                            c.buffer.duration - c.startTrim,
                                                                            c.playDuration * durationScale
                                                                        );
                                                                        return { ...c, speed: newSpeed, playDuration: newDuration };
                                                                    }
                                                                    return c;
                                                                }));
                                                                setAudioModified(true);
                                                            }}
                                                            className="flex-1 h-1 bg-white/10 rounded-full appearance-none accent-cyan-500 cursor-pointer"
                                                        />
                                                    </div>
                                                    <div className="flex gap-1.5 mt-1">
                                                        {[0.5, 1.0, 1.5, 2.0].map(val => (
                                                            <button 
                                                                key={val}
                                                                onClick={() => {
                                                                    setAudioClips(prev => prev.map(c => {
                                                                        if (c.id === selectedClipId) {
                                                                            const oldSpeed = c.speed || 1.0;
                                                                            const durationScale = oldSpeed / val;
                                                                            const newDuration = Math.min(
                                                                                c.buffer.duration - c.startTrim,
                                                                                c.playDuration * durationScale
                                                                            );
                                                                            return { ...c, speed: val, playDuration: newDuration };
                                                                        }
                                                                        return c;
                                                                    }));
                                                                    setAudioModified(true);
                                                                }}
                                                                className={`text-[8px] font-black px-1.5 py-0.5 rounded transition-all ${
                                                                    (clip.speed || 1.0) === val 
                                                                        ? 'bg-cyan-500 text-black' 
                                                                        : 'bg-white/5 text-gray-400 hover:text-white'
                                                                }`}
                                                            >
                                                                {val}x
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>

                                                {/* Volume Control */}
                                                <div className="flex flex-col gap-1.5 bg-white/5 p-2 rounded-lg border border-white/5">
                                                    <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest flex items-center justify-between">
                                                        <span>{t('Clip Volume')}</span>
                                                        <span className="text-cyan-400 font-mono">{Math.round((clip.volume || 1.0) * 100)}%</span>
                                                    </span>
                                                    <input 
                                                        type="range" 
                                                        min="0" 
                                                        max="2" 
                                                        step="0.05"
                                                        value={clip.volume !== undefined ? clip.volume : 1.0}
                                                        onChange={(e) => {
                                                            const val = parseFloat(e.target.value);
                                                            setAudioClips(prev => prev.map(c => c.id === selectedClipId ? { ...c, volume: val } : c));
                                                            setAudioModified(true);
                                                        }}
                                                        className="w-full h-1 bg-white/10 rounded-full appearance-none accent-cyan-500 cursor-pointer"
                                                    />
                                                </div>

                                                {/* Trim Start */}
                                                <div className="flex flex-col gap-1.5 bg-white/5 p-2 rounded-lg border border-white/5">
                                                    <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest flex items-center justify-between">
                                                        <span>{t('Trim Start')}</span>
                                                        <span className="text-cyan-400 font-mono">{clip.startTrim.toFixed(1)}s</span>
                                                    </span>
                                                    <input 
                                                        type="range" 
                                                        min="0" 
                                                        max={Math.max(0.1, clip.buffer.duration - 0.2)} 
                                                        step="0.05"
                                                        value={clip.startTrim}
                                                        onChange={(e) => {
                                                            const val = parseFloat(e.target.value);
                                                            const maxDur = clip.buffer.duration - val;
                                                            setAudioClips(prev => prev.map(c => {
                                                                if (c.id === selectedClipId) {
                                                                    return {
                                                                        ...c,
                                                                        startTrim: val,
                                                                        playDuration: Math.min(c.playDuration, maxDur)
                                                                    };
                                                                }
                                                                return c;
                                                            }));
                                                            setAudioModified(true);
                                                        }}
                                                        className="w-full h-1 bg-white/10 rounded-full appearance-none accent-cyan-500 cursor-pointer"
                                                    />
                                                </div>

                                                {/* Play Duration */}
                                                <div className="flex flex-col gap-1.5 bg-white/5 p-2 rounded-lg border border-white/5">
                                                    <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest flex items-center justify-between">
                                                        <span>{t('Duration')}</span>
                                                        <span className="text-cyan-400 font-mono">{clip.playDuration.toFixed(1)}s</span>
                                                    </span>
                                                    <input 
                                                        type="range" 
                                                        min="0.2" 
                                                        max={clip.buffer.duration - clip.startTrim} 
                                                        step="0.05"
                                                        value={clip.playDuration}
                                                        onChange={(e) => {
                                                            const val = parseFloat(e.target.value);
                                                            setAudioClips(prev => prev.map(c => c.id === selectedClipId ? { ...c, playDuration: val } : c));
                                                            setAudioModified(true);
                                                        }}
                                                        className="w-full h-1 bg-white/10 rounded-full appearance-none accent-cyan-500 cursor-pointer"
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })()}
                            </div>
                        )}

                        {/* The Two Lanes Grid Layout */}
                        <div className="flex flex-1 overflow-hidden border border-white/10 rounded-xl bg-[#0c0c0e]">
                            {/* Left Header Sidebar Labels */}
                            <div className="w-20 sm:w-28 shrink-0 bg-[#121215] border-r border-white/10 flex flex-col pt-8">
                                {/* Lane 1 Label: Frames */}
                                <div className="h-[68px] flex flex-col justify-center px-2 sm:px-4 border-b border-white/5">
                                    <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-1.5">
                                        <Film size={12} className="text-purple-400"/>
                                        {t('Frames')}
                                    </span>
                                    <span className="text-[9px] text-gray-500">{frames.length} total</span>
                                </div>
                                
                                {/* Lane 2 Label: Audio with editing slider trigger gear */}
                                <div style={{ height: audioClips.length === 0 ? 68 : audioClips.length * 52 + 56 }} className="flex flex-col justify-center px-2 sm:px-4 relative group">
                                    <div className="flex items-center justify-between">
                                        <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-1.5">
                                            <Music size={12} className="text-cyan-400"/>
                                            {t('Audio')}
                                        </span>
                                        <div className="flex gap-1">
                                            <button 
                                                onClick={() => setShowAudioImportManager(true)}
                                                className="text-cyan-400 hover:text-white p-1 hover:bg-white/5 rounded-md transition-all active:scale-95"
                                                title={t('Add Audio Track')}
                                            >
                                                <Plus size={12} />
                                            </button>
                                            {audioClips.length > 0 && (
                                                <button 
                                                    onClick={() => {
                                                        if (audioClips.length > 0) {
                                                            if (!selectedClipId) setSelectedClipId(audioClips[0].id);
                                                            setShowClipEditDrawer(prev => !prev);
                                                        }
                                                    }}
                                                    className="text-cyan-400 hover:text-white p-1 hover:bg-white/5 rounded-md transition-all active:scale-95"
                                                    title={t('Edit Clip Details')}
                                                >
                                                    <Sliders size={12} />
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                    <span className="text-[9px] text-gray-500 truncate" title={audioFileName}>
                                        {audioClips.length > 0 ? audioClips.length + ' ' + t('tracks') : t('No track')}
                                    </span>
                                </div>
                            </div>

                            {/* Right Scrollable Timeline Channels */}
                            <div className={`flex-1 overflow-y-hidden custom-scrollbar relative p-1 pb-2 scroll-track-container ${
                                (isDraggingAudio === 'move' && isAudioLongPressed) ? 'overflow-x-hidden' : 'overflow-x-auto'
                            }`}>
                                {(() => {
                                    const totalFramesWidth = frames.length * FRAME_WIDTH;
                                    const maxClipTimelineEnd = audioClips.reduce((max, clip) => Math.max(max, clip.startOffset + clip.playDuration), 0);
                                    const totalAudioWidth = maxClipTimelineEnd * playbackSpeed * FRAME_WIDTH;
                                    const trackWidth = Math.max(totalFramesWidth + 120, totalAudioWidth + 120);

                                    return (
                                        <div style={{ width: trackWidth, position: 'relative' }} className="h-full pt-6">
                                            {/* Ruler ticks every 5 frames */}
                                            <div 
                                                className="absolute top-0 left-0 w-full h-5 border-b border-white/5 flex items-end cursor-ew-resize pointer-events-auto z-15"
                                                onPointerDown={(e) => {
                                                    const rect = e.currentTarget.getBoundingClientRect();
                                                    const scrollTrack = e.currentTarget.closest('.scroll-track-container');
                                                    const scrollLeft = scrollTrack ? scrollTrack.scrollLeft : 0;
                                                    const x = e.clientX - rect.left + scrollLeft;
                                                    const frameIdx = Math.max(0, Math.min(frames.length - 1, Math.floor(x / FRAME_WIDTH)));
                                                    saveActiveLayer();
                                                    setCurrentFrameIndex(frameIdx);
                                                    scrubAudio(frameIdx / playbackSpeed);
                                                    
                                                    // Start playhead dragging
                                                    isDraggingPlayheadRef.current = true;
                                                    const dragHandle = e.currentTarget.closest('.scroll-track-container')?.querySelector('.playhead-drag-handle');
                                                    if (dragHandle) {
                                                        try { (dragHandle as HTMLElement).setPointerCapture(e.pointerId); } catch(_) {}
                                                    }
                                                }}
                                            >
                                                {Array.from({ length: Math.ceil(trackWidth / FRAME_WIDTH) }).map((_, i) => (
                                                    <div 
                                                        key={i} 
                                                        style={{ position: 'absolute', left: i * FRAME_WIDTH }} 
                                                        className="h-3 border-l border-white/10 pl-1 pb-0.5 text-[8px] font-mono text-gray-500 select-none pointer-events-none"
                                                    >
                                                        {(i % 5 === 0) ? `F${i + 1}` : ''}
                                                    </div>
                                                ))}
                                            </div>

                                            {/* Row 1: Frames Track */}
                                            <div className="h-[68px] border-b border-white/5 flex items-center relative">
                                                {frames.map((frame, index) => (
                                                    <div 
                                                        key={frame.id} 
                                                        style={{ position: 'absolute', left: index * FRAME_WIDTH, width: FRAME_WIDTH }}
                                                        className="h-[54px] px-1 relative group/frame"
                                                    >
                                                        <div
                                                            onClick={() => {
                                                                if (index !== currentFrameIndex) {
                                                                    saveActiveLayer();
                                                                    setCurrentFrameIndex(index);
                                                                    scrubAudio(index / playbackSpeed);
                                                                }
                                                            }}
                                                            className={`w-full h-full cursor-pointer rounded-md border overflow-hidden bg-black transition-all relative ${
                                                                index === currentFrameIndex 
                                                                    ? 'border-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.5)] scale-[1.02] z-10' 
                                                                    : 'border-white/10 hover:border-white/30'
                                                            }`}
                                                        >
                                                            <div className="w-full h-full relative bg-zinc-900" style={{ backgroundImage: 'repeating-conic-gradient(#333 0% 25%, transparent 0% 50%)', backgroundSize: '10px 10px' }}>
                                                                <img src={frame.dataUri || undefined} className="w-full h-full object-contain pointer-events-none mb-1" alt="" />
                                                            </div>
                                                        </div>

                                                        {/* Rearrange Action Buttons Overlaid on each Frame - Permanently Visible & Professional */}
                                                        <div className="absolute inset-x-1 bottom-1 flex justify-between items-center bg-black/80 backdrop-blur-[1px] rounded border border-white/10 p-0.5 z-20 pointer-events-none">
                                                            <button 
                                                                onClick={(e) => handleMoveFrameLeft(index, e)}
                                                                disabled={index === 0}
                                                                className={`w-5 h-5 rounded bg-zinc-900 hover:bg-cyan-500 hover:text-black flex items-center justify-center text-white transition-all active:scale-90 disabled:opacity-20 disabled:pointer-events-none border border-white/5 pointer-events-auto`}
                                                                title={t('Move Left')}
                                                            >
                                                                <ChevronLeft size={10} strokeWidth={2.5} />
                                                            </button>
                                                            <span className="text-[8px] font-black font-mono text-cyan-400 select-none">
                                                                {index + 1}
                                                            </span>
                                                            <button 
                                                                onClick={(e) => handleMoveFrameRight(index, e)}
                                                                disabled={index === frames.length - 1}
                                                                className={`w-5 h-5 rounded bg-zinc-900 hover:bg-cyan-500 hover:text-black flex items-center justify-center text-white transition-all active:scale-90 disabled:opacity-20 disabled:pointer-events-none border border-white/5 pointer-events-auto`}
                                                                title={t('Move Right')}
                                                            >
                                                                <ChevronRight size={10} strokeWidth={2.5} />
                                                            </button>
                                                        </div>
                                                    </div>
                                                ))}
                                                <button 
                                                    onClick={addFrame} 
                                                    style={{ position: 'absolute', left: frames.length * FRAME_WIDTH }}
                                                    className="w-[80px] h-[54px] rounded-md border border-dashed border-white/10 hover:border-cyan-500/50 hover:bg-cyan-500/5 flex items-center justify-center text-gray-600 hover:text-cyan-400 transition-all"
                                                >
                                                    <Plus size={16}/>
                                                </button>
                                            </div>
                                            {/* Row 2: Audio Track with Multi-Clip Layout */}
                                            <div style={{ height: audioClips.length === 0 ? 68 : audioClips.length * 52 + 56 }} className="relative bg-black/10">
                                                {audioClips.map((clip, index) => {
                                                    const isSelected = selectedClipId === clip.id;
                                                    return (
                                                        <div 
                                                            key={clip.id}
                                                            style={{ 
                                                                position: 'absolute', 
                                                                top: index * 52 + 11,
                                                                left: clip.startOffset * playbackSpeed * FRAME_WIDTH, 
                                                                width: Math.max(40, clip.playDuration * playbackSpeed * FRAME_WIDTH),
                                                                touchAction: 'none'
                                                            }}
                                                            className={`h-[46px] select-none rounded-lg border text-cyan-300 shadow-md flex items-center justify-between px-2 overflow-hidden absolute group transition-all duration-100 ${
                                                                isSelected 
                                                                     ? 'border-cyan-400 bg-gradient-to-r from-cyan-950/80 to-teal-950/80 ring-2 ring-cyan-500/50 z-20' 
                                                                     : 'border-white/10 bg-gradient-to-r from-cyan-950/40 to-teal-950/40 hover:border-white/30 z-10'
                                                            }`}
                                                            onPointerDown={(e) => {
                                                                setSelectedClipId(clip.id);
                                                            }}
                                                        >
                                                            {/* Drag Handle Trim Left */}
                                                            <div 
                                                                className="absolute left-0 top-0 bottom-0 w-2.5 bg-cyan-500 hover:bg-cyan-400 cursor-ew-resize flex items-center justify-center rounded-l-md active:scale-95 transition-all z-20"
                                                                onPointerDown={(e) => handleAudioPointerDown(e, clip.id, 'trim-start')}
                                                            >
                                                                <div className="w-[1px] h-3 bg-black"></div>
                                                            </div>

                                                            {/* Background REAL Waveform Visualizer */}
                                                            <ClipWaveform clip={clip} width={Math.max(40, clip.playDuration * playbackSpeed * FRAME_WIDTH)} />

                                                            {/* Center Draggable Label */}
                                                            <div 
                                                                className="flex-1 text-center h-full flex flex-col justify-center items-center cursor-pointer select-none z-10 px-3"
                                                                onPointerDown={(e) => handleAudioPointerDown(e, clip.id, 'move')}
                                                                onPointerMove={handleAudioPointerMove}
                                                                onPointerUp={handleAudioPointerUp}
                                                            >
                                                                <span className="text-[10px] font-black truncate max-w-full text-white tracking-wide">
                                                                    {clip.name}
                                                                </span>
                                                                <span className="text-[8px] opacity-70 font-mono text-cyan-300">
                                                                    {(clip.startOffset).toFixed(1)}s → {(clip.startOffset + clip.playDuration).toFixed(1)}s
                                                                </span>
                                                            </div>

                                                            {/* Drag Handle Trim Right */}
                                                            <div 
                                                                className="absolute right-0 top-0 bottom-0 w-2.5 bg-cyan-500 hover:bg-cyan-400 cursor-ew-resize flex items-center justify-center rounded-r-md active:scale-95 transition-all z-20"
                                                                onPointerDown={(e) => handleAudioPointerDown(e, clip.id, 'trim-end')}
                                                            >
                                                                <div className="w-[1px] h-3 bg-black"></div>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                                {audioClips.length === 0 && (
                                                    <div 
                                                        onClick={() => setShowAudioImportManager(true)}
                                                        className="absolute top-1/2 left-0 w-full max-w-md h-[46px] -translate-y-1/2 border border-dashed border-white/10 rounded-lg hover:border-cyan-500/40 hover:bg-cyan-500/5 cursor-pointer flex items-center justify-center gap-2 text-gray-500 hover:text-cyan-400 transition-all text-xs"
                                                    >
                                                        <Plus size={14}/>
                                                        {t('Click to Import and Place Audio Track')}
                                                    </div>
                                                )}
                                                {audioClips.length > 0 && (
                                                    <div 
                                                        onClick={() => setShowAudioImportManager(true)}
                                                        style={{ top: audioClips.length * 52 + 11 }}
                                                        className="absolute left-0 w-full max-w-[200px] h-[32px] border border-dashed border-white/10 rounded-lg hover:border-cyan-500/40 hover:bg-cyan-500/5 cursor-pointer flex items-center justify-center gap-2 text-gray-500 hover:text-cyan-400 transition-all text-xs"
                                                    >
                                                        <Plus size={14}/>
                                                        {t('Add Track')}
                                                    </div>
                                                )}
                                            </div>

                                            {/* Active Playhead vertical cursor across tracks */}
                                            <div 
                                                style={{ 
                                                    position: 'absolute', 
                                                    left: currentFrameIndex * FRAME_WIDTH + FRAME_WIDTH / 2,
                                                    top: 0 
                                                }}
                                                className="w-0.5 h-full bg-cyan-400 z-30 pointer-events-none relative"
                                            >
                                                {/* Playhead Drag Handle at the top - FlipaClip Style */}
                                                <div 
                                                    className="absolute -top-1.5 -left-[14px] w-7 h-7 bg-cyan-500 rounded-full flex items-center justify-center border-2 border-white shadow-[0_0_10px_rgba(6,182,212,0.8)] hover:scale-110 active:scale-95 transition-transform cursor-ew-resize pointer-events-auto z-40 playhead-drag-handle"
                                                    onPointerDown={(e) => {
                                                        isDraggingPlayheadRef.current = true;
                                                        e.currentTarget.setPointerCapture(e.pointerId);
                                                    }}
                                                    onPointerMove={(e) => {
                                                        if (isDraggingPlayheadRef.current) {
                                                            const scrollTrack = e.currentTarget.closest('.scroll-track-container');
                                                            if (scrollTrack) {
                                                                const rect = scrollTrack.getBoundingClientRect();
                                                                const x = e.clientX - rect.left + scrollTrack.scrollLeft;
                                                                const frameIdx = Math.max(0, Math.min(frames.length - 1, Math.floor(x / FRAME_WIDTH)));
                                                                if (frameIdx !== currentFrameIndex) {
                                                                    saveActiveLayer();
                                                                    setCurrentFrameIndex(frameIdx);
                                                                    scrubAudio(frameIdx / playbackSpeed);
                                                                }
                                                            }
                                                        }
                                                    }}
                                                    onPointerUp={(e) => {
                                                        if (isDraggingPlayheadRef.current) {
                                                            isDraggingPlayheadRef.current = false;
                                                            try { e.currentTarget.releasePointerCapture(e.pointerId); } catch(_) {}
                                                        }
                                                    }}
                                                    onPointerCancel={(e) => {
                                                        if (isDraggingPlayheadRef.current) {
                                                            isDraggingPlayheadRef.current = false;
                                                            try { e.currentTarget.releasePointerCapture(e.pointerId); } catch(_) {}
                                                        }
                                                    }}
                                                />

                                                {/* Cut Button on the playhead mid head (intersection between frame and audio lane) */}
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleSliceAudioAtPlayhead();
                                                    }}
                                                    className="absolute top-[52px] -left-3.5 w-7 h-7 bg-cyan-500 hover:bg-cyan-400 rounded-full flex items-center justify-center shadow-[0_0_12px_rgba(6,182,212,0.8)] hover:scale-110 active:scale-90 transition-transform cursor-pointer pointer-events-auto border-2 border-white text-black font-black z-45"
                                                    title={t("Slice clip at playhead")}
                                                >
                                                    <Scissors size={11} className="text-black font-bold" strokeWidth={2.5} />
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })()}
                            </div>
                        </div>
                    </div>
                ) : (
                    <>
                        <div className="flex flex-1 overflow-hidden relative">
                            <button 
                                className="shrink-0 px-3 py-2 my-2 text-cyan-400 hover:bg-cyan-500/20 rounded-lg flex flex-col items-center justify-center gap-1 group active:scale-95 transition-all bg-black/40 border border-white/5 ml-2 z-10"
                                onClick={() => setShowCompactFrames(true)}
                                title={t("All Frames Grid")}
                            >
                                <LayoutGrid size={20} />
                            </button>
                            <div className="w-[1px] bg-white/10 shrink-0 mx-2 my-2 z-10"></div>
                            {frames.length > 50 ? (
                                <VirtualTimeline 
                                    frames={frames}
                                    currentFrameIndex={currentFrameIndex}
                                    setCurrentFrameIndex={setCurrentFrameIndex}
                                    addFrame={addFrame}
                                    saveActiveLayer={saveActiveLayer}
                                    audioBuffer={audioBuffer}
                                    scrubAudio={scrubAudio}
                                    playbackSpeed={playbackSpeed}
                                    onMoveLeft={handleMoveFrameLeft}
                                    onMoveRight={handleMoveFrameRight}
                                    t={t}
                                />
                            ) : (
                                <Reorder.Group 
                                    axis="x" 
                                    values={frames} 
                                    onReorder={handleReorderFrames}
                                    className="flex-1 overflow-y-hidden overflow-x-auto custom-scrollbar p-2 flex gap-4 items-center pl-1"
                                    onWheel={(e) => e.stopPropagation()}
                                    as="div"
                                >
                                    {frames.map((frame, idx) => (
                                        <DraggableFrameItem 
                                            key={frame.id}
                                            frame={frame}
                                            index={idx}
                                            isSelected={idx === currentFrameIndex}
                                            onClick={() => {
                                                if (idx !== currentFrameIndex) {
                                                    saveActiveLayer();
                                                    setCurrentFrameIndex(idx);
                                                    if (audioBuffer) {
                                                        scrubAudio(idx / playbackSpeed);
                                                    }
                                                }
                                            }}
                                            onMoveLeft={handleMoveFrameLeft}
                                            onMoveRight={handleMoveFrameRight}
                                            totalFrames={frames.length}
                                            t={t}
                                        />
                                    ))}
                                    <button onClick={addFrame} className="shrink-0 h-full aspect-video rounded-lg border-2 border-dashed border-white/10 hover:border-cyan-500/50 hover:bg-cyan-500/5 flex items-center justify-center text-gray-600 hover:text-cyan-400 transition-all">
                                        <Plus size={24}/>
                                    </button>
                                </Reorder.Group>
                            )}
                        </div>

                        {audioBuffer && (
                            <div className="flex justify-end mt-1 px-5 pb-2 shrink-0">
                                 <span className="text-[9px] font-mono text-cyan-500 uppercase tracking-widest">
                                    Frame {currentFrameIndex + 1} / {frames.length}
                                 </span>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>

            {/* ADVANCED BACKGROUND REMOVAL MODAL */}
            {isBgRemovalModalOpen && (
                <div className="fixed inset-0 z-[2000] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto animate-in fade-in duration-300" onPointerDown={e => e.stopPropagation()}>
                    <div className="bg-[#111115]/95 border border-white/10 rounded-3xl w-full max-w-4xl p-6 md:p-8 flex flex-col gap-6 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.9)] text-white animate-in zoom-in-95 duration-300 max-h-[90vh] overflow-y-auto">
                        
                        {/* Header */}
                        <div className="flex justify-between items-start border-b border-white/5 pb-4">
                            <div>
                                <h3 className="text-xl font-black text-white flex items-center gap-2">
                                    <Sparkles className="text-amber-400 animate-pulse" size={22}/>
                                    {t('Advanced Background Removal')}
                                </h3>
                                <p className="text-gray-400 text-xs mt-1">
                                    {t('Optimize and clean up images or sketches for perfect frame-by-frame animation.')}
                                </p>
                            </div>
                            <button 
                                onClick={() => setIsBgRemovalModalOpen(false)}
                                className="p-2 hover:bg-white/5 rounded-full text-gray-400 hover:text-white transition-all"
                            >
                                <X size={20}/>
                            </button>
                        </div>
                        
                        {/* Split Layout */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-stretch">
                            
                            {/* Left Column: Real-time Live Preview */}
                            <div className="flex flex-col gap-3 min-h-[300px]">
                                <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-1.5">
                                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping"></span>
                                    {t('Real-Time Extraction Preview')}
                                </span>
                                <div 
                                    className="flex-1 min-h-[300px] border border-white/10 rounded-2xl relative overflow-hidden flex items-center justify-center p-4 bg-black/40 shadow-inner group"
                                    style={{ 
                                        backgroundImage: 'repeating-conic-gradient(#222 0% 25%, transparent 0% 50%)', 
                                        backgroundSize: '20px 20px' 
                                    }}
                                >
                                    {bgRemovalPreviewUri ? (
                                        <img 
                                            src={bgRemovalPreviewUri} 
                                            alt="Preview" 
                                            className="max-w-full max-h-[340px] object-contain drop-shadow-[0_10px_20px_rgba(0,0,0,0.5)] transition-all select-none"
                                            referrerPolicy="no-referrer"
                                        />
                                    ) : (
                                        <div className="flex flex-col items-center gap-3 text-gray-500 font-medium">
                                            <Loader2 size={32} className="animate-spin text-amber-500"/>
                                            <span className="text-xs">{t('Generating preview...')}</span>
                                        </div>
                                    )}
                                    
                                    {/* Hover to reveal original */}
                                    {bgRemovalOrigUri && (
                                        <div className="absolute bottom-3 left-3 bg-black/80 hover:bg-black/95 px-2.5 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-wider border border-white/10 cursor-help transition-all shadow-md select-none">
                                            {t('Transparent Grid Background')}
                                        </div>
                                    )}
                                </div>
                            </div>
                            
                            {/* Right Column: Settings */}
                            <div className="flex flex-col justify-between gap-6">
                                <div className="space-y-6">
                                    
                                    {/* Mode Selector */}
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
                                            {t('Select Processing Method')}
                                        </label>
                                        <div className="grid grid-cols-2 gap-3">
                                            <button 
                                                onClick={() => setBgRemovalMode('lineart')}
                                                className={`p-4 rounded-xl border text-left transition-all ${bgRemovalMode === 'lineart' ? 'border-amber-500 bg-amber-500/10 text-white' : 'border-white/10 bg-[#16161a] hover:bg-white/5 text-gray-400'}`}
                                            >
                                                <div className="flex items-center gap-2 font-bold text-xs">
                                                    <PenTool size={14} className={bgRemovalMode === 'lineart' ? 'text-amber-400' : 'text-gray-400'}/>
                                                    {t('Line Art Extractor')}
                                                </div>
                                                <p className="text-[10px] text-gray-400 mt-1 leading-relaxed">
                                                    {t('Perfect for drawings, sketches, and camera photos of paper drawings. Extracts ink perfectly.')}
                                                </p>
                                            </button>
                                            
                                            <button 
                                                onClick={() => setBgRemovalMode('ai')}
                                                className={`p-4 rounded-xl border text-left transition-all ${bgRemovalMode === 'ai' ? 'border-cyan-500 bg-cyan-500/10 text-white' : 'border-white/10 bg-[#16161a] hover:bg-white/5 text-gray-400'}`}
                                            >
                                                <div className="flex items-center gap-2 font-bold text-xs">
                                                    <Scissors size={14} className={bgRemovalMode === 'ai' ? 'text-cyan-400' : 'text-gray-400'}/>
                                                    {t('AI Segmenter')}
                                                </div>
                                                <p className="text-[10px] text-gray-400 mt-1 leading-relaxed">
                                                    {t('Best for complex photos, full-color cartoon figures, or distinct physical objects.')}
                                                </p>
                                            </button>
                                        </div>
                                    </div>
                                    
                                    {/* Conditional Settings */}
                                    {bgRemovalMode === 'lineart' ? (
                                        <div className="space-y-4 animate-in fade-in duration-200">
                                            
                                            {/* Threshold slider */}
                                            <div className="space-y-1.5 bg-[#16161a] border border-white/5 p-3 rounded-xl">
                                                <div className="flex justify-between items-center">
                                                    <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{t('Paper Brightness Threshold')}</span>
                                                    <span className="text-xs font-mono font-bold text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded">{bgRemovalThreshold}</span>
                                                </div>
                                                <p className="text-[9px] text-gray-500 leading-tight">
                                                    {t('Controls white paper detection. Increase if shadows/creases remain.')}
                                                </p>
                                                <div className="flex items-center gap-3 pt-1">
                                                    <button 
                                                        onClick={() => setBgRemovalThreshold(prev => Math.max(0, prev - 5))}
                                                        className="w-6 h-6 rounded bg-white/5 hover:bg-white/10 flex items-center justify-center font-bold text-xs"
                                                    >
                                                        -
                                                    </button>
                                                    <input 
                                                        type="range"
                                                        min="0"
                                                        max="255"
                                                        value={bgRemovalThreshold}
                                                        onChange={(e) => setBgRemovalThreshold(Number(e.target.value))}
                                                        className="flex-1 accent-amber-500 h-1 bg-white/10 rounded-full appearance-none"
                                                    />
                                                    <button 
                                                        onClick={() => setBgRemovalThreshold(prev => Math.min(255, prev + 5))}
                                                        className="w-6 h-6 rounded bg-white/5 hover:bg-white/10 flex items-center justify-center font-bold text-xs"
                                                    >
                                                        +
                                                    </button>
                                                </div>
                                            </div>
                                            
                                            {/* Smoothness slider */}
                                            <div className="space-y-1.5 bg-[#16161a] border border-white/5 p-3 rounded-xl">
                                                <div className="flex justify-between items-center">
                                                    <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{t('Ink Edge Contrast')}</span>
                                                    <span className="text-xs font-mono font-bold text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded">{bgRemovalSmoothness}</span>
                                                </div>
                                                <p className="text-[9px] text-gray-500 leading-tight">
                                                    {t('Controls ink line sharpness. Lower values give razor-sharp binary lines; higher values keep pencil shading.')}
                                                </p>
                                                <div className="flex items-center gap-3 pt-1">
                                                    <button 
                                                        onClick={() => setBgRemovalSmoothness(prev => Math.max(0, prev - 2))}
                                                        className="w-6 h-6 rounded bg-white/5 hover:bg-white/10 flex items-center justify-center font-bold text-xs"
                                                    >
                                                        -
                                                    </button>
                                                    <input 
                                                        type="range"
                                                        min="0"
                                                        max="100"
                                                        value={bgRemovalSmoothness}
                                                        onChange={(e) => setBgRemovalSmoothness(Number(e.target.value))}
                                                        className="flex-1 accent-amber-500 h-1 bg-white/10 rounded-full appearance-none"
                                                    />
                                                    <button 
                                                        onClick={() => setBgRemovalSmoothness(prev => Math.min(100, prev + 2))}
                                                        className="w-6 h-6 rounded bg-white/5 hover:bg-white/10 flex items-center justify-center font-bold text-xs"
                                                    >
                                                        +
                                                    </button>
                                                </div>
                                            </div>

                                            {/* Joint Gap Closer Toggle */}
                                            <div className="flex items-center justify-between bg-[#16161a] border border-white/5 p-3.5 rounded-xl">
                                                <div className="space-y-1 pr-4">
                                                    <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest block">{t('Smart Joint Infill')}</span>
                                                    <p className="text-[9px] text-gray-500 leading-relaxed">
                                                        {t('Detects and connects tiny gaps/joints in hand-drawn line art so paint bucket fills work perfectly without leaking.')}
                                                    </p>
                                                </div>
                                                <label className="relative inline-flex items-center cursor-pointer select-none">
                                                    <input 
                                                        type="checkbox" 
                                                        checked={bgRemovalInfillJoints}
                                                        onChange={(e) => setBgRemovalInfillJoints(e.target.checked)}
                                                        className="sr-only peer"
                                                    />
                                                    <div className="w-11 h-6 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-500"></div>
                                                </label>
                                            </div>

                                            {/* Ink Color Mode */}
                                            <div className="space-y-2 bg-[#16161a] border border-white/5 p-3.5 rounded-xl">
                                                <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest block">{t('Ink Colorization Mode')}</span>
                                                <p className="text-[9px] text-gray-500 leading-tight mb-2">
                                                    {t('Convert the line art to solid digital ink as if drawn in the app.')}
                                                </p>
                                                <div className="grid grid-cols-3 gap-2">
                                                    {[
                                                        { key: 'preserve', label: t('Original Pencil') },
                                                        { key: 'black', label: t('Solid Black') },
                                                        { key: 'current', label: t('Current Brush') }
                                                    ].map(opt => (
                                                        <button
                                                            key={opt.key}
                                                            onClick={() => setBgRemovalInkColorMode(opt.key as any)}
                                                            className={`py-2 rounded-lg text-[10px] font-bold border transition-all ${bgRemovalInkColorMode === opt.key ? 'border-amber-500 bg-amber-500/10 text-white' : 'border-white/5 bg-black/40 hover:bg-white/5 text-gray-400'}`}
                                                        >
                                                            {opt.label}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                            
                                        </div>
                                    ) : (
                                        <div className="space-y-4 animate-in fade-in duration-200 bg-[#16161a] border border-white/5 p-4 rounded-xl text-center">
                                            <Scissors size={28} className="text-cyan-400 mx-auto mb-2 animate-bounce"/>
                                            <div className="font-bold text-xs text-white">{t('AI Subject Segmenter')}</div>
                                            <p className="text-[10px] text-gray-400 leading-relaxed max-w-xs mx-auto mt-1">
                                                {t('Utilizes a deep neural network to segment the main foreground object and separate it cleanly from its environment.')}
                                            </p>
                                        </div>
                                    )}
                                    
                                </div>
                                
                                {/* Bottom Actions */}
                                <div className="flex gap-3 border-t border-white/5 pt-4">
                                    <button 
                                        onClick={() => setIsBgRemovalModalOpen(false)}
                                        className="flex-1 py-3.5 bg-white/5 hover:bg-white/10 rounded-2xl text-gray-400 hover:text-white text-xs font-black uppercase tracking-widest transition-all"
                                    >
                                        {t('Cancel')}
                                    </button>
                                    <button 
                                        onClick={applyAdvancedBgRemoval}
                                        disabled={isProcessingBgRemoval || (bgRemovalMode === 'lineart' && !bgRemovalPreviewUri)}
                                        className="flex-1 py-3.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 active:scale-[0.98] disabled:opacity-50 text-black text-xs font-black uppercase tracking-widest rounded-2xl transition-all flex items-center justify-center gap-2 shadow-[0_10px_30px_rgba(245,158,11,0.3)]"
                                    >
                                        {isProcessingBgRemoval ? (
                                            <>
                                                <Loader2 size={14} className="animate-spin"/>
                                                {t('Processing...')}
                                            </>
                                        ) : (
                                            <>
                                                <Check size={14} className="stroke-[3]"/>
                                                {t('Bake & Apply Layer')}
                                            </>
                                        )}
                                    </button>
                                </div>
                                
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* RIGGING TYPE PROMPT - Global Overlay */}
            {showRiggingPrompt && (
                <div className="fixed inset-0 z-[2000] bg-black/80 flex items-center justify-center animate-in fade-in">
                    <div className="bg-[#111] border border-white/10 rounded-2xl w-full max-w-sm p-6 shadow-2xl animate-in zoom-in-95 flex flex-col gap-6">
                        <div>
                            <h3 className="text-white font-bold text-lg">{t('Select Rig Type')}</h3>
                            <p className="text-gray-400 text-xs mt-1">{t('Choose how the bones influence the drawing.')}</p>
                        </div>
                        <div className="flex flex-col gap-3">
                            <button 
                                onClick={() => { setShowRiggingPrompt(false); startRigging('HUMAN'); }}
                                className="p-4 border border-white/10 hover:border-cyan-500 hover:bg-cyan-500/10 rounded-xl text-left transition-all"
                            >
                                <div className="text-cyan-400 font-bold mb-1">{t('Human Rig (Rigid)')}</div>
                                <div className="text-gray-400 text-[10px] leading-tight">{t('Best for separate body parts like arms/legs. Moving a bone snaps its exact area without gooey stretching.')}</div>
                            </button>
                            <button 
                                onClick={() => { setShowRiggingPrompt(false); startRigging('MESH'); }}
                                className="p-4 border border-white/10 hover:border-purple-500 hover:bg-purple-500/10 rounded-xl text-left transition-all"
                            >
                                <div className="text-purple-400 font-bold mb-1">{t('Mesh Rig (Soft)')}</div>
                                <div className="text-gray-400 text-[10px] leading-tight">{t('Best for gooey, stretchy objects like cloaks, tails, or slime. Influences bleed organically between bones.')}</div>
                            </button>
                        </div>
                        <button 
                            onClick={() => setShowRiggingPrompt(false)}
                            className="w-full py-3 bg-white/5 hover:bg-white/10 rounded-xl text-gray-400 text-xs font-bold transition-all"
                        >
                            {t('CANCEL')}
                        </button>
                    </div>
                </div>
            )}

            {/* ONION SKIN MODAL OVERLAY */}
            {showOnionSkinMenu && (
                <div className="fixed inset-0 z-[9999] flex items-center justify-center pointer-events-none">
                    <motion.div drag dragMomentum={false} className="relative bg-[#111] border border-white/10 p-5 rounded-2xl shadow-[0_40px_100px_rgba(0,0,0,0.8)] flex flex-col gap-4 min-w-[240px] z-[10000] pointer-events-auto cursor-move animate-in fade-in zoom-in-95 duration-200">
                        <div className="flex justify-between items-center pb-3 border-b border-white/10">
                            <span className="text-xs font-black text-gray-200 uppercase tracking-widest pointer-events-none">{t('Onion Skin Settings')}</span>
                            <button onPointerDownCapture={(e)=>e.stopPropagation()} onClick={() => setShowOnionSkinMenu(false)} className="text-gray-500 hover:text-white p-1 bg-white/5 rounded-full cursor-pointer"><X size={14}/></button>
                        </div>
                        <div className="flex flex-col gap-4 cursor-default" onPointerDownCapture={(e)=>e.stopPropagation()}>
                            <div className="flex justify-between items-center">
                                <span className="text-[11px] font-mono text-gray-400">{t('Previous Frames (Red)')}</span>
                                <input type="number" min="0" max="10" value={onionSkinSettings.prev} onChange={e => setOnionSkinSettings(s => ({...s, prev: parseInt(e.target.value) || 0}))} className="w-14 bg-black border border-white/10 rounded px-2 py-1 text-xs text-white text-center outline-none focus:border-cyan-500 transition-colors"/>
                            </div>
                            <div className="flex justify-between items-center">
                                <span className="text-[11px] font-mono text-gray-400">{t('Next Frames (Green)')}</span>
                                <input type="number" min="0" max="10" value={onionSkinSettings.next} onChange={e => setOnionSkinSettings(s => ({...s, next: parseInt(e.target.value) || 0}))} className="w-14 bg-black border border-white/10 rounded px-2 py-1 text-xs text-white text-center outline-none focus:border-cyan-500 transition-colors"/>
                            </div>
                            <div className="flex flex-col gap-2 mt-2">
                                <div className="flex justify-between text-[11px] font-mono text-gray-400">
                                    <span>{t('Base Opacity')}</span>
                                    <span>{Math.round(onionSkinSettings.opacity * 100)}%</span>
                                </div>
                                <input type="range" min="0.1" max="1" step="0.05" value={onionSkinSettings.opacity} onChange={e => setOnionSkinSettings(s => ({...s, opacity: parseFloat(e.target.value)}))} className="w-full h-1.5 bg-white/20 rounded-full appearance-none accent-cyan-500 cursor-pointer"/>
                            </div>
                        </div>
                    </motion.div>
                </div>
            )}

            {/* EXPORT OPTIONS MENU */}
            {isExportMenuOpen && (
                <div className="fixed inset-0 z-[1000] bg-black/60 flex items-center justify-center p-4">
                    <div className="bg-[#18181b] border border-white/10 rounded-xl w-full max-w-sm overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
                        <div className="p-4 border-b border-white/10 flex items-center justify-between">
                            <h3 className="font-semibold text-white">{t('Export Animation')}</h3>
                            <button onClick={() => setIsExportMenuOpen(false)} className="text-gray-400 hover:text-white transition-colors">
                                <X size={20} />
                            </button>
                        </div>
                        <div className="p-6 flex flex-col gap-5">
                            <div className="flex flex-col gap-2">
                                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{t('Format')}</label>
                                <div className="grid grid-cols-1 gap-2">
                                    <button 
                                        onClick={() => setExportFormat('video')}
                                        className={`px-4 py-3 text-left rounded-lg border ${exportFormat === 'video' ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400' : 'bg-black border-white/5 text-gray-300 hover:bg-white/5'} transition-all flex flex-col`}
                                    >
                                        <div className="flex justify-between items-center w-full">
                                            <span className="font-medium text-sm">{t('Video File')}</span>
                                        </div>
                                        <span className="text-xs opacity-70">{t('High quality render')}</span>
                                    </button>
                                    
                                    {exportFormat === 'video' && (
                                        <div className="flex gap-2 pl-4 py-1 animate-in fade-in duration-200">
                                            <button
                                                onClick={() => setVideoCodec('mp4')}
                                                className={`flex-1 py-2 text-xs rounded-lg border font-medium transition-all ${videoCodec === 'mp4' ? 'bg-white/10 border-white/20 text-white' : 'bg-transparent border-transparent text-gray-400 hover:text-white'}`}
                                            >
                                                MP4 (H.264)
                                            </button>
                                            <button
                                                onClick={() => setVideoCodec('webm')}
                                                className={`flex-1 py-2 text-xs rounded-lg border font-medium transition-all ${videoCodec === 'webm' ? 'bg-white/10 border-white/20 text-white' : 'bg-transparent border-transparent text-gray-400 hover:text-white'}`}
                                            >
                                                WebM (VP9)
                                            </button>
                                        </div>
                                    )}
                                    <button 
                                        onClick={() => setExportFormat('gif')}
                                        className={`px-4 py-3 text-left rounded-lg border ${exportFormat === 'gif' ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400' : 'bg-black border-white/5 text-gray-300 hover:bg-white/5'} transition-all flex flex-col`}
                                    >
                                        <span className="font-medium text-sm">{t('Animated GIF')}</span>
                                        <span className="text-xs opacity-70">{t('Lossless palette, slow render')}</span>
                                    </button>
                                    <button 
                                        onClick={() => setExportFormat('zip')}
                                        className={`px-4 py-3 text-left rounded-lg border ${exportFormat === 'zip' ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400' : 'bg-black border-white/5 text-gray-300 hover:bg-white/5'} transition-all flex flex-col`}
                                    >
                                        <span className="font-medium text-sm">{t('Frame Sequence')}</span>
                                        <span className="text-xs opacity-70">{t('.zip of PNG frames')}</span>
                                    </button>
                                    
                                    <button 
                                        onClick={() => setExportFormat('game')}
                                        className={`px-4 py-3 text-left rounded-lg border ${exportFormat === 'game' ? 'bg-amber-500/10 border-amber-500/30 text-amber-400' : 'bg-black border-white/5 text-gray-300 hover:bg-white/5'} transition-all flex flex-col`}
                                    >
                                        <span className="font-medium text-sm flex items-center gap-1.5">
                                            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>
                                            {t('Export as Game Format')}
                                        </span>
                                        <span className="text-xs opacity-70">{t('.anim_game bundle for Animato Game Builder')}</span>
                                    </button>
                                </div>
                            </div>
                            
                            <button 
                                onClick={handleExport} 
                                className={`w-full py-3 flex items-center justify-center gap-2 font-black uppercase tracking-widest text-sm rounded-lg transition-all active:scale-95 mt-2 ${
                                    exportFormat === 'game' 
                                        ? 'bg-amber-500 hover:bg-amber-400 text-black shadow-[0_0_20px_rgba(245,158,11,0.3)]' 
                                        : 'bg-cyan-500 hover:bg-cyan-400 text-black shadow-[0_0_20px_rgba(6,182,212,0.3)]'
                                }`}
                            >
                                <Play size={16} fill="currentColor"/> {t('Render Animation')}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* FULL PREVIEW MODAL */}
            {isShowingPreview && (
                <div className="fixed inset-0 z-[100001] bg-[#0c0c0e] flex flex-col items-center justify-center animate-in fade-in duration-300 backdrop-blur-3xl">
                    <div className="absolute inset-0 bg-[#0c0c0e]/95 pointer-events-none" />
                    
                    {/* Top Bar Classic UI */}
                    <div className="absolute top-0 left-0 right-0 h-14 bg-[#111] border-b border-white/10 z-[1001] flex items-center justify-between px-6">
                        <div className="flex items-center gap-3">
                            <Video size={16} className="text-gray-400" />
                            <span className="text-xs font-medium text-gray-300 tracking-wide">{t('Export Preview')}</span>
                        </div>

                        <div className="flex items-center gap-4">
                            {isExporting ? (
                                <div className="flex items-center gap-3 w-48">
                                    <span className="text-[10px] font-mono text-gray-400">{t('ENCODING')}</span>
                                    <div className="flex-1 h-1.5 bg-black rounded-full overflow-hidden border border-white/10">
                                        <div 
                                            className="h-full bg-white transition-all duration-300 ease-out" 
                                            style={{ width: `${exportProgress || 0}%` }}
                                        />
                                    </div>
                                    <span className="text-[10px] font-mono text-white w-8 text-right">{exportProgress?.toFixed(0)}%</span>
                                </div>
                            ) : null}
                            
                            <div className="w-px h-6 bg-white/10 mx-2"></div>
                            
                            <button 
                                onClick={() => { setIsShowingPreview(false); setIsPlaying(false); setExportedFile(null); }} 
                                className="text-gray-500 hover:text-white transition-colors p-1"
                            >
                                <X size={20}/>
                            </button>
                        </div>
                    </div>

                    <div className="flex-1 relative flex items-center justify-center p-8 w-full h-full overflow-hidden min-h-0 min-w-0 mt-14">
                        
                        {exportedFile ? (
                            <div className="flex flex-col items-center justify-center gap-6 animate-in fade-in zoom-in-95 duration-500 w-full max-w-3xl">
                                {exportedFile.type === 'video' ? (
                                    <video 
                                        src={exportedFile.url} 
                                        controls 
                                        autoPlay 
                                        loop 
                                        className="w-full max-h-[60vh] object-contain rounded-lg shadow-[0_0_50px_rgba(0,0,0,0.5)] border border-white/10"
                                    />
                                ) : exportedFile.type === 'gif' ? (
                                    <img 
                                        src={exportedFile.url} 
                                        alt="Animation Preview"
                                        className="w-full max-h-[60vh] object-contain rounded-lg shadow-[0_0_50px_rgba(0,0,0,0.5)] border border-white/10"
                                    />
                                ) : exportedFile.type === 'game' ? (
                                    <div className="w-full max-h-[60vh] h-[400px] flex flex-col items-center justify-center bg-[#1e140a] rounded-lg shadow-[0_0_50px_rgba(0,0,0,0.5)] border border-amber-500/20">
                                        <div className="w-16 h-16 bg-amber-500/20 text-amber-400 rounded-2xl flex items-center justify-center mb-4 animate-bounce">
                                            <Gamepad2 size={32} />
                                        </div>
                                        <p className="text-amber-400 font-bold text-lg">{t('Animation Compiled to Game Format')}</p>
                                        <p className="text-gray-400 text-xs mt-2 max-w-md text-center leading-relaxed px-4">
                                            {t('Download this .anim_game file to load it as a custom player/enemy sprite directly inside your Animato Game Builder scenes!')}
                                        </p>
                                    </div>
                                ) : (
                                    <div className="w-full max-h-[60vh] h-[400px] flex flex-col items-center justify-center bg-gray-900 rounded-lg shadow-[0_0_50px_rgba(0,0,0,0.5)] border border-white/10">
                                        <div className="w-16 h-16 bg-blue-500/20 text-blue-400 rounded-2xl flex items-center justify-center mb-4">
                                            <Download size={32} />
                                        </div>
                                        <p className="text-gray-300 font-medium">{t('Frames extracted to ZIP')}</p>
                                    </div>
                                )}
                                <div className="flex items-center gap-4 mt-4">
                                    <button 
                                        onClick={() => {
                                            if (!exportedFile) return;
                                            
                                            const baseName = settings?.name?.trim() || "animation";
                                            const ext = exportedFile.extension || (exportedFile.type === 'video' ? 'webm' : exportedFile.type === 'gif' ? 'gif' : 'zip');
                                            
                                            setNamingModalValue(baseName);
                                            setNamingModalExtension(ext);
                                            setIsNamingModalOpen(true);
                                        }}
                                        className="px-8 py-3 bg-white text-black hover:bg-gray-200 transition-transform active:scale-95 rounded-lg text-sm font-bold flex items-center gap-2 shadow-2xl"
                                    >
                                        <Download size={18}/>
                                        {t('Download File')}
                                    </button>
                                    <button 
                                        onClick={() => {
                                            setExportedFile(null);
                                            setIsPlaying(true);
                                        }}
                                        className="px-6 py-3 bg-white/10 text-white hover:bg-white/20 transition-all rounded-lg text-sm font-semibold"
                                    >
                                        {t('Back to Editor')}
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <>
                                {isExporting && (
                                    <div className="absolute inset-0 z-50 bg-[#0c0c0e] flex flex-col items-center justify-center gap-6 animate-in fade-in">
                                        <div className="relative w-24 h-24 mb-4">
                                            <div className="absolute inset-0 border-4 border-white/5 rounded-full"></div>
                                            <div className="absolute inset-0 border-4 border-cyan-500 rounded-full border-t-transparent animate-spin"></div>
                                            <div className="absolute inset-0 flex items-center justify-center text-xl font-bold font-mono text-white">
                                                {exportProgress?.toFixed(0)}%
                                            </div>
                                        </div>
                                        <div className="text-gray-400 font-medium tracking-wide">{t('Rendering Animation...')}</div>
                                    </div>
                                )}
                                <div 
                                    id="export-canvas-target"
                                    className={`relative overflow-hidden pointer-events-auto border border-white/5 flex shrink-0 export-target shadow-[0_40px_100px_rgba(0,0,0,0.5)]`}
                                    style={{ 
                                aspectRatio: `${canvasSize.width} / ${canvasSize.height}`,
                                maxWidth: '100%',
                                maxHeight: '100%',
                                width: canvasSize.width >= canvasSize.height ? '100%' : 'auto',
                                height: canvasSize.height >= canvasSize.width ? '100%' : 'auto',
                                background: isCanvasTransparent ? 'transparent' : (canvasBgColor !== 'transparent' ? canvasBgColor : '#ffffff'),
                                pointerEvents: isExporting ? 'none' : 'auto'
                            }}
                        >
                            {/* Checkerboard for transparent previews */}
                            {isCanvasTransparent && (
                                <div className="absolute inset-0 z-0 opacity-10" style={{
                                    backgroundImage: 'conic-gradient(#333 90deg, #444 90deg 180deg, #333 180deg 270deg, #444 270deg)',
                                    backgroundSize: '40px 40px'
                                }}/>
                            )}
                            
                            {/* LAYERED DYNAMIC RENDERING FOR PREVIEW / CACHE */}
                            <div className="absolute inset-0 z-10 w-full h-full">
                                {(() => {
                                    let indices = [currentFrameIndex];
                                    if (isPlaying) {
                                        const nextIdx = (currentFrameIndex + 1) % Math.max(1, frames.length);
                                        const prevIdx = (currentFrameIndex - 1 + frames.length) % Math.max(1, frames.length);
                                        indices.push(nextIdx, prevIdx);
                                    }
                                    return Array.from(new Set(indices));
                                })().map((frameIdx) => {
                                    const frame = frames[frameIdx];
                                    if (!frame) return null;
                                    const isCurrentFrame = frameIdx === currentFrameIndex;
                                    return (
                                        <div 
                                            key={frame.id}
                                            className="absolute inset-0 w-full h-full"
                                            style={{ visibility: isCurrentFrame ? 'visible' : 'hidden' }}
                                        >
                                            {frame.layers?.filter(l => l.visible).map(layer => (
                                                <LayerRenderer 
                                                    key={layer.id}
                                                    layer={layer}
                                                    isActiveFrame={isCurrentFrame}
                                                    activeLayerId={null} // Don't hide the active layer in export renderer!
                                                    isPlaying={true}     // Force PLAY mode to render the raw image not canvas context
                                                    canvasSize={canvasSize}
                                                    isTransforming={false}
                                                    isLassoExtraction={false}
                                                    isRiggingMode={false}
                                                    isLowPerformanceMode={isLowPerformanceMode}
                                                />
                                            ))}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                        </>
                        )}
                    </div>

                    {/* Timeline indicator in preview */}
                    {!isExporting && !exportedFile && (
                        <div className="absolute bottom-12 w-full px-12 z-[1001] pointer-events-none">
                            <div className="w-full h-1 bg-white/10 rounded-full relative overflow-hidden">
                                <div 
                                    className="absolute h-full bg-cyan-500 transition-all duration-100"
                                    style={{ width: `${((currentFrameIndex + 1) / frames.length) * 100}%` }}
                                />
                            </div>
                            <div className="mt-2 text-center text-[10px] font-mono text-gray-500">
                                FRAME {currentFrameIndex + 1} / {frames.length}
                            </div>
                        </div>
                    )}
                </div>
            )}
            {isImportingVideo && (
                <div className="fixed inset-0 bg-[#0a0a0a]/95 backdrop-blur-sm z-[9999] flex flex-col items-center justify-center p-8">
                    {extractingFrameUri ? (
                        <div className="relative mb-8 w-64 aspect-video rounded-xl overflow-hidden border border-white/10 shadow-2xl">
                            <img src={extractingFrameUri} className="w-full h-full object-contain bg-black/50" />
                            <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent flex flex-col justify-end p-4">
                                <div className="text-2xl font-black text-white font-mono">{importVideoProgress}%</div>
                            </div>
                        </div>
                    ) : (
                        <div className="relative w-32 h-32 mb-8">
                            <div className="absolute inset-0 border-4 border-white/5 rounded-full"></div>
                            <div className="absolute inset-0 border-4 border-purple-500 rounded-full border-t-transparent animate-spin"></div>
                            <div className="absolute inset-0 flex items-center justify-center text-2xl font-black text-white font-mono">
                                {importVideoProgress}%
                            </div>
                        </div>
                    )}
                    <h2 className="text-xl sm:text-2xl font-black text-white tracking-widest uppercase text-center mb-2">{t('Extracting Video Frames')}</h2>
                    <p className="text-gray-400 max-w-md text-center text-[11px] sm:text-xs">
                        {t('Reading frames at chosen FPS. This might take a moment. Please do not close the window.')}
                    </p>
                </div>
            )}
            {/* --- COMPACT FRAMES GRID MODAL --- */}
            {showCompactFrames && (
                <div className="fixed inset-0 z-[600] bg-black/80 backdrop-blur-md flex items-center justify-center animate-in fade-in zoom-in-95 duration-200">
                    <div className="w-[90vw] max-w-5xl h-[80vh] flex flex-col bg-[#111] border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
                        <div className="flex items-center justify-between p-4 bg-[#181818] border-b border-white/5">
                            <h2 className="text-sm font-bold text-white tracking-widest uppercase flex items-center gap-2">
                                <LayoutGrid size={16}/> {t('Frames Grid')}
                            </h2>
                            <button onClick={() => setShowCompactFrames(false)} className="p-2 hover:bg-white/10 rounded-lg text-gray-400 hover:text-white transition-colors">
                                <X size={20}/>
                            </button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                            {frames.length > 50 ? (
                                <VirtuosoGrid
                                    style={{ height: '100%', width: '100%' }}
                                    totalCount={frames.length + 1}
                                    listClassName="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4"
                                    itemContent={(idx) => {
                                        if (idx === frames.length) {
                                            return (
                                                <li style={{ listStyle: 'none' }} className="relative h-full w-full group rounded-xl border-2 border-dashed border-white/20 bg-white/5 hover:bg-white/10 hover:border-cyan-500 transition-all cursor-pointer flex items-center justify-center p-4 aspect-video" onClick={addFrame}>
                                                    <div className="flex flex-col items-center gap-2 text-gray-500 group-hover:text-cyan-400">
                                                        <Plus size={32}/>
                                                        <span className="text-[10px] font-bold uppercase tracking-widest">{t('Add Frame')}</span>
                                                    </div>
                                                </li>
                                            );
                                        }
                                        const frame = frames[idx];
                                        return (
                                            <li 
                                                style={{ listStyle: 'none' }}
                                                className="relative h-full w-full group rounded-xl border-2 border-white/10 bg-black overflow-hidden hover:border-cyan-500/50 transition-colors cursor-pointer"
                                                onClick={() => {
                                                    saveActiveLayer();
                                                    setCurrentFrameIndex(idx);
                                                    setShowCompactFrames(false);
                                                }}
                                            >
                                                <div className="aspect-video w-full relative">
                                                    {frame.dataUri ? (
                                                        <img src={frame.dataUri} loading="lazy" className="w-full h-full object-contain pointer-events-none" />
                                                    ) : (
                                                        <div className="w-full h-full flex items-center justify-center opacity-10"><ImageIcon size={24}/></div>
                                                    )}
                                                </div>
                                                <div className="absolute top-2 left-2 bg-black/80 px-2 py-0.5 rounded text-[10px] font-bold text-white shadow-lg">
                                                    {idx + 1}
                                                </div>
                                            </li>
                                        );
                                    }}
                                />
                            ) : (
                                <Reorder.Group 
                                    axis="y"
                                    values={frames} 
                                    onReorder={(newOrder) => {
                                        const currentFrameObj = frames[currentFrameIndex];
                                        setFrames(newOrder);
                                        const newIdx = newOrder.findIndex(f => f.id === currentFrameObj.id);
                                        if (newIdx !== -1) setCurrentFrameIndex(newIdx);
                                    }}
                                    className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4"
                                    style={{ listStyleType: 'none', margin: 0, padding: 0 }}
                                    as="ul"
                                >
                                    {frames.map((frame, idx) => (
                                        <Reorder.Item 
                                            key={frame.id} 
                                            value={frame}
                                            className="relative group rounded-xl border-2 border-white/10 bg-black overflow-hidden cursor-grab active:cursor-grabbing hover:border-cyan-500/50 transition-colors"
                                            style={{ userSelect: 'none' }}
                                            as="li"
                                        >
                                            <div className="w-full h-full" onClick={() => {
                                                saveActiveLayer();
                                                setCurrentFrameIndex(idx);
                                                setShowCompactFrames(false);
                                            }}>
                                                <div className="aspect-video w-full relative">
                                                    {frame.dataUri ? (
                                                        <img src={frame.dataUri} loading="lazy" className="w-full h-full object-contain pointer-events-none" />
                                                    ) : (
                                                        <div className="w-full h-full flex items-center justify-center opacity-10"><ImageIcon size={24}/></div>
                                                    )}
                                                </div>
                                                <div className="absolute top-2 left-2 bg-black/80 px-2 py-0.5 rounded text-[10px] font-bold text-white shadow-lg">
                                                    {idx + 1}
                                                </div>
                                            </div>
                                            {/* Actions overlay */}
                                            <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex justify-end gap-1">
                                                <button 
                                                    onPointerDown={e => e.stopPropagation()}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        saveActiveLayer();
                                                        const currentFrameCopy = safeDeepClone(frame);
                                                        currentFrameCopy.id = `f_${Date.now()}_${Math.random()}`;
                                                        currentFrameCopy.layers = currentFrameCopy.layers?.map(l => ({ ...l, id: `layer_${Date.now()}_${Math.random()}` }));
                                                        setFrames(prev => {
                                                            const next = [...prev];
                                                            next.splice(idx + 1, 0, currentFrameCopy);
                                                            return next;
                                                        });
                                                        setCurrentFrameIndex(idx + 1);
                                                        triggerLocalToast(t('Frame Copied'));
                                                    }}
                                                    className="p-1.5 bg-white/10 hover:bg-white/20 rounded shadow-lg text-white"
                                                    title={t('Copy Frame')}
                                                >
                                                    <Copy size={12}/>
                                                </button>
                                                <button 
                                                    onPointerDown={e => e.stopPropagation()}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        if (frames.length > 1) {
                                                            const confirmDelete = window.confirm(t('Are you sure you want to delete this frame?'));
                                                            if (confirmDelete) {
                                                                const newFrames = frames.filter(f => f.id !== frame.id);
                                                                setFrames(newFrames);
                                                                if (currentFrameIndex >= newFrames.length) {
                                                                    setCurrentFrameIndex(newFrames.length - 1);
                                                                }
                                                            }
                                                        }
                                                    }}
                                                    className="p-1.5 bg-red-500/20 hover:bg-red-500/80 rounded shadow-lg text-red-500 hover:text-white transition-colors"
                                                >
                                                    <Trash2 size={12}/>
                                                </button>
                                            </div>
                                        </Reorder.Item>
                                    ))}
                                    <li className="relative group rounded-xl border-2 border-dashed border-white/20 bg-white/5 hover:bg-white/10 hover:border-cyan-500 transition-all cursor-pointer flex items-center justify-center p-4 aspect-video" onClick={addFrame}>
                                        <div className="flex flex-col items-center gap-2 text-gray-500 group-hover:text-cyan-400">
                                            <Plus size={32}/>
                                            <span className="text-[10px] font-bold uppercase tracking-widest">{t('Add Frame')}</span>
                                        </div>
                                    </li>
                                </Reorder.Group>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* --- CUSTOMIZABLE EXPORT FILE NAMING MODAL --- */}
            {isNamingModalOpen && (
                <div className="fixed inset-0 z-[100005] flex items-center justify-center">
                    {/* Backdrop */}
                    <div 
                        className="fixed inset-0 bg-black/85 backdrop-blur-md animate-in fade-in duration-300"
                        onClick={() => setIsNamingModalOpen(false)}
                    />
                    
                    {/* Modal Card */}
                    <div className="relative z-10 w-full max-w-md bg-[#18181b] border border-white/15 p-6 rounded-3xl shadow-[0_25px_50px_-12px_rgba(0,0,0,0.8)] animate-in zoom-in-95 duration-200" onPointerDown={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between mb-5">
                            <h3 className="text-white font-black text-xs tracking-widest uppercase flex items-center gap-2">
                                <Edit2 size={16} className="text-cyan-400"/>
                                {t('EXPORT FILE NAME')}
                            </h3>
                            <button 
                                onClick={() => setIsNamingModalOpen(false)}
                                className="text-gray-500 hover:text-white transition-colors p-1 rounded-lg hover:bg-white/5"
                            >
                                <X size={18}/>
                            </button>
                        </div>

                        <p className="text-xs text-gray-400 mb-4 leading-relaxed">
                            {t('Choose a classic, elegant name for your animation file before exporting.')}
                        </p>

                        <div className="space-y-5">
                            {/* Input container with design and icon */}
                            <div className="relative flex items-center">
                                {/* Icon inside the input */}
                                <div className="absolute left-4 text-cyan-400/80 pointer-events-none">
                                    <Type size={16} />
                                </div>
                                <input
                                    type="text"
                                    value={namingModalValue}
                                    onChange={(e) => setNamingModalValue(e.target.value)}
                                    placeholder={t('Enter file name...')}
                                    className="w-full bg-black/60 border border-white/10 rounded-2xl py-3.5 pl-11 pr-20 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 font-medium tracking-wide transition-all"
                                    autoFocus
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                            handleConfirmDownload();
                                        }
                                    }}
                                />
                                {/* Suffix Extension Badge */}
                                <div className="absolute right-3.5 bg-cyan-950/80 border border-cyan-500/30 text-cyan-400 text-[10px] font-black font-mono px-2.5 py-1 rounded-lg select-none uppercase tracking-wider">
                                    .{namingModalExtension}
                                </div>
                            </div>

                            {/* Footer Buttons */}
                            <div className="flex items-center justify-end gap-3 pt-2">
                                <button
                                    onClick={() => setIsNamingModalOpen(false)}
                                    className="px-5 py-2.5 bg-white/5 hover:bg-white/10 text-white rounded-xl text-xs font-bold transition-all active:scale-95 border border-white/5"
                                >
                                    {t('Cancel')}
                                </button>
                                <button
                                    onClick={handleConfirmDownload}
                                    className="px-6 py-2.5 bg-gradient-to-r from-cyan-500 to-teal-500 hover:from-cyan-400 hover:to-teal-400 text-black font-black rounded-xl text-xs flex items-center gap-1.5 shadow-[0_0_20px_rgba(34,211,238,0.3)] transition-all active:scale-95"
                                >
                                    <Check size={14} strokeWidth={2.5}/>
                                    {t('Export & Save')}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>

        {/* --- FLOATING TRANSFORM TOOLBAR (Portaled to body to avoid canvas transforms) --- */}
        {!isPlaying && isTransforming && transformImageUri && createPortal(
            <div 
                className="draggable-panel fixed z-[1000] pointer-events-auto flex flex-wrap sm:flex-nowrap items-center justify-center gap-1 bg-[#18181b]/98 backdrop-blur-xl p-1.5 rounded-xl sm:rounded-2xl border border-white/10 shadow-[0_10px_40px_rgba(0,0,0,0.8)] max-w-[92vw] sm:max-w-none cursor-move select-none"
                style={{ left: transformPanel.pos.x, top: transformPanel.pos.y }}
                onPointerDown={transformPanel.onPointerDown}
                onPointerMove={transformPanel.onPointerMove}
                onPointerUp={transformPanel.onPointerUp}
            >
                <div className="text-gray-500 hover:text-white transition-colors px-1 flex items-center justify-center touch-none" title={t('Drag Toolbar')}>
                    <GripVertical size={14} className="opacity-60" />
                </div>
                
                {/* Confirm Action */}
                <button 
                    onPointerDown={e => e.stopPropagation()}
                    onClick={confirmTransform}
                    className="p-1.5 sm:p-2 rounded-lg sm:rounded-xl bg-green-500 text-black hover:bg-green-400 transition-all shadow-lg active:scale-95 flex items-center justify-center"
                    title={t('Confirm')}
                >
                    <Check size={14} strokeWidth={3}/>
                </button>
                
                <div className="w-px h-5 sm:h-6 bg-white/10 mx-0.5 sm:mx-1"></div>
                

                
                {/* Flip transformations */}
                <button
                    onPointerDown={e => e.stopPropagation()}
                    onClick={() => setTransformState(prev => ({ ...prev, flipX: !prev.flipX }))}
                    className={`p-1.5 sm:p-2 rounded-lg sm:rounded-xl transition-all shadow-md active:scale-95 ${transformState.flipX ? 'bg-cyan-500 text-black' : 'bg-white/5 text-gray-300 hover:bg-white/10'}`}
                    title={t('Flip Horizontal')}
                >
                    <FlipHorizontal size={14} />
                </button>
                <button
                    onPointerDown={e => e.stopPropagation()}
                    onClick={() => setTransformState(prev => ({ ...prev, flipY: !prev.flipY }))}
                    className={`p-1.5 sm:p-2 rounded-lg sm:rounded-xl transition-all shadow-md active:scale-95 ${transformState.flipY ? 'bg-cyan-500 text-black' : 'bg-white/5 text-gray-300 hover:bg-white/10'}`}
                    title={t('Flip Vertical')}
                >
                    <FlipVertical size={14} />
                </button>
                
                <div className="w-px h-5 sm:h-6 bg-white/10 mx-0.5 sm:mx-1"></div>
                
                {/* Clipboard operations */}
                <button 
                    onPointerDown={e => e.stopPropagation()}
                    onClick={handleCopy}
                    className="p-1.5 sm:p-2 rounded-lg sm:rounded-xl bg-white/5 text-white hover:bg-white/10 transition-all active:scale-95 flex items-center justify-center"
                    title={t('Copy')}
                >
                    <Copy size={14}/>
                </button>
                <button 
                    onPointerDown={e => e.stopPropagation()}
                    onClick={handleCut}
                    className="p-1.5 sm:p-2 rounded-lg sm:rounded-xl bg-white/5 text-white hover:bg-white/10 transition-all active:scale-95 flex items-center justify-center"
                    title={t('Cut')}
                >
                    <Scissors size={14}/>
                </button>
                
                <div className="w-px h-5 sm:h-6 bg-white/10 mx-0.5 sm:mx-1"></div>
                
                {/* Cancel Action */}
                <button 
                    onPointerDown={e => e.stopPropagation()}
                    onClick={() => { 
                        setIsTransforming(false); 
                        setIsLassoMode(false); 
                        setTransformImageUri(null); 
                    }}
                    className="p-1.5 sm:p-2 rounded-lg sm:rounded-xl bg-red-500/20 text-red-400 hover:bg-red-500/30 hover:text-red-300 transition-all active:scale-95 flex items-center justify-center"
                    title={t('Cancel')}
                >
                    <X size={14} strokeWidth={2.5}/>
                </button>
            </div>,
            document.body
        )}
        </>
    );
};
