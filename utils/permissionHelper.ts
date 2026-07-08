export const requestAllPermissions = async () => {
    // 1. Notify the Native Wrapper to ask for Android/iOS permissions explicitly
    try {
        if (typeof (window as any).AndroidWrapper !== 'undefined') {
            if ((window as any).AndroidWrapper.requestPermissions) {
                (window as any).AndroidWrapper.requestPermissions("camera,microphone,storage,nearby_devices");
            } else if ((window as any).AndroidWrapper.requestAllPermissions) {
                (window as any).AndroidWrapper.requestAllPermissions();
            }
        }
    } catch (e) {}

    try {
        if ((window as any).webkit?.messageHandlers?.iosWrapper?.postMessage) {
            (window as any).webkit.messageHandlers.iosWrapper.postMessage({
                action: 'requestPermissions',
                permissions: ['camera', 'microphone', 'storage', 'nearby_devices']
            });
        }
    } catch (e) {}

    try {
        window.parent.postMessage(JSON.stringify({
            action: 'request_permissions',
            payload: ['camera', 'microphone', 'storage', 'nearby_devices']
        }), '*');
    } catch (e) {}

    // 2. Trigger web APIs to force permission prompts (wrapped iOS/Android often routes these to native prompts)
    setTimeout(async () => {
        try {
            // Camera & Mic pre-ping removed to avoid hardware locking 'NotReadableError' on some devices.
        } catch (e) {}

        try {
            // Storage
            if (navigator.storage && navigator.storage.persist) {
                navigator.storage.persist().catch(() => {});
            }
        } catch (e) {}
    }, 1000); // Small delay to let app load first
};
