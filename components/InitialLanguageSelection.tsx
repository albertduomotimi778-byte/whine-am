import React from 'react';
import { motion } from 'motion/react';
import { Globe, ArrowRight } from 'lucide-react';
import { useLanguage } from '../utils/LanguageContext';

const LANGUAGES = [
  "English", "Spanish", "French", "Mandarin (Chinese)", "Hindi", 
  "Arabic", "Portuguese", "Russian", "Japanese", "German"
];

export const InitialLanguageSelection = ({ onSelect }: { onSelect: (lang: string) => void }) => {
  const { setLanguage, t } = useLanguage();
  const [selected, setSelected] = React.useState("English");

  const handleSelect = (lang: string) => {
    setLanguage(lang);
    onSelect(lang);
  };

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center p-6 overflow-hidden bg-[#050505]">
      {/* Optimized Background Layer */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none opacity-40">
          <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-gradient-to-br from-pink-500/10 to-orange-500/10 rounded-full blur-3xl animate-pulse" style={{ animationDuration: '6s' }} />
          <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-gradient-to-tl from-cyan-500/10 to-blue-500/10 rounded-full blur-3xl animate-pulse" style={{ animationDuration: '8s' }} />
          <div className="absolute top-[30%] left-[60%] w-[30%] h-[30%] bg-gradient-to-tr from-purple-500/10 to-indigo-500/10 rounded-full blur-2xl animate-pulse" style={{ animationDuration: '7s' }} />
          
          {/* Animated SVG blobs */}
          <motion.div 
            animate={{ rotate: 360 }} 
            transition={{ duration: 30, repeat: Infinity, ease: "linear" }}
            className="absolute top-1/4 left-1/4 opacity-20"
          >
             <svg width="200" height="200" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
                <path fill="#06b6d4" d="M42.7,-68.8C55.9,-61.2,67.6,-50.2,76.5,-36.8C85.4,-23.4,91.5,-7.6,89.5,7.7C87.4,22.9,77.3,37.5,65.6,49.8C54,62.1,40.8,72.1,25.6,78.2C10.4,84.4,-6.9,86.6,-22.4,82.4C-38,78.1,-51.8,67.5,-63.3,54.4C-74.8,41.2,-83.9,25.5,-86.3,9.1C-88.7,-7.4,-84.3,-24.5,-74.6,-38.3C-64.8,-52.1,-49.6,-62.7,-34.5,-69C-19.4,-75.3,-4.5,-77.3,10.6,-76.3C25.7,-75.4,41.3,-71.4,42.7,-68.8Z" transform="translate(100 100)" />
             </svg>
          </motion.div>

          <motion.div 
            animate={{ rotate: -360 }} 
            transition={{ duration: 35, repeat: Infinity, ease: "linear" }}
            className="absolute bottom-1/4 right-1/4 opacity-10"
          >
             <svg width="250" height="250" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
                <path fill="#8b5cf6" d="M48.7,-70.6C62.7,-61.8,73.4,-48.1,81.1,-32.7C88.7,-17.3,93.4,-0.4,89.8,14.6C86.1,29.7,74.1,43,60.6,52.8C47.1,62.6,32.1,68.9,16.5,72.6C0.9,76.4,-15.3,77.6,-30.2,72.8C-45,68.1,-58.5,57.4,-68.7,43.8C-78.9,30.3,-85.7,13.9,-85,-2.2C-84.3,-18.2,-76,-33.9,-65,-46.8C-53.9,-59.7,-40,-69.8,-25.2,-74.2C-10.4,-78.5,5.4,-77.1,20.8,-75C36.2,-72.8,51.2,-69.8,48.7,-70.6Z" transform="translate(100 100)" />
             </svg>
          </motion.div>
      </div>

      <motion.div 
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm bg-black/60 border border-white/10 rounded-3xl p-8 shadow-2xl relative z-10"
      >
        <div className="flex flex-col items-center text-center">
            <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", delay: 0.2 }}
                className="w-16 h-16 bg-gradient-to-br from-cyan-400 to-blue-600 rounded-2xl flex items-center justify-center mb-6 shadow-lg shadow-cyan-500/30"
            >
                <Globe className="text-white" size={32} />
            </motion.div>

            <h1 className="text-2xl font-black text-white mb-2 tracking-tight">
                {t("Hi there! Welcome.")}
            </h1>
            <p className="text-gray-300 text-sm mb-8 font-medium">
                {t("Choose a language to make yourself at home before we begin.")}
            </p>

            <div className="w-full relative mb-6">
                 <select 
                    value={selected}
                    onChange={(e) => setSelected(e.target.value)}
                    className="w-full appearance-none bg-white/5 border border-white/10 rounded-2xl py-3.5 px-5 text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 font-semibold cursor-pointer"
                 >
                    {LANGUAGES.map(lang => (
                        <option key={lang} value={lang} className="bg-[#111] text-white notranslate">{lang}</option>
                    ))}
                 </select>
                 <ArrowRight className="absolute right-5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" size={16} />
            </div>

            <button 
                onClick={() => handleSelect(selected)}
                className="w-full bg-white text-black hover:bg-gray-100 py-3.5 rounded-2xl font-bold transition-all shadow-[0_0_20px_rgba(255,255,255,0.1)] flex items-center justify-center gap-2 group"
            >
                {t("Continue")} <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
            </button>
        </div>
      </motion.div>
    </div>
  );
};
