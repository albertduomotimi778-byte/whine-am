import React, { useState, useEffect, useRef } from 'react';
import gameData from './game-data.json';

// Global shared AudioContext to handle gameplay audio and escape browser autoplay constraints
let globalAudioCtx: any = null;
const decodedBufferCache: Record<string, AudioBuffer> = {};

const getSharedAudioContext = (): AudioContext => {
  if (typeof window === 'undefined') return null as any;
  if (!globalAudioCtx) {
    globalAudioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  if (globalAudioCtx.state === 'suspended') {
    globalAudioCtx.resume().catch(() => {});
  }
  return globalAudioCtx;
};

const playSoundWithSharedContext = async (audioSrc: string) => {
  if (!audioSrc) return;
  try {
    const ctx = getSharedAudioContext();
    if (!ctx) return;

    if (decodedBufferCache[audioSrc]) {
      const source = ctx.createBufferSource();
      source.buffer = decodedBufferCache[audioSrc];
      source.connect(ctx.destination);
      source.start(0);
      return;
    }

    const response = await fetch(audioSrc);
    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    decodedBufferCache[audioSrc] = audioBuffer;

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);
    source.start(0);
  } catch (err) {
    console.warn("Audio playback failed:", err);
    try {
      const audio = new Audio(audioSrc);
      audio.play().catch(() => {});
    } catch (e) {}
  }
};

export default function GameRunner() {
  const [activeSceneId, setActiveSceneId] = useState(gameData.activeSceneId || 'scene_1');
  const [stageElements, setStageElements] = useState([]);
  const [windowSize, setWindowSize] = useState({ width: typeof window !== 'undefined' ? window.innerWidth : 640, height: typeof window !== 'undefined' ? window.innerHeight : 360 });
  const [showRotationPrompt, setShowRotationPrompt] = useState(false);

  const aspectRatio = gameData.aspectRatio || 'landscape';
  const VIRTUAL_WIDTH = aspectRatio === 'landscape' ? 640 : 360;
  const VIRTUAL_HEIGHT = aspectRatio === 'landscape' ? 360 : 640;

  useEffect(() => {
    const handleResize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      setWindowSize({ width: w, height: h });
      if (aspectRatio === 'landscape' && w < h) setShowRotationPrompt(true);
      else if (aspectRatio === 'portrait' && w > h) setShowRotationPrompt(true);
      else setShowRotationPrompt(false);
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [aspectRatio]);

  const scale = Math.min(windowSize.width / VIRTUAL_WIDTH, windowSize.height / VIRTUAL_HEIGHT);
  const stageElementsRef = useRef(stageElements);
  useEffect(() => { stageElementsRef.current = stageElements; }, [stageElements]);

  useEffect(() => {
    const sceneEls = (gameData.sceneElements && gameData.sceneElements[activeSceneId]) || [];
    setStageElements(sceneEls);
  }, [activeSceneId]);

  const executeAction = (act) => {
    switch (act.type) {
      case 'goto_scene':
        if (act.target && (gameData.scenes || []).some(s => s.id === act.target)) {
          setActiveSceneId(act.target);
        }
        break;
      case 'change_opacity':
        if (act.target) {
          const val = Number(act.value ?? 50) / 100;
          setStageElements(prev => prev.map(el => (el.id === act.target || el.data === act.target || el.buttonId === act.target) ? { ...el, opacity: val } : el));
        }
        break;
      case 'destroy':
        if (act.target) {
          setStageElements(prev => prev.filter(el => el.id !== act.target && el.data !== act.target && el.buttonId !== act.target));
        }
        break;
      case 'play_sound':
        if (act.value) {
          const sound = (gameData.projectSounds || []).find(s => s.id === act.value || s.name === act.value);
          const audioSrc = sound?.url || sound?.dataUrl || act.value;
          if (audioSrc) {
            playSoundWithSharedContext(audioSrc);
          }
        }
        break;
      case 'play_animation':
        if (act.target) {
          const videoId = act.target;
          const fitToScreen = act.fitToScreen || false;
          const existing = stageElementsRef.current.find(el => el.type === 'video' && el.videoId === videoId);
          if (existing) {
            const elVid = document.getElementById(`video_player_${existing.id}`) as HTMLVideoElement;
            if (elVid) { elVid.currentTime = 0; elVid.play().catch(() => {}); }
          } else {
            const elId = `vid_${Date.now()}`;
            setStageElements(prev => [...prev, { id: elId, type: 'video', videoId, fitToScreen, x: fitToScreen ? 0 : 100, y: fitToScreen ? 0 : 50, width: fitToScreen ? VIRTUAL_WIDTH : 300, height: fitToScreen ? VIRTUAL_HEIGHT : 200, layerId: '' }]);
            setTimeout(() => {
              const elVid = document.getElementById(`video_player_${elId}`) as HTMLVideoElement;
              if (elVid) { elVid.currentTime = 0; elVid.play().catch(() => {}); }
            }, 100);
          }
        }
        break;
      case 'stop_animation':
        if (act.target) {
          const existing = stageElementsRef.current.find(el => el.type === 'video' && el.videoId === act.target);
          if (existing) {
            const elVid = document.getElementById(`video_player_${existing.id}`) as HTMLVideoElement;
            if (elVid) elVid.pause();
          }
        }
        break;
      case 'remove_animation':
        if (act.target) {
          setStageElements(prev => prev.filter(el => !(el.type === 'video' && el.videoId === act.target)));
        }
        break;
      case 'move_to':
        if (act.target) {
          setStageElements(prev => prev.map(el => (el.id === act.target || el.data === act.target || el.buttonId === act.target) ? { ...el, x: Number(act.x ?? 100), y: Number(act.y ?? 100) } : el));
        }
        break;
      case 'rotate':
        if (act.target) {
          setStageElements(prev => prev.map(el => (el.id === act.target || el.data === act.target || el.buttonId === act.target) ? { ...el, rotation: (el.rotation || 0) + Number(act.value ?? 15) } : el));
        }
        break;
      case 'show_text':
        if (act.value) {
          const toastId = `toast_${Date.now()}`;
          setStageElements(prev => [...prev, { id: toastId, type: 'btn', x: 220, y: 150, width: 200, height: 40, isToast: true, text: act.value }]);
          setTimeout(() => setStageElements(prev => prev.filter(el => el.id !== toastId)), 3000);
        }
        break;
      case 'move_straight':
      case 'move_zigzag':
        if (act.target) {
          setStageElements(prev => prev.map(el => (el.id === act.target || el.data === act.target || el.buttonId === act.target) ? { ...el, x: el.x + 80, y: el.y + (act.type === 'move_zigzag' ? 30 : 0) } : el));
        }
        break;
      case 'change_animation':
        if (act.target && act.value !== undefined) {
          setStageElements(prev => prev.map(el => (el.id === act.target || el.data === act.target || el.buttonId === act.target) ? { ...el, activeAnimationIndex: Number(act.value) } : el));
        }
        break;
    }
  };

  const lastTapRef = useRef({ time: 0, target: '' });
  const handleButtonClick = (buttonId) => {
    const now = Date.now();
    const isDoubleTap = now - lastTapRef.current.time < 300 && lastTapRef.current.target === buttonId;
    lastTapRef.current = { time: now, target: buttonId };

    const btnEl = stageElementsRef.current.find(e => e.id === buttonId);
    const sceneEvents = (gameData.sceneEvents && gameData.sceneEvents[activeSceneId]) || [];
    sceneEvents.forEach(ev => {
      const isPressed = ev.conditions?.some(cond => {
        if (cond.target !== buttonId && cond.target !== btnEl?.buttonId && cond.target !== btnEl?.data) return false;
        if (isDoubleTap && cond.type === 'double_tap') return true;
        return cond.type === 'click' || cond.type === 'pressed';
      });
      if (isPressed) ev.actions?.forEach(act => executeAction(act));
    });
  };

  useEffect(() => {
    const sceneEvents = (gameData.sceneEvents && gameData.sceneEvents[activeSceneId]) || [];
    sceneEvents.forEach(ev => {
      if (ev.conditions?.some(cond => cond.type === 'scene_start')) ev.actions?.forEach(act => executeAction(act));
    });
    const interval = setInterval(() => {
      sceneEvents.forEach(ev => {
        const allMet = ev.conditions?.every(cond => {
          if (cond.type === 'collision') {
            const el1 = stageElementsRef.current.find(el => el.id === cond.target || el.data === cond.target);
            const el2 = stageElementsRef.current.find(el => el.id === cond.target2 || el.data === cond.target2);
            if (!el1 || !el2) return false;
            return !(el1.x + el1.width < el2.x || el2.x + el2.width < el1.x || el1.y + el1.height < el2.y || el2.y + el2.height < el1.y);
          }
          return false;
        });
        if (allMet && ev.conditions?.some(c => c.type === 'collision')) ev.actions?.forEach(act => executeAction(act));
      });
    }, 200);
    return () => clearInterval(interval);
  }, [activeSceneId]);

  return (
    <div style={{ backgroundColor: '#000', width: '100vw', height: '100vh', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {gameData.customCSS && <style>{gameData.customCSS}</style>}
      <div style={{ position: 'relative', width: `${VIRTUAL_WIDTH}px`, height: `${VIRTUAL_HEIGHT}px`, transform: `scale(${scale})`, backgroundColor: gameData.stageBgColor || '#000', overflow: 'hidden' }}>
        {stageElements.map((el, i) => {
          const isInteractive = el.type === 'btn' || el.type === 'obj';
          const gameObject = (gameData.gameObjects || []).find(g => g.id === el.data);
          const bgUrl = el.url || gameObject?.url || gameObject?.animations?.[el.activeAnimationIndex || 0] || gameObject?.animations?.[0] || el.data;
          return (
            <div key={el.id || i} onClick={(e) => { if (isInteractive) { e.stopPropagation(); handleButtonClick(el.id); } }} style={{ position: 'absolute', left: el.type === 'bg' ? 0 : el.x, top: el.type === 'bg' ? 0 : el.y, width: el.type === 'bg' ? '100%' : el.width, height: el.type === 'bg' ? '100%' : el.height, backgroundImage: (el.type !== 'video' && bgUrl) ? `url(${bgUrl})` : undefined, backgroundSize: '100% 100%', opacity: el.opacity ?? 1, transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined, zIndex: el.type === 'bg' ? 0 : 10, cursor: isInteractive ? 'pointer' : 'default' }}>
              {el.type === 'btn' && <button style={{ width: '100%', height: '100%', background: 'transparent', border: 'none', color: 'white', fontWeight: 'bold' }}>{el.text}</button>}
              {el.type === 'video' && <video id={`video_player_${el.id}`} src={(gameData.projectVideos || []).find(v => v.id === el.videoId)?.url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} playsInline />}
            </div>
          );
        })}
      </div>
    </div>
  );
}