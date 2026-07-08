import React, { useEffect, useState } from 'react';
import { useLanguage } from '../utils/LanguageContext';
import { motion, AnimatePresence } from 'motion/react';
import { Logo } from './Logo';

interface PremiumSplashProps {
  onComplete: () => void;
}

export const PremiumSplash: React.FC<PremiumSplashProps> = ({ onComplete }) => {
  const { t } = useLanguage();

  const [stage, setStage] = useState(0);

  useEffect(() => {
    // Stage sequence
    // 0: Initial blank
    // 1: Logo path drawing
    // 2: Name reveals
    // 3: "STUDIO" tagline pops in
    // 4: "developed by Egelio Technologies" pops in
    // 5: Fade out

    const t1 = setTimeout(() => setStage(1), 200);
    const t2 = setTimeout(() => setStage(2), 1000);
    const t3 = setTimeout(() => setStage(3), 1500);
    const t4 = setTimeout(() => setStage(4), 2200);
    const t5 = setTimeout(() => setStage(5), 3800);
    
    // Fallback: Ensure the splash always completes regardless of animation timing
    const t6 = setTimeout(() => {
      onComplete();
    }, 4500);
    
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
      clearTimeout(t5);
      clearTimeout(t6);
    };
  }, [onComplete]);

  return (
    <AnimatePresence onExitComplete={onComplete}>
      {stage < 5 && (
        <motion.div
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.6, ease: "easeOut" } }}
          className="fixed inset-0 z-[9999] bg-[#030303] flex items-center justify-center flex-col overflow-hidden will-change-opacity"
        >
          {/* Subtle background glow - replaced expensive blur with radial gradient */}
          <motion.div 
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 0.15, scale: 1 }}
            transition={{ duration: 3, ease: "easeOut" }}
            className="absolute w-[800px] h-[800px] bg-[radial-gradient(circle_at_center,_#06b6d4_0%,_transparent_70%)] pointer-events-none will-change-transform"
          />

          <div className="relative z-10 flex flex-col items-center justify-center">
            {/* Logo Mark Container */}
            <div className="w-24 h-24 relative mb-8 flex items-center justify-center">
              {/* Outer Ring */}
              <motion.svg
                viewBox="0 0 100 100"
                className="absolute inset-0 w-full h-full -rotate-90 overflow-visible"
              >
                <circle
                  cx="50"
                  cy="50"
                  r="48"
                  fill="none"
                  stroke="rgba(6, 182, 212, 0.15)"
                  strokeWidth="2"
                />
                <motion.circle
                  cx="50"
                  cy="50"
                  r="48"
                  fill="none"
                  stroke="#06b6d4"
                  strokeWidth="2"
                  strokeLinecap="round"
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: stage >= 1 ? 1 : 0 }}
                  transition={{ duration: 1.2, ease: [0.65, 0, 0.35, 1] }}
                  style={{ willChange: "stroke-dasharray" }}
                />
              </motion.svg>
              
              {/* Core shape / "AM" monogram representation */}
              <motion.div
                initial={{ scale: 0, opacity: 0, rotate: -45 }}
                animate={{ 
                    scale: stage >= 1 ? 1 : 0, 
                    opacity: stage >= 1 ? 1 : 0, 
                    rotate: stage >= 1 ? 0 : -45 
                }}
                transition={{ type: "spring", damping: 15, stiffness: 120, delay: 0.3 }}
                className="absolute inset-0 m-auto flex items-center justify-center will-change-transform"
              >
                <Logo size={48} showText={false} />
              </motion.div>
            </div>

            {/* Typography */}
            <div className="overflow-visible flex flex-col items-center w-[350px]">
              <motion.h1
                initial={{ y: 20, opacity: 0 }}
                animate={{ 
                    y: stage >= 2 ? 0 : 20, 
                    opacity: stage >= 2 ? 1 : 0 
                }}
                transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                className="text-4xl font-extrabold tracking-[0.2em] text-transparent bg-clip-text bg-gradient-to-r from-white via-gray-200 to-gray-500 mb-2 will-change-transform"
              >
                {t('ANIMATO')}
              </motion.h1>
              
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: stage >= 3 ? 1 : 0 }}
                transition={{ duration: 0.6, ease: "easeOut" }}
                className="flex items-center justify-center gap-4 w-full px-8 will-change-opacity"
              >
                <motion.div 
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: stage >= 3 ? 1 : 0 }}
                  style={{ originX: 1 }}
                  transition={{ duration: 0.7, ease: "easeOut" }}
                  className="h-[1px] flex-1 bg-gradient-to-r from-transparent to-cyan-500/50 will-change-transform" 
                />
                <span className="text-[10px] font-mono tracking-[0.4em] text-cyan-400 font-medium">{t('STUDIO')}</span>
                <motion.div 
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: stage >= 3 ? 1 : 0 }}
                  style={{ originX: 0 }}
                  transition={{ duration: 0.7, ease: "easeOut" }}
                  className="h-[1px] flex-1 bg-gradient-to-l from-transparent to-cyan-500/50 will-change-transform" 
                />
              </motion.div>
            </div>
          </div>
          
          {/* Brand attribution */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: stage >= 4 ? 1 : 0, y: stage >= 4 ? 0 : 10 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            className="absolute bottom-12 left-0 right-0 flex flex-col items-center opacity-70 will-change-transform pointer-events-none"
          >
            <span className="text-[9px] uppercase tracking-widest text-gray-400 mb-1">Developed by</span>
            <span className="text-xs font-bold tracking-[0.2em] text-white">EGELUO TECHNOLOGIES</span>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
