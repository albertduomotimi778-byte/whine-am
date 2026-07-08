export type ThemeType = 'midnight' | 'light' | 'forest' | 'ocean' | 'cyberpunk' | 'synthwave' | 'nebula' | 'lava' | 'aurora' | 'matrix';

export interface ThemeColors {
  text: string;
  bg: string;
  hoverBg: string;
  border: string;
  ring: string;
  pulseGlow: string;
  badge: string;
  buttonActiveBg: string;
  buttonActiveHover: string;
  buttonActiveText: string;
  accentIcon: string;
}

export const getThemeColors = (theme: ThemeType): ThemeColors => {
  switch (theme) {
    case 'light':
      return {
        text: 'text-blue-600',
        bg: 'bg-blue-50/80',
        hoverBg: 'hover:bg-blue-100/80',
        border: 'border-blue-200',
        ring: 'focus:ring-blue-500/30',
        pulseGlow: 'bg-blue-500',
        badge: 'bg-blue-100 text-blue-700 border-blue-200',
        buttonActiveBg: 'bg-blue-600',
        buttonActiveHover: 'hover:bg-blue-700',
        buttonActiveText: 'text-white',
        accentIcon: 'text-blue-500'
      };
    case 'forest':
      return {
        text: 'text-emerald-400',
        bg: 'bg-emerald-500/10',
        hoverBg: 'hover:bg-emerald-500/20',
        border: 'border-emerald-500/30',
        ring: 'focus:ring-emerald-500/40',
        pulseGlow: 'bg-emerald-400',
        badge: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
        buttonActiveBg: 'bg-emerald-500',
        buttonActiveHover: 'hover:bg-emerald-450',
        buttonActiveText: 'text-black',
        accentIcon: 'text-emerald-400'
      };
    case 'ocean':
      return {
        text: 'text-cyan-400',
        bg: 'bg-cyan-500/10',
        hoverBg: 'hover:bg-cyan-500/20',
        border: 'border-cyan-500/30',
        ring: 'focus:ring-cyan-500/40',
        pulseGlow: 'bg-cyan-400',
        badge: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
        buttonActiveBg: 'bg-cyan-500',
        buttonActiveHover: 'hover:bg-cyan-400',
        buttonActiveText: 'text-black',
        accentIcon: 'text-cyan-400'
      };
    case 'cyberpunk':
      return {
        text: 'text-pink-500',
        bg: 'bg-pink-500/10',
        hoverBg: 'hover:bg-pink-500/20',
        border: 'border-pink-500/30',
        ring: 'focus:ring-pink-500/40',
        pulseGlow: 'bg-pink-500',
        badge: 'bg-pink-500/10 text-pink-400 border-pink-500/20',
        buttonActiveBg: 'bg-pink-500',
        buttonActiveHover: 'hover:bg-pink-400',
        buttonActiveText: 'text-black',
        accentIcon: 'text-pink-400'
      };
    case 'synthwave':
      return {
        text: 'text-orange-500',
        bg: 'bg-orange-500/10',
        hoverBg: 'hover:bg-orange-500/20',
        border: 'border-orange-500/30',
        ring: 'focus:ring-orange-500/40',
        pulseGlow: 'bg-orange-500',
        badge: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
        buttonActiveBg: 'bg-orange-500',
        buttonActiveHover: 'hover:bg-orange-450',
        buttonActiveText: 'text-black',
        accentIcon: 'text-orange-400'
      };
    case 'nebula':
      return {
        text: 'text-fuchsia-400',
        bg: 'bg-fuchsia-500/10',
        hoverBg: 'hover:bg-fuchsia-500/20',
        border: 'border-fuchsia-500/30',
        ring: 'focus:ring-fuchsia-500/40',
        pulseGlow: 'bg-fuchsia-400',
        badge: 'bg-fuchsia-500/10 text-fuchsia-400 border-fuchsia-500/20',
        buttonActiveBg: 'bg-fuchsia-500',
        buttonActiveHover: 'hover:bg-fuchsia-450',
        buttonActiveText: 'text-black',
        accentIcon: 'text-fuchsia-400'
      };
    case 'lava':
      return {
        text: 'text-red-500',
        bg: 'bg-red-500/10',
        hoverBg: 'hover:bg-red-500/20',
        border: 'border-red-500/30',
        ring: 'focus:ring-red-500/40',
        pulseGlow: 'bg-red-500',
        badge: 'bg-red-500/10 text-red-400 border-red-500/20',
        buttonActiveBg: 'bg-red-500',
        buttonActiveHover: 'hover:bg-red-650',
        buttonActiveText: 'text-white',
        accentIcon: 'text-red-400'
      };
    case 'aurora':
      return {
        text: 'text-teal-400',
        bg: 'bg-teal-500/10',
        hoverBg: 'hover:bg-teal-500/20',
        border: 'border-teal-500/30',
        ring: 'focus:ring-teal-500/40',
        pulseGlow: 'bg-teal-400',
        badge: 'bg-teal-500/10 text-teal-400 border-teal-500/20',
        buttonActiveBg: 'bg-teal-500',
        buttonActiveHover: 'hover:bg-teal-450',
        buttonActiveText: 'text-black',
        accentIcon: 'text-teal-400'
      };
    case 'matrix':
      return {
        text: 'text-green-500',
        bg: 'bg-green-500/10',
        hoverBg: 'hover:bg-green-500/20',
        border: 'border-green-500/30',
        ring: 'focus:ring-green-500/40',
        pulseGlow: 'bg-green-500',
        badge: 'bg-green-500/10 text-green-400 border-green-500/20',
        buttonActiveBg: 'bg-green-500',
        buttonActiveHover: 'hover:bg-green-450',
        buttonActiveText: 'text-black',
        accentIcon: 'text-green-400'
      };
    case 'midnight':
    default:
      return {
        text: 'text-indigo-400',
        bg: 'bg-indigo-500/10',
        hoverBg: 'hover:bg-indigo-500/20',
        border: 'border-indigo-500/30',
        ring: 'focus:ring-indigo-500/40',
        pulseGlow: 'bg-indigo-400',
        badge: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
        buttonActiveBg: 'bg-indigo-500',
        buttonActiveHover: 'hover:bg-indigo-450',
        buttonActiveText: 'text-white',
        accentIcon: 'text-indigo-400'
      };
  }
};
