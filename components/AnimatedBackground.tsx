import React, { useEffect, useMemo } from 'react';
import { motion } from 'motion/react';

export type ThemeType = 'midnight' | 'light' | 'forest' | 'ocean' | 'cyberpunk' | 'synthwave' | 'nebula' | 'lava' | 'aurora' | 'matrix';

export const THEME_OPTIONS: { id: ThemeType, name: string }[] = [
    { id: 'midnight', name: 'Midnight (Default)' },
    { id: 'light', name: 'Daylight' },
    { id: 'forest', name: 'Enchanted Forest' },
    { id: 'ocean', name: 'Deep Ocean' },
    { id: 'cyberpunk', name: 'Cyber City' },
    { id: 'synthwave', name: 'Retro Synthwave' },
    { id: 'nebula', name: 'Cosmic Nebula' },
    { id: 'lava', name: 'Volcanic Lava' },
    { id: 'aurora', name: 'Northern Lights' },
    { id: 'matrix', name: 'Digital Matrix' }
];

export const AnimatedBackground: React.FC<{ theme: ThemeType, isLowPerformanceMode?: boolean }> = ({ theme, isLowPerformanceMode }) => {
    useEffect(() => {
        document.body.setAttribute('data-theme', theme);
    }, [theme]);

    const leafParticles = useMemo(() => isLowPerformanceMode ? [] : [...Array(12)].map((_, i) => ({
        id: i,
        left: `${Math.random() * 100}%`,
        delayY: Math.random() * -20,
        durY: 10 + Math.random() * 15,
        durX: 5 + Math.random() * 5,
        durR: 5 + Math.random() * 5
    })), [isLowPerformanceMode]);

    const orbParticles = useMemo(() => isLowPerformanceMode ? [] : [...Array(8)].map((_, i) => ({
        id: i,
        left: `${Math.random() * 100}%`,
        top: `${Math.random() * 100}%`,
        delay: Math.random() * -20,
        dur: 15 + Math.random() * 15
    })), [isLowPerformanceMode]);

    const oceanBubbles = useMemo(() => isLowPerformanceMode ? [] : [...Array(15)].map((_, i) => ({
        id: i,
        left: `${Math.random() * 100}%`,
        delay: Math.random() * -20,
        dur: 5 + Math.random() * 10,
        size: 5 + Math.random() * 15
    })), [isLowPerformanceMode]);

    const starParticles = useMemo(() => isLowPerformanceMode ? [] : [...Array(25)].map((_, i) => ({
        id: i,
        left: `${Math.random() * 100}%`,
        top: `${Math.random() * 100}%`,
        delay: Math.random() * -5,
        dur: 1 + Math.random() * 4,
        size: 1 + Math.random() * 3
    })), [isLowPerformanceMode]);

    const matrixParticles = useMemo(() => isLowPerformanceMode ? [] : [...Array(20)].map((_, i) => ({
        id: i,
        left: `${Math.random() * 100}%`,
        delay: Math.random() * -10,
        dur: 3 + Math.random() * 5,
        size: 10 + Math.random() * 14,
        char: String.fromCharCode(0x30A0 + Math.random() * 96)
    })), [isLowPerformanceMode]);

    const lightMotes = useMemo(() => isLowPerformanceMode ? [] : [...Array(15)].map((_, i) => ({
        id: i,
        left: `${Math.random() * 100}%`,
        top: `${Math.random() * 100}%`,
        delay: Math.random() * -10,
        dur: 10 + Math.random() * 10,
        size: 20 + Math.random() * 40
    })), [isLowPerformanceMode]);

    const cyberpunkLines = useMemo(() => isLowPerformanceMode ? [] : [...Array(15)].map((_, i) => ({
        id: i,
        top: `${Math.random() * 100}%`,
        delay: Math.random() * -5,
        dur: 0.1 + Math.random() * 0.5,
        width: 10 + Math.random() * 90
    })), [isLowPerformanceMode]);

    const auroraMotes = useMemo(() => isLowPerformanceMode ? [] : [...Array(20)].map((_, i) => ({
        id: i,
        left: `${Math.random() * 100}%`,
        top: `${Math.random() * 80}%`,
        delay: Math.random() * -10,
        dur: 5 + Math.random() * 5,
        size: 2 + Math.random() * 4
    })), [isLowPerformanceMode]);

    if (theme === 'midnight' || (isLowPerformanceMode && theme !== 'light')) return null;

    return (
        <div className="fixed inset-0 z-[-1] overflow-hidden pointer-events-none">
            {theme === 'light' && (
                <div className="absolute inset-0 bg-gradient-to-br from-[#f0f4f8] via-[#e2e8f0] to-[#cbd5e1] animate-gradient-bg bg-[length:200%_200%]">
                    {lightMotes.map(p => (
                        <motion.div
                            key={p.id}
                            animate={{
                                y: ['-5vh', '5vh', '-5vh'],
                                x: ['-2vw', '2vw', '-2vw'],
                                opacity: [0.1, 0.4, 0.1],
                                scale: [1, 1.2, 1]
                            }}
                            transition={{ duration: p.dur, repeat: Infinity, ease: "easeInOut", delay: p.delay }}
                            className="absolute rounded-full bg-white/40 blur-xl mix-blend-overlay"
                            style={{ left: p.left, top: p.top, width: p.size, height: p.size }}
                        />
                    ))}
                </div>
            )}
            
            {theme === 'forest' && (
                <div className="absolute inset-0 bg-gradient-to-br from-[#0f2027] via-[#203a43] to-[#2c5364] animate-gradient-bg bg-[length:400%_400%]">
                    <div className="absolute inset-0 opacity-30 mix-blend-overlay bg-[url('https://grainy-gradients.vercel.app/noise.svg')]" />
                    <motion.div 
                        animate={{ opacity: [0.3, 0.6, 0.3], scale: [1, 1.1, 1] }}
                        transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
                        className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-green-500/20 via-transparent to-transparent" 
                    />
                    {leafParticles.map(p => (
                        <motion.div
                            key={p.id}
                            initial={{ y: '-10vh', rotate: 0 }}
                            animate={{ 
                                y: '110vh', 
                                x: ['-5vw', '5vw', '-5vw'],
                                rotate: 360 
                            }}
                            transition={{ 
                                y: { duration: p.durY, repeat: Infinity, ease: "linear", delay: p.delayY },
                                x: { duration: p.durX, repeat: Infinity, ease: "easeInOut" },
                                rotate: { duration: p.durR, repeat: Infinity, ease: "linear" }
                            }}
                            className="absolute w-3 h-3 md:w-5 md:h-5 bg-green-500/20 rounded-[0_60%_60%_60%] border border-green-400/30 mix-blend-screen shadow-[0_0_10px_rgba(74,222,128,0.2)]"
                            style={{ left: p.left }}
                        />
                    ))}
                </div>
            )}

            {theme === 'ocean' && (
                <div className="absolute inset-0 bg-gradient-to-br from-[#020024] via-[#090979] to-[#00d4ff] animate-gradient-bg bg-[length:300%_300%]">
                    <motion.div 
                        animate={{ y: [0, -20, 0] }}
                        transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
                        className="absolute inset-0 bg-[radial-gradient(circle_at_bottom_left,_var(--tw-gradient-stops))] from-blue-400/20 via-transparent to-transparent" 
                    />
                    <motion.div 
                        animate={{ y: [0, 20, 0] }}
                        transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
                        className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-cyan-300/20 via-transparent to-transparent" 
                    />
                    {oceanBubbles.map(p => (
                        <motion.div
                            key={p.id}
                            initial={{ y: '110vh' }}
                            animate={{ y: '-10vh', x: ['-2vw', '2vw', '-2vw'] }}
                            transition={{ 
                                y: { duration: p.dur, repeat: Infinity, ease: "linear", delay: p.delay },
                                x: { duration: 3, repeat: Infinity, ease: "easeInOut" }
                            }}
                            className="absolute rounded-full border border-cyan-300/40 opacity-60 mix-blend-overlay shadow-[inset_0_0_10px_rgba(103,232,249,0.5)]"
                            style={{ 
                                left: p.left,
                                width: p.size,
                                height: p.size
                            }}
                        />
                    ))}
                </div>
            )}

            {theme === 'cyberpunk' && (
                <div className="absolute inset-0 bg-[#0f0c29] overflow-hidden">
                    <div className="absolute inset-0 bg-gradient-to-br from-[#0f0c29] via-[#302b63] to-[#24243e] opacity-80" />
                    <motion.div 
                        animate={{ backgroundPosition: ["0% 0%", "100% 100%"] }}
                        transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
                        className="absolute inset-0 border-t border-l border-pink-500/10 bg-[linear-gradient(rgba(255,20,147,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,20,147,0.05)_1px,transparent_1px)] bg-[size:40px_40px]" 
                    />
                    <motion.div
                        animate={{ opacity: [0, 0.5, 0] }}
                        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                        className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom,_var(--tw-gradient-stops))] from-cyan-400/20 via-transparent to-transparent"
                    />
                    {cyberpunkLines.map(p => (
                        <motion.div
                            key={p.id}
                            animate={{ opacity: [0, 1, 0], x: ['-100vw', '100vw'] }}
                            transition={{ duration: p.dur, repeat: Infinity, delay: p.delay, ease: "linear" }}
                            className="absolute h-[1px] bg-cyan-400/50 shadow-[0_0_10px_rgba(34,211,238,0.8)]"
                            style={{ top: p.top, width: `${p.width}%` }}
                        />
                    ))}
                </div>
            )}

            {theme === 'synthwave' && (
                <div className="absolute inset-0 bg-gradient-to-b from-[#1a0033] via-[#4d004d] to-[#ff0066] animate-gradient-bg bg-[length:200%_200%]">
                    <div className="absolute bottom-0 left-0 right-0 h-1/2 bg-[linear-gradient(rgba(0,255,255,0.2)_1px,transparent_1px),linear-gradient(90deg,rgba(0,255,255,0.2)_1px,transparent_1px)] bg-[size:50px_50px] [transform:perspective(500px)_rotateX(60deg)] origin-bottom" />
                    {starParticles.map(p => (
                        <motion.div
                            key={p.id}
                            initial={{ x: '110vw' }}
                            animate={{ x: '-10vw' }}
                            transition={{ duration: p.dur * 5, repeat: Infinity, ease: "linear", delay: p.delay }}
                            className="absolute bg-white rounded-full shadow-[0_0_8px_rgba(255,255,255,0.8)]"
                            style={{ left: p.left, top: `${Math.random() * 50}%`, width: p.size, height: p.size }}
                        />
                    ))}
                </div>
            )}

            {theme === 'nebula' && (
                <div className="absolute inset-0 bg-[#050505] overflow-hidden">
                    <motion.div 
                        animate={{ rotate: 360, scale: [1, 1.2, 1] }}
                        transition={{ rotate: { duration: 100, repeat: Infinity, ease: "linear" }, scale: { duration: 20, repeat: Infinity, ease: "easeInOut" } }}
                        className="absolute -top-[50%] -left-[50%] w-[200%] h-[200%] bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-purple-900/40 via-fuchsia-900/10 to-transparent blur-3xl mix-blend-screen"
                    />
                    {starParticles.map(p => (
                        <motion.div
                            key={p.id}
                            animate={{ opacity: [0.2, 1, 0.2], scale: [0.8, 1.2, 0.8] }}
                            transition={{ duration: p.dur, repeat: Infinity, ease: "easeInOut", delay: p.delay }}
                            className="absolute bg-white rounded-full shadow-[0_0_10px_rgba(255,255,255,0.5)]"
                            style={{ left: p.left, top: p.top, width: p.size, height: p.size }}
                        />
                    ))}
                </div>
            )}

            {theme === 'lava' && (
                <div className="absolute inset-0 bg-[#1a0b0b]">
                    <motion.div 
                        animate={{ opacity: [0.4, 0.8, 0.4], scale: [1, 1.1, 1] }}
                        transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
                        className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom,_var(--tw-gradient-stops))] from-orange-600/40 via-red-900/20 to-transparent"
                    />
                    <div className="absolute inset-0 opacity-40 mix-blend-overlay bg-[url('https://grainy-gradients.vercel.app/noise.svg')]" />
                    {orbParticles.map(p => (
                        <motion.div
                            key={p.id}
                            animate={{ 
                                y: ['0vh', '-20vh', '10vh', '0vh'],
                                x: ['0vw', '10vw', '-10vw', '0vw'],
                                scale: [1, 1.5, 0.8, 1],
                                opacity: [0.2, 0.6, 0.2]
                            }}
                            transition={{ 
                                duration: p.dur, 
                                repeat: Infinity, 
                                ease: "easeInOut",
                                delay: p.delay
                            }}
                            className="absolute w-16 h-16 md:w-32 md:h-32 bg-red-500/20 rounded-full blur-[30px] mix-blend-screen"
                            style={{ 
                                left: p.left,
                                top: p.top
                            }}
                        />
                    ))}
                </div>
            )}

            {theme === 'aurora' && (
                <div className="absolute inset-0 bg-[#010a15] overflow-hidden">
                    <motion.div 
                        animate={{ 
                            x: ['-20%', '20%', '-20%'],
                            y: ['-10%', '10%', '-10%'],
                        }}
                        transition={{ duration: 20, repeat: Infinity, ease: "easeInOut" }}
                        className="absolute top-0 left-0 right-0 h-[60%] bg-gradient-to-b from-green-400/30 via-emerald-500/10 to-transparent blur-3xl transform -skew-y-12"
                    />
                    <motion.div 
                        animate={{ 
                            x: ['20%', '-20%', '20%'],
                            transform: ['skewY(12deg)', 'skewY(5deg)', 'skewY(12deg)']
                        }}
                        transition={{ duration: 15, repeat: Infinity, ease: "easeInOut", delay: 2 }}
                        className="absolute top-[20%] left-0 right-0 h-[50%] bg-gradient-to-b from-teal-400/20 via-cyan-500/10 to-transparent blur-3xl"
                    />
                    {auroraMotes.map(p => (
                        <motion.div
                            key={p.id}
                            animate={{ opacity: [0.2, 0.8, 0.2], scale: [0.8, 1.5, 0.8], x: ['-2vw', '2vw', '-2vw'] }}
                            transition={{ duration: p.dur, repeat: Infinity, delay: p.delay, ease: "easeInOut" }}
                            className="absolute rounded-full bg-emerald-300 mix-blend-screen shadow-[0_0_10px_rgba(110,231,183,0.5)] blur-[1px]"
                            style={{ left: p.left, top: p.top, width: p.size, height: p.size }}
                        />
                    ))}
                </div>
            )}

            {theme === 'matrix' && (
                <div className="absolute inset-0 bg-black overflow-hidden">
                    <div className="absolute inset-0 opacity-20 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI4IiBoZWlnaHQ9IjgiPgo8cmVjdCB3aWR0aD0iOCIgaGVpZ2h0PSI4IiBmaWxsPSIjMDAwMDBwIj48L3JlY3Q+CjxwYXRoIGQ9Ik0wIDBMOCA4Wk04IDBMMCA4WiIgc3Ryb2tlPSIjMDBmZjAwIiBzdHJva2Utd2lkdGg9IjAuNSI+PC9wYXRoPgo8L3N2Zz4=')] bg-repeat shadow-[inset_0_0_100px_black]" />
                    <motion.div 
                        animate={{ y: ['-100%', '100%'] }}
                        transition={{ duration: 10, repeat: Infinity, ease: "linear" }}
                        className="absolute inset-0 bg-gradient-to-b from-transparent via-[#00ff00]/10 to-transparent"
                    />
                    {matrixParticles.map(p => (
                        <motion.div
                            key={p.id}
                            initial={{ y: '-20vh' }}
                            animate={{ y: '120vh' }}
                            transition={{ duration: p.dur, repeat: Infinity, ease: "linear", delay: p.delay }}
                            className="absolute font-mono text-[#00ff00] opacity-70 font-bold select-none text-shadow-[0_0_8px_#00ff00]"
                            style={{ left: p.left, fontSize: p.size }}
                        >
                            {p.char}
                        </motion.div>
                    ))}
                </div>
            )}
        </div>
    );
};
