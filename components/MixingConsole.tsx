
import React, { useRef } from 'react';
import { useLanguage } from '../utils/LanguageContext';
import { TrackState } from '../types';
import { Volume2, VolumeX, Upload, Music, Mic2 } from 'lucide-react';
import { AudioImportManager } from './AudioImportManager';

interface ChannelStripProps {
  track: TrackState;
  updateTrack: (updates: Partial<TrackState>) => void;
  onLoad: (file: File) => void;
  isMaster?: boolean;
  theme: 'light' | 'dark';
  onInteractionStart?: () => void;
  onInteractionEnd?: () => void;
}

const RackScrew = () => (
    <div className="w-2.5 h-2.5 rounded-full bg-[#111] border border-[#222] shadow-[inset_0_1px_2px_rgba(0,0,0,0.8),0_1px_0_rgba(255,255,255,0.1)] flex items-center justify-center">
        <div className="w-1.5 h-0.5 bg-[#0a0a0a] transform -rotate-45"></div>
    </div>
);

const ChannelStrip: React.FC<ChannelStripProps> = ({ track, updateTrack, onLoad, isMaster, theme, onInteractionStart, onInteractionEnd }) => {
  const { t } = useLanguage();
  const [showImportManager, setShowImportManager] = React.useState(false);

  const highlightColor = isMaster ? 'text-amber-500' : 'text-cyan-500';
  const highlightBg = isMaster ? 'bg-amber-500' : 'bg-cyan-500';
  const buttonHover = isMaster ? 'hover:bg-amber-900/20 hover:border-amber-500/50' : 'hover:bg-cyan-900/20 hover:border-cyan-500/50';
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files[0]) {
          onLoad(e.target.files[0]);
          e.target.value = ''; // Reset immediately to allow re-selection
      }
  };

  return (
    <div className={`
      relative p-1 rounded bg-gradient-to-b from-[#1a1a1a] to-[#0a0a0a] shadow-2xl border-x border-[#000] flex flex-col gap-0
      w-full h-full min-h-[300px] overflow-hidden group
    `}>
      {/* Import Manager Modal */}
      {showImportManager && (
          <AudioImportManager 
            onClose={() => setShowImportManager(false)}
            onLoad={(file) => {
                onLoad(file);
                setShowImportManager(false);
            }}
          />
      )}

      {/* Rack Ears / Mount */}
      <div className="absolute top-2 left-2 opacity-60"><RackScrew/></div>
      <div className="absolute top-2 right-2 opacity-60"><RackScrew/></div>
      <div className="absolute bottom-2 left-2 opacity-60"><RackScrew/></div>
      <div className="absolute bottom-2 right-2 opacity-60"><RackScrew/></div>

      {/* Module Faceplate */}
      <div className="bg-[#141414] m-2 border border-white/5 rounded flex flex-col h-full relative overflow-hidden shadow-[inset_0_0_20px_rgba(0,0,0,0.8)]">
          
          {/* Header */}
          <div className="bg-[#0f0f0f] p-3 border-b border-white/5 flex items-center justify-between shadow-sm">
              <div className="flex items-center gap-2 overflow-hidden">
                  <div className={`p-1 rounded-sm bg-black/40 border border-white/5 ${highlightColor}`}>
                      {isMaster ? <Mic2 size={12}/> : <Music size={12}/>}
                  </div>
                  <div className="flex flex-col">
                      <span className={`text-[9px] font-black tracking-widest ${highlightColor} uppercase leading-none`}>
                          {isMaster ? t('VOCAL BUS') : t('INST BUS')}
                      </span>
                      <span className="text-[7px] text-gray-600 font-mono">CH.{isMaster ? '01' : '02'}</span>
                  </div>
              </div>
              <div className={`w-1.5 h-1.5 rounded-full ${track.muted ? 'bg-red-900' : `${highlightBg} shadow-[0_0_6px_currentColor]`}`}></div>
          </div>

          {/* LCD Display Area */}
          <div className="bg-[#050505] mx-3 mt-3 p-2 rounded border border-white/10 font-mono text-[9px] text-gray-300 relative shadow-inner overflow-hidden group-hover:border-white/20 transition-colors">
              <div className="flex justify-between items-center text-[7px] text-gray-600 uppercase mb-1">
                  <span>{t('SOURCE FILE')}</span>
                  <span className={track.buffer ? 'text-green-500' : 'text-gray-700'}>{track.buffer ? t('ACTIVE') : t('EMPTY')}</span>
              </div>
              <div className="truncate font-bold text-gray-200 tracking-tight">{track.name || t('No Audio Loaded')}</div>
              
              {/* Scanlines overlay */}
              <div className="absolute inset-0 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] z-10 pointer-events-none opacity-30 background-size-[100%_2px,3px_100%]"></div>
          </div>

          {/* Controls */}
          <div className="flex-1 p-3 flex flex-col justify-between gap-4">
              
              {/* Gain Fader Simulation */}
              <div className="flex-1 flex gap-4">
                  <div className="flex-1 flex flex-col justify-center gap-1">
                      <div className="flex justify-between text-[8px] font-bold text-gray-500">
                          <span>{t('GAIN')}</span>
                          <span className={highlightColor}>{(track.gain * 100).toFixed(0)}%</span>
                      </div>
                      <input 
                          type="range" min="0" max="1.5" step="0.01" value={track.gain}
                          onChange={(e) => updateTrack({ gain: parseFloat(e.target.value) })}
                          onPointerDown={onInteractionStart}
                          onPointerUp={onInteractionEnd}
                          className={`w-full h-1.5 bg-[#0a0a0a] rounded-full appearance-none cursor-pointer border border-white/5 accent-${isMaster ? 'amber' : 'cyan'}-500`}
                      />
                      
                      <div className="h-4"></div>

                      <div className="flex justify-between text-[8px] font-bold text-gray-500">
                          <span>{t('PITCH')}</span>
                          <span className="text-gray-300">x{track.pitch.toFixed(2)}</span>
                      </div>
                      <input 
                          type="range" min="0.5" max="2.0" step="0.05" value={track.pitch}
                          onChange={(e) => updateTrack({ pitch: parseFloat(e.target.value) })}
                          onPointerDown={onInteractionStart}
                          onPointerUp={onInteractionEnd}
                          className={`w-full h-1.5 bg-[#0a0a0a] rounded-full appearance-none cursor-pointer border border-white/5 accent-gray-500`}
                      />

                      <div className="h-4"></div>

                      <div className="flex justify-between text-[8px] font-bold text-gray-500">
                          <span>{t('SPEED')}</span>
                          <span className="text-gray-300">x{(track.speed ?? 1.0).toFixed(2)}</span>
                      </div>
                      <input 
                          type="range" min="0.5" max="2.0" step="0.05" value={track.speed ?? 1.0}
                          onChange={(e) => updateTrack({ speed: parseFloat(e.target.value) })}
                          onPointerDown={onInteractionStart}
                          onPointerUp={onInteractionEnd}
                          className={`w-full h-1.5 bg-[#0a0a0a] rounded-full appearance-none cursor-pointer border border-white/5 accent-gray-500`}
                      />
                  </div>
              </div>

              {/* Action Buttons */}
              <div className="grid grid-cols-1 gap-2 mt-auto">
                  <button 
                      onClick={() => setShowImportManager(true)}
                      className={`cursor-pointer bg-[#222] border border-white/5 rounded flex items-center justify-center gap-2 py-2 transition-all active:scale-95 ${buttonHover}`}
                  >
                      <Upload size={14} className={isMaster ? 'text-amber-500' : 'text-cyan-500'}/>
                      <span className="text-[9px] font-bold text-gray-300 tracking-wide">{t('IMPORT AUDIO')}</span>
                  </button>
                  
                  <div className="flex gap-2">
                      <button 
                          onClick={() => updateTrack({ muted: !track.muted })}
                          className={`flex-1 flex items-center justify-center gap-2 py-1.5 rounded border transition-colors ${track.muted ? 'bg-red-900/40 border-red-900/60 text-red-400' : 'bg-[#181818] border-white/5 hover:bg-[#222] text-gray-500'}`}
                      >
                          {track.muted ? <VolumeX size={12}/> : <Volume2 size={12}/>}
                          <span className="text-[8px] font-bold">{track.muted ? t('MUTED') : t('MUTE')}</span>
                      </button>
                  </div>
              </div>
          </div>
      </div>
    </div>
  );
};

export const MixingConsole: React.FC<any> = ({ vocalTrack, setVocalTrack, instTrack, setInstTrack, loadTrack, theme, onInteractionStart, onInteractionEnd }) => {
  const { t } = useLanguage();

  return (
    <div className="grid grid-cols-2 lg:flex lg:flex-row gap-2 lg:gap-4 h-full p-1 lg:p-2 items-stretch">
      <ChannelStrip 
        track={vocalTrack} 
        updateTrack={setVocalTrack} 
        onLoad={(f) => loadTrack(f, 'vocal')}
        isMaster={true}
        theme={theme}
        onInteractionStart={onInteractionStart}
        onInteractionEnd={onInteractionEnd}
      />
      <ChannelStrip 
        track={instTrack} 
        updateTrack={setInstTrack} 
        onLoad={(f) => loadTrack(f, 'inst')}
        theme={theme}
        onInteractionStart={onInteractionStart}
        onInteractionEnd={onInteractionEnd}
      />
    </div>
  );
};
