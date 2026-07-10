import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { blobUrlToBase64 } from './storage';
import { get as getIDB } from 'idb-keyval';

export const processGameDataAssets = async (gameData: any, zip?: JSZip): Promise<any> => {
  if (!gameData) return gameData;
  
  const data = JSON.parse(JSON.stringify(gameData));
  
  const stats = {
    videos: { found: 0, copied: 0 },
    audio: { found: 0, copied: 0 },
    images: { found: 0, copied: 0 }
  };

  const getAssetData = async (url: string): Promise<{ data: Uint8Array, mimeType: string, base64: string } | null> => {
    try {
      if (url.startsWith('blob:') || url.startsWith('http')) {
        const resp = await fetch(url);
        const blob = await resp.blob();
        const arrayBuffer = await blob.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        
        // Convert to base64 for fallback
        let binary = '';
        const len = bytes.byteLength;
        for (let i = 0; i < len; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const b64 = btoa(binary);

        return {
          data: bytes,
          mimeType: blob.type,
          base64: `data:${blob.type};base64,${b64}`
        };
      } else if (url.startsWith('data:')) {
        const parts = url.split(',');
        const mime = parts[0].match(/:(.*?);/)?.[1] || 'application/octet-stream';
        const b64 = parts[1];
        const binary = atob(b64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return { data: bytes, mimeType: mime, base64: url };
      }
      return null;
    } catch (e) {
      console.error("Failed to get asset data for", url, e);
      return null;
    }
  };

  const saveAsset = async (url: string, folder: string, prefix: string): Promise<string> => {
    if (!url) return url;
    
    // If it's already a relative path, skip
    if (!url.startsWith('blob:') && !url.startsWith('data:') && !url.startsWith('local_')) {
      return url;
    }

    let actualUrl = url;
    if (url.startsWith('local_sound_ref:')) {
      const id = url.replace('local_sound_ref:', '');
      actualUrl = await getIDB(`game_sound_${id}`) || '';
    } else if (url.startsWith('local_video_ref:')) {
      const id = url.replace('local_video_ref:', '');
      actualUrl = await getIDB(`game_video_${id}`) || '';
    }

    if (!actualUrl) return url;

    const asset = await getAssetData(actualUrl);
    if (asset) {
      if (zip) {
        const ext = asset.mimeType.split('/')[1]?.split(';')[0] || 'bin';
        const fileName = `${prefix}_${Math.random().toString(36).substr(2, 9)}.${ext}`;
        const path = `assets/${folder}/${fileName}`;
        zip.file(path, asset.data);
        
        if (folder === 'videos') stats.videos.copied++;
        if (folder === 'audio') stats.audio.copied++;
        if (folder === 'images') stats.images.copied++;
        
        return `./${path}`;
      } else {
        // Fallback to base64 if no zip provided (e.g. for GitHub/Vercel deployment)
        if (folder === 'videos') stats.videos.copied++;
        if (folder === 'audio') stats.audio.copied++;
        if (folder === 'images') stats.images.copied++;
        return asset.base64;
      }
    }
    return url;
  };

  // 1. Process environments (backgrounds)
  if (Array.isArray(data.environments)) {
    for (const env of data.environments) {
      if (env.url) {
        stats.images.found++;
        env.url = await saveAsset(env.url, 'images', 'bg');
      }
      if (env.thumbnail) {
        env.thumbnail = await saveAsset(env.thumbnail, 'images', 'thumb');
      }
    }
  }

  // 2. Process uiButtons
  if (Array.isArray(data.uiButtons)) {
    for (const btn of data.uiButtons) {
      if (btn.url) {
        stats.images.found++;
        btn.url = await saveAsset(btn.url, 'images', 'btn');
      }
      if (btn.data && typeof btn.data === 'string') {
        btn.data = await saveAsset(btn.data, 'images', 'btn_data');
      }
    }
  }

  // 3. Process gameObjects
  if (Array.isArray(data.gameObjects)) {
    for (const obj of data.gameObjects) {
      if (obj.url) {
        stats.images.found++;
        obj.url = await saveAsset(obj.url, 'images', 'obj');
      }
      if (Array.isArray(obj.animations)) {
        for (const anim of obj.animations) {
          if (Array.isArray(anim.frames)) {
            const processedFrames = [];
            for (const frame of anim.frames) {
              if (frame) {
                stats.images.found++;
                processedFrames.push(await saveAsset(frame, 'images', 'frame'));
              } else {
                processedFrames.push(frame);
              }
            }
            anim.frames = processedFrames;
          }
        }
      }
    }
  }

  // 4. Process sceneElements
  if (data.sceneElements && typeof data.sceneElements === 'object') {
    for (const sceneId of Object.keys(data.sceneElements)) {
      const elements = data.sceneElements[sceneId];
      if (Array.isArray(elements)) {
        for (const el of elements) {
          if (el.url) {
            stats.images.found++;
            el.url = await saveAsset(el.url, 'images', 'el');
          }
          if (el.data && typeof el.data === 'string') {
            el.data = await saveAsset(el.data, 'images', 'el_data');
          }
        }
      }
    }
  }

  // 5. Process sceneEvents (resolve local sounds)
  if (data.sceneEvents && typeof data.sceneEvents === 'object') {
    for (const sceneId of Object.keys(data.sceneEvents)) {
      const sceneEvs = data.sceneEvents[sceneId];
      if (Array.isArray(sceneEvs)) {
        for (const ev of sceneEvs) {
          if (Array.isArray(ev.actions)) {
            for (const act of ev.actions) {
              if (act.type === 'play_sound' && act.value) {
                stats.audio.found++;
                act.value = await saveAsset(act.value, 'audio', 'sound');
              }
            }
          }
        }
      }
    }
  }

  // 6. Process projectSounds list
  if (Array.isArray(data.projectSounds)) {
    for (const snd of data.projectSounds) {
      if (snd.dataUrl) {
        stats.audio.found++;
        snd.dataUrl = await saveAsset(snd.dataUrl, 'audio', 'project_sound');
      }
    }
  }

  // 7. Process projectVideos list
  if (Array.isArray(data.projectVideos)) {
    for (const vid of data.projectVideos) {
      if (vid.url) {
        stats.videos.found++;
        vid.url = await saveAsset(vid.url, 'videos', 'video');
      }
    }
  }

  console.log("--- Export Asset Bundling Summary ---");
  console.log(`Videos: ${stats.videos.copied}/${stats.videos.found} copied.`);
  console.log(`Audio: ${stats.audio.copied}/${stats.audio.found} copied.`);
  console.log(`Images: ${stats.images.copied}/${stats.images.found} copied.`);
  if (stats.videos.copied !== stats.videos.found || stats.audio.copied !== stats.audio.found) {
    console.warn("Some assets failed to copy. Check console for read errors.");
  }
  console.log("--------------------------------------");

  return data;
};

export const generateProjectZip = async (gameData: any) => {
  const zip = new JSZip();
  
  // Preprocess gameData to bundle assets as files
  const processedGameData = await processGameDataAssets(gameData, zip);

  // Project Metadata
  const metadata = {
    name: "Animato Game Project",
    exportedAt: new Date().toISOString(),
    version: "1.0.0"
  };
  zip.file("animato-metadata.json", JSON.stringify(metadata, null, 2));

  // Game Data
  zip.file("src/game-data.json", JSON.stringify(processedGameData, null, 2));

  // package.json
  zip.file("package.json", JSON.stringify({
    name: "animato-game",
    private: true,
    version: "0.0.0",
    type: "module",
    scripts: {
      "dev": "vite",
      "build": "vite build",
      "preview": "vite preview"
    },
    dependencies: {
      "react": "^19.0.0",
      "react-dom": "^19.0.0",
      "lucide-react": "^0.474.0",
      "motion": "^12.0.0"
    },
    devDependencies: {
      "@types/react": "^19.0.0",
      "@types/react-dom": "^19.0.0",
      "@vitejs/plugin-react": "^4.3.4",
      "autoprefixer": "^10.4.20",
      "postcss": "^8.4.49",
      "tailwindcss": "^3.4.15",
      "typescript": "^5.7.2",
      "vite": "^6.0.0"
    }
  }, null, 2));

  // Vite config
  zip.file("vite.config.ts", `
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './',
})
`);

  // Index.html
  zip.file("index.html", `
<!DOCTYPE html>
<html lang="en" style="margin:0;padding:0;width:100%;height:100%;overflow:hidden;">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <title>Animato Game</title>
  </head>
  <body style="margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:#000;">
    <div id="root" style="width:100%;height:100%;"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`);

  // main.tsx
  zip.file("src/main.tsx", `
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
`);

  // index.css
  zip.file("src/index.css", `
@tailwind base;
@tailwind components;
@tailwind utilities;

html, body, #root {
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background-color: #000;
  color: #fff;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
`);

  // tailwind.config.js
  zip.file("tailwind.config.js", `
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
`);

  // postcss.config.js
  zip.file("postcss.config.js", `
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
`);

  // App.tsx (The Fully Featured Game Runner)
  zip.file("src/App.tsx", `import React, { useState, useEffect, useRef } from 'react';
import gameData from './game-data.json';

// Global shared AudioContext to handle gameplay audio and escape browser autoplay constraints
let globalAudioCtx: any = null;
const decodedBufferCache: Record<string, AudioBuffer> = {};

const normalizeDataURL = (dataURL: string): string => {
  if (!dataURL || !dataURL.startsWith('data:')) return dataURL;
  // Standardize common but non-standard audio mime types
  let [header, dataPart] = dataURL.split(',');
  if (!dataPart) return dataURL;
  
  let mimeMatch = header.match(/data:(.*?)(;|$)/);
  if (mimeMatch) {
    let mime = mimeMatch[1];
    if (mime === 'audio/mp3' || mime === 'audio/x-mp3' || mime === 'audio/x-mpeg') {
      header = header.replace(mime, 'audio/mpeg');
    } else if (mime === 'audio/x-wav') {
      header = header.replace(mime, 'audio/wav');
    } else if (mime === 'audio/x-m4a' || mime === 'audio/m4a') {
      header = header.replace(mime, 'audio/mp4');
    }
  }
  return \`\${header},\${dataPart}\`;
};

const dataURLToArrayBuffer = (dataURL: string): ArrayBuffer => {
  try {
    const normalized = normalizeDataURL(dataURL);
    const parts = normalized.split(',');
    if (parts.length < 2) {
      throw new Error("Invalid Data URL format");
    }
    const header = parts[0];
    const dataPart = parts[1];
    
    let binaryString: string;
    if (header.includes(';base64')) {
      const base64 = decodeURIComponent(dataPart);
      binaryString = atob(base64);
    } else {
      binaryString = decodeURIComponent(dataPart);
    }
    
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  } catch (err) {
    console.error("Failed to convert Data URL to ArrayBuffer:", err);
    return new ArrayBuffer(0);
  }
};

const getSharedAudioContext = (): AudioContext => {
  if (typeof window === 'undefined') {
    throw new Error("AudioContext is not available on server-side");
  }
  if (!globalAudioCtx) {
    globalAudioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  if (globalAudioCtx.state === 'suspended') {
    globalAudioCtx.resume().catch(err => {
      console.warn("Failed to resume shared AudioContext:", err);
    });
  }
  return globalAudioCtx;
};

// Automatic listener to unlock the AudioContext on the first user interaction
if (typeof window !== 'undefined') {
  const unlock = () => {
    try {
      const ctx = getSharedAudioContext();
      if (ctx && ctx.state === 'running') {
        window.removeEventListener('click', unlock);
        window.removeEventListener('keydown', unlock);
        window.removeEventListener('touchstart', unlock);
        console.log("Shared AudioContext successfully unlocked!");
      }
    } catch (e) {
      // Quietly ignore and wait for next interaction
    }
  };
  window.addEventListener('click', unlock, { passive: true });
  window.addEventListener('keydown', unlock, { passive: true });
  window.addEventListener('touchstart', unlock, { passive: true });
}

const playSoundWithSharedContext = async (audioSrc: string) => {
  if (!audioSrc) return;

  try {
    const ctx = getSharedAudioContext();
    
    // Check decoded buffer cache first
    if (decodedBufferCache[audioSrc]) {
      const source = ctx.createBufferSource();
      source.buffer = decodedBufferCache[audioSrc];
      source.connect(ctx.destination);
      source.start(0);
      return;
    }

    let arrayBuffer: ArrayBuffer;
    if (audioSrc.startsWith('data:')) {
      arrayBuffer = dataURLToArrayBuffer(audioSrc);
    } else {
      // Fetch and decode for remote/blob/relative URLs
      const response = await fetch(audioSrc);
      arrayBuffer = await response.arrayBuffer();
    }

    if (arrayBuffer.byteLength === 0) {
      throw new Error("Empty audio buffer");
    }
    
    let handled = false;
    const handleSuccess = (audioBuffer: AudioBuffer) => {
      if (handled) return;
      handled = true;
      decodedBufferCache[audioSrc] = audioBuffer;
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);
      source.start(0);
    };

    const handleFailure = (err: any) => {
      if (handled) return;
      handled = true;
      console.warn("decodeAudioData failed, trying direct Audio element fallback:", err);
      try {
        const audio = new Audio(audioSrc);
        audio.play().catch(fallbackErr => {
          console.warn("Standard Audio direct playback failed (logged as warning):", fallbackErr);
          playBeepWithSharedContext();
        });
      } catch (fallbackErr) {
        console.warn("Standard Audio initialization failed (logged as warning):", fallbackErr);
        playBeepWithSharedContext();
      }
    };

    try {
      const decodePromise = ctx.decodeAudioData(arrayBuffer, handleSuccess, handleFailure);
      if (decodePromise && typeof decodePromise.catch === 'function') {
        decodePromise.catch((err) => {
          handleFailure(err);
        });
      }
    } catch (decodeErr) {
      handleFailure(decodeErr);
    }
  } catch (err) {
    console.warn("Shared AudioContext play failed, using direct Audio fallback:", err);
    try {
      const audio = new Audio(audioSrc);
      audio.play().catch(directErr => {
        console.warn("Direct Audio element playback failed (logged as warning):", directErr);
        playBeepWithSharedContext();
      });
    } catch (directErr) {
      console.warn("Direct Audio element instantiation failed (logged as warning):", directErr);
      playBeepWithSharedContext();
    }
  }
};

const playBeepWithSharedContext = () => {
  try {
    const ctx = getSharedAudioContext();
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();
    osc.connect(gainNode);
    gainNode.connect(ctx.destination);
    osc.frequency.value = 523.25; // C5 Note
    gainNode.gain.setValueAtTime(0.1, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
    osc.start(0);
    osc.stop(ctx.currentTime + 0.3);
  } catch (err) {
    console.warn("Shared context beep failed:", err);
  }
};

const AnimatedSprite = ({ frames, fps, speed = 1, width, height }: { frames: string[], fps: number, speed?: number, width: number, height: number }) => {
  const [currentFrame, setCurrentFrame] = useState(0);
  
  useEffect(() => {
    if (!frames || frames.length === 0) return;
    const actualFps = (fps || 24) * speed;
    const interval = setInterval(() => {
      setCurrentFrame(prev => (prev + 1) % frames.length);
    }, 1000 / actualFps);
    return () => clearInterval(interval);
  }, [frames, fps, speed]);

  if (!frames || frames.length === 0) {
    return <div style={{ width: '100%', height: '100%', backgroundColor: '#27272a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', color: '#71717a' }}>No Anim</div>;
  }

  return (
    <div 
      style={{
        width: '100%',
        height: '100%',
        backgroundImage: \`url(\${frames[currentFrame]})\`,
        backgroundSize: '100% 100%',
        backgroundRepeat: 'no-repeat'
      }}
    />
  );
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
      if (aspectRatio === 'landscape' && w < h) {
        setShowRotationPrompt(true);
      } else if (aspectRatio === 'portrait' && w > h) {
        setShowRotationPrompt(true);
      } else {
        setShowRotationPrompt(false);
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    const mql = window.matchMedia('(orientation: landscape)');
    const mqlListener = () => handleResize();
    try { mql.addEventListener('change', mqlListener); } catch(e) { window.addEventListener('orientationchange', mqlListener); }
    return () => {
      window.removeEventListener('resize', handleResize);
      try { mql.removeEventListener('change', mqlListener); } catch(e) { window.removeEventListener('orientationchange', mqlListener); }
    };
  }, [aspectRatio]);

  const scale = (() => {
    const maxW = windowSize.width;
    const maxH = windowSize.height;
    return Math.min(maxW / VIRTUAL_WIDTH, maxH / VIRTUAL_HEIGHT);
  })();

  const stageElementsRef = useRef(stageElements);
  useEffect(() => {
    stageElementsRef.current = stageElements;
  }, [stageElements]);

  useEffect(() => {
    const sceneEls = gameData.sceneElements[activeSceneId] || [];
    setStageElements(sceneEls);
  }, [activeSceneId]);

  const executeAction = (act) => {
    switch (act.type) {
      case 'goto_scene':
        if (act.target) {
          const exists = (gameData.scenes || []).some(s => s.id === act.target);
          if (exists) {
            setActiveSceneId(act.target);
          }
        }
        break;

      case 'change_opacity':
        if (act.target) {
          const val = Number(act.value ?? 50) / 100;
          setStageElements(prev => prev.map(el => {
            if (el.data === act.target || el.id === act.target || el.buttonId === act.target) {
              return { ...el, opacity: val };
            }
            return el;
          }));
        }
        break;

      case 'destroy':
        if (act.target) {
          setStageElements(prev => prev.filter(el => el.data !== act.target && el.id !== act.target && el.buttonId !== act.target));
        }
        break;

      case 'play_sound':
        try {
          if (act.value) {
            const sound = (gameData.projectSounds || []).find(s => s.id === act.value || s.name === act.value);
            const soundUrl = sound?.url || sound?.dataUrl || act.value;
            playSoundWithSharedContext(soundUrl);
          } else {
            playBeepWithSharedContext();
          }
        } catch (e) {
          console.warn("Audio Context blocked or failed:", e);
        }
        break;

      case 'play_animation':
        if (act.target) {
          const videoId = act.target;
          const fitToScreen = act.fitToScreen || false;
          const existing = stageElementsRef.current.find(el => el.type === 'video' && el.videoId === videoId);
          if (existing) {
            const elVid = document.getElementById(\`video_player_\${existing.id}\`) as HTMLVideoElement;
            if (elVid) {
              elVid.currentTime = 0;
              elVid.play().catch(e => console.log('Video play failed:', e));
            }
          } else {
            const elId = \`vid_\${Date.now()}\`;
            setStageElements(prev => [
              ...prev,
              {
                id: elId,
                type: 'video',
                videoId: videoId,
                fitToScreen: fitToScreen,
                x: fitToScreen ? 0 : 100,
                y: fitToScreen ? 0 : 50,
                width: fitToScreen ? VIRTUAL_WIDTH : 300,
                height: fitToScreen ? VIRTUAL_HEIGHT : 200,
                layerId: ''
              }
            ]);
            setTimeout(() => {
              const elVid = document.getElementById(\`video_player_\${elId}\`) as HTMLVideoElement;
              if (elVid) {
                elVid.currentTime = 0;
                elVid.play().catch(e => console.log('Video play failed:', e));
              }
            }, 100);
          }
        }
        break;

      case 'stop_animation':
        if (act.target) {
          const videoId = act.target;
          const existing = stageElementsRef.current.find(el => el.type === 'video' && el.videoId === videoId);
          if (existing) {
            const elVid = document.getElementById(\`video_player_\${existing.id}\`) as HTMLVideoElement;
            if (elVid) elVid.pause();
          }
        }
        break;

      case 'remove_animation':
        if (act.target) {
          const videoId = act.target;
          setStageElements(prev => prev.filter(el => !(el.type === 'video' && el.videoId === videoId)));
        }
        break;

      case 'move_to':
        if (act.target) {
          const targetX = Number(act.x ?? 100);
          const targetY = Number(act.y ?? 100);
          setStageElements(prev => prev.map(el => {
            if (el.data === act.target || el.id === act.target || el.buttonId === act.target) {
              return { ...el, x: targetX, y: targetY };
            }
            return el;
          }));
        }
        break;

      case 'move_straight':
      case 'move_zigzag':
        if (act.target) {
          setStageElements(prev => prev.map(el => {
            if (el.data === act.target || el.id === act.target || el.buttonId === act.target) {
              return { ...el, x: el.x + 80, y: el.y + (act.type === 'move_zigzag' ? 30 : 0) };
            }
            return el;
          }));
        }
        break;

      case 'change_color':
      case 'glow':
        if (act.target) {
          setStageElements(prev => prev.map(el => {
            if (el.data === act.target || el.id === act.target || el.buttonId === act.target) {
              return { ...el, colorFilter: act.value };
            }
            return el;
          }));
        }
        break;

      case 'rotate':
        if (act.target) {
          const rotationDegrees = Number(act.value ?? 15);
          setStageElements(prev => prev.map(el => {
            if (el.data === act.target || el.id === act.target || el.buttonId === act.target) {
              return { ...el, rotation: (el.rotation || 0) + rotationDegrees };
            }
            return el;
          }));
        }
        break;
        
      case 'inc_width':
        if (act.target) {
          const addWidth = Number(act.value ?? 10);
          setStageElements(prev => prev.map(el => {
            if (el.data === act.target || el.id === act.target || el.buttonId === act.target) {
              return { ...el, width: el.width + addWidth };
            }
            return el;
          }));
        }
        break;

      case 'inc_height':
        if (act.target) {
          const addHeight = Number(act.value ?? 10);
          setStageElements(prev => prev.map(el => {
            if (el.data === act.target || el.id === act.target || el.buttonId === act.target) {
              return { ...el, height: el.height + addHeight };
            }
            return el;
          }));
        }
        break;

      case 'create_character':
        if (act.target) {
           const targetObj = (gameData.gameObjects || []).find(g => g.id === act.target);
           if (targetObj) {
             const newId = \`created_\${Date.now()}\`;
             setStageElements(prev => [
               ...prev,
               { id: newId, type: 'obj', data: act.target, x: Number(act.x ?? 100), y: Number(act.y ?? 100), width: 100, height: 100, zIndex: 10 }
             ]);
           }
        }
        break;

      case 'js':
        if (act.code) {
          try {
            const runUserCode = new Function(
              'stageElements', 'setStageElements', 
              'activeSceneId', 'handleSwitchScene',
              'events', 'setEvents',
              'gameObjects', 'setGameObjects',
              'layers', 'setLayers',
              'activeLayerId', 'setActiveLayerId',
              act.code
            );
            runUserCode(
              stageElements, (val) => {
                if (typeof val === 'function') setStageElements(val);
                else setStageElements(val);
              },
              activeSceneId, (sceneId) => {
                setActiveSceneId(sceneId);
              },
              [], () => {},
              gameData.gameObjects || [], () => {},
              gameData.layers || [], () => {},
              '', () => {}
            );
          } catch (err) {
            console.error("Custom JS Error:", err);
          }
        }
        break;

      case 'show_text':
        if (act.value) {
          const message = act.value;
          const toastId = \`toast_\${Date.now()}\`;
          setStageElements(prev => [
            ...prev,
            { id: toastId, type: 'btn', data: null, url: null, x: 220, y: 150, width: 200, height: 40, isToast: true, text: message }
          ]);
          setTimeout(() => {
            setStageElements(prev => prev.filter(el => el.id !== toastId));
          }, 3000);
        }
        break;

      default:
        console.log("Unhandled action:", act.type);
    }
  };

  const handleButtonClick = (buttonId) => {
    if (!buttonId) return;
    const btnEl = stageElements.find(e => e.id === buttonId);
    const sceneEvents = gameData.sceneEvents[activeSceneId] || [];
    sceneEvents.forEach(ev => {
      const isPressed = ev.conditions?.some(cond => 
        (cond.type === 'pressed' || cond.type === 'pressed_time' || cond.type === 'double_tap' || cond.type === 'click') && 
        (cond.target === buttonId || (btnEl?.buttonId && cond.target === btnEl.buttonId) || (btnEl?.data && cond.target === btnEl.data))
      );
      if (isPressed) {
        ev.actions?.forEach(act => executeAction(act));
      }
    });
  };

  useEffect(() => {
    const sceneEvents = gameData.sceneEvents[activeSceneId] || [];
    sceneEvents.forEach(ev => {
      const hasSceneStart = ev.conditions?.some(cond => cond.type === 'scene_start');
      if (hasSceneStart) {
        ev.actions?.forEach(act => executeAction(act));
      }
    });

    let lastTime = Date.now();
    const timerValues = { scene_timer: 0 };

    const interval = setInterval(() => {
      const now = Date.now();
      const dt = (now - lastTime) / 1000;
      lastTime = now;
      timerValues.scene_timer += dt;

      const currentEvents = gameData.sceneEvents[activeSceneId] || [];
      currentEvents.forEach(ev => {
        let allConditionsMet = ev.conditions?.length > 0;

        ev.conditions?.forEach(cond => {
          if (!allConditionsMet) return;

          if (cond.type === 'timer') {
            const limit = Number(cond.value || 0);
            if (timerValues.scene_timer < limit) {
              allConditionsMet = false;
            }
          }

          if (cond.type === 'collision') {
            const target1 = cond.target;
            const target2 = cond.target2;
            if (target1 && target2) {
              const el1 = stageElementsRef.current.find(el => el.data === target1 || el.id === target1);
              const el2 = stageElementsRef.current.find(el => el.data === target2 || el.id === target2);
              if (el1 && el2) {
                const collides = !(
                  el1.x + el1.width < el2.x ||
                  el2.x + el2.width < el1.x ||
                  el1.y + el1.height < el2.y ||
                  el2.y + el2.height < el1.y
                );
                if (!collides) allConditionsMet = false;
              } else {
                allConditionsMet = false;
              }
            } else {
              allConditionsMet = false;
            }
          }

          if (cond.type === 'scene_start' || cond.type === 'pressed' || cond.type === 'pressed_time' || cond.type === 'double_tap') {
            allConditionsMet = false;
          }
        });

        if (allConditionsMet) {
          ev.actions?.forEach(act => executeAction(act));
        }
      });
    }, 200);

    return () => clearInterval(interval);
  }, [activeSceneId]);

  return (
    <div style={{ backgroundColor: '#0a0a0c', width: '100vw', height: '100vh', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
      {gameData.customCSS && <style>{gameData.customCSS}</style>}
      <div 
        style={{ 
          position: 'relative', 
          width: \`\${VIRTUAL_WIDTH}px\`,
          height: \`\${VIRTUAL_HEIGHT}px\`,
          transform: \`scale(\${scale})\`,
          transformOrigin: 'center',
          backgroundColor: gameData.stageBgColor || '#000', 
          overflow: 'hidden',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
          borderRadius: aspectRatio === 'portrait' ? '32px' : '12px',
          border: aspectRatio === 'portrait' ? '12px solid #27272a' : '2px solid rgba(255,255,255,0.05)',
        }}
      >
        {stageElements.map((el, i) => {
           const isButton = el.type === 'btn';
           const isObj = el.type === 'obj' || el.type === 'enemy';
           const gameObject = isObj ? (gameData.gameObjects || []).find(g => g.id === el.data) : null;
           const isText = gameObject?.type === 'text';
           const bgUrl = el.url || (isObj ? (gameObject?.url || gameObject?.animations?.[0]) : el.data);
           const firstAnim = gameObject?.animations?.[0];

           const layers = gameData.layers || [];
           const layerIdx = layers.findIndex(l => l.id === el.layerId);
           const layerZ = layerIdx === -1 ? 10 : (layers.length - layerIdx) * 10;
           const finalZ = isText ? layerZ + 2000 : layerZ;

           const isInteractive = isButton || el.type === 'obj' || el.type === 'enemy';
           return (
             <div 
               key={el.id || i} 
               onClick={(e) => {
                 if (isInteractive) {
                   e.stopPropagation();
                   handleButtonClick(el.id);
                 }
               }}
               style={{ 
                 position: 'absolute', 
                 left: el.type === 'bg' ? 0 : el.x, 
                 top: el.type === 'bg' ? 0 : el.y, 
                 width: el.type === 'bg' ? '100%' : el.width, 
                 height: el.type === 'bg' ? '100%' : el.height, 
                 backgroundImage: (!isText && bgUrl && el.type !== 'video') ? \`url(\${bgUrl})\` : undefined, 
                 backgroundSize: '100% 100%',
                 backgroundRepeat: 'no-repeat',
                 backgroundColor: (!bgUrl && el.type === 'btn') ? 'rgba(236,72,153,0.2)' : undefined,
                 opacity: el.opacity !== undefined ? el.opacity : 1,
                 transform: el.rotation ? \`rotate(\${el.rotation}deg)\` : undefined,
                 cursor: isInteractive ? 'pointer' : 'default',
                 pointerEvents: isInteractive ? 'auto' : 'none',
                 zIndex: el.type === 'bg' ? 0 : finalZ
               }}
             >
               {el.type === 'btn' && <button style={{width:'100%',height:'100%',background:'transparent',border:'none', cursor: 'pointer', color: 'white', fontWeight: 'bold'}}>{el.text}</button>}
               {el.type === 'video' && (
                 <video
                   id={\`video_player_\${el.id}\`}
                   src={(gameData.projectVideos || []).find(v => v.id === el.videoId)?.url}
                   style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                   playsInline
                   preload="auto"
                   onEnded={() => {
                     setStageElements(prev => prev.filter(item => item.id !== el.id));
                   }}
                 />
               )}
               {el.type === 'obj' && gameObject?.type === 'text' ? (
                 <div 
                   style={{
                     width: '100%',
                     height: '100%',
                     display: 'flex',
                     alignItems: 'center',
                     justifyContent: gameObject.align === 'left' ? 'flex-start' : gameObject.align === 'right' ? 'flex-end' : 'center',
                     textAlign: gameObject.align ?? 'center',
                     fontSize: \`\${gameObject.fontSize ?? 24}px\`,
                     color: gameObject.color ?? '#ffffff',
                     fontFamily: gameObject.fontFamily ?? 'Inter, sans-serif',
                     fontWeight: gameObject.bold !== false ? 'bold' : 'normal',
                     fontStyle: gameObject.italic ? 'italic' : 'normal',
                     lineHeight: 1.2,
                     wordBreak: 'break-word',
                     overflow: 'visible',
                     padding: '4px'
                   }}
                 >
                   {gameObject.textContent ?? gameObject.name ?? 'Text'}
                 </div>
               ) : el.type === 'obj' && firstAnim && firstAnim.frames && firstAnim.frames.length > 0 ? (
                 <AnimatedSprite frames={firstAnim.frames} fps={firstAnim.fps || 24} speed={firstAnim.speed || 1} width={el.width} height={el.height} />
               ) : el.type === 'obj' && (!firstAnim || !firstAnim.frames || firstAnim.frames.length === 0) ? (
                 <div style={{ width: '100%', height: '100%', backgroundColor: 'rgba(6,182,212,0.2)', border: '1px solid rgba(6,182,212,0.5)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontSize: '10px', color: '#22d3ee', fontWeight: 'bold', padding: '4px', textAlign: 'center' }}>
                   {gameObject?.name || 'Object'}
                 </div>
               ) : null}
               {el.isToast && (
                 <div style={{ width: '100%', height: '100%', backgroundColor: 'rgba(0,0,0,0.95)', color: '#facc15', border: '1px solid rgba(234,179,8,0.8)', borderRadius: '4px', padding: '4px 12px', fontSize: '12px', fontFamily: 'monospace', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.3)', textAlign: 'center' }}>
                   {el.text}
                 </div>
               )}
             </div>
           );
        })}
      </div>
      {showRotationPrompt && (
        <div style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(10,10,12,0.95)', zIndex: 9999, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#fff', fontFamily: 'Inter, sans-serif', padding: '24px', textAlign: 'center' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px', animation: 'spin 4s linear infinite' }}>🔄</div>
          <h2 style={{ fontSize: '20px', fontWeight: 'bold', marginBottom: '8px' }}>Please Rotate Your Device</h2>
          <p style={{ color: '#a1a1aa', fontSize: '14px', maxWidth: '300px', marginBottom: '24px' }}>This game is designed for {aspectRatio} screen layout. Please rotate your screen for the best experience.</p>
          <button onClick={() => setShowRotationPrompt(false)} style={{ backgroundColor: '#fff', color: '#000', border: 'none', padding: '10px 20px', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', fontSize: '13px' }}>Play Anyway</button>
        </div>
      )}
    </div>
  );
}
`);

  const content = await zip.generateAsync({ type: "blob" });
  saveAs(content, "animato-project.zip");
};
