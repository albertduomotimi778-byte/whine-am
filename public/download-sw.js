const fileMap = new Map();

self.addEventListener('install', (event) => {
    self.skipWaiting(); // Activate immediately
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim()); // Take control of all pages
});

self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'STORE_BLOB') {
        fileMap.set(event.data.id, { blob: event.data.blob, filename: event.data.filename });
        // Reply back to acknowledge
        if (event.ports && event.ports[0]) {
            event.ports[0].postMessage({ status: 'ok' });
        }
    }
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    if (url.pathname.startsWith('/__sw_download__/')) {
        const id = url.pathname.replace('/__sw_download__/', '');
        if (fileMap.has(id)) {
            const { blob, filename } = fileMap.get(id);
            const headers = new Headers();
            
            // Clean filename to prevent header injection
            const safeName = filename.replace(/[^\w\.\-\s]/g, '_');
            
            headers.append('Content-Disposition', `attachment; filename="${safeName}"`);
            headers.append('Content-Type', blob.type || 'application/octet-stream');
            
            // Tell browser its safe to cache/download
            headers.append('Cache-Control', 'no-store, no-cache, must-revalidate');

            event.respondWith(new Response(blob, { headers }));
            
            // Cleanup memory after giving the browser time to download
            setTimeout(() => {
                fileMap.delete(id);
            }, 60000); // 1 minute
            return;
        }
    }
});
