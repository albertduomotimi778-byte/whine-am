
import { get, set, del, keys } from 'idb-keyval';
import { CharacterComposition, Keyframe, LipSyncKeyframe, LightSource, VisemeShape, FrameData, ProjectType } from '../types';
import { showAppToast } from './toastHelper';
import { saveCloudProject } from './backend';

export interface ProjectMetadata {
    id: string;
    name: string;
    lastModified: number;
    thumbnail?: string; // Data URI
    version: string;
    projectType?: ProjectType; // New Field
    isCloud?: boolean; // Indicates if project is only located in the cloud but shown locally
}

export interface FrameSettings {
    width: number;
    height: number;
    fps: number;
    brushSettings?: { size: number; opacity: number; hardness: number };
    smoothing?: number;
    onionSkinSettings?: { prev: number; next: number; opacity: number };
    playbackSpeed?: number;
}

export interface FullProjectData extends ProjectMetadata {
    // Shared Props
    extraDuration: number;
    
    // Character Animation Props
    character?: CharacterComposition | null; // For legacy
    characters?: { id: string; name: string; composition: CharacterComposition; assemblerSession?: any; origin: any; thumbnail?: string }[];
    activeSceneCharacterId?: string | null;
    keyframes: Keyframe[];
    lipSyncKeyframes: LipSyncKeyframe[];
    cameraTransform: any;
    characterFilters?: any; // For legacy
    characterFiltersMap?: Record<string, any>;
    lightSources: LightSource[];
    backgroundTransform: any;
    linkBgToCamera: boolean;
    ambientLightLevel: number;
    visemeMap: Record<VisemeShape, string | null>;
    canvasBgColor: string;
    isCanvasTransparent: boolean;
    backgroundImage: { url: string | null, width: number, height: number };
    
    // Audio Props
    vocalTrackData?: { url?: string; gain: number; pitch: number; speed: number; muted: boolean; name: string };
    instTrackData?: { url?: string; gain: number; pitch: number; speed: number; muted: boolean; name: string };
    frameAudioData?: { url?: string; name: string }; // New: for FrameByFrame audio
    audioDuration?: number;

    // Frame Animation Props
    frames?: FrameData[];
    frameSettings?: FrameSettings;
    aspectRatio?: string;
    customCSS?: string;
}

const STORAGE_KEY_PREFIX = 'app_proj_';
const LIST_KEY = 'app_project_list';

export const blobUrlToBase64 = async (url: string): Promise<string> => {
    if (!url) return url;
    if (url.startsWith('data:')) {
        return url;
    }
    try {
        const response = await fetch(url);
        let blob = await response.blob();
        // Prevent image loading errors caused by missing or incorrect MIME types.
        if (!blob.type || blob.type === 'text/plain' || blob.type === 'application/octet-stream') {
            blob = new Blob([blob], { type: 'image/png' });
        }
        return await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    } catch (e) {
        console.warn("fetch(blob) failed, falling back to canvas serialization:", e);
        return new Promise((resolve) => {
            const img = new Image();
            // Do not set crossOrigin for blob URLs, it causes them to fail!
            if (!url.startsWith('blob:')) {
                img.crossOrigin = 'anonymous';
            }
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');
                if (!ctx) return resolve(url);
                ctx.drawImage(img, 0, 0);
                resolve(canvas.toDataURL('image/png'));
            };
            img.onerror = () => {
                console.error("blobUrlToBase64 fallback failed for", url);
                resolve(url); // Fallback to original url instead of crashing
            };
            img.src = url;
        });
    }
};

// Helpers for compression
const compressData = async (data: any): Promise<ArrayBuffer | any> => {
    if (typeof CompressionStream === 'undefined') return data;
    try {
        const jsonString = JSON.stringify(data);
        const bytes = new TextEncoder().encode(jsonString);
        const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
        return await new Response(stream).arrayBuffer();
    } catch (e) {
        console.warn("Compression failed, falling back to raw data", e);
        return data;
    }
};

const decompressData = async (data: any): Promise<any> => {
    if (data instanceof ArrayBuffer) {
        if (typeof DecompressionStream === 'undefined') {
            throw new Error("DecompressionStream not supported in this browser, cannot read compressed project.");
        }
        try {
            const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip'));
            const decompressedBytes = await new Response(stream).arrayBuffer();
            const jsonString = new TextDecoder().decode(decompressedBytes);
            return JSON.parse(jsonString);
        } catch (e) {
            console.error("Decompression failed", e);
            throw e;
        }
    }
    return data;
};

export const StorageUtils = {
    getProjectList: async (): Promise<ProjectMetadata[]> => {
        try {
            const list = await get(LIST_KEY);
            return list || [];
        } catch (e: any) {
            console.error("Failed to load project list", e);
            if (e && e.message && e.message.includes('large IndexedDB value')) {
                console.warn("Rebuilding project list due to large size limit...");
                try {
                    const allKeys = await keys();
                    const newMetadata: ProjectMetadata[] = [];
                    for (const k of allKeys) {
                        if (typeof k === 'string' && k.startsWith(STORAGE_KEY_PREFIX)) {
                            // Only rebuild metadata without trying to load the full project if it might crash
                            // Actually, trying to `get(k)` might throw again if it's too large, but we can catch it!
                            try {
                                const data = await get(k);
                                const parsed = await decompressData(data);
                                if (parsed) {
                                    newMetadata.push({
                                        id: parsed.id,
                                        name: parsed.name,
                                        lastModified: parsed.lastModified,
                                        version: parsed.version,
                                        thumbnail: "", // strip thumbnail to avoid future crashes
                                        projectType: parsed.projectType
                                    });
                                }
                            } catch(err) {
                                console.warn(`Could not recover project ${k}`, err);
                            }
                        }
                    }
                    await set(LIST_KEY, newMetadata);
                    return newMetadata;
                } catch(err2) {
                    console.error("Failed to rebuild project list", err2);
                }
            }
            return [];
        }
    },

    saveProject: async (data: FullProjectData): Promise<boolean> => {
        try {
            
            // 1. Deep convert all Blob URLs to Base64 to ensure persistence
            const stringified = JSON.stringify(data);
            if (!stringified || stringified === 'undefined') {
                console.warn("Attempted to save undefined or invalid data");
                return false;
            }
            const processedData = JSON.parse(stringified);
            
            // Convert Character Images (Legacy)
            if (processedData.character) {
                for (const partId in processedData.character) {
                    const part = processedData.character[partId];
                    if (part.imageUrl && part.imageUrl.startsWith('blob:')) {
                        
                        part.imageUrl = await blobUrlToBase64(part.imageUrl);
                    }
                }
            }

            // Convert Characters array Images
            if (processedData.characters) {
                for (const char of processedData.characters) {
                    if (char.composition) {
                        for (const partId in char.composition) {
                            const part = char.composition[partId];
                            if (part.imageUrl && part.imageUrl.startsWith('blob:')) {
                                
                                part.imageUrl = await blobUrlToBase64(part.imageUrl);
                            }
                        }
                    }
                    if (char.visemeMap) {
                        for (const viseme in char.visemeMap) {
                            const url = char.visemeMap[viseme as VisemeShape];
                            if (url && url.startsWith('blob:')) {
                                
                                char.visemeMap[viseme as VisemeShape] = await blobUrlToBase64(url);
                            }
                        }
                    }
                }
            }

            
            // Convert Background Image
            if (processedData.backgroundImage && processedData.backgroundImage.url && processedData.backgroundImage.url.startsWith('blob:')) {
                
                processedData.backgroundImage.url = await blobUrlToBase64(processedData.backgroundImage.url);
            }

            // Convert Viseme Map Images
            if (processedData.visemeMap) {
                for (const viseme in processedData.visemeMap) {
                    const url = processedData.visemeMap[viseme];
                    if (url && url.startsWith('blob:')) {
                        
                        processedData.visemeMap[viseme] = await blobUrlToBase64(url);
                    }
                }
            }

            // 2. Save Full Data
            const dataKey = `${STORAGE_KEY_PREFIX}${processedData.id}`;
            const compressedParams = await compressData(processedData);
            await set(dataKey, compressedParams);
            

            // 3. Update List (Metadata only)
            const list = await StorageUtils.getProjectList();
            const existingIndex = list.findIndex(p => p.id === processedData.id);
            
            const meta: ProjectMetadata = {
                id: processedData.id,
                name: processedData.name,
                lastModified: processedData.lastModified,
                version: processedData.version,
                thumbnail: processedData.thumbnail,
                projectType: processedData.projectType
            };

            if (existingIndex >= 0) {
                list[existingIndex] = meta;
            } else {
                list.unshift(meta);
            }
            
            await set(LIST_KEY, list);

            return true;
        } catch (e: any) {
            console.error("Save failed", e);
            if (e.name === 'QuotaExceededError' || (e.message && e.message.includes('QuotaExceededError'))) {
                showAppToast("Save failed: Storage is full! Please delete some old projects or use smaller audio files.");
            } else if (e.name === 'RangeError' || (e.message && e.message.includes('Invalid string length'))) {
                showAppToast("Save failed: Project data is too large! (Often caused by extremely long audio tracks).");
            } else if (e.name === 'DataCloneError' || e.name === 'UnknownError') {
                showAppToast("Save failed: The project is too complex or your browser is running out of storage space to save it. Try removing some audio or using lower quality images.");
            } else {
                showAppToast("Save failed: An unexpected error occurred. Details: " + (e.message || String(e)));
            }
            return false;
        }
    },

    loadProject: async (id: string): Promise<FullProjectData | null> => {
        try {
            
            let data = await get(`${STORAGE_KEY_PREFIX}${id}`);
            if (data) {
                data = await decompressData(data);
                
            } else {
                
            }
            return data || null;
        } catch (e: any) {
            console.error("Load failed", e);
            if (e && e.message && e.message.includes('large IndexedDB value')) {
                showAppToast("Load failed: The project data is too large to be read. This is usually caused by extremely long audio tracks or too many high-resolution images.");
            } else {
                showAppToast("Load failed: An error occurred while reading the project from local storage.");
            }
            return null;
        }
    },

    deleteProject: async (id: string): Promise<ProjectMetadata[]> => {
        try {
            await del(`${STORAGE_KEY_PREFIX}${id}`);
            const list = await StorageUtils.getProjectList();
            const newList = list.filter(p => p.id !== id);
            await set(LIST_KEY, newList);
            return newList;
        } catch (e) {
            console.error("Delete failed", e);
            return [];
        }
    },

    renameProject: async (id: string, newName: string): Promise<ProjectMetadata[]> => {
        try {
            // 1. Update List
            const list = await StorageUtils.getProjectList();
            const item = list.find(p => p.id === id);
            if (item) {
                item.name = newName;
                item.lastModified = Date.now();
                await set(LIST_KEY, list);
            }

            // 2. Update Full Data (if it exists)
            const dataKey = `${STORAGE_KEY_PREFIX}${id}`;
            let data = await get(dataKey);
            if (data) {
                data = await decompressData(data);
                data.name = newName;
                data.lastModified = Date.now();
                const compressedData = await compressData(data);
                await set(dataKey, compressedData);
            }
            return list;
        } catch (e) {
            console.error("Rename failed", e);
            return await StorageUtils.getProjectList();
        }
    }
};