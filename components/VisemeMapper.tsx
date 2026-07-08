
import React, { useState } from 'react';
import { useLanguage } from '../utils/LanguageContext';
import { VisemeShape, UnpackedImage } from '../types';
import { Upload, X, Check, Image as ImageIcon, RefreshCw, Trash2, GripVertical, Move } from 'lucide-react';

interface VisemeMapperProps {
  onClose: () => void;
  onImplement: (map: Record<VisemeShape, string | null>) => void;
  currentMap: Record<VisemeShape, string | null>;
  theme?: 'light' | 'dark';
  availableAssets?: UnpackedImage[];
}

export const VISEME_SLOTS = [
  { id: VisemeShape.REST, label: 'REST / NEUTRAL', desc: 'Closed mouth, relaxed', color: 'text-gray-400' },
  { id: VisemeShape.AI, label: 'AI (AH, I)', desc: 'Wide Open Vowels', color: 'text-red-400' },
  { id: VisemeShape.E, label: 'E (EE, EH)', desc: 'Stretched Wide', color: 'text-orange-400' },
  { id: VisemeShape.O, label: 'O (OH)', desc: 'Open Round', color: 'text-amber-400' },
  { id: VisemeShape.U, label: 'U (OO, W)', desc: 'Tight Pucker', color: 'text-yellow-400' },
  { id: VisemeShape.MBP, label: 'MBP (M, B, P)', desc: 'Lips Pressed Together', color: 'text-green-400' },
  { id: VisemeShape.FV, label: 'FV (F, V)', desc: 'Upper Teeth on Lip', color: 'text-teal-400' },
  { id: VisemeShape.L, label: 'L (L, TH, D)', desc: 'Tongue Behind Teeth', color: 'text-cyan-400' },
  { id: VisemeShape.CONS, label: 'CONS (S, T, K)', desc: 'Teeth Clenched / Grin', color: 'text-blue-400' },
];

// --- HELPER: DRAGGABLE HOOK ---
const useDraggableElement = (initialPos: {x: number, y: number}) => {
    const posRef = React.useRef(initialPos); 
    const isDraggingRef = React.useRef(false);
    const offsetRef = React.useRef({ x: 0, y: 0 });

    const handlePointerDown = (e: React.PointerEvent) => {
        if ((e.target as HTMLElement).tagName.toLowerCase() === 'select' || (e.target as HTMLElement).tagName.toLowerCase() === 'input' || (e.target as HTMLElement).tagName.toLowerCase() === 'button') return;
        e.preventDefault();
        e.stopPropagation();
        isDraggingRef.current = true;
        offsetRef.current = { x: e.clientX - posRef.current.x, y: e.clientY - posRef.current.y };
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    };

    const handlePointerMove = (e: React.PointerEvent) => {
        if (!isDraggingRef.current) return;
        e.stopPropagation();
        const newX = e.clientX - offsetRef.current.x;
        const newY = e.clientY - offsetRef.current.y;
        posRef.current = { x: newX, y: newY };
        
        const target = (e.currentTarget as HTMLElement).closest('.touch-none') as HTMLElement;
        if (target) {
            target.style.transform = `translate3d(${newX}px, ${newY}px, 0)`;
        }
    };

    const handlePointerUp = (e: React.PointerEvent) => {
        isDraggingRef.current = false;
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    };

    return { pos: posRef.current, handlePointerDown, handlePointerMove, handlePointerUp };
};

const VisemeMapper: React.FC<VisemeMapperProps> = ({ onClose, onImplement, currentMap, theme = 'light', availableAssets = [] }) => {
  const { t } = useLanguage();

  const [tempMap, setTempMap] = useState<Record<VisemeShape, string | null>>(currentMap);
  const [draggedUrl, setDraggedUrl] = useState<string | null>(null);
  const [selectedAssetUrl, setSelectedAssetUrl] = useState<string | null>(null);
  const dragProps = useDraggableElement({ x: 0, y: 0 });

  const handleUpload = (shape: VisemeShape, file: File) => {
    const newUrl = URL.createObjectURL(file);
    setTempMap(prevMap => {
      const oldUrl = prevMap[shape];
      if (oldUrl) {
        // We only revoke if it's a blob url we created here. 
        // If it came from currentMap, parent handles it? 
        // For simplicity, we just overwrite.
      }
      return { ...prevMap, [shape]: newUrl };
    });
  };

  const handleSave = () => {
    onImplement(tempMap);
    onClose();
  };

  const handleDrop = (e: React.DragEvent, shape: VisemeShape) => {
      e.preventDefault();
      const transferUrl = e.dataTransfer.getData('text/plain');
      const targetUrl = draggedUrl || transferUrl;
      if (targetUrl) {
          setTempMap(prev => ({ ...prev, [shape]: targetUrl }));
          setDraggedUrl(null);
      } else if (e.dataTransfer.files?.[0]) {
          handleUpload(shape, e.dataTransfer.files[0]);
      }
  };

  return (
    <div className={`fixed inset-0 z-[300] flex items-center justify-center p-4 ${theme === 'light' ? 'bg-black/40' : 'bg-black/90'}`}>
      <div 
        className={`touch-none absolute border rounded-2xl w-full max-w-6xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden transition-colors duration-300 ${theme === 'light' ? 'bg-white border-black/10' : 'bg-[#0a0a0a] border-white/10'}`}
        style={{ transform: `translate3d(${dragProps.pos.x}px, ${dragProps.pos.y}px, 0)` }}
      >
        
        {/* Header */}
        <div 
          className={`p-6 border-b flex justify-between items-center cursor-move shrink-0 ${theme === 'light' ? 'bg-gray-50 border-black/5' : 'bg-white/5 border-white/5'}`}
          onPointerDown={dragProps.handlePointerDown}
          onPointerMove={dragProps.handlePointerMove}
          onPointerUp={dragProps.handlePointerUp}
        >
          <div>
            <h2 className={`text-xl font-bold tracking-tight flex items-center gap-3 ${theme === 'light' ? 'text-gray-900 pointer-events-none' : 'text-white pointer-events-none'}`}>
              <ImageIcon className="text-cyan-500" />
              {t('Precision Viseme Studio')}
            </h2>
            <p className="text-xs text-gray-400 mt-1 pointer-events-none">{t('Map standard phonemes for studio-quality offline lip sync.')}</p>
          </div>
          <button onClick={onClose} className={`pointer-events-auto p-2 rounded-full transition-colors ${theme === 'light' ? 'hover:bg-gray-200 text-gray-500' : 'hover:bg-white/10 text-gray-400'}`}>
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 flex overflow-hidden">
            
            {/* Asset Tray */}
            {availableAssets.length > 0 && (
                <div className={`w-48 flex flex-col border-r shrink-0 ${theme === 'light' ? 'bg-gray-100 border-black/5' : 'bg-[#111] border-white/5'}`}>
                    <div className="p-3 border-b border-white/5 text-[10px] font-bold text-gray-500 uppercase tracking-wider flex items-center gap-2">
                        <GripVertical size={12}/> {t('Available Assets')}
                    </div>
                    <div className="flex-1 overflow-y-auto p-2 space-y-2 custom-scrollbar">
                        {availableAssets.filter(a => a.url && a.url !== "null").map(asset => (
                            <div 
                                key={asset.id}
                                draggable
                                onDragStart={(e) => { 
                                    setDraggedUrl(asset.url);
                                    e.dataTransfer.setData('text/plain', asset.url); 
                                    e.dataTransfer.effectAllowed = 'copy';
                                }}
                                onDragEnd={() => setDraggedUrl(null)}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedAssetUrl(prev => prev === asset.url ? null : asset.url);
                                }}
                                className={`p-2 rounded-lg border flex flex-col items-center gap-2 cursor-grab active:cursor-grabbing hover:border-cyan-500/50 transition-colors ${theme === 'light' ? 'bg-white border-black/5' : 'bg-[#181818] border-white/5'} ${selectedAssetUrl === asset.url ? 'ring-2 ring-cyan-500 border-transparent' : ''}`}
                            >
                                <div className="w-16 h-16 flex items-center justify-center">
                                    <img src={asset.url} className="max-w-full max-h-full object-contain pointer-events-none"/>
                                </div>
                                <span className="text-[9px] text-gray-400 truncate w-full text-center">{asset.name}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
            
            {/* Grid of Slots */}
            <div className="flex-1 overflow-y-auto p-4 lg:p-6 custom-scrollbar relative" onClick={() => setSelectedAssetUrl(null)}>
               <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 pb-6">
                  {VISEME_SLOTS.map((slot) => {
                    const currentImage = tempMap[slot.id];
                    
                    return (
                      <div 
                        key={slot.id} 
                        className={`group relative flex flex-col border rounded-xl overflow-hidden transition-all duration-300 shadow-sm ${theme === 'light' ? 'bg-gray-50 border-black/5 hover:border-cyan-400' : 'bg-white/5 border-white/5 hover:border-cyan-500/50'} ${selectedAssetUrl ? 'ring-2 ring-transparent hover:ring-cyan-500/50 cursor-pointer' : ''}`}
                        onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); }}
                        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'; }}
                        onDrop={(e) => { e.stopPropagation(); handleDrop(e, slot.id); }}
                        onClick={(e) => {
                          if (selectedAssetUrl) {
                            e.stopPropagation();
                            setTempMap(prev => ({ ...prev, [slot.id]: selectedAssetUrl }));
                            setSelectedAssetUrl(null);
                          }
                        }}
                      >
                        {/* Drop overlay area to stabilize drops when dragging */}
                        <div className={`absolute inset-0 z-20 ${draggedUrl ? 'pointer-events-auto' : 'pointer-events-none'}`} 
                             onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); }}
                             onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'; }}
                             onDrop={(e) => { e.stopPropagation(); handleDrop(e, slot.id); }}
                        />
                        {/* Header */}
                        <div className={`p-3 border-b flex justify-between items-center ${theme === 'light' ? 'bg-white border-black/5' : 'bg-white/5 border-white/5'}`}>
                           <div>
                             <span className={`text-sm font-bold ${slot.color}`}>{slot.label}</span>
                             <p className="text-[10px] text-gray-500">{slot.desc}</p>
                           </div>
                           {currentImage && currentImage !== "null" && <div className="w-2 h-2 bg-green-500 rounded-full shadow-[0_0_5px_rgba(34,197,94,0.5)]"></div>}
                        </div>

                        {/* Preview / Upload Area */}
                        <div className={`w-full aspect-video relative ${theme === 'light' ? 'bg-white' : 'bg-black/50'}`}>
                           {currentImage && currentImage !== "null" ? (
                             <div className="absolute inset-0 w-full h-full">
                               <div className="absolute inset-0 flex items-center justify-center p-4">
                                  <img 
                                    src={currentImage} 
                                    alt={slot.label} 
                                    className="max-h-full w-auto object-contain filter drop-shadow-xl select-none pointer-events-none" 
                                  />
                               </div>
                               
                               {/* Overlay */}
                               <div className="absolute inset-0 flex flex-col justify-end p-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 bg-gradient-to-t from-black/90 via-black/50 to-transparent pointer-events-none">
                                  <div className="flex gap-2 justify-center">
                                      <label className="pointer-events-auto flex-1 cursor-pointer bg-cyan-600 hover:bg-cyan-500 text-white p-2 rounded-lg flex items-center justify-center gap-2 transition-colors shadow-lg">
                                         <RefreshCw size={14} />
                                         <span className="text-[10px] font-bold">{t('CHANGE')}</span>
                                         <input type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => e.target.files?.[0] && handleUpload(slot.id, e.target.files[0])} />
                                      </label>
                                      <button 
                                         onClick={() => setTempMap(prev => ({ ...prev, [slot.id]: null }))}
                                         className="pointer-events-auto flex-none bg-red-500/20 hover:bg-red-500/40 text-red-400 p-2 rounded-lg border border-red-500/30 transition-colors"
                                      >
                                         <Trash2 size={14} />
                                      </button>
                                  </div>
                               </div>
                             </div>
                           ) : (
                             <label 
                               className={`absolute inset-0 flex flex-col items-center justify-center cursor-pointer transition-colors active:opacity-70 ${theme === 'light' ? 'hover:bg-gray-100' : 'hover:bg-white/5'} ${draggedUrl ? 'pointer-events-none z-0' : 'z-10'}`}
                               onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); }}
                               onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'; }}
                               onDrop={(e) => { e.stopPropagation(); handleDrop(e, slot.id); }}
                             >
                                <Upload size={20} className="text-gray-500 mb-2 group-hover:text-cyan-500 transition-colors" />
                                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest group-hover:text-cyan-500/70">{t('Drag Asset Here')}</span>
                                <span className="text-[8px] text-gray-600">{t('or click to upload')}</span>
                                <input type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => e.target.files?.[0] && handleUpload(slot.id, e.target.files[0])} />
                             </label>
                           )}
                        </div>
                      </div>
                    );
                  })}
               </div>
            </div>
        </div>

        {/* Footer */}
        <div className={`p-6 border-t flex justify-end gap-4 shrink-0 ${theme === 'light' ? 'bg-gray-50 border-black/5' : 'bg-black/20 border-white/5'}`}>
          <button 
            onClick={onClose}
            className={`px-6 py-3 rounded-lg text-sm font-medium transition-colors ${theme === 'light' ? 'text-gray-500 hover:text-gray-900 hover:bg-gray-200' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
          >
            {t('Cancel')}
          </button>
          <button 
            onClick={handleSave}
            className={`
              px-8 py-3 rounded-lg text-sm font-bold tracking-wide flex items-center gap-2 transition-all shadow-lg
              ${tempMap[VisemeShape.REST] 
                 ? 'bg-cyan-500 hover:bg-cyan-400 text-white shadow-[0_0_20px_rgba(0,242,255,0.3)]' 
                 : 'bg-gray-300 text-gray-500 cursor-not-allowed opacity-50'
              }
            `}
            disabled={!tempMap[VisemeShape.REST]}
          >
            <Check size={16} />
            {t('IMPLEMENT LIP SYNC')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default VisemeMapper;
