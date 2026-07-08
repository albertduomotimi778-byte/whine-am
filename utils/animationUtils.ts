
import { EasingType, Keyframe } from '../types';

const pow = Math.pow;
const sqrt = Math.sqrt;
const sin = Math.sin;
const cos = Math.cos;
const PI = Math.PI;
const c1 = 1.70158;
const c2 = c1 * 1.525;
const c3 = c1 + 1;
const c4 = (2 * PI) / 3;
const c5 = (2 * PI) / 4.5;

// --- EASING FUNCTIONS (Standard Penner Equations) ---
const bounceOut = (x: number): number => {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (x < 1 / d1) return n1 * x * x;
  else if (x < 2 / d1) return n1 * (x -= 1.5 / d1) * x + 0.75;
  else if (x < 2.5 / d1) return n1 * (x -= 2.25 / d1) * x + 0.9375;
  else return n1 * (x -= 2.625 / d1) * x + 0.984375;
};

export const EasingFunctions = {
  [EasingType.Linear]: (x: number) => x,
  [EasingType.Step]: (x: number) => x < 1 ? 0 : 1,
  [EasingType.EaseInQuad]: (x: number) => x * x,
  [EasingType.EaseOutQuad]: (x: number) => 1 - (1 - x) * (1 - x),
  [EasingType.EaseInOutQuad]: (x: number) => x < 0.5 ? 2 * x * x : 1 - pow(-2 * x + 2, 2) / 2,
  [EasingType.EaseInCubic]: (x: number) => x * x * x,
  [EasingType.EaseOutCubic]: (x: number) => 1 - pow(1 - x, 3),
  [EasingType.EaseInOutCubic]: (x: number) => x < 0.5 ? 4 * x * x * x : 1 - pow(-2 * x + 2, 3) / 2,
  [EasingType.EaseInQuart]: (x: number) => x * x * x * x,
  [EasingType.EaseOutQuart]: (x: number) => 1 - pow(1 - x, 4),
  [EasingType.EaseInOutQuart]: (x: number) => x < 0.5 ? 8 * x * x * x * x : 1 - pow(-2 * x + 2, 4) / 2,
  [EasingType.EaseInQuint]: (x: number) => x * x * x * x * x,
  [EasingType.EaseOutQuint]: (x: number) => 1 - pow(1 - x, 5),
  [EasingType.EaseInOutQuint]: (x: number) => x < 0.5 ? 16 * x * x * x * x * x : 1 - pow(-2 * x + 2, 5) / 2,
  [EasingType.EaseInSine]: (x: number) => 1 - cos((x * PI) / 2),
  [EasingType.EaseOutSine]: (x: number) => sin((x * PI) / 2),
  [EasingType.EaseInOutSine]: (x: number) => -(cos(PI * x) - 1) / 2,
  [EasingType.EaseInExpo]: (x: number) => x === 0 ? 0 : pow(2, 10 * x - 10),
  [EasingType.EaseOutExpo]: (x: number) => x === 1 ? 1 : 1 - pow(2, -10 * x),
  [EasingType.EaseInOutExpo]: (x: number) => x === 0 ? 0 : x === 1 ? 1 : x < 0.5 ? pow(2, 20 * x - 10) / 2 : (2 - pow(2, -20 * x + 10)) / 2,
  [EasingType.EaseInCirc]: (x: number) => 1 - sqrt(1 - pow(x, 2)),
  [EasingType.EaseOutCirc]: (x: number) => sqrt(1 - pow(x - 1, 2)),
  [EasingType.EaseInOutCirc]: (x: number) => x < 0.5 ? (1 - sqrt(1 - pow(2 * x, 2))) / 2 : (sqrt(1 - pow(-2 * x + 2, 2)) + 1) / 2,
  [EasingType.EaseInBack]: (x: number) => c3 * x * x * x - c1 * x * x,
  [EasingType.EaseOutBack]: (x: number) => 1 + c3 * pow(x - 1, 3) + c1 * pow(x - 1, 2),
  [EasingType.EaseInOutBack]: (x: number) => x < 0.5 ? (pow(2 * x, 2) * ((c2 + 1) * 2 * x - c2)) / 2 : (pow(2 * x - 2, 2) * ((c2 + 1) * (x * 2 - 2) + c2) + 2) / 2,
  [EasingType.EaseInElastic]: (x: number) => x === 0 ? 0 : x === 1 ? 1 : -pow(2, 10 * x - 10) * sin((x * 10 - 10.75) * c4),
  [EasingType.EaseOutElastic]: (x: number) => x === 0 ? 0 : x === 1 ? 1 : pow(2, -10 * x) * sin((x * 10 - 0.75) * c4) + 1,
  [EasingType.EaseInOutElastic]: (x: number) => x === 0 ? 0 : x === 1 ? 1 : x < 0.5 ? -(pow(2, 20 * x - 10) * sin((20 * x - 11.125) * c5)) / 2 : (pow(2, -20 * x + 10) * sin((20 * x - 11.125) * c5)) / 2 + 1,
  [EasingType.EaseInBounce]: (x: number) => 1 - bounceOut(1 - x),
  [EasingType.EaseOutBounce]: bounceOut,
  [EasingType.EaseInOutBounce]: (x: number) => x < 0.5 ? (1 - bounceOut(1 - 2 * x)) / 2 : (1 + bounceOut(2 * x - 1)) / 2,
};

export const compensateAnchorShift = (
  x: number, y: number,
  rotation: number,
  scaleX: number, scaleY: number,
  flipX: boolean, flipY: boolean,
  oldAnchorX: number, oldAnchorY: number,
  newAnchorX: number, newAnchorY: number,
  width: number = 150, height: number = 150
) => {
  const dxLocal = ((newAnchorX - oldAnchorX) / 100) * width;
  const dyLocal = ((newAnchorY - oldAnchorY) / 100) * height;

  const rad = (rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  const finalScaleX = scaleX * (flipX ? -1 : 1);
  const finalScaleY = scaleY * (flipY ? -1 : 1);

  const rdx = dxLocal * cos * finalScaleX - dyLocal * sin * finalScaleY;
  const rdy = dxLocal * sin * finalScaleX + dyLocal * cos * finalScaleY;

  return {
    x: x - dxLocal + rdx,
    y: y - dyLocal + rdy
  };
};

const lerp = (start: number, end: number, t: number) => {
  return start + (end - start) * t;
};

// --- HELPER: GET DEFAULT VALUE ---
const getDefaultValueForProperty = (prop: string): number => {
    const p = prop.toLowerCase();
    if (p.includes('scale') || p.includes('opacity') || p.includes('alpha')) return 1;
    if (p.includes('brightness') || p.includes('contrast') || p.includes('saturation')) return 100;
    if (p.includes('bgzoom')) return 100;
    if (p.includes('gain')) return 1.0;
    if (p.includes('pitch')) return 1.0;
    if (p.includes('intensity')) return 1.0;
    return 0;
};

export const resolveAnimation = (keyframes: Keyframe[], time: number): Record<string, number> => {
    if (!keyframes || keyframes.length === 0) return {};

    const sortedKeys = [...keyframes].sort((a, b) => a.time - b.time);
    const result: Record<string, number> = {};
    
    // COLLECT ALL UNIQUE PROPERTIES ACROSS THE TIMELINE
    const allProps = new Set<string>();
    sortedKeys.forEach(kf => Object.keys(kf.properties).forEach(p => allProps.add(p)));

    // --- TRACK-BASED INTERPOLATION ---
    // For each property, we find the specific Previous and Next keyframes that define IT.
    // This allows sparse keyframes to work correctly without complex global lookahead.
    
    allProps.forEach(prop => {
        let prevKey: Keyframe | null = null;
        let nextKey: Keyframe | null = null;

        // 1. Find the closest defined keys surrounding 'time'
        for (let i = 0; i < sortedKeys.length; i++) {
            const kf = sortedKeys[i];
            // If this keyframe has our property...
            if (kf.properties[prop] !== undefined) {
                if (kf.time <= time) {
                    prevKey = kf; // Candidate for start
                } else {
                    nextKey = kf; // First key after time, stop searching
                    break; 
                }
            }
        }

        // 2. Interpolate
        if (prevKey && nextKey) {
            // Normal case: We are between two defined values
            const startVal = prevKey.properties[prop];
            const endVal = nextKey.properties[prop];
            const duration = nextKey.time - prevKey.time;
            
            if (duration <= 0.0001 || prop.endsWith("isVisible")) {
                // For isVisible, we use step interpolation (value holds until next keyframe)
                result[prop] = prop.endsWith("isVisible") ? startVal : endVal;
            } else {
                const rawT = (time - prevKey.time) / duration;
                const easeFunc = EasingFunctions[prevKey.easing] || EasingFunctions[EasingType.Linear];
                const t = easeFunc(Math.max(0, Math.min(1, rawT)));
                result[prop] = lerp(startVal, endVal, t);
            }
        } else if (prevKey) {
            // After last keyframe -> HOLD
            result[prop] = prevKey.properties[prop];
        } else if (nextKey) {
            // Before first keyframe -> Use first value (No implicit 0 default, allows setup pose)
            result[prop] = nextKey.properties[prop];
        } else {
            // Property exists in set but found nowhere? Fallback (shouldn't happen)
            result[prop] = getDefaultValueForProperty(prop);
        }
    });

    return result;
};

export const getSceneStateAtTime = resolveAnimation;
