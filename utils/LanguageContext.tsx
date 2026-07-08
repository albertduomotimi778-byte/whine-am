import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { translations } from './translations';

type LanguageContextType = {
  language: string;
  setLanguage: (lang: string) => void;
  t: (text: string) => string;
};

const LanguageContext = createContext<LanguageContextType>({
  language: 'English',
  setLanguage: () => {},
  t: (text) => text,
});

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguage] = useState('English');
  const prevLanguageRef = React.useRef<string | undefined>();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSetLanguage = (lang: string) => {
    if (!navigator.onLine && lang !== 'English') {
      setErrorMsg(`Internet connection is required to translate to ${lang}.`);
      setTimeout(() => setErrorMsg(null), 3000);
      return;
    }
    setLanguage(lang);
  };

  useEffect(() => {
    const pref = localStorage.getItem('app_language_preference');
    if (pref) {
      setLanguage(pref);
    } else {
      const userStr = localStorage.getItem('app_user');
      if (userStr) {
        try {
          const u = JSON.parse(userStr);
          if (u.language) {
            setLanguage(u.language);
          }
        } catch (e) {}
      }
    }
  }, []);

  useEffect(() => {
    prevLanguageRef.current = language;

    localStorage.setItem('app_language_preference', language);
    
    // Also update logged in user object if it exists
    const userStr = localStorage.getItem('app_user');
    if (userStr) {
      try {
        const u = JSON.parse(userStr);
        if (u.language !== language) {
          u.language = language;
          localStorage.setItem('app_user', JSON.stringify(u));
        }
      } catch (e) {}
    }
  }, [language]);

  useEffect(() => {
    // Revert logic for English
    if (language === 'English') {
      const resetGoogle = () => {
        try {
          // 1. Try clicking the "Show Original" button in the Google Translate banner
          const iframe = document.querySelector('iframe.goog-te-banner-frame');
          if (iframe) {
            const innerDoc = (iframe as any).contentDocument || (iframe as any).contentWindow?.document;
            const btn = innerDoc?.querySelector('.goog-te-button button') || innerDoc?.querySelector('#\\:1\\.restore');
            if (btn) btn.click();
            iframe.remove();
          }
          
          // 2. Try setting the combo box back to English/Select Language
          const select = document.querySelector('.goog-te-combo') as HTMLSelectElement;
          if (select) {
            if (select.value !== 'en' && select.value !== '') {
              select.value = 'en';
              select.dispatchEvent(new Event('change'));
            }
          }

          // 3. Remove classes and styles injected by Google Translate
          document.documentElement.classList.remove('translated-ltr', 'translated-rtl');
          document.body.classList.remove('translated-ltr', 'translated-rtl');
          document.documentElement.style.height = '';
          document.body.style.top = '0px';
          document.body.style.position = '';
          
          // 4. Remove all elements that might be sticky
          document.querySelectorAll('.goog-te-spinner-pos, .goog-te-banner, .goog-te-balloon, .goog-te-mask').forEach(el => el.remove());

          // 5. Clear googtrans cookies more aggressively
          const domains = [window.location.hostname, "." + window.location.hostname, ".google.com", ""];
          const paths = ["/", "/studio", "/project-manager"]; 
          domains.forEach(domain => {
            paths.forEach(path => {
              const domainStr = domain ? `; domain=${domain}` : "";
              document.cookie = `googtrans=; expires=Thu, 01 Jan 1970 00:00:01 GMT; path=${path}${domainStr}`;
              document.cookie = `googtrans=; expires=Thu, 01 Jan 1970 00:00:01 GMT; path=${path}`;
            });
          });
        } catch(e) {}
      };

    resetGoogle();
    const interval = setInterval(resetGoogle, 1000);
    const timeout = setTimeout(() => clearInterval(interval), 5000);

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }

    const langMap: Record<string, string> = {
      "Mandarin (Chinese)": "zh-CN", "Spanish": "es", "Hindi": "hi", "Arabic": "ar",
      "Bengali": "bn", "Portuguese": "pt", "Russian": "ru", "Japanese": "ja", 
      "French": "fr", "German": "de", "Urdu": "ur", "Korean": "ko", 
      "Italian": "it", "Turkish": "tr", "English": "en"
    };

    const targetCode = langMap[language];
    if (!targetCode) return;

    if (language === 'English') {
      try {
        const domains = [window.location.hostname, "." + window.location.hostname, ".google.com", ""];
        const paths = ["/", "/studio", "/project-manager"]; 
        domains.forEach(domain => {
          paths.forEach(path => {
            const domainStr = domain ? `; domain=${domain}` : "";
            document.cookie = `googtrans=; expires=Thu, 01 Jan 1970 00:00:01 GMT; path=${path}${domainStr}`;
            document.cookie = `googtrans=; expires=Thu, 01 Jan 1970 00:00:01 GMT; path=${path}`;
          });
        });
        localStorage.removeItem('googtrans');
      } catch (e) {}
    }

    // Load script if not present
    if (!document.getElementById('google-translate-script')) {
      const script = document.createElement('script');
      script.id = 'google-translate-script';
      script.src = "https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit";
      
      (window as any).googleTranslateElementInit = () => {
        new (window as any).google.translate.TranslateElement({
          pageLanguage: 'en',
          includedLanguages: Object.values(langMap).join(','),
          autoDisplay: false
        }, 'google_translate_element');
      };

      const div = document.createElement('div');
      div.id = 'google_translate_element';
      div.style.display = 'none';
      document.body.appendChild(div);
      document.body.appendChild(script);
    }

    // Attempt to trigger translation
    const triggerTranslation = () => {
       const select = document.querySelector('.goog-te-combo') as HTMLSelectElement;
       if (select && select.value !== targetCode) {
           select.value = language === 'English' ? '' : targetCode;
           select.dispatchEvent(new Event('change'));
       }
    };

    const tryTrigger = setInterval(() => {
        const select = document.querySelector('.goog-te-combo') as HTMLSelectElement;
        if (select) {
            triggerTranslation();
            clearInterval(tryTrigger);
        }
    }, 50);

    // Watch for dynamic DOM additions and re-trigger translation
    let debounceTimer: any;
    const observer = new MutationObserver((mutations) => {
        if (language === 'English') return;

        let shouldTrigger = false;
        // Optimization: Peak at only few mutations if there are many to avoid blocking
        const limit = Math.min(mutations.length, 50);
        for (let i = 0; i < limit; i++) {
            const mutation = mutations[i];
            if (mutation.type === 'childList') {
                for (let j = 0; j < mutation.addedNodes.length; j++) {
                    const node = mutation.addedNodes[j];
                    if (node.nodeType === 1) { // Element node
                        const el = node as HTMLElement;
                        if (el.tagName.toLowerCase() === 'font' || el.classList.contains('goog-te-spinner-pos') || el.classList.contains('skiptranslate') || el.id === 'goog-gt-tt' || el.tagName.toLowerCase() === 'iframe') {
                            continue;
                        }
                        shouldTrigger = true;
                        break;
                    }
                }
            }
            if (shouldTrigger) break;
        }

        if (shouldTrigger) {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                const select = document.querySelector('.goog-te-combo') as HTMLSelectElement;
                if (select && select.value !== targetCode) {
                    select.value = targetCode;
                    select.dispatchEvent(new Event('change'));
                }
            }, 50); // Near-instant responsiveness
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
        clearInterval(tryTrigger);
        clearTimeout(debounceTimer);
        observer.disconnect();
    };
  }, [language]);

  const t = useCallback((text: string) => {
    // Using local dictionary as fallback or instant translation before Google kicks in
    if (language === 'English' || !language) return text;
    const langDict = translations[language];
    if (langDict && langDict[text]) {
      return langDict[text];
    }
    return text;
  }, [language]);

  const contextValue = React.useMemo(() => ({ 
    language, 
    setLanguage: handleSetLanguage, 
    t 
  }), [language, handleSetLanguage, t]);

  return (
    <LanguageContext.Provider value={contextValue}>
      {children}
      {errorMsg && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[99999] pointer-events-none">
          <div className="bg-[#111]/95 backdrop-blur-xl border border-red-500/30 shadow-[0_0_30px_rgba(255,0,0,0.2)] text-red-400 px-8 py-3 rounded-full flex items-center gap-3 animate-in slide-in-from-top-4 zoom-in-95 fade-in duration-300">
            <div className="w-2 h-2 rounded-full bg-red-500 shadow-[0_0_10px_currentColor] animate-pulse"></div>
            <span className="text-[10px] font-black tracking-[0.2em] uppercase">{errorMsg}</span>
          </div>
        </div>
      )}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => useContext(LanguageContext);
