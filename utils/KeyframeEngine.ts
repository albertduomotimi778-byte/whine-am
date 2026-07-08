
import { Keyframe, EasingType, BezierControlPoints } from '../types';

// --- BEZIER MATH ---

class CubicBezier {
    private cx: number;
    private bx: number;
    private ax: number;
    private cy: number;
    private by: number;
    private ay: number;

    constructor(p1x: number, p1y: number, p2x: number, p2y: number) {
        this.cx = 3.0 * p1x;
        this.bx = 3.0 * (p2x - p1x) - this.cx;
        this.ax = 1.0 - this.cx - this.bx;

        this.cy = 3.0 * p1y;
        this.by = 3.0 * (p2y - p1y) - this.cy;
        this.ay = 1.0 - this.cy - this.by;
    }

    private sampleCurveX(t: number): number {
        return ((this.ax * t + this.bx) * t + this.cx) * t;
    }

    private sampleCurveY(t: number): number {
        return ((this.ay * t + this.by) * t + this.cy) * t;
    }

    private sampleCurveDerivativeX(t: number): number {
        return (3.0 * this.ax * t + 2.0 * this.bx) * t + this.cx;
    }

    solve(x: number, epsilon: number = 1e-6): number {
        return this.sampleCurveY(this.solveCurveX(x, epsilon));
    }

    private solveCurveX(x: number, epsilon: number): number {
        let t0: number, t1: number, t2: number, x2: number, d2: number, i: number;

        // Newton-Raphson
        for (t2 = x, i = 0; i < 8; i++) {
            x2 = this.sampleCurveX(t2) - x;
            if (Math.abs(x2) < epsilon) return t2;
            d2 = this.sampleCurveDerivativeX(t2);
            if (Math.abs(d2) < 1e-6) break;
            t2 = t2 - x2 / d2;
        }

        // Binary Subdivision
        t0 = 0.0;
        t1 = 1.0;
        t2 = x;

        if (t2 < t0) return t0;
        if (t2 > t1) return t1;

        while (t0 < t1) {
            x2 = this.sampleCurveX(t2);
            if (Math.abs(x2 - x) < epsilon) return t2;
            if (x > x2) t0 = t2;
            else t1 = t2;
            t2 = (t1 - t0) * 0.5 + t0;
        }

        return t2;
    }
}

// --- CONFIG ---

const EASING_MAP: Record<EasingType, BezierControlPoints> = {
    [EasingType.Linear]: [0, 0, 1, 1],
    [EasingType.Step]: [0, 1, 0, 1],
    [EasingType.EaseInQuad]: [0.55, 0.085, 0.68, 0.53],
    [EasingType.EaseOutQuad]: [0.25, 0.46, 0.45, 0.94],
    [EasingType.EaseInOutQuad]: [0.455, 0.03, 0.515, 0.955],
    [EasingType.EaseInCubic]: [0.55, 0.055, 0.675, 0.19],
    [EasingType.EaseOutCubic]: [0.215, 0.61, 0.355, 1],
    [EasingType.EaseInOutCubic]: [0.645, 0.045, 0.355, 1],
    [EasingType.EaseInQuart]: [0.895, 0.03, 0.685, 0.22],
    [EasingType.EaseOutQuart]: [0.165, 0.84, 0.44, 1],
    [EasingType.EaseInOutQuart]: [0.77, 0, 0.175, 1],
    [EasingType.EaseInQuint]: [0.755, 0.05, 0.855, 0.06],
    [EasingType.EaseOutQuint]: [0.23, 1, 0.32, 1],
    [EasingType.EaseInOutQuint]: [0.86, 0, 0.07, 1],
    [EasingType.EaseInSine]: [0.47, 0, 0.745, 0.715],
    [EasingType.EaseOutSine]: [0.39, 0.575, 0.565, 1],
    [EasingType.EaseInOutSine]: [0.445, 0.05, 0.55, 0.95],
    [EasingType.EaseInExpo]: [0.95, 0.05, 0.795, 0.035],
    [EasingType.EaseOutExpo]: [0.19, 1, 0.22, 1],
    [EasingType.EaseInOutExpo]: [1, 0, 0, 1],
    [EasingType.EaseInCirc]: [0.6, 0.04, 0.98, 0.335],
    [EasingType.EaseOutCirc]: [0.075, 0.82, 0.165, 1],
    [EasingType.EaseInOutCirc]: [0.785, 0.135, 0.15, 0.86],
    [EasingType.EaseInBack]: [0.6, -0.28, 0.735, 0.045],
    [EasingType.EaseOutBack]: [0.175, 0.885, 0.32, 1.275],
    [EasingType.EaseInOutBack]: [0.68, -0.55, 0.265, 1.55],
    [EasingType.EaseInElastic]: [0.7, -0.4, 0.8, 0.4], 
    [EasingType.EaseOutElastic]: [0.2, 0.6, 0.3, 1.4],
    [EasingType.EaseInOutElastic]: [0.8, -0.4, 0.2, 1.4],
    [EasingType.EaseInBounce]: [0.4, 0, 0.8, 0.5],
    [EasingType.EaseOutBounce]: [0.2, 0.5, 0.6, 1],
    [EasingType.EaseInOutBounce]: [0.4, 0, 0.6, 1],
};

const BEZIER_CACHE = new Map<string, CubicBezier>();

const getBezierSolver = (p1x: number, p1y: number, p2x: number, p2y: number): CubicBezier => {
    const key = `${p1x.toFixed(3)},${p1y.toFixed(3)},${p2x.toFixed(3)},${p2y.toFixed(3)}`;
    if (!BEZIER_CACHE.has(key)) {
        BEZIER_CACHE.set(key, new CubicBezier(p1x, p1y, p2x, p2y));
    }
    return BEZIER_CACHE.get(key)!;
};

// --- ENGINE ---

export class KeyframeEngine {

    static getTracks(keyframes: Keyframe[]): Record<string, Keyframe[]> {
        const tracks: Record<string, Keyframe[]> = {};
        const sorted = [...keyframes].sort((a, b) => a.time - b.time);
        
        sorted.forEach(kf => {
            if (kf.properties) {
                Object.keys(kf.properties).forEach(prop => {
                    if (!tracks[prop]) tracks[prop] = [];
                    tracks[prop].push(kf);
                });
            }
        });
        return tracks;
    }

    static resolveStateFromTracks(tracks: Record<string, Keyframe[]>, globalTime: number): Record<string, number> {
        const result: Record<string, number> = {};
        Object.keys(tracks).forEach(prop => {
            result[prop] = this.evaluateTrack(tracks[prop], prop, globalTime);
        });
        return result;
    }

    static resolveState(keyframes: Keyframe[], globalTime: number, isSorted: boolean = false): Record<string, number> {
        if (!keyframes || keyframes.length === 0) return {};
        const tracks = this.getTracks(keyframes);
        return this.resolveStateFromTracks(tracks, globalTime);
    }

    private static evaluateTrack(track: Keyframe[], property: string, time: number): number {
        if (track.length === 0) return this.getDefaultValue(property);

        // --- EDGE CASES ---
        
        // Before Start -> Return First Value
        if (time <= track[0].time) {
            return track[0].properties[property];
        }

        // After End -> Return Last Value
        if (time >= track[track.length - 1].time) {
            return track[track.length - 1].properties[property];
        }

        // --- SEGMENT SEARCH (Binary) ---
        // Find index 'i' such that track[i].time <= time < track[i+1].time
        
        let low = 0;
        let high = track.length - 2; // We are looking for the *start* of the segment, so it can't be the last element
        let i = 0; // Default to first segment if search fails (shouldn't happen due to edge cases)

        while (low <= high) {
            const mid = (low + high) >>> 1;
            if (track[mid].time <= time) {
                i = mid;
                low = mid + 1;
            } else {
                high = mid - 1;
            }
        }

        const prevKey = track[i];
        const nextKey = track[i + 1];

        // Safety check (should be covered by After End check, but safe is better)
        if (!nextKey) return prevKey.properties[property];

        return this.interpolate(prevKey, nextKey, property, time);
    }

    private static interpolate(k1: Keyframe, k2: Keyframe, prop: string, time: number): number {
        const startVal = k1.properties[prop];
        const endVal = k2.properties[prop];
        const duration = k2.time - k1.time;

        if (duration <= 0.00001) return startVal;

        // 1. Normalize Time (0.0 to 1.0)
        // Clamp 0-1 to ensure no overshooting if floating point errors occur
        const localT = Math.max(0, Math.min(1, (time - k1.time) / duration));

        // 2. Get Bezier Curve
        let curve: BezierControlPoints;
        if (k1.controlPoints) {
            curve = k1.controlPoints;
        } else {
            curve = EASING_MAP[k1.easing] || EASING_MAP[EasingType.Linear];
        }

        // 3. Solve Progression
        // If Linear, skip Bezier math for speed
        let progression = localT;
        if (k1.easing !== EasingType.Linear || k1.controlPoints) {
            const solver = getBezierSolver(...curve);
            progression = solver.solve(localT);
        }

        // 4. Lerp
        return startVal + (endVal - startVal) * progression;
    }

    private static getDefaultValue(prop: string): number {
        const p = prop.toLowerCase();
        // Scale/Opacity default to 1, others to 0
        if (p.includes('scale') || p.includes('alpha') || p.includes('opacity') || p.includes('zoom')) return 1;
        if (p.includes('brightness') || p.includes('contrast') || p.includes('saturation')) return 100;
        if (p.includes('gain') || p.includes('pitch')) return 1.0;
        return 0;
    }
}
