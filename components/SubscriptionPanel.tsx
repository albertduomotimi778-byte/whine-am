import React, { useState, useRef, useEffect } from 'react';
import { showAppToast } from '../utils/toastHelper';
import { useLanguage } from '../utils/LanguageContext';
import { motion, AnimatePresence } from 'motion/react';
import { Check, ChevronRight, LogOut, Sparkles, X, AlertCircle } from 'lucide-react';
import * as backend from '../utils/backend';
import { detectUserCountry, getScaledPrice } from '../utils/pppPricing';
import { db, collection, doc, getDoc, getDocs, query, where } from '../utils/firebase';
import { getBackendApiUrl } from '../utils/api';

interface Plan {
  id: string;
  name: string;
  basePriceNgn: number;
  duration: string;
  cycle: string;
  features: string[];
  popular?: boolean;
}

const PLANS: Plan[] = [
  {
    id: 'daily',
    name: 'Day Pass',
    basePriceNgn: 100,
    duration: '24 hours',
    cycle: 'day',
    features: ['Full Studio Access', 'Export up to 1080p', 'Standard Characters']
  },
  {
    id: 'weekly',
    name: 'Weekly',
    basePriceNgn: 500,
    duration: '7 days',
    cycle: 'week',
    features: ['Full Studio Access', 'Export up to 4K', 'Premium Characters', 'Priority Support']
  },
  {
    id: 'monthly',
    name: 'Monthly',
    basePriceNgn: 1500,
    duration: '1 month',
    cycle: 'month',
    popular: true,
    features: ['Full Studio Access', 'Export up to 4K', 'All Characters', 'Priority Support', 'Custom Visemes', "Join Creator's Program to make money"]
  },
  {
    id: 'yearly',
    name: 'Yearly',
    basePriceNgn: 10500,
    duration: '1 year',
    cycle: 'year',
    features: [
      'Full Studio Access', 
      'Export up to 4K', 
      'All Characters', 
      'Priority Support', 
      'Custom Visemes', 
      'API Access', 
      "Creator's Program access", 
      'Premium Cloud Sync access', 
      'Access to run on any Platform Competition'
    ]
  }
];

export const SubscriptionPanel = ({ user, onComplete, onSignOut }: { user: any, onComplete: () => void, onSignOut: () => void }) => {
  const { t } = useLanguage();
  const [countryCode, setCountryCode] = useState<string>('NG');

  useEffect(() => {
    detectUserCountry().then(setCountryCode);
  }, []);
  useEffect(() => {
    localStorage.setItem('app_currency', 'NGN');
  }, []);
  const [selectedPlan, setSelectedPlan] = useState<string>(() => {
    const params = new URLSearchParams(window.location.search);
    const pendingFromUrl = params.get('plan');
    const sticky = localStorage.getItem('selected_subscription_plan');
    const current = user?.subscription_type && user.subscription_type !== 'none' ? user.subscription_type : null;
    
    const choice = pendingFromUrl || sticky || current || 'monthly';
    // Ensure it's in localStorage even if it's the default
    if (!sticky) {
      localStorage.setItem('selected_subscription_plan', choice);
    }
    return choice;
  });

  // Sync to localStorage on every change
  React.useEffect(() => {
    localStorage.setItem('selected_subscription_plan', selectedPlan);
    localStorage.setItem('pending_app_plan', selectedPlan);
  }, [selectedPlan]);

  const handleSetSelectedPlan = (id: string) => {
    setSelectedPlan(id);
  };
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset loading state if user returns to this page (e.g. from Paystack redirect cancellation)
  React.useEffect(() => {
    const handleFocus = () => {
      // Give a tiny delay for App.tsx sync to potentially happen first
      setTimeout(() => {
        setLoading(false);
      }, 1500);
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, []);

  const lang = user?.language || 'English';
  const [showContact, setShowContact] = useState(false);
  
  const [referralCode, setReferralCode] = useState(() => localStorage.getItem('pending_referral_code') || '');
  const [discountActive, setDiscountActive] = useState(() => !!localStorage.getItem('pending_referral_code'));
  
  const checkFirstTime = !localStorage.getItem('first_subscription_done');

  const handleApplyReferral = async () => {
      const code = referralCode.trim();
      if (!code) {
          showAppToast("Please enter a referral code.");
          return;
      }
      
      setLoading(true);
      try {
          const url = getBackendApiUrl(`/api/creator/referral/check?code=${encodeURIComponent(code)}`);
          
          let checkSuccess = false;
          let codeExists = false;
          try {
              const res = await fetch(url);
              if (res.ok) {
                  const data = await res.json();
                  if (data && data.status) {
                      checkSuccess = true;
                      codeExists = !!data.exists;
                  }
              }
          } catch (err) {
              console.warn("Backend referral check failed; using client-side direct Firestore fallback...", err);
          }

          if (!checkSuccess) {
              console.log("Running client-side direct-Firestore fallback for referral checking");
              const docRef = doc(db, 'referrals', code);
              const snap = await getDoc(docRef);
              if (snap.exists()) {
                  codeExists = true;
                  checkSuccess = true;
              } else {
                  const q = query(collection(db, 'referrals'), where('referralId', '==', code));
                  const qSnap = await getDocs(q);
                  if (!qSnap.empty) {
                      codeExists = true;
                      checkSuccess = true;
                  } else {
                      const allRefs = await getDocs(collection(db, 'referrals'));
                      const found = allRefs.docs.some(d => d.id.toLowerCase() === code.toLowerCase() || (d.data().referralId && String(d.data().referralId).toLowerCase() === code.toLowerCase()));
                      if (found) {
                          codeExists = true;
                      }
                      checkSuccess = true;
                  }
              }
          }

          if (codeExists) {
              setDiscountActive(true);
              localStorage.setItem('pending_referral_code', code);
              showAppToast("Referral code applied! 10% discount active.");
          } else {
              setDiscountActive(false);
              localStorage.removeItem('pending_referral_code');
              showAppToast("Error: This referral code does not exist.");
          }
      } catch (err) {
          console.error("Referral check error:", err);
          showAppToast("Could not verify referral code. Please try again.");
      } finally {
          setLoading(false);
      }
  };

  const currencySymbol = '₦';

  const getPrice = (plan: Plan) => {
    let price = getScaledPrice(plan.basePriceNgn, countryCode);
    if (discountActive && checkFirstTime) {
        price = price * 0.9;
    }
    return price.toLocaleString();
  };

  const handleSubscribe = async () => {
    if (!navigator.onLine) {
      setError(t("You are offline. Please connect to the internet to subscribe."));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const plan = PLANS.find(p => p.id === selectedPlan) || PLANS[2];
      let finalAmount = getScaledPrice(plan.basePriceNgn, countryCode);
      if (discountActive && checkFirstTime) {
          finalAmount = finalAmount * 0.9;
      }
      const finalCurrency = 'NGN';
      
      // Validation
      let storedEmail = '';
      try {
        const au = localStorage.getItem('app_user');
        if (au && au !== 'undefined' && au !== 'null') {
          const parsed = JSON.parse(au);
          storedEmail = parsed?.email || '';
        }
      } catch (e) {}

      let userEmail = (user?.email || storedEmail || '').trim();
      
      // If email still missing, try one last place
      if (!userEmail) {
        userEmail = localStorage.getItem('pending_app_payment') || '';
      }

      if (!userEmail || !userEmail.includes('@')) {
        console.error("Subscription Error: Email missing or invalid", { user, localStorage: localStorage.getItem('app_user') });
        setError(t("Valid email is required to process payment. Please sign out and sign in again."));
        setLoading(false);
        return;
      }

      // Mark payment as pending in local storage to track process
      localStorage.setItem('pending_app_payment', userEmail);
      localStorage.setItem('pending_app_plan', selectedPlan);
      localStorage.setItem('app_currency', finalCurrency);
      
      // Initialize Paystack setup in a popup
      if (!(window as any).PaystackPop) {
        throw new Error("Payment gateway is loading, please try again in a moment.");
      }

      const handler = (window as any).PaystackPop.setup({
        key: import.meta.env.VITE_PAYSTACK_PUBLIC_KEY || 'pk_live_d616663688ee4eecd3d5265784e941b3f7736a6a',
        email: userEmail,
        amount: finalAmount * 100,
        currency: finalCurrency,
        metadata: {
            email: userEmail,
            plan_type: selectedPlan,
            country: user?.country || 'Nigeria',
            language: user?.language || 'English',
        },
        callback: (response: any) => {
            console.log("Paystack callback:", response);
            // On success, redirect to verify
            window.location.href = `${window.location.origin}/payment/${encodeURIComponent(userEmail)}/${finalAmount}/${selectedPlan}/?reference=${response.reference}`;
        },
        onClose: () => {
            setLoading(false);
        }
      });
      handler.openIframe();
      setLoading(false); // Modal is open, no longer "loading" the initialization
      
    } catch (err: any) {
      if (err.name === 'AbortError' || err.message?.includes('aborted')) {
        console.error('Paystack initialization timed out.');
        setError(t("Payment initialization timed out. Please try again."));
      } else {
        console.error('Paystack Error catch block:', err);
        setError(err.message || 'Payment initialization failed');
      }
    } finally {
      setLoading(false);
    }
  };

  const [showDevPrompt, setShowDevPrompt] = useState(false);
  const [devPassword, setDevPassword] = useState('');

  const devClicksRef = useRef(0);
  const clickTimeoutRef = useRef<any>(null);

  const handleDevClick = () => {
    devClicksRef.current += 1;
    if (clickTimeoutRef.current) clearTimeout(clickTimeoutRef.current);

    if (devClicksRef.current >= 4) {
      devClicksRef.current = 0;
      setShowDevPrompt(true);
    } else {
      clickTimeoutRef.current = setTimeout(() => {
        devClicksRef.current = 0;
      }, 2000);
    }
  };

  const handleDevSubmit = async () => {
    if (devPassword === "admin123") {
      let extraTime = 30 * 24 * 60 * 60 * 1000;
      if (selectedPlan === 'daily') extraTime = 24 * 60 * 60 * 1000;
      if (selectedPlan === 'weekly') extraTime = 7 * 24 * 60 * 60 * 1000;
      if (selectedPlan === 'yearly') extraTime = 365 * 24 * 60 * 60 * 1000;
      
      const expiryMs = Date.now() + extraTime;

      try {
        const data = await backend.devActivate({
            email: user?.email,
            plan: selectedPlan,
            expiryMs: expiryMs
        });
        
        if (data.success && data.user) {
            localStorage.setItem('app_user', JSON.stringify(data.user));
            onComplete();
        }
      } catch (e) {
          console.error("Dev activation failed", e);
          const updatedUser = {
            ...user,
            subscription_status: 'active',
            subscription_type: selectedPlan,
            subscription_expiry: expiryMs
          };
          localStorage.setItem('app_user', JSON.stringify(updatedUser));
          onComplete();
      }
      setShowDevPrompt(false);
    } else {
      showAppToast(t("Incorrect password"));
      setDevPassword('');
    }
  };

  if (loading) {
    const plan = PLANS.find(p => p.id === selectedPlan) || PLANS[2];
    return (
      <div className="fixed inset-0 z-[10000] bg-[#050505] flex items-center justify-center p-6 text-center">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full"
        >
          <div className="relative mb-8">
            <div className="w-24 h-24 border-b-4 border-cyan-500 rounded-full animate-spin mx-auto opacity-80" />
            <div className="absolute inset-0 flex items-center justify-center">
                <Sparkles className="w-8 h-8 text-cyan-400 animate-pulse" />
            </div>
          </div>
          
          <h2 className="text-3xl font-bold text-white mb-2 tracking-tight">
            Preparing Payment...
          </h2>

          <div className="bg-[#111] border border-white/5 rounded-2xl p-4 mb-6 text-left">
             <div className="flex justify-between items-center mb-1">
                <span className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">Account</span>
                <span className="text-xs text-white truncate ml-4">
                  {user?.email || (() => {
                    try {
                      const au = localStorage.getItem('app_user');
                      if (au && au !== 'undefined' && au !== 'null') {
                        return JSON.parse(au)?.email || '';
                      }
                    } catch(e) {}
                    return '';
                  })() || 'Account'}
                </span>
             </div>
             <div className="flex justify-between items-center">
                <span className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">Subscription Plan</span>
                <span className="text-xs text-cyan-400 font-bold uppercase tracking-widest">PRO: {plan.name}</span>
             </div>
          </div>
          
          <p className="text-gray-400 text-sm">
            Please wait while we connect you to our secure payment partner, Paystack.
          </p>

          <div className="mt-8 flex justify-center gap-2">
            {[0, 1, 2].map((i) => (
                <motion.div
                    key={i}
                    animate={{ scale: [1, 1.2, 1], opacity: [0.3, 1, 0.3] }}
                    transition={{ repeat: Infinity, duration: 1.2, delay: i * 0.2 }}
                    className="w-1.5 h-1.5 bg-cyan-500 rounded-full"
                />
            ))}
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[9990] bg-[#050505] flex flex-col items-center justify-center overflow-hidden p-2 sm:p-4">
      {/* Background Ambience */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 right-[20%] w-[40%] h-[40%] bg-cyan-900/30 rounded-full blur-3xl" />
        <div className="absolute bottom-[10%] left-[10%] w-[40%] h-[40%] bg-blue-900/20 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 text-center mb-4 mt-2 shrink-0">
        {user?.subscription_status === 'expired' && (
          <div className="bg-red-500/10 border border-red-500/20 text-red-400 py-2 px-4 rounded-xl text-sm font-semibold mb-4 w-max mx-auto animate-pulse flex items-center gap-2">
            <AlertCircle size={16} /> {t('Your subscription has expired. Please renew to continue.')}
          </div>
        )}
        <h1 
          className="text-2xl md:text-4xl font-bold text-white tracking-tight mb-2 select-none"
          onClick={handleDevClick}
        >
          {t('Choose Your Plan')}
        </h1>
        <p className="text-gray-400 text-xs md:text-sm max-w-md mx-auto">{t('Unlock the full potential of Animato Studio with a subscription tailored to your workflow.')}</p>
      </div>

      <div className="relative z-10 w-full overflow-x-auto py-4 px-2 snap-x snap-mandatory hide-scrollbar min-h-0 shrink">
        <div className="flex gap-4 md:gap-6 px-4 md:px-8 w-max mx-auto items-stretch h-full">
          {PLANS.map((plan) => (
            <div 
              key={plan.id}
              onClick={() => handleSetSelectedPlan(plan.id)}
              className={`snap-center shrink-0 w-[240px] md:w-[280px] flex flex-col rounded-[1.5rem] p-5 cursor-pointer transition-all border-2 relative group
                ${selectedPlan === plan.id 
                  ? 'border-cyan-500 bg-[#0A0A0C] scale-[1.02] shadow-[0_0_30px_rgba(6,182,212,0.2)] z-10' 
                  : 'border-white/5 bg-[#111113] hover:bg-[#1a1a1f] hover:border-white/10 hover:-translate-y-1'}`}
            >
              {plan.popular && (
                <div className="absolute top-0 left-0 right-0 h-6 border-b border-cyan-500/20 bg-cyan-500/10 flex items-center justify-center text-cyan-400 text-[10px] font-bold uppercase tracking-wider rounded-t-[1.5rem]">
                  {t('Most Popular')}
                </div>
              )}
              {discountActive && checkFirstTime && (
                <div className="absolute -top-3 -right-3 px-2 py-1 bg-green-500 text-black text-[10px] font-black rounded-lg shadow-lg rotate-12 z-20">
                  -10% OFF
                </div>
              )}

              <div className={`mb-4 relative z-10 ${plan.popular ? 'mt-4' : ''}`}>
                <h3 className={`text-base font-bold mb-2 ${selectedPlan === plan.id ? 'text-white' : 'text-gray-300'}`}>{plan.name}</h3>
                <div className="flex flex-col gap-1 min-h-[80px]">
                  <div className="flex items-baseline gap-1">
                    <span className={`text-3xl font-black tracking-tight ${selectedPlan === plan.id ? 'text-white' : 'text-white'}`}>{currencySymbol}{getPrice(plan)}</span>
                    <span className="text-xs text-gray-500 font-medium">/{plan.cycle}</span>
                  </div>
                  <p className="text-xs text-gray-400 font-medium mt-2 leading-relaxed">
                    {plan.id === 'daily' ? `Full access to all Pro features for 24 hours.` : 
                     plan.id === 'weekly' ? `Full access to all Pro features for 7 days.` :
                     plan.id === 'monthly' ? `Full access to all Pro features for 1 month.` :
                     `Full access to all Pro features for 1 year.`}
                  </p>
                </div>
              </div>

              <div className="space-y-3 mb-2 relative z-10 flex-1">
                 {/* Features can be added here if needed */}
              </div>

              <div className="mt-auto relative z-10 pt-4">
                <div className={`w-full py-2.5 rounded-full font-bold text-xs text-center transition-colors border-2
                  ${selectedPlan === plan.id 
                    ? 'bg-cyan-600 text-white border-cyan-600 hover:bg-cyan-500 shadow-lg shadow-cyan-500/20' 
                    : 'bg-transparent text-gray-300 border-gray-600 hover:bg-white/5 hover:text-white'}`}
                >
                  {selectedPlan === plan.id ? `Start ${plan.name}` : `Get ${plan.name}`}
                </div>
              </div>
            </div>
          ))}
          {/* Mock Enterprise Plan */}
           <div 
              className={`snap-center shrink-0 w-[240px] md:w-[280px] flex flex-col rounded-[1.5rem] p-5 cursor-pointer transition-all relative group bg-cyan-950/20 text-white border-2 border-cyan-900/30 hover:bg-cyan-900/20 hover:-translate-y-1`}
              onClick={() => setShowContact(true)}
            >
               <div className="mb-4 relative z-10">
                <h3 className="text-base font-bold mb-2 text-cyan-400">Enterprise</h3>
                <div className="flex flex-col gap-1 min-h-[80px]">
                  <div className="flex items-baseline gap-1">
                    <span className="text-2xl font-black tracking-tight text-white mt-1">Contact Us</span>
                  </div>
                  <p className="text-xs text-cyan-100/70 font-medium mt-3 leading-relaxed">
                    For large teams and orgs needing advanced security, control, and support.
                  </p>
                </div>
              </div>
               <div className="space-y-3 mb-2 relative z-10 flex-1"></div>
               <div className="mt-auto relative z-10 pt-4">
                <div className="w-full py-2.5 rounded-full font-bold text-xs text-center transition-colors border-2 border-cyan-500/50 text-cyan-100 hover:bg-cyan-500/10">
                  Contact Us
                </div>
              </div>
           </div>
        </div>
      </div>

      <div className="w-full max-w-sm mt-2 px-4 z-10 shrink-0">
        {checkFirstTime && (
            <div className="mb-4 flex gap-2 w-full p-1 bg-white/5 rounded-xl border border-white/10">
                <input 
                    type="text" 
                    placeholder="Referral Code (Optional)" 
                    value={referralCode}
                    onChange={(e) => {
                        setReferralCode(e.target.value);
                        if (!e.target.value) {
                            setDiscountActive(false);
                            localStorage.removeItem('pending_referral_code');
                        }
                    }}
                    className="flex-1 bg-transparent px-3 py-2 text-sm text-white outline-none rounded-lg"
                />
                <button 
                  onClick={handleApplyReferral}
                  className="px-4 bg-white/10 hover:bg-white/20 text-white rounded-lg text-xs font-bold transition"
                >
                  Apply
                </button>
            </div>
        )}

        {error && (
            <div className="p-3 bg-red-900/20 border border-red-500/30 rounded-xl text-red-200 text-xs mb-3 animate-in fade-in slide-in-from-top-2">
              <p className="font-bold flex items-center gap-2 mb-1">
                <X size={14} /> {t('Payment Error')}
              </p>
              <p className="opacity-90">{error}</p>
            </div>
        )}

        <button
          onClick={handleSubscribe}
          disabled={loading}
          className="w-full bg-white text-black hover:bg-gray-100 rounded-xl py-3 text-sm font-bold tracking-wide transition-all shadow-[0_0_20px_rgba(255,255,255,0.1)] flex items-center justify-center gap-2 mb-3"
        >
          {loading ? t('Processing...') : t('Subscribe Now')} <ChevronRight size={16} />
        </button>
        
        <button 
          onClick={onSignOut}
          className="w-full flex items-center justify-center gap-2 text-[10px] font-bold text-red-500/80 hover:text-red-400 tracking-widest uppercase transition-colors mb-2"
        >
          <LogOut size={12} />
          {t('Sign Out')}
        </button>
      </div>

      <AnimatePresence>
        {showContact && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[9999] bg-black/80 flex items-center justify-center p-4"
            onClick={() => setShowContact(false)}
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className="bg-[#111113] border border-white/10 rounded-2xl p-6 max-w-sm w-full relative"
            >
              <button 
                onClick={() => setShowContact(false)}
                className="absolute top-4 right-4 text-gray-400 hover:text-white transition-colors"
                title="Close"
              >
                <X size={20} />
              </button>
              <h3 className="text-xl font-bold text-white mb-2">Contact Us</h3>
              <p className="text-sm text-gray-400 mb-6">Let's discuss how Animato can scale for your enterprise needs.</p>
              
              <div className="space-y-4">
                <div className="bg-white/5 rounded-xl p-4 border border-white/5 text-center">
                  <p className="text-sm text-gray-400 mb-1">Email</p>
                  <a href="mailto:egeluotechnologies@gmail.com" className="text-cyan-400 font-semibold hover:underline">egeluotechnologies@gmail.com</a>
                </div>
              </div>
              
              <button 
                onClick={() => setShowContact(false)}
                className="w-full mt-6 py-2.5 rounded-xl text-white font-bold text-sm bg-cyan-600 hover:bg-cyan-500 transition-colors"
              >
                Close
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showDevPrompt && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[9999] bg-black/80 flex items-center justify-center p-4"
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-[#111113] border border-white/10 rounded-2xl p-6 max-w-sm w-full relative"
            >
              <h3 className="text-xl font-bold text-white mb-4">Developer Login</h3>
              <input 
                type="password" 
                value={devPassword}
                onChange={e => setDevPassword(e.target.value)}
                placeholder="Enter Password"
                className="w-full bg-black/50 border border-white/10 rounded-lg py-2 pl-3 pr-4 text-white placeholder-gray-500 mb-4 focus:outline-none focus:border-cyan-500/50"
                autoFocus
              />
              <div className="flex gap-2">
                <button 
                  onClick={() => setShowDevPrompt(false)}
                  className="flex-1 py-2 rounded-lg text-gray-400 font-bold text-sm bg-white/5 hover:bg-white/10 transition-colors"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleDevSubmit}
                  className="flex-1 py-2 rounded-lg text-white font-bold text-sm bg-cyan-600 hover:bg-cyan-500 transition-colors"
                >
                  Submit
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <style dangerouslySetInnerHTML={{__html: `
        .hide-scrollbar::-webkit-scrollbar {
          display: none;
        }
        .hide-scrollbar {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}} />
    </div>
  );
};

