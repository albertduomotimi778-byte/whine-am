import React, { useState, useEffect, useRef } from 'react';
import { useLanguage } from '../utils/LanguageContext';
import { X, Wand2, Loader2, Key } from 'lucide-react';
import { GoogleGenAI, Type } from '@google/genai';

interface AiGeneratorModalProps {
    onClose: () => void;
    onGenerate: (images: {url: string, width: number, height: number, guessedPart?: string}[]) => void;
}

const sliceSpriteSheet = async (imageUrl: string): Promise<{url: string, width: number, height: number}[]> => {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "Anonymous";
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            if (!ctx) return reject('No context');
            canvas.width = img.width;
            canvas.height = img.height;
            ctx.drawImage(img, 0, 0);
            
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const data = imageData.data;
            const width = canvas.width;
            const height = canvas.height;
            
            // 1. Flood fill from edges to make background transparent
            // Sample background color from the top-left corner
            const bgR = data[0];
            const bgG = data[1];
            const bgB = data[2];
            
            const colorDistance = (r1: number, g1: number, b1: number, r2: number, g2: number, b2: number) => {
                return Math.sqrt(Math.pow(r1 - r2, 2) + Math.pow(g1 - g2, 2) + Math.pow(b1 - b2, 2));
            };

            const isBackground = (r: number, g: number, b: number) => {
                // Check if it's close to the sampled background color OR close to white
                return colorDistance(r, g, b, bgR, bgG, bgB) < 30 || (r > 240 && g > 240 && b > 240);
            };
            
            const bgVisited = new Uint8Array(width * height);
            const bgQueueX = new Int32Array(width * height);
            const bgQueueY = new Int32Array(width * height);
            let bgHead = 0;
            let bgTail = 0;

            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    if (x === 0 || x === width - 1 || y === 0 || y === height - 1) {
                        const idx = (y * width + x) * 4;
                        if (isBackground(data[idx], data[idx+1], data[idx+2])) {
                            bgQueueX[bgTail] = x;
                            bgQueueY[bgTail] = y;
                            bgTail++;
                            bgVisited[y * width + x] = 1;
                            data[idx+3] = 0; // Make transparent
                        }
                    }
                }
            }

            while (bgHead < bgTail) {
                const cx = bgQueueX[bgHead];
                const cy = bgQueueY[bgHead];
                bgHead++;

                const neighbors = [[cx-1, cy], [cx+1, cy], [cx, cy-1], [cx, cy+1]];
                for (const [nx, ny] of neighbors) {
                    if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                        const nIdx = ny * width + nx;
                        if (bgVisited[nIdx] === 0) {
                            const pIdx = nIdx * 4;
                            if (isBackground(data[pIdx], data[pIdx+1], data[pIdx+2])) {
                                bgVisited[nIdx] = 1;
                                data[pIdx+3] = 0; // Make transparent
                                bgQueueX[bgTail] = nx;
                                bgQueueY[bgTail] = ny;
                                bgTail++;
                            }
                        }
                    }
                }
            }
            
            ctx.putImageData(imageData, 0, 0);

            // 2. Find connected components
            const visited = new Uint8Array(width * height);
            const regions: {minX: number, minY: number, maxX: number, maxY: number}[] = [];
            
            const getPixelAlpha = (x: number, y: number) => {
                if (x < 0 || x >= width || y < 0 || y >= height) return 0;
                return data[(y * width + x) * 4 + 3];
            };

            const queueX = new Int32Array(width * height);
            const queueY = new Int32Array(width * height);

            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const idx = y * width + x;
                    if (visited[idx] === 0) {
                        if (getPixelAlpha(x, y) > 0) {
                            let minX = x, maxX = x, minY = y, maxY = y;
                            
                            let head = 0;
                            let tail = 0;
                            
                            queueX[tail] = x;
                            queueY[tail] = y;
                            tail++;
                            visited[idx] = 1;
                            
                            while(head < tail) {
                                const cx = queueX[head];
                                const cy = queueY[head];
                                head++;
                                
                                if (cx < minX) minX = cx;
                                if (cx > maxX) maxX = cx;
                                if (cy < minY) minY = cy;
                                if (cy > maxY) maxY = cy;
                                
                                const neighbors = [[cx-1, cy], [cx+1, cy], [cx, cy-1], [cx, cy+1]];
                                for (const [nx, ny] of neighbors) {
                                    if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                                        const nIdx = ny * width + nx;
                                        if (visited[nIdx] === 0) {
                                            visited[nIdx] = 1;
                                            if (getPixelAlpha(nx, ny) > 0) {
                                                queueX[tail] = nx;
                                                queueY[tail] = ny;
                                                tail++;
                                            }
                                        }
                                    }
                                }
                            }
                            
                            if (maxX - minX > 15 && maxY - minY > 15) {
                                const pad = 4;
                                regions.push({
                                    minX: Math.max(0, minX - pad),
                                    minY: Math.max(0, minY - pad),
                                    maxX: Math.min(width, maxX + pad),
                                    maxY: Math.min(height, maxY + pad)
                                });
                            }
                        } else {
                            visited[idx] = 1;
                        }
                    }
                }
            }
            
            // 3. Extract regions
            const slicedParts: {url: string, width: number, height: number, base64Data: string}[] = [];
            regions.forEach(r => {
                const rWidth = r.maxX - r.minX;
                const rHeight = r.maxY - r.minY;
                const rCanvas = document.createElement('canvas');
                rCanvas.width = rWidth;
                rCanvas.height = rHeight;
                const rCtx = rCanvas.getContext('2d');
                if (rCtx) {
                    rCtx.putImageData(ctx.getImageData(r.minX, r.minY, rWidth, rHeight), 0, 0);
                    const dataUrl = rCanvas.toDataURL('image/png');
                    const base64Data = dataUrl.split(',')[1];
                    slicedParts.push({url: dataUrl, width: rWidth, height: rHeight, base64Data});
                }
            });
            
            resolve(slicedParts as any); // Type assertion, we'll handle classification later
        };
        img.onerror = reject;
        img.src = imageUrl;
    });
};

export const AiGeneratorModal: React.FC<AiGeneratorModalProps> = ({ onClose, onGenerate }) => {
  const { t } = useLanguage();

    const [prompt, setPrompt] = useState("A 2D game asset sprite sheet of a character's body parts arranged in a grid. The image must contain ONLY separated, disconnected body parts: a head, a torso, left arm, right arm, left leg, right leg, and 3 different mouth shapes (closed, open, wide). They must be spread out on a pure solid white background. DO NOT draw a full assembled character. Draw the parts disassembled. Clean digital art style, flat colors.");
    const [apiKey, setApiKey] = useState("");
    const [isGenerating, setIsGenerating] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const keyIndexRef = useRef(0);

    useEffect(() => {
        const envKey = (import.meta as any).env.VITE_FIREWORKS_API_KEY;
        const savedKey = localStorage.getItem('fireworks_api_key');
        if (envKey) {
            setApiKey(envKey);
        } else if (savedKey) {
            setApiKey(savedKey);
        }
    }, []);

    const handleGenerate = async () => {
        if (!navigator.onLine) {
            setError(t("You are offline. AI generation requires an internet connection."));
            return;
        }
        if (!apiKey) {
            setError("Please provide a Fireworks API Key.");
            return;
        }
        if (!prompt) {
            setError("Please provide a prompt.");
            return;
        }

        const keys = apiKey.split(',').map(k => k.trim()).filter(k => k.length > 0);
        if (keys.length === 0) {
            setError("No valid API keys found.");
            return;
        }

        setIsGenerating(true);
        setError(null);
        localStorage.setItem('fireworks_api_key', apiKey);

        const currentKey = keys[keyIndexRef.current % keys.length];
        keyIndexRef.current = (keyIndexRef.current + 1) % keys.length;

        try {
            const response = await fetch("https://api.fireworks.ai/inference/v1/image_generation/accounts/fireworks/models/playground-v2-5-1024px-aesthetic", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${currentKey}`,
                    "Content-Type": "application/json",
                    "Accept": "application/json"
                },
                body: JSON.stringify({
                    prompt: prompt,
                    negative_prompt: "full assembled body, complete character, standing character, multiple characters, connected parts, overlapping parts, background scene, text, watermark, shading, 3d, realistic",
                    aspect_ratio: "16:9"
                })
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData.error?.message || errData.message || `API Error: ${response.status}`);
            }

            const data = await response.json();
            
            let base64Image = null;
            if (Array.isArray(data) && data[0] && data[0].base64) {
                base64Image = `data:image/jpeg;base64,${data[0].base64}`;
            } else if (data.data && data.data[0] && data.data[0].b64_json) {
                base64Image = `data:image/jpeg;base64,${data.data[0].b64_json}`;
            }

            if (base64Image) {
                // Slice the generated sprite sheet into separate parts
                const slicedImages: any[] = await sliceSpriteSheet(base64Image);
                
                if (slicedImages.length === 0) {
                    // Fallback if slicing failed to find distinct parts
                    const img = new Image();
                    img.onload = () => {
                        onGenerate([{ url: base64Image, width: img.width, height: img.height, guessedPart: 'root' }]);
                    };
                    img.src = base64Image;
                } else {
                    // Classify the sliced images using Gemini
                    const classifiedImages = [];
                    const geminiKey = process.env.GEMINI_API_KEY;
                    
                    if (geminiKey) {
                        try {
                            const ai = new GoogleGenAI({ apiKey: geminiKey });
                            for (const slice of slicedImages) {
                                try {
                                    const geminiResponse = await ai.models.generateContent({
                                        model: "gemini-3-flash-preview",
                                        contents: {
                                            parts: [
                                                { inlineData: { mimeType: "image/png", data: slice.base64Data } },
                                                { text: "What body part is this? Choose exactly one from: head, body, leftArm, rightArm, leftLeg, rightLeg, mouthOpen, mouthClosed, mouthWide, other. Respond with just the word." }
                                            ]
                                        },
                                        config: {
                                            temperature: 0.1
                                        }
                                    });
                                    const classification = geminiResponse.text?.trim() || 'other';
                                    classifiedImages.push({
                                        url: slice.url,
                                        width: slice.width,
                                        height: slice.height,
                                        guessedPart: classification
                                    });
                                } catch (e) {
                                    console.error("Gemini classification failed for a slice", e);
                                    classifiedImages.push({ url: slice.url, width: slice.width, height: slice.height, guessedPart: 'other' });
                                }
                            }
                        } catch (e) {
                            console.error("Failed to initialize Gemini", e);
                            classifiedImages.push(...slicedImages.map(s => ({ url: s.url, width: s.width, height: s.height, guessedPart: 'other' })));
                        }
                    } else {
                        classifiedImages.push(...slicedImages.map(s => ({ url: s.url, width: s.width, height: s.height, guessedPart: 'other' })));
                    }

                    onGenerate(classifiedImages);
                }
            } else {
                throw new Error("Invalid response format from API.");
            }
        } catch (err: any) {
            console.error(err);
            setError(err.message || "Failed to generate character.");
            setIsGenerating(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[600] bg-black/80  flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="bg-[#151515] border border-white/10 rounded-2xl max-w-lg w-full p-6 shadow-2xl flex flex-col gap-4">
                <div className="flex justify-between items-center pb-4 border-b border-white/5">
                    <div className="flex items-center gap-2 text-cyan-500">
                        <Wand2 size={20} />
                        <h2 className="font-bold text-lg">{t('Generate Character with AI')}</h2>
                    </div>
                    <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">
                        <X size={20} />
                    </button>
                </div>

                <div className="space-y-4">
                    <div className="space-y-2">
                        <label className="text-xs font-bold text-gray-400 flex items-center gap-2">
                            <Key size={14} /> {t('FIREWORKS API KEY(S) (COMMA-SEPARATED)')}
                        </label>
                        <input 
                            type="password" 
                            value={apiKey} 
                            onChange={(e) => setApiKey(e.target.value)} 
                            placeholder={t('fw_..., fw_...')} 
                            className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg p-3 text-sm text-white focus:outline-none focus:border-cyan-500/50 transition-colors"
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="text-xs font-bold text-gray-400 flex items-center gap-2">
                            <Wand2 size={14} /> {t('PROMPT')}
                        </label>
                        <textarea 
                            value={prompt} 
                            onChange={(e) => setPrompt(e.target.value)} 
                            rows={4}
                            className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg p-3 text-sm text-white focus:outline-none focus:border-cyan-500/50 transition-colors resize-none"
                        />
                        <p className="text-[10px] text-gray-500 italic">
                            {t('Tip: Ask for a sprite sheet on a solid white background with separated parts for best results.')}
                        </p>
                    </div>

                    {error && (
                        <div className="bg-red-500/10 border border-red-500/20 text-red-500 text-xs p-3 rounded-lg">
                            {error}
                        </div>
                    )}
                </div>

                <div className="pt-4 border-t border-white/5 flex justify-end gap-3">
                    <button 
                        onClick={onClose} 
                        className="px-4 py-2 rounded-lg text-sm font-bold text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
                    >
                        {t('CANCEL')}
                    </button>
                    <button 
                        onClick={handleGenerate} 
                        disabled={isGenerating || !apiKey || !prompt}
                        className="px-6 py-2 rounded-lg text-sm font-bold bg-cyan-500 hover:bg-cyan-400 text-black transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                        {isGenerating ? (
                            <><Loader2 size={16} className="animate-spin" /> {t('GENERATING...')}</>
                        ) : (
                            <><Wand2 size={16} /> {t('GENERATE')}</>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
};
