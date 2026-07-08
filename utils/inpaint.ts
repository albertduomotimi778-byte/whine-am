export async function fastInpaint(originalImageUri: string, maskImageUri: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const imgOrig = new Image();
        const imgMask = new Image();
        let loaded = 0;
        const onload = () => {
            loaded++;
            if (loaded === 2) {
                processInpaint();
            }
        };
        imgOrig.onload = onload;
        imgOrig.onerror = reject;
        imgMask.onload = onload;
        imgMask.onerror = reject;
        imgOrig.src = originalImageUri;
        imgMask.src = maskImageUri;

        function processInpaint() {
            const canvas = document.createElement('canvas');
            const w = imgOrig.width;
            const h = imgOrig.height;
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d')!;
            
            // Draw original
            ctx.drawImage(imgOrig, 0, 0);
            const origData = ctx.getImageData(0, 0, w, h);
            
            // Get mask
            ctx.clearRect(0, 0, w, h);
            ctx.drawImage(imgMask, 0, 0);
            const maskData = ctx.getImageData(0, 0, w, h);
            
            const pxOrig = origData.data;
            const pxMask = maskData.data;
            
            const isHole = new Uint8Array(w * h);
            for (let i = 0; i < w * h; i++) {
                if (pxMask[i * 4 + 3] > 10) { // If foreground exists here
                    isHole[i] = 1;
                    // Clear the pixel in the original, we will fill it
                    pxOrig[i * 4] = 0;
                    pxOrig[i * 4 + 1] = 0;
                    pxOrig[i * 4 + 2] = 0;
                    pxOrig[i * 4 + 3] = 0;
                }
            }
            
            // Fast inpainting via multi-pass inward extrapolation (distance-based blur)
            const MAX_PASSES = Math.max(w, h); // Max possible distance
            let pass = 0;
            
            // Two buffers to avoid directional bias during a single pass
            const tempPx = new Uint8Array(pxOrig);
            const tempHole = new Uint8Array(isHole);
            
            while (pass < MAX_PASSES) {
                let filledInPass = 0;
                for (let y = 0; y < h; y++) {
                    for (let x = 0; x < w; x++) {
                        const idx = y * w + x;
                        if (isHole[idx] === 1) {
                            let r = 0, g = 0, b = 0, a = 0, count = 0;
                            
                            // Check 8 neighbors in original buffer
                            const neighbors = [
                                [-1, -1], [0, -1], [1, -1],
                                [-1, 0],           [1, 0],
                                [-1, 1],  [0, 1],  [1, 1]
                            ];
                            
                            for (const [dx, dy] of neighbors) {
                                const nx = x + dx;
                                const ny = y + dy;
                                if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
                                    const nIdx = ny * w + nx;
                                    // if neighbor is NOT a hole, we can sample it
                                    if (isHole[nIdx] === 0) {
                                        const pxIdx = nIdx * 4;
                                        r += pxOrig[pxIdx];
                                        g += pxOrig[pxIdx + 1];
                                        b += pxOrig[pxIdx + 2];
                                        a += pxOrig[pxIdx + 3];
                                        count++;
                                    }
                                }
                            }
                            
                            if (count > 0) {
                                const pxIdx = idx * 4;
                                tempPx[pxIdx] = r / count;
                                tempPx[pxIdx + 1] = g / count;
                                tempPx[pxIdx + 2] = b / count;
                                tempPx[pxIdx + 3] = a / count; // maintain alpha roughly
                                tempHole[idx] = 0; // Marked as filled
                                filledInPass++;
                            }
                        }
                    }
                }
                
                // Copy back
                pxOrig.set(tempPx);
                isHole.set(tempHole);
                
                if (filledInPass === 0) break;
                pass++;
            }
            
            ctx.putImageData(origData, 0, 0);
            resolve(canvas.toDataURL('image/png'));
        }
    });
}
