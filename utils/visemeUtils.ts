
import { VisemeShape } from '../types';

export interface VisemePhysicsParams {
    openness: number; // Vertical Jaw Drop (0 to 1)
    spread: number;   // Horizontal Mouth Width (-1 to 1)
    squeeze: number;  // Lip Compression/Pucker (ScaleX factor)
}

/**
 * Calculates bio-mechanical deformation targets.
 * Emulates facial muscle groups for realistic "fleshy" movement.
 */
export const calculateInstantVisemeParams = (shape: VisemeShape, intensity: number): VisemePhysicsParams => {
    let openness = 0; 
    let spread = 0; 
    let squeeze = 1;

    // Organic Non-Linear Response Curve
    // Adjusted curve for a more "fleshy" and responsive feel
    const i = Math.pow(Math.max(0, Math.min(1, intensity)), 1.2);

    switch (shape) {
        case VisemeShape.AI: 
            // Jaw drops (Digastric), Lips relaxed
            openness = 0.95; 
            spread = 0.15; 
            squeeze = 0.95;
            break;
            
        case VisemeShape.E: 
            // Cheeks pull back (Zygomaticus major), Jaw mid-open
            openness = 0.45; 
            spread = 0.9; // Wide stretch
            squeeze = 1.1; // Slight flattening
            break;
            
        case VisemeShape.O: 
            // Lips round (Orbicularis oris), Jaw open
            openness = 0.85; 
            spread = -0.45; // Negative spread = narrow corners
            squeeze = 0.75; // Horizontal compression
            break;
            
        case VisemeShape.U: 
            // Lips tight pucker, Jaw closed-mid
            openness = 0.35; 
            spread = -0.75; // Extreme narrowing
            squeeze = 0.55; // Extreme compression
            break;
            
        case VisemeShape.L: 
            // Jaw mid, Tongue interaction (neutral width)
            openness = 0.6; 
            spread = 0.25; 
            squeeze = 1.0;
            break;
            
        case VisemeShape.FV: 
            // Upper teeth on lower lip (Mentalis), Jaw closed-mid
            openness = 0.25; 
            spread = 0.15; 
            squeeze = 1.05; // Tuck effect
            break;
            
        case VisemeShape.MBP: 
            // Lips pressed (active closure), slightly wider
            openness = 0.05; 
            spread = 0.25;
            squeeze = 1.25; // Pressed flat
            break;
            
        case VisemeShape.CONS: 
            // Teeth clenched (S/T), Jaw nearly closed, Wide
            openness = 0.2; 
            spread = 0.7; 
            squeeze = 1.05;
            break;
            
        default: // REST
            openness = 0;
            spread = 0;
            squeeze = 1;
    }

    return {
        // Damping the effect slightly for small intensities to prevent jitter
        openness: openness * i,
        spread: spread * i,
        // Squeeze interpolates from 1.0 (neutral) to target
        squeeze: 1 + (squeeze - 1) * i
    };
};

export interface MouthTargets {
    scaleX: number;
    scaleY: number;
    offsetY: number;
}

/**
 * The One Source of Truth for viseme coordinate targets.
 * Ensures the Editor Stage and the Export Render look identical.
 */
export const getMouthPhysicsTargets = (shape: VisemeShape, intensity: number): MouthTargets => {
    const params = calculateInstantVisemeParams(shape, intensity);
    
    let targetScaleX = 1.0;
    let targetScaleY = 1.0;
    let targetOffsetY = 0;

    targetScaleY += params.openness * 0.35; // slightly wider vertical scale for more expressive "fleshy" look
    targetScaleX += params.spread * 0.18;   // organic lateral stretch

    // Correct for natural mouth thinning when stretching wide
    if (params.openness > 0.1 && params.spread < 0.2) {
        targetScaleX -= params.openness * 0.12; 
    }

    // Jaw drop translation: when mouth opens, the jaw moves downwards
    // This is mathematically and anatomically correct for organic speech.
    targetOffsetY += params.openness * 6.5;

    // Overrides for specific extreme shapes (matching original stage behavior)
    switch (shape) {
        case VisemeShape.O: 
        case VisemeShape.U: 
            targetScaleX = 0.85; 
            targetScaleY = Math.max(0.85, 1.0 + params.openness * 0.3); 
            targetOffsetY += params.openness * 2.0; // Extra down shift for lower lip rounding
            break;
        case VisemeShape.MBP: 
            targetScaleY = 0.92; 
            targetScaleX = 1.06; 
            break;
        case VisemeShape.FV: 
            targetScaleY = 0.95;
            targetScaleX = 1.02;
            break;
        case VisemeShape.E: 
            targetScaleX = 1.15; 
            targetScaleY = 0.95; 
            break;
    }

    // Apply the pucker/squeeze factor from the viseme definition
    targetScaleX *= params.squeeze;
    
    return { 
        scaleX: targetScaleX, 
        scaleY: targetScaleY, 
        offsetY: targetOffsetY 
    };
};
