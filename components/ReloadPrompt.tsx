import React from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { RefreshCw, X, Sparkles, CheckCircle2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useLanguage } from '../utils/LanguageContext';
import { showAppToast } from '../utils/toastHelper';

export const ReloadPrompt = ({ onUpdate }: { onUpdate?: () => Promise<void> | void }) => {
  const { t } = useLanguage();
  const [isUpdating, setIsUpdating] = React.useState(false);
  const [updateSuccess, setUpdateSuccess] = React.useState(false);
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegistered(r) {
      if (r) {
        // Trigger initial check
        r.update().catch(console.error);
        
        setInterval(() => {
          if (!(!document.hidden && navigator.onLine)) return;
          r.update().catch(console.error);
        }, 60000); // 60 second checking to be less aggressive
      }
    },
    onRegisterError(error) {
        console.error('SW registration error', error);
    }
  });

  // Display "App has been updated" notification if the app was just updated and reloaded
  React.useEffect(() => {
    const justUpdated = localStorage.getItem('pwa_just_updated');
    if (justUpdated === 'true') {
      localStorage.removeItem('pwa_just_updated');
      // Gentle delay to allow the app state and UI to settle
      setTimeout(() => {
        showAppToast(t('App has been updated.'));
      }, 1000);
    }
  }, [t]);

  React.useEffect(() => {
    (window as any).__pwaNeedRefresh = needRefresh;
    (window as any).__showReloadPrompt = () => {
      console.log("Triggering ReloadPrompt UI manually for testing...");
      setNeedRefresh(true);
    };
    (window as any).__checkAppUpdate = () => {
      return new Promise<boolean>(async (resolve) => {
        console.log("Checking for updates manually...");
        
        // 1. If we already know we need a refresh, return true immediately!
        if ((window as any).__pwaNeedRefresh === true) {
          resolve(true);
          return;
        }

        try {
          const registrations = await navigator.serviceWorker?.getRegistrations();
          if (!registrations || registrations.length === 0) {
            console.warn("No active Service Worker found.");
            resolve(false);
            return;
          }

          // Let's keep track of whether any updatefound event fires
          let updateEventDetected = false;
          
          // Create listeners
          const cleanupFns: (() => void)[] = [];
          
          const handleUpdateFound = () => {
            console.log("PWA Updatefound event triggered!");
            updateEventDetected = true;
          };

          for (const r of registrations) {
            // If already waiting/installing
            if (r.waiting || r.installing) {
              updateEventDetected = true;
            }
            r.addEventListener('updatefound', handleUpdateFound);
            cleanupFns.push(() => r.removeEventListener('updatefound', handleUpdateFound));
          }

          // Trigger the update checks
          const updatePromises = registrations.map(r => r.update().catch(err => {
            console.error("Single SW registration update fail:", err);
          }));
          
          // Wait for all updates to trigger
          await Promise.all(updatePromises);

          // We'll poll every 100ms up to 2.5 seconds to see if:
          // 1. updateEventDetected became true
          // 2. Or any registration has r.waiting or r.installing
          // 3. Or __pwaNeedRefresh became true
          let elapsed = 0;
          const checkInterval = 100;
          const maxWait = 2500;
          
          const intervalId = setInterval(() => {
            elapsed += checkInterval;
            
            // Check if any registration now has wait/install or if an event was detected
            let hasPendingOrInstalling = updateEventDetected;
            for (const r of registrations) {
              if (r.waiting || r.installing) {
                hasPendingOrInstalling = true;
              }
            }

            if (hasPendingOrInstalling || (window as any).__pwaNeedRefresh === true) {
              clearInterval(intervalId);
              cleanup();
              console.log("Service Worker check completed: Update detected!");
              resolve(true);
              return;
            }

            if (elapsed >= maxWait) {
              clearInterval(intervalId);
              cleanup();
              console.log("Service Worker check completed: No update found within timeout.");
              resolve(false);
              return;
            }
          }, checkInterval);

          const cleanup = () => {
            cleanupFns.forEach(fn => fn());
          };

        } catch (e) {
          console.error("Manual service worker check failed:", e);
          resolve(false);
        }
      });
    };
    return () => {
      delete (window as any).__showReloadPrompt;
      delete (window as any).__checkAppUpdate;
      delete (window as any).__pwaNeedRefresh;
    };
  }, [setNeedRefresh, needRefresh]);

  const handleUpdate = async () => {
    setIsUpdating(true);
    if (onUpdate) {
      try {
        await onUpdate();
      } catch (e) {
        console.error("onUpdate failed", e);
      }
    }
    
    setTimeout(async () => {
        try {
            // Force skipWaiting and claiming on any currently waiting sw registration
            const registrations = await navigator.serviceWorker?.getRegistrations();
            if (registrations && registrations.length > 0) {
              for (const r of registrations) {
                if (r.waiting) {
                  r.waiting.postMessage({ type: 'SKIP_WAITING' });
                }
              }
            }
        } catch (e) {
            console.error("Direct skip waiting failed", e);
        }

        try {
            // updateServiceWorker with true forces a full page reload, installing and activating
            await updateServiceWorker(true);
        } catch(e) {
            console.error("SW Update fail", e);
        }

        setIsUpdating(false);
        setUpdateSuccess(true);
        localStorage.setItem('pwa_just_updated', 'true');
        localStorage.setItem('app_version', 'v1.0.5');

        // Dispatch custom event to notify Hub / Profile and other parts of the app
        window.dispatchEvent(new CustomEvent('pwa-app-updated'));

        // Display immediate toast
        showAppToast(t('App has been updated.'));

        // Reset state after a few seconds of displaying success checkmark
        setTimeout(() => {
          setNeedRefresh(false);
          setUpdateSuccess(false);
        }, 4000);
    }, 1500);
  };

  return (
    <AnimatePresence>
      {needRefresh && (
        <motion.div
           initial={{ opacity: 0, y: 20 }}
           animate={{ opacity: 1, y: 0 }}
           exit={{ opacity: 0, scale: 0.95 }}
           className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-6 sm:bottom-6 sm:w-85 md:w-96 pointer-events-auto z-[9999999] bg-[#0c0c0e]/95 backdrop-blur-md border border-neutral-800/80 p-4 rounded-xl shadow-[0_12px_40px_rgba(0,0,0,0.6)] text-white pb-[calc(1rem+env(safe-area-inset-bottom))]"
        >
          {isUpdating ? (
            <div className="flex items-center gap-3 text-sm flex-1 py-1">
              <RefreshCw size={16} className="animate-spin text-cyan-400"/>
              <span className="text-white font-medium">{t('Updating...')}</span>
            </div>
          ) : updateSuccess ? (
            <div className="flex items-center gap-3 text-sm flex-1 py-1">
              <CheckCircle2 size={16} className="text-emerald-500 font-bold animate-bounce" />
              <span className="text-white font-medium">{t('App has been updated.')}</span>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex gap-2.5 text-sm flex-1">
                  <Sparkles size={16} className="text-cyan-400 shrink-0 mt-0.5" />
                  <div className="text-left">
                    <p className="font-bold text-white text-xs">{t('Update Available')}</p>
                    <p className="text-[10px] text-zinc-400 mt-0.5 leading-relaxed">{t('A new version with performance improvements is ready.')}</p>
                  </div>
                </div>
                <button 
                  onClick={() => setNeedRefresh(false)}
                  className="p-1 rounded-full hover:bg-white/5 text-zinc-500 hover:text-white transition-colors"
                >
                  <X size={14} />
                </button>
              </div>
              <div className="flex justify-end gap-2 pt-0.5">
                <button
                  onClick={handleUpdate}
                  className="px-3.5 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-black font-black text-[10px] uppercase tracking-wider rounded-lg transition-colors flex items-center gap-1.5 shadow-md shadow-cyan-900/10 cursor-pointer select-none"
                >
                  <RefreshCw size={11} className="animate-[spin_4s_linear_infinite]" />
                  {t('Update now')}
                </button>
              </div>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
};
