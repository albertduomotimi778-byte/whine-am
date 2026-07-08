import React, { useState } from 'react';
import { motion } from 'motion/react';
import { X, Lock, Eye, EyeOff, Key, Copy, Check, ShieldAlert } from 'lucide-react';
import { useLanguage } from '../utils/LanguageContext';
import * as backend from '../utils/backend';
import { ThemeType, getThemeColors } from '../utils/themeColors';

interface AccountSecurityModalProps {
  user: any;
  theme?: ThemeType;
  onClose: () => void;
  onUserUpdate: (updatedUser: any) => void;
}

export const AccountSecurityModal: React.FC<AccountSecurityModalProps> = ({
  user,
  theme = 'midnight',
  onClose,
  onUserUpdate
}) => {
  const { t } = useLanguage();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [copied, setCopied] = useState(false);
  
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const isLight = theme === 'light';
  const colors = getThemeColors(theme as ThemeType);

  // Retrieve current password if any
  const hasPassword = !!(user?.password && user?.password !== 'Animato-Auto-Pass-123!');
  const currentPasswordText = user?.password || '';

  const handleCopy = () => {
    if (!currentPasswordText) return;
    navigator.clipboard.writeText(currentPasswordText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSavePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    const trimmedPass = newPassword.trim();
    const trimmedConfirm = confirmPassword.trim();

    if (!trimmedPass) {
      setErrorMsg(t('Password cannot be empty'));
      return;
    }

    if (trimmedPass.length < 4) {
      setErrorMsg(t('Password must be at least 4 characters long'));
      return;
    }

    if (trimmedPass !== trimmedConfirm) {
      setErrorMsg(t('Passwords do not match'));
      return;
    }

    setLoading(true);
    try {
      await backend.changePassword(user.email, trimmedPass);
      const updatedUser = { ...user, password: trimmedPass };
      
      // Update local storage session
      localStorage.setItem('app_user', JSON.stringify(updatedUser));
      onUserUpdate(updatedUser);
      
      setSuccessMsg(t('Security password saved successfully!'));
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      setErrorMsg(err.message || t('Failed to update password'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[110] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-300">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 15 }}
        className={`w-full max-w-md border rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] ${isLight ? 'bg-white border-black/10' : 'bg-[#0c0c0e] border-white/10'}`}
      >
         {/* Header */}
        <div className={`p-5 border-b flex justify-between items-center shrink-0 ${isLight ? 'bg-gray-50 border-black/5' : 'bg-[#111113] border-white/5'}`}>
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 ${colors.bg} rounded-lg flex items-center justify-center ${colors.text} border ${colors.border}`}>
              <Lock size={18} />
            </div>
            <div>
              <h2 className={`text-sm font-bold tracking-wide uppercase ${isLight ? 'text-gray-900' : 'text-white'}`}>{t('Account Security')}</h2>
              <p className="text-gray-500 text-[10px] uppercase font-mono tracking-wider mt-0.5">{user?.email}</p>
            </div>
          </div>
          <button 
            onClick={onClose} 
            className={`p-1.5 rounded-full transition-colors ${isLight ? 'text-gray-500 hover:text-gray-900 hover:bg-black/5' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
          >
            <X size={18} />
          </button>
        </div>

        {/* Scrollable Container */}
        <div className="p-5 space-y-6 overflow-y-auto custom-scrollbar">
          {/* Card: Current Password Display (For accounts that have password) */}
          <div className={`border rounded-xl p-4 space-y-3.5 ${isLight ? 'bg-gray-50/50 border-black/5' : 'bg-white/5 border-white/5'}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Key size={14} className={`${colors.text} shrink-0`} />
                <span className={`text-xs font-bold ${isLight ? 'text-gray-700' : 'text-gray-300'}`}>{t('Current Password')}</span>
              </div>
              <span className={`text-[9px] font-mono px-2 py-0.5 rounded-full uppercase tracking-widest ${hasPassword ? `${colors.bg} ${colors.text} border ${colors.border}` : 'bg-amber-500/10 text-amber-500 border border-amber-500/20'}`}>
                {hasPassword ? t('Enabled') : t('SSO Only')}
              </span>
            </div>

            {hasPassword ? (
              <div className="space-y-2">
                <p className="text-[10px] text-gray-400">{t('Reveal your current password if you forgot it:')}</p>
                <div className={`flex items-center gap-2 border rounded-lg p-2.5 ${isLight ? 'bg-white border-black/10' : 'bg-black/40 border-white/10'}`}>
                  <span className={`text-xs font-mono select-all font-semibold flex-1 tracking-wider overflow-hidden truncate ${isLight ? 'text-gray-800' : 'text-gray-200'}`}>
                    {showCurrentPassword ? currentPasswordText : '••••••••••••'}
                  </span>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                      className={`p-1 rounded transition-colors ${isLight ? 'text-gray-400 hover:text-gray-800 hover:bg-black/5' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
                      title={showCurrentPassword ? t('Hide') : t('Show')}
                    >
                      {showCurrentPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                    <button
                      type="button"
                      onClick={handleCopy}
                      className={`p-1 rounded transition-colors relative ${isLight ? 'text-gray-400 hover:text-gray-800 hover:bg-black/5' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
                      title={t('Copy')}
                    >
                      {copied ? <Check size={14} className={`${colors.text}`} /> : <Copy size={14} />}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2.5 p-3 bg-amber-500/5 rounded-lg border border-amber-500/10 text-amber-500/90 text-[10px] leading-normal font-sans">
                <ShieldAlert size={14} className="shrink-0 mt-0.5 text-amber-500" />
                <div>
                  <p className="font-bold uppercase tracking-wider">{t('Google sso account')}</p>
                  <p className="text-gray-400 mt-1">{t('No local security password has been configured for this account. Create one below to add security credentials.')}</p>
                </div>
              </div>
            )}
          </div>

          {/* Form: Add/Change Password */}
          <form onSubmit={handleSavePassword} className="space-y-4">
            <h3 className={`text-xs font-bold uppercase tracking-widest ${isLight ? 'text-gray-600' : 'text-gray-300'}`}>
              {hasPassword ? t('Modify Password') : t('Set Account Password')}
            </h3>

            {/* Error & Success Messages */}
            {errorMsg && (
              <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-xs rounded-lg flex items-center gap-2">
                <span className="font-medium">{errorMsg}</span>
              </div>
            )}
            {successMsg && (
              <div className={`p-3 ${colors.bg} border ${colors.border} ${colors.text} text-xs rounded-lg flex items-center gap-2 font-bold animate-in fade-in duration-200`}>
                <span>{successMsg}</span>
              </div>
            )}

            <div className="space-y-4">
              {/* Field 1: New Password */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">{t('New Password')}</label>
                <div className="relative">
                  <input
                    type={showNewPassword ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => { setNewPassword(e.target.value); setErrorMsg(null); }}
                    className={`w-full border rounded-xl px-3 py-2.5 text-xs placeholder-gray-600 outline-none transition-all pr-10 font-mono font-bold tracking-wide focus:border-cyan-500/60 focus:ring-1 ${colors.ring} ${isLight ? 'bg-white border-black/15 hover:border-black/20 text-gray-900' : 'bg-black/40 border-white/15 hover:border-white/20 text-white'}`}
                    placeholder={t('Enter new password')}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    className={`absolute right-3 top-1/2 -translate-y-1/2 ${isLight ? 'text-gray-400 hover:text-gray-700' : 'text-gray-400 hover:text-white'}`}
                  >
                    {showNewPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>

              {/* Field 2: Confirm Password */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">{t('Confirm Password')}</label>
                <div className="relative">
                  <input
                    type={showConfirmPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => { setConfirmPassword(e.target.value); setErrorMsg(null); }}
                    className={`w-full border rounded-xl px-3 py-2.5 text-xs placeholder-gray-600 outline-none transition-all pr-10 font-mono font-bold tracking-wide focus:border-cyan-500/60 focus:ring-1 ${colors.ring} ${isLight ? 'bg-white border-black/15 hover:border-black/20 text-gray-900' : 'bg-black/40 border-white/15 hover:border-white/20 text-white'}`}
                    placeholder={t('Confirm new password')}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className={`absolute right-3 top-1/2 -translate-y-1/2 ${isLight ? 'text-gray-400 hover:text-gray-700' : 'text-gray-400 hover:text-white'}`}
                  >
                    {showConfirmPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading}
              className={`w-full mt-2 py-2.5 ${colors.buttonActiveBg} ${colors.buttonActiveText} ${colors.buttonActiveHover} font-bold text-xs rounded-xl active:scale-98 transition-all flex items-center justify-center gap-2 shadow-lg cursor-pointer disabled:opacity-50 disabled:pointer-events-none uppercase tracking-wider`}
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
                  {t('Saving...')}
                </>
              ) : (
                <>
                  <Lock size={14} />
                  {hasPassword ? t('Update Password') : t('Save Security Password')}
                </>
              )}
            </button>
          </form>
        </div>
      </motion.div>
    </div>
  );
};
