
import { LipSyncKeyframe, VisemeShape } from '../types';
import { calculateMultiBandEnergies, determineVisemeFromSpectrum, calculateZeroCrossingRate } from './audioAnalysisHelpers';

// --- CONFIGURATION ---
const TARGET_FPS = 60;
const FFT_SIZE = 2048; // High resolution frequency analysis
const MIN_DECIBELS = -100;
const MAX_DECIBELS = -30;

// --- FFT IMPLEMENTATION (Cooley-Tukey) ---
// Performs a Radix-2 FFT on real-valued input.
// Returns the magnitude spectrum.
const fftMag = (input: Float32Array): Float32Array => {
    const n = input.length;
    const bits = Math.log2(n);
    
    // 1. Bit-reversal permutation
    const real = new Float32Array(input);
    const imag = new Float32Array(n);
    
    for (let i = 0; i < n; i++) {
        let rev = 0;
        let num = i;
        for (let j = 0; j < bits; j++) {
            rev = (rev << 1) | (num & 1);
            num >>>= 1;
        }
        if (rev > i) {
            const tr = real[i]; real[i] = real[rev]; real[rev] = tr;
            const ti = imag[i]; imag[i] = imag[rev]; imag[rev] = ti;
        }
    }

    // 2. Butterfly operations
    for (let s = 1; s <= bits; s++) {
        const m = 1 << s;
        const m2 = m >> 1;
        // W_m = e^(-2*pi*i / m)
        const wmR = Math.cos(Math.PI / m2 * -1); 
        const wmI = Math.sin(Math.PI / m2 * -1);
        
        for (let k = 0; k < n; k += m) {
            let wR = 1;
            let wI = 0;
            for (let j = 0; j < m2; j++) {
                const tR = wR * real[k + j + m2] - wI * imag[k + j + m2];
                const tI = wR * imag[k + j + m2] + wI * real[k + j + m2];
                const uR = real[k + j];
                const uI = imag[k + j];
                
                real[k + j] = uR + tR;
                imag[k + j] = uI + tI;
                real[k + j + m2] = uR - tR;
                imag[k + j + m2] = uI - tI;
                
                // Rotate factor
                const tempR = wR;
                wR = wR * wmR - wI * wmI;
                wI = tempR * wmI + wI * wmR;
            }
        }
    }

    // 3. Compute Magnitudes
    const output = new Float32Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
        output[i] = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]);
    }
    return output;
};

// Hanning Window to reduce spectral leakage
const applyWindow = (buffer: Float32Array) => {
    const n = buffer.length;
    for (let i = 0; i < n; i++) {
        buffer[i] *= 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
    }
};

/**
 * Professional FFT Auto LipSync Processor
 * Replicates the Real-Time Audio Engine logic exactly by performing
 * windowed spectral analysis on the entire buffer.
 */
export const processLipSync = async (
    audioBuffer: AudioBuffer,
    onProgress: (percent: number) => void
): Promise<LipSyncKeyframe[]> => {
    
    const data = audioBuffer.getChannelData(0);
    const sampleRate = audioBuffer.sampleRate;
    
    // Step forward in time at 60fps increments
    const hopSize = Math.floor(sampleRate / TARGET_FPS);
    const totalFrames = Math.floor((data.length - FFT_SIZE) / hopSize);
    
    const keyframes: LipSyncKeyframe[] = [];
    
    // State Tracking (Matches useAudioEngine hooks)
    let prevIntensity = 0;
    let currentStableShape: VisemeShape = VisemeShape.REST;
    let pendingShape: VisemeShape = VisemeShape.REST;
    let holdCounter = 0;
    const DEBOUNCE_FRAMES = 2; // Anti-jitter threshold

    const windowBuffer = new Float32Array(FFT_SIZE);
    const historyList: { low: number, mid: number, high: number }[] = [];
    
    // Process loop
    for (let i = 0; i < totalFrames; i++) {
        const offset = i * hopSize;
        
        // 1. Fill Window
        for (let j = 0; j < FFT_SIZE; j++) {
            if (offset + j < data.length) {
                windowBuffer[j] = data[offset + j];
            } else {
                windowBuffer[j] = 0;
            }
        }

        // 2. Time Domain Features (ZCR)
        // Convert to Byte range 0-255 to match helper expectations
        const byteTimeDomain = new Uint8Array(FFT_SIZE);
        for(let j=0; j<FFT_SIZE; j++) {
            // Map -1..1 to 0..255
            byteTimeDomain[j] = Math.min(255, Math.max(0, (windowBuffer[j] + 1) * 127.5));
        }
        const zcr = calculateZeroCrossingRate(byteTimeDomain);

        // 3. Frequency Domain Features (FFT)
        applyWindow(windowBuffer);
        const magnitudes = fftMag(windowBuffer);
        
        // Convert to Byte Frequency Data (dB scale)
        // This mimics AnalyserNode.getByteFrequencyData
        const byteFreqData = new Uint8Array(magnitudes.length);
        let freqSum = 0;
        
        for(let j=0; j<magnitudes.length; j++) {
            // Approx scaling factor to match Web Audio API levels
            const val = magnitudes[j] / FFT_SIZE * 4.0;
            
            let db = 20 * Math.log10(val || 1e-10);
            if (!isFinite(db)) db = MIN_DECIBELS;
            
            const scaled = Math.max(0, Math.min(255, (db - MIN_DECIBELS) / (MAX_DECIBELS - MIN_DECIBELS) * 255));
            byteFreqData[j] = scaled;
            freqSum += scaled;
        }
        
        const totalEnergy = freqSum / byteFreqData.length;

        // 4. Classification (Using shared logic)
        const { low, mid, high } = calculateMultiBandEnergies(byteFreqData, sampleRate, FFT_SIZE);
        
        // Track the sliding history of energies to estimate active music/noise background floor
        historyList.push({ low, mid, high });
        if (historyList.length > 50) historyList.shift();
        
        // Estimate the noise floor as the minimum energy observed in the sliding window.
        // During continuous music or noise, their energies are steady, so the minimum
        // energy across the window isolates this continuous background.
        let lowNoiseFloor = 999;
        let midNoiseFloor = 999;
        let highNoiseFloor = 999;
        for (let h = 0; h < historyList.length; h++) {
            if (historyList[h].low < lowNoiseFloor) lowNoiseFloor = historyList[h].low;
            if (historyList[h].mid < midNoiseFloor) midNoiseFloor = historyList[h].mid;
            if (historyList[h].high < highNoiseFloor) highNoiseFloor = historyList[h].high;
        }
        
        if (historyList.length < 15) {
            lowNoiseFloor = 0; midNoiseFloor = 0; highNoiseFloor = 0;
        }
        
        // Use adaptive spectral subtraction to isolate the dynamic voice and suppress background music
        // When backing music or steady noise is louder, raise subtraction threshold to 0.95 to clean vocal transients
        const subtractionCoeff = midNoiseFloor > 12 ? 0.95 : 0.88;
        const dLow = Math.max(0, low - lowNoiseFloor * subtractionCoeff);
        const dMid = Math.max(0, mid - midNoiseFloor * subtractionCoeff);
        const dHigh = Math.max(0, high - highNoiseFloor * subtractionCoeff);
        
        // Vocal speech is primarily packed into mid frequencies (250Hz - 4kHz).
        // Focus weight primarily on dMid to keep vocals isolated from high treble/drums & low subbass.
        const filteredTotalEnergy = dMid * 0.72 + dLow * 0.16 + dHigh * 0.12;
        const instantShape = determineVisemeFromSpectrum(dLow, dMid, dHigh, zcr, filteredTotalEnergy);

        // 5. Debounce & Stability Logic
        // This effectively ignores spurious 1-frame glitches unless they persist
        let effectiveShape = currentStableShape;
        
        // Silence Gate based on filtered voice energy
        if (filteredTotalEnergy < 4.5) {
            currentStableShape = VisemeShape.REST;
            holdCounter = 0;
            pendingShape = VisemeShape.REST;
            effectiveShape = VisemeShape.REST;
        } else {
            if (instantShape === currentStableShape) {
                holdCounter = 0;
                pendingShape = instantShape;
            } else {
                if (instantShape === pendingShape) {
                    holdCounter++;
                    if (holdCounter >= DEBOUNCE_FRAMES) {
                        currentStableShape = instantShape;
                        holdCounter = 0;
                    }
                } else {
                    pendingShape = instantShape;
                    holdCounter = 1;
                }
            }
            effectiveShape = currentStableShape;
        }

        // 6. Smoothing & Intensity Mapping
        // Simple rolling average matching real-time engine
        const smoothIntensity = (filteredTotalEnergy + prevIntensity) * 0.5;
        prevIntensity = filteredTotalEnergy;
        
        // Intensity normalization matching audioUtils.ts exactly (0..1)
        const normalizedIntensity = smoothIntensity / 255;

        // 7. Keyframe Generation
        const time = i / TARGET_FPS;
        
        // Optimization: Only record if there is activity or a transition to rest
        const isAudible = normalizedIntensity > 0.01;
        const isTransitionToRest = effectiveShape === VisemeShape.REST && keyframes.length > 0 && keyframes[keyframes.length-1].shape !== VisemeShape.REST;

        if (isAudible || isTransitionToRest) {
             keyframes.push({
                id: `ls_auto_${i}_${Date.now()}`,
                time: time,
                shape: effectiveShape,
                intensity: isAudible ? normalizedIntensity : 0,
                isManual: false
            });
        }

        // 8. Async Yield (Prevent UI Freeze)
        // Every ~150 frames, break the loop to let the browser render
        if (i % 150 === 0) {
            onProgress((i / totalFrames) * 100);
            await new Promise(r => setTimeout(r, 0));
        }
    }
    
    onProgress(100);
    return keyframes;
};
