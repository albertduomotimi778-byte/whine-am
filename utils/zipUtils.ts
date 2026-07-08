
import JSZip from 'jszip';
import { UnpackedImage } from '../types';

export { type UnpackedImage };

const getImageDimensions = (url: string): Promise<{ width: number, height: number }> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // MANDATORY FIX: Set CORS before setting src to prevent Tainted Canvas errors during export
    img.crossOrigin = "anonymous"; 
    img.onload = () => resolve({ width: img.width, height: img.height });
    img.onerror = reject;
    img.src = url;
  });
};

export async function processCharacterZip(file: File): Promise<UnpackedImage[]> {
  const zip = await JSZip.loadAsync(file);
  const imagePromises: Promise<UnpackedImage | null>[] = [];
  const imageRegex = /\.(png|jpe?g|webp|svg)$/i;

  zip.forEach((relativePath, zipEntry) => {
    if (!zipEntry.dir && imageRegex.test(relativePath)) {
      const promise = zipEntry.async('blob').then(async (blob) => {
        try {
          const url = URL.createObjectURL(blob);
          const { width, height } = await getImageDimensions(url);
          return {
            id: `zip-img-${Math.random().toString(36).substr(2, 9)}`,
            name: zipEntry.name,
            url,
            width,
            height,
          };
        } catch (e) {
          console.error("Failed to process image from zip:", zipEntry.name, e);
          return null;
        }
      });
      imagePromises.push(promise);
    }
  });

  const results = await Promise.all(imagePromises);
  
  return results.filter((result): result is UnpackedImage => result !== null);
}

export async function processCharacterFile(file: File): Promise<UnpackedImage[]> {
    const zipMimeTypes = ['application/zip', 'application/x-zip-compressed', 'application/octet-stream', 'multipart/x-zip'];
    const isZip = zipMimeTypes.includes(file.type) || 
                  file.name.toLowerCase().endsWith('.zip') || 
                  file.name.toLowerCase().endsWith('.animato') || 
                  file.name.toLowerCase().endsWith('.onyx');

    if (isZip) {
        try {
            return await processCharacterZip(file);
        } catch (e) {
            console.error("Not a valid ZIP, trying as image...", e);
        }
    }
    
    if (file.type.startsWith('image/') || /\.(png|jpe?g|webp|svg)$/i.test(file.name)) {
    // Handle single image
    const url = URL.createObjectURL(file);
    const { width, height } = await getImageDimensions(url);
    return [{
      id: `img-${Math.random().toString(36).substr(2, 9)}`,
      name: file.name,
      url,
      width,
      height,
    }];
  }
  return [];
}
