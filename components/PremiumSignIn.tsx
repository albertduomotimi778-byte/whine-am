import React, { useState, useRef, useEffect } from 'react';
import { useLanguage } from '../utils/LanguageContext';
import { motion, AnimatePresence } from 'motion/react';
import { User, ChevronRight, Mail, Sparkles, Wand2, Lock, ArrowLeft } from 'lucide-react';
import { supabase } from '../utils/supabase';

interface PremiumSignInProps {
  onComplete: (userData: any) => void;
}

import * as backend from '../utils/backend';
import { Logo } from './Logo';

export const PremiumSignIn: React.FC<PremiumSignInProps> = ({ onComplete }) => {
  const { t } = useLanguage();

  const [step, setStep] = useState<'WELCOME' | 'FORM' | 'PASSWORD_PROMPT' | 'LOADING' | 'SUCCESS'>('WELCOME');
  const [formData, setFormData] = useState({ name: '', email: '' });
  const [enteredPassword, setEnteredPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Show welcome animation for 1.8 seconds before showing form
    const timer = setTimeout(() => {
      setStep('FORM');
    }, 1800);
    return () => clearTimeout(timer);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!navigator.onLine) {
      setError(t("You are offline. Please connect to the internet."));
      return;
    }

    if (!formData.email.trim() || !formData.name.trim()) return;

    setStep('LOADING');
    setError(null);

    const emailLower = formData.email.toLowerCase().trim();

    try {
      let hasCustomPassword = false;
      let accountExists = false;
      let fetchedName = '';

      if (supabase) {
        try {
          const { data } = await supabase.from('user_accounts').select('*').eq('email', emailLower).single();
          if (data) {
            accountExists = true;
            fetchedName = data.name || fetchedName;
            if (data.password && data.password !== 'Animato-Auto-Pass-123!') {
              hasCustomPassword = true;
            }
          }
        } catch (e) {}
      }

      if (!accountExists) {
        const existingAccounts = JSON.parse(localStorage.getItem('user_accounts') || '[]');
        const localAct = existingAccounts.find((a: any) => a.email === emailLower);
        if (localAct) {
          accountExists = true;
          fetchedName = localAct.name || fetchedName;
          if (localAct.password && localAct.password !== 'Animato-Auto-Pass-123!') {
            hasCustomPassword = true;
          }
        }
      }

      if (hasCustomPassword) {
        setStep('PASSWORD_PROMPT');
        return;
      }

      // No custom password, continue normal registration/auth fallback
      let data;
      try {
        data = await Promise.race([
          backend.syncUser(emailLower),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000))
        ]) as any;
      } catch (e) {
        data = await Promise.race([
          backend.register({
            email: emailLower,
            password: 'Animato-Auto-Pass-123!',
            country: 'Worldwide',
            language: 'English',
          }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000))
        ]) as any;
        
        if (data?.user) data.user.name = formData.name;
      }

      if (!data || !data.user) {
        data = { user: { email: emailLower, name: formData.name, subscription_status: 'none' } };
      }

      localStorage.setItem('app_user', JSON.stringify(data.user));
      setStep('SUCCESS');
      setTimeout(() => {
        onComplete(data.user);
      }, 500);
    } catch (err: any) {
      console.error("UI auth error:", err);
      const fallbackUser = { email: emailLower, name: formData.name, subscription_status: 'none' };
      localStorage.setItem('app_user', JSON.stringify(fallbackUser));
      setStep('SUCCESS');
      setTimeout(() => {
        onComplete(fallbackUser);
      }, 500);
    }
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!enteredPassword.trim()) return;

    setStep('LOADING');
    setError(null);

    const emailLower = formData.email.toLowerCase().trim();

    try {
      const data = await backend.login({
        email: emailLower,
        password: enteredPassword.trim()
      });

      if (data && data.user) {
        // Carry name forward if it exists in formData and not in parsed user
        const parsedUser = data.user;
        if (!parsedUser.name && formData.name) {
          parsedUser.name = formData.name;
        }
        localStorage.setItem('app_user', JSON.stringify(parsedUser));
        setStep('SUCCESS');
        setTimeout(() => {
          onComplete(parsedUser);
        }, 500);
      } else {
        throw new Error(t('Invalid password.'));
      }
    } catch (err: any) {
      setError(err.message || t('Incorrect password. Please try again.'));
      setStep('PASSWORD_PROMPT');
    }
  };

  return (
    <div className="fixed inset-0 z-[9995] bg-[#050505] flex justify-center items-center overflow-y-auto px-4 py-8 perspective-[1000px]">
      <div className="absolute inset-0 pointer-events-none opacity-50">
        <div className="absolute top-[-20%] left-[-10%] w-[60%] h-[60%] bg-cyan-900/30 rounded-full blur-3xl animate-pulse" style={{ animationDuration: '4s' }} />
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-blue-900/30 rounded-full blur-3xl" />
      </div>

      <AnimatePresence mode="wait">
        {step === 'WELCOME' && (
          <motion.div 
            key="welcome"
            initial={{ opacity: 0, scale: 0.8, rotateX: 20 }}
            animate={{ opacity: 1, scale: 1, rotateX: 0 }}
            exit={{ opacity: 0, scale: 1.1, filter: 'blur(10px)' }}
            transition={{ duration: 1.2, type: 'spring', bounce: 0.4 }}
            className="flex flex-col items-center justify-center text-center z-10"
          >
            <motion.div 
               animate={{ rotate: 360, y: [0, -10, 0] }}
               transition={{ rotate: { duration: 20, repeat: Infinity, ease: "linear" }, y: { duration: 3, repeat: Infinity, ease: "easeInOut" } }}
               className="mb-8 relative"
            >
                <div className="absolute inset-0 bg-cyan-500/30 blur-2xl rounded-full scale-150"></div>
                <Logo size={80} showText={false} />
            </motion.div>
            <motion.h1 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3, duration: 0.8 }}
                className="text-4xl md:text-6xl font-black text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-blue-500 to-indigo-600 tracking-tighter mb-4"
            >
                Animato Studio
            </motion.h1>
            <motion.p 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.8, duration: 1 }}
                className="text-lg md:text-xl text-gray-400 tracking-wide font-light flex items-center justify-center gap-2"
            >
                <Wand2 className="text-cyan-400" size={20} /> Where Imagination Takes Flight
            </motion.p>
          </motion.div>
        )}

        {step === 'FORM' && (
          <motion.div 
            key="form"
            initial={{ opacity: 0, y: 30, rotateX: -10 }}
            animate={{ opacity: 1, y: 0, rotateX: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            className="w-full max-w-sm p-6 relative z-10 my-auto bg-white/[0.02] border border-white/10 rounded-3xl shadow-[0_0_50px_rgba(0,0,0,0.5)] backdrop-blur-xl"
          >
            <div className="text-center mb-8">
              <div className="mx-auto mb-4 flex flex-col items-center justify-center select-none">
                <Logo size={42} showText={false} />
              </div>
              <h2 className="text-2xl font-bold text-white tracking-tight mb-2">Welcome</h2>
              <p className="text-sm text-gray-400">
                 Tell us a bit about yourself to get started.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400 ml-1">Your Name</label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={16} />
                  <input 
                    type="text" 
                    required
                    value={formData.name}
                    onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                    className="w-full bg-[#111113] border border-white/10 rounded-2xl py-3 pl-10 pr-4 text-white focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50 transition-all font-medium text-sm shadow-inner"
                    placeholder="e.g. Alex"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400 ml-1">{t('Email Address')}</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={16} />
                  <input 
                    type="email" 
                    required
                    value={formData.email}
                    onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                    className="w-full bg-[#111113] border border-white/10 rounded-2xl py-3 pl-10 pr-4 text-white focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50 transition-all font-medium text-sm shadow-inner"
                    placeholder="For contact & billing"
                  />
                </div>
              </div>

              {error && <p className="text-red-400 text-xs text-center">{error}</p>}

              <button 
                type="submit" 
                className="w-full mt-6 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white rounded-2xl py-3.5 font-bold tracking-wide transition-all shadow-[0_0_20px_rgba(6,182,212,0.3)] hover:shadow-[0_0_30px_rgba(6,182,212,0.5)] flex items-center justify-center gap-2 text-sm"
              >
                Let's Go <ChevronRight size={18} />
              </button>
            </form>
          </motion.div>
        )}

        {step === 'PASSWORD_PROMPT' && (
          <motion.div 
            key="password_prompt"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.5 }}
            className="w-full max-w-sm p-6 relative z-10 my-auto bg-white/[0.02] border border-white/10 rounded-3xl shadow-[0_0_50px_rgba(0,0,0,0.5)] backdrop-blur-xl"
          >
            <button 
              onClick={() => { setStep('FORM'); setError(null); }}
              className="absolute left-4 top-4 p-1.5 rounded-full hover:bg-white/5 text-gray-400 hover:text-white transition-all flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider cursor-pointer"
            >
              <ArrowLeft size={14} /> Back
            </button>

            <div className="text-center mb-6 mt-4">
              <div className="mx-auto mb-3 flex flex-col items-center justify-center select-none">
                <Logo size={42} showText={false} />
              </div>
              <h2 className="text-xl font-bold text-white tracking-tight mb-1 flex items-center justify-center gap-2">
                <Lock size={18} className="text-cyan-400" /> Security Required
              </h2>
              <p className="text-xs text-gray-400">
                This account is password-protected. Please enter your secret password to sign in.
              </p>
            </div>

            <form onSubmit={handlePasswordSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400 ml-1">Password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={16} />
                  <input 
                    type="password" 
                    required
                    autoFocus
                    value={enteredPassword}
                    onChange={(e) => setEnteredPassword(e.target.value)}
                    className="w-full bg-[#111113] border border-white/10 rounded-2xl py-3 pl-10 pr-4 text-white focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50 transition-all font-medium text-sm shadow-inner"
                    placeholder="Enter account password..."
                  />
                </div>
              </div>

              {error && <p className="text-red-400 text-xs text-center">{error}</p>}

              <button 
                type="submit" 
                className="w-full mt-6 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white rounded-2xl py-3.5 font-bold tracking-wide transition-all shadow-[0_0_20px_rgba(6,182,212,0.3)] hover:shadow-[0_0_30px_rgba(6,182,212,0.5)] flex items-center justify-center gap-2 text-sm cursor-pointer"
              >
                Sign In Securely <ChevronRight size={18} />
              </button>
            </form>
          </motion.div>
        )}

        {step === 'LOADING' && (
          <motion.div 
            key="loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col items-center justify-center space-y-6 z-10"
          >
            <div className="relative w-16 h-16 flex items-center justify-center">
               <div className="absolute inset-0 border-t-2 border-cyan-500 rounded-full animate-spin"></div>
               <Sparkles className="text-cyan-500 w-6 h-6 animate-pulse" />
            </div>
            <div className="text-center space-y-2">
              <p className="text-sm text-gray-400 font-mono tracking-widest uppercase animate-pulse">Setting things up...</p>
            </div>
          </motion.div>
        )}

        {step === 'SUCCESS' && (
          <motion.div 
            key="success"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: "spring", damping: 20, stiffness: 100 }}
            className="w-full max-w-sm p-8 relative z-10 text-center flex flex-col items-center"
          >
            <motion.div 
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", delay: 0.2 }}
              className="w-20 h-20 bg-green-500/10 rounded-full flex items-center justify-center mx-auto mb-8 border border-green-500/20 shadow-[0_0_30px_rgba(34,197,94,0.3)]"
            >
              <Sparkles size={40} className="text-green-400" />
            </motion.div>
            <h2 className="text-2xl font-bold text-white mb-2 tracking-tight">
              Ready!
            </h2>
            <p className="text-gray-400">
               Welcome aboard, {formData.name || 'Creator'}!
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
