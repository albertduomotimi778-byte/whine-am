
import React, { useEffect, useState } from 'react';
import { useLanguage } from '../utils/LanguageContext';
import { Mic, CheckCircle, X } from 'lucide-react';
import { processLipSync } from '../utils/LipSyncProcessor';
import { LipSyncKeyframe } from '../types';

interface LipSyncGeneratorModalProps {
    isOpen: boolean;
    onClose: () => void;
    audioBuffer: AudioBuffer | null;
    audioSpeed?: number;
    onComplete: (keyframes: LipSyncKeyframe[]) => void;
    selectedCharacterId?: string | 'ALL';
}

export const LipSyncGeneratorModal: React.FC<LipSyncGeneratorModalProps> = ({ isOpen, onClose, audioBuffer, audioSpeed = 1.0, onComplete, selectedCharacterId }) => {
  const { t } = useLanguage();

    const [progress, setProgress] = useState(0);
    const [status, setStatus] = useState<'IDLE' | 'PROCESSING' | 'DONE'>('IDLE');

    useEffect(() => {
        if (isOpen && audioBuffer && status === 'IDLE') {
            startProcessing();
        }
    }, [isOpen, audioBuffer]);

    const startProcessing = async () => {
        if (!audioBuffer) return;
        setStatus('PROCESSING');
        
        // Give UI a moment to render the modal before blocking thread
        setTimeout(async () => {
            const keys = await processLipSync(audioBuffer, (p) => setProgress(p));
            setTimeout(() => {
                setStatus('DONE');
                setTimeout(() => {
                    // Tag keyframes with targetId if provided and not 'ALL'
                    const taggedKeys = keys.map(k => ({
                        ...k,
                        time: k.time / audioSpeed,
                        duration: k.duration / audioSpeed,
                        targetId: selectedCharacterId !== 'ALL' ? selectedCharacterId : undefined
                    }));
                    onComplete(taggedKeys);
                    cleanup();
                }, 500); // Show "Done" briefly
            }, 200);
        }, 300);
    };

    const cleanup = () => {
        onClose();
        setTimeout(() => {
            setStatus('IDLE');
            setProgress(0);
        }, 300);
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[999] bg-black/80  flex items-center justify-center animate-in fade-in duration-200">
            <div className="w-full max-w-md bg-[#0a0a0a] border border-white/10 rounded-2xl shadow-2xl overflow-hidden relative">
                {/* Decorative Background */}
                <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/5 via-transparent to-transparent pointer-events-none"/>
                
                <div className="p-8 flex flex-col items-center text-center relative z-10">
                    <div className="w-16 h-16 rounded-full bg-[#111] border border-cyan-500/20 flex items-center justify-center mb-6 shadow-[0_0_30px_rgba(6,182,212,0.1)]">
                        {status === 'DONE' ? (
                            <CheckCircle size={32} className="text-green-400 animate-in zoom-in spin-in-12 duration-300"/>
                        ) : (
                            <Mic size={32} className={`text-cyan-500 ${status === 'PROCESSING' ? 'animate-pulse' : ''}`}/>
                        )}
                    </div>

                    <h3 className="text-xl font-bold text-white mb-2 tracking-tight">{t('Auto-LipSync Engine')}</h3>
                    <p className="text-xs text-gray-500 font-mono mb-8 uppercase tracking-widest">
                        {status === 'PROCESSING' ? 'Analyzing Phonemes...' : (status === 'DONE' ? 'Analysis Complete' : 'Initializing...')}
                    </p>

                    {/* Progress Bar */}
                    <div className="w-full h-1 bg-[#151515] rounded-full overflow-hidden mb-2">
                        <div 
                            className="h-full bg-cyan-500 shadow-[0_0_10px_cyan] transition-all duration-100 ease-linear"
                            style={{ width: `${progress}%` }}
                        />
                    </div>
                    <div className="w-full flex justify-between text-[9px] text-gray-600 font-bold font-mono">
                        <span>0%</span>
                        <span>{Math.round(progress)}%</span>
                        <span>100%</span>
                    </div>
                </div>

                <button onClick={cleanup} className="absolute top-4 right-4 text-gray-600 hover:text-white transition-colors">
                    <X size={16}/>
                </button>
            </div>
        </div>
    );
};
