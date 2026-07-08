import React from 'react';
import { Sun, Contrast, Droplets, Focus, Sliders } from 'lucide-react';

interface AdjustTabProps {
  activeSceneCharacterId: string | null;
  characterFiltersMap: Record<string, any>;
  updateCharacterFilter: (propName: string, val: number, charId: string) => void;
  t: (key: string) => string;
  propertyTarget?: string;
  character?: any;
}

export const AdjustTab: React.FC<AdjustTabProps> = ({
  activeSceneCharacterId,
  characterFiltersMap,
  updateCharacterFilter,
  t,
  propertyTarget,
  character
}) => {
  let currentFilters = characterFiltersMap[activeSceneCharacterId || ""] || {
    saturation: 100,
    contrast: 100,
    brightness: 100,
    sharpness: 0
  };

  if (propertyTarget && propertyTarget !== "root" && character && character[propertyTarget]) {
    currentFilters = {
      ...(character[propertyTarget].filters || {
        saturation: 100,
        contrast: 100,
        brightness: 100,
      }),
      sharpness: currentFilters.sharpness // Always inherit global sharpness
    };
  }

  const handleUpdate = (prop: string, val: number) => {
    if (!activeSceneCharacterId) return;
    updateCharacterFilter(prop, val, activeSceneCharacterId);
  };

  return (
    <div className="w-full h-full p-6 flex flex-col gap-6 overflow-y-auto pointer-events-auto">
      {!activeSceneCharacterId ? (
        <div className="h-full flex flex-col items-center justify-center text-center p-8 gap-4 grayscale opacity-50">
          <Sliders size={48} className="text-gray-700" />
          <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
            {t("Select a character")}
            <br />
            {t("to adjust")}
          </p>
        </div>
      ) : (
        <div className="max-w-xl mx-auto w-full space-y-6">
          <div className="flex items-center gap-2 text-xs font-black text-gray-300 uppercase tracking-widest">
            <Sliders size={14} className="text-cyan-500" /> {t("Adjustment Filters")}
          </div>

          <div className="bg-[#111] p-5 rounded-2xl border border-white/5 space-y-8">
            
            <div className="space-y-3">
              <div className="flex justify-between items-center text-[10px] font-bold text-gray-500 uppercase">
                <div className="flex items-center gap-2"><Sun size={14}/> {t("Brightness")}</div>
                <span className="font-mono text-cyan-400">{Math.round(currentFilters.brightness)}%</span>
              </div>
              <input 
                type="range" min="0" max="200" step="1"
                value={currentFilters.brightness}
                onChange={(e) => handleUpdate("brightness", parseFloat(e.target.value))}
                className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-cyan-500 [&::-webkit-slider-thumb]:rounded-full"
              />
            </div>

            <div className="space-y-3">
              <div className="flex justify-between items-center text-[10px] font-bold text-gray-500 uppercase">
                <div className="flex items-center gap-2"><Contrast size={14}/> {t("Contrast")}</div>
                <span className="font-mono text-cyan-400">{Math.round(currentFilters.contrast)}%</span>
              </div>
              <input 
                type="range" min="0" max="200" step="1"
                value={currentFilters.contrast}
                onChange={(e) => handleUpdate("contrast", parseFloat(e.target.value))}
                className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-cyan-500 [&::-webkit-slider-thumb]:rounded-full"
              />
            </div>

            <div className="space-y-3">
              <div className="flex justify-between items-center text-[10px] font-bold text-gray-500 uppercase">
                <div className="flex items-center gap-2"><Droplets size={14}/> {t("Saturation")}</div>
                <span className="font-mono text-cyan-400">{Math.round(currentFilters.saturation)}%</span>
              </div>
              <input 
                type="range" min="0" max="200" step="1"
                value={currentFilters.saturation}
                onChange={(e) => handleUpdate("saturation", parseFloat(e.target.value))}
                className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-cyan-500 [&::-webkit-slider-thumb]:rounded-full"
              />
            </div>

            <div className="space-y-3">
              <div className="flex justify-between items-center text-[10px] font-bold text-gray-500 uppercase">
                <div className="flex items-center gap-2"><Focus size={14}/> {t("Sharpness & Details")}</div>
                <span className="font-mono text-cyan-400">{Math.round(currentFilters.sharpness)}%</span>
              </div>
              <input 
                type="range" min="0" max="100" step="1"
                value={currentFilters.sharpness || 0}
                onChange={(e) => handleUpdate("sharpness", parseFloat(e.target.value))}
                className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-cyan-500 [&::-webkit-slider-thumb]:rounded-full"
              />
            </div>

          </div>
        </div>
      )}
    </div>
  );
};
