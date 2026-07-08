
import React, { useRef, useState, useEffect } from 'react';
import { useLanguage } from '../utils/LanguageContext';
import { Plus, FolderOpen, Activity, Search, Clock, Trash2, LayoutGrid, List as ListIcon, HardDrive, Edit2, Download, MoreVertical, X, Check, UserCog, Film, PenTool, Monitor, Smartphone, Square as SquareIcon, Frame, Instagram, Clapperboard, MonitorSmartphone, Youtube, Lock, ChevronDown, Bug, MessageSquare, Send, Globe, User, Copy, Palette, RefreshCw, ShoppingCart, Star, Cloud, Gamepad2 } from 'lucide-react';

import { motion, AnimatePresence } from 'motion/react';
import { ProjectMetadata, StorageUtils, FrameSettings } from '../utils/storage';
import { triggerDownload } from '../utils/downloadHelper';
import { ProjectType } from '../types';
import { showAppToast } from '../utils/toastHelper';
import * as backend from '../utils/backend';
import { Logo } from './Logo';
import { AnimatedBackground, THEME_OPTIONS, ThemeType } from './AnimatedBackground';
import { Store } from './Store';
import { AdminPanel } from './AdminPanel';
import { CreatorProgramModal } from './CreatorProgramModal';
import { AccountSecurityModal } from './AccountSecurityModal';
import { CloudStorageModal } from './CloudStorageModal';
import { CompetitionTutorialModal } from './CompetitionTutorialModal';
import { Trophy } from 'lucide-react';
import { getThemeColors } from '../utils/themeColors';

interface ProjectManagerProps {
  user: any;
  onNewProject: (type: ProjectType, settings?: FrameSettings & { name: string }) => void;
  onOpenProject: (file: File) => void;
  onLoadSavedProject: (id: string) => void;
  savedProjects: ProjectMetadata[];
  onDeleteProject: (id: string) => void;
  onDuplicateProject: (id: string) => void;
  onRenameProject: (id: string, newName: string) => void;
  onSignOut?: () => void;
  activeTheme: ThemeType;
  onThemeChange: (themeId: ThemeType) => void;
  onUserUpdate?: (updatedUser: any) => void;
  onRefreshProjects?: () => void;
  onImportToExistingProject?: (projectId: string, importedData: any) => Promise<void>;
}

// Helper for countdown
const SubscriptionCountdown = ({ expiry }: { expiry: number }) => {
    const [timeLeft, setTimeLeft] = useState(Math.max(0, expiry - Date.now()));
    
    useEffect(() => {
        const interval = setInterval(() => {
            setTimeLeft(Math.max(0, expiry - Date.now()));
        }, 1000);
        return () => clearInterval(interval);
    }, [expiry]);

    const formatTime = (ms: number) => {
        const seconds = Math.floor((ms / 1000) % 60);
        const minutes = Math.floor((ms / 1000 / 60) % 60);
        const hours = Math.floor((ms / (1000 * 60 * 60)) % 24);
        const days = Math.floor(ms / (1000 * 60 * 60 * 24));
        
        if (days > 0) return `${days}d ${hours}h ${minutes}m ${seconds}s`;
        return `${hours}h ${minutes}m ${seconds}s`;
    };

    if (timeLeft <= 0) return <p className="text-xs text-red-400 font-mono">Expired</p>;

    const isUrgent = timeLeft < 24 * 60 * 60 * 1000;

    return (
        <div className={isUrgent ? "text-red-400 font-bold" : "text-gray-300"}>
            <p className="text-xs font-mono">{formatTime(timeLeft)}</p>
        </div>
    );
};

export const ProjectManager: React.FC<ProjectManagerProps> = ({ 
    user,
    onNewProject, 
    onOpenProject, 
    onLoadSavedProject,
    savedProjects,
    onDeleteProject,
    onDuplicateProject,
    onRenameProject,
    onSignOut,
    activeTheme,
    onThemeChange,
    onUserUpdate,
    onRefreshProjects,
    onImportToExistingProject
}) => {
  const { t, language, setLanguage } = useLanguage();
  const colors = getThemeColors(activeTheme);
  const [showLanguageMenu, setShowLanguageMenu] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [showCreatorProgram, setShowCreatorProgram] = useState(false);
  const [showSecurityModal, setShowSecurityModal] = useState(false);
  const [showCloudStorageModal, setShowCloudStorageModal] = useState(false);
  const [showThemeMenu, setShowThemeMenu] = useState(false);
  const [showCommunityModal, setShowCommunityModal] = useState(false);
  const [activeCommunityTab, setActiveCommunityTab] = useState<'competition' | 'tutorial'>('competition');

  const [appVersion, setAppVersion] = useState(() => localStorage.getItem('app_version') || 'v1.0.4');
  const [hasNewBadge, setHasNewBadge] = useState(() => localStorage.getItem('pwa_app_updated') === 'true');

  useEffect(() => {
    const handlePwaUpdate = () => {
      setAppVersion('v1.0.5');
      setHasNewBadge(true);
    };
    window.addEventListener('pwa-app-updated', handlePwaUpdate);
    return () => window.removeEventListener('pwa-app-updated', handlePwaUpdate);
  }, []);

  // Premium Cloud Restore states
  const [showCloudPrompt, setShowCloudPrompt] = useState(false);
  const [checkingCloudTag, setCheckingCloudTag] = useState(false);
  const [loadingCloudBackup, setLoadingCloudBackup] = useState(false);

  useEffect(() => {
    const checkCloudTagStatus = async () => {
      const normalizedEmail = user?.email?.toLowerCase().trim();
      if (!normalizedEmail) return;
      const isPremium = user?.subscription_status === 'active' && ['yearly', 'monthly', 'pro', 'premium', 'studio'].includes((user?.subscription_type || '').trim().toLowerCase());
      if (!isPremium) return;

      // Check if yearly user has already manually joined cloud, cache status locally
      const storedJoin = localStorage.getItem(`user_cloud_joined_${normalizedEmail}`);
      let isJoined = storedJoin === 'true';
      if (!isJoined) {
        const hasDbTag = await backend.hasCloudTag(normalizedEmail);
        if (hasDbTag) {
          localStorage.setItem(`user_cloud_joined_${normalizedEmail}`, 'true');
          isJoined = true;
        }
      }

      setCheckingCloudTag(true);
      try {
        const cloudProjects = await backend.getCloudProjects(normalizedEmail);
        const realProjects = cloudProjects.filter(p => !p.id.startsWith('cloud_tag_') && p.name !== '__CLOUD_TAG__');
        if (realProjects.length > 0) {
          // Keep user_cloud_joined locally active since they have synced/joined on the cloud!
          localStorage.setItem(`user_cloud_joined_${normalizedEmail}`, 'true');
          isJoined = true;

          // Only show the compact recovery UI when the user is signing in on a new device through the intro sign in
          const justSignedIn = sessionStorage.getItem('just_signed_in_session') === 'true';
          if (justSignedIn) {
            const dismissed = localStorage.getItem(`cloud_prompt_dismissed_${normalizedEmail}`) === 'true';
            const alreadyDismissedSession = sessionStorage.getItem(`cloud_prompt_session_dismissed_${normalizedEmail}`) === 'true';
            if (!dismissed && !alreadyDismissedSession) {
              setShowCloudPrompt(true);
            }
          }
        }
      } catch (err) {
        console.error("Error verifying cloud status:", err);
      } finally {
        setCheckingCloudTag(false);
      }
    };
    checkCloudTagStatus();
  }, [user?.email]);

  const handlePopulateCloudBackup = async () => {
    const normalizedEmail = user?.email?.toLowerCase().trim();
    if (!normalizedEmail) return;
    setLoadingCloudBackup(true);
    try {
      const cloudProjects = await backend.getCloudProjects(normalizedEmail);
      // Filter out meta tag rows
      const realProjects = cloudProjects.filter(p => !p.id.startsWith('cloud_tag_') && p.name !== '__CLOUD_TAG__');
      
      let loadedCount = 0;
      for (const cp of realProjects) {
        let projectData = cp.project_data;
        if (!projectData && cp.dropbox) {
          projectData = await backend.loadCloudProjectDropbox(cp.dropbox);
        } else if (!projectData && cp.filebase) {
          projectData = await backend.loadCloudProjectFilebase(normalizedEmail, cp.id, cp.filebase);
        } else if (!projectData && cp.chunks) {
          projectData = await backend.loadCloudProjectChunks(cp.id, cp.chunks);
        }
        if (projectData) {
          const fullProjectData = {
            ...projectData,
            id: cp.id,
            name: cp.name,
            lastModified: projectData.lastModified || new Date(cp.updated_at).getTime(),
            version: projectData.version || "1.0.0",
          };
          await StorageUtils.saveProject(fullProjectData);
          loadedCount++;
        }
      }

      triggerLocalToast(`${t('Successfully loaded')} ${loadedCount} ${t('projects from the cloud!')}`);
      setShowCloudPrompt(false);
      localStorage.setItem(`cloud_prompt_dismissed_${normalizedEmail}`, 'true');
      onRefreshProjects?.();
    } catch (err: any) {
      console.error("Failed to load cloud backups", err);
      triggerLocalToast(t('Failed to load cloud backup projects.'));
    } finally {
      setLoadingCloudBackup(false);
    }
  };

  const handleCancelCloudPrompt = () => {
    const normalizedEmail = user?.email?.toLowerCase().trim();
    if (!normalizedEmail) return;
    setShowCloudPrompt(false);
    localStorage.setItem(`cloud_prompt_dismissed_${normalizedEmail}`, 'true');
    sessionStorage.setItem(`cloud_prompt_session_dismissed_${normalizedEmail}`, 'true');
  };

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveCommunityTab(prev => prev === 'competition' ? 'tutorial' : 'competition');
    }, 7000);
    return () => clearInterval(interval);
  }, []);
  
  const handleThemeChange = (themeId: ThemeType) => {
      onThemeChange(themeId);
      setShowThemeMenu(false);
  };

  const LANGUAGES_LIST = [
    "English", "Mandarin (Chinese)", "Spanish", "Hindi", "Arabic", 
    "Bengali", "Portuguese", "Russian", "Japanese", "French", 
    "German", "Urdu", "Korean", "Italian", "Turkish"
  ];

  const [localToast, setLocalToast] = useState<string | null>(null);
  const triggerLocalToast = (msg: string) => {
      setLocalToast(msg);
      setTimeout(() => setLocalToast(null), 3000);
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [viewMode, setViewMode] = useState<'GRID' | 'LIST'>('GRID');
  const [searchQuery, setSearchQuery] = useState('');
  
  // Modal State
  const [setupStage, setSetupStage] = useState<'NONE' | 'TYPE_SELECT' | 'FRAME_SETUP' | 'CHARACTER_SETUP' | 'BUG_REPORT' | 'STORE'>(() => {
    return window.location.pathname.includes('/store-payment') ? 'STORE' : 'NONE';
  });
  const [selecting, setSelecting] = useState<'NONE' | 'CHARACTER' | 'FRAME' | 'GAME'>('NONE');

  const [bugDescription, setBugDescription] = useState('');
  const [isSendingBug, setIsSendingBug] = useState(false);
  const [bugSubmitSuccess, setBugSubmitSuccess] = useState(false);

  const [logoTaps, setLogoTaps] = useState(0);
  const [proTaps, setProTaps] = useState(0);
  const [profileTaps, setProfileTaps] = useState(0);
  const [showAdminBugs, setShowAdminBugs] = useState(false);
  const [adminBugs, setAdminBugs] = useState<any[]>([]);

  const [adminDBTaps, setAdminDBTaps] = useState(0);
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [showAdminPwdPrompt, setShowAdminPwdPrompt] = useState(false);
  const [adminPwdInput, setAdminPwdInput] = useState('');
  const [isCheckingUpdates, setIsCheckingUpdates] = useState(false);

  useEffect(() => {
    // Legacy auto-activation removed.
  }, [user?.email, user?.subscription_status]);

  const handleLogoTap = () => {
    setLogoTaps(prev => {
      const newCount = prev + 1;
      if (newCount >= 3) {
        setShowAdminPwdPrompt(true);
        return 0;
      }
      return newCount;
    });
    setTimeout(() => setLogoTaps(0), 1500);
  };

  const handleProTap = () => {
    setProTaps(prev => {
        const next = prev + 1;
        if (next >= 3) {
            const expiry = new Date(Date.now() - 1000 * 60 * 60).toISOString(); // 1 hour ago
            const updatedUser = { 
                ...user, 
                subscription_expiry: expiry,
                subscription_status: 'expired' 
            };
            localStorage.setItem('app_user', JSON.stringify(updatedUser));
            localStorage.setItem('debug_force_expiry', 'true');
            window.location.reload();
            return 0;
        }
        return next;
    });
    // Reset count if not tapped within 2 seconds
    setTimeout(() => setProTaps(0), 2000);
  };

  const handleProfileTap = () => {
    setProfileTaps(prev => {
        const next = prev + 1;
        if (next >= 3) {
            localStorage.clear(); // COMPREHENSIVE RESET
            window.location.reload();
            return 0;
        }
        return next;
    });
    // Reset count if not tapped within 2 seconds
    setTimeout(() => setProfileTaps(0), 4000); // Give more time for the 3 taps
  };

  const fetchAdminBugs = async () => {
    try {
      const data = await backend.getBugs();
      setAdminBugs(data);
      setShowAdminBugs(true);
    } catch (err) {
      console.error("Failed to fetch bugs", err);
      const existingBugs = JSON.parse(localStorage.getItem('user_bugs') || '[]');
      setAdminBugs(existingBugs);
      setShowAdminBugs(true);
    }
  };

  const handleDeleteBug = async (id: number) => {
    try {
      await backend.deleteBug(id);
      setAdminBugs(prev => prev.filter(bug => bug.id !== id));
    } catch (err) {
      console.error("Failed to delete bug", err);
      const existingBugs = JSON.parse(localStorage.getItem('user_bugs') || '[]');
      const updatedBugs = existingBugs.filter((b: any) => b.id !== id);
      localStorage.setItem('user_bugs', JSON.stringify(updatedBugs));
      setAdminBugs(updatedBugs);
    }
  };

  const handleSendBug = async () => {
    if (!bugDescription.trim()) return;
    setIsSendingBug(true);
    
    try {
      const email = "egeluotechnologies@gmail.com";
      const subject = encodeURIComponent("Animato Studio Bug Report");
      const body = encodeURIComponent(`Bug Description:\n${bugDescription}\n\nEnvironment:\n${navigator.userAgent}`);
      
      const mailtoLink = `mailto:${email}?subject=${subject}&body=${body}`;
      
      try {
        const iframe = document.createElement('iframe');
        iframe.style.display = 'none';
        iframe.src = mailtoLink;
        document.body.appendChild(iframe);
        setTimeout(() => {
          document.body.removeChild(iframe);
        }, 1000);
      } catch (e) {
        window.location.href = mailtoLink;
      }

      setBugSubmitSuccess(true);
      setTimeout(() => {
        setBugSubmitSuccess(false);
        setBugDescription('');
        setSetupStage('NONE');
      }, 2500);
    } catch (e) {
      console.error("Failed to send bug report:", e);
    } finally {
      setIsSendingBug(false);
    }
  };

  const handleWorkflowSelect = (type: 'CHARACTER' | 'FRAME' | 'GAME') => {
      setSelecting(type);
      setTimeout(() => {
          if (type === 'CHARACTER') {
              setSetupStage('CHARACTER_SETUP');
          } else if (type === 'FRAME') {
              setSetupStage('FRAME_SETUP');
          } else if (type === 'GAME') {
              onNewProject('GAME', { name: newProjectName || "Untitled Game" } as any);
              setSetupStage('NONE');
          }
          setSelecting('NONE');
      }, 350);
  };
  
  // Frame Project Setup State
  const [newProjectName, setNewProjectName] = useState('New Animation');
  const [selectedFps, setSelectedFps] = useState(12);
  const [selectedRatio, setSelectedRatio] = useState('16:9');

  const FRAME_ASPECT_RATIOS = [
      { label: "16:9", value: "16:9", desc: "YouTube", icon: Youtube },
      { label: "9:16", value: "9:16", desc: "TikTok", icon: Smartphone },
      { label: "1:1", value: "1:1", desc: "Instagram", icon: SquareIcon },
      { label: "4:3", value: "4:3", desc: "Classic", icon: Monitor },
  ];

  // Interaction State
  const [editingId, setEditingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onOpenProject(file);
    }
    if (e.target) e.target.value = ''; 
  };

  const createCharacterProject = () => {
      onNewProject('CHARACTER', { name: newProjectName || "Untitled Animation", aspectRatio: selectedRatio.replace(':', '/') } as any);
      setSetupStage('NONE');
  };

  const startRename = (project: ProjectMetadata) => {
      setEditingId(project.id);
      setRenameValue(project.name);
      setConfirmDeleteId(null);
  };

  const saveRename = (id: string) => {
      if (renameValue.trim()) {
          onRenameProject(id, renameValue.trim());
      }
      setEditingId(null);
  };

  const handleExport = async (project: ProjectMetadata) => {
      const fullData = await StorageUtils.loadProject(project.id);
      if (!fullData) {
          showAppToast("Could not load project data.");
          return;
      }
      const filename = `${project.name.trim()}.animato_project`;
      const blob = new Blob([JSON.stringify(fullData, null, 2)], { type: 'application/json' });
      
      triggerLocalToast("DOWNLOADING...");
      await triggerDownload(blob, filename);
      
      setTimeout(() => {
          triggerLocalToast("PROJECT SAVED TO DEVICE: DOWNLOADS FOLDER");
      }, 2000);
  };

  const createFrameProject = () => {
      let width = 1920;
      let height = 1080;
      
      if (selectedRatio === '9:16') {
          width = 1080;
          height = 1920;
      } else if (selectedRatio === '1:1') {
          width = 1080;
          height = 1080;
      } else if (selectedRatio === '4:3') {
          width = 1440;
          height = 1080;
      }

      const settings: FrameSettings & { name: string } = {
          name: newProjectName || "Untitled Animation",
          fps: selectedFps,
          width,
          height
      };
      
      onNewProject('FRAME', settings);
      setSetupStage('NONE');
  };

  const filteredProjects = savedProjects.filter(p => 
      p.name.toLowerCase().includes(searchQuery.toLowerCase())
  ).sort((a, b) => b.lastModified - a.lastModified);

  const formatDate = (ts: number) => {
      return new Date(ts).toLocaleDateString(undefined, { 
          month: 'short', day: 'numeric', year: 'numeric'
      });
  };

  return (
    <>
    <div 
        className="fixed inset-0 bg-[#09090b] flex flex-col md:flex-row text-gray-200 font-sans selection:bg-cyan-500/30 overflow-hidden animate-in fade-in duration-700 zoom-in-95"
        style={{ display: (setupStage === 'STORE' || setupStage.includes('SETUP')) ? 'none' : 'flex' }}
    >
      {/* AnimatedBackground is rendered at the App level now */}
      
      {/* SIDEBAR (Desktop) / HEADER (Mobile) */}
      <div className="w-full md:w-64 bg-[#111113] border-b md:border-b-0 md:border-r border-white/5 flex flex-col shrink-0 md:h-full z-20 shadow-xl">
          <div className="p-4 md:p-6 flex items-center justify-between md:justify-start gap-3 bg-[#111113]">
              <div className="flex items-center gap-3 w-full">
                  <div onClick={handleLogoTap} title={t('Tap 3 times for Admin panel')} className="flex items-center gap-2 cursor-pointer group">
                      <Logo size={32} showText={true} />
                      {user?.subscription_status === 'active' && (
                        <div 
                          onClick={(e) => { e.stopPropagation(); handleProTap(); }}
                          className="px-1.5 py-0.5 bg-gradient-to-r from-yellow-400 to-amber-600 rounded text-[8px] font-black text-black cursor-pointer select-none active:scale-90 transition-transform"
                        >PRO</div>
                      )}
                  </div>
              </div>
          </div>

          {/* DESKTOP ACTIONS (Hidden on Mobile) */}
          <div className="px-4 py-2 hidden md:block">
              <button 
                onClick={() => setSetupStage('TYPE_SELECT')}
                className="w-full flex items-center gap-3 px-4 py-3 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg shadow-lg shadow-cyan-900/20 transition-all font-semibold text-xs mb-6 group active:scale-95"
              >
                  <Plus size={16} className="group-hover:scale-110 transition-transform"/> 
                  <span>{t('New Project')}</span>
              </button>

              <div className="space-y-1">
                  <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider px-4 mb-2 flex items-center justify-between">
                    <span>{t('Workspace')}</span>
                  </div>
                  <button className="w-full flex items-center gap-3 px-4 py-2 bg-white/5 text-cyan-400 rounded-lg text-xs font-medium border border-cyan-500/10">
                      <LayoutGrid size={14}/> {t('Recent Projects')}
                  </button>
                  <button onClick={() => fileInputRef.current?.click()} className="w-full flex items-center gap-3 px-4 py-2 text-gray-400 hover:text-white hover:bg-white/5 rounded-lg text-xs font-medium transition-colors">
                      <FolderOpen size={14}/> {t('Open from Disk...')}
                  </button>
                  <button 
                    onClick={() => setSetupStage('BUG_REPORT')}
                    className="w-full flex items-center gap-3 px-4 py-2 text-red-400/70 hover:text-red-400 hover:bg-red-400/5 rounded-lg text-xs font-medium transition-colors"
                  >
                      <Bug size={14}/> {t('Report a Bug')}
                  </button>
                  <button 
                    onClick={() => setSetupStage('STORE')}
                    className="w-full flex items-center gap-3 px-4 py-2 text-purple-400/90 hover:text-purple-400 hover:bg-purple-400/10 rounded-lg text-xs font-medium transition-colors mt-2"
                  >
                      <ShoppingCart size={14}/> {t('Asset Store')}
                  </button>

                  {/* FADING COMMUNITY HUD WIDGET */}
                  <div className="mt-4 px-1">
                      <div className="text-[10px] font-bold text-gray-500 uppercase tracking-widest px-3 mb-2 flex items-center justify-between">
                        <span>{t('Community Lounge')}</span>
                        <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
                      </div>
                      <button 
                        onClick={() => setShowCommunityModal(true)}
                        className="w-full text-left bg-gradient-to-br from-white/[0.03] to-white/[0.01] hover:from-white/[0.06] hover:to-white/[0.02] border border-white/5 hover:border-cyan-500/20 rounded-xl p-3 transition-all relative overflow-hidden group active:scale-98"
                      >
                          <AnimatePresence mode="wait">
                              {activeCommunityTab === 'competition' ? (
                                  <motion.div 
                                    key="competition"
                                    initial={{ opacity: 0, y: 5 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -5 }}
                                    transition={{ duration: 0.3 }}
                                    className="flex items-start gap-2.5"
                                  >
                                      <div className="p-2 bg-amber-500/10 text-amber-400 rounded-lg border border-amber-500/15 shrink-0 group-hover:scale-110 transition-transform">
                                          <Trophy size={14} />
                                      </div>
                                      <div className="overflow-hidden">
                                          <p className="text-[11px] font-bold text-gray-200 tracking-wide flex items-center gap-1">
                                              <span>Active Contests</span>
                                              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-[ping_1.5s_infinite]" />
                                          </p>
                                          <p className="text-[9px] text-amber-400 font-bold tracking-tight mt-0.5 truncate">Win Cash Prizes!</p>
                                      </div>
                                  </motion.div>
                              ) : (
                                  <motion.div 
                                    key="tutorial"
                                    initial={{ opacity: 0, y: 5 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -5 }}
                                    transition={{ duration: 0.3 }}
                                    className="flex items-start gap-2.5"
                                  >
                                      <div className="p-2 bg-red-500/10 text-red-400 rounded-lg border border-red-500/15 shrink-0 group-hover:scale-110 transition-transform">
                                          <Youtube size={14} />
                                      </div>
                                      <div className="overflow-hidden">
                                          <p className="text-[11px] font-bold text-gray-200 tracking-wide">Video Tutorials</p>
                                          <p className="text-[9px] text-cyan-400 font-semibold tracking-tight mt-0.5 truncate">Learn Pro Animation</p>
                                      </div>
                                  </motion.div>
                              )}
                          </AnimatePresence>
                      </button>
                  </div>
              </div>
          </div>

          {/* MOBILE ACTIONS ROW (Visible on Mobile) */}
          <div className="px-4 pb-4 md:hidden flex flex-col gap-2">
              <div className="flex gap-2">
                    <button 
                        onClick={() => setSetupStage('TYPE_SELECT')}
                        className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg font-bold text-xs shadow-lg shadow-cyan-900/10 active:scale-95 transition-all"
                    >
                        <Plus size={14}/> {t('New Project')}
                    </button>
                    <button 
                        onClick={() => fileInputRef.current?.click()}
                        className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-[#18181b] border border-white/10 text-gray-300 hover:text-white rounded-lg font-bold text-xs active:scale-95 transition-all"
                    >
                        <FolderOpen size={14}/> {t('Open')}
                    </button>
              </div>
              <button 
                  onClick={() => setSetupStage('STORE')}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-purple-950/20 border border-purple-500/20 text-purple-400/90 hover:text-purple-400 hover:bg-purple-900/20 rounded-lg font-bold text-xs active:scale-95 transition-all"
              >
                  <ShoppingCart size={14}/> {t('Open Asset Store')}
              </button>
              
              {/* MOBILE COMMUNITY HUB WIDGET */}
              <button 
                   onClick={() => { setShowCommunityModal(true); }}
                   className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-[#111113] border border-[#8b5cf6]/20 hover:bg-[#0a0a0a] text-purple-300 hover:text-white rounded-lg font-bold text-xs active:scale-95 transition-all overflow-hidden relative"
              >
                  <AnimatePresence mode="wait">
                      {activeCommunityTab === 'competition' ? (
                          <motion.div key="comp" initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -3 }} className="flex items-center gap-1.5 justify-center">
                              <Trophy size={13} className="text-amber-400" />
                              <span>Explore Active Competitions</span>
                          </motion.div>
                      ) : (
                          <motion.div key="tut" initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -3 }} className="flex items-center gap-1.5 justify-center">
                              <Youtube size={13} className="text-red-450" />
                              <span>Watch Video Tutorials</span>
                          </motion.div>
                      )}
                  </AnimatePresence>
              </button>

              <button 
                  onClick={() => setSetupStage('BUG_REPORT')}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-red-950/20 border border-red-500/20 text-red-400/80 hover:text-red-400 hover:bg-red-900/20 rounded-lg font-bold text-xs active:scale-95 transition-all"
              >
                  <Bug size={14}/> {t('Report a Bug')}
              </button>
          </div>

          <input type="file" ref={fileInputRef} accept="*/*" className="hidden" onChange={handleFileChange} />

          <div className="mt-auto p-6 border-t border-white/5 hidden md:block">
              <div className="text-[10px] text-gray-600 font-mono mb-2">{t('STORAGE STATUS')}</div>
              <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden">
                  <div className="h-full bg-cyan-500/50 w-1/4"></div>
              </div>
              <p className="text-[10px] text-gray-500 mt-2">{t('Local Storage Active')}</p>
          </div>
      </div>

      {/* MAIN CONTENT AREA */}
      <div className="flex-1 flex flex-col min-w-0 bg-[#09090b] relative min-h-0">
          {/* Top Bar */}
          <div className="h-auto md:h-14 border-b border-white/5 flex flex-col md:flex-row items-center justify-between px-3 md:px-6 py-2 md:py-0 bg-[#09090b]/95  gap-2 shrink-0 z-10 sticky top-0">
              <div className="flex items-center gap-3 flex-1 w-full md:w-auto">
                  <div className="relative w-full md:max-w-md group">
                      <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 group-focus-within:text-cyan-500 transition-colors"/>
                      <input 
                        type="text" 
                        placeholder={t('Search projects...')} 
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full bg-[#18181b] border border-white/10 rounded-lg pl-9 pr-4 py-2 text-[11px] text-white focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50 outline-none transition-all placeholder-gray-600"
                      />
                  </div>
              </div>
              <div className="flex items-center justify-end w-auto gap-1 md:gap-1.5 md:border-l border-white/5 md:pl-4 md:ml-4">
                  <div className="relative mr-1 md:mr-2">
                      <button 
                        onClick={() => { setShowThemeMenu(!showThemeMenu); setShowLanguageMenu(false); setShowProfileMenu(false); }}
                        className="flex items-center gap-1.5 md:gap-2 px-2 md:px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-[10px] font-bold text-gray-400 hover:text-white transition-all"
                        title={t('Theme')}
                      >
                          <Palette size={14} className="text-cyan-500" />
                          <span className="hidden lg:inline">{t('Theme')}</span>
                      </button>
                      
                      <AnimatePresence>
                          {showThemeMenu && (
                              <motion.div 
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: 10 }}
                                className="absolute left-0 mt-2 w-36 md:w-48 bg-[#0a0a0a] border border-white/10 rounded-xl shadow-2xl py-2 z-[999] max-h-64 overflow-y-auto custom-scrollbar"
                              >
                                  {THEME_OPTIONS.map(theme => (
                                      <button 
                                        key={theme.id}
                                        onClick={() => handleThemeChange(theme.id)}
                                        className={`w-full text-left px-4 py-2 text-[11px] hover:bg-white/5 transition-colors ${activeTheme === theme.id ? 'text-cyan-400 bg-cyan-500/5 font-bold' : 'text-gray-400'}`}
                                      >
                                          {theme.name}
                                      </button>
                                  ))}
                              </motion.div>
                          )}
                      </AnimatePresence>
                  </div>

                  <div className="relative mr-1 md:mr-2">
                      <button 
                        onClick={() => { setShowLanguageMenu(!showLanguageMenu); setShowProfileMenu(false); setShowThemeMenu(false); }}
                        className="flex items-center gap-1.5 md:gap-2 px-2 md:px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-[10px] font-bold text-gray-400 hover:text-white transition-all"
                        title={t('Language')}
                      >
                          <Globe size={14} className="text-cyan-500" />
                          <span className="notranslate hidden lg:inline" translate="no">{language}</span>
                      </button>
                      
                      <AnimatePresence>
                          {showLanguageMenu && (
                              <motion.div 
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: 10 }}
                                className="absolute left-0 mt-2 w-40 md:w-48 bg-[#0a0a0a] border border-white/10 rounded-xl shadow-2xl py-2 z-[999] max-h-64 overflow-y-auto custom-scrollbar"
                              >
                                  {LANGUAGES_LIST.map(lang => (
                                      <button 
                                        key={lang}
                                        onClick={() => { setLanguage(lang); setShowLanguageMenu(false); }}
                                        className={`w-full text-left px-4 py-2 text-[11px] hover:bg-white/5 transition-colors notranslate ${language === lang ? 'text-cyan-400 bg-cyan-500/5' : 'text-gray-400'}`}
                                        translate="no"
                                      >
                                          {lang}
                                      </button>
                                  ))}
                              </motion.div>
                          )}
                      </AnimatePresence>
                  </div>

                  <div className="relative">
                      <button 
                        onClick={() => { setShowCloudStorageModal(true); setShowLanguageMenu(false); setShowThemeMenu(false); setShowProfileMenu(false); }}
                        className="flex items-center gap-1.5 p-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-gray-400 hover:text-white transition-all group"
                        title={t('Cloud Storage')}
                      >
                          <Cloud size={14} className={`${colors.accentIcon} transition-colors`} />
                          <span className={`w-1.5 h-1.5 ${colors.pulseGlow} rounded-full animate-pulse shrink-0`} />
                      </button>
                  </div>

                  <div className="relative">
                      <button 
                        onClick={() => { 
                          setShowProfileMenu(!showProfileMenu); 
                          setShowLanguageMenu(false); 
                          setShowThemeMenu(false); 
                          if (hasNewBadge) {
                            setHasNewBadge(false);
                            localStorage.removeItem('pwa_app_updated');
                          }
                        }}
                        className="flex items-center gap-2 p-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-gray-400 hover:text-white transition-all relative"
                        title={t('Profile')}
                      >
                          <User size={14} className="text-cyan-500" />
                          {hasNewBadge && (
                            <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-emerald-500 border border-[#09090b] rounded-full animate-pulse" />
                          )}
                      </button>
                  </div>
                  
                  <div className="w-px h-6 bg-white/10 mx-1 hidden md:block"></div>

                  <button onClick={() => setViewMode('GRID')} className={`p-1.5 rounded-lg transition-colors ${viewMode === 'GRID' ? 'text-cyan-400 bg-cyan-900/10' : 'text-gray-500 hover:text-white'}`}><LayoutGrid size={14}/></button>
                  <button onClick={() => setViewMode('LIST')} className={`p-1.5 rounded-lg transition-colors ${viewMode === 'LIST' ? 'text-cyan-400 bg-cyan-900/10' : 'text-gray-500 hover:text-white'}`}><ListIcon size={14}/></button>
              </div>
          </div>

          {/* SCROLLABLE CONTENT CONTAINER */}
          <div className="flex-1 overflow-y-auto custom-scrollbar p-4 md:p-8 relative">
              <div className="max-w-[1600px] mx-auto pb-32 md:pb-40">
                  <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2 hidden md:flex sticky top-0">
                      <Clock size={20} className="text-cyan-500"/> {t('Recent Projects')}
                  </h2>

                  {filteredProjects.length === 0 ? (
                      <div className="flex flex-col items-center justify-center h-64 border-2 border-dashed border-white/5 rounded-2xl bg-white/[0.02]">
                          <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mb-4">
                              <HardDrive size={24} className="text-gray-600"/>
                          </div>
                          <p className="text-gray-500 text-sm font-medium">{t('No projects found')}</p>
                          <button onClick={() => setSetupStage('TYPE_SELECT')} className="mt-4 text-cyan-500 hover:text-cyan-400 text-xs font-bold uppercase tracking-wider">{t('Create First Project')}</button>
                      </div>
                  ) : (
                      <div className={`grid gap-6 ${viewMode === 'GRID' ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5' : 'grid-cols-1'}`}>
                          {filteredProjects.map(project => (
                              <div 
                                key={project.id}
                                className={`group relative bg-[#18181b] border border-white/5 hover:border-cyan-500/30 rounded-xl overflow-hidden transition-all hover:shadow-2xl hover:shadow-black/50 hover:-translate-y-1 ${viewMode === 'LIST' ? 'flex items-center h-20 md:h-24' : 'flex flex-col h-full'}`}
                              >
                                  {/* THUMBNAIL AREA */}
                                  <div 
                                    className={`relative overflow-hidden cursor-pointer ${viewMode === 'GRID' ? 'aspect-video w-full border-b border-white/5 bg-black' : 'w-24 md:w-32 h-full border-r border-white/5 bg-black'}`}
                                    onClick={() => onLoadSavedProject(project.id)}
                                  >
                                      {project.thumbnail ? (
                                          <img src={project.thumbnail} className="w-full h-full object-contain opacity-60 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none select-none" />
                                      ) : (
                                          <div className="w-full h-full bg-gradient-to-br from-gray-800 to-black flex items-center justify-center pointer-events-none">
                                              <Activity className="text-gray-700"/>
                                          </div>
                                      )}
                                      
                                      {/* Quick Open Overlay */}
                                      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center -[1px]">
                                          <div className="bg-cyan-500 text-black px-4 py-1.5 rounded-full text-[10px] font-black tracking-widest shadow-lg transform scale-90 group-hover:scale-100 transition-transform">
                                              {t('OPEN')}
                                          </div>
                                      </div>
                                  </div>

                                  {/* DETAILS AREA */}
                                  <div className="p-3 flex-1 flex flex-col justify-between gap-2 bg-[#18181b]">
                                      {/* Title / Rename Input */}
                                      <div className="min-h-[20px]">
                                          {editingId === project.id ? (
                                              <div className="flex items-center gap-1">
                                                  <input 
                                                    autoFocus
                                                    type="text" 
                                                    value={renameValue} 
                                                    onChange={(e) => setRenameValue(e.target.value)}
                                                    onKeyDown={(e) => { if(e.key === 'Enter') saveRename(project.id); if(e.key === 'Escape') setEditingId(null); }}
                                                    onBlur={() => saveRename(project.id)}
                                                    className="w-full bg-black border border-cyan-500/50 rounded px-1.5 py-0.5 text-xs text-white outline-none"
                                                  />
                                                  <button onClick={() => saveRename(project.id)} className="text-green-500 hover:text-green-400 p-1"><Check size={12}/></button>
                                              </div>
                                          ) : (
                                              <div className="flex justify-between items-start gap-2">
                                                  <h3 className="text-sm font-bold text-gray-200 truncate group-hover:text-cyan-400 transition-colors flex items-center gap-1.5" title={project.name}>
                                                      {project.name}
                                                      {project.isCloud && <Cloud size={12} className="text-emerald-400" title="Cloud Synced Project" />}
                                                  </h3>
                                                  <span className="text-[9px] text-gray-600 font-mono whitespace-nowrap pt-0.5">{formatDate(project.lastModified)}</span>
                                              </div>
                                          )}
                                      </div>

                                      {/* Action Bar */}
                                      <div className="flex items-center justify-between pt-2 border-t border-white/5 opacity-60 group-hover:opacity-100 transition-opacity">
                                          <div className="flex items-center gap-1">
                                              <button 
                                                onClick={(e) => { e.stopPropagation(); startRename(project); }} 
                                                className="p-1.5 rounded hover:bg-white/10 text-gray-500 hover:text-white transition-colors"
                                                title={t('Rename')}
                                              >
                                                  <Edit2 size={12}/>
                                              </button>
                                              <button 
                                                onClick={(e) => { e.stopPropagation(); onDuplicateProject(project.id); }} 
                                                className="p-1.5 rounded hover:bg-white/10 text-gray-500 hover:text-cyan-400 transition-colors"
                                                title={t('Duplicate')}
                                              >
                                                  <Copy size={12}/>
                                              </button>
                                              <button 
                                                onClick={(e) => { e.stopPropagation(); handleExport(project); }}
                                                className="p-1.5 rounded hover:bg-white/10 text-gray-500 hover:text-white transition-colors"
                                                title={t('Export File')}
                                              >
                                                  <Download size={12}/>
                                              </button>
                                          </div>

                                          {confirmDeleteId === project.id ? (
                                              <button 
                                                onClick={(e) => { e.stopPropagation(); onDeleteProject(project.id); setConfirmDeleteId(null); }}
                                                className="flex items-center gap-1 px-2 py-1 bg-red-900/30 text-red-400 border border-red-900/50 rounded hover:bg-red-900/50 transition-colors text-[9px] font-bold"
                                              >
                                                  {t('CONFIRM')}
                                              </button>
                                          ) : (
                                              <button 
                                                onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(project.id); }}
                                                className="p-1.5 rounded hover:bg-red-900/20 text-gray-500 hover:text-red-400 transition-colors"
                                                title={t('Delete')}
                                              >
                                                  <Trash2 size={12}/>
                                              </button>
                                          )}
                                      </div>
                                  </div>
                              </div>
                          ))}
                      </div>
                  )}
              </div>
          </div>
      </div>

      {/* NEW PROJECT TYPE MODAL */}
      {showAdminPanel && <AdminPanel onClose={() => setShowAdminPanel(false)} />}
      
      {showAdminPwdPrompt && (
        <div className="fixed inset-0 z-[200] bg-black/80 flex items-center justify-center p-4">
          <div className="bg-[#111] border border-white/10 rounded-xl p-6 shadow-2xl max-w-sm w-full">
            <h3 className="text-white font-bold mb-4">Admin Access</h3>
            <input 
               autoFocus
               type="password"
               value={adminPwdInput}
               onChange={(e) => setAdminPwdInput(e.target.value)}
               placeholder="Enter password..."
               className="w-full bg-black border border-white/20 rounded p-2 text-white mb-4 outline-none focus:border-cyan-500"
               onKeyDown={(e) => {
                 if (e.key === 'Enter') {
                   if (adminPwdInput === 's1p2b3e4@787') {
                     setShowAdminPanel(true);
                     setShowAdminPwdPrompt(false);
                     setAdminPwdInput('');
                   } else {
                     alert('Incorrect password');
                   }
                 }
                 if (e.key === 'Escape') {
                   setShowAdminPwdPrompt(false);
                 }
               }}
            />
            <div className="flex justify-end gap-2">
               <button onClick={() => setShowAdminPwdPrompt(false)} className="px-3 py-1.5 text-xs text-gray-400 hover:text-white">Cancel</button>
               <button 
                 onClick={() => {
                   if (adminPwdInput === 's1p2b3e4@787') {
                     setShowAdminPanel(true);
                     setShowAdminPwdPrompt(false);
                     setAdminPwdInput('');
                   } else {
                     alert('Incorrect password');
                   }
                 }}
                 className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold rounded"
               >Unlock</button>
            </div>
          </div>
        </div>
      )}
    </div>

      {setupStage === 'TYPE_SELECT' && (
          <div className="fixed inset-0 z-[100] bg-black/90  flex items-center justify-center p-4 animate-in fade-in duration-200">
              <div className="w-full max-w-2xl bg-[#111] border border-white/10 rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 slide-in-from-bottom-4 duration-300 flex flex-col max-h-[90vh]">
                  <div className="p-4 sm:p-5 border-b border-white/5 flex justify-between items-center shrink-0">
                      <div>
                          <h2 className="text-sm sm:text-lg font-bold text-white tracking-tight uppercase">{t('New Project')}</h2>
                          <p className="text-gray-500 text-[10px] mt-0.5 tracking-tight">{t('Select your workflow preference')}</p>
                      </div>
                      <button onClick={() => setSetupStage('NONE')} className="p-2 hover:bg-white/10 rounded-full transition-colors text-gray-400 hover:text-white"><X size={16}/></button>
                  </div>
                  
                  <div className="p-4 flex flex-col gap-2 max-w-lg mx-auto overflow-y-auto no-scrollbar w-full">
                      {/* Character Mode */}
                      <button 
                          onClick={() => handleWorkflowSelect('CHARACTER')}
                          disabled={selecting !== 'NONE'}
                          className={`group relative flex items-center gap-4 p-4 border rounded-2xl transition-all text-left overflow-hidden active:scale-[0.98] ${
                              selecting === 'CHARACTER' 
                                ? 'bg-cyan-500/10 border-cyan-500 shadow-lg shadow-cyan-500/30' 
                                : 'bg-[#0c0c0e] border-white/5 hover:bg-[#111113] hover:border-cyan-500/40'
                          }`}
                      >
                          <div className={`absolute inset-0 transition-opacity ${selecting === 'CHARACTER' ? 'opacity-30' : 'opacity-10'} bg-gradient-to-r from-cyan-500/20 to-transparent`}></div>
                          <div className={`shrink-0 w-12 h-12 rounded-xl border flex items-center justify-center transition-all duration-300 ${
                              selecting === 'CHARACTER' 
                                ? 'bg-cyan-500 text-black border-cyan-500 scale-110' 
                                : 'bg-cyan-950/40 border-cyan-500/20 text-cyan-400 group-hover:scale-110 group-hover:bg-cyan-500 group-hover:text-black'
                          }`}>
                              <UserCog size={22}/>
                          </div>
                          <div className="relative z-10 min-w-0">
                              <h3 className={`font-black text-xs transition-colors tracking-widest uppercase ${
                                  selecting === 'CHARACTER' ? 'text-cyan-400' : 'text-white group-hover:text-cyan-400'
                              }`}>{t('CHARACTER ANIMATION')}</h3>
                              <p className="text-gray-500 text-[10px] leading-tight font-medium mt-0.5 max-w-[240px]">
                                  {t('Skeletal rigging & auto-lip sync. Professional performance tools.')}
                              </p>
                          </div>
                          <div className={`ml-auto transition-opacity ${selecting === 'CHARACTER' ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                              <ChevronDown size={14} className="-rotate-90 text-cyan-500"/>
                          </div>
                          {selecting === 'CHARACTER' && (
                              <motion.div layoutId="selection-glow" className="absolute inset-0 border-2 border-cyan-500 rounded-2xl z-20 pointer-events-none" initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 0] }} transition={{ duration: 0.35 }} />
                          )}
                      </button>

                      {/* Frame Mode */}
                      <button 
                          onClick={() => handleWorkflowSelect('FRAME')}
                          disabled={selecting !== 'NONE'}
                          className={`group relative flex items-center gap-4 p-4 border rounded-2xl transition-all text-left overflow-hidden active:scale-[0.98] ${
                              selecting === 'FRAME' 
                                ? 'bg-purple-500/10 border-purple-500 shadow-[0_0_20px_rgba(168,85,247,0.3)]' 
                                : 'bg-[#0c0c0e] border-white/5 hover:bg-[#111113] hover:border-purple-500/40'
                          }`}
                      >
                          <div className={`absolute inset-0 transition-opacity ${selecting === 'FRAME' ? 'opacity-30' : 'opacity-10'} bg-gradient-to-r from-purple-500/20 to-transparent`}></div>
                          <div className={`shrink-0 w-12 h-12 rounded-xl border flex items-center justify-center transition-all duration-300 ${
                              selecting === 'FRAME' 
                                ? 'bg-purple-500 text-white border-purple-500 scale-110' 
                                : 'bg-purple-950/40 border-purple-500/20 text-purple-400 group-hover:scale-110 group-hover:bg-purple-500 group-hover:text-white'
                          }`}>
                              <PenTool size={22}/>
                          </div>
                          <div className="relative z-10 min-w-0">
                              <h3 className={`font-black text-xs transition-colors tracking-widest uppercase ${
                                  selecting === 'FRAME' ? 'text-purple-400' : 'text-white group-hover:text-purple-400'
                              }`}>{t('FRAME-BY-FRAME')}</h3>
                              <p className="text-gray-500 text-[10px] leading-tight font-medium mt-0.5 max-w-[240px]">
                                  {t('Traditional hand-drawn tools & onion skinning.')}
                              </p>
                          </div>
                          <div className={`ml-auto transition-opacity ${selecting === 'FRAME' ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                              <ChevronDown size={14} className="-rotate-90 text-purple-500"/>
                          </div>
                          {selecting === 'FRAME' && (
                              <motion.div layoutId="selection-glow" className="absolute inset-0 border-2 border-purple-500 rounded-2xl z-20 pointer-events-none" initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 0] }} transition={{ duration: 0.35 }} />
                          )}
                      </button>

                      {/* No-Code Game Mode */}
                      <button 
                          onClick={() => handleWorkflowSelect('GAME')}
                          disabled={selecting !== 'NONE'}
                          className={`group relative flex items-center gap-4 p-4 border rounded-2xl transition-all text-left overflow-hidden active:scale-[0.98] ${
                              selecting === 'GAME' 
                                ? 'bg-amber-500/10 border-amber-500 shadow-[0_0_20px_rgba(245,158,11,0.3)]' 
                                : 'bg-[#0c0c0e] border-white/5 hover:bg-[#111113] hover:border-amber-500/40'
                          }`}
                      >
                          <div className={`absolute inset-0 transition-opacity ${selecting === 'GAME' ? 'opacity-30' : 'opacity-10'} bg-gradient-to-r from-amber-500/20 to-transparent`}></div>
                          <div className={`shrink-0 w-12 h-12 rounded-xl border flex items-center justify-center transition-all duration-300 ${
                              selecting === 'GAME' 
                                ? 'bg-amber-500 text-black border-amber-500 scale-110' 
                                : 'bg-amber-950/40 border-amber-500/20 text-amber-400 group-hover:scale-110 group-hover:bg-amber-500 group-hover:text-black'
                          }`}>
                              <Gamepad2 size={22}/>
                          </div>
                          <div className="relative z-10 min-w-0">
                              <h3 className={`font-black text-xs transition-colors tracking-widest uppercase ${
                                  selecting === 'GAME' ? 'text-amber-400' : 'text-white group-hover:text-amber-400'
                              }`}>{t('NO-CODE ANIMATO GAME BUILDER EXPERIENCE')}</h3>
                              <p className="text-gray-500 text-[10px] leading-tight font-medium mt-0.5 max-w-[240px]">
                                  {t('Create 2D platformer games with interactive physics & custom logic events.')}
                              </p>
                          </div>
                          <div className={`ml-auto transition-opacity ${selecting === 'GAME' ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                              <ChevronDown size={14} className="-rotate-90 text-amber-500"/>
                          </div>
                          {selecting === 'GAME' && (
                              <motion.div layoutId="selection-glow" className="absolute inset-0 border-2 border-amber-500 rounded-2xl z-20 pointer-events-none" initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 0] }} transition={{ duration: 0.35 }} />
                          )}
                      </button>
                  </div>
              </div>
          </div>
      )}

      {/* FRAME PROJECT SETUP MODAL - SIMPLIFIED */}
      {setupStage === 'FRAME_SETUP' && (
          <div className="fixed inset-0 z-[110] bg-black/95  flex items-center justify-center p-4 animate-in fade-in duration-300">
              <div className="w-full max-w-lg bg-[#0c0c0e] border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
                  {/* Setup Header */}
                  <div className="p-5 border-b border-white/5 flex justify-between items-center bg-[#111] shrink-0">
                      <div className="flex items-center gap-3">
                          <div className="w-9 h-9 bg-purple-500/20 rounded-lg flex items-center justify-center text-purple-400 border border-purple-500/30">
                              <PenTool size={18}/>
                          </div>
                          <div>
                              <h2 className="text-lg font-bold text-white tracking-tight leading-none">{t('New Animation')}</h2>
                              <p className="text-gray-500 text-[10px] mt-1">{t('Configure your project')}</p>
                          </div>
                      </div>
                      <button onClick={() => setSetupStage('TYPE_SELECT')} className="p-2 hover:bg-white/10 rounded-full transition-colors text-gray-400 hover:text-white"><X size={18}/></button>
                  </div>

                  <div className="p-5 space-y-5 overflow-y-auto custom-scrollbar">
                      <div className="space-y-1.5">
                          <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">{t('Project Name')}</label>
                          <input 
                            type="text" 
                            value={newProjectName}
                            onChange={(e) => setNewProjectName(e.target.value)}
                            className="w-full bg-[#18181b] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:border-purple-500 focus:ring-1 focus:ring-purple-500 outline-none transition-all placeholder-gray-600"
                            placeholder={t('My Awesome Animation')}
                            autoFocus
                          />
                      </div>

                      <div className="space-y-1.5">
                          <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">{t('Aspect Ratio')}</label>
                          <div className="grid grid-cols-2 gap-2">
                              {FRAME_ASPECT_RATIOS.map((ratio) => (
                                  <button 
                                      key={ratio.value}
                                      onClick={() => setSelectedRatio(ratio.value)}
                                      className={`p-3 rounded-xl border flex flex-col items-center justify-center gap-1 transition-all ${selectedRatio === ratio.value ? 'bg-purple-500/10 border-purple-500 text-purple-400' : 'bg-[#18181b] border-white/5 text-gray-400 hover:bg-[#111113] hover:text-white'}`}
                                  >
                                      <ratio.icon size={18} />
                                      <span className="text-[11px] font-bold">{ratio.label}</span>
                                      <span className="text-[9px] opacity-60 pointer-events-none">{ratio.desc}</span>
                                  </button>
                              ))}
                          </div>
                      </div>

                      <div className="space-y-1.5">
                          <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">{t('FPS')}</label>
                          <div className="grid grid-cols-4 gap-1.5">
                              {[12, 24, 30, 60].map(fps => (
                                  <button 
                                    key={fps}
                                    onClick={() => setSelectedFps(fps)}
                                    className={`py-2.5 rounded-xl text-xs font-bold border transition-all ${selectedFps === fps ? 'bg-purple-500 text-white border-purple-500 shadow-lg shadow-purple-900/40' : 'bg-[#18181b] border-white/5 text-gray-400 hover:bg-[#111113] hover:text-white'}`}
                                  >
                                      {fps}
                                  </button>
                              ))}
                          </div>
                      </div>
                  </div>

                  <div className="p-5 border-t border-white/5 bg-[#111] flex justify-end gap-3">
                      <button onClick={() => setSetupStage('TYPE_SELECT')} className="px-5 py-2.5 rounded-xl text-[10px] font-bold text-gray-400 hover:text-white hover:bg-white/5 transition-colors">{t('CANCEL')}</button>
                      <button onClick={createFrameProject} className="px-6 py-2.5 bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs rounded-xl shadow-lg shadow-purple-900/20 transition-all flex items-center gap-2">
                          {t('CREATE')} <Check size={14}/>
                      </button>
                  </div>
              </div>
          </div>
      )}

      {/* CHARACTER PROJECT SETUP MODAL - SIMPLIFIED */}
      {setupStage === 'STORE' && (
          <Store 
             onClose={() => setSetupStage('NONE')}
             user={user}
             onOpenProject={onOpenProject}
             onNewProject={onNewProject}
             savedProjects={savedProjects}
             onImportToExistingProject={onImportToExistingProject}
             onPurchaseSuccess={() => {
                 setSetupStage('NONE');
             }}
          />
      )}

      {setupStage === 'CHARACTER_SETUP' && (
          <div className="fixed inset-0 z-[110] bg-black/95  flex items-center justify-center p-4 animate-in fade-in duration-300">
              <div className="w-full max-w-lg bg-[#0c0c0e] border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
                  {/* Setup Header */}
                  <div className="p-5 border-b border-white/5 flex justify-between items-center bg-[#111] shrink-0">
                      <div className="flex items-center gap-3">
                          <div className="w-9 h-9 bg-cyan-500/20 rounded-lg flex items-center justify-center text-cyan-400 border border-cyan-500/30">
                              <UserCog size={18}/>
                          </div>
                          <div>
                              <h2 className="text-lg font-bold text-white tracking-tight leading-none">{t('New Character Animation')}</h2>
                              <p className="text-gray-500 text-[10px] mt-1">{t('Configure your project')}</p>
                          </div>
                      </div>
                      <button onClick={() => setSetupStage('TYPE_SELECT')} className="p-2 hover:bg-white/10 rounded-full transition-colors text-gray-400 hover:text-white"><X size={18}/></button>
                  </div>

                  <div className="p-5 space-y-5 overflow-y-auto custom-scrollbar">
                      <div className="space-y-1.5">
                          <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">{t('Project Name')}</label>
                          <input 
                            type="text" 
                            value={newProjectName}
                            onChange={(e) => setNewProjectName(e.target.value)}
                            className="w-full bg-[#18181b] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 outline-none transition-all placeholder-gray-600"
                            placeholder={t('My Awesome Animation')}
                            autoFocus
                          />
                      </div>

                      <div className="space-y-1.5">
                          <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">{t('Aspect Ratio')}</label>
                          <div className="grid grid-cols-2 gap-2">
                              {FRAME_ASPECT_RATIOS.map((ratio) => (
                                  <button 
                                      key={ratio.value}
                                      onClick={() => setSelectedRatio(ratio.value)}
                                      className={`p-3 rounded-xl border flex flex-col items-center justify-center gap-1 transition-all ${selectedRatio === ratio.value ? 'bg-cyan-500/10 border-cyan-500 text-cyan-400' : 'bg-[#18181b] border-white/5 text-gray-400 hover:bg-[#111113] hover:text-white'}`}
                                  >
                                      <ratio.icon size={18} />
                                      <span className="text-[11px] font-bold">{ratio.label}</span>
                                      <span className="text-[9px] opacity-60 pointer-events-none">{ratio.desc}</span>
                                  </button>
                              ))}
                          </div>
                      </div>
                  </div>

                  <div className="p-5 border-t border-white/5 bg-[#111] flex justify-end gap-3">
                      <button onClick={() => setSetupStage('TYPE_SELECT')} className="px-5 py-2.5 rounded-xl text-[10px] font-bold text-gray-400 hover:text-white hover:bg-white/5 transition-colors">{t('CANCEL')}</button>
                      <button onClick={createCharacterProject} className="px-6 py-2.5 bg-cyan-600 hover:bg-cyan-500 text-black font-bold text-xs rounded-xl shadow-lg shadow-cyan-900/20 transition-all flex items-center gap-2">
                          {t('CREATE')} <Check size={14}/>
                      </button>
                  </div>
              </div>
          </div>
      )}

      {/* BUG REPORT MODAL */}
      {setupStage === 'BUG_REPORT' && (
          <div className="fixed inset-0 z-[120] bg-black/90  flex items-center justify-center p-4 animate-in fade-in duration-300">
              <div className="w-full max-w-lg bg-[#0c0c0e] border border-red-500/20 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
                  {bugSubmitSuccess ? (
                      <div className="p-8 flex flex-col items-center justify-center text-center space-y-4 animate-in zoom-in duration-300">
                          <div className="w-16 h-16 bg-green-500/10 text-green-400 rounded-full flex items-center justify-center mb-2">
                              <Check size={32} />
                          </div>
                          <h3 className="text-xl font-bold text-white tracking-tight">{t('Report Submitted!')}</h3>
                          <p className="text-sm text-gray-400">{t('Thanks for your feedback. We\'re on it!')}</p>
                      </div>
                  ) : (
                      <>
                  <div className="p-5 border-b border-white/5 flex justify-between items-center bg-[#111] shrink-0">
                      <div className="flex items-center gap-3">
                          <div className="w-9 h-9 bg-red-500/20 rounded-lg flex items-center justify-center text-red-400 border border-red-500/30">
                              <Bug size={18}/>
                          </div>
                          <div>
                              <h2 className="text-lg font-bold text-white tracking-tight leading-none">{t('Report a Bug')}</h2>
                              <p className="text-gray-500 text-[10px] mt-1">{t('Tell the AI dev what\'s broken')}</p>
                          </div>
                      </div>
                      <button onClick={() => setSetupStage('NONE')} className="p-2 hover:bg-white/10 rounded-full transition-colors text-gray-400 hover:text-white"><X size={18}/></button>
                  </div>

                  <div className="p-5 flex-1 overflow-y-auto custom-scrollbar space-y-4">
                      <div className="bg-red-500/5 border border-red-500/10 rounded-xl p-3 text-[10px] text-red-400/80 leading-relaxed">
                          {t('Your report will be stored locally and read by the AI assistant on its next update cycle. Please be specific about what went wrong.')}
                      </div>

                      <div className="space-y-1.5">
                          <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">{t('Bug Description')}</label>
                          <textarea 
                            value={bugDescription}
                            onChange={(e) => setBugDescription(e.target.value)}
                            className="w-full bg-[#18181b] border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:border-red-500/50 focus:ring-1 focus:ring-red-500/50 outline-none transition-all placeholder-gray-600 min-h-[150px] resize-none"
                            placeholder={t('Example: The export button doesn\'t work when I have more than 10 layers...')}
                            autoFocus
                          />
                      </div>
                  </div>

                  <div className="p-5 border-t border-white/5 bg-[#111] flex justify-end gap-3">
                      <button onClick={() => setSetupStage('NONE')} className="px-5 py-2.5 rounded-xl text-[10px] font-bold text-gray-400 hover:text-white hover:bg-white/5 transition-colors">{t('CANCEL')}</button>
                      <button 
                        onClick={handleSendBug} 
                        disabled={isSendingBug || !bugDescription.trim()}
                        className="px-6 py-2.5 bg-red-600 hover:bg-red-500 disabled:bg-gray-800 disabled:text-gray-500 text-white font-bold text-xs rounded-xl shadow-lg shadow-red-900/20 transition-all flex items-center gap-2"
                      >
                          {isSendingBug ? 'SENDING...' : 'SEND REPORT'} <Send size={14}/>
                      </button>
                  </div>
                      </>
                  )}
              </div>
          </div>
      )}
      {/* ADMIN BUGS MODAL */}
      {showAdminBugs && (
          <div className="fixed inset-0 z-[150] bg-black/90  flex items-center justify-center p-4 animate-in fade-in duration-300">
              <div className="w-full max-w-4xl bg-[#0c0c0e] border border-cyan-500/20 rounded-2xl shadow-2xl overflow-hidden flex flex-col h-[85vh]">
                  <div className="p-5 border-b border-white/5 flex justify-between items-center bg-[#111] shrink-0">
                      <div className="flex items-center gap-3">
                          <div className="w-9 h-9 bg-cyan-500/20 rounded-lg flex items-center justify-center text-cyan-400 border border-cyan-500/30">
                              <Bug size={18}/>
                          </div>
                          <div>
                              <h2 className="text-lg font-bold text-white tracking-tight leading-none">{t('Admin Bug Database (Secret)')}</h2>
                              <p className="text-gray-500 text-[10px] mt-1">{t('Review reported bugs')}</p>
                          </div>
                      </div>
                      <button onClick={() => setShowAdminBugs(false)} className="p-2 hover:bg-white/10 rounded-full transition-colors text-gray-400 hover:text-white"><X size={18}/></button>
                  </div>

                  <div className="p-5 overflow-y-auto custom-scrollbar flex-1 space-y-4">
                      {adminBugs.length === 0 ? (
                          <div className="text-center text-gray-500 py-10">{t('No bugs reported yet.')}</div>
                      ) : (
                          adminBugs.map((bug: any) => (
                              <div key={bug.id} className="bg-[#18181b] border border-white/5 rounded-xl p-4 flex flex-col gap-2">
                                  <div className="flex justify-between items-start">
                                      <div className="flex flex-col">
                                          <span className="text-xs text-cyan-500 font-mono">Bug #{bug.id}</span>
                                          <span className="text-[10px] text-gray-500">{new Date(bug.timestamp).toLocaleString()}</span>
                                      </div>
                                      <button 
                                          onClick={() => handleDeleteBug(bug.id)}
                                          className="p-1.5 bg-red-950/30 text-red-500 hover:bg-red-500/20 hover:text-red-400 rounded-md transition-colors"
                                          title={t('Delete bug')}
                                      >
                                          <Trash2 size={14} />
                                      </button>
                                  </div>
                                  <p className="text-sm text-white whitespace-pre-wrap mt-1">{bug.description}</p>
                                  <div className="mt-2 text-[9px] text-gray-600 font-mono bg-black/50 p-2 rounded break-all">
                                      {bug.userAgent}
                                  </div>
                              </div>
                          ))
                      )}
                  </div>
              </div>
          </div>
      )}

      <AnimatePresence>
          {localToast && (
              <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 20 }}
                  className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[500] pointer-events-none"
              >
                  <div className="bg-black/90 border border-cyan-500/30 px-6 py-3 rounded-full text-cyan-400 text-[10px] font-black uppercase tracking-[0.2em] shadow-lg shadow-cyan-500/10 flex items-center gap-3">
                      <div className="w-1.5 h-1.5 rounded-full bg-cyan-500 animate-pulse"></div>
                      {localToast}
                  </div>
              </motion.div>
          )}
      </AnimatePresence>
      <AnimatePresence>
          {showProfileMenu && user && (
              <div className="fixed inset-0 z-[200] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setShowProfileMenu(false)}>
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="w-full max-w-sm max-h-[85vh] overflow-y-auto custom-scrollbar bg-[#0a0a0a] border border-white/10 rounded-2xl shadow-2xl p-4"
                    onClick={(e) => e.stopPropagation()}
                  >
                      <div className="flex flex-col gap-2">
                          <div className="flex items-center justify-between border-b border-white/5 pb-3">
                            <div className="flex items-center gap-3">
                                <div 
                                    onClick={handleProfileTap}
                                    className="w-10 h-10 rounded-full bg-cyan-900/40 flex items-center justify-center text-cyan-400 border border-cyan-500/20 shrink-0 cursor-pointer select-none active:scale-95 transition-transform"
                                >
                                    <User size={20} />
                                </div>
                                <div className="overflow-hidden">
                                    <div className="flex items-center gap-2">
                                        <p className="text-sm font-bold text-white truncate">{user.email}</p>
                                        {user.subscription_status === 'active' && (
                                        <div className="px-1 py-0.5 bg-yellow-500 rounded text-[7px] font-black text-black shrink-0">PRO</div>
                                        )}
                                    </div>
                                        <p className="text-[10px] text-cyan-400 tracking-wider uppercase font-bold mt-0.5">
                                            {user.subscription_status === 'active' ? (
                                                (user.subscription_type || '').trim().toLowerCase() === 'daily' ? t('Daily Pass') : 
                                                (user.subscription_type || '').trim().toLowerCase() === 'weekly' ? t('Weekly Plan') :
                                                (user.subscription_type || '').trim().toLowerCase() === 'monthly' ? t('Monthly Plan') :
                                                (user.subscription_type || '').trim().toLowerCase() === 'yearly' ? t('Yearly Plan') : 
                                                (user.subscription_type ? (user.subscription_type.charAt(0).toUpperCase() + user.subscription_type.slice(1)) : t('Active Plan'))
                                            ) : t('No Active Plan')}
                                        </p>
                                </div>
                            </div>
                            <button onClick={() => setShowProfileMenu(false)} className="p-1 text-gray-400 hover:text-white rounded-full hover:bg-white/5">
                                <X size={16} />
                            </button>
                          </div>
                          <div className="pt-2">
                              <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-1">{t('Subscription Expires')}</p>
                              <div className="flex flex-col gap-1">
                                  <p className="text-xs text-gray-300 font-mono">
                                      {user.subscription_expiry ? 
                                        (isNaN(new Date(user.subscription_expiry).getTime()) ? t('N/A') :
                                        new Date(user.subscription_expiry).toLocaleString(undefined, {
                                          year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                                        })) : t('N/A')}
                                  </p>
                                  {user.subscription_expiry && user.subscription_status === 'active' &&
                                    new Date(user.subscription_expiry).getTime() > Date.now() && (
                                      <SubscriptionCountdown expiry={new Date(user.subscription_expiry).getTime()} />
                                  )}
                              </div>
                          </div>
                          <div className="mt-2 pt-2 border-t border-white/5">
                              <button 
                                  onClick={() => { setShowProfileMenu(false); setShowCreatorProgram(true); }}
                                  className="w-full text-left px-3 py-2 text-xs bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 font-bold tracking-wide rounded border border-cyan-500/30 flex items-center gap-2 transition-colors mb-2"
                              >
                                  <Star size={14} />
                                  {t('Creator Program')}
                              </button>
                              <button 
                                  onClick={() => { setShowProfileMenu(false); setShowSecurityModal(true); }}
                                  className={`w-full text-left px-3 py-2 text-xs ${colors.bg} ${colors.hoverBg} ${colors.text} font-bold tracking-wide rounded border ${colors.border} flex items-center gap-2 transition-colors mb-2`}
                              >
                                  <Lock size={14} />
                                  {t('Account Security')}
                              </button>

                              <button 
                                disabled={isCheckingUpdates}
                                onClick={async () => {
                                  setIsCheckingUpdates(true);
                                  
                                  const runDeepCheck = async (): Promise<boolean> => {
                                    // 1. Try standard Service Worker check first
                                    if (typeof (window as any).__checkAppUpdate === 'function') {
                                      try {
                                        const swUpdate = await (window as any).__checkAppUpdate();
                                        if (swUpdate) return true;
                                      } catch (err) {
                                        console.warn("SW update check failed, trying deep check...", err);
                                      }
                                    }

                                    // 2. Fallback to manually checking registrations
                                    if (navigator.serviceWorker) {
                                      try {
                                        const regs = await navigator.serviceWorker.getRegistrations();
                                        for (const r of regs) {
                                          await r.update();
                                          if (r.waiting || r.installing) {
                                            return true;
                                          }
                                        }
                                      } catch (err) {
                                        console.warn("Manual registrations update failed", err);
                                      }
                                    }

                                    // 3. Force-fetch index.html from network to detect script bundle differences (absolute truth)
                                    try {
                                      const response = await fetch(`/index.html?t=${Date.now()}`, { cache: 'no-store' });
                                      if (response.ok) {
                                        const text = await response.text();
                                        const scriptRegex = /\/assets\/index-[a-zA-Z0-9_\-]+\.js/g;
                                        const remoteScripts = text.match(scriptRegex) || [];
                                        
                                        const localScripts = Array.from(document.querySelectorAll('script'))
                                          .map(s => s.src)
                                          .filter(src => src.includes('/assets/index-'));

                                        if (remoteScripts.length > 0 && localScripts.length > 0) {
                                          const remoteMain = remoteScripts[0];
                                          const localMain = localScripts[0];
                                          if (!localMain.includes(remoteMain)) {
                                            console.log("Deep check found new remote script:", remoteMain);
                                            return true;
                                          }
                                        }
                                      }
                                    } catch (err) {
                                      console.warn("Failed to head-check remote assets", err);
                                    }
                                    
                                    return false;
                                  };

                                  try {
                                    const hasUpdate = await runDeepCheck();
                                    if (hasUpdate) {
                                      showAppToast(t('Update found!'));
                                      if (typeof (window as any).__showReloadPrompt === 'function') {
                                        (window as any).__showReloadPrompt();
                                      } else {
                                        if (confirm(t('A new version of the app is available! Would you like to reload to apply it now?'))) {
                                          window.location.reload();
                                        }
                                      }
                                    } else {
                                      alert(t('You are using the latest version of the app.'));
                                      showAppToast(t('You are using the latest version of the app.'));
                                    }
                                  } catch (err) {
                                    showAppToast(t('Update check issue: ') + String(err));
                                  } finally {
                                    setIsCheckingUpdates(false);
                                  }
                                }}
                                className={`w-full py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 border ${
                                  isCheckingUpdates 
                                    ? 'bg-neutral-800/55 text-neutral-500 border-white/5 cursor-not-allowed' 
                                    : 'bg-gradient-to-r from-cyan-950/30 to-blue-950/30 hover:from-cyan-900/40 hover:to-blue-900/40 text-cyan-400 hover:text-cyan-300 border-cyan-500/15'
                                }`}
                              >
                                  <RefreshCw size={12} className={isCheckingUpdates ? "animate-spin text-cyan-500" : "animate-[spin_4s_linear_infinite]"} />
                                  {isCheckingUpdates ? t('Checking...') : t('Check for Updates')}
                              </button>
                              <div className="flex items-center justify-between text-[10px] text-zinc-500 px-1 mt-1">
                                <span>{t('App Version')}</span>
                                <span className={`font-mono font-bold ${hasNewBadge ? 'text-emerald-400 animate-pulse' : 'text-zinc-400'}`}>
                                  {appVersion} {hasNewBadge && `(${t('Updated')})`}
                                </span>
                              </div>
                          </div>
                          <button 
                            onClick={() => {
                                if (onSignOut) {
                                    onSignOut();
                                } else {
                                    localStorage.removeItem('app_user');
                                    localStorage.removeItem('pending_app_payment');
                                    localStorage.removeItem('pending_app_plan');
                                    window.location.href = window.location.origin + '/';
                                }
                            }}
                            className="mt-4 w-full py-2 bg-white/5 hover:bg-white/10 text-gray-300 rounded-lg text-xs font-bold transition-all"
                          >
                              {t('Sign Out')}
                          </button>
                      </div>
                  </motion.div>
              </div>
          )}
      </AnimatePresence>
      {showCreatorProgram && <CreatorProgramModal user={user} onClose={() => setShowCreatorProgram(false)} />}
      {showSecurityModal && (
          <AccountSecurityModal 
              user={user} 
              theme={activeTheme}
              onClose={() => setShowSecurityModal(false)} 
              onUserUpdate={(updated) => {
                  if (onUserUpdate) onUserUpdate(updated);
              }}
          />
      )}
      {showCloudStorageModal && (
          <CloudStorageModal 
              user={user} 
              theme={activeTheme}
              savedProjects={savedProjects}
              onClose={() => setShowCloudStorageModal(false)}
              onRefreshProjects={onRefreshProjects}
          />
      )}
      {showCommunityModal && (
          <CompetitionTutorialModal 
              user={user}
              initialTab={activeCommunityTab}
              theme={activeTheme}
              onClose={() => setShowCommunityModal(false)}
          />
      )}

      {/* Premium Cloud Restore compact prompt */}
      <AnimatePresence>
        {showCloudPrompt && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 30 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 30 }}
            className="fixed bottom-6 right-6 z-[100] max-w-sm w-full bg-[#0c0c0e]/95 backdrop-blur-md border border-cyan-500/30 rounded-2xl shadow-2xl p-5 flex flex-col gap-4 animate-in fade-in duration-300 pointer-events-auto"
          >
            <div className="flex items-start gap-3">
              <div className="p-2.5 bg-cyan-500/20 text-cyan-400 rounded-xl border border-cyan-500/25 shrink-0">
                <Cloud size={18} className="animate-pulse" />
              </div>
              <div className="space-y-1">
                <h4 className="text-xs font-black text-white uppercase tracking-wider">{t('Cloud Setup Found')}</h4>
                <p className="text-[11px] text-gray-400 leading-normal">
                  {t("Do you want to load your backed up animation projects into this device's project manager?")}
                </p>
              </div>
            </div>

            <div className="flex gap-2 w-full">
              <button
                onClick={handleCancelCloudPrompt}
                className="flex-1 py-2 border border-white/10 hover:bg-white/5 text-gray-400 hover:text-white rounded-lg text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer"
              >
                {t('Cancel')}
              </button>
              <button
                onClick={handlePopulateCloudBackup}
                disabled={loadingCloudBackup}
                className="flex-1 py-2 bg-gradient-to-r from-cyan-600 to-cyan-500 hover:from-cyan-500 hover:to-cyan-400 text-black font-black text-[10px] uppercase tracking-wider rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {loadingCloudBackup ? (
                  <>
                    <RefreshCw size={11} className="animate-spin" />
                    <span>{t('Loading...')}</span>
                  </>
                ) : (
                  <>
                    <RefreshCw size={11} />
                    <span>{t('Load')}</span>
                  </>
                )}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};
