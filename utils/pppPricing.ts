
interface PPPFactor {
    factor: number;
    currencySymbol: string; // Only used for internal calc if we needed, but we keep UI as NGN
}

const PPP_FACTORS: Record<string, number> = {
    'NG': 1.0,    // Nigeria (Base)
    'US': 60.0,   // USA (e.g. 100 NGN -> 6,000 NGN approx $4.50)
    'GB': 55.0,   // UK
    'CA': 50.0,   // Canada
    'AU': 52.0,   // Australia
    'DE': 48.0,   // Germany
    'FR': 48.0,   // France
    'ZA': 5.0,    // South Africa
    'GH': 1.2,    // Ghana
    'IN': 3.0,    // India
    'BR': 8.0,    // Brazil
};

const DEFAULT_HIGH_ECONOMY_FACTOR = 40.0;

export async function detectUserCountry(): Promise<string> {
    try {
        const response = await fetch('https://ipapi.co/json/');
        const data = await response.json();
        return data.country_code || 'NG';
    } catch (e) {
        console.warn("PPP: Failed to detect country, defaulting to Nigeria", e);
        return 'NG';
    }
}

export function getScaledPrice(basePriceNgn: number, countryCode: string): number {
    const factor = PPP_FACTORS[countryCode] || (countryCode === 'NG' ? 1.0 : DEFAULT_HIGH_ECONOMY_FACTOR);
    
    // We want to ensure it's still a "neat" number
    const scaled = basePriceNgn * factor;
    
    // Round to nearest 50 for clean look in NGN
    return Math.round(scaled / 50) * 50;
}
