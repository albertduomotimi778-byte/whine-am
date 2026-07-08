
import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { useLanguage } from '../utils/LanguageContext';
import { Bone as BoneIcon, Move, RotateCw, Trash2, Crosshair } from 'lucide-react';
import { Bone } from '../types';
import { BONE_PALETTE } from '../constants';

// --- CONFIG ---
const DEFAULT_MESH_RES = 3; 
export const PUPPET_PADDING = 120; 

// --- GLOBAL IMAGE CACHE ---
const GLOBAL_IMAGE_CACHE = new Map<string, HTMLImageElement>();

// --- OPTIMIZED MATH ---
type Mat3 = Float32Array;
const createMat3 = (): Mat3 => new Float32Array([1, 0, 0, 1, 0, 0]);
const IDENTITY = createMat3();

const safeFloat = (n: any, def: number = 0) => {
    const p = parseFloat(n);
    return isFinite(p) ? p : def;
};

const multiply = (out: Mat3, a: Mat3, b: Mat3): Mat3 => {
  const a0 = a[0], a1 = a[1], a2 = a[2], a3 = a[3], a4 = a[4], a5 = a[5];
  const b0 = b[0], b1 = b[1], b2 = b[2], b3 = b[3], b4 = b[4], b5 = b[5];
  out[0] = a0 * b0 + a2 * b1;
  out[1] = a1 * b0 + a3 * b1;
  out[2] = a0 * b2 + a2 * b3;
  out[3] = a1 * b2 + a3 * b3;
  out[4] = a0 * b4 + a2 * b5 + a4;
  out[5] = a1 * b4 + a3 * b5 + a5;
  return out;
};

const fromTransform = (out: Mat3, x: number, y: number, angle: number, scaleX: number = 1, scaleY: number = 1): Mat3 => {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  out[0] = c * scaleX;
  out[1] = s * scaleX;
  out[2] = -s * scaleY;
  out[3] = c * scaleY;
  out[4] = x;
  out[5] = y;
  return out;
};

const transformPoint = (m: Mat3, x: number, y: number) => ({
  x: m[0] * x + m[2] * y + m[4],
  y: m[1] * x + m[3] * y + m[5]
});

// --- TYPES ---
interface Vertex {
  x: number; y: number; u: number; v: number;
  weights: { sourceId: string; weight: number }[];
  curX: number; curY: number;
}

interface PuppetWarpProps {
  layerId?: string;
  opacity?: number;
  imageUri: string | null;
  width?: number;
  height?: number;
  bones?: Bone[];
  onBonesChange?: (bones: Bone[]) => void;
  boneTransforms?: Record<string, { rotation: number, scaleX: number, scaleY: number }>;
  getDynamicTransforms?: () => Record<string, { rotation: number, scaleX: number, scaleY: number }> | undefined;
  mode?: 'EDIT' | 'PLAY';
  activeBoneId?: string | null;
  onBoneSelect?: (boneId: string | null) => void;
  showSkeleton?: boolean; 
  tool?: 'BONE' | 'HAND' | 'DELETE' | 'MOVE';
  isActive?: boolean;
  rigType?: 'MESH' | 'HUMAN';
  isLowPerformanceMode?: boolean;
}

const identityMat3 = new Float32Array([1, 0, 0, 1, 0, 0]);

const drawTriangle = (ctx: CanvasRenderingContext2D, img: HTMLImageElement, p0: any, p1: any, p2: any) => {
    const w = img.naturalWidth; const h = img.naturalHeight;
    let x0 = p0.curX, y0 = p0.curY, u0 = p0.u * w, v0 = p0.v * h;
    let x1 = p1.curX, y1 = p1.curY, u1 = p1.u * w, v1 = p1.v * h;
    let x2 = p2.curX, y2 = p2.curY, u2 = p2.u * w, v2 = p2.v * h;

    const ox0 = x0, oy0 = y0, ox1 = x1, oy1 = y1, ox2 = x2, oy2 = y2;

    // Expand vertices slightly outward from centroid to prevent hairline grid gaps
    const cx = (x0 + x1 + x2) / 3;
    const cy = (y0 + y1 + y2) / 3;
    const expand = 1.0; // Increased expansion to weld mesh seams and eliminate mesh visibility
    
    // Calculate distance and push out
    const pushOut = (x: number, y: number, cx: number, cy: number, pOut: {x:number, y:number}) => {
        const dx = x - cx; const dy = y - cy;
        const lenSq = dx*dx + dy*dy;
        if (lenSq < 0.0001) { pOut.x = x; pOut.y = y; return; }
        const invLen = expand / Math.sqrt(lenSq);
        pOut.x = x + dx * invLen; pOut.y = y + dy * invLen;
    };

    const p0Out = {x:0, y:0}, p1Out = {x:0, y:0}, p2Out = {x:0, y:0};
    pushOut(x0, y0, cx, cy, p0Out);
    pushOut(x1, y1, cx, cy, p1Out);
    pushOut(x2, y2, cx, cy, p2Out);

    const ex0 = p0Out.x, ey0 = p0Out.y;
    const ex1 = p1Out.x, ey1 = p1Out.y;
    const ex2 = p2Out.x, ey2 = p2Out.y;

    const dU0 = u1 - u0, dV0 = v1 - v0, dU1 = u2 - u0, dV1 = v2 - v0;
    const det = dU0 * dV1 - dU1 * dV0;
    if (Math.abs(det) < 0.001) return; 
    const idet = 1 / det;
    
    ctx.save();
    ctx.beginPath(); ctx.moveTo(ex0, ey0); ctx.lineTo(ex1, ey1); ctx.lineTo(ex2, ey2); ctx.closePath(); ctx.clip();
    
    // Texture mapping matrix MUST be calculated using original coordinates so the texture overlap seamlessly welds
    const a = ((ox1-ox0)*dV1 - (ox2-ox0)*dV0) * idet;
    const b = ((oy1-oy0)*dV1 - (oy2-oy0)*dV0) * idet;
    const c = ((ox2-ox0)*dU0 - (ox1-ox0)*dU1) * idet;
    const d = ((oy2-oy0)*dU0 - (oy1-oy0)*dU1) * idet;
    const e = ox0 - a*u0 - c*v0;
    const f = oy0 - b*u0 - d*v0;
    
    ctx.transform(a, b, c, d, e, f);
    ctx.drawImage(img, -0.5, -0.5, w + 1, h + 1); // Extra padding for the draw
    ctx.restore();
};

// --- GLOBAL MESH CACHE FOR PLAYBACK OPTIMIZATION ---
const PLAYBACK_MESH_CACHE = new Map<string, Vertex[]>();

export const drawWarpedImage = (
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  width: number,
  height: number,
  bones: Bone[],
  transforms: Record<string, { rotation: number, scaleX: number, scaleY: number }>,
  rigType: 'MESH' | 'HUMAN' = 'MESH',
  meshRes: number = DEFAULT_MESH_RES
) => {
  const MESH_RES = meshRes;
  const bonesRef = bones;
  const currentTransforms = transforms;

  // --- MESH DEFORMATION ---
  const globalMatrices: Record<string, Mat3> = {};
  const computeBoneMatrix = (bone: Bone, depth: number = 0): Mat3 => {
      if (depth > 50) return IDENTITY;
      if (globalMatrices[bone.id]) return globalMatrices[bone.id];
      
      const transform = currentTransforms[bone.id] || { rotation: 0, scaleX: 1, scaleY: 1 };
      let parentMat = IDENTITY;
      
      if (bone.parentId) {
          const parent = bonesRef.find(b => b.id === bone.parentId);
          if (parent) parentMat = computeBoneMatrix(parent, depth + 1);
      }
      
      const sX = safeFloat(bone.startX); const sY = safeFloat(bone.startY);
      
      const t1 = createMat3(); t1[0]=1; t1[1]=0; t1[2]=0; t1[3]=1; t1[4]= -sX; t1[5]= -sY;
      const rs = fromTransform(createMat3(), 0, 0, (safeFloat(transform.rotation) * Math.PI) / 180, safeFloat(transform.scaleX, 1), safeFloat(transform.scaleY, 1));
      const t2 = createMat3(); t2[0]=1; t2[1]=0; t2[2]=0; t2[3]=1; t2[4]= sX; t2[5]= sY;
      
      const localDeform = createMat3();
      multiply(localDeform, t2, multiply(createMat3(), rs, t1));
      
      const result = createMat3();
      multiply(result, parentMat, localDeform);
      
      globalMatrices[bone.id] = result;
      return result;
  };
  bonesRef.forEach(b => computeBoneMatrix(b));
  globalMatrices['STATIC_ROOT'] = IDENTITY;

  let hash = `${width}x${height}_${rigType}`;
  if (img.src) hash += img.src.substring(img.src.length - 100);
  for (let i=0; i<bonesRef.length; i++) {
      const b=bonesRef[i]; hash += `${b.id}${Math.round(safeFloat(b.startX))}${Math.round(safeFloat(b.startY))}${Math.round(safeFloat(b.endX))}${Math.round(safeFloat(b.endY))}`;
  }

      let verts: Vertex[];
  if (PLAYBACK_MESH_CACHE.has(hash)) {
      verts = PLAYBACK_MESH_CACHE.get(hash)!;
  } else {
      verts = [];
      for (let y = 0; y <= MESH_RES; y++) {
        for (let x = 0; x <= MESH_RES; x++) {
          const u = x / MESH_RES;
          const v = y / MESH_RES;
          verts.push({
            x: u * width, y: v * height,
            u, v, weights: [],
            curX: u * width, curY: v * height
          });
        }
      }

      // Bind Skin (Smooth Stretchy IDW)
      verts.forEach(v => {
          let totalWeight = 0;
          const influences: { sourceId: string, weight: number }[] = [];
          bonesRef.forEach(b => {
              const bx1 = safeFloat(b.startX); const by1 = safeFloat(b.startY);
              const bx2 = safeFloat(b.endX); const by2 = safeFloat(b.endY);
              
              let dist = distanceToSegment(v.x, v.y, bx1, by1, bx2, by2);

              // Find closest point
              const l2 = (bx2 - bx1)**2 + (by2 - by1)**2;
              let t = 0;
              if (l2 !== 0) {
                  t = Math.max(0, Math.min(1, ((v.x - bx1) * (bx2 - bx1) + (v.y - by1) * (by2 - by1)) / l2));
              }

              // Smoother distance weighting power for continuous stretchy feeling
              const isLowPerformanceMode = false;
              const power = isLowPerformanceMode ? 2 : 2.5;
              const w = 1 / (Math.pow(dist, power) + 0.1); 
              influences.push({ sourceId: b.id, weight: w });
          });
          
          // Localized bending for HUMAN rig: parts with no bones stay static
          if (rigType === 'HUMAN') {
              const fallbackDist = 120; // Range of bone influence
              const fallbackWeight = 1 / (Math.pow(fallbackDist, 2.5) + 0.1);
              influences.push({ sourceId: 'STATIC_ROOT', weight: fallbackWeight });
          }
          
          influences.sort((a, b) => b.weight - a.weight);
          
          // Soft culling: Keep top 4 bones for smoother blends, no hard tearing
          const numInfluences = rigType === 'HUMAN' ? 1 : 4;
          const validInfluences = influences.slice(0, numInfluences);
          
          validInfluences.forEach(inf => totalWeight += inf.weight);
          v.weights = validInfluences.map(inf => ({ sourceId: inf.sourceId, weight: inf.weight / totalWeight }));
      });
      
      PLAYBACK_MESH_CACHE.set(hash, verts);
      if (PLAYBACK_MESH_CACHE.size > 100) {
          const keys = Array.from(PLAYBACK_MESH_CACHE.keys());
          PLAYBACK_MESH_CACHE.delete(keys[0]);
      }
  }

  const vertsCount = verts.length;
  for (let i = 0; i < vertsCount; i++) {
      const v = verts[i];
      const wList = v.weights;
      const wCount = wList.length;
      if (wCount === 0) { v.curX = v.x; v.curY = v.y; continue; }
      let tx = 0; let ty = 0;
      for (let j = 0; j < wCount; j++) {
          const w = wList[j];
          const mat = globalMatrices[w.sourceId] || IDENTITY;
          const px = mat[0] * v.x + mat[2] * v.y + mat[4];
          const py = mat[1] * v.x + mat[3] * v.y + mat[5];
          tx += px * w.weight; ty += py * w.weight;
      }
      v.curX = tx; v.curY = ty;
  }

  for (let y = 0; y < MESH_RES; y++) {
      for (let x = 0; x < MESH_RES; x++) {
          const i = y * (MESH_RES + 1) + x;
          drawTriangle(ctx, img, verts[i], verts[i+1], verts[i+MESH_RES+1]);
          drawTriangle(ctx, img, verts[i+1], verts[i+MESH_RES+2], verts[i+MESH_RES+1]);
      }
  }
};

export const PuppetWarp: React.FC<PuppetWarpProps> = ({ 
  layerId,
  imageUri, 
  width = 500, 
  height = 500,
  bones: initialBones = [],
  onBonesChange,
  boneTransforms = {},
  getDynamicTransforms,
  mode = 'PLAY',
  activeBoneId,
  onBoneSelect,
  showSkeleton = false,
  tool = 'BONE',
  isActive = true,
  rigType = 'MESH',
  opacity = 1,
  isLowPerformanceMode = false
}) => {
  const { t } = useLanguage();

  const MESH_RES = 5; // Unified high-performance resolution to ensure identical mesh triangulation between edit and playback

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const animationFrameId = useRef<number>(0);
  const vertices = useRef<Vertex[]>([]);

  // --- STABLE REFS FOR ENGINE DATA ---
  const bonesRef = useRef<Bone[]>(initialBones);
  const boneTransformsRef = useRef(boneTransforms);
  const getDynamicTransformsRef = useRef(getDynamicTransforms);
  const toolRef = useRef(tool);
  const modeRef = useRef(mode);
  const activeBoneIdRef = useRef(activeBoneId);
  const showSkeletonRef = useRef(showSkeleton);
  const isActiveRef = useRef(isActive);
  const lastImageUriRef = useRef<string | null>(null);
  const globalMatricesRef = useRef<Record<string, Mat3>>({});
  const lastRenderHash = useRef<string>('');
  const widthRef = useRef(width);
  const heightRef = useRef(height);
  const opacityRef = useRef(opacity);

  useEffect(() => { widthRef.current = width; heightRef.current = height; opacityRef.current = opacity; }, [width, height, opacity]);

  // Interaction Refs
  const dragStart = useRef<{x: number, y: number} | null>(null);
  const tempBoneStart = useRef<{x: number, y: number, parentId: string | null} | null>(null);
  const snapTarget = useRef<{x: number, y: number, parentId: string | null} | null>(null);
  const mousePos = useRef<{x: number, y: number} | null>(null);
  const draggedJoints = useRef<{ boneId: string, type: 'start' | 'end', offsetX: number, offsetY: number }[]>([]);

  const tempMatA = useRef(createMat3());
  const tempMatB = useRef(createMat3());
  const tempMatC = useRef(createMat3());

  const { visualRadius, hitRadius } = useMemo(() => {
    const refSize = Math.min(width, height);
    const scale = Math.min(2.0, Math.max(0.15, refSize / 500));
    return { visualRadius: 20 * scale, hitRadius: 30 * scale };
  }, [width, height]);

  const [lastImageUri, setLastImageUri] = useState<string | null>(null);
  const imgDataRef = useRef<{data: Uint8ClampedArray, width: number, height: number} | null>(null);

  const bindSkin = useCallback(() => {
    const currentBones = bonesRef.current;
    if (currentBones.length === 0) {
        vertices.current.forEach(v => { v.weights = []; v.curX = v.x; v.curY = v.y; });
        return;
    }

    vertices.current.forEach(v => {
        v.weights = [];
        let totalWeight = 0;
        const influences: { sourceId: string, weight: number }[] = [];

        currentBones.forEach(b => {
             const bx1=safeFloat(b.startX), by1=safeFloat(b.startY), bx2=safeFloat(b.endX), by2=safeFloat(b.endY);
             const l2 = (bx2 - bx1)**2 + (by2 - by1)**2;
             
             let dist = distanceToSegment(v.x, v.y, bx1, by1, bx2, by2);
            
            const power = isLowPerformanceMode ? 2 : 2.5;
            const w = 1 / (Math.pow(dist, power) + 0.1); 
            influences.push({ sourceId: b.id, weight: w });
        });

        if (rigType === 'HUMAN') {
            const fallbackDist = 120;
            const fallbackWeight = 1 / (Math.pow(fallbackDist, 2.5) + 0.1);
            influences.push({ sourceId: 'STATIC_ROOT', weight: fallbackWeight });
        }

        influences.sort((a, b) => b.weight - a.weight);
        
        // Soft culling: Keep top 4 bones for smoother blends, no hard tearing
        const numInfluences = rigType === 'HUMAN' ? 1 : 4;
        const validInfluences = influences.slice(0, numInfluences);
        
        validInfluences.forEach(inf => totalWeight += inf.weight);
        v.weights = validInfluences.map(inf => ({ sourceId: inf.sourceId, weight: inf.weight / totalWeight }));
    });
  }, [width, height, rigType]); // Simplified dependencies

  useEffect(() => { bonesRef.current = initialBones; bindSkin(); }, [initialBones, bindSkin]);
  useEffect(() => { boneTransformsRef.current = boneTransforms; }, [boneTransforms]);
  useEffect(() => { getDynamicTransformsRef.current = getDynamicTransforms; }, [getDynamicTransforms]);
  useEffect(() => { toolRef.current = tool; }, [tool]);
  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { activeBoneIdRef.current = activeBoneId; }, [activeBoneId]);
  useEffect(() => { showSkeletonRef.current = showSkeleton; }, [showSkeleton]);
  useEffect(() => { isActiveRef.current = isActive; }, [isActive]);

  useEffect(() => {
    const verts: Vertex[] = [];
    for (let y = 0; y <= MESH_RES; y++) {
      for (let x = 0; x <= MESH_RES; x++) {
        const u = x / MESH_RES;
        const v = y / MESH_RES;
        verts.push({
          x: u * width, y: v * height,
          u, v, weights: [],
          curX: u * width, curY: v * height
        });
      }
    }
    vertices.current = verts;
    bindSkin(); 
  }, [width, height, bindSkin]);

  useEffect(() => {
    if (imageUri && imageUri !== lastImageUri) {
      setLastImageUri(imageUri);
      
      const extractImageData = (img: HTMLImageElement) => {
          if (!img.width) return;
          const c = document.createElement('canvas');
          c.width = width;
          c.height = height;
          const ctx = c.getContext('2d');
          if (ctx) {
              ctx.drawImage(img, 0, 0, width, height);
              const data = ctx.getImageData(0, 0, width, height);
              imgDataRef.current = { data: data.data, width, height };
              bindSkin(); // Fire directly without queueing a component render
          }
      };

      if (GLOBAL_IMAGE_CACHE.has(imageUri)) {
        const img = GLOBAL_IMAGE_CACHE.get(imageUri)!;
        imageRef.current = img;
        extractImageData(img);
        return;
      }

      const img = new Image();
      img.crossOrigin = "anonymous"; 
      img.onload = () => { 
        imageRef.current = img; 
        GLOBAL_IMAGE_CACHE.set(imageUri, img);
        extractImageData(img);
      };
      img.src = imageUri;
    }
  }, [imageUri, width, height, bindSkin]);

  useEffect(() => {
    bindSkin();
  }, [bindSkin]);

  const frameCounterRef = useRef<number>(0);
  const loop = useCallback((time?: number) => {
        if (!canvasRef.current || (!isActiveRef.current && modeRef.current !== 'EDIT')) {
            return;
        }

        if (isLowPerformanceMode && time) {
             frameCounterRef.current++;
             if (frameCounterRef.current % 2 !== 0) {
                 animationFrameId.current = requestAnimationFrame(loop);
                 return;
             }
        }

        const ctx = canvasRef.current.getContext('2d', { alpha: true, desynchronized: true });
        if (!ctx) return;
        ctx.globalAlpha = opacityRef.current;
        poolIdx.current = 0; // Reset pool for this frame

    const img = imageRef.current;
    if (!img || !img.complete) {
        animationFrameId.current = requestAnimationFrame(loop);
        return;
    }

    const currentBones = bonesRef.current;
    
    // Imperative fetch for 60fps animations bypassing React diffs
    const dynamicTr = getDynamicTransformsRef.current?.();
    const currentTransforms = dynamicTr || boneTransformsRef.current;
    
    const currentMode = modeRef.current;
    const currentActiveId = activeBoneIdRef.current;
    const currentTool = toolRef.current;
    const currentShowSkeleton = showSkeletonRef.current;

    let renderHash = currentMode + currentTool + currentActiveId + currentShowSkeleton + widthRef.current + heightRef.current + draggedJoints.current.length;
    if (mousePos.current) renderHash += `${Math.round(mousePos.current.x)},${Math.round(mousePos.current.y)}`;
    if (tempBoneStart.current) renderHash += `${Math.round(tempBoneStart.current.x)},${Math.round(tempBoneStart.current.y)}`;
    if (snapTarget.current) renderHash += snapTarget.current.parentId || '';
    
    // Fast inline string builder vs slow JSON.stringify for GC
    for (let i = 0; i < currentBones.length; i++) {
        const b = currentBones[i];
        renderHash += `${b.id}${b.startX}${b.startY}${b.endX}${b.endY}`;
        const tr = currentTransforms[b.id];
        if (tr) renderHash += `${tr.rotation}${tr.scaleX}${tr.scaleY}`;
    }

    if (renderHash === lastRenderHash.current) {
        if (isActiveRef.current) {
            animationFrameId.current = requestAnimationFrame(loop);
        }
        return; // Skip identical frame
    }
    lastRenderHash.current = renderHash;

        // --- MESH DEFORMATION ---
        const globalMatrices: Record<string, Mat3> = {};
        globalMatrices['STATIC_ROOT'] = IDENTITY;
        const computeBoneMatrix = (bone: Bone, depth: number = 0): Mat3 => {
            if (depth > 50) return IDENTITY;
            if (globalMatrices[bone.id]) return globalMatrices[bone.id];
            
            const transform = currentTransforms[bone.id] || { rotation: 0, scaleX: 1, scaleY: 1 };
            let parentMat = IDENTITY;
            
            if (bone.parentId) {
                const parent = currentBones.find(b => b.id === bone.parentId);
                if (parent) parentMat = computeBoneMatrix(parent, depth + 1);
            }
            
            const sX = safeFloat(bone.startX); const sY = safeFloat(bone.startY);
            
            // Reusable scratch matrices
            const t1 = tempMatA.current; t1[0]=1; t1[1]=0; t1[2]=0; t1[3]=1; t1[4]= -sX; t1[5]= -sY;
            const rs = fromTransform(tempMatB.current, 0, 0, (safeFloat(transform.rotation) * Math.PI) / 180, safeFloat(transform.scaleX, 1), safeFloat(transform.scaleY, 1));
            const t2 = tempMatC.current; t2[0]=1; t2[1]=0; t2[2]=0; t2[3]=1; t2[4]= sX; t2[5]= sY;
            
            // Use pool for the final result
            const localDeform = getFromPool();
            multiply(localDeform, t2, multiply(tempMatA.current, rs, t1));
            
            const result = getFromPool();
            multiply(result, parentMat, localDeform);
            
            globalMatrices[bone.id] = result;
            globalMatricesRef.current[bone.id] = result;
            return result;
        };
    currentBones.forEach(b => computeBoneMatrix(b));

    const vertsList = vertices.current;
    const vertsLen = vertsList.length;
    for (let i = 0; i < vertsLen; i++) {
        const v = vertsList[i];
        const weightsList = v.weights;
        const weightsLen = weightsList.length;
        if (weightsLen === 0) { v.curX = v.x; v.curY = v.y; continue; }
        let tx = 0; let ty = 0;
        for (let j = 0; j < weightsLen; j++) {
            const w = weightsList[j];
            const mat = globalMatrices[w.sourceId] || IDENTITY;
            const weight = w.weight;
            const px = mat[0] * v.x + mat[2] * v.y + mat[4];
            const py = mat[1] * v.x + mat[3] * v.y + mat[5];
            tx += px * weight; ty += py * weight;
        }
        v.curX = isNaN(tx) ? v.x : tx; v.curY = isNaN(ty) ? v.y : ty;
    }

    ctx.clearRect(0, 0, widthRef.current + PUPPET_PADDING * 2, heightRef.current + PUPPET_PADDING * 2);
    ctx.save();
    ctx.translate(PUPPET_PADDING, PUPPET_PADDING);

    const v = vertices.current;
    for (let y = 0; y < MESH_RES; y++) {
        for (let x = 0; x < MESH_RES; x++) {
            const i = y * (MESH_RES + 1) + x;
            drawTriangle(ctx, img, v[i], v[i+1], v[i+MESH_RES+1]);
            drawTriangle(ctx, img, v[i+1], v[i+MESH_RES+2], v[i+MESH_RES+1]);
        }
    }

    // --- SKELETON & UI OVERLAYS ---
    // Only show skeleton in EDIT mode if using a rigging tool, or if showSkeleton is explicitly enabled
    const shouldShowBones = currentShowSkeleton || (currentMode === 'EDIT' && (currentTool === 'BONE' || currentTool === 'DELETE' || currentTool === 'MOVE'));

    if (shouldShowBones) {
        // Draw Bones
        currentBones.forEach((b, index) => {
            const mat = globalMatrices[b.id] || IDENTITY;
            const s = transformPoint(mat, safeFloat(b.startX), safeFloat(b.startY));
            const e = transformPoint(mat, safeFloat(b.endX), safeFloat(b.endY));
            drawPremiumBone(ctx, s, e, BONE_PALETTE[index % BONE_PALETTE.length], currentActiveId === b.id);
        });

        // Smart Snap Feedback (EDIT Mode Only)
        if (currentMode === 'EDIT' && currentTool === 'BONE') {
            // Draw Snap Target
            if (snapTarget.current) {
                ctx.beginPath();
                ctx.arc(snapTarget.current.x, snapTarget.current.y, hitRadius * 0.6, 0, Math.PI * 2);
                ctx.strokeStyle = '#00f2ff'; ctx.lineWidth = 2; ctx.stroke();
                ctx.fillStyle = 'rgba(0, 242, 255, 0.3)'; ctx.fill();
            }

            // Draw Preview Line (While Dragging)
            if (tempBoneStart.current && mousePos.current) {
                const s = tempBoneStart.current;
                // Use snap target if available for end point, else raw mouse
                const eX = snapTarget.current ? snapTarget.current.x : mousePos.current.x;
                const eY = snapTarget.current ? snapTarget.current.y : mousePos.current.y;

                ctx.beginPath();
                ctx.moveTo(s.x, s.y);
                ctx.lineTo(eX, eY);
                ctx.strokeStyle = '#00f2ff';
                ctx.setLineDash([5, 5]);
                ctx.lineWidth = 2;
                ctx.stroke();
                ctx.setLineDash([]);

                // Draw end indicator
                ctx.beginPath();
                ctx.arc(eX, eY, 4, 0, Math.PI * 2);
                ctx.fillStyle = '#00f2ff';
                ctx.fill();
            }
        }
    }

    ctx.restore();
    
    if (isActiveRef.current) {
        animationFrameId.current = requestAnimationFrame(loop);
    }
  }, []); 

  const drawPremiumBone = (ctx: CanvasRenderingContext2D, start: {x:number, y:number}, end: {x:number, y:number}, color: string, isSelected: boolean) => {
      const dx = end.x - start.x; const dy = end.y - start.y;
      const length = Math.sqrt(dx*dx + dy*dy);
      const angle = Math.atan2(dy, dx);
      
      ctx.save();
      ctx.translate(start.x, start.y); ctx.rotate(angle);
      
      const midWidth = visualRadius * 0.6;
      ctx.beginPath();
      ctx.moveTo(0, 0); ctx.lineTo(length * 0.2, -midWidth); ctx.lineTo(length * 0.8, -midWidth * 0.5); ctx.lineTo(length, 0);
      ctx.lineTo(length * 0.8, midWidth * 0.5); ctx.lineTo(length * 0.2, midWidth); ctx.closePath();
      
      ctx.fillStyle = isSelected ? '#ffffff' : color;
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1; ctx.stroke();
      
      // Joints
      ctx.beginPath(); ctx.arc(0, 0, visualRadius * 0.4, 0, Math.PI*2); ctx.fillStyle = isSelected ? '#fff' : '#222'; ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(length, 0, visualRadius * 0.25, 0, Math.PI*2); ctx.fill(); ctx.stroke();
      ctx.restore();
  };

    // Reusable matrices to avoid GC pressure
    const MATRIX_POOL_SIZE = 512; // Massively increased for very complex deep rigs
    const matrixPool = useRef<Mat3[]>([]);
    const poolIdx = useRef(0);

    if (matrixPool.current.length === 0) {
        for (let i = 0; i < MATRIX_POOL_SIZE; i++) {
            matrixPool.current.push(new Float32Array([1, 0, 0, 1, 0, 0]));
        }
    }

    const getFromPool = (): Mat3 => {
        const m = matrixPool.current[poolIdx.current];
        poolIdx.current = (poolIdx.current + 1) % MATRIX_POOL_SIZE;
        m[0]=1; m[1]=0; m[2]=0; m[3]=1; m[4]=0; m[5]=0;
        return m;
    };

  useEffect(() => {
    // Optimization: When becoming active, we must draw IMMEDIATELY to prevent the 1-frame blinking glitch
    // This happens because requestAnimationFrame waits for the NEXT browser paint, leaving this frame blank.
    if (isActive) {
        loop(performance.now()); // Immediate draw for current frame
        animationFrameId.current = requestAnimationFrame(loop); // Then start loop
    } else {
        loop(performance.now()); // Static render for inactive states (onion skin etc)
    }
    return () => cancelAnimationFrame(animationFrameId.current);
  }, [isActive, loop]);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (!e.isPrimary) return; // Prevent multi-touch zoom fingers from drawing bones
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) * (canvasRef.current.width / rect.width)) - PUPPET_PADDING;
    const y = ((e.clientY - rect.top) * (canvasRef.current.height / rect.height)) - PUPPET_PADDING;
    
    // TOOL: DELETE
    if (mode === 'EDIT' && tool === 'DELETE') {
        let boneToDeleteId = null; let minDst = hitRadius;
        bonesRef.current.forEach(b => {
            const mat = globalMatricesRef.current[b.id] || IDENTITY;
            const s = transformPoint(mat, safeFloat(b.startX), safeFloat(b.startY));
            const e = transformPoint(mat, safeFloat(b.endX), safeFloat(b.endY));
            const d = distanceToSegment(x, y, s.x, s.y, e.x, e.y);
            if (d < minDst) { minDst = d; boneToDeleteId = b.id; }
        });
        if (boneToDeleteId) {
            const newBones = bonesRef.current.filter(b => b.id !== boneToDeleteId);
            if (onBonesChange) onBonesChange(newBones);
        }
        return;
    }

    // TOOL: MOVE (DRAG JOINTS)
    if (mode === 'EDIT' && tool === 'MOVE') {
        let minDst = hitRadius;
        let targetBoneId: string | null = null;
        let jointType: 'start' | 'end' | null = null;
        
        // Find closest joint in TRANSFORMED space
        bonesRef.current.forEach(b => {
            const mat = globalMatricesRef.current[b.id] || IDENTITY;
            const s = transformPoint(mat, safeFloat(b.startX), safeFloat(b.startY));
            const e = transformPoint(mat, safeFloat(b.endX), safeFloat(b.endY));

            const dS = Math.hypot(x - s.x, y - s.y);
            if (dS < minDst) { minDst = dS; jointType = 'start'; targetBoneId = b.id; }
            const dE = Math.hypot(x - e.x, y - e.y);
            if (dE < minDst) { minDst = dE; jointType = 'end'; targetBoneId = b.id; }
        });

        if (targetBoneId && jointType) {
            // Find all bones sharing this joint (in ORIGINAL space for consistent editing)
            const targetBone = bonesRef.current.find(b => b.id === targetBoneId);
            if (!targetBone) return;
            const originX = jointType === 'start' ? safeFloat(targetBone.startX) : safeFloat(targetBone.endX);
            const originY = jointType === 'start' ? safeFloat(targetBone.startY) : safeFloat(targetBone.endY);

            const jointsToMove: { boneId: string, type: 'start' | 'end', offsetX: number, offsetY: number }[] = [];
            bonesRef.current.forEach(b => {
                if (Math.hypot(originX - safeFloat(b.startX), originY - safeFloat(b.startY)) < 1) {
                    jointsToMove.push({ boneId: b.id, type: 'start', offsetX: safeFloat(b.startX) - x, offsetY: safeFloat(b.startY) - y });
                }
                if (Math.hypot(originX - safeFloat(b.endX), originY - safeFloat(b.endY)) < 1) {
                    jointsToMove.push({ boneId: b.id, type: 'end', offsetX: safeFloat(b.endX) - x, offsetY: safeFloat(b.endY) - y });
                }
            });
            draggedJoints.current = jointsToMove;
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
        }
        return;
    }

    // TOOL: BONE (DRAW)
    if (mode === 'EDIT' && tool === 'BONE') {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        
        let startX = x, startY = y, parentId = null;

        // Use Snap Target if valid (Priority: Explicit Snap > Freehand)
        if (snapTarget.current) {
            startX = snapTarget.current.x;
            startY = snapTarget.current.y;
            parentId = snapTarget.current.parentId;
        } else {
            // Check if clicking existing bone body to parent (Legacy fallback)
            bonesRef.current.forEach(b => {
                const dS = Math.hypot(x - safeFloat(b.startX), y - safeFloat(b.startY));
                const dE = Math.hypot(x - safeFloat(b.endX), y - safeFloat(b.endY));
                if (dE < hitRadius) { parentId = b.id; startX = safeFloat(b.endX); startY = safeFloat(b.endY); }
                else if (dS < hitRadius) { parentId = b.parentId; startX = safeFloat(b.startX); startY = safeFloat(b.startY); }
            });
        }

        tempBoneStart.current = { x: startX, y: startY, parentId };
        dragStart.current = { x, y };
    } 
    // TOOL: HAND (SELECT/MANIPULATE)
    else if ((mode === 'EDIT' && tool === 'HAND') || onBoneSelect) {
        let selected = null; let minDst = hitRadius; 
        
        bonesRef.current.forEach(b => {
            const mat = globalMatricesRef.current[b.id] || IDENTITY;
            const s = transformPoint(mat, safeFloat(b.startX), safeFloat(b.startY));
            const e = transformPoint(mat, safeFloat(b.endX), safeFloat(b.endY));
            const d = distanceToSegment(x, y, s.x, s.y, e.x, e.y);
            if (d < minDst) { minDst = d; selected = b.id; }
        });
        
        if (onBoneSelect) onBoneSelect(selected);
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
      if (!e.isPrimary) return;
      if (!canvasRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const x = ((e.clientX - rect.left) * (canvasRef.current.width / rect.width)) - PUPPET_PADDING;
      const y = ((e.clientY - rect.top) * (canvasRef.current.height / rect.height)) - PUPPET_PADDING;
      
      mousePos.current = { x, y };

      if (mode === 'EDIT' && tool === 'MOVE' && draggedJoints.current.length > 0) {
          const newBones = bonesRef.current.map(b => {
              let newStartX = safeFloat(b.startX);
              let newStartY = safeFloat(b.startY);
              let newEndX = safeFloat(b.endX);
              let newEndY = safeFloat(b.endY);
              let changed = false;

              draggedJoints.current.forEach(j => {
                  if (j.boneId === b.id) {
                      changed = true;
                      if (j.type === 'start') {
                          newStartX = x + j.offsetX;
                          newStartY = y + j.offsetY;
                      } else {
                          newEndX = x + j.offsetX;
                          newEndY = y + j.offsetY;
                      }
                  }
              });

              if (changed) {
                  return {
                      ...b,
                      startX: newStartX, startY: newStartY,
                      endX: newEndX, endY: newEndY,
                      length: Math.hypot(newEndX - newStartX, newEndY - newStartY),
                      angle: Math.atan2(newEndY - newStartY, newEndX - newStartX)
                  };
              }
              return b;
          });
          
          bonesRef.current = newBones;
          return;
      }

      if (mode === 'EDIT' && tool === 'BONE') {
          // --- SMART SNAPPING LOGIC ---
          let closest = null;
          let minDst = hitRadius;

          // Search all bone endpoints for snap targets
          bonesRef.current.forEach(b => {
              // Start Point (Joint)
              const sx = safeFloat(b.startX), sy = safeFloat(b.startY);
              const dS = Math.hypot(x - sx, y - sy);
              if (dS < minDst) { 
                  minDst = dS; 
                  closest = { x: sx, y: sy, parentId: b.parentId }; // Parenting to sibling's parent (Branching)
              }

              // End Point (Tip)
              const ex = safeFloat(b.endX), ey = safeFloat(b.endY);
              const dE = Math.hypot(x - ex, y - ey);
              if (dE < minDst) { 
                  minDst = dE; 
                  closest = { x: ex, y: ey, parentId: b.id }; // Parenting to this bone (Chain)
              }
          });

          // Prevent snapping to the currently drawing bone start point (zero length bone)
          if (closest && tempBoneStart.current) {
              if (Math.hypot(closest.x - tempBoneStart.current.x, closest.y - tempBoneStart.current.y) < 1) {
                  closest = null;
              }
          }

          snapTarget.current = closest;
      } else {
          snapTarget.current = null;
      }

      if (tempBoneStart.current) {
          dragStart.current = { x, y };
      }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
      if (!e.isPrimary) return;
      if (mode === 'EDIT' && tool === 'MOVE' && draggedJoints.current.length > 0) {
          if (onBonesChange) onBonesChange(bonesRef.current);
          draggedJoints.current = [];
          (e.target as HTMLElement).releasePointerCapture(e.pointerId);
          return;
      }

      if (tempBoneStart.current && dragStart.current) {
          const s = tempBoneStart.current; 
          
          // Use snap target for end if available
          let eX = dragStart.current.x;
          let eY = dragStart.current.y;
          if (snapTarget.current) {
              eX = snapTarget.current.x;
              eY = snapTarget.current.y;
          }

          const len = Math.hypot(eX - s.x, eY - s.y);
          if (len > 5) {
              const newBone: Bone = { 
                  id: `bone_${Date.now()}`, 
                  parentId: s.parentId, 
                  startX: s.x, startY: s.y, 
                  endX: eX, endY: eY, 
                  length: len, 
                  angle: Math.atan2(eY - s.y, eX - s.x) 
              };
              if (onBonesChange) onBonesChange([...bonesRef.current, newBone]);
          }
      }
      tempBoneStart.current = null; dragStart.current = null;
      if (e.target instanceof HTMLElement) e.target.releasePointerCapture(e.pointerId);
  };

  return (
    <div className="relative w-full h-full select-none" id={`puppet-warp-container-${initialBones?.[0]?.id || 'anim'}`}>
        <canvas 
            id={`puppet-canvas-${initialBones?.[0]?.id || Math.random().toString(36).substring(7)}`}
            ref={canvasRef}
            width={width + PUPPET_PADDING * 2} 
            height={height + PUPPET_PADDING * 2}
            className={`puppet-canvas ${layerId ? `puppet-canvas-${layerId}` : ''} touch-none will-change-transform ${mode === 'EDIT' ? (tool === 'DELETE' ? 'cursor-no-drop' : (tool === 'HAND' ? 'cursor-grab' : (tool === 'MOVE' ? 'cursor-move' : 'cursor-crosshair'))) : (showSkeleton ? 'cursor-pointer' : 'cursor-default')}`}
            style={{ 
                position: 'absolute', 
                left: `${-PUPPET_PADDING / width * 100}%`, 
                top: `${-PUPPET_PADDING / height * 100}%`,
                width: `${(width + PUPPET_PADDING * 2) / width * 100}%`, 
                height: `${(height + PUPPET_PADDING * 2) / height * 100}%`,
                touchAction: 'none'
            }} 
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
        />
    </div>
  );
};

const distanceToSegment = (x: number, y: number, x1: number, y1: number, x2: number, y2: number) => {
    const A = x - x1; const B = y - y1; const C = x2 - x1; const D = y2 - y1;
    const dot = A * C + B * D; const len_sq = C * C + D * D;
    let param = -1; if (len_sq !== 0) param = dot / len_sq;
    let xx, yy;
    if (param < 0) { xx = x1; yy = y1; } else if (param > 1) { xx = x2; yy = y2; } else { xx = x1 + param * C; yy = y1 + param * D; }
    return Math.hypot(x - xx, y - yy);
};
