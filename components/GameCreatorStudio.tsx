import React, { useState, useRef, useEffect } from 'react';
import { 
  ArrowLeft, Play, Settings, Download, Plus, X, 
  Layers, Box, MousePointerClick, Image as ImageIcon, FileCode2,
  MonitorPlay, Smartphone, PaintBucket, PenTool,
  ChevronDown, ChevronUp, Sliders, Trash2, Github,
  Save, RefreshCw, Key, Shield, HelpCircle, ExternalLink, Flame, Info,
  AlertTriangle, AlertCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { AdvancedColorPicker } from './AdvancedColorPicker';
import { generateProjectZip } from '../utils/exportUtils';
import { db, doc, setDoc, getDoc, deleteDoc, serverTimestamp, auth, googleProvider } from '../utils/firebase';
import { signInWithPopup } from 'firebase/auth';
import { getBackendApiUrl } from '../utils/api';
import { GithubRepoModal } from './GithubRepoModal';
import { MobileAppModal } from './MobileAppModal';

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
    return <div className="w-full h-full bg-zinc-800 border border-white/20 flex items-center justify-center text-xs text-gray-500">No Anim</div>;
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

const performFloodFill = (canvas: HTMLCanvasElement, startX: number, startY: number, fillColor: string) => {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const width = canvas.width;
  const height = canvas.height;
  const startXRounded = Math.floor(startX);
  const startYRounded = Math.floor(startY);
  if (startXRounded < 0 || startXRounded >= width || startYRounded < 0 || startYRounded >= height) return;

  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = 1;
  tempCanvas.height = 1;
  const tempCtx = tempCanvas.getContext('2d');
  if (!tempCtx) return;
  tempCtx.fillStyle = fillColor;
  tempCtx.fillRect(0, 0, 1, 1);
  const fillPixel = tempCtx.getImageData(0, 0, 1, 1).data;
  const fillR = fillPixel[0];
  const fillG = fillPixel[1];
  const fillB = fillPixel[2];
  const fillA = fillPixel[3];

  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;

  const startIdx = (startYRounded * width + startXRounded) * 4;
  const startR = data[startIdx];
  const startG = data[startIdx + 1];
  const startB = data[startIdx + 2];
  const startA = data[startIdx + 3];

  if (startR === fillR && startG === fillG && startB === fillB && startA === fillA) {
    return;
  }

  const matchColor = (idx: number) => {
    return Math.abs(data[idx] - startR) < 30 &&
           Math.abs(data[idx+1] - startG) < 30 &&
           Math.abs(data[idx+2] - startB) < 30 &&
           Math.abs(data[idx+3] - startA) < 30;
  };

  const stack: [number, number][] = [[startXRounded, startYRounded]];
  const visited = new Uint8Array(width * height);

  while (stack.length > 0) {
    const curr = stack.pop()!;
    const cx = curr[0];
    const cy = curr[1];

    if (cx < 0 || cx >= width || cy < 0 || cy >= height) continue;

    const visitIdx = cy * width + cx;
    if (visited[visitIdx]) continue;
    visited[visitIdx] = 1;

    const idx = visitIdx * 4;
    if (matchColor(idx)) {
      data[idx] = fillR;
      data[idx + 1] = fillG;
      data[idx + 2] = fillB;
      data[idx + 3] = fillA;

      stack.push([cx + 1, cy]);
      stack.push([cx - 1, cy]);
      stack.push([cx, cy + 1]);
      stack.push([cx, cy - 1]);
    }
  }

  ctx.putImageData(imgData, 0, 0);
};

interface GameCreatorStudioProps {
  projectId: string;
  projectName: string;
  onBack: () => void;
  onSave: () => void;
}

type BottomTab = 'events' | 'layers' | 'objects' | 'buttons' | 'environment' | 'properties';

export const GameCreatorStudio: React.FC<GameCreatorStudioProps> = ({
  projectId,
  projectName,
  onBack,
  onSave
}) => {
  const [scenes, setScenes] = useState<{ id: string, name: string }[]>([
    { id: 'scene_1', name: 'Scene 1' }
  ]);
  const [activeSceneId, setActiveSceneId] = useState<string>('scene_1');
  const stageParentRef = useRef<HTMLDivElement>(null);
  const [parentDimensions, setParentDimensions] = useState({ width: 800, height: 450 });

  useEffect(() => {
    if (!stageParentRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (let entry of entries) {
        const { width, height } = entry.contentRect;
        setParentDimensions({ width, height });
      }
    });
    observer.observe(stageParentRef.current);
    return () => observer.disconnect();
  }, []);

  const [activeBottomTab, setActiveBottomTab] = useState<BottomTab>('objects');
  const [isPreviewing, setIsPreviewing] = useState(false);

  // --- Multi-scene State Persistence ---
  const [sceneElements, setSceneElements] = useState<Record<string, any[]>>({
    scene_1: []
  });
  const [sceneEvents, setSceneEvents] = useState<Record<string, any[]>>({
    scene_1: [{ id: 'ev_1', conditions: [], actions: [] }]
  });

  // --- Preview Engine State Backups ---
  const [scenesBackup, setScenesBackup] = useState<any[] | null>(null);
  const [sceneElementsBackup, setSceneElementsBackup] = useState<Record<string, any[]> | null>(null);
  const [sceneEventsBackup, setSceneEventsBackup] = useState<Record<string, any[]> | null>(null);
  const [activeSceneIdBackup, setActiveSceneIdBackup] = useState<string | null>(null);

  // --- Custom JavaScript Editor State ---
  const [editingJsAction, setEditingJsAction] = useState<{ evIndex: number, actIndex: number, code: string } | null>(null);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showMobileAppModal, setShowMobileAppModal] = useState(false);
  const [showGithubConnectModal, setShowGithubConnectModal] = useState(false);
  const [showGithubRepoModal, setShowGithubRepoModal] = useState(false);
  const [isGithubConnected, setIsGithubConnected] = useState(false);
  const [githubUsername, setGithubUsername] = useState('');
  const [githubMissingScopes, setGithubMissingScopes] = useState<string[]>([]);
  const [githubIsFineGrained, setGithubIsFineGrained] = useState<boolean>(false);
  const [appVersion, setAppVersion] = useState(() => localStorage.getItem('app_version') || 'v1.0.4');

  useEffect(() => {
    const handlePwaUpdate = () => {
      setAppVersion('v1.0.5');
    };
    window.addEventListener('pwa-app-updated', handlePwaUpdate);
    return () => window.removeEventListener('pwa-app-updated', handlePwaUpdate);
  }, []);
  
  // Tabbed GitHub connection states
  const [githubConnectTab, setGithubConnectTab] = useState<'pat' | 'oauth'>('oauth');
  const [patToken, setPatToken] = useState('');
  const [isVerifyingPat, setIsVerifyingPat] = useState(false);
  const [patError, setPatError] = useState<string | null>(null);
  const [isDisconnectingGithub, setIsDisconnectingGithub] = useState(false);
  const [isConnectingOauth, setIsConnectingOauth] = useState(false);
  const authWindowRef = useRef<Window | null>(null);

  // --- Settings State ---
  const [showSettings, setShowSettings] = useState(false);
  const [stageBgColor, setStageBgColor] = useState('#111111');
  const [autoSave, setAutoSave] = useState(() => {
    const saved = localStorage.getItem(`autosave_${projectId}`);
    return saved === 'true';
  });
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);

  useEffect(() => {
    localStorage.setItem(`autosave_${projectId}`, String(autoSave));
  }, [autoSave, projectId]);
  
  // --- Stage Elements State ---
  const [stageElements, setStageElements] = useState<{id: string, type: 'bg' | 'btn' | 'obj', url?: string, x: number, y: number, width: number, height: number, data?: any}[]>([]);
  const [draggedElement, setDraggedElement] = useState<{id: string, offsetX: number, offsetY: number} | null>(null);
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [aspectRatio, setAspectRatio] = useState<'landscape' | 'portrait'>('landscape');

  const VIRTUAL_WIDTH = aspectRatio === 'landscape' ? 640 : 360;
  const VIRTUAL_HEIGHT = aspectRatio === 'landscape' ? 360 : 640;
  const scale = (() => {
    const padding = 48;
    const maxW = parentDimensions.width - padding;
    const maxH = parentDimensions.height - padding;
    return Math.min(maxW / VIRTUAL_WIDTH, maxH / VIRTUAL_HEIGHT, 1);
  })();

  // --- Draw Canvas State ---
  const [showDrawCanvas, setShowDrawCanvas] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawingRef = useRef(false);
  const [drawColor, setDrawColor] = useState('#ff0055');
  const [drawMode, setDrawMode] = useState<'pen' | 'fill'>('pen');
  const [showDrawColorPicker, setShowDrawColorPicker] = useState(false);
  const [showStageBgColorPicker, setShowStageBgColorPicker] = useState(false);

  // --- Events State ---
  const [events, setEvents] = useState<{ id: string, conditions: any[], actions: any[] }[]>([
    { id: 'ev_1', conditions: [], actions: [] }
  ]);
  const [collapsedEvents, setCollapsedEvents] = useState<Record<string, boolean>>({});
  const [showConditionPicker, setShowConditionPicker] = useState<string | null>(null);
  const [showActionPicker, setShowActionPicker] = useState<string | null>(null);

  // --- Refs for Event Loop ---
  const stageElementsRef = useRef(stageElements);
  const eventsRef = useRef(events);
  const executeActionRef = useRef(executeActionInPreview);

  useEffect(() => { stageElementsRef.current = stageElements; }, [stageElements]);
  useEffect(() => { eventsRef.current = events; }, [events]);
  useEffect(() => { executeActionRef.current = executeActionInPreview; }, [executeActionInPreview]);

  // --- Preview Backup / Restore Effect ---
  useEffect(() => {
    if (isPreviewing) {
      const fullElements = { ...sceneElements, [activeSceneId]: stageElements };
      const fullEvents = { ...sceneEvents, [activeSceneId]: events };
      
      setScenesBackup([...scenes]);
      setActiveSceneIdBackup(activeSceneId);
      setSceneElementsBackup(fullElements);
      setSceneEventsBackup(fullEvents);
      
      setSceneElements(fullElements);
      setSceneEvents(fullEvents);
    } else {
      if (scenesBackup && activeSceneIdBackup && sceneElementsBackup && sceneEventsBackup) {
        setScenes(scenesBackup);
        setActiveSceneId(activeSceneIdBackup);
        setSceneElements(sceneElementsBackup);
        setSceneEvents(sceneEventsBackup);
        
        setStageElements(sceneElementsBackup[activeSceneIdBackup] || []);
        setEvents(sceneEventsBackup[activeSceneIdBackup] || [{ id: `ev_${Date.now()}`, conditions: [], actions: [] }]);
        
        setScenesBackup(null);
        setActiveSceneIdBackup(null);
        setSceneElementsBackup(null);
        setSceneEventsBackup(null);
      }
    }
  }, [isPreviewing]);

  // --- Trigger Scene Start Events on Preview ---
  useEffect(() => {
    if (isPreviewing) {
      events.forEach(ev => {
        const hasSceneStart = ev.conditions.some(cond => cond.type === 'scene_start');
        if (hasSceneStart) {
          ev.actions.forEach(act => executeActionInPreview(act));
        }
      });
    }
  }, [isPreviewing, activeSceneId]);

  // --- Real-time Event Loop for Conditions (e.g. Collision, Timers, repeat loops) ---
  useEffect(() => {
    if (!isPreviewing) return;
    
    let lastTime = Date.now();
    const timerValues: Record<string, number> = { scene_timer: 0 };
    
    const interval = setInterval(() => {
      const now = Date.now();
      const dt = (now - lastTime) / 1000;
      lastTime = now;
      timerValues.scene_timer += dt;
      
      eventsRef.current.forEach(ev => {
        let allConditionsMet = ev.conditions.length > 0;
        
        ev.conditions.forEach(cond => {
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
          ev.actions.forEach(act => executeActionRef.current(act));
        }
      });
    }, 200);
    
    return () => clearInterval(interval);
  }, [isPreviewing, events, stageElements]);

  // --- Real-time Preview Engine Interpreter ---
  function executeActionInPreview(act: any) {
    switch (act.type) {
      case 'goto_scene':
        if (act.target) {
          const targetScene = scenes.find(s => s.id === act.target);
          if (targetScene) {
            handleSwitchScene(act.target);
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
          osc.frequency.value = 523.25; // C5 Note
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
           const targetObj = gameObjects.find(g => g.id === act.target);
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
        console.log("Executing custom JS action in preview:", act.code);
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

            // Wrap setStageElements to force shallow array reference copies
            // This guarantees React detects updates and re-renders with zero-delay
            const customSetStageElements = (newVal: any) => {
              if (typeof newVal === 'function') {
                setStageElements(prev => {
                  const updated = newVal(prev);
                  return Array.isArray(updated) ? [...updated] : updated;
                });
              } else {
                setStageElements(Array.isArray(newVal) ? [...newVal] : newVal);
              }
            };

            // Pass stageElementsRef.current (always absolute latest value)
            // to runUserCode, ensuring zero stale data delay or overwriting
            runUserCode(
              stageElementsRef.current, customSetStageElements, 
              activeSceneId, handleSwitchScene,
              events, setEvents,
              gameObjects, setGameObjects,
              layers, setLayers,
              activeLayerId, setActiveLayerId
            );
          } catch (err: any) {
            console.error("Custom JS Error:", err);
            alert(`Your custom JavaScript code has an error:\n${err.message}`);
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
        console.log("Unhandled action preview execution:", act.type);
    }
  };

  const handleButtonClickInPreview = (buttonId: string) => {
    if (!buttonId) return;
    console.log("Button clicked in preview:", buttonId);
    const btnEl = stageElementsRef.current.find(e => e.id === buttonId);
    eventsRef.current.forEach(ev => {
      const isPressed = ev.conditions.some(cond => 
        (cond.type === 'pressed' || cond.type === 'pressed_time' || cond.type === 'double_tap' || cond.type === 'click') && 
        (cond.target === buttonId || (btnEl?.buttonId && cond.target === btnEl.buttonId) || (btnEl?.data && cond.target === btnEl.data))
      );
      if (isPressed) {
        console.log("Triggering actions for event:", ev.name);
        ev.actions.forEach(act => executeActionInPreview(act));
      }
    });
  };

  const CONDITIONS_LIST = [
    { type: 'moved', label: 'Moved X' },
    { type: 'collision', label: 'Collision between X and Y' },
    { type: 'pressed', label: 'Clicked / Pressed' },
    { type: 'opacity', label: 'Opacity is X' },
    { type: 'position', label: 'Position is X or Y' },
    { type: 'sound_playing', label: 'Sound is playing' },
    { type: 'color', label: 'Color is...' },
    { type: 'scene_start', label: 'At the beginning of scene' },
    { type: 'pressed_time', label: 'Pressed for X secs' },
    { type: 'animation', label: 'Animation X of character is showing' },
    { type: 'created', label: 'Character created at X, Y' },
    { type: 'double_tap', label: 'Double tap' },
    { type: 'loop', label: 'Repeat X times (Loop)' },
    { type: 'key_pressed', label: 'Key Pressed' },
    { type: 'is_visible', label: 'Is Visible' },
    { type: 'timer', label: 'Timer value > X' },
    { type: 'variable', label: 'Variable value' }
  ];
  const ACTIONS_LIST = [
    { type: 'play_sound', label: 'Play sound' },
    { type: 'show_animation', label: 'Show animation X of character' },
    { type: 'move_to', label: 'Move character to X, Y' },
    { type: 'change_opacity', label: 'Change opacity' },
    { type: 'create_character', label: 'Create character at X, Y' },
    { type: 'change_color', label: 'Change color of character' },
    { type: 'play_animation', label: 'Play animation' },
    { type: 'move_straight', label: 'Move in a straight line to character X' },
    { type: 'move_zigzag', label: 'Move in a zigzag path to character X' },
    { type: 'show_text', label: 'Show text' },
    { type: 'delete_text', label: 'Delete text' },
    { type: 'glow', label: 'Make glow color' },
    { type: 'speed_up', label: 'Increase speed' },
    { type: 'rotate', label: 'Rotate X degrees' },
    { type: 'inc_height', label: 'Increase height (Y axis)' },
    { type: 'inc_width', label: 'Increase width (X axis)' },
    { type: 'vibrate', label: 'Vibrate' },
    { type: 'set_var', label: 'Set Global/Scene Variable' },
    { type: 'js', label: 'Execute JavaScript Code' },
    { type: 'destroy', label: 'Destroy object' },
    { type: 'goto_scene', label: 'Go to scene' },
    { type: 'wait', label: 'Wait X seconds' }
  ];

  // --- Layers State ---
  const [layers, setLayers] = useState([{ id: 'layer_1', name: 'Base Layer' }]);
  const [activeLayerId, setActiveLayerId] = useState<string>('layer_1');
  const [editingLayerId, setEditingLayerId] = useState<string | null>(null);

  // --- Objects State ---
  const [gameObjects, setGameObjects] = useState<{ id: string, name: string, type: string, animations?: {id: string, name: string}[] }[]>([]);
  const [showObjectPicker, setShowObjectPicker] = useState(false);
  const [editingCharacter, setEditingCharacter] = useState<string | null>(null);
  
  // --- Buttons State ---
  const [uiButtons, setUiButtons] = useState<{ id: string, name: string, type: 'image' | 'shape', data?: string, url?: string }[]>([
    { id: 'btn_left', name: 'Left Button', type: 'shape', data: 'https://cdn-icons-png.flaticon.com/512/271/271220.png' },
    { id: 'btn_right', name: 'Right Button', type: 'shape', data: 'https://cdn-icons-png.flaticon.com/512/271/271228.png' },
    { id: 'btn_jump', name: 'Jump Button', type: 'shape', data: 'https://cdn-icons-png.flaticon.com/512/359/359394.png' }
  ]);

  // --- Environment State ---
  const [environments, setEnvironments] = useState<{ id: string, url: string }[]>([]);

  // --- Persistence Logic ---
  useEffect(() => {
    const loadProjectData = async () => {
      if (!projectId) return;
      try {
        const docRef = doc(db, 'projects', projectId);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const data = docSnap.data();
          if (data.scenes) setScenes(data.scenes);
          if (data.sceneElements) setSceneElements(data.sceneElements);
          if (data.sceneEvents) setSceneEvents(data.sceneEvents);
          if (data.gameObjects) setGameObjects(data.gameObjects);
          if (data.uiButtons) setUiButtons(data.uiButtons);
          if (data.environments) setEnvironments(data.environments);
          if (data.layers) setLayers(data.layers);
          if (data.stageBgColor) setStageBgColor(data.stageBgColor);
          if (data.aspectRatio) setAspectRatio(data.aspectRatio);
          if (data.activeSceneId) {
             setActiveSceneId(data.activeSceneId);
             setStageElements(data.sceneElements[data.activeSceneId] || []);
             setEvents(data.sceneEvents[data.activeSceneId] || []);
          }
          if (data.lastSaved) setLastSaved(new Date(data.lastSaved.seconds * 1000));
        }
      } catch (error) {
        console.error("Failed to load project:", error);
      }
    };
    loadProjectData();
  }, [projectId]);

  // Retrieve user email from localStorage
  const userStr = typeof window !== 'undefined' ? localStorage.getItem('app_user') : null;
  const loggedInUser = userStr ? JSON.parse(userStr) : null;
  const userEmail = (loggedInUser?.email || '').toLowerCase().trim();

  // Check connection status on mount and window focus (ensures Back button and popup return are caught instantly)
  useEffect(() => {
    if (!userEmail) return;
    const checkStatus = async () => {
      // Query the backend status API (absolute, server-side source of truth, bypassing client Firestore cache out-of-sync)
      try {
        const response = await fetch(`/api/auth/github/status?email=${encodeURIComponent(userEmail)}`);
        if (response.ok) {
          const data = await response.json();
          if (data.connected) {
            setIsGithubConnected(true);
            setGithubUsername(data.username);
            setGithubMissingScopes(data.missingScopes || []);
            setGithubIsFineGrained(data.isFineGrained || false);
            
            // Save or refresh cache
            localStorage.setItem(`github_conn_${userEmail}`, JSON.stringify({
              connected: true,
              username: data.username,
              avatar_url: data.avatar_url,
              timestamp: Date.now()
            }));
          } else {
            // Check if we have a very recent cache entry (from the last 15 seconds)
            // This prevents a slight network or sync delay from wiping the state immediately after callback
            const cached = localStorage.getItem(`github_conn_${userEmail}`);
            if (cached) {
              try {
                const conn = JSON.parse(cached);
                const isRecent = conn.timestamp && (Date.now() - conn.timestamp < 15000);
                if (isRecent && conn.connected) {
                  setIsGithubConnected(true);
                  setGithubUsername(conn.username || 'Connected');
                  return; // Keep the recent cache for now
                }
              } catch (e) {}
            }

            // Explicitly clear state and cache if connection no longer exists on database and is not recent
            setIsGithubConnected(false);
            setGithubUsername('');
            localStorage.removeItem(`github_conn_${userEmail}`);
          }
        } else {
          throw new Error('Non-ok response from server status check');
        }
      } catch (err) {
        console.error('Failed to check GitHub connection status via API:', err);
        // Fallback to local cache only if API check fails (e.g. offline)
        const cached = localStorage.getItem(`github_conn_${userEmail}`);
        if (cached) {
          try {
            const conn = JSON.parse(cached);
            if (conn.connected) {
              setIsGithubConnected(true);
              setGithubUsername(conn.username || 'Connected');
            }
          } catch (e) {}
        }
      }
    };

    checkStatus();

    const handleFocusOrReturn = async () => {
      await checkStatus();
      setIsConnectingOauth(false);
      
      // Close the popup window if it is still open when returning to the app
      if (authWindowRef.current && !authWindowRef.current.closed) {
        try {
          authWindowRef.current.close();
        } catch (e) {}
        authWindowRef.current = null;
      }
    };

    // Listen to window focus and page visibility (e.g. when returning from a popup or redirect tab)
    window.addEventListener('focus', handleFocusOrReturn);
    
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        handleFocusOrReturn();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('focus', handleFocusOrReturn);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [userEmail]);

  // Poll connection status when the GitHub Connect Modal is active
  // This makes connection 100% robust in iframe, preview, and native wrapper environments where postMessage/focus are unreliable
  useEffect(() => {
    if (!showGithubConnectModal || !userEmail || isGithubConnected) return;

    const pollInterval = setInterval(async () => {
      try {
        const response = await fetch(`/api/auth/github/status?email=${encodeURIComponent(userEmail)}`);
        if (response.ok) {
          const data = await response.json();
          if (data.connected) {
            setIsGithubConnected(true);
            setGithubUsername(data.username);
            setGithubMissingScopes(data.missingScopes || []);
            setGithubIsFineGrained(data.isFineGrained || false);
            
            // Save cache
            localStorage.setItem(`github_conn_${userEmail}`, JSON.stringify({
              connected: true,
              username: data.username,
              avatar_url: data.avatar_url,
              timestamp: Date.now()
            }));

            // Automatically hide connect modal on successful connection
            setShowGithubConnectModal(false);
          }
        }
      } catch (err) {
        console.error('Polling GitHub connection status error:', err);
      }
    }, 1500);

    return () => clearInterval(pollInterval);
  }, [showGithubConnectModal, userEmail, isGithubConnected]);

  const handleGithubConnect = async () => {
    setIsConnectingOauth(true);
    try {
      const clientId = import.meta.env.VITE_GITHUB_CLIENT_ID || 'Ov23likm06wuJwUgR5KV';
      let redirectUri = `${window.location.origin}/auth/callback`;
      
      const isMobileProtocol = window.location.protocol === 'file:' || 
                               window.location.protocol === 'capacitor:' || 
                               window.location.protocol === 'ionic:' ||
                               window.location.protocol === 'app:';
      
      if (isMobileProtocol) {
        // Resolve backend URL (which points to standard https web host) and use it as redirect URI
        const backendUrl = getBackendApiUrl('');
        redirectUri = `${backendUrl.replace(/\/$/, '')}/auth/callback`;
      }
      
      // Generate a secure, high-entropy random state parameter for CSRF defense
      const array = new Uint8Array(16);
      window.crypto.getRandomValues(array);
      const randomState = Array.from(array, dec => dec.toString(16).padStart(2, "0")).join("");

      console.log("[GameCreatorStudio] [TEMP LOG] Generated state at login:", randomState);

      // Persist state and current email in cookies and localStorage
      document.cookie = `github_oauth_state=${randomState}; max-age=300; path=/; SameSite=Lax; Secure`;
      document.cookie = `github_oauth_email=${userEmail}; max-age=300; path=/; SameSite=Lax; Secure`;
      localStorage.setItem('github_oauth_state', randomState);
      localStorage.setItem('github_oauth_email', userEmail);
      
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        scope: 'repo workflow admin:repo_hook delete_repo read:user user:email',
        state: randomState,
        prompt: 'consent'
      });
      
      const authUrl = `https://github.com/login/oauth/authorize?${params.toString()}`;
      
      const authWindow = window.open(
        authUrl,
        'oauth_popup',
        'width=600,height=700,status=yes,toolbar=no,menubar=no,location=yes'
      );
      
      if (!authWindow) {
        setIsConnectingOauth(false);
        alert('Please allow popups for this site to connect your GitHub account.');
      } else {
        authWindowRef.current = authWindow;
      }
    } catch (error: any) {
      setIsConnectingOauth(false);
      console.error('OAuth connection error:', error);
      alert('Failed to initiate GitHub connection: ' + (error.message || String(error)));
    }
  };

  const handlePatConnect = async () => {
    if (!patToken.trim()) {
      setPatError('Please enter a Personal Access Token');
      return;
    }
    setIsVerifyingPat(true);
    setPatError(null);
    try {
      const response = await fetch('https://api.github.com/user', {
        headers: {
          'Authorization': `Bearer ${patToken.trim()}`,
          'Accept': 'application/json'
        }
      });
      if (!response.ok) {
        throw new Error('Invalid token. Make sure the token is active and correct.');
      }
      
      const scopesHeader = response.headers.get('x-oauth-scopes') || '';
      const isFineGrained = patToken.trim().startsWith('github_pat_');
      
      if (!isFineGrained) {
        const scopes = scopesHeader.split(',').map(s => s.trim());
        const missing: string[] = [];
        if (!scopes.includes('repo')) missing.push('repo');
        if (!scopes.includes('workflow')) missing.push('workflow');
        if (!scopes.includes('admin:repo_hook')) missing.push('admin:repo_hook');
        if (!scopes.includes('delete_repo')) missing.push('delete_repo');
        
        const hasUserScope = scopes.includes('user');
        if (!hasUserScope && !scopes.includes('read:user')) missing.push('read:user');
        if (!hasUserScope && !scopes.includes('user:email')) missing.push('user:email');
        
        if (missing.length > 0) {
          throw new Error(`Token is missing the following required classic scopes: ${missing.join(', ')}. Please update your Classic PAT scopes.`);
        }
      }
      
      const data = await response.json();
      const login = data.login || 'GitHub User';
      const avatarUrl = data.avatar_url || '';
      
      // Save to firestore client-side
      const connectionRef = doc(db, 'github_connections', userEmail);
      await setDoc(connectionRef, {
        email: userEmail,
        access_token: patToken.trim(),
        username: login,
        avatar_url: avatarUrl,
        connectedAt: new Date().toISOString()
      });
      
      // Save cache
      localStorage.setItem(`github_conn_${userEmail}`, JSON.stringify({
        connected: true,
        username: login,
        avatar_url: avatarUrl,
        accessToken: patToken.trim()
      }));
      
      setIsGithubConnected(true);
      setGithubUsername(login);
      setGithubMissingScopes([]);
      setGithubIsFineGrained(isFineGrained);
      setShowGithubConnectModal(false);
      alert(`Successfully connected to GitHub as @${login}!`);
    } catch (err: any) {
      console.error('PAT Verification error:', err);
      setPatError(err.message || 'Verification failed. Please double check your token.');
    } finally {
      setIsVerifyingPat(false);
    }
  };

  const handleDisconnectGithub = async () => {
    if (!userEmail) {
      alert("Missing user email context. Cannot disconnect.");
      return;
    }
    setIsDisconnectingGithub(true);
    try {
      // 1. Call backend API to delete the connection securely server-side
      const response = await fetch('/api/auth/github/disconnect', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email: userEmail })
      });
      
      if (!response.ok) {
        throw new Error('Server disconnect failed');
      }

      // Also attempt client-side delete as backup (may fail if unauthenticated, but we handle it gracefully)
      try {
        await deleteDoc(doc(db, 'github_connections', userEmail));
      } catch (firestoreErr) {
        console.warn('Optional client-side firestore delete failed:', firestoreErr);
      }
      
      // 2. Clear local storage cache
      localStorage.removeItem(`github_conn_${userEmail}`);
      
      // 3. Reset React state
      setIsGithubConnected(false);
      setGithubUsername('');
      setGithubMissingScopes([]);
      setGithubIsFineGrained(false);
      
      alert('Successfully disconnected from your GitHub account.');
    } catch (err: any) {
      console.error('Failed to disconnect from GitHub:', err);
      alert('Failed to disconnect: ' + (err.message || String(err)));
    } finally {
      setIsDisconnectingGithub(false);
    }
  };

  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        setShowGithubConnectModal(false);
        setIsGithubConnected(true);
        
        try {
          const response = await fetch(`/api/auth/github/status?email=${encodeURIComponent(userEmail)}`);
          if (response.ok) {
            const data = await response.json();
            if (data.connected) {
              setGithubUsername(data.username);
              setGithubMissingScopes(data.missingScopes || []);
              setGithubIsFineGrained(data.isFineGrained || false);
              localStorage.setItem(`github_conn_${userEmail}`, JSON.stringify({
                connected: true,
                username: data.username,
                avatar_url: data.avatar_url,
                timestamp: Date.now()
              }));
            }
          }
        } catch (e) {
          console.error('Failed to refresh status after oauth success:', e);
        }
        
        alert('GitHub account connected successfully!');
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [userEmail]);

  const handleSaveProject = async (manual = true) => {
    if (!projectId || isSaving) return;
    setIsSaving(true);
    try {
      const projectData = {
        projectId,
        projectName: projectName || 'Untitled Project',
        scenes,
        sceneElements: { ...sceneElements, [activeSceneId]: stageElements },
        sceneEvents: { ...sceneEvents, [activeSceneId]: events },
        gameObjects,
        uiButtons,
        environments,
        layers,
        stageBgColor,
        aspectRatio,
        activeSceneId,
        lastSaved: serverTimestamp()
      };
      await setDoc(doc(db, 'projects', projectId), projectData);
      setLastSaved(new Date());
      if (manual && typeof onSave === 'function') {
        onSave();
      }
    } catch (error) {
      console.error("Save failed:", error);
    } finally {
      setIsSaving(false);
    }
  };

  useEffect(() => {
    if (!autoSave || isPreviewing) return;
    
    const timeout = setTimeout(() => {
      handleSaveProject(false);
    }, 5000);

    return () => clearTimeout(timeout);
  }, [scenes, stageElements, events, gameObjects, uiButtons, environments, layers, stageBgColor, aspectRatio, autoSave, isPreviewing]);

  useEffect(() => {
    const handleBeforeUnload = () => {
      if (autoSave) {
        handleSaveProject(false);
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [autoSave, scenes, stageElements, events, gameObjects, uiButtons, environments, layers, stageBgColor, aspectRatio]);

  // Synchronize buttons on stage with uiButtons
  useEffect(() => {
    const buttonsOnStage = stageElements.filter(el => el.type === 'btn');
    let updated = false;
    const newUiButtons = [...uiButtons];
    
    buttonsOnStage.forEach(el => {
      if (!el.buttonId) {
        el.buttonId = `btn_${el.id.split('_')[1] || Date.now()}`;
      }
      const exists = newUiButtons.some(b => b.id === el.buttonId);
      if (!exists) {
        newUiButtons.push({
          id: el.buttonId,
          name: el.text || `Button ${newUiButtons.length + 1}`,
          type: el.url ? 'image' : 'shape',
          data: el.url ? null : el.data,
          url: el.url
        } as any);
        updated = true;
      }
    });
    
    if (updated) {
      setUiButtons(newUiButtons);
    }
  }, [stageElements]);

  const OBJECT_TYPES = [
    { type: 'character', label: 'Character', icon: Box },
    { type: 'enemy', label: 'Enemy', icon: Box },
    { type: 'text', label: 'Text', icon: FileCode2 },
    { type: 'collectible', label: 'Collectible', icon: Play }
  ];



  const handleSwitchScene = (newSceneId: string) => {
    setSceneElements(prev => ({
      ...prev,
      [activeSceneId]: stageElements
    }));
    setSceneEvents(prev => ({
      ...prev,
      [activeSceneId]: events
    }));
    
    setStageElements(sceneElements[newSceneId] || []);
    setEvents(sceneEvents[newSceneId] || [{ id: `ev_${Date.now()}`, conditions: [], actions: [] }]);
    
    setActiveSceneId(newSceneId);
    setSelectedElementId(null);
  };

  const handleDeleteScene = (sceneIdToDelete: string) => {
    const newScenes = scenes.filter(s => s.id !== sceneIdToDelete);
    setScenes(newScenes);
    
    const newSceneElements = { ...sceneElements };
    delete newSceneElements[sceneIdToDelete];
    const newSceneEvents = { ...sceneEvents };
    delete newSceneEvents[sceneIdToDelete];
    setSceneElements(newSceneElements);
    setSceneEvents(newSceneEvents);

    if (activeSceneId === sceneIdToDelete) {
      const fallbackSceneId = newScenes[0]?.id || 'scene_1';
      setStageElements(newSceneElements[fallbackSceneId] || []);
      setEvents(newSceneEvents[fallbackSceneId] || [{ id: `ev_${Date.now()}`, conditions: [], actions: [] }]);
      setActiveSceneId(fallbackSceneId);
    }
    setSelectedElementId(null);
  };

  const handleAddScene = () => {
    setSceneElements(prev => ({
      ...prev,
      [activeSceneId]: stageElements
    }));
    setSceneEvents(prev => ({
      ...prev,
      [activeSceneId]: events
    }));

    const newId = `scene_${Date.now()}`;
    setScenes([...scenes, { id: newId, name: `Scene ${scenes.length + 1}` }]);
    
    setStageElements([]);
    setEvents([{ id: `ev_${Date.now()}`, conditions: [], actions: [] }]);
    setActiveSceneId(newId);
    setSelectedElementId(null);
  };

  const renderConditionDropdown = (label: string, cond: any, evIndex: number, condIndex: number, key: string, options: {id: string, name: string, url?: string, data?: string}[]) => {
    const selectedId = cond[key] || '';
    const selectedOpt = options.find(opt => opt.id === selectedId);
    const previewUrl = selectedOpt ? ((selectedOpt as any).url || (selectedOpt as any).data) : null;

    return (
      <div className="flex items-center gap-2 mt-2 w-full">
        <span className="text-gray-400 shrink-0 text-xs">{label}:</span>
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <select 
            className="bg-black/60 border border-white/10 rounded px-2 py-1 text-white text-xs outline-none focus:border-cyan-500/50 flex-1 min-w-0"
            value={selectedId}
            onChange={(e) => {
              const newEvents = [...events];
              newEvents[evIndex].conditions[condIndex][key] = e.target.value;
              setEvents(newEvents);
            }}
          >
            <option value="" disabled>Select...</option>
            {options.map(opt => <option key={opt.id} value={opt.id}>{opt.name}</option>)}
          </select>
          {previewUrl && (
            <div className="w-6 h-6 rounded border border-white/20 bg-zinc-800 flex items-center justify-center overflow-hidden shrink-0" title="Button Preview">
              <img src={previewUrl} className="max-w-full max-h-full object-contain" alt="preview" referrerPolicy="no-referrer" />
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderActionDropdown = (label: string, act: any, evIndex: number, actIndex: number, key: string, options: {id: string, name: string, url?: string, data?: string}[]) => {
    const selectedId = act[key] || '';
    const selectedOpt = options.find(opt => opt.id === selectedId);
    const previewUrl = selectedOpt ? ((selectedOpt as any).url || (selectedOpt as any).data) : null;

    return (
      <div className="flex items-center gap-2 mt-2 w-full">
        <span className="text-gray-400 shrink-0 text-xs">{label}:</span>
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <select 
            className="bg-black/60 border border-white/10 rounded px-2 py-1 text-white text-xs outline-none focus:border-purple-500/50 flex-1 min-w-0"
            value={selectedId}
            onChange={(e) => {
              const newEvents = [...events];
              newEvents[evIndex].actions[actIndex][key] = e.target.value;
              setEvents(newEvents);
            }}
          >
            <option value="" disabled>Select...</option>
            {options.map(opt => <option key={opt.id} value={opt.id}>{opt.name}</option>)}
          </select>
          {previewUrl && (
            <div className="w-6 h-6 rounded border border-white/20 bg-zinc-800 flex items-center justify-center overflow-hidden shrink-0" title="Button Preview">
              <img src={previewUrl} className="max-w-full max-h-full object-contain" alt="preview" referrerPolicy="no-referrer" />
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderInput = (label: string, obj: any, evIndex: number, idx: number, key: string, isAction: boolean, type = "text") => (
    <div className="flex items-center gap-2 mt-2">
      <span className="text-gray-400">{label}:</span>
      <input 
        type={type}
        className={`bg-black/40 border border-white/10 rounded px-2 py-1 text-white outline-none w-24 ${isAction ? 'focus:border-purple-500/50' : 'focus:border-cyan-500/50'}`}
        value={obj[key] || ''}
        onChange={(e) => {
          const newEvents = [...events];
          if (isAction) newEvents[evIndex].actions[idx][key] = e.target.value;
          else newEvents[evIndex].conditions[idx][key] = e.target.value;
          setEvents(newEvents);
        }}
      />
    </div>
  );

  const availableObjects = gameObjects;

  return (
    <div className="w-full h-screen bg-[#050505] text-white flex flex-col relative overflow-hidden font-sans">
      {/* TOP HEADER */}
      <header className="h-14 border-b border-white/10 flex items-center justify-between px-2 sm:px-4 shrink-0 bg-[#0a0a0c] overflow-x-auto custom-scrollbar gap-4">
        
        {/* Left: Back & Scenes */}
        <div className="flex items-center gap-3 sm:gap-6 h-full shrink-0">
          <button 
            onClick={async () => {
              if (autoSave) {
                await handleSaveProject(false);
              }
              onBack();
            }}
            className="text-gray-400 hover:text-white transition-colors flex items-center gap-1.5 text-xs font-bold shrink-0"
          >
            <ArrowLeft size={16} /> <span className="hidden sm:inline">Back</span>
          </button>

          <div className="h-4 w-px bg-white/10 shrink-0" />

          {/* Scene Tabs */}
          <div className="flex items-end h-full gap-1 pt-2 shrink-0">
            {scenes.map(scene => (
              <button
                key={scene.id}
                onClick={() => handleSwitchScene(scene.id)}
                className={`px-4 py-2 text-xs font-bold rounded-t-lg border-t border-x transition-all flex items-center gap-2 ${
                  activeSceneId === scene.id 
                    ? 'bg-[#151518] border-white/10 text-cyan-400' 
                    : 'bg-transparent border-transparent text-gray-500 hover:text-gray-300 hover:bg-white/5'
                }`}
              >
                {scene.name}
                {scenes.length > 1 && (
                  <X 
                    size={12} 
                    className="opacity-50 hover:opacity-100 transition-opacity" 
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteScene(scene.id);
                    }}
                  />
                )}
              </button>
            ))}
            <button 
              onClick={handleAddScene}
              className="px-3 py-2 text-gray-500 hover:text-white transition-colors mb-1"
            >
              <Plus size={16} />
            </button>
          </div>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <button 
            onClick={() => setIsPreviewing(!isPreviewing)}
            className={`px-3 sm:px-4 py-1.5 rounded-lg text-xs font-bold flex items-center gap-2 transition-all shrink-0 ${
              isPreviewing 
                ? 'bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20' 
                : 'bg-green-500 hover:bg-green-400 text-black shadow-[0_0_15px_rgba(34,197,94,0.2)]'
            }`}
          >
            {isPreviewing ? <MonitorPlay size={14} /> : <Play size={14} fill="currentColor" />}
            {isPreviewing ? 'Stop Preview' : <span className="hidden sm:inline">Preview in Realtime</span>}
            {!isPreviewing && <span className="sm:hidden">Preview</span>}
          </button>
          
          <button 
            onClick={() => setShowExportModal(true)}
            className="px-2 sm:px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-gray-300 hover:text-white rounded-lg text-xs font-bold flex items-center gap-2 border border-white/5 transition-all shrink-0"
          >
            <Download size={14} /> <span className="hidden sm:inline">Export APK</span>
            <span className="sm:hidden">Export</span>
          </button>
          
          <button 
            onClick={() => setShowSettings(true)}
            className="p-1.5 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-all shrink-0"
          >
            <Settings size={18} />
          </button>
        </div>
      </header>

      {/* MAIN CONTENT AREA */}
      <div className="flex-1 flex flex-col overflow-hidden">
        
        {/* TOP: Canvas / Stage Area */}
        <div ref={stageParentRef} className={`${activeBottomTab === 'events' ? 'hidden' : 'flex-1'} relative bg-[#0a0a0c] p-6 flex flex-col items-center justify-center min-h-[40vh] overflow-hidden`}>
          {/* Canvas Wrapper - maintain aspect ratio */}
          <div 
            style={{
              width: `${VIRTUAL_WIDTH}px`,
              height: `${VIRTUAL_HEIGHT}px`,
              transform: `scale(${scale})`,
              transformOrigin: 'center',
              backgroundColor: stageBgColor,
            }}
            className={`transition-all duration-300 shadow-2xl relative overflow-hidden flex items-center justify-center shrink-0 ${
              aspectRatio === 'portrait' 
                ? 'border-[12px] border-zinc-800 rounded-[32px] ring-4 ring-zinc-900/50' 
                : 'border-2 border-white/5 rounded-xl'
            }`}
            onClick={() => {
              if (isPreviewing) {
                setIsPreviewing(false);
              }
              setSelectedElementId(null);
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (isPreviewing) return; // Disable drop during preview
              if (draggedElement) return; // Fix duplication: ignore drops when moving stage elements
              const type = e.dataTransfer.getData('type');
              const id = e.dataTransfer.getData('id');
              const rect = e.currentTarget.getBoundingClientRect();
              const x = (e.clientX - rect.left) / scale;
              const y = (e.clientY - rect.top) / scale;
              
              if (type === 'bg') {
                const env = environments.find(e => e.id === id);
                if (env) {
                  setStageElements([...stageElements, { id: `el_${Date.now()}`, type: 'bg', url: env.url, x: 0, y: 0, width: rect.width, height: rect.height, layerId: activeLayerId }]);
                }
              } else if (type === 'btn') {
                const btn = uiButtons.find(b => b.id === id);
                if (btn) {
                   setStageElements([...stageElements, { id: `el_${Date.now()}`, type: 'btn', buttonId: btn.id, data: btn.data, url: btn.type === 'image' ? (btn as any).url : null, x: x - 25, y: y - 25, width: 50, height: 50, layerId: activeLayerId }]);
                }
              }
            }}
          >
            {/* Render Stage Elements */}
            {stageElements.map(el => {
              const gameObject = (el.type === 'obj' || el.type === 'enemy' as any) ? gameObjects.find(o => o.id === el.data) : null;
              const firstAnim = gameObject?.animations?.[0];
              const isButton = el.type === 'btn';
              const isText = gameObject?.type === 'text';

              // Calculate dynamic z-index based on layer
              const layerIdx = layers.findIndex(l => l.id === (el as any).layerId);
              const layerZ = layerIdx === -1 ? 10 : (layers.length - layerIdx) * 10;
              const finalZ = isText ? layerZ + 2000 : (selectedElementId === el.id ? 5000 : layerZ);
              
              return (
              <div
                key={el.id}
                className={`absolute ${(!isPreviewing && selectedElementId === el.id) ? 'ring-2 ring-cyan-500' : ''}`}
                style={{
                  left: el.type === 'bg' ? 0 : el.x,
                  top: el.type === 'bg' ? 0 : el.y,
                  width: el.type === 'bg' ? '100%' : el.width,
                  height: el.type === 'bg' ? '100%' : el.height,
                  backgroundImage: (el.type !== 'obj' && (el.url || el.data)) ? `url(${el.url || el.data})` : undefined,
                  backgroundSize: '100% 100%',
                  backgroundRepeat: 'no-repeat',
                  backgroundColor: (!el.url && !el.data && el.type === 'btn') ? 'rgba(236,72,153,0.2)' : undefined,
                  zIndex: el.type === 'bg' ? 0 : finalZ,
                  cursor: isPreviewing ? (isButton ? 'pointer' : 'default') : 'move',
                  opacity: el.opacity !== undefined ? el.opacity : 1,
                  filter: el.colorFilter ? `hue-rotate(90deg) drop-shadow(0 0 8px ${el.colorFilter})` : undefined,
                  pointerEvents: isPreviewing ? (isButton ? 'auto' : 'none') : 'auto'
                }}
                draggable={!isPreviewing}
                onClick={(e) => {
                  e.stopPropagation();
                  if (isPreviewing) {
                    handleButtonClickInPreview(el.id);
                  } else {
                    setSelectedElementId(el.id);
                    setActiveBottomTab('properties');
                  }
                }}
                onDragStart={(e) => {
                  if (isPreviewing) return;
                  e.stopPropagation();
                  setDraggedElement({ id: el.id, offsetX: e.clientX - (el.x * scale), offsetY: e.clientY - (el.y * scale) });
                  setSelectedElementId(el.id);
                  setActiveBottomTab('properties');
                }}
                onDragEnd={(e) => {
                  if (isPreviewing) return;
                  e.stopPropagation();
                  if (draggedElement) {
                    const rect = (e.target as HTMLElement).parentElement?.getBoundingClientRect();
                    if (rect) {
                      const newX = (e.clientX - rect.left - draggedElement.offsetX) / scale;
                      const newY = (e.clientY - rect.top - draggedElement.offsetY) / scale;
                      setStageElements(stageElements.map(s => s.id === el.id ? { ...s, x: newX, y: newY } : s));
                    }
                    setDraggedElement(null);
                  }
                }}
              >
                {el.type === 'obj' && gameObject?.type === 'text' ? (
                  <div 
                    className="w-full h-full flex items-center select-text"
                    style={{
                      fontSize: `${gameObject.fontSize ?? 24}px`,
                      color: gameObject.color ?? '#ffffff',
                      fontFamily: gameObject.fontFamily ?? 'Inter, sans-serif',
                      fontWeight: gameObject.bold !== false ? 'bold' : 'normal',
                      fontStyle: gameObject.italic ? 'italic' : 'normal',
                      textAlign: gameObject.align ?? 'center',
                      justifyContent: gameObject.align === 'left' ? 'flex-start' : gameObject.align === 'right' ? 'flex-end' : 'center',
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
                  <div className="w-full h-full bg-cyan-500/20 border border-cyan-500/50 flex flex-col items-center justify-center text-[10px] text-cyan-400 font-bold p-1 text-center">
                    {gameObject?.name || 'Object'}
                    <span className="opacity-50 text-[8px]">No Anim</span>
                  </div>
                ) : null}
                {el.isToast && (
                  <div className="w-full h-full bg-black/95 text-yellow-400 border border-yellow-500/80 rounded px-3 py-1 text-xs font-mono font-bold flex items-center justify-center shadow-lg text-center animate-bounce">
                    {el.text}
                  </div>
                )}
                {/* Controls for resizing */}
                {!isPreviewing && (
                  <div 
                    className="absolute bottom-0 right-0 w-3 h-3 bg-white border border-black cursor-se-resize opacity-0 hover:opacity-100"
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      const startX = e.clientX;
                      const startY = e.clientY;
                      const startW = el.width;
                      const startH = el.height;
                      
                      const onMouseMove = (moveEv: MouseEvent) => {
                        const newW = Math.max(20, startW + (moveEv.clientX - startX) / scale);
                        const newH = Math.max(20, startH + (moveEv.clientY - startY) / scale);
                        setStageElements(prev => prev.map(s => s.id === el.id ? { ...s, width: newW, height: newH } : s));
                      };
                      
                      const onMouseUp = () => {
                        window.removeEventListener('mousemove', onMouseMove);
                        window.removeEventListener('mouseup', onMouseUp);
                      };
                      
                      window.addEventListener('mousemove', onMouseMove);
                      window.addEventListener('mouseup', onMouseUp);
                    }}
                  />
                )}
              </div>
              )
            })}
            
            {isPreviewing && stageElements.length === 0 && stageBgColor === '#111111' ? (
              <div className="text-green-400 text-sm font-mono flex flex-col items-center gap-2">
                <Play size={32} className="animate-pulse" />
                <span>Game Running...</span>
              </div>
            ) : (!isPreviewing && stageElements.length === 0 && stageBgColor === '#111111') ? (
              <div className="text-gray-600 text-sm font-medium flex flex-col items-center gap-3">
                <ImageIcon size={48} className="opacity-20" />
                <span>Main Stage Area - {scenes.find(s => s.id === activeSceneId)?.name}</span>
              </div>
            ) : null}
          </div>
        </div>

        {/* MIDDLE: Tab Bar */}
        <div className="h-12 border-y border-white/10 bg-[#0f0f12] flex items-center justify-start sm:justify-center gap-2 px-2 sm:px-4 shrink-0 shadow-lg z-10 relative overflow-x-auto custom-scrollbar">
          {[
            { id: 'events', label: 'Events', icon: FileCode2 },
            { id: 'layers', label: 'Layers', icon: Layers },
            { id: 'objects', label: 'Objects', icon: Box },
            { id: 'buttons', label: 'Buttons', icon: MousePointerClick },
            { id: 'environment', label: 'Environment', icon: ImageIcon },
            { id: 'properties', label: 'Properties', icon: Sliders }
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeBottomTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveBottomTab(tab.id as BottomTab)}
                className={`px-4 sm:px-5 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 shrink-0 ${
                  isActive 
                    ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 shadow-[0_0_10px_rgba(6,182,212,0.1)]' 
                    : 'text-gray-400 hover:text-white hover:bg-white/5 border border-transparent'
                }`}
              >
                <Icon size={14} /> {tab.label}
              </button>
            )
          })}
        </div>

        {/* BOTTOM: Panel Content */}
        <div className={`${(activeBottomTab === 'events' || activeBottomTab === 'properties') ? 'flex-1' : 'h-1/3 min-h-[250px]'} bg-[#151518] p-4 overflow-y-auto`}>
          <AnimatePresence mode="wait">
            <motion.div
              key={activeBottomTab}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className="h-full"
            >
              {activeBottomTab === 'properties' && (
                <div className="flex flex-col h-full max-w-4xl mx-auto text-xs">
                  <div className="flex items-center justify-between mb-4 shrink-0">
                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                      <Settings size={16} className="text-cyan-400 animate-spin-slow" /> Element Properties
                    </h3>
                    {selectedElementId && (
                      <button
                        onClick={() => setSelectedElementId(null)}
                        className="text-xs text-gray-400 hover:text-white px-2 py-1 bg-white/5 rounded-lg border border-white/5 transition-all"
                      >
                        Deselect
                      </button>
                    )}
                  </div>

                  {!selectedElementId ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-gray-500 text-xs border border-dashed border-white/10 rounded-2xl p-8 bg-zinc-950/20">
                      <Settings size={32} className="mb-2 opacity-30 animate-pulse" />
                      <p className="text-center font-medium text-gray-400">No element selected</p>
                      <p className="text-center text-gray-500 mt-1 max-w-xs">Click on any object, button, or background on the stage above to view and edit its properties downwards here.</p>
                    </div>
                  ) : (
                    (() => {
                      const el = stageElements.find(item => item.id === selectedElementId);
                      if (!el) {
                        return (
                          <div className="flex-1 flex flex-col items-center justify-center text-gray-500 text-xs border border-dashed border-white/10 rounded-2xl p-8 bg-zinc-950/20">
                            <Settings size={32} className="mb-2 opacity-30" />
                            <p className="text-center font-medium text-gray-400">Element not found</p>
                          </div>
                        );
                      }
                      const gameObject = el.type === 'obj' ? gameObjects.find(o => o.id === el.data) : null;
                      const isText = gameObject?.type === 'text';

                      return (
                        <div className="flex-1 overflow-y-auto grid grid-cols-1 md:grid-cols-3 gap-6 pb-4">
                          {/* Column 1: Core Transform */}
                          <div className="bg-zinc-900/40 border border-white/5 rounded-xl p-4 flex flex-col gap-4">
                            <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider border-b border-white/5 pb-2">Transform</h4>
                            
                            <div className="flex flex-col gap-1.5">
                              <div className="flex justify-between items-center text-xs">
                                <label className="text-gray-400 font-medium">X Position</label>
                                <span className="text-cyan-400 font-mono font-bold bg-cyan-950/30 px-1.5 py-0.5 rounded border border-cyan-500/10">{Math.round(el.x || 0)}px</span>
                              </div>
                              <input 
                                type="range" 
                                min="-100" 
                                max="1000" 
                                className="accent-cyan-500 h-1.5 w-full cursor-pointer" 
                                value={el.x ?? 0} 
                                onChange={(e) => setStageElements(stageElements.map(item => item.id === selectedElementId ? {...item, x: Number(e.target.value)} : item))} 
                              />
                            </div>

                            <div className="flex flex-col gap-1.5">
                              <div className="flex justify-between items-center text-xs">
                                <label className="text-gray-400 font-medium">Y Position</label>
                                <span className="text-cyan-400 font-mono font-bold bg-cyan-950/30 px-1.5 py-0.5 rounded border border-cyan-500/10">{Math.round(el.y || 0)}px</span>
                              </div>
                              <input 
                                type="range" 
                                min="-100" 
                                max="1000" 
                                className="accent-cyan-500 h-1.5 w-full cursor-pointer" 
                                value={el.y ?? 0} 
                                onChange={(e) => setStageElements(stageElements.map(item => item.id === selectedElementId ? {...item, y: Number(e.target.value)} : item))} 
                              />
                            </div>

                            <div className="flex flex-col gap-1.5">
                              <div className="flex justify-between items-center text-xs">
                                <label className="text-gray-400 font-medium">Scale (Width)</label>
                                <span className="text-cyan-400 font-mono font-bold bg-cyan-950/30 px-1.5 py-0.5 rounded border border-cyan-500/10">{Math.round(el.width || 0)}px</span>
                              </div>
                              <input 
                                type="range" 
                                min="10" 
                                max="1000" 
                                className="accent-cyan-500 h-1.5 w-full cursor-pointer" 
                                value={el.width ?? 50} 
                                onChange={(e) => {
                                   const val = Number(e.target.value);
                                   setStageElements(stageElements.map(item => {
                                     if (item.id === selectedElementId) {
                                       const ratio = item.height / item.width;
                                       return {...item, width: val, height: val * ratio || val};
                                     }
                                     return item;
                                   }));
                                }} 
                              />
                            </div>
                          </div>

                          {/* Column 2: Styling or Text Config */}
                          <div className="bg-zinc-900/40 border border-white/5 rounded-xl p-4 flex flex-col gap-4">
                            <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider border-b border-white/5 pb-2">Properties & Design</h4>
                            
                            {isText && gameObject ? (
                              <div className="flex flex-col gap-3">
                                <div className="flex flex-col gap-1">
                                  <label className="text-xs text-gray-400 font-medium">Text Content</label>
                                  <input 
                                    type="text" 
                                    className="bg-black/60 border border-white/10 rounded-lg px-3 py-1.5 text-white outline-none focus:border-cyan-500 text-xs transition-colors" 
                                    value={gameObject.textContent ?? gameObject.name ?? ''} 
                                    onChange={(e) => {
                                      setGameObjects(gameObjects.map(o => o.id === gameObject.id ? { ...o, textContent: e.target.value, name: e.target.value } : o));
                                    }} 
                                  />
                                </div>

                                <div className="flex flex-col gap-1.5">
                                  <div className="flex justify-between items-center text-xs">
                                    <label className="text-gray-400 font-medium">Font Size</label>
                                    <span className="text-cyan-400 font-mono font-bold bg-cyan-950/30 px-1.5 py-0.5 rounded border border-cyan-500/10">{gameObject.fontSize ?? 24}px</span>
                                  </div>
                                  <input 
                                    type="range" 
                                    min="8" 
                                    max="120" 
                                    className="accent-cyan-500 h-1.5 w-full cursor-pointer" 
                                    value={gameObject.fontSize ?? 24} 
                                    onChange={(e) => {
                                      setGameObjects(gameObjects.map(o => o.id === gameObject.id ? { ...o, fontSize: Number(e.target.value) } : o));
                                    }} 
                                  />
                                </div>

                                <div className="flex flex-col gap-1">
                                  <label className="text-xs text-gray-400 font-medium">Text Color</label>
                                  <div className="flex items-center gap-3 bg-black/40 border border-white/5 rounded-lg p-1.5">
                                    <input 
                                      type="color" 
                                      className="w-8 h-8 rounded border border-white/10 cursor-pointer bg-transparent" 
                                      value={gameObject.color ?? '#ffffff'} 
                                      onChange={(e) => {
                                        setGameObjects(gameObjects.map(o => o.id === gameObject.id ? { ...o, color: e.target.value } : o));
                                      }} 
                                    />
                                    <span className="font-mono text-xs text-gray-300 uppercase tracking-wider">{gameObject.color ?? '#ffffff'}</span>
                                  </div>
                                </div>

                                <div className="flex flex-col gap-1">
                                  <label className="text-xs text-gray-400 font-medium">Font Family</label>
                                  <select 
                                    className="bg-black/60 border border-white/10 rounded-lg px-3 py-1.5 text-white outline-none focus:border-cyan-500 text-xs transition-colors cursor-pointer"
                                    value={gameObject.fontFamily ?? 'sans-serif'} 
                                    onChange={(e) => {
                                      setGameObjects(gameObjects.map(o => o.id === gameObject.id ? { ...o, fontFamily: e.target.value } : o));
                                    }}
                                  >
                                    <option value="sans-serif">Sans-Serif</option>
                                    <option value="serif">Serif</option>
                                    <option value="monospace">Monospace</option>
                                    <option value="Space Grotesk">Space Grotesk</option>
                                    <option value="Inter">Inter</option>
                                    <option value="JetBrains Mono">JetBrains Mono</option>
                                    <option value="Arial">Arial</option>
                                    <option value="Georgia">Georgia</option>
                                  </select>
                                </div>

                                <div className="flex flex-col gap-1">
                                  <label className="text-xs text-gray-400 font-medium">Style & Alignment</label>
                                  <div className="flex items-center gap-1 bg-black/40 border border-white/5 rounded-lg p-1.5">
                                    {/* Bold Toggle */}
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setGameObjects(gameObjects.map(o => o.id === gameObject.id ? { ...o, bold: o.bold === false ? true : false } : o));
                                      }}
                                      className={`h-7 px-2.5 rounded font-bold text-xs border transition-all ${gameObject.bold !== false ? 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30' : 'bg-black/40 text-gray-400 border-white/5'}`}
                                    >
                                      B
                                    </button>
                                    {/* Italic Toggle */}
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setGameObjects(gameObjects.map(o => o.id === gameObject.id ? { ...o, italic: !o.italic } : o));
                                      }}
                                      className={`h-7 px-2.5 rounded italic text-xs border transition-all ${gameObject.italic ? 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30' : 'bg-black/40 text-gray-400 border-white/5'}`}
                                    >
                                      I
                                    </button>
                                    <div className="w-px h-5 bg-white/10 mx-1" />
                                    {/* Align Left */}
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setGameObjects(gameObjects.map(o => o.id === gameObject.id ? { ...o, align: 'left' } : o));
                                      }}
                                      className={`h-7 px-2 rounded text-[10px] border transition-all ${gameObject.align === 'left' ? 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30' : 'bg-black/40 text-gray-400 border-white/5'}`}
                                    >
                                      Left
                                    </button>
                                    {/* Align Center */}
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setGameObjects(gameObjects.map(o => o.id === gameObject.id ? { ...o, align: 'center' } : o));
                                      }}
                                      className={`h-7 px-2 rounded text-[10px] border transition-all ${gameObject.align === 'center' || !gameObject.align ? 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30' : 'bg-black/40 text-gray-400 border-white/5'}`}
                                    >
                                      Center
                                    </button>
                                    {/* Align Right */}
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setGameObjects(gameObjects.map(o => o.id === gameObject.id ? { ...o, align: 'right' } : o));
                                      }}
                                      className={`h-7 px-2 rounded text-[10px] border transition-all ${gameObject.align === 'right' ? 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30' : 'bg-black/40 text-gray-400 border-white/5'}`}
                                    >
                                      Right
                                    </button>
                                  </div>
                                </div>
                              </div>
                            ) : (
                              <div className="text-gray-500 text-xs py-4 flex flex-col items-center justify-center h-full text-center">
                                <Box size={24} className="mb-2 opacity-20" />
                                <span>No special properties for this element type ({el.type})</span>
                              </div>
                            )}
                          </div>

                          {/* Column 3: Actions & Details */}
                          <div className="bg-zinc-900/40 border border-white/5 rounded-xl p-4 flex flex-col justify-between gap-4">
                            <div>
                              <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider border-b border-white/5 pb-2 mb-3">Element Info</h4>
                              <div className="space-y-2 text-xs">
                                <div className="flex justify-between py-1 border-b border-white/5">
                                  <span className="text-gray-500">Element ID</span>
                                  <span className="text-gray-300 font-mono">{el.id}</span>
                                </div>
                                <div className="flex justify-between py-1 border-b border-white/5">
                                  <span className="text-gray-500">Type</span>
                                  <span className="text-cyan-400 font-bold uppercase">{el.type}</span>
                                </div>
                                {gameObject && (
                                  <div className="flex justify-between py-1 border-b border-white/5">
                                    <span className="text-gray-500">Object Name</span>
                                    <span className="text-gray-300 font-medium">{gameObject.name}</span>
                                  </div>
                                )}
                              </div>
                            </div>

                            <button
                              onClick={() => {
                                setStageElements(stageElements.filter(item => item.id !== selectedElementId));
                                setSelectedElementId(null);
                              }}
                              className="py-2.5 w-full bg-red-600 hover:bg-red-500 text-white text-xs font-bold rounded-lg shadow-lg shadow-red-950/20 transition-all flex items-center justify-center gap-1.5 border border-red-500/10 shrink-0"
                            >
                              <Trash2 size={14} /> Delete from Stage
                            </button>
                          </div>
                        </div>
                      );
                    })()
                  )}
                </div>
              )}
              {activeBottomTab === 'events' && (() => {
                const stageButtons = stageElements
                  .filter(el => el.type === 'btn')
                  .map(el => {
                    const template = uiButtons.find(b => b.id === el.buttonId);
                    return {
                      id: el.id,
                      name: el.text || (template ? template.name : 'Button') + ` (Stage El #${el.id.slice(-4)})`,
                      url: el.url || (template ? (template.url || template.data) : undefined)
                    };
                  });
                const allCollapsed = events.length > 0 && events.every(ev => collapsedEvents[ev.id]);
                return (
                  <div className="flex flex-col h-full relative">
                    <div className="flex items-center justify-between mb-4 shrink-0">
                      <h3 className="text-sm font-bold text-white flex items-center gap-2">
                        <FileCode2 size={16} className="text-cyan-400" /> Event Logic
                      </h3>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => {
                            const nextState: Record<string, boolean> = {};
                            events.forEach(ev => {
                              nextState[ev.id] = !allCollapsed;
                            });
                            setCollapsedEvents(nextState);
                          }}
                          className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-gray-300 hover:text-white text-xs font-bold rounded-lg flex items-center gap-1.5 transition-all animate-fade-in"
                        >
                          <Sliders size={14} /> {allCollapsed ? "Expand All" : "Minimize All"}
                        </button>
                        <button 
                          onClick={() => setEvents([...events, { id: `ev_${Date.now()}`, conditions: [], actions: [] }])}
                          className="px-3 py-1.5 bg-cyan-500 hover:bg-cyan-400 text-black text-xs font-bold rounded-lg flex items-center gap-1.5 transition-all shadow-[0_0_10px_rgba(6,182,212,0.15)]"
                        >
                          <Plus size={14} /> Add Event
                        </button>
                      </div>
                    </div>
                    
                    <div className="flex-1 overflow-y-auto space-y-4 custom-scrollbar pr-2 pb-64">
                      {events.map((ev, index) => (
                        <div key={ev.id} className={`bg-zinc-900/50 border border-white/5 rounded-xl flex flex-col relative ${showConditionPicker === ev.id || showActionPicker === ev.id ? 'z-[100]' : 'z-10'}`}>
                          {/* Event Header bar */}
                          <div 
                            onClick={() => setCollapsedEvents(prev => ({ ...prev, [ev.id]: !prev[ev.id] }))}
                            className="flex items-center justify-between px-4 py-2 border-b border-white/5 bg-zinc-950/40 rounded-t-xl select-none cursor-pointer hover:bg-zinc-900/40 transition-colors"
                          >
                            <div className="flex items-center gap-2 min-w-0 flex-1">
                              <span className="text-[10px] font-mono bg-zinc-800 text-zinc-400 px-1.5 py-0.5 rounded shrink-0">EVENT #{index + 1}</span>
                              {collapsedEvents[ev.id] && (
                                <span className="text-[10px] text-zinc-400 truncate max-w-lg ml-3 bg-black/20 px-2 py-0.5 rounded border border-white/5 font-medium animate-fade-in">
                                  {ev.conditions.length === 0 ? "No conditions" : ev.conditions.map(c => CONDITIONS_LIST.find(cl => cl.type === c.type)?.label || c.type).join(" & ")}
                                  <span className="text-cyan-500 mx-1.5 font-bold">➔</span>
                                  {ev.actions.length === 0 ? "No actions" : ev.actions.map(a => ACTIONS_LIST.find(al => al.type === a.type)?.label || a.type).join(" & ")}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 shrink-0 ml-4">
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setCollapsedEvents(prev => ({ ...prev, [ev.id]: !prev[ev.id] }));
                                }}
                                className="p-1 text-gray-400 hover:text-white hover:bg-white/5 rounded transition-all flex items-center gap-1"
                                title={collapsedEvents[ev.id] ? "Expand Event" : "Minimize Event"}
                              >
                                {collapsedEvents[ev.id] ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                                <span className="text-[10px] font-bold">{collapsedEvents[ev.id] ? "Expand" : "Minimize"}</span>
                              </button>
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const newEvents = events.filter(e => e.id !== ev.id);
                                  setEvents(newEvents);
                                }}
                                className="p-1 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded transition-all"
                                title="Delete Event"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </div>

                          {!collapsedEvents[ev.id] && (
                            <div className="flex flex-row relative">
                              {/* Conditions */}
                              <div className="w-1/2 shrink-0 p-4 border-r border-white/5 bg-zinc-950/30 rounded-bl-xl flex flex-col min-w-0">
                                <div className="flex justify-between items-center mb-3">
                                  <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Conditions (If)</h4>
                                </div>
                                <div className="space-y-2">
                                  {ev.conditions.map((cond, i) => (
                                     <div key={i} className="px-3 py-2 bg-blue-950/20 border border-blue-500/20 text-blue-400 text-xs rounded-lg relative group">
                                       <button
                                          onClick={() => {
                                            const newEvents = [...events];
                                            newEvents[index].conditions.splice(i, 1);
                                            setEvents(newEvents);
                                          }}
                                          className="absolute top-2 right-2 text-blue-400 opacity-0 group-hover:opacity-100 transition-opacity"
                                       >
                                         <X size={12} />
                                       </button>
                                       <div className="font-bold mb-1">{CONDITIONS_LIST.find(c => c.type === cond.type)?.label || cond.type}</div>
                                       {cond.type === 'moved' && renderConditionDropdown('Object', cond, index, i, 'target', availableObjects)}
                                       {cond.type === 'collision' && (
                                         <>
                                           {renderConditionDropdown('Object X', cond, index, i, 'target', availableObjects)}
                                           {renderConditionDropdown('Object Y', cond, index, i, 'target2', availableObjects)}
                                         </>
                                       )}
                                       {cond.type === 'pressed' && renderConditionDropdown('Button', cond, index, i, 'target', stageButtons)}
                                       {cond.type === 'opacity' && (
                                         <>
                                           {renderConditionDropdown('Object', cond, index, i, 'target', availableObjects)}
                                           {renderInput('Value (%)', cond, index, i, 'value', false, 'number')}
                                         </>
                                       )}
                                       {cond.type === 'position' && (
                                         <>
                                           {renderConditionDropdown('Object', cond, index, i, 'target', availableObjects)}
                                           {renderInput('X', cond, index, i, 'x', false, 'number')}
                                           {renderInput('Y', cond, index, i, 'y', false, 'number')}
                                         </>
                                       )}
                                       {cond.type === 'animation' && (
                                         <>
                                           {renderConditionDropdown('Character', cond, index, i, 'target', availableObjects)}
                                           {renderInput('Animation Name', cond, index, i, 'value', false)}
                                         </>
                                       )}
                                       {cond.type === 'created' && (
                                         <>
                                           {renderConditionDropdown('Character', cond, index, i, 'target', availableObjects)}
                                           {renderInput('X', cond, index, i, 'x', false, 'number')}
                                           {renderInput('Y', cond, index, i, 'y', false, 'number')}
                                         </>
                                       )}
                                       {cond.type === 'pressed_time' && (
                                         <>
                                           {renderConditionDropdown('Button', cond, index, i, 'target', stageButtons)}
                                           {renderInput('Seconds', cond, index, i, 'value', false, 'number')}
                                         </>
                                       )}
                                       {cond.type === 'color' && renderInput('Color', cond, index, i, 'value', false, 'color')}
                                     </div>
                                  ))}
                                  <div className="relative z-50">
                                    <button 
                                      onClick={() => {
                                        if (showConditionPicker === ev.id) setShowConditionPicker(null);
                                        else {
                                          setShowConditionPicker(ev.id);
                                          setShowActionPicker(null);
                                        }
                                      }}
                                      className="w-full py-2 border border-dashed border-white/20 hover:border-white/40 hover:bg-white/5 text-gray-400 text-xs rounded-lg flex items-center justify-center gap-1.5 transition-all"
                                    >
                                      <Plus size={12} /> Add Condition
                                    </button>
                                    
                                    {showConditionPicker === ev.id && (
                                       <div className="absolute top-full left-0 mt-2 w-64 bg-zinc-800 border border-white/10 rounded-xl shadow-2xl p-2 z-[100]" style={{ zIndex: 100 }}>
                                         <div className="flex justify-between items-center px-2 py-1 mb-1 border-b border-white/5">
                                           <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Select Condition</span>
                                           <button 
                                             onClick={() => setShowConditionPicker(null)}
                                             className="text-gray-400 hover:text-white transition-colors"
                                           >
                                             <X size={12} />
                                           </button>
                                         </div>
                                         <div className="max-h-40 overflow-y-auto custom-scrollbar">
                                           {CONDITIONS_LIST.map((c, i) => (
                                             <button 
                                               key={i}
                                               onClick={() => {
                                                 const newEvents = [...events];
                                                 newEvents[index].conditions.push({ type: c.type });
                                                 setEvents(newEvents);
                                                 setShowConditionPicker(null);
                                               }}
                                               className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:text-white hover:bg-white/10 rounded-lg"
                                             >
                                               {c.label}
                                             </button>
                                           ))}
                                         </div>
                                       </div>
                                    )}
                                  </div>
                                </div>
                              </div>

                              {/* Actions */}
                              <div className="w-1/2 shrink-0 p-4 bg-zinc-950/10 rounded-br-xl flex flex-col min-w-0">
                                <div className="flex justify-between items-center mb-3">
                                   <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Actions (Then)</h4>
                                </div>
                                <div className="space-y-2">
                                  {ev.actions.map((act, i) => (
                                     <div key={i} className="px-3 py-2 bg-purple-950/20 border border-purple-500/20 text-purple-400 text-xs rounded-lg relative group">
                                       <button
                                          onClick={() => {
                                            const newEvents = [...events];
                                            newEvents[index].actions.splice(i, 1);
                                            setEvents(newEvents);
                                          }}
                                          className="absolute top-2 right-2 text-purple-400 opacity-0 group-hover:opacity-100 transition-opacity"
                                       >
                                         <X size={12} />
                                       </button>
                                       <div className="font-bold flex items-center gap-2 mb-1 pr-4">
                                         <span>{ACTIONS_LIST.find(a => a.type === act.type)?.label || act.type}</span>
                                         {act.type === 'js' && (
                                            <span className="px-1.5 py-0.5 bg-black/40 text-[9px] rounded text-yellow-500 font-mono">JS</span>
                                         )}
                                       </div>
                                       {(act.type === 'move_to' || act.type === 'create_character') && (
                                         <>
                                           {renderActionDropdown('Character', act, index, i, 'target', availableObjects)}
                                           {renderInput('X', act, index, i, 'x', true, 'number')}
                                           {renderInput('Y', act, index, i, 'y', true, 'number')}
                                         </>
                                       )}
                                       {(act.type === 'move_straight' || act.type === 'move_zigzag') && (
                                         <>
                                           {renderActionDropdown('Move', act, index, i, 'target', availableObjects)}
                                           {renderActionDropdown('To', act, index, i, 'target2', availableObjects)}
                                         </>
                                       )}
                                       {act.type === 'show_animation' && (
                                         <>
                                           {renderActionDropdown('Character', act, index, i, 'target', availableObjects)}
                                           {renderInput('Animation Name', act, index, i, 'value', true)}
                                         </>
                                       )}
                                       {act.type === 'show_text' && renderInput('Text Content', act, index, i, 'value', true)}
                                       {act.type === 'glow' && (
                                         <>
                                           {renderActionDropdown('Object', act, index, i, 'target', availableObjects)}
                                           {renderInput('Color', act, index, i, 'color', true, 'color')}
                                         </>
                                       )}
                                       {(act.type === 'change_opacity' || act.type === 'speed_up' || act.type === 'inc_height' || act.type === 'inc_width') && (
                                         <>
                                           {renderActionDropdown('Object', act, index, i, 'target', availableObjects)}
                                           {renderInput('Value', act, index, i, 'value', true, 'number')}
                                         </>
                                       )}
                                       {act.type === 'rotate' && (
                                         <>
                                           {renderActionDropdown('Object', act, index, i, 'target', availableObjects)}
                                           {renderInput('Degrees', act, index, i, 'value', true, 'number')}
                                         </>
                                       )}
                                       {act.type === 'js' && (
                                         <div className="mt-2 space-y-2">
                                           <button
                                             onClick={() => setEditingJsAction({ evIndex: index, actIndex: i, code: act.code || '' })}
                                             className="px-3 py-1.5 bg-yellow-600 hover:bg-yellow-500 text-black text-[10px] font-bold uppercase tracking-wider rounded flex items-center gap-1.5 transition-colors"
                                           >
                                             <FileCode2 size={12} /> Edit JavaScript Code
                                           </button>
                                           {act.code && (
                                             <pre className="text-[9px] font-mono text-zinc-400 bg-black/30 p-1.5 rounded max-h-20 overflow-y-auto whitespace-pre-wrap select-text">
                                               {act.code}
                                             </pre>
                                           )}
                                         </div>
                                       )}
                                       {act.type === 'goto_scene' && (
                                         <>
                                           {renderActionDropdown('Go to Scene', act, index, i, 'target', scenes)}
                                         </>
                                       )}
                                     </div>
                                  ))}
                                  <div className="relative z-50">
                                    <button 
                                      onClick={() => {
                                        if (showActionPicker === ev.id) setShowActionPicker(null);
                                        else {
                                          setShowActionPicker(ev.id);
                                          setShowConditionPicker(null);
                                        }
                                      }}
                                      className="w-full py-2 border border-dashed border-white/20 hover:border-white/40 hover:bg-white/5 text-gray-400 text-xs rounded-lg flex items-center justify-center gap-1.5 transition-all"
                                    >
                                      <Plus size={12} /> Add Action
                                    </button>
                                    
                                    {showActionPicker === ev.id && (
                                       <div className="absolute top-full left-0 mt-2 w-64 bg-zinc-800 border border-white/10 rounded-xl shadow-2xl p-2 z-[100]" style={{ zIndex: 100 }}>
                                         <div className="flex justify-between items-center px-2 py-1 mb-1 border-b border-white/5">
                                           <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Select Action</span>
                                           <button 
                                             onClick={() => setShowActionPicker(null)}
                                             className="text-gray-400 hover:text-white transition-colors"
                                           >
                                             <X size={12} />
                                           </button>
                                         </div>
                                         <div className="max-h-40 overflow-y-auto custom-scrollbar">
                                           {ACTIONS_LIST.map((a, i) => (
                                             <button 
                                               key={i}
                                               onClick={() => {
                                                 const newEvents = [...events];
                                                 newEvents[index].actions.push({ type: a.type });
                                                 setEvents(newEvents);
                                                 setShowActionPicker(null);
                                               }}
                                               className={`w-full text-left px-3 py-1.5 text-xs hover:bg-white/10 rounded-lg ${a.type === 'js' ? 'text-yellow-400 font-bold' : 'text-gray-300 hover:text-white'}`}
                                             >
                                               {a.label}
                                             </button>
                                           ))}
                                         </div>
                                       </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
              )})()}
              {activeBottomTab === 'layers' && (
                <div className="flex flex-col h-full overflow-hidden max-w-2xl mx-auto">
                  <div className="flex items-center justify-between mb-4 shrink-0">
                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                      <Layers size={16} className="text-blue-400" /> Scene Layers
                    </h3>
                    <button 
                      onClick={() => {
                        const newLayerId = `layer_${Date.now()}`;
                        setLayers([{ id: newLayerId, name: `Layer ${layers.length + 1}` }, ...layers]);
                        setActiveLayerId(newLayerId);
                      }}
                      className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-bold rounded-lg flex items-center gap-1.5 transition-all"
                    >
                      <Plus size={14} /> Add Layer
                    </button>
                  </div>
                  <div className="flex-1 overflow-y-auto space-y-2 pb-4">
                    {layers.map((layer, index) => {
                      const isActive = activeLayerId === layer.id;
                      const layerIndex = layers.length - index;
                      return (
                        <div 
                          key={layer.id} 
                          onClick={() => setActiveLayerId(layer.id)}
                          className={`flex items-center justify-between p-3 border transition-all group cursor-pointer rounded-xl ${
                            isActive 
                              ? 'bg-blue-500/10 border-blue-500/50 ring-1 ring-blue-500/20' 
                              : 'bg-zinc-900 border-white/5 hover:border-white/10'
                          }`}
                        >
                          <div className="flex items-center gap-3 flex-1">
                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs ${isActive ? 'bg-blue-500 text-black' : 'bg-zinc-800 text-gray-500'}`}>
                              {layerIndex}
                            </div>
                            {editingLayerId === layer.id ? (
                              <input 
                                autoFocus
                                className="bg-black/60 border border-blue-500/50 rounded px-2 py-1 text-white text-sm outline-none w-full max-w-[200px]"
                                value={layer.name}
                                onChange={(e) => {
                                  setLayers(layers.map(l => l.id === layer.id ? { ...l, name: e.target.value } : l));
                                }}
                                onBlur={() => setEditingLayerId(null)}
                                onKeyDown={(e) => e.key === 'Enter' && setEditingLayerId(null)}
                                onClick={(e) => e.stopPropagation()}
                              />
                            ) : (
                              <span 
                                className={`text-sm font-medium transition-colors ${isActive ? 'text-blue-400' : 'text-gray-200'}`}
                                onDoubleClick={(e) => {
                                  e.stopPropagation();
                                  setEditingLayerId(layer.id);
                                }}
                              >
                                {layer.name}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-3">
                            <div className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">
                              {index === layers.length - 1 ? '(Base)' : ''}
                            </div>
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingLayerId(layer.id);
                                }}
                                className="p-1.5 text-gray-400 hover:text-white transition-colors"
                                title="Rename Layer"
                              >
                                <PenTool size={14} />
                              </button>
                              {index !== layers.length - 1 && (
                                <button 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (confirm(`Delete layer "${layer.name}" and all its elements?`)) {
                                      setLayers(layers.filter(l => l.id !== layer.id));
                                      setStageElements(stageElements.filter(el => (el as any).layerId !== layer.id));
                                      if (activeLayerId === layer.id) {
                                        setActiveLayerId(layers[layers.length - 1].id);
                                      }
                                    }
                                  }}
                                  className="text-red-400 bg-red-500/20 hover:bg-red-500/30 transition-colors p-1.5 rounded-md flex items-center justify-center border border-red-500/20"
                                >
                                  <X size={14} />
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {activeBottomTab === 'objects' && (
                <div className="flex flex-col h-full overflow-hidden max-w-4xl mx-auto relative">
                  <div className="flex items-center justify-between mb-4 shrink-0">
                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                      <Box size={16} className="text-amber-400" /> Game Objects
                    </h3>
                    <button 
                      onClick={() => setShowObjectPicker(!showObjectPicker)}
                      className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-black text-xs font-bold rounded-lg flex items-center gap-1.5 transition-all"
                    >
                      <Plus size={14} /> Add Object
                    </button>
                    
                    {showObjectPicker && (
                      <div className="absolute top-12 right-0 w-48 bg-zinc-800 border border-white/10 rounded-xl shadow-2xl z-50 p-2 overflow-hidden">
                        <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2 px-2">Object Types</div>
                        {OBJECT_TYPES.map((t) => {
                          const Icon = t.icon;
                          return (
                            <button
                              key={t.type}
                              onClick={() => {
                                setGameObjects([...gameObjects, { id: `obj_${Date.now()}`, name: `New ${t.label}`, type: t.type }]);
                                setShowObjectPicker(false);
                              }}
                              className="w-full flex items-center gap-2 text-left px-3 py-2 text-xs text-gray-200 hover:text-white hover:bg-white/10 rounded-lg transition-all"
                            >
                              <Icon size={14} /> {t.label}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  
                  <div className="flex-1 overflow-y-auto grid grid-cols-2 md:grid-cols-4 gap-4">
                    {gameObjects.length === 0 ? (
                      <div className="col-span-full h-32 flex flex-col items-center justify-center text-gray-500 text-xs border border-dashed border-white/10 rounded-2xl">
                        <Box size={24} className="mb-2 opacity-30" />
                        No objects yet. Click "Add Object" to begin.
                      </div>
                    ) : (
                      gameObjects.map(obj => (
                        <div key={obj.id} className="bg-zinc-900 border border-white/5 rounded-xl p-4 flex flex-col gap-3 group hover:border-amber-500/30 transition-all relative">
                           <button 
                             onClick={() => {
                               setGameObjects(gameObjects.filter(o => o.id !== obj.id));
                               setStageElements(stageElements.filter(el => el.data !== obj.id));
                             }}
                             className="absolute top-2 right-2 p-1 text-gray-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity rounded bg-black/40 hover:bg-black/60"
                             title={`Delete ${obj.type}`}
                           >
                             <Trash2 size={12} />
                           </button>
                           <div className="w-12 h-12 bg-black rounded-lg mx-auto flex items-center justify-center shadow-inner">
                             <ImageIcon size={20} className="text-gray-600" />
                           </div>
                           <div className="text-center">
                             <div className="text-xs font-bold text-gray-200 truncate">{obj.name}</div>
                             <div className="text-[10px] text-gray-500 uppercase">{obj.type}</div>
                           </div>
                           <button 
                             onClick={() => setEditingCharacter(obj.id)}
                             className="mt-2 py-1.5 w-full bg-zinc-800 hover:bg-zinc-700 text-xs font-bold text-white rounded-lg border border-white/5 transition-colors"
                           >
                             Edit {obj.type.charAt(0).toUpperCase() + obj.type.slice(1)}
                           </button>
                           {stageElements.some(el => el.type === 'obj' && el.data === obj.id) ? (
                             <button 
                               onClick={() => {
                                 const el = stageElements.find(e => e.type === 'obj' && e.data === obj.id);
                                 if (el) { setSelectedElementId(el.id); setActiveBottomTab('properties'); }
                               }}
                               className="mt-1 py-1.5 w-full bg-cyan-600/20 hover:bg-cyan-500/30 text-xs font-bold text-cyan-400 rounded-lg border border-cyan-500/20 transition-colors"
                             >
                               Edit Position
                             </button>
                           ) : (
                             <button 
                               onClick={() => {
                                  const newId = `el_${Date.now()}`;
                                  setStageElements([...stageElements, { id: newId, type: 'obj' as any, data: obj.id, x: 50, y: 50, width: 80, height: 80, layerId: activeLayerId }]);
                                  setSelectedElementId(newId);
                                  setActiveBottomTab('properties');
                                }}
                               className="mt-1 py-1.5 w-full bg-cyan-600 hover:bg-cyan-500 text-xs font-bold text-white rounded-lg border border-white/5 transition-colors"
                             >
                               Add to Stage
                             </button>
                           )}
                        </div>
                      ))
                    )}
                  </div>

                  {/* Object Edit Modal */}
                  {editingCharacter && (
                    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[3000000] flex items-center justify-center p-4 overflow-y-auto">
                      <div className="bg-[#151518] border border-white/10 rounded-2xl w-full max-w-md p-6 flex flex-col gap-4 shadow-2xl my-auto">
                        <div className="flex justify-between items-center">
                          <h3 className="font-bold text-white capitalize">Edit {gameObjects.find(o => o.id === editingCharacter)?.type || 'Object'}</h3>
                          <button onClick={() => setEditingCharacter(null)} className="text-gray-400 hover:text-white">
                            <X size={18} />
                          </button>
                        </div>
                        
                        {(() => {
                          const char = gameObjects.find(o => o.id === editingCharacter);
                          if (!char) return null;
                          return char.type === 'text' ? (
                            <>
                              <div className="flex flex-col gap-1">
                                <label className="text-xs text-gray-400 font-bold">Text Label (Internal Name)</label>
                                <input 
                                  type="text" 
                                  className="bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white outline-none focus:border-cyan-500/50 text-xs"
                                  value={char.name}
                                  onChange={(e) => {
                                    setGameObjects(gameObjects.map(o => o.id === char.id ? { ...o, name: e.target.value } : o));
                                  }}
                                />
                              </div>
                              <div className="flex flex-col gap-1">
                                <label className="text-xs text-gray-400 font-bold">Written Text Content</label>
                                <textarea 
                                  className="bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white outline-none focus:border-cyan-500/50 h-20 resize-none text-xs"
                                  value={char.textContent ?? char.name ?? ''}
                                  onChange={(e) => {
                                    setGameObjects(gameObjects.map(o => o.id === char.id ? { ...o, textContent: e.target.value } : o));
                                  }}
                                  placeholder="Enter text..."
                                />
                              </div>
                              <div className="grid grid-cols-2 gap-3 mt-1">
                                <div className="flex flex-col gap-1">
                                  <div className="flex justify-between">
                                    <label className="text-xs text-gray-400 font-bold">Font Size</label>
                                    <span className="text-cyan-400 text-[10px]">{char.fontSize ?? 24}px</span>
                                  </div>
                                  <input 
                                    type="range" 
                                    min="8" 
                                    max="120" 
                                    className="accent-cyan-500 h-2" 
                                    value={char.fontSize ?? 24} 
                                    onChange={(e) => {
                                      setGameObjects(gameObjects.map(o => o.id === char.id ? { ...o, fontSize: Number(e.target.value) } : o));
                                    }} 
                                  />
                                </div>
                                <div className="flex flex-col gap-1">
                                  <label className="text-xs text-gray-400 font-bold">Font Color</label>
                                  <div className="flex items-center gap-2">
                                    <input 
                                      type="color" 
                                      className="w-8 h-8 rounded bg-transparent border border-white/10 cursor-pointer" 
                                      value={char.color ?? '#ffffff'} 
                                      onChange={(e) => {
                                        setGameObjects(gameObjects.map(o => o.id === char.id ? { ...o, color: e.target.value } : o));
                                      }} 
                                    />
                                    <span className="text-xs font-mono uppercase text-gray-300">{char.color ?? '#ffffff'}</span>
                                  </div>
                                </div>
                              </div>
                              <div className="flex flex-col gap-1 mt-1">
                                <label className="text-xs text-gray-400 font-bold">Font Family</label>
                                <select 
                                  className="bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white outline-none focus:border-cyan-500/50 text-xs"
                                  value={char.fontFamily ?? 'sans-serif'} 
                                  onChange={(e) => {
                                    setGameObjects(gameObjects.map(o => o.id === char.id ? { ...o, fontFamily: e.target.value } : o));
                                  }}
                                >
                                  <option value="sans-serif">Sans-Serif</option>
                                  <option value="serif">Serif</option>
                                  <option value="monospace">Monospace</option>
                                  <option value="Space Grotesk">Space Grotesk</option>
                                  <option value="Inter">Inter</option>
                                  <option value="JetBrains Mono">JetBrains Mono</option>
                                  <option value="Arial">Arial</option>
                                  <option value="Georgia">Georgia</option>
                                </select>
                              </div>
                            </>
                          ) : (
                            <>
                              <div className="flex flex-col gap-1">
                                <label className="text-xs text-gray-400 font-bold">Character Name</label>
                                <input 
                                  type="text" 
                                  className="bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white outline-none focus:border-cyan-500/50"
                                  value={char.name}
                                  onChange={(e) => {
                                    setGameObjects(gameObjects.map(o => o.id === char.id ? { ...o, name: e.target.value } : o));
                                  }}
                                />
                              </div>
                              
                              <div className="flex flex-col gap-2 mt-2">
                                <div className="flex justify-between items-center">
                                  <label className="text-xs text-gray-400 font-bold">Animations</label>
                                  <button 
                                    onClick={() => {
                                      const anims = char.animations || [];
                                      setGameObjects(gameObjects.map(o => o.id === char.id ? { ...o, animations: [...anims, { id: `anim_${Date.now()}`, name: `Animation ${anims.length + 1}` }] } : o));
                                    }}
                                    className="text-cyan-400 hover:text-cyan-300 text-xs flex items-center gap-1 font-bold"
                                  >
                                    <Plus size={12} /> Add
                                  </button>
                                </div>
                                <div className="space-y-2 max-h-48 overflow-y-auto custom-scrollbar pr-1">
                                  {(char.animations || [{ id: 'anim_default', name: 'Animation 1' }]).map(anim => (
                                    <div key={anim.id} className="flex flex-col gap-2 bg-black/40 border border-white/10 rounded-lg p-2">
                                      <div className="flex items-center gap-2">
                                        <div className="w-8 h-8 rounded bg-zinc-800 flex items-center justify-center shrink-0 border border-white/5 overflow-hidden">
                                          {anim.frames && anim.frames.length > 0 ? (
                                            <AnimatedSprite frames={anim.frames} fps={anim.fps || 24} speed={anim.speed || 1} width={32} height={32} />
                                          ) : (
                                            <ImageIcon size={12} className="text-gray-600" />
                                          )}
                                        </div>
                                        <input 
                                          type="text" 
                                          className="bg-transparent text-sm text-white outline-none flex-1 min-w-0"
                                          value={anim.name}
                                          onChange={(e) => {
                                            const anims = char.animations || [{ id: 'anim_default', name: 'Animation 1' }];
                                            const newAnims = anims.map(a => a.id === anim.id ? { ...a, name: e.target.value } : a);
                                            setGameObjects(gameObjects.map(o => o.id === char.id ? { ...o, animations: newAnims } : o));
                                          }}
                                        />
                                        <label className="px-2 py-1 bg-zinc-800 hover:bg-zinc-700 text-[10px] text-white rounded transition-colors whitespace-nowrap cursor-pointer shrink-0">
                                          Import
                                          <input 
                                            type="file" 
                                            accept=".anim_game,.json,application/json" 
                                            className="hidden" 
                                            onChange={(e) => {
                                              if (e.target.files && e.target.files[0]) {
                                                const file = e.target.files[0];
                                                const reader = new FileReader();
                                                reader.onload = (ev) => {
                                                  try {
                                                    const data = JSON.parse(ev.target?.result as string);
                                                    if (data.type === 'anim_game' && data.frames) {
                                                      const anims = char.animations || [{ id: 'anim_default', name: 'Animation 1' }];
                                                      const newAnims = anims.map(a => a.id === anim.id ? { ...a, frames: data.frames, fps: data.fps } : a);
                                                      setGameObjects(gameObjects.map(o => o.id === char.id ? { ...o, animations: newAnims } : o));
                                                      alert('Animation imported successfully!');
                                                    } else {
                                                      alert('Invalid game animation format.');
                                                    }
                                                  } catch (err) {
                                                    alert('Failed to read file.');
                                                  }
                                                };
                                                reader.readAsText(file);
                                              }
                                            }}
                                          />
                                        </label>
                                      </div>
                                      
                                      {anim.frames && anim.frames.length > 0 && (
                                        <div className="flex items-center gap-2 px-1">
                                          <label className="text-[10px] text-gray-500 font-bold uppercase w-12">Speed</label>
                                          <input 
                                            type="range" 
                                            min="0.1" 
                                            max="3" 
                                            step="0.1"
                                            value={anim.speed || 1}
                                            onChange={(e) => {
                                              const newAnims = (char.animations || []).map(a => a.id === anim.id ? { ...a, speed: Number(e.target.value) } : a);
                                              setGameObjects(gameObjects.map(o => o.id === char.id ? { ...o, animations: newAnims } : o));
                                            }}
                                            className="flex-1 accent-cyan-500 h-1" 
                                          />
                                          <span className="text-[10px] text-cyan-400 font-mono">x{anim.speed || 1}</span>
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </>
                          );
                        })()}
                      </div>
                    </div>
                  )}
                </div>
              )}
              {activeBottomTab === 'buttons' && (
                <div className="flex flex-col h-full overflow-hidden max-w-4xl mx-auto">
                  <div className="flex items-center justify-between mb-4 shrink-0">
                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                      <MousePointerClick size={16} className="text-pink-400" /> On-Screen Controls
                    </h3>
                    <div className="flex gap-2">
                       <label className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-bold rounded-lg flex items-center gap-1.5 cursor-pointer transition-colors border border-white/5">
                         <ImageIcon size={14} /> Import Image
                         <input type="file" accept="image/*" className="hidden" onChange={(e) => {
                           if (e.target.files && e.target.files[0]) {
                             const file = e.target.files[0];
                             const reader = new FileReader();
                             reader.onload = (ev) => {
                               if (ev.target?.result) {
                                 setUiButtons([...uiButtons, { id: `btn_${Date.now()}`, name: file.name, type: 'image', url: ev.target.result as string } as any]);
                               }
                             };
                             reader.readAsDataURL(file);
                           }
                         }} />
                       </label>
                       <button 
                         onClick={() => setShowDrawCanvas(true)}
                         className="px-3 py-1.5 bg-pink-500/20 hover:bg-pink-500/30 text-pink-400 text-xs font-bold rounded-lg border border-pink-500/20 flex items-center gap-1.5 transition-colors"
                       >
                         <Plus size={14} /> Draw Shape
                       </button>
                    </div>
                  </div>
                  
                  <div className="flex-1 overflow-y-auto grid grid-cols-2 md:grid-cols-4 gap-4">
                    {uiButtons.length === 0 ? (
                      <div className="col-span-full h-32 flex flex-col items-center justify-center text-gray-500 text-xs border border-dashed border-white/10 rounded-2xl">
                        <MousePointerClick size={24} className="mb-2 opacity-30" />
                        No buttons yet. Import an image or draw a shape.
                      </div>
                    ) : (
                      uiButtons.map(btn => (
                        <div 
                          key={btn.id} 
                          className="bg-zinc-900 border border-white/5 rounded-xl p-4 flex flex-col gap-3 group relative hover:border-pink-500/30 transition-all cursor-grab active:cursor-grabbing"
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.setData('type', 'btn');
                            e.dataTransfer.setData('id', btn.id);
                          }}
                        >
                           <button 
                             onClick={() => {
                               setUiButtons(uiButtons.filter(b => b.id !== btn.id));
                               setStageElements(stageElements.filter(el => el.type !== 'btn' || el.buttonId !== btn.id));
                             }}
                             className="absolute top-2 right-2 text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                           >
                             <X size={14} />
                           </button>
                           <div className={`w-12 h-12 rounded-lg mx-auto flex items-center justify-center shadow-inner ${btn.type === 'shape' ? 'bg-pink-500/20 border border-pink-500/50' : 'bg-black'} overflow-hidden`}>
                             {btn.type === 'image' && (btn as any).url ? <img src={(btn as any).url} className="w-full h-full object-cover" /> : btn.type === 'image' ? <ImageIcon size={20} className="text-gray-600" /> : null}
                             {btn.type === 'shape' && (btn as any).data && <img src={(btn as any).data} className="w-full h-full object-contain" />}
                           </div>
                           <div className="text-center">
                             <input 
                               type="text" 
                               className="text-xs font-bold text-gray-200 bg-transparent text-center outline-none w-full truncate"
                               value={btn.name}
                               onChange={(e) => setUiButtons(uiButtons.map(b => b.id === btn.id ? { ...b, name: e.target.value } : b))}
                             />
                             <div className="text-[10px] text-gray-500 uppercase mt-1">{btn.type}</div>
                           </div>
                           <button 
                             onClick={() => {
                                const newId = `el_${Date.now()}`;
                                 setStageElements([...stageElements, { id: newId, type: 'btn', buttonId: btn.id, data: btn.type === 'shape' ? (btn as any).data : null, url: btn.type === 'image' ? (btn as any).url : null, x: 50, y: 50, width: 50, height: 50, layerId: activeLayerId }]);
                                setSelectedElementId(newId);
                                setActiveBottomTab('properties');
                              }}
                             className="mt-1 py-1 w-full bg-pink-600/50 hover:bg-pink-500/80 text-[10px] font-bold text-white rounded transition-colors"
                           >
                             Add to Stage
                           </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
              {activeBottomTab === 'environment' && (
                <div className="flex flex-col h-full overflow-hidden max-w-4xl mx-auto">
                  <div className="flex items-center justify-between mb-4 shrink-0">
                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                      <ImageIcon size={16} className="text-emerald-400" /> Environment Backgrounds
                    </h3>
                    <label className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg cursor-pointer flex items-center gap-1.5 transition-colors shadow-lg">
                       <Plus size={14} /> Add Background
                       <input type="file" accept="image/*" className="hidden" onChange={(e) => {
                         if (e.target.files && e.target.files[0]) {
                           const reader = new FileReader();
                           reader.onload = (ev) => {
                             if (ev.target?.result) {
                               setEnvironments([...environments, { id: `env_${Date.now()}`, url: ev.target.result as string }]);
                             }
                           };
                           reader.readAsDataURL(e.target.files[0]);
                         }
                       }} />
                    </label>
                  </div>

                  <div className="flex-1 overflow-y-auto grid grid-cols-2 md:grid-cols-3 gap-4 pb-4">
                    {environments.length === 0 ? (
                      <div className="col-span-full h-32 flex flex-col items-center justify-center text-gray-500 text-xs border border-dashed border-white/10 rounded-2xl">
                        <ImageIcon size={24} className="mb-2 opacity-30" />
                        No environments added yet. Click "Add Background" to upload an image.
                      </div>
                    ) : (
                      environments.map(env => (
                        <div 
                          key={env.id} 
                          className="relative group rounded-xl overflow-hidden border border-white/10 aspect-video bg-black flex items-center justify-center cursor-grab active:cursor-grabbing"
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.setData('type', 'bg');
                            e.dataTransfer.setData('id', env.id);
                          }}
                        >
                          <img src={env.url} alt="Environment" className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" />
                          <button 
                             onClick={() => setEnvironments(environments.filter(e => e.id !== env.id))}
                             className="absolute top-2 right-2 p-1.5 bg-black/50 hover:bg-red-500/80 text-white rounded-lg opacity-0 group-hover:opacity-100 transition-all backdrop-blur-sm"
                           >
                             <X size={14} />
                           </button>
                           <button 
                             onClick={() => {
                                const newId = `el_${Date.now()}`;
                                setStageElements([...stageElements, { id: newId, type: 'bg', url: env.url, x: 0, y: 0, width: 640, height: 360, layerId: activeLayerId }]);
                                setSelectedElementId(newId);
                                setActiveBottomTab('properties');
                              }}
                             className="absolute bottom-2 left-1/2 -translate-x-1/2 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-xs font-bold text-white rounded-lg opacity-0 group-hover:opacity-100 transition-all backdrop-blur-sm whitespace-nowrap"
                           >
                             Add to Stage
                           </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

      </div>

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[2000000] flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-[#151518] border border-white/10 rounded-2xl w-full max-w-md p-6 shadow-2xl flex flex-col gap-6 my-auto">
            <div className="flex justify-between items-center">
              <h3 className="font-bold text-white flex items-center gap-2">
                <Settings size={18} className="text-gray-400" /> Project Settings
              </h3>
              <button onClick={() => setShowSettings(false)} className="text-gray-400 hover:text-white">
                <X size={18} />
              </button>
            </div>
            
            <div className="flex flex-col gap-2">
              <label className="text-sm font-bold text-gray-300">Main Stage Area Color</label>
              <div className="flex items-center gap-3">
                <div 
                  className="w-10 h-10 rounded cursor-pointer border border-white/10"
                  style={{ backgroundColor: stageBgColor }}
                  onClick={() => setShowStageBgColorPicker(true)}
                />
                <span className="text-xs text-gray-500 font-mono uppercase">{stageBgColor}</span>
                {showStageBgColorPicker && (
                  <>
                    <div className="fixed inset-0 z-[999] bg-black/20" onClick={() => setShowStageBgColorPicker(false)}></div>
                    <div className="fixed z-[1000]" style={{ left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}>
                        <AdvancedColorPicker 
                            initialColor={stageBgColor}
                            onChange={(color) => setStageBgColor(color)}
                            onClose={() => setShowStageBgColorPicker(false)}
                        />
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-2 pt-4 border-t border-white/5">
              <label className="text-sm font-bold text-gray-300 font-medium">Game Orientation / Aspect Ratio</label>
              <div className="flex gap-4">
                <button 
                  onClick={() => setAspectRatio('landscape')}
                  className={`flex-1 py-3 px-4 rounded-xl border font-bold text-xs flex flex-col items-center gap-2 transition-all ${aspectRatio === 'landscape' ? 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30' : 'bg-black/30 text-gray-400 border-white/10 hover:border-white/20'}`}
                >
                  <MonitorPlay size={20} />
                  <span>Landscape (16:9)</span>
                </button>
                <button 
                  onClick={() => setAspectRatio('portrait')}
                  className={`flex-1 py-3 px-4 rounded-xl border font-bold text-xs flex flex-col items-center gap-2 transition-all ${aspectRatio === 'portrait' ? 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30' : 'bg-black/30 text-gray-400 border-white/10 hover:border-white/20'}`}
                >
                  <Smartphone size={20} />
                  <span>Portrait (9:16)</span>
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-2 pt-4 border-t border-white/5">
              <label className="text-sm font-bold text-gray-300">Environment Variables</label>
              <p className="text-xs text-gray-500 mb-2">Sync variables for your application here.</p>
              <div className="flex items-center gap-2">
                <input type="text" placeholder="KEY" className="bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white outline-none focus:border-cyan-500/50 w-1/3 text-xs" />
                <input type="text" placeholder="VALUE" className="bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white outline-none focus:border-cyan-500/50 flex-1 text-xs" />
                <button className="p-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg transition-colors">
                  <Plus size={14} />
                </button>
              </div>
            </div>

            {/* GitHub Developer Account Integration */}
            <div className="flex flex-col gap-2.5 pt-4 border-t border-white/5 text-left">
              <label className="text-sm font-bold text-gray-300 flex items-center gap-2">
                <Github size={16} className="text-zinc-400" /> GitHub Account
              </label>
              
              {isGithubConnected ? (
                <div className="flex flex-col gap-2.5">
                  <div className="bg-zinc-950 border border-white/5 rounded-2xl p-4 flex items-center justify-between gap-3 animate-in fade-in duration-200">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
                        <Github size={18} />
                      </div>
                      <div className="text-left">
                        <span className="text-xs font-bold text-white block leading-tight">Connected</span>
                        <span className="text-[10px] text-zinc-500 leading-tight">as @{githubUsername}</span>
                      </div>
                    </div>
                    
                    <button
                      onClick={handleDisconnectGithub}
                      disabled={isDisconnectingGithub}
                      className="px-3.5 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 hover:border-rose-500/30 text-[10px] font-bold rounded-xl transition-all flex items-center gap-1.5 disabled:opacity-40"
                    >
                      {isDisconnectingGithub ? (
                        <RefreshCw size={12} className="animate-spin" />
                      ) : (
                        <>Disconnect</>
                      )}
                    </button>
                  </div>

                  {githubIsFineGrained && (
                    <div className="px-3.5 py-2.5 bg-blue-500/5 border border-blue-500/10 rounded-xl text-[10px] text-blue-400 flex items-start gap-2 leading-relaxed text-left">
                      <Info size={14} className="mt-0.5 flex-shrink-0" />
                      <span>
                        Using a <strong>Fine-grained PAT</strong>. Please ensure you have granted <strong>Read & Write</strong> permissions for Contents, Workflows, Pages, Actions, and Administration in your token's repository settings.
                      </span>
                    </div>
                  )}

                  {!githubIsFineGrained && githubMissingScopes.length > 0 && (
                    <div className="p-3.5 bg-red-500/5 border border-red-500/15 rounded-xl text-[11px] space-y-2 text-left">
                      <div className="flex items-center gap-1.5 text-red-400 font-bold text-[10px] uppercase tracking-wider">
                        <AlertTriangle size={13} className="text-red-400" />
                        Missing Required Classic Scopes
                      </div>
                      <p className="text-[10px] text-zinc-400 leading-relaxed">
                        Your connection is missing critical scopes required for deploying games to Pages and compiling APKs:
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {githubMissingScopes.map(scope => (
                          <span key={scope} className="px-1.5 py-0.5 bg-red-500/10 border border-red-500/20 text-red-300 rounded text-[9px] font-mono font-semibold">
                            {scope}
                          </span>
                        ))}
                      </div>
                      <p className="text-[10px] text-zinc-500 leading-relaxed">
                        Please disconnect and connect again with a token that includes these scopes to avoid silent deployment or compilation failures.
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="bg-zinc-950/60 border border-white/5 rounded-2xl p-4 flex items-center justify-between gap-3 animate-in fade-in duration-200">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-zinc-900 border border-white/5 flex items-center justify-center text-zinc-500">
                      <Github size={18} />
                    </div>
                    <div className="text-left">
                      <span className="text-xs font-bold text-zinc-400 block leading-tight">Not Connected</span>
                      <span className="text-[10px] text-zinc-600 leading-tight">Connect to deploy your games</span>
                    </div>
                  </div>
                  
                  <button
                    onClick={() => {
                      setShowSettings(false);
                      setShowGithubConnectModal(true);
                    }}
                    className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white text-[10px] font-bold rounded-xl border border-white/10 transition-all flex items-center gap-1 hover:scale-105 active:scale-95 shadow-md"
                  >
                    Connect
                  </button>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-4 pt-6 border-t border-white/5">
              <div className="flex items-center justify-between">
                <div className="flex flex-col">
                  <label className="text-sm font-bold text-gray-300">Auto-save</label>
                  <p className="text-[10px] text-gray-500">Automatically save changes</p>
                </div>
                <button 
                  onClick={() => setAutoSave(!autoSave)}
                  className={`w-12 h-6 rounded-full p-1 transition-colors relative ${autoSave ? 'bg-cyan-500' : 'bg-zinc-800'}`}
                >
                  <motion.div 
                    layout
                    className={`w-4 h-4 rounded-full bg-white transition-transform ${autoSave ? 'translate-x-6' : 'translate-x-0'}`} 
                  />
                </button>
              </div>

              <button 
                onClick={() => handleSaveProject(true)}
                disabled={isSaving}
                className="w-full py-3 bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-black font-bold rounded-xl flex items-center justify-center gap-2 transition-all"
              >
                {isSaving ? <RefreshCw size={18} className="animate-spin" /> : <Save size={18} />}
                {isSaving ? 'Saving...' : 'Save Game Project'}
              </button>
              
              {lastSaved && (
                <p className="text-[10px] text-center text-gray-500">
                  Last saved: {lastSaved.toLocaleTimeString()}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Draw Canvas Modal */}
      {showDrawCanvas && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[2000000] flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-[#151518] border border-white/10 rounded-2xl w-full max-w-2xl p-4 shadow-2xl flex flex-col gap-4 my-auto">
            <div className="flex justify-between items-center">
              <h3 className="font-bold text-white flex items-center gap-2">
                <MousePointerClick size={18} className="text-pink-400" /> Draw Shape Button
              </h3>
              <button onClick={() => setShowDrawCanvas(false)} className="text-gray-400 hover:text-white">
                <X size={18} />
              </button>
            </div>
            
            <div className="flex gap-4 items-start">
              <div className="flex flex-col gap-2 shrink-0">
                <button 
                  onClick={() => setDrawMode('pen')}
                  className={`p-3 rounded-xl flex items-center justify-center transition-all ${drawMode === 'pen' ? 'bg-pink-500/20 text-pink-400 border border-pink-500/50' : 'bg-zinc-800 text-gray-400 hover:text-white border border-transparent'}`}
                >
                  <PenTool size={20} />
                </button>
                <button 
                  onClick={() => setDrawMode('fill')}
                  className={`p-3 rounded-xl flex items-center justify-center transition-all ${drawMode === 'fill' ? 'bg-pink-500/20 text-pink-400 border border-pink-500/50' : 'bg-zinc-800 text-gray-400 hover:text-white border border-transparent'}`}
                >
                  <PaintBucket size={20} />
                </button>
                
                <div className="mt-4 pt-4 border-t border-white/10 flex flex-col items-center gap-2">
                  <label className="text-[10px] font-bold text-gray-500 uppercase">Color</label>
                  <div 
                    className="w-10 h-10 rounded-full cursor-pointer border-2 border-white/10"
                    style={{ backgroundColor: drawColor }}
                    onClick={() => setShowDrawColorPicker(true)}
                  />
                  {showDrawColorPicker && (
                    <>
                      <div className="fixed inset-0 z-[100] bg-black/20" onClick={() => setShowDrawColorPicker(false)}></div>
                      <div className="fixed z-[101]" style={{ left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}>
                          <AdvancedColorPicker 
                              initialColor={drawColor}
                              onChange={(color) => setDrawColor(color)}
                              onClose={() => setShowDrawColorPicker(false)}
                          />
                      </div>
                    </>
                  )}
                </div>
              </div>
              
              <div className="flex-1 bg-white rounded-xl border border-white/10 aspect-square flex items-center justify-center relative overflow-hidden">
                <canvas 
                  ref={canvasRef}
                  width={400}
                  height={400}
                  className="w-full h-full bg-white cursor-crosshair rounded-xl touch-none"
                  onPointerDown={(e) => {
                    if (!canvasRef.current) return;
                    isDrawingRef.current = true;
                    try {
                      (e.target as HTMLElement).setPointerCapture(e.pointerId);
                    } catch (err) {}
                    const ctx = canvasRef.current.getContext('2d');
                    if (ctx) {
                      const rect = canvasRef.current.getBoundingClientRect();
                      const x = (e.clientX - rect.left) * (400 / rect.width);
                      const y = (e.clientY - rect.top) * (400 / rect.height);
                      
                      ctx.strokeStyle = drawColor;
                      ctx.fillStyle = drawColor;
                      ctx.lineWidth = 6;
                      ctx.lineCap = 'round';
                      ctx.lineJoin = 'round';

                      if (drawMode === 'fill') {
                        performFloodFill(canvasRef.current, x, y, drawColor);
                      } else {
                        ctx.beginPath();
                        ctx.moveTo(x, y);
                        ctx.lineTo(x + 0.1, y);
                        ctx.stroke();
                      }
                    }
                  }}
                  onPointerMove={(e) => {
                    if (!isDrawingRef.current || drawMode !== 'pen' || !canvasRef.current) return;
                    const ctx = canvasRef.current.getContext('2d');
                    if (ctx) {
                      const rect = canvasRef.current.getBoundingClientRect();
                      const x = (e.clientX - rect.left) * (400 / rect.width);
                      const y = (e.clientY - rect.top) * (400 / rect.height);
                      ctx.lineTo(x, y);
                      ctx.stroke();
                    }
                  }}
                  onPointerUp={(e) => { 
                    isDrawingRef.current = false; 
                    try {
                      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
                    } catch (err) {}
                  }}
                  onPointerLeave={() => { isDrawingRef.current = false; }}
                />
              </div>
            </div>
            
            <div className="flex justify-end gap-2 pt-2">
              <button 
                onClick={() => {
                  const ctx = canvasRef.current?.getContext('2d');
                  if (ctx) ctx.clearRect(0, 0, 400, 400);
                }}
                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-bold rounded-lg transition-colors"
              >
                Clear
              </button>
              <button 
                onClick={() => {
                  if (canvasRef.current) {
                    const dataUrl = canvasRef.current.toDataURL();
                    setUiButtons([...uiButtons, { id: `btn_${Date.now()}`, name: `Drawn Button ${uiButtons.length + 1}`, type: 'shape', data: dataUrl } as any]);
                    setShowDrawCanvas(false);
                  }
                }}
                className="px-6 py-2 bg-pink-600 hover:bg-pink-500 text-white text-xs font-bold rounded-lg transition-colors"
              >
                Save Button
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- SPACIOUS JAVASCRIPT CODE EDITOR MODAL --- */}
      {editingJsAction && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-[2000000] flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-[#151518] border border-white/15 rounded-2xl w-full max-w-2xl p-6 shadow-2xl flex flex-col gap-4 animate-in zoom-in-95 duration-200 my-auto">
            <div className="flex justify-between items-center">
              <h3 className="font-bold text-yellow-400 text-sm flex items-center gap-2">
                <FileCode2 size={18} /> Edit Custom JavaScript Action
              </h3>
              <button 
                onClick={() => setEditingJsAction(null)} 
                className="text-gray-400 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>
            <div className="text-xs text-gray-400 leading-relaxed bg-black/30 p-3 rounded-lg border border-white/5 font-mono">
              <p className="font-bold text-gray-300 mb-1">// Available preview runtime globals:</p>
              <div className="grid grid-cols-2 gap-x-4">
                <p>- <span className="text-cyan-400">stageElements</span> / <span className="text-blue-400">setStageElements</span></p>
                <p>- <span className="text-cyan-400">events</span> / <span className="text-blue-400">setEvents</span></p>
                <p>- <span className="text-cyan-400">gameObjects</span> / <span className="text-blue-400">setGameObjects</span></p>
                <p>- <span className="text-cyan-400">layers</span> / <span className="text-blue-400">setLayers</span></p>
                <p>- <span className="text-cyan-400">activeSceneId</span> / <span className="text-blue-400">handleSwitchScene</span></p>
              </div>
            </div>
            <textarea
              value={editingJsAction.code}
              onChange={(e) => setEditingJsAction({ ...editingJsAction, code: e.target.value })}
              placeholder="// Write your custom JavaScript code here... e.g. setStageElements(prev => prev.map(el => el.type === 'obj' ? {...el, x: el.x + 10} : el));"
              className="w-full h-80 bg-black border border-white/10 rounded-xl p-4 text-xs font-mono text-yellow-100 outline-none focus:border-yellow-500/50 custom-scrollbar resize-none"
            />
            <div className="flex justify-end gap-2">
              <button 
                onClick={() => setEditingJsAction(null)}
                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-bold rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={() => {
                  try {
                    const runUserCode = new Function(
                      'stageElements', 'setStageElements', 
                      'activeSceneId', 'handleSwitchScene',
                      'events', 'setEvents',
                      'gameObjects', 'setGameObjects',
                      'layers', 'setLayers',
                      'activeLayerId', 'setActiveLayerId',
                      editingJsAction.code
                    );
                    runUserCode(
                      stageElements, setStageElements, 
                      activeSceneId, handleSwitchScene,
                      events, setEvents,
                      gameObjects, setGameObjects,
                      layers, setLayers,
                      activeLayerId, setActiveLayerId
                    );
                  } catch (err: any) {
                    alert(`JS Test Error: ${err.message}`);
                  }
                }}
                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-bold rounded-lg transition-colors border border-white/5"
              >
                Run Test
              </button>
              <button 
                onClick={() => {
                  const newEvents = [...events];
                  newEvents[editingJsAction.evIndex].actions[editingJsAction.actIndex].code = editingJsAction.code;
                  setEvents(newEvents);
                  setEditingJsAction(null);
                }}
                className="px-6 py-2 bg-yellow-500 hover:bg-yellow-400 text-black text-xs font-bold rounded-lg transition-colors"
              >
                Save & Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Export Modal */}
      {showExportModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[2000000] flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-[#151518] border border-white/10 rounded-3xl w-full max-w-lg p-8 shadow-2xl flex flex-col gap-8 animate-in zoom-in-95 duration-200 my-auto">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-xl font-bold text-white">Export Project</h3>
                <p className="text-xs text-gray-500 mt-1">Choose how you want to package your game</p>
              </div>
              <button onClick={() => setShowExportModal(false)} className="w-10 h-10 rounded-full bg-zinc-800/50 hover:bg-zinc-800 text-gray-400 hover:text-white flex items-center justify-center transition-all">
                <X size={20} />
              </button>
            </div>

            <div className="grid grid-cols-1 gap-4">
              <button 
                onClick={() => {
                  const gameData = {
                    scenes,
                    sceneElements,
                    sceneEvents,
                    gameObjects,
                    uiButtons,
                    environments,
                    stageBgColor,
                    aspectRatio,
                    VIRTUAL_WIDTH,
                    VIRTUAL_HEIGHT,
                    activeSceneId
                  };
                  generateProjectZip(gameData);
                  setShowExportModal(false);
                }}
                className="flex items-center gap-4 p-5 bg-zinc-900/50 hover:bg-blue-500/10 border border-white/5 hover:border-blue-500/30 rounded-2xl transition-all group"
              >
                <div className="w-12 h-12 rounded-xl bg-blue-500/20 text-blue-400 flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform">
                  <Download size={24} />
                </div>
                <div className="text-left">
                  <div className="text-sm font-bold text-white">Download Zip Code</div>
                  <div className="text-[11px] text-gray-500 mt-0.5">Download the complete source code for local development.</div>
                </div>
              </button>

              <button 
                onClick={() => {
                  setShowExportModal(false);
                  if (isGithubConnected) {
                    setShowGithubRepoModal(true);
                  } else {
                    setShowGithubConnectModal(true);
                  }
                }}
                className="flex items-center gap-4 p-5 bg-zinc-900/50 hover:bg-purple-500/10 border border-white/5 hover:border-purple-500/30 rounded-2xl transition-all group"
              >
                <div className="w-12 h-12 rounded-xl bg-purple-500/20 text-purple-400 flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform">
                  <Github size={24} />
                </div>
                <div className="text-left">
                  <div className="text-sm font-bold text-white flex items-center gap-2 flex-wrap">
                    Upload to GitHub Pages
                    {isGithubConnected && (
                      <span className="text-[10px] bg-purple-500/30 text-purple-300 px-2 py-0.5 rounded-full border border-purple-500/30 font-medium">
                        Connected as {githubUsername}
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-gray-500 mt-0.5">Deploy your game instantly to a web URL via GitHub.</div>
                </div>
              </button>

              <button 
                onClick={() => {
                  setShowExportModal(false);
                  if (isGithubConnected) {
                    setShowMobileAppModal(true);
                  } else {
                    setShowGithubConnectModal(true);
                  }
                }}
                className="flex items-center gap-4 p-5 bg-zinc-900/50 hover:bg-emerald-500/10 border border-white/5 hover:border-emerald-500/30 rounded-2xl transition-all group"
              >
                <div className="w-12 h-12 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform">
                  <Smartphone size={24} />
                </div>
                <div className="text-left">
                  <div className="text-sm font-bold text-white flex items-center gap-2 flex-wrap">
                    Convert to Mobile App
                    {isGithubConnected && (
                      <span className="text-[10px] bg-emerald-500/30 text-emerald-300 px-2 py-0.5 rounded-full border border-emerald-500/30 font-medium">
                        Connected as {githubUsername}
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-gray-500 mt-0.5">Generate a native Android or iOS wrapper for your game.</div>
                </div>
              </button>
            </div>
            
            <div className="text-center">
              <p className="text-[10px] text-zinc-600 uppercase tracking-[0.2em]">Build Production Bundle {appVersion}</p>
            </div>
          </div>
        </div>
      )}

      {/* GitHub Connect Modal */}
      {showGithubConnectModal && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-md z-[3000000] flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-[#0b0b0d] border border-white/10 rounded-[32px] w-full max-w-lg p-6 md:p-8 shadow-[0_0_50px_rgba(0,0,0,0.8)] flex flex-col gap-6 animate-in zoom-in-95 duration-200 my-auto text-left relative overflow-hidden">
            {/* Top decorative gradient glow */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-48 h-1 bg-gradient-to-r from-cyan-500 via-purple-500 to-pink-500 blur-sm rounded-full opacity-60" />

            <div className="flex items-center justify-between border-b border-white/5 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-white shadow-md">
                  <Github size={20} />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white tracking-tight">Connect Developer Account</h3>
                  <p className="text-xs text-zinc-400">Deploy games and bundles securely to GitHub</p>
                </div>
              </div>
              <button 
                onClick={() => {
                  setShowGithubConnectModal(false);
                  setPatError(null);
                }}
                className="p-1.5 rounded-full hover:bg-white/5 text-gray-400 hover:text-white transition-all"
              >
                <X size={18} />
              </button>
            </div>

            {/* Tab Selection */}
            <div className="flex p-1 bg-zinc-950 rounded-2xl border border-white/5 gap-1.5">
              {[
                { id: 'oauth', label: 'GitHub OAuth', desc: 'Secure Popup' },
                { id: 'pat', label: 'Personal Token', desc: 'Personal PAT' }
              ].map((tab) => {
                const isActive = githubConnectTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => {
                      setGithubConnectTab(tab.id as any);
                      setPatError(null);
                    }}
                    className={`flex-1 py-3 rounded-xl text-xs font-bold transition-all text-center flex flex-col items-center justify-center relative overflow-hidden ${
                      isActive 
                        ? 'bg-zinc-900 text-white border border-white/10 shadow-[0_4px_20px_rgba(0,0,0,0.4)]' 
                        : 'text-zinc-400 hover:text-white hover:bg-white/[0.02]'
                    }`}
                  >
                    {isActive && (
                      <motion.div 
                        layoutId="activeTabIndicator" 
                        className="absolute bottom-0 inset-x-4 h-0.5 bg-cyan-400 rounded-full" 
                        transition={{ type: "spring", stiffness: 300, damping: 30 }}
                      />
                    )}
                    <span>{tab.label}</span>
                    <span className="text-[9px] font-normal opacity-50 mt-0.5">{tab.desc}</span>
                  </button>
                );
              })}
            </div>

            {/* Dynamic visual representation of active token method */}
            <div className="flex flex-col items-center justify-center py-4 bg-zinc-950/40 rounded-2xl border border-white/5 gap-3 animate-in fade-in duration-300">
              {githubConnectTab === 'oauth' ? (
                <>
                  <div className="relative flex items-center justify-center">
                    <div className="absolute inset-0 bg-purple-500/10 blur-xl rounded-full scale-150 animate-pulse" />
                    <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-purple-600 to-indigo-600 p-0.5 shadow-lg shadow-purple-500/10 hover:scale-105 transition-transform duration-300">
                      <div className="w-full h-full rounded-[14px] bg-[#0b0b0d] flex items-center justify-center text-white">
                        <Github size={30} className="animate-bounce-subtle" />
                      </div>
                    </div>
                  </div>
                  <div className="text-center">
                    <span className="text-xs font-bold text-white block">Official GitHub Authorization</span>
                    <span className="text-[10px] text-zinc-500">Redirects to GitHub's verified OAuth gateway</span>
                  </div>
                </>
              ) : (
                <>
                  <div className="relative flex items-center justify-center">
                    <div className="absolute inset-0 bg-cyan-500/10 blur-xl rounded-full scale-150 animate-pulse" />
                    <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-cyan-500 to-emerald-500 p-0.5 shadow-lg shadow-cyan-500/10 hover:scale-105 transition-transform duration-300">
                      <div className="w-full h-full rounded-[14px] bg-[#0b0b0d] flex items-center justify-center text-cyan-400">
                        <Key size={28} className="animate-pulse" />
                      </div>
                    </div>
                  </div>
                  <div className="text-center">
                    <span className="text-xs font-bold text-white block">Developer Access Token</span>
                    <span className="text-[10px] text-zinc-500">Secured with Classic PAT classic credentials</span>
                  </div>
                </>
              )}
            </div>

            {/* Tab content */}
            <div className="flex-1 space-y-4">
              {githubConnectTab === 'pat' && (
                <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <p className="text-xs text-zinc-400 leading-relaxed">
                    This method runs 100% locally on your client machine. It's the most secure and dependable setup for private workspaces and serverless static platforms like <strong className="text-zinc-200">Vercel</strong>.
                  </p>
                  
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
                      <Shield size={12} className="text-cyan-400" />
                      Personal Access Token (PAT)
                    </label>
                    <input
                      type="password"
                      placeholder="Paste token (ghp_...)"
                      value={patToken}
                      onChange={(e) => setPatToken(e.target.value)}
                      className="w-full bg-zinc-950 border border-white/10 rounded-xl px-4 py-3 text-white text-xs outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50 transition-all font-mono shadow-inner placeholder:text-zinc-600"
                    />
                  </div>

                  <div className="bg-zinc-950/60 border border-white/5 p-4 rounded-xl space-y-3.5 text-[11px] text-zinc-400">
                    <div className="space-y-1.5">
                      <span className="font-bold text-white flex items-center gap-1 text-[12px]">
                        <HelpCircle size={14} className="text-cyan-400" />
                        Required Permissions & Scopes:
                      </span>
                      <p className="text-[10px] text-zinc-400 leading-relaxed">
                        To enable seamless repository creation, GitHub Pages publishing, and APK compilation, your Personal Access Token must have specific permissions.
                      </p>
                    </div>

                    <div className="border-t border-white/5 pt-3.5 space-y-2">
                      <span className="font-semibold text-zinc-200 block text-[11px]">
                        Option A: Classic PAT (Classic Token)
                      </span>
                      <p className="text-[10px] leading-relaxed">
                        Go to <a href="https://github.com/settings/tokens/new?scopes=repo,workflow,admin:repo_hook,delete_repo,read:user,user:email&description=Animato%20Studio" target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline inline-flex items-center gap-0.5 font-medium">GitHub Classic Settings <ExternalLink size={10} /></a> and ensure these scopes are checked:
                      </p>
                      <ul className="list-disc list-inside space-y-1 pl-1 text-[10px] leading-relaxed text-zinc-300">
                        <li><strong className="text-zinc-100">repo</strong> (Full repository control)</li>
                        <li><strong className="text-zinc-100">workflow</strong> (Update workflow files)</li>
                        <li><strong className="text-zinc-100">admin:repo_hook</strong> (Manage repository webhooks)</li>
                        <li><strong className="text-zinc-100">delete_repo</strong> (Delete connected repos if needed)</li>
                        <li><strong className="text-zinc-100">read:user</strong> & <strong className="text-zinc-100">user:email</strong> (Retrieve profile info)</li>
                      </ul>
                    </div>

                    <div className="border-t border-white/5 pt-3.5 space-y-2">
                      <span className="font-semibold text-zinc-200 block text-[11px]">
                        Option B: Fine-grained PAT (Beta Token)
                      </span>
                      <p className="text-[10px] leading-relaxed">
                        Go to <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline inline-flex items-center gap-0.5 font-medium">GitHub Fine-grained Settings <ExternalLink size={10} /></a>. Select your target repositories, and set these <strong className="text-zinc-200">Repository Permissions</strong> to <strong className="text-emerald-400">Read & Write</strong>:
                      </p>
                      <ul className="list-disc list-inside space-y-1 pl-1 text-[10px] leading-relaxed text-zinc-300">
                        <li><strong className="text-zinc-100">Contents</strong>: Read and Write</li>
                        <li><strong className="text-zinc-100">Workflows</strong>: Read and Write</li>
                        <li><strong className="text-zinc-100">Pages</strong>: Read and Write</li>
                        <li><strong className="text-zinc-100">Actions</strong>: Read and Write</li>
                        <li><strong className="text-zinc-100">Administration</strong>: Read and Write</li>
                        <li><strong className="text-zinc-100">Metadata</strong>: Read-only (required automatically)</li>
                      </ul>
                    </div>
                  </div>

                  {patError && (
                    <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-xs rounded-xl font-medium leading-relaxed">
                      {patError}
                    </div>
                  )}

                  <button
                    onClick={handlePatConnect}
                    disabled={isVerifyingPat || !patToken.trim()}
                    className="w-full py-3 bg-cyan-600 hover:bg-cyan-500 text-white font-bold rounded-xl transition-all flex items-center justify-center gap-2 text-xs shadow-lg shadow-cyan-900/10 disabled:opacity-40"
                  >
                    {isVerifyingPat ? (
                      <>
                        <RefreshCw size={16} className="animate-spin" />
                        Verifying Secure Token...
                      </>
                    ) : (
                      'Verify & Connect Developer PAT'
                    )}
                  </button>
                </div>
              )}

              {githubConnectTab === 'oauth' && (
                <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <p className="text-xs text-zinc-400 leading-relaxed">
                    Authorize the workspace through secure GitHub OAuth. This links your account through an official safe login callback sequence inside a standard popup dialog.
                  </p>
                  
                  <div className="pt-2">
                    <button
                      onClick={handleGithubConnect}
                      disabled={isConnectingOauth}
                      className="w-full py-3.5 bg-white text-black hover:bg-zinc-200 font-bold rounded-xl transition-all flex items-center justify-center gap-2.5 text-xs shadow-xl active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isConnectingOauth ? (
                        <>
                          <RefreshCw size={14} className="animate-spin text-zinc-800" />
                          <span>Connecting with GitHub...</span>
                        </>
                      ) : (
                        <>
                          <Github size={16} />
                          <span>Authorize & Sign In with GitHub</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end border-t border-white/5 pt-4">
              <button 
                onClick={() => {
                  setShowGithubConnectModal(false);
                  setPatError(null);
                }}
                className="px-5 py-2.5 bg-transparent text-zinc-400 hover:text-white text-xs font-semibold rounded-xl hover:bg-white/5 transition-all"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- FULL VIEWPORT DEVICE PREVIEW OVERLAY --- */}
      {isPreviewing && (
        <div className="fixed inset-0 bg-black/95 z-[4000000] flex flex-col items-center justify-center p-4 animate-in fade-in duration-300">
          {/* Floating Exit Button */}
          <button 
            onClick={() => setIsPreviewing(false)}
            className="absolute top-4 right-4 px-5 py-2 bg-red-600 hover:bg-red-500 text-white text-xs font-bold rounded-full flex items-center gap-2 shadow-2xl z-[100000] transition-colors"
          >
            <X size={14} /> Stop Preview
          </button>
          
          {/* Device Frame mockup */}
          <div 
            className={`relative rounded-[24px] border-[8px] border-zinc-800 shadow-[0_0_40px_rgba(0,0,0,0.8)] overflow-hidden flex items-center justify-center bg-[#111] transition-all duration-300 ${
              aspectRatio === 'landscape' ? 'w-full max-w-4xl aspect-[16/9]' : 'h-[80vh] max-h-full aspect-[9/16]'
            }`}
            ref={(node) => {
              if (node) {
                const rect = node.getBoundingClientRect();
                const scale = Math.min((rect.width - 16) / VIRTUAL_WIDTH, (rect.height - 16) / VIRTUAL_HEIGHT);
                node.style.setProperty('--preview-scale', scale.toString());
              }
            }}
          >
            {/* The Actual Stage Game Canvas */}
            <div 
              className="relative overflow-hidden shrink-0"
              style={{ 
                backgroundColor: stageBgColor,
                width: `${VIRTUAL_WIDTH}px`,
                height: `${VIRTUAL_HEIGHT}px`,
                transform: 'scale(var(--preview-scale, 1))',
                transformOrigin: 'center'
              }}
            >
              {stageElements.map(el => {
                const gameObject = (el.type === 'obj' || el.type === 'enemy' as any) ? gameObjects.find(o => o.id === el.data) : null;
                const firstAnim = gameObject?.animations?.[0];
                const isButton = el.type === 'btn';
                const isText = gameObject?.type === 'text';
                
                // Calculate dynamic z-index based on layer
                const layerIdx = layers.findIndex(l => l.id === (el as any).layerId);
                const layerZ = layerIdx === -1 ? 10 : (layers.length - layerIdx) * 10;
                const finalZ = isText ? layerZ + 2000 : (isPreviewing ? layerZ : (selectedElementId === el.id ? 5000 : layerZ));

                return (
                  <div
                    key={el.id}
                    className="absolute"
                    style={{
                      left: el.type === 'bg' ? 0 : el.x,
                      top: el.type === 'bg' ? 0 : el.y,
                      width: el.type === 'bg' ? '100%' : el.width,
                      height: el.type === 'bg' ? '100%' : el.height,
                      backgroundImage: (el.type !== 'obj' && (el.url || el.data)) ? `url(${el.url || el.data})` : undefined,
                      backgroundSize: '100% 100%',
                      backgroundRepeat: 'no-repeat',
                      backgroundColor: (!el.url && !el.data && el.type === 'btn') ? 'rgba(236,72,153,0.2)' : undefined,
                      zIndex: el.type === 'bg' ? 0 : finalZ,
                      cursor: isButton ? 'pointer' : 'default',
                      opacity: el.opacity !== undefined ? el.opacity : 1,
                      filter: el.colorFilter ? `hue-rotate(90deg) drop-shadow(0 0 8px ${el.colorFilter})` : undefined,
                      transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
                      pointerEvents: (isButton || el.type === 'obj' || el.type === 'enemy') ? 'auto' : 'none'
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isButton || el.type === 'obj' || el.type === 'enemy') {
                        handleButtonClickInPreview(el.id);
                      }
                    }}
                  >
                    {el.type === 'obj' && gameObject?.type === 'text' ? (
                      <div 
                        className="w-full h-full flex items-center justify-center text-center font-bold"
                        style={{
                          fontSize: `${gameObject.fontSize ?? 24}px`,
                          color: gameObject.color ?? '#ffffff',
                          fontFamily: gameObject.fontFamily ?? 'Inter, sans-serif',
                          lineHeight: 1.2,
                          wordBreak: 'break-word',
                          overflow: 'visible'
                        }}
                      >
                        {gameObject.textContent ?? gameObject.name ?? 'Text'}
                      </div>
                    ) : el.type === 'obj' && firstAnim && firstAnim.frames && firstAnim.frames.length > 0 ? (
                      <AnimatedSprite frames={firstAnim.frames} fps={firstAnim.fps || 24} speed={firstAnim.speed || 1} width={el.width} height={el.height} />
                    ) : el.type === 'obj' && (!firstAnim || !firstAnim.frames || firstAnim.frames.length === 0) ? (
                      <div className="w-full h-full bg-cyan-500/20 border border-cyan-500/50 flex flex-col items-center justify-center text-[10px] text-cyan-400 font-bold p-1 text-center">
                        {gameObject?.name || 'Object'}
                      </div>
                    ) : null}
                    {el.isToast && (
                      <div className="w-full h-full bg-black/95 text-yellow-400 border border-yellow-500/80 rounded px-3 py-1 text-xs font-mono font-bold flex items-center justify-center shadow-lg text-center animate-bounce">
                        {el.text}
                      </div>
                    )}
                  </div>
                );
              })}
              
              {stageElements.length === 0 && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-zinc-500 text-xs font-mono">
                  <Play size={32} className="mb-2 text-green-500 animate-pulse" />
                  <span>Scene is empty - Running Preview...</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <GithubRepoModal 
        isOpen={showGithubRepoModal}
        onClose={() => setShowGithubRepoModal(false)}
        projectName={projectName}
        gameData={{
          scenes,
          sceneElements: { ...sceneElements, [activeSceneId]: stageElements },
          sceneEvents: { ...sceneEvents, [activeSceneId]: events },
          gameObjects,
          uiButtons,
          environments,
          layers,
          stageBgColor,
          aspectRatio,
          activeSceneId,
          VIRTUAL_WIDTH,
          VIRTUAL_HEIGHT
        }}
        userEmail={userEmail}
      />

      <MobileAppModal
        isOpen={showMobileAppModal}
        onClose={() => setShowMobileAppModal(false)}
        projectName={projectName}
        userEmail={userEmail}
        gameData={{
          scenes,
          sceneElements: { ...sceneElements, [activeSceneId]: stageElements },
          sceneEvents: { ...sceneEvents, [activeSceneId]: events },
          gameObjects,
          uiButtons,
          environments,
          layers,
          stageBgColor,
          aspectRatio,
          activeSceneId,
          VIRTUAL_WIDTH,
          VIRTUAL_HEIGHT
        }}
      />
    </div>
  );
};
