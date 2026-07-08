
import { Matrix2D } from "./utils/mathUtils";

export enum VisemeShape {
  REST = 'REST',       // Neutral
  AI = 'AI',           // Ah, I, Eye (Open)
  E = 'E',             // Ee, Eh (Wide/Stretch)
  O = 'O',             // Oh (Open Round)
  U = 'U',             // Oo, W, Q (Tight Round)
  FV = 'FV',           // F, V (Teeth on Lip)
  L = 'L',             // L, Th, D (Tongue Up)
  MBP = 'MBP',         // M, B, P (Lips Pressed/Active Closed)
  CONS = 'CONS'        // S, T, K, Ch, J (Teeth Clenched/Sibilant)
}

export type ProjectType = 'CHARACTER' | 'FRAME' | 'GAME';

export interface FrameLayer {
  id: string;
  name: string;
  dataUri: string; // Base64
  visible: boolean;
  opacity: number; // 0-1
  bones?: Bone[]; // Skeletal support for individual layers
  boneTransforms?: Record<string, { rotation: number, scaleX: number, scaleY: number }>;
  rigType?: 'MESH' | 'HUMAN';
}

export interface FrameData {
  id: string;
  dataUri: string; // Composite Base64 (Flattened view for timeline)
  layers?: FrameLayer[]; // Layers for editing
  note?: string;
}

// --- BRUSH ENGINE TYPES ---

export type BrushEngineType = 
  | 'INK_G_PEN' 
  | 'INK_MAPPING' 
  | 'PENCIL_REAL' 
  | 'PENCIL_MECHANICAL' 
  | 'MARKER_FLAT' 
  | 'PAINT_WATERCOLOR' 
  | 'PAINT_OIL' 
  | 'AIRBRUSH_SOFT' 
  | 'AIRBRUSH_DROPLET' 
  | 'STAMP_STAR' 
  | 'STAMP_HEART' 
  | 'STAMP_SPARKLE' 
  | 'STAMP_LEAF' 
  | 'STAMP_LACE'
  | 'PIXEL' 
  | 'ERASER_HARD' 
  | 'ERASER_SOFT' 
  | 'ERASER_KNEADED';

export interface BrushPreset {
    id: string;
    name: string;
    category: string; // 'PEN' | 'PENCIL' | 'PAINT' | 'AIRBRUSH' | 'DECOR' | 'ERASER' | 'FILL'
    engine: BrushEngineType;
    size: number;
    opacity: number;
    spacing?: number; // 0.01 to 10.0 (Percentage of brush size. 0.1 = continuous line, 1.5 = gaps)
    jitter?: number;  // 0 to 1 (Randomness in position)
    rotationMode?: 'FIXED' | 'FOLLOW' | 'RANDOM'; // For stamps
    hardness?: number; // 0 (Soft) to 1 (Hard)
    blendMode?: GlobalCompositeOperation;
    pressureSensitive?: boolean;
    texture?: boolean; // If true, applies noise pattern
    icon?: any;
    description?: string; // Add description field
}

export type LipSyncMode = 'DSP' | 'AI';

export interface TextKeyframe {
  id: string;
  time: number; // For now time is just creation time
  text: string;
  x: number;
  y: number;
  color: string;
  borderColor: string;
  backgroundColor: string;
  shadowColor: string;
  fontSize: number;
  fontFamily: string;
}

export interface SceneText {
  id: string;
  text: string;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  color: string;
  borderColor: string;
  borderWidth: number;
  backgroundColor: string;
  shadowColor: string;
  fontSize: number;
  fontFamily: string;
  styleTemplate: 'none' | 'meme' | 'subtitle' | 'comic';
}

export interface VisemeFrame {
  time: number;
  shape: VisemeShape;
  intensity: number;
  openness: number; 
  spread: number;   
  spectralFlux: number; 
  plosiveScore: number; 
}

export interface LipSyncKeyframe {
  id: string;
  time: number;
  shape: VisemeShape;
  intensity: number;
  isManual: boolean; // If true, auto-generation won't overwrite this
  targetId?: string; // ID of the character this keyframe targets
  duration?: number;
}

export interface AudioSegment {
    id: string;
    buffer: AudioBuffer;      // Original buffer
    startPosition: number;    // Where the segment starts in the timeline (in seconds)
    clipStart: number;        // Start time within the original buffer (in seconds)
    duration: number;         // Duration of the segment
}

export interface TrackState {
  id: string;
  name: string;
  buffer: AudioBuffer | null;
  url?: string;
  segments: AudioSegment[];
  gain: number;
  muted: boolean;
  pitch: number;
  speed: number;
  color: string;
  visemes?: VisemeFrame[]; 
}

export interface AudioContextState {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  playbackRate: number;
}

export interface TransformState {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  anchorX: number; // Percent 0-100
  anchorY: number; // Percent 0-100
  flipX?: boolean;
  flipY?: boolean;
  eyeSquint?: number;
  pupilX?: number;
  pupilY?: number;
}

export interface Bone {
  id: string;
  parentId: string | null;
  startX: number; 
  startY: number;
  endX: number; 
  endY: number;
  length: number;
  angle: number; // Base angle in radians
}

export interface CharacterPart {
  id: string;
  label: string;
  imageUrl: string | null;
  transform: TransformState;
  baseTransform?: TransformState;
  zIndex: number;
  width?: number;
  height?: number;
  tags: string[];
  bones?: Bone[]; // Added skeletal support
  rigType?: 'MESH' | 'HUMAN';

  parentId: string | null;
  children: string[];
  isGroup: boolean;
  isIndependent: boolean;
  isOpen?: boolean; 
  isVisible?: boolean; 
  opacity?: number;
  loopSpeed?: number;
  isLoopActive?: boolean;
  filters?: { brightness: number, contrast: number, saturation: number };
  physics?: {
    points?: { x: number, y: number, oldX: number, oldY: number, anchorX: number, anchorY: number }[];
    blink?: { nextBlink: number, isBlinking: boolean, progress: number };
    breath?: { phase: number };
  };
}

export type CharacterComposition = Record<string, CharacterPart>;

export enum EasingType {
  Linear = 'Linear',
  Step = 'Step',
  EaseInQuad = 'EaseInQuad',
  EaseOutQuad = 'EaseOutQuad',
  EaseInOutQuad = 'EaseInOutQuad',
  EaseInCubic = 'EaseInCubic',
  EaseOutCubic = 'EaseOutCubic',
  EaseInOutCubic = 'EaseInOutCubic',
  EaseInQuart = 'EaseInQuart',
  EaseOutQuart = 'EaseOutQuart',
  EaseInOutQuart = 'EaseInOutQuart',
  EaseInQuint = 'EaseInQuint',
  EaseOutQuint = 'EaseOutQuint',
  EaseInOutQuint = 'EaseInOutQuint',
  EaseInSine = 'EaseInSine',
  EaseOutSine = 'EaseOutSine',
  EaseInOutSine = 'EaseInOutSine',
  EaseInExpo = 'EaseInExpo',
  EaseOutExpo = 'EaseOutExpo',
  EaseInOutExpo = 'EaseInOutExpo',
  EaseInCirc = 'EaseInCirc',
  EaseOutCirc = 'EaseOutCirc',
  EaseInOutCirc = 'EaseInOutCirc',
  EaseInBack = 'EaseInBack',
  EaseOutBack = 'EaseOutBack',
  EaseInOutBack = 'EaseInOutBack',
  EaseInElastic = 'EaseInElastic',
  EaseOutElastic = 'EaseOutElastic',
  EaseInOutElastic = 'EaseInOutElastic',
  EaseInBounce = 'EaseInBounce',
  EaseOutBounce = 'EaseOutBounce',
  EaseInOutBounce = 'EaseInOutBounce',
}

// Universal Property Type - Allows any string key for infinite extensibility
export type AnimatableProperty = string;

// [x1, y1, x2, y2]
export type BezierControlPoints = [number, number, number, number];

export interface Keyframe {
  id: string;
  time: number; 
  // Map of "target:property" -> value (e.g. "camera:x": 100, "char:head:rotation": 45)
  // This supports ANY numeric property in the entire app.
  properties: Record<string, number>; 
  easing: EasingType;
  // Optional: Custom Bezier Curve override. If present, ignores EasingType.
  controlPoints?: BezierControlPoints;
}

// --- ASSET MANAGEMENT TYPES ---

export interface UnpackedImage {
  id: string;
  name: string;
  url: string;
  width: number;
  height: number;
}

export interface PlacedAsset {
    id: string;
    asset: UnpackedImage;
    transform: TransformState;
    zIndex: number;
}

export interface AssemblerSession {
  placedAssets: PlacedAsset[];
  assignments: Record<string, string | null>;
  unassignedImages: UnpackedImage[];
  hasSession: boolean;
  visemeMap?: Partial<Record<VisemeShape, string | null>>;
}

// --- LIGHTING TYPES ---

export type LightType = 'SUN' | 'BULB' | 'LIGHTNING';

export interface LightSource {
    id: string;
    type: LightType;
    x: number; // Stage coordinate X relative to center
    y: number; // Stage coordinate Y relative to center
    intensity: number; // 0 to 2
    color: string; // Hex
    radius?: number; // Spread for bulbs
    softness?: number; // Blur amount for shadows
    isActive: boolean;
    renderBehind?: boolean;
    targetCharacterId?: string;
    targetPartIds?: string[];
    isBlinking?: boolean;
    blinkSpeed?: number;
}

export type ShadowConfig = { 
    enabled: boolean; 
    opacity: number; 
    blur: number; 
    skewX: number; 
    scaleY: number; 
    offsetX: number; 
    offsetY: number; 
    color: string; 
};

// --- EXPORT TYPES ---

export type ExportResolution = '4K' | '1080p' | '720p' | '480p';
export type ExportFrameRate = '60' | '30' | '24';
export type ExportBitrate = 'High' | 'Recommended' | 'Low';
export type ExportFormat = 'mp4' | 'webm';

export interface ExportSettings {
    resolution: ExportResolution;
    frameRate: ExportFrameRate;
    bitrate: ExportBitrate;
    format: ExportFormat;
}
