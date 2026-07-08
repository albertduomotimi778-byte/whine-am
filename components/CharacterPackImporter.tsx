
import { showAppToast } from '../utils/toastHelper';
import React, { useState, useRef, useMemo, useCallback, Suspense, lazy, useEffect } from 'react';
import { useLanguage } from '../utils/LanguageContext';
import { CharacterComposition, CharacterPart, TransformState, VisemeShape, UnpackedImage, PlacedAsset, AssemblerSession } from '../types';
import { processCharacterFile } from '../utils/zipUtils';
import { safeDeepClone } from '../utils/cloneUtils';
import { UploadCloud, X, Check, Layers, Image as ImageIcon, Trash2, UserCog, ChevronsUpDown, ArrowLeft, GripVertical, AlertTriangle, ZoomIn, ZoomOut, Maximize, Move, Settings, Scaling, Edit3, GripHorizontal, Smile, RotateCcw, RotateCw, PlusCircle, Ghost, FileUp, Cpu } from 'lucide-react';

const VisemeMapper = lazy(() => import('./VisemeMapper'));

// --- TYPES ---

type Assignments = Record<string, string | null>; // Maps rigPartId -> placedAssetId

interface CharacterAssemblerProps {
    onClose: () => void;
    baseRig: CharacterComposition;
    onImplement: (character: CharacterComposition, visemeMap?: Record<VisemeShape, string | null>) => void;
    savedSession?: AssemblerSession | null;
    onSaveSession?: (session: AssemblerSession) => void;
    currentVisemeMap?: Record<VisemeShape, string | null>; // NEW PROP
    initialFile?: File | null;
}

// --- HELPER: Coordinate System Logic ---
const getRecursiveParentTransform = (partId: string | null, parts: CharacterComposition): { x: number, y: number, scaleX: number, scaleY: number, rotation: number } => {
    if (!partId || !parts[partId]) return { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 };
    
    const parent = parts[partId];
    const pt = getRecursiveParentTransform(parent.parentId, parts);
    
    const rad = (pt.rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    
    const rx = parent.transform.x * pt.scaleX;
    const ry = parent.transform.y * pt.scaleY;
    
    // Safety clamp to avoid division by zero later
    const safeParentScaleX = Math.abs(parent.transform.scaleX) < 0.001 ? 0.001 : parent.transform.scaleX;
    const safeParentScaleY = Math.abs(parent.transform.scaleY) < 0.001 ? 0.001 : parent.transform.scaleY;

    return {
        x: pt.x + (rx * cos - ry * sin),
        y: pt.y + (rx * sin + ry * cos),
        scaleX: pt.scaleX * safeParentScaleX,
        scaleY: pt.scaleY * safeParentScaleY,
        rotation: pt.rotation + parent.transform.rotation
    };
};

// --- HELPER: DRAGGABLE HOOK ---
const useDraggableElement = (initialPos: {x: number, y: number}) => {
    // Only used for initial render, actual pos is updated via DOM
    const posRef = useRef(initialPos); 
    const [isDragging, setIsDragging] = useState(false);
    const offsetRef = useRef({ x: 0, y: 0 });
    
    // We keep a dummy state just to trigger initial render if needed, but not on every move
    const [_, forceRender] = useState(0);

    const handlePointerDown = (e: React.PointerEvent) => {
        if ((e.target as HTMLElement).tagName.toLowerCase() === 'select' || (e.target as HTMLElement).tagName.toLowerCase() === 'input') return;
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(true);
        offsetRef.current = { x: e.clientX - posRef.current.x, y: e.clientY - posRef.current.y };
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    };

    const handlePointerMove = (e: React.PointerEvent) => {
        if (!isDragging) return;
        e.stopPropagation();
        const newX = e.clientX - offsetRef.current.x;
        const newY = e.clientY - offsetRef.current.y;
        posRef.current = { x: newX, y: newY };
        
        // Update DOM directly to avoid React re-renders causing lag
        const target = (e.currentTarget as HTMLElement).closest('.touch-none') as HTMLElement;
        if (target) {
            target.style.transform = `translate3d(${newX}px, ${newY}px, 0)`;
        }
    };

    const handlePointerUp = (e: React.PointerEvent) => {
        if (!isDragging) return;
        setIsDragging(false);
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    };

    // Return posRef.current as pos so the initial render picks it up
    return { pos: posRef.current, handlePointerDown, handlePointerMove, handlePointerUp, isDragging };
};


// --- DRAGGABLE ASSET ON CANVAS ---
const PlacedDraggableAsset = React.memo(({ data, isSelected, isMovable, assignedPartLabel, onSelect, onDoubleTap, onMove, onAnchorChange, onRotationChange, onDragEnd, forcePointerEvents, zoom }: {
    data: PlacedAsset;
    isSelected: boolean;
    isMovable: boolean;
    assignedPartLabel: string | null;
    onSelect: (id: string, e: React.PointerEvent) => void;
    onDoubleTap: (id: string) => void;
    onMove: (id: string, dx: number, dy: number) => void;
    onAnchorChange: (id: string, prop: 'anchorX' | 'anchorY', val: number) => void;
    onRotationChange: (id: string, rot: number) => void;
    onDragEnd: () => void;
    forcePointerEvents: boolean;
    zoom: number;
}) => {
    const dragStartRef = useRef<{ x: number, y: number } | null>(null);
    const anchorDragRef = useRef<{ startX: number, startY: number, initX: number, initY: number } | null>(null);
    const rotationDragRef = useRef<{ startX: number, startY: number, startRot: number, centerX: number, centerY: number } | null>(null);
    const lastTapRef = useRef<number>(0);
    const totalDelta = useRef({ dx: 0, dy: 0 });
    const elRef = useRef<HTMLDivElement>(null);
    
    const handlePointerDown = (e: React.PointerEvent) => { 
        if (anchorDragRef.current || rotationDragRef.current) return;
        e.stopPropagation();
        if (!isMovable) return; 
        
        const now = Date.now();
        if (now - lastTapRef.current < 300) { onDoubleTap(data.id); }
        lastTapRef.current = now;

        dragStartRef.current = { x: e.clientX, y: e.clientY }; 
        totalDelta.current = { dx: 0, dy: 0 };
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        onSelect(data.id, e); 
    };
    
    const handlePointerMove = (e: React.PointerEvent) => { 
        if (anchorDragRef.current) {
            e.stopPropagation();
            if (!elRef.current) return;
            // The rect should be the asset's bounding box without transformation...
            // actually boundingClientRect contains transformation.
            // But we scale roughly based on logical width/height and zoom
            const rectWidth = data.asset.width * data.transform.scaleX * zoom;
            const rectHeight = data.asset.height * data.transform.scaleY * zoom;
            
            const deltaX = ((e.clientX - anchorDragRef.current.startX) / rectWidth) * 100;
            const deltaY = ((e.clientY - anchorDragRef.current.startY) / rectHeight) * 100;
            
            const newAnchorX = Math.max(0, Math.min(100, anchorDragRef.current.initX + deltaX));
            const newAnchorY = Math.max(0, Math.min(100, anchorDragRef.current.initY + deltaY));
            
            onAnchorChange(data.id, 'anchorX', newAnchorX);
            onAnchorChange(data.id, 'anchorY', newAnchorY);
            return;
        }
        if (rotationDragRef.current) {
            e.stopPropagation();
            const angle = Math.atan2(e.clientY - rotationDragRef.current.centerY, e.clientX - rotationDragRef.current.centerX);
            const degrees = (angle * 180 / Math.PI) + 90; 
            onRotationChange(data.id, degrees);
            return;
        }

        if (!dragStartRef.current) return; 
        const dx = (e.clientX - dragStartRef.current.x) / zoom; 
        const dy = (e.clientY - dragStartRef.current.y) / zoom; 
        
        dragStartRef.current = { x: e.clientX, y: e.clientY }; 
        totalDelta.current.dx += dx;
        totalDelta.current.dy += dy;

        onMove(data.id, dx * zoom, dy * zoom);
    };
    
    const handlePointerUp = (e: React.PointerEvent) => { 
        if (anchorDragRef.current) {
            anchorDragRef.current = null;
            onDragEnd();
            return;
        }
        if (rotationDragRef.current) {
            rotationDragRef.current = null;
            onDragEnd();
            return;
        }

        if (dragStartRef.current) {
            dragStartRef.current = null; 
            (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
            onDragEnd();
        }
    };

    return (
        <div
            ref={elRef}
            className={`absolute flex touch-none will-change-transform ${isMovable && (!anchorDragRef.current && !rotationDragRef.current) ? 'cursor-grab active:cursor-grabbing' : ''}`}
            style={{
                width: data.asset.width, height: data.asset.height,
                left: '50%', top: '50%',
                transformOrigin: `${data.transform.anchorX ?? 50}% ${data.transform.anchorY ?? 50}%`,
                transform: `translate(${data.transform.x}px, ${data.transform.y}px) translate(-${data.transform.anchorX ?? 50}%, -${data.transform.anchorY ?? 50}%) rotate(${data.transform.rotation}deg) scale(${data.transform.scaleX}, ${data.transform.scaleY})`,
                zIndex: data.zIndex,
                pointerEvents: forcePointerEvents ? 'auto' : 'none',
                opacity: (isMovable || !assignedPartLabel) ? 1 : 0.6
            }}
            onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp}
        >
            <img src={data.asset.url} alt={data.asset.name} className={`w-full h-full pointer-events-none select-none ${isMovable ? '' : 'grayscale-[0.3]'}`} />
            <div className={`absolute inset-0 border-2 transition-all duration-150 rounded-sm ${isSelected ? 'border-cyan-500 shadow-[0_0_15px_rgba(6,182,212,0.3)]' : 'border-transparent hover:border-white/20'}`} />
            {assignedPartLabel && isSelected && (
                <div className={`absolute -top-4 left-1/2 -translate-x-1/2 text-black text-[9px] font-black px-2 py-0.5 rounded shadow-lg pointer-events-none whitespace-nowrap z-50 bg-cyan-500`}>
                    {assignedPartLabel.toUpperCase()}
                </div>
            )}
            {isSelected && (
                <div 
                    className="absolute w-4 h-4 border border-red-500 rounded-full flex items-center justify-center cursor-move shadow-md z-50 mix-blend-difference"
                    style={{ 
                        left: `calc(${data.transform.anchorX ?? 50}% - 8px)`, 
                        top: `calc(${data.transform.anchorY ?? 50}% - 8px)`,
                        pointerEvents: 'auto'
                    }}
                    onPointerDown={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        anchorDragRef.current = {
                            startX: e.clientX,
                            startY: e.clientY,
                            initX: data.transform.anchorX ?? 50,
                            initY: data.transform.anchorY ?? 50
                        };
                    }}
                >
                    <div className="w-1 h-1 bg-red-500 rounded-full"></div>
                </div>
            )}
            
            {isSelected && (
                <div 
                    className="absolute -top-10 left-1/2 -translate-x-1/2 w-6 h-6 bg-amber-500 rounded-full border border-white cursor-crosshair shadow-xl z-50 flex items-center justify-center pointer-events-auto"
                    onPointerDown={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        const el = elRef.current;
                        if (!el) return;
                        const rect = el.getBoundingClientRect();
                        rotationDragRef.current = {
                            startX: e.clientX,
                            startY: e.clientY,
                            startRot: data.transform.rotation,
                            centerX: rect.left + rect.width / 2,
                            centerY: rect.top + rect.height / 2
                        };
                    }}
                >
                    <div className="w-1 h-1 bg-white rounded-full"></div>
                    <div className="absolute top-6 left-1/2 -translate-x-1/2 w-px h-4 bg-amber-500/50"></div>
                </div>
            )}
        </div>
    );
}, (prev, next) => {
    return prev.data === next.data && prev.isSelected === next.isSelected && prev.zoom === next.zoom;
});

type HistoryState = { placedAssets: PlacedAsset[]; assignments: Assignments; unassignedImages: UnpackedImage[]; };

const CharacterAssembler: React.FC<CharacterAssemblerProps> = ({ onClose, baseRig, onImplement, savedSession, onSaveSession, currentVisemeMap, initialFile }) => {
  const { t } = useLanguage();

    const [step, setStep] = useState<'upload' | 'assemble'>('upload');
    const [unassignedImages, setUnassignedImages] = useState<UnpackedImage[]>([]);
    const [placedAssets, setPlacedAssets] = useState<PlacedAsset[]>([]);
    const [initialMaxScaleMap, setInitialMaxScaleMap] = useState<Record<string, number>>({});
    const [assignments, setAssignments] = useState<Assignments>({});
    const [isLoading, setIsLoading] = useState(false);
    const [loadingText, setLoadingText] = useState("LOADING...");
    const [draggedAsset, setDraggedAsset] = useState<UnpackedImage | null>(null);
    const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
    const [activeLayerId, setActiveLayerId] = useState<string | null>(null); 
    const [isInspectorOpen, setIsInspectorOpen] = useState(true);
    const [isAssetTrayOpen, setIsAssetTrayOpen] = useState(true);
    const [promptState, setPromptState] = useState<'none' | 'showing' | 'continue' | 'new'>('none');
    const [lockedLayers, setLockedLayers] = useState<string[]>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const importInputRef = useRef<HTMLInputElement>(null);
    const [showGhost, setShowGhost] = useState(true);
    const [showImportWarning, setShowImportWarning] = useState(false);

    const [history, setHistory] = useState<HistoryState[]>([]);
    const [historyIndex, setHistoryIndex] = useState(-1);

    // --- HANDLE INITIAL FILE ---
    useEffect(() => {
        if (initialFile) {
            handleFileChange({ target: { files: [initialFile] } } as any);
        }
    }, [initialFile]);

    // --- SCALE CONTROL HELPERS ---
    const getMinScaleFactor = (assetId: string) => {
        const rigId = Object.keys(assignments).find(k => assignments[k] === assetId);
        if (!rigId) return 0.1;
        const part = baseRig[rigId];
        if (!part) return 0.1;
        const search = (part.label + (part.id || '')).toLowerCase();
        // Parts that should be allow to scale down further (e.g. eyes, nose, lids)
        const isSmall = search.includes('eye') || search.includes('nose') || search.includes('pupil') || search.includes('lid') || search.includes('ball');
        return isSmall ? 0.01 : 0.1;
    };

    const fromScale = (s: number, id: string) => {
        const maxScale = initialMaxScaleMap[id] || 1.0;
        const minScale = maxScale * getMinScaleFactor(id);
        const absS = Math.abs(s);
        const constrainedS = Math.min(Math.max(absS, minScale), maxScale);
        return ((constrainedS - minScale) / Math.max(maxScale - minScale, 0.0001)) * 99 + 1;                
    };
    const toScale = (v: number, id: string) => {
        const maxScale = initialMaxScaleMap[id] || 1.0;
        const minScale = maxScale * getMinScaleFactor(id);
        return minScale + ((v - 1) / 99) * Math.max(maxScale - minScale, 0.0001);
    };

    const [isVisemeMapperOpen, setIsVisemeMapperOpen] = useState(false);
    const [visemeMap, setVisemeMap] = useState<Partial<Record<VisemeShape, string | null>>>({});

    useEffect(() => {
        // Priority 1: Saved Session (In-memory state preserved during app usage)
        if (savedSession && savedSession.hasSession) {
            setPlacedAssets(savedSession.placedAssets);
            setAssignments(savedSession.assignments);
            setUnassignedImages(savedSession.unassignedImages);
            if (savedSession.visemeMap) setVisemeMap(savedSession.visemeMap); // Restore mouth map
            setStep('assemble');
            return;
        }

        // Priority 2: Reconstruct from Imported Rig (If no session exists but rig has content)
        const hasContent = (Object.values(baseRig) as CharacterPart[]).some(p => p.imageUrl && !p.isGroup);
        
        if (hasContent && step === 'upload' && promptState === 'none') {
            setPromptState('showing');
            return;
        }

        if (hasContent && step === 'upload' && promptState === 'continue') {
            setIsLoading(true);
            setLoadingText("RECONSTRUCTING SCENE...");
            
            // Allow UI to render loading state
            setTimeout(() => {
                const newPlacedAssets: PlacedAsset[] = [];
                const newAssignments: Assignments = {};
                const newLockedLayers: string[] = [];
                // const newImages: UnpackedImage[] = []; // Unused when clearing tray
                const extractedVisemeMap: Record<VisemeShape, string | null> = { ...visemeMap } as any;

                // Helper to calculate world transform
                const computeWorldTransform = (partId: string): TransformState => {
                    const part = baseRig[partId];
                    if (!part) return { x:0, y:0, scaleX:1, scaleY:1, rotation:0, anchorX:50, anchorY:50 };

                    const parentWorld = part.parentId ? computeWorldTransform(part.parentId) : { x:0, y:0, scaleX:1, scaleY:1, rotation:0 };
                    
                    // Simple Forward Kinematics for Transform Recovery
                    // 1. Rotate Local offset by Parent Rotation
                    const rad = (parentWorld.rotation * Math.PI) / 180;
                    const cos = Math.cos(rad);
                    const sin = Math.sin(rad);
                    
                    // Apply Parent Scale to Local Position
                    const rx = part.transform.x * parentWorld.scaleX;
                    const ry = part.transform.y * parentWorld.scaleY;

                    const worldX = parentWorld.x + (rx * cos - ry * sin);
                    const worldY = parentWorld.y + (rx * sin + ry * cos);
                    
                    return {
                        x: worldX,
                        y: worldY,
                        scaleX: parentWorld.scaleX * part.transform.scaleX,
                        scaleY: parentWorld.scaleY * part.transform.scaleY,
                        rotation: parentWorld.rotation + part.transform.rotation,
                        anchorX: 50, // Reset visual anchor for assembler
                        anchorY: 50
                    };
                };

                // Traverse and rebuild
                const newInitialMaxScaleMap: Record<string, number> = {};
                (Object.values(baseRig) as CharacterPart[]).forEach(part => {
                    if (part.imageUrl) {
                        const imgId = `img_${part.id}`;
                        
                        const imgData: UnpackedImage = {
                            id: imgId,
                            name: part.label,
                            url: part.imageUrl!,
                            width: part.width || 200,
                            height: part.height || 200
                        };

                        // Determine if it should be placed on canvas
                        // Skip if it's a Viseme Node (they stay in tray/map)
                        if (part.tags.includes('Viseme')) {
                             const shape = part.tags.find(t => Object.values(VisemeShape).includes(t as VisemeShape)) as VisemeShape | undefined;
                             if (shape) extractedVisemeMap[shape] = part.imageUrl;
                        } else {
                            // Normal part
                            const worldT = computeWorldTransform(part.id);
                            
                            const assetId = `restored_${part.id}`;
                            const placed: PlacedAsset = {
                                id: assetId,
                                asset: imgData,
                                transform: {
                                    x: worldT.x,
                                    y: worldT.y,
                                    scaleX: worldT.scaleX,
                                    scaleY: worldT.scaleY,
                                    rotation: worldT.rotation,
                                    anchorX: 50,
                                    anchorY: 50
                                },
                                zIndex: part.zIndex
                            };

                            newPlacedAssets.push(placed);
                            newAssignments[part.id] = assetId;
                            newLockedLayers.push(part.id);
                            newInitialMaxScaleMap[assetId] = Math.max(worldT.scaleX, worldT.scaleY);
                        }
                    }
                });

                // Clear Asset Tray for reconstructed characters (User Request)
                // All assets are either on stage or mapped to Visemes.
                setUnassignedImages([]); 

                setPlacedAssets(newPlacedAssets);
                setInitialMaxScaleMap(newInitialMaxScaleMap);
                setAssignments(newAssignments);
                setLockedLayers(newLockedLayers);
                setVisemeMap(extractedVisemeMap);
                
                // If provided via props, sync the map (Prop overrides extracted if strictly newer)
                if (currentVisemeMap && Object.values(currentVisemeMap).some(v => v)) {
                    setVisemeMap(prev => ({...prev, ...currentVisemeMap}));
                }
                
                setStep('assemble');
                setIsLoading(false);
            }, 100);
        }
    }, [savedSession, promptState]); // Added promptState to deps

    // Update active layer if we click an asset that is assigned
    useEffect(() => {
        if (selectedAssetId) {
            const rigId = Object.keys(assignments).find(k => assignments[k] === selectedAssetId);
            if (rigId) setActiveLayerId(rigId);
        }
    }, [selectedAssetId, assignments]);

    const inspectorDrag = useDraggableElement({ x: window.innerWidth - 340, y: 80 });
    const zoomDrag = useDraggableElement({ x: window.innerWidth - 60, y: 20 });
    const editBtnDrag = useDraggableElement({ x: window.innerWidth - 80, y: window.innerHeight / 2 });

    const [view, setView] = useState({ x: 0, y: 0, zoom: 1 });
    const [isPanning, setIsPanning] = useState(false);
    const panStartRef = useRef({ x: 0, y: 0 });
    const viewStartRef = useRef({ x: 0, y: 0 });

    // Filter logic: Show explicitly the 'mouth' group, but HIDE any individual viseme parts (mouth_AI, etc)
    const targetRigParts = useMemo(() => 
        (Object.values(baseRig) as CharacterPart[])
        .filter(p => (!p.isGroup || p.id === 'mouth') && !p.tags.includes('Viseme')), 
    [baseRig]);

    const unassignedRigParts = useMemo(() => targetRigParts.filter(p => !assignments[p.id]), [targetRigParts, assignments]);
    const selectedAsset = useMemo(() => placedAssets.find(p => p.id === selectedAssetId), [placedAssets, selectedAssetId]);
    const selectedAssetRigId = useMemo<string | null | undefined>(() => selectedAssetId ? Object.keys(assignments).find(key => assignments[key] === selectedAssetId) : null, [assignments, selectedAssetId]);

    const saveCurrentSession = useCallback(() => {
        if (onSaveSession && step === 'assemble') {
            onSaveSession({ 
                placedAssets, 
                assignments, 
                unassignedImages, 
                hasSession: true,
                // @ts-ignore
                visemeMap 
            });
        }
    }, [onSaveSession, step, placedAssets, assignments, unassignedImages, visemeMap]);

    const handleClose = () => { saveCurrentSession(); onClose(); };

    const [shouldRecordHistory, setShouldRecordHistory] = useState(false);

    const recordHistory = useCallback(() => {
        const newState: HistoryState = {
            placedAssets: safeDeepClone(placedAssets),
            assignments: safeDeepClone(assignments),
            unassignedImages: safeDeepClone(unassignedImages)
        };
        setHistory(prev => {
            const newHistory = prev.slice(0, historyIndex + 1);
            if (newHistory.length > 30) newHistory.shift();
            return [...newHistory, newState];
        });
        setHistoryIndex(prev => Math.min(prev + 1, 29));
    }, [placedAssets, assignments, unassignedImages, historyIndex]);

    useEffect(() => {
        if (shouldRecordHistory) {
            recordHistory();
            setShouldRecordHistory(false);
        }
    }, [shouldRecordHistory, recordHistory]);

    useEffect(() => { if (step === 'assemble' && history.length === 0) setShouldRecordHistory(true); }, [step, history.length]);

    const handleUndo = () => {
        if (historyIndex > 0) {
            const newIndex = historyIndex - 1;
            const state = history[newIndex];
            setPlacedAssets(state.placedAssets);
            setAssignments(state.assignments);
            setUnassignedImages(state.unassignedImages);
            setHistoryIndex(newIndex);
        }
    };

    const handleRedo = () => {
        if (historyIndex < history.length - 1) {
            const newIndex = historyIndex + 1;
            const state = history[newIndex];
            setPlacedAssets(state.placedAssets);
            setAssignments(state.assignments);
            setUnassignedImages(state.unassignedImages);
            setHistoryIndex(newIndex);
        }
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;
        setIsLoading(true);
        setLoadingText("ANALYZING ASSET PACK...");
        try {
            const fileArray = Array.from(files) as File[];
            const batchSize = 10; // Process 10 files at a time
            const results: UnpackedImage[] = [];

            for (let i = 0; i < fileArray.length; i += batchSize) {
                const batch = fileArray.slice(i, i + batchSize);
                const batchPromises = batch.map(file => processCharacterFile(file));
                const batchResults = await Promise.all(batchPromises);
                results.push(...batchResults.flat());
                setLoadingText(`ANALYZING ASSET PACK... (${Math.min(i + batchSize, fileArray.length)}/${fileArray.length})`);
            }

            setLoadingText("EXTRACTING RESOURCES...");
            // Simulate brief delay for UX
            setTimeout(() => {
                if (results.length > 0) {
                    setUnassignedImages(prev => [...prev, ...results]);
                    if (step !== 'assemble') setStep('assemble');
                } else {
                    // Feedback for no images (ZIP loop issue)
                    const hasAnimato = fileArray.some(f => f.name.toLowerCase().endsWith('.animato') || f.name.toLowerCase().endsWith('.onyx') || f.name.toLowerCase().endsWith('.json'));
                    if (hasAnimato) {
                        showAppToast(t("The selected file appears to be a Rig Configuration rather than an Asset Pack. Please use the 'IMPORT CONFIG OR PSD' tool in the main studio menu to load character configurations."));
                    } else {
                        showAppToast(t("No valid PNG, JPG, or SVG images found in the selected file(s). If you are importing a character rig, use the 'IMPORT CONFIG' tool in the Studio Menu instead."));
                    }
                }
                setIsLoading(false);
            }, 800);
        } catch (err) { showAppToast("Failed to process file."); setIsLoading(false); } finally {
            if (e.target) e.target.value = '';
        }
    };

    const triggerFileInput = useCallback(() => {
        if (fileInputRef.current) {
            // Fix: Call synchronously to ensure browser allows file picker
            fileInputRef.current.click();
        }
    }, []);
    
    const handleCanvasPointerDown = (e: React.PointerEvent) => {
        if (e.button !== 0) return;
        setIsPanning(true);
        panStartRef.current = { x: e.clientX, y: e.clientY };
        viewStartRef.current = { x: view.x, y: view.y };
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        // Deselecting on canvas click allows user to clear selection,
        // which locks all assigned layers (as per "only movable if layer clicked")
        setSelectedAssetId(null);
        setActiveLayerId(null); 
        setIsInspectorOpen(false);
    };

    const handleCanvasPointerMove = (e: React.PointerEvent) => {
        if (!isPanning) return;
        const dx = e.clientX - panStartRef.current.x;
        const dy = e.clientY - panStartRef.current.y;
        setView(v => ({ ...v, x: viewStartRef.current.x + dx, y: viewStartRef.current.y + dy }));
    };

    const handleCanvasPointerUp = (e: React.PointerEvent) => {
        setIsPanning(false);
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    };

    const handleDropOnCanvas = (e: React.DragEvent) => {
        e.preventDefault();
        let asset = draggedAsset;
        if (!asset) {
            const dragId = e.dataTransfer.getData('text/plain');
            asset = unassignedImages.find(img => img.id === dragId) || null;
            if (!asset) return;
        }
        setUnassignedImages(prev => prev.filter(img => img.id !== asset!.id));

        // Auto-scale to fit proportionally in a 300x300 area (approx)
        const maxWidth = 300;
        const maxHeight = 300;
        const scaleX = Math.min(1, maxWidth / asset.width);
        const scaleY = Math.min(1, maxHeight / asset.height);
        const scale = Math.min(scaleX, scaleY);
        
        const newPlacedAsset: PlacedAsset = {
            id: `p_${asset.id}`, asset: asset,
            transform: { x: -view.x / view.zoom, y: -view.y / view.zoom, scaleX: scale, scaleY: scale, rotation: 0, anchorX: 50, anchorY: 50 },
            zIndex: (placedAssets.length > 0 ? Math.max(...placedAssets.map(p => p.zIndex)) : 0) + 1,
        };
        setInitialMaxScaleMap(prev => ({...prev, [newPlacedAsset.id]: scale}));
        setPlacedAssets(prev => [...prev, newPlacedAsset]);
        setSelectedAssetId(newPlacedAsset.id);
        setDraggedAsset(null);
        setIsInspectorOpen(true);
        setShouldRecordHistory(true);
    };

    const handleMoveAsset = (id: string, dx: number, dy: number) => {
        const scale = view.zoom;
        setPlacedAssets(p => p.map(a => a.id === id ? { ...a, transform: { ...a.transform, x: a.transform.x + (dx / scale), y: a.transform.y + (dy / scale) } } : a));
    };

    const handleAssetDragEnd = () => setShouldRecordHistory(true);

    const handleZIndexChange = (id: string, z: number) => setPlacedAssets(p => p.map(a => a.id === id ? { ...a, zIndex: z } : a));
    const handleZIndexCommit = () => setShouldRecordHistory(true);
    const handleScaleChange = useCallback((id: string, axis: 'x' | 'y' | 'uniform', value: number) => {
        setPlacedAssets(p => p.map(a => {
            if (a.id !== id) return a;
            
            const maxScale = initialMaxScaleMap[id] || 1.0;
            const minScale = maxScale * getMinScaleFactor(id);
            
            const newTransform = { ...a.transform };
            
            if (axis === 'uniform') {
                const constrained = Math.min(Math.max(value, minScale), maxScale);
                const signX = a.transform.scaleX < 0 ? -1 : 1;
                const signY = a.transform.scaleY < 0 ? -1 : 1;
                newTransform.scaleX = constrained * signX;
                newTransform.scaleY = constrained * signY;
            } else if (axis === 'x') {
                const sign = value < 0 ? -1 : 1;
                const constrained = Math.min(Math.max(Math.abs(value), minScale), maxScale);
                newTransform.scaleX = constrained * sign;
            } else if (axis === 'y') {
                const sign = value < 0 ? -1 : 1;
                const constrained = Math.min(Math.max(Math.abs(value), minScale), maxScale);
                newTransform.scaleY = constrained * sign;
            }
            return { ...a, transform: newTransform };
        }));
    }, [initialMaxScaleMap]);
    
    const handleRotationChange = (id: string, rot: number) => {
        setPlacedAssets(p => p.map(a => a.id === id ? { ...a, transform: { ...a.transform, rotation: rot } } : a));
    };
    const handleRotationCommit = () => setShouldRecordHistory(true);

    const handleAnchorChange = (id: string, prop: 'anchorX' | 'anchorY', val: number) => {
        setPlacedAssets(p => p.map(a => {
            if (a.id !== id) return a;
            
            // Re-calculate the position to prevent the image from jumping
            // Note: Simplification for UX. When Anchor changes, the CSS transformOrigin changes.
            // Ideally, the image shouldn't jump visually.
            return { ...a, transform: { ...a.transform, [prop]: val } }
        }));
    };
    const handleAnchorCommit = () => setShouldRecordHistory(true);

    const handleScaleCommit = () => setShouldRecordHistory(true);

    const handleAssignLayer = (placedId: string, rigId: string) => {
        if (rigId === 'mouth') {
            const asset = placedAssets.find(p => p.id === placedId);
            if (asset) setVisemeMap(prev => ({ ...prev, [VisemeShape.REST]: asset.asset.url }));
            setIsVisemeMapperOpen(true);
            return;
        }
        setAssignments(prev => ({ ...prev, [rigId]: placedId }));
        setActiveLayerId(rigId);
        setShouldRecordHistory(true);
    };
    
    const handleLayerSelect = (rigId: string) => {
        if (activeLayerId === rigId) {
            // If already active, toggle assignment off (Unassign)
            if (assignments[rigId]) {
                handleUnassignLayer(rigId);
            }
            setActiveLayerId(null);
            setSelectedAssetId(null);
            return;
        }
        setActiveLayerId(rigId);
        const assignedAssetId = assignments[rigId];
        if (assignedAssetId) {
            setSelectedAssetId(assignedAssetId);
            setIsInspectorOpen(true);
        } else {
            setSelectedAssetId(null);
            setIsInspectorOpen(false);
        }
    };

    const handleUnassignLayer = (rigId: string) => {
        setAssignments(prev => ({ ...prev, [rigId]: null }));
        setShouldRecordHistory(true);
    };
    
    const handleDeleteAsset = (id: string) => {
        const assetToDelete = placedAssets.find(p => p.id === id);
        if (assetToDelete) setUnassignedImages(prev => [...prev, assetToDelete.asset]);
        setPlacedAssets(prev => prev.filter(p => p.id !== id));
        if (selectedAssetRigId) handleUnassignLayer(selectedAssetRigId);
        setSelectedAssetId(null);
        setIsInspectorOpen(false);
        setShouldRecordHistory(true);
    };

    const handleVisemeImplement = (newMap: Record<VisemeShape, string | null>) => {
        setVisemeMap(newMap);
        setIsVisemeMapperOpen(false);

        const values = Object.values(newMap);
        const usedUrls = new Set(values.filter((url): url is string => typeof url === 'string'));
        const restUrl = newMap[VisemeShape.REST];

        setUnassignedImages((prev: UnpackedImage[]) => prev.filter((img: UnpackedImage) => {
            return !usedUrls.has(img.url); 
        }));

        if (restUrl && typeof restUrl === 'string') {
             let existingPlacedId = placedAssets.find(p => p.asset.url === restUrl)?.id;
             if (!existingPlacedId) {
                 const imgData = { id: `mouth_rest_${Date.now()}`, name: 'Mouth (Rest)', url: restUrl, width: 200, height: 100 }; 
                 const newId = `p_mouth_${Date.now()}`;
                 const newAsset: PlacedAsset = {
                     id: newId,
                     asset: imgData,
                     transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, anchorX: 50, anchorY: 50 },
                     zIndex: 100
                 };
                 setPlacedAssets(prev => [...prev, newAsset]);
                 existingPlacedId = newId;
             }
             setAssignments(prev => ({ ...prev, 'mouth': existingPlacedId as string }));
             setActiveLayerId('mouth');
             setSelectedAssetId(existingPlacedId);
        }
        setShouldRecordHistory(true);
    };
    
    const handleImplement = () => {
        setIsLoading(true);
        setLoadingText("FINALIZING RIG...");
        saveCurrentSession();
        
        setTimeout(() => {
            const finalRig: CharacterComposition = safeDeepClone(baseRig);
            
            if (promptState === 'new') {
                Object.keys(finalRig).forEach(partId => {
                    if (!finalRig[partId].isGroup) {
                        finalRig[partId].imageUrl = null;
                        finalRig[partId].width = undefined;
                        finalRig[partId].height = undefined;
                    }
                });
            }

            Object.keys(finalRig).forEach(partId => {
                const placedAssetId = assignments[partId];
                if (placedAssetId) {
                    const asset = placedAssets.find(p => p.id === placedAssetId);
                    if (asset) {
                        const parentId = finalRig[partId].parentId;
                        const parentWorld = getRecursiveParentTransform(parentId, finalRig);
                        
                        // Avoid Division by Zero (Coordinate Explosion)
                        const safeScaleX = Math.abs(parentWorld.scaleX) < 0.001 ? 0.001 : parentWorld.scaleX;
                        const safeScaleY = Math.abs(parentWorld.scaleY) < 0.001 ? 0.001 : parentWorld.scaleY;

                        const dx = asset.transform.x - parentWorld.x;
                        const dy = asset.transform.y - parentWorld.y;
                        const rad = (-parentWorld.rotation * Math.PI) / 180;
                        const cos = Math.cos(rad);
                        const sin = Math.sin(rad);
                        const unRotatedX = dx * cos - dy * sin;
                        const unRotatedY = dx * sin + dy * cos;
                        
                        const localX = unRotatedX / safeScaleX;
                        const localY = unRotatedY / safeScaleY;
                        const localScaleX = asset.transform.scaleX / safeScaleX;
                        const localScaleY = asset.transform.scaleY / safeScaleY;
                        const localRotation = asset.transform.rotation - parentWorld.rotation;

                        const newTransform = {
                            ...finalRig[partId].transform,
                            x: localX, y: localY, scaleX: localScaleX, scaleY: localScaleY, rotation: localRotation
                        };

                        finalRig[partId] = { 
                            ...finalRig[partId], 
                            imageUrl: asset.asset.url, 
                            width: asset.asset.width, 
                            height: asset.asset.height, 
                            transform: newTransform,
                            baseTransform: { ...newTransform }, // SAVE BIND POSE
                            zIndex: asset.zIndex 
                        };
                    }
                }
            });
            const mouthPart = finalRig['mouth'];
            if(mouthPart && Object.keys(visemeMap).length > 0) {
                 mouthPart.children = [];
                 
                 // Fix: Ensure parent container keeps the REST image so Rigging Studio tree shows preview
                 mouthPart.imageUrl = visemeMap[VisemeShape.REST] || null; 
                 
                 Object.entries(visemeMap).forEach(([shape, url]) => {
                     if (url) {
                         const visemeId = `${mouthPart.id}_${shape}`;
                         finalRig[visemeId] = { 
                             id: visemeId, label: shape, parentId: mouthPart.id, zIndex: 1, 
                             imageUrl: url as string,
                             // Fix: Inherit width/height from parent so Rigging Studio renders them correctly
                             width: mouthPart.width,
                             height: mouthPart.height,
                             transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, anchorX: 50, anchorY: 50 }, 
                             tags: ['Viseme', shape], children: [], isGroup: false, isIndependent: false, 
                             isVisible: shape === VisemeShape.REST 
                        };
                         mouthPart.children.push(visemeId);
                     }
                 });
            }
            
            onImplement(finalRig, visemeMap as Record<VisemeShape, string | null>);
            setIsLoading(false);
        }, 800);
    };

    if (step === 'upload' && promptState !== 'showing') return (
        <div className="fixed inset-0 z-[400] bg-[#050505] flex flex-col p-4 animate-in fade-in duration-300">
            <button onClick={onClose} className="absolute top-6 right-6 p-2 rounded-full text-gray-500 hover:text-white transition-colors hover:bg-white/10"><X size={24}/></button>
            <div className="flex-1 flex flex-col items-center justify-center text-center">
                <input type="file" ref={fileInputRef} accept="*/*" className="hidden" onChange={handleFileChange} />
                <button 
                    onClick={triggerFileInput} 
                    className="group w-full max-w-lg aspect-[1.5] border border-dashed border-white/10 hover:border-cyan-500/50 bg-[#111] hover:bg-[#151515] rounded-3xl flex flex-col items-center justify-center cursor-pointer transition-all duration-300 relative overflow-hidden"
                >
                    <div className="absolute inset-0 bg-gradient-to-tr from-cyan-500/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                    <div className="relative p-8 flex flex-col items-center">
                        <div className="w-20 h-20 rounded-2xl bg-[#0a0a0a] border border-white/5 flex items-center justify-center mb-6 shadow-2xl group-hover:scale-110 transition-transform duration-300">
                             <UploadCloud size={40} className="text-gray-600 group-hover:text-cyan-400 transition-colors" />
                        </div>
                        <h3 className="text-2xl font-bold text-white mb-2 tracking-tight">{t('Import Character Pack')}</h3>
                        <p className="text-gray-500 text-sm max-w-xs leading-relaxed">{t('Select a')} <span className="text-cyan-500 font-mono">{t('.zip')}</span> {t('file containing your character parts (PNG/JPG).')}</p>
                    </div>
                </button>
                
                {savedSession?.hasSession && (
                    <button onClick={() => setStep('assemble')} className="mt-8 text-gray-500 hover:text-white underline text-sm transition-colors">
                        {t('Cancel & Return to Previous Session')}
                    </button>
                )}
            </div>

            {/* PROFESSIONAL LOADING OVERLAY */}
            {isLoading && (
                <div className="absolute inset-0 bg-[#050505]/95  flex flex-col items-center justify-center z-50 animate-in fade-in">
                    <div className="relative mb-8">
                        <div className="w-16 h-16 border-2 border-white/10 rounded-full animate-[spin_3s_linear_infinite]"></div>
                        <div className="absolute inset-0 w-16 h-16 border-t-2 border-cyan-500 rounded-full animate-spin"></div>
                        <Cpu size={24} className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-cyan-500 animate-pulse" />
                    </div>
                    <div className="flex flex-col items-center gap-2">
                        <span className="text-cyan-500 font-mono text-xs font-bold tracking-[0.2em] uppercase">{loadingText}</span>
                        <span className="text-gray-600 text-[10px] tracking-widest">{t('PLEASE WAIT')}</span>
                    </div>
                </div>
            )}
        </div>
    );

    return (
        <div className="fixed inset-0 z-[400] bg-[#050505]/98 backdrop-blur-[40px] flex flex-col animate-in fade-in duration-300 text-gray-200 selection:bg-cyan-500/30">
            {promptState === 'showing' && (
                <div className="absolute inset-0 z-[600] bg-black/95 backdrop-blur-2xl flex items-center justify-center p-4">
                    <div className="bg-[#111] border border-white/10 rounded-xl max-w-md w-full p-6 shadow-2xl">
                        <h2 className="text-xl font-bold text-white mb-2">{t('Existing Character Found')}</h2>
                        <p className="text-gray-400 text-sm mb-6">
                            {t('This character already has drawn or assigned parts. Do you want to continue editing the existing character, or start a fresh one?')}
                        </p>
                        <div className="flex flex-col gap-3">
                            <button 
                                onClick={() => setPromptState('continue')}
                                className="w-full py-3 bg-cyan-500 hover:bg-cyan-400 text-black font-bold rounded-lg transition-colors"
                            >
                                {t('Continue Editing')}
                            </button>
                            <button 
                                onClick={() => setPromptState('new')}
                                className="w-full py-3 bg-white/5 hover:bg-white/10 text-white font-bold rounded-lg transition-colors border border-white/10"
                            >
                                {t('Create New Character')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
            <Suspense fallback={null}>{isVisemeMapperOpen && <VisemeMapper onClose={() => setIsVisemeMapperOpen(false)} currentMap={visemeMap as Record<VisemeShape, string | null>} onImplement={handleVisemeImplement} theme='dark' availableAssets={unassignedImages} />}</Suspense>
            
            <input type="file" ref={importInputRef} accept="*/*" className="hidden" onChange={handleFileChange} />

            {showImportWarning && (
                <div className="absolute inset-0 z-[500] bg-black/80  flex items-center justify-center p-4 animate-in fade-in duration-200">
                    <div className="bg-[#151515] border border-white/10 rounded-2xl max-w-sm w-full p-6 shadow-2xl scale-100 animate-in zoom-in-95 duration-200">
                        <div className="flex flex-col items-center text-center gap-4">
                            <div className="w-12 h-12 rounded-full bg-cyan-500/10 flex items-center justify-center text-cyan-500 mb-2">
                                <FileUp size={24} />
                            </div>
                            <h3 className="text-lg font-bold text-white">{t('Import Asset Pack?')}</h3>
                            <p className="text-sm text-gray-400 leading-relaxed">
                                {t('This will')} <span className="text-cyan-400 font-bold">{t('add new assets')}</span> {t('to your unassigned images without clearing your current progress.')}
                            </p>
                            <div className="flex gap-3 w-full mt-2">
                                <button 
                                    onClick={() => setShowImportWarning(false)}
                                    className="flex-1 py-3 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 font-bold text-xs transition-colors"
                                >
                                    {t('CANCEL')}
                                </button>
                                <button 
                                    onClick={() => {
                                        importInputRef.current?.click();
                                        setShowImportWarning(false);
                                    }}
                                    className="flex-1 py-3 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-black font-black text-xs transition-colors"
                                >
                                    {t('CONFIRM')}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {isLoading && (
                <div className="absolute inset-0 z-[600] bg-[#050505]/90  flex flex-col items-center justify-center">
                    <div className="flex flex-col items-center gap-6">
                        <div className="relative">
                            <div className="w-12 h-12 border-2 border-white/5 rounded-full"></div>
                            <div className="absolute inset-0 border-t-2 border-cyan-500 rounded-full animate-spin"></div>
                        </div>
                        <div className="flex flex-col items-center gap-1">
                            <div className="text-cyan-400 font-mono font-bold tracking-[0.2em] text-xs">{loadingText}</div>
                            <div className="w-32 h-0.5 bg-white/10 rounded-full overflow-hidden mt-2">
                                <div className="h-full bg-cyan-500 w-1/2 animate-[shimmer_1s_infinite_linear]"></div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
            
            <header className="flex-shrink-0 h-14 md:h-16 px-3 md:px-6 flex justify-between items-center border-b border-white/5 bg-[#0a0a0a]/90  relative z-30">
                <div className="flex items-center gap-3 md:gap-4 flex-1 min-w-0">
                    <button onClick={handleClose} className="p-2 -ml-2 rounded-full text-gray-500 hover:text-white hover:bg-white/5 transition-colors flex-shrink-0"><ArrowLeft size={20}/></button>
                    <div className="min-w-0 overflow-hidden">
                        <h2 className="text-sm font-bold text-white flex items-center gap-2 truncate">
                            <UserCog size={16} className="text-cyan-500 flex-shrink-0" /> 
                            <span className="hidden md:inline">{t('ASSEMBLY STUDIO')}</span>
                            <span className="md:hidden">{t('ASSEMBLER')}</span>
                        </h2>
                        <p className="text-[10px] text-gray-600 font-mono hidden md:block">{t('DRAG ASSETS • POSITION • ASSIGN LAYERS')}</p>
                    </div>
                </div>
                
                <div className="flex items-center gap-2 md:gap-4 flex-shrink-0 ml-2">
                     <button 
                        onClick={() => setShowGhost(!showGhost)}
                        className={`p-2 rounded hover:bg-white/10 transition-colors ${showGhost ? 'text-cyan-400' : 'text-gray-600'}`}
                        title={t('Toggle Reference Template')}
                     >
                         <Ghost size={16}/>
                     </button>

                     <button 
                        onClick={() => setShowImportWarning(true)}
                        className="flex items-center gap-2 px-2 md:px-3 py-1.5 rounded bg-white/5 hover:bg-white/10 border border-white/10 text-[10px] font-bold text-gray-400 hover:text-white transition-all"
                        title={t('Import Additional Assets')}
                     >
                        <FileUp size={14}/> <span className="hidden sm:inline">{t('IMPORT PACK')}</span>
                     </button>

                    <div className="flex items-center bg-[#151515] border border-white/10 rounded-lg p-1">
                        <button 
                            onClick={handleUndo} 
                            disabled={historyIndex <= 0}
                            className="p-1.5 rounded hover:bg-white/10 text-gray-400 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                            title={t('Undo (Ctrl+Z)')}
                        >
                            <RotateCcw size={16}/>
                        </button>
                        <div className="w-px h-4 bg-white/10 mx-1"></div>
                        <button 
                            onClick={handleRedo} 
                            disabled={historyIndex >= history.length - 1}
                            className="p-1.5 rounded hover:bg-white/10 text-gray-400 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                            title={t('Redo (Ctrl+Y)')}
                        >
                            <RotateCw size={16}/>
                        </button>
                    </div>

                    <button 
                        onClick={handleImplement} 
                        disabled={isLoading} 
                        className="px-4 md:px-6 py-2 bg-cyan-500 hover:bg-cyan-400 text-black text-xs font-black tracking-wider rounded-lg shadow-[0_0_20px_rgba(6,182,212,0.2)] hover:shadow-[0_0_30px_rgba(6,182,212,0.4)] transition-all disabled:opacity-50 disabled:shadow-none flex items-center gap-2"
                    >
                        <Check size={14} /> <span className="hidden sm:inline">{t('IMPLEMENT')}</span>
                    </button>
                </div>
            </header>

            <main className="flex-1 relative overflow-hidden bg-[#080808]">
                <div 
                    className="absolute inset-0 touch-none cursor-move"
                    onPointerDown={handleCanvasPointerDown}
                    onPointerMove={handleCanvasPointerMove}
                    onPointerUp={handleCanvasPointerUp}
                    onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }} 
                    onDrop={handleDropOnCanvas}
                >
                    <div 
                        className="absolute inset-0 pointer-events-none opacity-20"
                        style={{ 
                            backgroundImage: `linear-gradient(#333 1px, transparent 1px), linear-gradient(90deg, #333 1px, transparent 1px)`, 
                            backgroundSize: `${50 * view.zoom}px ${50 * view.zoom}px`,
                            backgroundPosition: `${view.x}px ${view.y}px`
                        }}
                    />
                    
                    <div 
                        className="absolute w-full h-full pointer-events-none"
                        style={{ 
                            transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,
                            transformOrigin: '0 0'
                        }}
                    >
                        <div className="absolute top-1/2 left-1/2 w-4 h-4 -ml-2 -mt-2 border border-white/10 rounded-full flex items-center justify-center">
                            <div className="w-0.5 h-0.5 bg-cyan-500 rounded-full"/>
                        </div>

                        {showGhost && (
                            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] opacity-10 pointer-events-none grayscale transition-opacity duration-300">
                                {(Object.values(baseRig) as CharacterPart[]).filter(p => p.imageUrl && p.imageUrl !== "null").map(p => (
                                    <div key={p.id} className="absolute inset-0" style={{transform:`translate(${p.transform.x}px, ${p.transform.y}px)`}}>
                                        <img src={p.imageUrl!} className="w-full h-full object-contain"/>
                                    </div>
                                ))}
                            </div>
                        )}

                        <div 
                            className={`pointer-events-auto ${draggedAsset ? 'pointer-events-none' : ''}`}
                        >
                            {placedAssets.map(p => {
                                const assignedLayer = Object.keys(assignments).find(k => assignments[k] === p.id);
                                const isAssigned = !!assignedLayer;
                                const isAssignedToActiveLayer = activeLayerId && assignments[activeLayerId] === p.id;
                                
                                // STRICT SELECTION LOGIC:
                                // Assigned assets are ONLY movable if their layer is active.
                                // Unassigned assets are ALWAYS movable (for placement).
                                const isMovable = isAssigned ? (activeLayerId === assignedLayer) : true;
                                
                                // FORCE POINTER EVENTS:
                                // If an assigned asset is NOT active, it should be invisible to clicks (pointer-events: none)
                                // so you can click "through" it to select layers behind it (like Face behind Hair).
                                // Unassigned assets are always interactive.
                                const forcePointerEvents = isAssigned ? isAssignedToActiveLayer : true;
                                
                                return (
                                    <PlacedDraggableAsset 
                                        key={p.id} 
                                        data={p} 
                                        isSelected={p.id === selectedAssetId} 
                                        isMovable={isMovable}
                                        assignedPartLabel={baseRig[assignedLayer || '']?.label || null}
                                        forcePointerEvents={forcePointerEvents}
                                        zoom={view.zoom}
                                        onSelect={(id, e) => { e.stopPropagation(); setSelectedAssetId(id); }} 
                                        onDoubleTap={(id) => { setSelectedAssetId(id); setIsInspectorOpen(true); }}
                                        onMove={handleMoveAsset} 
                                        onAnchorChange={(id, prop, val) => {
                                            handleAnchorChange(id, prop, val);
                                        }}
                                        onRotationChange={handleRotationChange}
                                        onDragEnd={handleAssetDragEnd}
                                    />
                                );
                            })}
                        </div>
                    </div>
                </div>

                <div 
                    className="absolute z-40 flex flex-col gap-2 p-1.5 rounded-xl bg-[#111]/90  border border-white/10 shadow-2xl touch-none"
                    style={{ transform: `translate3d(${zoomDrag.pos.x}px, ${zoomDrag.pos.y}px, 0)` }}
                >
                     <div 
                        onPointerDown={zoomDrag.handlePointerDown} 
                        onPointerMove={zoomDrag.handlePointerMove} 
                        onPointerUp={zoomDrag.handlePointerUp}
                        className="h-4 w-full flex items-center justify-center cursor-move mb-1 opacity-50 hover:opacity-100"
                     >
                        <GripHorizontal size={12} />
                     </div>
                     <button onClick={() => setView(v => ({...v, zoom: Math.min(3, v.zoom + 0.1)}))} className="p-2 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"><ZoomIn size={18}/></button>
                     <div className="relative h-32 w-8 flex items-center justify-center">
                        <input 
                            type="range" 
                            min="0.5" max="3" step="0.1" 
                            value={view.zoom} 
                            onChange={e => setView(v => ({...v, zoom: parseFloat(e.target.value)}))}
                            className="absolute -rotate-90 w-32 h-8 opacity-0 cursor-pointer z-10"
                        />
                        <div className="w-1 h-24 bg-white/10 rounded-full relative overflow-hidden">
                             <div 
                                className="absolute bottom-0 left-0 right-0 bg-cyan-500" 
                                style={{ height: `${((view.zoom - 0.5) / 2.5) * 100}%` }} 
                             />
                        </div>
                     </div>
                     <button onClick={() => setView(v => ({...v, zoom: Math.max(0.5, v.zoom - 0.1)}))} className="p-2 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"><ZoomOut size={18}/></button>
                     <div className="w-full h-px bg-white/10 my-1"/>
                     <button onClick={() => setView({x:0, y:0, zoom:1})} className="p-2 text-gray-400 hover:text-cyan-400 hover:bg-white/10 rounded-lg transition-colors" title={t('Reset View')}><Maximize size={18}/></button>
                </div>

                {selectedAsset && !isInspectorOpen && (
                    <div 
                        className="absolute z-50 touch-none"
                        style={{ transform: `translate3d(${editBtnDrag.pos.x}px, ${editBtnDrag.pos.y}px, 0)` }}
                        onPointerDown={editBtnDrag.handlePointerDown}
                        onPointerMove={editBtnDrag.handlePointerMove}
                        onPointerUp={editBtnDrag.handlePointerUp}
                    >
                        <button 
                            onClick={(e) => { 
                                if(!editBtnDrag.isDragging) setIsInspectorOpen(true) 
                            }}
                            className="w-12 h-12 rounded-full bg-cyan-500 text-black shadow-[0_0_20px_rgba(6,182,212,0.4)] flex items-center justify-center animate-in zoom-in hover:scale-110 transition-transform duration-200 cursor-move"
                            title={t('Edit Asset')}
                        >
                            <Edit3 size={20} fill="currentColor" />
                        </button>
                    </div>
                )}
            </main>
            
            {selectedAsset && isInspectorOpen && (
                <div 
                    className="absolute z-[100] shadow-2xl touch-none resize overflow-hidden"
                    style={{ transform: `translate3d(${inspectorDrag.pos.x}px, ${inspectorDrag.pos.y}px, 0)`, width: '280px', minWidth: '220px', maxWidth: '350px', maxHeight: '55vh' }}
                >
                    <div className="bg-[#151515]/95  border border-white/10 rounded-2xl flex flex-col h-full max-h-[55vh] overflow-hidden">
                        <div 
                            className="p-3 border-b border-white/5 flex items-center gap-3 bg-white/5 cursor-move shrink-0"
                            onPointerDown={inspectorDrag.handlePointerDown} 
                            onPointerMove={inspectorDrag.handlePointerMove} 
                            onPointerUp={inspectorDrag.handlePointerUp}
                        >
                            <GripHorizontal size={14} className="text-gray-500" />
                            <div className="w-8 h-8 bg-black/40 rounded-lg border border-white/5 p-1 flex items-center justify-center overflow-hidden pointer-events-none">
                                <img src={selectedAsset.asset.url} className="w-full h-full object-contain"/>
                            </div>
                            <div className="flex-1 min-w-0 pointer-events-none">
                                <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">{t('EDITING ASSET')}</div>
                                <div className="text-xs text-white truncate font-medium">{selectedAsset.asset.name}</div>
                            </div>
                            <button onClick={()=>setIsInspectorOpen(false)} className="p-2 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"><X size={18}/></button>
                        </div>
                        
                        <div className="p-4 space-y-4 flex-1 overflow-y-auto custom-scrollbar rounded-b-2xl">
                            <div className="space-y-2">
                                <label className="text-[10px] font-bold text-gray-500 flex items-center gap-1"><Layers size={10}/> {t('ASSIGN TO LAYER')}</label>
                                <div className="relative">
                                    <select 
                                        value={selectedAssetRigId || ''} 
                                        onChange={(e: React.ChangeEvent<HTMLSelectElement>) => { 
                                            if (selectedAssetRigId) {
                                                handleUnassignLayer(selectedAssetRigId); 
                                            }
                                            if (selectedAsset) handleAssignLayer(selectedAsset.id, e.target.value); 
                                        }} 
                                        className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg px-3 py-2.5 text-xs text-white appearance-none focus:border-cyan-500 outline-none transition-colors"
                                    >
                                        <option value="" disabled>{t('Choose a rig layer...')}</option>
                                        {targetRigParts.map(p => {
                                            const isAssigned = !!assignments[p.id];
                                            const isLocked = lockedLayers.includes(p.id);
                                            return (
                                                <option key={p.id} value={p.id} disabled={isLocked && assignments[p.id] !== selectedAssetId}>
                                                    {p.label} {isAssigned ? (isLocked ? '(Locked)' : '(Assigned)') : ''}
                                                </option>
                                            );
                                        })}
                                    </select>
                                    <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-500"><ChevronsUpDown size={12}/></div>
                                </div>
                            </div>

                            <div className="space-y-3">
                                <label className="text-[10px] font-bold text-gray-500 flex items-center gap-1"><Move size={10}/> {t('TRANSFORM')}</label>
                                <div className="grid grid-cols-2 gap-2">
                                    <button 
                                        onClick={() => handleScaleChange(selectedAsset.id, 'x', selectedAsset.transform.scaleX * -1)}
                                        className={`py-1.5 rounded-lg text-[10px] font-bold border transition-all ${selectedAsset.transform.scaleX < 0 ? 'bg-cyan-500 text-black border-cyan-500' : 'bg-[#111] text-gray-400 border-white/10 hover:border-cyan-500/50'}`}
                                    >
                                        {t('FLIP X')}
                                    </button>
                                    <button 
                                        onClick={() => handleScaleChange(selectedAsset.id, 'y', selectedAsset.transform.scaleY * -1)}
                                        className={`py-1.5 rounded-lg text-[10px] font-bold border transition-all ${selectedAsset.transform.scaleY < 0 ? 'bg-cyan-500 text-black border-cyan-500' : 'bg-[#111] text-gray-400 border-white/10 hover:border-cyan-500/50'}`}
                                    >
                                        {t('FLIP Y')}
                                    </button>
                                </div>
                            </div>

                            <div className="space-y-3">
                                <label className="text-[10px] font-bold text-gray-500 flex items-center gap-1"><Scaling size={10}/> {t('SCALE TRANSFORM')}</label>
                                
                                <div className="space-y-1 pb-1 border-b border-white/5">
                                    <div className="flex justify-between items-center">
                                        <label className="text-[9px] font-bold text-gray-400">{t('UNIFORM')}</label>
                                        <span className="text-[9px] font-mono text-cyan-400">{selectedAsset.transform.scaleX.toFixed(2)}x</span>
                                    </div>
                                    <input 
                                        type="range" 
                                        min="1" max="100" step="0.1"
                                        value={fromScale(selectedAsset.transform.scaleX, selectedAsset.id)} 
                                        onChange={e => handleScaleChange(selectedAsset.id, 'uniform', toScale(parseFloat(e.target.value), selectedAsset.id))} 
                                        onPointerUp={handleScaleCommit}
                                        className="w-full h-1 bg-white/10 rounded-full appearance-none cursor-pointer accent-cyan-500 hover:accent-cyan-400"
                                    />
                                </div>

                                <div className="space-y-1">
                                    <div className="flex justify-between items-center">
                                        <label className="text-[9px] font-bold text-gray-500">{t('SCALE X')}</label>
                                        <span className="text-[9px] font-mono text-cyan-400">{selectedAsset.transform.scaleX.toFixed(2)}x</span>
                                    </div>
                                    <input 
                                        type="range" 
                                        min="1" max="100" step="0.1"
                                        value={fromScale(selectedAsset.transform.scaleX, selectedAsset.id)} 
                                        onChange={e => handleScaleChange(selectedAsset.id, 'x', toScale(parseFloat(e.target.value), selectedAsset.id))} 
                                        onPointerUp={handleScaleCommit}
                                        className="w-full h-1 bg-white/10 rounded-full appearance-none cursor-pointer accent-cyan-500 hover:accent-cyan-400"
                                    />
                                </div>

                                <div className="space-y-1">
                                    <div className="flex justify-between items-center">
                                        <label className="text-[9px] font-bold text-gray-500">{t('SCALE Y')}</label>
                                        <div className="flex items-center gap-1">
                                            <input 
                                                type="number" 
                                                value={selectedAsset.transform.scaleY.toFixed(2)}
                                                onChange={e => handleScaleChange(selectedAsset.id, 'y', parseFloat(e.target.value))}
                                                className="w-10 bg-[#111] border border-white/10 rounded px-1 py-0.5 text-[10px] text-cyan-400 text-center"
                                            />
                                            <span className="text-[9px] font-mono text-cyan-400">{t('x')}</span>
                                        </div>
                                    </div>
                                    <input 
                                        type="range" 
                                        min="1" max="100" step="0.1"
                                        value={fromScale(selectedAsset.transform.scaleY, selectedAsset.id)} 
                                        onChange={e => handleScaleChange(selectedAsset.id, 'y', toScale(parseFloat(e.target.value), selectedAsset.id))} 
                                        onPointerUp={handleScaleCommit}
                                        className="w-full h-1 bg-white/10 rounded-full appearance-none cursor-pointer accent-cyan-500 hover:accent-cyan-400"
                                    />
                                </div>
                            </div>

                            <div className="space-y-3">
                                <label className="text-[10px] font-bold text-gray-500 flex items-center gap-1"><RotateCw size={10}/> {t('ROTATION & ORIGIN')}</label>
                                
                                <div className="space-y-1 border-b border-white/5 pb-2">
                                    <div className="flex justify-between items-center">
                                        <label className="text-[9px] font-bold text-gray-400">{t('ROTATION')}</label>
                                        <span className="text-[9px] font-mono text-cyan-400">{selectedAsset.transform.rotation.toFixed(0)}°</span>
                                    </div>
                                    <input 
                                        type="range" 
                                        min="-180" max="180" step="1"
                                        value={selectedAsset.transform.rotation} 
                                        onChange={e => handleRotationChange(selectedAsset.id, parseFloat(e.target.value))} 
                                        onPointerUp={handleRotationCommit}
                                        className="w-full h-1 bg-white/10 rounded-full appearance-none cursor-pointer accent-amber-500 hover:accent-amber-400"
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-3 pt-1">
                                    <div className="space-y-1">
                                        <div className="flex justify-between items-center">
                                            <label className="text-[8px] font-bold text-gray-500">{t('ANCHOR X')}</label>
                                        </div>
                                        <input 
                                            type="number" 
                                            value={selectedAsset.transform.anchorX !== undefined ? (selectedAsset.transform.anchorX) : 50}
                                            onChange={e => {
                                                handleAnchorChange(selectedAsset.id, 'anchorX', parseFloat(e.target.value));
                                                handleAnchorCommit();
                                            }}
                                            className="w-full bg-[#111] border border-white/10 rounded px-1 min-w-0 py-1 text-[10px] text-cyan-400 text-center"
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <div className="flex justify-between items-center">
                                            <label className="text-[8px] font-bold text-gray-500">{t('ANCHOR Y')}</label>
                                        </div>
                                        <input 
                                            type="number" 
                                            value={selectedAsset.transform.anchorY !== undefined ? (selectedAsset.transform.anchorY) : 50}
                                            onChange={e => {
                                                handleAnchorChange(selectedAsset.id, 'anchorY', parseFloat(e.target.value));
                                                handleAnchorCommit();
                                            }}
                                            className="w-full bg-[#111] border border-white/10 rounded px-1 min-w-0 py-1 text-[10px] text-cyan-400 text-center"
                                        />
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-3">
                                <div className="flex justify-between items-center">
                                    <label className="text-[10px] font-bold text-gray-500">{t('Z-INDEX (DEPTH)')}</label>
                                    <div className="flex items-center gap-2">
                                        <input 
                                            type="number" 
                                            value={selectedAsset.zIndex}
                                            onChange={e => handleZIndexChange(selectedAsset.id, parseInt(e.target.value))}
                                            className="w-10 bg-[#111] border border-white/10 rounded px-1 py-0.5 text-[10px] text-cyan-400 text-center"
                                        />
                                    </div>
                                </div>
                                <input 
                                    type="range" 
                                    min="0" max={placedAssets.length + 5} 
                                    value={selectedAsset.zIndex} 
                                    onChange={e => handleZIndexChange(selectedAsset.id, parseInt(e.target.value))} 
                                    onPointerUp={handleZIndexCommit}
                                    className="w-full h-1 bg-white/10 rounded-full appearance-none cursor-pointer accent-cyan-500 hover:accent-cyan-400"
                                />
                                <div className="flex justify-between text-[9px] text-gray-600 font-mono">
                                    <span>{t('BACK')}</span>
                                    <span>{t('FRONT')}</span>
                                </div>
                            </div>
                            
                            <button onClick={()=>handleDeleteAsset(selectedAsset.id)} className="w-full py-2 flex items-center justify-center gap-2 text-red-400 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 rounded-lg transition-colors text-xs font-bold">
                                <Trash2 size={14}/> {t('REMOVE ASSET')}
                            </button>
                            {selectedAssetRigId && (
                                <button onClick={() => handleUnassignLayer(selectedAssetRigId)} className="w-full py-2 flex items-center justify-center gap-2 text-amber-400 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 rounded-lg transition-colors text-xs font-bold">
                                    <RotateCcw size={14}/> {t('UNASSIGN LAYER')}
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}

            <footer className={`absolute bottom-0 left-0 right-0 z-30 transition-transform duration-300 ease-[cubic-bezier(0.2,0,0,1)] flex flex-col ${selectedAsset ? 'translate-y-0' : 'translate-y-0'}`}>
                <div className="flex justify-center pointer-events-none">
                     <button 
                        onClick={() => setIsAssetTrayOpen(!isAssetTrayOpen)} 
                        className="pointer-events-auto bg-[#151515] border-t border-x border-white/10 rounded-t-xl px-6 py-1 hover:bg-[#1a1a1a] transition-colors"
                     >
                         <GripVertical size={14} className="text-gray-600 rotate-90"/>
                     </button>
                </div>

                <div className={`bg-[#0a0a0a]/95  border-t border-white/10 transition-all duration-300 overflow-hidden ${isAssetTrayOpen ? 'h-40' : 'h-0'}`}>
                    <div className="h-full flex divide-x divide-white/5">
                        <div className="flex-1 flex flex-col min-w-0">
                            <div className="px-4 py-2 border-b border-white/5 flex justify-between items-center">
                                <div className="flex items-center gap-4">
                                    <span className="text-[10px] font-bold text-gray-500 flex items-center gap-2"><ImageIcon size={12}/> {t('ASSETS')}</span>
                                    <span className="text-[10px] bg-white/5 px-1.5 rounded text-gray-400">{unassignedImages.length}</span>
                                </div>
                                <button 
                                    onClick={() => setIsVisemeMapperOpen(true)}
                                    className="px-3 py-1 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 rounded text-[10px] font-bold text-cyan-400 flex items-center gap-2 transition-colors"
                                >
                                    <Smile size={12} />
                                    {t('MOUTH STUDIO')}
                                </button>
                            </div>
                            <div className="flex-1 p-3 overflow-x-auto custom-scrollbar flex gap-3 items-center">
                                {unassignedImages.length === 0 ? (
                                    <div className="w-full text-center text-xs text-gray-600 italic">{t('All assets placed. Good job!')}</div>
                                ) : (
                                    unassignedImages.map(img => (
                                        <div 
                                            key={img.id} 
                                            draggable 
                                            onDragStart={(e) => {
                                                setDraggedAsset(img);
                                                e.dataTransfer.setData('text/plain', img.id);
                                                e.dataTransfer.effectAllowed = 'copyMove';
                                            }} 
                                            onDragEnd={() => setDraggedAsset(null)}
                                            className="w-20 h-20 shrink-0 bg-[#151515] border border-white/5 rounded-lg p-1 cursor-grab active:cursor-grabbing hover:border-cyan-500/50 hover:bg-[#1a1a1a] transition-all flex items-center justify-center group relative"
                                        >
                                            <img src={img.url} className="max-w-full max-h-full object-contain pointer-events-none opacity-70 group-hover:opacity-100 transition-opacity"/>
                                            <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 bg-black/50 rounded-full p-0.5"><Move size={10} className="text-white"/></div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>

                        <div className="w-1/3 md:w-64 flex flex-col bg-[#080808]">
                            <div className="px-4 py-2 border-b border-white/5 flex justify-between items-center">
                                <span className="text-[10px] font-bold text-gray-500 flex items-center gap-2"><Layers size={12}/> {t('REQUIRED')}</span>
                                <span className={`text-[10px] px-1.5 rounded ${unassignedRigParts.length > 0 ? 'bg-amber-500/20 text-amber-500' : 'bg-green-500/20 text-green-500'}`}>{unassignedRigParts.length}</span>
                            </div>
                            <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
                                {targetRigParts.map(p => {
                                    const isAssigned = !!assignments[p.id];
                                    const isLocked = lockedLayers.includes(p.id);
                                    const isActive = activeLayerId === p.id;
                                    
                                    if (p.id === 'mouth') return (
                                        <button 
                                            key={p.id} 
                                            onClick={() => handleLayerSelect(p.id)} 
                                            className={`w-full text-left p-2 rounded flex items-center justify-between group transition-colors ${
                                                isActive 
                                                    ? 'bg-cyan-500/30 text-white border border-cyan-500/50' 
                                                    : (isAssigned ? 'bg-cyan-900/10 text-cyan-600 hover:bg-cyan-500/10' : 'text-gray-300 bg-white/5 hover:bg-white/10')
                                            }`}
                                        >
                                            <span className="text-xs font-bold">{t('Mouth (Group)')}</span>
                                            {isAssigned ? <Check size={10} className="text-cyan-500"/> : <Settings size={12} className="text-gray-500 opacity-50 group-hover:opacity-100" onClick={(e) => { e.stopPropagation(); setIsVisemeMapperOpen(true); }}/>}
                                        </button>
                                    );
                                    
                                    return (
                                        <button 
                                            key={p.id} 
                                            onClick={() => { if (!isLocked) handleLayerSelect(p.id); }}
                                            disabled={isLocked}
                                            className={`w-full text-left px-2 py-1.5 rounded flex items-center justify-between text-xs transition-colors ${
                                                isActive 
                                                    ? 'bg-cyan-500/30 text-white border border-cyan-500/50' 
                                                    : (isAssigned ? (isLocked ? 'text-gray-600 bg-white/5 cursor-not-allowed' : 'text-gray-400 hover:text-white hover:bg-white/5') : 'text-gray-300 bg-white/5 hover:bg-white/10')
                                            }`}
                                        >
                                            <span className={isLocked ? 'line-through opacity-50' : ''}>{p.label}</span>
                                            {isAssigned && (isLocked ? <div className="w-2 h-2 rounded-full bg-gray-600"/> : <Check size={10} className="text-green-500"/>)}
                                        </button>
                                    )
                                })}
                            </div>
                        </div>
                    </div>
                </div>
            </footer>
        </div>
    );
};

export default CharacterAssembler;
