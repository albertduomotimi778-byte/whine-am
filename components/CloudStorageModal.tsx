import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Cloud, UploadCloud, Trash2, ShieldAlert, Sparkles, AlertCircle, HardDrive, Database, RefreshCw, Layers, Check, Star, ArrowRight, Lock } from 'lucide-react';
import { useLanguage } from '../utils/LanguageContext';
import * as backend from '../utils/backend';
import { StorageUtils } from '../utils/storage';
import { ThemeType, getThemeColors } from '../utils/themeColors';
import { detectUserCountry, getScaledPrice } from '../utils/pppPricing';

interface CloudStorageModalProps {
  user: any;
  savedProjects: any[];
  theme?: ThemeType;
  onClose: () => void;
  onRefreshProjects?: () => void;
}

export const CloudStorageModal: React.FC<CloudStorageModalProps> = ({
  user,
  savedProjects,
  theme = 'midnight',
  onClose,
  onRefreshProjects
}) => {
  const { t } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [cloudJoined, setCloudJoined] = useState(false);
  const [subView, setSubView] = useState<'menu' | 'load' | 'upload'>('menu');
  const [cloudProjects, setCloudProjects] = useState<any[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [showUpgradeUI, setShowUpgradeUI] = useState<boolean>(false);
  const [countryCode, setCountryCode] = useState<string>('NG');
  const [paystackLoading, setPaystackLoading] = useState<boolean>(false);
  const [paystackError, setPaystackError] = useState<string | null>(null);
  
  const [selectedToBackup, setSelectedToBackup] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (savedProjects && savedProjects.length > 0) {
      setSelectedToBackup(new Set(savedProjects.map(p => p.id)));
    }
  }, [savedProjects]);

  const [loadingProject, setLoadingProject] = useState<string | null>(null);
  const [loadProgress, setLoadProgress] = useState<number>(0);

  useEffect(() => {
    detectUserCountry().then(setCountryCode).catch(() => {});
  }, []);

  const handleSubscriptionPay = async (planType: 'monthly' | 'yearly') => {
    setPaystackLoading(true);
    setPaystackError(null);
    try {
      const baseNgn = planType === 'monthly' ? 1500 : 10500;
      const finalAmount = getScaledPrice(baseNgn, countryCode);
      const userEmail = user?.email?.toLowerCase()?.trim() || localStorage.getItem('pending_app_payment') || '';

      if (!userEmail) {
        throw new Error(t("Email is missing. Please sign back in first."));
      }

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
          console.log("Paystack Renewal success callback from Cloud Storage Modal:", response);
          window.location.href = `${window.location.origin}/payment/${encodeURIComponent(userEmail)}/${finalAmount}/${planType}/?reference=${response.reference}`;
        },
        onClose: () => {
          setPaystackLoading(false);
        }
      });
      handler.openIframe();
    } catch (err: any) {
      console.error(err);
      setPaystackError(err.message || t("Failed to start payment"));
      setPaystackLoading(false);
    }
  };

  const isLight = theme === 'light';
  const colors = getThemeColors(theme as ThemeType);

  // Checks premium subscription eligibility (Any active paid plan)
  const isPremium = user?.subscription_status === 'active' && ['yearly', 'monthly', 'pro', 'premium', 'studio'].includes((user?.subscription_type || '').trim().toLowerCase());
  const normalizedEmail = user?.email?.toLowerCase().trim() || '';

  // Limits
  const MAX_STORAGE_BYTES = 500 * 1024 * 1024; // 500 MB
  const MAX_PROJECT_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB

  // Load cloud data status
  useEffect(() => {
    const checkCloudStatus = async () => {
      setLoading(true);
      try {
        if (!normalizedEmail || !isPremium) {
          setLoading(false);
          return;
        }
        const storedJoin = localStorage.getItem(`user_cloud_joined_${normalizedEmail}`);
        let isJoined = storedJoin === 'true';

        // Load existing cloud projects regardless of isJoined to see if they already have files
        const projects = await backend.getCloudProjects(normalizedEmail);
        const realProjects = projects.filter(p => !p.id.startsWith('cloud_tag_') && p.name !== '__CLOUD_TAG__');

        if (realProjects.length > 0) {
          localStorage.setItem(`user_cloud_joined_${normalizedEmail}`, 'true');
          isJoined = true;
        } else if (!isJoined) {
          const hasDbTag = await backend.hasCloudTag(normalizedEmail);
          if (hasDbTag) {
            localStorage.setItem(`user_cloud_joined_${normalizedEmail}`, 'true');
            isJoined = true;
          }
        }
        
        if (isJoined) {
          setCloudJoined(true);
          setCloudProjects(realProjects);
        } else {
          setCloudJoined(false);
          setCloudProjects([]);
        }
      } catch (err) {
        console.error("Failed to load cloud storage info", err);
      } finally {
        setLoading(false);
      }
    };
    checkCloudStatus();
  }, [normalizedEmail, isPremium]);

  // Total Storage utilized calculation
  const totalUsedBytes = cloudProjects.reduce((sum, p) => sum + (p.size_bytes || 0), 0);
  const storagePercentage = Math.min((totalUsedBytes / MAX_STORAGE_BYTES) * 100, 100);

  const formatSize = (bytes: number) => {
    if (!bytes) return '0 KB';
    const mb = bytes / (1024 * 1024);
    if (mb < 1) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${mb.toFixed(2)} MB`;
  };

  const handleJoinCloud = async () => {
    setErrorMessage(null);
    if (!isPremium) {
      setErrorMessage(t('You are not eligible for premium cloud storage. You must have an active subscription to unlock.'));
      return;
    }
    setLoading(true);
    try {
      await backend.addCloudTag(normalizedEmail);
      setCloudJoined(true);
      
      // Auto-select and backup all existing local projects to the cloud
      const allIds: string[] = savedProjects.map(p => String(p.id));
      const backupSet = new Set<string>(allIds);
      setSelectedToBackup(backupSet);
      
      // Trigger auto sync immediately with the fully populated backup set
      await triggerAutoSync(backupSet);
    } catch (err) {
      setErrorMessage(t('Failed to join cloud. Please try again.'));
    } finally {
      setLoading(false);
    }
  };

  const handleLoadIndividualProject = async (proj: any) => {
    setErrorMessage(null);
    setSuccessMessage(null);
    setLoadingProject(proj.name);
    setLoadProgress(5);

    // Beautiful smooth simulated loader tween
    let currentProgress = 5;
    const progressInterval = setInterval(() => {
      if (currentProgress < 90) {
        currentProgress += Math.floor(Math.random() * 15) + 5;
        if (currentProgress > 90) currentProgress = 90;
        setLoadProgress(currentProgress);
      }
    }, 120);

    try {
      let projectData = proj.project_data;
      if (!projectData && proj.dropbox) {
        projectData = await backend.loadCloudProjectDropbox(proj.dropbox);
      } else if (!projectData && proj.filebase) {
        projectData = await backend.loadCloudProjectFilebase(normalizedEmail, proj.id, proj.filebase);
      } else if (!projectData && proj.chunks) {
        projectData = await backend.loadCloudProjectChunks(proj.id, proj.chunks);
      }
      
      clearInterval(progressInterval);
      setLoadProgress(100);

      if (!projectData) {
        setErrorMessage(t('Project data is corrupt or empty.'));
        setLoadingProject(null);
        return;
      }
      const fullProjectData = {
        ...projectData,
        id: proj.id,
        name: proj.name,
        lastModified: projectData.lastModified || new Date(proj.updated_at).getTime(),
        version: projectData.version || '1.0.0',
      };

      await StorageUtils.saveProject(fullProjectData);
      
      setTimeout(() => {
        setSuccessMessage(`${t('Loaded')} "${proj.name}" ${t('successfully!')}`);
        setLoadingProject(null);
        onRefreshProjects?.();
      }, 300);

    } catch (err: any) {
      clearInterval(progressInterval);
      setLoadingProject(null);
      setErrorMessage(t('Load failed:') + ' ' + err.message);
    }
  };

  const handleSelectAllToBackup = () => {
    if (selectedToBackup.size === savedProjects.length && savedProjects.length > 0) {
      setSelectedToBackup(new Set());
    } else {
      setSelectedToBackup(new Set(savedProjects.map(p => p.id)));
    }
  };

  const toggleProjectSelection = (id: string) => {
    const nextList = new Set(selectedToBackup);
    if (nextList.has(id)) {
      nextList.delete(id);
    } else {
      nextList.add(id);
    }
    setSelectedToBackup(nextList);
  };

  const triggerAutoSync = async (overrideBackupSet?: Set<string>) => {
    const activeBackupSet = (overrideBackupSet instanceof Set) ? overrideBackupSet : selectedToBackup;
    if (activeBackupSet.size === 0) {
      setErrorMessage(t('No projects selected for backup. Please select at least one project.'));
      return;
    }

    setSyncing(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    
    try {
      const activeCloudProjects = await backend.getCloudProjects(normalizedEmail);
      // Filter out meta tag just in case
      const realActiveProjects = activeCloudProjects.filter(p => !p.id.startsWith('cloud_tag_') && p.name !== '__CLOUD_TAG__');
      let currentBytesUsed = realActiveProjects.reduce((sum: number, p: any) => sum + (p.size_bytes || 0), 0);
      let newlyUploadedCount = 0;
      let skippedSizeCount = 0;
      let failedUploadCount = 0;

      // Optimistic state to guarantee UI updates even if DB index lags
      const optimisticProjects = [...realActiveProjects];

      for (const localMetadata of savedProjects) {
        if (!activeBackupSet.has(localMetadata.id)) continue;

        const existingCloudProj = optimisticProjects.find(p => p.id === localMetadata.id);

        const projectData = await StorageUtils.loadProject(localMetadata.id);
        if (!projectData) continue;

        projectData.name = localMetadata.name;

        const serialized = JSON.stringify(projectData);
        const projectSize = serialized.length;

        if (projectSize > MAX_PROJECT_SIZE_BYTES) {
          skippedSizeCount++;
          continue;
        }

        if (currentBytesUsed + projectSize > MAX_STORAGE_BYTES) {
          setErrorMessage(t('Storage limit warning: 500 MB limit reached. Some projects could not be backed up.'));
          break;
        }

        const res = await backend.saveCloudProject(normalizedEmail, localMetadata.id, localMetadata.name, projectData, projectSize);
        if (res.success) {
          currentBytesUsed += projectSize;
          newlyUploadedCount++;
          
          // Append optimistically
          const idx = optimisticProjects.findIndex(p => p.id === localMetadata.id);
          const metaPayload: any = {
            id: localMetadata.id,
            name: localMetadata.name,
            size_bytes: projectSize,
            updated_at: new Date().toISOString(),
            project_data: null,
            chunks: null,
            filebase: null
          };
          
          if (idx !== -1) {
            optimisticProjects[idx] = { ...optimisticProjects[idx], ...metaPayload };
          } else {
            optimisticProjects.push(metaPayload);
          }
        } else {
          console.warn('Failed to upload', localMetadata.name, res.error);
          failedUploadCount++;
        }
      }

      setCloudProjects(optimisticProjects);
      
      // Still fetch in background to sync any other device updates
      backend.getCloudProjects(normalizedEmail).then(updatedProjects => {
         const realUpdated = updatedProjects.filter(p => !p.id.startsWith('cloud_tag_') && p.name !== '__CLOUD_TAG__');
         if (realUpdated.length >= optimisticProjects.length) {
            setCloudProjects(realUpdated);
         }
      }).catch(()=>{});
      
      if (newlyUploadedCount > 0) {
        setSuccessMessage(`${t('Successfully backed up')} ${newlyUploadedCount} ${t('projects to cloud storage!')}`);
        onRefreshProjects?.();
      } else {
        setSuccessMessage(t('Cloud storage is fully in-sync.'));
      }

      if (skippedSizeCount > 0 && failedUploadCount > 0) {
        setErrorMessage(t(`Some projects exceeded the 50 MB limit, and ${failedUploadCount} projects failed to upload.`));
      } else if (skippedSizeCount > 0) {
        setErrorMessage(t('Some projects exceeded the 50 MB maximum size limit and were skipped.'));
      } else if (failedUploadCount > 0) {
        setErrorMessage(t(`${failedUploadCount} projects failed to upload. Please try again.`));
      }
    } catch (err: any) {
      const msg = err?.message || String(err);
      console.error("AutoSync failed:", err);
      if (msg.includes('network') || msg.includes('fetch')) {
        setErrorMessage(t('Sync operation failed. Please check your network connection.'));
      } else {
        setErrorMessage(t(`Sync operation failed: ${msg}`));
      }
    } finally {
      setSyncing(false);
    }
  };

  const handleDeleteCloudProject = async (id: string, projectName: string) => {
    if (!window.confirm(`${t('Are you sure you want to delete')} "${projectName}" ${t('from the cloud? Local files remain untouched.')}`)) {
      return;
    }
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      await backend.deleteCloudProject(normalizedEmail, id);
      const updated = await backend.getCloudProjects(normalizedEmail);
      const realUpdated = updated.filter(p => !p.id.startsWith('cloud_tag_') && p.name !== '__CLOUD_TAG__');
      setCloudProjects(realUpdated);
      setSuccessMessage(t('Cloud project deleted successfully.'));
      onRefreshProjects?.();
    } catch (err) {
      setErrorMessage(t('Failed to delete cloud project.'));
    }
  };

  return (
    <div className="fixed inset-0 z-[120] bg-black/85 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-300">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 15 }}
        className={`w-full max-w-xl border rounded-2xl shadow-3xl overflow-hidden flex flex-col max-h-[85vh] ${isLight ? 'bg-white border-black/10' : 'bg-[#0c0c0e] border-white/10'}`}
      >
        {/* Header */}
        <div className={`p-5 border-b flex justify-between items-center shrink-0 ${isLight ? 'bg-gray-50 border-black/5' : 'bg-[#09090b] border-white/5'}`}>
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 ${colors.bg} rounded-xl flex items-center justify-center ${colors.text} border ${colors.border} animate-pulse`}>
              <Cloud size={20} />
            </div>
            <div>
              <h2 className={`text-sm font-black tracking-widest uppercase ${isLight ? 'text-gray-900' : 'text-white'}`}>{t('Animato Premium Cloud')}</h2>
              <p className="text-gray-500 text-[10px] uppercase font-mono tracking-wider mt-0.5">{t('Multi-Device Project Sync')}</p>
            </div>
          </div>
          <button 
            onClick={onClose} 
            className={`p-1.5 rounded-full transition-colors cursor-pointer ${isLight ? 'text-gray-400 hover:text-gray-900 hover:bg-black/5' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
          >
            <X size={18} />
          </button>
        </div>

        {/* Scrollable Workspace */}
        <div className="p-5 space-y-5 overflow-y-auto custom-scrollbar flex-1">
          {loading ? (
            <div className="py-20 flex flex-col items-center justify-center gap-3">
              <div className={`w-8 h-8 border-2 border-t-transparent rounded-full animate-spin ${colors.text}`} style={{ borderColor: 'currentColor', borderTopColor: 'transparent' }} />
              <p className="text-xs text-gray-500 uppercase tracking-widest font-mono">{t('Querying cloud status...')}</p>
            </div>
          ) : !cloudJoined ? (
            /* Promo / Invitation UI */
            <div className="space-y-5 py-4">
              <div className={`relative rounded-2xl overflow-hidden p-6 border ${isLight ? 'bg-gradient-to-br from-violet-100/50 via-zinc-100/50 to-white border-violet-500/10' : 'bg-gradient-to-br from-purple-950/20 via-zinc-900/10 to-[#08080a] border-violet-500/20'}`}>
                <div className="absolute top-4 right-4 bg-violet-500/15 text-violet-400 text-[9px] font-black uppercase px-2.5 py-1 rounded-full border border-violet-500/30">
                  {t('Premium')}
                </div>
                
                <h3 className={`text-base font-bold mb-2 flex items-center gap-2 ${isLight ? 'text-gray-900' : 'text-white'}`}>
                  <Sparkles size={16} className="text-violet-400" />
                  {t('Save & Restore Anywhere')}
                </h3>
                <p className={`text-xs leading-relaxed mb-4 ${isLight ? 'text-gray-600' : 'text-gray-400'}`}>
                  {t('Never lose work. Sync your animations securely to our high-speed cloud cluster. Access projects instantly across tablets, phones, and computers on demand.')}
                </p>

                {/* Grid features */}
                <div className="grid grid-cols-2 gap-3 mb-2">
                  <div className={`p-3 rounded-lg border ${isLight ? 'bg-white/50 border-black/5' : 'bg-white/5 border-white/5'}`}>
                    <Database size={14} className="text-violet-400 mb-1" />
                    <p className={`text-[10px] font-bold uppercase tracking-wider ${isLight ? 'text-gray-700' : 'text-gray-300'}`}>{t('500 MB Limit')}</p>
                    <p className="text-[9px] text-gray-500">{t('Generous workspace backup allowance')}</p>
                  </div>
                  <div className={`p-3 rounded-lg border ${isLight ? 'bg-white/50 border-black/5' : 'bg-white/5 border-white/5'}`}>
                    <Layers size={14} className="text-violet-400 mb-1" />
                    <p className={`text-[10px] font-bold uppercase tracking-wider ${isLight ? 'text-gray-700' : 'text-gray-300'}`}>{t('50 MB Files')}</p>
                    <p className="text-[9px] text-gray-500">{t('Sync heavy layered multi-frame projects')}</p>
                  </div>
                </div>
              </div>

              {!isPremium ? (
                <div className="space-y-4">
                  {/* Access Restricted Alert */}
                  <div className="p-4 bg-red-500/10 border border-red-500/15 text-red-400 text-xs rounded-xl flex items-start gap-2.5 leading-normal">
                    <ShieldAlert size={16} className="shrink-0 text-red-500 mt-0.5" />
                    <div>
                      <span className="font-bold uppercase tracking-widest block mb-0.5 text-red-400">{t('Restricted')}</span>
                      <p className="text-[11px] text-gray-400 mt-1">
                        {t('Animato Premium Cloud Storage is reserved for Yearly subscribers. Please upgrade your plan to unlock Multi-Device Project Sync.')}
                      </p>
                    </div>
                  </div>

                  {errorMessage && (
                    <div className="p-3 bg-red-500/10 border border-red-500/15 text-red-400 text-[11px] rounded-lg">
                      {errorMessage}
                    </div>
                  )}

                  {!showUpgradeUI ? (
                    <button
                      onClick={() => setShowUpgradeUI(true)}
                      className="w-full py-3 bg-gradient-to-r from-yellow-500 to-amber-600 hover:from-yellow-400 hover:to-amber-500 text-black font-black text-xs uppercase tracking-widest rounded-xl transition-all active:scale-[0.98] shadow-lg flex items-center justify-center gap-2 cursor-pointer border-0"
                    >
                      <Star size={14} className="fill-current text-black animate-pulse" />
                      <span>{t('Get a Monthly/Yearly Subscription')}</span>
                      <ArrowRight size={14} />
                    </button>
                  ) : (
                    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-3 duration-300">
                      <div className="flex justify-between items-center bg-[#18181b]/30 p-3 rounded-lg border border-white/5">
                        <span className="text-[10px] font-black uppercase text-gray-400 tracking-wider">
                          {t('Select Subscription Plan')}
                        </span>
                        <button
                          onClick={() => setShowUpgradeUI(false)}
                          className="text-[9px] uppercase font-black text-gray-500 hover:text-white cursor-pointer bg-transparent border-0"
                        >
                          {t('Back')}
                        </button>
                      </div>

                      {paystackError && (
                        <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-xs">
                          {paystackError}
                        </div>
                      )}

                      <div className="grid grid-cols-2 gap-4">
                        {/* Monthly Plan */}
                        <div className="bg-white/2 border border-white/5 hover:border-cyan-500/40 rounded-xl p-4 flex flex-col justify-between hover:bg-white/4 transition-all group relative">
                          <div>
                            <div className="flex justify-between items-start mb-2">
                              <span className="text-[9px] text-cyan-400 uppercase tracking-widest font-black">{t('Flexible')}</span>
                            </div>
                            <h4 className="text-sm font-black text-white mb-0.5">{t('Monthly Plan')}</h4>
                            <div className="mb-3">
                              <span className="text-lg font-black text-white">₦{getScaledPrice(1500, countryCode).toLocaleString()}</span>
                              <span className="text-[10px] text-gray-500 ml-1">/ {t('month')}</span>
                            </div>
                          </div>
                          <button
                            disabled={paystackLoading}
                            onClick={() => handleSubscriptionPay('monthly')}
                            className="w-full py-2 bg-white/5 hover:bg-cyan-500 hover:text-black border border-white/10 hover:border-cyan-400 font-bold text-[10px] uppercase tracking-wider rounded-lg transition-all cursor-pointer flex items-center justify-center gap-1"
                          >
                            <span>{paystackLoading ? t('Starting...') : t('Unlock Monthly')}</span>
                          </button>
                        </div>

                        {/* Yearly Plan */}
                        <div className="bg-gradient-to-b from-yellow-500/5 to-transparent border border-yellow-500/20 rounded-xl p-4 flex flex-col justify-between hover:border-yellow-400/40 transition-all group relative overflow-hidden">
                          <div className="absolute top-0 right-0 bg-yellow-500 text-black text-[7px] font-black tracking-widest uppercase py-0.5 px-2 rounded-bl-lg">
                            {t('RECOMMENDED')}
                          </div>
                          <div>
                            <div className="flex justify-between items-start mb-2">
                              <span className="text-[9px] text-yellow-500 uppercase tracking-widest font-black">{t('Save Over 40%')}</span>
                            </div>
                            <h4 className="text-sm font-black text-white mb-0.5">{t('Yearly Plan')}</h4>
                            <div className="mb-3">
                              <span className="text-lg font-black text-white">₦{getScaledPrice(10500, countryCode).toLocaleString()}</span>
                              <span className="text-[10px] text-gray-500 ml-1">/ {t('year')}</span>
                            </div>
                          </div>
                          <button
                            disabled={paystackLoading}
                            onClick={() => handleSubscriptionPay('yearly')}
                            className="w-full py-2 bg-yellow-500 hover:bg-yellow-400 text-black font-bold text-[10px] uppercase tracking-wider rounded-lg transition-all cursor-pointer flex items-center justify-center gap-1 border-0"
                          >
                            <span>{paystackLoading ? t('Starting...') : t('Unlock Yearly')}</span>
                          </button>
                        </div>
                      </div>
                      <p className="text-[9px] text-gray-500 text-center uppercase tracking-wider mt-1">
                        🔒 {t('Secured via Paystack • Cloud features unlock instantly')}
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                /* Join action */
                <button
                  onClick={handleJoinCloud}
                  className={`w-full py-3.5 ${colors.buttonActiveBg} hover:${colors.buttonActiveHover} ${colors.buttonActiveText} font-black text-xs uppercase tracking-widest rounded-xl transition-all shadow-xl flex items-center justify-center gap-2 cursor-pointer`}
                >
                  <Cloud size={14} />
                  {t('Join Premium Cloud Connection')}
                </button>
              )}
            </div>
          ) : (
            /* Active Cloud Storage UI */
            <div className="space-y-5">
              {subView === 'menu' && (
                <div className="space-y-6 py-4 animate-in fade-in duration-300">
                  {/* Storage indicator */}
                  <div className={`border rounded-2xl p-4.5 space-y-3.5 ${isLight ? 'bg-gray-50 border-black/10' : 'bg-[#121214] border-white/10'}`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <HardDrive size={14} className={`${colors.text}`} />
                        <span className={`text-xs font-bold uppercase tracking-wider ${isLight ? 'text-gray-700' : 'text-gray-300'}`}>{t('Cloud Storage Quota')}</span>
                      </div>
                      <span className={`text-[10px] font-mono ${isLight ? 'text-gray-600' : 'text-gray-400'}`}>
                        {formatSize(totalUsedBytes)} / <span className={`font-bold ${isLight ? 'text-gray-900' : 'text-white'}`}>{formatSize(MAX_STORAGE_BYTES)}</span>
                      </span>
                    </div>

                    {/* Progress bar */}
                    <div className={`w-full h-2.5 rounded-full overflow-hidden border ${isLight ? 'bg-black/5 border-black/5' : 'bg-white/5 border-white/5'}`}>
                      <div 
                        className={`h-full rounded-full transition-all duration-500 ${storagePercentage > 85 ? 'bg-red-500' : storagePercentage > 60 ? 'bg-yellow-500' : colors.pulseGlow}`}
                        style={{ width: `${storagePercentage}%` }}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4">
                    {/* UPLOAD BUTTON */}
                    <button
                      onClick={() => setSubView('upload')}
                      className={`group p-5 rounded-2xl border text-left transition-all ${isLight ? 'bg-white border-black/10 hover:border-violet-500/50 hover:bg-violet-50/10' : 'bg-gradient-to-r from-violet-950/20 to-[#121214] border-white/10 hover:border-violet-500/40 hover:bg-violet-900/10'} cursor-pointer`}
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-xl bg-violet-500/10 flex items-center justify-center border border-violet-500/20 text-violet-400 group-hover:scale-105 transition-transform duration-300">
                          <UploadCloud size={24} className="animate-pulse" />
                        </div>
                        <div className="flex-1">
                          <h4 className="text-sm font-black text-white group-hover:text-violet-400 transition-colors uppercase tracking-wider">{t('Upload Projects')}</h4>
                          <p className="text-gray-500 text-[10px] mt-1 leading-normal uppercase font-mono">{t('Backup local device projects to the Cloud')}</p>
                        </div>
                      </div>
                    </button>

                    {/* LOAD BUTTON */}
                    <button
                      onClick={() => setSubView('load')}
                      className={`group p-5 rounded-2xl border text-left transition-all ${isLight ? 'bg-white border-black/10 hover:border-cyan-500/50 hover:bg-cyan-50/10' : 'bg-gradient-to-r from-cyan-950/20 to-[#121214] border-white/10 hover:border-cyan-500/40 hover:bg-cyan-900/10'} cursor-pointer`}
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-xl bg-cyan-500/10 flex items-center justify-center border border-cyan-500/20 text-cyan-400 group-hover:scale-105 transition-transform duration-300">
                          <Cloud size={24} className="animate-pulse" />
                        </div>
                        <div className="flex-1">
                          <h4 className="text-sm font-black text-white group-hover:text-cyan-400 transition-colors uppercase tracking-wider">{t('Load Backups')}</h4>
                          <p className="text-gray-500 text-[10px] mt-1 leading-normal uppercase font-mono">{t('Restore synced projects to local browser')}</p>
                        </div>
                      </div>
                    </button>
                  </div>
                </div>
              )}

              {subView === 'upload' && (
                <div className="space-y-4 animate-in fade-in duration-300">
                  <div className="flex items-center justify-between pb-2 border-b border-white/5">
                    <button
                      onClick={() => setSubView('menu')}
                      className="text-[10px] uppercase font-black tracking-wider text-gray-500 hover:text-white flex items-center gap-1 cursor-pointer bg-transparent border-0"
                    >
                      &larr; {t('Back to Menu')}
                    </button>
                    <span className="text-[10px] font-mono text-violet-400 uppercase tracking-widest">{t('Upload Workspace')}</span>
                  </div>

                  {/* Feedback Notifications */}
                  {errorMessage && (
                    <div className="p-3 bg-red-500/10 border border-red-500/15 text-red-400 text-[11px] rounded-lg">
                      {errorMessage}
                    </div>
                  )}
                  {successMessage && (
                    <div className={`p-3 ${colors.bg} border ${colors.border} ${colors.text} text-[11px] font-semibold rounded-lg flex items-center gap-2`}>
                      <Check size={14} />
                      {successMessage}
                    </div>
                  )}

                  {/* Local Browser Projects Checklist */}
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <h3 className="text-[10px] font-black text-gray-500 uppercase tracking-widest">
                        {t('Select Projects to Backup')} ({savedProjects.length})
                      </h3>
                      {savedProjects.length > 0 && (
                        <button
                          onClick={handleSelectAllToBackup}
                          className={`text-[9px] font-black uppercase tracking-widest cursor-pointer px-2 py-1 rounded-md transition-colors ${selectedToBackup.size === savedProjects.length ? 'text-violet-400 bg-violet-400/10' : 'text-gray-500 hover:bg-white/5'}`}
                        >
                          {selectedToBackup.size === savedProjects.length ? t('Deselect All') : t('Select All')}
                        </button>
                      )}
                    </div>

                    {savedProjects.length === 0 ? (
                      <div className={`p-8 border rounded-xl text-center text-[10px] text-gray-500 uppercase ${isLight ? 'bg-gray-50/50 border-black/5' : 'bg-white/5 border-white/5'}`}>
                        {t('No local projects found on this device.')}
                      </div>
                    ) : (
                      <div className="space-y-2 max-h-[250px] overflow-y-auto custom-scrollbar pr-1 border border-white/5 rounded-xl p-2.5 bg-black/20">
                        {savedProjects.map(proj => {
                          const isSelected = selectedToBackup.has(proj.id);
                          return (
                            <div
                              key={proj.id}
                              onClick={() => toggleProjectSelection(proj.id)}
                              className={`flex items-center gap-3 p-2.5 rounded-lg cursor-pointer border transition-colors ${isSelected ? (isLight ? 'bg-violet-50 border-violet-200' : 'bg-violet-500/10 border-violet-500/30') : (isLight ? 'bg-white border-black/5 hover:bg-gray-50' : 'bg-[#18181b] border-white/5 hover:bg-white/5')} `}
                            >
                              <div className={`w-4 h-4 rounded-sm flex items-center justify-center shrink-0 border ${isSelected ? 'bg-violet-500 border-violet-500' : 'border-gray-500'}`}>
                                {isSelected && <Check size={12} className="text-white" />}
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className={`text-[11px] font-bold truncate ${isLight ? 'text-gray-900' : 'text-white'}`}>{proj.name}</p>
                                <p className="text-[9px] text-gray-500 font-mono mt-0.5">{new Date(proj.lastModified || Date.now()).toLocaleDateString()}</p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Sync Actions */}
                  <div className="flex gap-2.5 pt-2">
                    <button
                      onClick={() => triggerAutoSync()}
                      disabled={syncing || totalUsedBytes >= MAX_STORAGE_BYTES || selectedToBackup.size === 0}
                      className={`flex-1 py-3 ${colors.buttonActiveBg} ${colors.buttonActiveHover} ${colors.buttonActiveText} active:scale-98 font-bold text-xs uppercase tracking-widest rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed`}
                    >
                      {syncing ? (
                        <>
                          <RefreshCw size={14} className="animate-spin" />
                          {t('Syncing...')}
                        </>
                      ) : (
                        <>
                          <UploadCloud size={14} />
                          {t('Backup Storage Now')}
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}

              {subView === 'load' && (
                <div className="space-y-4 animate-in fade-in duration-300">
                  <div className="flex items-center justify-between pb-2 border-b border-white/5">
                    <button
                      onClick={() => setSubView('menu')}
                      className="text-[10px] uppercase font-black tracking-wider text-gray-500 hover:text-white flex items-center gap-1 cursor-pointer bg-transparent border-0"
                    >
                      &larr; {t('Back to Menu')}
                    </button>
                    <span className="text-[10px] font-mono text-cyan-400 uppercase tracking-widest">{t('Load Synced')}</span>
                  </div>

                  {/* Feedback Notifications */}
                  {errorMessage && (
                    <div className="p-3 bg-red-500/10 border border-red-500/15 text-red-400 text-[11px] rounded-lg">
                      {errorMessage}
                    </div>
                  )}
                  {successMessage && (
                    <div className={`p-3 ${colors.bg} border ${colors.border} ${colors.text} text-[11px] font-semibold rounded-lg flex items-center gap-2`}>
                      <Check size={14} />
                      {successMessage}
                    </div>
                  )}

                  {/* Cloud Saved Item List */}
                  <div className="space-y-3">
                    <h3 className="text-[10px] font-black text-gray-500 uppercase tracking-widest">{t('Backed Up Projects')} ({cloudProjects.length})</h3>
                    
                    {cloudProjects.length === 0 ? (
                      <div className={`border rounded-xl py-12 text-center text-xs text-gray-500 ${isLight ? 'bg-gray-50/50 border-black/5' : 'border-white/5 bg-white/2'}`}>
                        {t('No backups synced to cloud yet.')}
                      </div>
                    ) : (
                      <div className="space-y-2 max-h-[250px] overflow-y-auto custom-scrollbar pr-1">
                        {cloudProjects.map((proj) => (
                          <div 
                            key={proj.id}
                            className={`border rounded-xl p-3 flex justify-between items-center transition-all ${isLight ? 'bg-white border-black/5 hover:bg-gray-50' : 'bg-white/5 border-white/5 hover:bg-white/8'}`}
                          >
                            <div className="min-w-0 pr-4">
                              <p className={`text-xs font-bold truncate ${isLight ? 'text-gray-900' : 'text-white'}`}>{proj.name}</p>
                              <div className="flex items-center gap-2 text-[9px] text-gray-500 font-mono mt-0.5">
                                <span className="uppercase tracking-wide">{formatSize(proj.size_bytes)}</span>
                                <span>&bull;</span>
                                <span>{new Date(proj.updated_at).toLocaleDateString()}</span>
                              </div>
                            </div>
                            <div className="flex gap-1.5 items-center shrink-0">
                              <button
                                onClick={() => handleLoadIndividualProject(proj)}
                                className={`px-2.5 py-1.5 ${colors.bg} ${colors.hoverBg} ${colors.text} rounded-lg transition-all text-[10px] font-black uppercase tracking-wider flex items-center gap-1 cursor-pointer border ${colors.border}`}
                                title={t('Load project to Browser')}
                              >
                                <RefreshCw size={11} />
                                <span>{t('Load')}</span>
                              </button>
                              <button
                                onClick={() => handleDeleteCloudProject(proj.id, proj.name)}
                                className="p-1.5 bg-red-500/10 hover:bg-red-500 hover:text-white text-red-500 rounded-lg transition-all cursor-pointer border-0"
                                title={t('Delete backup')}
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer info banner */}
        <div className={`p-4 border-t text-center text-[10px] text-gray-500 leading-normal font-mono shrink-0 ${isLight ? 'bg-gray-50 border-black/5' : 'bg-[#09090b] border-white/5'}`}>
          PRO CONSOLE ACTIVE • USER CLOUD CONTAINER ASYNC
        </div>

        {/* Loading overlay for Cloud Project load */}
        <AnimatePresence>
          {loadingProject !== null && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-x-0 bottom-0 top-[1px] bg-black/90 backdrop-blur-md flex flex-col items-center justify-center p-6 z-[130] rounded-2xl"
            >
              <div className="w-full max-w-xs space-y-5 text-center">
                {/* Visual Accent Icon */}
                <div className="relative mx-auto w-16 h-16 bg-violet-500/10 rounded-2xl flex items-center justify-center border border-violet-500/20 text-violet-400">
                  <Cloud size={28} className="animate-bounce" />
                  <div className="absolute inset-0 rounded-2xl border border-violet-500/40 animate-ping opacity-25" />
                </div>

                <div className="space-y-1.5 font-sans">
                  <h3 className="text-white text-sm font-black uppercase tracking-widest">
                    {t('Loading Project')}
                  </h3>
                  <p className="text-gray-400 text-xs truncate max-w-full font-bold px-4">
                    "{loadingProject}"
                  </p>
                </div>

                {/* Progress Indicators */}
                <div className="space-y-2">
                  <div className="flex justify-between items-center text-[10px] uppercase font-bold tracking-wider text-gray-400">
                    <span className="font-mono text-gray-500">{t('Syncing Node')}</span>
                    <span className="text-[#00e5ff] font-mono">{loadProgress}%</span>
                  </div>
                  
                  {/* Outer track */}
                  <div className="w-full h-2 rounded-full overflow-hidden border border-white/5 relative">
                    {/* Progress Fill */}
                    <div 
                      className="h-full bg-gradient-to-r from-violet-500 to-cyan-400 rounded-full transition-all duration-300"
                      style={{ width: `${loadProgress}%` }}
                    />
                  </div>
                  
                  <p className="text-[9px] text-gray-500 uppercase tracking-widest font-mono">
                    {t('Sourcing cloud repository segments...')}
                  </p>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
};
