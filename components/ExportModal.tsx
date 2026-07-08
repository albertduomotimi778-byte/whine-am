
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useLanguage } from '../utils/LanguageContext';
import { CanvasRenderEngine } from '../utils/CanvasRenderEngine';
import { processLipSync } from '../utils/LipSyncProcessor';
import { triggerDownload, blobToDataURL } from '../utils/downloadHelper';
import { sendSystemNotification, requestNotificationPermission } from '../utils/notificationHelper';
import { TrackState, LipSyncKeyframe, CharacterComposition, VisemeShape, Keyframe, ShadowConfig, SceneText } from '../types'; 
import { Download, Film, X, AlertCircle, Video, CheckCircle2, Monitor, FileJson, Share2, Gamepad2 } from 'lucide-react'; 
import { motion, AnimatePresence } from 'motion/react';

interface ExportModalProps {
    isOpen: boolean;
    projectName?: string;
    onClose: () => void;
    vocalTrack: TrackState;
    instTrack: TrackState;
    duration: number;
    currentTime: number;
    onSeek: (time: number) => void;
    onPlay: () => void;
    onPause: () => void;
    getAudioStream: () => MediaStream | null;
    onTogglePresentationMode: (val: boolean) => void;
    setIsLocalMuted: (val: boolean) => void;
    canvasBgColor: string;
    isCanvasTransparent: boolean;
    setIsExporting: (val: boolean) => void; 
    setLipSyncKeyframes?: (keys: LipSyncKeyframe[]) => void; 
    lipSyncKeyframes?: LipSyncKeyframe[];
    lipSyncTargetId?: string | null;
    keyframes?: Keyframe[];
    characters: { id: string; name: string; composition: CharacterComposition, visemeMap?: Record<VisemeShape, string | null>, boneTransforms?: Record<string, {rotation: number, scaleX: number, scaleY: number}> }[];
    characterFiltersMap: Record<string, any>;
    visemeMap?: Record<VisemeShape, string | null>;
    cameraTransform?: any;
    backgroundImage?: any;
    availableBackgrounds?: any[];
    backgroundTransform?: any;
    lightSources?: any;
    ambientLightLevel?: any;
    audioDuration?: any;
    linkBgToCamera?: any;
    aspectRatio?: any;
    onExportProject?: () => void;
    shadowConfig?: ShadowConfig;
    depthShadowConfig?: ShadowConfig;
    texts?: SceneText[];
}

export const ExportModal: React.FC<ExportModalProps> = ({ 
    isOpen, projectName, onClose, duration, onSeek, onPause, onPlay, onTogglePresentationMode, setIsLocalMuted, setIsExporting,
    lipSyncKeyframes, setLipSyncKeyframes, lipSyncTargetId, keyframes, vocalTrack, instTrack, characters, characterFiltersMap, visemeMap, cameraTransform, backgroundImage, backgroundTransform, availableBackgrounds,
    canvasBgColor, isCanvasTransparent, aspectRatio, getAudioStream, onExportProject, lightSources, ambientLightLevel, linkBgToCamera,
    shadowConfig, depthShadowConfig, texts = []
}) => {
  const { t } = useLanguage();

    const [status, setStatus] = useState<'IDLE' | 'PREPARING' | 'RENDERING' | 'DONE' | 'ERROR'>('IDLE');
    const [errorMessage, setErrorMessage] = useState<string>('');
    const [statusMsg, setStatusMsg] = useState<string>('');
    const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
    const [finalBlob, setFinalBlob] = useState<Blob | null>(null);
    const [progress, setProgress] = useState(0);
    const [exportFileName, setExportFileName] = useState(projectName || 'animato_production');
    
    useEffect(() => {
        if (isOpen && projectName) {
            setExportFileName(projectName);
        }
    }, [isOpen, projectName]);
    const [exportFormat, setExportFormat] = useState<'mp4' | 'webm' | 'game'>('mp4');
    
    const engineRef = useRef<CanvasRenderEngine>(new CanvasRenderEngine());
    const opfsFileHandleRef = useRef<any>(null);

    useEffect(() => {
        if (!isOpen) {
            cleanup();
        } else {
            setStatus('IDLE');
        }
    }, [isOpen]);

    const [localToast, setLocalToast] = useState<string | null>(null);
    const triggerLocalToast = (msg: string) => {
        setLocalToast(msg);
        setTimeout(() => setLocalToast(null), 3000);
    };

    const cleanup = async () => {
        if (downloadUrl) URL.revokeObjectURL(downloadUrl);
        
        onTogglePresentationMode(false);
        setIsLocalMuted(false);
        setIsExporting(false); 
        
        setDownloadUrl(null);
        setStatus('IDLE');
        setErrorMessage('');
        setStatusMsg('');
        setProgress(0);
        if (status === 'RENDERING') {
            engineRef.current.cancel();
        }

        // Clean up OPFS file to prevent storage leaks on mobile
        if (opfsFileHandleRef.current) {
            try {
                const dir = await navigator.storage.getDirectory();
                await dir.removeEntry(opfsFileHandleRef.current.name);
                opfsFileHandleRef.current = null;
            } catch (e) {
                console.warn("Failed to clean up OPFS file:", e);
            }
        }
    };

    const handleStartRender = async () => {
        if (!characters || characters.length === 0) {
            setErrorMessage("No characters loaded.");
            return;
        }

        try {
            if (exportFormat === 'game') {
                // Now we will actually render it to frames using CanvasRenderEngine
                // We don't early return anymore
            }

            setErrorMessage('');
            setStatus('PREPARING');
            onPause();
            onSeek(0);
            setIsExporting(true);

            setStatusMsg('Checking Stage...');
            const stageEl = document.getElementById('animato-render-stage');
            if (!stageEl) {
                throw new Error("Stage element not found. Please ensure the animator is active.");
            }
            
            const domDims = { 
                width: stageEl.offsetWidth || (Number(aspectRatio.split(/[:/]/)[0]) || 16) * 120, 
                height: stageEl.offsetHeight || (Number(aspectRatio.split(/[:/]/)[1]) || 9) * 120
            };

            const isMobile = window.innerWidth <= 768;
            const maxDimension = isMobile ? 1280 : 1920;
            
            // Calculate proportional dimensions so it perfectly matches the 1000% exactly what they see on stage
            const scaleFactor = domDims.width > domDims.height 
                ? maxDimension / domDims.width 
                : maxDimension / domDims.height;
                
            const exportWidth = Math.round(domDims.width * scaleFactor);
            const exportHeight = Math.round(domDims.height * scaleFactor);

            setStatusMsg('Loading Graphics...');
            const bgUrls = availableBackgrounds?.map(b => b.url) || [];
            if (backgroundImage?.url && !bgUrls.includes(backgroundImage.url)) {
                bgUrls.push(backgroundImage.url);
            }
            await engineRef.current.loadAssets(characters, bgUrls, visemeMap, (pct, msg) => {
                setProgress(pct);
                setStatusMsg(msg);
            });

                    let finalLipSyncKeys = lipSyncKeyframes || [];
            if (finalLipSyncKeys.length === 0 && vocalTrack.buffer) {
                setStatusMsg('Voice Analysis...');
                try {
                        let generatedKeys: LipSyncKeyframe[] = [];
                        try {
                            if (vocalTrack.segments && vocalTrack.segments.length > 0) {
                                for (let i = 0; i < vocalTrack.segments.length; i++) {
                                    const seg = vocalTrack.segments[i];
                                    const audioSpeed = vocalTrack.speed || 1.0;
                                    const segKeys = await processLipSync(vocalTrack.buffer || seg.buffer, () => {}) as LipSyncKeyframe[];
                                    segKeys.forEach(k => {
                                        if (k.time >= seg.clipStart && k.time <= seg.clipStart + seg.duration) {
                                            generatedKeys.push({
                                                ...k,
                                                time: (k.time - seg.clipStart + seg.startPosition) / audioSpeed,
                                                duration: k.duration / audioSpeed
                                            });
                                        }
                                    });
                                }
                            } else {
                                const audioSpeed = vocalTrack.speed || 1.0;
                                generatedKeys = await processLipSync(vocalTrack.buffer, (p) => setProgress(p));
                                generatedKeys = generatedKeys.map(k => ({ ...k, time: k.time / audioSpeed, duration: k.duration / audioSpeed }));
                            }
                        } catch (e: any) {
                            throw new Error(`LipSync Error: ${e.message}`);
                        }
                        if (lipSyncTargetId && lipSyncTargetId !== 'ALL' && lipSyncTargetId !== null) {
                        generatedKeys = generatedKeys.map(k => ({ ...k, targetId: lipSyncTargetId }));
                    }
                    finalLipSyncKeys = generatedKeys;
                    if (setLipSyncKeyframes) setLipSyncKeyframes(finalLipSyncKeys);
                } catch (e) {
                    console.warn("Lip sync failed, proceeding without it", e);
                }
            }

            const actualDuration = Math.max(
                duration,
                vocalTrack.buffer?.duration || 0,
                instTrack?.buffer?.duration || 0
            );

            console.log("Starting export with params:", {
                duration: actualDuration,
                vocalDuration: vocalTrack.buffer?.duration,
                instDuration: instTrack?.buffer?.duration
            });

            if (actualDuration < 0.1) {
                throw new Error("Duration is too short for rendering. Please ensure audio or track is loaded.");
            }

            const hasAnyAudio = !!vocalTrack.buffer || !!instTrack?.buffer;
            let mixedAudio = null;
            if (hasAnyAudio) {
                setStatusMsg('Mixing Audio...');
                try {
                    mixedAudio = await engineRef.current.mixAudio(
                        { buffer: vocalTrack.buffer, gain: vocalTrack.gain, pitch: vocalTrack.pitch, speed: vocalTrack.speed ?? 1.0, segments: vocalTrack.segments },
                        { buffer: instTrack?.buffer || null, gain: instTrack?.gain || 0.6, pitch: instTrack?.pitch || 1, speed: instTrack?.speed ?? 1.0, segments: instTrack?.segments },
                        actualDuration
                    );
                } catch (audioErr: any) {
                    console.error("Audio mixing failed:", audioErr);
                    setStatusMsg(`Audio Skip: ${audioErr.message || 'error'}`);
                }
            }

            setStatusMsg('Starting Studio Render...');
            setStatus('RENDERING');
            
            // Combine background image metadata with its transform settings for the engine
            const fullBackground = {
                ...backgroundTransform,
                url: backgroundImage?.url || null,
                width: backgroundImage?.width || 0,
                height: backgroundImage?.height || 0,
                linkBgToCamera: !!linkBgToCamera
            };

            // Setup OPFS file stream for 1000% memory optimization on low-end devices
            let fileStream: any = undefined;
            if (exportFormat !== 'game' && 'storage' in navigator && 'getDirectory' in navigator.storage) {
                try {
                    const dir = await navigator.storage.getDirectory();
                    const ext = exportFormat;
                    const fileHandle = await dir.getFileHandle(`export_${Date.now()}.${ext}`, { create: true });
                    fileStream = await fileHandle.createWritable();
                    opfsFileHandleRef.current = fileHandle;
                } catch (e) {
                    console.warn("OPFS setup failed, falling back to memory:", e);
                }
            }

            // Using the precise frame-by-frame path
            const blob = await engineRef.current.renderVideo(
                characters,
                fullBackground,
                cameraTransform,
                characterFiltersMap,
                finalLipSyncKeys,
                visemeMap || {} as any,
                mixedAudio,
                actualDuration,
                { color: canvasBgColor, isTransparent: isCanvasTransparent },
                { width: exportWidth, height: exportHeight },
                domDims,
                (p, statusMsg) => {
                    setProgress(p);
                    if (statusMsg) setStatusMsg(statusMsg);
                },
                keyframes || [],
                lightSources || [],
                ambientLightLevel ?? 1.0,
                shadowConfig,
                depthShadowConfig,
                fileStream,
                exportFormat,
                availableBackgrounds,
                texts
            );

            let finalOutputBlob: Blob | null = blob;
            if (fileStream && opfsFileHandleRef.current) {
                // If it used OPFS and returned null, we read the result from disk!
                try {
                    finalOutputBlob = await opfsFileHandleRef.current.getFile();
                    if (finalOutputBlob && finalOutputBlob.size === 0) throw new Error("OPFS file is empty");
                } catch (e) {
                    console.error("Failed to read from OPFS after export:", e);
                    throw new Error("Corrupted OPFS file.");
                }
            }

            if (!finalOutputBlob || finalOutputBlob.size === 0) {
                 throw new Error("Export yielded empty file.");
            }

            if (finalOutputBlob) {
                const url = URL.createObjectURL(finalOutputBlob);
                setDownloadUrl(url);
                setFinalBlob(finalOutputBlob);
                setStatus('DONE');

                // Notify on completion
                requestNotificationPermission().then(granted => {
                    if (granted) sendSystemNotification("Download complete", "Your video export has been saved.");
                });
            } else {
                throw new Error("No video data captured.");
            }

        } catch (e: any) {
            console.error(e);
            engineRef.current.cancel();
            setStatus('ERROR');
            setErrorMessage(e.message || "Capture failed.");
            setIsExporting(false);
            onTogglePresentationMode(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[500] bg-black/90 flex items-center justify-center p-4 min-h-0 animate-in fade-in duration-300">
            <div className={`w-full max-w-lg max-h-full bg-[#0a0a0a] border border-white/10 rounded-2xl shadow-2xl overflow-y-auto custom-scrollbar relative transition-all flex flex-col`}>
                
                {/* Header */}
                <div className="p-4 border-b border-white/5 flex justify-between items-center bg-white/5">
                    <h3 className="text-xs font-black tracking-widest text-white uppercase flex items-center gap-2">
                        <Film size={14} className="text-cyan-500"/> {t('ANIMATO PRODUCTION EXPORT')}
                    </h3>
                    <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">
                        <X size={16}/>
                    </button>
                </div>

                <div className="p-8 flex flex-col items-center gap-6">
                    
                    {/* DESKTOP / RENDER UI */}
                    {status !== 'DONE' && (
                        <div className="flex flex-col items-center w-full gap-6">
                            <div className="relative">
                                {status === 'IDLE' && (
                                    <button 
                                        onClick={handleStartRender}
                                        className={`w-24 h-24 rounded-full border flex items-center justify-center group cursor-pointer transition-all hover:scale-105 hover:shadow-[0_0_30px_rgba(6,182,212,0.3)] animate-pulse bg-cyan-900/20 border-cyan-500/30 hover:bg-cyan-500/20`}
                                    >
                                        <div className={`absolute w-20 h-20 rounded-full border-2 border-dashed animate-[spin_10s_linear_infinite] border-cyan-500/30`}></div>
                                        <Video size={36} className="text-cyan-500 ml-1 group-hover:scale-110 transition-transform"/>
                                    </button>
                                )}
                                {(status === 'PREPARING' || status === 'RENDERING') && (
                                    <div className="w-full max-w-xs space-y-4">
                                        <div className="flex justify-between text-[10px] font-bold tracking-widest text-cyan-500">
                                            <span>{status === 'PREPARING' ? 'INITIALIZING' : 'RENDERING'}</span>
                                            <span>{Math.round(progress)}%</span>
                                        </div>
                                        <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                                            <div 
                                                className="h-full bg-cyan-500 shadow-[0_0_10px_rgba(6,182,212,0.8)] transition-all duration-300 ease-out"
                                                style={{ width: `${progress}%` }}
                                            />
                                        </div>
                                        {statusMsg && (
                                            <div className="text-[10px] text-gray-400 text-center font-mono animate-pulse">
                                                {statusMsg}
                                            </div>
                                        )}
                                    </div>
                                )}
                                {status === 'ERROR' && (
                                    <div className="w-24 h-24 rounded-full bg-red-900/20 border border-red-500/30 flex items-center justify-center">
                                        <AlertCircle size={40} className="text-red-500"/>
                                    </div>
                                )}
                            </div>

                            <div className="text-center space-y-2 w-full">
                                {status === 'IDLE' && (
                                    <>
                                        <h4 className="text-white font-bold text-lg">
                                            {t('Production Capture')}
                                        </h4>
                                        <p className="text-gray-500 text-xs max-w-[280px] mx-auto leading-relaxed mb-4">
                                            {t('Starts a High-Fidelity Canvas Recording. This records the internal canvas directly without prompting for screen sharing.')}
                                        </p>
                                        
                                        <div className="flex bg-[#050505] p-1 rounded-xl border border-white/10 w-fit mx-auto mb-2">
                                            <button 
                                                onClick={() => setExportFormat('mp4')}
                                                className={`px-6 py-2 rounded-lg text-xs font-black tracking-widest transition-all ${exportFormat === 'mp4' ? 'bg-cyan-500 text-black shadow-lg shadow-cyan-500/30' : 'text-gray-500 hover:text-white'}`}
                                            >
                                                MP4
                                            </button>
                                            <button 
                                                onClick={() => setExportFormat('webm')}
                                                className={`px-6 py-2 rounded-lg text-xs font-black tracking-widest transition-all ${exportFormat === 'webm' ? 'bg-cyan-500 text-black shadow-lg shadow-cyan-500/30' : 'text-gray-500 hover:text-white'}`}
                                            >
                                                WEBM
                                            </button>
                                            <button 
                                                onClick={() => setExportFormat('game')}
                                                className={`px-6 py-2 rounded-lg text-xs font-black tracking-widest transition-all ${exportFormat === 'game' ? 'bg-amber-500 text-black shadow-lg shadow-amber-500/30 font-bold' : 'text-gray-500 hover:text-white'}`}
                                            >
                                                GAME
                                            </button>
                                        </div>

                                        {errorMessage && (
                                            <p className="text-amber-500 text-xs mt-2 font-bold animate-in fade-in slide-in-from-top-1">
                                                {errorMessage}
                                            </p>
                                        )}
                                    </>
                                )}
                                {status === 'RENDERING' && (
                                    <>
                                        <h4 className="text-white font-bold text-lg animate-pulse">
                                            {t('Recording Main Stage...')}
                                        </h4>
                                        <p className="text-gray-500 text-xs">
                                            {t('Do not switch tabs. Audio and Video are being captured in real-time.')}
                                        </p>
                                    </>
                                )}
                                {status === 'ERROR' && (
                                    <>
                                        <h4 className="text-red-500 font-bold text-lg">{t('Recording Failed')}</h4>
                                        <p className="text-red-400/70 text-xs">{errorMessage}</p>
                                        <button 
                                            onClick={() => { setStatus('IDLE'); }}
                                            className="mt-4 text-[10px] bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded text-white transition-colors"
                                        >
                                            {t('Try Again')}
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>
                    )}

                    {/* DONE STATE */}
                    {status === 'DONE' && (
                        <div className="w-full space-y-4 sm:space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                            {downloadUrl && (
                                exportFormat === 'game' ? (
                                    <div className="w-full bg-[#1e140a] rounded-xl border border-amber-500/20 overflow-hidden shadow-2xl relative aspect-video max-h-[40vh] sm:max-h-[50vh] flex flex-col items-center justify-center p-6 text-center">
                                        <div className="w-14 h-14 bg-amber-500/20 text-amber-400 rounded-xl flex items-center justify-center mb-3 animate-bounce">
                                            <Gamepad2 size={28} />
                                        </div>
                                        <p className="text-amber-400 font-bold text-sm uppercase tracking-wider">{t('Character Game Bundle Compiled')}</p>
                                        <p className="text-gray-400 text-[10px] mt-1 max-w-[280px] leading-relaxed">
                                            {t('Download the .anim_game asset file. You can import this animation directly in your Animato Game Builder scenes!')}
                                        </p>
                                    </div>
                                ) : (
                                    <div className="w-full bg-black rounded-xl border border-white/10 overflow-hidden shadow-2xl relative aspect-video max-h-[40vh] sm:max-h-[50vh] group">
                                        <video src={`${downloadUrl}#t=0.001`} controls playsInline preload="auto" className="w-full h-full object-contain" />
                                    </div>
                                )
                            )}
                                <div className="flex flex-col items-center gap-2">
                                    <div className="flex items-center gap-2 text-green-500">
                                        <CheckCircle2 size={18}/>
                                        <h4 className="font-bold text-lg">{t('Production Master Ready')}</h4>
                                    </div>
                                    <p className="text-gray-500 text-xs text-center">
                                        {downloadUrl ? "High-bitrate sequence captured." : "High-bitrate sequence saved directly to your device."}
                                    </p>
                                </div>

                                <div className="w-full space-y-2">
                                    <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">{t('File Name')}</label>
                                    <input 
                                        type="text" 
                                        value={exportFileName}
                                        onChange={(e) => setExportFileName(e.target.value)}
                                        className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-white text-sm focus:outline-none focus:ring-1 focus:ring-cyan-500 h-10 mt-1"
                                        placeholder="filename"
                                    />
                                </div>

                                {downloadUrl && (
                                    <button 
                                        onClick={async () => {
                                            if (finalBlob) {
                                                const ext = exportFormat === 'game' ? 'anim_game' : exportFormat;
                                                const filename = `${exportFileName.trim().replace(new RegExp(`\\.${ext}$`, 'i'), '')}.${ext}`;
                                                await triggerDownload(finalBlob, filename);
                                                triggerLocalToast("Download Completed!");
                                            }
                                        }}
                                        className={`w-full py-4 font-black tracking-wider text-xs rounded-xl transition-all flex items-center justify-center gap-2 ${
                                            exportFormat === 'game' 
                                                ? 'bg-amber-500 hover:bg-amber-400 text-black shadow-[0_0_20px_rgba(245,158,11,0.2)]' 
                                                : 'bg-green-500 hover:bg-green-400 text-black shadow-[0_0_20px_rgba(34,197,94,0.2)]'
                                        }`}
                                    >
                                        <Download size={18}/> {exportFormat === 'game' ? t('SAVE GAME FORMAT ASSET') : t('SAVE VIDEO FILE')}
                                    </button>
                                )}

                            {!downloadUrl && !finalBlob && (
                                <button 
                                    onClick={onClose}
                                    className="w-full py-4 bg-white/10 hover:bg-white/20 text-white font-black tracking-wider text-xs rounded-xl transition-all flex items-center justify-center gap-2"
                                >
                                    {t('CLOSE')}
                                </button>
                            )}
                        </div>
                    )}

                    <AnimatePresence>
                        {localToast && (
                            <motion.div 
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: 20 }}
                                className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[100] pointer-events-none"
                            >
                                <div className="bg-black/90 border border-green-500/30 px-6 py-3 rounded-full text-green-400 text-[10px] font-black uppercase tracking-[0.2em] shadow-[0_0_20px_rgba(34,197,94,0.1)] flex items-center gap-3">
                                    <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></div>
                                    {localToast}
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    {/* Footer Actions */}
                    <div className="w-full pt-4 flex flex-col gap-3">
                        {(status === 'DONE' || status === 'ERROR') && (
                            <button 
                                onClick={cleanup}
                                className="w-full py-3 bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white font-bold text-xs rounded-xl transition-colors"
                            >
                                {t('CLOSE STUDIO')}
                            </button>
                        )}
                        
                        {status === 'RENDERING' && (
                            <button 
                                onClick={cleanup}
                                className="w-full py-3 bg-red-900/50 hover:bg-red-900/80 text-red-200 font-bold text-xs rounded-xl transition-colors border border-red-500/30"
                            >
                                {t('STOP RECORDING')}
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

