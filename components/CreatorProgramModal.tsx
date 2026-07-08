import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Star, Package, Users, Plus, ExternalLink, Copy, AlertTriangle, Trash2, ArrowRight, Lock, Edit, Image as ImageIcon, FileText, CheckCircle2, UploadCloud, Hourglass } from 'lucide-react';
import { db, collection, doc, setDoc, getDocs, query, where, serverTimestamp, deleteDoc, updateDoc } from '../utils/firebase';
import { useLanguage } from '../utils/LanguageContext';
import { detectUserCountry, getScaledPrice } from '../utils/pppPricing';
import { uploadToDropbox } from '../utils/dropbox';
import { getBackendApiUrl } from '../utils/api';

interface CreatorProgramModalProps {
    user: any;
    onClose: () => void;
}

const getApiUrl = (path: string): string => {
    return getBackendApiUrl(path);
};

export function CreatorProgramModal({ user, onClose }: CreatorProgramModalProps) {
    // Determine eligibility simply by logged in user email
    const isEligible = !!user?.email;
    
    const { t } = useLanguage();
    const [countryCode, setCountryCode] = useState<string>('NG');
    const [paystackLoading, setPaystackLoading] = useState<boolean>(false);
    const [paystackError, setPaystackError] = useState<string | null>(null);

    useEffect(() => {
        detectUserCountry().then(setCountryCode);
    }, []);

    const [step, setStep] = useState('select_role');
    const [loading, setLoading] = useState(true);

    const [sellerData, setSellerData] = useState<any>(null);
    const [refData, setRefData] = useState<any>(null);

    const [sellerId, setSellerId] = useState<string | null>(null);
    const [refId, setRefId] = useState<string | null>(null);

    const [hasFetched, setHasFetched] = useState(false);
    const [imageUploading, setImageUploading] = useState(false);

    useEffect(() => {
        if (!hasFetched && user?.email) {
            fetchDetails();
            setHasFetched(true);
        } else if (!user?.email) {
            setLoading(false);
        }
    }, [hasFetched, user]);

    const fetchDetails = async () => {
        setLoading(true);

        try {
            const email = user?.email?.toLowerCase()?.trim();
            if (!email) {
                setStep('ineligible');
                setLoading(false);
                return;
            }

            console.log("Running client-side direct-Firestore query for creator details");
            let foundSeller: any = null;
            let foundRef: any = null;
            let finalSellerId = "";
            let finalRefId = "";

            // Query Sellers
            const sellerQ = query(collection(db, 'sellers'), where('email', '==', email));
            const sellerSnap = await getDocs(sellerQ);
            if (!sellerSnap.empty) {
                const snapDoc = sellerSnap.docs[0];
                const data = snapDoc.data();
                finalSellerId = data.sellerId || snapDoc.id;
                foundSeller = {
                    payout: String(data.payout !== undefined ? data.payout : "0"),
                    bankName: data.bankName || "",
                    bankOwner: data.bankOwnerName || "",
                    accountNum: data.accountNumber || "",
                    email: data.email
                };
            }

            // Query Referrals
            const refQ = query(collection(db, 'referrals'), where('email', '==', email));
            const refSnap = await getDocs(refQ);
            if (!refSnap.empty) {
                const snapDoc = refSnap.docs[0];
                const data = snapDoc.data();
                finalRefId = data.referralId || snapDoc.id;
                foundRef = {
                    payout: String(data.payout !== undefined ? data.payout : "0"),
                    refs: String(data.numberOfReferences !== undefined ? data.numberOfReferences : "0"),
                    referralCode: finalRefId || "",
                    bankName: data.bankName || "",
                    bankOwner: data.bankOwnerName || "",
                    accountNum: data.accountNumber || ""
                };
            }

            // Optional background sync
            try {
                const detailsUrl = getApiUrl(`/api/creator/details?email=${encodeURIComponent(email)}`);
                fetch(detailsUrl).catch(e => console.warn(e));
            } catch (err) {}

            if (finalSellerId) {
                setSellerId(finalSellerId);
                setSellerData(foundSeller || { payout: 0 });
            } else {
                setSellerId(null);
                setSellerData(null);
            }

            if (finalRefId) {
                setRefId(finalRefId);
                setRefData(foundRef || { payout: 0, refs: 0 });
            } else {
                setRefId(null);
                setRefData(null);
            }

            const currentBankName = foundSeller?.bankName || foundRef?.bankName || "";
            const currentBankOwner = foundSeller?.bankOwner || foundSeller?.bankOwnerName || foundRef?.bankOwner || foundRef?.bankOwnerName || "";
            const currentAccountNum = foundSeller?.accountNum || foundSeller?.accountNumber || foundRef?.accountNum || foundRef?.accountNumber || "";

            setBankName(currentBankName);
            setBankOwnerName(currentBankOwner);
            setAccountNumber(currentAccountNum);

            if (finalSellerId || finalRefId) {
                setStep('dashboard');
                if (finalSellerId && !finalRefId) {
                    setViewingPayout('seller');
                    setActiveTab('payout');
                } else if (!finalSellerId && finalRefId) {
                    setViewingPayout('referral');
                    setActiveTab('referrals');
                } else {
                    setViewingPayout('seller');
                    setActiveTab('payout');
                }
            } else {
                // Not enrolled as creator yet. Check if subscription permits registration.
                const subType = (user?.subscription_type || '').toLowerCase().trim();
                const isSubActive = user?.subscription_status === 'active';
                const hasAllowedPlan = ['monthly', 'yearly'].includes(subType);
                const hasAccess = isSubActive && hasAllowedPlan;

                if (!hasAccess) {
                    setStep('restricted');
                } else {
                    setStep('select_role');
                }
            }
        } catch (e) {
            console.error("Error fetching creator details:", e);
            // Default check on error to protect registration
            const subType = (user?.subscription_type || '').toLowerCase().trim();
            const isSubActive = user?.subscription_status === 'active';
            const hasAllowedPlan = ['monthly', 'yearly'].includes(subType);
            const hasAccess = isSubActive && hasAllowedPlan;
            if (!hasAccess) {
                setStep('restricted');
            } else {
                setStep('select_role');
            }
        }
        setLoading(false);
    };

    const handleJoin = async (type: 'seller' | 'referral' | 'both') => {
        setLoading(true);
        try {
            const email = user?.email?.toLowerCase()?.trim();
            if (!email) {
                alert("Email not found.");
                setLoading(false);
                return;
            }
            let joinSuccess = false;
            
            const apiUrl = getApiUrl('/api/creator/join');

            try {
                const joinRes = await fetch(apiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ type, email })
                });
                if (joinRes.ok) {
                    const joinData = await joinRes.json();
                    if (joinData && joinData.status) {
                        joinSuccess = true;
                    }
                }
            } catch (err) {
                console.warn("Backend join fetch failed, falling back to direct client join", err);
            }

            if (!joinSuccess) {
                console.log("Executing direct client Firestore join fallback...");
                const baseName = email.split('@')[0].replace(/[^a-zA-Z0-9]/g, '');

                let existingBankName = "";
                let existingBankOwner = "";
                let existingAccNumber = "";

                const exRefQuery = query(collection(db, 'referrals'), where('email', '==', email));
                const exRefSnap = await getDocs(exRefQuery);
                if (!exRefSnap.empty) {
                    const data = exRefSnap.docs[0].data();
                    existingBankName = data.bankName || "";
                    existingBankOwner = data.bankOwnerName || "";
                    existingAccNumber = data.accountNumber || "";
                }

                const exSelQuery = query(collection(db, 'sellers'), where('email', '==', email));
                const exSelSnap = await getDocs(exSelQuery);
                if (!exSelSnap.empty && (!existingBankName || !existingBankOwner || !existingAccNumber)) {
                    const data = exSelSnap.docs[0].data();
                    existingBankName = data.bankName || existingBankName;
                    existingBankOwner = data.bankOwnerName || existingBankOwner;
                    existingAccNumber = data.accountNumber || existingAccNumber;
                }

                if (type === 'seller' || type === 'both') {
                    const sellerQ = query(collection(db, 'sellers'), where('email', '==', email));
                    const sellerSnap = await getDocs(sellerQ);
                    if (sellerSnap.empty) {
                        const finalSellerId = `${baseName}${Math.floor(100 + Math.random() * 900)}`;
                        await setDoc(doc(db, 'sellers', finalSellerId), {
                            sellerId: finalSellerId,
                            email: email,
                            payout: 0,
                            bankName: existingBankName,
                            bankOwnerName: existingBankOwner,
                            accountNumber: existingAccNumber,
                            createdAt: serverTimestamp(),
                            updatedAt: serverTimestamp()
                        });
                    }
                }

                if (type === 'referral' || type === 'both') {
                    const refQ = query(collection(db, 'referrals'), where('email', '==', email));
                    const refSnap = await getDocs(refQ);
                    if (refSnap.empty) {
                        const finalReferralId = `${baseName}${Math.floor(100 + Math.random() * 900)}`;
                        await setDoc(doc(db, 'referrals', finalReferralId), {
                            referralId: finalReferralId,
                            referralCode: finalReferralId,
                            email: email,
                            payout: 0,
                            numberOfReferences: 0,
                            bankName: existingBankName,
                            bankOwnerName: existingBankOwner,
                            accountNumber: existingAccNumber,
                            createdAt: serverTimestamp(),
                            updatedAt: serverTimestamp()
                        });
                    }
                }
                joinSuccess = true;
            }

            if (joinSuccess) {
                await fetchDetails();
            } else {
                alert("Failed to join.");
            }
        } catch (e: any) {
            console.error("Join error:", e);
            alert("Join error: " + (e.message || "Unknown error"));
        }
        setLoading(false);
    };

    const [activeTab, setActiveTab] = useState<'payout' | 'products' | 'sales' | 'referrals'>('payout');
    const [viewingPayout, setViewingPayout] = useState<'seller' | 'referral'>('seller');
    
    // Payout details
    const [bankName, setBankName] = useState("");
    const [bankOwnerName, setBankOwnerName] = useState("");
    const [accountNumber, setAccountNumber] = useState("");
    const [currency, setCurrency] = useState('NGN');

    const saveBankDetails = async () => {
        setLoading(true);
        try {
            let storedEmail = '';
            try {
                const au = localStorage.getItem('app_user');
                if (au && au !== 'undefined' && au !== 'null') {
                    const parsed = JSON.parse(au);
                    storedEmail = parsed?.email || '';
                }
            } catch (authErr) {}

            const email = (user?.email || storedEmail || '').trim().toLowerCase();
            if (!email) {
                alert("Please log in again to update bank details.");
                setLoading(false);
                return;
            }
            
            let updated = false;

            // 1. PRIMARY LOGIC: DIRECT CLIENT FIRESTORE
            console.log("Using direct client Firestore to update bank details");
            
            // Update or Create Sellers
            const sellerQ = query(collection(db, 'sellers'), where('email', '==', email));
            const sellerSnap = await getDocs(sellerQ);
            if (!sellerSnap.empty) {
                for (const docSnap of sellerSnap.docs) {
                    await updateDoc(docSnap.ref, {
                        bankName,
                        bankOwnerName,
                        accountNumber,
                        updatedAt: serverTimestamp()
                    });
                    updated = true;
                }
            } else {
                const baseName = email.split('@')[0].replace(/[^a-zA-Z0-9]/g, '');
                const finalSellerId = `${baseName}${Math.floor(100 + Math.random() * 900)}`;
                await setDoc(doc(db, 'sellers', finalSellerId), {
                    sellerId: finalSellerId,
                    email: email,
                    payout: 0,
                    bankName,
                    bankOwnerName,
                    accountNumber,
                    createdAt: serverTimestamp(),
                    updatedAt: serverTimestamp()
                });
                updated = true;
            }

            // Update or Create Referrals
            const refQ = query(collection(db, 'referrals'), where('email', '==', email));
            const refSnap = await getDocs(refQ);
            if (!refSnap.empty) {
                for (const docSnap of refSnap.docs) {
                    await updateDoc(docSnap.ref, {
                        bankName,
                        bankOwnerName,
                        accountNumber,
                        updatedAt: serverTimestamp()
                    });
                    updated = true;
                }
            } else {
                const baseName = email.split('@')[0].replace(/[^a-zA-Z0-9]/g, '');
                const finalReferralId = `${baseName}${Math.floor(100 + Math.random() * 900)}`;
                await setDoc(doc(db, 'referrals', finalReferralId), {
                    referralId: finalReferralId,
                    referralCode: finalReferralId,
                    email: email,
                    payout: 0,
                    numberOfReferences: 0,
                    bankName,
                    bankOwnerName,
                    accountNumber,
                    createdAt: serverTimestamp(),
                    updatedAt: serverTimestamp()
                });
                updated = true;
            }

            // 2. BACKGROUND ADMIN SHEET SYNC
            try {
                // We MUST wait for the backend call to complete so Vercel Serverless doesn't kill the container
                await fetch(getApiUrl('/api/creator/seller/update-bank'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, bankName, bankOwnerName, accountNumber })
                });
            } catch (err) {
                console.warn("Backend sheet sync background task failed:", err);
            }

            if (updated) {
                alert("Bank details updated successfully!");
                // Instantly update the local display data too
                if (sellerData) {
                    setSellerData({ ...sellerData, bankName, bankOwner: bankOwnerName, accountNum: accountNumber });
                }
                if (refData) {
                    setRefData({ ...refData, bankName, bankOwner: bankOwnerName, accountNum: accountNumber });
                }
                await fetchDetails();
            } else {
                alert("Failed to update bank details: Account matching email not found.");
            }
        } catch(e: any) {
            console.error("Error saving bank details:", e);
            alert("Error saving bank details: " + (e.message || "Unknown error"));
        }
        setLoading(false);
    };

    // Product Add
    const [showAddProduct, setShowAddProduct] = useState(false);
    const [editingProductId, setEditingProductId] = useState<string | null>(null);
    const [productForm, setProductForm] = useState({ name: '', url: '', thumbnail: '', price: '', description: '', category: 'Project file' });
    const [selectedThumbnailFile, setSelectedThumbnailFile] = useState<File | null>(null);
    const [selectedResourceFile, setSelectedResourceFile] = useState<File | null>(null);
    const [thumbnailPreviewUrl, setThumbnailPreviewUrl] = useState<string>('');
    const [preloadedThumbnail, setPreloadedThumbnail] = useState<{ base64: string, name: string } | null>(null);
    const [preloadedResource, setPreloadedResource] = useState<{ base64: string, name: string } | null>(null);

    useEffect(() => {
        if (!selectedThumbnailFile) {
            setThumbnailPreviewUrl('');
            setPreloadedThumbnail(null);
            return;
        }
        let active = true;
        const reader = new FileReader();
        reader.onloadend = () => {
            if (active && reader.result) {
                setThumbnailPreviewUrl(reader.result as string);
            }
        };
        reader.readAsDataURL(selectedThumbnailFile);
        return () => {
            active = false;
        };
    }, [selectedThumbnailFile]);

    useEffect(() => {
        if (!selectedResourceFile) {
            setPreloadedResource(null);
        }
    }, [selectedResourceFile]);

    const [uploadProgress, setUploadProgress] = useState<number | null>(null);
    const [uploadEta, setUploadEta] = useState<number | null>(null);
    const [sellerProducts, setSellerProducts] = useState<any[]>([]);
    const [payoutCurrency, setPayoutCurrency] = useState<'NGN' | 'USD'>('NGN');
    const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
    const [loadingProducts, setLoadingProducts] = useState(false);

    const isDropboxUrl = (url: string): boolean => {
        if (!url) return false;
        return url.includes('dropbox.com') || url.includes('dropboxusercontent.com');
    };

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

    const fetchSellerProducts = async (currentSellerId: string | null = sellerId) => {
        if (!currentSellerId) return;
        setLoadingProducts(true);
        try {
            // 1. Fetch from Firestore (Direct Database) & Filter Case-Insensitively
            let dbProds: any[] = [];
            let loadedDirectly = false;
            try {
                const productsRef = collection(db, 'products');
                const productsSnap = await getDocs(productsRef);
                dbProds = productsSnap.docs.map(docSnap => {
                    const data = docSnap.data();
                    return {
                        id: docSnap.id,
                        price: data.price ? String(data.price) : '',
                        category: data.category,
                        thumbnail: data.thumbnail,
                        productImages: Array.isArray(data.images) ? data.images.join(',') : (data.images || ''),
                        amount: data.amount,
                        productName: data.name || data.productName || '',
                        timesPurchased: data.timesPurchased !== undefined ? Number(data.timesPurchased) : 0,
                        productUrl: data.productUrl || data.url || '',
                        sellerId: data.sellerId,
                        starRating: data.starRating || '5',
                        productDescription: data.productDescription || data.description || '',
                        videoUrl: data.videoUrl || '',
                        auditStatus: data.auditStatus || 'approved'
                    };
                }).filter(p => {
                    const pSeller = p.sellerId ? String(p.sellerId).toLowerCase().trim() : '';
                    const curSeller = currentSellerId ? String(currentSellerId).toLowerCase().trim() : '';
                    return pSeller && curSeller && pSeller === curSeller;
                });
                loadedDirectly = true;
            } catch (err) {
                console.error("Error fetching seller products from Firestore:", err);
            }
            
            // Set instantly so UI is perfectly persistent and immediate
            if (dbProds.length > 0) {
                setSellerProducts(dbProds);
                setLoadingProducts(false); // Stop loading immediately
            }

            // 2. Fetch from sheet API in background (just in case they are synced in sheets)
            const fetchSheetsBackground = async () => {
                let sheetProds: any[] = [];
                try {
                    const res = await fetch(getApiUrl('/api/store/products'));
                    const data = await res.json();
                    if (data.status && data.products) {
                        sheetProds = data.products.filter((p: any) => {
                            const pSeller = p.sellerId ? String(p.sellerId).toLowerCase().trim() : '';
                            const curSeller = currentSellerId ? String(currentSellerId).toLowerCase().trim() : '';
                            return pSeller && curSeller && pSeller === curSeller;
                        });
                    }
                } catch (err) {
                    console.error("Error fetching seller products from sheets API:", err);
                }

                // If firestore loaded successfully, only include sheet products that exist in dbProds (otherwise they were deleted)
                const activeSheetProds = loadedDirectly 
                    ? sheetProds.filter(sheetProd => {
                        return dbProds.some(dbProd => 
                            String(dbProd.id) === String(sheetProd.id) ||
                            ((dbProd.productName || '').toString().toLowerCase().trim() === (sheetProd.productName || '').toString().toLowerCase().trim())
                        );
                    })
                    : sheetProds;

                // 3. Merge products securely
                const merged = [...dbProds];
                
                // Supplement with activeSheetProds
                activeSheetProds.forEach(sheetProd => {
                    const sheetProdName = (sheetProd.productName || '').toString().toLowerCase().trim();
                    const matchIndex = merged.findIndex(p => {
                        const dbProdName = (p.productName || '').toString().toLowerCase().trim();
                        return String(p.id) === String(sheetProd.id) || 
                               (dbProdName && sheetProdName && sheetProdName === dbProdName);
                    });
                    
                    if (matchIndex !== -1) {
                        // Merge fields but PREFER direct Firestore db values (like timesPurchased, ID, amount, description)
                        merged[matchIndex] = {
                            ...sheetProd,
                            ...merged[matchIndex], // direct Firestore overrides spreadsheet
                            timesPurchased: Math.max(Number(merged[matchIndex].timesPurchased || 0), Number(sheetProd.timesPurchased || 0))
                        };
                    } else {
                        merged.push(sheetProd);
                    }
                });

                if (loadedDirectly) {
                    setSellerProducts(merged);
                } else {
                    if (merged.length > 0) {
                        setSellerProducts(merged);
                    }
                }
                setLoadingProducts(false);
            };
            
            fetchSheetsBackground();
        } catch (e) {
            console.error("Error in fetchSellerProducts:", e);
            setLoadingProducts(false);
        }
    };

    useEffect(() => {
        if (sellerId) {
            fetchSellerProducts(sellerId);
        }
    }, [sellerId]);

    const addProduct = async () => {
        if (loading) return;
        setLoading(true);
        setUploadProgress(1);
        try {
            if (!productForm.name.trim()) {
                alert("Please enter a product name.");
                setLoading(false);
                setUploadProgress(null);
                return;
            }

            if (!selectedThumbnailFile) {
                alert("Please select a thumbnail image to upload.");
                setLoading(false);
                setUploadProgress(null);
                return;
            }

            if (!selectedResourceFile) {
                alert(`Please select and upload the actual ${productForm.category || 'product'} file.`);
                setLoading(false);
                setUploadProgress(null);
                return;
            }

            const newProductId = "prod_" + Date.now();

            setUploadProgress(0);
            setUploadEta(null);

            const finalThumbnail = await uploadToDropbox(
                preloadedThumbnail || selectedThumbnailFile, 
                `thumbnail_${newProductId}_${selectedThumbnailFile.name}`, 
                'product_thumbnails',
                (percent) => {
                    const mapped = Math.round(percent * 0.3); // Map thumbnail to 0% - 30%
                    setUploadProgress(mapped);
                }
            );

            setUploadProgress(30);

            const databaseUrl = await uploadToDropbox(
                preloadedResource || selectedResourceFile,
                `resource_${newProductId}_${selectedResourceFile.name}`,
                'product_resources',
                (percent) => {
                    const mapped = 30 + Math.round(percent * 0.6); // Map resource to 30% - 90%
                    setUploadProgress(mapped);
                }
            );

            setUploadProgress(90);

            let finalPriceString = productForm.price ? productForm.price.trim() : 'Free';
            let numericAmount = 0;
            
            if (finalPriceString && !isNaN(parseFloat(finalPriceString)) && parseFloat(finalPriceString) > 0) {
                numericAmount = parseFloat(finalPriceString);
            } else {
                finalPriceString = 'Free';
                numericAmount = 0;
            }
            
            const productCategory = productForm.category || 'Project file';

            // Direct Firestore document insertion
            await setDoc(doc(db, 'products', newProductId), {
                price: finalPriceString,
                category: productCategory,
                thumbnail: finalThumbnail || '',
                images: [finalThumbnail].filter(Boolean),
                amount: numericAmount,
                name: productForm.name || '',
                timesPurchased: 0,
                sellerId: sellerId || '',
                productUrl: databaseUrl || '', // db://${newProductId}
                starRating: '0',
                productDescription: productForm.description || '',
                auditStatus: 'approved', // instantly approved
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            });

            // Optimistically update UI so user sees product instantly
            setSellerProducts(prev => [{
                id: newProductId,
                productName: productForm.name,
                productUrl: databaseUrl,
                thumbnail: finalThumbnail,
                price: finalPriceString,
                amount: numericAmount,
                productDescription: productForm.description,
                sellerId: sellerId,
                category: productCategory,
                timesPurchased: 0,
                starRating: '0',
                productImages: finalThumbnail,
                auditStatus: 'approved'
            }, ...prev]);

            fetchSellerProducts(sellerId);
            setShowAddProduct(false);
            setProductForm({ name: '', url: '', thumbnail: '', price: '', description: '', category: 'Project file' } as any);
            setSelectedThumbnailFile(null);
            setSelectedResourceFile(null);
            alert("Product uploaded and saved successfully!");
        } catch (e: any) {
            console.error("Add product error:", e);
            alert("Error adding product: " + e.message);
        }
        setLoading(false);
        setUploadProgress(null);
        setUploadEta(null);
    };

    const updateProduct = async () => {
        if (loading || !editingProductId) return;
        setLoading(true);
        setUploadProgress(1);
        try {
            if (!productForm.name.trim()) {
                alert("Please enter a product name.");
                setLoading(false);
                setUploadProgress(null);
                return;
            }

            let finalThumbnail = productForm.thumbnail.trim();

            if (selectedThumbnailFile) {
                setUploadProgress(0);
                finalThumbnail = await uploadToDropbox(
                    preloadedThumbnail || selectedThumbnailFile, 
                    `thumbnail_${editingProductId}_${selectedThumbnailFile.name}`, 
                    'product_thumbnails',
                    (percent) => {
                        const maxPct = selectedResourceFile ? 30 : 90;
                        setUploadProgress(Math.round(percent * (maxPct / 100)));
                    }
                );
            }

            if (!finalThumbnail) {
                alert("Please select a thumbnail image to upload.");
                setLoading(false);
                setUploadProgress(null);
                return;
            }

            let databaseUrl = productForm.url;
            if (selectedResourceFile) {
                setUploadProgress(selectedThumbnailFile ? 30 : 0);
                setUploadEta(null);
                databaseUrl = await uploadToDropbox(
                    preloadedResource || selectedResourceFile,
                    `resource_${editingProductId}_${selectedResourceFile.name}`,
                    'product_resources',
                    (percent) => {
                        const startPct = selectedThumbnailFile ? 30 : 0;
                        const scaleFactor = selectedThumbnailFile ? 0.6 : 0.9;
                        setUploadProgress(startPct + Math.round(percent * scaleFactor));
                    }
                );
            }

            setUploadProgress(90);

            let finalPriceString = productForm.price ? productForm.price.trim() : 'Free';
            let numericAmount = 0;
            
            if (finalPriceString && !isNaN(parseFloat(finalPriceString)) && parseFloat(finalPriceString) > 0) {
                numericAmount = parseFloat(finalPriceString);
            } else {
                finalPriceString = 'Free';
                numericAmount = 0;
            }
            
            const productCategory = productForm.category || 'Project file';

            const ref = doc(db, 'products', editingProductId);
            await updateDoc(ref, {
                price: finalPriceString,
                category: productCategory,
                thumbnail: finalThumbnail || '',
                images: [finalThumbnail].filter(Boolean),
                amount: numericAmount,
                name: productForm.name || '',
                productUrl: databaseUrl || '',
                productDescription: productForm.description || '',
                updatedAt: serverTimestamp()
            });

            setSellerProducts(prev => prev.map(p => {
                if (p.id === editingProductId) {
                    return {
                        ...p,
                        productName: productForm.name,
                        productUrl: databaseUrl,
                        thumbnail: finalThumbnail,
                        price: finalPriceString,
                        amount: numericAmount,
                        productDescription: productForm.description,
                        category: productCategory,
                        productImages: finalThumbnail
                    };
                }
                return p;
            }));

            fetchSellerProducts(sellerId);
            setShowAddProduct(false);
            setEditingProductId(null);
            setProductForm({ name: '', url: '', thumbnail: '', price: '', description: '', category: 'Project file' } as any);
            setSelectedThumbnailFile(null);
            setSelectedResourceFile(null);
            alert("Product updated successfully!");
        } catch (e: any) {
            console.error("Update product error:", e);
            alert("Error updating product: " + e.message);
        }
        setLoading(false);
        setUploadProgress(null);
        setUploadEta(null);
    };

    const [productToDelete, setProductToDelete] = useState<any | null>(null);
    const [deletingProductId, setDeletingProductId] = useState<string | null>(null);

    const handleDeleteProduct = async (prod: any) => {
        if (!prod || !prod.id) return;
        setDeletingProductId(prod.id);
        try {
            let deleteSuccess = false;
            try {
                const response = await fetch(getApiUrl('/api/creator/seller/delete-product'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        productId: prod.id, 
                        sellerId: sellerId 
                    })
                });
                if (response.ok) {
                    const data = await response.json();
                    if (data && data.status) {
                        deleteSuccess = true;
                    }
                }
            } catch (err) {
                console.warn("Backend delete product failed, falling back to direct Firestore", err);
            }

            if (!deleteSuccess) {
                console.log("Using direct client Firestore fallback to delete product");
                await deleteDoc(doc(db, 'products', prod.id));
                deleteSuccess = true;
            }

            if (deleteSuccess) {
                // Remove from local state optimistically
                setSellerProducts(prev => prev.filter(p => p.id !== prod.id));
                alert("Product deleted successfully!");
                setProductToDelete(null);
            } else {
                alert("Failed to delete product.");
            }
        } catch (e: any) {
            console.error("Error deleting product:", e);
            alert("Error deleting product: " + (e.message || "Unknown error"));
        } finally {
            setDeletingProductId(null);
        }
    };

    const handleCreateRenewalPay = async (planType: 'monthly' | 'yearly') => {
        setPaystackLoading(true);
        setPaystackError(null);
        try {
            const baseNgn = planType === 'monthly' ? 1500 : 10500;
            const finalAmount = getScaledPrice(baseNgn, countryCode);
            const userEmail = user?.email?.toLowerCase()?.trim() || localStorage.getItem('pending_app_payment') || '';

            if (!userEmail) {
                throw new Error(t("Email is missing. Please sign back in first."));
            }

            // Standard storage tags for checkout
            localStorage.setItem('pending_app_payment', userEmail);
            localStorage.setItem('pending_app_plan', planType);
            localStorage.setItem('app_currency', 'NGN');

            if (!(window as any).PaystackPop) {
                throw new Error(t("Payment gateway pop is loading. Please retry."));
            }

            const handler = (window as any).PaystackPop.setup({
                key: import.meta.env.VITE_PAYSTACK_PUBLIC_KEY || 'pk_live_d616663688ee4eecd3d5265784e941b3f7736a6a',
                email: userEmail,
                amount: finalAmount * 100, // Paystack requires kobo/cents
                currency: 'NGN',
                metadata: {
                    email: userEmail,
                    plan_type: planType,
                    country: countryCode,
                    language: user?.language || 'English',
                },
                callback: (response: any) => {
                    console.log("Paystack Renewal success callback from Creator Program:", response);
                    // Redirect to standard verify callback route, which automatically does everything!
                    window.location.href = `${window.location.origin}/payment/${encodeURIComponent(userEmail)}/${finalAmount}/${planType}/?reference=${response.reference}`;
                },
                onClose: () => {
                    setPaystackLoading(false);
                }
            });

            handler.openIframe();
            setPaystackLoading(false); // Gateway iframe is now open and rendering
            
        } catch (err: any) {
            console.error("Paystack Renewal error in CreatorProgramModal:", err);
            setPaystackError(err.message || t("Payment initialization aborted"));
            setPaystackLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[200] bg-black/80 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="bg-[#0c0c0e] max-w-2xl w-full rounded-2xl border border-white/10 overflow-hidden flex flex-col max-h-[90vh] relative">
                {uploadProgress !== null && (
                    <div className="absolute inset-0 bg-[#0c0c0e]/95 backdrop-blur-md z-[250] flex flex-col items-center justify-center p-6 text-center">
                        <motion.div
                            animate={{ rotate: 360 }}
                            transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
                            className="w-12 h-12 text-cyan-400 mb-4"
                        >
                            <Hourglass className="w-12 h-12 text-cyan-400" />
                        </motion.div>
                        <p className="text-sm font-black text-white tracking-widest uppercase mb-1">UPLOAD IN PROGRESS</p>
                        <p className="text-[11px] text-gray-400 max-w-sm leading-relaxed">
                            Lossless zip chunk stream is active. File is sliced, compressed at ultra-speed and stored securely.
                        </p>
                        <div className="w-full max-w-xs bg-white/10 rounded-full h-2 mt-5 overflow-hidden border border-white/5 relative">
                            <div 
                                className="bg-cyan-400 h-2 rounded-full transition-all duration-300 shadow-[0_0_12px_rgba(0,229,255,0.8)]" 
                                style={{ width: `${uploadProgress}%` }}
                            ></div>
                        </div>
                        <div className="flex items-center justify-between w-full max-w-xs mt-2.5">
                            <span className="text-cyan-400 text-xs font-mono font-black">{uploadProgress}% Complete</span>
                            <span className="text-gray-400 text-[10px] font-medium font-mono">
                                {uploadEta !== null && uploadEta > 0 ? (
                                    uploadEta >= 60 
                                        ? `~${Math.floor(uploadEta / 60)}m ${uploadEta % 60}s left`
                                        : `~${uploadEta}s left`
                                ) : (
                                    uploadProgress < 35 ? "Compressing file..." : "Calculating ETA..."
                                )}
                            </span>
                        </div>
                    </div>
                )}
                <div className="flex items-center justify-between p-4 border-b border-white/10">
                    <h2 className="text-white font-bold text-lg flex items-center gap-2"><Star size={20} className="text-yellow-500" /> Creator Program</h2>
                    <button onClick={onClose} className="p-2 text-gray-400 hover:text-white rounded-full hover:bg-white/5"><X size={20} /></button>
                </div>

                <div className="p-4 overflow-y-auto flex-1 custom-scrollbar">
                    {loading && <div className="text-center text-gray-400 py-8">Loading...</div>}
                    
                    {!loading && step === 'restricted' && (
                        <div className="flex flex-col items-center text-center py-6 px-4 max-w-md mx-auto">
                            <div className="w-16 h-16 rounded-2xl bg-yellow-500/10 border border-yellow-500/20 flex items-center justify-center text-yellow-505 mb-5 animate-pulse shadow-[0_0_15px_rgba(234,179,8,0.15)]">
                                <Lock size={32} className="text-yellow-500" />
                            </div>
                            <h3 className="text-xl sm:text-2xl font-black text-white tracking-tight uppercase mb-3 text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 via-amber-300 to-yellow-500">
                                {t('Creator Program Locked')}
                            </h3>
                            <p className="text-xs sm:text-sm text-gray-400 mb-6 leading-relaxed font-semibold">
                                {t('Only owners of an active Monthly or Yearly subscription plan can join the Animato Creator Program. Unlock higher commissions, unlimited listings, custom referral codes, and earn with your animations!')}
                            </p>
                            
                            <div className="bg-white/[0.02] border border-white/5 rounded-xl p-4 w-full mb-6 space-y-3.5 text-left">
                                <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold border-b border-white/5 pb-1.5">{t('Premium Creator Privileges')}</p>
                                <div className="flex items-start gap-2 text-xs text-gray-300">
                                    <span className="text-yellow-500 mt-0.5">✦</span>
                                    <span>{t('Earn 50%-75% on all Marketer sales in Animato Store')}</span>
                                </div>
                                <div className="flex items-start gap-2 text-xs text-gray-300">
                                    <span className="text-yellow-500 mt-0.5">✦</span>
                                    <span>{t('Generate custom referral codes & invite animation studios')}</span>
                                </div>
                                <div className="flex items-start gap-2 text-xs text-gray-300">
                                    <span className="text-yellow-500 mt-0.5">✦</span>
                                    <span>{t('Payout channels to any bank account with instant approvals')}</span>
                                </div>
                            </div>

                            <button 
                                onClick={() => setStep('upgrade_plans')}
                                className="w-full py-3 bg-gradient-to-r from-yellow-500 to-amber-600 hover:from-yellow-400 hover:to-amber-500 text-black font-black text-xs uppercase tracking-widest rounded-xl transition-all active:scale-[0.98] shadow-lg flex items-center justify-center gap-2 cursor-pointer border-0"
                            >
                                <Star size={14} className="fill-current text-black" />
                                <span>{t('Get a Monthly/Yearly Subscription')}</span>
                                <ArrowRight size={14} />
                            </button>
                        </div>
                    )}

                    {!loading && step === 'upgrade_plans' && (
                        <div className="space-y-6 max-w-xl mx-auto py-2">
                            <div className="text-center">
                                <h3 className="text-lg font-black text-white tracking-widest uppercase mb-1">{t('Select Creator Tier')}</h3>
                            </div>

                            {paystackError && (
                                <div className="p-3 bg-red-500/10 border border-red-500/25 rounded-xl flex items-center gap-2.5 text-xs text-red-500">
                                    <AlertTriangle size={15} className="shrink-0 text-red-500" />
                                    <span>{paystackError}</span>
                                </div>
                            )}

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                {/* Monthly Plan */}
                                <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-5 flex flex-col justify-between hover:border-cyan-500/30 transition-all group relative overflow-hidden">
                                    <div>
                                        <div className="flex items-center justify-between mb-4">
                                            <span className="text-[10px] text-cyan-400 uppercase tracking-widest font-black font-mono">{t('Most Flexible')}</span>
                                            <span className="text-[11px] text-gray-500 font-mono">30 {t('Days')}</span>
                                        </div>
                                        <h4 className="text-lg font-black text-white mb-1">Monthly Plan</h4>
                                        <p className="text-xs text-gray-400 mb-4 font-medium leading-relaxed">
                                            {t("Ideal for content creators starting out on the platform.")}
                                        </p>

                                        <div className="mb-5">
                                            <span className="text-2xl font-black text-white">₦{getScaledPrice(1500, countryCode).toLocaleString()}</span>
                                            <span className="text-xs text-gray-500 ml-1">/ {t('month')}</span>
                                        </div>

                                        <ul className="space-y-2 mb-6">
                                            <li className="flex items-center gap-2 text-[11px] text-gray-300">
                                                <span className="text-cyan-400 font-bold font-mono">✓</span>
                                                <span>{t('Standard Creator Access')}</span>
                                            </li>
                                            <li className="flex items-center gap-2 text-[11px] text-gray-300">
                                                <span className="text-cyan-400 font-bold font-mono">✓</span>
                                                <span>{t('Custom Viseme Mapper')}</span>
                                            </li>
                                            <li className="flex items-center gap-2 text-[11px] text-gray-300">
                                                <span className="text-cyan-400 font-bold font-mono">✓</span>
                                                <span>{t('Priority 24/7 Chat Support')}</span>
                                            </li>
                                        </ul>
                                    </div>

                                    <button 
                                        disabled={paystackLoading}
                                        onClick={() => handleCreateRenewalPay('monthly')}
                                        className="w-full py-2.5 bg-white/5 group-hover:bg-cyan-500 group-hover:text-black border border-white/10 group-hover:border-cyan-400 text-white font-black text-[10px] uppercase tracking-wider rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5"
                                    >
                                        <span>{paystackLoading ? t('Processing...') : t('Unlock Monthly')}</span>
                                    </button>
                                </div>

                                {/* Yearly Plan */}
                                <div className="bg-gradient-to-b from-yellow-500/10 to-transparent border border-yellow-500/30 rounded-2xl p-5 flex flex-col justify-between hover:border-yellow-400/50 transition-all group relative overflow-hidden shadow-[0_0_20px_rgba(234,179,8,0.05)]">
                                    <div className="absolute top-0 right-0 bg-yellow-500 text-black text-[8px] font-black tracking-widest uppercase py-1 px-3.5 rounded-bl-xl">
                                        {t('BEST VALUE')}
                                    </div>
                                    
                                    <div>
                                        <div className="flex items-center justify-between mb-4">
                                            <span className="text-[10px] text-yellow-400 uppercase tracking-widest font-black font-mono">{t('Save Over 40%')}</span>
                                            <span className="text-[11px] text-gray-500 font-mono">365 {t('Days')}</span>
                                        </div>
                                        <h4 className="text-lg font-black text-white mb-1">Yearly Plan</h4>
                                        <p className="text-xs text-gray-400 mb-4 font-medium leading-relaxed">
                                            {t("For dedicated professional animators seeking maximum savings.")}
                                        </p>

                                        <div className="mb-5">
                                            <span className="text-2xl font-black text-white">₦{getScaledPrice(10500, countryCode).toLocaleString()}</span>
                                            <span className="text-xs text-gray-500 ml-1">/ {t('year')}</span>
                                        </div>

                                        <ul className="space-y-2 mb-6">
                                            <li className="flex items-center gap-2 text-[11px] text-gray-300">
                                                <span className="text-yellow-400 font-bold font-mono">✦</span>
                                                <span className="font-bold text-yellow-200">{t('Full Creator Access')}</span>
                                            </li>
                                            <li className="flex items-center gap-2 text-[11px] text-gray-300">
                                                <span className="text-yellow-400 font-bold font-mono">✦</span>
                                                <span>{t('Powerhouse Platform access')}</span>
                                            </li>
                                            <li className="flex items-center gap-2 text-[11px] text-gray-300">
                                                <span className="text-yellow-400 font-bold font-mono">✦</span>
                                                <span>{t('All Future Upgrades Included')}</span>
                                            </li>
                                        </ul>
                                    </div>

                                    <button 
                                        disabled={paystackLoading}
                                        onClick={() => handleCreateRenewalPay('yearly')}
                                        className="w-full py-2.5 bg-yellow-500 hover:bg-yellow-400 border border-yellow-400 text-black font-black text-[10px] uppercase tracking-wider rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 shadow-lg"
                                    >
                                        <span>{paystackLoading ? t('Processing...') : t('Unlock Yearly')}</span>
                                    </button>
                                </div>
                            </div>

                            <div className="flex justify-between items-center pt-2 border-t border-white/5">
                                <button 
                                    onClick={() => setStep('restricted')}
                                    className="px-4 py-2 text-xs text-gray-500 hover:text-white transition-colors border-0 bg-transparent"
                                >
                                    ← {t('Back')}
                                </button>
                                <span className="text-[10px] font-mono text-gray-600">{t('Secure checkout via Paystack')}</span>
                            </div>
                        </div>
                    )}

                    {!loading && step === 'ineligible' && (
                        <div className="text-center py-8">
                            <Star size={48} className="mx-auto text-gray-600 mb-4" />
                            <h3 className="text-xl font-bold text-white mb-2">Not Eligible</h3>
                            <p className="text-sm text-gray-400">You are not eligible to join the program. Make a monthly subscription plan to become eligible.</p>
                        </div>
                    )}

                    {!loading && step === 'select_role' && (
                        <div className="text-center py-8">
                            <h3 className="text-xl font-bold text-white mb-2">You are eligible!</h3>
                            <p className="text-sm text-gray-400 mb-8">Do you want to be a referrer or a marketer, and or both?</p>
                            
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                <button onClick={() => handleJoin('seller')} className="p-4 bg-white/5 rounded-xl border border-white/10 hover:border-cyan-500 hover:bg-cyan-500/10 transition">
                                    <Package size={32} className="mx-auto text-cyan-500 mb-2" />
                                    <h4 className="font-bold text-white text-sm">Marketer</h4>
                                    <p className="text-xs text-gray-500 mt-1">Market your products</p>
                                </button>
                                <button onClick={() => handleJoin('referral')} className="p-4 bg-white/5 rounded-xl border border-white/10 hover:border-purple-500 hover:bg-purple-500/10 transition">
                                    <Users size={32} className="mx-auto text-purple-500 mb-2" />
                                    <h4 className="font-bold text-white text-sm">Referrer</h4>
                                    <p className="text-xs text-gray-500 mt-1">Invite friends</p>
                                </button>
                                <button onClick={() => handleJoin('both')} className="p-4 bg-white/5 rounded-xl border border-white/10 hover:border-yellow-500 hover:bg-yellow-500/10 transition">
                                    <Star size={32} className="mx-auto text-yellow-500 mb-2" />
                                    <h4 className="font-bold text-white text-sm">Both</h4>
                                    <p className="text-xs text-gray-500 mt-1">Both Marketer & Referrer</p>
                                </button>
                            </div>
                        </div>
                    )}

                    {!loading && step === 'dashboard' && (
                        <div className="space-y-6">
                            <div className="bg-white/5 p-4 rounded-xl border border-white/10 relative overflow-hidden space-y-3">
                                <div className="absolute top-2 right-2 flex gap-1">
                                  <div className="w-1.5 h-1.5 rounded-full bg-white/20"></div>
                                  <div className="w-1.5 h-1.5 rounded-full bg-white/20"></div>
                                  <div className="w-1.5 h-1.5 rounded-full bg-white/20"></div>
                                </div>
                                <div className="flex items-center gap-4">
                                    <div className="w-14 h-14 rounded-full bg-cyan-900/40 flex items-center justify-center text-cyan-400 border border-cyan-500/50">
                                        <Star size={28} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-base font-bold text-white truncate">{user.email}</p>
                                        <div className="flex flex-wrap gap-2 mt-1">
                                            {sellerData && (
                                                <div className="flex items-center gap-1 px-2 py-0.5 bg-blue-500/20 text-blue-400 rounded text-[10px] font-bold border border-blue-500/30 group">
                                                    <span>MARKETER: {sellerId}</span>
                                                    <button 
                                                        onClick={() => {
                                                            if (sellerId) {
                                                                navigator.clipboard.writeText(sellerId);
                                                                alert("Marketer ID copied!");
                                                            }
                                                        }}
                                                        className="opacity-50 hover:opacity-100 transition-opacity p-0.5 cursor-pointer"
                                                        title="Copy Marketer ID"
                                                    >
                                                        <Copy size={10} />
                                                    </button>
                                                </div>
                                            )}
                                            {refData && (
                                                <div className="flex items-center gap-1 px-2 py-0.5 bg-purple-500/20 text-purple-400 rounded text-[10px] font-bold border border-purple-500/30 group">
                                                    <span>REF: {refId}</span>
                                                    <button 
                                                        onClick={() => {
                                                            if (refId) {
                                                                navigator.clipboard.writeText(refId);
                                                                alert("Referral ID copied!");
                                                            }
                                                        }}
                                                        className="opacity-50 hover:opacity-100 transition-opacity p-0.5 cursor-pointer"
                                                        title="Copy Referral ID"
                                                    >
                                                        <Copy size={10} />
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* Upgrading Roles Option - Positioned nicely with no chance of overlap */}
                                {sellerData && !refData && (
                                    <div className="pt-2 border-t border-white/5 flex justify-end">
                                        <button 
                                            onClick={() => {
                                                if(confirm("Do you want to join the Referral program too? This will generate a unique Referrer ID for you and add you to referrals.")) {
                                                    handleJoin('referral');
                                                }
                                            }}
                                            className="w-full sm:w-auto px-4 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold text-xs rounded-lg border border-purple-500/35 transition-all active:scale-95 flex items-center justify-center gap-1.5 shadow-lg shadow-purple-500/15 cursor-pointer"
                                        >
                                            <Plus size={14} />
                                            <span>Become a Referral ID</span>
                                        </button>
                                    </div>
                                )}
                                {refData && !sellerData && (
                                    <div className="pt-2 border-t border-white/5 flex justify-end">
                                        <button 
                                            onClick={() => {
                                                if(confirm("Do you want to become a Marketer (Seller) too? This will generate a Marketer ID for you, allowing you to list products on the marketplace.")) {
                                                    handleJoin('seller');
                                                }
                                            }}
                                            className="w-full sm:w-auto px-4 py-2 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-bold text-xs rounded-lg border border-cyan-500/35 transition-all active:scale-95 flex items-center justify-center gap-1.5 shadow-lg shadow-cyan-500/15 cursor-pointer"
                                        >
                                            <Plus size={14} />
                                            <span>Become a Seller</span>
                                        </button>
                                    </div>
                                )}
                            </div>

                            <div className="flex gap-2 overflow-x-auto pb-2 border-b border-white/10 custom-scrollbar">
                                {sellerData && (
                                    <>
                                        <button onClick={() => setActiveTab('payout')} className={`px-4 py-2 text-sm font-bold rounded-lg ${activeTab === 'payout' ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white'}`}>Payout</button>
                                        <button 
                                            onClick={() => {
                                                setActiveTab('products');
                                                if (sellerId) fetchSellerProducts(sellerId);
                                            }} 
                                            className={`px-4 py-2 text-sm font-bold rounded-lg ${activeTab === 'products' ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white'}`}
                                        >
                                            Products
                                        </button>
                                        <button 
                                            onClick={() => {
                                                setActiveTab('sales');
                                                if (sellerId) fetchSellerProducts(sellerId);
                                            }} 
                                            className={`px-4 py-2 text-sm font-bold rounded-lg ${activeTab === 'sales' ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white'}`}
                                        >
                                            Sales
                                        </button>
                                    </>
                                )}
                                {refData && (
                                    <>
                                       {!sellerData && <button onClick={() => setActiveTab('payout')} className={`px-4 py-2 text-sm font-bold rounded-lg ${activeTab === 'payout' ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white'}`}>Payout</button>}
                                       <button onClick={() => setActiveTab('referrals')} className={`px-4 py-2 text-sm font-bold rounded-lg ${activeTab === 'referrals' ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white'}`}>Referrals</button>
                                    </>
                                )}
                            </div>

                            {activeTab === 'payout' && (
                                <div className="space-y-4">
                                    <div className="bg-white/5 p-6 rounded-xl border border-white/10 text-center">
                                        <div className="flex justify-center mb-2">
                                            <button onClick={() => setCurrency('NGN')} className={`px-3 py-1 text-xs rounded-l border border-white/20 ${currency === 'NGN' ? 'bg-white/20 text-white' : 'text-gray-400'}`}>NGN</button>
                                            <button onClick={() => setCurrency('USD')} className={`px-3 py-1 text-xs rounded-r border border-white/20 ${currency === 'USD' ? 'bg-white/20 text-white' : 'text-gray-400'}`}>USD</button>
                                        </div>
                                        
                                        {sellerData && refData && (
                                            <div className="flex justify-center mb-4 gap-2">
                                                <button onClick={() => setViewingPayout('seller')} className={`px-3 py-1 text-xs rounded border border-white/20 ${viewingPayout === 'seller' ? 'bg-cyan-500/20 text-cyan-400 font-bold border-cyan-500/30' : 'text-gray-400'}`}>Marketer Payout</button>
                                                <button onClick={() => setViewingPayout('referral')} className={`px-3 py-1 text-xs rounded border border-white/20 ${viewingPayout === 'referral' ? 'bg-cyan-500/20 text-cyan-400 font-bold border-cyan-500/30' : 'text-gray-400'}`}>Referral Payout</button>
                                            </div>
                                        )}

                                        <p className="text-3xl font-black text-white">
                                            {currency === 'NGN' ? '₦ ' : '$ '}
                                            {currency === 'NGN' ? 
                                                (sellerData && refData ? 
                                                    (viewingPayout === 'seller' ? parseFloat(sellerData?.payout || "0") : parseFloat(refData?.payout || "0")) :
                                                 sellerData ? parseFloat(sellerData?.payout || "0") : parseFloat(refData?.payout || "0")
                                                ).toFixed(2) : 
                                                (sellerData && refData ? 
                                                    (viewingPayout === 'seller' ? (parseFloat(sellerData?.payout || "0") / 1500) : (parseFloat(refData?.payout || "0") / 1500)) :
                                                 sellerData ? (parseFloat(sellerData?.payout || "0") / 1500) : (parseFloat(refData?.payout || "0") / 1500)
                                                ).toFixed(2)}
                                        </p>
                                        <p className="text-xs text-gray-500 mt-2 max-w-sm mx-auto">Disclaimer: If you don't have a Nigeria account, make use of a Grey US account for direct transfer to avoid issues.</p>
                                    </div>
                                    
                                    {(sellerData || refData) && (
                                        <div className="space-y-3 bg-black/40 p-4 rounded border border-white/5">
                                            <h4 className="text-sm font-bold text-white mb-2">Payout Account</h4>
                                            <input value={bankName} onChange={e => setBankName(e.target.value)} placeholder={sellerData?.bankName || refData?.bankName || "Bank Name"} className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-white" />
                                            <input value={bankOwnerName} onChange={e => setBankOwnerName(e.target.value)} placeholder={sellerData?.bankOwner || refData?.bankOwner || "Account Owner Name"} className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-white" />
                                            <input value={accountNumber} onChange={e => setAccountNumber(e.target.value)} placeholder={sellerData?.accountNum || refData?.accountNum || "Account Number"} className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-white" />
                                            <button onClick={saveBankDetails} className="w-full py-2 bg-white/10 hover:bg-white/20 rounded text-sm font-bold text-white transition">Save Details</button>
                                        </div>
                                    )}
                                </div>
                            )}

                             {activeTab === 'products' && (
                                <div className="space-y-4">
                                    {!showAddProduct ? (
                                        <div>
                                            <button onClick={() => setShowAddProduct(true)} className="mb-6 flex items-center justify-center gap-2 w-full py-3 border border-dashed border-white/30 rounded-lg text-gray-300 hover:text-white hover:bg-white/5 transition font-medium text-sm">
                                                <Plus size={16} /> Add New Product
                                            </button>
                                            
                                            {loadingProducts ? (
                                                <div className="text-center text-gray-400 py-8 text-sm">Loading your store products...</div>
                                            ) : sellerProducts.length === 0 ? (
                                                <div className="text-center py-8 bg-white/5 rounded-xl border border-white/5">
                                                    <Package size={36} className="mx-auto text-gray-600 mb-2 animate-pulse" />
                                                    <p className="text-sm text-gray-400 font-medium">No live products found</p>
                                                    <p className="text-xs text-gray-500 mt-1">Add your first product to see it listed here and live in the marketplace!</p>
                                                </div>
                                            ) : (
                                                <div className="space-y-3">
                                                    <h3 className="text-xs text-gray-400 font-bold uppercase tracking-wider mb-2">My Products in Store ({sellerProducts.length})</h3>
                                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-h-[480px] overflow-y-auto pr-1.5 custom-scrollbar pb-2">
                                                        {sellerProducts.map((prod, idx) => {
                                                            const urlToStart = prod.productUrl || prod.thumbnail || '';
                                                            return (
                                                                <div 
                                                                    key={idx} 
                                                                    onClick={() => {
                                                                        if (urlToStart) {
                                                                            window.open(urlToStart, '_blank', 'noreferrer,noopener');
                                                                        }
                                                                    }}
                                                                    title="Click to launch / start product link"
                                                                    className="bg-white/5 rounded-xl border border-white/10 overflow-hidden flex flex-col hover:border-[#00e5ff] hover:bg-white/[0.08] transition duration-200 cursor-pointer group"
                                                                >
                                                                    <div className="relative aspect-video w-full bg-black/40 flex items-center justify-center overflow-hidden border-b border-white/5">
                                                                        {prod.thumbnail ? (
                                                                            <img src={prod.thumbnail} alt={prod.productName} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" referrerPolicy="no-referrer" />
                                                                        ) : (
                                                                            <div className="flex flex-col items-center justify-center text-gray-500 p-4">
                                                                                <Package size={28} />
                                                                                <span className="text-[10px] mt-1">No Image</span>
                                                                            </div>
                                                                        )}
                                                                        <div className="absolute top-2 right-2 bg-black/70 px-2 py-0.5 rounded text-[10px] font-bold text-cyan-400 border border-cyan-500/20">
                                                                            {prod.price && String(prod.price).toLowerCase() !== 'free' ? `₦ ${prod.price}` : 'Free'}
                                                                        </div>
                                                                        
                                                                        <div className="absolute inset-0 bg-black/45 opacity-0 group-hover:opacity-100 flex flex-col items-center justify-center transition-all duration-300">
                                                                            <span className="bg-[#00e5ff] text-black font-black text-[9px] tracking-widest px-2.5 py-1 rounded shadow-lg uppercase scale-90 group-hover:scale-100 transition-transform flex items-center gap-1">
                                                                                START LINK <ExternalLink size={9} />
                                                                            </span>
                                                                        </div>
                                                                    </div>
                                                                    <div className="p-3 flex-1 flex flex-col justify-between">
                                                                        <div>
                                                                            <h4 className="font-bold text-white text-sm line-clamp-1 group-hover:text-[#00e5ff] transition-colors">{prod.productName || "Untitled Product"}</h4>
                                                                            <p className="text-xs text-gray-400 mt-1 line-clamp-2 min-h-[2.5rem]">
                                                                                {prod.productDescription || "No product description provided."}
                                                                            </p>
                                                                        </div>
                                                                        
                                                                        <div className="flex items-center gap-1.5 mt-2 mb-1 z-10 w-full" onClick={(e) => e.stopPropagation()}>
                                                                            {prod.thumbnail && (
                                                                                <button 
                                                                                    onClick={() => {
                                                                                        navigator.clipboard.writeText(prod.thumbnail);
                                                                                        alert("Thumbnail link copied to clipboard!");
                                                                                    }}
                                                                                    className="px-2 py-1 bg-white/5 border border-white/5 hover:bg-[#00e5ff]/10 hover:text-[#00e5ff] transition rounded text-[9px] font-bold uppercase tracking-wider flex items-center gap-1 text-gray-300"
                                                                                >
                                                                                    <Copy size={8} /> Copy Thumb
                                                                                </button>
                                                                            )}
                                                                            {prod.productUrl && (
                                                                                <button 
                                                                                    onClick={() => {
                                                                                        navigator.clipboard.writeText(prod.productUrl);
                                                                                        alert("Product link copied to clipboard!");
                                                                                    }}
                                                                                    className="px-2 py-1 bg-white/5 border border-white/5 hover:bg-[#00e5ff]/10 hover:text-[#00e5ff] transition rounded text-[9px] font-bold uppercase tracking-wider flex items-center gap-1 text-gray-300"
                                                                                >
                                                                                    <Copy size={8} /> Copy Url
                                                                                </button>
                                                                            )}
                                                                            <button 
                                                                                onClick={() => {
                                                                                    setEditingProductId(prod.id);
                                                                                    setProductForm({
                                                                                        name: prod.productName || '',
                                                                                        url: prod.productUrl || '',
                                                                                        thumbnail: prod.thumbnail || '',
                                                                                        price: prod.price && String(prod.price).toLowerCase() !== 'free' ? String(prod.price) : '',
                                                                                        description: prod.productDescription || '',
                                                                                        category: prod.category || 'Project file'
                                                                                    });
                                                                                    setShowAddProduct(true);
                                                                                }}
                                                                                className="px-2 py-1 bg-[#00e5ff]/10 border border-[#00e5ff]/20 hover:bg-[#00e5ff]/25 hover:text-cyan-400 hover:border-[#00e5ff]/30 text-[#00e5ff] transition rounded text-[9px] font-bold uppercase tracking-wider flex items-center gap-1"
                                                                            >
                                                                                <Edit size={8} /> Edit
                                                                            </button>
                                                                            <button 
                                                                                onClick={() => setProductToDelete(prod)}
                                                                                className="ml-auto px-2 py-1 bg-red-500/10 border border-red-500/20 hover:bg-red-500/25 hover:text-red-400 hover:border-red-500/30 text-red-500 transition rounded text-[9px] font-bold uppercase tracking-wider flex items-center gap-1"
                                                                            >
                                                                                <Trash2 size={8} /> Delete
                                                                            </button>
                                                                        </div>

                                                                        <div className="flex items-center justify-between mt-2 pt-2 border-t border-white/5">
                                                                            <span className="text-[10px] font-mono text-gray-400 flex items-center gap-1.5">
                                                                                Audit: 
                                                                                <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase ${
                                                                                    prod.auditStatus === 'approved' ? 'bg-green-500/10 text-green-400 border border-green-500/25' :
                                                                                    prod.auditStatus === 'pending' || !prod.auditStatus ? 'bg-amber-500/10 text-amber-400 border border-amber-500/25' :
                                                                                    'bg-red-500/10 text-red-400 border border-red-500/25'
                                                                                }`}>
                                                                                    {prod.auditStatus || 'pending'}
                                                                                </span>
                                                                            </span>
                                                                            <div className="flex items-center gap-1.5">
                                                                                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
                                                                                <span className="text-[10px] font-bold text-green-400 uppercase tracking-widest">{prod.timesPurchased || 0} Users</span>
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    ) : (
                                        <div className="space-y-4 p-4 bg-black/40 border border-white/10 rounded-xl relative overflow-hidden">
                                            <h3 className="text-sm font-black text-white uppercase tracking-wider mb-1 flex items-center gap-1.5 font-sans">
                                                <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse"></span>
                                                {editingProductId ? "Modify Product Listing" : "Create Product Listing"}
                                            </h3>

                                            <div>
                                                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1">Product Title</label>
                                                <input disabled={loading} value={productForm.name} onChange={e => setProductForm({...productForm, name: e.target.value})} placeholder="e.g. Neon Cyberpunk Avatar" className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:border-cyan-500 outline-none disabled:opacity-50 transition" />
                                            </div>

                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                                <div>
                                                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1">Category Type</label>
                                                    <select disabled={loading} value={productForm.category || 'Project file'} onChange={e => setProductForm({...productForm, category: e.target.value})} className="w-full bg-black border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:border-cyan-500 outline-none disabled:opacity-50 transition" >
                                                        <option value="Project file">Project file</option>
                                                        <option value="Character file">Character file</option>
                                                        <option value="Zip file">Zip file</option>
                                                    </select>
                                                </div>
                                                <div>
                                                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1">Price (NGN) <span className="text-[9px] text-gray-500 lowercase">(Free if empty)</span></label>
                                                    <input disabled={loading} value={productForm.price} onChange={e => setProductForm({...productForm, price: e.target.value})} placeholder="e.g. 5000" className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:border-cyan-500 outline-none disabled:opacity-50 transition" />
                                                </div>
                                            </div>

                                            {/* Thumbnail Selection */}
                                            <div>
                                                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1.5 flex items-center gap-1.5">
                                                    <span>Product Thumbnail Image</span>
                                                    <span className="text-[9px] text-[#00e5ff] lowercase font-normal bg-cyan-500/10 px-1.5 py-0.5 rounded font-bold">Upload</span>
                                                </label>
                                                <div className="space-y-3">
                                                    <div className="flex items-center justify-center w-full">
                                                        <label className="flex flex-col items-center justify-center w-full h-16 border-2 border-white/10 border-dashed rounded-lg cursor-pointer bg-white/5 hover:bg-white/10 transition-all group overflow-hidden">
                                                            <div className="flex flex-col items-center justify-center py-2 px-4 shadow text-center w-full h-full">
                                                                <div className="flex gap-2 items-center">
                                                                    <UploadCloud size={16} className="text-cyan-400 group-hover:scale-110 transition-transform" />
                                                                    <p className="text-xs text-gray-400 group-hover:text-white transition-colors font-bold whitespace-nowrap">
                                                                        {selectedThumbnailFile ? selectedThumbnailFile.name : `Select Thumbnail Image`}
                                                                    </p>
                                                                </div>
                                                                <p className="text-[9px] text-gray-500 mt-1">JPEG, PNG, WEBP max 2MB</p>
                                                            </div>
                                                            <input 
                                                                type="file" 
                                                                className="hidden" 
                                                                accept="image/*"
                                                                onChange={(e) => {
                                                                    const file = e.target.files?.[0];
                                                                    if (file) {
                                                                        setSelectedThumbnailFile(file);
                                                                        const reader = new FileReader();
                                                                        reader.onload = () => {
                                                                            if (typeof reader.result === 'string') {
                                                                                const base64 = reader.result.includes(",") ? reader.result.substring(reader.result.indexOf(",") + 1) : reader.result;
                                                                                setPreloadedThumbnail({ base64, name: file.name });
                                                                            }
                                                                        };
                                                                        reader.readAsDataURL(file);
                                                                    }
                                                                }}
                                                            />
                                                        </label>
                                                    </div>

                                                    {(selectedThumbnailFile || (editingProductId && productForm.thumbnail)) ? (
                                                        <div className="flex items-center gap-3 p-3 bg-white/5 border border-white/10 rounded-lg">
                                                            <div className="w-12 h-12 rounded bg-black/40 overflow-hidden flex-shrink-0 border border-white/10 flex items-center justify-center">
                                                                <img 
                                                                    src={thumbnailPreviewUrl || productForm.thumbnail || null} 
                                                                    alt="Thumbnail preview"
                                                                    className="w-full h-full object-cover"
                                                                    referrerPolicy="no-referrer"
                                                                />
                                                            </div>
                                                            <div className="min-w-0 flex-1">
                                                                <p className="text-xs font-bold text-white truncate break-all">
                                                                    {selectedThumbnailFile ? selectedThumbnailFile.name : "Existing Thumbnail"}
                                                                </p>
                                                                <p className="text-[10px] flex items-center gap-1 font-mono text-cyan-400">
                                                                    ✓ {selectedThumbnailFile ? `${(selectedThumbnailFile.size / 1024).toFixed(1)} KB` : "Stored Link"}
                                                                </p>
                                                            </div>
                                                            <button 
                                                                type="button" 
                                                                onClick={() => {
                                                                    setSelectedThumbnailFile(null);
                                                                    if (editingProductId) {
                                                                        setProductForm({ ...productForm, thumbnail: '' });
                                                                    }
                                                                }}
                                                                className="p-1.5 bg-red-500/10 hover:bg-red-500/25 text-red-400 rounded transition"
                                                            >
                                                                <X size={12} />
                                                            </button>
                                                        </div>
                                                    ) : null}
                                                </div>
                                            </div>

                                            {/* Product Source File Upload */}
                                            <div>
                                                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1.5">
                                                    Upload actual {productForm.category === "Character file" ? "PSD file" : productForm.category === "Zip file" ? "Zip file" : "Project File"}
                                                </label>
                                                <input 
                                                    id="resourceInput"
                                                    type="file"
                                                    accept="*/*"
                                                    className="hidden"
                                                    disabled={loading}
                                                    onChange={(e) => {
                                                        const file = e.target.files?.[0];
                                                        if (file) {
                                                            setSelectedResourceFile(file);
                                                            const reader = new FileReader();
                                                            reader.onload = () => {
                                                                if (typeof reader.result === 'string') {
                                                                    const base64 = reader.result.includes(",") ? reader.result.substring(reader.result.indexOf(",") + 1) : reader.result;
                                                                    setPreloadedResource({ base64, name: file.name });
                                                                }
                                                            };
                                                            reader.readAsDataURL(file);
                                                        }
                                                    }}
                                                />
                                                {(selectedResourceFile || (editingProductId && productForm.url)) ? (
                                                    <div className="flex items-center gap-3 p-3 bg-white/5 border border-white/10 rounded-lg relative group">
                                                        <div className="p-2 bg-cyan-500/10 rounded text-cyan-400 flex-shrink-0">
                                                            <FileText size={18} />
                                                        </div>
                                                        <div className="min-w-0 flex-1">
                                                            <p className="text-xs font-bold text-white truncate">
                                                                {selectedResourceFile ? selectedResourceFile.name : `Original ${productForm.category}`}
                                                            </p>
                                                            <p className="text-[10px] text-green-400 flex items-center gap-1 font-mono">
                                                                <CheckCircle2 size={10} /> 
                                                                {selectedResourceFile ? `${(selectedResourceFile.size / (1024 * 1024)).toFixed(2)} MB (ready to pack)` : "Original asset stored in database"}
                                                            </p>
                                                        </div>
                                                        <button 
                                                            type="button" 
                                                            onClick={() => {
                                                                setSelectedResourceFile(null);
                                                                if (!editingProductId) setProductForm({ ...productForm, url: '' });
                                                            }}
                                                            className="p-1.5 bg-red-500/10 hover:bg-red-500/25 text-red-400 rounded transition"
                                                        >
                                                            <X size={12} />
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <button 
                                                        type="button"
                                                        onClick={() => document.getElementById('resourceInput')?.click()}
                                                        className="w-full py-4 bg-white/5 hover:bg-[#00e5ff]/5 border border-dashed border-white/15 hover:border-cyan-500/50 rounded-lg flex flex-col items-center justify-center gap-1.5 transition group"
                                                    >
                                                        <div className="p-2 bg-white/5 rounded-full text-gray-400 group-hover:text-cyan-400 group-hover:bg-cyan-500/10 transition">
                                                            <Plus size={16} />
                                                        </div>
                                                        <span className="text-xs font-bold text-gray-300">
                                                            {productForm.category === "Character file" ? "Import actual PSD file" : productForm.category === "Zip file" ? "Import actual zip file" : "Import actual project file"}
                                                        </span>
                                                        <span className="text-[9px] text-gray-500">
                                                            {productForm.category === "Character file" ? "Upload .psd only" : productForm.category === "Zip file" ? "Upload .zip only" : "Upload .json or .animato_project only"}
                                                        </span>
                                                    </button>
                                                )}
                                            </div>

                                            <div>
                                                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1">Product Description</label>
                                                <textarea disabled={loading} value={productForm.description} onChange={e => setProductForm({...productForm, description: e.target.value})} placeholder="Describe your resource file features..." className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white h-20 focus:border-cyan-500 outline-none resize-none disabled:opacity-50 transition" />
                                            </div>

                                            <div className="flex gap-2 mt-2">
                                                <button disabled={loading} type="button" onClick={() => { setShowAddProduct(false); setEditingProductId(null); setProductForm({ name: '', url: '', thumbnail: '', price: '', description: '', category: 'Project file' } as any); setSelectedThumbnailFile(null); setSelectedResourceFile(null); }} className="flex-1 py-2 bg-white/5 hover:bg-white/10 disabled:opacity-50 rounded-lg text-xs font-bold text-white transition">Cancel</button>
                                                <button 
                                                    disabled={loading || !productForm.name.trim() || (!selectedThumbnailFile && !editingProductId) || (!selectedResourceFile && !editingProductId)} 
                                                    onClick={editingProductId ? updateProduct : addProduct} 
                                                    className="flex-1 py-2 bg-cyan-500 hover:bg-cyan-600 disabled:bg-cyan-950 disabled:text-gray-500 disabled:opacity-60 rounded-lg text-xs font-bold text-white transition flex items-center justify-center gap-1.5"
                                                >
                                                    <UploadCloud size={14} />
                                                    {loading ? (uploadProgress !== null ? `Uploading (${uploadProgress}%)` : "Saving Product...") : (editingProductId ? "Update Product" : "Save Product")}
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {activeTab === 'sales' && (
                                <div className="space-y-6">
                                    {(() => {
                                        const totalSales = sellerProducts.reduce((sum, p) => {
                                            const amount = parseFloat(p.amount || '0');
                                            const isFree = String(p.price || '').toLowerCase() === 'free' || amount <= 0;
                                            return isFree ? sum : sum + (p.timesPurchased || 0);
                                        }, 0);

                                        const totalDownloads = sellerProducts.reduce((sum, p) => {
                                            const amount = parseFloat(p.amount || '0');
                                            const isFree = String(p.price || '').toLowerCase() === 'free' || amount <= 0;
                                            return isFree ? sum + (p.timesPurchased || 0) : sum;
                                        }, 0);

                                        const totalEstEarningsNgn = sellerProducts.reduce((sum, p) => {
                                            const amount = parseFloat(p.amount || '0');
                                            const isFree = String(p.price || '').toLowerCase() === 'free' || amount <= 0;
                                            if (isFree) return sum;
                                            return sum + ((p.timesPurchased || 0) * amount * 0.8);
                                        }, 0);

                                        const NGN_USD_RATE = 1500;
                                        const formatPrice = (ngnVal: number) => {
                                            if (payoutCurrency === 'USD') {
                                                return `$${(ngnVal / NGN_USD_RATE).toFixed(2)}`;
                                            }
                                            return `₦${Math.round(ngnVal).toLocaleString()}`;
                                        };

                                        return (
                                            <>
                                                {/* Currency Toggle Area */}
                                                <div className="flex flex-col sm:flex-row gap-3 justify-between items-start sm:items-center bg-white/5 border border-white/10 rounded-xl p-3 mt-1">
                                                    <div>
                                                        <h4 className="text-xs font-bold text-white mb-0.5">Est. Earnings Currency</h4>
                                                        <p className="text-[10px] text-gray-500">Switch estimated payouts between Naira and Dollars.</p>
                                                    </div>
                                                    <button 
                                                        onClick={() => setPayoutCurrency(prev => prev === 'NGN' ? 'USD' : 'NGN')}
                                                        className="px-3 py-1.5 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/20 text-cyan-400 rounded-lg text-xs font-black transition flex items-center gap-1.5 self-stretch sm:self-auto justify-center"
                                                    >
                                                        <span>Unit:</span>
                                                        <span className="underline">{payoutCurrency === 'NGN' ? "₦ Naira (NGN)" : "$ Dollars (USD)"}</span>
                                                    </button>
                                                </div>

                                                {/* Stats Grid */}
                                                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                                    <div className="bg-white/5 border border-white/10 rounded-xl p-3 text-center">
                                                        <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Products Live</p>
                                                        <p className="text-base font-black text-white mt-1">{sellerProducts.length}</p>
                                                    </div>
                                                    <div className="bg-white/5 border border-white/10 rounded-xl p-3 text-center">
                                                        <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Total Sales</p>
                                                        <p className="text-base font-black text-cyan-400 mt-1">{totalSales}</p>
                                                    </div>
                                                    <div className="bg-white/5 border border-white/10 rounded-xl p-3 text-center">
                                                        <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">No. of Users</p>
                                                        <p className="text-base font-black text-purple-400 mt-1">{totalDownloads}</p>
                                                    </div>
                                                    <div className="bg-white/5 border border-white/10 rounded-xl p-3 text-center">
                                                        <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Est. Earnings</p>
                                                        <p className="text-base font-black text-green-400 mt-1">
                                                            {formatPrice(totalEstEarningsNgn)}
                                                        </p>
                                                    </div>
                                                </div>

                                                {/* Graph Visualizer Section */}
                                                {loadingProducts ? (
                                                    <div className="text-center text-gray-400 py-12 text-sm bg-white/5 rounded-xl border border-white/10">
                                                        Loading sales performance analytics...
                                                    </div>
                                                ) : sellerProducts.length === 0 ? (
                                                    <div className="text-center py-12 text-gray-400 bg-white/5 rounded-xl border border-white/10 relative">
                                                        <div className="absolute bottom-0 w-full h-[100px] flex items-end">
                                                          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full text-cyan-500/10 fill-current opacity-30">
                                                             <polygon points="0,100 0,60 20,40 40,50 60,20 80,30 100,10 100,100" />
                                                          </svg>
                                                        </div>
                                                        <div className="relative z-10 flex flex-col items-center gap-2">
                                                            <Package size={32} className="text-gray-600 animate-pulse" />
                                                            <p className="text-sm font-medium">No sales or user data available.</p>
                                                            <p className="text-xs text-gray-500">Sales and user activity will automatically show up in a graph here.</p>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div className="space-y-5">
                                                        {/* Custom Interactive SVG Graph */}
                                                        <div className="bg-black/40 border border-white/10 rounded-xl p-4">
                                                            <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                                                                <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse"></span>
                                                                Users & Sales by Product
                                                            </h4>
                                                            
                                                            <div className="relative w-full overflow-x-auto">
                                                                <div className="min-w-[460px]">
                                                                    {(() => {
                                                                        const maxPurchased = Math.max(...sellerProducts.map(p => p.timesPurchased || 0), 4);
                                                                        const width = 500;
                                                                        const height = 180;
                                                                        const paddingLeft = 40;
                                                                        const paddingRight = 20;
                                                                        const paddingTop = 20;
                                                                        const paddingBottom = 30;

                                                                        const chartWidth = width - paddingLeft - paddingRight;
                                                                        const chartHeight = height - paddingTop - paddingBottom;

                                                                        return (
                                                                            <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto">
                                                                                {/* Grid lines & Y Axis labels */}
                                                                                {[0, 0.25, 0.5, 0.75, 1].map((ratio, index) => {
                                                                                    const y = paddingTop + chartHeight * (1 - ratio);
                                                                                    const labelValue = Math.round(maxPurchased * ratio);
                                                                                    return (
                                                                                        <g key={index} className="opacity-40">
                                                                                            <line 
                                                                                                x1={paddingLeft} 
                                                                                                y1={y} 
                                                                                                x2={width - paddingRight} 
                                                                                                y2={y} 
                                                                                                stroke="rgba(255, 255, 255, 0.1)" 
                                                                                                strokeWidth="1" 
                                                                                                strokeDasharray="4 4" 
                                                                                            />
                                                                                            <text 
                                                                                                x={paddingLeft - 8} 
                                                                                                y={y + 3} 
                                                                                                textAnchor="end" 
                                                                                                className="fill-gray-500 font-mono text-[9px] font-bold"
                                                                                            >
                                                                                                {labelValue}
                                                                                            </text>
                                                                                        </g>
                                                                                    );
                                                                                })}

                                                                                {/* Bars */}
                                                                                {sellerProducts.map((prod, idx) => {
                                                                                    const count = sellerProducts.length;
                                                                                    const colWidth = chartWidth / count;
                                                                                    const barWidth = Math.min(colWidth * 0.5, 28);
                                                                                    const colCenter = paddingLeft + (idx * colWidth) + (colWidth / 2);
                                                                                    const barLeft = colCenter - (barWidth / 2);
                                                                                    
                                                                                    const val = prod.timesPurchased || 0;
                                                                                    const barHeight = (val / maxPurchased) * chartHeight;
                                                                                    const barTop = paddingTop + chartHeight - barHeight;

                                                                                    const amount = parseFloat(prod.amount || '0');
                                                                                    const isFree = String(prod.price || '').toLowerCase() === 'free' || amount <= 0;

                                                                                    return (
                                                                                        <g key={idx} className="group cursor-pointer" onClick={() => setSelectedProductId(selectedProductId === prod.id ? null : prod.id)}>
                                                                                            {/* Invisible hover helper for whole column */}
                                                                                            <rect 
                                                                                                x={paddingLeft + idx * colWidth}
                                                                                                y={paddingTop}
                                                                                                width={colWidth}
                                                                                                height={chartHeight + 5}
                                                                                                className="fill-transparent hover:fill-white/[0.02]"
                                                                                            />

                                                                                            {/* Glow shadow for high sales */}
                                                                                            {val > 0 && (
                                                                                                <rect 
                                                                                                    x={barLeft} 
                                                                                                    y={barTop} 
                                                                                                    width={barWidth} 
                                                                                                    height={barHeight} 
                                                                                                    rx="4"
                                                                                                    className="fill-cyan-500/20 filter blur-sm transition-all duration-300 group-hover:fill-cyan-400/30"
                                                                                                />
                                                                                            )}

                                                                                            {/* Bar */}
                                                                                            <rect 
                                                                                                x={barLeft} 
                                                                                                y={barTop} 
                                                                                                width={barWidth} 
                                                                                                height={Math.max(barHeight, 3)} 
                                                                                                rx="3"
                                                                                                className={`transition-all duration-300 ${val > 0 ? (isFree ? 'fill-purple-500 group-hover:fill-purple-400' : 'fill-cyan-500 group-hover:fill-cyan-400') : 'fill-white/10 group-hover:fill-white/20'}`}
                                                                                            />

                                                                                            {/* Label */}
                                                                                            <text 
                                                                                                x={colCenter} 
                                                                                                y={height - paddingBottom + 14} 
                                                                                                textAnchor="middle" 
                                                                                                className="fill-gray-400 text-[8px] font-medium"
                                                                                            >
                                                                                                {prod.productName && prod.productName.length > 8 
                                                                                                    ? `${prod.productName.substring(0, 6)}...` 
                                                                                                    : prod.productName || `Prod ${idx + 1}`}
                                                                                            </text>

                                                                                            {/* Hover tooltip */}
                                                                                            <g className="opacity-0 group-hover:opacity-100 transition-all duration-200 pointer-events-none">
                                                                                                <rect 
                                                                                                    x={Math.max(barLeft - 30, 5)} 
                                                                                                    y={Math.max(barTop - 34, 2)} 
                                                                                                    width="95" 
                                                                                                    height="26" 
                                                                                                    rx="6" 
                                                                                                    className="fill-[#111] stroke stroke-white/20"
                                                                                                    strokeWidth="1"
                                                                                                />
                                                                                                <text 
                                                                                                    x={Math.max(barLeft - 30, 5) + 47.5} 
                                                                                                    y={Math.max(barTop - 34, 2) + 16} 
                                                                                                    textAnchor="middle" 
                                                                                                    className="fill-cyan-400 font-bold text-[9px] font-sans"
                                                                                                >
                                                                                                    {val} {isFree ? "users" : "sales"}
                                                                                                </text>
                                                                                            </g>
                                                                                        </g>
                                                                                    );
                                                                                })}

                                                                                {/* Ground border */}
                                                                                <line 
                                                                                    x1={paddingLeft} 
                                                                                    y1={height - paddingBottom} 
                                                                                    x2={width - paddingRight} 
                                                                                    y2={height - paddingBottom} 
                                                                                    stroke="rgba(255, 255, 255, 0.2)" 
                                                                                    strokeWidth="1.5" 
                                                                                />
                                                                            </svg>
                                                                        );
                                                                    })()}
                                                                </div>
                                                            </div>
                                                        </div>

                                                        {/* Products Leaderboard List */}
                                                        <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                                                                <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3 font-semibold flex justify-between items-center">
                                                                    <span>Product Sales Breakdown</span>
                                                                    <span className="text-[10px] text-cyan-400 font-normal">Click a product to view details</span>
                                                                </h4>
                                                                <div className="space-y-2">
                                                                    {sellerProducts
                                                                        .slice()
                                                                        .sort((a,b) => (b.timesPurchased || 0) - (a.timesPurchased || 0))
                                                                        .map((p, index) => {
                                                                            const amountNgn = parseFloat(p.amount || '0');
                                                                            const isFree = String(p.price || '').toLowerCase() === 'free' || amountNgn <= 0;
                                                                            const isOpen = selectedProductId === p.id;
                                                                            
                                                                            // Calculates 80% of price divided by the amount of sales
                                                                            const sales = p.timesPurchased || 0;
                                                                            const estSalesValNgn = sales > 0 ? (amountNgn * 0.8) / sales : 0;
                                                                            const totalEarningsNgn = sales * amountNgn * 0.8;

                                                                            return (
                                                                                <div key={index} className="flex flex-col p-2.5 bg-black/20 border border-white/5 rounded-lg hover:bg-black/30 transition">
                                                                                    {/* Header Row */}
                                                                                    <div 
                                                                                        onClick={() => setSelectedProductId(isOpen ? null : p.id)}
                                                                                        className="flex items-center justify-between cursor-pointer w-full select-none"
                                                                                    >
                                                                                        <div className="flex items-center gap-3">
                                                                                            <span className="text-xs font-mono font-bold text-gray-500 w-4">#{index + 1}</span>
                                                                                            {p.thumbnail ? (
                                                                                                <img src={p.thumbnail} alt={p.productName} className="w-8 h-8 rounded object-cover border border-white/10" referrerPolicy="no-referrer" />
                                                                                            ) : (
                                                                                                <div className="w-8 h-8 rounded bg-white/5 flex items-center justify-center text-gray-400 border border-white/10">
                                                                                                    <Package size={14} />
                                                                                                </div>
                                                                                            )}
                                                                                            <div>
                                                                                                <p className="text-xs font-bold text-white line-clamp-1">{p.productName || "Untitled"}</p>
                                                                                                <p className="text-[10px] text-gray-500">
                                                                                                    {isFree ? "Free Product" : `${formatPrice(amountNgn)} each`}
                                                                                                </p>
                                                                                            </div>
                                                                                        </div>
                                                                                        <div className="text-right flex items-center gap-3">
                                                                                            <div>
                                                                                                <p className="text-xs font-black text-cyan-400">
                                                                                                    {sales} {isFree ? "users" : "sales"}
                                                                                                </p>
                                                                                                {!isFree && (
                                                                                                    <p className="text-[10px] text-green-400 font-bold">
                                                                                                        +{formatPrice(totalEarningsNgn)}
                                                                                                    </p>
                                                                                                )}
                                                                                            </div>
                                                                                            <span className="text-gray-500 text-[9px] transition-transform duration-200">
                                                                                                {isOpen ? "▲" : "▼"}
                                                                                            </span>
                                                                                        </div>
                                                                                    </div>

                                                                                    {/* Expanded Details Panel */}
                                                                                    {isOpen && (
                                                                                        <div className="mt-3 pt-3 border-t border-white/5 text-left grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs bg-black/40 rounded p-2.5 animate-in fade-in slide-in-from-top-1">
                                                                                            {isFree ? (
                                                                                                <div className="space-y-1 sm:col-span-2">
                                                                                                    <p className="text-[10px] text-purple-400 font-bold uppercase tracking-wider">Product Users (Free)</p>
                                                                                                    <p className="text-sm font-black text-white">{sales} users</p>
                                                                                                    <p className="text-[10px] text-gray-500 italic">This is a free product. There are no sales or estimated earnings. This counts the number of unique user accounts utilizing this product.</p>
                                                                                                </div>
                                                                                            ) : (
                                                                                                <>
                                                                                                    <div className="space-y-1">
                                                                                                        <p className="text-[10px] text-cyan-400 font-bold uppercase tracking-wider">Estimated Sales Value / Unit</p>
                                                                                                        <p className="text-sm font-black text-white">
                                                                                                            {formatPrice(estSalesValNgn)}
                                                                                                        </p>
                                                                                                        <p className="text-[9px] text-gray-500 leading-normal italic">
                                                                                                            Calculated as 80% commission of the {formatPrice(amountNgn)} price divided by {sales} sales units.
                                                                                                        </p>
                                                                                                    </div>
                                                                                                    <div className="space-y-1">
                                                                                                        <p className="text-[10px] text-green-400 font-bold uppercase tracking-wider">Total Product Payout (80% share)</p>
                                                                                                        <p className="text-sm font-black text-green-400">
                                                                                                            {formatPrice(totalEarningsNgn)}
                                                                                                        </p>
                                                                                                        <p className="text-[9px] text-gray-500 leading-normal italic">
                                                                                                            Your net share: 80% of total product invoice volume.
                                                                                                        </p>
                                                                                                    </div>
                                                                                                </>
                                                                                            )}
                                                                                        </div>
                                                                                    )}
                                                                                </div>
                                                                            );
                                                                        })}
                                                                </div>
                                                        </div>
                                                    </div>
                                                )}
                                            </>
                                        );
                                    })()}
                                </div>
                            )}

                            {activeTab === 'referrals' && refData && (
                                <div className="text-center py-8 bg-white/5 rounded-xl border border-white/10 relative">
                                    <Users size={48} className="mx-auto text-purple-500 mb-4" />
                                    <p className="text-5xl font-black text-white">{refData.refs || 0}</p>
                                    <p className="text-sm font-bold text-gray-400 mt-2 uppercase tracking-widest">Total Referrals</p>
                                    
                                    <div className="mt-8 px-6">
                                        <p className="text-xs text-gray-400 mb-2 uppercase tracking-widest">YOUR REFERRAL CODE</p>
                                        <div className="bg-black/50 border border-white/10 rounded-lg p-3 flex items-center justify-between">
                                            <span className="font-mono text-purple-400 font-bold tracking-widest text-lg">{(refData && (refData.referralCode || refData.referralId)) || refId || "Generating..."}</span>
                                            <button 
                                              onClick={() => {
                                                  navigator.clipboard.writeText((refData && (refData.referralCode || refData.referralId)) || refId || "");
                                                  alert("Copied!");
                                              }} 
                                              className="p-2 bg-white/10 hover:bg-white/20 rounded transition text-white"
                                            >
                                                Copy
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </motion.div>

            {/* Custom Product Delete Confirmation Modal */}
            <AnimatePresence>
                {productToDelete && (
                    <div className="fixed inset-0 z-[300] bg-black/90 flex items-center justify-center p-4">
                        <motion.div 
                            initial={{ opacity: 0, scale: 0.95 }} 
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            className="bg-[#0c0c0e] border border-red-500/30 rounded-2xl p-6 max-w-sm w-full shadow-2xl flex flex-col gap-4 text-center"
                        >
                            <div className="mx-auto w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center text-red-500 border border-red-500/20">
                                <AlertTriangle size={24} />
                            </div>
                            <div>
                                <h3 className="text-base font-bold text-white mb-2">Delete Product?</h3>
                                <p className="text-xs text-gray-500 mb-1">
                                    Are you sure you want to delete <span className="text-red-400 font-bold">"{productToDelete.productName}"</span>?
                                </p>
                                <p className="text-[10.5px] text-gray-600 italic">
                                    This will permanently remove the product from the creator store and the live marketplace. This action cannot be undone.
                                </p>
                            </div>
                            <div className="grid grid-cols-2 gap-3 mt-2">
                                <button 
                                    onClick={() => setProductToDelete(null)}
                                    disabled={deletingProductId !== null}
                                    className="py-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-bold text-gray-400 hover:text-white transition-colors border border-white/5"
                                >
                                    Cancel
                                </button>
                                <button 
                                    onClick={() => handleDeleteProduct(productToDelete)}
                                    disabled={deletingProductId !== null}
                                    className="py-2.5 rounded-lg bg-red-500 hover:bg-red-400 disabled:bg-red-950 text-xs font-bold text-white transition-colors flex items-center justify-center gap-1.5 shadow-lg shadow-red-950/50"
                                >
                                    {deletingProductId ? (
                                        <>Deleting...</>
                                    ) : (
                                        <>
                                            Yes, Delete
                                        </>
                                    )}
                                </button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </div>
    );
}
