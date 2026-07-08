import React, { useState, useEffect, useRef } from 'react';
import gameData from './game-data.json';

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
        backgroundImage: `url(${frames[currentFrame]})`,
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
    return () => window.removeEventListener('resize', handleResize);
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
          const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
          const osc = audioCtx.createOscillator();
          const gainNode = audioCtx.createGain();
          osc.connect(gainNode);
          gainNode.connect(audioCtx.destination);
          osc.frequency.value = 523.25;
          gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
          gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
          osc.start();
          osc.stop(audioCtx.currentTime + 0.3);
        } catch (e) {
          console.warn("Audio Context blocked or failed:", e);
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
             const newId = `created_${Date.now()}`;
             setStageElements(prev => [
               ...prev,
               { id: newId, type: 'obj', data: act.target, x: Number(act.x ?? 100), y: Number(act.y ?? 100), width: 100, height: 100, zIndex: 10 }
             ]);
           }
        }
        break;

      case 'js':
        console.log('Executing custom JS action:', act.code);
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
            const customSetStageElements = (newVal) => {
              if (typeof newVal === 'function') {
                setStageElements(prev => {
                  const updated = newVal(prev);
                  return Array.isArray(updated) ? [...updated] : updated;
                });
              } else {
                setStageElements(Array.isArray(newVal) ? [...newVal] : newVal);
              }
            };
            runUserCode(
              stageElementsRef.current, customSetStageElements,
              activeSceneId, (sceneId) => {
                setActiveSceneId(sceneId);
              },
              gameData.sceneEvents[activeSceneId] || [], () => {},
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
          const toastId = `toast_${Date.now()}`;
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
    const btnEl = stageElementsRef.current.find(e => e.id === buttonId);
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
      <div 
        style={{ 
          position: 'relative', 
          width: `${VIRTUAL_WIDTH}px`, 
          height: `${VIRTUAL_HEIGHT}px`, 
          transform: `scale(${scale})`, 
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
                 backgroundImage: (!isText && bgUrl) ? `url(${bgUrl})` : undefined, 
                 backgroundSize: '100% 100%', 
                 backgroundRepeat: 'no-repeat', 
                 backgroundColor: (!bgUrl && el.type === 'btn') ? 'rgba(236,72,153,0.2)' : undefined, 
                 opacity: el.opacity !== undefined ? el.opacity : 1, 
                 transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined, 
                 cursor: isInteractive ? 'pointer' : 'default', 
                 pointerEvents: isInteractive ? 'auto' : 'none', 
                 zIndex: el.type === 'bg' ? 0 : finalZ 
               }}
             >
               {el.type === 'btn' && <button style={{width:'100%',height:'100%',background:'transparent',border:'none', cursor: 'pointer', color: 'white', fontWeight: 'bold'}}>{el.text}</button>}
               {el.type === 'obj' && gameObject?.type === 'text' ? (
                 <div 
                   style={{
                     width: '100%', 
                     height: '100%', 
                     display: 'flex', 
                     alignItems: 'center', 
                     justifyContent: gameObject.align === 'left' ? 'flex-start' : gameObject.align === 'right' ? 'flex-end' : 'center', 
                     textAlign: gameObject.align ?? 'center', 
                     fontSize: `${gameObject.fontSize ?? 24}px`, 
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
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>🔄</div>
          <h2 style={{ fontSize: '20px', fontWeight: 'bold', marginBottom: '8px' }}>Please Rotate Your Device</h2>
          <p style={{ color: '#a1a1aa', fontSize: '14px', maxWidth: '300px', marginBottom: '24px' }}>This game is designed for {aspectRatio} screen layout. Please rotate your screen for the best experience.</p>
          <button onClick={() => setShowRotationPrompt(false)} style={{ backgroundColor: '#fff', color: '#000', border: 'none', padding: '10px 20px', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', fontSize: '13px' }}>Play Anyway</button>
        </div>
      )}
    </div>
  );
}