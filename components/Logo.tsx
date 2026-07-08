import React from 'react';
import { motion } from 'motion/react';

interface LogoProps {
    className?: string;
    size?: number;
    showText?: boolean;
    textClassName?: string;
}

export const Logo: React.FC<LogoProps> = ({ className = '', size = 32, showText = false, textClassName = 'text-sm' }) => {
    return (
        <div className={`flex items-center gap-3 ${className}`}>
            <motion.div 
                className="relative flex items-center justify-center shrink-0 cursor-pointer overflow-hidden rounded-xl shadow-lg shadow-cyan-500/30 transition-all hover:scale-105 active:scale-95"
                style={{ width: size, height: size }}
                whileHover={{ rotate: 5 }}
            >
                <svg viewBox="0 0 100 100" className="w-full h-full drop-shadow-xl" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <defs>
                        <linearGradient id="brandGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" stopColor="#06b6d4" />
                            <stop offset="50%" stopColor="#6366f1" />
                            <stop offset="100%" stopColor="#ec4899" />
                        </linearGradient>
                        <filter id="glow">
                            <feGaussianBlur stdDeviation="4" result="coloredBlur"/>
                            <feMerge>
                                <feMergeNode in="coloredBlur"/>
                                <feMergeNode in="SourceGraphic"/>
                            </feMerge>
                        </filter>
                    </defs>
                    
                    <rect width="100" height="100" rx="24" fill="url(#brandGrad)" />
                    
                    {/* Abstract 'A' / Animation Path */}
                    <motion.path 
                        d="M 25 75 L 50 25 L 75 75 M 35 60 L 65 60" 
                        stroke="#ffffff" 
                        strokeWidth="10" 
                        strokeLinecap="round" 
                        strokeLinejoin="round"
                        initial={{ pathLength: 0, opacity: 0 }}
                        animate={{ pathLength: 1, opacity: 1 }}
                        transition={{ duration: 1.5, ease: "easeInOut" }}
                    />
                    
                    {/* Orbiting dot representing motion/animation */}
                    <motion.circle 
                        cx="50" cy="50" r="4" fill="#ffffff" filter="url(#glow)"
                        animate={{
                            cx: [50, 75, 50, 25, 50],
                            cy: [25, 50, 75, 50, 25]
                        }}
                        transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
                    />
                </svg>
            </motion.div>
            
            {showText && (
                <div className="flex flex-col">
                    <span className={`font-black tracking-widest text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-indigo-400 to-pink-400 ${textClassName}`}>
                        ANIMATO
                    </span>
                </div>
            )}
        </div>
    );
};
