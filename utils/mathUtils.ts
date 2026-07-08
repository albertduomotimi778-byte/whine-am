
/**
 * 2D Affine Matrix [a, b, c, d, tx, ty]
 * Represents:
 * | a  c  tx |
 * | b  d  ty |
 * | 0  0  1  |
 */
export type Matrix2D = [number, number, number, number, number, number];

export const Mat3 = {
  create: (): Matrix2D => [1, 0, 0, 1, 0, 0],

  identity: (out: Matrix2D): Matrix2D => {
    out[0] = 1; out[1] = 0;
    out[2] = 0; out[3] = 1;
    out[4] = 0; out[5] = 0;
    return out;
  },

  multiply: (out: Matrix2D, a: Matrix2D, b: Matrix2D): Matrix2D => {
    const a0 = a[0], a1 = a[1], a2 = a[2], a3 = a[3], a4 = a[4], a5 = a[5];
    const b0 = b[0], b1 = b[1], b2 = b[2], b3 = b[3], b4 = b[4], b5 = b[5];
    
    out[0] = a0 * b0 + a2 * b1;
    out[1] = a1 * b0 + a3 * b1;
    out[2] = a0 * b2 + a2 * b3;
    out[3] = a1 * b2 + a3 * b3;
    out[4] = a0 * b4 + a2 * b5 + a4;
    out[5] = a1 * b4 + a3 * b5 + a5;
    return out;
  },

  fromTransform: (out: Matrix2D, x: number, y: number, rotationDeg: number, scaleX: number, scaleY: number): Matrix2D => {
    const rad = (rotationDeg * Math.PI) / 180;
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    
    out[0] = c * scaleX;
    out[1] = s * scaleX;
    out[2] = -s * scaleY;
    out[3] = c * scaleY;
    out[4] = x;
    out[5] = y;
    return out;
  },

  /**
   * Constructs a Basis Matrix for a Bone Segment.
   * Includes SINGULARITY PROTECTION to prevent mesh collapse.
   */
  fromSegment: (out: Matrix2D, originX: number, originY: number, targetX: number, targetY: number): Matrix2D => {
      const dx = targetX - originX;
      const dy = targetY - originY;
      const len = Math.sqrt(dx*dx + dy*dy);
      
      // SINGULARITY PROTECTION:
      // If bone length is near zero, we clamp it to a tiny epsilon.
      // This prevents the matrix from scaling to 0 (collapsing the mesh).
      const safeLen = Math.max(len, 0.0001);

      // X-Basis: The Bone Vector itself (dx, dy)
      // This maps X=0 to Origin, X=1 to Target.
      out[0] = dx; 
      out[1] = dy;

      // Y-Basis: Normalized Perpendicular Vector (-dy/L, dx/L)
      // We scale this by safeLen to maintain Aspect Ratio (Uniform-ish scaling feel)
      // or keep it Unit Length for "Ribbon" behavior.
      // Current: "Rubber Band" behavior (Stretch X, Fixed Y thickness)
      out[2] = -dy / safeLen;
      out[3] = dx / safeLen;

      // Translation
      out[4] = originX;
      out[5] = originY;
      
      return out;
  },

  invert: (out: Matrix2D, a: Matrix2D): Matrix2D | null => {
    const a0 = a[0], a1 = a[1], a2 = a[2], a3 = a[3], a4 = a[4], a5 = a[5];
    const det = a0 * a3 - a2 * a1;

    // Relaxed epsilon for stability
    if (Math.abs(det) < 0.00000001) return null;
    const detInv = 1.0 / det;

    out[0] = a3 * detInv;
    out[1] = -a1 * detInv;
    out[2] = -a2 * detInv;
    out[3] = a0 * detInv;
    out[4] = (a2 * a5 - a3 * a4) * detInv;
    out[5] = (a1 * a4 - a0 * a5) * detInv;
    return out;
  },

  transformPoint: (m: Matrix2D, x: number, y: number): {x: number, y: number} => {
    return {
      x: m[0] * x + m[2] * y + m[4],
      y: m[1] * x + m[3] * y + m[5]
    };
  }
};

// --- GEOMETRY HELPERS ---

export const distanceToPoint = (x: number, y: number, bx: number, by: number) => {
    const dx = x - bx;
    const dy = y - by;
    return Math.sqrt(dx*dx + dy*dy);
};

export const distanceToSegment = (x: number, y: number, x1: number, y1: number, x2: number, y2: number) => {
    const A = x - x1;
    const B = y - y1;
    const C = x2 - x1;
    const D = y2 - y1;

    const dot = A * C + B * D;
    const len_sq = C * C + D * D;
    let param = -1;
    
    if (len_sq !== 0) param = dot / len_sq;

    let xx, yy;

    if (param < 0) {
        xx = x1;
        yy = y1;
    }
    else if (param > 1) {
        xx = x2;
        yy = y2;
    }
    else {
        xx = x1 + param * C;
        yy = y1 + param * D;
    }

    const dx = x - xx;
    const dy = y - yy;
    return Math.sqrt(dx * dx + dy * dy);
};
