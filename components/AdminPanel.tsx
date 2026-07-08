import React, { useState, useEffect, useRef } from 'react';
import { db, collection, onSnapshot, doc, setDoc, deleteDoc, getDocs, serverTimestamp, handleFirestoreError, OperationType } from '../utils/firebase';
import { Search, Shield, RefreshCw, Plus, Save, Database, AlertCircle, Info, Check, Trash2, X, Upload } from 'lucide-react';
import { uploadToDropbox } from '../utils/dropbox';

type TableType = 'products' | 'sellers' | 'referrals' | 'competitions' | 'tutorials' | 'dropbox_keys';

const SPREADSHEET_COLUMNS: Record<TableType, { key: string, label: string }[]> = {
  products: [
    { key: 'name', label: 'Product Name' },
    { key: 'price', label: 'Price' },
    { key: 'amount', label: 'Amount' },
    { key: 'thumbnail', label: 'Thumbnail Prod' },
    { key: 'images', label: 'Product Images' },
    { key: 'category', label: 'Category' },
    { key: 'sellerId', label: 'Seller ID' },
    { key: 'timesPurchased', label: 'Sales' },
    { key: 'productUrl', label: 'Product URL' },
    { key: 'starRating', label: 'Star Rating' },
    { key: 'productDescription', label: 'Product Description' },
    { key: 'videoUrl', label: 'Video URL' },
    { key: 'auditStatus', label: 'Audit Status' }
  ],
  sellers: [
    { key: 'sellerId', label: 'Seller ID' },
    { key: 'email', label: 'Email' },
    { key: 'accountNumber', label: 'Account Number' },
    { key: 'bankName', label: 'Bank Name' },
    { key: 'bankOwnerName', label: 'Bank Owner' },
    { key: 'payout', label: 'Payout' }
  ],
  referrals: [
    { key: 'referralId', label: 'Referral ID' },
    { key: 'email', label: 'Email' },
    { key: 'numberOfReferences', label: 'No. of ref' },
    { key: 'accountNumber', label: 'Account Number' },
    { key: 'bankName', label: 'Bank Name' },
    { key: 'bankOwnerName', label: 'Bank Owner' },
    { key: 'payout', label: 'Payout' }
  ],
  competitions: [
    { key: 'competition', label: 'Competition Name' },
    { key: 'price', label: 'Winners Cash Prize' },
    { key: 'eligibility', label: 'Eligibility (monthly / yearly)' },
    { key: 'end_date', label: 'End Date (YYYY-MM-DD)' },
    { key: 'applicants', label: 'No of Applicants' },
    { key: 'what_to_submit', label: 'What to Submit Details' },
    { key: 'input_fields', label: 'Input Fields (comma-separated, e.g. dropbox link, social media link)' },
    { key: 'flyer', label: 'Flyer Image URL' }
  ],
  tutorials: [
    { key: 'title', label: 'Name of Video' },
    { key: 'youtube_link', label: 'YouTube URL' },
    { key: 'views', label: 'Number of Views' },
    { key: 'thumbnail', label: 'Blog / Tutorial Image' }
  ],
  dropbox_keys: [
    { key: 'accessToken', label: 'Access Token' }
  ]
};

const getAlphabet = (index: number) => {
  return String.fromCharCode(65 + index);
};

export const AdminPanel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [activeTab, setActiveTab] = useState<TableType>('products');
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMSG, setErrorMSG] = useState('');
  const [localEdits, setLocalEdits] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);
  const [selectedCell, setSelectedCell] = useState<{row: string, col: string} | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [notification, setNotification] = useState<{message: string; type: 'success' | 'info' | 'error'} | null>(null);

  const showNotification = (msg: string, type: 'success' | 'info' | 'error' = 'success') => {
    setNotification({ message: msg, type });
    setTimeout(() => {
      setNotification(null);
    }, 4000);
  };

  useEffect(() => {
    setLoading(true);
    const unsubscribe = onSnapshot(collection(db, activeTab), (snapshot) => {
      const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setData(items);
      setLoading(false);
    }, (error) => {
      setLoading(false);
      try {
        handleFirestoreError(error, OperationType.LIST, activeTab);
      } catch (err: any) {
        setErrorMSG(err.message);
        showNotification(err.message, 'error');
      }
    });

    return () => unsubscribe();
  }, [activeTab]);

  const handleLocalChange = (id: string, col: string, value: any) => {
     setLocalEdits(prev => ({
       ...prev,
       [id]: {
          ...(prev[id] || {}),
          [col]: value
       }
     }));
  };

  const saveChanges = async () => {
    setSaving(true);
    let errorCnt = 0;
    for (const [id, changes] of Object.entries(localEdits)) {
       try {
         const updates = { ...(changes as Record<string, any>) };
         if (updates.images && typeof updates.images === 'string') {
             updates.images = updates.images.split(',').map((s: string) => s.trim()).filter((s: string) => s.length > 0);
         }
         await setDoc(doc(db, activeTab, id), { ...updates, updatedAt: serverTimestamp() }, { merge: true });
         if (activeTab === 'dropbox_keys' && updates.accessToken) {
           try {
             const { supabase } = await import("../utils/supabase");
             if (supabase) {
               const { error } = await supabase
                 .from('dropbox_keys')
                 .upsert({ id: id, accessToken: updates.accessToken.trim(), updated_at: new Date().toISOString() });
               if (error) {
                 console.warn("[AdminPanel Supabase Sync] error:", error.message);
               } else {
                 console.log("[AdminPanel Supabase Sync] Successfully saved token to Supabase:", id);
               }
             }
           } catch (supErr) {
             console.warn("[AdminPanel Supabase Sync] Failed to upsert to Supabase:", supErr);
           }
         }
       } catch(e) {
         errorCnt++;
         console.error(e);
       }
    }
    setLocalEdits({});
    setSaving(false);
    if (errorCnt > 0) {
      showNotification(`Saved with ${errorCnt} errors.`, 'error');
    } else {
      showNotification("Changes saved successfully to database!", "success");
    }
  };

  const clearAllDummyData = async () => {
    try {
      setLoading(true);
      await deleteDoc(doc(db, 'products', 'test_product_1')).catch(() => {});
      
      const collectionsToWipe: TableType[] = ['products', 'sellers', 'referrals'];
      for (const col of collectionsToWipe) {
        const q = collection(db, col);
        const snapshot = await getDocs(q);
        for (const d of snapshot.docs) {
          const val = d.data();
          const nameStr = String(val.name || val.email || val.sellerId || val.referralId || '').toLowerCase();
          if (
            d.id === 'test_product_1' ||
            nameStr.includes('test') || 
            nameStr.includes('dummy') || 
            nameStr.includes('animato studio') || 
            nameStr.includes('placeholder')
          ) {
            await deleteDoc(doc(db, col, d.id));
            console.log(`[AdminPanel Cleanup] Erased ${col} item:`, d.id);
          }
        }
      }
      
      setData([]);
      showNotification('All dummy products, sellers, and referrals have been completely erased from the database!', 'success');
    } catch (e: any) {
      showNotification('Error clearing data: ' + e.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const addRow = async () => {
    const newId = Date.now().toString();
    const basePath = `${activeTab}/${newId}`;
    try {
      const baseObj = { createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
      let specificObj = {};
      if (activeTab === 'products') {
        specificObj = { price: 'Free', category: '', thumbnail: '', images: [], amount: 0, name: '', timesPurchased: 0, sellerId: '', productUrl: '', starRating: '0', productDescription: '', videoUrl: '', auditStatus: 'approved' };
      } else if (activeTab === 'sellers') {
        specificObj = { sellerId: newId, accountNumber: '', bankName: '', bankOwnerName: '', payout: 0 };
      } else if (activeTab === 'referrals') {
        specificObj = { referralId: newId, numberOfReferences: 0, accountNumber: '', bankName: '', bankOwnerName: '', payout: 0 };
      } else if (activeTab === 'competitions') {
        specificObj = { competition: 'New Challenge Name', price: '$250', eligibility: 'yearly', end_date: '2026-07-25', applicants: 0, what_to_submit: 'Describe guidelines here.', input_fields: 'dropbox link, social media link', flyer: '' };
      } else if (activeTab === 'tutorials') {
        specificObj = { title: 'New Tutorial Lesson', youtube_link: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', views: 0 };
      } else if (activeTab === 'dropbox_keys') {
        specificObj = { accessToken: '' };
      }
      
      await setDoc(doc(db, activeTab, newId), { ...baseObj, ...specificObj });
      showNotification(`Row added to ${activeTab}!`, 'success');
    } catch (e) {
      try { 
        handleFirestoreError(e, OperationType.CREATE, basePath); 
      } catch (err: any) { 
        showNotification(err.message, 'error'); 
      }
    }
  };

  const deleteRow = async (id: string) => {
    try {
      await deleteDoc(doc(db, activeTab, id));
      if (activeTab === 'dropbox_keys') {
        try {
          const { supabase } = await import("../utils/supabase");
          if (supabase) {
            await supabase.from('dropbox_keys').delete().eq('id', id);
            console.log("[AdminPanel Supabase Sync] Deleted key from Supabase:", id);
          }
        } catch (supErr) {
          console.warn("[AdminPanel Supabase Sync] Failed to delete from Supabase:", supErr);
        }
      }
      showNotification(`Row deleted successfully!`, 'success');
    } catch (e) {
      try { 
        handleFirestoreError(e, OperationType.DELETE, `${activeTab}/${id}`); 
      } catch (err: any) { 
        showNotification(err.message, 'error'); 
      }
    }
  };

  const columns = SPREADSHEET_COLUMNS[activeTab];

  // Perform client-side real-time filter across spreadsheet columns
  const filteredData = data.filter((row) => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.trim().toLowerCase();
    return columns.some((col) => {
      const val = row[col.key];
      return String(val ?? '').toLowerCase().includes(query);
    }) || String(row.id ?? '').toLowerCase().includes(query);
  });

  const handleImageUpload = async (rowId: string, colKey: string, file: File) => {
    try {
      showNotification('Preloading image...', 'info');
      const base64Promise = new Promise<{ base64: string, name: string }>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result === 'string') {
            const base64 = reader.result.includes(",") ? reader.result.substring(reader.result.indexOf(",") + 1) : reader.result;
            resolve({ base64, name: file.name });
          } else {
            reject(new Error("Failed to read file reader result"));
          }
        };
        reader.onerror = () => reject(reader.error || new Error("Failed to read file"));
        reader.readAsDataURL(file);
      });
      const preloaded = await base64Promise;

      showNotification('Uploading image...', 'info');
      const url = await uploadToDropbox(preloaded, `admin_${Date.now()}_${file.name}`, 'admin_uploads');
      let sanitizedUrl = url.replace(/d1=0/gi, 'd1=1').replace(/dl=0/gi, 'dl=1');
      
      if (colKey === 'images') {
        const row = data.find(r => r.id === rowId);
        const currentVal = localEdits[rowId]?.[colKey] !== undefined ? localEdits[rowId][colKey] : row?.[colKey] || '';
        const currentArray = Array.isArray(currentVal) ? currentVal : (typeof currentVal === 'string' && currentVal ? currentVal.split(',').map(s=>s.trim()) : []);
        handleLocalChange(rowId, colKey, [...currentArray, sanitizedUrl].join(','));
      } else {
        handleLocalChange(rowId, colKey, sanitizedUrl);
      }
      
      showNotification('Image uploaded successfully!', 'success');
    } catch (err: any) {
      showNotification(`Upload failed: ${err.message}`, 'error');
    }
  };

  return (
    <div className="fixed inset-0 z-[200] bg-[#000000] text-gray-200 flex flex-col font-sans select-none animate-in fade-in duration-300">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between px-4 py-3 bg-[#1e1e1e] border-b border-[#333] gap-2">
         <div className="flex items-center space-x-4">
            <h1 className="text-xs font-bold text-white flex items-center gap-1.5 font-mono tracking-wider"><Shield size={14} className="text-red-500 animate-pulse" /> ANIMATO ADMIN DB</h1>
            <div className="flex items-center space-x-1.5 bg-black/40 p-1 rounded-lg border border-white/5">
              <button onClick={addRow} className="px-2.5 py-1 bg-neutral-800 hover:bg-neutral-700 active:scale-95 text-xs text-white flex items-center gap-1 rounded font-medium transition-all">
                <Plus size={12} className="text-green-400" />
                <span>Add Row</span>
              </button>
              <button 
                 onClick={saveChanges} 
                 disabled={saving || Object.keys(localEdits).length === 0} 
                 className={`px-2.5 py-1 rounded text-xs flex items-center gap-1 transition-all active:scale-95 duration-200 ${
                   Object.keys(localEdits).length > 0 
                     ? 'bg-emerald-600 hover:bg-emerald-500 text-white font-bold shadow-lg shadow-emerald-950/20' 
                     : 'bg-neutral-800 text-gray-500 cursor-not-allowed'
                 }`}
              >
                <Save size={12} className={Object.keys(localEdits).length > 0 ? "text-white" : "text-gray-500"} />
                <span>{saving ? 'Saving...' : `Save (${Object.keys(localEdits).length})`}</span>
              </button>
              <button onClick={clearAllDummyData} className="px-2.5 py-1 bg-red-950/40 hover:bg-red-900/60 active:scale-95 text-xs text-red-200 border border-red-500/20 flex items-center gap-1 rounded font-medium transition-all">
                <Trash2 size={12} className="text-red-400" />
                <span>Wipe Dummy Data</span>
              </button>
            </div>
         </div>
         
         <div className="flex items-center gap-3 self-end sm:self-auto w-full sm:w-auto">
            {/* Search Input */}
            <div className="relative flex items-center bg-black/50 rounded border border-[#333] px-2.5 py-1 w-full sm:w-60 focus-within:border-cyan-500/50 transition-all">
              <Search size={12} className="text-gray-500 mr-2 shrink-0" />
              <input 
                type="text" 
                placeholder="Search database..." 
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="bg-transparent text-xs text-gray-200 outline-none w-full placeholder-gray-600"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} className="p-0.5 text-gray-400 hover:text-white">
                  <X size={12} />
                </button>
              )}
            </div>
            
            <button onClick={onClose} className="px-4 py-1.5 bg-[#d93025] hover:bg-red-600 active:scale-95 text-white rounded text-xs font-semibold transition-all">Done</button>
         </div>
      </div>

      {/* Notifications Toast Banner */}
      {notification && (
        <div className={`px-4 py-2.5 text-xs text-white flex items-center justify-between border-b animate-in slide-in-from-top-2 duration-300 ${
          notification.type === 'success' ? 'bg-emerald-950/80 border-emerald-500/25 text-emerald-200' : 
          notification.type === 'error' ? 'bg-red-950/80 border-red-500/25 text-red-200' : 
          'bg-cyan-950/80 border-cyan-500/25 text-cyan-200'
        }`}>
          <div className="flex items-center gap-2">
            {notification.type === 'success' && <Check size={14} className="text-emerald-400 shrink-0" />}
            {notification.type === 'error' && <AlertCircle size={14} className="text-red-400 shrink-0" />}
            {notification.type === 'info' && <Info size={14} className="text-cyan-400 shrink-0" />}
            <span className="font-medium tracking-wide">{notification.message}</span>
          </div>
          <button onClick={() => setNotification(null)} className="opacity-70 hover:opacity-100 p-0.5">
            <X size={12} />
          </button>
        </div>
      )}

      {errorMSG && (
        <div className="p-2 bg-red-950/50 border-b border-red-900/50 text-red-400 text-xs flex items-center gap-1.5 px-4 font-medium">
          <AlertCircle size={12} />
          <span>{errorMSG}</span>
        </div>
      )}

      <div className="flex-1 overflow-auto bg-[#0f0f0f] relative custom-scrollbar">
         {loading ? (
           <div className="p-8 text-sm text-gray-500 flex items-center gap-2">
             <RefreshCw size={14} className="animate-spin text-green-500" />
             <span>Loading Firestore collections...</span>
           </div>
         ) : (
           <table className="border-collapse whitespace-nowrap bg-[#000000] min-w-full table-fixed">
              <thead>
                <tr>
                   <th className="w-10 min-w-[40px] sticky top-0 left-0 z-30 bg-[#1e1e1e] border border-[#333]"></th>
                   {columns.map((col, idx) => (
                     <th key={idx} className="sticky top-0 z-20 bg-[#1e1e1e] border border-[#333] px-2 py-1 text-xs text-center text-gray-300 font-normal min-w-[125px]">
                        {getAlphabet(idx)}
                     </th>
                   ))}
                   <th className="sticky top-0 z-20 w-12 bg-[#1e1e1e] border border-[#333]"></th>
                </tr>
                <tr>
                   <th className="w-10 min-w-[40px] sticky left-0 z-20 bg-[#1e1e1e] border border-[#333] text-center text-xs text-gray-300 font-normal py-1">
                     1
                   </th>
                   {columns.map((col) => (
                     <th key={col.key} className="bg-[#0f0f0f] border border-[#333] px-2 py-1 text-xs text-white font-semibold text-left">
                       {col.label}
                     </th>
                   ))}
                   <th className="bg-[#0f0f0f] border border-[#333]"></th>
                </tr>
              </thead>
              <tbody>
                {filteredData.map((row, rowIndex) => (
                  <tr key={row.id} className="hover:bg-neutral-900/10">
                    <td className="w-10 min-w-[40px] sticky left-0 z-10 bg-[#1e1e1e] border border-[#333] text-center text-xs text-gray-300 font-mono">
                      {rowIndex + 2}
                    </td>
                    
                    {columns.map((col) => {
                      let displayVal = localEdits[row.id]?.[col.key] !== undefined ? localEdits[row.id][col.key] : row[col.key];
                      if (col.key === 'images' && Array.isArray(displayVal)) {
                         displayVal = displayVal.join(',');
                      }
                      
                      const isEdited = localEdits[row.id]?.[col.key] !== undefined;
                      const isSelected = selectedCell?.row === row.id && selectedCell?.col === col.key;
                      
                      return (
                        <td 
                           key={col.key} 
                           onClick={() => setSelectedCell({row: row.id, col: col.key})}
                           className={`border border-[#333] relative p-0 text-sm overflow-hidden transition-colors
                                     ${isSelected ? 'outline outline-2 outline-[#1a73e8] z-10' : ''} 
                                     ${isEdited ? 'bg-emerald-950/45' : 'bg-[#000000] hover:bg-[#111111]'}`}
                        >
                           <div className="flex w-full h-full min-h-[30px]">
                             <input 
                                type="text"
                                value={displayVal === undefined ? '' : displayVal}
                                onChange={(e) => {
                                  let val: any = e.target.value;
                                  if (['amount', 'timesPurchased', 'payout', 'numberOfReferences', 'applicants', 'views'].includes(col.key)) {
                                      if(val !== '') val = parseFloat(val) || 0;
                                      else val = 0;
                                  }
                                  handleLocalChange(row.id, col.key, val);
                                }}
                                className={`w-full bg-transparent outline-none px-2.5 text-xs font-mono
                                  ${col.key === 'thumbnail' || col.key === 'images' || col.key === 'flyer' ? 'text-[#5e97f6] hover:underline' : ''} 
                                  ${isSelected ? 'text-white' : 'text-[#cccccc]'}`}
                             />
                             {(col.key === 'thumbnail' || col.key === 'images' || col.key === 'flyer') && (
                               <label className="text-gray-400 hover:text-white px-2 flex items-center justify-center border-l border-[#333] cursor-pointer bg-[#1e1e1e] hover:bg-[#2e2e2e] transition-colors" title="Upload to Dropbox">
                                 <Upload size={12} />
                                 <input 
                                   type="file" 
                                   accept="image/*"
                                   className="hidden" 
                                   onChange={(e) => {
                                     const file = e.target.files?.[0];
                                     if (file) {
                                       handleImageUpload(row.id, col.key, file);
                                     }
                                     e.target.value = '';
                                   }}
                                 />
                               </label>
                             )}
                           </div>
                        </td>
                      )
                    })}
                    <td className="border border-[#333] text-center bg-[#000000]">
                       <button onClick={() => deleteRow(row.id)} className="text-gray-500 hover:text-red-400 font-bold px-3 py-1 text-xs transition-colors flex items-center justify-center w-full"><Trash2 size={12} /></button>
                    </td>
                  </tr>
                ))}
                
                {Array.from({ length: Math.max(15, 50 - filteredData.length) }).map((_, i) => (
                  <tr key={`empty-${i}`}>
                    <td className="w-10 min-w-[40px] sticky left-0 z-10 bg-[#1e1e1e] border border-[#333] text-center text-xs text-gray-700 font-mono">
                      {filteredData.length + 2 + i}
                    </td>
                    {columns.map((col, idx) => (
                      <td key={`empty-${i}-${idx}`} className="border border-[#333] bg-[#000000] p-3 text-xs text-[#333]"></td>
                    ))}
                    <td className="border border-[#333] bg-[#000000]"></td>
                  </tr>
                ))}
              </tbody>
           </table>
         )}
      </div>

      <div className="flex items-center space-x-1 px-2 pt-2 bg-[#1e1e1e] border-t border-[#333] overflow-x-auto custom-scrollbar">
         <div className="px-2 py-1 flex items-center space-x-2">
            <span className="text-green-500 font-bold">∑</span>
            <div className="h-4 w-px bg-gray-600 mx-2"></div>
         </div>
         {['products', 'sellers', 'referrals', 'competitions', 'tutorials', 'dropbox_keys'].map((tab) => (
            <button 
               key={tab} 
               onClick={() => { setActiveTab(tab as TableType); setLocalEdits({}); setSelectedCell(null); }} 
               className={`px-4 py-2 rounded-t-lg text-xs font-semibold uppercase flex items-center space-x-2
                  ${activeTab === tab ? 'bg-[#0f0f0f] text-green-400 border-t-2 border-green-400' : 'bg-[#1e1e1e] text-gray-400 hover:bg-[#2b2b2b]'}`}
            >
               <span className="text-green-500 text-lg leading-none mb-0.5">■</span>
               <span>{tab === 'dropbox_keys' ? 'Dropbox link API keys' : tab}</span>
            </button>
         ))}
      </div>
    </div>
  );
};
