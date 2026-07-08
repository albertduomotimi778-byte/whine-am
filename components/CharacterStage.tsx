
import React, { useRef, useEffect, useCallback, useMemo, useState } from 'react';
import { VisemeShape, CharacterComposition, CharacterPart, LightSource } from '../types';
import { RefreshCcw, Crosshair, Sun, Lightbulb, Zap } from 'lucide-react';
import { PuppetWarp } from './PuppetWarp';
import { getMouthPhysicsTargets } from '../utils/visemeUtils';
import { showAppToast } from '../utils/toastHelper';

const isAnyAncestorHiddenForChar = (char: Record<string, any>, partId: string): boolean => {
  let currentId = partId;
  const maxDepth = 100;
  let depth = 0;
  while (currentId && currentId !== "root" && depth < maxDepth) {
    depth++;
    const p = char[currentId];
    if (!p) break;
    if (p.parentId) {
      const parent = char[p.parentId];
      if (parent) {
        if (parent.isVisible === false || parent.opacity === 0) {
          const parentLabel = (parent.label || '').toLowerCase();
          const parentIsLoop = parent.tags?.includes('Loop') || parentLabel.includes('loop');
          if (!parentIsLoop) {
            return true;
          }
        }
        currentId = p.parentId;
      } else {
        break;
      }
    } else {
      break;
    }
  }
  return false;
};

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

interface CharacterStageProps {
  viseme: { shape: VisemeShape, intensity: number, openness: number, spread: number, squeeze: number };
  visemeMap: Record<VisemeShape, string | null>;
  character: CharacterComposition | null;
  theme?: 'light' | 'dark';
  editingPartId?: string | null;
  onAnchorChange?: (partId: string, x: number, y: number) => void;
  showAnchors?: boolean;
  activePartId?: string;
  shadowMode?: boolean;
  boneTransforms?: Record<string, { rotation: number, scaleX: number, scaleY: number }>; 
  onBoneSelect?: (partId: string, boneId: string | null) => void;
  activeBoneId?: string | null;
  showSkeleton?: boolean; 
  activeRigTool?: 'BONE' | 'HAND' | 'DELETE' | 'MOVE';
  onBonesChange?: (partId: string, bones: any[]) => void;
  rigType?: 'MESH' | 'HUMAN';
  disableSmoothness?: boolean;
  disableRigging?: boolean;
  onInteractionEnd?: () => void;
  isLowPerformanceMode?: boolean;
  characterFilters?: { saturation: number, contrast: number, brightness: number, sharpness: number, autoBlink?: boolean, eyeSquint?: number, pupilX?: number, pupilY?: number, headTurn?: number, exprState?: number };
  cameraTransform?: { x: number; y: number; scale: number; rotation: number };
}

export const CharacterStage = React.memo<CharacterStageProps>(({ 
  viseme, 
  visemeMap, 
  character, 
  theme = 'light',
  editingPartId,
  onAnchorChange,
  showAnchors = false,
  activePartId,
  shadowMode = false,
  boneTransforms = {},
  onBoneSelect,
  activeBoneId,
  showSkeleton = false,
  activeRigTool = 'BONE',
  onBonesChange,
  rigType = 'MESH',
  disableSmoothness = false,
  disableRigging = false,
  onInteractionEnd,
  isLowPerformanceMode = false,
  characterFilters,
  cameraTransform = { x: 0, y: 0, scale: 1, rotation: 0 }
}) => {
  const { shape } = viseme;
  
  const activeMouthTexture = visemeMap[shape] || visemeMap[VisemeShape.REST];
  
  const partRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const animationFrameRef = useRef<number>(0);
  const characterRef = useRef(character);
  const visemeRef = useRef(viseme);
  const disableSmoothnessRef = useRef(disableSmoothness);
  const isLowPerformanceModeRef = useRef(isLowPerformanceMode);
  const characterFiltersRef = useRef(characterFilters);
  const localLowPerfOverrideRef = useRef(false);
  
  const onAnchorChangeRef = useRef(onAnchorChange);
  const onBoneSelectRef = useRef(onBoneSelect);
  const onInteractionEndRef = useRef(onInteractionEnd);
  
  // Synchronously update all refs on every render to prevent timing and race conditions
  characterRef.current = character;
  visemeRef.current = viseme;
  disableSmoothnessRef.current = disableSmoothness;
  isLowPerformanceModeRef.current = isLowPerformanceMode;
  characterFiltersRef.current = characterFilters;
  onAnchorChangeRef.current = onAnchorChange;
  onBoneSelectRef.current = onBoneSelect;
  onInteractionEndRef.current = onInteractionEnd;

  const physicsRef = useRef({
      x: 1, y: 1, offY: 0,
      vx: 0, vy: 0, vOffY: 0,
      jiggleY: 0, vJiggleY: 0
  });

  const lastTimeRef = useRef<number>(0);
  const timeAccumulatorRef = useRef<number>(0);
  const hasUserInteractedRef = useRef(false);

  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>(
    window.innerWidth > window.innerHeight ? 'landscape' : 'portrait'
  );

  useEffect(() => {
    const handleResize = () => {
      setOrientation(window.innerWidth > window.innerHeight ? 'landscape' : 'portrait');
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const [canvasTransform, setCanvasTransform] = useState<{ scale: number; x: number; y: number }>(() => {
    const saved = sessionStorage.getItem('stageTransform');
    return saved ? JSON.parse(saved) : { scale: 1, x: 0, y: 0 };
  });

  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    sessionStorage.setItem('stageTransform', JSON.stringify(canvasTransform));
    if (wrapperRef.current) {
        const { x, y, scale } = canvasTransform;
        wrapperRef.current.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    }
  }, [canvasTransform]);

  const handleWheel = (e: React.WheelEvent) => {
    hasUserInteractedRef.current = true;
    if (orientation !== 'landscape') return;
    e.preventDefault();
    const zoomFactor = -e.deltaY * 0.001;
    const prev = canvasTransform;
    
    // Zoom
    const targetScale = Math.max(0.1, Math.min(10, prev.scale + zoomFactor));
    
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (!rect) return;

    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    // Simplification for pan on zoom
    const scaleRatio = targetScale / prev.scale;
    const newX = mouseX - (mouseX - prev.x) * scaleRatio;
    const newY = mouseY - (mouseY - prev.y) * scaleRatio;

    setCanvasTransform({ x: newX, y: newY, scale: targetScale });
  };

  // Pan
  const isDraggingPivotRef = useRef(false);
  const activePivotPartIdRef = useRef<string | null>(null);
  const isPanningRef = useRef(false);
  const startPanRef = useRef({ x: 0, y: 0 });

  const handlePointerDown = (e: React.PointerEvent) => {
    hasUserInteractedRef.current = true;
    if (orientation !== 'landscape') return;
    if (isDraggingPivotRef.current) return;
    
    isPanningRef.current = true;
    startPanRef.current = { x: e.clientX - canvasTransform.x, y: e.clientY - canvasTransform.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isPanningRef.current) return;
    
    setCanvasTransform(prev => ({ ...prev, x: e.clientX - startPanRef.current.x, y: e.clientY - startPanRef.current.y }));
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    isPanningRef.current = false;
    let interactionEnded = false;
    if (isDraggingPivotRef.current) {
        isDraggingPivotRef.current = false;
        activePivotPartIdRef.current = null;
        interactionEnded = true;
    }
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    if (interactionEnded && onInteractionEndRef.current) {
        onInteractionEndRef.current();
    }
  };

  const animationLoop = useCallback((time: number) => {
    if (disableSmoothnessRef.current) {
        return;
    }

    const filterHash = characterFiltersRef.current ? `${characterFiltersRef.current.headTurn}_${characterFiltersRef.current.exprState}_${characterFiltersRef.current.pupilX}_${characterFiltersRef.current.pupilY}_${characterFiltersRef.current.eyeSquint}` : '';
    const filtersChanged = (animationLoop as any)._lastFilterHash !== filterHash;
    (animationLoop as any)._lastFilterHash = filterHash;

    const isOptimized = isLowPerformanceModeRef.current || localLowPerfOverrideRef.current;

    if (!filtersChanged && isOptimized && visemeRef.current.intensity < 0.01 && (!characterFiltersRef.current || (characterFiltersRef.current.eyeSquint || 0) < 1)) {
        // Evaluate if there are any active loops or blinks. If not, we can safely return to save battery.
        const char = characterRef.current;
        let hasActiveAnimations = false;
        if (char) {
            const parts = Object.values(char) as CharacterPart[];
            for (let i = 0; i < parts.length; i++) {
                const p = parts[i];
                const parent = p.parentId ? char[p.parentId] : null;
                const isLoopChild = parent && (parent.tags.includes('Loop') || parent.label.toLowerCase().includes('loop')) && !(parent.children.length > 0 && parent.children.every(c => char[c] && (char[c].tags.includes('Loop') || char[c].label.toLowerCase().includes('loop'))));

                if (!p.isVisible && !isLoopChild) continue;
                const name = p.label.toLowerCase();
                if (p.tags.includes('Blink') || name.includes('blink')) { hasActiveAnimations = true; break; }
                if (isLoopChild) { hasActiveAnimations = true; break; }
            }
        }
        if (!hasActiveAnimations) {
            animationFrameRef.current = requestAnimationFrame(animationLoop);
            return;
        }
    }

    const char = characterRef.current;
    if (!char) return;
    
    // --- GC OPTIMIZATION: Cache object serialization to avoid 60FPS memory leaks ---
    if ((animationLoop as any)._lastCharRef !== char) {
        const parts = Object.values(char) as CharacterPart[];
        (animationLoop as any)._cachedParts = parts;
        (animationLoop as any)._cachedActiveParts = isOptimized ? parts.filter(p => {
             const parent = p.parentId ? char[p.parentId] : null;
             const isLoopChild = parent && (parent.tags.includes('Loop') || parent.label.toLowerCase().includes('loop')) && !(parent.children.length > 0 && parent.children.every(c => char[c] && (char[c].tags.includes('Loop') || char[c].label.toLowerCase().includes('loop'))));
             const name = p.label.toLowerCase();
             const isFace = name.includes('eye') || name.includes('pupil') || p.tags.includes('Eyeball') || name.includes('mouth') || p.tags.includes('Mouth') || name.includes('nose') || p.tags.includes('Nose') || name.includes('eyebrow') || p.tags.includes('Eyebrow') || name.includes('blush') || name.includes('whisker');
             return (p.isVisible || isLoopChild) && (isFace || p.id === 'headGroup' || p.tags.includes('Blink') || name.includes('blink') || isLoopChild)
        }) : parts;
        (animationLoop as any)._lastCharRef = char;
        (animationLoop as any)._lastLowPerfMode = isOptimized;
    } else if ((animationLoop as any)._lastLowPerfMode !== isOptimized) {
        // Re-filter if mode changed
        const parts = (animationLoop as any)._cachedParts;
        (animationLoop as any)._cachedActiveParts = isOptimized ? parts.filter((p: any) => {
             const parent = p.parentId ? char[p.parentId] : null;
             const isLoopChild = parent && (parent.tags.includes('Loop') || parent.label.toLowerCase().includes('loop')) && !(parent.children.length > 0 && parent.children.every(c => char[c] && (char[c].tags.includes('Loop') || char[c].label.toLowerCase().includes('loop'))));
             const name = p.label.toLowerCase();
             const isFace = name.includes('eye') || name.includes('pupil') || p.tags.includes('Eyeball') || name.includes('mouth') || p.tags.includes('Mouth') || name.includes('nose') || p.tags.includes('Nose') || name.includes('eyebrow') || p.tags.includes('Eyebrow') || name.includes('blush') || name.includes('whisker');
             return (p.isVisible || isLoopChild) && (isFace || p.id === 'headGroup' || p.tags.includes('Blink') || name.includes('blink') || isLoopChild)
        }) : parts;
        (animationLoop as any)._lastLowPerfMode = isOptimized;
    }
    
    if (lastTimeRef.current === 0) lastTimeRef.current = time;
    const delta = (time - lastTimeRef.current) / 1000;
    lastTimeRef.current = time;

    // Detect and prevent lagging/crashing on low-end hardware automatically
    if (delta > 0.045 && delta < 0.5) { // frame took longer than 45ms (~22 FPS)
        (animationLoop as any)._slowFrameCount = ((animationLoop as any)._slowFrameCount || 0) + 1;
        if ((animationLoop as any)._slowFrameCount > 35) { // 35 consecutive slow frames
            if (!localLowPerfOverrideRef.current && !isLowPerformanceModeRef.current) {
                localLowPerfOverrideRef.current = true;
                console.warn("[Auto-Optimize] Sustained low framerate detected. Activating GPU Low Latency Mode for lag prevention.");
                showAppToast("Fluid Mode: Dynamic device optimization enabled");
            }
        }
    } else if (delta < 0.02) {
        (animationLoop as any)._slowFrameCount = Math.max(0, ((animationLoop as any)._slowFrameCount || 0) - 1);
    }
    
    const safeDelta = Math.min(delta, 0.1);
    timeAccumulatorRef.current += safeDelta;

    const FIXED_STEP = 1 / 60;
    let didUpdate = false;

    while (timeAccumulatorRef.current >= FIXED_STEP) {
        timeAccumulatorRef.current -= FIXED_STEP;
        didUpdate = true;

        const v = visemeRef.current;
        const targets = getMouthPhysicsTargets(v.shape, v.intensity);
        const phys = physicsRef.current;

        // Snappy contraction muscles when opening, elastic damping recoils when closing to REST
        const k = targets.scaleY > phys.y ? 0.65 : 0.40;
        const d = targets.scaleY > phys.y ? 0.72 : 0.84;
        
        const ax = (targets.scaleX - phys.x) * k; phys.vx += ax; phys.vx *= d; phys.x += phys.vx;
        const ay = (targets.scaleY - phys.y) * k; phys.vy += ay; phys.vy *= d; phys.y += phys.vy;
        
        // Horizontal muscle squash/squeeze linkage: when mouth stretches open, it organically narrows
        const squashFactor = 1.0 - Math.max(0, phys.y - 1.0) * 0.15;
        phys.x *= squashFactor;

        const aOff = (targets.offsetY - phys.offY) * k; phys.vOffY += aOff; phys.vOffY *= d; phys.offY += phys.vOffY;
        
        // Vocal micro-tremor / organic flesh tremor on louder syllables
        const shiverAmp = v.intensity > 0.45 ? Math.sin(time * 0.12) * v.intensity * 2.8 : 0;
        const targetJiggle = shiverAmp;
        const aJig = (targetJiggle - phys.jiggleY) * 0.25; phys.vJiggleY += aJig; phys.vJiggleY *= 0.8; phys.jiggleY += phys.vJiggleY;
    }

    const activeParts = (animationLoop as any)._cachedActiveParts || [];

    const ancestorHiddenCache = new Map<string, boolean>();
    const checkAncestorHiddenCached = (partId: string): boolean => {
        if (ancestorHiddenCache.has(partId)) return ancestorHiddenCache.get(partId)!;
        const p = char[partId];
        if (!p) {
            ancestorHiddenCache.set(partId, false);
            return false;
        }
        if (p.parentId && p.parentId !== "root") {
            const parent = char[p.parentId];
            if (parent) {
                if (parent.isVisible === false || parent.opacity === 0) {
                    const parentLabel = (parent.label || '').toLowerCase();
                    const parentIsLoop = parent.tags?.includes('Loop') || parentLabel.includes('loop');
                    if (!parentIsLoop) {
                        ancestorHiddenCache.set(partId, true);
                        return true;
                    }
                }
                const parentHidden = checkAncestorHiddenCached(p.parentId);
                ancestorHiddenCache.set(partId, parentHidden);
                return parentHidden;
            }
        }
        ancestorHiddenCache.set(partId, false);
        return false;
    };

    activeParts.forEach((part: CharacterPart) => {
        const parent = part.parentId ? char[part.parentId] : null;
        const isLoopChild = parent && (parent.tags.includes('Loop') || parent.label.toLowerCase().includes('loop')) && !(parent.children.length > 0 && parent.children.every(c => char[c] && (char[c].tags.includes('Loop') || char[c].label.toLowerCase().includes('loop'))));
        const isAncestorHidden = checkAncestorHiddenCached(part.id);
        if ((!part.isVisible || isAncestorHidden) && !isLoopChild) return; 
        
        const element = partRefs.current.get(part.id);
        if (!element) return;
        
        let dynamicT = '';
        if (part.tags.includes('Mouth') && !part.tags.includes('Viseme')) {
             const phys = physicsRef.current;
             const intense = visemeRef.current.intensity || 0;
             const exprState = characterFiltersRef.current?.exprState || 0;

             let finalX = Math.max(0.1, phys.x);
             let finalY = phys.y;
             if (Math.abs(finalY) < 0.1) finalY = finalY < 0 ? -0.1 : 0.1;
             
             let finalOffY = phys.offY + phys.jiggleY;
             let extraTransform = '';

             // Forcefully reset mouth rotation to 0 to prevent any sadness tilt glitch
             part.transform.rotation = 0;

             if (exprState === 1) { // angry
                 finalY *= 0.75;
                 finalX *= 1.15; // tensed wide
                 finalOffY += 1.5;
             } else if (exprState === 2) { // sad
                 finalY *= 0.8;
                 finalX *= 0.88;  // narrow sadness (pure symmetry, rotation locked to 0)
                 finalOffY += 3.5; // pull further down to accentuate sadness drooping
             } else if (exprState === 3) { // happy
                 finalY *= 1.15;
                 finalX *= 1.35; // smiling stretch
                 finalOffY -= 2.0; // lift corners up
             } else if (exprState === 4) { // serious
                 finalY *= 0.75;
                 finalX *= 1.0;
             }

             dynamicT = `translateY(${finalOffY.toFixed(2)}px) scale(${finalX.toFixed(3)}, ${finalY.toFixed(3)})${extraTransform}`;
        }

        if (part.tags.includes('Eyebrow') || part.label.toLowerCase().includes('eyebrow')) {
            const exprState = characterFiltersRef.current?.exprState || 0;
            const labelLower = part.label.toLowerCase();
            const parentLabel = part.parentId && char[part.parentId] ? (char[part.parentId].label || '').toLowerCase() : '';
            const isRight = labelLower.includes('right') || labelLower.includes('_r') || labelLower.includes(' r ') || labelLower.endsWith(' r') || labelLower.includes('-r') || parentLabel.includes('right') || parentLabel.includes('_r');
            const isLeft = !isRight && (labelLower.includes('left') || labelLower.includes('_l') || labelLower.includes(' l ') || labelLower.endsWith(' l') || labelLower.includes('-l') || parentLabel.includes('left') || parentLabel.includes('_l'));
            let rotMod = 0;
            let yMod = 0;
            if (exprState === 1) { // angry
                 rotMod = isLeft ? -15 : 15;
                 yMod = 3; // lowered tensed
            } else if (exprState === 2) { // sad
                 rotMod = isLeft ? 15 : -15;
                 yMod = -2; // slightly lifted inner eyebrows
            } else if (exprState === 3) { // happy
                 rotMod = isLeft ? 5 : -5;
                 yMod = -4; // lifted eyebrows
            } else if (exprState === 4) { // serious
                 rotMod = isLeft ? -5 : 5;
                 yMod = 2; // lowered focus
            }
            
            // Auto eyebrow movement during lip sync (realistic bounce)
            const activeViseme = visemeRef.current;
            if (activeViseme && activeViseme.intensity > 0.05) {
                const talkingLift = -activeViseme.intensity * 6;
                const talkingRot = isLeft ? -activeViseme.intensity * 5 : activeViseme.intensity * 5;
                yMod += talkingLift;
                rotMod += talkingRot;
            }
            
            if (rotMod !== 0 || yMod !== 0) {
                 dynamicT += ` translateY(${yMod}px) rotate(${rotMod}deg)`;
            }
        }
        
        if (part.id === 'headGroup' && visemeRef.current.intensity > 0.05) {
             const bob = (visemeRef.current.intensity * 3.0).toFixed(2);
             dynamicT += ` translateY(${bob}px)`;
        }

        const name = part.label.toLowerCase();
        const headTurn = characterFiltersRef.current?.headTurn || 0;
        
        if (headTurn !== 0 && !part.isGroup) {
              let headTurnDepth = 0;
              if (part.tags.includes('Nose') || name.includes('nose')) headTurnDepth = 0.35;
              else if (part.tags.includes('Mouth') || name.includes('mouth') || part.tags.includes('Viseme')) headTurnDepth = 0.4;
              else if (part.tags.includes('Pupil') || name.includes('pupil') || part.tags.includes('Iris') || name.includes('iris')) headTurnDepth = 0.3;
              else if (part.tags.includes('Eyebrow') || name.includes('eyebrow')) headTurnDepth = 0.25;
              else headTurnDepth = 0.0;
              
              if (headTurnDepth !== 0) {
                   dynamicT += ` translateX(${headTurn * 10 * headTurnDepth}px) scaleX(${1 - Math.abs(headTurn) * 0.02})`;
              }
        }
        
        const eyes = {
            squint: characterFiltersRef.current?.eyeSquint || 0,
            px: characterFiltersRef.current?.pupilX || 0,
            py: characterFiltersRef.current?.pupilY || 0
        };
        const isPupil = name.includes('pupil') || part.tags.includes('Pupil');
        const isEyeOrPupil = isPupil || part.tags.includes('Eyelid') || name.includes('eyelid');
        const isBlinkLayer = part.tags.includes('Blink') || name.includes('blink');

        let dynamicOpacity: string | null = null;
        
        // --- BLINK ---
        if (isBlinkLayer) {
            const blinkInterval = 4.0;
            const blinkDuration = 0.15;
            const t = (time / 1000) % blinkInterval;
            if (t < blinkDuration) {
                dynamicOpacity = Math.sin((t / blinkDuration) * Math.PI).toString();
            } else {
                dynamicOpacity = '0';
            }
        }

        // --- LOOPS ---
        if (part.parentId) {
             const parent = char[part.parentId];
             if (parent && (parent.tags.includes('Loop') || parent.label.toLowerCase().includes('loop'))) {
                  const allChildrenAreLoops = parent.children.length > 0 && parent.children.every(childId => char[childId] && (char[childId].tags.includes('Loop') || char[childId].label.toLowerCase().includes('loop')));
                  
                  if (!allChildrenAreLoops) {
                      const loopSpeed = parent.loopSpeed ?? parent.opacity ?? 1;
                      const siblings = parent.children;
                      const numSiblings = siblings.length;
                      if (numSiblings > 0) {
                           const myIndex = siblings.indexOf(part.id);
                           let activeIndex = 0;
                           if (parent.isLoopActive !== false) {
                               const fps = Math.max(1, 12 * loopSpeed);
                               const cycle = numSiblings * 2;
                               activeIndex = Math.floor((time / 1000) * fps) % cycle;
                               if (activeIndex >= numSiblings) {
                                   activeIndex = cycle - 1 - activeIndex;
                               }
                           }
                           if (myIndex !== activeIndex) dynamicOpacity = '0';
                           else if (dynamicOpacity === null) {
                               dynamicOpacity = part.opacity?.toString() || '1';
                           }
                      }
                  }
             }
        }

        if (isPupil) {
             const exprState = characterFiltersRef.current?.exprState || 0;
             let shiftX = 0;
             let shiftY = 0;
             if (exprState === 1) { // angry: squint and glare slightly inwards and down
                 shiftY = 3;
                 const labelLower = part.label.toLowerCase();
                 const parentLabel = part.parentId && char[part.parentId] ? (char[part.parentId].label || '').toLowerCase() : '';
                 const isRight = labelLower.includes('right') || labelLower.includes('_r') || labelLower.includes(' r ') || labelLower.endsWith(' r') || labelLower.includes('-r') || parentLabel.includes('right') || parentLabel.includes('_r');
                  const isLeft = !isRight && (labelLower.includes('left') || labelLower.includes('_l') || labelLower.includes(' l ') || labelLower.endsWith(' l') || labelLower.includes('-l') || parentLabel.includes('left') || parentLabel.includes('_l'));
                 shiftX = isLeft ? 10 : -10;
             } else if (exprState === 2) { // sad: pleading upper shift
                 shiftY = -4;
             } else if (exprState === 4) { // serious: stare forward centered
                 shiftY = 1;
             }
             
             const fx = eyes.px + shiftX;
             const fy = eyes.py + shiftY;
             dynamicT += ` translate(${fx}%, ${fy}%)`;
        }
        if (isEyeOrPupil) {
             const squintScale = 1 - (eyes.squint / 100);
             dynamicT += ` scaleY(${Math.max(0.01, squintScale)})`;
        }
        if ((isPupil || isEyeOrPupil) && eyes.squint >= 100) {
             dynamicOpacity = '0';
        }

        if (dynamicOpacity !== null) {
            element.style.opacity = dynamicOpacity;
        } else {
            element.style.opacity = '';
        }
        
        if (dynamicT) element.style.transform = dynamicT;
        else element.style.transform = '';
    });

    animationFrameRef.current = requestAnimationFrame(animationLoop);
  }, []);

  useEffect(() => {
    lastTimeRef.current = 0;
    const loop = (time: number) => animationLoop(time);
    animationFrameRef.current = requestAnimationFrame(loop);
    return () => { if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current); };
  }, [animationLoop, disableSmoothness]);

  const handlePivotDown = useCallback((e: React.PointerEvent, partId: string) => {
      e.stopPropagation(); e.preventDefault();
      const el = partRefs.current.get(partId);
      if (el) {
          isDraggingPivotRef.current = true;
          activePivotPartIdRef.current = partId;
          el.setPointerCapture(e.pointerId);
      }
  }, []);

  const handleContainerPointerMove = useCallback((e: React.PointerEvent, contextId?: string) => {
      if (isDraggingPivotRef.current && activePivotPartIdRef.current === contextId && onAnchorChangeRef.current) {
          e.stopPropagation();
          const el = partRefs.current.get(contextId!);
          if (!el) return;
          const w = el.offsetWidth || 1; 
          const h = el.offsetHeight || 1;
          const x = (e.nativeEvent.offsetX / w) * 100; 
          const y = (e.nativeEvent.offsetY / h) * 100;
          onAnchorChangeRef.current(contextId!, Math.max(0, Math.min(100, x)), Math.max(0, Math.min(100, y)));
          return;
      }
  }, []);
  
  // handleGlobalPointerUp removed as its logic was merged into the master event bubble handler.

  // --- STABLE RENDERING ---
  const characterContent = useMemo(() => {
    if (!character) {
        return <div className="w-full h-full flex items-center justify-center pointer-events-none opacity-20"><RefreshCcw size={48} className="animate-spin text-gray-400" /></div>;
    }

    const computedZIndexMap = new Map<string, number>();
    let currentZ = 10000;
    const visited = new Set<string>();
    const traverseZ = (nodeId: string) => {
        if (visited.has(nodeId)) return;
        visited.add(nodeId);
        const p = character[nodeId];
        if (!p) return;
        computedZIndexMap.set(nodeId, currentZ--);
        if (p.children) {
            for (const childId of p.children) traverseZ(childId);
        }
    };
    traverseZ('root');

    const renderPartHierarchy = (partId: string): React.ReactNode => {

      const part = character[partId];
      if (!part) return null;
      
      const isMouth = part.tags.includes('Mouth');
      const isViseme = part.tags.includes('Viseme');
      if (isViseme) return null; 
      
      let forceVisible = false;
      if (part.parentId) {
         const parent = character[part.parentId];
         if (parent && (parent.tags.includes('Loop') || parent.label.toLowerCase().includes('loop'))) {
            const allChildrenAreLoops = parent.children.length > 0 && parent.children.every(c => character[c] && (character[c].tags.includes('Loop') || character[c].label.toLowerCase().includes('loop')));
            if (!allChildrenAreLoops) forceVisible = true;
         }
      }
      
      const isAncestorHidden = isAnyAncestorHiddenForChar(character, part.id);
      if (!forceVisible && (!part.isVisible || isAncestorHidden) && !isMouth) return null; 
      
      const effectiveAnchorX = part.transform.anchorX ?? 50;
      const effectiveAnchorY = part.transform.anchorY ?? 50;

      const DEFAULT_PART_SIZE = 150;
      const hasDimensions = (part.width !== undefined && part.width > 0) || (part.height !== undefined && part.height > 0);
      const width = hasDimensions ? part.width! : DEFAULT_PART_SIZE;
      const height = hasDimensions ? part.height! : DEFAULT_PART_SIZE;
      
      const texture = isMouth ? activeMouthTexture : part.imageUrl;
      const isEditing = editingPartId === partId;
      const isSelectedForAnchor = showAnchors && activePartId === partId;

      const partBoneTransforms: Record<string, {rotation: number, scaleX: number, scaleY: number}> = {};
      if (part.bones && part.bones.length > 0) {
          part.bones.forEach(b => {
              const key = `${part.id}|${b.id}`;
              if (boneTransforms[key]) {
                  partBoneTransforms[b.id] = boneTransforms[key];
              }
          });
      }

      const flipScaleX = part.transform.flipX ? -1 : 1;
      const flipScaleY = part.transform.flipY ? -1 : 1;
      const finalScaleX = part.transform.scaleX * flipScaleX;
      const finalScaleY = part.transform.scaleY * flipScaleY;

      const safeScaleX = Math.abs(part.transform.scaleX) < 0.01 ? 0.01 : Math.abs(part.transform.scaleX);
      const safeScaleY = Math.abs(part.transform.scaleY) < 0.01 ? 0.01 : Math.abs(part.transform.scaleY);
      const inverseScale = `scale(${(flipScaleX/safeScaleX) / cameraTransform.scale}, ${(flipScaleY/safeScaleY) / cameraTransform.scale})`;
      
      const baseX = part.transform.x;
      const baseY = part.transform.y;
      
      const offsetX = baseX;
      const offsetY = baseY;

      let transformString = `translate(${offsetX}px, ${offsetY}px) rotate(${part.transform.rotation}deg) scale(${finalScaleX}, ${finalScaleY})`;

      const isBackHair = checkIsBackHair(part, character);
      let headBobStr = '';

      if (disableSmoothness) {
          if ((part.id === 'headGroup' || (isBackHair && part.parentId !== 'headGroup')) && viseme.intensity > 0.05) {
               const bob = (viseme.intensity * 3.0).toFixed(2);
               headBobStr = ` translateY(${bob}px)`;
               transformString += headBobStr;
          }
          
          let baseSquint = characterFilters?.eyeSquint || 0;
          const exprState = characterFilters?.exprState || 0;
          if (exprState === 1) baseSquint += 35;
          else if (exprState === 2) baseSquint += 20;
          else if (exprState === 3) baseSquint += 25;
          else if (exprState === 4) baseSquint += 15;

          const eyes = {
              squint: Math.min(100, Math.max(0, baseSquint)),
              px: characterFilters?.pupilX || 0,
              py: characterFilters?.pupilY || 0
          };
          const headTurn = characterFilters?.headTurn || 0;

          let headTurnDepth = 0;
          if (headTurn !== 0 && !part.isGroup) {
              const lbl = part.label.toLowerCase();
              if (part.tags.includes('Nose') || lbl.includes('nose')) headTurnDepth = 0.35;
              else if (part.tags.includes('Mouth') || lbl.includes('mouth') || part.tags.includes('Viseme')) headTurnDepth = 0.4;
              else if (part.tags.includes('Pupil') || lbl.includes('pupil') || part.tags.includes('Iris') || lbl.includes('iris')) headTurnDepth = 0.3;
              else if (part.tags.includes('Eyebrow') || lbl.includes('eyebrow')) headTurnDepth = 0.25;
              else headTurnDepth = 0.0;
          }

          if (headTurnDepth !== 0) {
               transformString += ` translateX(${headTurn * 10 * headTurnDepth}px) scaleX(${1 - Math.abs(headTurn) * 0.02})`;
          }

          const isPupilIris = part.tags.includes('Pupil') || part.label.toLowerCase().includes('pupil') || part.tags.includes('Iris') || part.label.toLowerCase().includes('iris');
          if (isPupilIris) {
               const exprState = characterFilters?.exprState || 0;
               let shiftX = 0;
               let shiftY = 0;
               let pScale = 1;
               if (exprState === 1) { // angry
                   shiftY = 4;
                   const labelLower = part.label.toLowerCase();
                   const parentLabel = part.parentId && character[part.parentId] ? (character[part.parentId].label || '').toLowerCase() : '';
                   const isRight = labelLower.includes('right') || labelLower.includes('_r') || labelLower.includes(' r ') || labelLower.endsWith(' r') || labelLower.includes('-r') || parentLabel.includes('right') || parentLabel.includes('_r');
                   const isLeft = !isRight && (labelLower.includes('left') || labelLower.includes('_l') || labelLower.includes(' l ') || labelLower.endsWith(' l') || labelLower.includes('-l') || parentLabel.includes('left') || parentLabel.includes('_l'));
                   shiftX = isLeft ? 12 : -12;
                   pScale = 0.85;
               } else if (exprState === 2) { // sad
                   shiftY = -5;
                   const labelLower = part.label.toLowerCase();
                   const parentLabel = part.parentId && character[part.parentId] ? (character[part.parentId].label || '').toLowerCase() : '';
                   const isRight = labelLower.includes('right') || labelLower.includes('_r') || labelLower.includes(' r ') || labelLower.endsWith(' r') || labelLower.includes('-r') || parentLabel.includes('right') || parentLabel.includes('_r');
                   const isLeft = !isRight && (labelLower.includes('left') || labelLower.includes('_l') || labelLower.includes(' l ') || labelLower.endsWith(' l') || labelLower.includes('-l') || parentLabel.includes('left') || parentLabel.includes('_l'));
                   shiftX = isLeft ? -4 : 4;
                   pScale = 1.1;
               } else if (exprState === 3) { // happy / surprise
                   pScale = 1.15;
                   shiftY = -2;
               } else if (exprState === 4) { // serious
                   shiftY = 2;
                   pScale = 0.9;
               }
               transformString += ` translate(${eyes.px + shiftX}%, ${eyes.py + shiftY}%) scale(${pScale})`;
          }
          if (part.tags.includes('Eyelid') || part.label.toLowerCase().includes('eyelid')) {
               const squintScale = 1 - (eyes.squint / 100);
               transformString += ` scaleY(${Math.max(0.01, squintScale)})`;
          }

          if (part.tags.includes('Mouth') && !part.tags.includes('Viseme')) {
              const intense = viseme?.intensity || 0;
              const targets = getMouthPhysicsTargets(viseme.shape, intense);
              let finalX = targets.scaleX; 
              let finalY = targets.scaleY || 1; 
              if (Math.abs(finalY) < 0.1) finalY = finalY < 0 ? -0.1 : 0.1;
              let finalOffY = targets.offsetY;
              let extraTransform = '';
              
              // Forcefully lock rotation to 0 to prevent sadness tilt glitch
              const exprState = characterFilters?.exprState || 0;
              if (exprState !== 0) {
                  // Re-build transformString without rotation
                  transformString = `translate(${offsetX}px, ${offsetY}px) rotate(0deg) scale(${finalScaleX}, ${finalScaleY})`;
              }

              if (exprState === 1) { 
                  finalY *= 0.75; 
                  finalX *= 1.15; 
                  finalOffY += 1.5;
              }
              else if (exprState === 2) { 
                  finalY *= 0.8; 
                  finalX *= 0.88; 
                  finalOffY += 3.5;
              }
              else if (exprState === 3) { 
                  finalY *= 1.15;
                  finalX *= 1.35; 
                  finalOffY -= 2.0;
              }
              else if (exprState === 4) { 
                  finalY *= 0.75; 
                  finalX *= 1.0;
              }
              transformString += ` translateY(${finalOffY.toFixed(2)}px) scale(${finalX.toFixed(3)}, ${finalY.toFixed(3)})${extraTransform}`;
          }

          if (part.tags.includes('Eyebrow') || part.label.toLowerCase().includes('eyebrow')) {
              const labelLower = part.label.toLowerCase();
              const parentLabel = part.parentId && character[part.parentId] ? (character[part.parentId].label || '').toLowerCase() : '';
              const isRight = labelLower.includes('right') || labelLower.includes('_r') || labelLower.includes(' r ') || labelLower.endsWith(' r') || labelLower.includes('-r') || parentLabel.includes('right') || parentLabel.includes('_r');
              const isLeft = !isRight && (labelLower.includes('left') || labelLower.includes('_l') || labelLower.includes(' l ') || labelLower.endsWith(' l') || labelLower.includes('-l') || parentLabel.includes('left') || parentLabel.includes('_l'));
              let rotMod = 0; let yMod = 0;
              if (exprState === 1) { rotMod = isLeft ? -15 : 15; yMod = 3; }
              else if (exprState === 2) { rotMod = isLeft ? 15 : -15; yMod = -2; }
              else if (exprState === 3) { rotMod = isLeft ? 5 : -5; yMod = -4; }
              else if (exprState === 4) { yMod = 2; rotMod = isLeft ? -5 : 5; }
              
              // Auto eyebrow movement during lip sync (realistic bounce)
              if (viseme && viseme.intensity > 0.05) {
                  const talkingLift = -viseme.intensity * 6;
                  const talkingRot = isLeft ? -viseme.intensity * 5 : viseme.intensity * 5;
                  yMod += talkingLift;
                  rotMod += talkingRot;
              }
              
              if (rotMod !== 0 || yMod !== 0) transformString += ` translateY(${yMod}px) rotate(${rotMod}deg)`;
          }
      }

      if (isBackHair && part.parentId !== 'headGroup') {
          const head = Object.values(character).find((p: any) => p.id === 'headGroup') as CharacterPart | undefined;
          if (head) {
              const headFlipX = head.transform.flipX ? -1 : 1;
              const headFlipY = head.transform.flipY ? -1 : 1;
              const globalHeadX = head.transform.x;
              const globalHeadY = head.transform.y;
              const headTransform = `translate(${globalHeadX}px, ${globalHeadY}px) rotate(${head.transform.rotation}deg) scale(${head.transform.scaleX * headFlipX}, ${head.transform.scaleY * headFlipY})${headBobStr}`;
              
              const localOffsetX = part.transform.x - head.transform.x;
              const localOffsetY = part.transform.y - head.transform.y;
              const partLocalTransform = `translate(${localOffsetX}px, ${localOffsetY}px) rotate(${part.transform.rotation - head.transform.rotation}deg) scale(${finalScaleX}, ${finalScaleY})`;
              
              transformString = `${headTransform} ${partLocalTransform}`;
          }
      }


      let opacity: number | string = part.opacity !== undefined ? part.opacity : 1;
      if (disableSmoothness) {
          const eyes = {
              squint: characterFilters?.eyeSquint || 0
          };
          if (part.tags.includes('Eyeball') || part.label.toLowerCase().includes('eyeball') || part.tags.includes('Pupil') || part.label.toLowerCase().includes('pupil') || part.tags.includes('Eyelid') || part.label.toLowerCase().includes('eyelid')) {
               opacity = eyes.squint >= 100 ? 0 : opacity;
          }
      }

      const buildCssFilter = () => {
          if (shadowMode) return 'brightness(0)';
          
          let br = 100, co = 100, sa = 100, sh = 0;
          
          if (characterFilters) {
              br = characterFilters.brightness ?? 100;
              co = characterFilters.contrast ?? 100;
              sa = characterFilters.saturation ?? 100;
              sh = characterFilters.sharpness ?? 0;
          }

          if (part.filters) {
              const pb = part.filters.brightness ?? 100;
              const pc = part.filters.contrast ?? 100;
              const ps = part.filters.saturation ?? 100;
              br = (br / 100) * pb;
              co = (co / 100) * pc;
              sa = (sa / 100) * ps;
          }

          let filt = '';
          if (br !== 100) filt += `brightness(${br}%) `;
          if (co !== 100) filt += `contrast(${co}%) `;
          if (sa !== 100) filt += `saturate(${sa}%) `;
          if (sh > 0) filt += `drop-shadow(0px 0px ${Math.max(1, sh / 20)}px rgba(0,0,0,${Math.min(0.5, sh / 200)})) `;

          // Eyeball / Pupil / Facial features precise tints based on expression
          const lbl = part.label.toLowerCase();
          const isEyeball = part.tags.includes('Eyeball') || lbl.includes('eyeball') || lbl.includes('sclera');
          const isPupilIris = part.tags.includes('Pupil') || lbl.includes('pupil') || part.tags.includes('Iris') || lbl.includes('iris');
          const isEyebrow = part.tags.includes('Eyebrow') || lbl.includes('eyebrow');
          const isMouthPart = part.tags.includes('Mouth') || lbl.includes('mouth') || part.tags.includes('Viseme');

          const exprState = characterFilters?.exprState || 0;
          let exprFilt = '';
          if (exprState === 1) { // Angry
              if (isEyeball) {
                  // Reddish angry/flushed bloodshot look
                  exprFilt = `sepia(40%) saturate(220%) hue-rotate(320deg) `;
              } else if (isPupilIris) {
                  exprFilt = `saturate(150%) brightness(95%) `;
              } else if (isEyebrow || isMouthPart) {
                  exprFilt = `brightness(90%) contrast(110%) `;
              }
          } else if (exprState === 2) { // Sad
              if (isEyeball) {
                  // Teary / bluish dim tint
                  exprFilt = `sepia(30%) saturate(120%) hue-rotate(180deg) brightness(105%) `;
              } else if (isPupilIris) {
                  exprFilt = `saturate(85%) hue-rotate(190deg) brightness(100%) `;
              } else if (isEyebrow || isMouthPart) {
                  exprFilt = `brightness(95%) saturate(90%) `;
              }
          } else if (exprState === 3) { // Happy / Excited
              if (isEyeball) {
                  // Warm golden highlight
                  exprFilt = `sepia(10%) saturate(110%) brightness(115%) `;
              } else if (isPupilIris) {
                  exprFilt = `saturate(160%) brightness(110%) `;
              } else if (isEyebrow || isMouthPart) {
                  exprFilt = `brightness(105%) saturate(120%) `;
              }
          } else if (exprState === 4) { // Serious
               if (isEyeball) {
                  exprFilt = `contrast(110%) brightness(95%) `;
              } else if (isPupilIris) {
                  exprFilt = `contrast(130%) saturate(100%) `;
              }
          }

          if (exprFilt) filt += exprFilt;
          return filt.trim() || 'none';
      };

      const style: React.CSSProperties = {
          filter: buildCssFilter(),
          opacity: opacity,
          willChange: 'transform, opacity, filter'
      };

      const shadowClass = '';

      return (
          <div 
              key={part.id}
              className="absolute"
              style={{ 
                  left: '50%', top: '50%',
                  width: width, height: height,
                  marginLeft: -width / 2, marginTop: -height / 2,
                  zIndex: computedZIndexMap.get(part.id) ?? 0,
                  transformOrigin: `${effectiveAnchorX}% ${effectiveAnchorY}%`,
                  transform: transformString,
                  backfaceVisibility: 'hidden',
                  ...style
              }}
              data-part-id={partId}
              onPointerMove={((isEditing || isSelectedForAnchor) && !shadowMode) ? (e) => handleContainerPointerMove(e, partId) : undefined}
          >
            <div 
                className="w-full h-full relative"
                ref={(el) => { if (el) partRefs.current.set(part.id, el); else partRefs.current.delete(part.id); }}
                style={{ transformOrigin: 'inherit' }}
            >
                {!shadowMode && isEditing && (
                    <div 
                        onPointerDown={(e) => handlePivotDown(e, partId)} 
                        className="absolute z-[200] w-10 h-10 cursor-crosshair group touch-none pointer-events-auto flex items-center justify-center" 
                        style={{ 
                            left: `${part.transform.anchorX ?? 50}%`, 
                            top: `${part.transform.anchorY ?? 50}%`,
                            transform: `translate(-50%, -50%) ${inverseScale}`
                        }}
                    >
                        <div className="w-full h-full bg-cyan-500/30 rounded-full animate-ping absolute inset-0"></div>
                        <div className="relative w-7 h-7 bg-cyan-500 border-2 border-white rounded-full shadow-md flex items-center justify-center">
                            <Crosshair size={14} className="text-white" />
                        </div>
                    </div>
                )}
                
                {(!part.isGroup || isMouth) && texture && texture !== "null" && (
                    <>
                        {((part.bones && part.bones.length > 0) || (!disableRigging && isEditing)) ? (
                            <PuppetWarp 
                                layerId={part.id}
                                imageUri={texture}
                                width={width}
                                height={height}
                                bones={part.bones || []}
                                onBonesChange={onBonesChange ? (bones) => onBonesChange(part.id, bones) : undefined}
                                boneTransforms={partBoneTransforms}
                                mode={(!disableRigging && isEditing) ? 'EDIT' : 'PLAY'}
                                tool={activeRigTool}
                                rigType={rigType}
                                showSkeleton={showSkeleton || (!disableRigging && isEditing)}
                                activeBoneId={activeBoneId}
                                onBoneSelect={onBoneSelect ? (boneId) => onBoneSelect(part.id, boneId) : undefined}
                            />
                        ) : (
                            <img 
                                src={texture} 
                                alt={part.label} 
                                crossOrigin="anonymous"
                                className={`w-full h-full pointer-events-none ${hasDimensions ? 'object-fill' : 'object-contain'} ${shadowClass}`} 
                            />
                        )}
                    </>
                )}

            </div>
          </div>
      );
    };

    return (
       <div className="relative w-full h-full">
          {Object.values(character).map((p: any) => renderPartHierarchy(p.id))}
       </div>
    );
  }, [
      character, activeMouthTexture, editingPartId, showAnchors, activePartId, 
      boneTransforms, activeBoneId, showSkeleton, theme, shadowMode,
      handleContainerPointerMove, handlePivotDown,
      disableSmoothness, 
      viseme.shape, 
      characterFilters,
      disableSmoothness ? viseme.intensity : null 
  ]);

  const anchorOverlayContent = useMemo(() => {
    if (!showAnchors || !activePartId || !character || !character[activePartId]) return null;

    const buildPath = (targetId: string) => {
        const path: string[] = [];
        let curr = targetId;
        while (curr) {
            path.unshift(curr);
            const parent = Object.values(character as Record<string, CharacterPart>).find((p: any) => p.children && p.children.includes(curr)) as CharacterPart | undefined;
            if (parent) {
                curr = parent.id;
            } else {
                break;
            }
        }
        return path;
    };

    const path = buildPath(activePartId);

    const renderAnchorOverlay = (currentId: string, parentAbsX: number = 0, parentAbsY: number = 0): React.ReactNode => {
        const part = character[currentId];
        if (!part) return null;

        const effectiveAnchorX = part.transform.anchorX ?? 50;
        const effectiveAnchorY = part.transform.anchorY ?? 50;

        const DEFAULT_PART_SIZE = 150;
        const hasDimensions = (part.width !== undefined && part.width > 0) || (part.height !== undefined && part.height > 0);
        const width = hasDimensions ? part.width! : DEFAULT_PART_SIZE;
        const height = hasDimensions ? part.height! : DEFAULT_PART_SIZE;
        
        const flipScaleX = part.transform.flipX ? -1 : 1;
        const flipScaleY = part.transform.flipY ? -1 : 1;
        const finalScaleX = part.transform.scaleX * flipScaleX;
        const finalScaleY = part.transform.scaleY * flipScaleY;

        const baseX = part.transform.x;
        const baseY = part.transform.y;

        const offsetX = baseX - parentAbsX;
        const offsetY = baseY - parentAbsY;

        let transformString = `translate(${offsetX}px, ${offsetY}px) rotate(${part.transform.rotation}deg) scale(${finalScaleX}, ${finalScaleY})`;

        const isBackHair = checkIsBackHair(part, character);
        if (isBackHair && part.parentId !== 'headGroup') {
            const head = Object.values(character).find((p: any) => p.id === 'headGroup') as CharacterPart | undefined;
            if (head) {
                const headFlipX = head.transform.flipX ? -1 : 1;
                const headFlipY = head.transform.flipY ? -1 : 1;
                const globalHeadX = head.transform.x;
                const globalHeadY = head.transform.y;
                const headTransform = `translate(${globalHeadX}px, ${globalHeadY}px) rotate(${head.transform.rotation}deg) scale(${head.transform.scaleX * headFlipX}, ${head.transform.scaleY * headFlipY})`;
                
                const localOffsetX = part.transform.x - head.transform.x;
                const localOffsetY = part.transform.y - head.transform.y;
                const partLocalTransform = `translate(${localOffsetX}px, ${localOffsetY}px) rotate(${part.transform.rotation - head.transform.rotation}deg) scale(${finalScaleX}, ${finalScaleY})`;
                
                transformString = `${headTransform} ${partLocalTransform}`;
            }
        }

        const isTarget = currentId === activePartId;
        const safeScaleX = Math.abs(part.transform.scaleX) < 0.01 ? 0.01 : Math.abs(part.transform.scaleX);
        const safeScaleY = Math.abs(part.transform.scaleY) < 0.01 ? 0.01 : Math.abs(part.transform.scaleY);
        const inverseScale = `scale(${(flipScaleX/safeScaleX) / cameraTransform.scale}, ${(flipScaleY/safeScaleY) / cameraTransform.scale})`;

        return (
            <div 
                key={`anchor-${currentId}`}
                className="absolute"
                style={{ 
                    left: '50%', top: '50%',
                    width: width, height: height,
                    marginLeft: -width / 2, marginTop: -height / 2,
                    zIndex: currentId === 'root' ? 100000 : undefined,
                    transformOrigin: `${effectiveAnchorX}% ${effectiveAnchorY}%`,
                    transform: transformString,
                    pointerEvents: 'none',
                }}
            >
                {isTarget && (
                    <div 
                        onPointerDown={(e) => handlePivotDown(e, currentId)} 
                        onPointerMove={(e) => handleContainerPointerMove(e, currentId)}
                        className="absolute z-[100000] w-20 h-20 cursor-grab active:cursor-grabbing group touch-none pointer-events-auto flex items-center justify-center" 
                        style={{ 
                            left: `${effectiveAnchorX}%`, 
                            top: `${effectiveAnchorY}%`,
                            transform: `translate(-50%, -50%) ${inverseScale}`
                        }}
                    >
                        <div className="absolute w-24 h-24 bg-cyan-500/20 rounded-full animate-pulse pointer-events-none"></div>
                        <div className="absolute inset-x-0 mx-auto w-20 h-20 bg-cyan-500/10 rounded-full border border-cyan-400/40 animate-ping pointer-events-none" style={{ animationDuration: '2s' }}></div>
                        <div className="absolute w-14 h-14 rounded-full border border-dashed border-cyan-400/50 animate-[spin_12s_linear_infinite] pointer-events-none"></div>
                        <div className="relative w-10 h-10 bg-slate-900 border-2 border-cyan-400 rounded-full flex items-center justify-center shadow-[0_0_12px_rgba(34,211,238,0.7)] group-hover:scale-110 group-hover:border-white transition-all duration-150 relative">
                            <Crosshair size={20} className="text-cyan-400 group-hover:text-white transition-colors animate-[spin_40s_linear_infinite]" />
                            <div className="absolute w-2 h-2 bg-cyan-400 rounded-full scale-100 group-hover:bg-white transition-colors shadow-[0_0_4px_#22d3ee]"></div>
                            {/* Label for anchor point */}
                            <div className="absolute top-full mt-2 bg-cyan-500 text-black text-[10px] font-black px-2 py-0.5 rounded whitespace-nowrap uppercase tracking-tighter shadow-lg pointer-events-none">
                                {part.label || 'Anchor'}
                            </div>
                        </div>
                    </div>
                )}
                {part.children.map(cId => {
                    if (path.includes(cId)) return renderAnchorOverlay(cId, baseX, baseY);
                    return null;
                })}
            </div>
        )
    };

    return (
        <div className="absolute inset-0 pointer-events-none z-[100000]">
            {renderAnchorOverlay('root', 0, 0)}
        </div>
    );
  }, [
    character, showAnchors, activePartId, handlePivotDown, handleContainerPointerMove
  ]);

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-transparent touch-none overflow-visible" 
      onPointerMove={handlePointerMove} 
      onPointerUp={handlePointerUp}
      onPointerDown={handlePointerDown}
      onWheel={handleWheel}
    >
      <div className={`absolute group select-none w-[500px] h-[500px] max-w-full max-h-full`} ref={wrapperRef}>
          <div className="w-full h-full transition-all duration-300">
             {characterContent}
             {anchorOverlayContent}
          </div>
      </div>
    </div>
  );
});
;
