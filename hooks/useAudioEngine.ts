
import { useState, useEffect, useRef, useCallback } from 'react';
import { TrackState, AudioContextState, VisemeShape, AudioSegment } from '../types';
import { analyzeViseme, resetAnalysis } from '../utils/audioUtils';
import { COLORS } from '../constants';
import { editAudioBuffer, appendAudioBuffer, EditOperation } from '../utils/editAudio';

export const useAudioEngine = () => {
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const pitchShiftNodeRef = useRef<AudioWorkletNode | null>(null);
  
  // Gains
  const vocalGainRef = useRef<GainNode | null>(null);
  const instGainRef = useRef<GainNode | null>(null);
  const vocalPitchNodeRef = useRef<AudioWorkletNode | null>(null);
  const instPitchNodeRef = useRef<AudioWorkletNode | null>(null);

  // Sources
  const vocalSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const instSourceRef = useRef<AudioBufferSourceNode | null>(null);

  // Ref to hold the latest play function to avoid stale closures in seek
  const playRef = useRef<() => void>(() => {});

  // --- PREDICTIVE ENGINE CONFIG ---
  // Adjusted to 40ms (approx 2.5 frames at 60fps) to sample "Frame X + 2"
  const LOOKAHEAD_DELAY = 0.04; 
  
  // --- PERFORMANCE CONFIG ---
  const UI_UPDATE_INTERVAL_MS = 33; // ~30fps for React State updates (optimized to prevent lag)

  // State
  const [vocalTrack, setVocalTrack] = useState<TrackState>({
    id: 'vocal', name: 'Vocal Track', buffer: null, segments: [], gain: 0.8, muted: false, pitch: 1.0, speed: 1.0, color: COLORS.VOCAL_WAVE, visemes: []
  });
  const [instTrack, setInstTrack] = useState<TrackState>({
    id: 'inst', name: 'Instrumental', buffer: null, segments: [], gain: 0.6, muted: false, pitch: 1.0, speed: 1.0, color: COLORS.INST_WAVE, visemes: []
  });

  const [playbackState, setPlaybackState] = useState<AudioContextState>({
    isPlaying: false, currentTime: 0, duration: 5, playbackRate: 1
  });

  const [currentViseme, setCurrentViseme] = useState<{ 
      shape: VisemeShape, intensity: number, openness: number, spread: number, squeeze: number, spectralFlux: number, plosiveScore: number
  }>({
    shape: VisemeShape.REST, intensity: 0, openness: 0, spread: 0, squeeze: 1, spectralFlux: 0, plosiveScore: 0
  });

  const [isLocalMuted, setIsLocalMuted] = useState(false);

  // --- TRIM / CROP STATE ---
  const trimRangeRef = useRef({ start: 0, end: Infinity });

  const playbackStartTimeRef = useRef<number>(0);
  const pauseTimeRef = useRef<number>(0);
  const animationFrameRef = useRef<number>(0);
  const isPlayingRef = useRef<boolean>(false);
  const isResumingRef = useRef<boolean>(false);
  const lastUiUpdateRef = useRef<number>(0);
  
  // Looping State Ref (to access in animation loop without re-binding)
  const loopStateRef = useRef({ isLooping: false, loopStart: 0, loopEnd: 0 });
  
  // Explicit Project Duration (Max of Audio or Keyframes, controlled by App)
  const projectDurationRef = useRef<number>(5.0);

  const ensureAudioContext = useCallback(async () => {
    if (audioContextRef.current) {
        if (audioContextRef.current.state === 'suspended') {
            try { await audioContextRef.current.resume(); } catch (e) {}
        }
        return audioContextRef.current;
    }

    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new AudioContextClass();
    audioContextRef.current = ctx;
    
    try {
        await ctx.audioWorklet.addModule('/pitch-shift-processor.js');
        pitchShiftNodeRef.current = new AudioWorkletNode(ctx, 'pitch-shift-processor');
    } catch (e) {
        console.warn("AudioWorklet not available", e);
    }

    // MASTER OUT
    const master = ctx.createGain();
    const compressor = ctx.createDynamicsCompressor();
    
    compressor.threshold.setValueAtTime(-24, ctx.currentTime);
    compressor.knee.setValueAtTime(30, ctx.currentTime);
    compressor.ratio.setValueAtTime(12, ctx.currentTime);
    compressor.attack.setValueAtTime(0.003, ctx.currentTime);
    compressor.release.setValueAtTime(0.25, ctx.currentTime);

    master.connect(compressor);
    compressor.connect(ctx.destination);
    masterGainRef.current = master;

    // --- THE TIME MACHINE (Look-ahead Pipeline) ---
    const delayNode = ctx.createDelay(1.0);
    delayNode.delayTime.value = LOOKAHEAD_DELAY; 
    delayNode.connect(master);

    // Analyzer
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.5; 
    analyserRef.current = analyser;

    const pitchNode = pitchShiftNodeRef.current;
    const vGain = ctx.createGain();
    const iGain = ctx.createGain();

    if (pitchNode) {
        try {
            const pitchVocal = new AudioWorkletNode(ctx, 'pitch-shift-processor');
            const pitchInst = new AudioWorkletNode(ctx, 'pitch-shift-processor');
            
            vocalPitchNodeRef.current = pitchVocal;
            instPitchNodeRef.current = pitchInst;
              
              vGain.connect(pitchVocal);
              pitchVocal.connect(delayNode);
              pitchVocal.connect(analyser);
              
              iGain.connect(pitchInst);
              pitchInst.connect(delayNode);
        } catch (e) {
            console.warn("AudioWorkletNode creation failed inside if (pitchNode)", e);
            vGain.connect(delayNode);
            vGain.connect(analyser);
            iGain.connect(delayNode);
        }
    } else {
          vGain.connect(delayNode);
          vGain.connect(analyser);
          iGain.connect(delayNode);
    }
    
    vocalGainRef.current = vGain;
    instGainRef.current = iGain;

    // Apply immediate volume states
    masterGainRef.current.gain.value = isLocalMuted ? 0 : 1.0;
    vGain.gain.value = vocalTrack.muted ? 0 : vocalTrack.gain;
    iGain.gain.value = instTrack.muted ? 0 : instTrack.gain;

    return ctx;
  }, [isLocalMuted, vocalTrack.muted, vocalTrack.gain, instTrack.muted, instTrack.gain]);

  useEffect(() => {
    return () => { 
        if (audioContextRef.current) audioContextRef.current.close(); 
        cancelAnimationFrame(animationFrameRef.current); 
    };
  }, []);

  // Handle Local Mute
  useEffect(() => {
      if (masterGainRef.current && audioContextRef.current) {
          masterGainRef.current.gain.setTargetAtTime(isLocalMuted ? 0 : 1.0, audioContextRef.current.currentTime, 0.05);
      }
  }, [isLocalMuted]);

  // Update Gains
  useEffect(() => {
    if (vocalGainRef.current && audioContextRef.current) {
        vocalGainRef.current.gain.setTargetAtTime(vocalTrack.muted ? 0 : vocalTrack.gain, audioContextRef.current.currentTime, 0.05);
    }
  }, [vocalTrack.gain, vocalTrack.muted]);

  useEffect(() => {
    if (instGainRef.current && audioContextRef.current) {
        instGainRef.current.gain.setTargetAtTime(instTrack.muted ? 0 : instTrack.gain, audioContextRef.current.currentTime, 0.05);
    }
  }, [instTrack.gain, instTrack.muted]);

  // Update Pitch
  useEffect(() => {
    if (vocalPitchNodeRef.current && audioContextRef.current) {
        const param = vocalPitchNodeRef.current.parameters.get('pitch');
        if (param) param.setTargetAtTime(vocalTrack.pitch, audioContextRef.current.currentTime, 0.05);
    }
  }, [vocalTrack.pitch]);

  useEffect(() => {
    if (instPitchNodeRef.current && audioContextRef.current) {
        const param = instPitchNodeRef.current.parameters.get('pitch');
        if (param) param.setTargetAtTime(instTrack.pitch, audioContextRef.current.currentTime, 0.05);
    }
  }, [instTrack.pitch]);

  // Update Speed
  useEffect(() => {
    if (vocalSourceRef.current && audioContextRef.current) {
        vocalSourceRef.current.playbackRate.setTargetAtTime(vocalTrack.speed ?? 1.0, audioContextRef.current.currentTime, 0.05);
    }
  }, [vocalTrack.speed]);

  useEffect(() => {
    if (instSourceRef.current && audioContextRef.current) {
        instSourceRef.current.playbackRate.setTargetAtTime(instTrack.speed ?? 1.0, audioContextRef.current.currentTime, 0.05);
    }
  }, [instTrack.speed]);

  const loadTrack = useCallback(async (file: File, type: 'vocal' | 'inst') => {
    const ctx = await ensureAudioContext();
    if (!ctx) return;
    try {
        const buffer = await file.arrayBuffer();
        const decoded = await ctx.decodeAudioData(buffer);
        
        const newSegment: AudioSegment = {
            id: Math.random().toString(36).substr(2, 9),
            buffer: decoded,
            startPosition: 0,
            clipStart: 0,
            duration: decoded.duration
        };
        
        if (type === 'vocal') {
            setVocalTrack(prev => {
                const newBuffer = prev.buffer ? appendAudioBuffer(ctx, prev.buffer, decoded) : decoded;
                return { 
                    ...prev, 
                    name: prev.buffer ? `${prev.name} + ${file.name}` : file.name, 
                    buffer: newBuffer,
                    segments: [...prev.segments, newSegment] 
                };
            });
        }
        else {
            setInstTrack(prev => {
                const newBuffer = prev.buffer ? appendAudioBuffer(ctx, prev.buffer, decoded) : decoded;
                return { 
                    ...prev, 
                    name: prev.buffer ? `${prev.name} + ${file.name}` : file.name, 
                    buffer: newBuffer,
                    segments: [...prev.segments, newSegment] 
                };
            });
        }
    } catch (err) { console.error("Failed to load track", err); }
  }, [ensureAudioContext]);

  const stopSources = () => {
      if (vocalSourceRef.current) { try { vocalSourceRef.current.stop(); } catch(e){} vocalSourceRef.current = null; }
      if (instSourceRef.current) { try { instSourceRef.current.stop(); } catch(e){} instSourceRef.current = null; }
  };

  const stop = useCallback(() => {
      if (!audioContextRef.current) return;
      stopSources();
      
      const { isLooping, loopStart } = loopStateRef.current;
      const targetTime = isLooping ? loopStart : 0;
      
      pauseTimeRef.current = targetTime; 
      isPlayingRef.current = false;
      setPlaybackState(prev => ({ ...prev, isPlaying: false, currentTime: targetTime }));
      cancelAnimationFrame(animationFrameRef.current);
      
      resetAnalysis(); // Clear spectral history
      setCurrentViseme({ shape: VisemeShape.REST, intensity: 0, openness: 0, spread: 0, squeeze: 1, spectralFlux: 0, plosiveScore: 0 });
  }, []);

  const pause = useCallback(() => {
      
      if (!audioContextRef.current || !isPlayingRef.current) {
          
          return;
      }
      stopSources();
      pauseTimeRef.current = (performance.now() - playbackStartTimeRef.current) / 1000;
      
      isPlayingRef.current = false;
      setPlaybackState(prev => ({ ...prev, isPlaying: false }));
      cancelAnimationFrame(animationFrameRef.current);
      
      resetAnalysis(); // Clear spectral history
      setCurrentViseme({ shape: VisemeShape.REST, intensity: 0, openness: 0, spread: 0, squeeze: 1, spectralFlux: 0, plosiveScore: 0 });
  }, []);

  const seek = useCallback((time: number) => {
      const wasPlaying = isPlayingRef.current;
      if (wasPlaying) pause(); 
      
      pauseTimeRef.current = time;
      setPlaybackState(prev => ({ ...prev, currentTime: time }));
      
      resetAnalysis(); // Reset debounce logic on seek
      
      if (wasPlaying) playRef.current(); 
  }, [pause]);

  const editTrackBuffer = useCallback((trackId: 'vocal' | 'inst', start: number, end: number, operation: EditOperation) => {
      if (!audioContextRef.current) return;
      
      const track = trackId === 'vocal' ? vocalTrack : instTrack;
      if (!track.buffer) return;

      const newBuffer = editAudioBuffer(audioContextRef.current, track.buffer, start, end, operation);
      
      if (trackId === 'vocal') {
          setVocalTrack(prev => ({ ...prev, buffer: newBuffer }));
      } else {
          setInstTrack(prev => ({ ...prev, buffer: newBuffer }));
      }
      seek(0);
  }, [vocalTrack, instTrack, seek]);

  const sliceTrack = useCallback((trackId: 'vocal' | 'inst', time: number, keep: 'LEFT' | 'RIGHT') => {
      if (!audioContextRef.current) return;
      const track = trackId === 'vocal' ? vocalTrack : instTrack;
      if (!track.buffer) return;
      
      const duration = track.buffer.duration;
      if (time <= 0 || time >= duration) return;

      const normalizedTime = time / duration;
      const start = keep === 'LEFT' ? 0 : normalizedTime;
      const end = keep === 'LEFT' ? normalizedTime : 1;
      
      const newBuffer = editAudioBuffer(audioContextRef.current, track.buffer, start, end, 'CROP');
      
      if (trackId === 'vocal') {
          setVocalTrack(prev => ({ ...prev, buffer: newBuffer }));
      } else {
          setInstTrack(prev => ({ ...prev, buffer: newBuffer }));
      }
      seek(0);
  }, [vocalTrack, instTrack, seek]);

  const setTrimRange = useCallback((start: number, end: number) => {
      trimRangeRef.current = { start, end };
  }, []);

  const play = useCallback(async () => {
      
      if (isResumingRef.current) {
          
          return;
      }
      const ctx = await ensureAudioContext();
      if (!ctx) {
          console.error('Audio Context not initialized');
          return;
      }
      
      if (ctx.state === 'suspended') {
          
          isResumingRef.current = true;
          try {
              await ctx.resume();
              
          } catch (e) {
              console.warn("AudioContext resume failed:", e);
          } finally {
              isResumingRef.current = false;
          }
      }
      if (isPlayingRef.current) {
          
          return;
      }

      resetAnalysis(); // Ensure we start with a clean slate

      const { isLooping, loopStart, loopEnd } = loopStateRef.current;

      if (isLooping) {
          if (pauseTimeRef.current < loopStart) {
              pauseTimeRef.current = loopStart;
          }
          if (pauseTimeRef.current >= loopEnd) {
              pauseTimeRef.current = loopStart;
          }
      }

      const offset = pauseTimeRef.current;
      
      playbackStartTimeRef.current = performance.now() - (offset * 1000);

      if (vocalTrack.buffer && vocalGainRef.current) {
          
          const src = audioContextRef.current.createBufferSource();
          src.buffer = vocalTrack.buffer;
          src.playbackRate.value = vocalTrack.speed;
          src.connect(vocalGainRef.current);
          src.start(0, offset);
          vocalSourceRef.current = src;
      } else {
          
      }

      if (instTrack.buffer && instGainRef.current) {
          
          const src = audioContextRef.current.createBufferSource();
          src.buffer = instTrack.buffer;
          src.playbackRate.value = instTrack.speed;
          src.connect(instGainRef.current);
          src.start(0, offset);
          instSourceRef.current = src;
      } else {
          
      }

      isPlayingRef.current = true;
      setPlaybackState(prev => ({ ...prev, isPlaying: true }));
      
      
      const loop = () => {
          if (!isPlayingRef.current || !audioContextRef.current) {
              
              return;
          }
          
          const current = Math.max(0, (performance.now() - playbackStartTimeRef.current) / 1000);
          
          const now = performance.now();
          const shouldUpdateUI = now - lastUiUpdateRef.current > UI_UPDATE_INTERVAL_MS;

          const limit = projectDurationRef.current;
          const { isLooping, loopStart, loopEnd } = loopStateRef.current;
          
          if (isLooping) {
              const effectiveEnd = loopEnd > 0 ? loopEnd : limit;
              if (current >= effectiveEnd) {
                  
                  seek(Math.max(loopStart, 0));
                  return;
              }
          } else {
              if (current >= limit) { 
                  
                  stopSources();
                  isPlayingRef.current = false;
                  pauseTimeRef.current = limit;
                  setPlaybackState(prev => ({ ...prev, currentTime: limit, isPlaying: false }));
                  cancelAnimationFrame(animationFrameRef.current);
                  return; 
              }
          }

          if (shouldUpdateUI) {
              setPlaybackState(prev => ({ ...prev, currentTime: current }));
              lastUiUpdateRef.current = now;
          }

          if (analyserRef.current) {
              const fftBinCount = analyserRef.current.frequencyBinCount;
              const freqData = new Uint8Array(fftBinCount);
              const timeData = new Uint8Array(fftBinCount);
              
              analyserRef.current.getByteFrequencyData(freqData);
              analyserRef.current.getByteTimeDomainData(timeData);
              
              const result = analyzeViseme(freqData, timeData, audioContextRef.current.sampleRate, analyserRef.current.fftSize);
              
              if (shouldUpdateUI) {
                  setCurrentViseme({ 
                      shape: result.shape, 
                      intensity: result.intensity,
                      openness: result.openness,
                      spread: result.spread,
                      squeeze: result.squeeze,
                      spectralFlux: result.spectralFlux,
                      plosiveScore: result.plosiveScore
                  });
              }
          }
          animationFrameRef.current = requestAnimationFrame(loop);
      };
      loop();
  }, [vocalTrack, instTrack, seek]);

  useEffect(() => {
      playRef.current = play;
  }, [play]);

  const setLoopState = useCallback((isLooping: boolean, start: number, end: number) => {
      loopStateRef.current = { isLooping, loopStart: start, loopEnd: end };
  }, []);

  const setTotalDuration = useCallback((duration: number) => {
      setPlaybackState(prev => {
          if (prev.duration === duration) return prev;
          projectDurationRef.current = duration;
          return { ...prev, duration };
      });
  }, []);

  const getMixedAudioStream = useCallback(() => {
      if (!audioContextRef.current || !masterGainRef.current) return null;
      const dest = audioContextRef.current.createMediaStreamDestination();
      masterGainRef.current.connect(dest);
      return dest.stream;
  }, []);

  const loadTrackFromBase64 = useCallback(async (base64: string, type: 'vocal' | 'inst') => {
      const ctx = await ensureAudioContext();
      if (!ctx) return;
      try {
          let arrayBuffer: ArrayBuffer;
          if (base64.startsWith('data:')) {
              const base64Data = base64.includes(',') ? base64.split(',')[1] : base64;
              const binaryStr = atob(base64Data);
              const len = binaryStr.length;
              const bytes = new Uint8Array(len);
              for (let i = 0; i < len; i++) {
                  bytes[i] = binaryStr.charCodeAt(i);
              }
              arrayBuffer = bytes.buffer;
          } else {
              // Fallback for normal URLs or blob URLs if any somehow ended up here
              const response = await fetch(base64);
              arrayBuffer = await response.arrayBuffer();
          }
          
          const decoded = await ctx.decodeAudioData(arrayBuffer);
          
          if (type === 'vocal') {
              setVocalTrack(prev => ({ ...prev, buffer: decoded }));
          } else {
              setInstTrack(prev => ({ ...prev, buffer: decoded }));
          }
      } catch(e) {
          console.error("Failed to load track from base64", e);
      }
  }, [ensureAudioContext]);

  return {
    playbackState,
    vocalTrack, setVocalTrack,
    instTrack, setInstTrack,
    currentViseme,
    loadTrack, loadTrackFromBase64, play, pause, stop, seek,
    setLoopState,
    setTotalDuration, 
    setTrimRange, 
    editTrackBuffer,
    sliceTrack,
    getMixedAudioStream,
    setIsLocalMuted,
    isLocalMuted,
    audioContextRef
  };
};
