import { toast } from 'sonner';

export function showAppToast(message: string) {
    toast(message);
}

export function subscribeToToast(callback: (message: string) => void) {
    // Deprecated: We use sonner now directly.
    // Keeping this for backward compatibility if needed, but it shouldn't be used for showing UI.
    const handler = (e: any) => callback(e.detail);
    window.addEventListener('show-app-toast', handler as EventListener);
    return () => window.removeEventListener('show-app-toast', handler as EventListener);
}

