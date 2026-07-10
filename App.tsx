import { showAppToast } from "./utils/toastHelper";
import { db, doc, getDoc, setDoc, updateDoc, collection, query, where, getDocs, serverTimestamp } from "./utils/firebase";
import React, {
  useState,
  useRef,
  useEffect,
  Suspense,
  lazy,
  useCallback,
  useMemo,
} from "react";
import { useLanguage } from "./utils/LanguageContext";
import { useAudioEngine } from "./hooks/useAudioEngine";
import { CharacterStage } from "./components/CharacterStage";
import { WaveformDisplay } from "./components/WaveformDisplay";
import { MixingConsole } from "./components/MixingConsole";
import { FrameRuler } from "./components/FrameRuler";
import { KeyframeTimeline } from "./components/KeyframeTimeline";
import { LipSyncTimeline } from "./components/LipSyncTimeline";
import { LipSyncGeneratorModal } from "./components/LipSyncGeneratorModal";
import { ProjectManager } from "./components/ProjectManager";
import { FastSlider } from "./components/FastSlider";
import { FrameByFrameEditor } from "./components/FrameByFrameEditor"; // NEW IMPORT
import { GameCreatorStudio } from "./components/GameCreatorStudio";
import { PremiumSplash } from "./components/PremiumSplash"; // NEW IMPORT
import { PremiumSignIn } from "./components/PremiumSignIn"; // NEW IMPORT
import { ExpiredRenewalModal } from "./components/ExpiredRenewalModal";
import { SubscriptionPanel } from "./components/SubscriptionPanel";
import { SubscriptionSuccessSplash } from "./components/SubscriptionSuccessSplash";
import { ExpiredSubscriptionSplash } from "./components/ExpiredSubscriptionSplash"; // NEW IMPORT
import GitHubAuthCallback from "./components/GitHubAuthCallback";
import { KinematicsTab } from "./components/KinematicsTab";
import { AdjustTab } from "./components/AdjustTab";
import { AnimatedBackground, ThemeType } from "./components/AnimatedBackground"; // NEW IMPORT
import {
  Loader2,
  Menu,
  ArrowLeft,
  UserCog,
  User,
  Edit3,
  Tag,
  PlusCircle,
  Play,
  Mic,
  Save,
  Film,
  Settings,
  X,
  PanelLeftClose,
  Layers,
  ChevronDown,
  ChevronRight,
  Folder,
  Layout,
  Eye,
  EyeOff,
  Monitor,
  Bone as BoneIcon,
  Smile,
  Zap,
  Split,
  Copy,
  ClipboardPaste,
  KeyIcon,
  Disc,
  Trash2,
  SkipBack,
  Repeat,
  Square,
  ZoomOut,
  ZoomIn,
  Camera,
  RotateCcw,
  RotateCw,
  Image as ImageIcon,
  Upload,
  CloudFog,
  Palette,
  Grid,
  Cpu,
  MousePointerClick,
  Check,
  Sliders,
  Anchor,
  Droplets,
  Move,
  Sun,
  Lightbulb,
  Sunrise,
  Sunset,
  Plus,
  Sparkles,
  Ratio,
  AlertCircle,
  AudioWaveform,
  Clock,
  Maximize,
} from "lucide-react";
import { COLORS, BONE_PALETTE } from "./constants";
import {
  VisemeShape,
  CharacterComposition,
  TransformState,
  CharacterPart,
  Keyframe,
  EasingType,
  AnimatableProperty,
  TrackState,
  UnpackedImage,
  PlacedAsset,
  AssemblerSession,
  Bone,
  LightSource,
  LightType,
  ShadowConfig,
  LipSyncKeyframe,
  FrameData,
  ProjectType,
} from "./types";
import {
  StorageUtils,
  ProjectMetadata,
  FullProjectData,
  FrameSettings,
  blobUrlToBase64,
} from "./utils/storage";
import { triggerDownload } from "./utils/downloadHelper";
import { KeyframeEngine } from "./utils/KeyframeEngine";
import { safeDeepClone } from "./utils/cloneUtils";
import { audioBufferToWavBase64 } from "./utils/audioUtils";
import { motion, AnimatePresence } from "motion/react";
import * as LucideIcons from "lucide-react";
import { TextKeyframe, SceneText } from "./types";
import {
  sendSystemNotification,
  requestNotificationPermission,
} from "./utils/notificationHelper";
import { InitialLanguageSelection } from "./components/InitialLanguageSelection";
import { ExportModal } from "./components/ExportModal";
import { calculateInstantVisemeParams } from "./utils/visemeUtils";
import { getInitialParts } from "./utils/characterDefaults";
import { compensateAnchorShift } from "./utils/animationUtils";
import * as backend from "./utils/backend";

import { requestAllPermissions } from "./utils/permissionHelper";

const FaceLeftIcon = ({ size = 20, className = "" }: { size?: number, className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <circle cx="12" cy="12" r="10" strokeWidth="2" />
    <path d="M7 10h.01" strokeWidth="3" />
    <path d="M12 10h.01" strokeWidth="3" />
    <path d="M8 12.5v1.5" strokeWidth="1.5" />
    <path d="M7.5 16.5c1.5 1 3.5.5 4.5 0" strokeWidth="1.5" />
  </svg>
);

const FaceCenterIcon = ({ size = 20, className = "" }: { size?: number, className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <circle cx="12" cy="12" r="10" strokeWidth="2" />
    <path d="M9 10h.01" strokeWidth="3" />
    <path d="M15 10h.01" strokeWidth="3" />
    <path d="M12 12.5v1.5" strokeWidth="1.5" />
    <path d="M9.5 16.5c1.5 1 3.5 1 5 0" strokeWidth="1.5" />
  </svg>
);

const FaceRightIcon = ({ size = 20, className = "" }: { size?: number, className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <circle cx="12" cy="12" r="10" strokeWidth="2" />
    <path d="M12 10h.01" strokeWidth="3" />
    <path d="M17 10h.01" strokeWidth="3" />
    <path d="M16 12.5v1.5" strokeWidth="1.5" />
    <path d="M16.5 16.5c-1.5 1-3.5.5-4.5 0" strokeWidth="1.5" />
  </svg>
);

const VisemeMapper = lazy(() => import("./components/VisemeMapper"));
const CharacterBuilder = lazy(() => import("./components/CharacterBuilder"));

import { AdvancedColorPicker } from "./components/AdvancedColorPicker";
import { ReloadPrompt } from "./components/ReloadPrompt";
// ... (keep imports and helper components like EasingEditor same as before)

type BackgroundImageState = {
  url: string | null;
  width: number;
  height: number;
};

interface HistoryState {
  character: CharacterComposition | null;
  characters: any[];
  characterFiltersMap: Record<string, any>;
  activeSceneCharacterId: string | null;
  keyframes: Keyframe[];
  lipSyncKeyframes: LipSyncKeyframe[];
  cameraTransform: { x: number; y: number; scale: number; rotation: number };
  characterFilters: {
    saturation: number;
    contrast: number;
    brightness: number;
    sharpness: number;
  };
  lightSources: LightSource[];
  backgroundTransform: {
    zoom: number;
    x: number;
    y: number;
    blur: number;
    brightness: number;
    contrast: number;
    saturation: number;
  };
  audioState: {
    vocalGain: number;
    vocalPitch: number;
    vocalSpeed: number;
    instGain: number;
    instPitch: number;
    instSpeed: number;
  };
  linkBgToCamera: boolean;
  ambientLightLevel: number;
  visemeMap: Record<VisemeShape, string | null>;
  backgroundImage: BackgroundImageState;
  canvasBgColor: string;
  isCanvasTransparent: boolean;
  activeBoneId: string | null;
  currentBoneTransforms: Record<
    string,
    { rotation: number; scaleX: number; scaleY: number }
  >;
}

const hexToRgb = (hex: string) => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : { r: 0, g: 0, b: 0 };
};

const componentToHex = (c: number) => {
  const hex = Math.min(255, Math.max(0, Math.round(c))).toString(16);
  return hex.length === 1 ? "0" + hex : hex;
};

const rgbToHex = (r: number, g: number, b: number) => {
  return "#" + componentToHex(r) + componentToHex(g) + componentToHex(b);
};

function RelativeSlider({
  value,
  onChange,
  onInteractionStart,
  onInteractionEnd,
  minRange = -300,
  maxRange = 300,
  step = 1,
}: any) {
  const [isDragging, setIsDragging] = useState(false);
  const [center, setCenter] = useState(value);

  // Keep the slider physically centered on the current value when not actively dragging
  useEffect(() => {
    if (!isDragging) {
      setCenter(value);
    }
  }, [value, isDragging]);

  return (
    <input
      type="range"
      min={center + minRange}
      max={center + maxRange}
      step={step}
      value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        setIsDragging(true);
        setCenter(value);
        if (onInteractionStart) onInteractionStart(e);
      }}
      onPointerUp={(e) => {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
        setIsDragging(false);
        setCenter(value);
        if (onInteractionEnd) onInteractionEnd(e);
      }}
      className="w-full h-1 bg-white/10 rounded-full accent-cyan-500 touch-none"
    />
  );
}

const EasingEditor: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  onSelect: (easing: EasingType) => void;
  position: { x: number; y: number };
  currentEasing: EasingType;
}> = ({ isOpen, onClose, onSelect, position, currentEasing }) => {
  const { t } = useLanguage();
  if (!isOpen) return null;
  return (
    <div
      className="fixed z-[999] w-64 bg-[#111]/95 border border-white/10 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-80"
      style={{ left: position.x, top: position.y }}
    >
      <div className="p-2 border-b border-white/10 flex justify-between">
        <span className="text-xs font-bold text-gray-400">
          {t("INTERPOLATION")}
        </span>
        <button onClick={onClose}>
          <LucideIcons.X size={14} />
        </button>
      </div>
      <div className="overflow-y-auto p-2 space-y-1 custom-scrollbar">
        {Object.values(EasingType).map((t) => (
          <button
            key={t}
            onClick={() => onSelect(t)}
            className={`w-full text-left px-2 py-1.5 rounded text-[10px] ${currentEasing === t ? "bg-cyan-500/20 text-cyan-400" : "text-gray-300 hover:bg-white/5"}`}
          >
            {t}
          </button>
        ))}
      </div>
    </div>
  );
};

const ASPECT_RATIOS = [
  {
    label: "16:9",
    value: "16/9",
    icon: LucideIcons.RectangleHorizontal,
    desc: "YouTube",
  },
  {
    label: "9:16",
    value: "9/16",
    icon: LucideIcons.Smartphone,
    desc: "Shorts/TikTok",
  },
  { label: "1:1", value: "1/1", icon: LucideIcons.Square, desc: "Square" },
  { label: "4:3", value: "4/3", icon: LucideIcons.Monitor, desc: "Classic" },
];

import { subscribeToToast } from "./utils/toastHelper";
import { Toaster, toast } from "sonner";

export const isLayerInVisibleView = (char: any, partId: string) => {
    if (!char || !char[partId]) return true;
    let currentId: string | undefined = partId;
    while (currentId && currentId !== 'root') {
        const curr = char[currentId];
        if (!curr) break;
        const isViewNode = curr.tags?.includes('View') || curr.label?.toLowerCase()?.includes('view');
        if (isViewNode && (curr.isVisible === false || curr.opacity === 0)) return false;
        currentId = curr.parentId;
    }
    return true;
};

export const getDescendants = (char: any, parentId: string): string[] => {
    if (!char) return [];
    const list: string[] = [];
    const children = Object.values(char).filter((p: any) => p && p.parentId === parentId);
    children.forEach((child: any) => {
        list.push(child.id);
        list.push(...getDescendants(char, child.id));
    });
    return list;
};

export const getSortedLayerTree = (char: any): { part: any; depth: number }[] => {
    if (!char) return [];
    const result: { part: any; depth: number }[] = [];
    const parts = Object.values(char) as any[];
    
    const roots = parts.filter(p => !p.parentId || p.parentId === 'root' || !char[p.parentId]);
    roots.sort((a, b) => (b.zIndex || 0) - (a.zIndex || 0));
    const traversed = new Set<string>();
    
    const traverse = (partId: string, depth: number) => {
        if (traversed.has(partId)) return;
        traversed.add(partId);
        const part = char[partId];
        if (!part) return;
        result.push({ part, depth });
        
        const children = parts.filter(p => p.parentId === partId);
        children.sort((a, b) => (b.zIndex || 0) - (a.zIndex || 0));
        children.forEach(c => traverse(c.id, depth + 1));
    };
    
    roots.forEach(r => traverse(r.id, 0));
    parts.forEach(p => {
        if (!traversed.has(p.id)) {
            traverse(p.id, 0);
        }
    });
    return result;
};

const DEFAULT_CHARACTER_FILTERS = {
  saturation: 100,
  contrast: 100,
  brightness: 100,
  sharpness: 0,
  eyeSquint: 0,
  pupilX: 0,
  pupilY: 0,
  headTurn: 0,
  exprState: 0
};

const DEFAULT_BONE_TRANSFORMS = {};

export const App = () => {
  // Handle GitHub OAuth Callback page immediately before rendering any heavy state
  if (typeof window !== "undefined" && window.location.pathname.startsWith("/auth/callback")) {
    return <GitHubAuthCallback />;
  }

  const { t, setLanguage } = useLanguage();

  const engine = useAudioEngine();
  const {
    playbackState,
    vocalTrack,
    setVocalTrack,
    instTrack,
    setInstTrack,
    currentViseme,
    editTrackBuffer,
    sliceTrack,
    getMixedAudioStream,
    setIsLocalMuted,
    setTotalDuration,
    setTrimRange,
  } = engine;

  // --- APP MODE STATE ---
  const [isVerifyingPayment, setIsVerifyingPayment] = useState(false);
  const [showSuccessSplash, setShowSuccessSplash] = useState(false);
  const [successPlan, setSuccessPlan] = useState("");
  const [successExpiry, setSuccessExpiry] = useState("");
  const [verificationStatus, setVerificationStatus] = useState<
    "verifying" | "verified"
  >("verifying");
  const [showSplash, setShowSplash] = useState(true);
  const [showSignIn, setShowSignIn] = useState(() => {
    const userStr = localStorage.getItem("app_user");
    if (!userStr) {
      return true;
    }
    try {
      const u = JSON.parse(userStr);
      // Force legacy users to re-auth
      if (!u.email) {
        localStorage.removeItem("app_user");
        return true;
      }
    } catch (e) {}
    return false;
  });
  const [showSubscription, setShowSubscription] = useState(() => {
    // If we're verifying a payment from a redirect, hide the subscription panel initially
    const params = new URLSearchParams(window.location.search);
    if (params.get("reference") || params.get("trxref")) return false;

    const userStr = localStorage.getItem("app_user");
    if (userStr) {
      try {
        const u = JSON.parse(userStr);
        if (u.subscription_status === "active" && u.subscription_expiry) {
          const expiryDate = new Date(u.subscription_expiry);
          if (new Date() > expiryDate) {
            return false; // Will trigger expiry logic
          }
        }
        return (
          u.subscription_status === "none" ||
          u.subscription_status === "expired"
        );
      } catch (e) {}
    }
    return false;
  });
  const [isExpired, setIsExpired] = useState(() => {
    if (localStorage.getItem("dev_override") === "true") return false;
    const userStr = localStorage.getItem("app_user");
    if (userStr) {
      try {
        const u = JSON.parse(userStr);
        if (
          (u.subscription_status === "active" ||
            u.subscription_status === "expired") &&
          u.subscription_expiry
        ) {
          const expiryDate = new Date(u.subscription_expiry);
          if (new Date() > expiryDate || u.subscription_status === "expired") {
            return true;
          }
        }
      } catch (e) {}
    }
    return false;
  });

  const [justRenewed, setJustRenewed] = useState(false); // To prevent stale sync after payment
  const [showLanguageSelector, setShowLanguageSelector] = useState(() => {
    return !localStorage.getItem("app_language_preference");
  });
  const [appMode, setAppMode] = useState<
    "PROJECT_MANAGER" | "EDITOR" | "CLOSED"
  >("PROJECT_MANAGER");

  const [user, setUser] = useState<any>(() => {
    const userStr = localStorage.getItem("app_user");
    if (!userStr) return null;
    try {
      const u = JSON.parse(userStr);
      return u;
    } catch (e) {
      return null;
    }
  });

  const [isLowPerformanceMode, setIsLowPerformanceMode] = useState(() => {
    const saved = localStorage.getItem("app_low_perf_mode");
    if (saved !== null) return saved === "true";
    // Auto-detect mobile or low-end devices
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    const isSmallScreen = window.innerWidth < 1024;
    return isMobile || isSmallScreen;
  });

  const [orientation, setOrientation] = useState<"portrait" | "landscape">(
    window.innerWidth > window.innerHeight ? "landscape" : "portrait",
  );
  const [isDesktopLike, setIsDesktopLike] = useState(window.innerWidth >= 1024);

  useEffect(() => {
    const handleResize = () => {
      setOrientation(
        window.innerWidth > window.innerHeight ? "landscape" : "portrait",
      );
      setIsDesktopLike(window.innerWidth >= 1024);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const [activeTheme, setActiveTheme] = useState<ThemeType>(() => {
    const saved = localStorage.getItem("animato_theme");
    return (saved as ThemeType) || "midnight";
  });

  const toggleLowPerformanceMode = () => {
    const next = !isLowPerformanceMode;
    setIsLowPerformanceMode(next);
    localStorage.setItem("app_low_perf_mode", String(next));
  };

  const handleThemeChange = (themeId: ThemeType) => {
    setActiveTheme(themeId);
    localStorage.setItem("animato_theme", themeId);
  };

  useEffect(() => {
    localStorage.setItem("app_currency", "NGN");
    requestAllPermissions();

    const restoreSession = sessionStorage.getItem("app_update_restore_state");
    if (restoreSession) {
      sessionStorage.removeItem("app_update_restore_state");
      try {
        const state = JSON.parse(restoreSession);
        if (state.appMode === "EDITOR" && state.projectId) {
          handleLoadSavedProject(state.projectId);
        } else if (state.appMode) {
          setAppMode(state.appMode);
        }
      } catch (e) {
        console.error("Failed to restore session state", e);
      }
    }
  }, []);

  useEffect(() => {
    if (user) {
      if (user.language) {
        setLanguage(user.language);
      }

      const checkSubscription = async () => {
        if (!navigator.onLine) return;
        // Don't sync if debug force expiry is on
        const isDebug = localStorage.getItem("debug_force_expiry") === "true";
        if (isDebug) return;

        // Skip if we just renewed to prevent accidental revert to stale status
        if (justRenewed) return;

        try {
          const data = await backend.syncUser(user.email);
          if (data.success && data.user) {
            const oldUser = user;
            localStorage.setItem("app_user", JSON.stringify(data.user));
            setUser(data.user);

            if (oldUser?.last_active_at) {
              const awayMs =
                Date.now() - new Date(oldUser.last_active_at).getTime();
              const awayHours = Math.floor(awayMs / (1000 * 60 * 60));
              if (awayHours > 0) {
                showToast(`Welcome back!`);
              }
            }

            if (
              data.user.subscription_status === "none" ||
              data.user.subscription_status === "expired"
            ) {
              setShowSubscription(true);
            } else {
              setShowSubscription(false);
              setIsExpired(false);
            }
          }
        } catch (e) {
          console.warn("Auto-sync subscription failed", e);
        }
      };

      // Don't sync if we are currently verifying a redirect
      const params = new URLSearchParams(window.location.search);
      const isRedirecting = !!(params.get("reference") || params.get("trxref"));

      if (!isVerifyingPayment && !isRedirecting) {
        checkSubscription();
      }
    }
  }, [user?.email, isVerifyingPayment, showSignIn]);
  // Run when sign in completes

  // Debug effect & Expiration countdown
  useEffect(() => {
    const debugExpired = localStorage.getItem("debug_force_expiry");
    if (debugExpired === "true" && user && !isVerifyingPayment) {
      if (user.subscription_status !== "expired") {
        const updated = { ...user, subscription_status: "expired" };
        setUser(updated);
        localStorage.setItem("app_user", JSON.stringify(updated));
      }
      if (!showSubscription) {
        setShowSubscription(true);
      }
    }

    if (
      !user ||
      user.subscription_status !== "active" ||
      !user.subscription_expiry
    )
      return;

    const intervalId = setInterval(() => {
      const expiryDate = new Date(user.subscription_expiry);
      if (Date.now() > expiryDate.getTime()) {
        const updatedUser = { ...user, subscription_status: "expired" };
        localStorage.setItem("app_user", JSON.stringify(updatedUser));
        setUser(updatedUser);
        setIsExpired(true);
        setShowSubscription(true); // Ensure modal pops up
      }
    }, 5000);

    return () => clearInterval(intervalId);
  }, [user, showSubscription]);

  // Handle Paystack callback & Redirect Logic
  useEffect(() => {
    const handlePaymentCallback = async () => {
      const pathname = window.location.pathname;
      const params = new URLSearchParams(window.location.search);
      const reference = params.get("reference") || params.get("trxref");

      // If we have a reference, clear the debug force expiry flag immediately
      if (reference) {
        localStorage.removeItem("debug_force_expiry");
      }

      const extendedMatch = pathname.match(
        /\/payment\/([^/]+)\/([^/]+)\/([^/]+)?/,
      );
      
      const storeMatch = pathname.match(
        /\/store-payment\/([^/]+)\/([^/]+)\/([^/]+)?/,
      );

      // If user cancelled, clear URL and abort
      if (extendedMatch && !reference) {
        let cancelEmail = decodeURIComponent(extendedMatch[1])
          .toLowerCase()
          .trim();
        if (!cancelEmail && user?.email) cancelEmail = user.email;
        if (cancelEmail) {
          backend
            .paystackCancel(cancelEmail)
            .then(() => {
              if (user && user.email === cancelEmail) {
                const updated = {
                  ...user,
                  subscription_status: "none",
                  subscription_type: "none",
                  subscription_expiry: null,
                };
                setUser(updated);
                localStorage.setItem("app_user", JSON.stringify(updated));
              }
            })
            .catch(console.error);
        }
        window.history.replaceState({}, document.title, "/");
        return;
      }

      if (reference && storeMatch) {
         // Store payments are handled entirely within Store.tsx
         // we just don't want the subscription logic catching this reference.
         return; 
      }

      if (reference && !storeMatch) {
        try {
          // 1. Resolve targeting: URL > Storage/Auth
          let pathEmail = "";
          let pathPrice = "";
          let pathPlan = "";
          if (extendedMatch) {
            pathEmail = decodeURIComponent(extendedMatch[1])
              .toLowerCase()
              .trim();
            pathPrice = extendedMatch[2];
            pathPlan = extendedMatch[3];
          }

          const pendingEmail = localStorage.getItem("pending_app_payment");
          const userStr = localStorage.getItem("app_user");
          let u = userStr ? JSON.parse(userStr) : null;

          const email = pathEmail || u?.email || pendingEmail || "";
          const rawPlan =
            pathPlan ||
            localStorage.getItem("pending_app_plan") ||
            localStorage.getItem("selected_subscription_plan") ||
            "monthly";
          const pendingPlan = rawPlan.split("/")[0];
          localStorage.setItem("selected_subscription_plan", pendingPlan);
          localStorage.setItem("pending_app_plan", pendingPlan);

          // 2. OPTIMISTIC UI UPDATE
          const durationDays =
            pendingPlan === "daily"
              ? 1
              : pendingPlan === "weekly"
                ? 7
                : pendingPlan === "yearly"
                  ? 365
                  : 30;

          const expiryDate = new Date();
          expiryDate.setDate(expiryDate.getDate() + durationDays);

          if (!u && email) {
            u = {
              email: email,
              subscription_status: "active",
              subscription_type: pendingPlan,
              subscription_expiry: expiryDate.toISOString(),
            };
          } else if (u) {
            u.subscription_status = "active";
            u.subscription_type = pendingPlan;
            u.subscription_expiry = expiryDate.toISOString();
          }

          if (u) {
            localStorage.setItem("app_user", JSON.stringify(u));
            setUser(u);
            setIsExpired(false);
          }

          localStorage.removeItem("pending_app_payment");
          localStorage.removeItem("pending_app_plan");

          // 3. SHOW AUTOMATIC VERIFICATION UI
          setSuccessPlan(pendingPlan);
          setSuccessExpiry(expiryDate.toISOString());
          setShowSuccessSplash(true);
          setIsVerifyingPayment(true);
          setVerificationStatus("verifying");

          // 4. Update Database (Ensures the "subscription sheet" is filled)
          try {
            const amountPaidNumber = parseFloat(pathPrice || (pendingPlan === "daily" ? "100" : pendingPlan === "weekly" ? "500" : pendingPlan === "yearly" ? "10000" : "2000"));
            const data = await backend.paystackVerify({
              reference,
              email,
              amount: amountPaidNumber.toString(),
              planType: pendingPlan,
              country: u?.country || "",
              language: u?.language || "",
              password: u?.password || "",
            });

            // Handle Referral Code logic
            const pendingRefId = localStorage.getItem('pending_referral_code');
            const savedRefId = localStorage.getItem(`saved_ref_used_${email}`);
            const isFirstTime = !localStorage.getItem('first_subscription_done');
            
            const activeRefId = pendingRefId || savedRefId;
            
            // Always dispatch a credit call to `/api/creator/referral/credit` so the server can apply
            // 10% payouts dynamically on both first-time and renewal subscriptions.
            try {
                let creditSuccess = false;
                try {
                    const response = await fetch('/api/creator/referral/credit', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ 
                            referralId: activeRefId || undefined, 
                            subscriptionAmount: amountPaidNumber,
                            isFirstTime: isFirstTime && !!pendingRefId,
                            email: email
                        })
                    });
                    if (response.ok) {
                        const creditData = await response.json();
                        if (creditData && creditData.status) {
                            creditSuccess = true;
                        }
                    }
                } catch (err) {
                    console.warn("Backend referral credit failed; falling back to client-side direct Firestore mapping...", err);
                }

                if (!creditSuccess) {
                    console.log("Running client-side direct-Firestore fallback for referral credit");
                    const cleanEmail = email ? String(email).toLowerCase().trim() : "";
                    let finalReferralId = activeRefId ? String(activeRefId).trim() : "";

                    if (cleanEmail) {
                        const connectionRef = doc(db, 'referred_subscribers', cleanEmail);
                        const connectionSnap = await getDoc(connectionRef);
                        if (finalReferralId) {
                            if (!connectionSnap.exists()) {
                                await setDoc(connectionRef, {
                                    referralId: finalReferralId,
                                    createdAt: serverTimestamp()
                                });
                            }
                        } else if (connectionSnap.exists()) {
                            finalReferralId = connectionSnap.data()?.referralId || "";
                        }
                    }

                    if (finalReferralId) {
                        const refRef = doc(db, 'referrals', finalReferralId);
                        const refSnap = await getDoc(refRef);
                        
                        let foundDoc: any = refSnap.exists() ? refSnap : null;
                        if (!foundDoc) {
                            const q = query(collection(db, 'referrals'), where('referralId', '==', finalReferralId));
                            const qSnap = await getDocs(q);
                            if (!qSnap.empty) {
                                foundDoc = qSnap.docs[0];
                            }
                        }

                        if (foundDoc) {
                            const refDocData = foundDoc.data();
                            let currentPayout = parseFloat(String(refDocData.payout || "0"));
                            let currentRefs = parseInt(String(refDocData.numberOfReferences || "0"), 10);

                            const addedPayout = Number(amountPaidNumber || 0) * 0.1;
                            currentPayout += addedPayout;

                            if (isFirstTime && !!pendingRefId) {
                                currentRefs += 1;
                            }

                            await updateDoc(foundDoc.ref, {
                                payout: currentPayout,
                                numberOfReferences: currentRefs,
                                updatedAt: serverTimestamp()
                            });
                        }
                    }
                }
            } catch(e) {
                console.error("Referral credit error", e);
            }

            if (isFirstTime) {
                localStorage.setItem('first_subscription_done', 'true');
            }
            if (pendingRefId) {
                localStorage.setItem(`saved_ref_used_${email}`, pendingRefId);
                localStorage.removeItem('pending_referral_code');
            }

            if (data.user) {
              localStorage.setItem("app_user", JSON.stringify(data.user));
              setUser(data.user);
              setIsExpired(false);
              setJustRenewed(true);
              setTimeout(() => setJustRenewed(false), 30000); // 30s cooldown
            }
            setVerificationStatus("verified");

            // 5. Take them to Project Manager AUTOMATICALLY
            setTimeout(() => {
              setIsVerifyingPayment(false);
              setShowSuccessSplash(false);
              setShowSubscription(false);
              setAppMode("PROJECT_MANAGER");
              setIsExpired(false);
              localStorage.removeItem("debug_force_expiry");
              window.history.replaceState({}, document.title, "/");
            }, 4000);
          } catch (e: any) {
            console.error("[Verify] Verification failed:", e.message || e);
            showAppToast(
              "Database Error: Could not save your subscription details. Verification failed.",
            );
            // Ensure they don't get past subscription screen if verification failed
            setIsVerifyingPayment(false);
            setShowSuccessSplash(false);
            // Keep setShowSubscription(true) so they stay on the subscription screen
            setVerificationStatus("verifying");
          }
        } catch (e: any) {
          console.error("Verification logic failed", e.message || e);
          setIsVerifyingPayment(false);
          window.history.replaceState({}, document.title, "/");
        }
      }
    };
    handlePaymentCallback();
  }, []);

  // --- PROJECT META ---
  const [currentProjectId, setCurrentProjectId] = useState<string>(
    `proj_${Date.now()}`,
  );
  const [projectName, setProjectName] = useState("Untitled Project");
  const [projectType, setProjectType] = useState<ProjectType>("CHARACTER"); // Default
  const [savedProjects, setSavedProjects] = useState<ProjectMetadata[]>([]);
  const [openingProjectState, setOpeningProjectState] = useState<{
    id: string;
    name: string;
    progress: number;
    step: string;
  } | null>(null);

  // --- CHARACTER EDITOR STATE ---
  const [theme] = useState<"light" | "dark">("dark");
  const [isEditMode, setIsEditMode] = useState(false);
  const [activeTrackId, setActiveTrackId] = useState<"vocal" | "inst">("vocal");
  const [selection, setSelection] = useState<{
    start: number;
    end: number;
  } | null>(null);
  const [isLooping, setIsLooping] = useState(false);
  const [isInteracting, setIsInteracting] = useState(false);
  const [isCharacterBuilderOpen, setIsCharacterBuilderOpen] = useState(false);
  const [pendingImportFile, setPendingImportFile] = useState<File | null>(null);
  const [isCharacterStudioModalOpen, setIsCharacterStudioModalOpen] =
    useState(false);
  const [newCharacterName, setNewCharacterName] = useState("New Character");
  const [activeLeftTab, setActiveLeftTab] = useState<"MIX" | "HIERARCHY">(
    "MIX",
  );

  const [assemblerSession, setAssemblerSession] =
    useState<AssemblerSession | null>(null);
  const [isLeftPanelOpen, setIsLeftPanelOpen] = useState(false);
  const [activeBottomTab, setActiveBottomTab] = useState<
    "TIMELINE" | "SCENE" | "CHAR" | "FACE" | "FX" | "LIP" | "KINEMATICS" | "LOOP" | "VIEW" | "SWAP" | "ADJUST" | "TEXT"
  >("TIMELINE");
  const [isTabsVisible, setIsTabsVisible] = useState(false);
  const [isAnchorMode, setIsAnchorMode] = useState(false);
  
  const [showGrid, setShowGrid] = useState(false);
  const [activeBoneId, setActiveBoneId] = useState<string | null>(null);
  const [activeRigTool, setActiveRigTool] = useState<
    "BONE" | "HAND" | "DELETE" | "MOVE" | "SCALE"
  >("BONE");
  const [rigType, setRigType] = useState<"MESH" | "HUMAN">("MESH");
  const [activeLightId, setActiveLightId] = useState<string | null>(null);
  const [lightSources, setLightSources] = useState<LightSource[]>([]);
  const [activeFxTab, setActiveFxTab] = useState<
    "SUN" | "BULB" | "LIGHTNING" | "SETTINGS"
  >("SUN");
  const [ambientLightLevel, setAmbientLightLevel] = useState(0.15);
  const [history, setHistory] = useState<HistoryState[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [easingMenuOpen, setEasingMenuOpen] = useState(false);
  const [easingMenuPos, setEasingMenuPos] = useState({ x: 0, y: 0 });
  const [editingKeyframeId, setEditingKeyframeId] = useState<string | null>(
    null,
  );
  const [propertyTarget, setPropertyTarget] = useState<string>("root");
  const [selectedPartIds, setSelectedPartIds] = useState<string[]>(["root"]);
  const [isSelectionMenuOpen, setIsSelectionMenuOpen] = useState(false);
  const [customTotalDuration, setCustomTotalDuration] = useState<number | null>(null);
  const [aspectRatio, setAspectRatio] = useState("16/9");
  const [canvasBgColor, setCanvasBgColor] = useState("#ffffff");
  const [isColorPickerOpen, setIsColorPickerOpen] = useState(false);
  const colorButtonRef = useRef<HTMLButtonElement>(null);
  const [isCanvasTransparent, setIsCanvasTransparent] = useState(false);
  const [backgroundImage, setBackgroundImage] = useState<BackgroundImageState>({
    url: null,
    width: 0,
    height: 0,
  });
  const [availableBackgrounds, setAvailableBackgrounds] = useState<BackgroundImageState[]>([]);
  const [backgroundTransform, setBackgroundTransform] = useState({
    zoom: 100,
    x: 50,
    y: 50,
    blur: 0,
    brightness: 100,
    contrast: 100,
    saturation: 100,
  });
  const [linkBgToCamera, setLinkBgToCamera] = useState(false);
  const bgInputRef = useRef<HTMLInputElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const unsavedCharacterIdRef = useRef<string | null>(null);

  const [texts, setTexts] = useState<SceneText[]>([]);
  const [selectedTextId, setSelectedTextId] = useState<string | null>(null);
  const [activeSceneSubTab, setActiveSceneSubTab] = useState<"STAGE" | "TEXT">("STAGE");

  const [stageScale, setStageScale] = useState(() => {
    if (typeof window !== 'undefined') {
       return Math.min(window.innerWidth / (16 * 120), window.innerHeight / (9 * 120));
    }
    return 1;
  });
  useEffect(() => {
    if (!canvasContainerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        // The container might be momentarily 0 during layout flips
        if (width > 0 && height > 0) {
           const tw = (Number(aspectRatio.split(/[:/]/)[0]) || 16) * 120;
           const th = (Number(aspectRatio.split(/[:/]/)[1]) || 9) * 120;
           setStageScale(Math.min(width / tw, height / th));
        }
      }
    });
    observer.observe(canvasContainerRef.current);
    return () => observer.disconnect();
  }, [aspectRatio]);

  const [thumbnailScale, setThumbnailScale] = useState(1);
  const [characters, setCharacters] = useState<
    {
      id: string;
      name: string;
      composition: CharacterComposition;
      assemblerSession?: AssemblerSession | null;
      origin: "ASSEMBLER" | "DESIGNER" | "IMPORTER" | null;
      thumbnail?: string;
      visemeMap?: Record<VisemeShape, string | null>;
      boneTransforms?: Record<
        string,
        { rotation: number; scaleX: number; scaleY: number }
      >;
    }[]
  >([]);

  const charactersRef = useRef(characters);
  useEffect(() => {
    charactersRef.current = characters;
  }, [characters]);

  const [activeSceneCharacterId, setActiveSceneCharacterId] = useState<
    string | null
  >(null);

  const [lipSyncTargetId, setLipSyncTargetId] = useState<string | "ALL">("ALL");

  const handleLipSyncTargetChange = (newTarget: string | "ALL") => {
    const targetValue = newTarget === "ALL" ? undefined : newTarget;

    // Retarget existing auto keyframes to the newly selected character
    setLipSyncKeyframes((prev) =>
      prev.map((k) => {
        if (!k.isManual) {
          return { ...k, targetId: targetValue };
        }
        return k;
      }),
    );

    setLipSyncTargetId(newTarget);
  };

  const getCharacterViseme = (charId: string) => {
    if (
      manualVisemeOverride &&
      (activeSceneCharacterId === charId || activeSceneCharacterId === "ALL")
    ) {
      const targets = calculateInstantVisemeParams(manualVisemeOverride, 1.0);
      return {
        shape: manualVisemeOverride,
        intensity: 1,
        openness: targets.openness,
        spread: targets.spread,
        squeeze: targets.squeeze,
        spectralFlux: 0,
        plosiveScore: 0,
      };
    }

    const charKeys = lipSyncKeyframes.filter(
      (k) => !k.targetId || k.targetId === charId,
    );
    if (charKeys.length === 0)
      return {
        shape: VisemeShape.REST,
        intensity: 0,
        openness: 0,
        spread: 0,
        squeeze: 1,
        spectralFlux: 0,
        plosiveScore: 0,
      };

    const t = playbackState.currentTime;
    let low = 0,
      high = charKeys.length - 1,
      idx = 0;
    while (low <= high) {
      const mid = (low + high) >>> 1;
      if (charKeys[mid].time <= t) {
        idx = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    const prev = charKeys[idx];
    const next = charKeys[idx + 1];

    if (!prev || prev.time > t)
      return {
        shape: VisemeShape.REST,
        intensity: 0,
        openness: 0,
        spread: 0,
        squeeze: 1,
        spectralFlux: 0,
        plosiveScore: 0,
      };
    if (!next) {
      const targets = calculateInstantVisemeParams(prev.shape, prev.intensity);
      return {
        shape: prev.shape,
        intensity: prev.intensity,
        openness: targets.openness,
        spread: targets.spread,
        squeeze: targets.squeeze,
        spectralFlux: 0,
        plosiveScore: 0,
      };
    }

    const span = next.time - prev.time;
    const progress = (t - prev.time) / (span || 0.001);
    const interpolatedIntensity =
      prev.intensity + (next.intensity - prev.intensity) * progress;
    const targets = calculateInstantVisemeParams(
      prev.shape,
      interpolatedIntensity,
    );

    return {
      shape: prev.shape,
      intensity: interpolatedIntensity,
      openness: targets.openness,
      spread: targets.spread,
      squeeze: targets.squeeze,
      spectralFlux: 0,
      plosiveScore: 0,
    };
  };

  const character = useMemo(
    () =>
      characters.find((c) => c.id === activeSceneCharacterId)?.composition ||
      null,
    [characters, activeSceneCharacterId],
  );
  const activeCharacterInstance = useMemo(
    () => characters.find((c) => c.id === activeSceneCharacterId) || null,
    [characters, activeSceneCharacterId],
  );

  useEffect(() => {
    if (
      activeSceneCharacterId &&
      activeSceneCharacterId !== "ALL" &&
      character
    ) {
      if (!character[propertyTarget]) {
        const newTarget = character["root"]
          ? "root"
          : Object.keys(character)[0] || "root";
        setPropertyTarget(newTarget);
        if (!selectedPartIds.includes(newTarget)) {
          setSelectedPartIds([newTarget]);
        }
      } else if (!selectedPartIds.length) {
        // Failsafe in case nothing is selected
        setSelectedPartIds([propertyTarget]);
      }
    }
  }, [activeSceneCharacterId, character, propertyTarget, selectedPartIds]);

  const setCharacter = useCallback(
    (
      newCompOrUpdater:
        | CharacterComposition
        | null
        | ((prev: CharacterComposition | null) => CharacterComposition | null),
    ) => {
      if (!activeSceneCharacterId) return;
      setCharacters((prev) =>
        prev.map((c) => {
          if (c.id === activeSceneCharacterId) {
            const newComp =
              typeof newCompOrUpdater === "function"
                ? newCompOrUpdater(c.composition as CharacterComposition | null)
                : newCompOrUpdater;
            return { ...c, composition: newComp || {} };
          }
          return c;
        }),
      );
    },
    [activeSceneCharacterId],
  );

  const [characterFiltersMap, setCharacterFiltersMap] = useState<
    Record<
      string,
      {
        saturation: number;
        contrast: number;
        brightness: number;
        sharpness: number;
        eyeSquint?: number;
        pupilX?: number;
        pupilY?: number;
        exprState?: number; headTurn?: number;
      }
    >
  >({});

  const currentCharacterFilters = useMemo(() => {
    if (activeSceneCharacterId === "ALL") {
      return { saturation: 100, contrast: 100, brightness: 100, sharpness: 0, eyeSquint: 0, pupilX: 0, pupilY: 0, exprState: 0, headTurn: 0 };
    }
    if (activeSceneCharacterId && propertyTarget && propertyTarget !== "root") {
      const char = characters.find((c) => c.id === activeSceneCharacterId);
      const partFilters = char?.composition?.[propertyTarget]?.filters;
      const globalFilters = characterFiltersMap[activeSceneCharacterId] || {
          saturation: 100,
          contrast: 100,
          brightness: 100,
          sharpness: 0,
          eyeSquint: 0,
          pupilX: 0,
          pupilY: 0,
          exprState: 0,
          headTurn: 0
      };
      if (partFilters) return { ...globalFilters, ...partFilters };
      return globalFilters;
    }
    return activeSceneCharacterId
      ? characterFiltersMap[activeSceneCharacterId] || {
          saturation: 100,
          contrast: 100,
          brightness: 100,
          sharpness: 0,
          eyeSquint: 0,
          pupilX: 0,
          pupilY: 0,
          exprState: 0
        }
      : { saturation: 100, contrast: 100, brightness: 100, sharpness: 0, eyeSquint: 0, pupilX: 0, pupilY: 0, exprState: 0 };
  }, [activeSceneCharacterId, characterFiltersMap, propertyTarget, characters]);

  const characterFilters = currentCharacterFilters;

  const handleBoneSelect = useCallback((partId: string, boneId: string | null) => {
    setActiveBoneId(boneId);
  }, []);

  const handleAnchorChange = useCallback((partId: string, x: number, y: number) => {
    let finalUpdates: Record<string, number> | null = null;
    setCharacter((prev: any) => {
        if (!prev) return prev;
        const p = prev[partId];
        if (!p) return prev;
        const t = p.transform;
        const oldX = t.anchorX ?? 50;
        const oldY = t.anchorY ?? 50;
        const pos = compensateAnchorShift(
            t.x, t.y, t.rotation, t.scaleX, t.scaleY, !!t.flipX, !!t.flipY,
            oldX, oldY, x, y,
            p.width || 150, p.height || 150
        );
        finalUpdates = {
            [`part:${activeSceneCharacterId}:${partId}:anchorX`]: x,
            [`part:${activeSceneCharacterId}:${partId}:anchorY`]: y,
            [`part:${activeSceneCharacterId}:${partId}:x`]: pos.x,
            [`part:${activeSceneCharacterId}:${partId}:y`]: pos.y
        };
        return {
            ...prev,
            [partId]: {
                ...p,
                transform: {
                    ...p.transform,
                    anchorX: x,
                    anchorY: y,
                    x: pos.x,
                    y: pos.y
                }
            }
        };
    });
    setShouldRecordHistory(true);
    if (finalUpdates && (window as any)._hackyAutoKeyFire) {
        (window as any)._hackyAutoKeyFire(finalUpdates);
    }
  }, [setCharacter, activeSceneCharacterId]);

  const setCharacterFilters = useCallback(
    (
      val: React.SetStateAction<{
        saturation: number;
        contrast: number;
        brightness: number;
        sharpness: number;
      }>,
    ) => {
      if (!activeSceneCharacterId) return;
      setCharacterFiltersMap((prev) => {
        const charFilters = prev[activeSceneCharacterId] || {
          saturation: 100,
          contrast: 100,
          brightness: 100,
          sharpness: 0,
        };
        const newVal = typeof val === "function" ? val(charFilters) : val;
        return { ...prev, [activeSceneCharacterId]: newVal };
      });
    },
    [activeSceneCharacterId],
  );
  const [cameraTransform, setCameraTransform] = useState({
    x: 0,
    y: 0,
    scale: 1,
    rotation: 0,
  });
  const [maxZoomLimit, setMaxZoomLimit] = useState(5.0); // Allow user to customize slider thresholds
  const lastTimeProcessedRef = useRef(0);
  const [keyframes, setKeyframes] = useState<Keyframe[]>([]);
  const sortedKeyframes = useMemo(
    () => [...keyframes].sort((a, b) => a.time - b.time),
    [keyframes],
  );
  const kfTracks = useMemo(
    () => KeyframeEngine.getTracks(sortedKeyframes),
    [sortedKeyframes],
  );
  const [lipSyncKeyframes, setLipSyncKeyframes] = useState<LipSyncKeyframe[]>(
    [],
  );

  const [isLipSyncModalOpen, setIsLipSyncModalOpen] = useState(false);
  const [clipboardKeyframe, setClipboardKeyframe] = useState<Keyframe | null>(
    null,
  );
  const [autoKeyEnabled, setAutoKeyEnabled] = useState(false);
  const currentBoneTransformsMemo = useMemo(
    () =>
      characters.find((c) => c.id === activeSceneCharacterId)?.boneTransforms ||
      {},
    [characters, activeSceneCharacterId],
  );

  const setCurrentBoneTransforms = useCallback(
    (
      val: React.SetStateAction<
        Record<string, { rotation: number; scaleX: number; scaleY: number }>
      >,
    ) => {
      if (!activeSceneCharacterId) return;
      setCharacters((prev) =>
        prev.map((c) =>
          c.id === activeSceneCharacterId
            ? {
                ...c,
                boneTransforms:
                  typeof val === "function" ? val(c.boneTransforms || {}) : val,
              }
            : c,
        ),
      );
    },
    [activeSceneCharacterId],
  );

  const currentBoneTransforms = activeSceneCharacterId
    ? currentBoneTransformsMemo
    : {};
  const [selectedKeyframeId, setSelectedKeyframeId] = useState<string | null>(
    null,
  );
  const [isDraggingChar, setIsDraggingChar] = useState(false);
  const [isDraggingLight, setIsDraggingLight] = useState(false);
  const [draggingLightId, setDraggingLightId] = useState<string | null>(null);
  const [isDraggingCamera, setIsDraggingCamera] = useState(false);
  const dragStartRef = useRef({
    startX: 0,
    startY: 0,
    initialX: 0,
    initialY: 0,
  });
  const preExportUiState = useRef({
    isLeftPanelOpen: false,
    isTabsVisible: false,
    currentTime: 0,
  });
  const [isVisemeMapperOpen, setIsVisemeMapperOpen] = useState(false);
  const [visemeMap, setVisemeMap] = useState<
    Record<VisemeShape, string | null>
  >({
    [VisemeShape.REST]: null,
    [VisemeShape.AI]: null,
    [VisemeShape.E]: null,
    [VisemeShape.O]: null,
    [VisemeShape.U]: null,
    [VisemeShape.FV]: null,
    [VisemeShape.L]: null,
    [VisemeShape.MBP]: null,
    [VisemeShape.CONS]: null,
  });
  const [manualVisemeOverride, setManualVisemeOverride] =
    useState<VisemeShape | null>(null);
  const [zoomLevel, setZoomLevel] = useState(1.5);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [isPresentationMode, setIsPresentationMode] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [customCSS, setCustomCSS] = useState("");
  const [shadowConfig, setShadowConfig] = useState<ShadowConfig>({
    enabled: false,
    opacity: 0.3,
    blur: 5,
    skewX: -20,
    scaleY: 0.3,
    offsetX: 10,
    offsetY: 10,
    color: "#000000",
  });
  const [depthShadowConfig, setDepthShadowConfig] = useState<ShadowConfig>({
    enabled: false,
    opacity: 0.2,
    blur: 10,
    skewX: 0,
    scaleY: 1,
    offsetX: 0,
    offsetY: 5,
    color: "#000000",
  });
  const [deleteConfirmation, setDeleteConfirmation] = useState<{
    isOpen: boolean;
    trackId: "vocal" | "inst" | null;
  }>({ isOpen: false, trackId: null });
  const [sliceModal, setSliceModal] = useState<{
    isOpen: boolean;
    time: number;
    trackId: "vocal" | "inst";
  }>({ isOpen: false, time: 0, trackId: "vocal" });
  const [extraDuration, setExtraDuration] = useState(0);

  // --- FRAME ANIMATION STATE ---
  const [frameData, setFrameData] = useState<FrameData[]>([]);
  const [frameSettings, setFrameSettings] = useState<FrameSettings | undefined>(
    undefined,
  );

  const projectDuration = useMemo(() => {
    if (customTotalDuration !== null) return customTotalDuration;
    const BASE_DURATION = 5.0;
    const audioMax = Math.max(
      vocalTrack.buffer?.duration || 0,
      instTrack.buffer?.duration || 0,
    );
    let kfMax = 0;
    if (keyframes.length > 0) {
      kfMax = Math.max(kfMax, ...keyframes.map((k) => k.time));
    }
    if (lipSyncKeyframes.length > 0) {
      kfMax = Math.max(kfMax, ...lipSyncKeyframes.map((k) => k.time));
    }

    const contentMax = Math.max(audioMax, kfMax) + extraDuration;
    return Math.max(BASE_DURATION + extraDuration, contentMax);
  }, [
    vocalTrack.buffer,
    instTrack.buffer,
    keyframes,
    lipSyncKeyframes,
    extraDuration,
    customTotalDuration,
  ]);

  const safeDuration = projectDuration;
  const progress = playbackState.currentTime / safeDuration;
  const currentKeyframe = useMemo(
    () => keyframes.find((k) => k.id === editingKeyframeId),
    [keyframes, editingKeyframeId],
  );

  // ... (Keyframe Animation Engine useEffect - kept as is)
  useEffect(() => {
    // 1. Only run if we have keyframes to process
    if (keyframes.length === 0) return;

    // 2. Do not override user if they are currently manipulating a control
    if (isDraggingCamera || isDraggingChar || isInteracting) return;

    const time = playbackState.currentTime;
    const isTimeChanged = time !== lastTimeProcessedRef.current;

    // Only resolve automated tracks if the active playback is running or playhead has shifted
    // This allows manual zoom settings and coordinates to remain fully sticky when paused.
    if (!playbackState.isPlaying && !isTimeChanged) {
      return;
    }
    lastTimeProcessedRef.current = time;

    const currentCharacters = charactersRef.current;
    const animatedState = KeyframeEngine.resolveStateFromTracks(
      kfTracks,
      time,
    );
    const EPSILON = 0.001; // Threshold for change detection

    // 3. Apply Camera Transforms
    const camUpdate: Partial<typeof cameraTransform> = {};
    if (
      animatedState["camera:x"] !== undefined &&
      Math.abs(animatedState["camera:x"] - cameraTransform.x) > EPSILON
    )
      camUpdate.x = animatedState["camera:x"];
    if (
      animatedState["camera:y"] !== undefined &&
      Math.abs(animatedState["camera:y"] - cameraTransform.y) > EPSILON
    )
      camUpdate.y = animatedState["camera:y"];
    if (
      animatedState["camera:scale"] !== undefined &&
      Math.abs(animatedState["camera:scale"] - cameraTransform.scale) > EPSILON
    )
      camUpdate.scale = animatedState["camera:scale"];
    if (
      animatedState["camera:rotation"] !== undefined &&
      Math.abs(animatedState["camera:rotation"] - cameraTransform.rotation) >
        EPSILON
    )
      camUpdate.rotation = animatedState["camera:rotation"];

    // 4. Apply Background Transforms
    const bgUpdate: Partial<typeof backgroundTransform> = {};
    const bgMap: Record<string, keyof typeof backgroundTransform> = {
      "bg:zoom": "zoom",
      "bg:blur": "blur",
      "bg:brightness": "brightness",
      "bg:contrast": "contrast",
      "bg:saturation": "saturation",
      "bg:x": "x",
      "bg:y": "y",
    };
    Object.entries(bgMap).forEach(([key, prop]) => {
      if (
        animatedState[key] !== undefined &&
        Math.abs(animatedState[key] - backgroundTransform[prop]) > EPSILON
      ) {
        bgUpdate[prop] = animatedState[key];
      }
    });

    if (animatedState["bg:index"] !== undefined) {
      const targetIndex = Math.round(animatedState["bg:index"]);
      if (availableBackgrounds[targetIndex]) {
        const bg = availableBackgrounds[targetIndex];
        if (backgroundImage.url !== bg.url) {
           setBackgroundImage(bg);
        }
      }
    }

    // 5. Apply Global Filters
    const filterUpdate: Partial<typeof characterFilters> = {};
    const filterMap: Record<string, keyof typeof characterFilters> = {
      "char:brightness": "brightness",
      "char:contrast": "contrast",
      "char:saturation": "saturation",
      "char:sharpness": "sharpness",
    };
    Object.entries(filterMap).forEach(([key, prop]) => {
      if (
        animatedState[key] !== undefined &&
        Math.abs(animatedState[key] - characterFilters[prop]) > EPSILON
      ) {
        filterUpdate[prop] = animatedState[key];
      }
    });

    // 6. Apply Ambient Light
    const ambientUpdate =
      animatedState["env:ambient"] !== undefined &&
      Math.abs(animatedState["env:ambient"] - ambientLightLevel) > EPSILON
        ? animatedState["env:ambient"]
        : null;

    // Apply Audio State
    const vocalUpdate: Partial<TrackState> = {};
    const instUpdate: Partial<TrackState> = {};
    
    if (animatedState["audio:vocalGain"] !== undefined && Math.abs(animatedState["audio:vocalGain"] - (vocalTrack.gain ?? 1)) > EPSILON) vocalUpdate.gain = animatedState["audio:vocalGain"];
    if (animatedState["audio:vocalPitch"] !== undefined && Math.abs(animatedState["audio:vocalPitch"] - (vocalTrack.pitch ?? 1)) > EPSILON) vocalUpdate.pitch = animatedState["audio:vocalPitch"];
    if (animatedState["audio:vocalSpeed"] !== undefined && Math.abs(animatedState["audio:vocalSpeed"] - (vocalTrack.speed ?? 1)) > EPSILON) vocalUpdate.speed = animatedState["audio:vocalSpeed"];
    
    if (animatedState["audio:instGain"] !== undefined && Math.abs(animatedState["audio:instGain"] - (instTrack.gain ?? 1)) > EPSILON) instUpdate.gain = animatedState["audio:instGain"];
    if (animatedState["audio:instPitch"] !== undefined && Math.abs(animatedState["audio:instPitch"] - (instTrack.pitch ?? 1)) > EPSILON) instUpdate.pitch = animatedState["audio:instPitch"];
    if (animatedState["audio:instSpeed"] !== undefined && Math.abs(animatedState["audio:instSpeed"] - (instTrack.speed ?? 1)) > EPSILON) instUpdate.speed = animatedState["audio:instSpeed"];

    // 7. Apply Puppet Bones & Part Transforms
    const boneUpdatesPerChar: Record<
      string,
      Record<string, { rotation: number; scaleX: number; scaleY: number }>
    > = {};
    const charUpdatesPerChar: Record<
      string,
      Record<
        string,
        Partial<TransformState> & {
          opacity?: number;
          filters?: {
            saturation: number;
            contrast: number;
            brightness: number;
          };
        }
      >
    > = {};
    const characterFilterUpdates: Record<
      string,
      {
        saturation: number;
        contrast: number;
        brightness: number;
        sharpness: number;
      }
    > = {};
    let lightUpdatesMap: Record<string, any> = {};

    Object.keys(animatedState).forEach((key) => {
      const parts = key.split(":");
      if (parts[0] === "puppet" && parts.length === 5) {
        const [_, charId, partId, boneId, prop] = parts;
        const val = animatedState[key];
        const mapKey = `${partId}|${boneId}`;

        if (!boneUpdatesPerChar[charId]) boneUpdatesPerChar[charId] = {};
        const charInstance = currentCharacters.find((c) => c.id === charId);
        const currentBone = charInstance?.boneTransforms?.[mapKey] || {
          rotation: 0,
          scaleX: 1,
          scaleY: 1,
        };

        if (Math.abs((currentBone as any)[prop] - val) > EPSILON) {
          if (!boneUpdatesPerChar[charId][mapKey])
            boneUpdatesPerChar[charId][mapKey] = { ...currentBone };
          (boneUpdatesPerChar[charId][mapKey] as any)[prop] = val;
        }
      } else if (parts[0] === "light" && parts.length === 3) {
        const [_, lightId, prop] = parts;
        const val = animatedState[key];

        if (!lightUpdatesMap[lightId]) lightUpdatesMap[lightId] = {};
        lightUpdatesMap[lightId][prop] = val;
      } else if (parts[0] === "char" && parts.length === 3) {
        const [_, charId, prop] = parts;
        const val = animatedState[key];
        const currentFilters = characterFiltersMap[charId] || {
          saturation: 100,
          contrast: 100,
          brightness: 100,
          sharpness: 0,
          eyeSquint: 0,
          pupilX: 0,
          pupilY: 0,
          exprState: 0
        };
        if (Math.abs((currentFilters as any)[prop] - val) > EPSILON) {
          if (!characterFilterUpdates[charId])
            characterFilterUpdates[charId] = { ...currentFilters };
          (characterFilterUpdates[charId] as any)[prop] = val;
        }
      } else if (parts[0] === "part" && parts.length === 4) {
        const [_, charId, partId, prop] = parts;
        const charInstance = currentCharacters.find((c) => c.id === charId);
        const charComp = charInstance?.composition;
        if (charComp && charComp[partId]) {
          if (!charUpdatesPerChar[charId]) charUpdatesPerChar[charId] = {};
          if (!charUpdatesPerChar[charId][partId])
            charUpdatesPerChar[charId][partId] = {};

          if (prop === "opacity") {
            const currentVal =
              charComp[partId].opacity !== undefined
                ? charComp[partId].opacity
                : 1;
            if (Math.abs(currentVal - animatedState[key]) > EPSILON) {
              charUpdatesPerChar[charId][partId].opacity = animatedState[key];
            }
          } else if (prop === "isVisible") {
             const currentVal = (charComp[partId].isVisible !== false) ? 1 : 0;
             const newVal = animatedState[key] > 0.001; // cross-fade threshold
             if ((currentVal > 0.5) !== newVal) {
                (charUpdatesPerChar[charId][partId] as any).isVisible = newVal;
             }
          } else if (["saturation", "contrast", "brightness"].includes(prop)) {
            const currentVal = (charComp[partId].filters as any)?.[prop] ?? 100;
            if (Math.abs(currentVal - animatedState[key]) > EPSILON) {
              if (!charUpdatesPerChar[charId][partId].filters)
                charUpdatesPerChar[charId][partId].filters = {
                  ...(charComp[partId].filters || {
                    saturation: 100,
                    contrast: 100,
                    brightness: 100,
                  }),
                };
              (charUpdatesPerChar[charId][partId].filters as any)[prop] =
                animatedState[key];
            }
          } else {
            const currentVal = charComp[partId].transform[
              prop as keyof TransformState
            ] as number;
            if (
              currentVal === undefined ||
              Math.abs(currentVal - animatedState[key]) > EPSILON
            ) {
              (charUpdatesPerChar[charId][partId] as any)[prop] =
                animatedState[key];
            }
          }
        }
      }
    });

    // Check if any update is needed
    if (
      Object.keys(camUpdate).length === 0 &&
      Object.keys(bgUpdate).length === 0 &&
      Object.keys(characterFilterUpdates).length === 0 &&
      ambientUpdate === null &&
      Object.keys(boneUpdatesPerChar).length === 0 &&
      Object.keys(lightUpdatesMap).length === 0 &&
      Object.keys(charUpdatesPerChar).length === 0 &&
      Object.keys(vocalUpdate).length === 0 &&
      Object.keys(instUpdate).length === 0
    ) {
      return; // No updates needed
    }

    // Apply updates
    requestAnimationFrame(() => {
      if (Object.keys(camUpdate).length > 0)
        setCameraTransform((prev) => ({ ...prev, ...camUpdate }));
      if (Object.keys(bgUpdate).length > 0)
        setBackgroundTransform((prev) => ({ ...prev, ...bgUpdate }));
      if (Object.keys(characterFilterUpdates).length > 0)
        setCharacterFiltersMap((prev) => ({
          ...prev,
          ...characterFilterUpdates,
        }));
      if (ambientUpdate !== null) setAmbientLightLevel(ambientUpdate);
      if (Object.keys(lightUpdatesMap).length > 0) {
        setLightSources((prev) => {
          let mutated = false;
          const next = prev.map((l) => {
            const updates = lightUpdatesMap[l.id];
            if (updates) {
               let localMutated = false;
               for (const prop in updates) {
                  if (Math.abs((l as any)[prop] - updates[prop]) > EPSILON) {
                      localMutated = true; break;
                  }
               }
               if (localMutated) { mutated = true; return { ...l, ...updates }; }
            }
            return l;
          });
          return mutated ? next : prev;
        });
      }
      if (Object.keys(vocalUpdate).length > 0)
        setVocalTrack((prev) => ({ ...prev, ...vocalUpdate }));
      if (Object.keys(instUpdate).length > 0)
        setInstTrack((prev) => ({ ...prev, ...instUpdate }));

      if (
        Object.keys(boneUpdatesPerChar).length > 0 ||
        Object.keys(charUpdatesPerChar).length > 0
      ) {
        setCharacters((prev) =>
          prev.map((c) => {
            let changed = false;
            let nextC = { ...c };
            const bUpdates = boneUpdatesPerChar[c.id];
            const pUpdates = charUpdatesPerChar[c.id];

            if (bUpdates) {
              nextC.boneTransforms = {
                ...(c.boneTransforms || {}),
                ...bUpdates,
              };
              changed = true;
            }

            if (pUpdates) {
              const nextComp = { ...c.composition };
              Object.entries(pUpdates).forEach(([partId, updates]) => {
                if (nextComp[partId]) {
                  const { opacity, filters, isVisible, ...tUpdate } = updates as any;
                  nextComp[partId] = {
                    ...nextComp[partId],
                    ...(opacity !== undefined ? { opacity } : {}),
                    ...(isVisible !== undefined ? { isVisible } : {}),
                    ...(filters !== undefined
                      ? {
                          filters: {
                            ...(nextComp[partId].filters || {
                              saturation: 100,
                              contrast: 100,
                              brightness: 100,
                            }),
                            ...filters,
                          },
                        }
                      : {}),
                    transform: { ...nextComp[partId].transform, ...tUpdate },
                  };
                }
              });
              nextC.composition = nextComp;
              changed = true;
            }

            return changed ? nextC : c;
          }),
        );
      }
    });
  }, [
    playbackState.currentTime,
    keyframes,
    isDraggingCamera,
    isDraggingChar,
    isInteracting,
  ]);

  useEffect(() => {
    setTotalDuration(safeDuration);
  }, [safeDuration]);

  const refreshProjectsList = useCallback(async () => {
    try {
      let localProjects = await StorageUtils.getProjectList();
      setSavedProjects(localProjects);
    } catch (e) {
      console.error("Critical error in project loader", e);
    }
  }, [user?.email, user?.subscription_status]);

  // Load Saved Projects List on Mount
  useEffect(() => {
    refreshProjectsList();
  }, [refreshProjectsList]);

  // --- TIMELINE AUTO-SCROLL ---
  useEffect(() => {
    requestAnimationFrame(() => {
      if (scrollContainerRef.current) {
        const container = scrollContainerRef.current;
        const playheadX =
          (playbackState.currentTime / safeDuration) * container.scrollWidth;
        const clientWidth = container.clientWidth;
        const scrollLeft = container.scrollLeft;

        // Define a "padding" area where the playhead can move without scrolling
        // Keep it between 25% and 75% of the screen
        const rightBound = scrollLeft + clientWidth * 0.75;
        const leftBound = scrollLeft + clientWidth * 0.25;

        if (playheadX > rightBound) {
          container.scrollLeft = playheadX - clientWidth * 0.75;
        } else if (playheadX < leftBound) {
          container.scrollLeft = playheadX - clientWidth * 0.25;
        }
      }
    });
  }, [playbackState.currentTime, safeDuration]);

  // --- HELPER FUNCTIONS ---

  // Check for offline usage duration
  useEffect(() => {
    const checkOffline = () => {
      if (!navigator.onLine) {
        const offlineStartStr = localStorage.getItem("offline_start_time");
        if (offlineStartStr) {
          const offlineStart = parseInt(offlineStartStr);
          const offlineDuration = Date.now() - offlineStart;
          if (offlineDuration > 3 * 24 * 60 * 60 * 1000) {
            showToast(
              "You have been offline for 3 days. Please connect to internet to get updates.",
            );
          }
        } else {
          localStorage.setItem("offline_start_time", Date.now().toString());
        }
      } else {
        localStorage.removeItem("offline_start_time");
      }
    };

    checkOffline();
    const interval = setInterval(checkOffline, 60 * 60 * 1000); // Check every hour
    return () => clearInterval(interval);
  }, []);

  const showToast = (msg: string) => {
    toast(msg);
  };

  const [shouldRecordHistory, setShouldRecordHistory] = useState(false);

  const recordHistory = useCallback(() => {
    const newState: HistoryState = {
      character: safeDeepClone(character),
      characters: safeDeepClone(characters),
      characterFiltersMap: safeDeepClone(characterFiltersMap),
      activeSceneCharacterId,
      keyframes: safeDeepClone(keyframes),
      lipSyncKeyframes: safeDeepClone(lipSyncKeyframes),
      cameraTransform: { ...cameraTransform },
      characterFilters: { ...characterFilters },
      lightSources: safeDeepClone(lightSources),
      backgroundTransform: { ...backgroundTransform },
      audioState: {
        vocalGain: vocalTrack.gain,
        vocalPitch: vocalTrack.pitch,
        vocalSpeed: vocalTrack.speed ?? 1.0,
        instGain: instTrack.gain,
        instPitch: instTrack.pitch,
        instSpeed: instTrack.speed ?? 1.0,
      },
      linkBgToCamera,
      ambientLightLevel,
      visemeMap: { ...visemeMap },
      backgroundImage: { ...backgroundImage },
      canvasBgColor,
      isCanvasTransparent,
      activeBoneId,
      currentBoneTransforms: safeDeepClone(currentBoneTransforms),
    };

    setHistory((prev) => {
      const newHistory = prev.slice(0, historyIndex + 1);
      if (newHistory.length > 50) newHistory.shift();
      return [...newHistory, newState];
    });
    setHistoryIndex((prev) => Math.min(prev + 1, 50));
  }, [
    character,
    keyframes,
    lipSyncKeyframes,
    cameraTransform,
    characterFilters,
    lightSources,
    backgroundTransform,
    vocalTrack,
    instTrack,
    linkBgToCamera,
    ambientLightLevel,
    visemeMap,
    backgroundImage,
    canvasBgColor,
    isCanvasTransparent,
    activeSceneCharacterId,
    characters,
    characterFiltersMap,
    historyIndex,
  ]);

  const recordHistoryRef = useRef(recordHistory);
  useEffect(() => {
    recordHistoryRef.current = recordHistory;
  }, [recordHistory]);

  useEffect(() => {
    if (shouldRecordHistory) {
      recordHistoryRef.current();
      setShouldRecordHistory(false);
    }
  }, [shouldRecordHistory]);

  // ... (Undo/Redo and other handlers) ...
  const handleUndo = () => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      const state = history[newIndex];
      setCharacter(state.character);
      if (state.characters) setCharacters(state.characters);
      if (state.characterFiltersMap) setCharacterFiltersMap(state.characterFiltersMap);
      if (state.activeSceneCharacterId !== undefined) setActiveSceneCharacterId(state.activeSceneCharacterId);
      setKeyframes(state.keyframes);
      setLipSyncKeyframes(state.lipSyncKeyframes);
      setCameraTransform(state.cameraTransform);
      setCharacterFilters(state.characterFilters);
      setLightSources(state.lightSources);
      setBackgroundTransform(state.backgroundTransform);
      setLinkBgToCamera(state.linkBgToCamera);
      setAmbientLightLevel(state.ambientLightLevel);
      setVisemeMap(state.visemeMap);
      setBackgroundImage(state.backgroundImage);
      setCanvasBgColor(state.canvasBgColor);
      setIsCanvasTransparent(state.isCanvasTransparent);
      setActiveBoneId(state.activeBoneId);
      setCurrentBoneTransforms(state.currentBoneTransforms || {});
      setVocalTrack((prev) => ({
        ...prev,
        gain: state.audioState.vocalGain,
        pitch: state.audioState.vocalPitch,
        speed: state.audioState.vocalSpeed ?? 1.0,
      }));
      setInstTrack((prev) => ({
        ...prev,
        gain: state.audioState.instGain,
        pitch: state.audioState.instPitch,
        speed: state.audioState.instSpeed ?? 1.0,
      }));
      setHistoryIndex(newIndex);
    }
  };

  const handleRedo = () => {
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      const state = history[newIndex];
      setCharacter(state.character);
      if (state.characters) setCharacters(state.characters);
      if (state.characterFiltersMap) setCharacterFiltersMap(state.characterFiltersMap);
      if (state.activeSceneCharacterId !== undefined) setActiveSceneCharacterId(state.activeSceneCharacterId);
      setKeyframes(state.keyframes);
      setLipSyncKeyframes(state.lipSyncKeyframes);
      setCameraTransform(state.cameraTransform);
      setCharacterFilters(state.characterFilters);
      setLightSources(state.lightSources);
      setBackgroundTransform(state.backgroundTransform);
      setLinkBgToCamera(state.linkBgToCamera);
      setAmbientLightLevel(state.ambientLightLevel);
      setVisemeMap(state.visemeMap);
      setBackgroundImage(state.backgroundImage);
      setCanvasBgColor(state.canvasBgColor);
      setIsCanvasTransparent(state.isCanvasTransparent);
      setActiveBoneId(state.activeBoneId);
      setCurrentBoneTransforms(state.currentBoneTransforms || {});
      setVocalTrack((prev) => ({
        ...prev,
        gain: state.audioState.vocalGain,
        pitch: state.audioState.vocalPitch,
        speed: state.audioState.vocalSpeed ?? 1.0,
      }));
      setInstTrack((prev) => ({
        ...prev,
        gain: state.audioState.instGain,
        pitch: state.audioState.instPitch,
        speed: state.audioState.instSpeed ?? 1.0,
      }));
      setHistoryIndex(newIndex);
    }
  };

  // ... (Interaction handlers same as before) ...
  const handleInteractionStart = useCallback(() => setIsInteracting(true), []);
  const handleInteractionEnd = useCallback(() => {
    setIsInteracting(false);
    setShouldRecordHistory(true);
  }, []);

  const handleBonesChange = useCallback((partId: string, bones: Bone[]) => {
    if (!activeSceneCharacterId) return;
    setCharacters((prev) =>
      prev.map((c) => {
        if (c.id === activeSceneCharacterId) {
          const part = c.composition[partId];
          if (part) {
            return {
              ...c,
              composition: {
                ...c.composition,
                [partId]: { ...part, bones },
              },
            };
          }
        }
        return c;
      }),
    );
    setShouldRecordHistory(true);
  }, [activeSceneCharacterId]);

  // --- AUTO KEYFRAME LOGIC ---
  const handleAutoKey = (updates: Record<string, number>, forceSave: boolean = false) => {
    if (!autoKeyEnabled && !forceSave) return;
    const time = playbackState.currentTime;

    setKeyframes((prev) => {
      const existingIndex = prev.findIndex(
        (k) => Math.abs(k.time - time) < 0.05,
      );

      if (existingIndex >= 0) {
        const updated = [...prev];
        updated[existingIndex] = {
          ...updated[existingIndex],
          properties: { ...updated[existingIndex].properties, ...updates },
        };
        return updated;
      } else {
        const newProps: Record<string, number> = {};

        // Camera & Background
        newProps["camera:x"] = cameraTransform.x;
        newProps["camera:y"] = cameraTransform.y;
        newProps["camera:scale"] = cameraTransform.scale;
        newProps["camera:rotation"] = cameraTransform.rotation;
        newProps["bg:zoom"] = backgroundTransform.zoom;
        newProps["bg:blur"] = backgroundTransform.blur;
        newProps["bg:brightness"] = backgroundTransform.brightness;
        newProps["bg:contrast"] = backgroundTransform.contrast;
        newProps["bg:saturation"] = backgroundTransform.saturation;
        newProps["bg:x"] = backgroundTransform.x;
        newProps["bg:y"] = backgroundTransform.y;

        // Filter state per character
        characters.forEach((char) => {
          const filters = characterFiltersMap[char.id] || {
            saturation: 100,
            contrast: 100,
            brightness: 100,
            sharpness: 0,
            eyeSquint: 0,
            pupilX: 0,
            pupilY: 0,
            exprState: 0
          };
          newProps[`char:${char.id}:brightness`] = filters.brightness;
          newProps[`char:${char.id}:contrast`] = filters.contrast;
          newProps[`char:${char.id}:saturation`] = filters.saturation;
          newProps[`char:${char.id}:sharpness`] = filters.sharpness;
          if (filters.eyeSquint !== undefined) newProps[`char:${char.id}:eyeSquint`] = filters.eyeSquint;
          if (filters.pupilX !== undefined) newProps[`char:${char.id}:pupilX`] = filters.pupilX;
          if (filters.pupilY !== undefined) newProps[`char:${char.id}:pupilY`] = filters.pupilY;
          if (filters.exprState !== undefined) newProps[`char:${char.id}:exprState`] = filters.exprState;
          if (filters.headTurn !== undefined) newProps[`char:${char.id}:headTurn`] = filters.headTurn;
        });

        // FX
        newProps["env:ambient"] = ambientLightLevel;
        lightSources.forEach((l) => {
          newProps[`light:${l.id}:intensity`] = l.intensity;
          newProps[`light:${l.id}:x`] = l.x;
          newProps[`light:${l.id}:y`] = l.y;
          newProps[`light:${l.id}:softness`] = l.softness;
          newProps[`light:${l.id}:radius`] = l.radius;
        });

        // Puppet Bones & Character parts
        characters.forEach((char) => {
          if (char.composition) {
            const charBones = char.boneTransforms || {};
            Object.entries(char.composition).forEach(
              ([partId, part]: [string, CharacterPart]) => {
                const t = part.transform;
                newProps[`part:${char.id}:${partId}:x`] = t.x;
                newProps[`part:${char.id}:${partId}:y`] = t.y;
                newProps[`part:${char.id}:${partId}:scaleX`] = t.scaleX;
                newProps[`part:${char.id}:${partId}:scaleY`] = t.scaleY;
                newProps[`part:${char.id}:${partId}:rotation`] = t.rotation;
                newProps[`part:${char.id}:${partId}:anchorX`] = t.anchorX;
                newProps[`part:${char.id}:${partId}:anchorY`] = t.anchorY;
                if (part.opacity !== undefined)
                  newProps[`part:${char.id}:${partId}:opacity`] = part.opacity;
                if (part.isVisible !== undefined)
                  newProps[`part:${char.id}:${partId}:isVisible`] = part.isVisible ? 1 : 0;
                if (part.filters) {
                  if (part.filters.brightness !== undefined)
                    newProps[`part:${char.id}:${partId}:brightness`] =
                      part.filters.brightness;
                  if (part.filters.contrast !== undefined)
                    newProps[`part:${char.id}:${partId}:contrast`] =
                      part.filters.contrast;
                  if (part.filters.saturation !== undefined)
                    newProps[`part:${char.id}:${partId}:saturation`] =
                      part.filters.saturation;
                }

                if (part.bones) {
                  part.bones.forEach((bone: Bone) => {
                    const key = `${partId}|${bone.id}`;
                    const boneT = charBones[key] || {
                      rotation: 0,
                      scaleX: 1,
                      scaleY: 1,
                    };
                    newProps[
                      `puppet:${char.id}:${partId}:${bone.id}:rotation`
                    ] = boneT.rotation;
                    newProps[`puppet:${char.id}:${partId}:${bone.id}:scaleX`] =
                      boneT.scaleX;
                    newProps[`puppet:${char.id}:${partId}:${bone.id}:scaleY`] =
                      boneT.scaleY;
                  });
                }
              },
            );
          }
        });

        return [
          ...prev,
          {
            id: `kf_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
            time: time,
            properties: { ...newProps, ...updates },
            easing: EasingType.Linear,
          },
        ];
      }
    });
  };

  useEffect(() => {
    (window as any)._hackyAutoKeyFire = (updates: Record<string, number>) => handleAutoKey(updates, true);
    return () => { (window as any)._hackyAutoKeyFire = null; };
  }, [playbackState.currentTime, autoKeyEnabled, handleAutoKey]);

  const updateAudioTrack = (
    type: "vocal" | "inst",
    updates: Partial<TrackState>,
  ) => {
    if (type === "vocal") setVocalTrack((prev) => ({ ...prev, ...updates }));
    else setInstTrack((prev) => ({ ...prev, ...updates }));
  };

  const effectiveViseme = useMemo(() => {
    if (manualVisemeOverride) {
      const targets = calculateInstantVisemeParams(manualVisemeOverride, 1.0);
      return {
        shape: manualVisemeOverride,
        intensity: 1.0,
        openness: targets.openness,
        spread: targets.spread,
        squeeze: targets.squeeze,
        spectralFlux: 0,
        plosiveScore: 0,
      };
    }

    if (lipSyncKeyframes.length > 0) {
      const t = playbackState.currentTime;
      let low = 0,
        high = lipSyncKeyframes.length - 1,
        idx = 0;
      while (low <= high) {
        const mid = (low + high) >>> 1;
        if (lipSyncKeyframes[mid].time <= t) {
          idx = mid;
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }

      const prev = lipSyncKeyframes[idx];
      const next = lipSyncKeyframes[idx + 1];

      if (!prev || prev.time > t) {
        return {
          shape: VisemeShape.REST,
          intensity: 0,
          openness: 0,
          spread: 0,
          squeeze: 1,
          spectralFlux: 0,
          plosiveScore: 0,
        };
      }

      if (!next) {
        return {
          shape: prev.shape,
          intensity: prev.intensity,
          openness: 0,
          spread: 0,
          squeeze: 1,
          spectralFlux: 0,
          plosiveScore: 0,
        };
      }

      const span = next.time - prev.time;
      const progress = (t - prev.time) / (span || 0.001);
      const clampedT = Math.max(0, Math.min(1, progress));
      const lerpedIntensity =
        prev.intensity + (next.intensity - prev.intensity) * clampedT;

      return {
        shape: prev.shape,
        intensity: lerpedIntensity,
        openness: 0,
        spread: 0,
        squeeze: 1,
        spectralFlux: 0,
        plosiveScore: 0,
      };
    }

    return currentViseme;
  }, [
    currentViseme,
    manualVisemeOverride,
    lipSyncKeyframes,
    playbackState.currentTime,
  ]);

  // ... (Pointer and Event Handlers) ...
  const handlePointerDown = (e: React.PointerEvent) => {
    if (activeBottomTab === "SCENE" && propertyTarget === "camera") {
      setIsDraggingCamera(true);
      dragStartRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        initialX: cameraTransform.x,
        initialY: cameraTransform.y,
      };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } else if (
      activeBottomTab === "CHAR" &&
      character &&
      propertyTarget !== "root"
    ) {
      const part = character[propertyTarget];
      if (part) {
        setIsDraggingChar(true);
        dragStartRef.current = {
          startX: e.clientX,
          startY: e.clientY,
          initialX: part.transform.x,
          initialY: part.transform.y,
        };
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      }
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (isDraggingCamera) {
      const dx = (e.clientX - dragStartRef.current.startX) / stageScale;
      const dy = (e.clientY - dragStartRef.current.startY) / stageScale;
      const nx = dragStartRef.current.initialX + dx;
      const ny = dragStartRef.current.initialY + dy;
      setCameraTransform((prev) => ({ ...prev, x: nx, y: ny }));
      handleAutoKey({ "camera:x": nx, "camera:y": ny });
    } else if (isDraggingChar) {
      const dx = (e.clientX - dragStartRef.current.startX) / stageScale;
      const dy = (e.clientY - dragStartRef.current.startY) / stageScale;
      updateCharacterProperty("x", dragStartRef.current.initialX + dx);
      updateCharacterProperty("y", dragStartRef.current.initialY + dy);
    } else if (isDraggingLight && draggingLightId) {
      const dx = (e.clientX - dragStartRef.current.startX) / stageScale;
      const dy = (e.clientY - dragStartRef.current.startY) / stageScale;
      const nx = dragStartRef.current.initialX + dx;
      const ny = dragStartRef.current.initialY + dy;
      handleLightMove(draggingLightId, nx, ny);
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (isDraggingCamera || isDraggingChar || isDraggingLight) {
      if (isDraggingLight && draggingLightId) {
        const light = lightSources.find(l => l.id === draggingLightId);
        if (light) {
            handleAutoKey({ [`light:${light.id}:x`]: light.x, [`light:${light.id}:y`]: light.y });
        }
      }
      setIsDraggingCamera(false);
      setIsDraggingChar(false);
      setIsDraggingLight(false);
      setDraggingLightId(null);
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      setShouldRecordHistory(true);
    }
  };

  const getTextStyle = (textObj: SceneText) => {
    let font = textObj.fontFamily;
    let color = textObj.color;
    let borderColor = textObj.borderColor;
    let borderWidth = textObj.borderWidth;
    let textTransform: "none" | "uppercase" = "none";

    if (textObj.styleTemplate === 'meme') {
      font = 'Impact, sans-serif';
      color = '#ffffff';
      borderColor = '#000000';
      borderWidth = 4;
      textTransform = "uppercase";
    } else if (textObj.styleTemplate === 'subtitle') {
      font = 'Arial, sans-serif';
      color = '#ffff00';
      borderColor = '#000000';
      borderWidth = 2;
    } else if (textObj.styleTemplate === 'comic') {
      font = '"Comic Sans MS", cursive, sans-serif';
      color = '#000000';
      borderColor = '#ffffff';
      borderWidth = 3;
    }

    const borderShadow = borderWidth > 0 ? Array.from({ length: 8 }, (_, i) => {
      const angle = (i * Math.PI) / 4;
      const dx = Math.round(Math.cos(angle) * borderWidth);
      const dy = Math.round(Math.sin(angle) * borderWidth);
      return `${dx}px ${dy}px 0 ${borderColor}`;
    }).join(', ') : 'none';

    return {
      fontFamily: font,
      color: color,
      textShadow: borderShadow,
      textTransform,
    };
  };

  const handleTextDragStart = (e: React.PointerEvent, textObj: SceneText) => {
    e.stopPropagation();
    setSelectedTextId(textObj.id);
    const startX = e.clientX;
    const startY = e.clientY;
    const initialX = textObj.x;
    const initialY = textObj.y;
    
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    
    const handlePointerMove = (moveEvent: PointerEvent) => {
      const dx = (moveEvent.clientX - startX) / stageScale / cameraTransform.scale;
      const dy = (moveEvent.clientY - startY) / stageScale / cameraTransform.scale;
      setTexts(prev => prev.map(item => item.id === textObj.id ? { ...item, x: initialX + dx, y: initialY + dy } : item));
    };
    
    const handlePointerUp = () => {
      target.releasePointerCapture(e.pointerId);
      target.removeEventListener('pointermove', handlePointerMove);
      target.removeEventListener('pointerup', handlePointerUp);
    };
    
    target.addEventListener('pointermove', handlePointerMove);
    target.addEventListener('pointerup', handlePointerUp);
  };

  const handleTextScaleStart = (e: React.PointerEvent, textObj: SceneText) => {
    e.stopPropagation();
    const startX = e.clientX;
    const initialScale = textObj.scale;
    
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    
    const handlePointerMove = (moveEvent: PointerEvent) => {
      const dx = (moveEvent.clientX - startX) / stageScale / cameraTransform.scale;
      const newScale = Math.max(0.1, initialScale + dx * 0.01);
      setTexts(prev => prev.map(item => item.id === textObj.id ? { ...item, scale: newScale } : item));
    };
    
    const handlePointerUp = () => {
      target.releasePointerCapture(e.pointerId);
      target.removeEventListener('pointermove', handlePointerMove);
      target.removeEventListener('pointerup', handlePointerUp);
    };
    
    target.addEventListener('pointermove', handlePointerMove);
    target.addEventListener('pointerup', handlePointerUp);
  };

  const handleTextRotateStart = (e: React.PointerEvent, textObj: SceneText) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).parentElement?.getBoundingClientRect();
    if (!rect) return;
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const initialAngle = Math.atan2(e.clientY - centerY, e.clientX - centerX) * 180 / Math.PI;
    const initialRotation = textObj.rotation;
    
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    
    const handlePointerMove = (moveEvent: PointerEvent) => {
      const currentAngle = Math.atan2(moveEvent.clientY - centerY, moveEvent.clientX - centerX) * 180 / Math.PI;
      const deltaAngle = currentAngle - initialAngle;
      let newRotation = (initialRotation + deltaAngle) % 360;
      setTexts(prev => prev.map(item => item.id === textObj.id ? { ...item, rotation: newRotation } : item));
    };
    
    const handlePointerUp = () => {
      target.releasePointerCapture(e.pointerId);
      target.removeEventListener('pointermove', handlePointerMove);
      target.removeEventListener('pointerup', handlePointerUp);
    };
    
    target.addEventListener('pointermove', handlePointerMove);
    target.addEventListener('pointerup', handlePointerUp);
  };

  const handleStageClick = (target: string) => {
    setSelectedTextId(null);
    if (activeBottomTab === "CHAR") {
      setPropertyTarget(target);
      setSelectedPartIds([target]);
    }
  };

  const handleLightMove = (id: string, x: number, y: number) => {
    setLightSources((prev) =>
      prev.map((l) => (l.id === id ? { ...l, x, y } : l)),
    );
  };

  const handleSliceTrigger = () => {
    setSliceModal({
      isOpen: true,
      time: playbackState.currentTime,
      trackId: activeTrackId,
    });
  };

  const handleCopyKeyframe = () => {
    if (selectedKeyframeId) {
      const kf = keyframes.find((k) => k.id === selectedKeyframeId);
      if (kf) {
        setClipboardKeyframe(kf);
        showToast("KEYFRAME COPIED");
      }
    }
  };

  const handlePasteKeyframe = (time: number) => {
    if (clipboardKeyframe) {
      const newKey = { ...clipboardKeyframe, id: `kf_${Date.now()}`, time };
      setKeyframes((prev) => [...prev, newKey]);
      setShouldRecordHistory(true);
      showToast("KEYFRAME PASTED");
    }
  };

  // ... (handleAddKeyframe, etc) ...
  const handleAddKeyframe = (time: number) => {
    const newProps: Record<string, number> = {};

    // Camera & Background
    newProps["camera:x"] = cameraTransform.x;
    newProps["camera:y"] = cameraTransform.y;
    newProps["camera:scale"] = cameraTransform.scale;
    newProps["camera:rotation"] = cameraTransform.rotation;
    newProps["bg:zoom"] = backgroundTransform.zoom;
    newProps["bg:blur"] = backgroundTransform.blur;
    newProps["bg:brightness"] = backgroundTransform.brightness;
    newProps["bg:contrast"] = backgroundTransform.contrast;
    newProps["bg:saturation"] = backgroundTransform.saturation;
    newProps["bg:x"] = backgroundTransform.x;
    newProps["bg:y"] = backgroundTransform.y;

    // AUDIO
    newProps["audio:vocalGain"] = vocalTrack.gain ?? 1;
    newProps["audio:vocalPitch"] = vocalTrack.pitch ?? 1;
    newProps["audio:vocalSpeed"] = vocalTrack.speed ?? 1.0;
    newProps["audio:instGain"] = instTrack.gain ?? 1;
    newProps["audio:instPitch"] = instTrack.pitch ?? 1;
    newProps["audio:instSpeed"] = instTrack.speed ?? 1.0;

    // Filter state per character
    characters.forEach((char) => {
      const filters = characterFiltersMap[char.id] || {
        brightness: 100,
        contrast: 100,
        saturation: 100,
        sharpness: 0,
        eyeSquint: 0,
        pupilX: 0,
        pupilY: 0,
        exprState: 0
      };
      newProps[`char:${char.id}:brightness`] = filters.brightness;
      newProps[`char:${char.id}:contrast`] = filters.contrast;
      newProps[`char:${char.id}:saturation`] = filters.saturation;
      newProps[`char:${char.id}:sharpness`] = filters.sharpness;
      if (filters.eyeSquint !== undefined) newProps[`char:${char.id}:eyeSquint`] = filters.eyeSquint;
      if (filters.pupilX !== undefined) newProps[`char:${char.id}:pupilX`] = filters.pupilX;
      if (filters.pupilY !== undefined) newProps[`char:${char.id}:pupilY`] = filters.pupilY;
      if (filters.exprState !== undefined) newProps[`char:${char.id}:exprState`] = filters.exprState;
          if (filters.headTurn !== undefined) newProps[`char:${char.id}:headTurn`] = filters.headTurn;
    });

    // FX
    newProps["env:ambient"] = ambientLightLevel;
    lightSources.forEach((l) => {
      newProps[`light:${l.id}:intensity`] = l.intensity;
      newProps[`light:${l.id}:x`] = l.x;
      newProps[`light:${l.id}:y`] = l.y;
      newProps[`light:${l.id}:softness`] = l.softness;
      newProps[`light:${l.id}:radius`] = l.radius;
    });

    // Puppet Bones & Character parts
    characters.forEach((char) => {
      if (char.composition) {
        const charBones = char.boneTransforms || {};
        Object.entries(char.composition).forEach(
          ([partId, part]: [string, CharacterPart]) => {
            const t = part.transform;
            newProps[`part:${char.id}:${partId}:x`] = t.x;
            newProps[`part:${char.id}:${partId}:y`] = t.y;
            newProps[`part:${char.id}:${partId}:scaleX`] = t.scaleX;
            newProps[`part:${char.id}:${partId}:scaleY`] = t.scaleY;
            newProps[`part:${char.id}:${partId}:rotation`] = t.rotation;
            newProps[`part:${char.id}:${partId}:anchorX`] = t.anchorX;
            newProps[`part:${char.id}:${partId}:anchorY`] = t.anchorY;
            if (part.opacity !== undefined)
              newProps[`part:${char.id}:${partId}:opacity`] = part.opacity;
            if (part.isVisible !== undefined)
              newProps[`part:${char.id}:${partId}:isVisible`] = part.isVisible ? 1 : 0;
            if (part.filters) {
              if (part.filters.brightness !== undefined) newProps[`part:${char.id}:${partId}:brightness`] = part.filters.brightness;
              if (part.filters.contrast !== undefined) newProps[`part:${char.id}:${partId}:contrast`] = part.filters.contrast;
              if (part.filters.saturation !== undefined) newProps[`part:${char.id}:${partId}:saturation`] = part.filters.saturation;
            }

            if (part.bones) {
              part.bones.forEach((bone: Bone) => {
                const key = `${partId}|${bone.id}`;
                const boneT = charBones[key] || {
                  rotation: 0,
                  scaleX: 1,
                  scaleY: 1,
                };
                newProps[`puppet:${char.id}:${partId}:${bone.id}:rotation`] =
                  boneT.rotation;
                newProps[`puppet:${char.id}:${partId}:${bone.id}:scaleX`] =
                  boneT.scaleX;
                newProps[`puppet:${char.id}:${partId}:${bone.id}:scaleY`] =
                  boneT.scaleY;
              });
            }
          },
        );
      }
    });

    const newKey: Keyframe = {
      id: `kf_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      time: time,
      properties: newProps,
      easing: EasingType.Linear,
    };

    setKeyframes((prev) => [...prev, newKey]);
    setShouldRecordHistory(true);
    showToast("KEYFRAME ADDED");
  };

  const handleUpdateKeyframe = useCallback(
    (id: string, updates: Partial<Keyframe>) => {
      setKeyframes((prev) =>
        prev.map((k) => (k.id === id ? { ...k, ...updates } : k)),
      );
      setShouldRecordHistory(true);
    },
    [],
  );

  const handleRemoveKeyframe = (id: string) => {
    setKeyframes((prev) => prev.filter((k) => k.id !== id));
    if (selectedKeyframeId === id) setSelectedKeyframeId(null);
    setShouldRecordHistory(true);
  };

  const handleRewind = () => engine.seek(0);

  const toggleLoop = () => {
    setIsLooping(!isLooping);
    engine.setLoopState(
      !isLooping,
      selection?.start || 0,
      selection?.end || safeDuration,
    );
  };

  const handleSeekWrapper = (time: number) => engine.seek(time);

  const handleSelectKeyframe = (id: string | null) => {
    setSelectedKeyframeId(id);
    if (id) {
      const kf = keyframes.find((k) => k.id === id);
      if (kf) {
        setEditingKeyframeId(id);
        engine.seek(kf.time);
      }
    } else {
      setEditingKeyframeId(null);
    }
  };

  const handleEditKeyframe = (id: string, e: React.MouseEvent) => {
    setEasingMenuPos({ x: e.clientX, y: e.clientY });
    setEasingMenuOpen(true);
    setEditingKeyframeId(id);
  };

  const handleClearTrack = (trackId: "vocal" | "inst") => {
    setDeleteConfirmation({ isOpen: true, trackId });
  };

  const handleLipSyncKeyClick = (id: string, e: React.MouseEvent) => {
    // Stub for future enhancement
  };

  // --- UPDATED SETTERS WITH AUTO-KEY ---

  const updateCamera = (updates: Partial<typeof cameraTransform>) => {
    setCameraTransform((prev) => ({ ...prev, ...updates }));

    if (autoKeyEnabled) {
      const props: Record<string, number> = {};
      if (updates.x !== undefined) props["camera:x"] = updates.x;
      if (updates.y !== undefined) props["camera:y"] = updates.y;
      if (updates.scale !== undefined) props["camera:scale"] = updates.scale;
      if (updates.rotation !== undefined)
        props["camera:rotation"] = updates.rotation;
      handleAutoKey(props);
    }
  };

  const updateBackgroundProperty = (
    prop: keyof typeof backgroundTransform,
    val: number,
  ) => {
    setBackgroundTransform((prev) => ({ ...prev, [prop]: val }));
    if (autoKeyEnabled) {
      handleAutoKey({ [`bg:${String(prop)}`]: val });
    }
  };

  const setAmbientLightWithKey = (val: number) => {
    setAmbientLightLevel(val);
    if (autoKeyEnabled) {
      handleAutoKey({ "env:ambient": val });
    }
  };

  const characterUpdateRaf = useRef<number | null>(null);
  const filterUpdateRaf = useRef<number | null>(null);

  const updatePartFilter = (prop: string, val: number) => {
    if (!character || !propertyTarget) return;
    if (filterUpdateRaf.current) cancelAnimationFrame(filterUpdateRaf.current);
    filterUpdateRaf.current = requestAnimationFrame(() => {
      setCharacter((prev) => {
        if (!prev) return prev;
        const next = { ...prev };
        selectedPartIds.forEach((id) => {
          if (next[id]) {
            const filters = next[id].filters || {
              brightness: 100,
              contrast: 100,
              saturation: 100,
              sharpness: 0,
            };
            next[id] = { ...next[id], filters: { ...filters, [prop]: val } };
          }
        });
        return next;
      });
    });
    if (autoKeyEnabled) {
      const updates: Record<string, number> = {};
      selectedPartIds.forEach((id) => {
        updates[`part:${activeSceneCharacterId}:${id}:${prop}`] = val;
      });
      handleAutoKey(updates);
    }
  };

  const updateCharacterProperty = (prop: string, val: number | boolean) => {
    if (!character) return;

    const primaryPart = character[propertyTarget];
    if (!primaryPart) return;

    if (prop === "opacity") {
      const delta =
        (val as number) -
        (primaryPart.opacity !== undefined ? primaryPart.opacity : 1);
      if (delta === 0) return;

      if (characterUpdateRaf.current)
        cancelAnimationFrame(characterUpdateRaf.current);
      characterUpdateRaf.current = requestAnimationFrame(() => {
        setCharacter((prev) => {
          if (!prev) return prev;
          const next = { ...prev };
          selectedPartIds.forEach((id) => {
            if (next[id]) {
              const currentOpacity =
                next[id].opacity !== undefined ? next[id].opacity : 1;
              next[id] = {
                ...next[id],
                opacity: Math.max(0, Math.min(1, currentOpacity + delta)),
              };
            }
          });
          return next;
        });
      });

      if (autoKeyEnabled) {
        const updates: Record<string, number> = {};
        selectedPartIds.forEach((id) => {
          const currentOpacity =
            character[id].opacity !== undefined ? character[id].opacity : 1;
          updates[`part:${activeSceneCharacterId}:${id}:opacity`] = Math.max(
            0,
            Math.min(1, currentOpacity + delta),
          );
        });
        handleAutoKey(updates);
      }
      return;
    }

    if (prop === "loopSpeed") {
      const delta =
        (val as number) -
        (primaryPart.loopSpeed !== undefined ? primaryPart.loopSpeed : 1);
      if (delta === 0) return;

      if (characterUpdateRaf.current)
        cancelAnimationFrame(characterUpdateRaf.current);
      characterUpdateRaf.current = requestAnimationFrame(() => {
        setCharacter((prev) => {
          if (!prev) return prev;
          const next = { ...prev };
          selectedPartIds.forEach((id) => {
            if (next[id]) {
              const currentSpeed =
                next[id].loopSpeed !== undefined ? next[id].loopSpeed : 1;
              next[id] = {
                ...next[id],
                loopSpeed: Math.max(0, Math.min(5, currentSpeed + delta)),
              };
            }
          });
          return next;
        });
      });

      if (autoKeyEnabled) {
        const updates: Record<string, number> = {};
        selectedPartIds.forEach((id) => {
          const currentSpeed =
            character[id].loopSpeed !== undefined ? character[id].loopSpeed : 1;
          updates[`part:${activeSceneCharacterId}:${id}:loopSpeed`] = Math.max(
            0,
            Math.min(5, currentSpeed + delta),
          );
        });
        handleAutoKey(updates);
      }
      return;
    }

    let delta = 0;
    if (typeof val === "number") {
      // Guard against undefined or missing values to prevent NaN delta calculations
      if (prop === "x") delta = val - (primaryPart.transform.x || 0);
      else if (prop === "y") delta = val - (primaryPart.transform.y || 0);
      else if (prop === "scale")
        delta = val - (primaryPart.transform.scaleX || 1);
      else if (prop === "rotation")
        delta = val - (primaryPart.transform.rotation || 0);
      else if (prop === "anchorX")
        delta = val - (primaryPart.transform.anchorX || 50);
      else if (prop === "anchorY")
        delta = val - (primaryPart.transform.anchorY || 50);

      if (isNaN(delta) || delta === 0) return;
    }

    if (autoKeyEnabled) {
      const autoKeyProps: Record<string, number | boolean> = {};
      selectedPartIds.forEach((id) => {
        const part = character[id];
        if (!part) return;
        const prefix = `part:${activeSceneCharacterId}:${id}`;
        if (typeof val === "number") {
          if (prop === "x")
            autoKeyProps[`${prefix}:x`] = (part.transform.x || 0) + delta;
          else if (prop === "y")
            autoKeyProps[`${prefix}:y`] = (part.transform.y || 0) + delta;
          else if (prop === "scale") {
            autoKeyProps[`${prefix}:scaleX`] =
              (part.transform.scaleX || 1) + delta;
            autoKeyProps[`${prefix}:scaleY`] =
              (part.transform.scaleY || 1) + delta;
          } else if (prop === "rotation")
            autoKeyProps[`${prefix}:rotation`] =
              (part.transform.rotation || 0) + delta;
          else if (prop === "anchorX")
            autoKeyProps[`${prefix}:anchorX`] =
              (part.transform.anchorX || 50) + delta;
          else if (prop === "anchorY")
            autoKeyProps[`${prefix}:anchorY`] =
              (part.transform.anchorY || 50) + delta;
        } else {
          autoKeyProps[`${prefix}:${prop}`] = val;
        }
      });
      handleAutoKey(autoKeyProps as any);
    }

    setCharacter((prev) => {
      if (!prev) return null;
      const next = { ...prev };
      selectedPartIds.forEach((id) => {
        const part = next[id];
        if (!part) return;
        const newTransform = { ...part.transform };
        if (typeof val === "number") {
          if (prop === "x") newTransform.x = (newTransform.x || 0) + delta;
          else if (prop === "y")
            newTransform.y = (newTransform.y || 0) + delta;
          else if (prop === "scale") {
            newTransform.scaleX = (newTransform.scaleX || 1) + delta;
            newTransform.scaleY = (newTransform.scaleY || 1) + delta;
          } else if (prop === "rotation")
            newTransform.rotation = (newTransform.rotation || 0) + delta;
          else if (prop === "anchorX")
            newTransform.anchorX = (newTransform.anchorX || 50) + delta;
          else if (prop === "anchorY")
            newTransform.anchorY = (newTransform.anchorY || 50) + delta;
        } else {
          if (prop === "flipX") newTransform.flipX = val;
          else if (prop === "flipY") newTransform.flipY = val;
        }

        next[id] = { ...part, transform: newTransform };
      });
      return next;
    });
  };

  const updateCharacterFilter = (
    prop: string,
    val: number | boolean,
    targetCharId: string = activeSceneCharacterId!,
  ) => {
    if (!targetCharId) return;

    const globalOnlyProps = ['headTurn', 'exprState', 'pupilX', 'pupilY', 'autoBlink', 'sharpness'];
    if (targetCharId !== "ALL" && propertyTarget && propertyTarget !== "root" && !globalOnlyProps.includes(prop)) {
      setCharacter((prev) => {
        const next = { ...prev };
        selectedPartIds.forEach((id) => {
          if (next[id]) {
            next[id] = {
              ...next[id],
              filters: {
                ...(next[id].filters || {
                  saturation: 100,
                  contrast: 100,
                  brightness: 100,
                }),
                [prop]: val,
              },
            };
          }
        });
        return next;
      });
      if (autoKeyEnabled && typeof val === "number") {
        let updates: Record<string, number> = {};
        selectedPartIds.forEach((id) => {
          updates[`part:${targetCharId}:${id}:${String(prop)}`] = val;
        });
        handleAutoKey(updates);
      }
      return;
    }

    if (targetCharId === "ALL") {
      const allUpdates: Record<string, number | boolean> = {};
      setCharacterFiltersMap((prev) => {
        const next = { ...prev };
        characters.forEach((c) => {
          next[c.id] = {
            ...(prev[c.id] || {
              saturation: 100,
              contrast: 100,
              brightness: 100,
              sharpness: 0,
              eyeSquint: 0,
              pupilX: 0,
              pupilY: 0,
              exprState: 0
            }),
            [prop]: val,
          };
          if (typeof val === "number")
            allUpdates[`char:${c.id}:${String(prop)}`] = val;
        });
        return next;
      });
      if (autoKeyEnabled && Object.keys(allUpdates).length > 0) {
        handleAutoKey(allUpdates as any);
      }
    } else {
      setCharacterFiltersMap((prev) => ({
        ...prev,
        [targetCharId]: {
          ...(prev[targetCharId] || {
            saturation: 100,
            contrast: 100,
            brightness: 100,
            sharpness: 0,
            eyeSquint: 0,
            pupilX: 0,
            pupilY: 0,
            exprState: 0
          }),
          [prop]: val,
        },
      }));
      if (autoKeyEnabled && typeof val === "number") {
        handleAutoKey({ [`char:${targetCharId}:${String(prop)}`]: val });
      }
    }
  };

  const handleVisemeOverride = (shape: VisemeShape) => {
    setManualVisemeOverride((prev) => (prev === shape ? null : shape));
  };

  const riggedParts = useMemo(() => {
    if (!character) return [];
    return Object.values(character).filter(
      (p: CharacterPart) => p.bones && p.bones.length > 0,
    );
  }, [character]);

  const updatePuppetBone = (
    prop: "rotation" | "scaleX" | "scaleY",
    val: number,
  ) => {
    if (!activeBoneId || !activeSceneCharacterId) return;
    const key = `${propertyTarget}|${activeBoneId}`;
    setCurrentBoneTransforms((prev) => ({
      ...prev,
      [key]: {
        ...(prev[key] || { rotation: 0, scaleX: 1, scaleY: 1 }),
        [prop]: val,
      },
    }));

    if (autoKeyEnabled) {
      handleAutoKey({
        [`puppet:${activeSceneCharacterId}:${propertyTarget}:${activeBoneId}:${prop}`]:
          val,
      });
    }
  };

  const handleSunPreset = (preset: "MORNING" | "NOON" | "EVENING") => {
    const sunId = "global_sun";
    const presets = {
      MORNING: { color: "#ffdfb0", intensity: 1.2, x: -150, y: -150 },
      NOON: { color: "#ffffff", intensity: 1.5, x: 0, y: -200 },
      EVENING: { color: "#ff8c42", intensity: 1.0, x: 150, y: -100 },
    };

    setLightSources((prev) => {
      const existing = prev.find((l) => l.type === "SUN");
      if (existing) {
        return prev.map((l) =>
          l.type === "SUN" ? { ...l, ...presets[preset], isActive: true } : l,
        );
      } else {
        return [
          ...prev,
          {
            id: sunId,
            type: "SUN",
            ...presets[preset],
            softness: 10,
            radius: 800,
            isActive: true,
          },
        ];
      }
    });
    showToast(`PRESET APPLIED: ${String(preset)}`);
    setShouldRecordHistory(true);
  };

  const handleLightUpdate = (id: string, updates: Partial<LightSource>) => {
    setLightSources((prev) =>
      prev.map((l) => (l.id === id ? { ...l, ...updates } : l)),
    );

    if (autoKeyEnabled) {
      const props: Record<string, number> = {};
      if (updates.intensity !== undefined)
        props[`light:${id}:intensity`] = updates.intensity;
      if (updates.softness !== undefined)
        props[`light:${id}:softness`] = updates.softness;
      if (updates.radius !== undefined)
        props[`light:${id}:radius`] = updates.radius;
      if (Object.keys(props).length > 0) handleAutoKey(props);
    }
  };

  const handleAddLight = (type: LightType) => {
    const id = `${type.toLowerCase()}_${Date.now().toString().slice(-4)}`;
    const newLight: LightSource = {
      id,
      type,
      x: 0,
      y: 0,
      intensity: 0.8,
      color: type === "SUN" ? "#ffcc00" : type === "BULB" ? "#00f2ff" : "#ffffff",
      radius: 300,
      softness: 20,
      isActive: true,
    };
    setLightSources((prev) => [...prev, newLight]);
    setKeyframes((prev) => prev.map(kf => ({
       ...kf,
       properties: {
          ...kf.properties,
          [`light:${id}:intensity`]: 0.8,
          [`light:${id}:x`]: 0,
          [`light:${id}:y`]: 0,
          [`light:${id}:softness`]: 20,
          [`light:${id}:radius`]: 300,
       }
    })));
    setShouldRecordHistory(true);
    showToast(`ADDED ${type} LIGHT`);
  };

  const handleRemoveLight = (id: string) => {
    setLightSources((prev) => prev.filter((l) => l.id !== id));
    setShouldRecordHistory(true);
    showToast("LIGHT REMOVED");
  };

  const cancelDelete = () =>
    setDeleteConfirmation({ isOpen: false, trackId: null });

  const confirmDelete = () => {
    if (deleteConfirmation.trackId === "vocal")
      setVocalTrack((prev) => ({ ...prev, buffer: null }));
    else setInstTrack((prev) => ({ ...prev, buffer: null }));
    setDeleteConfirmation({ isOpen: false, trackId: null });
    setShouldRecordHistory(true);
  };

  const confirmSlice = (keep: "LEFT" | "RIGHT") => {
    engine.sliceTrack(sliceModal.trackId, sliceModal.time, keep);
    setSliceModal({ ...sliceModal, isOpen: false });
    setShouldRecordHistory(true);
    showToast("TRACK SLICED");
  };

  const handleBackgroundUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const url = event.target?.result as string;
        const img = new Image();
        img.onload = () => {
          const newBg = { url, width: img.width, height: img.height };
          setBackgroundImage(newBg);
          setAvailableBackgrounds(prev => {
              if (prev.find(b => b.url === url)) {
                  if (autoKeyEnabled) handleAutoKey({ "bg:index": prev.findIndex(b => b.url === url) });
                  return prev;
              }
              if (autoKeyEnabled) handleAutoKey({ "bg:index": prev.length });
              return [...prev, newBg];
          });
          setShouldRecordHistory(true);
        };
        img.src = url;
      };
      reader.readAsDataURL(file);
    }
  };

  const handleEasingSelect = (easing: EasingType) => {
    if (editingKeyframeId) {
      handleUpdateKeyframe(editingKeyframeId, { easing });
      setEasingMenuOpen(false);
    }
  };

  const handleAutoLipSyncComplete = (keys: LipSyncKeyframe[]) => {
    const target = lipSyncTargetId === "ALL" ? undefined : lipSyncTargetId;
    const keysWithTarget = keys.map((k) => ({ ...k, targetId: target }));

    setLipSyncKeyframes((prev) => {
      // Replace all existing auto-keyframes with the newly generated ones
      // They are tied to the new target
      return [...prev.filter((k) => k.isManual), ...keysWithTarget].sort(
        (a, b) => a.time - b.time,
      );
    });

    setIsLipSyncModalOpen(false);
    setShouldRecordHistory(true);
    showToast("LIP SYNC GENERATED");
  };

  // --- PROJECT MANAGEMENT FUNCTIONS ---

  const resetState = () => {
    setCharacters([]);
    setActiveSceneCharacterId(null);
    setKeyframes([]);
    setLipSyncKeyframes([]);
    setFrameData([]);
    setVocalTrack((prev) => ({
      ...prev,
      buffer: null,
      name: "Vocal Track",
      gain: 0.8,
      pitch: 1,
      muted: false,
    }));
    setInstTrack((prev) => ({
      ...prev,
      buffer: null,
      name: "Instrumental",
      gain: 0.6,
      pitch: 1,
      muted: false,
    }));

    // Reset scene/background states
    setBackgroundImage({ url: null, width: 0, height: 0 });
    setBackgroundTransform({
      zoom: 100,
      x: 50,
      y: 50,
      blur: 0,
      brightness: 100,
      contrast: 100,
      saturation: 100,
    });
    setVisemeMap({
      [VisemeShape.REST]: null,
      [VisemeShape.AI]: null,
      [VisemeShape.E]: null,
      [VisemeShape.O]: null,
      [VisemeShape.U]: null,
      [VisemeShape.FV]: null,
      [VisemeShape.L]: null,
      [VisemeShape.MBP]: null,
      [VisemeShape.CONS]: null,
    });
    setLinkBgToCamera(false);
    setAmbientLightLevel(0.15);
    setCanvasBgColor("#ffffff");
    setIsCanvasTransparent(false);
    setActiveBoneId(null);
    setCurrentBoneTransforms({});
    setCharacterFiltersMap({});
    setLightSources([]);
  };

  const handleNewProject = (
    type: ProjectType = "CHARACTER",
    settings?: FrameSettings & { name: string, aspectRatio?: string },
  ) => {
    setAppMode("EDITOR");
    setProjectType(type);

    // Reset UI states to standard view
    setIsTabsVisible(false);
    setActiveBottomTab("TIMELINE");
    setIsLeftPanelOpen(false);

    // Reset critical state
    resetState();
    setHistory([]);
    setHistoryIndex(-1);
    setCurrentProjectId(`proj_${Date.now()}`);

    if (settings) {
      setProjectName(settings.name);
      if (type === "FRAME") {
        setFrameSettings({
          width: settings.width,
          height: settings.height,
          fps: settings.fps,
        });
      } else {
        if (settings.aspectRatio) setAspectRatio(settings.aspectRatio);
        setFrameSettings(undefined);
      }
    } else {
      setProjectName(`Project ${new Date().toLocaleDateString()}`);
      setFrameSettings(undefined);
    }

    showToast(`NEW ${type} PROJECT`);
    setShouldRecordHistory(true);
  };

  const handleOpenProject = async (file: File | any) => {
    if (file && !(file instanceof File) && typeof file === 'object') {
      restoreProjectState(file);
      return;
    }

    if (file && file instanceof File) {
      const nameLower = file.name.toLowerCase();
      const isBin = nameLower.endsWith(".bin") || nameLower.includes(".bin");
      const isPsd = nameLower.endsWith(".psd");
      const isCarta = nameLower.endsWith(".carta");
      const isZip = nameLower.endsWith(".zip") || nameLower.includes(".zip") || file.type === "application/zip" || file.type === "application/x-zip-compressed";

      if (isBin || isPsd || isCarta || isZip) {
        try {
          const buffer = await file.arrayBuffer();
          const headBytes = new Uint8Array(buffer.slice(0, 4));
          const isRealPsd = headBytes[0] === 0x38 && headBytes[1] === 0x42 && headBytes[2] === 0x50 && headBytes[3] === 0x53; // "8BPS"
          const isRealZip = (headBytes[0] === 0x50 && headBytes[1] === 0x4b) || file.type === "application/zip" || file.type === "application/x-zip-compressed";

          // 1. Convert .bin to appropriate extension
          if (isBin && isRealPsd) {
             showAppToast(t ? t("Converting .bin to .psd...") : "Converting .bin to .psd...");
             const newName = file.name.replace(/\.bin$/i, ".psd");
             file = new File([buffer], newName, { type: "image/vnd.adobe.photoshop" });
          } else if (isBin && isRealZip) {
             showAppToast(t ? t("Converting .bin to .zip...") : "Converting .bin to .zip...");
             const newName = file.name.replace(/\.bin$/i, ".zip");
             file = new File([buffer], newName, { type: "application/zip" });
          }

          if (file.name?.toLowerCase()?.endsWith(".zip") || file.name?.toLowerCase()?.includes(".zip") || isRealZip || file.type === "application/zip" || file.type === "application/x-zip-compressed") {
             handleNewProject("CHARACTER");
             setPendingImportFile(file);
             setIsCharacterStudioModalOpen(true);
             setIsCharacterBuilderOpen(true);
             showAppToast(t ? t("Loading ZIP into Character Assembler...") : "Loading ZIP into Character Assembler...");
             return;
          }

          // 2. Process .psd (original or converted from .bin) and load into specialized .carta project
          if (file.name?.toLowerCase()?.endsWith(".psd")) {
             showAppToast(t ? t("Processing interactive character layers...") : "Processing interactive character layers...");
             
             const { readPsd } = await import("ag-psd");
             const { DEFAULT_TRANSFORM, createPart } = await import("./utils/characterDefaults");
             const { autoCalculatePivots } = await import("./utils/autoPivot");

             const psd = readPsd(buffer, {
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
                 root: createPart("root", file.name.replace(/\.psd$/i, ""), null, 10, {
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

             const getLayerImageUri = (layerData: any): string => {
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
                 const processLayer = (layer: any, parentId: string) => {
                     const partId = `psd_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
                     if (layer.children !== undefined && layer.children.length > 0) {
                         newCharacter[partId] = createPart(partId, layer.name || "Group", parentId, globalZIndex--, { tags: [(layer.name || "").toLowerCase().includes("view") || (parentId === "root" && ((layer.name || "").toLowerCase().includes("front") || (layer.name || "").toLowerCase().includes("side") || (layer.name || "").toLowerCase().includes("back"))) ? "View" : ""].filter(Boolean),
                             isGroup: true,
                             isVisible: layer.hidden !== true,
                             isOpen: layer.opened !== false,
                             width: 0,
                             height: 0,
                             transform: { ...DEFAULT_TRANSFORM, x: 0, y: 0 },
                             children: [],
                         });
                         for (let i = layer.children.length - 1; i >= 0; i--) {
                             processLayer(layer.children[i], partId);
                         }
                         newCharacter[parentId].children.push(partId);
                     } else {
                         if (layer.canvas || layer.imageData) {
                             const dataUri = getLayerImageUri(layer);
                             if (dataUri) {
                                 const layerWidth = (layer.canvas?.width || layer.imageData?.width || 0) * scale;
                                 const layerHeight = (layer.canvas?.height || layer.imageData?.height || 0) * scale;
                                 const centerX = (layer.left || 0) + (layer.canvas?.width || layer.imageData?.width || 0) / 2;
                                 const centerY = (layer.top || 0) + (layer.canvas?.height || layer.imageData?.height || 0) / 2;
                                 const offsetX = (centerX - psdWidth / 2) * scale;
                                 const offsetY = (centerY - psdHeight / 2) * scale;

                                 newCharacter[partId] = createPart(partId, layer.name || "Layer", parentId, globalZIndex--, {
                                     imageUrl: dataUri,
                                     isVisible: layer.hidden !== true,
                                     width: layerWidth,
                                     height: layerHeight,
                                     transform: {
                                         ...DEFAULT_TRANSFORM,
                                         x: offsetX,
                                         y: offsetY,
                                     },
                                 });
                                 newCharacter[parentId].children.push(partId);
                             }
                         }
                     }
                 };
                 for (let i = psd.children.length - 1; i >= 0; i--) {
                     processLayer(psd.children[i], "root");
                 }
             }

              // Auto-toggle views so only the first one is visible
              const allViews = Object.values(newCharacter).filter((p: any) => p.tags?.includes("View") || p.label?.toLowerCase()?.includes("view"));
              if (allViews.length > 0) {
                  let defaultView: any = allViews.find((v: any) => v.isVisible === true);
                  if (!defaultView) defaultView = allViews.find((v: any) => v.label?.toLowerCase()?.includes("front"));
                  if (!defaultView) defaultView = allViews[allViews.length - 1]; // Top-most view folder
                  
                  allViews.forEach((v: any) => {
                      const isDefault = v.id === defaultView.id;
                      newCharacter[v.id] = {
                          ...newCharacter[v.id],
                          isVisible: isDefault,
                          opacity: isDefault ? 1 : 0
                      };
                      const descendants = getDescendants(newCharacter, v.id);
                      descendants.forEach((dId: string) => {
                          newCharacter[dId] = {
                              ...newCharacter[dId],
                              isVisible: isDefault,
                              opacity: isDefault ? 1 : 0
                          };
                      });
                  });
              }

             const charId = "char_" + Date.now();
             const autoChar = autoCalculatePivots(newCharacter);
             const wrappedChar = {
                 id: charId,
                 name: file.name.replace(/\.psd$/i, ""),
                 composition: autoChar,
                 visemeMap: { REST: null, AI: null, E: null, O: null, U: null, FV: null, L: null, MBP: null, CONS: null },
                 origin: "DESIGNER"
             };

             const autoProject = {
                 id: `proj_${Date.now()}`,
                 name: file.name.replace(/\.psd$/i, "") + " Project",
                 projectType: 'CHARACTER',
                 characters: [wrappedChar],
                 activeSceneCharacterId: charId,
                 animationData: {},
                 timelineDuration: 60,
                 playheadPosition: 0,
                 lastModified: Date.now(),
             };

             restoreProjectState(autoProject);
             showAppToast(t ? t("Seamlessly loaded into .carta studio project!") : "Seamlessly loaded into .carta studio project!");
             return;
          }

          // 3. Process .carta file drops or direct loads
          if (isCarta) {
             const { autoCalculatePivots } = await import("./utils/autoPivot");
             const text = await file.text();
             let parsedData = JSON.parse(text.trim().replace(/^\uFEFF/, ""));
             
             if (parsedData && !parsedData.projectType && !parsedData.id?.startsWith("proj_")) {
                 const charId = parsedData.id || "char_" + Date.now();
                 parsedData = {
                     id: `proj_${Date.now()}`,
                     name: (parsedData.name || "Carta Item") + " Project",
                     projectType: 'CHARACTER',
                     characters: [parsedData],
                     activeSceneCharacterId: charId,
                     animationData: {},
                     timelineDuration: 60,
                     playheadPosition: 0,
                     lastModified: Date.now(),
                 };
             }

             restoreProjectState(parsedData);
             showAppToast(t ? t("Loaded .carta project!") : "Loaded .carta project!");
             return;
          }
        } catch (err) {
          console.error("Advanced format pre-processor failed:", err);
        }
      }
    }

    let processedFile = file;
    if (file && file instanceof File && file.name?.toLowerCase()?.endsWith(".bin")) {
      try {
        const text = await file.text();
        JSON.parse(text);
        const newName = file.name.replace(/\.bin$/i, ".animato_project");
        processedFile = new File([text], newName, { type: "application/json" });
      } catch (err) {
        console.error("Failed to parse .bin project file as JSON", err);
        showAppToast(t("Import failed"));
        return;
      }
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const json = JSON.parse(text);
        restoreProjectState(json);
      } catch (err) {
        console.error(err);
        showAppToast(t("Import failed"));
      }
    };
    reader.readAsText(processedFile);
  };

  const restoreProjectState = async (json: any) => {
    // Relaxed validation: Just needs an ID (internal) or Metadata (external)
    const isValid = json && (json.id || json.metadata);

    if (isValid) {
      try {
        resetState();

        if (json.id) setCurrentProjectId(json.id);
        if (json.name) setProjectName(json.name);
        if (json.projectType) setProjectType(json.projectType);

        // Destructively restore state (default to empty/null if missing in JSON)
        if (json.characters) {
          setCharacters(json.characters);
          setActiveSceneCharacterId(
            json.activeSceneCharacterId ||
              (json.characters.length > 0 ? json.characters[0].id : null),
          );
        } else if (json.character) {
          // Migration path
          const newId = `char_${Date.now()}`;
          setCharacters([
            {
              id: newId,
              name: "Main Character",
              composition: json.character,
              origin: "DESIGNER",
              assemblerSession: json.assemblerSession,
            },
          ]);
          setActiveSceneCharacterId(newId);
        } else {
          setCharacters([]);
          setActiveSceneCharacterId(null);
        }

        setKeyframes(json.keyframes || []);
        setLipSyncKeyframes(json.lipSyncKeyframes || []);
        setFrameData(json.frames || []); // Load frames if they exist
        if (json.frameSettings) setFrameSettings(json.frameSettings);
        if (json.aspectRatio) setAspectRatio(json.aspectRatio);

        setCameraTransform(
          json.cameraTransform || { x: 0, y: 0, scale: 1, rotation: 0 },
        );

        if (json.characterFiltersMap) {
          setCharacterFiltersMap(json.characterFiltersMap);
        } else if (json.characterFilters) {
          if (json.character) {
            // MIGRATION filter state for active character
            setCharacterFiltersMap((prev) => ({
              ...prev,
              [activeSceneCharacterId || `char_${Date.now()}`]:
                json.characterFilters,
            }));
          }
        } else {
          setCharacterFiltersMap({});
        }

        setLightSources(json.lightSources || []);
        const defaultBgTransform = {
          zoom: 100,
          x: 50,
          y: 50,
          blur: 0,
          brightness: 100,
          contrast: 100,
          saturation: 100,
        };
        setBackgroundTransform(
          json.backgroundTransform
            ? { ...defaultBgTransform, ...json.backgroundTransform }
            : defaultBgTransform,
        );
        setVisemeMap(
          json.visemeMap || {
            [VisemeShape.REST]: null,
            [VisemeShape.AI]: null,
            [VisemeShape.E]: null,
            [VisemeShape.O]: null,
            [VisemeShape.U]: null,
            [VisemeShape.FV]: null,
            [VisemeShape.L]: null,
            [VisemeShape.MBP]: null,
            [VisemeShape.CONS]: null,
          },
        );
        setAmbientLightLevel(
          json.ambientLightLevel !== undefined ? json.ambientLightLevel : 0.15,
        );
        setCanvasBgColor(json.canvasBgColor || "#ffffff");
        setIsCanvasTransparent(json.isCanvasTransparent || false);
        setBackgroundImage(
          json.backgroundImage || { url: null, width: 0, height: 0 },
        );
        setLinkBgToCamera(json.linkBgToCamera || false);
        setCustomCSS(json.customCSS || "");
        setExtraDuration(json.extraDuration || 0);

        if (json.vocalTrackData && json.vocalTrackData.url) {
          try {
            setVocalTrack((prev) => ({
              ...prev,
              name: json.vocalTrackData.name || "Vocal Track",
              gain: json.vocalTrackData.gain ?? 0.8,
              pitch: json.vocalTrackData.pitch ?? 1,
              speed: json.vocalTrackData.speed ?? 1.0,
              muted: json.vocalTrackData.muted ?? false,
              url: json.vocalTrackData.url,
            }));
            await engine.loadTrackFromBase64(json.vocalTrackData.url, "vocal");
          } catch (audioErr) {
            console.warn("Could not load vocal audio buffer trace safely", audioErr);
          }
        } else {
          setVocalTrack((prev) => ({
            ...prev,
            buffer: null,
            name: "Vocal Track",
          }));
        }

        if (json.instTrackData && json.instTrackData.url) {
          try {
            setInstTrack((prev) => ({
              ...prev,
              name: json.instTrackData.name || "Instrumental",
              gain: json.instTrackData.gain ?? 0.6,
              pitch: json.instTrackData.pitch ?? 1,
              speed: json.instTrackData.speed ?? 1.0,
              muted: json.instTrackData.muted ?? false,
              url: json.instTrackData.url,
            }));
            await engine.loadTrackFromBase64(json.instTrackData.url, "inst");
          } catch (audioErr) {
            console.warn("Could not load instrumental audio buffer trace safely", audioErr);
          }
        } else {
          setInstTrack((prev) => ({
            ...prev,
            buffer: null,
            name: "Instrumental",
          }));
        }

        if (json.audioDuration) {
          engine.setTotalDuration(json.audioDuration);
        }

        // Reset UI states to standard view
        setIsTabsVisible(false);
        setActiveBottomTab("TIMELINE");
        setIsLeftPanelOpen(false);

        setAppMode("EDITOR");
        setIsCharacterBuilderOpen(false);

        // Allow state to settle before recording history
        setTimeout(() => {
          setShouldRecordHistory(true);
          showToast("PROJECT LOADED");
        }, 100);
      } catch (err) {
        console.error("Critical error while restoring project state: ", err);
        showAppToast(t ? t("Project restored with fallback parameters") : "Project loaded with defaults");
        setAppMode("EDITOR");
      }
    } else {
      console.error("Project Load Failed: Invalid structure", json);
      showAppToast("Invalid Animato Project File or Corrupted Save");
    }
  };

  const handleImportToExistingProject = async (projectId: string, importedData: any) => {
    try {
      showAppToast("Loading existing project...");
      const existingProject = await StorageUtils.loadProject(projectId);
      if (!existingProject) {
        showAppToast("Failed to load existing project");
        return;
      }

      if (!existingProject.characters) {
        existingProject.characters = [];
      }
      if (existingProject.character && existingProject.characters.length === 0) {
        existingProject.characters.push({
          id: existingProject.activeSceneCharacterId || `char_old_${Date.now()}`,
          name: existingProject.name || "Main Character",
          composition: existingProject.character,
          origin: "DESIGNER"
        });
      }

      let characterToImport: any = null;

      if (importedData instanceof File) {
        const nameLower = importedData.name.toLowerCase();
        const isZip = nameLower.endsWith(".zip") || nameLower.includes(".zip") || importedData.type === "application/zip" || importedData.type === "application/x-zip-compressed";
        
        if (isZip) {
          const JSZip = (await import("jszip")).default;
          const zipInstance = await JSZip.loadAsync(importedData);
          let jsonFileEntry: any = null;
          zipInstance.forEach((relativePath, entry) => {
            const isJunk = relativePath.includes('__MACOSX') || relativePath.split('/').some(p => p.startsWith('.'));
            if (!entry.dir && !isJunk && (relativePath.endsWith('.json') || relativePath.endsWith('.animato') || relativePath.endsWith('.animato_project'))) {
              jsonFileEntry = entry;
            }
          });
          if (!jsonFileEntry) {
            zipInstance.forEach((relativePath, entry) => {
              const isJunk = relativePath.includes('__MACOSX') || relativePath.split('/').some(p => p.startsWith('.'));
              if (!entry.dir && !isJunk && !jsonFileEntry) {
                jsonFileEntry = entry;
              }
            });
          }
          if (jsonFileEntry) {
            const jsonText = await jsonFileEntry.async('string');
            const cleanText = jsonText.trim().replace(/^\uFEFF/, "");
            let parsed = JSON.parse(cleanText);
            
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

            const charId = "char_" + Date.now();
            const { autoCalculatePivots } = await import("./utils/autoPivot");
            characterToImport = {
              id: charId,
              name: importedData.name.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " ").trim(),
              composition: autoCalculatePivots(parsed.composition || parsed),
              origin: "DESIGNER",
              visemeMap: parsed.visemeMap || { REST: null, AI: null, E: null, O: null, U: null, FV: null, L: null, MBP: null, CONS: null }
            };
          }
        } else if (nameLower.endsWith(".psd")) {
          const { readPsd } = await import("ag-psd");
          const { DEFAULT_TRANSFORM, createPart } = await import("./utils/characterDefaults");
          const { autoCalculatePivots } = await import("./utils/autoPivot");
          const arrayBuffer = await importedData.arrayBuffer();
          const psd = readPsd(arrayBuffer, { skipLayerImageData: false, skipThumbnail: true });
          
          const psdWidth = psd.width || 1000;
          const psdHeight = psd.height || 1000;
          const scale = Math.min(1, 425 / psdWidth, 425 / psdHeight);
          
          const composition: any = {
            root: createPart("root", importedData.name.replace(/\.psd$/i, ""), null, 10, {
              isGroup: true,
              isOpen: true,
              width: 0,
              height: 0,
              transform: { ...DEFAULT_TRANSFORM, x: 0, y: 0, scaleX: 1, scaleY: 1 }
            })
          };

          const getLayerImageUri = async (layerData: any): Promise<string> => {
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
            let zIndex = 100000;
            const processLayer = async (layer: any, parentId: string) => {
              const partId = `psd_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
              if (layer.children !== undefined && layer.children.length > 0) {
                composition[partId] = createPart(partId, layer.name || "Folder", parentId, zIndex--, {
                  isGroup: true,
                  isOpen: true,
                  transform: { ...DEFAULT_TRANSFORM, x: 0, y: 0 }
                });
                for (const child of layer.children) {
                  await processLayer(child, partId);
                }
              } else {
                const imgUri = await getLayerImageUri(layer);
                if (imgUri) {
                  const x = (layer.left || 0) + (layer.width || 0) / 2 - psdWidth / 2;
                  const y = (layer.top || 0) + (layer.height || 0) / 2 - psdHeight / 2;
                  composition[partId] = createPart(partId, layer.name || "Layer", parentId, zIndex--, {
                    imageUrl: imgUri,
                    width: layer.width || 100,
                    height: layer.height || 100,
                    transform: { ...DEFAULT_TRANSFORM, x: x * scale, y: y * scale, scaleX: scale, scaleY: scale }
                  });
                }
              }
            };
            for (const layer of psd.children) {
              await processLayer(layer, "root");
            }
          }

          characterToImport = {
            id: `char_${Date.now()}`,
            name: importedData.name.replace(/\.psd$/i, "").replace(/[-_]/g, " ").trim(),
            composition: autoCalculatePivots(composition),
            origin: "DESIGNER",
            visemeMap: { REST: null, AI: null, E: null, O: null, U: null, FV: null, L: null, MBP: null, CONS: null }
          };
        }
      } else if (importedData && typeof importedData === 'object') {
        if (importedData.characters && importedData.characters.length > 0) {
          characterToImport = importedData.characters[0];
        } else if (importedData.character) {
          characterToImport = {
            id: importedData.activeSceneCharacterId || `char_store_${Date.now()}`,
            name: importedData.name || "Imported Character",
            composition: importedData.character,
            origin: "DESIGNER",
            visemeMap: importedData.visemeMap || { REST: null, AI: null, E: null, O: null, U: null, FV: null, L: null, MBP: null, CONS: null }
          };
        }
      }

      if (!characterToImport) {
        showAppToast("Failed to parse character from asset package");
        return;
      }

      const uniqueCharId = `char_${Date.now()}`;
      characterToImport.id = uniqueCharId;

      existingProject.characters.push(characterToImport);
      existingProject.activeSceneCharacterId = uniqueCharId;

      await StorageUtils.saveProject(existingProject);
      await handleLoadSavedProject(projectId);
      showAppToast(`Successfully imported ${characterToImport.name}!`);
    } catch (err) {
      console.error("Import to existing project failed:", err);
      showAppToast("Import to existing project failed");
    }
  };

  const handleLoadSavedProject = async (id: string) => {
    const projMeta = savedProjects.find(p => p.id === id);
    const projName = projMeta ? projMeta.name : "Animato Project";

    setOpeningProjectState({
      id,
      name: projName,
      progress: 5,
      step: "Decompressing and parsing project data..."
    });

    const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
    await delay(200);

    try {
      let data = await StorageUtils.loadProject(id);
      
      setOpeningProjectState(prev => prev ? { ...prev, progress: 35, step: "Deserializing file structure & assets..." } : null);
      await delay(200);

      if (!data) {
         const cloudProj = savedProjects.find(p => p.id === id && (p as any)._cloudData);
         if (cloudProj && (cloudProj as any)._cloudData) {
           data = (cloudProj as any)._cloudData;
           await StorageUtils.saveProject((data as any));
         }
      }

      if (data) {
        setOpeningProjectState(prev => prev ? { ...prev, progress: 65, step: "Reconstructing kinematic skeleton & bones..." } : null);
        await delay(200);

        await restoreProjectState(data);

        setOpeningProjectState(prev => prev ? { ...prev, progress: 95, step: "Initializing viewport layout & frames..." } : null);
        await delay(200);

        setOpeningProjectState(prev => prev ? { ...prev, progress: 100, step: "Project ready for Animato!" } : null);
        await delay(250);

        setAppMode("EDITOR");
        showToast(`LOADED: ${data.name}`);
      } else {
        showToast("PROJECT NOT FOUND");
      }
    } catch (err: any) {
      console.error("Failed to load project with spinner", err);
      showToast("FAILED TO OPEN PROJECT");
    } finally {
      setOpeningProjectState(null);
    }
  };

  const handleDeleteProject = async (id: string) => {
    await StorageUtils.deleteProject(id);
    setSavedProjects(prev => prev.filter(p => p.id !== id));
    showToast("PROJECT DELETED");
  };

  const handleRenameProject = async (id: string, newName: string) => {
    await StorageUtils.renameProject(id, newName);
    await refreshProjectsList();
    if (id === currentProjectId) setProjectName(newName);
    showToast("PROJECT RENAMED");
  };

  const handleDuplicateProject = async (id: string) => {
    const data = await StorageUtils.loadProject(id);
    if (data) {
      const newId = `proj_${Date.now()}`;
      const newData = {
        ...data,
        id: newId,
        name: `${data.name} (Copy)`,
        lastModified: Date.now(),
      };
      const success = await StorageUtils.saveProject(newData);
      if (success) {
        await refreshProjectsList();
        showToast("PROJECT DUPLICATED");
      } else {
        showToast("DUPLICATION FAILED");
      }
    }
  };

  const handleSaveToStorage = useCallback(
    async (
      customThumb?: string | any,
      frameAudioData?: { url: string; name: string },
      extraSettings?: any,
    ) => {
      const originalTime = playbackState.currentTime;
      let thumb = typeof customThumb === "string" ? customThumb : "";

      // If extraSettings provided, update frameSettings state immediately
      if (extraSettings) {
        setFrameSettings(
          (prev) =>
            ({
              ...prev,
              ...extraSettings,
              // Ensure width/height are preserved if not in extraSettings
              width: prev?.width || 1920,
              height: prev?.height || 1080,
              fps: extraSettings.fps || prev?.fps || 12,
            }) as FrameSettings,
        );
      }

      // If frameAudioData provided, update vocal track
      if (frameAudioData) {
        try {
          const response = await fetch(frameAudioData.url);
          const arrayBuffer = await response.arrayBuffer();
          const buffer =
            await engine.audioContextRef.current?.decodeAudioData(arrayBuffer);
          if (buffer) {
            setVocalTrack({
              buffer,
              gain: 1,
              pitch: 1,
              muted: false,
              name: frameAudioData.name,
            });
          }
        } catch (e) {
          console.error("Failed to restore frame audio during save", e);
        }
      }
      if (!thumb) {
        try {
          if (projectType === "CHARACTER") {
            engine.seek(0);
            await new Promise((r) => setTimeout(r, 100));
          }

          // Adjust thumbnail source based on mode
          const el = document.getElementById(
            projectType === "FRAME"
              ? "animato-frame-canvas"
              : "animato-render-stage",
          );
          if (el) {
            // @ts-ignore
            const canvas = await html2canvas(el, {
              backgroundColor: null,
              scale: window.innerWidth <= 768 ? 0.1 : 0.2, // Drastically reduce scale for mobile devices to prevent RAM crashes
              logging: false, // Turn off logging
            });
            thumb = canvas.toDataURL("image/jpeg", 0.4);
          }

          if (projectType === "CHARACTER") {
            engine.seek(originalTime);
          }
        } catch (e) {
          console.warn("Thumb failed", e);
        }
      }

      let backgroundUrl = backgroundImage.url;

      if (backgroundUrl && backgroundUrl.startsWith("blob:")) {
        try {
          backgroundUrl = await blobUrlToBase64(backgroundUrl);
        } catch (e) {
          console.error("Failed to convert background to base64", e);
        }
      }

      let vocalTrackData = undefined;
      if (frameAudioData) {
        vocalTrackData = {
          ...frameAudioData,
          gain: 1,
          pitch: 1,
          speed: 1.0,
          muted: false,
        };
      } else if (vocalTrack.buffer) {
        try {
          const url = vocalTrack.url || await audioBufferToWavBase64(vocalTrack.buffer);
          if (!vocalTrack.url) setVocalTrack((prev) => ({ ...prev, url }));
          vocalTrackData = {
            url,
            gain: vocalTrack.gain,
            pitch: vocalTrack.pitch,
            speed: vocalTrack.speed ?? 1.0,
            muted: vocalTrack.muted,
            name: vocalTrack.name,
          };
        } catch (e) {
          console.error("Failed to save vocal audio", e);
        }
      }

      let instTrackData = undefined;
      if (instTrack.buffer) {
        try {
          const url = instTrack.url || await audioBufferToWavBase64(instTrack.buffer);
          if (!instTrack.url) setInstTrack((prev) => ({ ...prev, url }));
          instTrackData = {
            url,
            gain: instTrack.gain,
            pitch: instTrack.pitch,
            speed: instTrack.speed ?? 1.0,
            muted: instTrack.muted,
            name: instTrack.name,
          };
        } catch (e) {
          console.error("Failed to save inst audio", e);
        }
      }

      const finalFrameSettings = extraSettings
        ? {
            ...frameSettings,
            ...extraSettings,
            width: frameSettings?.width || 1920,
            height: frameSettings?.height || 1080,
            fps: extraSettings.fps || frameSettings?.fps || 12,
          }
        : frameSettings;

      const projectData: FullProjectData = {
        id: currentProjectId,
        name: projectName,
        lastModified: Date.now(),
        version: "2.4.0",
        thumbnail: thumb,
        projectType: projectType,
        characters,
        activeSceneCharacterId,
        keyframes,
        lipSyncKeyframes,
        cameraTransform,
        characterFiltersMap,
        lightSources,
        backgroundTransform,
        linkBgToCamera,
        ambientLightLevel,
        visemeMap,
        canvasBgColor,
        isCanvasTransparent,
        customCSS,
        backgroundImage: { ...backgroundImage, url: backgroundUrl },
        vocalTrackData,
        instTrackData,
        audioDuration: playbackState.duration,
        extraDuration,
        frames: frameData,
        frameSettings: finalFrameSettings,
        aspectRatio,
      };

      const success = await StorageUtils.saveProject(projectData);
      if (success) {
        await refreshProjectsList();
        showToast("SAVED TO BROWSER");
      } else {
        showToast("SAVE FAILED (STORAGE FULL?)");
      }
    },
    [
      currentProjectId,
      projectName,
      characters,
      activeSceneCharacterId,
      keyframes,
      lipSyncKeyframes,
      cameraTransform,
      characterFiltersMap,
      lightSources,
      backgroundTransform,
      linkBgToCamera,
      ambientLightLevel,
      visemeMap,
      canvasBgColor,
      isCanvasTransparent,
      backgroundImage,
      extraDuration,
      projectType,
      frameData,
      frameSettings,
      vocalTrack,
      instTrack,
      playbackState.duration,
      refreshProjectsList,
    ],
  );

  const autoSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // Notice we don't include handleSaveToStorage to avoid infinite loops when characters update
  useEffect(() => {
    // AUTO SAVE REMOVED FOR PERFORMANCE
    // User requested to remove auto-save as it causes jank and crashes on mobile.
  }, [historyIndex]);

  useEffect(() => {
     const onBeforeUnload = (e: BeforeUnloadEvent) => {
        // We can't await in beforeunload, but we can trigger a synchronous save if possible.
        // IDB is async, so we'll just try to fire it. It might not complete.
        if (currentProjectId && historyIndex >= 0) {
           handleSaveToStorage().catch(() => {});
        }
     };
     window.addEventListener("beforeunload", onBeforeUnload);
     return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [currentProjectId, historyIndex, handleSaveToStorage]);

  // ... (handleExportProject and main render logic remain same) ...
  const handleExportProject = useCallback(async () => {
    let vocalTrackData = undefined;
    if (vocalTrack.buffer) {
      try {
        const url = await audioBufferToWavBase64(vocalTrack.buffer);
        vocalTrackData = {
          url,
          gain: vocalTrack.gain,
          pitch: vocalTrack.pitch,
          speed: vocalTrack.speed ?? 1.0,
          muted: vocalTrack.muted,
          name: vocalTrack.name,
        };
      } catch (e) {
        console.error("Failed to save vocal audio", e);
      }
    }

    let instTrackData = undefined;
    if (instTrack.buffer) {
      try {
        const url = await audioBufferToWavBase64(instTrack.buffer);
        instTrackData = {
          url,
          gain: instTrack.gain,
          pitch: instTrack.pitch,
          speed: instTrack.speed ?? 1.0,
          muted: instTrack.muted,
          name: instTrack.name,
        };
      } catch (e) {
        console.error("Failed to save inst audio", e);
      }
    }

    // Convert visemeMap to base64 if needed
    let safeVisemeMap = { ...visemeMap };
    for (const v in safeVisemeMap) {
      const url = safeVisemeMap[v as VisemeShape];
      if (url && url.startsWith("blob:")) {
        try {
          safeVisemeMap[v as VisemeShape] = await blobUrlToBase64(url);
        } catch (e) {}
      }
    }

    // Background image to base64
    let bgImage = { ...backgroundImage };
    if (bgImage.url && bgImage.url.startsWith("blob:")) {
      try {
        bgImage.url = await blobUrlToBase64(bgImage.url);
      } catch (e) {}
    }

    // Convert character parts to base64
    let safeCharacters = JSON.parse(JSON.stringify(characters)); // deep clone
    for (const char of safeCharacters) {
      if (char.composition) {
        for (const partId in char.composition) {
          const part = char.composition[partId];
          if (part.imageUrl && part.imageUrl.startsWith("blob:")) {
            try {
              part.imageUrl = await blobUrlToBase64(part.imageUrl);
            } catch (e) {}
          }
        }
      }
    }

    const projectData = {
      id: currentProjectId,
      name: projectName,
      projectType,
      characters: safeCharacters,
      activeSceneCharacterId,
      keyframes,
      lipSyncKeyframes,
      frames: frameData,
      frameSettings,
      cameraTransform,
      characterFiltersMap,
      lightSources,
      backgroundTransform,
      linkBgToCamera,
      ambientLightLevel,
      visemeMap: safeVisemeMap,
      canvasBgColor,
      isCanvasTransparent,
      customCSS,
      backgroundImage: bgImage,
      vocalTrackData,
      instTrackData,
      audioDuration: playbackState.duration,
      extraDuration,
      metadata: {
        appName: "Animato Studio",
        version: "2.4.0",
        exportTime: Date.now(),
      },
    };

    const blob = new Blob([JSON.stringify(projectData, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const filename = `${projectName.trim()}.animato_project`;

    const doDownload = async () => {
      showToast("Preparing download...");
      await triggerDownload(blob, filename);

      setTimeout(() => {
        showToast(
          "Download Completed! Your project file has been saved to your device's Downloads or Files directory.",
        );
      }, 1500);
    };

    doDownload();
  }, [
    characters,
    activeSceneCharacterId,
    keyframes,
    lipSyncKeyframes,
    frameData,
    frameSettings,
    cameraTransform,
    characterFiltersMap,
    lightSources,
    backgroundTransform,
    linkBgToCamera,
    ambientLightLevel,
    visemeMap,
    canvasBgColor,
    isCanvasTransparent,
    backgroundImage,
    extraDuration,
    projectName,
    currentProjectId,
    projectType,
    vocalTrack,
    instTrack,
    playbackState.duration,
  ]);

  // --- MAIN RENDER ---
  if (showSuccessSplash) {
    return (
      <SubscriptionSuccessSplash
        plan={successPlan}
        expiry={successExpiry}
        onComplete={() => {
          // Background sync to ensure DB and LocalStorage are perfectly aligned without blocking UI
          if (user?.email) {
            backend
              .syncUser(user.email)
              .then((data) => {
                if (data.success && data.user) {
                  localStorage.setItem("app_user", JSON.stringify(data.user));
                  setUser(data.user);
                }
              })
              .catch(() => {});
          }
          setShowSuccessSplash(false);
          setIsVerifyingPayment(false);
          setShowSubscription(false);
          setAppMode("PROJECT_MANAGER");
          window.history.replaceState({}, document.title, "/");
        }}
      />
    );
  }

  if (isVerifyingPayment) {
    // Attempt to extract details from localStorage for verification UI context
    const pendingEmail = localStorage.getItem("pending_app_payment");
    const pendingPlan = localStorage.getItem("pending_app_plan") || "monthly";

    return (
      <div className="fixed inset-0 z-[10000] bg-black/95 flex items-center justify-center p-6 text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full"
        >
          <div className="relative mb-8">
            <div className="w-24 h-24 border-b-4 border-cyan-500 rounded-full animate-spin mx-auto opacity-80" />
            <div className="absolute inset-0 flex items-center justify-center">
              <Sparkles className="w-8 h-8 text-cyan-400 animate-pulse" />
            </div>
          </div>

          <h2 className="text-3xl font-bold text-white mb-2 tracking-tight">
            {verificationStatus === "verifying"
              ? "Verifying Payment..."
              : "Payment Verified"}
          </h2>

          {verificationStatus === "verified" && (
            <button
              onClick={() => {
                setIsVerifyingPayment(false);
                setShowSuccessSplash(false);
                setShowSubscription(false);
                setAppMode("PROJECT_MANAGER");
                window.history.replaceState({}, document.title, "/");
              }}
              className="mb-6 w-full py-3 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl font-bold transition-all transform hover:scale-[1.02]"
            >
              Continue to App
            </button>
          )}

          <div className="bg-[#111] border border-white/5 rounded-2xl p-4 mb-6 text-left">
            <div className="flex justify-between items-center mb-1">
              <span className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">
                Account
              </span>
              <span className="text-xs text-white truncate ml-4">
                {pendingEmail || user?.email}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">
                Selected Plan
              </span>
              <span className="text-xs text-cyan-400 font-bold uppercase tracking-widest">
                {pendingPlan}
              </span>
            </div>
          </div>

          <p className="text-gray-400 text-sm">
            {verificationStatus === "verifying"
              ? "We are confirming your transaction with Paystack. Please wait..."
              : "Subscription activated. Welcome to the Premium Studio."}
          </p>

          <div className="mt-8 flex flex-col items-center gap-4">
            <div className="flex justify-center gap-2">
              {[0, 1, 2].map((i) => (
                <motion.div
                  key={i}
                  animate={{ scale: [1, 1.2, 1], opacity: [0.3, 1, 0.3] }}
                  transition={{
                    repeat: Infinity,
                    duration: 1.2,
                    delay: i * 0.2,
                  }}
                  className="w-1.5 h-1.5 bg-cyan-500 rounded-full"
                />
              ))}
            </div>
          </div>
        </motion.div>
      </div>
    );
  }

  const handleSignOut = async () => {
    // 1. Keep globally persistent app preferences (NOT user data)
    const stickyPlan = localStorage.getItem("selected_subscription_plan");
    const lang = localStorage.getItem("app_language_preference");

    // 2. Clear All Data to properly sign out the user
    localStorage.clear();
    sessionStorage.clear();

    // Restore selected global items
    if (stickyPlan)
      localStorage.setItem("selected_subscription_plan", stickyPlan);
    if (lang) localStorage.setItem("app_language_preference", lang);

    // 3. Clear IndexedDB
    try {
      const dbs = await window.indexedDB.databases();
      for (const dbInfo of dbs) {
        if (dbInfo.name) window.indexedDB.deleteDatabase(dbInfo.name);
      }
    } catch (e) {}

    // 4. Clear Cookies
    const cookies = document.cookie.split(";");
    for (let i = 0; i < cookies.length; i++) {
      const cookie = cookies[i];
      const eqPos = cookie.indexOf("=");
      const name = eqPos > -1 ? cookie.substring(0, eqPos) : cookie;
      document.cookie = name + "=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/";
    }

    // Force a reload to clear any remaining state
    window.location.href = window.location.origin;
  };

  const handleSaveStateForUpdate = async () => {
    // Force a manual save first if editing
    if (appMode === "EDITOR" && currentProjectId) {
      try {
        await handleSaveToStorage();
      } catch (e) {
        console.error("Failed auto-save on update", e);
      }
    }
    sessionStorage.setItem(
      "app_update_restore_state",
      JSON.stringify({
        appMode,
        projectId: currentProjectId,
      }),
    );
  };

  const renderLoopAndViewPanel = () => {
    if (activeBottomTab === "LOOP") {
      return (
        <div className="w-full h-full p-6 flex flex-col gap-6 overflow-y-auto mt-0 bg-[#080808]">
          <div className="space-y-6">
            <div className="flex items-center gap-2 text-[10px] font-black text-gray-400 uppercase tracking-widest">
              <LucideIcons.Repeat size={14} className="text-cyan-500" /> {t("LOOPS")}
            </div>
            
            <div className="bg-[#111] p-3 rounded-lg border border-white/5 space-y-4">
              <div className="flex flex-col gap-2">
                <span className="text-[9px] font-bold text-gray-500 uppercase">{t("TARGET")}</span>
                <select
                  value={activeSceneCharacterId || ""}
                  onChange={(e) => setActiveSceneCharacterId(e.target.value)}
                  className="w-full bg-black/60 border border-white/10 rounded px-2 py-1.5 text-[10px] text-white"
                >
                  <option value="ALL">{t("All Characters")}</option>
                  {characters.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
                </select>
              </div>
            </div>

            {activeSceneCharacterId !== "ALL" && !!character && (
              <div className="space-y-4">
                {Object.values(character).filter((p: any) => p.tags.includes("Loop") && isLayerInVisibleView(character, p.id)).length === 0 && (
                   <p className="text-[10px] text-gray-500 italic p-4 text-center">{t("No loop groups found in this character.")}</p>
                )}
                {Object.values(character).filter((p: any) => p.tags.includes("Loop") && isLayerInVisibleView(character, p.id)).map((loopPart: any) => (
                  <div key={loopPart.id} className="bg-[#111] p-4 rounded-xl border border-white/5 space-y-4 animate-in fade-in">
                    <div className="flex justify-between items-center text-xs text-white font-bold border-b border-white/5 pb-2">
                      <span className="uppercase tracking-widest">{loopPart.label}</span>
                      <button onClick={() => {
                            const newActiveState = loopPart.isLoopActive === false ? true : false;
                            setCharacter((prev: any) => {
                               if (!prev) return prev;
                               const next = { ...prev };
                               next[loopPart.id] = { ...next[loopPart.id], isLoopActive: newActiveState };
                               return next;
                            });
                            if (autoKeyEnabled) {
                               handleAutoKey({ [`part:${activeSceneCharacterId}:${loopPart.id}:isLoopActive`]: newActiveState ? 1 : 0 });
                            }
                            setShouldRecordHistory(true);
                      }} className={`px-3 py-1 rounded text-[10px] transition-colors ${loopPart.isLoopActive !== false ? "bg-cyan-500/10 text-cyan-500 hover:bg-cyan-500/20" : "bg-white/5 text-gray-500 hover:bg-white/10"}`}>
                          {loopPart.isLoopActive !== false ? t("ACTIVE") : t("INACTIVE")}
                      </button>
                    </div>
                    <div className="space-y-2 pt-2">
                      <div className="flex justify-between text-[10px] font-bold text-gray-500">
                          <span>{t("SPEED (MULTIPLIER)")}</span>
                          <span className="text-cyan-400 font-mono">{(loopPart.loopSpeed ?? 1).toFixed(2)}x</span>
                      </div>
                      <input
                        type="range" min="0" max="5" step="0.1" value={loopPart.loopSpeed ?? 1}
                        onPointerDown={handleInteractionStart}
                        onPointerUp={handleInteractionEnd}
                        onChange={(e) => {
                            const val = parseFloat(e.target.value);
                            setCharacter((prev: any) => {
                               if (!prev) return prev;
                               const next = { ...prev };
                               next[loopPart.id] = { ...next[loopPart.id], loopSpeed: val };
                               return next;
                            });
                            if (autoKeyEnabled) {
                               handleAutoKey({ [`part:${activeSceneCharacterId}:${loopPart.id}:loopSpeed`]: val });
                            }
                        }}
                        className="w-full h-1.5 bg-white/10 rounded-full accent-cyan-500 cursor-pointer"
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      );
    }
    
    if (activeBottomTab === "SWAP") {
      return (
        <div className="w-full h-full p-6 flex flex-col gap-6 overflow-y-auto mt-0 bg-[#080808]">
            <div className="space-y-6">
                <div className="flex items-center gap-2 text-[10px] font-black text-gray-400 uppercase tracking-widest">
                    <LucideIcons.Layers size={14} className="text-cyan-500" /> {t("SWAP LIBRARY")}
                </div>
                <div className="flex items-center gap-4 bg-[#111] p-3 rounded-lg border border-white/5">
                  <User size={16} className="text-cyan-500" />
                  <span className="text-[9px] font-bold text-gray-500 uppercase tracking-widest">
                    {t("TARGET")}
                  </span>
                  <select
                    value={activeSceneCharacterId || ""}
                    onChange={(e) =>
                      setActiveSceneCharacterId(e.target.value)
                    }
                    className="flex-1 bg-black border border-white/10 rounded px-3 py-1.5 text-xs text-white"
                  >
                    <option value="">{t("None")}</option>
                    {characters.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                {(() => {
                     const isAnyAncestorHidden = (partId: string) => {
                        let currentId = partId;
                        while (currentId && currentId !== "root" && character![currentId]) {
                            const p = character![currentId];
                            if (p.isVisible === false || p.opacity === 0) return true;
                            if (p.parentId === currentId) break; // Avoid infinite loop
                            currentId = p.parentId;
                        }
                        return false;
                     };

                     const getPartPreviewUrls = (part: any): string[] => {
                        if (!part) return [];
                        if (part.imageUrl) return [part.imageUrl];
                        
                        const urls: string[] = [];
                        const collectUrls = (pId: string) => {
                            const p = character![pId];
                            if (!p) return;
                            if (p.imageUrl) {
                                urls.push(p.imageUrl);
                            }
                            if (p.isGroup && p.children && p.children.length > 0) {
                                const childParts = p.children
                                    .map((cid: string) => character![cid])
                                    .filter(Boolean);
                                
                                childParts.sort((a: any, b: any) => (a.zIndex || 0) - (b.zIndex || 0));
                                
                                childParts.forEach((cp: any) => {
                                    collectUrls(cp.id);
                                });
                            }
                        };
                        
                        collectUrls(part.id);
                        return urls;
                     };

                     const swapFolders = (Object.values(character || {}) as any[]).filter(p => p.isGroup && p.tags && p.tags.includes("Swap") && !isAnyAncestorHidden(p.id));
                     if (swapFolders.length === 0) return <div className="text-gray-500 text-[10px] font-bold uppercase tracking-widest p-4 text-center border border-dashed border-white/10 rounded-lg">{t("No SWAP folders detected. Ensure PSD group ends with _swap.")}</div>;
                     
                     return (
                         <div className="space-y-6 animate-in slide-in-from-bottom-2 fade-in">
                             <div className="bg-[#111] p-4 rounded-lg border border-white/5 space-y-6">
                                 {swapFolders.map(folder => (
                                     <div key={folder.id} className="space-y-3">
                                         <div className="text-[10px] font-black uppercase text-gray-500 tracking-wider">
                                             {folder.label.replace(/_swap$/i, '').replace(/ swap$/i, '')}
                                         </div>
                                         <div className="flex flex-wrap gap-2">
                                             {folder.children.map((childId: string) => {
                                                 const child = character![childId];
                                                 if (!child) return null;
                                                 const isVis = child.isVisible !== false;
                                                 const previewUrls = getPartPreviewUrls(child);
                                                 
                                                 return (
                                                     <button
                                                         key={childId}
                                                         type="button"
                                                         onClick={(e) => {
                                                             e.preventDefault();
                                                             e.stopPropagation();
                                                             if (!activeSceneCharacterId) return;
                                                             // Use character composition to find the currently active swap part (since anim is timeline logic)
                                                             const prevVisId = folder.children.find((cid: string) => character![cid] && character![cid].isVisible !== false);
                                                             
                                                             let tx = child.transform.x, ty = child.transform.y, tr = child.transform.rotation;
                                                             
                                                             setCharacter((prev: any) => {
                                                                 if (!prev) return prev;
                                                                 const next = { ...prev };
                                                                 folder.children.forEach((cid: string) => {
                                                                     if (next[cid]) {
                                                                         const isChildVisible = cid === childId;
                                                                         next[cid] = {
                                                                             ...next[cid],
                                                                             opacity: isChildVisible ? 1 : 0,
                                                                             isVisible: isChildVisible
                                                                         };
                                                                     }
                                                                 });
                                                                 return next;
                                                             });
                                                             
                                                             const updates: Record<string, number> = {};
                                                             folder.children.forEach((cid: string) => {
                                                                 updates[`part:${activeSceneCharacterId}:${cid}:isVisible`] = cid === childId ? 1 : 0;
                                                                 updates[`part:${activeSceneCharacterId}:${cid}:opacity`] = cid === childId ? 1 : 0;
                                                             });
                                                             
                                                             if (autoKeyEnabled) {
                                                                 handleAutoKey(updates);
                                                             } else if (editingKeyframeId) {
                                                                 const kf = keyframes.find(k => k.id === editingKeyframeId);
                                                                  if (kf) {
                                                                      handleUpdateKeyframe(editingKeyframeId, {
                                                                          properties: { ...kf.properties, ...updates }
                                                                      });
                                                                  }
                                                             }
                                                             setShouldRecordHistory(true);
                                                         }}
                                                         className={`w-16 h-16 relative rounded border overflow-hidden transition-all ${isVis ? 'border-cyan-500 shadow-[0_0_10px_rgba(6,182,212,0.3)] bg-cyan-500/10' : 'border-white/10 opacity-50 hover:opacity-100 hover:border-white/30 bg-black cursor-pointer'}`}
                                                         title={child.label}
                                                     >
                                                         {previewUrls.length > 0 ? (
                                                             <div className="w-full h-full relative p-1 flex items-center justify-center">
                                                                 {previewUrls.map((url, idx) => (
                                                                     <img
                                                                         key={`${childId}-preview-${idx}`}
                                                                         src={url || null}
                                                                         className="absolute inset-0 w-full h-full object-contain pointer-events-none"
                                                                         referrerPolicy="no-referrer"
                                                                     />
                                                                 ))}
                                                             </div>
                                                         ) : (
                                                             <div className="w-full h-full flex items-center justify-center text-[9px] font-bold text-gray-500 text-center uppercase tracking-widest break-words px-1 leading-tight pointer-events-none">
                                                                 {child.label.substring(0, 8)}
                                                             </div>
                                                         )}
                                                         {isVis && <div className="absolute inset-0 border-2 border-cyan-500 rounded pointer-events-none" />}
                                                     </button>
                                                 );
                                             })}
                                         </div>
                                     </div>
                                 ))}
                             </div>
                         </div>
                     );
                 })()}
            </div>
        </div>
      );
    }
    
    if (activeBottomTab === "VIEW") {
      return (
        <div className="w-full h-full p-6 flex flex-col gap-6 overflow-y-auto mt-0 bg-[#080808]">
          <div className="space-y-6">
            <div className="flex items-center gap-2 text-[10px] font-black text-gray-400 uppercase tracking-widest">
              <LucideIcons.Layers size={14} className="text-purple-500" /> {t("VIEWS")}
            </div>
            
            <div className="bg-[#111] p-3 rounded-lg border border-white/5 space-y-4">
              <div className="flex flex-col gap-2">
                <span className="text-[9px] font-bold text-gray-500 uppercase">{t("TARGET")}</span>
                <select
                  value={activeSceneCharacterId || ""}
                  onChange={(e) => setActiveSceneCharacterId(e.target.value)}
                  className="w-full bg-black/60 border border-white/10 rounded px-2 py-1.5 text-[10px] text-white"
                >
                  <option value="ALL">{t("All Characters")}</option>
                  {characters.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
                </select>
              </div>
            </div>

            {activeSceneCharacterId !== "ALL" && !!character && (
              <div className="space-y-4">
                 {Object.values(character).filter((p: any) => p.tags?.includes("View") || p.label?.toLowerCase()?.includes("view")).length === 0 && (
                   <p className="text-[10px] text-gray-500 italic p-4 text-center">{t("No views found in this character.")}</p>
                )}
                {Object.values(character).filter((p: any) => p.tags?.includes("View") || p.label?.toLowerCase()?.includes("view")).map((viewPart: any) => {
                  const isViewActive = viewPart.isVisible !== false && viewPart.opacity !== 0;
                  return (
                    <button 
                      key={viewPart.id} 
                      onClick={() => {
                          const views = Object.values(character).filter((p: any) => p.tags?.includes("View") || p.label?.toLowerCase()?.includes("view"));
                          const updates: Record<string, number> = {};
                          setCharacter((prev: any) => {
                             if (!prev) return prev;
                             const next = { ...prev };
                             views.forEach((v: any) => {
                                const isActive = v.id === viewPart.id;
                                next[v.id] = { ...next[v.id], opacity: isActive ? 1 : 0, isVisible: isActive };
                                if (autoKeyEnabled) {
                                    updates[`part:${activeSceneCharacterId}:${v.id}:opacity`] = isActive ? 1 : 0;
                                    updates[`part:${activeSceneCharacterId}:${v.id}:isVisible`] = isActive ? 1 : 0;
                                }

                                // Recursively update all descendants of this view
                                const descendants = getDescendants(next, v.id);
                                descendants.forEach((dId: string) => {
                                    next[dId] = { ...next[dId], opacity: isActive ? 1 : 0, isVisible: isActive };
                                    if (autoKeyEnabled) {
                                        updates[`part:${activeSceneCharacterId}:${dId}:opacity`] = isActive ? 1 : 0;
                                        updates[`part:${activeSceneCharacterId}:${dId}:isVisible`] = isActive ? 1 : 0;
                                    }
                                });
                             });
                             
                             // Check if current propertyTarget becomes hidden, and update selection if so
                             setTimeout(() => {
                                 if (propertyTarget && propertyTarget !== "root") {
                                     const stillVisible = isLayerInVisibleView(next, propertyTarget);
                                     if (!stillVisible) {
                                         const sortedParts = getSortedLayerTree(next);
                                         const firstVisiblePart = sortedParts.find(item => 
                                             item.part.id !== "root" && 
                                             !(item.part.tags?.includes("View") || item.part.label?.toLowerCase()?.includes("view")) && 
                                             isLayerInVisibleView(next, item.part.id)
                                         );
                                         const newTarget = firstVisiblePart ? firstVisiblePart.part.id : "root";
                                         setPropertyTarget(newTarget);
                                         setSelectedPartIds([newTarget]);
                                     }
                                 }
                             }, 50);

                             return next;
                          });
                          if (autoKeyEnabled) {
                             handleAutoKey(updates);
                          }
                          setShouldRecordHistory(true);
                      }}
                      className={`w-full text-left bg-[#111] p-4 rounded-xl border transition-all space-y-2 animate-in fade-in group ${isViewActive ? "border-purple-500 shadow-[0_0_15px_rgba(168,85,247,0.15)] bg-[#1a1122]" : "border-white/5 hover:border-white/20"}`}
                    >
                      <div className="flex justify-between items-center text-xs font-bold">
                        <span className={isViewActive ? "text-purple-400" : "text-gray-400"}>{viewPart.label}</span>
                        {isViewActive && <LucideIcons.CheckCircle size={14} className="text-purple-500" />}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      );
    }
    return null;
  };

  const renderTextPanel = (isEmbedded = false) => {
    const panelContent = (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-[10px] font-black text-gray-400 uppercase tracking-widest">
            <LucideIcons.Type size={14} className="text-cyan-400" /> {t("TEXT CONTROLS")}
          </div>
          <button
            onClick={() => {
              const newText: SceneText = {
                id: `text_${Date.now()}`,
                text: t("New Text"),
                x: 0,
                y: 0,
                scale: 1.0,
                rotation: 0,
                color: "#ffffff",
                borderColor: "#000000",
                borderWidth: 2,
                backgroundColor: "transparent",
                shadowColor: "transparent",
                fontSize: 40,
                fontFamily: "Arial",
                styleTemplate: 'none'
              };
              setTexts((prev) => [...prev, newText]);
              setSelectedTextId(newText.id);
            }}
            className="bg-cyan-500 hover:bg-cyan-400 text-black font-bold py-1.5 px-3 rounded-lg flex items-center justify-center gap-1 transition-colors text-[10px]"
          >
            <LucideIcons.Plus size={11} />
            {t("ADD TEXT")}
          </button>
        </div>

        {/* Quick Preset Buttons */}
        <div className="bg-[#111]/40 border border-white/5 rounded-xl p-3 space-y-2">
          <span className="text-[8px] font-bold text-gray-500 uppercase block">{t("Quick Preset Add")}</span>
          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={() => {
                const newText: SceneText = {
                  id: `text_${Date.now()}`,
                  text: "TOP TEXT\nBOTTOM TEXT",
                  x: 0,
                  y: 0,
                  scale: 1.0,
                  rotation: 0,
                  color: "#ffffff",
                  borderColor: "#000000",
                  borderWidth: 4,
                  backgroundColor: "transparent",
                  shadowColor: "transparent",
                  fontSize: 50,
                  fontFamily: "Impact",
                  styleTemplate: 'meme'
                };
                setTexts((prev) => [...prev, newText]);
                setSelectedTextId(newText.id);
              }}
              className="bg-black/40 hover:bg-black/70 border border-white/10 rounded-lg p-2 flex flex-col items-center gap-1 text-center transition-colors group"
            >
              <span className="text-[10px] font-black text-white group-hover:scale-105 transition-transform uppercase">MEME</span>
            </button>

            <button
              onClick={() => {
                const newText: SceneText = {
                  id: `text_${Date.now()}`,
                  text: t("Narrator voice-over..."),
                  x: 0,
                  y: 120,
                  scale: 1.0,
                  rotation: 0,
                  color: "#ffff00",
                  borderColor: "#000000",
                  borderWidth: 2,
                  backgroundColor: "transparent",
                  shadowColor: "transparent",
                  fontSize: 30,
                  fontFamily: "Arial",
                  styleTemplate: 'subtitle'
                };
                setTexts((prev) => [...prev, newText]);
                setSelectedTextId(newText.id);
              }}
              className="bg-black/40 hover:bg-black/70 border border-white/10 rounded-lg p-2 flex flex-col items-center gap-1 text-center transition-colors group"
            >
              <span className="text-[10px] font-bold text-yellow-300 group-hover:scale-105 transition-transform">{t("SUBTITLE")}</span>
            </button>

            <button
              onClick={() => {
                const newText: SceneText = {
                  id: `text_${Date.now()}`,
                  text: "POW!",
                  x: -50,
                  y: -50,
                  scale: 1.2,
                  rotation: -15,
                  color: "#000000",
                  borderColor: "#ffffff",
                  borderWidth: 3,
                  backgroundColor: "transparent",
                  shadowColor: "transparent",
                  fontSize: 45,
                  fontFamily: "Comic Sans MS",
                  styleTemplate: 'comic'
                };
                setTexts((prev) => [...prev, newText]);
                setSelectedTextId(newText.id);
              }}
              className="bg-black/40 hover:bg-black/70 border border-white/10 rounded-lg p-2 flex flex-col items-center gap-1 text-center transition-colors group"
            >
              <span className="text-[10px] font-semibold text-cyan-400 group-hover:scale-105 transition-transform">COMIC</span>
            </button>
          </div>
        </div>

        {selectedTextId ? (
          (() => {
            const selectedText = texts.find((t) => t.id === selectedTextId);
            if (!selectedText) return null;
            return (
              <div className="space-y-4 bg-[#111] p-3 rounded-xl border border-white/5 text-left animate-in fade-in zoom-in-95 duration-150">
                <div className="flex items-center justify-between border-b border-white/5 pb-2">
                  <span className="text-[10px] font-black text-cyan-400 uppercase tracking-widest flex items-center gap-1">
                    <LucideIcons.Edit3 size={11} />
                    {t("EDIT TEXT PROPERTIES")}
                  </span>
                  <button
                    onClick={() => setSelectedTextId(null)}
                    className="text-[9px] text-gray-400 hover:text-white"
                  >
                    {t("Deselect")}
                  </button>
                </div>

                <div className="space-y-1">
                  <span className="text-[8px] font-bold text-gray-500 uppercase">{t("TEXT CONTENT")}</span>
                  <textarea
                    value={selectedText.text}
                    onChange={(e) =>
                      setTexts((prev) =>
                        prev.map((t) => (t.id === selectedTextId ? { ...t, text: e.target.value } : t))
                      )
                    }
                    rows={2}
                    className="w-full bg-[#080808] border border-white/10 rounded text-xs text-white p-2 outline-none focus:border-cyan-500/50 transition-colors resize-none"
                    placeholder={t("Type your text here...")}
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <span className="text-[8px] font-bold text-gray-500 uppercase">{t("STYLE TEMPLATE")}</span>
                    <select
                      value={selectedText.styleTemplate}
                      onChange={(e) =>
                        setTexts((prev) =>
                          prev.map((t) =>
                            t.id === selectedTextId
                              ? { ...t, styleTemplate: e.target.value as any }
                              : t
                          )
                        )
                      }
                      className="w-full bg-[#080808] border border-white/10 rounded px-2 py-1.5 text-[10px] text-white outline-none focus:border-cyan-500/50"
                    >
                      <option value="none">{t("Default Style")}</option>
                      <option value="meme">{t("Meme Theme (Impact)")}</option>
                      <option value="subtitle">{t("Subtitle Theme")}</option>
                      <option value="comic">{t("Comic Theme")}</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <span className="text-[8px] font-bold text-gray-500 uppercase">{t("FONT FAMILY")}</span>
                    <select
                      disabled={selectedText.styleTemplate !== "none"}
                      value={selectedText.fontFamily}
                      onChange={(e) =>
                        setTexts((prev) =>
                          prev.map((t) =>
                            t.id === selectedTextId ? { ...t, fontFamily: e.target.value } : t
                          )
                        )
                      }
                      className="w-full bg-[#080808] border border-white/10 rounded px-2 py-1.5 text-[10px] text-white outline-none focus:border-cyan-500/50 disabled:opacity-50"
                    >
                      {["Arial", "Courier New", "Georgia", "Times New Roman", "Impact", "Comic Sans MS", "Verdana", "Trebuchet MS", "Tahoma", "Inter"].map((font) => (
                        <option key={font} value={font}>
                          {font}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Font Size with adjust buttons */}
                <div className="space-y-1">
                  <div className="flex justify-between items-center">
                    <span className="text-[8px] font-bold text-gray-500 uppercase">{t("FONT SIZE")}</span>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => setTexts(prev => prev.map(t => t.id === selectedTextId ? { ...t, fontSize: Math.max(10, t.fontSize - 2) } : t))}
                        className="w-4 h-4 bg-black border border-white/10 text-[9px] flex items-center justify-center text-gray-400 hover:text-white hover:border-cyan-500/50 rounded"
                      >
                        -
                      </button>
                      <span className="text-[9px] font-mono text-cyan-400 min-w-[28px] text-center">{selectedText.fontSize}px</span>
                      <button
                        onClick={() => setTexts(prev => prev.map(t => t.id === selectedTextId ? { ...t, fontSize: Math.min(200, t.fontSize + 2) } : t))}
                        className="w-4 h-4 bg-black border border-white/10 text-[9px] flex items-center justify-center text-gray-400 hover:text-white hover:border-cyan-500/50 rounded"
                      >
                        +
                      </button>
                    </div>
                  </div>
                  <input
                    type="range"
                    min="10"
                    max="150"
                    value={selectedText.fontSize}
                    onChange={(e) =>
                      setTexts((prev) =>
                        prev.map((t) =>
                          t.id === selectedTextId ? { ...t, fontSize: parseInt(e.target.value) } : t
                        )
                      )
                    }
                    className="w-full h-1 bg-white/10 rounded-full accent-cyan-500 cursor-pointer"
                  />
                </div>

                {selectedText.styleTemplate === "none" && (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1 text-left">
                        <span className="text-[8px] font-bold text-gray-500 uppercase">{t("TEXT COLOR")}</span>
                        <div className="flex gap-1.5 items-center">
                          <input
                            type="color"
                            value={selectedText.color}
                            onChange={(e) =>
                              setTexts((prev) =>
                                prev.map((t) =>
                                  t.id === selectedTextId ? { ...t, color: e.target.value } : t
                                )
                              )
                            }
                            className="w-6 h-6 rounded bg-transparent border border-white/10 cursor-pointer p-0 shrink-0"
                          />
                          <input
                            type="text"
                            value={selectedText.color}
                            onChange={(e) =>
                              setTexts((prev) =>
                                prev.map((t) =>
                                  t.id === selectedTextId ? { ...t, color: e.target.value } : t
                                )
                              )
                            }
                            className="w-full bg-[#080808] border border-white/10 rounded text-[9px] font-mono text-white p-1 text-center"
                          />
                        </div>
                      </div>

                      <div className="space-y-1 text-left">
                        <span className="text-[8px] font-bold text-gray-500 uppercase">{t("BORDER COLOR")}</span>
                        <div className="flex gap-1.5 items-center">
                          <input
                            type="color"
                            value={selectedText.borderColor}
                            onChange={(e) =>
                              setTexts((prev) =>
                                prev.map((t) =>
                                  t.id === selectedTextId ? { ...t, borderColor: e.target.value } : t
                                )
                              )
                            }
                            className="w-6 h-6 rounded bg-transparent border border-white/10 cursor-pointer p-0 shrink-0"
                          />
                          <input
                            type="text"
                            value={selectedText.borderColor}
                            onChange={(e) =>
                              setTexts((prev) =>
                                prev.map((t) =>
                                  t.id === selectedTextId ? { ...t, borderColor: e.target.value } : t
                                )
                              )
                            }
                            className="w-full bg-[#080808] border border-white/10 rounded text-[9px] font-mono text-white p-1 text-center"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <div className="flex justify-between items-center">
                        <span className="text-[8px] font-bold text-gray-500 uppercase">{t("BORDER WIDTH")}</span>
                        <span className="text-[9px] font-mono text-cyan-400">{selectedText.borderWidth}px</span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="15"
                        value={selectedText.borderWidth}
                        onChange={(e) =>
                          setTexts((prev) =>
                            prev.map((t) =>
                              t.id === selectedTextId ? { ...t, borderWidth: parseInt(e.target.value) } : t
                            )
                          )
                        }
                        className="w-full h-1 bg-white/10 rounded-full accent-cyan-500 cursor-pointer"
                      />
                    </div>
                  </>
                )}

                {/* Positioning Controls */}
                <div className="pt-2 border-t border-white/5 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[8px] font-bold text-gray-500 uppercase">{t("TRANSFORMS")}</span>
                    <button
                      onClick={() => {
                        setTexts(prev => prev.map(t => t.id === selectedTextId ? { ...t, x: 0, y: 0, scale: 1.0, rotation: 0 } : t));
                      }}
                      className="text-[7px] text-cyan-400 hover:text-cyan-300 uppercase font-bold"
                    >
                      {t("Reset All")}
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <div className="flex justify-between items-center">
                        <span className="text-[7px] text-gray-500 uppercase">Scale</span>
                        <span className="text-[8px] font-mono text-cyan-400">{selectedText.scale.toFixed(2)}x</span>
                      </div>
                      <input
                        type="range"
                        min="0.1"
                        max="3"
                        step="0.05"
                        value={selectedText.scale}
                        onChange={(e) =>
                          setTexts((prev) =>
                            prev.map((t) =>
                              t.id === selectedTextId ? { ...t, scale: parseFloat(e.target.value) } : t
                            )
                          )
                        }
                        className="w-full h-1 bg-white/10 rounded-full accent-cyan-500 cursor-pointer"
                      />
                    </div>

                    <div className="space-y-1">
                      <div className="flex justify-between items-center">
                        <span className="text-[7px] text-gray-500 uppercase">Rotation</span>
                        <span className="text-[8px] font-mono text-cyan-400">{Math.round(selectedText.rotation)}°</span>
                      </div>
                      <input
                        type="range"
                        min="-180"
                        max="180"
                        value={selectedText.rotation}
                        onChange={(e) =>
                          setTexts((prev) =>
                            prev.map((t) =>
                              t.id === selectedTextId ? { ...t, rotation: parseInt(e.target.value) } : t
                            )
                          )
                        }
                        className="w-full h-1 bg-white/10 rounded-full accent-cyan-500 cursor-pointer"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-1.5">
                    <div className="bg-black/20 p-1.5 rounded border border-white/5 flex flex-col gap-1 items-center">
                      <span className="text-[7px] text-gray-500 font-bold">X OFFSET (px)</span>
                      <div className="flex items-center gap-1 w-full justify-between">
                        <button
                          onClick={() => setTexts(prev => prev.map(t => t.id === selectedTextId ? { ...t, x: t.x - 5 } : t))}
                          className="bg-black border border-white/10 text-[9px] px-1 w-5 h-5 flex items-center justify-center text-gray-400 hover:text-white rounded"
                        >
                          -
                        </button>
                        <input
                          type="number"
                          value={Math.round(selectedText.x)}
                          onChange={(e) =>
                            setTexts((prev) =>
                              prev.map((t) =>
                                t.id === selectedTextId ? { ...t, x: parseFloat(e.target.value) || 0 } : t
                              )
                            )
                          }
                          className="bg-transparent border-0 text-center w-12 text-[10px] text-white font-mono outline-none"
                        />
                        <button
                          onClick={() => setTexts(prev => prev.map(t => t.id === selectedTextId ? { ...t, x: t.x + 5 } : t))}
                          className="bg-black border border-white/10 text-[9px] px-1 w-5 h-5 flex items-center justify-center text-gray-400 hover:text-white rounded"
                        >
                          +
                        </button>
                      </div>
                    </div>

                    <div className="bg-black/20 p-1.5 rounded border border-white/5 flex flex-col gap-1 items-center">
                      <span className="text-[7px] text-gray-500 font-bold">Y OFFSET (px)</span>
                      <div className="flex items-center gap-1 w-full justify-between">
                        <button
                          onClick={() => setTexts(prev => prev.map(t => t.id === selectedTextId ? { ...t, y: t.y - 5 } : t))}
                          className="bg-black border border-white/10 text-[9px] px-1 w-5 h-5 flex items-center justify-center text-gray-400 hover:text-white rounded"
                        >
                          -
                        </button>
                        <input
                          type="number"
                          value={Math.round(selectedText.y)}
                          onChange={(e) =>
                            setTexts((prev) =>
                              prev.map((t) =>
                                  t.id === selectedTextId ? { ...t, y: parseFloat(e.target.value) || 0 } : t
                                )
                              )
                            }
                            className="bg-transparent border-0 text-center w-12 text-[10px] text-white font-mono outline-none"
                          />
                          <button
                            onClick={() => setTexts(prev => prev.map(t => t.id === selectedTextId ? { ...t, y: t.y + 5 } : t))}
                            className="bg-black border border-white/10 text-[9px] px-1 w-5 h-5 flex items-center justify-center text-gray-400 hover:text-white rounded"
                          >
                            +
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={() => {
                      setTexts((prev) => prev.filter((t) => t.id !== selectedTextId));
                      setSelectedTextId(null);
                    }}
                    className="w-full bg-red-950/40 hover:bg-red-900/40 border border-red-500/20 text-red-400 font-bold py-1.5 px-3 rounded-lg flex items-center justify-center gap-1 transition-all text-[10px]"
                  >
                    <LucideIcons.Trash2 size={12} />
                    {t("DELETE TEXT LAYER")}
                  </button>
                </div>
              );
            })()
          ) : (
            <div className="text-center py-6 border border-dashed border-white/5 rounded-xl text-[10px] text-gray-500 bg-black/10">
              {t("Select text on stage or click 'ADD TEXT' to create one.")}
            </div>
          )}

          {/* List of existing text layers */}
          <div className="space-y-2">
            <span className="text-[9px] font-bold text-gray-500 uppercase tracking-widest block">{t("ACTIVE TEXT LAYERS")}</span>
            {texts.length === 0 ? (
              <div className="text-center py-6 border border-dashed border-white/5 rounded-lg text-[10px] text-gray-500">
                {t("No active text layers. Add one above!")}
              </div>
            ) : (
              <div className="space-y-1.5 max-h-48 overflow-y-auto custom-scrollbar">
                {texts.map((t) => (
                  <div
                    key={t.id}
                    onClick={() => setSelectedTextId(t.id)}
                    className={`flex items-center justify-between p-2 rounded-lg cursor-pointer transition-all border ${selectedTextId === t.id ? "bg-cyan-500/10 border-cyan-500/30 text-cyan-400" : "bg-black/20 border-white/5 text-gray-300 hover:bg-black/40 hover:text-white"}`}
                  >
                    <div className="flex items-center gap-2 truncate text-left">
                      <LucideIcons.Type size={12} className="text-cyan-400/80 shrink-0" />
                      <span className="text-[10px] truncate font-medium">{t.text || "(empty text)"}</span>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setTexts((prev) => prev.filter((item) => item.id !== t.id));
                        if (selectedTextId === t.id) setSelectedTextId(null);
                      }}
                      className="p-1 text-gray-500 hover:text-red-400 transition-colors shrink-0"
                    >
                      <LucideIcons.Trash2 size={11} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
    );

    if (isEmbedded) {
      return panelContent;
    }

    return (
      <div className="w-full h-full p-6 flex flex-col gap-6 overflow-y-auto mt-0 bg-[#080808]">
        {panelContent}
      </div>
    );
  };

  return (
    <>
      <AnimatedBackground
        theme={activeTheme}
        isLowPerformanceMode={isLowPerformanceMode}
      />
      <ReloadPrompt onUpdate={handleSaveStateForUpdate} />
      <AnimatePresence>
        {showLanguageSelector && (
          <InitialLanguageSelection
            onSelect={(lang) => {
              setShowLanguageSelector(false);
              // Also update localStorage so it's persisted, this is probably done in the component itself but if not it will skip it next time.
            }}
          />
        )}
      </AnimatePresence>
      {!showLanguageSelector &&
        (showSplash ? (
          <PremiumSplash onComplete={() => setShowSplash(false)} />
        ) : showSignIn ? (
          <PremiumSignIn
            onComplete={(userData) => {
              setShowSignIn(false);
              setUser(userData);
              setIsExpired(false); // Reset expired state on sign in
              sessionStorage.setItem('just_signed_in_session', 'true');
              if (
                userData?.subscription_status === "none" ||
                userData?.subscription_status === "expired"
              ) {
                setShowSubscription(true);
              } else {
                setShowSubscription(false);
              }
            }}
          />
        ) : showSubscription ? (
          user?.subscription_status === "expired" || isExpired ? (
            <ExpiredRenewalModal user={user} onSignOut={handleSignOut} />
          ) : (
            <SubscriptionPanel
              user={user}
              onComplete={() => {
                setShowSubscription(false);
                setAppMode("PROJECT_MANAGER");
              }}
              onSignOut={handleSignOut}
            />
          )
        ) : appMode === "PROJECT_MANAGER" ? (
          <ProjectManager
            user={user}
            onNewProject={handleNewProject}
            onOpenProject={handleOpenProject}
            onLoadSavedProject={handleLoadSavedProject}
            savedProjects={savedProjects}
            onDeleteProject={handleDeleteProject}
            onDuplicateProject={handleDuplicateProject}
            onRenameProject={handleRenameProject}
            onSignOut={handleSignOut}
            activeTheme={activeTheme}
            onThemeChange={handleThemeChange}
            onUserUpdate={setUser}
            onRefreshProjects={refreshProjectsList}
            onImportToExistingProject={handleImportToExistingProject}
          />
        ) : projectType === "GAME" ? (
          <GameCreatorStudio
            projectId={currentProjectId}
            projectName={projectName}
            customCSS={customCSS}
            onBack={() => setAppMode("PROJECT_MANAGER")}
            onSave={handleSaveToStorage}
          />
        ) : projectType === "FRAME" ? (
          <FrameByFrameEditor
            key={currentProjectId}
            onBack={() => setAppMode("PROJECT_MANAGER")}
            frames={frameData}
            setFrames={setFrameData}
            onSave={handleSaveToStorage}
            onLoadAudio={engine.loadTrack}
            settings={frameSettings}
            canvasBgColor={canvasBgColor}
            setCanvasBgColor={setCanvasBgColor}
            isCanvasTransparent={isCanvasTransparent}
            setIsCanvasTransparent={setIsCanvasTransparent}
            vocalTrack={vocalTrack}
            instTrack={instTrack}
            isLowPerformanceMode={isLowPerformanceMode}
          />
        ) : (
          <div
            className={`fixed inset-0 flex flex-col font-sans bg-[#050505] text-gray-200 overflow-hidden selection:bg-cyan-500/30`}
          >
            <style>{customCSS}</style>
            <input
              type="file"
              ref={bgInputRef}
              className="hidden"
              accept="image/*"
              onChange={handleBackgroundUpload}
            />
            <EasingEditor
              isOpen={easingMenuOpen}
              onClose={() => setEasingMenuOpen(false)}
              onSelect={handleEasingSelect}
              position={easingMenuPos}
              currentEasing={
                currentKeyframe ? currentKeyframe.easing : EasingType.Linear
              }
            />
            {isColorPickerOpen && (
              <div className="fixed inset-0 z-[999] flex items-center justify-center">
                <div
                  className="fixed inset-0 bg-black/50"
                  onClick={() => {
                    setIsColorPickerOpen(false);
                    setActiveLightId(null);
                    setShouldRecordHistory(true);
                  }}
                ></div>
                <div className="relative z-[1000]">
                  <AdvancedColorPicker
                    initialColor={
                      activeLightId
                        ? lightSources.find((l) => l.id === activeLightId)
                            ?.color || "#ffffff"
                        : canvasBgColor
                    }
                    onChange={(newColor) => {
                      if (activeLightId) {
                        handleLightUpdate(activeLightId, { color: newColor });
                      } else {
                        setCanvasBgColor(newColor);
                      }
                    }}
                    onClose={() => {
                      setIsColorPickerOpen(false);
                      setActiveLightId(null);
                      setShouldRecordHistory(true);
                    }}
                  />
                </div>
              </div>
            )}

            <Toaster
              theme={activeTheme === "light" ? "light" : "dark"}
              toastOptions={{
                className:
                  activeTheme === "light"
                    ? "bg-white/90 border-black/10 text-gray-800 backdrop-blur-md"
                    : "bg-[#111]/90 border-white/10 text-gray-200 backdrop-blur-md",
              }}
            />

            <LipSyncGeneratorModal
              isOpen={isLipSyncModalOpen}
              onClose={() => setIsLipSyncModalOpen(false)}
              audioBuffer={vocalTrack.buffer}
              audioSpeed={vocalTrack.speed || 1.0}
              onComplete={handleAutoLipSyncComplete}
              selectedCharacterId={lipSyncTargetId}
            />

            <Suspense
              fallback={
                <div className="fixed inset-0 bg-black/90  z-[100] flex items-center justify-center p-4">
                  <div className="flex flex-col items-center gap-4">
                    <Loader2 size={32} className="text-cyan-500 animate-spin" />
                    <p className="text-cyan-500 font-bold tracking-widest uppercase text-sm">
                      {t("Loading Rigging Studio...")}
                    </p>
                  </div>
                </div>
              }
            >
              {isVisemeMapperOpen && (
                <VisemeMapper
                  onClose={() => setIsVisemeMapperOpen(false)}
                  currentMap={visemeMap}
                  onImplement={(newMap) => setVisemeMap(newMap)}
                  theme={"dark"}
                />
              )}

              <AnimatePresence mode="wait">
                {isCharacterStudioModalOpen && !isCharacterBuilderOpen && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-[600] bg-black/90 backdrop-blur-[30px] flex items-center justify-center p-4 sm:p-6"
                  >
                    <motion.div
                      initial={{ scale: 0.9, opacity: 0, y: 20 }}
                      animate={{ scale: 1, opacity: 1, y: 0 }}
                      exit={{ scale: 0.9, opacity: 0, y: 20 }}
                      className="bg-[#0a0a0a] border border-white/10 w-full max-w-4xl rounded-3xl p-6 sm:p-10 shadow-[0_0_100px_rgba(0,0,0,0.8)] relative overflow-hidden"
                    >
                      <div className="flex justify-between items-center mb-6">
                        <div className="flex flex-col">
                          <h2 className="text-xl font-black text-white uppercase tracking-widest flex items-center gap-2">
                            <UserCog className="text-cyan-500" />{" "}
                            {t("Rigging Studio")}
                          </h2>
                          <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest mt-1">
                            {t("Select a character or create a new one")}
                          </p>
                        </div>
                        <button
                          id="close-rigging-studio-modal"
                          onClick={() => setIsCharacterStudioModalOpen(false)}
                          className="p-2 bg-white/5 hover:bg-white/10 rounded-full text-gray-400 hover:text-white transition-all z-[50]"
                        >
                          <X size={20} />
                        </button>
                      </div>

                      <div className="space-y-8 overflow-y-auto max-h-[70vh] custom-scrollbar pr-2">
                        {characters.length > 0 && (
                          <section>
                            <div className="flex items-center gap-2 mb-4">
                              <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">
                                {t("Active Scene Characters")}
                              </h3>
                              <div className="h-px flex-1 bg-white/5"></div>
                            </div>

                            <div className="flex items-center gap-4 mb-4 bg-white/5 p-3 rounded-lg">
                              <span className="text-[10px] font-bold text-gray-400">
                                {t("THUMBNAIL SIZE")}
                              </span>
                              <input
                                type="range"
                                min="0.5"
                                max="2"
                                step="0.1"
                                value={thumbnailScale || 1}
                                onChange={(e) =>
                                  setThumbnailScale(parseFloat(e.target.value))
                                }
                                className="flex-1 h-1 bg-white/10 rounded-full accent-cyan-500 touch-none"
                              />
                              <span className="text-[10px] font-mono text-cyan-500 w-8 text-right">
                                {Math.round((thumbnailScale || 1) * 100)}%
                              </span>
                            </div>

                            <div
                              className="grid gap-4"
                              style={{
                                gridTemplateColumns: `repeat(auto-fill, minmax(${100 * (thumbnailScale || 1)}px, 1fr))`,
                              }}
                            >
                              {characters.map((char) => (
                                <motion.button
                                  whileHover={{ scale: 1.02 }}
                                  whileTap={{ scale: 0.98 }}
                                  key={char.id}
                                  onClick={() => {
                                    setIsCharacterStudioModalOpen(false);
                                    setTimeout(() => {
                                      setActiveSceneCharacterId(char.id);
                                      setIsCharacterBuilderOpen(true);
                                    }, 50);
                                  }}
                                  className="relative aspect-[3/4] bg-black border border-white/10 rounded-xl overflow-hidden group hover:border-cyan-500 transition-all shadow-lg w-full flex-shrink-0"
                                >
                                  {char.thumbnail ? (
                                    <img
                                      src={char.thumbnail}
                                      className="absolute inset-0 w-full h-full object-contain opacity-60 group-hover:opacity-100 transition-opacity"
                                    />
                                  ) : (
                                    <div className="absolute inset-0 flex items-center justify-center text-gray-700 bg-gray-900/50">
                                      <User size={32} />
                                    </div>
                                  )}
                                  <div className="absolute inset-0 bg-gradient-to-t from-black via-black/20 to-transparent opacity-60 group-hover:opacity-40 transition-opacity"></div>
                                  <div className="absolute bottom-0 inset-x-0 p-3">
                                    <p className="text-[11px] font-black text-white truncate text-center group-hover:text-cyan-400 transition-colors uppercase tracking-widest">
                                      {char.name || "Unnamed"}
                                    </p>
                                  </div>
                                  {char.origin && (
                                    <div className="absolute top-2 right-2 text-[8px] font-black bg-cyan-900/80 text-cyan-400 px-1.5 py-0.5 rounded uppercase border border-cyan-500/30">
                                      {char.origin}
                                    </div>
                                  )}
                                  <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                                    <div className="bg-cyan-500 text-black p-2 rounded-full shadow-lg transform translate-y-4 group-hover:translate-y-0 transition-transform">
                                      <Edit3 size={16} />
                                    </div>
                                  </div>
                                </motion.button>
                              ))}
                            </div>
                          </section>
                        )}

                        <section>
                          <div className="flex items-center gap-2 mb-4 mt-4">
                            <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">
                              {t("Initialize New Entity")}
                            </h3>
                            <div className="h-px flex-1 bg-white/5"></div>
                          </div>
                          <div className="bg-[#18181b] p-6 rounded-2xl border border-white/5 hover:border-cyan-500/30 transition-colors group">
                            <div className="flex flex-col gap-4">
                              <div className="flex flex-col gap-1.5">
                                <label className="text-[9px] font-black text-gray-500 uppercase tracking-widest">
                                  {t("Character Identification Name")}
                                </label>
                                <div className="relative">
                                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                    <Tag size={12} className="text-gray-600" />
                                  </div>
                                  <input
                                    type="text"
                                    value={newCharacterName}
                                    onChange={(e) =>
                                      setNewCharacterName(e.target.value)
                                    }
                                    placeholder={t(
                                      "e.g. Hero, Villian, NPC...",
                                    )}
                                    className="w-full bg-black/40 border border-white/10 rounded-lg py-2.5 pl-9 pr-4 text-xs font-bold text-white placeholder:text-gray-700 focus:border-cyan-500/50 outline-none transition-all"
                                  />
                                </div>
                              </div>
                              <motion.button
                                whileHover={{ scale: 1.01 }}
                                whileTap={{ scale: 0.99 }}
                                onClick={() => {
                                  const newId = `char_${Date.now()}`;
                                  const newComp = getInitialParts();
                                  if (newComp["root"]) {
                                    newComp["root"].transform.scaleX = 2.5;
                                    newComp["root"].transform.scaleY = 2.5;
                                  }
                                  if (
                                    characters.length > 0 &&
                                    newComp["root"]
                                  ) {
                                    const offset = characters.length * 50;
                                    newComp["root"].transform.x += offset;
                                    newComp["root"].transform.y += offset;
                                  }

                                  setIsCharacterStudioModalOpen(false);
                                  setCharacters((prev) => [
                                    ...prev,
                                    {
                                      id: newId,
                                      name: newCharacterName || "New Character",
                                      composition: newComp,
                                      origin: null,
                                    },
                                  ]);
                                  unsavedCharacterIdRef.current = newId;

                                  setTimeout(() => {
                                    setActiveSceneCharacterId(newId);
                                    setIsCharacterBuilderOpen(true);
                                    setNewCharacterName("New Character");
                                  }, 50);
                                }}
                                className="w-full p-4 bg-cyan-500 hover:bg-cyan-400 text-black rounded-xl flex items-center justify-center gap-3 transition-all font-black text-xs uppercase tracking-widest shadow-cyan-500/20 shadow-lg"
                              >
                                <PlusCircle size={18} />
                                <span>{t("Create New Character")}</span>
                              </motion.button>
                            </div>
                          </div>
                        </section>
                      </div>
                    </motion.div>
                  </motion.div>
                )}
              </AnimatePresence>

              {isCharacterBuilderOpen && (
                <CharacterBuilder
                  initialImportFile={pendingImportFile}
                  onClearImportFile={() => setPendingImportFile(null)}
                  onClose={() => {
                    setIsCharacterBuilderOpen(false);
                    setIsCharacterStudioModalOpen(false);
                    if (unsavedCharacterIdRef.current) {
                      setCharacters((prev) =>
                        prev.filter(
                          (c) => c.id !== unsavedCharacterIdRef.current,
                        ),
                      );
                      if (
                        activeSceneCharacterId === unsavedCharacterIdRef.current
                      ) {
                        setActiveSceneCharacterId(null);
                      }
                      unsavedCharacterIdRef.current = null;
                    }
                  }}
                  currentCharacter={character}
                  onImplement={(c, thumb, origin, extractedBackgrounds) => {
                    if (extractedBackgrounds && extractedBackgrounds.length > 0) {
                        setAvailableBackgrounds(prev => {
                           const newBgs = [...prev];
                           extractedBackgrounds.forEach(bg => {
                               // verify no duplicates or just push
                               if (!newBgs.find(b => b.url === bg.url)) {
                                   newBgs.push({ url: bg.url, width: 1920, height: 1080 });
                               }
                           });
                           return newBgs;
                        });
                        toast(`Added ${extractedBackgrounds.length} PSD Backgrounds`);
                    }

                    const characterExists = activeSceneCharacterId && characters.some((char) => char.id === activeSceneCharacterId);
                    if (characterExists) {
                      setCharacters((prev) =>
                        prev.map((char) =>
                          char.id === activeSceneCharacterId
                            ? {
                                ...char,
                                composition: c,
                                thumbnail: thumb || char.thumbnail,
                                origin: origin || char.origin,
                              }
                            : char,
                        ),
                      );
                    } else {
                      const newId = "char_" + Date.now();
                      const rawName = pendingImportFile?.name
                        ? pendingImportFile.name.replace(/\.[^/.]+$/, "")
                        : "Assembled Character";
                      const charName = rawName.replace(/[-_]/g, " ").trim();
                      const capitalizedName = charName.charAt(0).toUpperCase() + charName.slice(1);
                      const newChar = {
                        id: newId,
                        name: capitalizedName,
                        composition: c,
                        thumbnail: thumb || undefined,
                        origin: origin || "ASSEMBLER",
                        visemeMap: { REST: null, AI: null, E: null, O: null, U: null, FV: null, L: null, MBP: null, CONS: null }
                      } as any;
                      setCharacters((prev) => [...prev, newChar]);
                      setActiveSceneCharacterId(newId);
                    }
                    unsavedCharacterIdRef.current = null;
                    setPendingImportFile(null); // Clear import state since it has been successfully added
                    setShouldRecordHistory(true);

                    // FORCE CLOSE ALL MODALS ON IMPLEMENT
                    setIsCharacterBuilderOpen(false);
                    setIsCharacterStudioModalOpen(false);
                  }}
                  visemeMap={activeCharacterInstance?.visemeMap || visemeMap}
                  onVisemeMapChange={(newMap) => {
                    if (activeSceneCharacterId) {
                      setCharacters((prev) =>
                        prev.map((c) =>
                          c.id === activeSceneCharacterId
                            ? { ...c, visemeMap: newMap }
                            : c,
                        ),
                      );
                    }
                  }}
                  characterFilters={characterFilters}
                  updateCharacterFilter={updateCharacterFilter}
                  assemblerSession={
                    activeCharacterInstance?.assemblerSession || null
                  }
                  onSaveAssemblerSession={(sess) => {
                    if (activeSceneCharacterId) {
                      setCharacters((prev) =>
                        prev.map((char) =>
                          char.id === activeSceneCharacterId
                            ? { ...char, assemblerSession: sess }
                            : char,
                        ),
                      );
                    }
                  }}
                  selectedPartIds={selectedPartIds}
                  setSelectedPartIds={setSelectedPartIds}
                  initialTool={
                    (pendingImportFile?.name?.toLowerCase()?.endsWith('.zip') || 
                     pendingImportFile?.name?.toLowerCase()?.includes('.zip') || 
                     pendingImportFile?.type === 'application/zip' || 
                     pendingImportFile?.type === 'application/x-zip-compressed' || 
                     pendingImportFile?.name?.toLowerCase()?.endsWith('.bin') || 
                     pendingImportFile?.name?.toLowerCase()?.includes('.bin'))
                      ? 'ASSEMBLER'
                      : (activeCharacterInstance?.origin || null)
                  }
                  lockTool={!!activeCharacterInstance?.origin}
                />
              )}
            </Suspense>

            {!isPresentationMode && (
              <div
                className={`h-12 border-b border-white/10 bg-[#0a0a0a] flex items-center justify-between px-2 sm:px-4 z-50 shrink-0 gap-2 overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:'none'] [scrollbar-width:'none'] ${orientation === "landscape" ? "py-1 h-10" : ""}`}
              >
                <div className="flex items-center gap-2 sm:gap-4 shrink-0">
                  <button
                    onClick={() => setIsLeftPanelOpen(!isLeftPanelOpen)}
                    className={`${isDesktopLike ? "hidden" : "lg:hidden"} p-2 text-gray-400 hover:text-white`}
                  >
                    <Menu size={20} />
                  </button>
                  <button
                    onClick={() => setAppMode("PROJECT_MANAGER")}
                    className="p-2 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                    title={t("Back to Projects")}
                  >
                    <ArrowLeft size={18} />
                  </button>
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 bg-cyan-500 rounded flex items-center justify-center font-black text-black text-xs shrink-0">
                      {t("Ox")}
                    </div>
                    <input
                      type="text"
                      value={projectName}
                      onChange={(e) => setProjectName(e.target.value)}
                      className="hidden md:block bg-transparent border-none text-white font-bold tracking-tight outline-none focus:bg-white/5 rounded px-2 w-32 md:w-auto truncate"
                    />
                  </div>
                  <div className="h-4 w-px bg-white/10 hidden sm:block" />
                  <button
                    onClick={() => {
                      setIsCharacterStudioModalOpen(true);
                    }}
                    className="flex items-center gap-2 px-3 py-1.5 rounded bg-white/5 hover:bg-white/10 text-[10px] font-bold transition-colors shrink-0"
                  >
                    <UserCog size={14} className="text-cyan-500" />{" "}
                    <span className="hidden sm:inline whitespace-nowrap">
                      {t("RIGGING STUDIO")}
                    </span>
                  </button>
                </div>
                <div className="flex items-center gap-2 sm:gap-4 shrink-0 justify-end">
                  <div className="flex items-center bg-white/5 rounded-lg p-0.5 border border-white/10 shrink-0">
                    <button
                      onClick={handleUndo}
                      disabled={historyIndex <= 0}
                      className="p-1.5 hover:bg-white/10 text-gray-400 hover:text-white disabled:opacity-30 rounded"
                    >
                      <RotateCcw size={14} />
                    </button>
                    <div className="w-px h-3 bg-white/10 mx-1"></div>
                    <button
                      onClick={handleRedo}
                      disabled={historyIndex >= history.length - 1}
                      className="p-1.5 hover:bg-white/10 text-gray-400 hover:text-white disabled:opacity-30 rounded"
                    >
                      <RotateCw size={14} />
                    </button>
                  </div>
                  {!isPresentationMode && (
                    <button
                      onClick={() => {
                        setIsPresentationMode(true);
                        setTimeout(() => engine.play(), 100);
                      }}
                      className="bg-cyan-500 hover:bg-cyan-400 text-black px-4 py-1.5 rounded-full z-50 transition-all flex items-center gap-2 shadow-lg hover:shadow-cyan-500/20 font-black text-[10px] tracking-widest"
                    >
                      <Play size={12} fill="currentColor" />
                      {t("PREVIEW")}
                    </button>
                  )}
                  <button
                    onClick={() => {
                      if (vocalTrack.buffer) setIsLipSyncModalOpen(true);
                      else showToast("LOAD VOCAL TRACK FIRST");
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-cyan-900/30 hover:bg-cyan-900/50 border border-cyan-500/30 rounded text-[9px] font-bold text-cyan-400 transition-colors"
                  >
                    <Mic size={12} />{" "}
                    <span className="hidden sm:inline">
                      {t("AUTO-LIPSYNC")}
                    </span>
                  </button>
                  <button
                    onClick={handleSaveToStorage}
                    className="p-2 bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white rounded border border-white/5 transition-all shrink-0"
                    title={t("Quick Save")}
                  >
                    <Save size={14} />
                  </button>
                  <button
                    onClick={() => {
                      preExportUiState.current = {
                        isLeftPanelOpen,
                        isTabsVisible,
                        currentTime: playbackState.currentTime,
                      };
                      setIsExportModalOpen(true);
                      setIsLeftPanelOpen(false);
                      setIsTabsVisible(false);
                    }}
                    className="flex items-center gap-2 px-3 py-1.5 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 text-[10px] font-bold rounded border border-cyan-500/30 transition-all hover:shadow-cyan-500/20 hover:shadow-lg shrink-0"
                  >
                    <Film size={14} />{" "}
                    <span className="hidden sm:inline whitespace-nowrap">
                      {t("EXPORT")}
                    </span>
                  </button>
                  <button
                    onClick={() => {
                      const newState = !isTabsVisible;
                      setIsTabsVisible(newState);
                      if (newState) {
                        setActiveBottomTab("SCENE");
                        setPropertyTarget("camera");
                      } else {
                        setActiveBottomTab("TIMELINE");
                      }
                    }}
                    className={`p-2 hover:text-white transition-colors shrink-0 ${isTabsVisible ? "text-cyan-400" : "text-gray-400"}`}
                    title={t("Toggle Editor Tabs")}
                  >
                    <Settings size={20} />
                  </button>
                </div>
              </div>
            )}

            {/* Main Layout */}
            <div className="flex-1 flex flex-col overflow-hidden relative">
              {isPresentationMode && (
                <button
                  onClick={() => {
                    setIsPresentationMode(false);
                    engine.pause();
                  }}
                  className="absolute top-4 right-4 z-[999] bg-[#111]/80 hover:bg-[#111] border border-white/10 rounded-full px-4 py-2 text-gray-300 hover:text-white flex items-center gap-2  transition-all"
                >
                  <X size={16} />
                  <span className="text-xs font-bold tracking-wider">
                    {t("EXIT PREVIEW")}
                  </span>
                </button>
              )}
              <div className="flex-1 flex relative overflow-hidden">
                {!isPresentationMode && (
                  <div
                    className={`absolute inset-y-0 left-0 z-40 w-full sm:w-80 portrait:w-full portrait:sm:w-80 landscape:w-[260px] lg:landscape:w-[320px] bg-[#111] border-r border-white/10 flex flex-col transform transition-transform duration-300 ${isDesktopLike ? "lg:relative lg:translate-x-0" : "lg:relative lg:translate-x-0"} ${isLeftPanelOpen || isDesktopLike ? "translate-x-0" : "-translate-x-full"} ${isDesktopLike ? "relative" : ""}`}
                  >
                    <div className="p-3 border-b border-white/5 bg-[#0a0a0a] flex justify-between items-center shadow-md z-10">
                      <div className="flex items-center gap-1 bg-black/40 p-0.5 rounded-lg border border-white/5">
                        <button
                          onClick={() => setActiveLeftTab("MIX")}
                          className={`px-3 py-1 rounded-md text-[9px] font-black uppercase tracking-widest transition-all ${activeLeftTab === "MIX" ? "bg-cyan-500 text-black shadow-lg shadow-cyan-500/40" : "text-gray-500 hover:text-white"}`}
                        >
                          {t("MIX RACK")}
                        </button>
                        <button
                          onClick={() => setActiveLeftTab("HIERARCHY")}
                          className={`px-3 py-1 rounded-md text-[9px] font-black uppercase tracking-widest transition-all ${activeLeftTab === "HIERARCHY" ? "bg-cyan-500 text-black shadow-lg shadow-cyan-500/40" : "text-gray-500 hover:text-white"}`}
                        >
                          {t("HIERARCHY")}
                        </button>
                      </div>
                      <button
                        onClick={() => setIsLeftPanelOpen(false)}
                        className="lg:hidden p-1 text-gray-500 hover:text-white"
                      >
                        <PanelLeftClose size={14} />
                      </button>
                    </div>
                    <div className="flex-1 overflow-y-auto transform-gpu custom-scrollbar p-0 bg-[#080808] relative">
                      {activeLeftTab === "MIX" ? (
                        <div className="p-4 h-full">
                          <MixingConsole
                            theme="dark"
                            vocalTrack={vocalTrack}
                            setVocalTrack={(u: Partial<TrackState>) =>
                              updateAudioTrack("vocal", u)
                            }
                            instTrack={instTrack}
                            setInstTrack={(u: Partial<TrackState>) =>
                              updateAudioTrack("inst", u)
                            }
                            loadTrack={(f: File, type: "vocal" | "inst") => {
                              engine.loadTrack(f, type);
                              setIsLooping(false);
                              setSelection(null);
                            }}
                            onInteractionStart={handleInteractionStart}
                            onInteractionEnd={handleInteractionEnd}
                          />
                        </div>
                      ) : activeLeftTab === "HIERARCHY" ? (
                        <div className="p-4 h-full select-none">
                          {!activeSceneCharacterId ||
                          activeSceneCharacterId === "ALL" ? (
                            <div className="h-full flex flex-col items-center justify-center text-center p-8 gap-4 grayscale opacity-50">
                              <Layers size={48} className="text-gray-700" />
                              <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
                                {t("Select a single character")}
                                <br />
                                {t("to view hierarchy")}
                              </p>
                            </div>
                          ) : (
                            <div className="space-y-1">
                              <div className="flex items-center justify-between mb-4">
                                <h3 className="text-[10px] font-black text-cyan-500 uppercase tracking-[0.2em]">
                                  {activeCharacterInstance?.name || "Character"}{" "}
                                  Layers
                                </h3>
                                <div className="flex gap-1">
                                  <button
                                    onClick={() =>
                                      setCharacters((prev) =>
                                        prev.map((c) =>
                                          c.id === activeSceneCharacterId
                                            ? {
                                                ...c,
                                                composition: Object.fromEntries(
                                                  Object.entries(
                                                    c.composition,
                                                  ).map(([id, p]) => [
                                                    id,
                                                    {
                                                      ...(p as CharacterPart),
                                                      isOpen: true,
                                                    },
                                                  ]),
                                                ),
                                              }
                                            : c,
                                        ),
                                      )
                                    }
                                    className="p-1 hover:bg-white/5 rounded text-gray-500 hover:text-white"
                                    title={t("Expand All")}
                                  >
                                    <ChevronDown size={12} />
                                  </button>
                                  <button
                                    onClick={() =>
                                      setCharacters((prev) =>
                                        prev.map((c) =>
                                          c.id === activeSceneCharacterId
                                            ? {
                                                ...c,
                                                composition: Object.fromEntries(
                                                  Object.entries(
                                                    c.composition,
                                                  ).map(([id, p]) => [
                                                    id,
                                                    {
                                                      ...(p as CharacterPart),
                                                      isOpen: false,
                                                    },
                                                  ]),
                                                ),
                                              }
                                            : c,
                                        ),
                                      )
                                    }
                                    className="p-1 hover:bg-white/5 rounded text-gray-500 hover:text-white"
                                    title={t("Collapse All")}
                                  >
                                    <ChevronRight size={12} />
                                  </button>
                                </div>
                              </div>
                              <div className="space-y-0.5">
                                {(() => {
                                  const renderItem = (
                                    partId: string,
                                    depth: number = 0,
                                  ): React.ReactNode => {
                                    const part = character?.[partId];
                                    if (!part) return null;
                                    const isSelected =
                                      selectedPartIds.includes(partId);
                                    const hasChildren =
                                      part.children.length > 0;
                                    const isVisible = part.isVisible !== false;

                                    return (
                                      <div key={partId} className="relative">
                                        <div
                                          style={{
                                            paddingLeft: `${depth * 12 + 8}px`,
                                          }}
                                          className={`flex items-center group min-w-0 gap-2 py-1.5 px-2 rounded cursor-pointer transition-all border border-transparent ${isSelected ? "bg-cyan-500/10 border-cyan-500/20 text-cyan-400" : "hover:bg-white/5 text-gray-400 hover:text-white"}`}
                                          onClick={(e) => {
                                            if (e.shiftKey) {
                                              setSelectedPartIds((prev) =>
                                                prev.includes(partId)
                                                  ? prev.filter(
                                                      (id) => id !== partId,
                                                    )
                                                  : [...prev, partId],
                                              );
                                            } else {
                                              setSelectedPartIds([partId]);
                                              setPropertyTarget(partId);
                                            }
                                          }}
                                        >
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setCharacter(
                                                Object.fromEntries(
                                                  Object.entries(
                                                    character!,
                                                  ).map(([id, p]) =>
                                                    id === partId
                                                      ? [
                                                          id,
                                                          {
                                                            ...(p as CharacterPart),
                                                            isOpen: !(
                                                              p as CharacterPart
                                                            ).isOpen,
                                                          },
                                                        ]
                                                      : [
                                                          id,
                                                          p as CharacterPart,
                                                        ],
                                                  ),
                                                ),
                                              );
                                            }}
                                            className={`p-0.5 rounded hover:bg-white/10 ${hasChildren ? "" : "invisible"}`}
                                          >
                                            {part.isOpen ? (
                                              <ChevronDown size={12} />
                                            ) : (
                                              <ChevronRight size={12} />
                                            )}
                                          </button>
                                          {part.isGroup ? (
                                            <Folder
                                              size={12}
                                              className={
                                                part.isOpen
                                                  ? "text-amber-400"
                                                  : "text-amber-600"
                                              }
                                            />
                                          ) : (
                                            <Layout
                                              size={12}
                                              className="text-gray-500"
                                            />
                                          )}
                                          <span className="text-[10px] font-medium truncate flex-1">
                                            {part.label}
                                          </span>
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              const newName = prompt(
                                                t("Enter new name:"),
                                                part.label,
                                              );
                                              if (
                                                newName &&
                                                newName.trim() !== ""
                                              ) {
                                                setCharacter(
                                                  Object.fromEntries(
                                                    Object.entries(
                                                      character!,
                                                    ).map(([id, p]) =>
                                                      id === partId
                                                        ? [
                                                            id,
                                                            {
                                                              ...(p as CharacterPart),
                                                              label:
                                                                newName.trim(),
                                                            },
                                                          ]
                                                        : [
                                                            id,
                                                            p as CharacterPart,
                                                          ],
                                                    ),
                                                  ),
                                                );
                                              }
                                            }}
                                            className={`p-1 rounded opacity-100 hover:bg-white/10 transition-colors text-gray-500 hover:text-white`}
                                            title={t("Rename Layer")}
                                          >
                                            <Edit3 size={12} />
                                          </button>
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setCharacter(
                                                Object.fromEntries(
                                                  Object.entries(
                                                    character!,
                                                  ).map(([id, p]) =>
                                                    id === partId
                                                      ? [
                                                          id,
                                                          {
                                                            ...(p as CharacterPart),
                                                            isVisible:
                                                              !isVisible,
                                                          },
                                                        ]
                                                      : [
                                                          id,
                                                          p as CharacterPart,
                                                        ],
                                                  ),
                                                ),
                                              );
                                            }}
                                            className={`p-1 rounded hover:bg-white/10 transition-colors ${isVisible ? "text-gray-500 hover:text-white" : "text-red-500/50"}`}
                                          >
                                            {isVisible ? (
                                              <Eye size={12} />
                                            ) : (
                                              <EyeOff size={12} />
                                            )}
                                          </button>
                                        </div>
                                        {part.isOpen && hasChildren && (
                                          <div className="relative">
                                            <div
                                              className="absolute left-[13px] top-0 bottom-0 w-px bg-white/5"
                                              style={{
                                                left: `${depth * 12 + 15}px`,
                                              }}
                                            />
                                            {part.children.map((childId) =>
                                              renderItem(childId, depth + 1),
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  };
                                  return renderItem("root");
                                })()}
                              </div>
                            </div>
                          )}
                        </div>
                      ) : null}
                    </div>
                  </div>
                )}

                <div className="flex-1 bg-[#050505] relative flex flex-col min-w-0 transition-all duration-300">
                  <div
                    className={`flex-1 relative overflow-hidden flex items-center justify-center ${isPresentationMode ? "p-0 bg-black" : "p-2 lg:p-4"}`}
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                  >
                    <div
                      ref={canvasContainerRef}
                      style={{ containerType: "size" }}
                      className="w-full h-full flex items-center justify-center"
                    >
                      <div
                        id="animato-render-stage"
                        className={`shrink-0 relative shadow-2xl overflow-hidden ring-1 ring-white/10 rounded-lg transition-colors duration-300 ease-in-out ${isCanvasTransparent && !isPresentationMode ? "bg-[url(https://upload.wikimedia.org/wikipedia/commons/e/e9/Transparency_checkered_background.png)]" : ""}`}
                        style={{
                          width: `${(Number(aspectRatio.split(/[:/]/)[0]) || 16) * 120}px`,
                          height: `${(Number(aspectRatio.split(/[:/]/)[1]) || 9) * 120}px`,
                          backgroundColor: isCanvasTransparent
                            ? "transparent"
                            : canvasBgColor,
                          transform: `scale(${stageScale})`,
                          transformOrigin: "center center"
                        }}
                      >
                        <div
                          className="absolute inset-0 pointer-events-none"
                          style={{
                            backgroundImage: backgroundImage.url
                              ? `url("${backgroundImage.url}")`
                              : "none",
                            backgroundSize: `${backgroundTransform.zoom}%`,
                            backgroundPosition: `${backgroundTransform.x}% ${backgroundTransform.y}%`,
                            backgroundRepeat: "no-repeat",
                            filter: `saturate(${backgroundTransform.saturation}%) contrast(${backgroundTransform.contrast}%) blur(${backgroundTransform.blur}px) brightness(${backgroundTransform.brightness * (lightSources.some(l => l.isActive) ? ambientLightLevel : 1.0)}%)`,
                            transform: linkBgToCamera
                              ? `translate(${cameraTransform.x}px, ${cameraTransform.y}px) rotate(${cameraTransform.rotation}deg) scale(${cameraTransform.scale})`
                              : "none",
                            transformOrigin: "center center",
                          }}
                        />
                        {showGrid && !isPresentationMode && !isExporting && (
                          <div
                            className="absolute inset-0 z-50 pointer-events-none opacity-30"
                            style={{
                              backgroundImage:
                                "linear-gradient(#00f2ff 1px, transparent 1px), linear-gradient(90deg, #00f2ff 1px, transparent 1px)",
                              backgroundSize: "10% 10%",
                            }}
                          >
                            <div className="absolute left-10 right-10 top-10 bottom-10 border-2 border-cyan-500/50"></div>
                          </div>
                        )}
                        <div
                          className="absolute inset-0 w-full h-full"
                          style={{
                            transform: `translate(${cameraTransform.x}px, ${cameraTransform.y}px) rotate(${cameraTransform.rotation}deg) scale(${cameraTransform.scale})`,
                            transformOrigin: "center center",
                          }}
                        >
                           {/* SCENE LEVEL LIGHTS (Render Behind All) */}
                          <div className="absolute inset-0 pointer-events-none mix-blend-screen overflow-visible" style={{ zIndex: 0 }}>
                            {lightSources.filter(l => l.isActive && l.renderBehind && (!l.targetCharacterId || l.targetCharacterId === "")).map(light => {
                               const radius = light.radius || 300;
                               return (
                                  <div 
                                    key={light.id}
                                    className="absolute rounded-full pointer-events-none"
                                    style={{
                                        left: '50%',
                                        top: '50%',
                                        width: light.type === 'SUN' ? '2000vw' : `${radius * 2}px`,
                                        height: light.type === 'SUN' ? '2000vh' : `${radius * 2}px`,
                                        transform: light.type === 'SUN' ? 'translate(-50%, -50%)' : `translate(calc(-50% + ${light.x}px), calc(-50% + ${light.y}px))`,
                                        animation: light.isBlinking ? `discoBlink ${Math.max(0.1, 2.0 - (light.blinkSpeed||0.5)*1.2)}s infinite step-start` : 'none'
                                    }}
                                  >
                                    <div
                                      className="w-full h-full rounded-full"
                                      style={{
                                          background: light.type === 'SUN' ? light.color : `radial-gradient(circle closest-side, ${light.color} 0%, ${light.color} 20%, color-mix(in srgb, ${light.color} 40%, transparent) 50%, transparent 100%)`,
                                          opacity: Math.min(1, light.intensity),
                                          filter: `blur(${light.softness || 0}px) brightness(${Math.max(1, light.intensity)})`,
                                      }}
                                    />
                                  </div>
                               );
                            })}
                          </div>

                          {characters.map((charInstance) => {
                            const filters = characterFiltersMap[
                              charInstance.id
                            ] || DEFAULT_CHARACTER_FILTERS;
                            const cVisemeMap =
                              charInstance.visemeMap || visemeMap;
                            const isTarget =
                              activeSceneCharacterId === charInstance.id;
                            const charViseme = getCharacterViseme(
                              charInstance.id,
                            );

                            return (
                              <div key={charInstance.id} className="absolute inset-0" style={{ zIndex: isTarget ? 30 : 10 }}>
                                {/* Character Specific Lights */}
                                <div className="absolute inset-0 pointer-events-none mix-blend-screen overflow-visible" style={{ zIndex: 5 }}>
                                  {lightSources.filter(l => l.isActive && l.renderBehind && l.targetCharacterId === charInstance.id).map(light => {
                                     const radius = light.radius || 300;
                                     return (
                                        <div 
                                          key={light.id}
                                          className="absolute rounded-full pointer-events-none"
                                          style={{
                                              left: '50%',
                                              top: '50%',
                                              width: light.type === 'SUN' ? '2000vw' : `${radius * 2}px`,
                                              height: light.type === 'SUN' ? '2000vh' : `${radius * 2}px`,
                                              transform: light.type === 'SUN' ? 'translate(-50%, -50%)' : `translate(calc(-50% + ${light.x}px), calc(-50% + ${light.y}px))`,
                                              animation: light.isBlinking ? `discoBlink ${Math.max(0.1, 2.0 - (light.blinkSpeed||0.5)*1.2)}s infinite step-start` : 'none'
                                          }}
                                        >
                                          <div
                                            className="w-full h-full rounded-full"
                                            style={{
                                                background: light.type === 'SUN' ? light.color : `radial-gradient(circle closest-side, ${light.color} 0%, ${light.color} 20%, color-mix(in srgb, ${light.color} 40%, transparent) 50%, transparent 100%)`,
                                                opacity: Math.min(1, light.intensity),
                                                filter: `blur(${light.softness || 0}px) brightness(${Math.max(1, light.intensity)})`,
                                            }}
                                          />
                                        </div>
                                     );
                                  })}
                                </div>

                                {shadowConfig.enabled &&
                                  !isLowPerformanceMode &&
                                  charInstance.composition && (
                                    <div
                                      className="absolute inset-0 flex items-center justify-center pointer-events-none transition-all duration-75 ease-linear"
                                      style={{
                                        transform: `translate(${shadowConfig.offsetX}px, ${shadowConfig.offsetY}px) skewX(${shadowConfig.skewX}deg) scaleY(${shadowConfig.scaleY})`,
                                        opacity: shadowConfig.opacity,
                                        filter: `blur(${shadowConfig.blur}px)`,
                                      }}
                                    >
                                      <CharacterStage
                                        theme="dark"
                                        viseme={charViseme}
                                        visemeMap={cVisemeMap}
                                        character={charInstance.composition}
                                        shadowMode={true}
                                        disableSmoothness={isExporting}
                                        disableRigging={true}
                                        characterFilters={filters}
                                        isLowPerformanceMode={
                                          isLowPerformanceMode
                                        }
                                      />
                                    </div>
                                  )}
                                {depthShadowConfig.enabled &&
                                  !isLowPerformanceMode &&
                                  charInstance.composition && (
                                    <div
                                      className="absolute inset-0 flex items-center justify-center pointer-events-none transition-all duration-75 ease-linear"
                                      style={{
                                        transform: `translate(${depthShadowConfig.offsetX}px, ${depthShadowConfig.offsetY}px)`,
                                        opacity: depthShadowConfig.opacity,
                                      }}
                                    >
                                      <CharacterStage
                                        theme="dark"
                                        viseme={charViseme}
                                        visemeMap={cVisemeMap}
                                        character={charInstance.composition}
                                        shadowMode={true}
                                        disableSmoothness={isExporting}
                                        disableRigging={true}
                                        characterFilters={filters}
                                        isLowPerformanceMode={
                                          isLowPerformanceMode
                                        }
                                      />
                                    </div>
                                  )}
                                <div
                                  className={`absolute inset-0 flex items-center justify-center z-10 cursor-default`}
                                  style={{
                                    filter: lightSources.some(l => l.isActive) ? `brightness(${ambientLightLevel * 100}%) contrast(110%)` : 'none',
                                  }}
                                  onClick={() => handleStageClick("root")}
                                >
                                  <CharacterStage
                                    theme="dark"
                                    viseme={charViseme}
                                    visemeMap={cVisemeMap}
                                    character={charInstance.composition}
                                    onAnchorChange={handleAnchorChange}
                                    showAnchors={
                                      isTarget &&
                                      isAnchorMode &&
                                      !isPresentationMode &&
                                      !isExporting
                                    }
                                    activePartId={
                                      isTarget ? propertyTarget : null
                                    }
                                    editingPartId={null}
                                    boneTransforms={
                                      isTarget
                                        ? currentBoneTransforms
                                        : charInstance.boneTransforms || DEFAULT_BONE_TRANSFORMS
                                    }
                                    onBoneSelect={handleBoneSelect}
                                    activeBoneId={
                                      isTarget ? activeBoneId : null
                                    }
                                    showSkeleton={false}
                                    ambientLightLevel={ambientLightLevel}
                                    showLightGizmos={false}
                                    disableSmoothness={isExporting}
                                    disableRigging={true}
                                    activeRigTool={activeRigTool}
                                    rigType={rigType}
                                    onBonesChange={handleBonesChange}
                                    onInteractionEnd={handleInteractionEnd}
                                    characterFilters={filters}
                                    isLowPerformanceMode={isLowPerformanceMode}
                                  />
                                </div>
                              </div>
                            );
                          })}

                          {/* SCENE LEVEL LIGHTS */}
                          <div className="absolute inset-0 pointer-events-none z-[100] mix-blend-screen overflow-visible">
                            {lightSources.filter(l => l.isActive && !l.renderBehind).map(light => {
                               if (light.type === 'LIGHTNING') {
                                  return (
                                     <div 
                                       key={light.id}
                                       className="absolute inset-0 pointer-events-none transition-all duration-75"
                                       style={{
                                           background: light.color,
                                           opacity: Math.min(1, light.intensity),
                                           filter: light.softness ? `blur(${light.softness}px)` : undefined,
                                       }}
                                     />
                                  );
                               }
                               const radius = light.radius || 300;
                               return (
                                  <div 
                                    key={light.id}
                                    className="absolute rounded-full pointer-events-none"
                                    style={{
                                        left: '50%',
                                        top: '50%',
                                        width: radius * 2,
                                        height: radius * 2,
                                        transform: `translate(calc(-50% + ${light.x}px), calc(-50% + ${light.y}px))`,
                                        animation: light.isBlinking ? `discoBlink ${Math.max(0.1, 2.0 - (light.blinkSpeed||0.5)*1.2)}s infinite step-start` : 'none'
                                    }}
                                  >
                                    <div
                                      className="w-full h-full rounded-full"
                                      style={{
                                          background: `radial-gradient(circle closest-side, ${light.color} 0%, ${light.color} 20%, color-mix(in srgb, ${light.color} 40%, transparent) 50%, transparent 100%)`,
                                          opacity: Math.min(1, light.intensity),
                                          filter: `blur(${light.softness || 0}px) brightness(${Math.max(1, light.intensity)})`,
                                      }}
                                    />
                                  </div>
                               );
                            })}
                          </div>

                          {/* LIGHT GIZMOS */}
                          {activeBottomTab === "FX" && !isPresentationMode && !isExporting && (
                            <div className="absolute inset-0 z-[1000] pointer-events-none">
                               {lightSources.map(light => (
                                  <div 
                                    key={light.id}
                                    onPointerDown={(e) => {
                                       e.stopPropagation();
                                       setIsDraggingLight(true);
                                       setDraggingLightId(light.id);
                                       dragStartRef.current = {
                                          startX: e.clientX,
                                          startY: e.clientY,
                                          initialX: light.x,
                                          initialY: light.y
                                       };
                                       (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                                    }}
                                    className={`absolute w-10 h-10 -ml-5 -mt-5 cursor-move pointer-events-auto group touch-none animate-in zoom-in-50 fade-in duration-300`}
                                    style={{
                                        left: '50%', top: '50%',
                                        transform: `translate(${light.x}px, ${light.y}px)`
                                    }}
                                  >
                                      <div className={`absolute inset-0 rounded-full border-2 border-white/40 opacity-0 group-hover:opacity-100 transition-all scale-125 ${light.isActive ? 'border-cyan-400/60' : 'border-gray-500/40'}`}></div>
                                      <div className={`w-full h-full rounded-full flex items-center justify-center shadow-2xl transition-all hover:scale-110 ${light.isActive ? 'bg-black/60 border border-white/20' : 'bg-black/80 border border-white/5 opacity-50 grayscale'}`}>
                                          {light.type === 'SUN' && <Sun size={20} className={`${light.isActive ? 'text-amber-400 animate-[spin_12s_linear_infinite]' : 'text-gray-500'}`} />}
                                          {light.type === 'BULB' && <Lightbulb size={20} className={`${light.isActive ? 'text-cyan-400' : 'text-gray-500'}`} style={{ color: light.isActive ? light.color : undefined }} />}
                                          {light.type === 'LIGHTNING' && <Zap size={20} className={`${light.isActive ? 'text-purple-400 fill-current' : 'text-gray-500'}`} />}
                                      </div>
                                      <div className={`absolute -bottom-6 left-1/2 -translate-x-1/2 whitespace-nowrap bg-black/80 border border-white/10 px-2 py-0.5 rounded text-[8px] font-black tracking-tighter uppercase transition-opacity ${light.isActive ? 'text-white block' : 'text-gray-500'}`}>
                                         {light.id}
                                      </div>
                                  </div>
                               ))}
                            </div>
                          )}
                          {lightSources
                            .filter((l) => l.type === "LIGHTNING" && l.isActive)
                            .map((l) => (
                              <div
                                key={l.id}
                                className="absolute inset-0 z-30 pointer-events-none mix-blend-screen"
                                style={{
                                  backgroundColor: l.color,
                                  opacity: l.intensity,
                                }}
                              ></div>
                            ))}

                          {/* DYNAMIC TEXT LAYERS */}
                          {texts.map((textObj) => {
                            const isSelected = selectedTextId === textObj.id && !isPresentationMode && !isExporting;
                            const textStyle = getTextStyle(textObj);
                            return (
                              <div
                                key={textObj.id}
                                onPointerDown={(e) => {
                                  if (!isPresentationMode && !isExporting) {
                                    e.stopPropagation();
                                    setSelectedTextId(textObj.id);
                                  }
                                }}
                                className={`absolute group select-none ${isSelected ? 'ring-2 ring-cyan-400 p-2 rounded' : ''}`}
                                style={{
                                  left: '50%',
                                  top: '50%',
                                  width: 'max-content',
                                  maxWidth: '400px',
                                  transform: `translate(-50%, -50%) translate(${textObj.x}px, ${textObj.y}px) scale(${textObj.scale}) rotate(${textObj.rotation}deg)`,
                                  transformOrigin: 'center center',
                                  zIndex: 150,
                                  cursor: isPresentationMode || isExporting ? 'default' : 'move',
                                }}
                              >
                                <div
                                  onPointerDown={(e) => {
                                    if (!isPresentationMode && !isExporting) {
                                      handleTextDragStart(e, textObj);
                                    }
                                  }}
                                  style={{
                                    fontFamily: textStyle.fontFamily,
                                    color: textStyle.color,
                                    textShadow: textStyle.textShadow,
                                    textTransform: textStyle.textTransform as any,
                                    fontSize: `${textObj.fontSize}px`,
                                    fontWeight: 'bold',
                                    textAlign: 'center',
                                    whiteSpace: 'pre-wrap',
                                    lineHeight: 1.2,
                                  }}
                                >
                                  {textObj.text}
                                </div>

                                {isSelected && (
                                  <>
                                    <div
                                      onPointerDown={(e) => handleTextRotateStart(e, textObj)}
                                      className="absolute -top-8 left-1/2 -translate-x-1/2 w-5 h-5 bg-cyan-500 border border-white rounded-full flex items-center justify-center cursor-alias pointer-events-auto shadow-lg text-black hover:bg-cyan-400 hover:scale-110 transition-transform"
                                      title={t('Rotate')}
                                    >
                                      <LucideIcons.RotateCw size={10} />
                                    </div>

                                    <div
                                      onPointerDown={(e) => handleTextScaleStart(e, textObj)}
                                      className="absolute -bottom-2 -right-2 w-4 h-4 bg-cyan-500 border border-white rounded-full cursor-se-resize pointer-events-auto shadow-lg hover:scale-110 transition-transform"
                                      title={t('Scale')}
                                    />

                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setTexts((prev) => prev.filter((item) => item.id !== textObj.id));
                                        setSelectedTextId(null);
                                      }}
                                      className="absolute -top-2 -right-2 w-4 h-4 bg-red-500 border border-white rounded-full flex items-center justify-center text-white pointer-events-auto shadow-lg hover:bg-red-400 hover:scale-110 transition-all text-[8px]"
                                      title={t('Delete')}
                                    >
                                      <LucideIcons.X size={8} />
                                    </button>
                                  </>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                {/* Desktop Right Sidebar for Properties */}
                {!isPresentationMode &&
                  isDesktopLike &&
                  activeBottomTab !== "TIMELINE" && (
                    <div className="w-72 landscape:w-60 lg:landscape:w-72 portrait:w-72 bg-[#0c0c0e] border-l border-white/10 flex flex-col relative animate-in slide-in-from-right duration-300 shrink-0 z-40">
                      <div className="p-3 border-b border-white/5 bg-[#0a0a0a] flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="p-1 rounded bg-cyan-500/10 text-cyan-400">
                            <Settings size={14} />
                          </div>
                          <span className="text-[10px] font-black uppercase tracking-widest text-white">
                            {activeBottomTab} PROPERTIES
                          </span>
                        </div>
                        <button
                          onClick={() => setActiveBottomTab("TIMELINE" as any)}
                          className="p-1 text-gray-500 hover:text-white"
                        >
                          <X size={14} />
                        </button>
                      </div>
                      <div className="flex-1 overflow-y-auto transform-gpu custom-scrollbar p-0 bg-[#080808]">
                        <div className="p-4 space-y-6">
                          {activeBottomTab === "SCENE" && (
                            <div className="space-y-6">
                              {/* Sub-Tabs: STAGE vs TEXT */}
                              <div className="flex border-b border-white/5 p-1 bg-black/40 rounded-lg gap-1">
                                <button
                                  onClick={() => setActiveSceneSubTab("STAGE")}
                                  className={`flex-1 py-1.5 text-center text-[10px] font-bold rounded-md transition-all flex items-center justify-center gap-1.5 ${activeSceneSubTab === "STAGE" ? "bg-cyan-500 text-black shadow-md shadow-cyan-500/20" : "text-gray-400 hover:text-white"}`}
                                >
                                  <LucideIcons.Monitor size={11} />
                                  {t("STAGE SETTINGS")}
                                </button>
                                <button
                                  onClick={() => setActiveSceneSubTab("TEXT")}
                                  className={`flex-1 py-1.5 text-center text-[10px] font-bold rounded-md transition-all flex items-center justify-center gap-1.5 ${activeSceneSubTab === "TEXT" ? "bg-cyan-500 text-black shadow-md shadow-cyan-500/20" : "text-gray-400 hover:text-white"}`}
                                >
                                  <LucideIcons.Type size={11} />
                                  {t("TEXT LAYERS")}
                                </button>
                              </div>

                              {activeSceneSubTab === "STAGE" && (
                                <div className="space-y-6 animate-in fade-in duration-150">
                                  <div className="space-y-3">
                                    <div className="flex items-center justify-between text-[10px] font-black text-gray-400 uppercase tracking-widest">
                                      <div className="flex items-center gap-2">
                                        <Clock size={12} /> {t("TIMELINE DURATION")}
                                      </div>
                                      <button onClick={() => setCustomTotalDuration(null)} className="text-[9px] bg-white/5 hover:bg-white/10 px-1.5 py-0.5 rounded transition-colors text-cyan-400">
                                        {t("AUTO")}
                                      </button>
                                    </div>
                                    <div className="bg-[#111] p-3 rounded-lg border border-white/5 space-y-3">
                                      <div className="flex items-center gap-2">
                                         <div className="flex-1 flex flex-col gap-1">
                                             <span className="text-[8px] font-bold text-gray-500 text-center">HOURS</span>
                                             <input type="number" min="0" value={customTotalDuration !== null ? Math.floor(customTotalDuration / 3600) : Math.floor(safeDuration / 3600)} onChange={e => {
                                                const h = parseInt(e.target.value) || 0;
                                                const m = customTotalDuration !== null ? Math.floor((customTotalDuration % 3600) / 60) : Math.floor((safeDuration % 3600) / 60);
                                                const s = customTotalDuration !== null ? customTotalDuration % 60 : safeDuration % 60;
                                                setCustomTotalDuration((h * 3600) + (m * 60) + s);
                                             }} className="w-full bg-[#080808] border border-white/10 text-center rounded text-xs text-white p-1.5 outline-none font-mono focus:border-cyan-500/50 transition-colors" />
                                         </div>
                                         <span className="text-gray-600 font-bold mt-3">:</span>
                                         <div className="flex-1 flex flex-col gap-1">
                                             <span className="text-[8px] font-bold text-gray-500 text-center">MINUTES</span>
                                             <input type="number" min="0" max="59" value={customTotalDuration !== null ? Math.floor((customTotalDuration % 3600) / 60) : Math.floor((safeDuration % 3600) / 60)} onChange={e => {
                                                const h = customTotalDuration !== null ? Math.floor(customTotalDuration / 3600) : Math.floor(safeDuration / 3600);
                                                const m = parseInt(e.target.value) || 0;
                                                const s = customTotalDuration !== null ? customTotalDuration % 60 : safeDuration % 60;
                                                setCustomTotalDuration((h * 3600) + (m * 60) + s);
                                             }} className="w-full bg-[#080808] border border-white/10 text-center rounded text-xs text-white p-1.5 outline-none font-mono focus:border-cyan-500/50 transition-colors" />
                                         </div>
                                         <span className="text-gray-600 font-bold mt-3">:</span>
                                         <div className="flex-1 flex flex-col gap-1">
                                             <span className="text-[8px] font-bold text-gray-500 text-center">SECONDS</span>
                                             <input type="number" min="0" max="59" value={customTotalDuration !== null ? Math.floor(customTotalDuration % 60) : Math.floor(safeDuration % 60)} onChange={e => {
                                                const h = customTotalDuration !== null ? Math.floor(customTotalDuration / 3600) : Math.floor(safeDuration / 3600);
                                                const m = customTotalDuration !== null ? Math.floor((customTotalDuration % 3600) / 60) : Math.floor((safeDuration % 3600) / 60);
                                                const s = parseFloat(e.target.value) || 0;
                                                setCustomTotalDuration((h * 3600) + (m * 60) + s);
                                             }} className="w-full bg-[#080808] border border-white/10 text-center rounded text-xs text-white p-1.5 outline-none font-mono focus:border-cyan-500/50 transition-colors" />
                                         </div>
                                      </div>
                                    </div>
                                  </div>
                                  <div className="space-y-3">
                                    <div className="flex items-center gap-2 text-[10px] font-black text-gray-400 uppercase tracking-widest">
                                      <Camera size={12} /> {t("CAMERA")}
                                    </div>
                                    <div className="space-y-4 bg-black/40 p-3 rounded-xl border border-white/5">
                                      <div className="space-y-1.5 ">
                                        <div className="flex justify-between items-center">
                                          <span className="text-[9px] font-bold text-gray-500">
                                            ZOOM (Max Limit: {Math.round(maxZoomLimit * 100)}%)
                                          </span>
                                          <div className="flex items-center gap-1.5">
                                            <span className="text-[8px] text-gray-600">Limit:</span>
                                            <input
                                              type="number"
                                              min="1"
                                              value={Math.round(maxZoomLimit * 100)}
                                              onChange={(e) => {
                                                let val = parseInt(e.target.value);
                                                if (!isNaN(val) && val > 0) setMaxZoomLimit(val / 100);
                                              }}
                                              className="text-[9px] font-mono text-cyan-500 bg-black/50 border border-white/5 rounded px-1 w-10 text-center outline-none focus:border-cyan-400"
                                            />
                                            <input
                                              type="number"
                                              min="10"
                                              step="1"
                                              value={Math.round(cameraTransform.scale * 100)}
                                              onChange={(e) => {
                                                  let val = parseFloat(e.target.value);
                                                  if (!isNaN(val)) updateCamera({ scale: val / 100 });
                                              }}
                                              className="text-[9px] font-mono text-cyan-400 bg-transparent text-right w-8 outline-none border-b border-cyan-500/30 focus:border-cyan-400 pointer-events-auto"
                                            />
                                            <span className="text-[9px] font-mono text-cyan-400">%</span>
                                          </div>
                                        </div>
                                        <input
                                          type="range"
                                          min="0.1"
                                          max={maxZoomLimit}
                                          step="0.05"
                                          value={cameraTransform.scale}
                                          onChange={(e) =>
                                            updateCamera({
                                              scale: parseFloat(e.target.value),
                                            })
                                          }
                                          className="w-full h-1 bg-white/10 rounded-full accent-cyan-500"
                                        />
                                      </div>
                                      <div className="space-y-1.5">
                                        <div className="flex justify-between items-center">
                                          <span className="text-[9px] font-bold text-gray-500">
                                            ROTATION
                                          </span>
                                          <div className="flex items-center gap-0.5">
                                            <input
                                              type="number"
                                              step="1"
                                              value={Math.round(cameraTransform.rotation)}
                                              onChange={(e) => {
                                                  let val = parseFloat(e.target.value);
                                                  if (!isNaN(val)) updateCamera({ rotation: val });
                                              }}
                                              className="text-[9px] font-mono text-cyan-400 bg-transparent text-right w-8 outline-none border-b border-cyan-500/30 focus:border-cyan-400 pointer-events-auto"
                                            />
                                            <span className="text-[9px] font-mono text-cyan-400">°</span>
                                          </div>
                                        </div>
                                        <input
                                          type="range"
                                          min="-180"
                                          max="180"
                                          value={cameraTransform.rotation}
                                          onChange={(e) =>
                                            updateCamera({
                                              rotation: parseFloat(e.target.value),
                                            })
                                          }
                                          className="w-full h-1 bg-white/10 rounded-full accent-cyan-500"
                                        />
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              )}

                              {activeSceneSubTab === "TEXT" && (
                                <div className="space-y-4 animate-in fade-in duration-150">
                                  <button
                                    onClick={() => {
                                      const newText: SceneText = {
                                        id: `text_${Date.now()}`,
                                        text: t("New Text"),
                                        x: 0,
                                        y: 0,
                                        scale: 1.0,
                                        rotation: 0,
                                        color: "#ffffff",
                                        borderColor: "#000000",
                                        borderWidth: 2,
                                        backgroundColor: "transparent",
                                        shadowColor: "transparent",
                                        fontSize: 40,
                                        fontFamily: "Arial",
                                        styleTemplate: 'none'
                                      };
                                      setTexts((prev) => [...prev, newText]);
                                      setSelectedTextId(newText.id);
                                    }}
                                    className="w-full bg-cyan-500 hover:bg-cyan-400 text-black font-bold py-2 px-3 rounded-lg flex items-center justify-center gap-1.5 transition-colors text-xs"
                                  >
                                    <LucideIcons.Plus size={14} />
                                    {t("ADD NEW TEXT")}
                                  </button>

                                  {selectedTextId ? (
                                    (() => {
                                      const selectedText = texts.find((t) => t.id === selectedTextId);
                                      if (!selectedText) return null;
                                      return (
                                        <div className="space-y-4 bg-[#111] p-3 rounded-xl border border-white/5 text-left">
                                          <div className="flex items-center justify-between border-b border-white/5 pb-2">
                                            <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-1">
                                              <LucideIcons.Edit3 size={11} className="text-cyan-400" />
                                              {t("EDIT TEXT LAYER")}
                                            </span>
                                            <button
                                              onClick={() => setSelectedTextId(null)}
                                              className="text-[9px] text-cyan-400 hover:text-cyan-300"
                                            >
                                              {t("Deselect")}
                                            </button>
                                          </div>

                                          <div className="space-y-1">
                                            <span className="text-[8px] font-bold text-gray-500 uppercase">{t("TEXT CONTENT")}</span>
                                            <textarea
                                              value={selectedText.text}
                                              onChange={(e) =>
                                                setTexts((prev) =>
                                                  prev.map((t) => (t.id === selectedTextId ? { ...t, text: e.target.value } : t))
                                                )
                                              }
                                              rows={2}
                                              className="w-full bg-[#080808] border border-white/10 rounded text-xs text-white p-2 outline-none focus:border-cyan-500/50 transition-colors resize-none"
                                              placeholder={t("Type your text here...")}
                                            />
                                          </div>

                                          <div className="space-y-1">
                                            <span className="text-[8px] font-bold text-gray-500 uppercase">{t("STYLE PRESET")}</span>
                                            <select
                                              value={selectedText.styleTemplate}
                                              onChange={(e) =>
                                                setTexts((prev) =>
                                                  prev.map((t) =>
                                                    t.id === selectedTextId
                                                      ? { ...t, styleTemplate: e.target.value as any }
                                                      : t
                                                  )
                                                )
                                              }
                                              className="w-full bg-[#080808] border border-white/10 rounded px-2 py-1.5 text-[10px] text-white outline-none focus:border-cyan-500/50"
                                            >
                                              <option value="none">{t("Default Style")}</option>
                                              <option value="meme">{t("Meme Theme (Impact)")}</option>
                                              <option value="subtitle">{t("Subtitle Theme (Yellow)")}</option>
                                              <option value="comic">{t("Comic Book Theme")}</option>
                                            </select>
                                          </div>

                                          {selectedText.styleTemplate === "none" && (
                                            <div className="space-y-1">
                                              <span className="text-[8px] font-bold text-gray-500 uppercase">{t("FONT FAMILY")}</span>
                                              <select
                                                value={selectedText.fontFamily}
                                                onChange={(e) =>
                                                  setTexts((prev) =>
                                                    prev.map((t) =>
                                                      t.id === selectedTextId ? { ...t, fontFamily: e.target.value } : t
                                                    )
                                                  )
                                                }
                                                className="w-full bg-[#080808] border border-white/10 rounded px-2 py-1.5 text-[10px] text-white outline-none focus:border-cyan-500/50"
                                              >
                                                {["Arial", "Courier New", "Georgia", "Times New Roman", "Impact", "Comic Sans MS", "Verdana", "Trebuchet MS", "Tahoma"].map((font) => (
                                                  <option key={font} value={font}>
                                                    {font}
                                                  </option>
                                                ))}
                                              </select>
                                            </div>
                                          )}

                                          <div className="space-y-1">
                                            <div className="flex justify-between items-center">
                                              <span className="text-[8px] font-bold text-gray-500 uppercase">{t("FONT SIZE")}</span>
                                              <span className="text-[9px] font-mono text-cyan-400">{selectedText.fontSize}px</span>
                                            </div>
                                            <input
                                              type="range"
                                              min="12"
                                              max="150"
                                              value={selectedText.fontSize}
                                              onChange={(e) =>
                                                setTexts((prev) =>
                                                  prev.map((t) =>
                                                    t.id === selectedTextId ? { ...t, fontSize: parseInt(e.target.value) } : t
                                                  )
                                                )
                                              }
                                              className="w-full h-1 bg-white/10 rounded-full accent-cyan-500"
                                            />
                                          </div>

                                          {selectedText.styleTemplate === "none" && (
                                            <>
                                              <div className="grid grid-cols-2 gap-2">
                                                <div className="space-y-1 text-left">
                                                  <span className="text-[8px] font-bold text-gray-500 uppercase">{t("TEXT COLOR")}</span>
                                                  <div className="flex gap-1.5 items-center">
                                                    <input
                                                      type="color"
                                                      value={selectedText.color}
                                                      onChange={(e) =>
                                                        setTexts((prev) =>
                                                          prev.map((t) =>
                                                            t.id === selectedTextId ? { ...t, color: e.target.value } : t
                                                          )
                                                        )
                                                      }
                                                      className="w-6 h-6 rounded bg-transparent border border-white/10 cursor-pointer p-0 shrink-0"
                                                    />
                                                    <input
                                                      type="text"
                                                      value={selectedText.color}
                                                      onChange={(e) =>
                                                        setTexts((prev) =>
                                                          prev.map((t) =>
                                                            t.id === selectedTextId ? { ...t, color: e.target.value } : t
                                                          )
                                                        )
                                                      }
                                                      className="w-full bg-[#080808] border border-white/10 rounded text-[9px] font-mono text-white p-1 text-center"
                                                    />
                                                  </div>
                                                </div>

                                                <div className="space-y-1 text-left">
                                                  <span className="text-[8px] font-bold text-gray-500 uppercase">{t("BORDER COLOR")}</span>
                                                  <div className="flex gap-1.5 items-center">
                                                    <input
                                                      type="color"
                                                      value={selectedText.borderColor}
                                                      onChange={(e) =>
                                                        setTexts((prev) =>
                                                          prev.map((t) =>
                                                            t.id === selectedTextId ? { ...t, borderColor: e.target.value } : t
                                                          )
                                                        )
                                                      }
                                                      className="w-6 h-6 rounded bg-transparent border border-white/10 cursor-pointer p-0 shrink-0"
                                                    />
                                                    <input
                                                      type="text"
                                                      value={selectedText.borderColor}
                                                      onChange={(e) =>
                                                        setTexts((prev) =>
                                                          prev.map((t) =>
                                                            t.id === selectedTextId ? { ...t, borderColor: e.target.value } : t
                                                          )
                                                        )
                                                      }
                                                      className="w-full bg-[#080808] border border-white/10 rounded text-[9px] font-mono text-white p-1 text-center"
                                                    />
                                                  </div>
                                                </div>
                                              </div>

                                              <div className="space-y-1">
                                                <div className="flex justify-between items-center">
                                                  <span className="text-[8px] font-bold text-gray-500 uppercase">{t("BORDER WIDTH")}</span>
                                                  <span className="text-[9px] font-mono text-cyan-400">{selectedText.borderWidth}px</span>
                                                </div>
                                                <input
                                                  type="range"
                                                  min="0"
                                                  max="10"
                                                  value={selectedText.borderWidth}
                                                  onChange={(e) =>
                                                    setTexts((prev) =>
                                                      prev.map((t) =>
                                                        t.id === selectedTextId ? { ...t, borderWidth: parseInt(e.target.value) } : t
                                                      )
                                                    )
                                                  }
                                                  className="w-full h-1 bg-white/10 rounded-full accent-cyan-500"
                                                />
                                              </div>
                                            </>
                                          )}

                                          <div className="pt-2 border-t border-white/5 space-y-2">
                                            <span className="text-[8px] font-bold text-gray-500 uppercase block">{t("FINE POSITIONING")}</span>
                                            <div className="grid grid-cols-3 gap-2">
                                              <div>
                                                <span className="text-[7px] text-gray-600 block text-center">X OFFSET</span>
                                                <input
                                                  type="number"
                                                  value={Math.round(selectedText.x)}
                                                  onChange={(e) =>
                                                    setTexts((prev) =>
                                                      prev.map((t) =>
                                                        t.id === selectedTextId ? { ...t, x: parseFloat(e.target.value) || 0 } : t
                                                      )
                                                    )
                                                  }
                                                  className="w-full bg-[#080808] border border-white/10 text-center rounded text-[10px] text-white py-1 outline-none font-mono"
                                                />
                                              </div>
                                              <div>
                                                <span className="text-[7px] text-gray-600 block text-center">Y OFFSET</span>
                                                <input
                                                  type="number"
                                                  value={Math.round(selectedText.y)}
                                                  onChange={(e) =>
                                                    setTexts((prev) =>
                                                      prev.map((t) =>
                                                        t.id === selectedTextId ? { ...t, y: parseFloat(e.target.value) || 0 } : t
                                                      )
                                                    )
                                                  }
                                                  className="w-full bg-[#080808] border border-white/10 text-center rounded text-[10px] text-white py-1 outline-none font-mono"
                                                />
                                              </div>
                                              <div>
                                                <span className="text-[7px] text-gray-600 block text-center">ROTATION</span>
                                                <input
                                                  type="number"
                                                  value={Math.round(selectedText.rotation)}
                                                  onChange={(e) =>
                                                    setTexts((prev) =>
                                                      prev.map((t) =>
                                                        t.id === selectedTextId ? { ...t, rotation: parseFloat(e.target.value) || 0 } : t
                                                      )
                                                    )
                                                  }
                                                  className="w-full bg-[#080808] border border-white/10 text-center rounded text-[10px] text-white py-1 outline-none font-mono"
                                                />
                                              </div>
                                            </div>
                                          </div>

                                          <button
                                            onClick={() => {
                                              setTexts((prev) => prev.filter((t) => t.id !== selectedTextId));
                                              setSelectedTextId(null);
                                            }}
                                            className="w-full bg-red-950/40 hover:bg-red-900/40 border border-red-500/20 text-red-400 font-bold py-1.5 px-3 rounded-lg flex items-center justify-center gap-1 transition-all text-[10px]"
                                          >
                                            <LucideIcons.Trash2 size={12} />
                                            {t("DELETE LAYER")}
                                          </button>
                                        </div>
                                      );
                                    })()
                                  ) : null}

                                  <div className="space-y-2">
                                    <span className="text-[9px] font-bold text-gray-500 uppercase tracking-widest block">{t("ACTIVE TEXTS")}</span>
                                    {texts.length === 0 ? (
                                      <div className="text-center py-6 border border-dashed border-white/5 rounded-lg text-[10px] text-gray-500">
                                        {t("No active text layers. Add one above!")}
                                      </div>
                                    ) : (
                                      <div className="space-y-1.5 max-h-48 overflow-y-auto custom-scrollbar">
                                        {texts.map((t) => (
                                          <div
                                            key={t.id}
                                            onClick={() => setSelectedTextId(t.id)}
                                            className={`flex items-center justify-between p-2 rounded-lg cursor-pointer transition-all border ${selectedTextId === t.id ? "bg-cyan-500/10 border-cyan-500/30 text-cyan-400" : "bg-black/20 border-white/5 text-gray-300 hover:bg-black/40 hover:text-white"}`}
                                          >
                                            <div className="flex items-center gap-2 truncate text-left">
                                              <LucideIcons.Type size={12} className="text-cyan-400/80 shrink-0" />
                                              <span className="text-[10px] truncate font-medium">{t.text || "(empty)"}</span>
                                            </div>
                                            <button
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                setTexts((prev) => prev.filter((item) => item.id !== t.id));
                                                if (selectedTextId === t.id) setSelectedTextId(null);
                                              }}
                                              className="p-1 text-gray-500 hover:text-red-400 transition-colors shrink-0"
                                            >
                                              <LucideIcons.Trash2 size={11} />
                                            </button>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                          {activeBottomTab === "CHAR" && (
                            <div className="space-y-6">
                              <div className="bg-[#111] p-3 rounded-lg border border-white/5 space-y-4">
                                <div className="flex flex-col gap-2">
                                  <span className="text-[9px] font-bold text-gray-500 uppercase">
                                    {t("TARGET")}
                                  </span>
                                  <select
                                    value={activeSceneCharacterId || ""}
                                    onChange={(e) =>
                                      setActiveSceneCharacterId(e.target.value)
                                    }
                                    className="w-full bg-black/60 border border-white/10 rounded px-2 py-1.5 text-[10px] text-white"
                                  >
                                    <option value="ALL">
                                      {t("All Characters")}
                                    </option>
                                    {characters.map((c) => (
                                      <option key={c.id} value={c.id}>
                                        {c.name}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              </div>
                              {activeSceneCharacterId !== "ALL" && (
                                <div className="space-y-4">
                                  <div className="flex items-center gap-2 text-[10px] font-black text-gray-400 uppercase tracking-widest border-b border-white/5 pb-2">
                                    <Sliders size={12} /> {t("TRANSFORM")}
                                  </div>
                                  <div className="bg-black/40 p-3 rounded-xl border border-white/5 space-y-4">
                                    <div className="grid grid-cols-2 gap-4">
                                      <div className="space-y-1">
                                        <span className="text-[8px] font-bold text-gray-600 block">
                                          X POSITION
                                        </span>
                                        <input
                                          type="number"
                                          value={Math.round(
                                            character?.[propertyTarget]
                                              ?.transform.x || 0,
                                          )}
                                          onChange={(e) =>
                                            updateCharacterProperty(
                                              "x",
                                              parseFloat(e.target.value),
                                            )
                                          }
                                          className="w-full bg-[#050505] border border-white/10 rounded px-2 py-1 text-[10px] font-mono text-white"
                                        />
                                      </div>
                                      <div className="space-y-1">
                                        <span className="text-[8px] font-bold text-gray-600 block">
                                          Y POSITION
                                        </span>
                                        <input
                                          type="number"
                                          value={Math.round(
                                            character?.[propertyTarget]
                                              ?.transform.y || 0,
                                          )}
                                          onChange={(e) =>
                                            updateCharacterProperty(
                                              "y",
                                              parseFloat(e.target.value),
                                            )
                                          }
                                          className="w-full bg-[#050505] border border-white/10 rounded px-2 py-1 text-[10px] font-mono text-white"
                                        />
                                      </div>
                                    </div>

                                    <div className="space-y-1.5">
                                      <div className="flex justify-between items-center">
                                        <span className="text-[9px] font-bold text-gray-500">
                                          {t("SCALE")}
                                        </span>
                                        <span className="text-[9px] font-mono text-cyan-400">
                                          {(
                                            character?.[propertyTarget]
                                              ?.transform.scaleX || 1
                                          ).toFixed(2)}
                                          x
                                        </span>
                                      </div>
                                      <input
                                        type="range"
                                        min="0.1"
                                        max="5"
                                        step="0.05"
                                        value={
                                          character?.[propertyTarget]?.transform
                                            .scaleX || 1
                                        }
                                        onChange={(e) =>
                                          updateCharacterProperty(
                                            "scale",
                                            parseFloat(e.target.value),
                                          )
                                        }
                                        className="w-full h-1 bg-white/10 rounded-full accent-cyan-500"
                                      />
                                    </div>

                                    <div className="space-y-1.5">
                                      <div className="flex justify-between items-center">
                                        <span className="text-[9px] font-bold text-gray-500">
                                          {t("ROTATION")}
                                        </span>
                                        <span className="text-[9px] font-mono text-cyan-400">
                                          {Math.round(
                                            character?.[propertyTarget]
                                              ?.transform.rotation || 0,
                                          )}
                                          °
                                        </span>
                                      </div>
                                      <input
                                        type="range"
                                        min="-180"
                                        max="180"
                                        value={
                                          character?.[propertyTarget]?.transform
                                            .rotation || 0
                                        }
                                        onChange={(e) =>
                                          updateCharacterProperty(
                                            "rotation",
                                            parseFloat(e.target.value),
                                          )
                                        }
                                        className="w-full h-1 bg-white/10 rounded-full accent-cyan-500"
                                      />
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                          {activeBottomTab === "FACE" && (
                            <div className="space-y-6">
                              {/* Top Header / Extra Controls If Needed */}
                              
                              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                
                                {/* 1. EXPRESSION PRESETS */}
                                <div className="space-y-3">
                                  <div className="flex items-center gap-2 text-xs font-bold text-gray-300 uppercase tracking-widest">
                                    <Smile size={12} /> {t("EXPRESSION PRESETS")}
                                  </div>
                                  <div className="bg-[#111] p-2 rounded-lg border border-white/5 flex gap-2">
                                    {[
                                      { l: 'NORMAL', v: 0 },
                                      { l: 'ANGRY', v: 1 },
                                      { l: 'SAD', v: 2 },
                                      { l: 'HAPPY', v: 3 },
                                      { l: 'SERIOUS', v: 4 }
                                    ].map(expr => (
                                      <button 
                                          key={expr.v}
                                          onClick={() => activeSceneCharacterId && updateCharacterFilter('exprState', expr.v, activeSceneCharacterId)}
                                          className={`flex-1 p-2 transition-all rounded text-[9px] font-bold uppercase ${characterFilters?.exprState === expr.v ? 'bg-cyan-500/20 shadow-[0_0_10px_rgba(6,182,212,0.5)] border border-cyan-500 text-cyan-400' : 'bg-white/5 hover:bg-cyan-500/20 border border-white/5 text-gray-400 hover:text-white'}`}
                                      >
                                          {t(expr.l)}
                                      </button>
                                    ))}
                                  </div>
                                </div>

                                {/* 2. 2.5D HEAD TURN */}
                                <div className="space-y-3">
                                  <div className="flex items-center gap-2 text-xs font-bold text-gray-300 uppercase tracking-widest">
                                    <LucideIcons.Box size={14} className="text-cyan-500" /> {t("2.5D HEAD TURN")}
                                  </div>
                                  <div className="bg-[#111] p-3 rounded-2xl border border-white/5 grid grid-cols-3 gap-3 shadow-inner">
                                    {[
                                      { l: '2.5D LEFT', v: -1, i: <FaceLeftIcon size={20} className="mx-auto" /> }, 
                                      { l: 'FRONT', v: 0, i: <FaceCenterIcon size={20} className="mx-auto" /> }, 
                                      { l: '2.5D RIGHT', v: 1, i: <FaceRightIcon size={20} className="mx-auto" /> }
                                    ].map(dir => {
                                        const active = characterFilters?.headTurn === dir.v;
                                        return (
                                        <button 
                                            key={dir.v}
                                            title={t(dir.l)}
                                            translate="no"
                                            onClick={() => activeSceneCharacterId && updateCharacterFilter('headTurn', dir.v, activeSceneCharacterId)}
                                            className={`relative group overflow-hidden py-4 flex flex-col items-center justify-center rounded-xl border-b-2 transition-all duration-200 active:translate-y-0.5 active:border-b-0 text-[10px] font-black uppercase tracking-widest gap-1 ${active ? 'bg-gradient-to-b from-cyan-500/30 to-cyan-600/5 border-cyan-500 text-cyan-300 shadow-[inset_0_2px_10px_rgba(6,182,212,0.2),0_4px_15px_rgba(6,182,212,0.25)]' : 'bg-gradient-to-b from-[#1a1a1a] to-[#0f0f0f] border-[#222] text-gray-500 hover:text-white hover:border-[#333] hover:bg-[#222]'}`}
                                        >
                                            <div className={`transition-transform duration-300 ${active ? 'scale-110 drop-shadow-[0_0_5px_rgba(6,182,212,0.8)]' : 'group-hover:scale-110'}`}>{dir.i}</div>
                                            {t(dir.l)}
                                            {active && <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-cyan-500/20 to-transparent pointer-events-none" />}
                                        </button>
                                        );
                                    })}
                                  </div>
                                </div>

                                {/* 3. PUPIL CONTROLS */}
                                <div className="space-y-3">
                                  <div className="flex items-center gap-2 text-[10px] font-black text-gray-400 uppercase tracking-widest">
                                    <Eye size={12} /> {t("PUPIL CONTROLS")}
                                  </div>
                                  <div className="bg-[#111] p-3 rounded-lg border border-white/5 grid grid-cols-3 gap-2 align-middle">
                                    <div />
                                    <button onClick={() => { if (!activeSceneCharacterId) return; updateCharacterFilter('pupilX', 0, activeSceneCharacterId); updateCharacterFilter('pupilY', -30, activeSceneCharacterId); }} className={`py-2 px-1 flex items-center justify-center rounded border transition-all font-black text-[9px] ${characterFilters?.pupilX === 0 && characterFilters?.pupilY === -30 ? 'bg-cyan-500/20 shadow-[0_0_10px_rgba(6,182,212,0.5)] border-cyan-500 text-cyan-400' : 'border-white/5 bg-white/5 hover:bg-cyan-500/20 hover:text-white text-gray-400'}`}>{t("UP")}</button>
                                    <div />
                                    
                                    <button onClick={() => { if (!activeSceneCharacterId) return; updateCharacterFilter('pupilX', -10, activeSceneCharacterId); updateCharacterFilter('pupilY', 0, activeSceneCharacterId); }} className={`py-2 px-1 flex items-center justify-center rounded border transition-all font-black text-[9px] ${characterFilters?.pupilX === -10 && characterFilters?.pupilY === 0 ? 'bg-cyan-500/20 shadow-[0_0_10px_rgba(6,182,212,0.5)] border-cyan-500 text-cyan-400' : 'border-white/5 bg-white/5 hover:bg-cyan-500/20 hover:text-white text-gray-400'}`}>{t("LEFT")}</button>
                                    <button onClick={() => { if (!activeSceneCharacterId) return; updateCharacterFilter('pupilX', 0, activeSceneCharacterId); updateCharacterFilter('pupilY', 0, activeSceneCharacterId); }} className={`py-2 px-1 flex items-center justify-center rounded border transition-all font-black text-[9px] ${characterFilters?.pupilX === 0 && characterFilters?.pupilY === 0 ? 'bg-cyan-500/20 shadow-[0_0_10px_rgba(6,182,212,0.5)] border-cyan-500 text-cyan-400' : 'border-white/5 bg-white/5 hover:bg-cyan-500/20 hover:text-white text-gray-400'}`}>{t("CENTER")}</button>
                                    <button onClick={() => { if (!activeSceneCharacterId) return; updateCharacterFilter('pupilX', 10, activeSceneCharacterId); updateCharacterFilter('pupilY', 0, activeSceneCharacterId); }} className={`py-2 px-1 flex items-center justify-center rounded border transition-all font-black text-[9px] ${characterFilters?.pupilX === 10 && characterFilters?.pupilY === 0 ? 'bg-cyan-500/20 shadow-[0_0_10px_rgba(6,182,212,0.5)] border-cyan-500 text-cyan-400' : 'border-white/5 bg-white/5 hover:bg-cyan-500/20 hover:text-white text-gray-400'}`}>{t("RIGHT")}</button>
                                    
                                    <div />
                                    <button onClick={() => { if (!activeSceneCharacterId) return; updateCharacterFilter('pupilX', 0, activeSceneCharacterId); updateCharacterFilter('pupilY', 35, activeSceneCharacterId); }} className={`py-2 px-1 flex items-center justify-center rounded border transition-all font-black text-[9px] ${characterFilters?.pupilX === 0 && characterFilters?.pupilY === 35 ? 'bg-cyan-500/20 shadow-[0_0_10px_rgba(6,182,212,0.5)] border-cyan-500 text-cyan-400' : 'border-white/5 bg-white/5 hover:bg-cyan-500/20 hover:text-white text-gray-400'}`}>{t("DOWN")}</button>
                                    <div />
                                  </div>
                                </div>

                                {/* 4. MOUTH OVERRIDE */}
                                <div className="space-y-3">
                                  <div className="flex items-center gap-2 text-xs font-bold text-gray-300 uppercase tracking-widest">
                                    <Smile size={12} /> {t("Mouth Override")}
                                  </div>
                                  <div className="bg-[#111] p-3 rounded-lg border border-white/5">
                                    <div className="grid grid-cols-4 gap-2">
                                      {Object.values(VisemeShape).map((shape) => (
                                        <button
                                          key={shape}
                                          onPointerDown={(e) => {
                                            e.preventDefault();
                                            // Note: Ensure `handleVisemeOverride` is defined and passed in the component scope
                                            handleVisemeOverride(shape);
                                          }}
                                          className={`aspect-square rounded border border-white/5 flex items-center justify-center text-[8px] font-black uppercase transition-all ${effectiveViseme.shape === shape ? "bg-cyan-500 text-black shadow-[0_0_10px_cyan]" : "bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white"}`}
                                        >
                                          {shape}
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                </div>
                                
                              </div>
                            </div>
                          )}
                          {activeBottomTab === "KINEMATICS" && (
                            <div className="space-y-6 flex-1 h-full max-h-full overflow-hidden">
                              <KinematicsTab
                                activeSceneCharacterId={activeSceneCharacterId}
                                setActiveSceneCharacterId={setActiveSceneCharacterId}
                                characters={characters}
                                character={character}
                                setCharacter={setCharacter}
                                propertyTarget={propertyTarget}
                                setPropertyTarget={setPropertyTarget}
                                setSelectedPartIds={setSelectedPartIds}
                                setShouldRecordHistory={setShouldRecordHistory}
                                isAnchorMode={isAnchorMode}
                                setIsAnchorMode={setIsAnchorMode}
                                t={t}
                                handleAutoKey={handleAutoKey}
                                autoKeyEnabled={autoKeyEnabled}
                              />
                            </div>
                          )}
                          {activeBottomTab === "TEXT" && renderTextPanel(true)}
                          {renderLoopAndViewPanel()}
                          {activeBottomTab === "ADJUST" && (
                            <AdjustTab
                              activeSceneCharacterId={activeSceneCharacterId}
                              characterFiltersMap={characterFiltersMap}
                              updateCharacterFilter={updateCharacterFilter}
                              t={t}
                              propertyTarget={propertyTarget}
                              character={character}
                            />
                          )}
                          {activeBottomTab === "FX" && (
                            <div className="space-y-6">
                              <div className="space-y-4">
                                <div className="flex items-center justify-between text-[10px] font-black text-gray-400 uppercase tracking-widest">
                                  <div className="flex items-center gap-2">
                                    <Zap size={12} /> {t("LIGHTING")}
                                  </div>
                                  <div className="flex gap-2">
                                    <button
                                      onClick={() => handleAddLight("SUN")}
                                      className="px-2 py-1 bg-amber-500/20 hover:bg-amber-500/40 border border-amber-500/30 rounded text-[9px] text-amber-500 transition-colors flex items-center gap-1"
                                    >
                                      <Sun size={10} /> +SUN
                                    </button>
                                    <button
                                      onClick={() => handleAddLight("BULB")}
                                      className="px-2 py-1 bg-cyan-500/20 hover:bg-cyan-500/40 border border-cyan-500/30 rounded text-[9px] text-cyan-500 transition-colors flex items-center gap-1"
                                    >
                                      <Lightbulb size={10} /> +BULB
                                    </button>
                                  </div>
                                </div>

                                <div className="space-y-4 max-h-[400px] overflow-y-auto custom-scrollbar pr-1">
                                  {lightSources.length === 0 && (
                                    <div className="py-8 text-center border-2 border-dashed border-white/5 rounded-xl">
                                      <p className="text-[9px] font-bold text-gray-600 uppercase tracking-widest">
                                        No Light Sources
                                      </p>
                                    </div>
                                  )}
                                  {lightSources.map((light) => (
                                    <div
                                      key={light.id}
                                      className="bg-black/40 p-3 rounded-xl border border-white/5 space-y-3 group/item"
                                    >
                                      <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                          <div className={`p-1 rounded ${light.type === 'SUN' ? 'bg-amber-500/20 text-amber-500' : 'bg-cyan-500/20 text-cyan-500'}`}>
                                            {light.type === 'SUN' ? <Sun size={12} /> : <Lightbulb size={12} />}
                                          </div>
                                          <span className="text-[9px] font-bold text-gray-300 uppercase tracking-widest">
                                            {light.id}
                                          </span>
                                        </div>
                                        <div className="flex items-center gap-3">
                                          <button
                                            onClick={() => handleRemoveLight(light.id)}
                                            className="opacity-0 group-hover/item:opacity-100 p-1 text-red-500 hover:bg-red-500/10 rounded transition-all"
                                          >
                                            <Trash2 size={12} />
                                          </button>
                                          <input
                                            type="checkbox"
                                            checked={light.isActive}
                                            onChange={() =>
                                              handleLightUpdate(light.id, {
                                                isActive: !light.isActive,
                                              })
                                            }
                                            className="rounded border-white/10 bg-black text-cyan-500 h-3 w-3"
                                          />
                                        </div>
                                      </div>

                                      <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-1.5">
                                          <div className="flex justify-between items-center">
                                            <span className="text-[8px] font-bold text-gray-600 uppercase">
                                              {t("Intensity")}
                                            </span>
                                            <span className="text-[8px] font-mono text-cyan-400">
                                              {(light.intensity * 100).toFixed(0)}%
                                            </span>
                                          </div>
                                          <input
                                            type="range"
                                            min="0"
                                            max="2"
                                            step="0.01"
                                            value={light.intensity}
                                            onChange={(e) =>
                                              handleLightUpdate(light.id, {
                                                intensity: parseFloat(e.target.value),
                                              })
                                            }
                                            className="w-full h-1 bg-white/10 rounded-full accent-cyan-500"
                                          />
                                        </div>
                                        <div className="space-y-1.5">
                                          <div className="flex justify-between items-center">
                                            <span className="text-[8px] font-bold text-gray-600 uppercase">
                                              {t("Radius")}
                                            </span>
                                            <span className="text-[8px] font-mono text-cyan-400">
                                              {Math.round(light.radius || 0)}px
                                            </span>
                                          </div>
                                          <input
                                            type="range"
                                            min="50"
                                            max="1000"
                                            step="10"
                                            value={light.radius || 300}
                                            onChange={(e) =>
                                              handleLightUpdate(light.id, {
                                                radius: parseFloat(e.target.value),
                                              })
                                            }
                                            className="w-full h-1 bg-white/10 rounded-full accent-cyan-500"
                                          />
                                        </div>
                                      </div>

                                      <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-1.5">
                                          <div className="flex justify-between items-center">
                                            <span className="text-[8px] font-bold text-gray-600 uppercase">
                                              {t("X Position")}
                                            </span>
                                            <span className="text-[8px] font-mono text-cyan-400">
                                              {Math.round(light.x)}px
                                            </span>
                                          </div>
                                          <input
                                            type="range"
                                            min="-400"
                                            max="400"
                                            value={light.x}
                                            onChange={(e) =>
                                              handleLightMove(light.id, parseFloat(e.target.value), light.y)
                                            }
                                            className="w-full h-1 bg-white/10 rounded-full accent-cyan-500"
                                          />
                                        </div>
                                        <div className="space-y-1.5">
                                          <div className="flex justify-between items-center">
                                            <span className="text-[8px] font-bold text-gray-600 uppercase">
                                              {t("Y Position")}
                                            </span>
                                            <span className="text-[8px] font-mono text-cyan-400">
                                              {Math.round(light.y)}px
                                            </span>
                                          </div>
                                          <input
                                            type="range"
                                            min="-400"
                                            max="400"
                                            value={light.y}
                                            onChange={(e) =>
                                              handleLightMove(light.id, light.x, parseFloat(e.target.value))
                                            }
                                            className="w-full h-1 bg-white/10 rounded-full accent-cyan-500"
                                          />
                                        </div>
                                      </div>

                                      <div className="flex items-center gap-3">
                                        <span className="text-[8px] font-bold text-gray-600 uppercase">COLOR</span>
                                        <input 
                                          type="color"
                                          value={light.color}
                                          onChange={(e) => handleLightUpdate(light.id, { color: e.target.value })}
                                          className="w-full h-4 bg-transparent border-none rounded overflow-hidden cursor-pointer"
                                        />
                                      </div>
                                    </div>
                                  ))}
                                </div>

                                <div className="space-y-3 pt-2 border-t border-white/5">
                                   <div className="flex justify-between items-center">
                                      <span className="text-[9px] font-bold text-gray-600 uppercase tracking-widest">{t("Ambient Level")}</span>
                                      <span className="text-[9px] font-mono text-amber-500">{(ambientLightLevel * 100).toFixed(0)}%</span>
                                   </div>
                                   <input 
                                     type="range"
                                     min="0"
                                     max="1"
                                     step="0.01"
                                     value={ambientLightLevel}
                                     onChange={(e) => setAmbientLightWithKey(parseFloat(e.target.value))}
                                     className="w-full h-1 bg-white/10 rounded-full accent-amber-500"
                                   />
                                </div>
                              </div>
                            </div>
                          )}
                          {/* Fallback for other tabs if they would be too complex to duplicate */}
                          {activeBottomTab !== "SCENE" &&
                            activeBottomTab !== "CHAR" &&
                            activeBottomTab !== "FACE" &&
                            activeBottomTab !== "FX" &&
                            activeBottomTab !== "ADJUST" &&
                            activeBottomTab !== "TEXT" &&
                            activeBottomTab !== "LIP" &&
                            activeBottomTab !== "KINEMATICS" &&
                            activeBottomTab !== "LOOP" &&
                            activeBottomTab !== "VIEW" &&
                            activeBottomTab !== "SWAP" && (
                              <div className="flex flex-col items-center justify-center py-12 px-6 text-center gap-4 opacity-50 grayscale">
                                <Settings size={48} className="text-gray-700" />
                                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
                                  {activeBottomTab} SETTINGS
                                  <br />
                                  OPEN TIMELINE TO VIEW FULL PANEL
                                </p>
                              </div>
                            )}
                        </div>
                      </div>
                    </div>
                  )}
              </div>

              {/* Timeline & Controls */}
              <div
                className={`${isPresentationMode ? "h-0 min-h-0 overflow-hidden border-t-0" : "h-[28vh] min-h-[200px] portrait:min-h-[200px] landscape:min-h-[140px] landscape:h-[140px] lg:landscape:min-h-[200px] lg:landscape:h-[28vh] border-t border-white/10"} bg-[#080808] flex flex-col shrink-0 relative z-30 ${isPresentationMode ? "pb-0" : "pb-8 lg:pb-2"} shadow-[0_-5px_30px_rgba(0,0,0,0.5)] transition-all duration-300`}
              >
                {!isPresentationMode && <></>}

                {!isPresentationMode && (
                  <>
                    {/* ... (Tab Buttons) ... */}
                    {isTabsVisible && !isPresentationMode && (
                      <div className="h-10 bg-[#111] border-b border-white/5 flex items-center px-2 gap-1 overflow-x-auto no-scrollbar shrink-0">
                        {[
                          { id: "SCENE", label: "SCENE SETUP", icon: Monitor },
                          { id: "TEXT", label: "TEXT", icon: LucideIcons.Type },
                          { id: "FACE", label: "EXPRESSION", icon: Smile },
                          { id: "LIP", label: "LIP SYNC", icon: Mic },
                          { id: "KINEMATICS", label: "KINEMATICS", icon: BoneIcon },
                          { id: "LOOP", label: "LOOPS", icon: LucideIcons.Repeat },
                          { id: "VIEW", label: "VIEWS", icon: LucideIcons.Layers },
                          { id: "SWAP", label: "SWAP", icon: LucideIcons.Layers },
                          { id: "FX", label: "LIGHTING", icon: Zap },
                          { id: "ADJUST", label: "ADJUST", icon: Sliders },
                        ].map((tab) => (
                          <button
                            key={String(tab.id)}
                            onClick={() => {
                              setActiveBottomTab(String(tab.id) as any);
                              if (String(tab.id) === "SCENE")
                                setPropertyTarget("camera");
                              else if (
                                String(tab.id) === "CHAR" &&
                                propertyTarget === "camera"
                              ) {
                                setPropertyTarget("root");
                                setSelectedPartIds(["root"]);
                              }
                            }}
                            className={`flex items-center gap-2 px-4 py-2 rounded-t-lg text-[10px] font-bold tracking-wide transition-all ${String(activeBottomTab) === String(tab.id) ? "bg-[#080808] text-cyan-400 border-t-2 border-cyan-500" : "text-gray-500 hover:text-white hover:bg-white/5"}`}
                          >
                            <tab.icon size={12} /> {tab.label}
                          </button>
                        ))}
                      </div>
                    )}

                    <div className="flex-1 relative overflow-hidden">
                      {/* ... (Timeline) ... */}
                      {activeBottomTab === "TIMELINE" && (
                        <div className="absolute inset-0 flex flex-col animate-in fade-in slide-in-from-bottom-2">
                          <div className="h-10 border-b border-white/5 bg-[#0a0a0a] grid grid-cols-[1fr_auto_1fr] items-center px-4 gap-2">
                            {/* Timeline Tools */}
                            <div className="flex items-center justify-start min-w-0 overflow-x-auto no-scrollbar">
                              <div className="flex items-center gap-2 pr-2">
                                <button
                                  onClick={handleSliceTrigger}
                                  className={`p-1.5 rounded-full shrink-0 transition-colors ${activeTrackId ? "text-purple-400 hover:bg-purple-900/20" : "text-gray-700 cursor-not-allowed"}`}
                                  title={t("Split Audio at Playhead")}
                                >
                                  <Split size={14} />
                                </button>
                                <div className="w-px h-4 bg-white/10 mx-1"></div>
                                <button
                                  onClick={handleCopyKeyframe}
                                  disabled={!selectedKeyframeId}
                                  className={`p-1.5 rounded-full shrink-0 transition-colors ${selectedKeyframeId ? "text-gray-300 hover:text-white hover:bg-white/10" : "text-gray-700 cursor-not-allowed"}`}
                                  title={t("Copy Keyframe")}
                                >
                                  <Copy size={14} />
                                </button>
                                <button
                                  onClick={() =>
                                    handlePasteKeyframe(
                                      playbackState.currentTime,
                                    )
                                  }
                                  disabled={!clipboardKeyframe}
                                  className={`p-1.5 rounded-full shrink-0 transition-colors ${clipboardKeyframe ? "text-cyan-400 hover:bg-cyan-900/20" : "text-gray-700 cursor-not-allowed"}`}
                                  title={t("Paste Keyframe at Playhead")}
                                >
                                  <ClipboardPaste size={14} />
                                </button>
                                <div className="w-px h-4 bg-white/10 mx-1"></div>
                                <button
                                  onClick={() => {
                                    const newState = !autoKeyEnabled;
                                    setAutoKeyEnabled(newState);
                                    showToast(
                                      newState
                                        ? "AUTO-KEYFRAME ACTIVE"
                                        : "AUTO-KEYFRAME DISABLED",
                                    );
                                  }}
                                  className={`p-1.5 rounded-full shrink-0 transition-all ${autoKeyEnabled ? "text-black bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.4)]" : "text-gray-600 border border-white/10 hover:border-white/30"}`}
                                  title={t("Toggle Auto-Keyframe")}
                                >
                                  <KeyIcon size={14} />
                                </button>
                                <div className="w-px h-4 bg-white/10 mx-1"></div>
                                <button
                                  onClick={() =>
                                    handleAddKeyframe(playbackState.currentTime)
                                  }
                                  className={`p-1.5 rounded-full shrink-0 text-amber-500 hover:bg-amber-500/10 transition-colors`}
                                  title={t("Add Keyframe Manually")}
                                >
                                  <Disc size={14} />
                                </button>
                                <button
                                  onClick={() =>
                                    selectedKeyframeId &&
                                    handleRemoveKeyframe(selectedKeyframeId)
                                  }
                                  className={`p-1.5 rounded-full shrink-0 ${selectedKeyframeId ? "text-red-500 hover:bg-red-500/10" : "text-gray-600 cursor-not-allowed"}`}
                                  title={t("Delete Keyframe")}
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            </div>
                            <div className="flex items-center gap-4 justify-center">
                              <button
                                onClick={handleRewind}
                                className="text-gray-400 hover:text-white transition-colors p-2"
                                title={t("Rewind to Start")}
                              >
                                <SkipBack size={14} fill="currentColor" />
                              </button>
                              <button
                                onClick={toggleLoop}
                                className={`p-2 rounded-lg transition-all ${isLooping ? "bg-green-500/20 text-green-400 border border-green-500/30" : "text-gray-500 hover:text-white"}`}
                                title={
                                  isLooping ? "Disable Loop" : "Enable Loop"
                                }
                              >
                                <Repeat
                                  size={14}
                                  className={isLooping ? "stroke-[2.5px]" : ""}
                                />
                              </button>
                              <button
                                onClick={
                                  playbackState.isPlaying
                                    ? engine.pause
                                    : engine.play
                                }
                                className="w-10 h-10 rounded-full bg-cyan-500 hover:bg-cyan-400 text-black flex items-center justify-center shadow-lg shadow-cyan-500/40 transition-transform active:scale-95"
                              >
                                {playbackState.isPlaying ? (
                                  <LucideIcons.Pause
                                    size={16}
                                    fill="currentColor"
                                  />
                                ) : (
                                  <Play
                                    size={16}
                                    fill="currentColor"
                                    className="ml-1"
                                  />
                                )}
                              </button>
                              <button
                                onClick={engine.stop}
                                className="text-gray-400 hover:text-white transition-colors p-2"
                              >
                                <Square size={14} fill="currentColor" />
                              </button>
                            </div>
                            <div className="flex items-center gap-2 justify-end min-w-0 relative">

                              <ZoomOut size={12} className="text-gray-500" />
                              <input
                                type="range"
                                min="1"
                                max="5"
                                step="0.1"
                                value={zoomLevel}
                                onChange={(e) =>
                                  setZoomLevel(parseFloat(e.target.value))
                                }
                                className="w-16 h-1 bg-white/10 rounded-full accent-cyan-500 touch-none"
                              />
                              <ZoomIn size={12} className="text-gray-500" />
                            </div>
                          </div>
                          <div
                            ref={scrollContainerRef}
                            className="flex-1 overflow-x-auto overflow-y-auto custom-scrollbar bg-[#050505] flex flex-col justify-end"
                          >
                            <div
                              className="h-full relative flex flex-col"
                              style={{
                                width: `${zoomLevel * 100}%`,
                                minWidth: "100%",
                              }}
                            >
                              <div className="h-6 border-b border-white/5 bg-[#0a0a0a] relative">
                                <FrameRuler
                                  theme="dark"
                                  duration={safeDuration}
                                  zoomLevel={zoomLevel}
                                  height={24}
                                  selection={selection}
                                  onSelectionChange={(s, e) =>
                                    setSelection({ start: s, end: e })
                                  }
                                  onSeek={(p) => handleSeekWrapper(p)}
                                  isLooping={isLooping}
                                />
                                <div className="absolute inset-0 pointer-events-none">
                                  <KeyframeTimeline
                                    duration={safeDuration}
                                    keyframes={keyframes}
                                    selectedKeyframeId={selectedKeyframeId}
                                    onSelectKeyframe={handleSelectKeyframe}
                                    onAddKeyframe={handleAddKeyframe}
                                    onUpdateKeyframe={handleUpdateKeyframe}
                                    onRemoveKeyframe={handleRemoveKeyframe}
                                    onEditKeyframe={handleEditKeyframe}
                                    zoomLevel={zoomLevel}
                                    theme="dark"
                                    height={24}
                                  />
                                </div>
                              </div>
                              <div
                                className="absolute top-0 bottom-0 w-px bg-red-500 z-[100] shadow-[0_0_10px_rgba(239,68,68,0.8)] pointer-events-none"
                                style={{
                                  left: `${(playbackState.currentTime / safeDuration) * 100}%`,
                                }}
                              >
                                <div className="absolute top-0 -left-1.5 w-3 h-3 bg-red-500 clip-path-polygon-[0%_0%,100%_0%,50%_100%] drop-shadow-sm"></div>
                              </div>
                              <div className="flex-1 flex flex-col relative">
                                <div
                                  className={`flex-1 border-b border-white/5 relative group ${activeTrackId === "vocal" ? "bg-white/5" : ""}`}
                                  onClick={() =>
                                    isEditMode && setActiveTrackId("vocal")
                                  }
                                >
                                  <div className="absolute top-1 left-2 text-[9px] font-bold text-amber-500 z-20 pointer-events-none bg-black/50 px-1 rounded">
                                    {t("VOCAL")}
                                  </div>
                                  {vocalTrack.buffer && (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleClearTrack("vocal");
                                      }}
                                      className="absolute top-1 left-14 z-20 p-0.5 rounded bg-black/50 text-gray-400 hover:text-red-400 border border-white/5 hover:border-red-500/50 transition-colors"
                                      title={t("Delete Waveform")}
                                    >
                                      <Trash2 size={10} />
                                    </button>
                                  )}
                                  <WaveformDisplay
                                    theme="dark"
                                    buffer={vocalTrack.buffer}
                                    duration={safeDuration}
                                    color={COLORS.VOCAL_WAVE}
                                    progress={progress}
                                    onSeek={(p) => {
                                      handleSeekWrapper(p * safeDuration);
                                      if (isEditMode && !selection)
                                        setSelection({
                                          start: 0,
                                          end: safeDuration,
                                        });
                                    }}
                                    onSelect={(s, e) =>
                                      setSelection({ start: s, end: e })
                                    }
                                    selection={selection}
                                    isEditMode={isEditMode}
                                    isActiveTrack={activeTrackId === "vocal"}
                                    height={50}
                                    zoomLevel={zoomLevel}
                                    isLooping={isLooping}
                                  />
                                  {lipSyncKeyframes.length > 0 && (
                                    <div className="absolute top-0 left-0 right-0 h-4 z-10 pointer-events-auto">
                                      <LipSyncTimeline
                                        keyframes={lipSyncKeyframes}
                                        duration={safeDuration}
                                        zoomLevel={zoomLevel}
                                        height={16}
                                        onKeyframeClick={handleLipSyncKeyClick}
                                      />
                                    </div>
                                  )}
                                </div>
                                <div
                                  className={`flex-1 relative group ${activeTrackId === "inst" ? "bg-white/5" : ""}`}
                                  onClick={() =>
                                    isEditMode && setActiveTrackId("inst")
                                  }
                                >
                                  <div className="absolute top-1 left-2 text-[9px] font-bold text-cyan-500 z-20 pointer-events-none bg-black/50 px-1 rounded">
                                    {t("INST")}
                                  </div>
                                  {instTrack.buffer && (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleClearTrack("inst");
                                      }}
                                      className="absolute top-1 left-12 z-20 p-0.5 rounded bg-black/50 text-gray-400 hover:text-red-400 border border-white/5 hover:border-red-500/50 transition-colors"
                                      title={t("Delete Waveform")}
                                    >
                                      <Trash2 size={10} />
                                    </button>
                                  )}
                                  <WaveformDisplay
                                    theme="dark"
                                    buffer={instTrack.buffer}
                                    duration={safeDuration}
                                    color={COLORS.INST_WAVE}
                                    progress={progress}
                                    onSeek={(p) => {
                                      handleSeekWrapper(p * safeDuration);
                                      if (isEditMode && !selection)
                                        setSelection({
                                          start: 0,
                                          end: safeDuration,
                                        });
                                    }}
                                    onSelect={(s, e) =>
                                      setSelection({ start: s, end: e })
                                    }
                                    selection={selection}
                                    isEditMode={isEditMode}
                                    isActiveTrack={activeTrackId === "inst"}
                                    height={50}
                                    zoomLevel={zoomLevel}
                                    isLooping={isLooping}
                                  />
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                      {activeBottomTab !== "TIMELINE" && !isDesktopLike && (
                        <div className="absolute inset-0 overflow-y-auto transform-gpu custom-scrollbar p-0 bg-[#0a0a0a] animate-in fade-in slide-in-from-right-4 flex">
                          {activeBottomTab === "SCENE" && (
                            <div className="w-full h-full p-6">
                              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                <div className="space-y-6">
                                  <div className="space-y-3">
                                    <div className="flex items-center justify-between text-xs font-bold text-gray-300">
                                      <div className="flex items-center gap-2">
                                        <Clock size={12} /> {t("TIMELINE DURATION")}
                                      </div>
                                      <button onClick={() => setCustomTotalDuration(null)} className="text-[10px] bg-white/5 hover:bg-white/10 px-2 py-1 rounded transition-colors text-cyan-400">
                                        {t("AUTO")}
                                      </button>
                                    </div>
                                    <div className="bg-[#111] p-4 rounded-xl border border-white/5 space-y-4">
                                      <div className="flex items-center gap-3">
                                         <div className="flex-1 flex flex-col gap-1.5">
                                             <span className="text-[10px] font-bold text-gray-500 text-center uppercase">HOURS</span>
                                             <input type="number" min="0" value={customTotalDuration !== null ? Math.floor(customTotalDuration / 3600) : Math.floor(safeDuration / 3600)} onChange={e => {
                                                const h = parseInt(e.target.value) || 0;
                                                const m = customTotalDuration !== null ? Math.floor((customTotalDuration % 3600) / 60) : Math.floor((safeDuration % 3600) / 60);
                                                const s = customTotalDuration !== null ? customTotalDuration % 60 : safeDuration % 60;
                                                setCustomTotalDuration((h * 3600) + (m * 60) + s);
                                             }} className="w-full bg-[#080808] border border-white/10 text-center rounded-lg text-sm text-white p-2.5 outline-none font-mono focus:border-cyan-500/50 transition-colors" />
                                         </div>
                                         <span className="text-gray-600 font-bold mt-4 text-lg">:</span>
                                         <div className="flex-1 flex flex-col gap-1.5">
                                             <span className="text-[10px] font-bold text-gray-500 text-center uppercase">MINUTES</span>
                                             <input type="number" min="0" max="59" value={customTotalDuration !== null ? Math.floor((customTotalDuration % 3600) / 60) : Math.floor((safeDuration % 3600) / 60)} onChange={e => {
                                                const h = customTotalDuration !== null ? Math.floor(customTotalDuration / 3600) : Math.floor(safeDuration / 3600);
                                                const m = parseInt(e.target.value) || 0;
                                                const s = customTotalDuration !== null ? customTotalDuration % 60 : safeDuration % 60;
                                                setCustomTotalDuration((h * 3600) + (m * 60) + s);
                                             }} className="w-full bg-[#080808] border border-white/10 text-center rounded-lg text-sm text-white p-2.5 outline-none font-mono focus:border-cyan-500/50 transition-colors" />
                                         </div>
                                         <span className="text-gray-600 font-bold mt-4 text-lg">:</span>
                                         <div className="flex-1 flex flex-col gap-1.5">
                                             <span className="text-[10px] font-bold text-gray-500 text-center uppercase">SECONDS</span>
                                             <input type="number" min="0" max="59" value={customTotalDuration !== null ? Math.floor(customTotalDuration % 60) : Math.floor(safeDuration % 60)} onChange={e => {
                                                const h = customTotalDuration !== null ? Math.floor(customTotalDuration / 3600) : Math.floor(safeDuration / 3600);
                                                const m = customTotalDuration !== null ? Math.floor((customTotalDuration % 3600) / 60) : Math.floor((safeDuration % 3600) / 60);
                                                const s = parseFloat(e.target.value) || 0;
                                                setCustomTotalDuration((h * 3600) + (m * 60) + s);
                                             }} className="w-full bg-[#080808] border border-white/10 text-center rounded-lg text-sm text-white p-2.5 outline-none font-mono focus:border-cyan-500/50 transition-colors" />
                                         </div>
                                      </div>
                                    </div>
                                  </div>

                                  <div className="space-y-3">
                                    <div className="flex items-center gap-2 text-xs font-bold text-gray-300">
                                      <Camera size={12} />{" "}
                                      {t("CAMERA SETTINGS")}
                                    </div>
                                    <div className="space-y-4">
                                      <div className="flex items-center gap-2 bg-[#111] p-2 rounded-lg border border-white/5">
                                        <span className="text-[9px] font-bold text-gray-500 w-16">
                                          {t("X POS")}
                                        </span>
                                        <input
                                          type="range"
                                          min="-2000"
                                          max="2000"
                                          step="1"
                                          value={cameraTransform.x}
                                          onChange={(e) =>
                                            updateCamera({
                                              x: parseFloat(e.target.value),
                                            })
                                          }
                                          onPointerDown={handleInteractionStart}
                                          onPointerUp={handleInteractionEnd}
                                          className="flex-1 h-1 bg-white/10 rounded-full accent-cyan-500 touch-none"
                                        />
                                        <span className="text-[10px] text-white w-8 text-right font-mono">
                                          {Math.round(cameraTransform.x)}
                                        </span>
                                        <button onClick={() => updateCamera({ x: 0 })} className="text-gray-500 hover:text-white">
                                            <RotateCcw size={10} />
                                        </button>
                                      </div>
                                      <div className="flex items-center gap-2 bg-[#111] p-2 rounded-lg border border-white/5">
                                        <span className="text-[9px] font-bold text-gray-500 w-16">
                                          {t("Y POS")}
                                        </span>
                                        <input
                                          type="range"
                                          min="-2000"
                                          max="2000"
                                          step="1"
                                          value={cameraTransform.y}
                                          onChange={(e) =>
                                            updateCamera({
                                              y: parseFloat(e.target.value),
                                            })
                                          }
                                          onPointerDown={handleInteractionStart}
                                          onPointerUp={handleInteractionEnd}
                                          className="flex-1 h-1 bg-white/10 rounded-full accent-cyan-500 touch-none"
                                        />
                                        <span className="text-[10px] text-white w-8 text-right font-mono">
                                          {Math.round(cameraTransform.y)}
                                        </span>
                                        <button onClick={() => updateCamera({ y: 0 })} className="text-gray-500 hover:text-white">
                                            <RotateCcw size={10} />
                                        </button>
                                      </div>
                                      <div className="flex items-center gap-2 bg-[#111] p-2 rounded-lg border border-white/5">
                                        <span className="text-[9px] font-bold text-gray-500 w-16">
                                          {t("CAM ZOOM")}
                                        </span>
                                        <div className="flex items-center gap-1.5 bg-black/30 px-1.5 py-0.5 rounded border border-white/5 text-[8px] text-gray-500">
                                          <span>Limit:</span>
                                          <input
                                            type="number"
                                            min="1"
                                            value={Math.round(maxZoomLimit * 100)}
                                            onChange={(e) => {
                                              let val = parseInt(e.target.value);
                                              if (!isNaN(val) && val > 0) setMaxZoomLimit(val / 100);
                                            }}
                                            className="text-[9px] font-mono text-cyan-500 bg-transparent w-8 text-center outline-none"
                                          />
                                        </div>
                                        <ZoomOut
                                          size={12}
                                          className="text-gray-600"
                                        />
                                        <input
                                          type="range"
                                          min="0.1"
                                          max={maxZoomLimit}
                                          step="0.05"
                                          value={cameraTransform.scale}
                                          onChange={(e) =>
                                            updateCamera({
                                              scale: parseFloat(e.target.value),
                                            })
                                          }
                                          onPointerDown={handleInteractionStart}
                                          onPointerUp={handleInteractionEnd}
                                          className="flex-1 h-1 bg-white/10 rounded-full accent-cyan-500 touch-none"
                                        />
                                        <ZoomIn
                                          size={12}
                                          className="text-gray-600"
                                        />
                                        <div className="flex items-center gap-0 w-12 justify-end">
                                          <input
                                            type="number"
                                            min="10"
                                            step="1"
                                            value={Math.round(cameraTransform.scale * 100)}
                                            onChange={(e) => {
                                                let val = parseFloat(e.target.value);
                                                if (!isNaN(val)) updateCamera({ scale: val / 100 });
                                            }}
                                            className="text-[9px] font-mono text-cyan-500 bg-transparent text-right w-full outline-none border-b border-cyan-500/30 focus:border-cyan-400 pointer-events-auto"
                                          />
                                          <span className="text-[9px] font-mono text-cyan-500">%</span>
                                        </div>
                                      </div>
                                      <div className="flex items-center gap-2 bg-[#111] p-2 rounded-lg border border-white/5">
                                        <span className="text-[9px] font-bold text-gray-500 w-16">
                                          {t("ROTATION")}
                                        </span>
                                        <RotateCcw
                                          size={12}
                                          className="text-gray-600"
                                        />
                                        <input
                                          type="range"
                                          min="-45"
                                          max="45"
                                          value={cameraTransform.rotation}
                                          onChange={(e) =>
                                            updateCamera({
                                              rotation: parseFloat(
                                                e.target.value,
                                              ),
                                            })
                                          }
                                          onPointerDown={handleInteractionStart}
                                          onPointerUp={handleInteractionEnd}
                                          className="flex-1 h-1 bg-white/10 rounded-full accent-cyan-500 touch-none"
                                        />
                                        <RotateCw
                                          size={12}
                                          className="text-gray-600"
                                        />
                                        <div className="flex items-center gap-0 w-12 justify-end">
                                          <input
                                            type="number"
                                            step="1"
                                            value={Math.round(cameraTransform.rotation)}
                                            onChange={(e) => {
                                                let val = parseFloat(e.target.value);
                                                if (!isNaN(val)) updateCamera({ rotation: val });
                                            }}
                                            className="text-[9px] font-mono text-cyan-500 bg-transparent text-right w-full outline-none border-b border-cyan-500/30 focus:border-cyan-400 pointer-events-auto"
                                          />
                                          <span className="text-[9px] font-mono text-cyan-500">°</span>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                </div>

                                <div className="space-y-6">
                                  <div className="space-y-3">
                                    <div className="flex items-center gap-2 text-xs font-bold text-gray-300">
                                      <ImageIcon size={12} />{" "}
                                      {t("BACKGROUND IMAGE")}
                                    </div>
                                    <div className="bg-[#111] rounded-lg border border-white/5 p-3 flex flex-wrap gap-2 min-h-[80px]">
                                      {availableBackgrounds.map((bg, idx) => (
                                        <div key={idx} className={`relative w-16 h-16 rounded overflow-hidden border-2 cursor-pointer transition-all ${backgroundImage.url === bg.url ? 'border-cyan-500 opacity-100' : 'border-transparent opacity-50 hover:opacity-100'}`} onClick={() => { setBackgroundImage(bg); if (autoKeyEnabled) handleAutoKey({ "bg:index": idx }); }}>
                                          <img src={(bg.url as string) || null} className="w-full h-full object-cover" />
                                          <button onClick={(e) => { e.stopPropagation(); setAvailableBackgrounds(prev => prev.filter(p => p.url !== bg.url)); if (backgroundImage.url === bg.url) setBackgroundImage({url: null, width: 0, height: 0}); }} className="absolute top-0 right-0 bg-black/60 p-0.5 rounded-bl hover:bg-red-500 transition-colors">
                                            <X size={10} className="text-white"/>
                                          </button>
                                        </div>
                                      ))}
                                      
                                      <button
                                        onClick={() => bgInputRef.current?.click()}
                                        className="w-16 h-16 rounded border border-dashed border-white/20 flex flex-col items-center justify-center text-gray-500 hover:text-cyan-400 hover:border-cyan-400/50 transition-colors bg-[#050505]"
                                      >
                                        <Upload size={14} className="mb-1" />
                                        <span className="text-[8px] font-bold text-center leading-tight">
                                          {t("ADD BG")}
                                        </span>
                                      </button>
                                    </div>
                                    
                                    {backgroundImage.url && backgroundImage.url !== "null" && (
                                      <div className="flex items-center gap-2 p-1">
                                        <button onClick={() => setBackgroundImage({url: null, width: 0, height: 0})} className="w-full text-[10px] font-bold py-2 bg-red-500/10 text-red-500 rounded hover:bg-red-500/20">CLEAR SELECTED BACKGROUND</button>
                                      </div>
                                    )}
                                    <div className="flex items-center gap-2 bg-[#111] p-3 rounded-lg border border-white/5">
                                      <input
                                        type="checkbox"
                                        id="linkBgCam"
                                        checked={linkBgToCamera}
                                        onChange={(e) => {
                                          setLinkBgToCamera(e.target.checked);
                                          setShouldRecordHistory(true);
                                        }}
                                        className="rounded border-white/10 bg-black text-cyan-500 focus:ring-0"
                                      />
                                      <label
                                        htmlFor="linkBgCam"
                                        className="text-[10px] text-gray-400 cursor-pointer"
                                      >
                                        {t("Link Background to Camera")}
                                      </label>
                                    </div>
                                  </div>

                                  <div className="space-y-3">
                                    <div className="flex items-center gap-2 text-xs font-bold text-gray-300">
                                      <Monitor size={12} />{" "}
                                      {t("BACKGROUND CONTROLS")}
                                    </div>
                                    <div className="space-y-3">
                                      <div className="flex items-center gap-2 bg-[#111] p-2 rounded-lg border border-white/5">
                                        <span className="text-[9px] font-bold text-gray-500 w-16">
                                          {t("BG ZOOM")}
                                        </span>
                                        <ZoomOut
                                          size={12}
                                          className="text-gray-600"
                                        />
                                        <input
                                          type="range"
                                          min="10"
                                          max="300"
                                          value={backgroundTransform.zoom}
                                          onChange={(e) =>
                                            updateBackgroundProperty(
                                              "zoom",
                                              parseFloat(e.target.value),
                                            )
                                          }
                                          onPointerDown={handleInteractionStart}
                                          onPointerUp={handleInteractionEnd}
                                          className="flex-1 h-1 bg-white/10 rounded-full accent-cyan-500 touch-none"
                                        />
                                        <ZoomIn
                                          size={12}
                                          className="text-gray-600"
                                        />
                                        <span className="text-[9px] font-mono text-cyan-500 w-8 text-right">
                                          {backgroundTransform.zoom}%
                                        </span>
                                      </div>
                                      <div className="flex items-center gap-2 bg-[#111] p-2 rounded-lg border border-white/5">
                                        <span className="text-[9px] font-bold text-gray-500 w-16">
                                          {t("BG X")}
                                        </span>
                                        <input
                                          type="range"
                                          min="0"
                                          max="100"
                                          value={backgroundTransform.x}
                                          onChange={(e) =>
                                            updateBackgroundProperty(
                                              "x",
                                              parseFloat(e.target.value),
                                            )
                                          }
                                          onPointerDown={handleInteractionStart}
                                          onPointerUp={handleInteractionEnd}
                                          className="flex-1 h-1 bg-white/10 rounded-full accent-cyan-500 touch-none"
                                        />
                                        <span className="text-[9px] font-mono text-cyan-500 w-8 text-right">
                                          {backgroundTransform.x}%
                                        </span>
                                      </div>
                                      <div className="flex items-center gap-2 bg-[#111] p-2 rounded-lg border border-white/5">
                                        <span className="text-[9px] font-bold text-gray-500 w-16">
                                          {t("BG Y")}
                                        </span>
                                        <input
                                          type="range"
                                          min="0"
                                          max="100"
                                          value={backgroundTransform.y}
                                          onChange={(e) =>
                                            updateBackgroundProperty(
                                              "y",
                                              parseFloat(e.target.value),
                                            )
                                          }
                                          onPointerDown={handleInteractionStart}
                                          onPointerUp={handleInteractionEnd}
                                          className="flex-1 h-1 bg-white/10 rounded-full accent-cyan-500 touch-none"
                                        />
                                        <span className="text-[9px] font-mono text-cyan-500 w-8 text-right">
                                          {backgroundTransform.y}%
                                        </span>
                                      </div>
                                      <div className="flex items-center gap-2 bg-[#111] p-2 rounded-lg border border-white/5">
                                        <span className="text-[9px] font-bold text-gray-500 w-16">
                                          {t("BG BLUR")}
                                        </span>
                                        <CloudFog
                                          size={12}
                                          className="text-gray-600"
                                        />
                                        <input
                                          type="range"
                                          min="0"
                                          max="20"
                                          value={backgroundTransform.blur}
                                          onChange={(e) =>
                                            updateBackgroundProperty(
                                              "blur",
                                              parseFloat(e.target.value),
                                            )
                                          }
                                          onPointerDown={handleInteractionStart}
                                          onPointerUp={handleInteractionEnd}
                                          className="flex-1 h-1 bg-white/10 rounded-full accent-cyan-500 touch-none"
                                        />
                                        <span className="text-[9px] font-mono text-cyan-500 w-8 text-right">
                                          {backgroundTransform.blur}px
                                        </span>
                                      </div>
                                      <div className="flex items-center gap-2 bg-[#111] p-2 rounded-lg border border-white/5">
                                        <span className="text-[9px] font-bold text-gray-500 w-16">
                                          {t("BRIGHT")}
                                        </span>
                                        <input
                                          type="range"
                                          min="0"
                                          max="200"
                                          value={backgroundTransform.brightness}
                                          onChange={(e) =>
                                            updateBackgroundProperty(
                                              "brightness",
                                              parseFloat(e.target.value),
                                            )
                                          }
                                          onPointerDown={handleInteractionStart}
                                          onPointerUp={handleInteractionEnd}
                                          className="flex-1 h-1 bg-white/10 rounded-full accent-cyan-500 touch-none"
                                        />
                                        <span className="text-[9px] font-mono text-cyan-500 w-8 text-right">
                                          {backgroundTransform.brightness}%
                                        </span>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                                
                                <div className="space-y-6">
                                  <div className="space-y-3">
                                    <div className="flex items-center gap-2 text-xs font-bold text-gray-300">
                                      <Palette size={12} />{" "}
                                      {t("STAGE COLORS & DISPLAY")}
                                    </div>
                                    <div className="space-y-2">
                                      <button
                                        ref={colorButtonRef}
                                        onClick={() => {
                                          setActiveLightId(null);
                                          setIsColorPickerOpen(true);
                                        }}
                                        className="w-full h-10 rounded-lg border border-white/10 flex items-center justify-center gap-2 text-[10px] font-bold text-gray-300 hover:bg-white/5 transition-colors"
                                        style={{
                                          backgroundColor: canvasBgColor,
                                        }}
                                      >
                                        <Palette size={12} />
                                        <span className="mix-blend-difference">
                                          {t("CANVAS COLOR")}
                                        </span>
                                      </button>
                                      <div className="grid grid-cols-2 gap-2">
                                        <div className="flex items-center justify-between bg-[#111] p-2 rounded-lg border border-white/10">
                                          <span className="text-[9px] text-gray-400 whitespace-nowrap">
                                            {t("TRANSPARENT")}
                                          </span>
                                          <input
                                            type="checkbox"
                                            checked={isCanvasTransparent}
                                            onChange={(e) => {
                                              setIsCanvasTransparent(
                                                e.target.checked,
                                              );
                                              setShouldRecordHistory(true);
                                            }}
                                            className="rounded border-white/10 bg-black text-cyan-500"
                                          />
                                        </div>
                                        <div className="flex items-center justify-between bg-[#111] p-2 rounded-lg border border-white/10">
                                          <span className="text-[9px] text-gray-400 flex items-center gap-1.5">
                                            <Grid size={10} /> {t("GRID")}
                                          </span>
                                          <input
                                            type="checkbox"
                                            checked={showGrid}
                                            onChange={(e) =>
                                              setShowGrid(e.target.checked)
                                            }
                                            className="rounded border-white/10 bg-black text-cyan-500"
                                          />
                                        </div>
                                      </div>
                                    </div>
                                  </div>

                                  {/* PERFORMANCE TOGGLE - Automatic detection enabled */}

                                  <div className="space-y-3">
                                    <div className="flex items-center gap-2 text-xs font-bold text-gray-300">
                                      <Cpu size={12} /> {t("CUSTOM CSS")}
                                    </div>
                                    <textarea
                                      value={customCSS}
                                      onChange={(e) => {
                                        setCustomCSS(e.target.value);
                                        setShouldRecordHistory(true);
                                      }}
                                      placeholder={t(
                                        "/* Add custom stage CSS... */",
                                      )}
                                      className="w-full h-32 bg-[#111] border border-white/10 rounded-lg p-3 text-[10px] font-mono whitespace-pre text-cyan-500 outline-none focus:border-cyan-500/50"
                                    />
                                  </div>
                                </div>
                              </div>
                            </div>
                          )}
                          {activeBottomTab === "CHAR" && (
                            <div className="w-full h-full p-6 flex flex-col gap-6 overflow-auto">
                              {characters.length > 0 && (
                                <div className="flex items-center gap-4 bg-[#111] p-3 rounded-xl border border-white/5">
                                  <User size={16} className="text-cyan-500" />
                                  <span className="text-xs font-bold text-gray-300">
                                    {t("TARGET CHARACTER:")}
                                  </span>
                                  <select
                                    value={activeSceneCharacterId || ""}
                                    onChange={(e) =>
                                      setActiveSceneCharacterId(e.target.value)
                                    }
                                    className="bg-[#050505] border border-white/10 rounded px-3 py-1.5 text-xs text-white outline-none focus:border-cyan-500"
                                  >
                                    <option value="ALL">
                                      {t("All Characters (Filters Only)")}
                                    </option>
                                    {characters.map((c) => (
                                      <option key={c.id} value={c.id}>
                                        {c.name}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              )}

                              <div
                                className={`grid grid-cols-1 md:grid-cols-3 gap-6 ${activeSceneCharacterId === "ALL" ? "opacity-50 pointer-events-none" : ""}`}
                              >
                                <div className="space-y-3">
                                  <div className="flex items-center justify-between text-xs font-bold text-gray-300">
                                    <div className="flex items-center gap-2">
                                      <MousePointerClick size={12} />{" "}
                                      {t("SELECTION")}
                                    </div>
                                    {selectedPartIds.length > 1 && (
                                      <span className="text-[9px] text-cyan-400 bg-cyan-900/20 px-1.5 rounded">
                                        {selectedPartIds.length} SELECTED
                                      </span>
                                    )}
                                  </div>
                                  <div className="relative z-50">
                                    <button
                                      onClick={() =>
                                        setIsSelectionMenuOpen(
                                          !isSelectionMenuOpen,
                                        )
                                      }
                                      className="w-full flex items-center justify-between bg-[#111] border border-white/10 hover:border-cyan-500/50 rounded-lg px-3 py-2 text-[10px] font-bold text-white transition-colors"
                                    >
                                      <span className="truncate flex-1 text-left">
                                        {selectedPartIds.length > 1
                                          ? `${selectedPartIds.length} Layers Selected`
                                          : character?.[selectedPartIds[0]]
                                              ?.label || "Select Layer"}
                                      </span>
                                      <ChevronDown
                                        size={12}
                                        className={`text-gray-500 transition-transform ${isSelectionMenuOpen ? "rotate-180" : ""}`}
                                      />
                                    </button>
                                    {isSelectionMenuOpen && (
                                      <div className="absolute top-full left-0 right-0 mt-1 bg-[#151515] border border-white/10 rounded-lg shadow-xl overflow-hidden max-h-60 overflow-y-auto custom-scrollbar animate-in zoom-in-95 duration-100">
                                        <div className="p-1 space-y-0.5">
                                          {character &&
                                            getSortedLayerTree(character)
                                              .filter(({ part }) => isLayerInVisibleView(character, part.id))
                                              .map(({ part: p, depth }) => {
                                              const isSelected =
                                                selectedPartIds.includes(p.id);
                                              return (
                                                <div
                                                  key={p.id}
                                                  onClick={() => {
                                                    setPropertyTarget(p.id);
                                                    setSelectedPartIds([p.id]);
                                                    setIsSelectionMenuOpen(
                                                      false,
                                                    );
                                                  }}
                                                  style={{ paddingLeft: `${8 + depth * 12}px` }}
                                                  className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition-colors ${isSelected ? "bg-cyan-500/10" : "hover:bg-white/5"}`}
                                                >
                                                  <div
                                                    onClick={(e) => {
                                                      e.stopPropagation();
                                                      if (isSelected) {
                                                        if (
                                                          selectedPartIds.length >
                                                          1
                                                        ) {
                                                          const newIds =
                                                            selectedPartIds.filter(
                                                              (id) =>
                                                                id !== p.id,
                                                            );
                                                          setSelectedPartIds(
                                                            newIds,
                                                          );
                                                          if (
                                                            propertyTarget ===
                                                            p.id
                                                          )
                                                            setPropertyTarget(
                                                              newIds[0],
                                                            );
                                                        }
                                                      } else {
                                                        setSelectedPartIds([
                                                          ...selectedPartIds,
                                                          p.id,
                                                        ]);
                                                        setPropertyTarget(p.id);
                                                      }
                                                    }}
                                                    className={`w-3 h-3 rounded-sm border flex items-center justify-center ${isSelected ? "border-cyan-500 bg-cyan-500" : "border-gray-600"}`}
                                                  >
                                                    {isSelected && (
                                                      <Check
                                                        size={10}
                                                        className="text-black"
                                                      />
                                                    )}
                                                  </div>
                                                  <span
                                                    className={`text-[10px] font-medium truncate ${isSelected ? "text-cyan-400" : "text-gray-400"}`}
                                                  >
                                                    {depth > 0 ? "└─ " : ""}{p.label}{" "}
                                                    {p.isGroup ? `(${t("Group")})` : ""}
                                                  </span>
                                                </div>
                                              );
                                            })}
                                          <div className="p-2 text-[9px] text-gray-500 italic text-center border-t border-white/5">
                                            {t(
                                              "Click checkbox to multi-select",
                                            )}
                                          </div>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2 text-xs font-bold text-gray-300 mt-6">
                                    <Sliders size={12} /> {t("TRANSFORM")}
                                  </div>
                                  <div className="space-y-4 bg-[#111] p-3 rounded-lg border border-white/5">
                                    <div className="flex justify-between">
                                      <span className="text-[9px] font-bold text-gray-500">
                                        {t("POS X")}
                                      </span>
                                      <input
                                        type="number"
                                        value={
                                          character?.[propertyTarget]?.transform
                                            .x || 0
                                        }
                                        onChange={(e) =>
                                          updateCharacterProperty(
                                            "x",
                                            parseFloat(e.target.value),
                                          )
                                        }
                                        className="w-16 bg-[#050505] border border-white/10 rounded px-1 text-[10px] text-right font-mono text-white"
                                      />
                                    </div>
                                    <RelativeSlider
                                      value={
                                        character?.[propertyTarget]?.transform
                                          .x || 0
                                      }
                                      onChange={(val: number) =>
                                        updateCharacterProperty("x", val)
                                      }
                                      onInteractionStart={
                                        handleInteractionStart
                                      }
                                      onInteractionEnd={handleInteractionEnd}
                                    />
                                    <div className="flex justify-between">
                                      <span className="text-[9px] font-bold text-gray-500">
                                        {t("POS Y")}
                                      </span>
                                      <input
                                        type="number"
                                        value={
                                          character?.[propertyTarget]?.transform
                                            .y || 0
                                        }
                                        onChange={(e) =>
                                          updateCharacterProperty(
                                            "y",
                                            parseFloat(e.target.value),
                                          )
                                        }
                                        className="w-16 bg-[#050505] border border-white/10 rounded px-1 text-[10px] text-right font-mono text-white"
                                      />
                                    </div>
                                    <RelativeSlider
                                      value={
                                        character?.[propertyTarget]?.transform
                                          .y || 0
                                      }
                                      onChange={(val: number) =>
                                        updateCharacterProperty("y", val)
                                      }
                                      onInteractionStart={
                                        handleInteractionStart
                                      }
                                      onInteractionEnd={handleInteractionEnd}
                                    />
                                    <div className="flex justify-between">
                                      <span className="text-[9px] font-bold text-gray-500">
                                        {t("SCALE")}
                                      </span>
                                      <span className="text-[9px] font-mono text-cyan-400">
                                        {(
                                          character?.[propertyTarget]?.transform
                                            .scaleX || 1
                                        ).toFixed(2)}
                                        x
                                      </span>
                                    </div>
                                    <input
                                      type="range"
                                      min="0.1"
                                      max="3"
                                      step="0.05"
                                      value={
                                        character?.[propertyTarget]?.transform
                                          .scaleX || 1
                                      }
                                      onChange={(e) =>
                                        updateCharacterProperty(
                                          "scale",
                                          parseFloat(e.target.value),
                                        )
                                      }
                                      onPointerDown={handleInteractionStart}
                                      onPointerUp={handleInteractionEnd}
                                      className="w-full h-1 bg-white/10 rounded-full accent-cyan-500 touch-none"
                                    />
                                    <div className="flex justify-between">
                                      <span className="text-[9px] font-bold text-gray-500">
                                        {t("ROTATION")}
                                      </span>
                                      <span className="text-[9px] font-mono text-cyan-400">
                                        {(
                                          character?.[propertyTarget]?.transform
                                            .rotation || 0
                                        ).toFixed(0)}
                                        °
                                      </span>
                                    </div>
                                    <input
                                      type="range"
                                      min="-180"
                                      max="180"
                                      value={
                                        character?.[propertyTarget]?.transform
                                          .rotation || 0
                                      }
                                      onChange={(e) =>
                                        updateCharacterProperty(
                                          "rotation",
                                          parseFloat(e.target.value),
                                        )
                                      }
                                      onPointerDown={handleInteractionStart}
                                      onPointerUp={handleInteractionEnd}
                                      className="w-full h-1 bg-white/10 rounded-full accent-cyan-500 touch-none"
                                    />
                                    <div className="flex justify-between">
                                      <span className="text-[9px] font-bold text-gray-500">
                                        {t("OPACITY")}
                                      </span>
                                      <span className="text-[9px] font-mono text-cyan-400">
                                        {Math.round(
                                          (character?.[propertyTarget]
                                            ?.opacity !== undefined
                                            ? character?.[propertyTarget]
                                                ?.opacity!
                                            : 1) * 100,
                                        )}
                                        %
                                      </span>
                                    </div>
                                    <input
                                      type="range"
                                      min="0"
                                      max="1"
                                      step="0.01"
                                      value={
                                        character?.[propertyTarget]?.opacity !==
                                        undefined
                                          ? character?.[propertyTarget]?.opacity
                                          : 1
                                      }
                                      onChange={(e) =>
                                        updateCharacterProperty(
                                          "opacity",
                                          parseFloat(e.target.value),
                                        )
                                      }
                                      onPointerDown={handleInteractionStart}
                                      onPointerUp={handleInteractionEnd}
                                      className="w-full h-1 bg-white/10 rounded-full accent-cyan-500 touch-none"
                                    />

                                    {character &&
                                      character[propertyTarget] &&
                                      (character[propertyTarget].tags.includes(
                                        "Loop",
                                      ) ||
                                        character[propertyTarget].label
                                          .toLowerCase()
                                          .includes("loop")) && (
                                        <>
                                          <div className="flex justify-between mt-2">
                                            <span className="text-[9px] font-bold text-cyan-500">
                                              {t("LOOP SPEED")}
                                            </span>
                                            <span className="text-[9px] font-mono text-cyan-400">
                                              {Math.round(
                                                (character[propertyTarget]
                                                  .loopSpeed !== undefined
                                                  ? character[propertyTarget]
                                                      .loopSpeed!
                                                  : 1) * 100,
                                              )}
                                              %
                                            </span>
                                          </div>
                                          <input
                                            type="range"
                                            min="0.1"
                                            max="5"
                                            step="0.1"
                                            value={
                                              character[propertyTarget]
                                                .loopSpeed !== undefined
                                                ? character[propertyTarget]
                                                    .loopSpeed
                                                : 1
                                            }
                                            onChange={(e) =>
                                              updateCharacterProperty(
                                                "loopSpeed",
                                                parseFloat(e.target.value),
                                              )
                                            }
                                            onPointerDown={
                                              handleInteractionStart
                                            }
                                            onPointerUp={handleInteractionEnd}
                                            className="w-full h-1 bg-cyan-500/30 rounded-full accent-cyan-400 touch-none"
                                          />
                                        </>
                                      )}

                                    <div className="flex items-center gap-4 pt-2 border-t border-white/5">
                                      <div className="flex items-center gap-2">
                                        <input
                                          type="checkbox"
                                          checked={
                                            character?.[propertyTarget]
                                              ?.transform.flipX || false
                                          }
                                          onChange={(e) =>
                                            updateCharacterProperty(
                                              "flipX",
                                              e.target.checked,
                                            )
                                          }
                                          className="rounded border-white/10 bg-[#111] text-cyan-500"
                                        />
                                        <span className="text-[10px] text-gray-400">
                                          {t("Flip Horizontal")}
                                        </span>
                                      </div>
                                      <div className="flex items-center gap-2">
                                        <input
                                          type="checkbox"
                                          checked={
                                            character?.[propertyTarget]
                                              ?.transform.flipY || false
                                          }
                                          onChange={(e) =>
                                            updateCharacterProperty(
                                              "flipY",
                                              e.target.checked,
                                            )
                                          }
                                          className="rounded border-white/10 bg-[#111] text-cyan-500"
                                        />
                                        <span className="text-[10px] text-gray-400">
                                          {t("Flip Vertical")}
                                        </span>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                                <div className="space-y-3">
                                  <div className="flex items-center gap-2 text-xs font-bold text-gray-300">
                                    <Anchor size={12} />{" "}
                                    {t("PIVOT POINT (ANCHOR)")}
                                  </div>
                                  <div className="bg-[#111] p-3 rounded-lg border border-white/5 space-y-4">
                                    <div className="flex items-center justify-between">
                                      <span className="text-[9px] text-gray-500">
                                        {t("ANCHOR MODE")}
                                      </span>
                                      <button
                                        onClick={() =>
                                          setIsAnchorMode(!isAnchorMode)
                                        }
                                        className={`text-[9px] font-bold px-2 py-1 rounded ${isAnchorMode ? "bg-cyan-500 text-black" : "bg-white/5 text-gray-400"}`}
                                      >
                                        {isAnchorMode ? "ON" : "OFF"}
                                      </button>
                                    </div>
                                    <div className="flex justify-between">
                                      <span className="text-[9px] font-bold text-gray-500">
                                        {t("ANCHOR X")}
                                      </span>
                                      <span className="text-[9px] font-mono text-cyan-400">
                                        {(
                                          character?.[propertyTarget]?.transform
                                            .anchorX || 50
                                        ).toFixed(0)}
                                        %
                                      </span>
                                    </div>
                                    <input
                                      type="range"
                                      min="0"
                                      max="100"
                                      value={
                                        character?.[propertyTarget]?.transform
                                          .anchorX || 50
                                      }
                                      onChange={(e) =>
                                        updateCharacterProperty(
                                          "anchorX",
                                          parseFloat(e.target.value),
                                        )
                                      }
                                      onPointerDown={handleInteractionStart}
                                      onPointerUp={handleInteractionEnd}
                                      className="w-full h-1 bg-white/10 rounded-full accent-cyan-500 touch-none"
                                    />
                                    <div className="flex justify-between">
                                      <span className="text-[9px] font-bold text-gray-500">
                                        {t("ANCHOR Y")}
                                      </span>
                                      <span className="text-[9px] font-mono text-cyan-400">
                                        {(
                                          character?.[propertyTarget]?.transform
                                            .anchorY || 50
                                        ).toFixed(0)}
                                        %
                                      </span>
                                    </div>
                                    <input
                                      type="range"
                                      min="0"
                                      max="100"
                                      value={
                                        character?.[propertyTarget]?.transform
                                          .anchorY || 50
                                      }
                                      onChange={(e) =>
                                        updateCharacterProperty(
                                          "anchorY",
                                          parseFloat(e.target.value),
                                        )
                                      }
                                      onPointerDown={handleInteractionStart}
                                      onPointerUp={handleInteractionEnd}
                                      className="w-full h-1 bg-white/10 rounded-full accent-cyan-500 touch-none"
                                    />
                                  </div>
                                </div>
                              </div>

                              <div className="grid grid-cols-1 gap-6 w-full max-w-md">
                                <div className="space-y-3">
                                  <div className="flex items-center gap-2 text-xs font-bold text-gray-300">
                                    <Droplets size={12} />{" "}
                                    {propertyTarget === "root"
                                      ? t("FILTERS (GLOBAL)")
                                      : t("FILTERS (LAYER)")}
                                  </div>
                                  <div className="bg-[#111] p-3 rounded-lg border border-white/5 space-y-4">
                                    <div className="flex justify-between">
                                      <span className="text-[9px] font-bold text-gray-500">
                                        {t("SATURATION")}
                                      </span>
                                      <span className="text-[9px] font-mono text-cyan-400">
                                        {propertyTarget === "root"
                                          ? currentCharacterFilters.saturation
                                          : (character?.[propertyTarget]
                                              ?.filters?.saturation ?? 100)}
                                        %
                                      </span>
                                    </div>
                                    <input
                                      type="range"
                                      min="0"
                                      max="200"
                                      value={
                                        propertyTarget === "root"
                                          ? currentCharacterFilters.saturation
                                          : (character?.[propertyTarget]
                                              ?.filters?.saturation ?? 100)
                                      }
                                      onChange={(e) =>
                                        propertyTarget === "root"
                                          ? updateCharacterFilter(
                                              "saturation",
                                              parseFloat(e.target.value),
                                              activeSceneCharacterId!,
                                            )
                                          : updatePartFilter(
                                              "saturation",
                                              parseFloat(e.target.value),
                                            )
                                      }
                                      onPointerDown={handleInteractionStart}
                                      onPointerUp={handleInteractionEnd}
                                      className="w-full h-1 bg-white/10 rounded-full accent-cyan-500 touch-none"
                                    />
                                    <div className="flex justify-between">
                                      <span className="text-[9px] font-bold text-gray-500">
                                        {t("CONTRAST")}
                                      </span>
                                      <span className="text-[9px] font-mono text-cyan-400">
                                        {propertyTarget === "root"
                                          ? currentCharacterFilters.contrast
                                          : (character?.[propertyTarget]
                                              ?.filters?.contrast ?? 100)}
                                        %
                                      </span>
                                    </div>
                                    <input
                                      type="range"
                                      min="0"
                                      max="200"
                                      value={
                                        propertyTarget === "root"
                                          ? currentCharacterFilters.contrast
                                          : (character?.[propertyTarget]
                                              ?.filters?.contrast ?? 100)
                                      }
                                      onChange={(e) =>
                                        propertyTarget === "root"
                                          ? updateCharacterFilter(
                                              "contrast",
                                              parseFloat(e.target.value),
                                              activeSceneCharacterId!,
                                            )
                                          : updatePartFilter(
                                              "contrast",
                                              parseFloat(e.target.value),
                                            )
                                      }
                                      onPointerDown={handleInteractionStart}
                                      onPointerUp={handleInteractionEnd}
                                      className="w-full h-1 bg-white/10 rounded-full accent-cyan-500 touch-none"
                                    />
                                    <div className="flex justify-between">
                                      <span className="text-[9px] font-bold text-gray-500">
                                        {t("BRIGHTNESS")}
                                      </span>
                                      <span className="text-[9px] font-mono text-cyan-400">
                                        {propertyTarget === "root"
                                          ? currentCharacterFilters.brightness
                                          : (character?.[propertyTarget]
                                              ?.filters?.brightness ?? 100)}
                                        %
                                      </span>
                                    </div>
                                    <input
                                      type="range"
                                      min="0"
                                      max="200"
                                      value={
                                        propertyTarget === "root"
                                          ? currentCharacterFilters.brightness
                                          : (character?.[propertyTarget]
                                              ?.filters?.brightness ?? 100)
                                      }
                                      onChange={(e) =>
                                        propertyTarget === "root"
                                          ? updateCharacterFilter(
                                              "brightness",
                                              parseFloat(e.target.value),
                                              activeSceneCharacterId!,
                                            )
                                          : updatePartFilter(
                                              "brightness",
                                              parseFloat(e.target.value),
                                            )
                                      }
                                      onPointerDown={handleInteractionStart}
                                      onPointerUp={handleInteractionEnd}
                                      className="w-full h-1 bg-white/10 rounded-full accent-cyan-500 touch-none"
                                    />
                                  </div>
                                </div>
                              </div>
                            </div>
                          )}
                          {false && activeBottomTab === ("RIG" as any) && (
                            <div className="w-full h-full p-6 flex flex-col gap-6 overflow-y-auto">
                              {characters.length > 0 && (
                                <div className="flex items-center gap-4 bg-[#111] p-3 rounded-xl border border-white/5">
                                  <BoneIcon
                                    size={16}
                                    className="text-cyan-500"
                                  />
                                  <span className="text-xs font-bold text-gray-300">
                                    {t("TARGET CHARACTER:")}
                                  </span>
                                  <select
                                    value={activeSceneCharacterId || ""}
                                    onChange={(e) =>
                                      setActiveSceneCharacterId(e.target.value)
                                    }
                                    className="bg-[#050505] border border-white/10 rounded px-3 py-1.5 text-xs text-white outline-none focus:border-cyan-500"
                                  >
                                    {characters.map((c) => (
                                      <option key={c.id} value={c.id}>
                                        {c.name}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              )}

                              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                <div className="space-y-6">
                                  <div className="space-y-3">
                                    <div className="flex items-center gap-2 text-xs font-bold text-gray-300">
                                      <Layers size={12} />{" "}
                                      {t("TARGET LAYER (MESH)")}
                                    </div>
                                    <select
                                      value={propertyTarget}
                                      onChange={(e) => {
                                        setPropertyTarget(e.target.value);
                                        setSelectedPartIds([e.target.value]);
                                      }}
                                      className="w-full bg-[#111] border border-white/10 rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-cyan-500"
                                    >
                                      <option value="root">
                                        {t("Select Layer...")}
                                      </option>
                                      {character &&
                                        getSortedLayerTree(character)
                                          .filter(({ part }) => isLayerInVisibleView(character, part.id))
                                          .map(({ part, depth }) => {
                                            const isViewNode = part.tags?.includes("View") || part.label?.toLowerCase()?.includes("view");
                                            const prefix = "\u00A0\u00A0".repeat(depth) + (depth > 0 ? "└─ " : "");
                                            return (
                                              <option key={part.id} value={part.id} className={isViewNode ? "font-bold text-cyan-400 bg-cyan-950/20" : ""}>
                                                {prefix}{part.label}
                                              </option>
                                            );
                                          })}
                                    </select>
                                  </div>

                                  <div className="space-y-3">
                                    <div className="flex items-center gap-2 text-xs font-bold text-gray-300">
                                      <BoneIcon size={12} />{" "}
                                      {t("RIGGING TOOLS")}
                                    </div>
                                    <div className="grid grid-cols-2 gap-2">
                                      <button
                                        onClick={() => setActiveRigTool("BONE")}
                                        className={`flex flex-col items-center justify-center p-3 rounded-lg border transition-all ${activeRigTool === "BONE" ? "bg-cyan-500/20 border-cyan-500 text-cyan-400" : "bg-[#111] border-white/10 text-gray-400 hover:text-white hover:bg-white/5"}`}
                                      >
                                        <BoneIcon size={16} className="mb-1" />
                                        <span className="text-[10px] font-bold">
                                          ADD BONE
                                        </span>
                                      </button>
                                      <button
                                        onClick={() => setActiveRigTool("MOVE")}
                                        className={`flex flex-col items-center justify-center p-3 rounded-lg border transition-all ${activeRigTool === "MOVE" ? "bg-cyan-500/20 border-cyan-500 text-cyan-400" : "bg-[#111] border-white/10 text-gray-400 hover:text-white hover:bg-white/5"}`}
                                      >
                                        <Move size={16} className="mb-1" />
                                        <span className="text-[10px] font-bold">
                                          MOVE BONE
                                        </span>
                                      </button>
                                      <button
                                        onClick={() => setActiveRigTool("HAND")}
                                        className={`flex flex-col items-center justify-center p-3 rounded-lg border transition-all ${activeRigTool === "HAND" ? "bg-cyan-500/20 border-cyan-500 text-cyan-400" : "bg-[#111] border-white/10 text-gray-400 hover:text-white hover:bg-white/5"}`}
                                      >
                                        <LucideIcons.Hand
                                          size={16}
                                          className="mb-1"
                                        />
                                        <span className="text-[10px] font-bold">
                                          IK CHAIN
                                        </span>
                                      </button>
                                      <button
                                        onClick={() =>
                                          setActiveRigTool("DELETE")
                                        }
                                        className={`flex flex-col items-center justify-center p-3 rounded-lg border transition-all ${activeRigTool === "DELETE" ? "bg-red-500/20 border-red-500 text-red-500" : "bg-[#111] border-white/10 text-gray-400 hover:text-white hover:bg-white/5"}`}
                                      >
                                        <Trash2 size={16} className="mb-1" />
                                        <span className="text-[10px] font-bold">
                                          DELETE BONE
                                        </span>
                                      </button>
                                    </div>
                                  </div>

                                  <div className="space-y-3">
                                    <div className="flex items-center gap-2 text-xs font-bold text-gray-300">
                                      <Layers size={12} /> {t("RIG TYPE")}
                                    </div>
                                    <div className="flex gap-2">
                                      <button
                                        onClick={() => setRigType("MESH")}
                                        className={`flex-1 py-1.5 rounded text-[10px] font-bold transition-colors ${rigType === "MESH" ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30" : "bg-[#111] text-gray-500 hover:text-white"}`}
                                      >
                                        MESH RIG
                                      </button>
                                      <button
                                        onClick={() => setRigType("HUMAN")}
                                        className={`flex-1 py-1.5 rounded text-[10px] font-bold transition-colors ${rigType === "HUMAN" ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30" : "bg-[#111] text-gray-500 hover:text-white"}`}
                                      >
                                        HUMAN RIG
                                      </button>
                                    </div>
                                  </div>
                                </div>

                                <div className="space-y-6">
                                  {activeBoneId && (
                                    <div className="space-y-3 bg-[#111] p-4 rounded-xl border border-white/5">
                                      <div className="text-xs font-bold text-cyan-400 flex items-center justify-between">
                                        <span>{t("ACTIVE BONE CONTROLS")}</span>
                                        <span className="text-[10px] text-gray-500">
                                          {activeBoneId}
                                        </span>
                                      </div>
                                      <div className="space-y-4">
                                        <div>
                                          <div className="flex justify-between text-[10px] text-gray-400 mb-1">
                                            <span>{t("Rotation")}</span>
                                            <span>
                                              {Math.round(
                                                currentBoneTransforms[
                                                  `${propertyTarget}|${activeBoneId}`
                                                ]?.rotation || 0,
                                              )}
                                              °
                                            </span>
                                          </div>
                                          <input
                                            type="range"
                                            min="-180"
                                            max="180"
                                            value={
                                              currentBoneTransforms[
                                                `${propertyTarget}|${activeBoneId}`
                                              ]?.rotation || 0
                                            }
                                            onChange={(e) =>
                                              updatePuppetBone(
                                                "rotation",
                                                parseFloat(e.target.value),
                                              )
                                            }
                                            className="w-full accent-cyan-500"
                                          />
                                        </div>
                                        <div>
                                          <div className="flex justify-between text-[10px] text-gray-400 mb-1">
                                            <span>{t("Scale X")}</span>
                                            <span>
                                              {(
                                                (currentBoneTransforms[
                                                  `${propertyTarget}|${activeBoneId}`
                                                ]?.scaleX ?? 1) * 100
                                              ).toFixed(0)}
                                              %
                                            </span>
                                          </div>
                                          <input
                                            type="range"
                                            min="0.1"
                                            max="3"
                                            step="0.05"
                                            value={
                                              currentBoneTransforms[
                                                `${propertyTarget}|${activeBoneId}`
                                              ]?.scaleX ?? 1
                                            }
                                            onChange={(e) =>
                                              updatePuppetBone(
                                                "scaleX",
                                                parseFloat(e.target.value),
                                              )
                                            }
                                            className="w-full accent-cyan-500"
                                          />
                                        </div>
                                        <div>
                                          <div className="flex justify-between text-[10px] text-gray-400 mb-1">
                                            <span>{t("Scale Y")}</span>
                                            <span>
                                              {(
                                                (currentBoneTransforms[
                                                  `${propertyTarget}|${activeBoneId}`
                                                ]?.scaleY ?? 1) * 100
                                              ).toFixed(0)}
                                              %
                                            </span>
                                          </div>
                                          <input
                                            type="range"
                                            min="0.1"
                                            max="3"
                                            step="0.05"
                                            value={
                                              currentBoneTransforms[
                                                `${propertyTarget}|${activeBoneId}`
                                              ]?.scaleY ?? 1
                                            }
                                            onChange={(e) =>
                                              updatePuppetBone(
                                                "scaleY",
                                                parseFloat(e.target.value),
                                              )
                                            }
                                            className="w-full accent-cyan-500"
                                          />
                                        </div>
                                      </div>
                                    </div>
                                  )}
                                  {!activeBoneId && (
                                    <div className="h-full min-h-[100px] flex items-center justify-center border border-dashed border-white/10 rounded-xl">
                                      <span className="text-[10px] font-bold text-gray-500 tracking-widest">
                                        {t("SELECT A BONE TO ANIMATE")}
                                      </span>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          )}
                          {activeBottomTab === "FACE" && (
                            <div className="w-full h-full p-6 flex flex-col gap-6 overflow-y-auto">
                              {characters.length > 0 && (
                                <div className="flex items-center gap-4 bg-[#111] p-3 rounded-xl border border-white/5">
                                  <User size={16} className="text-cyan-500" />
                                  <span className="text-xs font-bold text-gray-300">
                                    {t("EXPRESSION TARGET:")}
                                  </span>
                                  <select
                                    value={activeSceneCharacterId || ""}
                                    onChange={(e) =>
                                      setActiveSceneCharacterId(e.target.value)
                                    }
                                    className="bg-[#050505] border border-white/10 rounded px-3 py-1.5 text-xs text-white outline-none focus:border-cyan-500"
                                  >
                                    <option value="ALL">
                                      {t("All Characters")}
                                    </option>
                                    {characters.map((c) => (
                                      <option key={c.id} value={c.id}>
                                        {c.name}
                                      </option>
                                    ))}
                                  </select>
                                  <div className="ml-auto text-[9px] text-gray-500 italic uppercase font-black">
                                    {t("Manual override applies to target")}
                                  </div>
                                </div>
                              )}
                              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                
                                {/* 1. EXPRESSION PRESETS */}
                                <div className="space-y-3">
                                  <div className="flex items-center gap-2 text-xs font-bold text-gray-300 uppercase tracking-widest">
                                    <Smile size={12} /> {t("EXPRESSION PRESETS")}
                                  </div>
                                  <div className="bg-[#111] p-2 rounded-lg border border-white/5 flex gap-2">
                                    {[
                                      { l: 'NORMAL', v: 0 },
                                      { l: 'ANGRY', v: 1 },
                                      { l: 'SAD', v: 2 },
                                      { l: 'HAPPY', v: 3 },
                                      { l: 'SERIOUS', v: 4 }
                                    ].map(expr => (
                                      <button 
                                          key={expr.v}
                                          onClick={() => activeSceneCharacterId && updateCharacterFilter('exprState', expr.v, activeSceneCharacterId)}
                                          className={`flex-1 p-2 transition-all rounded text-[9px] font-bold uppercase ${characterFilters?.exprState === expr.v ? 'bg-cyan-500/20 shadow-[0_0_10px_rgba(6,182,212,0.5)] border border-cyan-500 text-cyan-400' : 'bg-white/5 hover:bg-cyan-500/20 border border-white/5 text-gray-400 hover:text-white'}`}
                                      >
                                          {t(expr.l)}
                                      </button>
                                    ))}
                                  </div>
                                </div>

                                {/* 2. 2.5D HEAD TURN */}
                                <div className="space-y-3">
                                  <div className="flex items-center gap-2 text-xs font-bold text-gray-300 uppercase tracking-widest">
                                    <LucideIcons.Box size={14} className="text-cyan-500" /> {t("2.5D HEAD TURN")}
                                  </div>
                                  <div className="bg-[#111] p-3 rounded-2xl border border-white/5 grid grid-cols-3 gap-3 shadow-inner">
                                    {[
                                      { l: '2.5D LEFT', v: -1, i: <FaceLeftIcon size={20} className="mx-auto" /> }, 
                                      { l: 'FRONT', v: 0, i: <FaceCenterIcon size={20} className="mx-auto" /> }, 
                                      { l: '2.5D RIGHT', v: 1, i: <FaceRightIcon size={20} className="mx-auto" /> }
                                    ].map(dir => {
                                        const active = characterFilters?.headTurn === dir.v;
                                        return (
                                        <button 
                                            key={dir.v}
                                            title={t(dir.l)}
                                            translate="no"
                                            onClick={() => activeSceneCharacterId && updateCharacterFilter('headTurn', dir.v, activeSceneCharacterId)}
                                            className={`relative group overflow-hidden py-4 flex flex-col items-center justify-center rounded-xl border-b-2 transition-all duration-200 active:translate-y-0.5 active:border-b-0 text-[10px] font-black uppercase tracking-widest gap-1 ${active ? 'bg-gradient-to-b from-cyan-500/30 to-cyan-600/5 border-cyan-500 text-cyan-300 shadow-[inset_0_2px_10px_rgba(6,182,212,0.2),0_4px_15px_rgba(6,182,212,0.25)]' : 'bg-gradient-to-b from-[#1a1a1a] to-[#0f0f0f] border-[#222] text-gray-500 hover:text-white hover:border-[#333] hover:bg-[#222]'}`}
                                        >
                                            <div className={`transition-transform duration-300 ${active ? 'scale-110 drop-shadow-[0_0_5px_rgba(6,182,212,0.8)]' : 'group-hover:scale-110'}`}>{dir.i}</div>
                                            {t(dir.l)}
                                            {active && <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-cyan-500/20 to-transparent pointer-events-none" />}
                                        </button>
                                        );
                                    })}
                                  </div>
                                </div>

                                {/* 3. PUPIL CONTROLS */}
                                <div className="space-y-3">
                                  <div className="flex items-center gap-2 text-[10px] font-black text-gray-400 uppercase tracking-widest">
                                    <Eye size={12} /> {t("PUPIL CONTROLS")}
                                  </div>
                                  <div className="bg-[#111] p-3 rounded-lg border border-white/5 grid grid-cols-3 gap-2 align-middle">
                                    <div />
                                    <button onClick={() => { if (!activeSceneCharacterId) return; updateCharacterFilter('pupilX', 0, activeSceneCharacterId); updateCharacterFilter('pupilY', -30, activeSceneCharacterId); }} className={`py-2 px-1 flex items-center justify-center rounded border transition-all font-black text-[9px] ${characterFilters?.pupilX === 0 && characterFilters?.pupilY === -30 ? 'bg-cyan-500/20 shadow-[0_0_10px_rgba(6,182,212,0.5)] border-cyan-500 text-cyan-400' : 'border-white/5 bg-white/5 hover:bg-cyan-500/20 hover:text-white text-gray-400'}`}>{t("UP")}</button>
                                    <div />
                                    
                                    <button onClick={() => { if (!activeSceneCharacterId) return; updateCharacterFilter('pupilX', -10, activeSceneCharacterId); updateCharacterFilter('pupilY', 0, activeSceneCharacterId); }} className={`py-2 px-1 flex items-center justify-center rounded border transition-all font-black text-[9px] ${characterFilters?.pupilX === -10 && characterFilters?.pupilY === 0 ? 'bg-cyan-500/20 shadow-[0_0_10px_rgba(6,182,212,0.5)] border-cyan-500 text-cyan-400' : 'border-white/5 bg-white/5 hover:bg-cyan-500/20 hover:text-white text-gray-400'}`}>{t("LEFT")}</button>
                                    <button onClick={() => { if (!activeSceneCharacterId) return; updateCharacterFilter('pupilX', 0, activeSceneCharacterId); updateCharacterFilter('pupilY', 0, activeSceneCharacterId); }} className={`py-2 px-1 flex items-center justify-center rounded border transition-all font-black text-[9px] ${characterFilters?.pupilX === 0 && characterFilters?.pupilY === 0 ? 'bg-cyan-500/20 shadow-[0_0_10px_rgba(6,182,212,0.5)] border-cyan-500 text-cyan-400' : 'border-white/5 bg-white/5 hover:bg-cyan-500/20 hover:text-white text-gray-400'}`}>{t("CENTER")}</button>
                                    <button onClick={() => { if (!activeSceneCharacterId) return; updateCharacterFilter('pupilX', 10, activeSceneCharacterId); updateCharacterFilter('pupilY', 0, activeSceneCharacterId); }} className={`py-2 px-1 flex items-center justify-center rounded border transition-all font-black text-[9px] ${characterFilters?.pupilX === 10 && characterFilters?.pupilY === 0 ? 'bg-cyan-500/20 shadow-[0_0_10px_rgba(6,182,212,0.5)] border-cyan-500 text-cyan-400' : 'border-white/5 bg-white/5 hover:bg-cyan-500/20 hover:text-white text-gray-400'}`}>{t("RIGHT")}</button>
                                    
                                    <div />
                                    <button onClick={() => { if (!activeSceneCharacterId) return; updateCharacterFilter('pupilX', 0, activeSceneCharacterId); updateCharacterFilter('pupilY', 35, activeSceneCharacterId); }} className={`py-2 px-1 flex items-center justify-center rounded border transition-all font-black text-[9px] ${characterFilters?.pupilX === 0 && characterFilters?.pupilY === 35 ? 'bg-cyan-500/20 shadow-[0_0_10px_rgba(6,182,212,0.5)] border-cyan-500 text-cyan-400' : 'border-white/5 bg-white/5 hover:bg-cyan-500/20 hover:text-white text-gray-400'}`}>{t("DOWN")}</button>
                                    <div />
                                  </div>
                                </div>

                                {/* 4. MOUTH OVERRIDE */}
                                <div className="space-y-3">
                                  <div className="flex items-center gap-2 text-xs font-bold text-gray-300 uppercase tracking-widest">
                                    <Smile size={12} /> {t("Mouth Override")}
                                  </div>
                                  <div className="bg-[#111] p-3 rounded-lg border border-white/5">
                                    <div className="grid grid-cols-4 gap-2">
                                      {Object.values(VisemeShape).map(
                                        (shape) => (
                                          <button
                                            key={shape}
                                            onPointerDown={(e) => {
                                              e.preventDefault();
                                              handleVisemeOverride(shape);
                                            }}
                                            className={`aspect-square rounded border border-white/5 flex items-center justify-center text-[8px] font-black uppercase transition-all ${effectiveViseme.shape === shape ? "bg-cyan-500 text-black shadow-[0_0_10px_cyan]" : "bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white"}`}
                                          >
                                            {shape}
                                          </button>
                                        ),
                                      )}
                                    </div>
                                  </div>
                                </div>
                                
                              </div>
                            </div>
                          )}
                          {activeBottomTab === "LIP" && (
                            <div className="w-full h-full p-6 flex flex-col gap-6 overflow-y-auto">
                              <div className="flex flex-wrap gap-6 items-start">
                                <div className="flex-1 min-w-[300px] space-y-4">
                                  <div className="flex items-center gap-2 text-xs font-black text-gray-300 uppercase tracking-widest">
                                    <Mic size={14} className="text-cyan-500" />{" "}
                                    {t("Lip Sync Targeting")}
                                  </div>
                                  <div className="bg-[#111] p-5 rounded-2xl border border-white/5 space-y-6">
                                    <div className="space-y-3">
                                      <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest">
                                        {t("Select Control Target")}
                                      </label>
                                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                        <button
                                          onClick={() =>
                                            handleLipSyncTargetChange("ALL")
                                          }
                                          className={`p-3 rounded-xl border text-left transition-all flex items-center gap-3 ${lipSyncTargetId === "ALL" ? "bg-cyan-500/10 border-cyan-500/40 text-cyan-400" : "bg-black/40 border-white/5 text-gray-500 hover:border-white/20"}`}
                                        >
                                          <div
                                            className={`w-3 h-3 rounded-full border-2 ${lipSyncTargetId === "ALL" ? "border-cyan-400 bg-cyan-400 shadow-[0_0_8px_cyan]" : "border-gray-700"}`}
                                          ></div>
                                          <span className="text-[10px] font-black uppercase tracking-widest">
                                            {t("Global (All)")}
                                          </span>
                                        </button>
                                        {characters.map((char) => (
                                          <button
                                            key={char.id}
                                            onClick={() =>
                                              handleLipSyncTargetChange(char.id)
                                            }
                                            className={`p-3 rounded-xl border text-left transition-all flex items-center gap-3 ${lipSyncTargetId === char.id ? "bg-cyan-500/10 border-cyan-500/40 text-cyan-400" : "bg-black/40 border-white/5 text-gray-500 hover:border-white/20"}`}
                                          >
                                            <div
                                              className={`w-3 h-3 rounded-full border-2 ${lipSyncTargetId === char.id ? "border-cyan-400 bg-cyan-400 shadow-[0_0_8px_cyan]" : "border-gray-700"}`}
                                            ></div>
                                            <span className="text-[10px] font-black uppercase tracking-widest truncate">
                                              {char.name}
                                            </span>
                                          </button>
                                        ))}
                                      </div>
                                    </div>

                                    <div className="pt-6 border-t border-white/5 space-y-4">
                                      <div className="flex items-center justify-between">
                                        <div className="flex flex-col">
                                          <span className="text-[11px] font-black text-white uppercase tracking-widest">
                                            {t("Auto Generation")}
                                          </span>
                                          <span className="text-[9px] text-gray-500 font-bold uppercase">
                                            {t("AI-Powered Viseme Mapping")}
                                          </span>
                                        </div>
                                        <button
                                          disabled={!vocalTrack.buffer}
                                          onClick={() =>
                                            setIsLipSyncModalOpen(true)
                                          }
                                          className="px-6 py-2.5 bg-cyan-500 hover:bg-cyan-400 disabled:opacity-30 disabled:grayscale text-black rounded-lg text-[10px] font-black uppercase tracking-[0.2em] transition-all shadow-lg shadow-cyan-500/30 flex items-center gap-2"
                                        >
                                          <Zap size={14} /> {t("Generate Sync")}
                                        </button>
                                      </div>
                                      {!vocalTrack.buffer && (
                                        <p className="text-[9px] text-amber-500/70 font-bold bg-amber-950/20 border border-amber-900/30 p-2 rounded flex items-center gap-2 uppercase tracking-widest">
                                          <AlertCircle size={12} />{" "}
                                          {t(
                                            "Please load a vocal track in the mix rack first",
                                          )}
                                        </p>
                                      )}
                                    </div>
                                  </div>
                                </div>

                                <div className="w-80 space-y-4">
                                  <div className="flex items-center gap-2 text-xs font-black text-gray-300 uppercase tracking-widest">
                                    <ImageIcon
                                      size={14}
                                      className="text-gray-500"
                                    />{" "}
                                    {t("Current Sequence")}
                                  </div>
                                  <div className="bg-[#111] rounded-2xl border border-white/5 overflow-hidden flex flex-col h-[300px]">
                                    <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-2">
                                      {(() => {
                                        const targetKeys = lipSyncKeyframes
                                          .filter((k) =>
                                            lipSyncTargetId === "ALL"
                                              ? k.targetId === undefined
                                              : k.targetId === lipSyncTargetId,
                                          )
                                          .sort((a, b) => a.time - b.time);

                                        if (targetKeys.length === 0) {
                                          return (
                                            <div className="h-full flex flex-col items-center justify-center text-center opacity-30 grayscale p-6 gap-4">
                                              <AudioWaveform
                                                size={40}
                                                className="text-gray-600"
                                              />
                                              <p className="text-[9px] font-black uppercase tracking-widest leading-relaxed">
                                                {t("No tracking data found")}
                                                <br />
                                                {t("for this target")}
                                              </p>
                                            </div>
                                          );
                                        }

                                        return (
                                          <>
                                            {targetKeys
                                              .slice(0, 50)
                                              .map((k) => (
                                                <div
                                                  key={k.id}
                                                  className="flex items-center gap-3 p-2.5 bg-black/40 rounded-xl border border-white/5 group hover:border-cyan-500/30 transition-all"
                                                >
                                                  <div className="text-[9px] font-mono text-cyan-500 w-12">
                                                    {k.time.toFixed(2)}s
                                                  </div>
                                                  <div className="text-[10px] font-black text-gray-300 uppercase tracking-widest flex-1">
                                                    {k.shape}
                                                  </div>
                                                  <button
                                                    onClick={() =>
                                                      setLipSyncKeyframes(
                                                        (prev) =>
                                                          prev.filter(
                                                            (key) =>
                                                              key.id !== k.id,
                                                          ),
                                                      )
                                                    }
                                                    className="p-1 px-2 rounded-md hover:bg-red-500/10 text-gray-600 hover:text-red-400 transition-all opacity-0 group-hover:opacity-100"
                                                  >
                                                    <Trash2 size={12} />
                                                  </button>
                                                </div>
                                              ))}
                                            {targetKeys.length > 50 && (
                                              <div className="py-4 text-center text-[9px] font-bold text-gray-600 uppercase tracking-widest flex items-center justify-center gap-2">
                                                <div className="flex-1 h-px bg-white/5"></div>
                                                {t("+")}{" "}
                                                {targetKeys.length - 50}{" "}
                                                {t("MORE KEYFRAMES")}
                                                <div className="flex-1 h-px bg-white/5"></div>
                                              </div>
                                            )}
                                          </>
                                        );
                                      })()}
                                    </div>
                                    {lipSyncKeyframes.length > 0 && (
                                      <div className="p-3 bg-black/60 border-t border-white/5">
                                        <button
                                          onClick={() =>
                                            setLipSyncKeyframes((prev) =>
                                              prev.filter((k) =>
                                                lipSyncTargetId === "ALL"
                                                  ? k.targetId !== undefined
                                                  : k.targetId !==
                                                    lipSyncTargetId,
                                              ),
                                            )
                                          }
                                          className="w-full py-2 text-[9px] font-bold text-red-500/70 hover:text-red-400 transition-colors uppercase tracking-widest"
                                        >
                                          {t("Clear Target Sequence")}
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          )}
                          {activeBottomTab === "KINEMATICS" && (
                            <div className="w-full h-full flex flex-col overflow-hidden">
                              <KinematicsTab
                                activeSceneCharacterId={activeSceneCharacterId}
                                setActiveSceneCharacterId={setActiveSceneCharacterId}
                                characters={characters}
                                character={character}
                                setCharacter={setCharacter}
                                propertyTarget={propertyTarget}
                                setPropertyTarget={setPropertyTarget}
                                setSelectedPartIds={setSelectedPartIds}
                                setShouldRecordHistory={setShouldRecordHistory}
                                isAnchorMode={isAnchorMode}
                                setIsAnchorMode={setIsAnchorMode}
                                t={t}
                                handleAutoKey={handleAutoKey}
                                autoKeyEnabled={autoKeyEnabled}
                                handleSaveToStorage={handleSaveToStorage}
                              />
                            </div>
                          )}
                          {renderLoopAndViewPanel()}
                          {activeBottomTab === "ADJUST" && (
                            <div className="w-full h-full flex flex-col">
                                <AdjustTab
                                  activeSceneCharacterId={activeSceneCharacterId}
                                  characterFiltersMap={characterFiltersMap}
                                  updateCharacterFilter={updateCharacterFilter}
                                  t={t}
                                  propertyTarget={propertyTarget}
                                  character={character}
                                />
                            </div>
                          )}
                          {activeBottomTab === "FX" && (
                            <div className="w-full h-full flex flex-col">
                              <div className="h-10 border-b border-white/5 flex items-center px-4 bg-[#0a0a0a] gap-4 shrink-0">
                                <button
                                  onClick={() => setActiveFxTab("SUN")}
                                  className={`text-[10px] font-bold flex items-center gap-2 px-2 py-1 rounded transition-colors ${activeFxTab === "SUN" ? "bg-amber-500/10 text-amber-500" : "text-gray-500 hover:text-white"}`}
                                >
                                  <Sun size={14} /> {t("GLOBAL SUN")}
                                </button>
                                <button
                                  onClick={() => setActiveFxTab("BULB")}
                                  className={`text-[10px] font-bold flex items-center gap-2 px-2 py-1 rounded transition-colors ${activeFxTab === "BULB" ? "bg-cyan-500/10 text-cyan-500" : "text-gray-500 hover:text-white"}`}
                                >
                                  <Lightbulb size={14} /> {t("POINT LIGHTS")}
                                </button>
                                <button
                                  onClick={() => setActiveFxTab("LIGHTNING")}
                                  className={`text-[10px] font-bold flex items-center gap-2 px-2 py-1 rounded transition-colors ${activeFxTab === "LIGHTNING" ? "bg-purple-500/10 text-purple-500" : "text-gray-500 hover:text-white"}`}
                                >
                                  <Zap size={14} /> {t("VFX")}
                                </button>
                                <div className="w-px h-4 bg-white/10 mx-2"></div>
                                <button
                                  onClick={() => setActiveFxTab("SETTINGS")}
                                  className={`text-[10px] font-bold flex items-center gap-2 px-2 py-1 rounded transition-colors ${activeFxTab === "SETTINGS" ? "bg-white/10 text-white" : "text-gray-500 hover:text-white"}`}
                                >
                                  <Sliders size={14} /> {t("AMBIENT")}
                                </button>
                              </div>
                              <div className="flex-1 p-6 overflow-y-auto custom-scrollbar">
                                <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                  {activeFxTab === "SUN" && (
                                    <>
                                      <div className="col-span-1 md:col-span-2 lg:col-span-3 grid grid-cols-3 gap-4 mb-4">
                                        <button
                                          onClick={() =>
                                            handleSunPreset("MORNING")
                                          }
                                          className="bg-[#111] hover:bg-[#161616] border border-white/5 rounded-xl p-4 flex flex-col items-center gap-2 group transition-all"
                                        >
                                          <Sunrise
                                            size={24}
                                            className="text-amber-300 group-hover:scale-110 transition-transform"
                                          />
                                          <span className="text-[10px] font-bold text-gray-400">
                                            {t("MORNING")}
                                          </span>
                                        </button>
                                        <button
                                          onClick={() =>
                                            handleSunPreset("NOON")
                                          }
                                          className="bg-[#111] hover:bg-[#161616] border border-white/5 rounded-xl p-4 flex flex-col items-center gap-2 group transition-all"
                                        >
                                          <Sun
                                            size={24}
                                            className="text-amber-500 group-hover:scale-110 transition-transform"
                                          />
                                          <span className="text-[10px] font-bold text-gray-400">
                                            {t("NOON")}
                                          </span>
                                        </button>
                                        <button
                                          onClick={() =>
                                            handleSunPreset("EVENING")
                                          }
                                          className="bg-[#111] hover:bg-[#161616] border border-white/5 rounded-xl p-4 flex flex-col items-center gap-2 group transition-all"
                                        >
                                          <Sunset
                                            size={24}
                                            className="text-orange-500 group-hover:scale-110 transition-transform"
                                          />
                                          <span className="text-[10px] font-bold text-gray-400">
                                            {t("EVENING")}
                                          </span>
                                        </button>
                                      </div>
                                      {lightSources
                                        .filter((l) => l.type === "SUN")
                                        .map((l) => (
                                          <div
                                            key={l.id}
                                            className="bg-[#111] p-4 rounded-xl border border-white/5 space-y-4 animate-in fade-in"
                                          >
                                            <div className="flex justify-between items-center pb-2 border-b border-white/5">
                                              <div className="flex items-center gap-2">
                                                <Sun
                                                  size={14}
                                                  className="text-amber-500"
                                                />
                                                <span className="text-xs font-bold text-gray-200">
                                                  {t("SUN PROPERTIES")}
                                                </span>
                                              </div>
                                              <input
                                                type="checkbox"
                                                checked={l.isActive}
                                                onChange={(e) => {
                                                  handleLightUpdate(l.id, {
                                                    isActive: e.target.checked,
                                                  });
                                                  setShouldRecordHistory(true);
                                                }}
                                                className="rounded border-white/10 bg-[#050505] text-amber-500"
                                              />
                                            </div>
                                            <div className="space-y-3">
                                              <div className="flex justify-between">
                                                <span className="text-[9px] font-bold text-gray-500">
                                                  {t("INTENSITY")}
                                                </span>
                                                <span className="text-[9px] font-mono text-amber-500">
                                                  {l.intensity.toFixed(2)}
                                                </span>
                                              </div>
                                              <input
                                                type="range"
                                                min="0"
                                                max="2"
                                                step="0.1"
                                                value={l.intensity}
                                                onChange={(e) =>
                                                  handleLightUpdate(l.id, {
                                                    intensity: parseFloat(
                                                      e.target.value,
                                                    ),
                                                  })
                                                }
                                                onPointerDown={
                                                  handleInteractionStart
                                                }
                                                onPointerUp={
                                                  handleInteractionEnd
                                                }
                                                className="w-full h-1 bg-white/10 rounded-full accent-amber-500 touch-none"
                                              />
                                              <div className="flex justify-between">
                                                <span className="text-[9px] font-bold text-gray-500">
                                                  {t("COLOR TEMP")}
                                                </span>
                                                <div
                                                  className="w-4 h-4 rounded border border-white/10"
                                                  style={{
                                                    backgroundColor: l.color,
                                                  }}
                                                ></div>
                                              </div>
                                              <button
                                                onClick={() => {
                                                  setActiveLightId(l.id);
                                                  setIsColorPickerOpen(true);
                                                }}
                                                className="w-full h-6 rounded border border-white/10 flex items-center justify-center gap-2 text-[10px] font-bold text-gray-300 hover:bg-white/5 transition-colors"
                                                style={{
                                                  backgroundColor: l.color,
                                                }}
                                              >
                                                <Palette size={12} />
                                              </button>
                                              <div className="flex justify-between">
                                                <span className="text-[9px] font-bold text-gray-500">
                                                  {t("SHADOW SOFTNESS")}
                                                </span>
                                                <span className="text-[9px] font-mono text-amber-500">
                                                  {l.softness}px
                                                </span>
                                              </div>
                                              <input
                                                type="range"
                                                min="0"
                                                max="20"
                                                value={l.softness}
                                                onChange={(e) =>
                                                  handleLightUpdate(l.id, {
                                                    softness: parseFloat(
                                                      e.target.value,
                                                    ),
                                                  })
                                                }
                                                onPointerDown={
                                                  handleInteractionStart
                                                }
                                                onPointerUp={
                                                  handleInteractionEnd
                                                }
                                                className="w-full h-1 bg-white/10 rounded-full accent-amber-500 touch-none"
                                              />
                                              <div className="space-y-3 pt-3 border-t border-white/5">
                                                <div className="flex items-center gap-2">
                                                  <input type="checkbox" id={`rb_${l.id}`} checked={!!l.renderBehind} 
                                                    onChange={(e) => handleLightUpdate(l.id, { renderBehind: e.target.checked })}
                                                    className="rounded border-white/10 bg-[#050505] text-cyan-500" />
                                                  <label htmlFor={`rb_${l.id}`} className="text-[10px] font-bold text-gray-400 cursor-pointer uppercase">{t("Render Behind Character")}</label>
                                                </div>
                                                {l.renderBehind && (
                                                  <div className="space-y-2 pl-6">
                                                    <label className="text-[9px] font-bold text-gray-500 uppercase">{t("Target Character")}</label>
                                                    <select value={l.targetCharacterId || ''} onChange={(e) => handleLightUpdate(l.id, { targetCharacterId: e.target.value })}
                                                      className="w-full bg-[#050505] border border-white/10 rounded px-2 py-1 text-[10px] text-white">
                                                      <option value="">{t("Any (All Characters)")}</option>
                                                      {characters.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                                    </select>
                                                    {(l.targetCharacterId && l.targetCharacterId !== "") && (
                                                      <div className="space-y-2 mt-2">
                                                        <label className="text-[9px] font-bold text-gray-500 uppercase">{t("Target Layer / Part")}</label>
                                                        <select value={l.targetPartIds?.[0] || 'root'} onChange={(e) => handleLightUpdate(l.id, { targetPartIds: [e.target.value] })}
                                                          className="w-full bg-[#050505] border border-white/10 rounded px-2 py-1 text-[10px] text-white">
                                                          <option value="root">{t("Entire Character")}</option>
                                                          {Object.values(characters.find(c => c.id === l.targetCharacterId)?.composition || {}).map((p: any) => (
                                                            <option key={p.id} value={p.id}>{p.label || p.id}</option>
                                                          ))}
                                                        </select>
                                                      </div>
                                                    )}
                                                  </div>
                                                )}
                                              </div>
                                            </div>
                                          </div>
                                        ))}
                                    </>
                                  )}
                                  {activeFxTab === "BULB" && (
                                    <>
                                      <div className="col-span-1 md:col-span-2 lg:col-span-3 mb-4">
                                        <button
                                          onClick={() => {
                                            setLightSources((prev) => [
                                              ...prev,
                                              {
                                                id: `light_${Date.now()}`,
                                                type: "BULB",
                                                x: 50,
                                                y: 50,
                                                intensity: 1,
                                                color: "#ffffff",
                                                softness: 10,
                                                radius: 200,
                                                isActive: true,
                                              },
                                            ]);
                                            setShouldRecordHistory(true);
                                          }}
                                          className="w-full bg-[#111] hover:bg-[#161616] border border-white/5 rounded-xl p-4 flex items-center justify-center gap-2 group transition-all text-cyan-500"
                                        >
                                          <PlusCircle
                                            size={16}
                                            className="group-hover:scale-110 transition-transform"
                                          />
                                          <span className="text-[10px] font-bold">
                                            {t("ADD POINT LIGHT")}
                                          </span>
                                        </button>
                                      </div>
                                      {lightSources
                                        .filter((l) => l.type === "BULB")
                                        .map((l) => (
                                          <div
                                            key={l.id}
                                            className="bg-[#111] p-4 rounded-xl border border-white/5 space-y-4 animate-in fade-in"
                                          >
                                            <div className="flex justify-between items-center pb-2 border-b border-white/5">
                                              <div className="flex items-center gap-2">
                                                <Lightbulb
                                                  size={14}
                                                  className="text-cyan-500"
                                                />
                                                <span className="text-xs font-bold text-gray-200">
                                                  {t("POINT LIGHT")}
                                                </span>
                                              </div>
                                              <div className="flex items-center gap-2">
                                                <input
                                                  type="checkbox"
                                                  checked={l.isActive}
                                                  onChange={(e) => {
                                                    handleLightUpdate(l.id, {
                                                      isActive:
                                                        e.target.checked,
                                                    });
                                                    setShouldRecordHistory(
                                                      true,
                                                    );
                                                  }}
                                                  className="rounded border-white/10 bg-[#050505] text-cyan-500"
                                                />
                                                <button
                                                  onClick={() => {
                                                    setLightSources((prev) =>
                                                      prev.filter(
                                                        (light) =>
                                                          light.id !== l.id,
                                                      ),
                                                    );
                                                    setShouldRecordHistory(
                                                      true,
                                                    );
                                                  }}
                                                  className="text-gray-500 hover:text-red-500"
                                                >
                                                  <Trash2 size={14} />
                                                </button>
                                              </div>
                                            </div>
                                            <div className="space-y-3">
                                              <div className="flex justify-between">
                                                <span className="text-[9px] font-bold text-gray-500">
                                                  {t("INTENSITY")}
                                                </span>
                                                <span className="text-[9px] font-mono text-cyan-500">
                                                  {l.intensity.toFixed(2)}
                                                </span>
                                              </div>
                                              <input
                                                type="range"
                                                min="0"
                                                max="3"
                                                step="0.1"
                                                value={l.intensity}
                                                onChange={(e) =>
                                                  handleLightUpdate(l.id, {
                                                    intensity: parseFloat(
                                                      e.target.value,
                                                    ),
                                                  })
                                                }
                                                onPointerDown={
                                                  handleInteractionStart
                                                }
                                                onPointerUp={
                                                  handleInteractionEnd
                                                }
                                                className="w-full h-1 bg-white/10 rounded-full accent-cyan-500 touch-none"
                                              />
                                              <div className="flex justify-between">
                                                <span className="text-[9px] font-bold text-gray-500">
                                                  {t("RADIUS")}
                                                </span>
                                                <span className="text-[9px] font-mono text-cyan-500">
                                                  {l.radius}px
                                                </span>
                                              </div>
                                              <input
                                                type="range"
                                                min="50"
                                                max="1000"
                                                value={l.radius}
                                                onChange={(e) =>
                                                  handleLightUpdate(l.id, {
                                                    radius: parseFloat(
                                                      e.target.value,
                                                    ),
                                                  })
                                                }
                                                onPointerDown={
                                                  handleInteractionStart
                                                }
                                                onPointerUp={
                                                  handleInteractionEnd
                                                }
                                                className="w-full h-1 bg-white/10 rounded-full accent-cyan-500 touch-none"
                                              />
                                              <div className="flex justify-between">
                                                <span className="text-[9px] font-bold text-gray-500">
                                                  {t("COLOR")}
                                                </span>
                                                <div
                                                  className="w-4 h-4 rounded border border-white/10"
                                                  style={{
                                                    backgroundColor: l.color,
                                                  }}
                                                ></div>
                                              </div>
                                              <button
                                                onClick={() => {
                                                  setActiveLightId(l.id);
                                                  setIsColorPickerOpen(true);
                                                }}
                                                className="w-full h-6 rounded border border-white/10 flex items-center justify-center gap-2 text-[10px] font-bold text-gray-300 hover:bg-white/5 transition-colors"
                                                style={{
                                                  backgroundColor: l.color,
                                                }}
                                              >
                                                <Palette size={12} />
                                              </button>
                                              <div className="space-y-3 pt-3 border-t border-white/5">
                                                <div className="flex items-center gap-2">
                                                  <input type="checkbox" id={`blink_${l.id}`} checked={!!l.isBlinking} 
                                                    onChange={(e) => handleLightUpdate(l.id, { isBlinking: e.target.checked, blinkSpeed: e.target.checked ? (l.blinkSpeed || 0.5) : l.blinkSpeed })}
                                                    className="rounded border-white/10 bg-[#050505] text-cyan-500" />
                                                  <label htmlFor={`blink_${l.id}`} className="text-[10px] font-bold text-gray-400 cursor-pointer uppercase">{t("Loop Blink (Disco Light)")}</label>
                                                </div>
                                                {l.isBlinking && (
                                                  <div className="space-y-2 pl-6">
                                                    <div className="flex justify-between">
                                                      <span className="text-[9px] font-bold text-gray-500">
                                                        {t("BLINK SPEED")}
                                                      </span>
                                                    </div>
                                                    <input
                                                      type="range"
                                                      min="0.1"
                                                      max="1.5"
                                                      step="0.05"
                                                      value={l.blinkSpeed || 0.5}
                                                      onChange={(e) =>
                                                        handleLightUpdate(l.id, {
                                                          blinkSpeed: parseFloat(e.target.value),
                                                        })
                                                      }
                                                      onPointerDown={handleInteractionStart}
                                                      onPointerUp={handleInteractionEnd}
                                                      className="w-full h-1 bg-white/10 rounded-full accent-cyan-500 touch-none"
                                                    />
                                                  </div>
                                                )}
                                              </div>
                                              <div className="space-y-3 pt-3 border-t border-white/5">
                                                <div className="flex items-center gap-2">
                                                  <input type="checkbox" id={`rb_${l.id}`} checked={!!l.renderBehind} 
                                                    onChange={(e) => handleLightUpdate(l.id, { renderBehind: e.target.checked })}
                                                    className="rounded border-white/10 bg-[#050505] text-cyan-500" />
                                                  <label htmlFor={`rb_${l.id}`} className="text-[10px] font-bold text-gray-400 cursor-pointer uppercase">{t("Render Behind Character")}</label>
                                                </div>
                                                {l.renderBehind && (
                                                  <div className="space-y-2 pl-6">
                                                    <label className="text-[9px] font-bold text-gray-500 uppercase">{t("Target Character")}</label>
                                                    <select value={l.targetCharacterId || ''} onChange={(e) => handleLightUpdate(l.id, { targetCharacterId: e.target.value })}
                                                      className="w-full bg-[#050505] border border-white/10 rounded px-2 py-1 text-[10px] text-white">
                                                      <option value="">{t("Any (All Characters)")}</option>
                                                      {characters.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                                    </select>
                                                    {(l.targetCharacterId && l.targetCharacterId !== "") && (
                                                      <div className="space-y-2 mt-2">
                                                        <label className="text-[9px] font-bold text-gray-500 uppercase">{t("Target Layer / Part")}</label>
                                                        <select value={l.targetPartIds?.[0] || 'root'} onChange={(e) => handleLightUpdate(l.id, { targetPartIds: [e.target.value] })}
                                                          className="w-full bg-[#050505] border border-white/10 rounded px-2 py-1 text-[10px] text-white">
                                                          <option value="root">{t("Entire Character")}</option>
                                                          {Object.values(characters.find(c => c.id === l.targetCharacterId)?.composition || {}).map((p: any) => (
                                                            <option key={p.id} value={p.id}>{p.label || p.id}</option>
                                                          ))}
                                                        </select>
                                                      </div>
                                                    )}
                                                  </div>
                                                )}
                                              </div>
                                            </div>
                                          </div>
                                        ))}
                                    </>
                                  )}
                                  {activeFxTab === "LIGHTNING" && (
                                    <>
                                      <div className="col-span-1 md:col-span-2 lg:col-span-3 mb-4">
                                        <button
                                          onClick={() => {
                                            setLightSources((prev) => [
                                              ...prev,
                                              {
                                                id: `light_${Date.now()}`,
                                                type: "LIGHTNING",
                                                x: 50,
                                                y: 50,
                                                intensity: 1,
                                                color: "#ffffff",
                                                softness: 0,
                                                radius: 0,
                                                isActive: true,
                                              },
                                            ]);
                                            setShouldRecordHistory(true);
                                          }}
                                          className="w-full bg-[#111] hover:bg-[#161616] border border-white/5 rounded-xl p-4 flex items-center justify-center gap-2 group transition-all text-purple-500"
                                        >
                                          <PlusCircle
                                            size={16}
                                            className="group-hover:scale-110 transition-transform"
                                          />
                                          <span className="text-[10px] font-bold">
                                            {t("ADD LIGHTNING EFFECT")}
                                          </span>
                                        </button>
                                      </div>
                                      {lightSources
                                        .filter((l) => l.type === "LIGHTNING")
                                        .map((l) => (
                                          <div
                                            key={l.id}
                                            className="bg-[#111] p-4 rounded-xl border border-white/5 space-y-4 animate-in fade-in"
                                          >
                                            <div className="flex justify-between items-center pb-2 border-b border-white/5">
                                              <div className="flex items-center gap-2">
                                                <Zap
                                                  size={14}
                                                  className="text-purple-500"
                                                />
                                                <span className="text-xs font-bold text-gray-200">
                                                  {t("LIGHTNING")}
                                                </span>
                                              </div>
                                              <div className="flex items-center gap-2">
                                                <input
                                                  type="checkbox"
                                                  checked={l.isActive}
                                                  onChange={(e) => {
                                                    handleLightUpdate(l.id, {
                                                      isActive:
                                                        e.target.checked,
                                                    });
                                                    setShouldRecordHistory(
                                                      true,
                                                    );
                                                  }}
                                                  className="rounded border-white/10 bg-[#050505] text-purple-500"
                                                />
                                                <button
                                                  onClick={() => {
                                                    setLightSources((prev) =>
                                                      prev.filter(
                                                        (light) =>
                                                          light.id !== l.id,
                                                      ),
                                                    );
                                                    setShouldRecordHistory(
                                                      true,
                                                    );
                                                  }}
                                                  className="text-gray-500 hover:text-red-500"
                                                >
                                                  <Trash2 size={14} />
                                                </button>
                                              </div>
                                            </div>
                                            <div className="space-y-3">
                                              <div className="flex justify-between">
                                                <span className="text-[9px] font-bold text-gray-500">
                                                  {t("FLASH INTENSITY")}
                                                </span>
                                                <span className="text-[9px] font-mono text-purple-500">
                                                  {l.intensity.toFixed(2)}
                                                </span>
                                              </div>
                                              <input
                                                type="range"
                                                min="0"
                                                max="1"
                                                step="0.05"
                                                value={l.intensity}
                                                onChange={(e) =>
                                                  handleLightUpdate(l.id, {
                                                    intensity: parseFloat(
                                                      e.target.value,
                                                    ),
                                                  })
                                                }
                                                onPointerDown={
                                                  handleInteractionStart
                                                }
                                                onPointerUp={
                                                  handleInteractionEnd
                                                }
                                                className="w-full h-1 bg-white/10 rounded-full accent-purple-500 touch-none"
                                              />
                                              <div className="flex justify-between">
                                                <span className="text-[9px] font-bold text-gray-500">
                                                  {t("COLOR")}
                                                </span>
                                                <div
                                                  className="w-4 h-4 rounded border border-white/10"
                                                  style={{
                                                    backgroundColor: l.color,
                                                  }}
                                                ></div>
                                              </div>
                                              <button
                                                onClick={() => {
                                                  setActiveLightId(l.id);
                                                  setIsColorPickerOpen(true);
                                                }}
                                                className="w-full h-6 rounded border border-white/10 flex items-center justify-center gap-2 text-[10px] font-bold text-gray-300 hover:bg-white/5 transition-colors"
                                                style={{
                                                  backgroundColor: l.color,
                                                }}
                                              >
                                                <Palette size={12} />
                                              </button>
                                            </div>
                                          </div>
                                        ))}
                                    </>
                                  )}
                                  {activeFxTab === "SETTINGS" && (
                                    <div className="col-span-1 md:col-span-2 lg:col-span-3 bg-[#111] p-6 rounded-xl border border-white/5">
                                      <h3 className="text-xs font-bold text-white mb-4 flex items-center gap-2">
                                        <Sliders
                                          size={14}
                                          className="text-gray-400"
                                        />{" "}
                                        {t("GLOBAL AMBIENT SETTINGS")}
                                      </h3>
                                      <div className="space-y-6 max-w-md">
                                        <div className="space-y-2">
                                          <div className="flex justify-between">
                                            <span className="text-[10px] font-bold text-gray-500">
                                              {t("AMBIENT LIGHT LEVEL")}
                                            </span>
                                            <span className="text-[10px] font-mono text-cyan-400">
                                              {(
                                                ambientLightLevel * 100
                                              ).toFixed(0)}
                                              %
                                            </span>
                                          </div>
                                          <input
                                            type="range"
                                            min="0"
                                            max="1"
                                            step="0.05"
                                            value={ambientLightLevel}
                                            onChange={(e) =>
                                              setAmbientLightWithKey(
                                                parseFloat(e.target.value),
                                              )
                                            }
                                            onPointerDown={
                                              handleInteractionStart
                                            }
                                            onPointerUp={handleInteractionEnd}
                                            className="w-full h-1.5 bg-white/10 rounded-full accent-gray-400"
                                          />
                                          <p className="text-[9px] text-gray-600">
                                            {t(
                                              "Controls the base brightness of the character when lights are active. Lower this for darker, more dramatic scenes.",
                                            )}
                                          </p>
                                        </div>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          )}
                          {activeBottomTab === "TEXT" && renderTextPanel(false)}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
            {isExpired && (
              <ExpiredSubscriptionSplash
                onRenew={() => {
                  setShowSubscription(true);
                  setIsExpired(false);
                }}
                onExit={() => {
                  window.location.href = "about:blank";
                }}
              />
            )}
            <ExportModal
              isOpen={isExportModalOpen}
              projectName={projectName}
              onClose={() => {
                setIsExportModalOpen(false);
                if (isPresentationMode) setIsPresentationMode(false);
                if (preExportUiState.current) {
                  setIsLeftPanelOpen(preExportUiState.current.isLeftPanelOpen);
                  setIsTabsVisible(preExportUiState.current.isTabsVisible);
                  if (preExportUiState.current.currentTime !== undefined) {
                    engine.seek(preExportUiState.current.currentTime);
                  }
                }
              }}
              duration={playbackState.duration || 0}
              currentTime={playbackState.currentTime || 0}
              onSeek={engine.seek}
              onPlay={engine.play}
              onPause={engine.pause}
              getAudioStream={getMixedAudioStream}
              onTogglePresentationMode={(val) => {
                setIsPresentationMode(val);
                if (val) {
                  preExportUiState.current = { isLeftPanelOpen, isTabsVisible };
                  setIsLeftPanelOpen(false);
                  setIsTabsVisible(false);
                } else {
                  setIsLeftPanelOpen(preExportUiState.current.isLeftPanelOpen);
                  setIsTabsVisible(preExportUiState.current.isTabsVisible);
                }
              }}
              setIsLocalMuted={setIsLocalMuted}
              characters={characters}
              characterFiltersMap={characterFiltersMap}
              keyframes={keyframes}
              lipSyncKeyframes={lipSyncKeyframes}
              setLipSyncKeyframes={setLipSyncKeyframes}
              lipSyncTargetId={lipSyncTargetId}
              onExportProject={handleExportProject}
              availableBackgrounds={availableBackgrounds}
              backgroundImage={backgroundImage}
              backgroundTransform={backgroundTransform}
              cameraTransform={cameraTransform}
              aspectRatio={aspectRatio}
              vocalTrack={vocalTrack}
              instTrack={instTrack}
              linkBgToCamera={linkBgToCamera}
              audioDuration={playbackState.duration || 0}
              canvasBgColor={canvasBgColor}
              isCanvasTransparent={isCanvasTransparent}
              lightSources={lightSources}
              ambientLightLevel={ambientLightLevel}
              visemeMap={visemeMap}
              setIsExporting={setIsExporting}
              shadowConfig={shadowConfig}
              depthShadowConfig={depthShadowConfig}
              texts={texts}
            />
            {deleteConfirmation.isOpen && (
              <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60  animate-in fade-in duration-200">
                {/* ... (Existing Confirmation Modals) ... */}
                <div className="w-[280px] max-w-[90%] bg-[#111] border border-white/10 rounded-xl p-4 shadow-2xl flex flex-col gap-4 transform scale-100 animate-in zoom-in-95 duration-200">
                  <div className="flex flex-col gap-2 text-center">
                    <div className="mx-auto w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center text-red-500">
                      <Trash2 size={20} />
                    </div>
                    <h3 className="text-sm font-bold text-white">
                      {t("Delete Audio Track?")}
                    </h3>
                    <p className="text-[10px] text-gray-400">
                      {t("This action cannot be undone.")}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={cancelDelete}
                      className="py-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-bold text-gray-300 transition-colors"
                    >
                      {t("Cancel")}
                    </button>
                    <button
                      onClick={confirmDelete}
                      className="py-2.5 rounded-lg bg-red-500 hover:bg-red-400 text-xs font-bold text-white transition-colors"
                    >
                      {t("Yes, Delete")}
                    </button>
                  </div>
                </div>
              </div>
            )}
            {sliceModal.isOpen && (
              <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60  animate-in fade-in duration-200">
                <div className="w-[280px] max-w-[90%] bg-[#111] border border-white/10 rounded-xl p-4 shadow-2xl flex flex-col gap-4 transform scale-100 animate-in zoom-in-95 duration-200">
                  <div className="flex flex-col gap-2 text-center">
                    <div className="mx-auto w-10 h-10 rounded-full bg-purple-500/10 flex items-center justify-center text-purple-500">
                      <Split size={20} />
                    </div>
                    <h3 className="text-sm font-bold text-white">
                      {t("Slice Audio?")}
                    </h3>
                    <p className="text-[10px] text-gray-400">
                      At {sliceModal.time.toFixed(2)}s
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => confirmSlice("LEFT")}
                      className="py-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-[10px] font-bold text-gray-300 transition-colors"
                    >
                      {t("KEEP LEFT")}
                    </button>
                    <button
                      onClick={() => confirmSlice("RIGHT")}
                      className="py-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-[10px] font-bold text-gray-300 transition-colors"
                    >
                      {t("KEEP RIGHT")}
                    </button>
                  </div>
                  <button
                    onClick={() =>
                      setSliceModal({ ...sliceModal, isOpen: false })
                    }
                    className="w-full py-2 rounded-lg text-[10px] font-bold text-gray-500 hover:text-white transition-colors"
                  >
                    {t("CANCEL")}
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      {openingProjectState && (
        <div className="fixed inset-0 z-[11000] bg-[#09090c]/95 backdrop-blur-xl flex flex-col items-center justify-center p-8 text-center animate-in fade-in duration-300">
          <div className="max-w-xs w-full bg-[#121216]/90 border border-white/5 p-6 rounded-[28px] shadow-2xl flex flex-col items-center transition-all duration-300 backdrop-blur-lg">
            <div className="relative mb-5 flex items-center justify-center">
              <div className="w-16 h-16 border-t-2 border-r-2 border-[#00e5ff] rounded-full animate-spin" />
              <div className="absolute inset-x-0 mx-auto w-12 h-12 bg-[#00e5ff]/10 rounded-full flex items-center justify-center">
                <span className="text-[10px] font-mono font-black text-[#00e5ff]">{openingProjectState.progress}%</span>
              </div>
            </div>
            <h3 className="text-xs font-black text-white mb-1 uppercase tracking-wider">
              {t ? t("Opening Project") : "Opening Project"}
            </h3>
            <p className="text-[11px] text-gray-300 font-bold mb-3 truncate max-w-full">
              {openingProjectState.name}
            </p>
            <div className="w-full bg-white/5 h-1.5 rounded-full overflow-hidden mb-3">
              <div 
                className="h-full bg-gradient-to-r from-cyan-400 to-indigo-500 rounded-full transition-all duration-300"
                style={{ width: `${openingProjectState.progress}%` }}
              />
            </div>
            <span className="text-[#00e5ff] text-[10px] font-mono font-black mb-1">
              {openingProjectState.progress}% {t ? t("Loaded") : "Loaded"}
            </span>
            <p className="text-[9px] text-gray-400 font-semibold leading-normal animate-pulse">
              {t && openingProjectState.step ? t(openingProjectState.step) : openingProjectState.step}
            </p>
          </div>
        </div>
      )}
    </>
  );
};
