import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useLanguage } from '../utils/LanguageContext';
import { X, Check, Layers, Plus, Trash2, MoveUp, MoveDown, Edit2, Eye, EyeOff, PaintBucket, PenTool, Eraser, Settings, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Undo, Redo, Folder, ChevronDown, ChevronRight, ChevronLeft, GripVertical, Hand, Ruler, Wrench, ZoomIn, ZoomOut, Maximize } from 'lucide-react';
import { AdvancedColorPicker } from './AdvancedColorPicker';
import { CharacterComposition, CharacterPart, TransformState } from '../types';
import { DEFAULT_TRANSFORM, createPart, getInitialParts } from '../utils/characterDefaults';

interface CharacterDesignerProps {
  onClose: () => void;
  onSave: (character: any) => void;
  initialCharacter: any;
}

export interface LayerData {
  id: string;
  name: string;
  zIndex: number;
  isVisible: boolean;
  dataUrl: string;
}

interface DrawingLayer {
  id: string;
  name: string;
  zIndex: number;
  isVisible: boolean;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  version: number;
}

const LayerCanvasRenderer = React.memo(({ layer, isVisible }: { layer: DrawingLayer; isVisible: boolean }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.innerHTML = '';
      layer.canvas.style.width = '100%';
      layer.canvas.style.height = '100%';
      layer.canvas.style.objectFit = 'contain';
      layer.canvas.style.pointerEvents = 'none';
      containerRef.current.appendChild(layer.canvas);
    }
  }, [layer.canvas, layer.version]);

  return (
    <div 
      ref={containerRef} 
      className={`absolute inset-0 w-full h-full pointer-events-none ${!isVisible ? 'opacity-0' : ''}`}
    />
  );
});

// --- HELPER: ROBUST DRAGGABLE HOOK (DELTA BASED) ---
const useDraggable = (initialX: number, initialY: number) => {
    const posRef = useRef({ x: initialX, y: initialY });
    const draggingRef = useRef(false);
    const dragStartRef = useRef({ x: 0, y: 0 });
    const initialPosRef = useRef({ x: 0, y: 0 });

    const onPointerDown = (e: React.PointerEvent) => {
        if ((e.target as HTMLElement).tagName.toLowerCase() === 'input' || (e.target as HTMLElement).tagName.toLowerCase() === 'select') return;
        draggingRef.current = true;
        dragStartRef.current = { x: e.clientX, y: e.clientY };
        initialPosRef.current = { x: posRef.current.x, y: posRef.current.y };
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    };

    const onPointerMove = (e: React.PointerEvent) => {
        if (!draggingRef.current) return;
        const dx = e.clientX - dragStartRef.current.x;
        const dy = e.clientY - dragStartRef.current.y;
        
        const newX = initialPosRef.current.x + dx;
        const newY = initialPosRef.current.y + dy;
        posRef.current = { x: newX, y: newY };
        
        const target = e.currentTarget.parentElement as HTMLElement;
        if (target) {
            target.style.transform = `translate3d(${newX}px, ${newY}px, 0)`;
        }
    };

    const onPointerUp = (e: React.PointerEvent) => {
        draggingRef.current = false;
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    };

    return { pos: posRef.current, onPointerDown, onPointerMove, onPointerUp };
};

export const CharacterDesigner: React.FC<CharacterDesignerProps> = ({ onClose, onSave, initialCharacter }) => {
  const { t } = useLanguage();

  const [character, setCharacter] = useState<CharacterComposition>(() => {
    const source = (initialCharacter && Object.keys(initialCharacter).length > 0) ? initialCharacter : getInitialParts();
    const init = { ...source };
    for (const key in init) {
      if (init[key].isGroup) {
        init[key] = { ...init[key], isOpen: false };
      }
    }
    return init;
  });
  const [layers, setLayers] = useState<DrawingLayer[]>([]);
  const [activeLayerId, setActiveLayerId] = useState<string | null>(null);
  const [tool, setTool] = useState<'pen' | 'pencil' | 'eraser' | 'fill' | 'pan'>('pen');
  const [isToolsMenuOpen, setIsToolsMenuOpen] = useState(false);
  const [penColor, setPenColor] = useState('#000000');
  const [penSize, setPenSize] = useState(3);
  const [pencilColor, setPencilColor] = useState('#555555');
  const [pencilSize, setPencilSize] = useState(1);
  const [eraserSize, setEraserSize] = useState(20);
  const [fillColor, setFillColor] = useState('#ff0000');
  const [isColorPickerOpen, setIsColorPickerOpen] = useState(false);
  const [isFillColorPickerOpen, setIsFillColorPickerOpen] = useState(false);
  const [isPencilColorPickerOpen, setIsPencilColorPickerOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDrawingRef = useRef(false);
  const lastPos = useRef<{x: number, y: number} | null>(null);
  const lastMid = useRef<{x: number, y: number} | null>(null);

  // Zoom and Pan state
  const zoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const lastPanPos = useRef<{x: number, y: number} | null>(null);

  const updateTransform = useCallback(() => {
    if (containerRef.current) {
      containerRef.current.style.transform = `translate(${panRef.current.x}px, ${panRef.current.y}px) scale(${zoomRef.current})`;
    }
  }, []);

  // Ruler state
  const [activeRuler, setActiveRuler] = useState<'circle' | 'square' | 'rectangle' | 'head_male' | 'head_female' | 'head_fat' | 'cloth' | null>(null);
  const [isRulerMenuOpen, setIsRulerMenuOpen] = useState(false);
  const [rulerTransform, setRulerTransform] = useState({ x: 400, y: 400, scale: 1 });
  
  // Movable Ruler Inspector
  const rulerPanel = useDraggable(20, 60);
  
  const activePointers = useRef<Set<number>>(new Set());

  // Drag and drop state
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string, position: 'above' | 'below' | 'inside' } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [selectedPartIds, setSelectedPartIds] = useState<string[]>([]);
  const [longPressTimer, setLongPressTimer] = useState<NodeJS.Timeout | null>(null);

  const CANVAS_WIDTH = 800;
  const CANVAS_HEIGHT = 800;

  const [isLayersPanelOpen, setIsLayersPanelOpen] = useState(false);
  const [artboardColor, setArtboardColor] = useState('transparent');
  const [isArtboardColorPickerOpen, setIsArtboardColorPickerOpen] = useState(false);

  interface HistoryAction {
    layerId: string;
    before: ImageData;
    after: ImageData;
  }
  const [history, setHistory] = useState<HistoryAction[]>([]);
  const [historyStep, setHistoryStep] = useState(-1);
  const beforeStateRef = useRef<ImageData | null>(null);

  const undo = () => {
    if (historyStep >= 0) {
      const action = history[historyStep];
      const layer = layers.find(l => l.id === action.layerId);
      if (layer) {
        layer.ctx.putImageData(action.before, 0, 0);
        // Force re-render of canvas by updating version
        setLayers(prev => prev.map(l => l.id === layer.id ? { ...l, version: l.version + 1 } : l));
      }
      setHistoryStep(prev => prev - 1);
    }
  };

  const redo = () => {
    if (historyStep < history.length - 1) {
      const action = history[historyStep + 1];
      const layer = layers.find(l => l.id === action.layerId);
      if (layer) {
        layer.ctx.putImageData(action.after, 0, 0);
        // Force re-render of canvas by updating version
        setLayers(prev => prev.map(l => l.id === layer.id ? { ...l, version: l.version + 1 } : l));
      }
      setHistoryStep(prev => prev + 1);
    }
  };

  // Prevent default browser pinch zoom
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const preventDefault = (e: TouchEvent) => {
      if (e.touches.length >= 2) {
        e.preventDefault();
      }
    };
    el.addEventListener('touchmove', preventDefault, { passive: false });
    return () => el.removeEventListener('touchmove', preventDefault);
  }, []);

  // Ruler snapping logic
  const rulerPointsRef = useRef<{x: number, y: number}[]>([]);
  useEffect(() => {
    if (!activeRuler) {
      rulerPointsRef.current = [];
      return;
    }
    
    let pathStr = '';
    switch (activeRuler) {
      case 'circle': pathStr = 'M 400 400 m -200, 0 a 200,200 0 1,0 400,0 a 200,200 0 1,0 -400,0'; break;
      case 'square': pathStr = 'M 200 200 L 600 200 L 600 600 L 200 600 Z'; break;
      case 'rectangle': pathStr = 'M 150 250 L 650 250 L 650 550 L 150 550 Z'; break;
      case 'head_male': pathStr = 'M 400 150 C 500 150 550 250 550 350 C 550 450 500 550 450 600 C 420 630 380 630 350 600 C 300 550 250 450 250 350 C 250 250 300 150 400 150 Z'; break;
      case 'head_female': pathStr = 'M 400 180 C 480 180 520 250 520 350 C 520 450 460 550 420 600 C 410 615 390 615 380 600 C 340 550 280 450 280 350 C 280 250 320 180 400 180 Z'; break;
      case 'head_fat': pathStr = 'M 400 200 C 520 200 580 300 580 400 C 580 500 520 580 450 600 C 420 610 380 610 350 600 C 280 580 220 500 220 400 C 220 300 280 200 400 200 Z'; break;
      case 'cloth': pathStr = 'M 300 200 L 500 200 L 550 350 L 500 350 L 500 600 L 300 600 L 300 350 L 250 350 Z'; break;
    }

    const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    pathEl.setAttribute('d', pathStr);
    const len = pathEl.getTotalLength();
    const points = [];
    const numSamples = Math.ceil(len); // 1 sample per pixel for maximum precision
    for (let i = 0; i <= numSamples; i++) {
      const pt = pathEl.getPointAtLength((i / numSamples) * len);
      const scaledX = (pt.x - 400) * rulerTransform.scale + 400;
      const scaledY = (pt.y - 400) * rulerTransform.scale + 400;
      points.push({ 
        x: scaledX + (rulerTransform.x - 400), 
        y: scaledY + (rulerTransform.y - 400) 
      });
    }
    rulerPointsRef.current = points;
  }, [activeRuler, rulerTransform.scale, rulerTransform.x, rulerTransform.y]);

  const snapPoint = (p: {x: number, y: number}) => {
    if (!activeRuler || rulerPointsRef.current.length === 0) return p;
    let closest = rulerPointsRef.current[0];
    let minDistSq = Infinity;
    const len = rulerPointsRef.current.length;
    for (let i = 0; i < len; i++) {
      const rp = rulerPointsRef.current[i];
      const dx = rp.x - p.x;
      const dy = rp.y - p.y;
      const distSq = dx*dx + dy*dy;
      if (distSq < minDistSq) {
        minDistSq = distSq;
        closest = rp;
      }
    }
    return closest;
  };

  useEffect(() => {
    if (character) {
      const loadLayers = async () => {
        const loadedLayers: DrawingLayer[] = [];
        
        for (const partId of Object.keys(character)) {
          const part = character[partId];
          if (part.isGroup || partId === 'root') continue;

          const canvas = document.createElement('canvas');
          canvas.width = CANVAS_WIDTH;
          canvas.height = CANVAS_HEIGHT;
          const ctx = canvas.getContext('2d');
          if (!ctx) continue;
          
          const newLayer: DrawingLayer = {
            id: part.id,
            name: part.label,
            zIndex: part.zIndex,
            isVisible: part.isVisible ?? true,
            canvas,
            ctx,
            version: 0
          };
          
          if (part.imageUrl) {
            await new Promise<void>((resolve) => {
              const img = new Image();
              img.onload = () => {
                ctx.drawImage(img, 0, 0);
                resolve();
              };
              img.onerror = () => resolve();
              img.src = part.imageUrl!;
            });
          }
          loadedLayers.push(newLayer);
        }
        
        setLayers(loadedLayers);
        if (loadedLayers.length > 0 && !activeLayerId) {
          setActiveLayerId(loadedLayers[0].id);
        }
      };
      
      loadLayers();
    }
  }, []);

/* Redundant createPart removed, using shared utils */

  const toggleVisibility = (id: string, e: React.MouseEvent) => { e.stopPropagation(); setCharacter(prev => ({ ...prev, [id]: { ...prev[id], isVisible: !(prev[id].isVisible ?? true) } })); };
  const toggleOpen = (id: string, e: React.MouseEvent) => { e.stopPropagation(); setCharacter(prev => ({ ...prev, [id]: { ...prev[id], isOpen: !prev[id].isOpen } })); };
  const handleRename = (id: string, newLabel: string) => { if (newLabel.trim()) { setCharacter(prev => ({ ...prev, [id]: { ...prev[id], label: newLabel } })); } setRenamingId(null); };
  const handleCreateGroup = () => {
      const newId = `group_${Date.now()}`;
      let parentId = 'root';
      const active = character[activeLayerId || ''];
      if (active) { if (active.isGroup) parentId = active.id; else if (active.parentId) parentId = active.parentId; }
      const newPart = createPart(newId, 'New Group', parentId, 10, { isGroup: true, children: [], isOpen: true });
      setCharacter(prev => {
          const next = { ...prev, [newId]: newPart };
          if (next[parentId]) { next[parentId] = { ...next[parentId], children: [...next[parentId].children, newId], isOpen: true }; }
          return next;
      });
      setRenamingId(newId); setActiveLayerId(newId);
  };
  const handleDelete = (id: string) => {
      if (id === 'root') return;
      setCharacter(prev => {
          const next = { ...prev };
          const deletePart = (partId: string) => { const part = next[partId]; if (!part) return; if (part.children) { [...part.children].forEach(childId => deletePart(childId)); } delete next[partId]; };
          const part = next[id];
          if (part && part.parentId && next[part.parentId]) { next[part.parentId] = { ...next[part.parentId], children: next[part.parentId].children.filter(cid => cid !== id) }; }
          deletePart(id);
          return next;
      });
      setLayers(prev => prev.filter(l => l.id !== id));
      if (activeLayerId === id) setActiveLayerId('root');
  };

  const handleDragStart = (e: React.DragEvent, id: string) => { e.stopPropagation(); setDraggedId(id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', id); };
  const handleDragOver = (e: React.DragEvent, targetId: string) => {
      e.preventDefault(); e.stopPropagation();
      if (!draggedId || draggedId === targetId) return;
      let current = character[targetId];
      while (current && current.parentId) { if (current.parentId === draggedId) return; current = character[current.parentId]; }
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const y = e.clientY - rect.top;
      const h = rect.height;
      const isGroup = character[targetId]?.isGroup;
      
      let position: 'above' | 'below' | 'inside';
      if (y < h * 0.25) { position = 'above'; } 
      else if (y > h * 0.75) { position = 'below'; } 
      else { if (isGroup) position = 'inside'; else position = 'below'; }
      
      setDropTarget(prev => {
          if (prev && prev.id === targetId && prev.position === position) return prev;
          return { id: targetId, position };
      });
  };
  const handleDrop = (e: React.DragEvent) => {
      e.preventDefault(); e.stopPropagation();
      if (!draggedId || !dropTarget) { setDraggedId(null); setDropTarget(null); return; }
      const { id: targetId, position } = dropTarget;
      if (draggedId === targetId) return;
      setCharacter(prev => {
          const next = { ...prev };
          const movedPart = { ...next[draggedId] };
          const oldParentId = movedPart.parentId;
          if (oldParentId && next[oldParentId]) { next[oldParentId] = { ...next[oldParentId], children: next[oldParentId].children.filter(id => id !== draggedId) }; }
          if (position === 'inside') {
              const target = next[targetId];
              movedPart.parentId = targetId;
              next[targetId] = { ...target, children: [...target.children, draggedId], isOpen: true };
          } else {
              const target = next[targetId];
              const newParentId = target.parentId;
              if (!newParentId || !next[newParentId]) return prev; 
              movedPart.parentId = newParentId;
              const parent = next[newParentId];
              const siblings = [...parent.children];
              const targetIndex = siblings.indexOf(targetId);
              const insertIndex = position === 'above' ? targetIndex : targetIndex + 1;
              siblings.splice(insertIndex, 0, draggedId);
              next[newParentId] = { ...parent, children: siblings };
          }
          next[draggedId] = movedPart;
          return next;
      });
      setDraggedId(null); setDropTarget(null);
  };

  const renderHierarchyItem = (partId: string, depth: number = 0) => {
      if (depth > 50) return null; 
      const part = character[partId];
      if (!part) return null;
      if (part.tags.includes('Viseme')) return null; 
      const isSelected = activeLayerId === partId;
      const isRenaming = renamingId === partId;
      const isDragging = draggedId === partId;
      const isDropTarget = dropTarget?.id === partId;
      const dropPos = dropTarget?.position;
      const isVisible = part.isVisible ?? true;
      const hasChildren = part.children.length > 0;

      return (
          <div key={partId} className="relative group">
              {isDropTarget && dropPos === 'above' && <div className="absolute top-0 left-0 right-0 h-0.5 bg-cyan-500 z-50"/>}
              {isDropTarget && dropPos === 'below' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-cyan-500 z-50"/>}
              <div draggable={partId !== 'root'} onDragStart={(e) => handleDragStart(e, partId)} onDragOver={(e) => handleDragOver(e, partId)} onDrop={handleDrop} 
                  onClick={() => { setActiveLayerId(partId); }} 
                  onPointerDown={() => {
                      const timer = setTimeout(() => {
                          if (selectedPartIds.includes(partId)) {
                              setSelectedPartIds(selectedPartIds.filter(id => id !== partId));
                          } else {
                              setSelectedPartIds([...selectedPartIds, partId]);
                          }
                      }, 500);
                      setLongPressTimer(timer);
                  }}
                  onPointerMove={() => {
                      if (longPressTimer) {
                          clearTimeout(longPressTimer);
                          setLongPressTimer(null);
                      }
                  }}
                  onPointerCancel={() => {
                      if (longPressTimer) {
                          clearTimeout(longPressTimer);
                          setLongPressTimer(null);
                      }
                  }}
                  onPointerUp={() => {
                      if (longPressTimer) {
                          clearTimeout(longPressTimer);
                          setLongPressTimer(null);
                      }
                  }}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer transition-all border border-transparent ${isSelected ? 'bg-cyan-900/20 text-cyan-400 border-cyan-500/30' : 'hover:bg-white/5 text-gray-400 hover:text-white'} ${isDragging ? 'opacity-50' : ''} ${isDropTarget && dropPos === 'inside' ? 'bg-cyan-500/20 border-cyan-500' : ''}`} style={{ paddingLeft: `${depth * 12 + 8}px` }}>
                  <button onClick={(e) => hasChildren ? toggleOpen(partId, e) : null} className={`p-0.5 rounded hover:bg-white/10 ${hasChildren ? '' : 'invisible'}`}>{part.isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</button>
                  {part.isGroup ? <Folder size={14} className={part.isOpen ? 'text-amber-400' : 'text-amber-600'} fill={part.isOpen ? "currentColor" : "none"} /> : <div className="w-3 h-3 rounded-sm bg-gray-600 border border-gray-500"/>}
                  {isRenaming ? (
                    <input 
                      autoFocus 
                      type="text" 
                      defaultValue={part.label || ''} 
                      onBlur={(e) => handleRename(partId, e.target.value)} 
                      onKeyDown={(e) => e.key === 'Enter' && handleRename(partId, e.currentTarget.value)} 
                      onClick={(e) => e.stopPropagation()} 
                      className="flex-1 min-w-0 bg-[#111] border border-cyan-500/50 rounded px-1 py-0 text-xs text-white outline-none"
                    />
                  ) : (
                    <span 
                      className="flex-1 min-w-0 truncate text-xs font-medium select-none"
                      onDoubleClick={(e) => { e.stopPropagation(); setRenamingId(partId); }}
                    >
                      {part.label}
                    </span>
                  )}
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button 
                        onClick={(e) => { e.stopPropagation(); setRenamingId(partId); }} 
                        className="p-1 hover:text-cyan-400 rounded hover:bg-white/10" 
                        title={t('Rename')}
                      >
                        <Edit2 size={10}/>
                      </button>
                      <button onClick={(e) => toggleVisibility(partId, e)} className={`p-1 rounded hover:bg-white/10 ${isVisible ? 'text-gray-500 hover:text-white' : 'text-gray-600'}`} title={isVisible ? "Hide" : "Show"}>{isVisible ? <Eye size={12}/> : <EyeOff size={12}/>}</button>
                      {partId !== 'root' && <button onClick={(e) => { e.stopPropagation(); handleDelete(partId); }} className="p-1 rounded hover:bg-white/10 text-gray-500 hover:text-red-400" title={t('Delete')}><Trash2 size={12}/></button>}
                  </div>
                  <div className="cursor-grab active:cursor-grabbing text-gray-600 hover:text-gray-400 md:hidden"><GripVertical size={12}/></div>
              </div>
              {part.isOpen && part.children.length > 0 && <div className="relative"><div className="absolute left-[12px] top-0 bottom-0 w-px bg-white/5" style={{ left: `${depth * 12 + 15}px` }}/>{part.children.map(childId => renderHierarchyItem(childId, depth + 1))}</div>}
          </div>
      );
  };

  const addLayer = (name: string) => {
    const id = `part_${Date.now()}`;
    const canvas = document.createElement('canvas');
    canvas.width = CANVAS_WIDTH;
    canvas.height = CANVAS_HEIGHT;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const newLayer: DrawingLayer = {
      id,
      name,
      zIndex: layers.length,
      isVisible: true,
      canvas,
      ctx,
      version: 0
    };
    
    setLayers(prev => [...prev, newLayer]);
    setActiveLayerId(id);

    setCharacter(prev => {
        const next = { ...prev };
        if (!next['bodyGroup']) {
            next['bodyGroup'] = createPart('bodyGroup', 'Body Group', 'root', 10, { isGroup: true, transform: { x: 0, y: 100, scaleX: 1, scaleY: 1, rotation: 0, anchorX: 50, anchorY: 50 }, tags: ['Body'], isOpen: true });
            if (next['root']) next['root'].children.push('bodyGroup');
        }
        next[id] = createPart(id, name, 'bodyGroup', layers.length);
        next['bodyGroup'].children.push(id);
        return next;
    });
  };

  const addVisemeLayers = () => {
    const visemes = ['REST', 'AI', 'E', 'O', 'U', 'FV', 'L', 'MBP', 'CONS'];
    const newLayers: DrawingLayer[] = [];
    let currentZ = layers.length;
    
    const newParts: Record<string, CharacterPart> = {};
    const newPartIds: string[] = [];

    visemes.forEach(v => {
      const id = `mouth_${v}_${Date.now()}`;
      const canvas = document.createElement('canvas');
      canvas.width = CANVAS_WIDTH;
      canvas.height = CANVAS_HEIGHT;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      
      newLayers.push({
        id,
        name: `mouth_${v}`,
        zIndex: currentZ++,
        isVisible: v === 'REST', // Only show REST by default
        canvas,
        ctx,
        version: 0
      });

      newParts[id] = createPart(id, `mouth_${v}`, 'headGroup', currentZ - 1, { tags: ['Mouth', 'Viseme', v], isVisible: v === 'REST' });
      newPartIds.push(id);
    });
    
    setLayers(prev => [...prev, ...newLayers]);
    setActiveLayerId(newLayers[0].id);

    setCharacter(prev => {
        const next = { ...prev, ...newParts };
        if (!next['headGroup']) {
            next['headGroup'] = createPart('headGroup', 'Head Group', 'root', 50, { isGroup: true, transform: { x: 0, y: -50, scaleX: 1, scaleY: 1, rotation: 0, anchorX: 50, anchorY: 50 }, tags: ['Head'], isOpen: true });
            if (next['root']) next['root'].children.push('headGroup');
        }
        next['headGroup'].children.push(...newPartIds);
        return next;
    });
  };

  const handleSave = () => {
    const newCharacter = { ...character };
    layers.forEach(l => {
        if (newCharacter[l.id]) {
            newCharacter[l.id].imageUrl = l.canvas.toDataURL('image/png');
        }
    });
    onSave(newCharacter);
  };

  const getRenderOrder = (partId: string, order: string[] = []) => {
    const part = character[partId];
    if (!part) return order;
    order.push(partId);
    // Iterate children in reverse so that the top item in the UI list (index 0) 
    // is rendered last (on top) in the canvas.
    for (let i = part.children.length - 1; i >= 0; i--) {
      getRenderOrder(part.children[i], order);
    }
    return order;
  };

  const renderOrder = getRenderOrder('root');

  const activeLayer = layers.find(l => l.id === activeLayerId);

  const getPos = (e: React.PointerEvent | React.MouseEvent) => {
    if (!containerRef.current) return { x: 0, y: 0 };
    const rect = containerRef.current.getBoundingClientRect();
    const scaleX = CANVAS_WIDTH / rect.width;
    const scaleY = CANVAS_HEIGHT / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY
    };
  };

  const floodFill = (ctx: CanvasRenderingContext2D, startX: number, startY: number, fillColor: string) => {
    if (!activeLayer) return;
    const beforeState = ctx.getImageData(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    const imageData = ctx.getImageData(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    const data = new Uint32Array(imageData.data.buffer);
    
    const fillRgb = hexToRgb(fillColor);
    const fillColor32 = (255 << 24) | (fillRgb.b << 16) | (fillRgb.g << 8) | fillRgb.r;
    
    const startIdx = startY * CANVAS_WIDTH + startX;
    const targetColor32 = data[startIdx];
    
    if (targetColor32 === fillColor32) return;
    
    const stack = [startX, startY];
    
    while (stack.length > 0) {
      let y = stack.pop()!;
      let x = stack.pop()!;
      
      let idx = y * CANVAS_WIDTH + x;
      while (y >= 0 && data[idx] === targetColor32) {
        y--;
        idx -= CANVAS_WIDTH;
      }
      y++;
      idx += CANVAS_WIDTH;
      
      let spanLeft = false;
      let spanRight = false;
      
      while (y < CANVAS_HEIGHT && data[idx] === targetColor32) {
        data[idx] = fillColor32;
        
        if (x > 0) {
          if (data[idx - 1] === targetColor32) {
            if (!spanLeft) {
              stack.push(x - 1, y);
              spanLeft = true;
            }
          } else if (spanLeft) {
            spanLeft = false;
          }
        }
        
        if (x < CANVAS_WIDTH - 1) {
          if (data[idx + 1] === targetColor32) {
            if (!spanRight) {
              stack.push(x + 1, y);
              spanRight = true;
            }
          } else if (spanRight) {
            spanRight = false;
          }
        }
        
        y++;
        idx += CANVAS_WIDTH;
      }
    }
    ctx.putImageData(imageData, 0, 0);
    
    const afterState = ctx.getImageData(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    const action: HistoryAction = {
      layerId: activeLayer.id,
      before: beforeState,
      after: afterState
    };
    setHistory(prev => {
      const newHistory = prev.slice(0, historyStep + 1);
      newHistory.push(action);
      return newHistory;
    });
    setHistoryStep(prev => prev + 1);
    // Force re-render of canvas by updating version
    setLayers(prev => prev.map(l => l.id === activeLayer.id ? { ...l, version: l.version + 1 } : l));
  };

  const hexToRgb = (hex: string) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16),
      a: 255
    } : { r: 0, g: 0, b: 0, a: 255 };
  };

  const initialPinchDistance = useRef<number | null>(null);
  const initialPinchZoom = useRef<number>(1);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      initialPinchDistance.current = Math.sqrt(dx * dx + dy * dy);
      initialPinchZoom.current = zoomRef.current;
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && initialPinchDistance.current !== null) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const scale = distance / initialPinchDistance.current;
      zoomRef.current = Math.min(Math.max(0.1, initialPinchZoom.current * scale), 10);
      updateTransform();
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (e.touches.length < 2) {
      initialPinchDistance.current = null;
    }
  };

  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
      zoomRef.current = Math.min(Math.max(0.1, zoomRef.current * zoomFactor), 10);
      updateTransform();
    } else {
      panRef.current = { x: panRef.current.x - e.deltaX, y: panRef.current.y - e.deltaY };
      updateTransform();
    }
  };

  const onPointerDown = (e: React.PointerEvent) => {
    activePointers.current.add(e.pointerId);

    if (activePointers.current.size > 1) {
      if (isDrawingRef.current && activeLayer && beforeStateRef.current) {
        activeLayer.ctx.putImageData(beforeStateRef.current, 0, 0);
      }
      isDrawingRef.current = false;
      return;
    }

    if (tool === 'pan' || e.button === 1) { // Middle click also pans
      setIsPanning(true);
      lastPanPos.current = { x: e.clientX, y: e.clientY };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }

    if (!activeLayer || !activeLayer.isVisible) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    let pos = getPos(e);
    
    if (tool === 'fill') {
      floodFill(activeLayer.ctx, Math.floor(pos.x), Math.floor(pos.y), fillColor);
      return;
    }
    
    pos = snapPoint(pos);
    
    isDrawingRef.current = true;
    lastPos.current = pos;
    lastMid.current = pos;
    beforeStateRef.current = activeLayer.ctx.getImageData(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    
    activeLayer.ctx.beginPath();
    activeLayer.ctx.moveTo(pos.x, pos.y);
    activeLayer.ctx.lineTo(pos.x, pos.y);
    activeLayer.ctx.lineCap = 'round';
    activeLayer.ctx.lineJoin = 'round';
    
    if (tool === 'eraser') {
      activeLayer.ctx.lineWidth = eraserSize;
      activeLayer.ctx.globalCompositeOperation = 'destination-out';
      activeLayer.ctx.strokeStyle = 'rgba(0,0,0,1)';
      activeLayer.ctx.globalAlpha = 1.0;
    } else if (tool === 'pencil') {
      activeLayer.ctx.lineWidth = pencilSize;
      activeLayer.ctx.globalCompositeOperation = 'source-over';
      activeLayer.ctx.strokeStyle = pencilColor;
      activeLayer.ctx.globalAlpha = 0.4; // Pencil usually faint
    } else {
      activeLayer.ctx.lineWidth = penSize;
      activeLayer.ctx.globalCompositeOperation = 'source-over';
      activeLayer.ctx.strokeStyle = penColor;
      activeLayer.ctx.globalAlpha = 1.0;
    }
    activeLayer.ctx.stroke();
  };

  const onPointerMove = (e: React.PointerEvent) => {
    // If multi-touch zoom is happening, reject move as draw move
    if (activePointers.current.size > 1) {
      if (isDrawingRef.current && activeLayer && beforeStateRef.current) {
         activeLayer.ctx.putImageData(beforeStateRef.current, 0, 0);
      }
      isDrawingRef.current = false;
    }

    if (isPanning && lastPanPos.current) {
      const dx = e.clientX - lastPanPos.current.x;
      const dy = e.clientY - lastPanPos.current.y;
      panRef.current = { x: panRef.current.x + dx, y: panRef.current.y + dy };
      lastPanPos.current = { x: e.clientX, y: e.clientY };
      updateTransform();
      return;
    }

    if (!isDrawingRef.current || !activeLayer || !lastPos.current || !lastMid.current) return;
    let pos = getPos(e);
    pos = snapPoint(pos);
    
    const mid = {
      x: (lastPos.current.x + pos.x) / 2,
      y: (lastPos.current.y + pos.y) / 2
    };

    activeLayer.ctx.beginPath();
    activeLayer.ctx.moveTo(lastMid.current.x, lastMid.current.y);
    activeLayer.ctx.quadraticCurveTo(lastPos.current.x, lastPos.current.y, mid.x, mid.y);
    activeLayer.ctx.lineCap = 'round';
    activeLayer.ctx.lineJoin = 'round';
    
    if (tool === 'eraser') {
      activeLayer.ctx.lineWidth = eraserSize;
      activeLayer.ctx.globalCompositeOperation = 'destination-out';
      activeLayer.ctx.strokeStyle = 'rgba(0,0,0,1)';
      activeLayer.ctx.globalAlpha = 1.0;
    } else if (tool === 'pencil') {
      activeLayer.ctx.lineWidth = pencilSize;
      activeLayer.ctx.globalCompositeOperation = 'source-over';
      activeLayer.ctx.strokeStyle = pencilColor;
      activeLayer.ctx.globalAlpha = 0.4;
    } else {
      activeLayer.ctx.lineWidth = penSize;
      activeLayer.ctx.globalCompositeOperation = 'source-over';
      activeLayer.ctx.strokeStyle = penColor;
      activeLayer.ctx.globalAlpha = 1.0;
    }
    activeLayer.ctx.stroke();
    
    lastPos.current = pos;
    lastMid.current = mid;
  };

  const onPointerUp = (e: React.PointerEvent) => {
    activePointers.current.delete(e.pointerId);
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    
    if (isPanning) {
      if (activePointers.current.size === 0) {
        setIsPanning(false);
        lastPanPos.current = null;
      }
      return;
    }

    if (isDrawingRef.current && activeLayer && lastPos.current && lastMid.current) {
      let pos = getPos(e);
      pos = snapPoint(pos);
      
      activeLayer.ctx.beginPath();
      activeLayer.ctx.moveTo(lastMid.current.x, lastMid.current.y);
      activeLayer.ctx.lineTo(pos.x, pos.y);
      activeLayer.ctx.lineCap = 'round';
      activeLayer.ctx.lineJoin = 'round';
      
      if (tool === 'eraser') {
        activeLayer.ctx.lineWidth = eraserSize;
        activeLayer.ctx.globalCompositeOperation = 'destination-out';
        activeLayer.ctx.strokeStyle = 'rgba(0,0,0,1)';
        activeLayer.ctx.globalAlpha = 1.0;
      } else if (tool === 'pencil') {
        activeLayer.ctx.lineWidth = pencilSize;
        activeLayer.ctx.globalCompositeOperation = 'source-over';
        activeLayer.ctx.strokeStyle = pencilColor;
        activeLayer.ctx.globalAlpha = 0.4;
      } else {
        activeLayer.ctx.lineWidth = penSize;
        activeLayer.ctx.globalCompositeOperation = 'source-over';
        activeLayer.ctx.strokeStyle = penColor;
        activeLayer.ctx.globalAlpha = 1.0;
      }
      activeLayer.ctx.stroke();
    }

    if (isDrawingRef.current && activeLayer && beforeStateRef.current) {
      const afterState = activeLayer.ctx.getImageData(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      const action: HistoryAction = {
        layerId: activeLayer.id,
        before: beforeStateRef.current,
        after: afterState
      };
      setHistory(prev => {
        const newHistory = prev.slice(0, historyStep + 1);
        newHistory.push(action);
        return newHistory;
      });
      setHistoryStep(prev => prev + 1);
      // Force re-render of canvas by updating version
      setLayers(prev => prev.map(l => l.id === activeLayer.id ? { ...l, version: l.version + 1 } : l));
    }
    
    if (activePointers.current.size === 0) {
      isDrawingRef.current = false;
      lastPos.current = null;
      lastMid.current = null;
      beforeStateRef.current = null;
    }
  };

  const renderRulerOverlay = () => {
    if (!activeRuler) return null;
    
    let path = '';
    switch (activeRuler) {
      case 'circle':
        path = 'M 400 400 m -200, 0 a 200,200 0 1,0 400,0 a 200,200 0 1,0 -400,0';
        break;
      case 'square':
        path = 'M 200 200 L 600 200 L 600 600 L 200 600 Z';
        break;
      case 'rectangle':
        path = 'M 150 250 L 650 250 L 650 550 L 150 550 Z';
        break;
      case 'head_male':
        path = 'M 400 150 C 500 150 550 250 550 350 C 550 450 500 550 450 600 C 420 630 380 630 350 600 C 300 550 250 450 250 350 C 250 250 300 150 400 150 Z';
        break;
      case 'head_female':
        path = 'M 400 180 C 480 180 520 250 520 350 C 520 450 460 550 420 600 C 410 615 390 615 380 600 C 340 550 280 450 280 350 C 280 250 320 180 400 180 Z';
        break;
      case 'head_fat':
        path = 'M 400 200 C 520 200 580 300 580 400 C 580 500 520 580 450 600 C 420 610 380 610 350 600 C 280 580 220 500 220 400 C 220 300 280 200 400 200 Z';
        break;
      case 'cloth':
        path = 'M 300 200 L 500 200 L 550 350 L 500 350 L 500 600 L 300 600 L 300 350 L 250 350 Z';
        break;
    }

    return (
      <svg 
        className="absolute inset-0 pointer-events-none z-[120]" 
        width="100%" 
        height="100%" 
        viewBox="0 0 800 800"
      >
        <g transform={`translate(${rulerTransform.x - 400 * rulerTransform.scale}, ${rulerTransform.y - 400 * rulerTransform.scale}) scale(${rulerTransform.scale})`}>
          {/* Backdrop stroke for better visibility */}
          <path d={path} fill="none" stroke="rgba(0, 0, 0, 0.4)" strokeWidth="6" />
          <path d={path} fill="none" stroke="#00ffff" strokeWidth="2" strokeDasharray="8,4" />
        </g>
      </svg>
    );
  };

  return (
    <div className="fixed inset-0 bg-[#050505] z-[100] flex flex-col overflow-hidden select-none touch-none">
      {/* Consolidated Top Header & Tool Selector */}
      <div className="h-12 border-b border-white/10 bg-[#0a0a0a] flex items-center justify-between px-2 md:px-4 shrink-0 z-[200]">
        <div className="flex items-center gap-1 min-w-0 flex-1">
            <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-white transition-colors shrink-0"><ChevronLeft size={20}/></button>
            <div className="w-px h-6 bg-white/10 mx-1 shrink-0" />
            
            <div className="flex items-center gap-1 overflow-x-auto no-scrollbar py-1 min-w-0">
              {[
                { id: 'pen', icon: PenTool, label: 'Pen' },
                { id: 'pencil', icon: Edit2, label: 'Pencil' },
                { id: 'eraser', icon: Eraser, label: 'Eraser' },
                { id: 'fill', icon: PaintBucket, label: 'Fill' },
                { id: 'pan', icon: Hand, label: 'Pan' },
              ].map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTool(t.id as any)}
                  className={`p-1.5 rounded transition-all ${tool === t.id ? 'bg-cyan-500 text-black shadow-[0_0_10px_rgba(6,182,212,0.3)]' : 'text-gray-500 hover:text-white hover:bg-white/5'}`}
                  title={t.label}
                >
                  <t.icon size={16}/>
                </button>
              ))}
              
              <div className="w-px h-4 bg-white/10 mx-1 shrink-0" />
              
              <button 
                onClick={() => setIsRulerMenuOpen(!isRulerMenuOpen)} 
                className={`p-1.5 rounded transition-all ${activeRuler ? 'bg-amber-500 text-black shadow-[0_0_10px_rgba(245,158,11,0.3)]' : 'text-gray-500 hover:text-white hover:bg-white/5'}`}
                title={t('Ruler')}
              >
                <Ruler size={16}/>
              </button>
            </div>
        </div>
        
        <div className="flex items-center gap-1 md:gap-3 shrink-0">
          <button 
            onClick={undo} 
            disabled={historyStep < 0} 
            className={`p-1.5 rounded ${historyStep < 0 ? 'opacity-20 text-gray-600' : 'text-cyan-400 hover:bg-cyan-500/10'}`}
          >
            <Undo size={14}/>
          </button>
          <button 
            onClick={redo} 
            disabled={historyStep >= history.length - 1} 
            className={`p-1.5 rounded ${historyStep >= history.length - 1 ? 'opacity-20 text-gray-600' : 'text-cyan-400 hover:bg-cyan-500/10'}`}
          >
            <Redo size={14}/>
          </button>
          
          <div className="w-px h-6 bg-white/10 mx-1" />
          
          <div className="flex items-center gap-1 shrink-0">
            <button 
              onClick={onClose} 
              className="hidden md:block px-2 py-1.5 rounded bg-white/5 border border-white/10 text-gray-400 font-bold text-[9px] uppercase hover:text-white transition-all shadow-sm"
            >
              {t('Cancel')}
            </button>
            <button 
              onClick={handleSave} 
              className="px-3 py-1.5 rounded bg-cyan-600 text-white font-black text-xs md:text-[10px] hover:bg-cyan-500 transition-all active:scale-95 shadow-[0_0_15px_rgba(8,145,178,0.3)]"
            >
              {t('SAVE')}
            </button>
          </div>
        </div>
      </div>
      {/* Movable Ruler Settings (if open) */}
      {isRulerMenuOpen && (
        <div 
          className="fixed z-[350] w-64 bg-[#111] border border-white/10 rounded-xl shadow-2xl overflow-hidden"
          style={{ transform: `translate3d(${rulerPanel.pos.x}px, ${rulerPanel.pos.y}px, 0)` }}
        >
            <div 
              className="p-3 bg-[#18181b] flex justify-between items-center cursor-move border-b border-white/5 active:bg-cyan-900/10"
              onPointerDown={rulerPanel.onPointerDown}
              onPointerMove={rulerPanel.onPointerMove}
              onPointerUp={rulerPanel.onPointerUp}
            >
              <div className="flex items-center gap-2">
                <GripVertical size={14} className="text-gray-600" />
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{t('Ruler Panel')}</span>
              </div>
              <button onClick={() => setIsRulerMenuOpen(false)} className="text-gray-500 hover:text-white p-1"><X size={14}/></button>
            </div>
            <div className="p-4 bg-[#111]">
              <div className="grid grid-cols-4 gap-2 mb-4">
                {['circle', 'square', 'rectangle', 'head_male', 'head_female', 'head_fat', 'cloth'].map(r => (
                  <button 
                    key={r}
                    onClick={() => setActiveRuler(activeRuler === r ? null : r as any)}
                    className={`px-1 py-1 rounded text-[8px] font-bold uppercase transition-all border ${activeRuler === r ? 'bg-amber-500 text-black border-amber-500' : 'bg-white/5 text-gray-500 border-white/10 hover:border-gray-500'}`}
                  >
                    {r.split('_')[0]}
                  </button>
                ))}
              </div>
              {activeRuler && (
                <div className="space-y-4 border-t border-white/5 pt-4">
                  <div className="flex flex-col gap-1">
                    <div className="flex justify-between text-[9px] font-bold text-gray-500 uppercase"><span>{t('Scale')}</span><span className="text-amber-500">{rulerTransform.scale.toFixed(2)}x</span></div>
                    <input type="range" min="0.1" max="3" step="0.05" value={rulerTransform.scale} onChange={(e) => setRulerTransform(prev => ({ ...prev, scale: parseFloat(e.target.value) }))} className="w-full accent-amber-500 h-1" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-[9px] font-bold text-gray-500 uppercase tracking-widest">{t('Offset X/Y')}</span>
                    <input type="range" min="0" max="800" value={rulerTransform.x} onChange={(e) => setRulerTransform(p => ({...p, x: parseInt(e.target.value)}))} className="w-full accent-amber-500 h-1" />
                    <input type="range" min="0" max="800" value={rulerTransform.y} onChange={(e) => setRulerTransform(p => ({...p, y: parseInt(e.target.value)}))} className="w-full accent-amber-500 h-1" />
                  </div>
                  <button onClick={() => setActiveRuler(null)} className="w-full py-2 bg-red-500/10 text-red-500 text-[9px] font-black rounded border border-red-500/20 hover:bg-red-500/20 uppercase">{t('Remove Ruler')}</button>
                </div>
              )}
            </div>
        </div>
      )}
      {/* Tool Inspector */}


      {/* Tool Inspector */}
      <div className="h-14 bg-[#0a0a0a] border-b border-white/5 flex items-center justify-start md:justify-center gap-6 px-4 shrink-0 z-[180] overflow-x-auto no-scrollbar">
        {tool === 'pen' && (
          <>
            <div className="flex items-center gap-3">
              <span className="text-[9px] font-black text-gray-600 uppercase tracking-widest">{t('Pen Size')}</span>
              <div className="flex items-center gap-2">
                <input type="range" min="1" max="100" value={penSize} onChange={(e) => setPenSize(parseInt(e.target.value))} className="w-24 md:w-32 accent-cyan-500 h-1" />
                <span className="text-[10px] text-gray-400 font-mono w-4">{penSize}</span>
              </div>
            </div>
            <div className="w-px h-4 bg-white/10" />
            <div className="flex items-center gap-3 relative">
              <span className="text-[9px] font-black text-gray-600 uppercase tracking-widest">{t('Color')}</span>
              <button 
                onClick={() => { setIsColorPickerOpen(!isColorPickerOpen); setIsFillColorPickerOpen(false); setIsPencilColorPickerOpen(false); }}
                className="w-8 h-5 rounded-md border border-white/20 shadow-lg"
                style={{ backgroundColor: penColor }}
              />
              {isColorPickerOpen && (
                <div className="fixed top-44 left-1/2 -translate-x-1/2 z-[400] scale-90 sm:scale-100">
                  <AdvancedColorPicker 
                    initialColor={penColor} 
                    onChange={setPenColor} 
                    onClose={() => setIsColorPickerOpen(false)} 
                  />
                </div>
              )}
            </div>
          </>
        )}

        {tool === 'pencil' && (
          <>
            <div className="flex items-center gap-3">
              <span className="text-[9px] font-black text-gray-600 uppercase tracking-widest">{t('Pencil Size')}</span>
              <div className="flex items-center gap-2">
                <input type="range" min="1" max="20" value={pencilSize} onChange={(e) => setPencilSize(parseInt(e.target.value))} className="w-24 md:w-32 accent-amber-500 h-1" />
                <span className="text-[10px] text-gray-400 font-mono w-4">{pencilSize}</span>
              </div>
            </div>
            <div className="w-px h-4 bg-white/10" />
            <div className="flex items-center gap-3 relative">
              <span className="text-[9px] font-black text-gray-600 uppercase tracking-widest">{t('Color')}</span>
              <button 
                onClick={() => { setIsPencilColorPickerOpen(!isPencilColorPickerOpen); setIsColorPickerOpen(false); setIsFillColorPickerOpen(false); }}
                className="w-8 h-5 rounded-md border border-white/20 shadow-lg"
                style={{ backgroundColor: pencilColor }}
              />
              {isPencilColorPickerOpen && (
                <div className="fixed top-44 left-1/2 -translate-x-1/2 z-[400] scale-90 sm:scale-100">
                  <AdvancedColorPicker 
                    initialColor={pencilColor} 
                    onChange={setPencilColor} 
                    onClose={() => setIsPencilColorPickerOpen(false)} 
                  />
                </div>
              )}
            </div>
          </>
        )}

        {tool === 'eraser' && (
          <div className="flex items-center gap-3">
            <span className="text-[9px] font-black text-gray-600 uppercase tracking-widest">{t('Size')}</span>
            <div className="flex items-center gap-2">
              <input type="range" min="1" max="100" value={eraserSize} onChange={(e) => setEraserSize(parseInt(e.target.value))} className="w-32 md:w-48 accent-cyan-500 h-1" />
              <span className="text-[10px] text-gray-400 font-mono w-6">{eraserSize}</span>
            </div>
          </div>
        )}

        {tool === 'fill' && (
          <div className="flex items-center gap-3 relative">
            <span className="text-[9px] font-black text-gray-600 uppercase tracking-widest">{t('Color')}</span>
            <button 
              onClick={() => { setIsFillColorPickerOpen(!isFillColorPickerOpen); setIsColorPickerOpen(false); setIsPencilColorPickerOpen(false); setIsArtboardColorPickerOpen(false); }}
              className="w-10 h-6 rounded-md border border-white/20 shadow-lg"
              style={{ backgroundColor: fillColor }}
            />
            {isFillColorPickerOpen && (
              <div className="fixed top-44 left-1/2 -translate-x-1/2 z-[400] scale-90 sm:scale-100">
                <AdvancedColorPicker 
                  initialColor={fillColor} 
                  onChange={setFillColor} 
                  onClose={() => setIsFillColorPickerOpen(false)} 
                />
              </div>
            )}
          </div>
        )}

        {tool === 'pan' && (
          <span className="text-[9px] text-gray-500 font-bold uppercase tracking-widest flex items-center gap-2">
             <Hand size={14} className="animate-pulse" /> {t('Drag Canvas')}
          </span>
        )}
        
        <div className="w-px h-6 bg-white/10 mx-1" />
        
        <div className="flex items-center gap-1">
            <button onClick={() => { zoomRef.current = 1; panRef.current = {x:0, y:0}; updateTransform(); }} className="p-1.5 text-gray-500 hover:text-white transition-colors" title={t('Reset View')}><Maximize size={16}/></button>
        </div>
      </div>

      {/* Main Workspace */}
      <div className="flex-1 flex flex-col min-h-0 relative overflow-hidden">
        <div className="flex-1 flex flex-row min-h-0 relative overflow-hidden">
          {/* Layers Panel Toggle (when closed) */}
        {!isLayersPanelOpen && (
          <div className="absolute top-4 right-4 z-[140]">
            <button onClick={() => setIsLayersPanelOpen(true)} className="p-2 bg-[#111] border border-white/10 rounded text-gray-400 hover:text-white shadow-lg flex items-center gap-2">
              <span className="text-xs font-bold hidden md:inline">{t('Layers')}</span>
              <PanelRightOpen size={20} />
            </button>
          </div>
        )}

          {/* Canvas Area */}
      <div 
        className="flex-1 bg-[#0a0a0a] relative flex items-center justify-center overflow-hidden p-4"
        onWheel={handleWheel}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div 
          ref={containerRef}
          className={`relative bg-white/5 shadow-2xl rounded-lg overflow-hidden ${tool === 'pan' ? 'cursor-grab' : 'cursor-crosshair'}`}
          style={{ 
            width: '100%', 
            maxWidth: '800px', 
            aspectRatio: '1/1', 
            touchAction: 'none',
            transform: `translate(${panRef.current.x}px, ${panRef.current.y}px) scale(${zoomRef.current})`,
            transformOrigin: 'center'
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
        >
          {/* Checkerboard background */}
          <div className="absolute inset-0" style={{
            backgroundImage: 'conic-gradient(#222 90deg, #333 90deg 180deg, #222 180deg 270deg, #333 270deg)',
            backgroundSize: '20px 20px',
            opacity: 0.5
          }} />
          
          {/* Solid background if selected */}
          {artboardColor !== 'transparent' && (
            <div className="absolute inset-0" style={{ backgroundColor: artboardColor }} />
          )}
          
          {/* Render Layers */}
          {[...layers].sort((a, b) => {
            const idxA = renderOrder.indexOf(a.id);
            const idxB = renderOrder.indexOf(b.id);
            return idxA - idxB;
          }).map(layer => {
            const part = character[layer.id];
            const isVisible = part ? (part.isVisible ?? true) : layer.isVisible;
            return <LayerCanvasRenderer key={layer.id} layer={layer} isVisible={isVisible} />;
          })}
          
          {/* Ruler Overlay */}
          {renderRulerOverlay()}
        </div>
      </div>
      
        {/* Layers Panel */}
        {isLayersPanelOpen && (
          <div className="absolute md:relative inset-y-0 right-0 w-64 bg-[#111] border-l border-white/10 flex flex-col shrink-0 z-[150] shadow-2xl md:shadow-none">
            <div className="p-4 border-b border-white/10 flex justify-between items-center shrink-0">
            <div className="flex items-center gap-2">
              <button onClick={() => setIsLayersPanelOpen(false)} className="text-gray-400 hover:text-white" title={t('Hide Layers')}><PanelRightClose size={18}/></button>
              <h2 className="text-white font-bold flex items-center gap-2"><Layers size={18}/> {t('Layers')}</h2>
            </div>
            <div className="flex gap-2">
              <button onClick={handleCreateGroup} className="text-xs bg-white/5 hover:bg-white/10 px-2 py-1 rounded text-gray-400 hover:text-white border border-white/10" title={t('New Group')}>{t('Group')}</button>
              <button onClick={addVisemeLayers} className="text-xs bg-white/5 hover:bg-white/10 px-2 py-1 rounded text-gray-400 hover:text-white border border-white/10" title={t('Add Mouth Visemes')}>{t('Mouth')}</button>
              <button onClick={() => addLayer(`Layer ${layers.length + 1}`)} className="text-cyan-400 hover:text-cyan-300"><Plus size={20}/></button>
            </div>
          </div>
        
          <div className="flex-1 overflow-y-auto p-2 min-h-0">
            {renderHierarchyItem('root')}
          </div>
      </div>
      )}
      </div>
      </div>

      {/* Bottom Toolbar - General Scene Settings */}
      <div className="h-14 bg-[#111] border-t border-white/10 flex items-center justify-center gap-6 px-4 shrink-0 z-[150]">
          <div className="flex items-center gap-3 shrink-0 relative">
              <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">{t('Artboard BG')}</span>
              <button 
                onClick={() => { setIsArtboardColorPickerOpen(!isArtboardColorPickerOpen); setIsColorPickerOpen(false); setIsFillColorPickerOpen(false); }}
                className="w-10 h-7 rounded border border-white/20 flex items-center justify-center relative overflow-hidden shadow-lg transition-transform active:scale-95"
              >
                <div className="absolute inset-0" style={{
                  backgroundImage: 'conic-gradient(#222 90deg, #333 90deg 180deg, #222 180deg 270deg, #333 270deg)',
                  backgroundSize: '10px 10px',
                }} />
                <div className="absolute inset-0" style={{ backgroundColor: artboardColor === 'transparent' ? 'transparent' : artboardColor }} />
              </button>
              {isArtboardColorPickerOpen && (
                <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[300]">
                  <AdvancedColorPicker 
                    initialColor={artboardColor === 'transparent' ? '#ffffff' : artboardColor} 
                    onChange={setArtboardColor} 
                    onClose={() => setIsArtboardColorPickerOpen(false)} 
                  />
                </div>
              )}
          </div>
          
          <div className="w-px h-6 bg-white/10 mx-2" />

          <div className="flex items-center gap-2">
            <button 
              onClick={() => setIsLayersPanelOpen(!isLayersPanelOpen)}
              className={`p-2 rounded-lg transition-colors ${isLayersPanelOpen ? 'bg-cyan-500 text-black' : 'bg-white/5 text-gray-400 hover:bg-white/10'}`}
              title={t('Layers')}
            >
              <Layers size={18} />
            </button>
          </div>
      </div>
    </div>
  );
};
