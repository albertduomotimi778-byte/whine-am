import React, { useEffect } from 'react';
import { motion } from 'motion/react';
import { useLanguage } from '../utils/LanguageContext';
import { CheckCircle } from 'lucide-react';

interface Props {
  plan: string;
  expiry: string;
  onComplete: () => void;
}

export const SubscriptionSuccessSplash: React.FC<Props> = ({ plan, expiry, onComplete }) => {
  const { t } = useLanguage();

  useEffect(() => {
    // Wait for 1.5 seconds then auto-proceed if still open for a snappy experience
    const timer = setTimeout(onComplete, 1500);
    return () => clearTimeout(timer);
  }, [onComplete]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[9999] bg-[#030303]/90 flex items-center justify-center p-4"
    >
      <motion.div 
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-[#111] border border-cyan-500/30 p-8 rounded-2xl shadow-2xl flex flex-col items-center text-center max-w-sm w-full"
      >
        <div className="w-16 h-16 bg-cyan-500/20 rounded-full flex items-center justify-center mb-6">
            <CheckCircle className="w-10 h-10 text-cyan-400" />
        </div>
        
        <h2 className="text-xl font-bold text-white mb-2">
            {t('Subscription Successful')}
        </h2>
        
        <p className="text-gray-400 text-sm mb-6">
            Your {plan.charAt(0).toUpperCase() + plan.slice(1)} subscription plan is successful.
            <br />
            Expires on {new Date(expiry).toLocaleDateString()}.
            <br />
            <span className="text-cyan-400 font-semibold">Enjoy animating!</span>
        </p>

        <button 
            onClick={onComplete}
            className="w-full py-3 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg font-bold transition-colors"
        >
            {t('Continue')}
        </button>
      </motion.div>
    </motion.div>
  );
};
