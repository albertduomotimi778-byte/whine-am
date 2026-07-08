/**
 * Converts a Blob to a Data URL (Base64). 
 */
export const blobToDataURL = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target?.result as string);
        reader.onerror = (e) => reject(e);
        reader.readAsDataURL(blob);
    });
};

/**
 * Get accurate MIME-type based on file extension
 */
const getMimeTypeByExtension = (filename: string, defaultType: string = 'application/octet-stream'): string => {
    const ext = filename.toLowerCase().split('.').pop() || '';
    switch (ext) {
        case 'psd':
            return 'image/vnd.adobe.photoshop';
        case 'animato_project':
        case 'json':
            return 'application/json';
        case 'zip':
            return 'application/zip';
        case 'mp4':
            return 'video/mp4';
        case 'webm':
            return 'video/webm';
        case 'gif':
            return 'image/gif';
        case 'png':
            return 'image/png';
        case 'jpg':
        case 'jpeg':
            return 'image/jpeg';
        case 'webp':
            return 'image/webp';
        default:
            return defaultType;
    }
};

/**
 * Appends filename safely within the pathname of the URL before query parameters
 * to guarantee that mobile/WebView download managers respect the original file and naming format.
 */
const appendFilenameToUrlPath = (url: string, filename: string): string => {
    try {
        const base = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
        const urlObj = new URL(url, base);
        let pathname = urlObj.pathname;
        
        if (pathname === '/api/store/download/unified' || 
            pathname === '/api/store/download' || 
            pathname === '/api/download-temp-retrieve') {
            urlObj.pathname = `${pathname}/${encodeURIComponent(filename)}`;
        }
        
        if (url.startsWith('/')) {
            return urlObj.pathname + urlObj.search + urlObj.hash;
        }
        return urlObj.href;
    } catch (e) {
        console.warn("[appendFilenameToUrlPath] Failed to parse URL:", e);
        return url;
    }
};

/**
 * Advanced download logic incorporating native bridge extraction, web share api, and fallback.
 */
export const triggerDownload = async (blobOrUrl: Blob | string, filename: string, directUrl?: string) => {
    const cleanName = filename.trim().replace(/[<>:"/\\|?*]/g, '_'); 

    // 0. Handle direct URLs using direct URL routing if provided
    if (directUrl && typeof window !== 'undefined') {
        let resolvedUrl = directUrl;
        if (directUrl.startsWith('/')) {
            resolvedUrl = window.location.origin + directUrl;
        }
        
        // Inject filename parameter into the path for perfect format mapping on mobile web/native wrapper loaders
        resolvedUrl = appendFilenameToUrlPath(resolvedUrl, cleanName);
        
        const isNativeWrapper = /Capacitor|Cordova/i.test(navigator.userAgent) 
                                || (window as any).ReactNativeWebView 
                                || !!(window as any).Capacitor 
                                || !!(window as any).cordova;
        const isIframe = window.parent && window.parent !== window;
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        
        if (isNativeWrapper || isIframe || isMobile) {
            console.log("[triggerDownload] Resolving directly via directUrl:", resolvedUrl);
            
            // Send notice to ReactNativeWebView
            if ((window as any).ReactNativeWebView && typeof (window as any).ReactNativeWebView.postMessage === 'function') {
                try {
                    (window as any).ReactNativeWebView.postMessage(JSON.stringify({
                        type: "DOWNLOAD_URL",
                        filename: cleanName,
                        url: resolvedUrl
                    }));
                } catch (e) {
                    console.error("Failed to post message for DOWNLOAD_URL:", e);
                }
            }
            
            // Direct native/browser redirect download handles attachment headers cleanly with 0% memory overhead!
            window.location.href = resolvedUrl;
            return;
        }
    }

    // Handle generic string URLs natively via anchor tag
    if (typeof blobOrUrl === 'string' && !blobOrUrl.startsWith('blob:')) {
        const link = document.createElement('a');
        link.href = `${blobOrUrl}#/download/${encodeURIComponent(cleanName)}`;
        link.download = cleanName;
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        setTimeout(() => { if (document.body.contains(link)) document.body.removeChild(link); }, 3000);
        return;
    }

    let blob: Blob;
    if (typeof blobOrUrl === 'string') {
        try {
            const response = await fetch(blobOrUrl);
            blob = await response.blob();
        } catch (e) {
            blob = new Blob(); 
        }
    } else {
        blob = blobOrUrl;
    }

    if (blob.size === 0) {
        console.warn("[triggerDownload] Empty blob provided.");
        return;
    }

    // Cache the base64 translation to prevent CPU and Memory thrashing on mobile browsers/WebViews
    let cachedBase64: string | null = null;
    const getBase64Data = async (): Promise<string> => {
        if (cachedBase64 !== null) return cachedBase64;
        cachedBase64 = await blobToDataURL(blob);
        return cachedBase64;
    };

    // 1. The Native Bridge fallback
    if (typeof window !== 'undefined') {
        const isNativeWrapper = /Capacitor|Cordova/i.test(navigator.userAgent) 
                                || (window as any).ReactNativeWebView 
                                || !!(window as any).Capacitor 
                                || !!(window as any).cordova;
        
        // Only convert to Base64 if we are actually writing to a native bridge, and file size is reasonably small
        if (isNativeWrapper && blob.size < 12 * 1024 * 1024) { // keep payload size safe for bridge
            try {
                const base64Data = await getBase64Data();
                const payload = {
                    type: "DOWNLOAD_FILE",
                    filename: cleanName,
                    data: base64Data
                };
                const payloadStr = JSON.stringify(payload);
                let bridgeUsed = false;
                
                if ((window as any).ReactNativeWebView && typeof (window as any).ReactNativeWebView.postMessage === 'function') {
                    (window as any).ReactNativeWebView.postMessage(payloadStr);
                    bridgeUsed = true;
                }

                // Also notify general window/parent context for cordova/capacitor wrappers that intercept standard message flows
                try {
                    window.postMessage(payload, '*');
                    if (window.parent && window.parent !== window) {
                        window.parent.postMessage(payload, '*');
                    }
                } catch (pe) {
                    // Ignore serializability exceptions
                }
                
                if (bridgeUsed) return;
            } catch(e) {
                console.log("Native bridge extraction failed", e);
            }
        }

        // Send warning/tracking postMessage to preview parent if inside iframe, but DO NOT block standard user download
        if (window.parent && window.parent !== window && blob.size < 5 * 1024 * 1024) {
            try {
                const base64Data = await getBase64Data();
                window.parent.postMessage(JSON.stringify({
                    type: "DOWNLOAD_FILE_IFRAME",
                    filename: cleanName,
                    data: base64Data
                }), '*');
            } catch (e) {
                // ignore
            }
        }
    }

    // Wrap Blob in File object 
    let fileObj: File;
    try {
        const ext = cleanName.toLowerCase().split('.').pop() || '';
        const isMedia = ['mp4', 'webm', 'mov', 'avi', 'gif', 'png', 'jpg', 'jpeg', 'webp', 'mp3', 'wav', 'aac'].includes(ext);
        
        // Non-media custom/document files (json, zip, psd, animato_project) are often blocked by navigator.canShare() whitelist check.
        // Wrapping them temporarily in 'text/plain' triggers perfect share-ability without changing the internal raw file bytes.
        let finalMimeType = blob.type || getMimeTypeByExtension(cleanName);
        if (finalMimeType === 'application/octet-stream' || !finalMimeType) {
            finalMimeType = getMimeTypeByExtension(cleanName);
        }
        
        const isCoreFormat = ['psd', 'animato_project', 'zip'].includes(ext);
        if (!isMedia && !isCoreFormat) {
            finalMimeType = 'text/plain';
        }
        
        fileObj = new File([blob], cleanName, { type: finalMimeType });
    } catch(e) {
        fileObj = blob as any;
        (fileObj as any).name = cleanName;
    }

    // 1.5. Server-assisted fallback for restricted WebViews and iframes ONLY when file is small enough (< 3MB) to prevent crash/lag
    if (typeof window !== 'undefined') {
        const isNativeWrapper = /Capacitor|Cordova/i.test(navigator.userAgent) 
                                || (window as any).ReactNativeWebView 
                                || !!(window as any).Capacitor 
                                || !!(window as any).cordova;
        const isIframe = window.parent && window.parent !== window;
        
        // CRITICAL OPTIMIZATION: Do not use slow POST-assisted file uploads for standard mobile browsers (which download blobs perfectly)
        // Also limit the size to < 3MB to prevent memory crashes on low-end mobile devices
        if ((isNativeWrapper || isIframe) && blob.size < 3 * 1024 * 1024) {
            try {
                const base64Data = await getBase64Data();
                const response = await fetch('/api/download-temp-store', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        filename: cleanName,
                        contentType: blob.type || 'application/octet-stream',
                        base64Data: base64Data
                    })
                });
                
                if (response.ok) {
                    const resData = await response.json();
                    if (resData && resData.id) {
                        const retrieveUrl = `/api/download-temp-retrieve/${encodeURIComponent(cleanName)}?id=${resData.id}`;
                        window.location.href = retrieveUrl;
                        console.log("[triggerDownload] Server-assisted native download redirect success:", retrieveUrl);
                        return;
                    }
                }
            } catch (err) {
                console.error("[triggerDownload] Server-assisted download failed, falling back to local...", err);
            }
        }
    }

    // 2. The Web Share API fallback
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    if (isMobile && typeof navigator !== 'undefined' && navigator.canShare && navigator.canShare({ files: [fileObj] })) {
        try {
            await navigator.share({
                files: [fileObj],
                title: cleanName,
            });
            return;
        } catch (e) {
            console.log("Share API fallback", e);
        }
    }

    // 3. Standard HTML Blob Download Fallback
    const blobUrl = URL.createObjectURL(fileObj);
    const downloadUrl = `${blobUrl}#/${encodeURIComponent(cleanName)}`;

    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = cleanName;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    
    setTimeout(() => { 
        if (document.body.contains(link)) document.body.removeChild(link); 
        URL.revokeObjectURL(blobUrl);
    }, 8000);
};
