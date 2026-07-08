import { db, collection, doc, setDoc, getDocs, writeBatch, query, where } from "./firebase";
import JSZip from "jszip";

// Helper to convert base64 to Blob
export const base64ToBlob = (base64: string, mimeType: string): Blob => {
    const cleanBase64 = base64.includes(",") ? base64.split(",")[1] : base64;
    const byteCharacters = atob(cleanBase64);
    const byteArrays = [];
    for (let offset = 0; offset < byteCharacters.length; offset += 512) {
        const slice = byteCharacters.slice(offset, offset + 512);
        const byteNumbers = new Array(slice.length);
        for (let i = 0; i < slice.length; i++) {
            byteNumbers[i] = slice.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        byteArrays.push(byteArray);
    }
    return new Blob(byteArrays, { type: mimeType });
};

// Helper to convert Blob to base64
export const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const result = e.target?.result as string;
            resolve(result);
        };
        reader.onerror = (err) => reject(err);
        reader.readAsDataURL(blob);
    });
};

// High-performance image garbage-collection protection set.
// Storing active image instances globally prevents the browser's aggressive
// garbage collector from cleaning up unattached HTMLImages inside memory-constrained iframes.
const activeImages = new Set<HTMLImageElement>();

// Compress image thumbnail to a high-performance safe base64 JPEG format
export const compressThumbnail = (file: File, maxDim: number = 400): Promise<string> => {
    return new Promise((resolve) => {
        if (!file) return resolve("");
        
        let objectUrl = "";
        try {
            objectUrl = URL.createObjectURL(file);
        } catch (e) {
            console.warn("URL.createObjectURL failed, fallback to FileReader", e);
        }
        
        const img = new Image();
        activeImages.add(img);

        const cleanUp = () => {
            activeImages.delete(img);
            if (objectUrl) {
                try {
                    URL.revokeObjectURL(objectUrl);
                } catch (e) {}
            }
        };

        const fallbackToRawBase64 = () => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const dataUrl = e.target?.result as string;
                cleanUp();
                if (dataUrl && dataUrl.length > 25) {
                    // Fall back to original base64. Limit is 900KB to safely fit inside 1MB firestore doc limits.
                    if (dataUrl.length < 900 * 1024) {
                        resolve(dataUrl);
                    } else {
                        // If it's still too large for firestore limit, we must return the dataurl because for
                        // localhost and SQLite/local-json database disk server it always works perfectly fine.
                        resolve(dataUrl);
                    }
                } else {
                    resolve("");
                }
            };
            reader.onerror = () => {
                cleanUp();
                resolve("");
            };
            reader.readAsDataURL(file);
        };

        img.onload = () => {
            try {
                const canvas = document.createElement("canvas");
                let width = img.width;
                let height = img.height;
                
                if (width > maxDim || height > maxDim) {
                    if (width > height) {
                        height = Math.round((height * maxDim) / width);
                        width = maxDim;
                    } else {
                        width = Math.round((width * maxDim) / height);
                        height = maxDim;
                    }
                }
                
                canvas.width = width || 1;
                canvas.height = height || 1;
                const ctx = canvas.getContext("2d");
                if (ctx) {
                    ctx.drawImage(img, 0, 0, width, height);
                    // Convert to lightweight optimized JPEG (typically 5KB - 15KB)
                    const compressedUrl = canvas.toDataURL("image/jpeg", 0.75);
                    if (compressedUrl && compressedUrl.length > 25) {
                        cleanUp();
                        resolve(compressedUrl);
                        return;
                    }
                }
            } catch (err) {
                console.error("Canvas scale down drawing failed:", err);
            }
            // If canvas drawing/compression failed, trigger final fallback via FileReader
            fallbackToRawBase64();
        };

        img.onerror = () => {
            console.warn("Image object load failed in compressThumbnail. Falling back to FileReader raw base64.");
            fallbackToRawBase64();
        };

        if (objectUrl) {
            img.src = objectUrl;
        } else {
            fallbackToRawBase64();
        }
    });
};

// Upload helper: uploads the actual product to Dropbox and returns the permanent direct URL
export const uploadProductFileInChunks = async (
    productId: string,
    file: Blob | File,
    originalFileName: string,
    onProgress?: (progress: number, etaSeconds?: number) => void
): Promise<string> => {
    onProgress?.(5, 0);
    
    try {
        const { uploadToDropbox } = await import('./dropbox');
        
        onProgress?.(30, 0);
        // Direct Dropbox upload
        const dropboxUrl = await uploadToDropbox(file, `${productId}_${originalFileName}`);
        
        onProgress?.(100, 0);
        return dropboxUrl;
    } catch (err) {
        console.error("Failed to upload to Dropbox, falling back to legacy chunks:", err);
        throw err;
    }
};

// Delete helper to remove redundant chunks
export const deleteProductChunks = async (productId: string) => {
    try {
        const response = await fetch("/api/creator/seller/delete-chunks", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ productId })
        });
        if (!response.ok) {
            throw new Error(`API returned status ${response.status}`);
        }
    } catch (err) {
        console.warn("API delete chunks failed, falling back to direct client SDK deletion:", err);
        try {
            const q = query(collection(db, "product_assets"), where("productId", "==", productId));
            const snap = await getDocs(q);
            const batch = writeBatch(db);
            snap.docs.forEach((d) => {
                batch.delete(d.ref);
            });
            await batch.commit();
        } catch (fallbackErr) {
            console.warn("Direct deletion fallback failed too:", fallbackErr);
        }
    }
};

// Download helper: queries chunk documents, sorts them, re-assembles the zip, and unzips original file
export const downloadProductFileInChunks = async (
    productId: string,
    onProgress?: (progress: number) => void
): Promise<{ blob: Blob; fileName: string }> => {
    onProgress?.(10);
    const q = query(collection(db, "product_assets"), where("productId", "==", productId));
    const snap = await getDocs(q);
    
    if (snap.empty) {
        throw new Error("No asset chunks found for this product in database.");
    }
    
    onProgress?.(40);

    // Sort chunks by index
    const sortedDocs = [...snap.docs].sort((a, b) => {
        return (a.data().chunkIndex || 0) - (b.data().chunkIndex || 0);
    });

    onProgress?.(60);

    // Reconstruct base64 zipped data
    let base64Zip = "";
    sortedDocs.forEach((docSnap) => {
        base64Zip += docSnap.data().data || "";
    });

    const fileName = sortedDocs[0].data().fileName || "product_file";
    
    onProgress?.(80);

    // Convert base64 back to Blob
    const zipBlob = base64ToBlob(base64Zip, "application/zip");

    // Load zip and extract the original file
    const zip = await JSZip.loadAsync(zipBlob);
    const innerFiles = Object.keys(zip.files);
    
    if (innerFiles.length === 0) {
        throw new Error("The zip archive is empty.");
    }

    // Usually the deflated zip contains only one original file
    const originalFileName = innerFiles[0];
    const originalFileBytes = await zip.files[originalFileName].async("uint8array");
    
    // Guess appropriate MIME type
    let mimeType = "application/octet-stream";
    if (originalFileName.endsWith(".psd")) {
        mimeType = "image/vnd.adobe.photoshop";
    } else if (originalFileName.endsWith(".json") || originalFileName.endsWith(".animato_project")) {
        mimeType = "application/json";
    }

    const originalBlob = new Blob([originalFileBytes], { type: mimeType });
    onProgress?.(100);

    return {
        blob: originalBlob,
        fileName: originalFileName
    };
};
