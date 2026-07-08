import React, { useState, useEffect, useRef } from 'react';
import { X, Search, Filter, ShoppingCart, Download, User, Users, DollarSign, Image as ImageIcon, ChevronLeft, ChevronRight, Play, Sparkles, CheckCircle2, ChevronDown, Lock, ArrowLeft, FilePlus2, FolderOpen, Folder, FolderPlus } from 'lucide-react';
import { showAppToast } from '../utils/toastHelper';
import { triggerDownload } from '../utils/downloadHelper';
import { getBackendApiUrl } from '../utils/api';
import { db, collection, onSnapshot, doc, setDoc, getDoc, serverTimestamp, updateDoc, query, where, getDocs } from '../utils/firebase';
import { downloadProductFileInChunks } from '../utils/productStorage';
import { StorageUtils } from '../utils/storage';
import JSZip from 'jszip';
import { Logo } from './Logo';
import { detectUserCountry, getScaledPrice } from '../utils/pppPricing';
import { DEFAULT_TRANSFORM, createPart } from '../utils/characterDefaults';
import { VisemeShape } from '../types';
import { autoCalculatePivots } from '../utils/autoPivot';

const convertDropboxUrl = (url: string): string => {
  if (!url) return url;
  let trimmed = url.trim();
  if (!trimmed.includes('dropbox.com') && !trimmed.includes('dropboxusercontent.com')) return trimmed;
  
  if (trimmed.includes('dl=0')) {
    trimmed = trimmed.replace('dl=0', 'dl=1');
  } else if (!trimmed.includes('dl=1') && !trimmed.includes('raw=1')) {
    if (trimmed.includes('?')) {
      trimmed = trimmed + '&dl=1';
    } else {
      trimmed = trimmed + '?dl=1';
    }
  }
  return trimmed;
};

const ProductImage = ({ src, alt, className, imgClassName, isPriority }: { src: string, alt: string, className?: string, imgClassName?: string, isPriority?: boolean }) => {
  const getFallbackSrc = () => {
    const nameLower = String(alt || '').toLowerCase();
    if (nameLower.includes('lion') || nameLower.includes('cat') || nameLower.includes('character') || nameLower.includes('puppet') || nameLower.includes('pack')) {
      return "https://images.unsplash.com/photo-1541512416146-3cf58d6b27cc?q=80&w=800&auto=format&fit=crop";
    }
    if (nameLower.includes('adam') || nameLower.includes('boy') || nameLower.includes('man') || nameLower.includes('epic') || nameLower.includes('synthesizer')) {
      return "https://images.unsplash.com/photo-1560942485-b2a11cc13456?q=80&w=800&auto=format&fit=crop";
    }
    return "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=800&auto=format&fit=crop";
  };

  const finalSrc = src && src.trim() !== '' ? src.trim() : getFallbackSrc();
  const [error, setError] = useState(!finalSrc);
  const convertedSrc = convertDropboxUrl(finalSrc);

  useEffect(() => {
    if (!finalSrc) setError(true);
    else setError(false);
  }, [finalSrc]);

  return (
    <div className={`relative w-full h-full flex items-center justify-center bg-black/50 overflow-hidden ${className || ''}`}>
      {error ? (
        <div className="w-full h-full flex flex-col items-center justify-center text-gray-700 bg-[#121214]">
           <ImageIcon size={24} className="mb-2 opacity-50" />
           <span className="text-[10px] uppercase font-bold tracking-widest text-gray-600">Image failed</span>
        </div>
      ) : (
        <img 
          src={convertedSrc || null} 
          alt={alt} 
          referrerPolicy="no-referrer"
          fetchPriority={isPriority ? "high" : "auto"}
          decoding="async"
          loading={isPriority ? "eager" : "lazy"}
          className={`relative z-10 w-full h-full ${imgClassName || 'object-cover group-hover:scale-105 transition-transform duration-500'}`} 
          onError={() => setError(true)}
        />
      )}
    </div>
  );
};


interface CachedAsset {
  blob: Blob;
  filename: string;
  url: string;
  progress?: number;
}

// Global in-memory cache to persist prefetched/downloaded product assets across sessions and modal life-cycles
export const globalStoreAssetCache: Record<string, CachedAsset | Promise<CachedAsset>> = {};
const globalStoreAssetProgress: Record<string, number> = {};

// Zero-latency proactive asset background downloader helper
export const prefetchProductAsset = (product: any, getBackendApiUrl: (path: string) => string): Promise<CachedAsset> => {
    const productId = String(product.id || '');
    if (!productId) return Promise.reject(new Error("Missing product ID"));
    
    if (globalStoreAssetCache[productId]) {
        if (globalStoreAssetCache[productId] instanceof Promise) {
            return globalStoreAssetCache[productId] as Promise<CachedAsset>;
        }
        return Promise.resolve(globalStoreAssetCache[productId] as CachedAsset);
    }

    let realUrl = product.productUrl;
    if (!realUrl) {
        return Promise.reject(new Error("No product download url available"));
    }

    const runPrefetch = async (): Promise<CachedAsset> => {
        let finalUrl = realUrl;
        let blobResult: Blob | null = null;
        let directUrlToStore = "";
        let filenameFromHeader = "";

        // Dropbox URL cleaning
        if (finalUrl?.includes('dropbox.com')) {
            finalUrl = finalUrl.replace(/(www\.)?dropbox\.com/, 'dl.dropboxusercontent.com');
            if (finalUrl.includes('dl=0')) {
                finalUrl = finalUrl.replace('dl=0', 'dl=1');
            } else if (!finalUrl.includes('dl=')) {
                const separator = finalUrl.includes('?') ? '&' : '?';
                finalUrl = finalUrl + separator + 'dl=1';
            }
        }

        const fetchWithProgressSilent = async (urlStr: string): Promise<{ blob: Blob; filename?: string }> => {
            const response = await fetch(urlStr);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            
            let fname = "";
            const contentDisp = response.headers.get('content-disposition');
            if (contentDisp) {
                const match = contentDisp.match(/filename=(?:"([^"]+)"|([^;\n]+))/);
                if (match) {
                    fname = decodeURIComponent(match[1] || match[2] || "");
                }
            }

            const contentLength = response.headers.get('content-length');
            if (!contentLength) {
                const fetchedBlob = await response.blob();
                return { blob: fetchedBlob, filename: fname };
            }

            const total = parseInt(contentLength, 10);
            const reader = response.body?.getReader();
            if (!reader) {
                const fetchedBlob = await response.blob();
                return { blob: fetchedBlob, filename: fname };
            }

            let loaded = 0;
            const chunks: Uint8Array[] = [];
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                if (value) {
                    chunks.push(value);
                    loaded += value.length;
                    const percent = Math.round((loaded / total) * 100);
                    globalStoreAssetProgress[productId] = percent;
                    const currentEntry = globalStoreAssetCache[productId];
                    if (currentEntry && !(currentEntry instanceof Promise)) {
                        currentEntry.progress = percent;
                    }
                }
            }
            return { blob: new Blob(chunks), filename: fname };
        };

        const isProject = (product.category || '').toLowerCase().includes('project') || (product.category || '').toLowerCase().includes('template') || (product.category || '').toLowerCase().includes('anim');
        let baseName = product.productName.trim()
            .replace(/\.psd$/i, '')
            .replace(/\.animato_project$/i, '')
            .replace(/\.json$/i, '')
            .replace(/\.zip$/i, '')
            .replace(/\.tsx$/i, '');

        const pCat = (product.category || '').toLowerCase().trim();
        const isZipFile = pCat.includes('zip') || 
                          (product.productName || '').toLowerCase().endsWith('.zip') || 
                          (product.productName || '').toLowerCase().includes('.zip') || 
                          (product.productUrl || '').toLowerCase().includes('.zip') || 
                          (product.productUrl || '').toLowerCase().includes('zip');
        const isCharFile = pCat.includes('character') || pCat.includes('puppet') || pCat.includes('char') || (!isProject && !isZipFile);
        let ext = isZipFile ? ".zip" : (isCharFile ? ".psd" : ".animato_project");

        if (finalUrl?.startsWith('db://') || finalUrl === `db://${product.id}`) {
            const unifiedUrl = getBackendApiUrl(`/api/store/download/unified?productId=${product.id}`);
            directUrlToStore = unifiedUrl;
            try {
                const res = await fetchWithProgressSilent(unifiedUrl);
                blobResult = res.blob;
                if (res.filename) {
                    filenameFromHeader = res.filename;
                }
            } catch (unifiedErr) {
                console.warn("[GlobalPrefetch] Unified database download fallback triggered:", unifiedErr);
                const fallbackRes = await downloadProductFileInChunks(product.id, (progress) => {
                    globalStoreAssetProgress[productId] = progress;
                    const currentEntry = globalStoreAssetCache[productId];
                    if (currentEntry && !(currentEntry instanceof Promise)) {
                        currentEntry.progress = progress;
                    }
                });
                blobResult = fallbackRes.blob;
                filenameFromHeader = fallbackRes.fileName;
            }
        } else {
            const isNative = window.location.protocol === 'file:' || 
                             window.location.protocol === 'capacitor:' || 
                             window.location.protocol === 'app:' ||
                             !!(window as any).Capacitor || 
                             !!(window as any).cordova;

            directUrlToStore = finalUrl;
            if (isNative) {
                try {
                    const res = await fetchWithProgressSilent(finalUrl);
                    blobResult = res.blob;
                    if (res.filename) {
                        filenameFromHeader = res.filename;
                    }
                } catch (err) {
                    console.warn("[GlobalPrefetch] Direct native prefetch failed:", err);
                }
            }

            if (!blobResult) {
                const proxyUrl = getBackendApiUrl(`/api/store/download?url=${encodeURIComponent(finalUrl)}`);
                try {
                    directUrlToStore = proxyUrl;
                    const res = await fetchWithProgressSilent(proxyUrl);
                    blobResult = res.blob;
                    if (res.filename) {
                        filenameFromHeader = res.filename;
                    }
                } catch (proxyErr) {
                    console.warn("[GlobalPrefetch] Proxy prefetch failed, falling back inline:", proxyErr);
                }
            }

            if (!blobResult) {
                try {
                    directUrlToStore = finalUrl;
                    const res = await fetchWithProgressSilent(finalUrl);
                    blobResult = res.blob;
                    if (res.filename) {
                        filenameFromHeader = res.filename;
                    }
                } catch (finalDlErr) {
                    throw new Error("Unable to download preview files in background check.");
                }
            }
        }

        let isRealPsd = false;
        let isRealJson = false;
        let isRealZip = false;
        let isHtmlError = false;

        if (blobResult) {
            try {
                const headBuffer = await blobResult.slice(0, 100).arrayBuffer();
                const headArr = new Uint8Array(headBuffer);
                const signature = String.fromCharCode(...headArr.slice(0, 4));
                
                if (signature === "8BPS") {
                    isRealPsd = true;
                } else if (signature.startsWith("PK")) {
                    isRealZip = true;
                } else {
                    const sampleText = new TextDecoder().decode(headArr).trim();
                    if (sampleText.startsWith("{") || sampleText.startsWith("[")) {
                        isRealJson = true;
                    } else if (sampleText.toLowerCase().includes("<!doctype") || sampleText.toLowerCase().includes("<html")) {
                        isHtmlError = true;
                    }
                }
            } catch (e) {
                console.warn("[GlobalPrefetch] Magic bits check failed during prefetch:", e);
            }
        }

        if (isHtmlError) {
            throw new Error("This direct download link is currently unavailable.");
        }

        let finalExt = isRealPsd ? ".psd" : (isRealZip ? ".zip" : (isRealJson ? ".animato_project" : ext));
        let finalFilename = `${baseName}${finalExt}`;

        return { blob: blobResult, filename: finalFilename, url: directUrlToStore, progress: 100 };
    };

    const promise = runPrefetch();
    globalStoreAssetCache[productId] = promise;

    promise.then((result) => {
        globalStoreAssetCache[productId] = result;
    }).catch((err) => {
        delete globalStoreAssetCache[productId];
    });

    return promise;
};


interface StoreProps {
  onClose: () => void;
  user: any;
  onOpenProject: (file: File) => void;
  onNewProject: (type: any, settings: any) => void; 
  onPurchaseSuccess?: () => void;
  savedProjects?: any[];
  onImportToExistingProject?: (projectId: string, importedData: any) => Promise<void>;
}

const updateProductSalesInFirestore = async (
  db: any, 
  product: any,
  downloadingUserEmail?: string
): Promise<{ success: boolean; url?: string }> => {
  try {
    const prodName = String(product.productName || product.name || '').trim();
    const sellerId = String(product.sellerId || '').trim();
    const prodUrl = product.productUrl || product.url || '';
    
    console.log(`Starting updateProductSalesInFirestore with sellerId: "${sellerId}" and productName: "${prodName}"`);
    
    let matchedDocRef = null;
    let currentPurchased = 0;
    let fetchedUrl = '';
    let matchedDocData: any = null;

    // Step 1: "It goes to the product sheet [products collection], then checks the seller ID of that product."
    if (sellerId) {
      const q = query(collection(db, 'products'), where('sellerId', '==', sellerId));
      const qSnap = await getDocs(q);
      
      // Step 2: "Once it finds the seller ID, it finds the name of that product attached to that seller ID."
      if (!qSnap.empty) {
        const matchedDoc = qSnap.docs.find(docSnap => {
          const data = docSnap.data();
          const dbName = String(data.name || data.productName || '').trim();
          return dbName.toLowerCase() === prodName.toLowerCase();
        });
        
        if (matchedDoc) {
          matchedDocRef = matchedDoc.ref;
          matchedDocData = matchedDoc.data();
          currentPurchased = Number(matchedDocData.timesPurchased || 0);
          fetchedUrl = matchedDocData.productUrl || '';
          console.log(`Found product match via seller ID + name: docId=${matchedDoc.id}, current sales=${currentPurchased}`);
        }
      }
    }

    // Step 3: Robust Fallback Lookup if the seller ID match was unsuccessful
    if (!matchedDocRef) {
      console.log("No seller ID match found, trying fallback ID lookup...");
      const docId = product.firestoreId || product.id;
      if (docId) {
        const productRef = doc(db, 'products', String(docId));
        const snap = await getDoc(productRef);
        if (snap.exists()) {
          matchedDocRef = productRef;
          matchedDocData = snap.data();
          currentPurchased = Number(matchedDocData.timesPurchased || 0);
          fetchedUrl = matchedDocData.productUrl || '';
          console.log(`Fallback: matched product directly by ID ${docId}`);
        }
      }
    }

    if (!matchedDocRef && prodName) {
      console.log("No seller ID/ID match, trying fallback name-only lookup...");
      const q = query(collection(db, 'products'), where('name', '==', prodName));
      const qSnap = await getDocs(q);
      if (!qSnap.empty) {
        matchedDocRef = qSnap.docs[0].ref;
        matchedDocData = qSnap.docs[0].data();
        currentPurchased = Number(matchedDocData.timesPurchased || 0);
        fetchedUrl = matchedDocData.productUrl || '';
        console.log(`Fallback: matched product directly by name only`);
      }
    }

    // Step 4: "Then it checks the column for sales and adds one to whatever is in that column."
    if (matchedDocRef) {
      const email = (downloadingUserEmail || product.userEmail || JSON.parse(localStorage.getItem('app_user') || '{}').email || '').trim().toLowerCase();
      let nextSalesValue = currentPurchased;
      let shouldUpdate = true;
      let nextUniqueUsers = matchedDocData && Array.isArray(matchedDocData.uniqueUsers) ? matchedDocData.uniqueUsers : [];

      if (email) {
        if (nextUniqueUsers.includes(email)) {
          console.log(`[updateProductSalesInFirestore] User ${email} already in uniqueUsers. Skipping sales/users increment.`);
          shouldUpdate = false;
        } else {
          nextSalesValue = currentPurchased + 1;
          nextUniqueUsers = [...nextUniqueUsers, email];
        }
      } else {
        nextSalesValue = currentPurchased + 1;
      }

      if (shouldUpdate) {
        await updateDoc(matchedDocRef, {
          timesPurchased: nextSalesValue,
          uniqueUsers: nextUniqueUsers,
          updatedAt: serverTimestamp()
        });
        console.log(`Successfully incremented sales (timesPurchased) to ${nextSalesValue} for product doc id: ${matchedDocRef.id}`);
        // Keep updated value locally
        if (matchedDocData) {
          matchedDocData.timesPurchased = nextSalesValue;
          matchedDocData.uniqueUsers = nextUniqueUsers;
        }
      }
      return { success: true, url: fetchedUrl || prodUrl };
    }
    
    console.warn("Could not find matching product document to update sales.", product);
    return { success: false };
  } catch (err) {
    console.error("updateProductSalesInFirestore failed:", err);
    return { success: false };
  }
};

const updateSellerPayoutInFirestore = async (
  db: any, 
  sellerId: string, 
  payoutAmount: number
): Promise<boolean> => {
  try {
    if (!sellerId) return false;
    const cleanSellerId = sellerId.toLowerCase().trim();
    let matchedDocRef = null;
    let currentPayout = 0;

    // 1. Try finding seller document directly by ID
    const directRef = doc(db, 'sellers', sellerId);
    const directSnap = await getDoc(directRef);
    if (directSnap.exists()) {
      matchedDocRef = directRef;
      currentPayout = parseFloat(String(directSnap.data().payout || "0"));
    } else {
      // 2. Scan all sellers (case insensitive)
      const sellersSnap = await getDocs(collection(db, 'sellers'));
      const foundIdx = sellersSnap.docs.find(d => {
        const sVal = d.data().sellerId || d.id;
        return String(sVal).toLowerCase().trim() === cleanSellerId;
      });
      if (foundIdx) {
        matchedDocRef = foundIdx.ref;
        currentPayout = parseFloat(String(foundIdx.data().payout || "0"));
      }
    }

    if (matchedDocRef) {
      await updateDoc(matchedDocRef, {
        payout: currentPayout + payoutAmount,
        updatedAt: serverTimestamp()
      });
      console.log("updateSellerPayoutInFirestore: added payout reward of:", payoutAmount, "to seller:", matchedDocRef.id);
      return true;
    }
    console.warn("updateSellerPayoutInFirestore: seller not found in sellers collection for ID:", sellerId);
    return false;
  } catch (err) {
    console.error("updateSellerPayoutInFirestore failed:", err);
    return false;
  }
};

export const Store: React.FC<StoreProps> = ({ onClose, user, onOpenProject, onNewProject, onPurchaseSuccess, savedProjects, onImportToExistingProject }) => {
  const [sheetProducts, setSheetProducts] = useState<any[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('cached_sheet_products') || '[]');
    } catch (_) {
      return [];
    }
  });
  const [dbProducts, setDbProducts] = useState<any[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('cached_db_products') || '[]');
    } catch (_) {
      return [];
    }
  });
  const [dbProductsLoaded, setDbProductsLoaded] = useState(false);
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(() => {
    try {
      const hasSheet = localStorage.getItem('cached_sheet_products');
      const hasDb = localStorage.getItem('cached_db_products');
      return !(hasSheet || hasDb);
    } catch (_) {
      return true;
    }
  });
  const [downloadedIds, setDownloadedIds] = useState<string[]>([]);

  // Track downloaded items on client and sync with localStorage
  useEffect(() => {
    try {
      const arr = JSON.parse(localStorage.getItem('downloaded_store_products') || '[]');
      setDownloadedIds(arr.map((id: any) => String(id)));
    } catch (_) {}
  }, []);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'free' | 'paid'>('all');
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'project file' | 'character file'>('all');
  const [selectedProduct, setSelectedProduct] = useState<any | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // 1. Listen to Firestore products database in real-time
  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, 'products'),
      (snapshot) => {
        const items = snapshot.docs.map(doc => {
          const data = doc.data();
          return {
            id: doc.id,
            firestoreId: doc.id,
            price: data.price,
            category: data.category,
            thumbnail: data.thumbnail,
            productImages: Array.isArray(data.images) ? data.images.join(',') : (data.images || ''),
            amount: data.amount,
            productName: data.name || data.productName || '',
            timesPurchased: data.timesPurchased || 0,
            productUrl: data.productUrl,
            sellerId: data.sellerId || 'animato studio',
            starRating: data.starRating || '0',
            productDescription: data.productDescription || data.description || '',
            videoUrl: data.videoUrl || '',
            auditStatus: data.auditStatus || 'approved'
          };
        });
        setDbProducts(items);
        setDbProductsLoaded(true);
        try {
          localStorage.setItem('cached_db_products', JSON.stringify(items));
        } catch (_) {}
      },
      (e) => {
        console.error("Firestore database product load failed:", e);
      }
    );
    return () => unsubscribe();
  }, []);

  // 2. Fetch Google Sheets products
  useEffect(() => {
    if (!navigator.onLine) {
       const cached = localStorage.getItem('cached_sheet_products') || localStorage.getItem('cached_db_products');
       if (!cached) {
         setErrorMsg("Oops! No internet connection. Please connect to the internet.");
       }
       setLoading(false);
       return;
    }

    setLoading(true);
    setErrorMsg(null);

    const loadProducts = async () => {
      try {
        const apiUrl = getBackendApiUrl('/api/store/products');
        const res = await fetch(apiUrl);
        if (!res.ok) throw new Error("API response not ok: " + res.status);
        const data = await res.json();
        if (data.status && data.products && data.products.length > 0) {
          const mapped = data.products.map((p: any) => ({
             ...p,
             id: String(p.id),
             productImages: p.productImages || p.images || '',
             starRating: p.starRating || '0',
             productDescription: p.productDescription || p.description || '',
             videoUrl: p.videoUrl || '',
             auditStatus: p.auditStatus || 'approved'
          }));
          setSheetProducts(mapped);
          try {
            localStorage.setItem('cached_sheet_products', JSON.stringify(mapped));
          } catch (_) {}
          setLoading(false);
        } else {
          throw new Error("No products returned from sheets response");
        }
      } catch (err) {
        console.warn("Failed to load products from Google Sheet. Syncing with direct database collection...", err);
        setLoading(false);
      }
    };

    loadProducts();
  }, []);

  const prefetchedUrls = React.useRef(new Set<string>());
  const prefetchProductThumbnails = (items: any[]) => {
    if (!items || items.length === 0) return;
    items.forEach(item => {
      if (item.thumbnail && item.thumbnail.startsWith('http') && !prefetchedUrls.current.has(item.thumbnail)) {
        prefetchedUrls.current.add(item.thumbnail);
        const img = new Image();
        img.src = item.thumbnail;
      }
    });
  };

  const prefetchedAssets = React.useRef(new Set<string>());
  const prefetchCandidateAssets = (items: any[]) => {
    if (!items || items.length === 0) return;
    const freeItems = items.filter(item => {
      const baseAmount = parseFloat(item.amount || '0');
      const isFree = String(item.price || '').toLowerCase() === 'free' || baseAmount <= 0;
      return isFree && item.productUrl && !prefetchedAssets.current.has(String(item.id));
    });

    const itemsToPrefetch = freeItems.slice(0, 4);
    itemsToPrefetch.forEach((item, index) => {
      prefetchedAssets.current.add(String(item.id));
      setTimeout(() => {
        prefetchProductAsset(item, getBackendApiUrl).catch(err => {
          console.warn(`[IdlePrefetch] Background prefetch failed for ${item.productName}:`, err);
        });
      }, index * 1200);
    });
  };

  // 3. Keep products compiled / combined and handle redirects or selection
  useEffect(() => {
    // If dbProducts has successfully loaded from Firestore, filter out sheetProducts that no longer exist in dbProducts (i.e. was deleted)
    let filteredSheetProducts = [...sheetProducts];
    if (dbProductsLoaded && dbProducts.length > 0) {
      filteredSheetProducts = sheetProducts.filter(p => {
        return dbProducts.some(dbProd => 
          String(dbProd.id) === String(p.id) ||
          ((dbProd.productName || '').toString().toLowerCase().trim() === (p.productName || '').toString().toLowerCase().trim())
        );
      });
    }

    const merged = [...filteredSheetProducts];
    
    dbProducts.forEach(dbProd => {
      const dbProdName = (dbProd.productName || '').toString().toLowerCase().trim();
      const matchIndex = merged.findIndex(p => {
        const sheetProdName = (p.productName || '').toString().toLowerCase().trim();
        return String(p.id) === String(dbProd.id) || 
               (dbProdName && sheetProdName && sheetProdName === dbProdName);
      });
      if (matchIndex !== -1) {
        // Merge - let dbProduct fields override
        merged[matchIndex] = {
          ...merged[matchIndex],
          ...dbProd,
          firestoreId: dbProd.firestoreId,
          id: merged[matchIndex].id // keep original sheet ID string format if it matched sheet ID
        };
      } else {
        // Core additional product
        merged.push({
          ...dbProd,
          firestoreId: dbProd.firestoreId
        });
      }
    });

    if (dbProductsLoaded) {
      setProducts(merged);
      prefetchProductThumbnails(merged);
      prefetchCandidateAssets(merged);
    } else {
      if (merged.length > 0) {
        setProducts(merged);
        prefetchProductThumbnails(merged);
        prefetchCandidateAssets(merged);
      } else if (sheetProducts.length > 0) {
        setProducts(sheetProducts);
        prefetchProductThumbnails(sheetProducts);
        prefetchCandidateAssets(sheetProducts);
      } else if (dbProducts.length > 0) {
        setProducts(dbProducts);
        prefetchProductThumbnails(dbProducts);
        prefetchCandidateAssets(dbProducts);
      }
    }

    // Try handling redirects if route matches
    if (merged.length > 0) {
      const pathname = window.location.pathname;
      const params = new URLSearchParams(window.location.search);
      const reference = params.get("reference") || params.get("trxref");
      const storeMatch = pathname.match(/\/store-payment\/([^/]+)\/([^/]+)\/([^/]+)?/);
      if (storeMatch && reference && !selectedProduct) {
        const redirectProductId = storeMatch[3];
        const found = merged.find((pr: any) => String(pr.id) === String(redirectProductId));
        if (found) setSelectedProduct(found);
      }
    }
  }, [sheetProducts, dbProducts, dbProductsLoaded]);

  const filteredProducts = React.useMemo(() => {
    return products.filter(p => {
      // 1. Audit Check: Only display 'approved' products.
      // Sellers can see their own uploaded products (while pending or rejected)
      const sellerEmail = (user?.email || '').toLowerCase().trim();
      const productSeller = (p.sellerId || '').toLowerCase().trim();
      const isMyProduct = sellerEmail && productSeller && (productSeller === sellerEmail || productSeller === user?.sellerId);
      
      if (p.auditStatus && p.auditStatus !== 'approved' && !isMyProduct) {
         return false;
      }

      const pName = (p.productName || '').toLowerCase();
      const pSeller = (p.sellerId || '').toLowerCase();
      if (searchQuery && !pName.includes(searchQuery.toLowerCase()) && !pSeller.includes(searchQuery.toLowerCase())) {
          return false;
      }

      const pPrice = (p.price || '').toString().toLowerCase();
      if (filter === 'free' && pPrice !== 'free') return false;
      if (filter === 'paid' && pPrice === 'free') return false;
      
      const pCat = (p.category || '').toString().toLowerCase().trim();
      if (categoryFilter === 'project file') {
          const isProj = pCat.includes('project') || pCat.includes('template') || pCat.includes('anim');
          if (!isProj) return false;
      }
      if (categoryFilter === 'character file') {
          const isZip = pCat.includes('zip');
          const isChar = pCat.includes('character') || pCat.includes('puppet') || pCat.includes('char');
          if (!isChar || isZip) return false;
      }
      if (categoryFilter === 'zip') {
          const isZip = pCat.includes('zip');
          if (!isZip) return false;
      }
      
      return true;
    });
  }, [products, searchQuery, filter, categoryFilter, user]);

  const featuredItem = React.useMemo(() => {
    // Find featured item matching 'gege' or first item while auditing correctly
    const approvedOnly = products.filter(p => p.auditStatus === 'approved' || !p.auditStatus);
    return approvedOnly.find((p: any) => p.productName?.toLowerCase().includes('gege')) || approvedOnly[0] || products[0];
  }, [products]);

  const projectTemplates = React.useMemo(() => {
    return filteredProducts.filter(p => {
       const pCat = (p.category || '').toString().toLowerCase().trim();
       return pCat.includes('project') || pCat.includes('template') || pCat.includes('anim');
    });
  }, [filteredProducts]);

  const characterTemplates = React.useMemo(() => {
    return filteredProducts.filter(p => {
       const pCat = (p.category || '').toString().toLowerCase().trim();
       const isZip = pCat.includes('zip');
       return (pCat.includes('character') || pCat.includes('puppet') || pCat.includes('char')) && !isZip;
    });
  }, [filteredProducts]);

  const zipTemplates = React.useMemo(() => {
    return filteredProducts.filter(p => {
       const pCat = (p.category || '').toString().toLowerCase().trim();
       return pCat.includes('zip');
    });
  }, [filteredProducts]);

  const popularAssets = React.useMemo(() => {
    return [...filteredProducts].sort((a, b) => (b.timesPurchased || 0) - (a.timesPurchased || 0));
  }, [filteredProducts]);

  const isBrowsingAll = searchQuery !== '' || filter !== 'all' || categoryFilter !== 'all';

  return (
    <div 
       className="fixed inset-0 z-[200] flex flex-col text-white animate-in slide-in-from-bottom-5 duration-300 select-none pb-safe"
       style={{ backgroundColor: 'rgba(5, 5, 8, 0.96)', backdropFilter: 'blur(36px)' }}
    >
      {/* App Store Page Header */}
      <div 
         className="h-20 border-b border-white/5 flex items-center justify-between px-6 shrink-0 bg-[#09090c]/50"
      >
        <div className="flex items-center gap-4">
          <button onClick={onClose} className="p-2.5 hover:bg-white/10 rounded-full transition-colors">
            <X size={20} className="text-gray-400 hover:text-white" />
          </button>
          <div className="font-black tracking-wider text-md uppercase flex items-center gap-2.5">
            <Logo size={26} />
            <span className="tracking-widest font-black text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-indigo-400 to-pink-400">ANIMATO STORE</span>
          </div>
        </div>

        {/* Search Input center aligned */}
        <div className="hidden sm:flex relative items-center max-w-sm w-full mx-4">
          <Search size={16} className="absolute left-4 text-gray-500 pointer-events-none" />
          <input 
            type="text"
            placeholder="Search characters or animations..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-[#16161c] border border-white/5 rounded-full pl-11 pr-10 py-2.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-[#00e5ff]/50 focus:ring-1 focus:ring-[#00e5ff]/20 transition-all font-medium"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="absolute right-3.5 p-1 rounded-full hover:bg-white/5 text-gray-400 hover:text-white">
              <X size={12} />
            </button>
          )}
        </div>
        
        {/* Empty placeholder to balance spacing */}
        <div className="w-10 h-10 shrink-0" />
      </div>

      {/* Mobile Search input */}
      <div className="p-4 sm:hidden shrink-0 border-b border-white/5 bg-[#09090c]/30">
        <div className="relative flex items-center w-full">
          <Search size={15} className="absolute left-4 text-gray-500 pointer-events-none" />
          <input 
            type="text"
            placeholder="Search characters or animations..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-[#16161c] border border-white/5 rounded-full pl-11 pr-10 py-2.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-[#00e5ff]/50 focus:ring-1 focus:ring-[#00e5ff]/25 transition-all font-medium"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="absolute right-3.5 p-1 rounded-full hover:bg-white/5 text-gray-400 hover:text-white">
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        
        {/* Left sidebar sidebar selector pills */}
        <div className="w-full md:w-56 shrink-0 border-r border-white/5 bg-[#07070a]/30 p-4 shrink-0 flex flex-row overflow-x-auto md:flex-col gap-2 md:space-y-1 md:overflow-y-auto justify-start items-center md:items-stretch custom-scrollbar select-none border-b md:border-b-0">
          <span className="hidden md:block text-[10px] font-black tracking-widest text-gray-500 uppercase px-3 mb-2">FILTER ASSETS</span>
          
          <button 
            onClick={() => { setCategoryFilter('all'); setFilter('all'); }} 
            className={`px-4 py-2 text-left rounded-full md:rounded-xl text-xs font-bold transition-all shrink-0 uppercase tracking-widest ${categoryFilter === 'all' && filter === 'all' ? 'bg-[#00e5ff]/10 text-[#00e5ff] border border-[#00e5ff]/20' : 'text-gray-400 border border-transparent hover:bg-white/5 hover:text-white'}`}
          >
            All Assets
          </button>
          <button 
            onClick={() => { setCategoryFilter('project file'); setFilter('all'); }}
            className={`px-4 py-2 text-left rounded-full md:rounded-xl text-xs font-bold transition-all shrink-0 uppercase tracking-widest ${categoryFilter === 'project file' && filter === 'all' ? 'bg-[#00e5ff]/10 text-[#00e5ff] border border-[#00e5ff]/20' : 'text-gray-400 border border-transparent hover:bg-white/5 hover:text-white'}`}
          >
            Projects
          </button>
          <button 
            onClick={() => { setCategoryFilter('character file'); setFilter('all'); }}
            className={`px-4 py-2 text-left rounded-full md:rounded-xl text-xs font-bold transition-all shrink-0 uppercase tracking-widest ${categoryFilter === 'character file' && filter === 'all' ? 'bg-[#00e5ff]/10 text-[#00e5ff] border border-[#00e5ff]/20' : 'text-gray-400 border border-transparent hover:bg-white/5 hover:text-white'}`}
          >
            Characters
          </button>
          <button 
            onClick={() => { setCategoryFilter('zip'); setFilter('all'); }}
            className={`px-4 py-2 text-left rounded-full md:rounded-xl text-xs font-bold transition-all shrink-0 uppercase tracking-widest ${categoryFilter === 'zip' && filter === 'all' ? 'bg-[#00e5ff]/10 text-[#00e5ff] border border-[#00e5ff]/20' : 'text-gray-400 border border-transparent hover:bg-white/5 hover:text-white'}`}
          >
            Zip Files
          </button>
          <button 
            onClick={() => { setCategoryFilter('all'); setFilter('free'); }}
            className={`px-4 py-2 text-left rounded-full md:rounded-xl text-xs font-bold transition-all shrink-0 uppercase tracking-widest ${filter === 'free' ? 'bg-[#00e5ff]/10 text-[#00e5ff] border border-[#00e5ff]/20' : 'text-gray-400 border border-transparent hover:bg-white/5 hover:text-white'}`}
          >
            Free Only
          </button>
          <button 
            onClick={() => { setCategoryFilter('all'); setFilter('paid'); }}
            className={`px-4 py-2 text-left rounded-full md:rounded-xl text-xs font-bold transition-all shrink-0 uppercase tracking-widest ${filter === 'paid' ? 'bg-[#00e5ff]/10 text-[#00e5ff] border border-[#00e5ff]/20' : 'text-gray-400 border border-transparent hover:bg-white/5 hover:text-white'}`}
          >
            Premium Paid
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-4 md:p-8 custom-scrollbar">
          {loading ? (
            <div className="space-y-8 animate-in fade-in duration-300">
               <div>
                  <div className="w-48 h-4 bg-white/10 rounded-full mb-4 animate-pulse" />
                  <div className="flex gap-4 overflow-x-auto pb-4">
                     {[...Array(6)].map((_, i) => (
                        <div key={i} className="flex flex-col gap-2 shrink-0 animate-pulse">
                           <div className="w-28 h-28 rounded-[24px] bg-white/5 border border-white/5" />
                           <div className="w-24 h-3 bg-white/10 rounded-full mt-1" />
                           <div className="w-16 h-2.5 bg-white/5 rounded-full" />
                        </div>
                     ))}
                  </div>
               </div>
               <div>
                  <div className="w-48 h-4 bg-white/10 rounded-full mb-4 animate-pulse" />
                  <div className="flex gap-4 overflow-x-auto pb-4">
                     {[...Array(6)].map((_, i) => (
                        <div key={i} className="flex flex-col gap-2 shrink-0 animate-pulse">
                           <div className="w-28 h-28 rounded-[24px] bg-white/5 border border-white/5" />
                           <div className="w-24 h-3 bg-white/10 rounded-full mt-1" />
                           <div className="w-16 h-2.5 bg-white/5 rounded-full" />
                        </div>
                     ))}
                  </div>
               </div>
            </div>
          ) : errorMsg ? (
            <div className="w-full h-64 flex flex-col items-center justify-center text-red-500 gap-4">
              <div className="font-bold tracking-widest uppercase text-xs text-center bg-red-950/20 px-4 py-2.5 rounded-xl border border-red-900/45">{errorMsg}</div>
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="w-full h-64 flex flex-col items-center justify-center text-gray-500 gap-3">
              <ShoppingCart size={40} className="opacity-20" />
              <div className="font-bold tracking-widest uppercase text-xs">No matching products found</div>
            </div>
          ) : (
            <>
              {/* SPOTLIGHT HERO ACCENT BUBBLE */}
              {featuredItem && !isBrowsingAll && (
                  <div 
                      onClick={() => setSelectedProduct(featuredItem)}
                      onMouseEnter={() => prefetchProductAsset(featuredItem, getBackendApiUrl).catch(() => {})}
                      className="relative mb-8 rounded-[28px] overflow-hidden bg-gradient-to-r from-zinc-900 via-neutral-900 to-black border border-white/10 h-44 sm:h-52 md:h-60 flex items-center justify-between p-6 md:p-10 cursor-pointer group hover:border-[#00e5ff]/50 transition-all shadow-xl"
                  >
                      <div className="flex-1 flex flex-col justify-center max-w-sm md:max-w-md z-10 select-none">
                          <span className="text-[9px] font-black tracking-widest text-[#00e5ff] bg-[#00e5ff]/10 px-2.5 py-1 rounded-full uppercase w-max mb-3">SPOTLIGHT FEATURED</span>
                          <h2 className="text-xl sm:text-2xl md:text-3xl font-black text-white tracking-tight leading-none mb-2">{featuredItem.productName}</h2>
                          <p className="text-xs text-gray-400 line-clamp-2 md:line-clamp-3 mb-4 font-medium">Unpack this professional production project directly inside Animato Studio. Optimized for fluid action performance.</p>
                          <div className="flex items-center gap-3">
                              <span className="px-3 py-1 bg-green-500/10 border border-green-500/20 text-green-400 text-[10px] font-black tracking-wider uppercase rounded-lg">FREE DOWNLOAD</span>
                              <span className="text-[10px] uppercase font-bold tracking-widest text-[#00e5ff] flex items-center gap-1">by {featuredItem.sellerId}</span>
                          </div>
                      </div>
                      <div className="absolute right-0 top-0 bottom-0 w-1/3 md:w-2/5 h-full opacity-40 group-hover:opacity-60 transition-opacity overflow-hidden pointer-events-none">
                          <img src={featuredItem.thumbnail || "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=800&auto=format&fit=crop"} className="w-full h-full object-cover origin-right scale-105 group-hover:scale-110 transition-transform duration-700 select-none" referrerPolicy="no-referrer" />
                      </div>
                      <div className="absolute inset-0 bg-gradient-to-r from-black via-black/80 to-transparent pointer-events-none" />
                  </div>
              )}

              {/* DYNAMIC SCROLL VIEWS OR SEARCH DIRECT RESULTS GRID */}
              {!isBrowsingAll ? (
                <div className="space-y-6">
                  {/* Category Horizontal row 1: Animation Projects */}
                  <HorizontalProductRow 
                    title="Ready-to-Use Anim Projects" 
                    items={projectTemplates} 
                    onSelectProduct={setSelectedProduct} 
                    downloadedIds={downloadedIds}
                  />

                  {/* Category Horizontal row 2: Rigged Puppets */}
                  <HorizontalProductRow 
                    title="Rigged Character Puppets" 
                    items={characterTemplates} 
                    onSelectProduct={setSelectedProduct} 
                    downloadedIds={downloadedIds}
                  />

                  {/* Category Horizontal row 2.5: Zip Assets */}
                  {zipTemplates.length > 0 && (
                      <HorizontalProductRow 
                        title="Character ZIP Collections" 
                        items={zipTemplates} 
                        onSelectProduct={setSelectedProduct} 
                        downloadedIds={downloadedIds}
                      />
                  )}

                  {/* Category Horizontal row 3: Most Pop Assets */}
                  <HorizontalProductRow 
                    title="Top Download Charts" 
                    items={popularAssets} 
                    onSelectProduct={setSelectedProduct} 
                    downloadedIds={downloadedIds}
                  />
                </div>
              ) : (
                <div className="animate-in fade-in duration-200">
                  <div className="text-xs font-black tracking-widest text-gray-500 uppercase mb-4">Matches ({filteredProducts.length})</div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-x-4 gap-y-6">
                    {filteredProducts.map((p, idx) => {
                        const isFree = String(p.price || '').toLowerCase() === 'free';
                        const isDownloaded = downloadedIds.includes(String(p.id)) || downloadedIds.includes(String(p.firestoreId));
                        return (
                            <div 
                                key={idx}
                                onClick={() => setSelectedProduct(p)}
                                onMouseEnter={() => prefetchProductAsset(p, getBackendApiUrl).catch(() => {})}
                                className="flex flex-col gap-1 items-start cursor-pointer w-full group"
                                id={`search-prod-${p.id}`}
                            >
                                <div className="aspect-square w-full rounded-[24px] overflow-hidden bg-[#121215] border border-white/10 relative group-hover:border-[#00e5ff]/50 transition-all shadow-md">
                                    {p.thumbnail ? (
                                        <ProductImage src={p.thumbnail} alt={p.productName} isPriority={idx < 8} className="group-hover:scale-105 transition-transform duration-300" />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center text-gray-700">
                                            <ImageIcon size={22} />
                                        </div>
                                    )}
                                    {isFree ? (
                                        <span className="absolute top-2.5 right-2.5 px-1.5 py-0.5 bg-emerald-500 text-[8px] font-black tracking-widest text-black rounded uppercase">FREE</span>
                                    ) : (
                                        <span className="absolute top-2.5 right-2.5 px-1.5 py-0.5 bg-amber-500 text-[8px] font-black tracking-widest text-black rounded uppercase">${p.amount}</span>
                                    )}
                                    {isDownloaded && (
                                        <div className="absolute bottom-2.5 right-2.5 bg-emerald-500 text-black p-1 rounded-full flex items-center justify-center shadow-lg animate-in zoom-in-50 duration-200" title="Downloaded">
                                            <CheckCircle2 size={10} className="stroke-[3]" />
                                        </div>
                                    )}
                                </div>
                                <div className="text-xs font-bold text-gray-200 mt-2 line-clamp-1 w-full text-left font-sans group-hover:text-[#00e5ff] transition-all">
                                    {p.productName}
                                </div>
                                <div className="text-[10px] text-gray-400 hover:text-white capitalize flex items-center gap-1 mt-0.5 font-bold">
                                    {p.category?.replace(' file', '') || 'Asset'} • by {p.sellerId?.replace('animato studio', 'Animato')}
                                </div>
                            </div>
                        );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {selectedProduct && (
        <ProductModal 
          product={products.find(p => String(p.id) === String(selectedProduct.id)) || selectedProduct} 
          onClose={() => setSelectedProduct(null)} 
          user={user} 
          onOpenProject={onOpenProject}
          onNewProject={onNewProject}
          onPurchaseSuccess={onPurchaseSuccess}
          savedProjects={savedProjects}
          onImportToExistingProject={onImportToExistingProject}
          onDownloaded={(id: any) => {
              setDownloadedIds(prev => {
                  const sId = String(id);
                  if (prev.includes(sId)) return prev;
                  return [...prev, sId];
              });
          }}
        />
      )}
    </div>
  );
};


// Horizontal Category Row Engine for smooth Playstore layouts
const HorizontalProductRow = ({ title, items, onSelectProduct, downloadedIds = [] }: { title: string, items: any[], onSelectProduct: (p: any) => void, downloadedIds?: string[] }) => {
    const scrollRef = React.useRef<HTMLDivElement>(null);
    const scroll = (direction: 'left' | 'right') => {
        if (scrollRef.current) {
            const scrollAmount = direction === 'left' ? -350 : 350;
            scrollRef.current.scrollBy({ left: scrollAmount, behavior: 'smooth' });
        }
    };

    if (items.length === 0) return null;

    return (
        <div className="mb-6 relative group/row animate-in fade-in duration-300 border-b border-white/5 pb-4">
            <div className="flex items-center justify-between mb-3.5 pr-2">
                <h2 className="text-xs font-black tracking-widest text-[#00e5ff] uppercase">{title}</h2>
                <div className="flex gap-1.5 opacity-0 group-hover/row:opacity-100 transition-opacity duration-200">
                    <button onClick={() => scroll('left')} className="p-1.5 bg-[#16161c] border border-white/5 hover:bg-white/10 rounded-full text-white/70 hover:text-white transition-colors cursor-pointer select-none">
                        <ChevronLeft size={14} />
                    </button>
                    <button onClick={() => scroll('right')} className="p-1.5 bg-[#16161c] border border-white/5 hover:bg-white/10 rounded-full text-white/70 hover:text-white transition-colors cursor-pointer select-none">
                        <ChevronRight size={14} />
                    </button>
                </div>
            </div>
            
            <div 
                ref={scrollRef}
                className="flex gap-4 overflow-x-auto pb-2 custom-scrollbar scroll-smooth snap-x select-none"
            >
                {items.map((p, idx) => {
                    const isFree = String(p.price || '').toLowerCase() === 'free';
                    const isDownloaded = downloadedIds.includes(String(p.id)) || downloadedIds.includes(String(p.firestoreId));
                    return (
                        <div 
                            key={idx}
                            onClick={() => onSelectProduct(p)}
                            onMouseEnter={() => prefetchProductAsset(p, getBackendApiUrl).catch(() => {})}
                            className="flex flex-col gap-1 items-start cursor-pointer w-[114px] group shrink-0 snap-start active:scale-95 transition-transform"
                            id={`row-prod-${p.id}`}
                        >
                            <div className="w-[110px] h-[110px] rounded-[24px] overflow-hidden bg-[#121215] border border-white/10 relative group-hover:border-[#00e5ff]/50 transition-all shadow-md">
                                {p.thumbnail ? (
                                    <ProductImage src={p.thumbnail} alt={p.productName} isPriority={idx < 5} className="group-hover:scale-105 transition-transform duration-300" />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center text-gray-700">
                                        <ImageIcon size={22} />
                                    </div>
                                )}
                                {isFree ? (
                                    <span className="absolute top-2 right-2 px-1.5 py-0.5 bg-emerald-500 text-[8px] font-black tracking-widest text-black rounded uppercase">FREE</span>
                                ) : (
                                    <span className="absolute top-2 right-2 px-1.5 py-0.5 bg-amber-500 text-[8px] font-black tracking-widest text-black rounded uppercase">${p.amount}</span>
                                )}
                                {isDownloaded && (
                                    <div className="absolute bottom-2 right-2 bg-emerald-500 text-black p-1 rounded-full flex items-center justify-center shadow-lg animate-in zoom-in-50 duration-200" title="Downloaded">
                                        <CheckCircle2 size={10} className="stroke-[3]" />
                                    </div>
                                )}
                            </div>
                            <div className="text-xs font-bold text-gray-200 mt-2 line-clamp-1 w-full text-left font-sans group-hover:text-[#00e5ff] transition-all">
                                {p.productName}
                            </div>
                            <div className="text-[10px] text-gray-500 truncate w-full text-left font-bold capitalize mt-0.5">
                                {p.category?.replace(' file', '') || 'Asset'}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

// ... Product Modal Implemented Below ...
const ProductModal = ({ 
  product, 
  onClose, 
  user, 
  onOpenProject, 
  onNewProject, 
  onPurchaseSuccess, 
  onDownloaded,
  savedProjects,
  onImportToExistingProject
}: any) => {
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<number>(0);
  const [downloadStep, setDownloadStep] = useState<'idle' | 'downloading' | 'success' | 'opening' | 'completed'>('idle');
  const [showOptionsScreen, setShowOptionsScreen] = useState(false);
  const [importSubView, setImportSubView] = useState<'options' | 'project_list'>('options');
  const [selectedProjId, setSelectedProjId] = useState<string>('');
  const [importingToProj, setImportingToProj] = useState(false);
  const [purchased, setPurchased] = useState(() => {
    try {
      const activeUserEmail = (user?.email || JSON.parse(localStorage.getItem('app_user') || '{}').email || '').trim().toLowerCase();
      if (activeUserEmail && Array.isArray(product.uniqueUsers) && product.uniqueUsers.includes(activeUserEmail)) {
        return true;
      }
      const localPurchases = JSON.parse(localStorage.getItem('purchased_store_products') || '[]');
      return localPurchases.includes(product.id) || localPurchases.includes(String(product.id));
    } catch (e) {
      return false;
    }
  });
  const [downloadedProjectData, setDownloadedProjectData] = useState<any | null>(null);
  const [preparedBlob, setPreparedBlob] = useState<Blob | null>(null);
  const [preparedFilename, setPreparedFilename] = useState<string>('');
  const [preparedDownloadUrl, setPreparedDownloadUrl] = useState<string>('');
  const [hasDownloadedThisSession, setHasDownloadedThisSession] = useState(false);
  const [finalProjectDataState, setFinalProjectDataState] = useState<any | null>(null);
  
  const [prefetchedBlob, setPrefetchedBlob] = useState<Blob | null>(null);
  const [prefetchedFilename, setPrefetchedFilename] = useState<string>('');
  const [prefetchedDownloadUrl, setPrefetchedDownloadUrl] = useState<string>('');
  const [prefetchProgress, setPrefetchProgress] = useState<number>(0);
  const [prefetchActive, setPrefetchActive] = useState<boolean>(false);
  const prefetchPromiseRef = useRef<Promise<{ blob: Blob; filename: string; url: string }> | null>(null);
  const downloadingRef = useRef(false);

  useEffect(() => {
    downloadingRef.current = downloading;
  }, [downloading]);

  const initiatePrefetch = async () => {
    const productId = String(product.id || '');
    if (!productId || prefetchedBlob || hasDownloadedThisSession) return;
    
    setPrefetchActive(true);
    console.log("[Prefetch] Starting/hooking into asset prefetch for product:", product.productName);

    try {
        let cachedEntry = globalStoreAssetCache[productId];
        
        if (!cachedEntry) {
            // Trigger brand new prefetch in the global cache
            cachedEntry = prefetchProductAsset(product, getBackendApiUrl);
        }

        if (cachedEntry instanceof Promise) {
            prefetchPromiseRef.current = cachedEntry;
            
            // Periodically check prefetch progress from the running promise
            const intervalId = setInterval(() => {
                const prog = globalStoreAssetProgress[productId];
                if (prog !== undefined) {
                    setPrefetchProgress(prog);
                }
            }, 100);

            try {
                const res = await cachedEntry;
                clearInterval(intervalId);
                setPrefetchedBlob(res.blob);
                setPrefetchedFilename(res.filename);
                setPrefetchedDownloadUrl(res.url);
                setPrefetchProgress(100);
                console.log("[Prefetch] Fully loaded and latched to active prefetch stream:", res.filename);
            } catch (err) {
                clearInterval(intervalId);
                throw err;
            }
        } else {
            // Instant, 0x latency cache hit!
            setPrefetchedBlob(cachedEntry.blob);
            setPrefetchedFilename(cachedEntry.filename);
            setPrefetchedDownloadUrl(cachedEntry.url);
            setPrefetchProgress(100);
            console.log("[Prefetch] Zero-latency instant cache hit retrieved for asset:", cachedEntry.filename);
        }
    } catch (err) {
        console.warn("[Prefetch] Background prefetch download or latching failed:", err);
        prefetchPromiseRef.current = null;
    } finally {
        setPrefetchActive(false);
    }
  };

  // Math on amounts for NGN / PPP Price calculations
  const baseAmount = parseFloat(product.amount || '0');
  const isFree = String(product.price || '').toLowerCase() === 'free' || baseAmount <= 0;

  // Trigger silent proactive background prefetching for immediate results
  useEffect(() => {
    if ((isFree || purchased) && !hasDownloadedThisSession) {
        initiatePrefetch();
    }
  }, [isFree, purchased, hasDownloadedThisSession, product.id, product.productUrl]);
  
  const isProject = (product.category || '').toLowerCase().includes('project') || (product.category || '').toLowerCase().includes('template') || (product.category || '').toLowerCase().includes('anim');
  const isZip = (product.category || '').toLowerCase().includes('zip') || 
                (product.productName || '').toLowerCase().endsWith('.zip') || 
                (product.productName || '').toLowerCase().includes('.zip') || 
                (product.productUrl || '').toLowerCase().includes('.zip') || 
                (product.productUrl || '').toLowerCase().includes('zip');
  const selectedFormat = isZip ? 'zip' : (isProject ? 'animato_project' : 'psd');
  
  const [countryCode, setCountryCode] = useState<string>('NG');
  useEffect(() => {
    detectUserCountry().then(setCountryCode);
  }, []);

  // Check if this product is already in the local Storage list, so we can immediately offer "Open in Studio" without requiring a re-download!
  useEffect(() => {
    let active = true;
    const findExistingProject = async () => {
      try {
        const list = await StorageUtils.getProjectList();
        if (!active) return;
        const match = list.find((p: any) => 
          String(p.storeProductId) === String(product.id) || 
          p.name === product.productName || 
          p.name === `${product.productName} Character Project`
        );
        if (match) {
          const fullData = await StorageUtils.loadProject(match.id);
          if (fullData && active) {
            setFinalProjectDataState(fullData);
            setHasDownloadedThisSession(true);
            
            // Build the exact, format-correct custom filename
            let baseName = product.productName.trim()
                .replace(/\.psd$/i, '')
                .replace(/\.animato_project$/i, '')
                .replace(/\.json$/i, '')
                .replace(/\.zip$/i, '')
                .replace(/\.tsx$/i, '');
                
            const pCat = (product.category || '').toLowerCase().trim();
            const isZipFile = pCat.includes('zip') || 
                              (product.productName || '').toLowerCase().endsWith('.zip') || 
                              (product.productName || '').toLowerCase().includes('.zip') || 
                              (product.productUrl || '').toLowerCase().includes('.zip') || 
                              (product.productUrl || '').toLowerCase().includes('zip');
            const isCharFile = pCat.includes('character') || pCat.includes('puppet') || pCat.includes('char') || (!isProject && !isZipFile);
            setPreparedFilename(isZipFile ? `${baseName}.zip` : (isCharFile ? `${baseName}.psd` : `${baseName}.animato_project`));
          }
        }
      } catch (err) {
        console.warn("Checking existing local project metadata failsafe:", err);
      }
    };
    if (product?.id && !isZip) {
      findExistingProject();
    }
    return () => {
      active = false;
    };
  }, [product.id, product.productName, product.category, isProject]);

  const [currentImgIdx, setCurrentImgIdx] = useState(0);
   const rawImages = (() => {
    const raw = typeof product.productImages === 'string' ? product.productImages.trim() : (Array.isArray(product.productImages) ? product.productImages.join(', ') : (Array.isArray(product.images) ? product.images.join(', ') : String(product.productImages || product.images || '').trim()));
    if (!raw) return [];
    if (raw.startsWith('data:')) return [raw];
    return raw.split(',').map((u: string) => u.trim()).filter((u: string) => u);
  })();
  const defaultImg = product.thumbnail;
  const galleryImages = rawImages.length > 0 ? rawImages : (defaultImg ? [defaultImg] : []);
  
  const hasVideo = !!product.videoUrl;
  const [activeMedia, setActiveMedia] = useState<'video' | 'image'>(hasVideo ? 'video' : 'image');

  // Math on amounts for NGN / PPP Price calculations
  const scaledPrice = getScaledPrice(baseAmount, countryCode);
  const formattedPrice = isFree ? 'FREE' : `₦${scaledPrice.toLocaleString()}`;

  // Sync purchase status with local storage on load
  useEffect(() => {
    try {
        const localPurchases = JSON.parse(localStorage.getItem('purchased_store_products') || '[]');
        if (localPurchases.includes(product.id) || localPurchases.includes(String(product.id))) {
            setPurchased(true);
        }
    } catch (e) {
        console.error("Local purchases sync error:", e);
    }
  }, [product.id]);

  useEffect(() => {
    const pathname = window.location.pathname;
    const params = new URLSearchParams(window.location.search);
    const reference = params.get("reference") || params.get("trxref");
    const storeMatch = pathname.match(/\/store-payment\/([^/]+)\/([^/]+)\/([^/]+)?/);

    if (storeMatch && reference && storeMatch[3] === String(product.id)) {
        // Clear the URL so we don't re-verify on accident
        window.history.replaceState({}, document.title, window.location.pathname);
        
        // Start verification
        setDownloading(true);
        const verifyPayment = async () => {
            try {
                let verified = false;
                let fetchedProductUrl = product.productUrl;

                // 1. PRIMARY LOGIC: client side firestore update (Vercel / Native Capacitor Apps without VITE_API_URL)
                try {
                    const activeUserEmail = (user?.email || JSON.parse(localStorage.getItem('app_user') || '{}').email || '').trim().toLowerCase();
                    const prodUpdate = await updateProductSalesInFirestore(db, product, activeUserEmail);
                    if (prodUpdate.success) {
                        fetchedProductUrl = prodUpdate.url || product.productUrl;
                    }

                    if (product.sellerId) {
                        const payoutAmount = Number(scaledPrice) * 0.8;
                        await updateSellerPayoutInFirestore(db, product.sellerId, payoutAmount);
                    }
                    verified = true;
                } catch (localErr: any) {
                    console.error("Client fallback error:", localErr);
                    throw localErr;
                }

                // 2. BACKGROUND ADMIN SHEET SYNC
                try {
                    const activeUserEmail = (user?.email || JSON.parse(localStorage.getItem('app_user') || '{}').email || '').trim().toLowerCase();
                    const apiUrl = getBackendApiUrl('/api/store/verify-purchase');
                    // Await the fetch so Vercel Serverless retains the DB context
                    const verifyRes = await fetch(apiUrl, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            reference: reference,
                            productId: product.id,
                            sellerId: product.sellerId,
                            amountPaid: scaledPrice,
                            userEmail: activeUserEmail
                        })
                    });
                    const data = await verifyRes.json();
                    if (data.status && data.productUrl && !fetchedProductUrl) {
                        fetchedProductUrl = data.productUrl;
                    }
                } catch (e: any) {
                    console.warn("Backend verification failed.", e);
                }

                if (verified) {
                    // Purchase successful! Switch to download button
                    product.productUrl = fetchedProductUrl || product.productUrl;
                    setPurchased(true);

                    // Add to locally saved purchased items so they keep ownership forever
                    try {
                        const localPurchases = JSON.parse(localStorage.getItem('purchased_store_products') || '[]');
                        const strId = String(product.id);
                        if (!localPurchases.includes(product.id) && !localPurchases.includes(strId)) {
                            localPurchases.push(product.id);
                            localStorage.setItem('purchased_store_products', JSON.stringify(localPurchases));
                        }
                    } catch (e) {}

                    showAppToast("Payment successful! You can now download your item.");
                }
            } catch (err: any) {
                console.error(err);
                showAppToast("Verification error: " + err.message);
            } finally {
                setDownloading(false);
            }
        };

        verifyPayment();
    }
  }, []);

  const handlePurchase = async () => {
    // If FREE or already Purchased
    if (isFree || purchased) {
      await processDownload(product.productUrl);
      return;
    }

    if (!navigator.onLine) {
      showAppToast("You are offline. Please connect to the internet to purchase.");
      return;
    }

    // IF PAID - Initialize Paystack using subscription-like robust email logic
    let userEmail = (user?.email || JSON.parse(localStorage.getItem('app_user') || '{}').email || '').trim();
    if (!userEmail) {
      userEmail = localStorage.getItem('pending_app_payment') || '';
    }

    if (!userEmail || !userEmail.includes('@')) {
      showAppToast("Valid email is required to process payment. Please make sure you are signed in.");
      return;
    }

    const PaystackPop = (window as any).PaystackPop;
    if (!PaystackPop) {
       showAppToast("Payment gateway is loading, please try again in a moment.");
       return;
    }

    const public_key = import.meta.env.VITE_PAYSTACK_PUBLIC_KEY || 'pk_live_d616663688ee4eecd3d5265784e941b3f7736a6a';
    if (!public_key) {
        showAppToast("Missing Paystack configuration");
        return;
    }
    
    setLoading(true); // Show preparing payment screen

    // Mark payment as pending in local storage to track process
    localStorage.setItem('pending_app_payment', userEmail);
    localStorage.setItem('app_currency', 'NGN');

    const handler = PaystackPop.setup({
        key: public_key,
        email: userEmail,
        amount: Math.round(scaledPrice * 100), // kobo in Naira matching local purchase power
        currency: 'NGN',
        metadata: {
            email: userEmail,
            product_id: product.id,
            product_name: product.productName,
            country: user?.country || 'Nigeria',
            language: user?.language || 'English',
        },
        callback: (response: any) => {
            setLoading(false);
            window.location.href = `${window.location.origin}/store-payment/${encodeURIComponent(userEmail)}/${scaledPrice}/${product.id}/?reference=${response.reference}`;
        },
        onClose: () => {
            setLoading(false);
            showAppToast("Purchase dialogue closed.");
        }
    });
    
    handler.openIframe();
    setLoading(false); // Modal is open, no longer "loading" the initialization
  };

  const processDownload = async (url: string) => {
    setDownloadStep('downloading');
    setDownloading(true);
    let realUrl = url;

    // Advanced, streaming progress fetcher supporting headers, chunk limits, and error handling
    const fetchWithProgress = async (urlStr: string): Promise<{ blob: Blob; filename?: string }> => {
        const response = await fetch(urlStr);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        
        const contentDisp = response.headers.get('content-disposition');
        let filenameFromHeader = "";
        if (contentDisp) {
            const match = contentDisp.match(/filename=(?:"([^"]+)"|([^;\n]+))/);
            if (match) {
                filenameFromHeader = decodeURIComponent(match[1] || match[2] || "");
            }
        }

        const b = await response.blob();
        return { blob: b, filename: filenameFromHeader };
    };

    try {
        // --- UNIFIED DOWNLOADING PIPELINE (DATABASE CORES & EXTERNAL URLS) ---
        let blob: Blob | null = null;
        let directUrlToStore = "";
        let filename = "";

        let baseName = product.productName.trim()
            .replace(/\.psd$/i, '')
            .replace(/\.animato_project$/i, '')
            .replace(/\.json$/i, '')
            .replace(/\.zip$/i, '')
            .replace(/\.tsx$/i, '');

        const pCat = (product.category || '').toLowerCase().trim();
        const isZipFile = pCat.includes('zip') || 
                          (product.productName || '').toLowerCase().endsWith('.zip') || 
                          (product.productName || '').toLowerCase().includes('.zip') || 
                          (product.productUrl || '').toLowerCase().includes('.zip') || 
                          (product.productUrl || '').toLowerCase().includes('zip');
        const isCharFile = pCat.includes('character') || pCat.includes('puppet') || pCat.includes('char') || (!isProject && !isZipFile);
        let ext = isZipFile ? ".zip" : (isCharFile ? ".psd" : ".animato_project");

        // 1. Instantly resolve from the proactive background prefetch if completed!
        if (prefetchedBlob) {
            console.log("[Downloads] Serving instantly from proactive background cached storage.");
            blob = prefetchedBlob;
            filename = prefetchedFilename || `${baseName}${ext}`;
            directUrlToStore = prefetchedDownloadUrl || realUrl;
            setDownloadProgress(100);
        }
        // 2. Or latch cleanly onto the active stream if still running in background
        else if (prefetchPromiseRef.current) {
            console.log("[Downloads] Latching onto active background prefetch promise stream.");
            setDownloadProgress(prefetchProgress);
            try {
                const res = await prefetchPromiseRef.current;
                blob = res.blob;
                filename = res.filename;
                directUrlToStore = res.url;
                setDownloadProgress(100);
            } catch (err) {
                console.warn("[Downloads] Latched prefetch stream failed, falling back to direct legacy fetch...", err);
                prefetchPromiseRef.current = null;
            }
        }

        // 3. Fallback: If no background hit, complete a direct inline foreground fetch
        if (!blob) {
            if (realUrl?.startsWith('db://') || realUrl === `db://${product.id}`) {
                try {
                    setDownloadProgress(0);
                    showAppToast("Fetching assets safely from unified cloud store...");
                    
                    const unifiedUrl = getBackendApiUrl(`/api/store/download/unified?productId=${product.id}`);
                    directUrlToStore = unifiedUrl;
                    
                    try {
                        const res = await fetchWithProgress(unifiedUrl);
                        blob = res.blob;
                    } catch (unifiedErr) {
                        console.warn("Unified download failed, falling back to legacy client-side chunks recovery...", unifiedErr);
                        const fallbackRes = await downloadProductFileInChunks(product.id, (progress) => {
                            setDownloadProgress(progress);
                        });
                        blob = fallbackRes.blob;
                    }
                } catch (dbDlErr: any) {
                    console.error("Database chunk recovery failed:", dbDlErr);
                    showAppToast(`Database file access failed: ${dbDlErr.message || dbDlErr}.`);
                    setDownloading(false);
                    setDownloadStep('idle');
                    return;
                }
            } else {
                if (realUrl?.includes('dropbox.com')) {
                    realUrl = realUrl.replace(/(www\.)?dropbox\.com/, 'dl.dropboxusercontent.com');
                    if (realUrl.includes('dl=0')) {
                        realUrl = realUrl.replace('dl=0', 'dl=1');
                    } else if (!realUrl.includes('dl=')) {
                        const separator = realUrl.includes('?') ? '&' : '?';
                        realUrl = realUrl + separator + 'dl=1';
                    }
                }

                const isNative = window.location.protocol === 'file:' || 
                                 window.location.protocol === 'capacitor:' || 
                                 window.location.protocol === 'app:' ||
                                 !!(window as any).Capacitor || 
                                 !!(window as any).cordova;

                setDownloadProgress(0);
                directUrlToStore = realUrl;

                if (isNative) {
                    try {
                        const res = await fetchWithProgress(realUrl);
                        blob = res.blob;
                    } catch (nativeDlErr) {
                        console.warn("Direct native download failed, trying proxy servers...", nativeDlErr);
                    }
                }

                if (!blob) {
                    const proxyUrl = getBackendApiUrl(`/api/store/download?url=${encodeURIComponent(realUrl)}`);
                    try {
                        directUrlToStore = proxyUrl;
                        const res = await fetchWithProgress(proxyUrl);
                        blob = res.blob;
                    } catch (proxyErr) {
                        console.warn("Dynamic API Proxy download failed:", proxyErr);
                    }
                }

                if (!blob) {
                    try {
                        directUrlToStore = realUrl;
                        const res = await fetchWithProgress(realUrl);
                        blob = res.blob;
                    } catch (finalDlErr) {
                        throw new Error("Unable to download product file. Please check your network connection.");
                    }
                }
            }
        }

        // --- MULTIPLE RESOLUTIONS / REAL-TIME MAGIC BYTE INTEGRATION ---
        let isRealPsd = false;
        let isRealJson = false;
        let isRealZip = false;
        let isHtmlError = false;
        let isRealCarta = false;
        let isRealBin = false;

        const lowerUrl = (realUrl || '').toLowerCase();
        const lowerUrlProd = (product.productUrl || '').toLowerCase();
        const lowerProdName = (product.productName || '').toLowerCase();
        
        if (lowerUrl.includes('.carta') || lowerUrlProd.includes('.carta') || lowerProdName.includes('.carta') || (filename && filename.toLowerCase().endsWith('.carta'))) {
            isRealCarta = true;
        }
        if (lowerUrl.includes('.bin') || lowerUrlProd.includes('.bin') || lowerProdName.includes('.bin') || (filename && filename.toLowerCase().endsWith('.bin'))) {
            isRealBin = true;
        }

        if (blob) {
            try {
                const headBuffer = await blob.slice(0, 100).arrayBuffer();
                const headArr = new Uint8Array(headBuffer);
                const signature = String.fromCharCode(...headArr.slice(0, 4));
                
                if (signature === "8BPS") {
                    isRealPsd = true;
                } else if (signature.startsWith("PK")) {
                    isRealZip = true;
                } else {
                    const sampleText = new TextDecoder().decode(headArr).trim();
                    if (sampleText.startsWith("{") || sampleText.startsWith("[")) {
                        isRealJson = true;
                    } else if (sampleText.toLowerCase().includes("<!doctype") || sampleText.toLowerCase().includes("<html")) {
                        isHtmlError = true;
                    }
                }
            } catch (e) {
                console.warn("Signature verification failed:", e);
            }
        }

        if (isHtmlError) {
            throw new Error("This direct download link is currently unavailable or returned a server login/error page. Please contact the asset creator or support.");
        }

        const containsResource = filename && (filename.includes("resource_prod") || filename.toLowerCase().startsWith("resource"));
        let finalFilename = filename;
        if (!finalFilename || containsResource) {
            let actualExt = ext;
            if (isRealPsd) {
                actualExt = ".psd";
            } else if (isRealZip) {
                actualExt = ".zip";
            } else if (isRealJson) {
                actualExt = ".animato_project";
            } else if (isRealCarta) {
                actualExt = ".carta";
            } else if (isRealBin) {
                actualExt = ".bin";
            }
            finalFilename = `${baseName}${actualExt}`;
        }

        setPreparedFilename(finalFilename);
        setPreparedBlob(blob);
        setPreparedDownloadUrl(directUrlToStore);

        setDownloadProgress(100);
        setDownloadStep('opening');

    // Standard tracking stats update in background
    try {
        const apiUrl = getBackendApiUrl('/api/store/increment-downloads');
        fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                productId: product.id,
                productName: product.productName,
                productUrl: product.productUrl,
                userEmail: (user?.email || JSON.parse(localStorage.getItem('app_user') || '{}').email || '').trim().toLowerCase()
            })
        }).catch(err => console.warn("Backend increment network error:", err));

        const activeUserEmail = (user?.email || JSON.parse(localStorage.getItem('app_user') || '{}').email || '').trim().toLowerCase();
        updateProductSalesInFirestore(db, product, activeUserEmail).catch(err => console.error("Firestore sales increment failed:", err));
    } catch (err) {
        console.warn("Analytics tracking failure:", err);
    }

    // Local downloaded tracking update
    try {
        const downloadedList = JSON.parse(localStorage.getItem('downloaded_store_products') || '[]');
        const strId = String(product.id);
        if (!downloadedList.includes(product.id) && !downloadedList.includes(strId)) {
            downloadedList.push(product.id);
            localStorage.setItem('downloaded_store_products', JSON.stringify(downloadedList));
        }
        if (onDownloaded) {
            onDownloaded(product.id);
        }
    } catch (saveDlErr) {
        console.error("Local tracking state save failed:", saveDlErr);
    }

    // 🟢 TRY OPENS/TIMELINE PARSING SAFELY (Async/Background-wrapped so thread is never locked on mobile viewports)
    let parsed = null;
    let text = "";
    let finalProjectData = null;

    try {
        const isUrlZip = !!isRealZip || ext === ".zip" || finalFilename.toLowerCase().endsWith(".zip");
        const isUrlPsd = !isUrlZip && (!!isRealPsd || ext === ".psd" || finalFilename.toLowerCase().endsWith(".psd"));
        const isUrlJson = !isUrlZip && !isUrlPsd && (!!isRealJson || finalFilename.toLowerCase().endsWith(".json") || finalFilename.toLowerCase().endsWith(".animato_project"));

        if (isUrlZip) {
            const file = new File([blob], finalFilename, { type: "application/zip" });
            setFinalProjectDataState(file);
            setHasDownloadedThisSession(true);
            setShowOptionsScreen(true);
            setDownloadStep('idle');
            setDownloading(false);
            return;
        }

        if (isRealPsd || isUrlPsd) {
                    const { readPsd } = await import("ag-psd");
                    const arrayBuffer = await blob.arrayBuffer();
                    
                    // Yield main thread before heavy parsing
                    await new Promise(resolve => setTimeout(resolve, 0));
                    
                    const psd = readPsd(arrayBuffer, {
                        skipLayerImageData: false,
                        skipThumbnail: true,
                    });
                    
                    const psdWidth = psd.width || 1000;
                    const psdHeight = psd.height || 1000;
                    
                    const baseStageLimit = 500;
                    const paddingFactor = 0.85;
                    const scale = Math.min(
                        1,
                        (baseStageLimit * paddingFactor) / psdWidth,
                        (baseStageLimit * paddingFactor) / psdHeight
                    );
                    
                    const newCharacter: any = {
                        root: createPart("root", (product.productName || "PSD Template").replace(/\.psd$/i, ""), null, 10, {
                            isGroup: true,
                            isOpen: true,
                            width: 0,
                            height: 0,
                            transform: {
                                ...DEFAULT_TRANSFORM,
                                x: 0,
                                y: 0,
                                scaleX: 1,
                                scaleY: 1,
                            },
                        }),
                    };
                    
                    const getLayerImageUri = async (layerData: any): Promise<string> => {
                        // Yield main thread per generation block
                        await new Promise(resolve => setTimeout(resolve, 0));
                        if (layerData.canvas) return layerData.canvas.toDataURL();
                        if (layerData.imageData) {
                            const c = document.createElement("canvas");
                            c.width = layerData.imageData.width;
                            c.height = layerData.imageData.height;
                            const ctx = c.getContext("2d");
                            if (ctx) {
                                ctx.putImageData(
                                    new ImageData(
                                        new Uint8ClampedArray(layerData.imageData.data),
                                        layerData.imageData.width,
                                        layerData.imageData.height
                                    ),
                                    0,
                                    0
                                );
                                return c.toDataURL();
                            }
                        }
                        return "";
                    };
                    
                    if (psd.children) {
                        let globalZIndex = 100000;
                        
                        const processLayer = async (
                            layer: any,
                            parentId: string,
                            overrideName?: string,
                            inMouthFolder: boolean = false
                        ) => {
                            // Yield to let React render and prevent UI freeze
                            await new Promise(resolve => requestAnimationFrame(resolve));
                            
                            const partId = `psd_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
                            
                            if (layer.children !== undefined && layer.children.length > 0) {
                                const nameLower = (layer.name || "").toLowerCase();
                                
                                if (nameLower === "background" || nameLower === "backgrounds") {
                                    return undefined;
                                }
                                
                                if (nameLower === "anchor points" || nameLower === "anchor_points") {
                                    return undefined;
                                }
                                
                                const isLoop = nameLower.includes("loop");
                                const isMouth = nameLower.includes("mouth") || nameLower.includes("viseme");
                                const isView = nameLower.includes("view") || 
                                               (parentId === "root" && (nameLower.includes("front") || nameLower.includes("side") || nameLower.includes("back")));
                                const isSwap = nameLower.endsWith("_swap") || nameLower.endsWith(" swap");
                                
                                const tags: string[] = [];
                                if (isLoop) tags.push("Loop");
                                if (isView) tags.push("View");
                                if (isSwap) tags.push("Swap");
                                
                                let isVisible = layer.hidden !== true;
                                if (isView) {
                                    isVisible = false;
                                }
                                
                                newCharacter[partId] = createPart(
                                    partId,
                                    overrideName || layer.name || "Group",
                                    parentId,
                                    globalZIndex--,
                                    {
                                        isGroup: true,
                                        isVisible: isVisible,
                                        isOpen: layer.opened !== false,
                                        width: 0,
                                        height: 0,
                                        transform: { ...DEFAULT_TRANSFORM, x: 0, y: 0 },
                                        children: [],
                                        tags: tags,
                                    }
                                );
                                
                                let loopChildIndex = 1;
                                for (let i = layer.children.length - 1; i >= 0; i--) {
                                    const childId = await processLayer(
                                        layer.children[i],
                                        partId,
                                        isLoop ? String(loopChildIndex++) : undefined,
                                        isMouth || inMouthFolder
                                    );
                                    
                                    if (isSwap && childId && newCharacter[childId]) {
                                        if (i === layer.children.length - 1) {
                                            newCharacter[childId].isVisible = true;
                                        } else {
                                            newCharacter[childId].isVisible = false;
                                        }
                                    }
                                }
                                
                                newCharacter[parentId].children.push(partId);
                                return partId;
                            } else {
                                try {
                                    if (layer.canvas || layer.imageData) {
                                        let dataUri = await getLayerImageUri(layer);
                                        let layerWidth = (layer.canvas?.width || layer.imageData?.width || 0) * scale;
                                        let layerHeight = (layer.canvas?.height || layer.imageData?.height || 0) * scale;
                                        
                                        const originalWidth = layer.canvas?.width || layer.imageData?.width || 0;
                                        const originalHeight = layer.canvas?.height || layer.imageData?.height || 0;
                                        
                                        const centerX = (layer.left || 0) + originalWidth / 2;
                                        const centerY = (layer.top || 0) + originalHeight / 2;
                                        const offsetX = (centerX - psdWidth / 2) * scale;
                                        const offsetY = (centerY - psdHeight / 2) * scale;
                                        
                                        const layerNameUpper = (layer.name || "").toUpperCase();
                                        const tags: string[] = [];
                                        
                                        let assignedShape: VisemeShape | null = null;
                                        
                                        const shapeMatches = {
                                            REST: VisemeShape.REST,
                                            AI: VisemeShape.AI,
                                            O: VisemeShape.O,
                                            U: VisemeShape.U,
                                            E: VisemeShape.E,
                                            FV: VisemeShape.FV,
                                            MBP: VisemeShape.MBP,
                                            L: VisemeShape.L,
                                            CONS: VisemeShape.CONS,
                                            C: VisemeShape.CONS,
                                            A: VisemeShape.AI,
                                            I: VisemeShape.AI,
                                        };
                                        
                                        if (inMouthFolder) {
                                            const tokens = layerNameUpper.split(/[^A-Z0-9]/);
                                            Object.keys(shapeMatches).forEach(key => {
                                                if (tokens.includes(key) || layerNameUpper === key) {
                                                    assignedShape = shapeMatches[key as keyof typeof shapeMatches];
                                                }
                                            });
                                            
                                            if (!assignedShape && layerNameUpper.length === 1) {
                                                if (layerNameUpper in shapeMatches) {
                                                    assignedShape = shapeMatches[layerNameUpper as keyof typeof shapeMatches];
                                                }
                                            }
                                            
                                            if (layerNameUpper.includes("REST") || layerNameUpper.includes("NEUTRAL") || assignedShape === VisemeShape.REST) {
                                                tags.push("Mouth");
                                                tags.push("Viseme"); 
                                                tags.push(VisemeShape.REST);
                                                layer.hidden = false;
                                            } else {
                                                tags.push("Viseme");
                                                if (assignedShape) tags.push(assignedShape);
                                                layer.hidden = true;
                                            }
                                        } else if (
                                            layerNameUpper.includes("MOUTH_") ||
                                            layerNameUpper.includes("VISEME_")
                                        ) {
                                            const foundSuffix = layerNameUpper.split("_").pop();
                                            if (foundSuffix && foundSuffix in shapeMatches) {
                                                tags.push("Mouth");
                                                tags.push("Viseme");
                                                tags.push(
                                                    shapeMatches[foundSuffix as keyof typeof shapeMatches]
                                                );
                                            }
                                        }
                                        
                                        const isBlink = layerNameUpper.includes("BLINK");
                                        if (isBlink) {
                                            tags.push("Blink");
                                        }
                                        
                                        if (dataUri) {
                                            if (tags.includes("Mouth") && tags.includes("Viseme")) {
                                                const restIndex = tags.indexOf("Viseme");
                                                if (restIndex > -1 && tags.includes(VisemeShape.REST)) {
                                                    tags.splice(restIndex, 1);
                                                }
                                            }
                                            
                                            newCharacter[partId] = createPart(
                                                partId,
                                                overrideName || layer.name || "PSD Layer",
                                                parentId,
                                                globalZIndex--,
                                                {
                                                    imageUrl: dataUri,
                                                    isVisible: tags.includes(VisemeShape.REST) ? true : (tags.includes("Viseme") ? false : layer.hidden !== true),
                                                    width: layerWidth,
                                                    height: layerHeight,
                                                    transform: {
                                                        ...DEFAULT_TRANSFORM,
                                                        x: offsetX,
                                                        y: offsetY,
                                                        scaleX: 1,
                                                        scaleY: 1,
                                                    },
                                                    children: [],
                                                    tags: tags,
                                                }
                                            );
                                            
                                            newCharacter[parentId].children.push(partId);
                                            return partId;
                                        }
                                    }
                                } catch (layerErr) {
                                    console.warn("Failed psd layers element", layer.name, layerErr);
                                }
                                return undefined;
                            }
                        };
                        
                        for (let i = psd.children.length - 1; i >= 0; i--) {
                            await processLayer(psd.children[i], "root");
                        }
                    }
                    
                    parsed = newCharacter;
            } else {
                try {
                    text = await blob.text();
                    const cleanText = text.trim().replace(/^\uFEFF/, "");
                    parsed = JSON.parse(cleanText);
                } catch (jsonParseErr) {
                    try {
                        const zip = await JSZip.loadAsync(blob);
                        let jsonFileEntry: any = null;
                        
                        zip.forEach((relativePath, entry) => {
                            const isJunk = relativePath.includes('__MACOSX') || relativePath.split('/').some(p => p.startsWith('.'));
                            if (!entry.dir && !isJunk && (relativePath.endsWith('.json') || relativePath.endsWith('.animato') || relativePath.endsWith('.animato_project'))) {
                                jsonFileEntry = entry;
                            }
                        });

                        if (!jsonFileEntry) {
                            zip.forEach((relativePath, entry) => {
                                const isJunk = relativePath.includes('__MACOSX') || relativePath.split('/').some(p => p.startsWith('.'));
                                if (!entry.dir && !isJunk && !jsonFileEntry) {
                                    jsonFileEntry = entry;
                                }
                            });
                        }

                        if (jsonFileEntry) {
                            text = await jsonFileEntry.async('string');
                            const cleanText = text.trim().replace(/^\uFEFF/, "");
                            parsed = JSON.parse(cleanText);
                        } else {
                            throw new Error("No files found inside downloaded ZIP.");
                        }
                    } catch (zipError) {
                        throw new Error("File could not be parsed as direct JSON animation nor zipped metadata.");
                    }
                }
            }

            if (parsed) {
                if (parsed.metadata && parsed.assemblerConfig) {
                    const newCharacter: any = {};
                    const { assemblerConfig, riggingConfig, assets } = parsed;
                    const sf = (v: any, def = 0) => (typeof v === "number" && !isNaN(v) ? v : def);
                    Object.entries(assemblerConfig as Record<string, any>).forEach(([partId, config]) => {
                        const rawBones = (riggingConfig as any)?.[partId]?.bones || [];
                        const sanitizedBones = rawBones.map((b: any) => ({
                            ...b,
                            startX: sf(b.startX),
                            startY: sf(b.startY),
                            endX: sf(b.endX),
                            endY: sf(b.endY),
                            length: sf(b.length),
                            angle: sf(b.angle),
                        }));
                        newCharacter[partId] = {
                            ...config,
                            imageUrl: config.assetId && assets ? assets[config.assetId] : null,
                            bones: sanitizedBones,
                        };
                    });
                    parsed = newCharacter;
                }

                if (!isProject) {
                    const charId = "char_" + Date.now();
                    if (!parsed.composition) {
                        const extractedVisemeMap: Record<string, string | null> = {
                          REST: null, AI: null, E: null, O: null, U: null, FV: null, L: null, MBP: null, CONS: null
                        };
                        Object.values(parsed).forEach((part: any) => {
                          if ((part.tags?.includes("Viseme") || (part.tags?.includes("Mouth") && part.tags?.includes("REST"))) && part.imageUrl) {
                            const shapeIds = ["REST", "AI", "E", "O", "U", "FV", "L", "MBP", "CONS"];
                            const shape = part.tags.find((t: string) => shapeIds.includes(t));
                            if (shape) extractedVisemeMap[shape] = part.imageUrl;
                          }
                        });
                        
                        parsed = {
                            id: charId,
                            name: product.productName,
                            composition: autoCalculatePivots(parsed),
                            visemeMap: extractedVisemeMap,
                            origin: "DESIGNER"
                        };
                    } else {
                        parsed.composition = autoCalculatePivots(parsed.composition);
                    }
                    if (!parsed.id) parsed.id = charId;
                    
                    finalProjectData = {
                       id: `proj_${Date.now()}`,
                       name: product.productName,
                       projectType: 'CHARACTER',
                       characters: [parsed],
                       activeSceneCharacterId: parsed.id,
                       animationData: {},
                       timelineDuration: 60,
                       playheadPosition: 0,
                       lastModified: Date.now(),
                       storeProductId: product.id
                    };
                } else {
                    finalProjectData = parsed;
                    if (!finalProjectData.id) finalProjectData.id = `proj_${Date.now()}`;
                    if (!finalProjectData.name) finalProjectData.name = product.productName;
                    finalProjectData.lastModified = Date.now();
                    finalProjectData.storeProductId = product.id;
                }

                // Skip immediate block-heavy DB storage to allow instantaneous render
                // The main App.tsx auto-save logic will persist this naturally over time!
                StorageUtils.saveProject(finalProjectData).catch(e => console.warn("Background save delay:", e));
                setFinalProjectDataState(finalProjectData);

                // Seamlessly launch into the workspace immediately for a top-tier user experience
                if (finalProjectData) {
                    setShowOptionsScreen(true);
                    setDownloadStep('idle');
                    setDownloading(false);
                }
            }
        } catch (importErr) {
            console.warn("Local storage parsing or background import failed:", importErr);
            showAppToast("Error parsing file structure. Reverting.");
            setDownloadStep('idle');
            setDownloading(false);
            return;
        }

        setHasDownloadedThisSession(true);
        // It's closed via auto-launch in the timeout, but just to be safe
    } catch (e: any) {
        console.error("Download failure:", e);
        showAppToast(e.message || "Failed to load item. Please check your network connection.");
        setDownloadStep('idle');
        setDownloading(false);
    }
  };

  const rawRating = parseFloat(product.starRating || '0');
  const ratingValue = Math.floor(rawRating);
  
  const ratingUi = ratingValue <= 0 ? (
    <div className="flex items-center gap-1.5 text-gray-500 text-[10px] font-black uppercase tracking-widest bg-white/5 py-1.5 px-3 rounded-full border border-white/5 shadow-sm w-max">
       <span className="w-1.5 h-1.5 rounded-full bg-gray-600 animate-pulse" />
       Not rated by Animato Studio
    </div>
  ) : (
    <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/20 py-1.5 px-3.5 rounded-full shadow-sm w-max">
      <span className="text-[11px] tracking-tight flex gap-0.5 animate-pulse">
        {"🌟".repeat(ratingValue)}
      </span>
      <span className="text-[10px] text-amber-400 font-black uppercase tracking-widest leading-none">Rated by Animato</span>
    </div>
  );

  if (loading) {
    return (
      <div className="fixed inset-0 z-[10000] bg-[#050505] flex items-center justify-center p-6 text-center">
        <div className="max-w-md w-full animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="relative mb-8">
            <div className="w-24 h-24 border-b-4 border-cyan-500 rounded-full animate-spin mx-auto opacity-80" />
            <div className="absolute inset-0 flex items-center justify-center">
                <Sparkles className="w-8 h-8 text-cyan-400 animate-pulse" />
            </div>
          </div>
          
          <h2 className="text-3xl font-bold text-white mb-2 tracking-tight">
            Preparing Payment...
          </h2>

          <div className="bg-[#111] border border-white/5 rounded-2xl p-4 mb-6 text-left">
             <div className="flex justify-between items-center mb-1">
                <span className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">Account</span>
                <span className="text-xs text-white truncate ml-4">
                  {(user?.email || JSON.parse(localStorage.getItem('app_user') || '{}').email || '').trim() || 'Guest'}
                </span>
             </div>
             <div className="flex justify-between items-center">
                <span className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">Asset</span>
                <span className="text-xs text-cyan-400 font-bold uppercase tracking-widest">{product.productName}</span>
             </div>
          </div>
          
          <p className="text-gray-400 text-sm">
            Please wait while we connect you to our secure payment partner, Paystack.
          </p>

          <div className="mt-8 flex justify-center gap-2">
            {[0, 1, 2].map((i) => (
                <div
                    key={i}
                    className="w-1.5 h-1.5 bg-cyan-500 rounded-full animate-pulse"
                    style={{ animationDelay: `${i * 0.2}s` }}
                />
            ))}
          </div>
        </div>
      </div>
    );
  }



  return (
    <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <button onClick={onClose} className="fixed top-4 right-4 z-[110] p-3 bg-black/50 hover:bg-black/80 rounded-full text-white backdrop-blur-md transition-colors border border-white/10">
          <X size={24}/>
      </button>
      <div className="max-w-3xl w-full max-h-[85vh] bg-[#0c0c0e] rounded-3xl border border-white/10 flex flex-col md:flex-row shadow-2xl animate-in zoom-in-95 duration-200 relative overflow-y-auto md:overflow-hidden h-fit md:h-[580px]">
         
         {(downloading || downloadStep === 'success') && (
           <div className="absolute inset-0 z-[120] bg-[#09090c]/98 backdrop-blur-xl flex flex-col items-center justify-center p-8 text-center animate-in fade-in duration-300">
             <div className={`${downloadStep === 'success' ? 'max-w-md' : 'max-w-xs'} w-full bg-[#121216] border border-white/5 p-6 rounded-[28px] shadow-2xl flex flex-col items-center transition-all duration-300`}>
                 {downloadStep === 'downloading' && (
                     <>
                         <div className="relative mb-5 flex items-center justify-center">
                             <div className="w-16 h-16 border-t-2 border-r-2 border-[#00e5ff] rounded-full animate-spin" />
                             <div className="absolute inset-x-0 mx-auto w-12 h-12 bg-[#00e5ff]/10 rounded-full flex items-center justify-center">
                                 <span className="text-[10px] font-black font-mono text-[#00e5ff]">{downloadProgress}%</span>
                             </div>
                         </div>
                         <h3 className="text-xs font-black text-white mb-2 uppercase tracking-wider">
                             Loading Assets...
                         </h3>
                         
                         {/* Dynamic Progress Bar */}
                         <div className="w-full bg-white/5 h-1.5 rounded-full overflow-hidden mb-3">
                             <div 
                                 className="h-full bg-gradient-to-r from-cyan-400 to-indigo-500 rounded-full transition-all duration-300"
                                 style={{ width: `${downloadProgress}%` }}
                             />
                         </div>
                         <span className="text-[#00e5ff] text-xs font-mono font-black mb-1">{downloadProgress}% Loaded</span>

                         <p className="text-[10px] text-gray-400 font-semibold leading-normal">
                             Opening <span className="text-[#00e5ff]">{product.productName}</span>...
                         </p>
                     </>
                 )}
                 {downloadStep === 'opening' && (
                     <>
                         <div className="relative mb-5 flex items-center justify-center">
                             <div className="w-16 h-16 border-t-2 border-[#00e5ff] rounded-full animate-spin" />
                             <div className="absolute inset-x-0 mx-auto w-12 h-12 bg-[#00e5ff]/5 rounded-full flex items-center justify-center">
                                 <Sparkles className="w-5 h-5 text-[#00e5ff] animate-pulse" />
                             </div>
                         </div>
                         <h3 className="text-xs font-black text-white mb-1 uppercase tracking-wider">
                             Loading assets in Animato Studio...
                         </h3>
                         <p className="text-[10px] text-gray-400 font-semibold leading-normal">
                             Synchronizing workspace...
                         </p>
                     </>
                 )}
             </div>
           </div>
         )}

         <div className="w-full md:w-7/12 bg-black relative flex items-center justify-center min-h-[300px] md:h-full overflow-hidden">
            {activeMedia === 'video' && hasVideo ? (
                <div className="w-full h-full flex items-center justify-center bg-black min-h-[300px] md:h-full">
                    <video 
                        src={product.videoUrl} 
                        className="w-full h-full max-h-[320px] md:max-h-[480px] object-contain rounded-2xl"
                        autoPlay
                        muted
                        loop
                        playsInline
                        controls
                    />
                    <div className="absolute top-4 left-4 bg-purple-500/10 border border-purple-500/20 backdrop-blur-md px-3 py-1 rounded-full text-[9px] font-black tracking-widest text-[#00e5ff] uppercase">
                        PREVIEW VIDEO
                    </div>
                </div>
            ) : (
                <ProductImage 
                   src={galleryImages.length > 0 ? galleryImages[currentImgIdx] : undefined} 
                   alt="Product image" 
                   className="w-full h-full max-h-[320px] md:max-h-[480px]" 
                   imgClassName="object-contain" 
                />
            )}
            
            <div className="absolute bottom-4 left-0 right-0 flex flex-col items-center gap-2 px-4 z-10 pointer-events-auto">
                <div className="flex gap-2 items-center bg-black/90 border border-white/10 px-4 py-2 rounded-2xl shrink-0 overflow-x-auto max-w-[280px] sm:max-w-md justify-center shadow-2xl">
                    {hasVideo && (
                        <button 
                            onClick={() => { setActiveMedia('video'); }}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[9px] font-black tracking-widest uppercase transition-all shrink-0 ${
                                activeMedia === 'video' 
                                ? 'bg-gradient-to-r from-purple-500 to-indigo-500 text-white shadow-lg' 
                                : 'bg-[#121215] text-gray-400 hover:text-white border border-white/5'
                            }`}
                        >
                            <Play size={10} className="fill-current text-current" /> Video
                        </button>
                    )}
                    {galleryImages.map((img: string, i: number) => (
                        <button 
                            key={i} 
                            onClick={() => { setActiveMedia('image'); setCurrentImgIdx(i); }}
                            className={`w-10 h-10 rounded-xl overflow-hidden shrink-0 border transition-all relative ${
                                activeMedia === 'image' && currentImgIdx === i 
                                ? 'border-[#00e5ff] scale-110 shadow-lg' 
                                : 'border-white/10 hover:border-white/30'
                            }`}
                        >
                            <img src={img} referrerPolicy="no-referrer" alt={`Thumb ${i}`} className="w-full h-full object-cover" />
                        </button>
                    ))}
                </div>
            </div>
         </div>

         {showOptionsScreen ? (
            importSubView === 'options' ? (
              <div className="w-full md:w-5/12 p-6 md:p-8 flex flex-col justify-between md:h-full md:overflow-y-auto custom-scrollbar animate-in fade-in slide-in-from-right-4 duration-300">
                 <div>
                    <button 
                      onClick={() => {
                        setShowOptionsScreen(false);
                      }}
                      className="flex items-center gap-2 text-xs font-bold text-gray-500 hover:text-white mb-6 transition-colors cursor-pointer"
                    >
                      <ArrowLeft size={14} /> Back to Product
                    </button>
                    
                    <h3 className="text-lg font-black text-white tracking-tight mb-1">
                      Asset Ready!
                    </h3>
                    <p className="text-xs text-gray-400 mb-6 leading-relaxed">
                      Choose how you would like to open or import <span className="text-[#00e5ff] font-extrabold">{product.productName}</span>.
                    </p>

                    <div className="flex flex-col gap-3">
                       {/* OPTION 1: Open in a New Project */}
                       <button
                          onClick={() => {
                             if (finalProjectDataState) {
                                 onOpenProject(finalProjectDataState);
                                 onClose();
                             }
                          }}
                          className="w-full text-left p-4 rounded-2xl bg-[#121215] border border-white/5 hover:border-[#00e5ff]/50 hover:bg-white/5 transition-all group flex items-start gap-3.5 cursor-pointer"
                       >
                          <div className="p-2.5 rounded-xl bg-cyan-500/10 text-cyan-400 group-hover:scale-110 transition-transform">
                             <FilePlus2 size={20} />
                          </div>
                          <div>
                             <h4 className="text-xs font-black text-white uppercase tracking-wider group-hover:text-cyan-400 transition-colors">
                                Open in New Project
                             </h4>
                             <p className="text-[10px] text-gray-400 font-medium leading-normal mt-1">
                                Create a fresh new workspace starring this character.
                             </p>
                          </div>
                       </button>

                       {/* OPTION 2: Import into Existing Project */}
                       <button
                          onClick={() => {
                             setImportSubView('project_list');
                          }}
                          className="w-full text-left p-4 rounded-2xl bg-[#121215] border border-white/5 hover:border-[#00e5ff]/50 hover:bg-white/5 transition-all group flex items-start gap-3.5 cursor-pointer"
                       >
                          <div className="p-2.5 rounded-xl bg-purple-500/10 text-purple-400 group-hover:scale-110 transition-transform">
                             <FolderOpen size={20} />
                          </div>
                          <div>
                             <h4 className="text-xs font-black text-white uppercase tracking-wider group-hover:text-purple-400 transition-colors">
                                Open in Existing Project
                             </h4>
                             <p className="text-[10px] text-gray-400 font-medium leading-normal mt-1">
                                Add this asset into an active stage project.
                             </p>
                          </div>
                       </button>

                     </div>
                 </div>
              </div>
            ) : (
              <div className="w-full md:w-5/12 p-6 md:p-8 flex flex-col justify-between md:h-full md:overflow-y-auto custom-scrollbar animate-in fade-in slide-in-from-right-4 duration-300">
                 <div className="flex flex-col h-full justify-between">
                    <div>
                       <button 
                         onClick={() => {
                           setImportSubView('options');
                         }}
                         className="flex items-center gap-2 text-xs font-bold text-gray-500 hover:text-white mb-6 transition-colors cursor-pointer"
                       >
                         <ArrowLeft size={14} /> Back to Options
                       </button>
                       
                       <h3 className="text-lg font-black text-white tracking-tight mb-1">
                         Select Stage Project
                       </h3>
                       <p className="text-xs text-gray-400 mb-6 leading-relaxed">
                         Choose an existing project from your stage to import this character into.
                       </p>

                       {(() => {
                          const characterProjects = (savedProjects || []).filter(p => p.projectType === 'CHARACTER');
                          if (characterProjects.length === 0) {
                             return (
                                <div className="w-full flex flex-col items-center justify-center p-6 border border-white/5 rounded-2xl bg-[#121215] text-center">
                                   <FolderPlus size={32} className="text-gray-600 mb-3 animate-pulse" />
                                   <h4 className="text-xs font-black text-white uppercase tracking-wider mb-1">
                                      No Active Projects
                                   </h4>
                                   <p className="text-[10px] text-gray-500 font-medium leading-normal">
                                      We couldn't find any character projects on stage. Create a project first to import assets into.
                                   </p>
                                </div>
                             );
                          }
                          return (
                             <div className="w-full overflow-y-auto max-h-[250px] pr-1.5 custom-scrollbar mb-4">
                                {characterProjects.map((p) => {
                                   const isSelected = selectedProjId === p.id;
                                   return (
                                      <div
                                         key={p.id}
                                         onClick={() => setSelectedProjId(p.id)}
                                         className={`p-3 rounded-xl border transition-all cursor-pointer flex items-center gap-3.5 mb-2.5 ${
                                            isSelected 
                                            ? 'border-[#00e5ff] bg-[#00e5ff]/5' 
                                            : 'border-white/5 bg-[#121215] hover:bg-white/5'
                                         }`}
                                      >
                                         {p.thumbnail ? (
                                            <img src={p.thumbnail} alt={p.name} className="w-10 h-10 rounded-lg object-cover bg-black border border-white/10 shrink-0" />
                                         ) : (
                                            <div className="w-10 h-10 rounded-lg bg-cyan-500/10 text-cyan-400 flex items-center justify-center border border-cyan-500/10 shrink-0">
                                               <Folder size={18} />
                                            </div>
                                         )}
                                         <div className="flex-1 min-w-0">
                                            <h4 className="text-xs font-black text-white truncate uppercase tracking-wider text-left">
                                               {p.name}
                                            </h4>
                                            <p className="text-[9px] text-gray-500 font-bold uppercase tracking-wider mt-0.5 text-left">
                                               Modified: {new Date(p.lastModified).toLocaleDateString()}
                                            </p>
                                         </div>
                                         <div className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${
                                            isSelected 
                                            ? 'border-[#00e5ff] bg-[#00e5ff]' 
                                            : 'border-gray-600'
                                         }`}>
                                            {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-black" />}
                                         </div>
                                      </div>
                                   );
                                })}
                             </div>
                          );
                       })()}
                    </div>

                    {(savedProjects || []).filter(p => p.projectType === 'CHARACTER').length > 0 && (
                       <button
                          disabled={!selectedProjId || importingToProj}
                          onClick={async () => {
                             const dataToImport = finalProjectDataState || (preparedBlob ? new File([preparedBlob], preparedFilename, { type: preparedBlob.type }) : null);
                             if (dataToImport && onImportToExistingProject) {
                                setImportingToProj(true);
                                await onImportToExistingProject(selectedProjId, dataToImport);
                                setImportingToProj(false);
                                onClose();
                             }
                          }}
                          className={`w-full py-4 rounded-xl font-black text-xs uppercase tracking-widest flex items-center justify-center gap-3 transition-transform active:scale-95 cursor-pointer bg-[#00e5ff] text-black border border-transparent shadow-xl hover:brightness-110 mt-auto ${
                             (!selectedProjId || importingToProj) ? 'opacity-50 cursor-not-allowed bg-gray-800 text-gray-400 border-white/5' : ''
                          }`}
                       >
                          {importingToProj ? (
                             <><div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"/> Importing...</>
                          ) : (
                             <><CheckCircle2 size={16} /> Import & Open Project</>
                          )}
                       </button>
                    )}
                 </div>
              </div>
            )
         ) : (
            <div className="w-full md:w-5/12 p-6 md:p-8 flex flex-col justify-between md:h-full md:overflow-y-auto custom-scrollbar">
               <div>
                  <div className="mb-4">
                     {ratingUi}
                  </div>

                  <div className="text-[10px] text-cyan-400 font-bold uppercase tracking-widest mb-1.5">
                      {product.category || 'Animato Asset'}
                  </div>
                  <h2 className="text-xl md:text-2xl font-black text-white leading-tight mb-2 tracking-tight text-left">
                      {product.productName}
                  </h2>

                  <div className="flex flex-col gap-2 text-xs font-semibold tracking-wider text-gray-400 mt-3 mb-6">
                      <div className="flex items-center gap-1.5 text-gray-400 text-[10px] font-bold uppercase tracking-wider bg-white/5 rounded-xl px-3.5 py-1.5 border border-white/5 w-max">
                         <User size={11} className="text-[#00e5ff]" /> Designed by: <span className="text-[#00e5ff] font-extrabold ml-1">{product.sellerId}</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-gray-400 text-[10px] font-bold uppercase tracking-wider bg-white/5 rounded-xl px-3.5 py-1.5 border border-white/5 w-max">
                         <Users size={11} className="text-cyan-400 animate-bounce" /> Total users: <span className="text-gray-200 font-extrabold ml-1">{parseInt(product.timesPurchased || '0').toLocaleString()}</span>
                      </div>
                  </div>

                  <p className="text-gray-400 text-xs font-medium leading-relaxed mb-6 text-left border-l border-white/10 pl-3">
                      {product.productDescription || "No description provided for this premium Animato asset. Fully optimized for instant timeline layout integrations."}
                  </p>
               </div>

               <div>
                  <div className="p-5 rounded-2xl bg-[#111114] border border-white/5 mb-6">
                     <div className="text-gray-500 text-[10px] font-black uppercase tracking-widest mb-1">Price ({countryCode})</div>
                     <div className="text-3xl font-black text-white flex items-center tracking-tight">
                        {formattedPrice}
                     </div>
                  </div>

                  {/* Format select removed per requirement */}

                  {(isFree || purchased) && isProject && (
                     <div className="mb-6 text-left animate-in fade-in slide-in-from-bottom-2 duration-200">
                         <label className="text-gray-400 text-[10px] font-black uppercase tracking-widest block mb-1">
                             Format Automatically Selected
                         </label>
                         <div className="relative opacity-80">
                             <select 
                                 disabled
                                 value="animato_project"
                                 className="w-full bg-[#16161a] border border-white/5 text-gray-400 rounded-xl px-4 py-3.5 text-xs font-bold appearance-none pr-10 cursor-not-allowed"
                             >
                                 <option value="animato_project">🎬 Animato Project File (.animato_project)</option>
                             </select>
                             <div className="absolute inset-y-0 right-3 flex items-center pointer-events-none text-gray-500">
                                 <Lock size={12} />
                             </div>
                         </div>
                         <p className="text-[10px] text-gray-500 font-medium leading-normal mt-2 pl-0.5">
                             Project template file. Saves as .animato_project and opens in timeline editor.
                         </p>
                     </div>
                  )}
                  
                  {hasDownloadedThisSession ? (
                      <button 
                          onClick={async () => {
                              setShowOptionsScreen(true);
                          }}
                          className="w-full py-4 rounded-xl font-black text-xs uppercase tracking-widest flex items-center justify-center gap-3 transition-transform active:scale-95 cursor-pointer bg-gradient-to-r from-emerald-500 to-emerald-600 border border-emerald-500/50 text-white shadow-xl hover:brightness-110"
                      >
                          <CheckCircle2 size={18} className="text-white shrink-0 animate-pulse" />
                          Load in Studio
                      </button>
                  ) : (
                      <button 
                          onClick={handlePurchase}
                          disabled={downloading}
                          className={`w-full py-4 rounded-xl font-black text-xs uppercase tracking-widest flex items-center justify-center gap-3 transition-transform active:scale-95 cursor-pointer ${
                              downloading ? 'opacity-50 cursor-not-allowed bg-gray-800 text-gray-400' :
                              (isFree || purchased)
                              ? 'bg-white text-black hover:bg-gray-200 shadow-lg' 
                              : 'bg-gradient-to-r from-[#00e5ff] to-blue-600 text-white hover:from-cyan-300 hover:to-blue-500 shadow-xl'
                          }`}
                      >
                          {downloading ? (
                              <><div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"/> Loading...</>
                          ) : (isFree || purchased) ? (
                              <><Play size={18} className="fill-current"/> Load in Studio</>
                          ) : (
                              <><ShoppingCart size={18}/> Buy Now</>
                          )}
                      </button>
                  )}
               </div>
            </div>
         )}
      </div>
    </div>
  );
};
