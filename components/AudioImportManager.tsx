
import { showAppToast } from '../utils/toastHelper';
import React, { useState, useRef } from 'react';
import { useLanguage } from '../utils/LanguageContext';
import { X, Upload, Film, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface AudioImportManagerProps {
    onClose: () => void;
    onLoad: (file: File) => void;
}

export const AudioImportManager: React.FC<AudioImportManagerProps> = ({ onClose, onLoad }) => {
    const { t } = useLanguage();
    const [mode, setMode] = useState<'PICKER' | 'EXTRACTING'>('PICKER');
    const [isProcessing, setIsProcessing] = useState(false);
    const [progress, setProgress] = useState(0);

    const videoInputRef = useRef<HTMLInputElement>(null);
    const audioInputRef = useRef<HTMLInputElement>(null);

    // --- EXTRACTION LOGIC ---
    const handleVideoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setMode('EXTRACTING');
        setIsProcessing(true);
        setProgress(10);

        try {
            const arrayBuffer = await file.arrayBuffer();
            setProgress(30);

            const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
            const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
            setProgress(70);

            const wavBlob = audioBufferToWav(audioBuffer);
            const extractedFile = new File([wavBlob], `extracted_${file.name.split('.')[0]}.wav`, { type: 'audio/wav' });
            
            setProgress(100);
            onLoad(extractedFile);
            onClose();

        } catch (err) {
            console.error("Extraction error:", err);
            showAppToast(t("Failed to extract audio."));
            setMode('PICKER');
            setIsProcessing(false);
        }
    };

    // Helper: AudioBuffer to WAV
    const audioBufferToWav = (buffer: AudioBuffer) => {
        const numOfChan = buffer.numberOfChannels,
            length = buffer.length * numOfChan * 2 + 44,
            bufferArray = new ArrayBuffer(length),
            view = new DataView(bufferArray),
            channels = [],
            sampleRate = buffer.sampleRate;
        let pos = 0;

        const setUint16 = (data: number) => { view.setUint16(pos, data, true); pos += 2; };
        const setUint32 = (data: number) => { view.setUint32(pos, data, true); pos += 4; };

        setUint32(0x46464952); // "RIFF"
        setUint32(length - 8); // file length - 8
        setUint32(0x45564157); // "WAVE"
        setUint32(0x20746d66); // "fmt " chunk
        setUint32(16); // length = 16
        setUint16(1); // PCM (uncompressed)
        setUint16(numOfChan);
        setUint32(sampleRate);
        setUint32(sampleRate * 2 * numOfChan); // avg. bytes/sec
        setUint16(numOfChan * 2); // block-align
        setUint16(16); // 16nd-bit
        setUint32(0x61746164); // "data" - chunk
        setUint32(length - pos - 4); // chunk length

        for (let i = 0; i < buffer.numberOfChannels; i++) {
            channels.push(buffer.getChannelData(i));
        }

        let offset = 0;
        while (pos < length) {
            for (let i = 0; i < numOfChan; i++) {           
                let sample = Math.max(-1, Math.min(1, channels[i][offset]));
                sample = (sample < 0 ? sample * 0x8000 : sample * 0x7FFF);
                view.setInt16(pos, sample, true);
                pos += 2;
            }
            offset++;
        }

        return new Blob([bufferArray], { type: 'audio/wav' });
    };

    const formatTime = (s: number) => {
        const mins = Math.floor(s / 60);
        const secs = s % 60;
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    return (
        <div className="fixed inset-0 z-[1000] bg-black/80 flex items-center justify-center p-4 backdrop-blur-md">
            <motion.div 
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="bg-[#0b0b0b] border border-white/10 rounded-xl w-full max-w-sm max-h-[90vh] overflow-y-auto custom-scrollbar shadow-2xl flex flex-col"
            >
                {/* Header */}
                <div className="px-4 py-3 border-b border-white/5 flex justify-between items-center bg-[#111]">
                    <h2 className="font-bold text-white text-sm tracking-tight">{t('Audio Studio')}</h2>
                    <button onClick={onClose} className="p-1 hover:bg-white/10 rounded-full transition-colors text-gray-500 hover:text-white">
                        <X size={16} />
                    </button>
                </div>

                <div className="p-4">
                    <AnimatePresence mode="wait">
                        {mode === 'PICKER' && (
                            <motion.div 
                                key="picker"
                                initial={{ opacity: 0, scale: 0.95 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 1.05 }}
                                className="space-y-2"
                            >
                                <button 
                                    onClick={() => videoInputRef.current?.click()}
                                    className="w-full flex items-center gap-4 p-3 bg-[#151515] hover:bg-[#202020] border border-white/5 rounded-lg transition-all text-left"
                                >
                                    <div className="w-10 h-10 rounded-full bg-blue-950/30 flex items-center justify-center text-blue-500">
                                        <Film size={18} />
                                    </div>
                                    <div>
                                        <h3 className="text-sm font-bold text-white">{t('Extract from Video')}</h3>
                                        <p className="text-[10px] text-gray-500">{t('Auto-convert video audio')}</p>
                                    </div>
                                    <input ref={videoInputRef} type="file" className="hidden" accept="video/*" onChange={handleVideoSelect} />
                                </button>
                                <button 
                                    onClick={() => audioInputRef.current?.click()}
                                    className="w-full flex items-center gap-4 p-3 bg-[#151515] hover:bg-[#202020] border border-white/5 rounded-lg transition-all text-left"
                                >
                                    <div className="w-10 h-10 rounded-full bg-neutral-900/30 flex items-center justify-center text-neutral-400">
                                        <Upload size={18} />
                                    </div>
                                    <div>
                                        <h3 className="text-sm font-bold text-white">{t('Import File')}</h3>
                                        <p className="text-[10px] text-gray-500">{t('Load existing audio')}</p>
                                    </div>
                                    <input ref={audioInputRef} type="file" className="hidden" accept="audio/*" onChange={(e) => {
                                        if (e.target.files?.[0]) { onLoad(e.target.files[0]); onClose(); }
                                    }} />
                                </button>
                            </motion.div>
                        )}

                        {mode === 'EXTRACTING' && (
                            <motion.div 
                                key="extracting"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                className="flex flex-col items-center py-8"
                            >
                                <Loader2 size={32} className="text-blue-500 animate-spin mb-4" />
                                <h3 className="text-xs font-bold text-white uppercase">{t('Extracting Audio')}</h3>
                                <div className="w-32 h-1 bg-neutral-800 rounded-full mt-4 overflow-hidden">
                                    <motion.div className="h-full bg-blue-500" initial={{ width: 0 }} animate={{ width: `${progress}%` }} />
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </motion.div>
        </div>
    );
};
