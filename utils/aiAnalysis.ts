
import { VisemeShape } from '../types';
import { 
    calculateSpectralEnvelope,
    calculateSpectralCentroid,
    findFormant,
    calculateOrganicIntensity
} from './audioAnalysisHelpers';

export const analyzeVisemeAI = (frequencyData: Uint8Array, sampleRate: number, windowSize: number): { shape: VisemeShape, intensity: number, confidence: number } => {
    const binSize = sampleRate / windowSize;
    
    // 1. Calculate Core Features
    let totalEnergy = 0;
    for(let i=0; i<frequencyData.length; i++) totalEnergy += frequencyData[i];
    const avgEnergy = totalEnergy / frequencyData.length;
    const normalizedEnergy = avgEnergy / 255;
    
    const intensity = calculateOrganicIntensity(normalizedEnergy);
    
    // Silence Gate
    if (intensity < 0.05) return { shape: VisemeShape.REST, intensity: 0, confidence: 1.0 };

    const centroid = calculateSpectralCentroid(frequencyData, sampleRate, windowSize);
    const envelope = calculateSpectralEnvelope(frequencyData, 5); // Tighter envelope for better peak tracking
    
    // Detect Formants (Vowel Quadrants)
    // Ranges adjusted for general vocal characteristics
    const f1 = findFormant(envelope, binSize, 250, 950).freq; 
    const f2 = findFormant(envelope, binSize, 950, 3000).freq;
    
    // --- DECISION TREE ---

    // 1. Strong Vowels (Energy Driven)
    
    // "AI" / "Ah" (Open Back) -> High F1
    if (f1 > 700) {
        return { shape: VisemeShape.AI, intensity, confidence: 0.95 };
    }

    // "E" / "Ee" (Close Front) -> Low F1, High F2
    if (f1 < 500 && f2 > 1900) {
        return { shape: VisemeShape.E, intensity, confidence: 0.9 };
    }

    // "O" / "Oh" (Mid Back) -> Mid F1, Low F2
    if (f1 > 400 && f1 < 700 && f2 < 1200) {
        return { shape: VisemeShape.O, intensity, confidence: 0.9 };
    }

    // "U" / "Oo" (Close Back) -> Low F1, Low F2
    if (f1 < 400 && f2 < 1000) {
        return { shape: VisemeShape.U, intensity, confidence: 0.9 };
    }

    // 2. Consonants (Spectral Balance Driven)

    // Sibilants (S, T, Ch) -> Very High Centroid
    if (centroid > 4000) {
        // Suppress intensity for S sounds as jaw doesn't open much
        return { shape: VisemeShape.CONS, intensity: intensity * 0.6, confidence: 0.8 }; 
    }

    // Fricatives (F, V) -> High Centroid but lower than S
    if (centroid > 2200 && centroid < 4000) {
        return { shape: VisemeShape.FV, intensity: intensity * 0.8, confidence: 0.8 };
    }

    // Bilabials (M, B, P) -> Burst energy, low centroid
    if (f1 < 300 && centroid < 1500 && intensity > 0.2) {
        return { shape: VisemeShape.MBP, intensity: intensity * 0.7, confidence: 0.8 }; 
    }

    // Dental/Lateral (L, Th)
    if (f2 > 1200 && f2 < 1800) {
        return { shape: VisemeShape.L, intensity: intensity * 0.9, confidence: 0.7 };
    }

    // Default Fallback
    // If high intensity but no specific formant match, default to generic open
    if (intensity > 0.3) return { shape: VisemeShape.AI, intensity, confidence: 0.5 };
    
    return { shape: VisemeShape.REST, intensity: 0, confidence: 0.5 };
};
