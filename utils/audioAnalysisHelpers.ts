
import { VisemeShape } from '../types';

/**
 * Calculates energy in Low, Mid, and High frequency bands.
 */
export const calculateMultiBandEnergies = (
    frequencyData: Uint8Array,
    sampleRate: number,
    fftSize: number
) => {
    const binSize = sampleRate / fftSize;
    
    const getSum = (minHz: number, maxHz: number) => {
        const start = Math.floor(minHz / binSize);
        const end = Math.floor(maxHz / binSize);
        if (start >= end) return 0;
        let sum = 0;
        const safeEnd = Math.min(end, frequencyData.length);
        for (let i = start; i < safeEnd; i++) {
            sum += frequencyData[i];
        }
        return sum / Math.max(1, safeEnd - start);
    };

    const low = getSum(80, 650);
    const mid = getSum(650, 2500);
    const high = getSum(2500, 10000); 

    return { low, mid, high };
};

/**
 * Advanced spectral classifier.
 */
export const determineVisemeFromSpectrum = (
    low: number, 
    mid: number, 
    high: number, 
    zcr: number,
    totalEnergy: number
): VisemeShape => {
    const NOISE_THRESHOLD = 5; 
    
    if (totalEnergy < NOISE_THRESHOLD) {
        return VisemeShape.REST; 
    }

    const total = low + mid + high + 0.01;
    const rLow = low / total;
    const rMid = mid / total;
    const rHigh = high / total;

    // Detect hard consonants, fricatives, and siblants (S, T, K, F, V, etc.)
    if (zcr > 0.12 || rHigh > 0.35) {
        if (zcr > 0.22 || (rHigh > 0.5 && totalEnergy > 10)) return VisemeShape.CONS;
        if (totalEnergy < 50 && (rHigh > 0.3 || zcr > 0.12)) return VisemeShape.FV; 
        return VisemeShape.E; 
    }

    // Detect Plosives / Hums (M, B, P)
    // Very low frequency dominant, low zero-crossing means humming or closed-mouth vocalization
    if (totalEnergy >= NOISE_THRESHOLD && totalEnergy < 35 && rLow > 0.65 && zcr < 0.06) {
         return VisemeShape.MBP; 
    }

    // Vowel Ratios (A, I, E, O, U)
    if (rMid > 0.38) return VisemeShape.AI;
    if (rMid > 0.25 && rLow < 0.4) return VisemeShape.E;

    if (rLow > 0.42) {
        if (rLow > 0.7) return VisemeShape.U;
        return VisemeShape.O;
    }

    if (totalEnergy > 50) return VisemeShape.AI;
    
    // Fallback for mid-energy neutral sounds (like 'L', 'N', 'D')
    if (totalEnergy > 10) return VisemeShape.L;
    
    // Very quiet in-between sounds (soft breathing, trail-offs)
    return VisemeShape.REST;
};

/**
 * Maps shapes to precise physical deformation targets.
 */
export const getPhysicsForShape = (shape: VisemeShape, intensity: number) => {
    let openness = 0;
    let spread = 0;
    let squeeze = 1;

    // Organic non-linear response
    const i = Math.pow(Math.min(1, Math.max(0, intensity / 255)), 1.2);

    switch (shape) {
        case VisemeShape.AI: 
            openness = 0.9; 
            spread = 0.15; 
            squeeze = 0.95;
            break;
        case VisemeShape.E: 
            openness = 0.5; 
            spread = 0.85; 
            squeeze = 1.15; 
            break;
        case VisemeShape.O: 
            openness = 0.8; 
            spread = -0.4; 
            squeeze = 0.7; 
            break;
        case VisemeShape.U: 
            openness = 0.35; 
            spread = -0.7; 
            squeeze = 0.5; 
            break;
        case VisemeShape.L: 
            openness = 0.55; 
            spread = 0.25; 
            squeeze = 1.0;
            break;
        case VisemeShape.FV: 
            openness = 0.25; 
            spread = 0.15; 
            squeeze = 1.05; 
            break;
        case VisemeShape.MBP: 
            openness = 0.05; 
            spread = 0.2;
            squeeze = 1.2; 
            break;
        case VisemeShape.CONS: 
            openness = 0.2; 
            spread = 0.65; 
            squeeze = 1.05;
            break;
        default: // REST
            openness = 0;
            spread = 0;
            squeeze = 1;
    }
    
    return {
        openness: openness * i,
        spread: spread * i,
        squeeze: 1 + (squeeze - 1) * i
    };
};

export const calculateZeroCrossingRate = (timeDomainData: Uint8Array): number => {
    let zeroCrossings = 0;
    const len = timeDomainData.length;
    for (let i = 1; i < len; i++) {
        const current = timeDomainData[i] - 128;
        const prev = timeDomainData[i - 1] - 128;
        if ((current >= 0 && prev < 0) || (current < 0 && prev >= 0)) {
            zeroCrossings++;
        }
    }
    return zeroCrossings / len;
};

export const calculateMouthPhysicsParams = getPhysicsForShape;
export const calculateOrganicIntensity = (n: number) => Math.pow(n, 1.2);

export const calculateSpectralCentroid = (frequencyData: Uint8Array, sampleRate: number, fftSize: number): number => {
    let numerator = 0;
    let denominator = 0;
    const binSize = sampleRate / fftSize;
    for (let i = 0; i < frequencyData.length; i++) {
        numerator += i * frequencyData[i];
        denominator += frequencyData[i];
    }
    if (denominator === 0) return 0;
    return (numerator / denominator) * binSize;
};

export const calculateBandEnergy = (frequencyData: Uint8Array, sampleRate: number, fftSize: number, minHz: number, maxHz: number): number => {
    const binSize = sampleRate / fftSize;
    const startBin = Math.floor(minHz / binSize);
    const endBin = Math.min(Math.floor(maxHz / binSize), frequencyData.length);
    let sum = 0;
    for (let i = startBin; i < endBin; i++) { sum += frequencyData[i]; }
    return sum / (endBin - startBin || 1);
};

export const calculateSpectralEnvelope = (frequencyData: Uint8Array, windowSize: number): Float32Array => {
    const envelope = new Float32Array(frequencyData.length);
    for(let i = 0; i < frequencyData.length; i++) {
        let max = 0;
        for(let j = Math.max(0, i - windowSize); j <= Math.min(frequencyData.length - 1, i + windowSize); j++) {
            if(frequencyData[j] > max) max = frequencyData[j];
        }
        envelope[i] = max;
    }
    return envelope;
};

export const findFormant = (envelope: Float32Array, binSize: number, minHz: number, maxHz: number): { freq: number, amp: number } => {
    const startBin = Math.floor(minHz / binSize);
    const endBin = Math.min(Math.floor(maxHz / binSize), envelope.length);
    let maxAmp = 0;
    let maxFreq = 0;
    for (let i = startBin; i < endBin; i++) {
        if (envelope[i] > maxAmp) {
            maxAmp = envelope[i];
            maxFreq = i * binSize;
        }
    }
    return { freq: maxFreq, amp: maxAmp };
};
