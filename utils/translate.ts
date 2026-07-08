export function applyLanguageConstraint(language: string) {
  const langMap: Record<string, string> = {
    "English": "en",
    "Mandarin (Chinese)": "zh-CN",
    "Spanish": "es",
    "Hindi": "hi",
    "Arabic": "ar",
    "Bengali": "bn",
    "Portuguese": "pt",
    "Russian": "ru",
    "Japanese": "ja",
    "French": "fr",
    "German": "de",
    "Urdu": "ur",
    "Korean": "ko",
    "Italian": "it",
    "Turkish": "tr"
  };

  const targetLang = langMap[language] || "en";
  const expectedCookie = targetLang === 'en' ? null : `/en/${targetLang}`;

  const getCookie = (name: string) => {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop()?.split(';').shift() || null;
    return null;
  };

  const currentCookie = getCookie('googtrans');

  const setCookies = (lang: string) => {
    document.cookie = `googtrans=/en/${lang}; path=/`;
    document.cookie = `googtrans=/en/${lang}; domain=${location.hostname}; path=/`;
    document.cookie = `googtrans=/en/${lang}; domain=.${location.hostname}; path=/`;
  };

  const clearCookies = () => {
    document.cookie = "googtrans=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
    document.cookie = "googtrans=; expires=Thu, 01 Jan 1970 00:00:00 UTC; domain=" + location.hostname + "; path=/;";
    document.cookie = "googtrans=; expires=Thu, 01 Jan 1970 00:00:00 UTC; domain=." + location.hostname + "; path=/;";
  };

  // If the cookie doesn't match our expected target language, update it and reload
  if (currentCookie !== expectedCookie) {
    if (targetLang === 'en') {
      clearCookies();
    } else {
      setCookies(targetLang);
    }
    // Prevent infinite reload loop by checking if we successfully set/cleared the cookie
    // Sometimes cookies are stubborn on weird domains, so we do a quick check
    if (getCookie('googtrans') !== currentCookie) {
       window.location.reload();
       return;
    }
  }

  // If we reach here, the cookie is correct. 
  // If we need a non-English language, ensure the script is injected
  if (targetLang !== "en") {
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
  }
}

