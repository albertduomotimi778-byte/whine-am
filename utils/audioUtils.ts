
import { VisemeShape } from '../types';
import { 
    calculateMultiBandEnergies,
    determineVisemeFromSpectrum,
    calculateZeroCrossingRate,
    getPhysicsForShape
} from './audioAnalysisHelpers';

// --- SMOOTHING & DEBOUNCE STATE ---
// Retained across calls to prevent jitter and strobing
let prevIntensity = 0;
let currentStableShape: VisemeShape = VisemeShape.REST;
let pendingShape: VisemeShape = VisemeShape.REST;
let holdCounter = 0;

// Moving history of multiband energies to track background noise floor in real-time
let realTimeHistory: { low: number, mid: number, high: number }[] = [];

const DEBOUNCE_FRAMES = 2; // Approx 30ms at 60fps to prevent strobe

/**
 * Resets the internal state of the audio analyzer.
 * Call this when starting playback or seeking to ensure clean transients.
 */
export const resetAnalysis = () => {
    prevIntensity = 0;
    currentStableShape = VisemeShape.REST;
    pendingShape = VisemeShape.REST;
    holdCounter = 0;
    realTimeHistory = [];
};

export const analyzeViseme = (
    frequencyData: Uint8Array, 
    timeDomainData: Uint8Array, 
    sampleRate: number, 
    fftSize: number
): { shape: VisemeShape, intensity: number, openness: number, spread: number, squeeze: number, spectralFlux: number, plosiveScore: number } => {
    
    // 1. EXTRACT SPECTRAL FEATURES
    const { low, mid, high } = calculateMultiBandEnergies(frequencyData, sampleRate, fftSize);
    
    // Track sliding history of energies to estimate continuous backing music/noise backgrounds
    realTimeHistory.push({ low, mid, high });
    if (realTimeHistory.length > 50) realTimeHistory.shift();

    // Estimate the noise floor as the minimum energy observed in the sliding window.
    let lowNoiseFloor = 999;
    let midNoiseFloor = 999;
    let highNoiseFloor = 999;
    for (let h = 0; h < realTimeHistory.length; h++) {
        if (realTimeHistory[h].low < lowNoiseFloor) lowNoiseFloor = realTimeHistory[h].low;
        if (realTimeHistory[h].mid < midNoiseFloor) midNoiseFloor = realTimeHistory[h].mid;
        if (realTimeHistory[h].high < highNoiseFloor) highNoiseFloor = realTimeHistory[h].high;
    }

    if (realTimeHistory.length < 15) {
        lowNoiseFloor = 0; midNoiseFloor = 0; highNoiseFloor = 0;
    }

    // Perform adaptive spectral subtraction to aggressively suppress background tracks
    // When backing music or steady noise is louder, raise subtraction threshold to 0.95 to clean vocal transients
    const subtractionCoeff = midNoiseFloor > 12 ? 0.95 : 0.88;
    const dLow = Math.max(0, low - lowNoiseFloor * subtractionCoeff);
    const dMid = Math.max(0, mid - midNoiseFloor * subtractionCoeff);
    const dHigh = Math.max(0, high - highNoiseFloor * subtractionCoeff);

    // Calculate Total Energy (0-255)
    let sum = 0;
    for (let i = 0; i < frequencyData.length; i++) sum += frequencyData[i];
    const totalEnergy = sum / frequencyData.length;
    
    // Vocal speech is primarily packed into mid frequencies (250Hz - 4kHz).
    // Focus weight primarily on dMid to keep vocals isolated from high treble/drums & low subbass.
    const filteredTotalEnergy = dMid * 0.72 + dLow * 0.16 + dHigh * 0.12;

    // Calculate Zero Crossing Rate
    const zcr = calculateZeroCrossingRate(timeDomainData);

    // 2. DETERMINE RAW TARGET SHAPE (Instantaneous)
    const instantShape = determineVisemeFromSpectrum(dLow, dMid, dHigh, zcr, filteredTotalEnergy);

    // 3. DEBOUNCING LOGIC (Anti-Strobe)
    // Only switch if the new shape persists for DEBOUNCE_FRAMES
    
    // Silence Gate (Override debounce for immediate closing)
    if (filteredTotalEnergy < 4.5) {
        currentStableShape = VisemeShape.REST;
        holdCounter = 0;
        pendingShape = VisemeShape.REST;
    } else {
        if (instantShape === currentStableShape) {
            // New matches current, stable state continues
            holdCounter = 0;
            pendingShape = instantShape;
        } else {
            // New shape detected
            if (instantShape === pendingShape) {
                // If it matches pending, increment counter
                holdCounter++;
                if (holdCounter >= DEBOUNCE_FRAMES) {
                    currentStableShape = instantShape;
                    holdCounter = 0;
                }
            } else {
                // New distinct candidate
                pendingShape = instantShape;
                holdCounter = 1;
            }
        }
    }

    // 4. APPLY SMOOTHING (2-Frame Rolling Average for Physics Intensity)
    const smoothIntensity = (filteredTotalEnergy + prevIntensity) / 2;
    prevIntensity = filteredTotalEnergy;

    // 5. MAP TO PHYSICS (Using Stabilized Shape)
    const { openness, spread, squeeze } = getPhysicsForShape(currentStableShape, smoothIntensity);

    // 6. PLOSIVE DETECTION (Flux)
    const flux = Math.max(0, totalEnergy - prevIntensity);

    return { 
        shape: currentStableShape, 
        intensity: smoothIntensity / 255, // Normalize 0-1 for UI consumption
        openness, 
        spread,
        squeeze,
        spectralFlux: flux,
        plosiveScore: flux
    };
};

export const audioBufferToWavBase64 = async (buffer: AudioBuffer): Promise<string> => {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const format = 1; // PCM
    const bitDepth = 16;
    
    const bytesPerSample = bitDepth / 8;
    const blockAlign = numChannels * bytesPerSample;
    
    const wavBytes = buffer.length * blockAlign;
    const bufferBuf = new ArrayBuffer(44 + wavBytes);
    const view = new DataView(bufferBuf);
    
    const writeString = (view: DataView, offset: number, string: string) => {
        for (let i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
        }
    };
    
    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + wavBytes, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, format, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitDepth, true);
    writeString(view, 36, 'data');
    view.setUint32(40, wavBytes, true);
    
    const channels = [];
    for (let i = 0; i < numChannels; i++) {
        channels.push(buffer.getChannelData(i));
    }
    
    let offset = 44;
    for (let i = 0; i < buffer.length; i++) {
        if (i > 0 && i % 44100 === 0) {
            // Yield every 1 second of audio to prevent UI blocks
            await new Promise(resolve => setTimeout(resolve, 0));
        }
        for (let channel = 0; channel < numChannels; channel++) {
            let sample = channels[channel][i];
            sample = Math.max(-1, Math.min(1, sample));
            sample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
            view.setInt16(offset, sample, true);
            offset += 2;
        }
    }
    
    const blob = new Blob([bufferBuf], { type: 'audio/wav' });
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
};

export const base64ToAudioBuffer = async (ctx: AudioContext, base64: string): Promise<AudioBuffer> => {
    const response = await fetch(base64);
    const arrayBuffer = await response.arrayBuffer();
    return await ctx.decodeAudioData(arrayBuffer);
};
