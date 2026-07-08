export const determineActiveBackend = async (): Promise<string> => {
  const candidates: string[] = [];

  // 1. Add env VITE_API_URL if configured
  if (import.meta.env.VITE_API_URL) {
    candidates.push(import.meta.env.VITE_API_URL.replace(/\/+$/, ''));
  }

  // 2. Add current window origin if on standard staging/Vercel/prod host (starts with http/https)
  if (typeof window !== 'undefined' && window.location && window.location.origin) {
    const origin = window.location.origin;
    if (origin.startsWith('http')) {
      const isLocalhostDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      // If it's Vercel, staging, or dev on the standard 3000 port, test this origin first
      if (!isLocalhostDev || window.location.port === '3000') {
        candidates.push(origin);
      }
    }
  }

  // 3. Cloud Run sandboxes as fallbacks
  const devUrl = 'https://ais-dev-typgj764yfxch2imrke632-28730033374.europe-west2.run.app';
  const preUrl = 'https://ais-pre-typgj764yfxch2imrke632-28730033374.europe-west2.run.app';
  candidates.push(devUrl);
  candidates.push(preUrl);

  const testUrl = async (url: string): Promise<boolean> => {
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 1500);
      const res = await fetch(`${url}/api/health`, { signal: controller.signal });
      clearTimeout(id);
      if (res.ok) return true;
    } catch (_) {}
    return false;
  };

  // Test candidates in order and cache the first active one
  for (const url of candidates) {
    const ok = await testUrl(url);
    if (ok) {
      localStorage.setItem('determined_backend_url', url);
      console.log('[API] Determined active backend:', url);
      return url;
    }
  }

  return '';
};

export const getBackendApiUrl = (path: string): string => {
  let baseUrl = import.meta.env.VITE_API_URL?.replace(/\/+$/, '') || '';
  
  if (!baseUrl) {
    const cached = localStorage.getItem('determined_backend_url');
    if (cached) {
      baseUrl = cached;
    } else {
      const isMobile = window.location.protocol === 'file:' || 
                       window.location.protocol === 'capacitor:' || 
                       window.location.protocol === 'ionic:' || 
                       (window.location.hostname === 'localhost' && window.location.port !== '3000' && window.location.port !== '5173');
                     
      const isStagingOrVercel = window.location.hostname.includes('vercel.app') || 
                                window.location.hostname.includes('github.io') ||
                                (window.location.hostname !== 'localhost' && !window.location.hostname.endsWith('run.app'));

      if (isMobile) {
        // Fallback default for native wrapper when offline/not-yet-cached
        baseUrl = 'https://ais-pre-typgj764yfxch2imrke632-28730033374.europe-west2.run.app';
      } else if (isStagingOrVercel) {
        // On Vercel or other external static hosting, the backend is hosted on Cloud Run
        baseUrl = 'https://ais-pre-typgj764yfxch2imrke632-28730033374.europe-west2.run.app';
      } else {
        baseUrl = window.location.origin;
      }
    }
  }

  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${baseUrl}${cleanPath}`;
};

