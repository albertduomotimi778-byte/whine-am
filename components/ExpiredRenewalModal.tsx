import { showAppToast } from '../utils/toastHelper';
import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useLanguage } from '../utils/LanguageContext';
import { AlertCircle, ChevronRight, Check, CreditCard, Sparkles } from 'lucide-react';
import { detectUserCountry, getScaledPrice } from '../utils/pppPricing';

interface ExpiredRenewalModalProps {
  user: any;
  onSignOut: () => void;
}

const PLANS = [
  { id: 'daily', name: 'Day', basePriceNgn: 100 },
  { id: 'weekly', name: 'Week', basePriceNgn: 500 },
  { id: 'monthly', name: 'Month', basePriceNgn: 1500 },
  { id: 'yearly', name: 'Year', basePriceNgn: 10500 },
];

export const ExpiredRenewalModal = ({ user, onSignOut }: ExpiredRenewalModalProps) => {
  const { t } = useLanguage();
  const [step, setStep] = useState<'EXPIRED' | 'SELECT'>('EXPIRED');
  const [countryCode, setCountryCode] = useState('NG');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    detectUserCountry().then(setCountryCode);
  }, []);

  const handleRenewClick = () => setStep('SELECT');

  const handleSubscribe = (planId: string) => {
    setLoading(true);
    const plan = PLANS.find(p => p.id === planId);
    if (!plan) return;

    const amount = getScaledPrice(plan.basePriceNgn, countryCode);
    
    // Save state for restoration
    const userEmail = user?.email || '';
    localStorage.setItem('pending_app_payment', userEmail);
    localStorage.setItem('pending_app_plan', planId);
    localStorage.setItem('app_currency', 'NGN');

    // Paystack integration
    if (!(window as any).PaystackPop) {
      showAppToast(t("Payment gateway is loading, please try again in a moment."));
      setLoading(false);
      return;
    }

    const handler = (window as any).PaystackPop.setup({
      key: import.meta.env.VITE_PAYSTACK_PUBLIC_KEY || 'pk_live_d616663688ee4eecd3d5265784e941b3f7736a6a',
      email: userEmail,
      amount: amount * 100, // kobo
      currency: 'NGN',
      ref: 'REN_' + Math.floor((Math.random() * 1000000000) + 1),
      callback: (response: any) => {
        window.location.href = `${window.location.pathname}?reference=${response.reference}&plan=${planId}`;
      },
      onClose: () => setLoading(false)
    });
    handler.openIframe();
  };

  return (
    <div className="fixed inset-0 z-[10000] bg-black/90 backdrop-blur-md flex items-center justify-center p-4">
      <AnimatePresence mode="wait">
        {step === 'EXPIRED' ? (
          <motion.div 
            key="expired"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.1 }}
            className="w-full max-w-sm bg-[#0d0d10] border border-red-500/20 rounded-3xl p-8 text-center shadow-2xl"
          >
            <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
              <AlertCircle className="text-red-500" size={32} />
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">{t('Subscription Expired')}</h2>
            <p className="text-gray-400 mb-8">{t('Renew to continue your creative journey with Animato Studio.')}</p>
            
            <button 
              onClick={handleRenewClick}
              className="w-full py-4 bg-white text-black font-bold rounded-2xl flex items-center justify-center gap-2 hover:bg-gray-200 transition-colors"
            >
              {t('Renew Subscription')}
              <ChevronRight size={18} />
            </button>
            
            <button 
              onClick={onSignOut}
              className="mt-6 text-sm text-gray-500 hover:text-white transition-colors"
            >
              {t('Sign out')}
            </button>
          </motion.div>
        ) : (
          <motion.div 
            key="select"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full max-w-md bg-[#0d0d10] border border-white/5 rounded-3xl p-6 shadow-2xl"
          >
            <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 bg-cyan-500/10 rounded-xl flex items-center justify-center">
                    <Sparkles className="text-cyan-400" size={20} />
                </div>
                <div>
                    <h2 className="text-lg font-bold text-white leading-none">{t('Select a Plan')}</h2>
                    <p className="text-xs text-gray-400 mt-1">{t('Maintain your access in seconds.')}</p>
                </div>
            </div>

            <div className="space-y-3 mb-8">
              {PLANS.map(plan => {
                const price = getScaledPrice(plan.basePriceNgn, countryCode);
                return (
                  <button
                    key={plan.id}
                    onClick={() => handleSubscribe(plan.id)}
                    disabled={loading}
                    className="w-full group relative flex items-center justify-between p-4 bg-white/5 border border-white/5 rounded-2xl hover:border-cyan-500/50 hover:bg-cyan-500/5 transition-all disabled:opacity-50"
                  >
                    <div className="flex flex-col items-start">
                        <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">{t(plan.name)}</span>
                        <span className="text-xl font-black text-white">₦{price.toLocaleString()}</span>
                    </div>
                    <div className="w-10 h-10 rounded-xl bg-white/5 group-hover:bg-cyan-500 flex items-center justify-center transition-colors">
                        <CreditCard size={18} className="text-gray-400 group-hover:text-black" />
                    </div>
                  </button>
                );
              })}
            </div>

            <p className="text-[10px] text-gray-600 text-center uppercase tracking-widest">
                {t('Pay securely via Paystack')}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
