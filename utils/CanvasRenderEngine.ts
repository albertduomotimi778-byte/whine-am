import { CharacterComposition, CharacterPart, VisemeShape, LipSyncKeyframe, LightSource, Keyframe, Bone, SceneText } from '../types';
import { getMouthPhysicsTargets } from './visemeUtils';
import { KeyframeEngine } from './KeyframeEngine';
import { Muxer, ArrayBufferTarget, FileSystemWritableFileStreamTarget } from 'webm-muxer';
import { Muxer as Mp4Muxer, ArrayBufferTarget as Mp4ArrayBufferTarget, FileSystemWritableFileStreamTarget as Mp4FileSystemTarget } from 'mp4-muxer';
import { drawWarpedImage } from '../components/PuppetWarp';

const checkIsBackHair = (part: any, character: any): boolean => {
  if (!part) return false;
  let curr = part;
  const visited = new Set<string>();
  while (curr) {
    if (visited.has(curr.id)) break;
    visited.add(curr.id);
    const labelLower = (curr.label || '').toLowerCase();
    const isBack = labelLower.includes('back');
    const isHair = labelLower.includes('hair') || labelLower.includes('here') || labelLower.includes('hair_swap');
    if (
      labelLower === 'back' ||
      labelLower.includes('backhair') ||
      labelLower.includes('back_hair') ||
      labelLower.includes('back-hair') ||
      (isBack && isHair)
    ) {
      return true;
    }
    curr = curr.parentId && character ? character[curr.parentId] : null;
  }
  return false;
};

interface RenderSettings {
    color: string;
    isTransparent: boolean;
}

interface ShadowConfig {
    enabled: boolean;
    offsetX: number;
    offsetY: number;
    blur: number;
    opacity: number;
    color: string;
    skewX: number;
    scaleY: number;
}

export class CanvasRenderEngine {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private imageCache: Map<string, HTMLImageElement> = new Map();
    private blurredCache: Map<string, HTMLCanvasElement> = new Map();
    private isCancelled: boolean = false;
    private lastFilter: string = "none";

    // --- PHYSICS STATE ---
    private physicsStates: Map<string, {
        x: number; y: number; offY: number; vx: number; vy: number; vOffY: number;
        jiggleY: number; vJiggleY: number; simTime: number; 
        eyebrowInt?: number; vEyebrowInt?: number;
    }> = new Map();

    constructor() {
        // Always use standard HTML canvas for maximum hardware/encoder compatibility across all devices and browsers.
        // Avoid OffscreenCanvas which has bugs on Safari with VideoFrame and complex filters.
        this.canvas = document.createElement('canvas');
        this.canvas.width = 1920;
        this.canvas.height = 1080;
        // CRITICAL: Do NOT use willReadFrequently: true, as it forces software rendering causing massive lag and crashes.
        this.ctx = this.canvas.getContext('2d', { alpha: true, desynchronized: true }) as CanvasRenderingContext2D;
    }

    public async loadAssets(
        characters: { id: string, composition: CharacterComposition, visemeMap?: Record<VisemeShape, string | null> }[] | null, 
        backgroundUrl: string | string[] | null,
        visemeMap?: Record<VisemeShape, string | null>,
        onProgress?: (pct: number, msg: string) => void
    ): Promise<void> {
        return new Promise<void>(async (resolve) => {
            const globalTimeout = setTimeout(() => {
                console.warn("loadAssets: Global timeout reached. Moving forward.");
                resolve();
            }, 30000);

            try {
                this.imageCache.clear();
                this.blurredCache.clear();
                const urlsSet = new Set<string>();

                if (backgroundUrl) {
                    if (Array.isArray(backgroundUrl)) {
                        backgroundUrl.forEach(u => u && urlsSet.add(u));
                    } else {
                        urlsSet.add(backgroundUrl);
                    }
                }

                if (characters) {
                    characters.forEach(char => {
                        if (!char.composition) return;
                        Object.values(char.composition).forEach((part: any) => {
                            if (part && part.imageUrl) urlsSet.add(part.imageUrl);
                        });
                        if (char.visemeMap) {
                            Object.values(char.visemeMap).forEach(url => { if (url) urlsSet.add(url); });
                        }
                    });
                }

                if (visemeMap) {
                    Object.values(visemeMap).forEach(url => { if (url) urlsSet.add(url); });
                }

                const allUrls = Array.from(urlsSet).filter(u => u && typeof u === 'string');
                if (allUrls.length === 0) {
                    clearTimeout(globalTimeout);
                    resolve();
                    return;
                }

                let loadedCount = 0;
                await Promise.all(allUrls.map(url => {
                    return new Promise<void>((resolveOne) => {
                        const img = new Image();
                        if (!url.startsWith('data:') && !url.startsWith('blob:')) {
                            img.crossOrigin = "anonymous";
                        }
                        img.onload = () => {
                            this.imageCache.set(url, img);
                            loadedCount++;
                            if (onProgress) onProgress((loadedCount / allUrls.length) * 100, `Assets: ${loadedCount}/${allUrls.length}`);
                            resolveOne();
                        };
                        img.onerror = () => { loadedCount++; resolveOne(); };
                        img.src = url;
                    });
                }));

                clearTimeout(globalTimeout);
                resolve();
            } catch (err) {
                clearTimeout(globalTimeout);
                resolve();
            }
        });
    }

    public async mixAudio(
        vocalTrack: { buffer: AudioBuffer | null, gain: number, pitch: number, speed: number, segments?: import('../types').AudioSegment[] },
        instTrack: { buffer: AudioBuffer | null, gain: number, pitch: number, speed: number, segments?: import('../types').AudioSegment[] },
        duration: number
    ): Promise<AudioBuffer> {
        const sampleRate = 48000;
        const frameCount = Math.max(1, Math.ceil(duration * sampleRate));
        const offlineCtx = new (window.OfflineAudioContext || (window as any).webkitOfflineAudioContext)(2, frameCount, sampleRate);

        const master = offlineCtx.createGain();
        const compressor = offlineCtx.createDynamicsCompressor();
        
        compressor.threshold.setValueAtTime(-24, offlineCtx.currentTime);
        compressor.knee.setValueAtTime(30, offlineCtx.currentTime);
        compressor.ratio.setValueAtTime(12, offlineCtx.currentTime);
        compressor.attack.setValueAtTime(0.003, offlineCtx.currentTime);
        compressor.release.setValueAtTime(0.25, offlineCtx.currentTime);

        master.connect(compressor);
        compressor.connect(offlineCtx.destination);

        const playTrack = (track: { buffer: AudioBuffer | null, gain: number, pitch: number, speed: number, segments?: import('../types').AudioSegment[] }) => {
            if (!track.buffer && (!track.segments || track.segments.length === 0)) return;
            const segments = track.segments?.length ? track.segments : (track.buffer ? [{ buffer: track.buffer, startPosition: 0, clipStart: 0, duration: track.buffer.duration }] : []);
            
            segments.forEach(seg => {
                const src = offlineCtx.createBufferSource();
                src.buffer = track.buffer || seg.buffer; // Some segments may store their buffer locally
                src.playbackRate.value = track.speed;
                const gain = offlineCtx.createGain();
                gain.gain.value = track.gain;
                src.connect(gain);
                gain.connect(master);
                src.start(seg.startPosition, seg.clipStart, seg.duration);
            });
        };

        playTrack(vocalTrack);
        playTrack(instTrack);

        return await offlineCtx.startRendering();
    }

    public async renderVideo(
        characters: { id: string, composition: CharacterComposition, visemeMap?: Record<VisemeShape, string | null>, boneTransforms?: Record<string, {rotation: number, scaleX: number, scaleY: number}> }[],
        background: { url: string | null, x: number, y: number, zoom: number, blur: number, brightness: number, contrast: number, saturation: number, linkBgToCamera?: boolean },
        camera: { x: number, y: number, scale: number, rotation: number },
        characterFilters: Record<string, any>,
        lipSyncKeys: LipSyncKeyframe[],
        visemeMap: Record<VisemeShape, string | null>,
        audioBuffer: AudioBuffer | null,
        duration: number,
        canvasSettings: RenderSettings,
        resolution: { width: number, height: number },
        sourceDimensions: { width: number, height: number },
        onProgress: (pct: number, status?: string) => void,
        keyframes: Keyframe[] = [],
        lightSources: LightSource[] = [],
        ambientLightLevel: number = 1.0,
        shadowConfig: ShadowConfig = { enabled: false, offsetX: 0, offsetY: 0, blur: 0, opacity: 0.5, color: '#000', skewX: 0, scaleY: 1 },
        depthShadowConfig: ShadowConfig = { enabled: false, offsetX: 0, offsetY: 0, blur: 0, opacity: 0.5, color: '#000', skewX: 0, scaleY: 1 },
        fileStream?: any,
        exportFormat: 'webm' | 'mp4' | 'game' = 'webm',
        availableBackgrounds?: { url: string | null }[],
        texts: SceneText[] = []
    ): Promise<Blob | null> {
        if (exportFormat === 'game') {
            canvasSettings = { ...canvasSettings, isTransparent: true };
        }
        this.isCancelled = false;
        this.physicsStates.clear();
        this.lastFilter = "none";
        
        // --- CRITICAL FIX: Ensure divisible by 4 (required by most codecs like H264 for max compat) ---
        const exportWidth = Math.floor(resolution.width / 4) * 4;
        const exportHeight = Math.floor(resolution.height / 4) * 4;
        
        // Also ensure a minimum size (some encoders fail on tiny dimensions)
        const finalWidth = Math.max(128, exportWidth);
        const finalHeight = Math.max(128, exportHeight);

        this.canvas.width = finalWidth;
        this.canvas.height = finalHeight;
        this.ctx = this.canvas.getContext('2d', { 
            alpha: canvasSettings.isTransparent, 
            desynchronized: false, 
            willReadFrequently: false
        })!;

        const fps = 30;
        const totalFrames = Math.floor(duration * fps);
        const frameTime = 1 / fps;
        const sampleRate = audioBuffer?.sampleRate || 48000;

        // Optimized Data Prep
        const kfTracks = KeyframeEngine.getTracks(keyframes);
        const charLipKeysMap = new Map(characters.map(c => [c.id, lipSyncKeys.filter(k => !k.targetId || k.targetId === c.id)]));

        return new Promise(async (resolve, reject) => {
            try {
                if (exportFormat === 'game') {
                    const gameFrames: string[] = [];
                    const globalScale = finalWidth / sourceDimensions.width;
                    const yieldFreq = 5;

                    for (let i = 0; i < totalFrames; i++) {
                        if (this.isCancelled) {
                            resolve(null); return;
                        }
                        const time = i * frameTime;
                        const animatedState = KeyframeEngine.resolveStateFromTracks(kfTracks, time);
                        
                        let bgUrl = null;

                        this.drawFrame(
                            time, characters,
                            {
                                ...background, url: bgUrl,
                                zoom: animatedState['bg:zoom'] ?? background.zoom,
                                blur: animatedState['bg:blur'] ?? background.blur,
                                brightness: animatedState['bg:brightness'] ?? background.brightness,
                                contrast: animatedState['bg:contrast'] ?? background.contrast,
                                saturation: animatedState['bg:saturation'] ?? background.saturation,
                                x: animatedState['bg:x'] ?? background.x,
                                y: animatedState['bg:y'] ?? background.y
                            },
                            {
                                x: animatedState['camera:x'] ?? camera.x,
                                y: animatedState['camera:y'] ?? camera.y,
                                scale: animatedState['camera:scale'] ?? camera.scale,
                                rotation: animatedState['camera:rotation'] ?? camera.rotation
                            },
                            characterFilters, lipSyncKeys, visemeMap, canvasSettings, globalScale, lightSources, animatedState['env:ambient'] ?? ambientLightLevel, animatedState,
                            charLipKeysMap, shadowConfig, depthShadowConfig, texts
                        );

                        // Push to game frames
                        gameFrames.push(this.canvas.toDataURL("image/png"));

                        if (i % yieldFreq === 0) {
                            const pct = (i / totalFrames) * 95;
                            onProgress(pct, `Compiling game frames: ${Math.round(pct)}%`);
                            await new Promise(r => setTimeout(r, 0));
                        }
                    }

                    const gameProj = {
                        type: "anim_game",
                        version: "1.0",
                        name: "Character Animation",
                        fps: fps,
                        frames: gameFrames
                    };
                    const blob = new Blob([JSON.stringify(gameProj, null, 2)], { type: 'application/json' });
                    resolve(blob);
                    return;
                }

                // Prefer VP9 for higher color accuracy and quality, fallback to VP8
                const codecOptions = [
                    { codec: 'vp09.00.10.08', muxer: 'V_VP9' }, 
                    { codec: 'vp8', muxer: 'V_VP8' },
                    { codec: 'avc1.42E01E', muxer: 'V_MPEG4/ISO/AVC' }
                ];
                
                let chosen = codecOptions[0]; // Prefer VP9 for higher quality
                onProgress(0, "Preparing High-Quality Codec...");

                let finalConfig: VideoEncoderConfig | null = null;

                for (const option of codecOptions) {
                    try {
                        const testConfig: VideoEncoderConfig = {
                            codec: option.codec,
                            width: finalWidth,
                            height: finalHeight,
                            displayWidth: finalWidth,
                            displayHeight: finalHeight,
                            bitrate: 5_000_000,
                            framerate: fps,
                            hardwareAcceleration: "no-preference",
                            alpha: (option.muxer.startsWith('V_VP') && canvasSettings.isTransparent) ? 'keep' : 'discard'
                        };

                        
                        const support = await VideoEncoder.isConfigSupported(testConfig);
                        if (support.supported && support.config) {
                            chosen = option;
                            finalConfig = support.config;
                            console.log("Selected optimized codec:", option.codec);
                            break;
                        }
                    } catch (e) { continue; }
                }

                const videoConfig: VideoEncoderConfig = finalConfig || {
                    codec: chosen.codec,
                    width: finalWidth,
                    height: finalHeight,
                    displayWidth: finalWidth,
                    displayHeight: finalHeight,
                    bitrate: 5_000_000,
                    framerate: fps,
                    hardwareAcceleration: "no-preference",
                    alpha: (chosen.muxer.startsWith('V_VP') && canvasSettings.isTransparent) ? 'keep' : 'discard'
                };

                // PRE-FLIGHT CAPABILITY CHECKS FOR AUDIO CODEC
                let selectedAudioCodec: string | null = null;
                let muxerAudioCodec: 'aac' | 'opus' | null = null;
                const hasAudio = !!audioBuffer && audioBuffer.length > 0;

                if (hasAudio && typeof AudioEncoder !== 'undefined') {
                    const audioChannels = 2; // Hardcoded stereo in this file
                    if (exportFormat === 'mp4') {
                        // 1. Try AAC first
                        try {
                            const aacSupport = await AudioEncoder.isConfigSupported({
                                codec: 'mp4a.40.2',
                                sampleRate,
                                numberOfChannels: audioChannels,
                                bitrate: 128000
                            });
                            if (aacSupport.supported) {
                                selectedAudioCodec = 'mp4a.40.2';
                                muxerAudioCodec = 'aac';
                            }
                        } catch (e) {}

                        // 2. Try Opus fallback in MP4
                        if (!selectedAudioCodec) {
                            try {
                                const opusSupport = await AudioEncoder.isConfigSupported({
                                    codec: 'opus',
                                    sampleRate,
                                    numberOfChannels: audioChannels,
                                    bitrate: 128000
                                });
                                if (opusSupport.supported) {
                                    selectedAudioCodec = 'opus';
                                    muxerAudioCodec = 'opus';
                                }
                            } catch (e) {}
                        }
                    } else {
                        // WebM uses Opus
                        try {
                            const opusSupport = await AudioEncoder.isConfigSupported({
                                codec: 'opus',
                                sampleRate,
                                numberOfChannels: audioChannels,
                                bitrate: 128000
                            });
                            if (opusSupport.supported) {
                                selectedAudioCodec = 'opus';
                                muxerAudioCodec = 'opus';
                            }
                        } catch (e) {}
                    }
                }

                let target: any;
                let muxer: any;

                if (exportFormat === 'mp4') {
                    const avcCodecs = [
                        // High Profile (Preferred for quality)
                        'avc1.64002a', // High Profile, Level 4.2
                        'avc1.640029', // High Profile, Level 4.1
                        'avc1.640028', // High Profile, Level 4.0 (Supports 1080p @ 30fps)
                        'avc1.640033', // High Profile, Level 5.1 (Supports 4K @ 30fps)
                        'avc1.640034', // High Profile, Level 5.2 (Supports 4K @ 60fps)
                        
                        // Main Profile (Excellent compatibility)
                        'avc1.4d402a', // Main Profile, Level 4.2
                        'avc1.4d4029', // Main Profile, Level 4.1
                        'avc1.4d4028', // Main Profile, Level 4.0
                        'avc1.4d401f', // Main Profile, Level 3.1
                        
                        // Baseline Profile (Max compatibility)
                        'avc1.42e02a', // Baseline Profile, Level 4.2
                        'avc1.42e029', // Baseline Profile, Level 4.1
                        'avc1.42e028', // Baseline Profile, Level 4.0
                        'avc1.42e01f'  // Baseline Profile, Level 3.1
                    ];
                    let selectedCodec = 'avc1.640028';
                    for (const codec of avcCodecs) {
                        try {
                            const isSupported = await VideoEncoder.isConfigSupported({
                                codec,
                                width: finalWidth,
                                height: finalHeight,
                                bitrate: 5_000_000,
                                framerate: fps
                            });
                            if (isSupported.supported) {
                                selectedCodec = codec;
                                break;
                            }
                        } catch (e) {}
                    }
                    videoConfig.codec = selectedCodec;
                    videoConfig.alpha = 'discard'; // MP4 AVC doesn't support alpha
                    target = fileStream ? new Mp4FileSystemTarget(fileStream) : new Mp4ArrayBufferTarget();
                    muxer = new Mp4Muxer({
                        target: target,
                        video: {
                            codec: 'avc',
                            width: finalWidth,
                            height: finalHeight
                        },
                        audio: muxerAudioCodec ? { 
                            codec: muxerAudioCodec, 
                            sampleRate, 
                            numberOfChannels: 2 
                        } : undefined,
                        fastStart: fileStream ? false : 'in-memory',
                        firstTimestampBehavior: 'strict'
                    });
                } else {
                    target = fileStream ? new FileSystemWritableFileStreamTarget(fileStream) : new ArrayBufferTarget();
                    muxer = new Muxer({
                        target: target,
                        video: { 
                            codec: chosen.muxer as any, 
                            width: finalWidth, 
                            height: finalHeight, 
                            frameRate: fps 
                        },
                        audio: selectedAudioCodec ? { 
                            codec: 'A_OPUS', 
                            sampleRate, 
                            numberOfChannels: 2 
                        } : undefined,
                        type: 'webm',
                        firstTimestampBehavior: 'strict'
                    });
                }

                const videoEncoder = new VideoEncoder({
                    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
                    error: e => { 
                        console.error("Video Encoder Error:", e); 
                        reject(new Error(`Studio Encoder Error: ${e.message}`)); 
                    }
                });

                try {
                    videoEncoder.configure(videoConfig);
                } catch (e) {
                    console.warn("Standard config failed, trying fallback...", e);
                    videoConfig.alpha = "discard";
                    videoEncoder.configure(videoConfig);
                }

                let audioEncoder: AudioEncoder | null = null;
                if (hasAudio && selectedAudioCodec) {
                    try {
                        audioEncoder = new AudioEncoder({
                            output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
                            error: e => console.warn("Audio Encoder Error:", e)
                        });
                        audioEncoder.configure({ 
                            codec: selectedAudioCodec, 
                            sampleRate, 
                            numberOfChannels: 2, 
                            bitrate: 128_000 
                        });
                    } catch (e) {
                        console.warn("AudioEncoder configuration failed:", e);
                        audioEncoder = null;
                    }
                }

                const audioChans: Float32Array[] = [];
                if (hasAudio && audioBuffer) {
                    for (let c = 0; c < audioBuffer.numberOfChannels; c++) {
                        audioChans.push(audioBuffer.getChannelData(c));
                    }
                }

                const globalScale = finalWidth / sourceDimensions.width;
                const yieldFreq = 30; 
                const audioBlockSize = Math.ceil(frameTime * sampleRate) + 10; // +10 to prevent floating point boundary errors
                const pData = new Float32Array(audioBlockSize * 2);

                for (let i = 0; i < totalFrames; i++) {
                    if (this.isCancelled) {
                        videoEncoder.close(); if (audioEncoder) audioEncoder.close();
                        if (fileStream) { try { await fileStream.close(); } catch(e){} }
                        resolve(null); return;
                    }

                    const time = i * frameTime;
                    const animatedState = KeyframeEngine.resolveStateFromTracks(kfTracks, time);

                    let bgUrl = background.url;
                    if (availableBackgrounds && animatedState['bg:index'] !== undefined) {
                        const bgIndex = Math.round(animatedState['bg:index']);
                        if (availableBackgrounds[bgIndex]) {
                            bgUrl = availableBackgrounds[bgIndex].url;
                        }
                    }

                    this.drawFrame(
                        time, characters,
                        {
                            ...background,
                            url: bgUrl,
                            zoom: animatedState['bg:zoom'] ?? background.zoom,
                            blur: animatedState['bg:blur'] ?? background.blur,
                            brightness: animatedState['bg:brightness'] ?? background.brightness,
                            contrast: animatedState['bg:contrast'] ?? background.contrast,
                            saturation: animatedState['bg:saturation'] ?? background.saturation,
                            x: animatedState['bg:x'] ?? background.x,
                            y: animatedState['bg:y'] ?? background.y
                        },
                        {
                            x: animatedState['camera:x'] ?? camera.x,
                            y: animatedState['camera:y'] ?? camera.y,
                            scale: animatedState['camera:scale'] ?? camera.scale,
                            rotation: animatedState['camera:rotation'] ?? camera.rotation
                        },
                        characterFilters, lipSyncKeys, visemeMap, canvasSettings, globalScale, lightSources, animatedState['env:ambient'] ?? ambientLightLevel, animatedState,
                        charLipKeysMap,
                        shadowConfig,
                        depthShadowConfig,
                        texts
                    );

                    // Absolute critical yield BEFORE capture so the GPU pipeline actually flushes the complex draw commands.
                    // This fixes the blank video issues 100% on iOS and complex animations.
                    await new Promise(r => setTimeout(r, 0));

                    const frameTimestampMicro = Math.round(time * 1_000_000);
                    const frameDurationMicro = Math.round(frameTime * 1_000_000);

                    const frameInit: any = { 
                        timestamp: frameTimestampMicro, 
                        duration: frameDurationMicro,
                        alpha: canvasSettings.isTransparent ? 'keep' : 'discard'
                    };

                    const frame = new VideoFrame(this.canvas, frameInit);
                    
                    videoEncoder.encode(frame, { keyFrame: i % 30 === 0 }); 
                    frame.close();

                    // Absolute critical yield AFTER to avoid GPU buffer under-runs and unblock UI.
                    await new Promise(r => setTimeout(r, 0));

                    if (audioEncoder && audioBuffer) {
                        const start = Math.floor(time * sampleRate);
                        const end = Math.min(audioBuffer.length, Math.floor((time + frameTime) * sampleRate));
                        const actualLen = end - start;
                        if (actualLen > 0) {
                            for (let ch = 0; ch < 2; ch++) {
                                const sub = audioChans[ch < audioChans.length ? ch : 0].subarray(start, end);
                                pData.set(sub, ch * actualLen);
                            }
                            const aPack = new AudioData({ 
                                format: 'f32-planar', 
                                sampleRate, 
                                numberOfFrames: actualLen, 
                                numberOfChannels: 2, 
                                timestamp: frameTimestampMicro, 
                                data: pData.subarray(0, actualLen * 2) 
                             });
                            audioEncoder.encode(aPack); aPack.close();
                        }
                    }

                    if (i % yieldFreq === 0 || i === totalFrames - 1) {
                        const pct = (i / totalFrames) * 95; // Only go up to 95% during loops
                        onProgress(pct, `Exporting Video: ${Math.round(pct)}%`);
                        await new Promise(r => setTimeout(r, 0));
                    }

                    // Throttle to avoid memory exhaustion! Keep queue tiny to prevent RAM crash on low end devices.
                    while (videoEncoder.state === 'configured' && videoEncoder.encodeQueueSize > 2) {
                        await new Promise(r => setTimeout(r, 10));
                    }
                }

                onProgress(97, "Finishing video encoding...");
                
                // Wrap flush in a race to prevent permanent hang
                const flushPromise = Promise.all([
                    videoEncoder.flush(),
                    audioEncoder ? audioEncoder.flush() : Promise.resolve()
                ]);
                
                const timeoutPromise = new Promise((_, reject) => 
                    setTimeout(() => reject(new Error("Encoding timed out: Encoder failed to resolve final flush.")), 15000)
                );

                try {
                    await Promise.race([flushPromise, timeoutPromise]);
                } catch (e) {
                    console.warn("Finalization warning (proceeding anyway):", e);
                }

                onProgress(99, "Finalizing Studio Stream...");
                // Small delay to let OS/Browser catch up before finalizing muxer
                await new Promise(r => setTimeout(r, 200));

                muxer.finalize();
                
                // Cleanup encoders
                try {
                    videoEncoder.close();
                    if (audioEncoder) audioEncoder.close();
                } catch (e) {
                    console.warn("Error closing encoders during finalization:", e);
                }

                if (fileStream) {
                    try {
                        await fileStream.close();
                    } catch(e) {
                         console.warn("Failed to close fileStream:", e);
                    }
                    resolve(null);
                } else {
                    const buffer = exportFormat === 'mp4' ? (muxer.target as Mp4ArrayBufferTarget).buffer : (muxer.target as ArrayBufferTarget).buffer;
                    if (!buffer || buffer.byteLength === 0) {
                        reject(new Error("Muxing failed: Final buffer is empty."));
                    } else {
                        resolve(new Blob([buffer], { type: exportFormat === 'mp4' ? 'video/mp4' : 'video/webm' }));
                    }
                }

            } catch (err) { reject(err); }
        });
    }

    public cancel() { this.isCancelled = true; }

    private stepPhysics(charId: string, targetTime: number, keys: LipSyncKeyframe[]) {
        const FIXED_STEP = 1 / 30;
        let phys = this.physicsStates.get(charId) || { x: 1, y: 1, offY: 0, vx: 0, vy: 0, vOffY: 0, jiggleY: 0, vJiggleY: 0, eyebrowInt: 0, vEyebrowInt: 0, simTime: 0 } as any;
        while (phys.simTime < targetTime) {
            phys.simTime += FIXED_STEP;
            const v = this.getInterpolatedViseme(phys.simTime, keys);
            const tg = getMouthPhysicsTargets(v.shape, v.intensity);
            phys.vx = (phys.vx + (tg.scaleX - phys.x) * 0.55) * 0.7; phys.x += phys.vx;
            phys.vy = (phys.vy + (tg.scaleY - phys.y) * 0.55) * 0.7; phys.y += phys.vy;
            phys.vOffY = (phys.vOffY + (tg.offsetY - phys.offY) * 0.55) * 0.7; phys.offY += phys.vOffY;
            phys.vJiggleY = (phys.vJiggleY + ((phys.y - 1.0) * 10 - phys.jiggleY) * 0.15) * 0.8; phys.jiggleY += phys.vJiggleY;
            
            const tgtEyebrow = v.intensity;
            phys.vEyebrowInt = ((phys.vEyebrowInt || 0) + (tgtEyebrow - (phys.eyebrowInt || 0)) * 0.15) * 0.8;
            phys.eyebrowInt = (phys.eyebrowInt || 0) + phys.vEyebrowInt;
        }
        this.physicsStates.set(charId, phys);
    }

    private drawFrame(
        time: number,
        chars: { id: string, composition: CharacterComposition, visemeMap?: Record<VisemeShape, string | null>, boneTransforms?: Record<string, any> }[],
        bg: { url: string | null, x: number, y: number, zoom: number, blur: number, brightness: number, contrast: number, saturation: number, linkBgToCamera?: boolean },
        cam: { x: number, y: number, scale: number, rotation: number },
        filters: Record<string, any>,
        lipKeys: LipSyncKeyframe[],
        globalVisemes: Record<VisemeShape, string | null>,
        settings: RenderSettings,
        globalScale: number,
        lights: LightSource[],
        ambient: number,
        anim: Record<string, any>,
        lipKeysMap?: Map<string, LipSyncKeyframe[]>,
        shadowConfig?: ShadowConfig,
        depthShadowConfig?: ShadowConfig,
        texts?: SceneText[]
    ) {
        const { width: w, height: h } = this.canvas;
        const ctx = this.ctx;

        ctx.setTransform(1, 0, 0, 1, 0, 0);
        if (settings.isTransparent) {
            ctx.clearRect(0, 0, w, h);
        } else {
            ctx.fillStyle = settings.color;
            ctx.fillRect(0, 0, w, h);
        }

        const camMat = new DOMMatrix();
        camMat.translateSelf(w/2, h/2);
        camMat.scaleSelf(globalScale, globalScale);
        camMat.translateSelf(cam.x, cam.y);
        camMat.rotateSelf(0, 0, cam.rotation);
        camMat.scaleSelf(cam.scale, cam.scale);

        // Background
        if (bg.url && this.imageCache.has(bg.url)) {
            const img = this.imageCache.get(bg.url)!;
            ctx.save();
            if (bg.linkBgToCamera) {
                ctx.setTransform(camMat);
            } else {
                const bgMat = new DOMMatrix();
                bgMat.translateSelf(w/2, h/2);
                bgMat.scaleSelf(globalScale, globalScale);
                ctx.setTransform(bgMat);
            }

            const z = bg.zoom !== undefined ? bg.zoom / 100 : 1;
            const bx = bg.x !== undefined ? bg.x : 50;
            const by = bg.y !== undefined ? bg.y : 50;
            
            const vw = w / globalScale;
            const vh = h / globalScale;
            
            // In App.tsx, CSS uses backgroundSize: '100%'. This equates to '100% auto'.
            let drawW = vw * z;
            let drawH = drawW / (img.width / img.height);
            
            let finalBgBrightness = bg.brightness;
            const activeLights = lights.filter(l => l.isActive);
            if (activeLights.length > 0) {
                finalBgBrightness = (bg.brightness / 100) * (ambient * 100);
            }

            let f = '';
            if (finalBgBrightness !== 100) f += `brightness(${finalBgBrightness}%) `;
            if (bg.contrast !== 100) f += `contrast(${bg.contrast}%) `;
            if (bg.saturation !== 100) f += `saturate(${bg.saturation}%) `;
            if (bg.blur > 0) f += `blur(${bg.blur}px) `;
            this.setCtxFilter(f || 'none');
            
            const tlX = (vw - drawW) * (bx / 100) - vw / 2;
            const tlY = (vh - drawH) * (by / 100) - vh / 2;

            ctx.drawImage(img, tlX, tlY, drawW, drawH);
            ctx.restore();
        }

        const drawLight = (l: LightSource) => {
            if (l.type === 'LIGHTNING') return;
            ctx.save();
            ctx.globalCompositeOperation = 'screen';
            let intensity = anim[`light:${l.id}:intensity`] ?? l.intensity;
            const softness = anim[`light:${l.id}:softness`] ?? l.softness;
            const lx = anim[`light:${l.id}:x`] ?? l.x;

            if (l.isBlinking) {
                const speed = l.blinkSpeed || 0.5;
                const duration = Math.max(0.1, 2.0 - speed * 1.2);
                const phase = (time % duration) / duration;
                if (phase >= 0.5) intensity = 0;
            }
            const ly = anim[`light:${l.id}:y`] ?? l.y;
            const radius = anim[`light:${l.id}:radius`] ?? l.radius;

            ctx.globalAlpha = Math.min(1, Math.max(0, intensity));
            let filterStr = "";
            if (softness > 0) filterStr = `blur(${softness}px)`;
            if (intensity > 1) {
                 filterStr = filterStr ? `${filterStr} brightness(${intensity * 100}%)` : `brightness(${intensity * 100}%)`;
            }
            this.setCtxFilter(filterStr || 'none');

            const isGlobalSun = l.type === 'SUN' && l.renderBehind;

            if (isGlobalSun) {
                ctx.fillStyle = l.color;
                ctx.beginPath();
                ctx.ellipse(0, 0, w, h, 0, 0, Math.PI * 2);
                ctx.fill();
            } else {
                const r = radius || 300;
                if (r > 0) {
                    const grad = ctx.createRadialGradient(lx, ly, 0, lx, ly, r);
                    
                    let r_v = 255, g_v = 255, b_v = 255;
                    if (l.color && l.color.startsWith('#')) {
                        const clean = l.color.replace('#', '');
                        if (clean.length === 3) {
                            r_v = parseInt(clean[0] + clean[0], 16);
                            g_v = parseInt(clean[1] + clean[1], 16);
                            b_v = parseInt(clean[2] + clean[2], 16);
                        } else if (clean.length === 6) {
                            r_v = parseInt(clean.substring(0, 2), 16);
                            g_v = parseInt(clean.substring(2, 4), 16);
                            b_v = parseInt(clean.substring(4, 6), 16);
                        }
                    }

                    grad.addColorStop(0, l.color); 
                    grad.addColorStop(0.2, l.color); 
                    grad.addColorStop(0.5, `rgba(${r_v}, ${g_v}, ${b_v}, 0.4)`);
                    grad.addColorStop(1, `rgba(${r_v}, ${g_v}, ${b_v}, 0)`);
                    
                    ctx.fillStyle = grad;
                    ctx.fillRect(lx - r, ly - r, r * 2, r * 2);
                }
            }
            ctx.restore();
        };

        const renderCharacter = (char: any, baseMat: DOMMatrix, shadowMode: boolean = false, sCfg?: ShadowConfig) => {
            const charKeys = lipKeysMap?.get(char.id) || lipKeys.filter(k => !k.targetId || k.targetId === char.id);
            if (!shadowMode) this.stepPhysics(char.id, time, charKeys);
            
            const vis = this.getInterpolatedViseme(time, charKeys);
            const phys = this.physicsStates.get(char.id)!;
            const vMap = char.visemeMap || globalVisemes;
            const charBoneTransforms = char.boneTransforms || {};

            const cFilters = filters[char.id] || { brightness: 100, contrast: 100, saturation: 100, eyeSquint: 0, pupilX: 0, pupilY: 0, exprState: 0 };
            const br = anim[`char:${char.id}:brightness`] ?? cFilters.brightness;
            const co = anim[`char:${char.id}:contrast`] ?? cFilters.contrast;
            const sa = anim[`char:${char.id}:saturation`] ?? cFilters.saturation;
            const squint = anim[`char:${char.id}:eyeSquint`] ?? cFilters.eyeSquint;
            const px = anim[`char:${char.id}:pupilX`] ?? cFilters.pupilX;
            const py = anim[`char:${char.id}:pupilY`] ?? cFilters.pupilY;
            const exprState = anim[`char:${char.id}:exprState`] ?? cFilters.exprState ?? 0;
            const headTurn = anim[`char:${char.id}:headTurn`] ?? cFilters.headTurn ?? 0;
            const sh = anim[`char:${char.id}:sharpness`] ?? cFilters.sharpness ?? 0;
            
            ctx.save();
            let finalMat = baseMat;
            if (shadowMode && sCfg) {
                finalMat = baseMat.translate(sCfg.offsetX, sCfg.offsetY).skewX(sCfg.skewX).scale(1, sCfg.scaleY);
                ctx.setTransform(finalMat);
                ctx.globalAlpha = sCfg.opacity;
                this.setCtxFilter(`brightness(0) blur(${sCfg.blur}px)`);
            } else {
                ctx.setTransform(finalMat);
                let filt = '';
                if (br !== 100) filt += `brightness(${br}%) `;
                if (co !== 100) filt += `contrast(${co}%) `;
                if (sa !== 100) filt += `saturate(${sa}%) `;
                if (sh > 0) filt += `drop-shadow(0px 0px ${Math.max(1, sh / 20)}px rgba(0,0,0,${Math.min(0.5, sh / 200)})) `;
                this.setCtxFilter(filt.trim() || 'none');
            }

            // Precompute z-indexes exactly like CharacterStage.tsx
            const computedZIndexMap = new Map<string, number>();
            let currentZ = 10000;
            const visited = new Set<string>();
            const traverseZ = (nodeId: string) => {
                if (visited.has(nodeId)) return;
                visited.add(nodeId);
                const p = char.composition[nodeId];
                if (!p) return;
                computedZIndexMap.set(nodeId, currentZ--);
                if (p.children) {
                    for (const childId of p.children) traverseZ(childId);
                }
            };
            traverseZ('root');

            const list = (Object.values(char.composition) as CharacterPart[])
                .filter(p => !p.tags.includes('Viseme'))
                .sort((a, b) => {
                    const zA = computedZIndexMap.get(a.id) ?? 0;
                    const zB = computedZIndexMap.get(b.id) ?? 0;
                    return zA - zB; // Ascending: highest z-index drawn last (on top)
                });
                
            const matrices = new Map<string, DOMMatrix>();
            
            // Generate flat visual matrices exactly matching CharacterStage DOM representation
            for (let i = 0; i < list.length; i++) {
                const id = list[i].id;
                const p = char.composition[id];
                if (!p) continue;
                
                const cw = p.width || 150;
                const ch = p.height || 150;
                const cAnchorX = p.transform.anchorX ?? 50;
                const cAnchorY = p.transform.anchorY ?? 50;
                
                const path = `part:${char.id}:${id}`;
                const tx = anim[`${path}:x`] ?? p.transform.x;
                const ty = anim[`${path}:y`] ?? p.transform.y;
                const tr = anim[`${path}:rotation`] ?? p.transform.rotation;
                
                const flipScaleX = p.transform.flipX ? -1 : 1;
                const flipScaleY = p.transform.flipY ? -1 : 1;
                let sx = (anim[`${path}:scaleX`] ?? p.transform.scaleX) * flipScaleX;
                let sy = (anim[`${path}:scaleY`] ?? p.transform.scaleY) * flipScaleY;
                
                const name = p.label.toLowerCase();
                const isPupil = name.includes('pupil') || p.tags.includes('Pupil') || name.includes('iris') || p.tags.includes('Iris');
                const isEyeOrPupil = isPupil || p.tags.includes('Eyelid') || name.includes('eyelid');

                let physSX = 1, physSY = 1;
                let physTY = 0;
                if (p.tags.includes('Mouth') && !p.tags.includes('Viseme')) { 
                     physSX = Math.max(0.1, phys.x); 
                     physSY = phys.y;
                     if (Math.abs(physSY) < 0.1) physSY = physSY < 0 ? -0.1 : 0.1;
                     physTY = phys.offY + phys.jiggleY; 
                     
                     if (exprState === 1) { // angry
                         physSY *= 0.8;
                         physSX *= 1.1;
                     } else if (exprState === 2) { // sad
                         physSY *= 0.85;
                         physSX *= 0.9;
                     } else if (exprState === 3) { // happy
                         physSY *= 1.1;
                         physSX *= 1.25;
                     } else if (exprState === 4) { // serious
                         physSY *= 0.8;
                         physSX *= 0.95;
                     }
                }
                
                let innerTY = 0;
                let innerSX = 1;
                let innerSY = 1;
                if (p.tags.includes('Mouth') && !p.tags.includes('Viseme')) {
                     innerTY = physTY;
                     innerSX = physSX;
                     innerSY = physSY;
                } else if (p.id === 'headGroup' && vis.intensity > 0.05) {
                     innerTY = vis.intensity * 3.0;
                }

                const pXScale = px / 100;
                const pYScale = py / 100;
                let finalTxFinal = tx;
                let finalTyFinal = ty;
                
                let pShiftX = 0;
                let pShiftY = 0;
                let pLocalScale = 1;
                if (isPupil) {
                    if (exprState === 1) { // angry: squint and glare slightly inwards and down
                        pShiftY = 4;
                        const labelLower = p.label.toLowerCase();
                        const parentLabel = p.parentId && char.composition[p.parentId] ? (char.composition[p.parentId].label || '').toLowerCase() : '';
                        const isRight = labelLower.includes('right') || labelLower.includes('_r') || labelLower.includes(' r ') || labelLower.endsWith(' r') || labelLower.includes('-r') || parentLabel.includes('right') || parentLabel.includes('_r');
                        const isLeft = !isRight && (labelLower.includes('left') || labelLower.includes('_l') || labelLower.includes(' l ') || labelLower.endsWith(' l') || labelLower.includes('-l') || parentLabel.includes('left') || parentLabel.includes('_l'));
                        pShiftX = isLeft ? 12 : -12;
                        pLocalScale = 0.85;
                    } else if (exprState === 2) { // sad: pleading upper shift
                        pShiftY = -5;
                        const labelLower = p.label.toLowerCase();
                        const parentLabel = p.parentId && char.composition[p.parentId] ? (char.composition[p.parentId].label || '').toLowerCase() : '';
                        const isRight = labelLower.includes('right') || labelLower.includes('_r') || labelLower.includes(' r ') || labelLower.endsWith(' r') || labelLower.includes('-r') || parentLabel.includes('right') || parentLabel.includes('_r');
                        const isLeft = !isRight && (labelLower.includes('left') || labelLower.includes('_l') || labelLower.includes(' l ') || labelLower.endsWith(' l') || labelLower.includes('-l') || parentLabel.includes('left') || parentLabel.includes('_l'));
                        pShiftX = isLeft ? -4 : 4;
                        pLocalScale = 1.1;
                    } else if (exprState === 3) { // happy
                        pLocalScale = 1.15;
                        pShiftY = -2;
                    } else if (exprState === 4) { // serious: stare forward centered
                        pShiftY = 2;
                        pLocalScale = 0.9;
                    }
                }
                
                const pLocalOffsetX = isPupil ? (pXScale + pShiftX / 100) * cw : 0;
                const pLocalOffsetY = isPupil ? (pYScale + pShiftY / 100) * ch : 0;
                const sq = isEyeOrPupil ? Math.max(0.01, 1 - (squint / 100)) : 1;
                
                let sxFinal = sx;
                let syFinal = sy * sq;

                if (isPupil) {
                    sxFinal *= (1 - Math.abs(pXScale) * 0.25) * pLocalScale;
                    syFinal *= (1 - Math.abs(pYScale) * 0.25) * pLocalScale;
                }
                
                let finalTr = tr;
                let headTurnDepth = 0;
                if (headTurn !== 0 && !p.isGroup) {
                    if (p.tags.includes('Nose') || name.includes('nose')) headTurnDepth = 0.35;
                    else if (p.tags.includes('Mouth') || name.includes('mouth') || p.tags.includes('Viseme')) headTurnDepth = 0.4;
                    else if (p.tags.includes('Pupil') || name.includes('pupil') || p.tags.includes('Iris') || name.includes('iris')) headTurnDepth = 0.3;
                    else if (p.tags.includes('Eyebrow') || name.includes('eyebrow')) headTurnDepth = 0.25;
                    else headTurnDepth = 0.0;
                }
                
                if (headTurnDepth !== 0) {
                    finalTxFinal += headTurn * 10 * headTurnDepth;
                    sxFinal *= (1 - Math.abs(headTurn) * 0.02);
                }
                
                if (name.includes('eyebrow') || p.tags.includes('Eyebrow')) {
                    const labelLower = p.label.toLowerCase();
                    const parentLabel = p.parentId && char.composition[p.parentId] ? (char.composition[p.parentId].label || '').toLowerCase() : '';
                    const isRight = labelLower.includes('right') || labelLower.includes('_r') || labelLower.includes(' r ') || labelLower.endsWith(' r') || labelLower.includes('-r') || parentLabel.includes('right') || parentLabel.includes('_r');
                    const isLeft = !isRight && (labelLower.includes('left') || labelLower.includes('_l') || labelLower.includes(' l ') || labelLower.endsWith(' l') || labelLower.includes('-l') || parentLabel.includes('left') || parentLabel.includes('_l'));
                    let rotMod = 0;
                    let yMod = 0;
                    if (exprState === 1) { // angry
                         rotMod = isLeft ? -15 : 15;
                         yMod = 3;
                    } else if (exprState === 2) { // sad
                         rotMod = isLeft ? 15 : -15;
                         yMod = -2;
                    } else if (exprState === 3) { // happy
                         rotMod = isLeft ? 5 : -5;
                         yMod = -4;
                    } else if (exprState === 4) { // serious
                         rotMod = isLeft ? -5 : 5;
                         yMod = 2;
                    }

                    // Auto eyebrow movement during lip sync (realistic bounce)
                    if (phys && phys.eyebrowInt > 0.05) {
                         const talkingLift = -phys.eyebrowInt * 6;
                         const talkingRot = isLeft ? -phys.eyebrowInt * 5 : phys.eyebrowInt * 5;
                         yMod += talkingLift;
                         rotMod += talkingRot;
                    }

                    finalTyFinal += yMod;
                    finalTr += rotMod;
                }
                
                // CharacterStage offsetX is exactly just part.transform.x (finalTxFinal)
                const offsetX = finalTxFinal;
                const offsetY = finalTyFinal;
                
                // Offset from Center to Anchor Point
                const originX = cw * (cAnchorX / 100 - 0.5);
                const originY = ch * (cAnchorY / 100 - 0.5);
                
                let world = DOMMatrix.fromMatrix(finalMat)
                     .translate(offsetX, offsetY)
                     .translate(originX, originY)
                     .rotate(finalTr)
                     .scale(sxFinal, syFinal)
                     .translate(-originX, -originY);
                     
                // Match HTML Stage nested inner transformations exactly
                if (innerTY !== 0 || innerSX !== 1 || innerSY !== 1) {
                     world = world.translate(0, innerTY).scale(innerSX, innerSY);
                }
                if (isPupil) {
                     world = world.translate(pLocalOffsetX, pLocalOffsetY);
                }
                     
                matrices.set(id, world);
            }

            // Extra override exactly replicating the CharacterStage static bypass for 'back hair' not in headGroup:
            for (let i = 0; i < list.length; i++) {
                const id = list[i].id;
                const p = char.composition[id];
                const isBackHair = checkIsBackHair(p, char.composition);
                if (isBackHair && p.parentId !== 'headGroup') {
                    const head = char.composition['headGroup'];
                    if (head) {
                        const hPath = `part:${char.id}:headGroup`;
                        const hx = anim[`${hPath}:x`] ?? head.transform.x;
                        const hy = anim[`${hPath}:y`] ?? head.transform.y;
                        const hr = anim[`${hPath}:rotation`] ?? head.transform.rotation;
                        let hsx = anim[`${hPath}:scaleX`] ?? head.transform.scaleX;
                        let hsy = anim[`${hPath}:scaleY`] ?? head.transform.scaleY;
                        
                        const headFlipX = head.transform.flipX ? -1 : 1;
                        const headFlipY = head.transform.flipY ? -1 : 1;
                        // Build head world matrix raw-styled
                        const hOriginX = (head.width || 150) * ((head.transform.anchorX ?? 50) / 100 - 0.5);
                        const hOriginY = (head.height || 150) * ((head.transform.anchorY ?? 50) / 100 - 0.5);
                        const headMat = DOMMatrix.fromMatrix(finalMat)
                            .translate(hx, hy)
                            .translate(hOriginX, hOriginY)
                            .rotate(hr)
                            .scale(hsx * headFlipX, hsy * headFlipY)
                            .translate(-hOriginX, -hOriginY);
                            
                        // Also get the animated variables for the back hair from the current timeline
                        const pMat = matrices.get(id);
                        if (pMat) {
                             const pPath = `part:${char.id}:${id}`;
                             const px = anim[`${pPath}:x`] ?? p.transform.x;
                             const py = anim[`${pPath}:y`] ?? p.transform.y;
                             const pr = anim[`${pPath}:rotation`] ?? p.transform.rotation;
                             const pSx = anim[`${pPath}:scaleX`] ?? p.transform.scaleX;
                             const pSy = anim[`${pPath}:scaleY`] ?? p.transform.scaleY;
                             
                             const localOffsetX = px - hx;
                             const localOffsetY = py - hy;
                             
                             const pCW = p.width || 150;
                             const pCH = p.height || 150;
                             const pOriginX = pCW * ((p.transform.anchorX ?? 50) / 100 - 0.5);
                             const pOriginY = pCH * ((p.transform.anchorY ?? 50) / 100 - 0.5);
                             
                             const flipScaleX = p.transform.flipX ? -1 : 1;
                             const flipScaleY = p.transform.flipY ? -1 : 1;
                             
                             const localMat = DOMMatrix.fromMatrix(headMat)
                                  .translate(localOffsetX, localOffsetY)
                                  .translate(pOriginX, pOriginY)
                                  .rotate(pr - hr)
                                  .scale(pSx * flipScaleX, pSy * flipScaleY)
                                  .translate(-pOriginX, -pOriginY);
                                  
                             matrices.set(id, localMat);
                        }
                    }
                }
            }

            const isLayerInVisibleView = (charComp: any, partId: string) => {
                let currentId: string | undefined = partId;
                while (currentId && currentId !== 'root') {
                    const curr = charComp[currentId];
                    if (!curr) break;
                    const isVis = (anim[`part:${char.id}:${curr.id}:isVisible`] ?? (curr.isVisible !== false ? 1 : 0)) >= 0.5;
                    const opac = anim[`part:${char.id}:${curr.id}:opacity`] ?? (curr.opacity !== undefined ? curr.opacity : 1);
                    const isViewNode = curr.tags?.includes('View') || curr.label?.toLowerCase().includes('view');
                    if (isViewNode && (!isVis || opac === 0)) return false;
                    currentId = curr.parentId;
                }
                return true;
            };

            if (!shadowMode) {
                const charBeforeLights = lights.filter(l => l.isActive && l.renderBehind && l.targetCharacterId === char.id && (!l.targetPartIds || l.targetPartIds.length === 0 || l.targetPartIds[0] === 'root'));
                if (charBeforeLights.length > 0) {
                    ctx.save();
                    ctx.setTransform(camMat);
                    charBeforeLights.forEach(drawLight);
                    ctx.restore();
                }
            }

            for (let k = 0; k < list.length; k++) {
                const p = list[k];
                
                if (!shadowMode) {
                    const pBeforeLights = lights.filter(l => l.isActive && l.renderBehind && l.targetCharacterId === char.id && l.targetPartIds?.includes(p.id));
                    if (pBeforeLights.length > 0) {
                        ctx.save();
                        ctx.setTransform(camMat);
                        pBeforeLights.forEach(drawLight);
                        ctx.restore();
                    }
                }

                const parentForLoop = p.parentId ? char.composition[p.parentId] : null;
                const isLoopChild = parentForLoop && (parentForLoop.tags.includes('Loop') || parentForLoop.label.toLowerCase().includes('loop')) && !(parentForLoop.children.length > 0 && parentForLoop.children.every(c => char.composition[c] && (char.composition[c].tags.includes('Loop') || char.composition[c].label.toLowerCase().includes('loop'))));

                if (!isLayerInVisibleView(char.composition, p.id)) continue;
                const pIsVis = (anim[`part:${char.id}:${p.id}:isVisible`] ?? (p.isVisible !== false ? 1 : 0)) >= 0.5;
                if (!pIsVis && !isLoopChild) continue;
                let m = matrices.get(p.id);
                if (!m) {
                    const tx = p.transform.x;
                    const ty = p.transform.y;
                    const tr = p.transform.rotation;
                    const sx = p.transform.scaleX;
                    const sy = p.transform.scaleY;
                    m = new DOMMatrix().translate(tx, ty).rotate(tr).scale(sx, sy);
                }
                
                let url = p.imageUrl;
                if (p.tags.includes('Mouth')) url = vMap[vis.shape] || vMap[VisemeShape.REST] || url;
                
                const path = `part:${char.id}:${p.id}`;
                let pOpacity: number | string = anim[`${path}:opacity`] ?? p.opacity ?? 1;

                const name = p.label.toLowerCase();
                const isPupil = name.includes('pupil') || p.tags.includes('Pupil');
                const isEyeOrPupil = name.includes('eye') || name.includes('pupil') || p.tags.includes('Eyeball') || name.includes('eyelid') || p.tags.includes('Eyelid');

                // Handle squint visibility
                if (isEyeOrPupil && squint >= 100) {
                    pOpacity = 0;
                }
                
                // Handle Auto Blink
                const isBlinkLayer = p.tags.includes('Blink') || name.includes('blink');
                if (isBlinkLayer) {
                    const blinkInterval = 4.0;
                    const blinkDuration = 0.15;
                    const t = time % blinkInterval;
                    if (t < blinkDuration) {
                        pOpacity = Math.sin((t / blinkDuration) * Math.PI);
                    } else {
                        pOpacity = 0;
                    }
                }
                
                // Handle Auto Loop Folder children
                if (p.parentId) {
                    const parent = char.composition[p.parentId];
                    if (parent && (parent.tags.includes('Loop') || parent.label.toLowerCase().includes('loop'))) {
                        const allChildrenAreLoops = parent.children.length > 0 && parent.children.every(c => char.composition[c] && (char.composition[c].tags.includes('Loop') || char.composition[c].label.toLowerCase().includes('loop')));
                        
                        if (!allChildrenAreLoops) {
                            const loopSpeed = anim[`part:${char.id}:${parent.id}:loopSpeed`] ?? parent.loopSpeed ?? anim[`part:${char.id}:${parent.id}:opacity`] ?? parent.opacity ?? 1;
                            const numSiblings = parent.children.length;
                            if (numSiblings > 0) {
                                const myIndex = parent.children.indexOf(p.id);
                                let activeIndex = 0;
                                
                                const isLoopActiveState = anim[`part:${char.id}:${parent.id}:isLoopActive`] ?? parent.isLoopActive;
                                if (isLoopActiveState !== false) {
                                    const fps = Math.max(1, 12 * loopSpeed);
                                    const cycle = numSiblings * 2;
                                    activeIndex = Math.floor(time * fps) % cycle;
                                    if (activeIndex >= numSiblings) {
                                        activeIndex = cycle - 1 - activeIndex;
                                    }
                                }
                                
                                if (myIndex !== activeIndex) {
                                    pOpacity = 0;
                                } else if (typeof pOpacity === 'number' && pOpacity === 1) { // Apply parent opacity to active frame
                                    pOpacity = p.opacity !== undefined ? p.opacity : 1; 
                                }
                            }
                        }
                    }
                }

                if (Number(pOpacity) <= 0) continue;

                const isMouth = p.tags.includes('Mouth');
                if ((!p.isGroup || isMouth) && url && this.imageCache.has(url)) {
                    const img = this.imageCache.get(url)!;
                    const pw = p.width || 150, ph = p.height || 150;
                    ctx.setTransform(m);
                    ctx.globalAlpha = shadowMode ? (sCfg?.opacity ?? 0.5) * Number(pOpacity) : Number(pOpacity);

                    let filterStr = "";
                    if (!shadowMode) {
                        let fBr = anim[`char:${char.id}:brightness`] ?? cFilters.brightness;
                        let fCo = anim[`char:${char.id}:contrast`] ?? cFilters.contrast;
                        let fSa = anim[`char:${char.id}:saturation`] ?? cFilters.saturation;

                        const path = `part:${char.id}:${p.id}`;
                        const partBr = anim[`${path}:brightness`] ?? p.filters?.brightness ?? 100;
                        const partCo = anim[`${path}:contrast`] ?? p.filters?.contrast ?? 100;
                        const partSa = anim[`${path}:saturation`] ?? p.filters?.saturation ?? 100;

                        fBr = (fBr / 100) * partBr;
                        fCo = (fCo / 100) * partCo;
                        fSa = (fSa / 100) * partSa;

                        if (fBr !== 100 || fCo !== 100 || fSa !== 100) {
                            filterStr = `brightness(${fBr}%) contrast(${fCo}%) saturate(${fSa}%)`;
                        }

                        // Eyeball / Pupil / Facial features precise tints based on expression
                        const lbl = p.label.toLowerCase();
                        const isEyeball = p.tags.includes('Eyeball') || lbl.includes('eyeball') || lbl.includes('sclera');
                        const isPupilIris = p.tags.includes('Pupil') || lbl.includes('pupil') || p.tags.includes('Iris') || lbl.includes('iris');
                        const isEyebrow = p.tags.includes('Eyebrow') || lbl.includes('eyebrow');
                        const isMouthPart = p.tags.includes('Mouth') || lbl.includes('mouth') || p.tags.includes('Viseme');

                        let exprFilt = '';
                        if (exprState === 1) { // Angry
                            if (isEyeball) {
                                exprFilt = `sepia(40%) saturate(220%) hue-rotate(320deg)`;
                            } else if (isPupilIris) {
                                exprFilt = `saturate(150%) brightness(95%)`;
                            } else if (isEyebrow || isMouthPart) {
                                exprFilt = `brightness(90%) contrast(110%)`;
                            }
                        } else if (exprState === 2) { // Sad
                            if (isEyeball) {
                                exprFilt = `sepia(30%) saturate(120%) hue-rotate(180deg) brightness(105%)`;
                            } else if (isPupilIris) {
                                exprFilt = `saturate(85%) hue-rotate(190deg) brightness(100%)`;
                            } else if (isEyebrow || isMouthPart) {
                                exprFilt = `brightness(95%) saturate(90%)`;
                            }
                        } else if (exprState === 3) { // Happy
                            if (isEyeball) {
                                exprFilt = `sepia(10%) saturate(110%) brightness(115%)`;
                            } else if (isPupilIris) {
                                exprFilt = `saturate(160%) brightness(110%)`;
                            } else if (isEyebrow || isMouthPart) {
                                exprFilt = `brightness(105%) saturate(120%)`;
                            }
                        } else if (exprState === 4) { // Serious
                             if (isEyeball) {
                                exprFilt = `contrast(110%) brightness(95%)`;
                            } else if (isPupilIris) {
                                exprFilt = `contrast(130%) saturate(100%)`;
                            }
                        }

                        if (exprFilt) {
                            filterStr = filterStr ? `${filterStr} ${exprFilt}` : exprFilt;
                        }
                        
                        const activeLights = lights.filter(l => l.isActive);
                        const actualAmbient = activeLights.length > 0 ? ambient : 1.0;
                        const ambStr = `brightness(${actualAmbient * 100}%) contrast(110%)`;
                        filterStr = filterStr ? `${filterStr} ${ambStr}` : ambStr;
                        
                        const sh = anim[`char:${char.id}:sharpness`] ?? cFilters.sharpness ?? 0;
                        if (sh > 0) {
                            filterStr += ` drop-shadow(0px 0px ${sh}px rgba(255,255,255,${sh/100}))`;
                        }
                    }

                    if (filterStr) this.setCtxFilter(filterStr);
                    else this.setCtxFilter('none');

                    if (p.bones && p.bones.length > 0) {
                        const bTransforms: Record<string, any> = {};
                        p.bones.forEach((b: Bone) => {
                            const key = `${p.id}|${b.id}`;
                            const animKey = `puppet:${char.id}:${p.id}:${b.id}`;
                            const rot = anim[`${animKey}:rotation`] ?? charBoneTransforms[key]?.rotation ?? 0;
                            const sx = anim[`${animKey}:scaleX`] ?? charBoneTransforms[key]?.scaleX ?? 1;
                            const sy = anim[`${animKey}:scaleY`] ?? charBoneTransforms[key]?.scaleY ?? 1;
                            bTransforms[b.id] = { rotation: rot, scaleX: sx, scaleY: sy };
                        });
                        ctx.save();
                        ctx.translate(-pw / 2, -ph / 2);
                        drawWarpedImage(ctx, img, pw, ph, p.bones, bTransforms, p.rigType || 'MESH');
                        ctx.restore();
                    } else {
                        ctx.drawImage(img, -pw / 2, -ph / 2, pw, ph);
                    }
                }
            }
            ctx.restore();
        };

        const globalBeforeLights = lights.filter(l => l.isActive && l.renderBehind && (!l.targetCharacterId || l.targetCharacterId === ""));
        if (globalBeforeLights.length > 0) {
            ctx.save();
            ctx.setTransform(camMat);
            globalBeforeLights.forEach(drawLight);
            ctx.restore();
        }

        for (let i = 0; i < chars.length; i++) {
            const char = chars[i];
            if (depthShadowConfig?.enabled) renderCharacter(char, camMat, true, depthShadowConfig);
            if (shadowConfig?.enabled) renderCharacter(char, camMat, true, shadowConfig);
            renderCharacter(char, camMat);
        }

        const activeForegroundLights = lights.filter(l => l.isActive && !l.renderBehind);
        if (activeForegroundLights.length > 0) {
            ctx.save();
            ctx.setTransform(camMat);
            activeForegroundLights.forEach(drawLight);
            ctx.restore();
        }

        // Global Lightning effect
        const lightningLights = lights.filter(l => l.isActive && l.type === 'LIGHTNING');
        
        if (lightningLights.length > 0) {
            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.globalCompositeOperation = 'screen';
            
            lightningLights.forEach(l => {
                let intensity = anim[`light:${l.id}:intensity`] ?? l.intensity;
                const softness = anim[`light:${l.id}:softness`] ?? l.softness;

                if (l.isBlinking) {
                    const speed = l.blinkSpeed || 0.5;
                    const duration = Math.max(0.1, 2.0 - speed * 1.2);
                    const phase = (time % duration) / duration;
                    if (phase >= 0.5) intensity = 0;
                }

                ctx.globalAlpha = Math.min(1, Math.max(0, intensity));
                if (softness > 0) ctx.filter = `blur(${softness}px)`;
                else ctx.filter = 'none';
                ctx.fillStyle = l.color;
                ctx.fillRect(0, 0, w, h);
            });
            ctx.restore();
            ctx.globalCompositeOperation = 'source-over';
        }

        // Draw Dynamic Scene Texts
        if (texts && texts.length > 0) {
            texts.forEach(t => {
                ctx.save();
                
                // 1. Get Style properties (similar to getTextStyle in App.tsx)
                let font = t.fontFamily || 'Inter, sans-serif';
                let color = t.color || '#ffffff';
                let borderColor = t.borderColor || '#000000';
                let borderWidth = t.borderWidth ?? 0;
                let textTransform = "none";

                if (t.styleTemplate === 'meme') {
                    font = 'Impact, Arial, sans-serif';
                    color = '#ffffff';
                    borderColor = '#000000';
                    borderWidth = 4;
                    textTransform = "uppercase";
                } else if (t.styleTemplate === 'subtitle') {
                    font = 'Arial, sans-serif';
                    color = '#ffff00';
                    borderColor = '#000000';
                    borderWidth = 2;
                } else if (t.styleTemplate === 'comic') {
                    font = '"Comic Sans MS", cursive, sans-serif';
                    color = '#000000';
                    borderColor = '#ffffff';
                    borderWidth = 3;
                }

                // 2. Align with camera coordinates or standard coordinate system
                ctx.setTransform(camMat);

                // Translate to text x, y coordinates
                ctx.translate(t.x, t.y);
                ctx.scale(t.scale, t.scale);
                ctx.rotate((t.rotation * Math.PI) / 180);

                // 3. Configure text style
                ctx.font = `bold ${t.fontSize}px ${font}`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                
                let textToDraw = t.text;
                if (textTransform === 'uppercase') {
                    textToDraw = textToDraw.toUpperCase();
                }

                const lines = textToDraw.split('\n');
                const lineHeight = t.fontSize * 1.2;
                const startY = -((lines.length - 1) * lineHeight) / 2;

                // 4. Draw stroke (border) and fill for each line
                lines.forEach((line, index) => {
                    const py = startY + index * lineHeight;
                    if (borderWidth > 0) {
                        ctx.strokeStyle = borderColor;
                        ctx.lineWidth = borderWidth * 2; // Outer stroke
                        ctx.lineJoin = 'round';
                        ctx.miterLimit = 2;
                        ctx.strokeText(line, 0, py);
                    }
                    ctx.fillStyle = color;
                    ctx.fillText(line, 0, py);
                });

                ctx.restore();
            });
        }
    }

    private setCtxFilter(f: string) {
        this.ctx.filter = f;
    }

    private getInterpolatedViseme(t: number, keys: LipSyncKeyframe[]) {
        if (keys.length === 0) return { shape: VisemeShape.REST, intensity: 0 };
        let l = 0, r = keys.length - 1, idx = 0;
        while (l <= r) { const m = (l + r) >>> 1; if (keys[m].time <= t) { idx = m; l = m + 1; } else r = m - 1; }
        const p = keys[idx], n = keys[idx + 1];
        if (!p || p.time > t) return { shape: VisemeShape.REST, intensity: 0 };
        if (!n) return { shape: p.shape, intensity: p.intensity };
        const pr = (t - p.time) / ((n.time - p.time) || 0.001);
        return { shape: p.shape, intensity: p.intensity + (n.intensity - p.intensity) * Math.max(0, Math.min(1, pr)) };
    }
}
