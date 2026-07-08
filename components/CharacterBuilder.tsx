import React, {
  useState,
  useRef,
  useEffect,
  Suspense,
  lazy,
  memo,
  useCallback,
  useMemo,
} from "react";
import { toast } from "sonner";
import { useLanguage } from "../utils/LanguageContext";
import html2canvas from "html2canvas";
import {
  CharacterComposition,
  CharacterPart,
  TransformState,
  VisemeShape,
  AssemblerSession,
  Bone,
} from "../types";
import { triggerDownload } from "../utils/downloadHelper";
import {
  DEFAULT_TRANSFORM,
  createPart,
  getInitialParts,
} from "../utils/characterDefaults";
import { safeDeepClone } from "../utils/cloneUtils";
import { compensateAnchorShift } from "../utils/animationUtils";
import { autoCalculatePivots } from "../utils/autoPivot";
import {
  X,
  Check,
  Layers,
  Trash2,
  UserCog,
  ChevronDown,
  ArrowLeft,
  ZoomIn,
  ZoomOut,
  Maximize,
  Settings,
  Hand,
  Bone as BoneIcon,
  Layout,
  LogOut,
  Folder,
  PanelLeftOpen,
  AlertCircle,
  Sliders,
  Edit2,
  FilePlus,
  FolderPlus,
  Eye,
  EyeOff,
  ChevronRight,
  GripVertical,
  Download,
  Upload,
  Terminal,
  AlertTriangle,
  Share2,
  Save,
  FileText,
  Move,
  RefreshCcw,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { PuppetWarp } from "./PuppetWarp";
import { CharacterStage } from "./CharacterStage";
import { CharacterDesigner, LayerData } from "./CharacterDesigner";

const CharacterPackImporter = lazy(() => import("./CharacterPackImporter"));

interface CharacterBuilderProps {
  onClose: () => void;
  initialImportFile?: File | null;
  onClearImportFile?: () => void;
  onImplement: (
    character: CharacterComposition,
    thumbnail?: string,
    origin?: "ASSEMBLER" | "DESIGNER" | "IMPORTER",
    extractedBackgrounds?: { url: string }[]
  ) => void;
  currentCharacter: CharacterComposition | null;
  visemeMap: Record<VisemeShape, string | null>;
  onVisemeMapChange: (map: Record<VisemeShape, string | null>) => void;
  characterFilters: {
    saturation: number;
    contrast: number;
    brightness: number;
    sharpness: number;
    autoBlink: boolean;
    eyeSquint: number;
    pupilX: number;
    pupilY: number;
  };
  updateCharacterFilter: (prop: string, val: number | boolean) => void;
  assemblerSession?: AssemblerSession | null;
  onSaveAssemblerSession?: (session: AssemblerSession) => void;
  selectedPartIds: string[];
  setSelectedPartIds: (ids: string[]) => void;
  initialTool?: "ASSEMBLER" | "DESIGNER" | "IMPORTER" | null;
  lockTool?: boolean;
}

// --- HELPER FUNCTIONS FOR EXPORT/IMPORT ---

const sf = (n: number | undefined | null, def = 0) => {
  if (n === undefined || n === null || !Number.isFinite(n)) return def;
  return Math.round(n * 10000) / 10000;
};

const sanitizeTransform = (t: TransformState): TransformState => ({
  x: sf(t.x),
  y: sf(t.y),
  scaleX: Math.abs(t.scaleX) < 0.0001 ? 0.0001 : sf(t.scaleX, 1),
  scaleY: Math.abs(t.scaleY) < 0.0001 ? 0.0001 : sf(t.scaleY, 1),
  rotation: sf(t.rotation),
  anchorX: sf(t.anchorX, 50),
  anchorY: sf(t.anchorY, 50),
});

const dataURItoBlob = (dataURI: string) => {
  try {
    if (!dataURI || !dataURI.startsWith("data:")) {
      console.warn("Invalid DataURI format");
      return null;
    }

    const cleanURI = dataURI.replace(/\s/g, "");
    const split = cleanURI.split(",");
    if (split.length < 2) return null;

    const byteString = atob(split[1]);
    const mimeString = split[0].split(":")[1].split(";")[0];
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) {
      ia[i] = byteString.charCodeAt(i);
    }
    return new Blob([ab], { type: mimeString });
  } catch (e: any) {
    console.error(`DataURI Error: ${e.message}`);
    return null;
  }
};

const blobUrlToBase64 = async (url: string): Promise<string> => {
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (typeof reader.result === "string") resolve(reader.result);
        else reject(new Error("Failed to read blob"));
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (e: any) {
    try {
      return await new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          const canvas = document.createElement("canvas");
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext("2d");
          ctx?.drawImage(img, 0, 0);
          resolve(canvas.toDataURL("image/png"));
        };
        img.onerror = () => resolve("");
        img.src = url;
      });
    } catch (e2) {
      return "";
    }
  }
};

const generateThumbnail = (): string => {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const grad = ctx.createRadialGradient(256, 256, 0, 256, 256, 512);
    grad.addColorStop(0, "#1a1a1a");
    grad.addColorStop(1, "#000000");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 512, 512);

    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.lineWidth = 2;
    for (let i = 0; i < 512; i += 40) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, 512);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(512, i);
      ctx.stroke();
    }

    ctx.strokeStyle = "#00f2ff";
    ctx.lineWidth = 15;
    ctx.shadowColor = "#00f2ff";
    ctx.shadowBlur = 40;
    ctx.beginPath();
    ctx.arc(256, 256, 180, 0, Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = 0;

    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 120px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("ANIMATO", 256, 256);

    ctx.font = "30px monospace";
    ctx.fillStyle = "#00f2ff";
    ctx.fillText("RIG CONFIG", 256, 330);
  }
  return canvas.toDataURL("image/png");
};

// --- LOADING SCREEN ---
const LoadingScreen = ({
  message,
  logs,
  onCancel,
}: {
  message?: string;
  logs?: string[];
  onCancel?: () => void;
}) => {
  const { t } = useLanguage();
  return (
    <div className="absolute inset-0 z-[600] bg-[#050505] flex flex-col items-center justify-center gap-8 font-mono">
      {onCancel && (
        <button
          onClick={onCancel}
          className="absolute top-8 right-8 text-gray-500 hover:text-white p-2 bg-white/5 rounded-full z-50"
        >
          <X size={20} />
        </button>
      )}
      <div className="relative">
        <div className="w-20 h-20 border border-white/5 rounded-full absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 animate-[spin_4s_linear_infinite]"></div>
        <div className="w-16 h-16 border-t-2 border-cyan-500 rounded-full animate-spin shadow-[0_0_15px_rgba(6,182,212,0.5)]"></div>
        <div className="w-12 h-12 border-b-2 border-cyan-800 rounded-full absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 animate-[spin_2s_linear_infinite_reverse]"></div>
        <div className="w-2 h-2 bg-white rounded-full absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 animate-pulse shadow-[0_0_10px_white]"></div>
      </div>

      <div className="flex flex-col items-center gap-3">
        <h3 className="text-cyan-500 text-xs tracking-[0.4em] font-black uppercase">
          {t("ANIMATO STUDIO")}
        </h3>
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 bg-cyan-500 rounded-full animate-pulse"></span>
          <p className="text-gray-500 text-[9px] tracking-[0.2em]">
            {message || "INITIALIZING..."}
          </p>
        </div>
      </div>

      {logs && logs.length > 0 && (
        <div className="mt-8 w-96 max-w-[90vw] h-32 bg-[#111] border border-white/10 rounded-lg p-2 overflow-y-auto custom-scrollbar">
          {logs.map((log, i) => (
            <div
              key={i}
              className="text-[8px] text-gray-500 border-b border-white/5 py-0.5 font-mono"
            >
              {log}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const DebugConsole = ({
  logs,
  onClose,
  clearLogs,
}: {
  logs: string[];
  onClose: () => void;
  clearLogs: () => void;
}) => {
  const { t } = useLanguage();
  return (
    <div className="absolute top-20 right-4 w-80 bg-[#0a0a0a]/95  border border-white/10 rounded-lg shadow-2xl z-[700] flex flex-col max-h-[500px]">
      <div className="p-2 border-b border-white/10 flex justify-between items-center bg-white/5">
        <span className="text-[10px] font-bold text-cyan-500 flex items-center gap-2">
          <Terminal size={12} /> {t("DEBUG CONSOLE")}
        </span>
        <div className="flex gap-2">
          <button
            onClick={clearLogs}
            className="text-[9px] text-gray-400 hover:text-white"
          >
            {t("CLEAR")}
          </button>
          <button onClick={onClose}>
            <X size={12} />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2 font-mono space-y-1">
        {logs.length === 0 ? (
          <div className="text-[9px] text-gray-600 italic">
            {t("No logs...")}
          </div>
        ) : (
          logs.map((l, i) => (
            <div
              key={i}
              className="text-[9px] text-gray-300 break-words border-b border-white/5 py-1"
            >
              {l.includes("Error") || l.includes("Failed") ? (
                <span className="text-red-400">{l}</span>
              ) : l.includes("Success") ? (
                <span className="text-green-400">{l}</span>
              ) : (
                l
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};



const CharacterBuilder: React.FC<CharacterBuilderProps> = ({
  onClose,
  initialImportFile,
  onClearImportFile,
  onImplement,
  currentCharacter,
  visemeMap,
  onVisemeMapChange,
  characterFilters,
  updateCharacterFilter,
  assemblerSession,
  onSaveAssemblerSession,
  selectedPartIds,
  setSelectedPartIds,
  initialTool,
  lockTool,
}) => {
  const { t } = useLanguage();

  const [extractedBgQueue, setExtractedBgQueue] = useState<{ url: string }[]>([]);

  // --- STATE INITIALIZATION ---
  const [character, setCharacter] = useState<CharacterComposition>(() => {
    let source =
      currentCharacter && Object.keys(currentCharacter).length > 0
        ? currentCharacter
        : getInitialParts();
    source = autoCalculatePivots(source);
    const clone = safeDeepClone(source);
    Object.keys(clone).forEach((key) => {
      const part = clone[key];
      if (part.baseTransform) {
        part.transform = { ...part.baseTransform };
      } else {
        part.baseTransform = { ...part.transform };
      }
    });
    return clone;
  });

  const [localVisemeMap, setLocalVisemeMap] =
    useState<Record<VisemeShape, string | null>>(visemeMap);

  const [activePartId, setActivePartId] = useState<string>("root");
  // STABLE LOOKUP: Use memo to ensure activePart is consistent across renders unless ID or character state actually changes
  const activePart = useMemo(
    () => character[activePartId],
    [character, activePartId],
  );

  const [isAssemblerOpen, setIsAssemblerOpen] = useState(
    initialTool === "ASSEMBLER",
  );
  const [assemblerFile, setAssemblerFile] = useState<File | null>(() => {
    if (initialTool === "ASSEMBLER" && initialImportFile) {
      return initialImportFile;
    }
    return null;
  });
  const [isDesignerOpen, setIsDesignerOpen] = useState(
    initialTool === "DESIGNER",
  );
  const [isImporterOpen, setIsImporterOpen] = useState(
    initialTool === "IMPORTER",
  );
  const [longPressTimer, setLongPressTimer] = useState<NodeJS.Timeout | null>(
    null,
  );
  const rigImportInputRef = useRef<HTMLInputElement>(null);

  // --- HIERARCHY STATE ---
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    id: string;
    position: "above" | "below" | "inside";
  } | null>(null);

  // UI State
  const [mobilePanel, setMobilePanel] = useState<
    "hierarchy" | "inspector" | null
  >(null);
  const [desktopLeftPanel, setDesktopLeftPanel] = useState(true);

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

  const stageRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [stageScale, setStageScale] = useState(1);

  useEffect(() => {
    if (!containerRef.current) return;
    const resizeObserver = new ResizeObserver((entries) => {
      for (let entry of entries) {
        const { width, height } = entry.contentRect;
        // Stage is 500x500. We want to fit it with some padding.
        const padding = 32;
        const availableWidth = width - padding * 2;
        const availableHeight = height - padding * 2;
        const scale = Math.min(1, availableWidth / 500, availableHeight / 500);
        setStageScale(scale);
      }
    });
    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, []);
  const [isSaving, setIsSaving] = useState(false);
  const [desktopRightPanel, setDesktopRightPanel] = useState(true);
  const [isToolsMenuOpen, setIsToolsMenuOpen] = useState(false);

  // Export State



  const [loopEditorLayers, setLoopEditorLayers] = useState<CharacterPart[]>([]);
  const [selectedLoopId, setSelectedLoopId] = useState<string | null>(null);

  const [internalToast, setInternalToast] = useState<string | null>(null);

  // Debugging
  const logsRef = useRef<string[]>([]);
  const [logTick, setLogTick] = useState(0);
  const [showDebug, setShowDebug] = useState(false);

  const log = useCallback((msg: string) => {
    const timestamp = new Date().toLocaleTimeString();
    const entry = `[${timestamp}] ${msg}`;
    logsRef.current = [entry, ...logsRef.current];

    setLogTick((t) => t + 1);
  }, []);

  const [isLoading, setIsLoading] = useState(false);
  const [loadingText, setLoadingText] = useState("PROCESSING...");

  const triggerToast = (msg: string) => {
    toast(msg);
  };

  const getOutputCharacter = (riggingChar: CharacterComposition): CharacterComposition => {
    if (!currentCharacter) return riggingChar; 
    const out = safeDeepClone(riggingChar);

    Object.keys(out).forEach(partId => {
       const part = out[partId];
       const originalPart = currentCharacter[partId];
       
       const newBaseTransform = { ...part.transform };
       part.baseTransform = { ...newBaseTransform };

       if (originalPart && originalPart.baseTransform && originalPart.transform) {
          const oldBase = originalPart.baseTransform;
          const oldMain = originalPart.transform;

          const dx = newBaseTransform.x - oldBase.x;
          const dy = newBaseTransform.y - oldBase.y;
          
          const getRatio = (n: number, o: number) => {
             if (Math.abs(o) < 0.0001) return 1;
             return n / o;
          }
          const scaleXRatio = getRatio(newBaseTransform.scaleX, oldBase.scaleX);
          const scaleYRatio = getRatio(newBaseTransform.scaleY, oldBase.scaleY);
          
          const drot = newBaseTransform.rotation - oldBase.rotation;

          part.transform = {
             ...newBaseTransform,
             x: oldMain.x + dx,
             y: oldMain.y + dy,
             scaleX: oldMain.scaleX * scaleXRatio,
             scaleY: oldMain.scaleY * scaleYRatio,
             rotation: oldMain.rotation + drot,
             flipX: (newBaseTransform.flipX !== oldBase.flipX) ? !oldMain.flipX : oldMain.flipX,
             flipY: (newBaseTransform.flipY !== oldBase.flipY) ? !oldMain.flipY : oldMain.flipY,
             anchorX: newBaseTransform.anchorX,
             anchorY: newBaseTransform.anchorY,
          };
       }
    });
    return out;
  };

  const handleAssemblerImplement = (
    newCharacter: CharacterComposition,
    newVisemeMap?: Record<VisemeShape, string | null>,
  ) => {
    const autoChar = autoCalculatePivots(newCharacter);
    setCharacter(autoChar);
    if (newVisemeMap) onVisemeMapChange(newVisemeMap);
    onImplement(getOutputCharacter(autoChar), undefined, "ASSEMBLER");
    setIsAssemblerOpen(false);
  };

  const handleDesignerSave = (newCharacter: CharacterComposition) => {
    setCharacter(newCharacter);
    onImplement(getOutputCharacter(newCharacter), undefined, "DESIGNER");
    setIsDesignerOpen(false);
  };

  const handleSave = async () => {
    setIsSaving(true);
    setLoadingText("SAVING...");

    // Final implementation call
    try {
      const thumbnail = generateThumbnail();
      onVisemeMapChange(localVisemeMap);
      onImplement(
        getOutputCharacter(character),
        thumbnail,
        lockTool ? initialTool || undefined : undefined,
        extractedBgQueue.length > 0 ? extractedBgQueue : undefined
      );

      // Short delay to show success state before closing
      setTimeout(() => {
        setIsSaving(false);
        onClose();
      }, 300);
    } catch (e: any) {
      log(`Save Error: ${e.message}`);
      setIsSaving(false);
      triggerToast("SAVE FAILED");
    }
  };



  const handleImportClick = () => {
    if (rigImportInputRef.current) {
      rigImportInputRef.current.click();
    }
    setIsToolsMenuOpen(false);
  };

  useEffect(() => {
    if (initialImportFile) {
        if (initialTool !== "ASSEMBLER") {
            handleFileImport(initialImportFile);
        }
        if (onClearImportFile) onClearImportFile();
    }
  }, [initialImportFile, initialTool]);

  const importRiggedCharacter = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    let file = e.target.files?.[0];
    if (!file) {
      setIsLoading(false);
      return;
    }
    await handleFileImport(file, e);
  };

  const handleFileImport = async (file: File, e?: React.ChangeEvent<HTMLInputElement>) => {
    log(`Selected: ${file.name}`);
    setIsLoading(true);
    setLoadingText("READING DATA...");

    if (file.name.toLowerCase().endsWith(".bin")) {
      try {
        setLoadingText("CHECKING METADATA...");
        const buffer = await file.arrayBuffer();
        const headerBytes = new Uint8Array(buffer.slice(0, 4));
        
        const isPSD = headerBytes[0] === 0x38 && headerBytes[1] === 0x42 && headerBytes[2] === 0x50 && headerBytes[3] === 0x53; // "8BPS"
        const isZIP = headerBytes[0] === 0x50 && headerBytes[1] === 0x4b && headerBytes[2] === 0x03 && headerBytes[3] === 0x04; // "PK\x03\x04"
        
        if (isPSD) {
          const newName = file.name.replace(/\.bin$/i, ".psd");
          file = new File([buffer], newName, { type: "image/vnd.adobe.photoshop" });
          log(`Detected .bin as PSD. Converted filename to ${newName}`);
        } else if (isZIP) {
          const newName = file.name.replace(/\.bin$/i, ".zip");
          file = new File([buffer], newName, { type: "application/zip" });
          log(`Detected .bin as ZIP. Converted filename to ${newName}`);
        } else {
          throw new Error("Metadata check failed. File is not a valid PSD or ZIP.");
        }
      } catch (metadataErr) {
        console.error("Metadata conversion failed", metadataErr);
        triggerToast("IMPORT FAILED");
        setIsLoading(false);
        if (e && e.target) e.target.value = "";
        return;
      }
    }

    if (file.name.toLowerCase().endsWith(".psd")) {
      try {
        setLoadingText("PARSING PSD...");
        const { readPsd } = await import("ag-psd");
        const arrayBuffer = await file.arrayBuffer();
        const psd = readPsd(arrayBuffer, {
          skipLayerImageData: false,
          skipThumbnail: true,
        });

        const psdWidth = psd.width || 1000;
        const psdHeight = psd.height || 1000;

        // The CharacterStage internal coordinate system is mostly 500x500.
        // We use a smaller padding factor to ensure the imported character root
        // is visually 'zoomed out' and fits comfortably inside the Rigging Studio and Loop Detect UI.
        const baseStageLimit = 500;
        const paddingFactor = 0.85; // Increased scale
        const scale = Math.min(
          1,
          (baseStageLimit * paddingFactor) / psdWidth,
          (baseStageLimit * paddingFactor) / psdHeight,
        );

        const newCharacter: CharacterComposition = {
          root: createPart("root", file.name.replace(".psd", ""), null, 10, {
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

        const extractedPsdBackgrounds: { url: string }[] = [];
        const extractedAnchors: Record<string, { x: number; y: number }> = {};

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

        const extractAnchors = (node: any) => {
            if (node.children) {
                for (let i = 0; i < node.children.length; i++) {
                    extractAnchors(node.children[i]);
                }
            } else {
                const layerWidth = node.canvas?.width || node.imageData?.width || 0;
                const layerHeight = node.canvas?.height || node.imageData?.height || 0;
                const centerX = (node.left || 0) + layerWidth / 2;
                const centerY = (node.top || 0) + layerHeight / 2;
                const offsetX = centerX - psdWidth / 2;
                const offsetY = centerY - psdHeight / 2;
                
                let name = (node.name || "").toLowerCase()
                                .replace("_anchor_point", "")
                                .replace(" anchor point", "")
                                .trim();
                extractedAnchors[name] = { x: offsetX * scale, y: offsetY * scale };
            }
        };

        // The Photoshop canvas API in browsers needs to decode blending correctly.
        // Depending on the version, we can extract the ImageData directly!
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
                  for (let i = layer.children.length - 1; i >= 0; i--) {
                      const bgLayer = layer.children[i];
                      const uri = await getLayerImageUri(bgLayer);
                      if (uri) extractedPsdBackgrounds.push({ url: uri });
                  }
                  return undefined; // Skip adding background folder to character safely
              }

              if (nameLower === "anchor points" || nameLower === "anchor_points") {
                  extractAnchors(layer);
                  return undefined;
              }

              const isLoop = nameLower.includes("loop");
              const isMouth = nameLower.includes("mouth") || nameLower.includes("viseme");
              
              // Detect views (e.g. "front view", "side view", "back view")
              const isView = nameLower.includes("view") || 
                             (parentId === "root" && (nameLower.includes("front") || nameLower.includes("side") || nameLower.includes("back")));
              const isSwap = nameLower.endsWith("_swap") || nameLower.endsWith(" swap");
              
              const tags: string[] = [];
              if (isLoop) tags.push("Loop");
              if (isView) tags.push("View");
              if (isSwap) tags.push("Swap");
              // Note: We deliberately do NOT push "Mouth" to the folder if it's a mouth folder
              // because we want the mouth_REST layer to be the primary Mouth anchor for physics and lip sync.
              // Instead, we just pass down `inMouthFolder: true`.

              let isVisible = layer.hidden !== true;
              if (isView) {
                 isVisible = false; // We'll set the first one to true later
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
                },
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
                    // First child (topmost in PSD, processed first because i goes from length-1 to 0? Wait, length-1 is top or bottom?
                    // According to comment, length-1 is bottom. Actually `ag-psd` layer 0 is bottom. So length-1 is top.
                    // If we want the top-most visible, it's the first one processed.
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
                    // It's inside a mouth folder. Map it as a viseme.
                    const tokens = layerNameUpper.split(/[^A-Z0-9]/);
                    Object.keys(shapeMatches).forEach(key => {
                        if (tokens.includes(key) || layerNameUpper === key) {
                            assignedShape = shapeMatches[key as keyof typeof shapeMatches];
                        }
                    });
                    
                    if (!assignedShape && layerNameUpper.length === 1) {
                        // fallback for exact 1-letter match like "O" or "U"
                        if (layerNameUpper in shapeMatches) {
                            assignedShape = shapeMatches[layerNameUpper as keyof typeof shapeMatches];
                        }
                    }

                    if (layerNameUpper.includes("REST") || layerNameUpper.includes("NEUTRAL") || assignedShape === VisemeShape.REST) {
                        tags.push("Mouth"); // This layer becomes the primary mouth geometry.
                        tags.push("Viseme"); 
                        tags.push(VisemeShape.REST);
                        // Also make it the default visible layer in the mouth folder
                        layer.hidden = false;
                    } else {
                        tags.push("Viseme");
                        if (assignedShape) tags.push(assignedShape);
                        layer.hidden = true; // Non-rest mouth shapes should be hidden.
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
                        shapeMatches[foundSuffix as keyof typeof shapeMatches],
                      );
                    }
                  }

                  const isBlink = layerNameUpper.includes("BLINK");
                  if (isBlink) {
                    tags.push("Blink");
                  }

                  if (dataUri) {
                    const isViseme = tags.includes("Viseme");
                    // Important: if it's the primary mouth, we might want it visible even if we gave it Viseme tag?
                    // Actually, if we give it Viseme, it gets extracted into the map and hidden by CharacterStage!
                    // Wait, if CharacterStage hides it, then WHAT rendered the mouth_REST layer natively?
                    // Let's REMOVE "Viseme" tag if it is the primary mouth so that it renders!
                    if (tags.includes("Mouth") && tags.includes("Viseme")) {
                        // In CharacterStage, "isViseme" means return null.
                        // But for "Mouth", its image is replaced.
                        // So if we don't return null, it gets rendered with the physics applied!
                        // Let's remove "Viseme" tag from the REST mouth.
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
                        isVisible: tags.includes(VisemeShape.REST) ? true : (isViseme ? false : layer.hidden !== true),
                        width: layerWidth,
                        height: layerHeight,
                        transform: {
                          ...DEFAULT_TRANSFORM,
                          x: offsetX,
                          y: offsetY,
                        },
                        tags,
                      },
                    );
                    newCharacter[parentId].children.push(partId);
                  } else {
                    newCharacter[partId] = createPart(
                      partId,
                      overrideName || layer.name || "Empty Layer",
                      parentId,
                      globalZIndex--,
                      {
                        width: 0,
                        height: 0,
                        isVisible: layer.hidden !== true,
                        transform: { ...DEFAULT_TRANSFORM, x: 0, y: 0 },
                        tags: [],
                      },
                    );
                    newCharacter[parentId].children.push(partId);
                  }
                } else {
                  newCharacter[partId] = createPart(
                    partId,
                    overrideName || layer.name || "Empty Layer",
                    parentId,
                    globalZIndex--,
                    {
                      width: 0,
                      height: 0,
                      isVisible: layer.hidden !== true,
                      transform: { ...DEFAULT_TRANSFORM, x: 0, y: 0 },
                      tags: [],
                    },
                  );
                  newCharacter[parentId].children.push(partId);
                }
              } catch (err) {
                console.warn("Failed to parse PSD layer", layer.name, err);
              }
              return partId;
            }
          };

          for (let i = psd.children.length - 1; i >= 0; i--) {
            await processLayer(psd.children[i], "root");
          }

          // Apply extracted anchor points
          if (Object.keys(extractedAnchors).length > 0) {
              const partValues = Object.values(newCharacter);
              for (const [anchorName, anchorPos] of Object.entries(extractedAnchors)) {
                  // Find exactly matching part by label, or best matching
                  const matchingPart = partValues.find(p => p.label.toLowerCase().trim() === anchorName) 
                                     || partValues.find(p => p.label.toLowerCase().includes(anchorName));
                  if (matchingPart && matchingPart.width && matchingPart.height) {
                      const partLeft = matchingPart.transform.x - matchingPart.width / 2;
                      const partTop = matchingPart.transform.y - matchingPart.height / 2;
                      
                      // Convert extracted PSD coords to percentage
                      matchingPart.transform.anchorX = ((anchorPos.x - partLeft) / matchingPart.width) * 100;
                      matchingPart.transform.anchorY = ((anchorPos.y - partTop) / matchingPart.height) * 100;
                  }
              }
          }

          // Auto-group Limbs for Rigging Hierarchy
          const hierarchies = [
              [{side: 'Left', type: 'Arm', parts: ['left upper arm', 'left_upper_arm']}, {side: 'Left', type: 'Arm', parts: ['left lower arm', 'left_lower_arm']}, {side: 'Left', type: 'Arm', parts: ['left hand', 'left hands', 'left_hand']}],
              [{side: 'Right', type: 'Arm', parts: ['right upper arm', 'right_upper_arm']}, {side: 'Right', type: 'Arm', parts: ['right lower arm', 'right_lower_arm']}, {side: 'Right', type: 'Arm', parts: ['right hand', 'right hands', 'right_hand']}],
              [{side: 'Left', type: 'Leg', parts: ['left upper leg', 'left thigh', 'left_upper_leg']}, {side: 'Left', type: 'Leg', parts: ['left lower leg', 'left calf', 'left_lower_leg']}, {side: 'Left', type: 'Leg', parts: ['left foot', 'left shoe', 'left_foot']}],
              [{side: 'Right', type: 'Leg', parts: ['right upper leg', 'right thigh', 'right_upper_leg']}, {side: 'Right', type: 'Leg', parts: ['right lower leg', 'right calf', 'right_lower_leg']}, {side: 'Right', type: 'Leg', parts: ['right foot', 'right shoe', 'right_foot']}],
          ];

          Object.values(newCharacter).forEach(parent => {
              if (!parent.isGroup || parent.children.length === 0) return;

              hierarchies.forEach(chain => {
                  const upperMatchIndex = parent.children.findIndex(id => {
                      const l = newCharacter[id].label.toLowerCase().trim();
                      return chain[0].parts.includes(l);
                  });
                  const lowerMatchIndex = parent.children.findIndex(id => {
                      const l = newCharacter[id].label.toLowerCase().trim();
                      return chain[1].parts.includes(l);
                  });
                  const handMatchIndex = parent.children.findIndex(id => {
                      const l = newCharacter[id].label.toLowerCase().trim();
                      return chain[2].parts.includes(l);
                  });

                  if (upperMatchIndex >= 0 && lowerMatchIndex >= 0) {
                      const upperId = parent.children[upperMatchIndex];
                      const lowerId = parent.children[lowerMatchIndex];
                      const handId = handMatchIndex >= 0 ? parent.children[handMatchIndex] : null;

                      const sideLabel = chain[0].side;
                      const typeLabel = chain[0].type;

                      const upperGroupId = `psd_group_${Date.now()}_${Math.random().toString(36).substr(2,9)}`;
                      const lowerGroupId = `psd_group_${Date.now()}_${Math.random().toString(36).substr(2,9)}`;

                      newCharacter[upperGroupId] = createPart(
                          upperGroupId,
                          `${sideLabel} Upper ${typeLabel}`,
                          parent.id,
                          newCharacter[upperId].zIndex + 1,
                          {
                              isGroup: true, isVisible: true, isOpen: true,
                              width: 0, height: 0, transform: { ...DEFAULT_TRANSFORM, x: 0, y: 0 },
                              children: [upperId, lowerGroupId], tags: []
                          }
                      );

                      newCharacter[lowerGroupId] = createPart(
                          lowerGroupId,
                          `${sideLabel} Lower ${typeLabel}`,
                          upperGroupId,
                          newCharacter[lowerId].zIndex + 1,
                          {
                              isGroup: true, isVisible: true, isOpen: true,
                              width: 0, height: 0, transform: { ...DEFAULT_TRANSFORM, x: 0, y: 0 },
                              children: [lowerId], tags: []
                          }
                      );

                      if (handId) {
                          newCharacter[lowerGroupId].children.push(handId);
                          newCharacter[handId].parentId = lowerGroupId;
                      }

                      newCharacter[upperId].parentId = upperGroupId;
                      newCharacter[lowerId].parentId = lowerGroupId;

                      parent.children = parent.children.filter(id => id !== upperId && id !== lowerId && id !== handId);
                      parent.children.push(upperGroupId);
                  }
              });
          });

          // End Auto-group Limbs
          
          // Determine visible view.
          const allViews = Object.values(newCharacter).filter((p) => p.tags.includes("View"));
          if (allViews.length > 0) {
              // The top-most layer in PSD is at index 0, which we processed last, so it's at the end of Object.values.
              // Let's just find the one that explicitly says "front" or pick the last one inserted (top-most).
              let defaultView = allViews.find(v => v.label.toLowerCase().includes('front'));
              if (!defaultView) defaultView = allViews[allViews.length - 1]; // Top-most
              
              allViews.forEach(v => {
                  newCharacter[v.id].isVisible = (v.id === defaultView.id);
                  newCharacter[v.id].opacity = (v.id === defaultView.id) ? 1 : 0;
              });
          }
        }

        const isInsideVisibleView = (p: CharacterPart) => {
            let curr = p;
            while (curr.parentId && curr.parentId !== 'root') {
               curr = newCharacter[curr.parentId];
               if (curr.tags.includes('View') && !curr.isVisible) return false;
            }
            if (curr.tags.includes('View') && !curr.isVisible) return false;
            return true;
        };

        const extractedVisemeMap: Record<VisemeShape, string | null> = {
          [VisemeShape.REST]: null,
          [VisemeShape.AI]: null,
          [VisemeShape.E]: null,
          [VisemeShape.O]: null,
          [VisemeShape.U]: null,
          [VisemeShape.FV]: null,
          [VisemeShape.L]: null,
          [VisemeShape.MBP]: null,
          [VisemeShape.CONS]: null,
        };
        Object.values(newCharacter).forEach((part) => {
          if ((part.tags.includes("Viseme") || (part.tags.includes("Mouth") && part.tags.includes(VisemeShape.REST))) && part.imageUrl) {
            const shape = part.tags.find((t) =>
              Object.values(VisemeShape).includes(t as VisemeShape),
            ) as VisemeShape | undefined;
            if (shape) extractedVisemeMap[shape] = part.imageUrl;
          }
        });

        let parsedChar = newCharacter;
        parsedChar = autoCalculatePivots(parsedChar);
        setCharacter(parsedChar);
        setLocalVisemeMap(extractedVisemeMap);
        if (extractedPsdBackgrounds.length > 0) {
            setExtractedBgQueue(extractedPsdBackgrounds);
        }
        setTimeout(() => {
          const loops = Object.values(parsedChar).filter((p) =>
            p.tags.includes("Loop") && isInsideVisibleView(p)
          );
          if (loops.length > 0) {
            setLoopEditorLayers(loops);
            setSelectedLoopId(loops[0].id);
            triggerToast("LOOPS DETECTED");
          } else {
            triggerToast("PSD IMPORT SUCCESSFUL");
          }
          setIsLoading(false);
        }, 500);
      } catch (err) {
        console.error("PSD Error", err);
        triggerToast("IMPORT FAILED");
        setIsLoading(false);
      }
      return;
    }

    if (file.name.toLowerCase().endsWith(".zip")) {
      setTimeout(async () => {
        try {
          setLoadingText("UNZIPPING CONFIG...");
          const JSZip = (await import("jszip")).default;
          const zipInstance = await JSZip.loadAsync(file);
          let targetEntry: any = null;
          zipInstance.forEach((relativePath, entry) => {
            if (!entry.dir && (relativePath.endsWith(".anima2D") || relativePath.endsWith(".anima2d") || relativePath.endsWith(".json") || relativePath.endsWith(".animato"))) {
              targetEntry = entry;
            }
          });

          if (targetEntry) {
            const zipText = await targetEntry.async("string");
            const jsonVal = JSON.parse(zipText);
            await processJson(jsonVal);
          } else {
            throw new Error("No .anima2D or configuration file found inside ZIP archive.");
          }
        } catch (err: any) {
          log(`ZIP Error: ${err.message}`);
          triggerToast("IMPORT FAILED");
          setIsLoading(false);
          if (e && e.target) e.target.value = "";
        }
      }, 50);
      return;
    }

    const processJson = async (json: any) => {
      try {
        // Handle format conversions for Store projects or characters to rigging spec
        if (json.characters && json.characters[0]) {
          const storeChar = json.characters[0];
          const composition = storeChar.composition || {};
          const assets: Record<string, string> = {};
          const assemblerConfig: Record<string, any> = {};
          const riggingConfig: Record<string, any> = {};
          
          Object.entries(composition).forEach(([partId, partRaw]) => {
            const part = partRaw as any;
            const assetId = part.assetId || `ast_${partId}`;
            if (part.imageUrl) {
              assets[assetId] = part.imageUrl;
            }
            assemblerConfig[partId] = {
              ...part,
              assetId: part.imageUrl ? assetId : (part.assetId || null),
              imageUrl: undefined,
              bones: undefined
            };
            riggingConfig[partId] = {
              bones: part.bones || []
            };
          });
          
          json = {
            metadata: {
              type: "converted_anima2D",
              version: "1.0",
              name: storeChar.name || json.name || "Imported Character"
            },
            assets,
            assemblerConfig,
            riggingConfig
          };
        } else if (json.composition) {
          const assets: Record<string, string> = {};
          const assemblerConfig: Record<string, any> = {};
          const riggingConfig: Record<string, any> = {};
          
          Object.entries(json.composition).forEach(([partId, partRaw]) => {
            const part = partRaw as any;
            const assetId = part.assetId || `ast_${partId}`;
            if (part.imageUrl) {
              assets[assetId] = part.imageUrl;
            }
            assemblerConfig[partId] = {
              ...part,
              assetId: part.imageUrl ? assetId : (part.assetId || null),
              imageUrl: undefined,
              bones: undefined
            };
            riggingConfig[partId] = {
              bones: part.bones || []
            };
          });
          
          json = {
            metadata: {
              type: "converted_anima2D",
              version: "1.0",
              name: json.name || "Imported Character"
            },
            assets,
            assemblerConfig,
            riggingConfig
          };
        }

        if (!json.metadata) throw new Error("Invalid Animato File");

        setLoadingText("REHYDRATING ASSETS...");

        const assetMap: Record<string, string> = {};
        const dimMap: Record<string, { w: number; h: number }> = {};

        if (json.assets) {
          const entries = Object.entries(json.assets);
          await Promise.all(
            entries.map(async ([id, base64]) => {
              const blob = dataURItoBlob(base64 as string);
              if (blob) {
                const url = URL.createObjectURL(blob);
                await new Promise((res) => {
                  const img = new Image();
                  img.onload = () => {
                    dimMap[id] = { w: img.width, h: img.height };
                    res(null);
                  };
                  img.onerror = () => {
                    console.warn(
                      "Failed to load asset during rehydration:",
                      id,
                    );
                    res(null);
                  };
                  img.src = url;
                });
                assetMap[id] = url;
              }
            }),
          );
        }

        const newCharacter: CharacterComposition = {};
        const { assemblerConfig, riggingConfig } = json;

        Object.entries(assemblerConfig as Record<string, any>).forEach(
          ([partId, config]) => {
            const restoredTransform = config.transform
              ? {
                  x: sf(config.transform.x),
                  y: sf(config.transform.y),
                  scaleX: sf(config.transform.scaleX, 1),
                  scaleY: sf(config.transform.scaleY, 1),
                  rotation: sf(config.transform.rotation),
                  anchorX: sf(config.transform.anchorX, 50),
                  anchorY: sf(config.transform.anchorY, 50),
                }
              : DEFAULT_TRANSFORM;

            let finalWidth = sf(config.width);
            let finalHeight = sf(config.height);
            if (config.assetId && dimMap[config.assetId]) {
              finalWidth = dimMap[config.assetId].w;
              finalHeight = dimMap[config.assetId].h;
            }

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
              transform: restoredTransform,
              baseTransform: config.baseTransform
                ? { ...config.baseTransform }
                : { ...restoredTransform },
              imageUrl: config.assetId ? assetMap[config.assetId] : null,
              width: finalWidth,
              height: finalHeight,
              bones: sanitizedBones,
            };
          },
        );

        const extractedVisemeMap: Record<VisemeShape, string | null> = {
          [VisemeShape.REST]: null,
          [VisemeShape.AI]: null,
          [VisemeShape.E]: null,
          [VisemeShape.O]: null,
          [VisemeShape.U]: null,
          [VisemeShape.FV]: null,
          [VisemeShape.L]: null,
          [VisemeShape.MBP]: null,
          [VisemeShape.CONS]: null,
        };
        Object.values(newCharacter).forEach((part) => {
          if ((part.tags.includes("Viseme") || (part.tags.includes("Mouth") && part.tags.includes(VisemeShape.REST))) && part.imageUrl) {
            const shape = part.tags.find((t) =>
              Object.values(VisemeShape).includes(t as VisemeShape),
            ) as VisemeShape | undefined;
            if (shape) extractedVisemeMap[shape] = part.imageUrl;
          }
        });

        if (!newCharacter["root"]) {
          newCharacter["root"] = createPart("root", "Root", null, 0, {
            isGroup: true,
            isOpen: true,
          });
        }

        const autoChar = autoCalculatePivots(newCharacter);
        setCharacter(autoChar);
        setLocalVisemeMap(extractedVisemeMap);
        setActivePartId("root");
        triggerToast("IMPORT SUCCESSFUL");
      } catch (err: any) {
        log(`Error: ${err.message}`);
        triggerToast("IMPORT FAILED");
      } finally {
        setIsLoading(false);
        if (e && e.target) e.target.value = "";
      }
    };

    setTimeout(() => {
      const reader = new FileReader();
      reader.onload = async (event) => {
        setLoadingText("PARSING SCENE...");

        setTimeout(async () => {
          try {
            const text = event.target?.result as string;
            const jsonVal = JSON.parse(text);
            await processJson(jsonVal);
          } catch (err: any) {
            log(`Error: ${err.message}`);
            triggerToast("IMPORT FAILED");
            setIsLoading(false);
            if (e && e.target) e.target.value = "";
          }
        }, 50);
      };

      reader.onerror = () => setIsLoading(false);
      reader.readAsText(file);
    }, 50);
  };

  const toggleVisibility = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setCharacter((prev) => {
      const part = prev[id];
      const willBeVisible = !(part.isVisible ?? true);
      const isView = part.tags.includes('View');

      const next = { ...prev };
      next[id] = { ...part, isVisible: willBeVisible };

      if (isView && willBeVisible) {
        // Hide all other views
        Object.keys(next).forEach((k) => {
          if (k !== id && next[k].tags.includes('View')) {
            next[k] = { ...next[k], isVisible: false };
          }
        });
      }

      return next;
    });
  };
  const toggleOpen = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setCharacter((prev) => ({
      ...prev,
      [id]: { ...prev[id], isOpen: !prev[id].isOpen },
    }));
  };
  const handleRename = (id: string, newLabel: string) => {
    if (newLabel.trim()) {
      setCharacter((prev) => ({
        ...prev,
        [id]: { ...prev[id], label: newLabel },
      }));
    }
    setRenamingId(null);
  };
  const handleCreate = (type: "group" | "layer") => {
    const newId = `${type}_${Date.now()}`;
    let parentId = "root";
    const active = character[activePartId];
    if (active) {
      if (active.isGroup) parentId = active.id;
      else if (active.parentId) parentId = active.parentId;
    }
    const newPart = createPart(
      newId,
      type === "group" ? "New Group" : "New Layer",
      parentId,
      10,
      { isGroup: type === "group", children: [], isOpen: true },
    );
    setCharacter((prev) => {
      const next = { ...prev, [newId]: newPart };
      if (next[parentId]) {
        next[parentId] = {
          ...next[parentId],
          children: [...next[parentId].children, newId],
          isOpen: true,
        };
      }
      return next;
    });
    setRenamingId(newId);
    setActivePartId(newId);
  };
  const handleDelete = (id: string) => {
    if (id === "root") {
      triggerToast("Cannot delete root");
      return;
    }
    setCharacter((prev) => {
      const next = { ...prev };
      const deletePart = (partId: string) => {
        const part = next[partId];
        if (!part) return;
        if (part.children) {
          [...part.children].forEach((childId) => deletePart(childId));
        }
        delete next[partId];
      };
      const part = next[id];
      if (part && part.parentId && next[part.parentId]) {
        next[part.parentId] = {
          ...next[part.parentId],
          children: next[part.parentId].children.filter((cid) => cid !== id),
        };
      }
      deletePart(id);
      return next;
    });
    if (activePartId === id) setActivePartId("root");
  };
  const handleDragStart = (e: React.DragEvent, id: string) => {
    e.stopPropagation();
    setDraggedId(id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
  };
  const handleDragOver = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!draggedId || draggedId === targetId) return;

    // Prevent infinite loop if data became corrupted
    let current = character[targetId];
    let depthLimit = 0;
    while (current && current.parentId && depthLimit < 100) {
      if (current.parentId === draggedId) return;
      current = character[current.parentId];
      depthLimit++;
    }

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const y = e.clientY - rect.top;
    const h = rect.height;
    const isGroup = character[targetId]?.isGroup;

    let position: "above" | "below" | "inside";
    if (y < h * 0.25) {
      position = "above";
    } else if (y > h * 0.75) {
      position = "below";
    } else {
      if (isGroup) position = "inside";
      else position = "below";
    }

    setDropTarget((prev) => {
      if (prev && prev.id === targetId && prev.position === position)
        return prev;
      return { id: targetId, position };
    });
  };
  const handleDrop = (e: React.DragEvent) => {
    try {
      e.preventDefault();
      e.stopPropagation();
      if (!draggedId || !dropTarget) {
        setDraggedId(null);
        setDropTarget(null);
        return;
      }
      const { id: targetId, position } = dropTarget;
      if (draggedId === targetId) return;

      // Cycle check
      let current = character[targetId];
      let depthLimit = 0;
      while (current && current.parentId && depthLimit < 100) {
        if (current.parentId === draggedId) {
          setDraggedId(null);
          setDropTarget(null);
          return;
        }
        current = character[current.parentId];
        depthLimit++;
      }

      setCharacter((prev) => {
        try {
          const next = { ...prev };
          const movedPart = { ...next[draggedId] };
          if (!movedPart) return prev;

          const oldParentId = movedPart.parentId;
          if (oldParentId && next[oldParentId]) {
            next[oldParentId] = {
              ...next[oldParentId],
              children: (next[oldParentId].children || []).filter(
                (id) => id !== draggedId,
              ),
            };
          }

          if (position === "inside") {
            const target = next[targetId];
            movedPart.parentId = targetId;
            next[targetId] = {
              ...target,
              children: [draggedId, ...(target.children || [])],
              isOpen: true,
            };
          } else {
            const target = next[targetId];
            const newParentId = target.parentId;
            if (!newParentId || !next[newParentId]) {
              // If trying to move to root level above/below another root level part
              if (target.parentId === null) {
                // Find root parts and reorder
                // Actually root siblings are not explicitly tracked in a parent's children unless root is special
                // But here every part has a parentId, even if it's 'root'.
                return prev;
              }
              return prev;
            }
            movedPart.parentId = newParentId;
            const parent = next[newParentId];
            const siblings = [...(parent.children || [])];
            const targetIndex = siblings.indexOf(targetId);
            const insertIndex =
              position === "above" ? targetIndex : targetIndex + 1;
            siblings.splice(insertIndex, 0, draggedId);
            next[newParentId] = { ...parent, children: siblings };
          }
          next[draggedId] = movedPart;
          return next;
        } catch (err) {
          console.error("Drop state update error", err);
          return prev;
        }
      });
    } catch (err) {
      console.error("Handle drop error", err);
    } finally {
      setDraggedId(null);
      setDropTarget(null);
    }
  };

  // CRITICAL FIX: Explicitly ensure width/height are preserved during update to prevent canvas resize flicker
  const handleUpdateActivePart = useCallback(
    (updates: Partial<CharacterPart>) => {
      setCharacter((prev) => {
        const oldPart = prev[activePartId];
        return {
          ...prev,
          [activePartId]: {
            ...oldPart,
            ...updates,
          },
        };
      });
    },
    [activePartId],
  );

  // --- RECURSIVE TREE RENDERER ---
  const renderHierarchyItem = (partId: string, depth: number = 0) => {
    if (depth > 50) return null;
    const part = character[partId];
    if (!part) return null;
    if (part.tags.includes("Viseme")) return null;
    const isSelected = activePartId === partId;
    const isRenaming = renamingId === partId;
    const isDragging = draggedId === partId;
    const isDropTarget = dropTarget?.id === partId;
    const dropPos = dropTarget?.position;
    const isVisible = part.isVisible ?? true;
    const hasChildren = part.children.length > 0;

    return (
      <div key={partId} className="relative group">
        {isDropTarget && dropPos === "above" && (
          <div className="absolute top-0 left-0 right-0 h-0.5 bg-cyan-500 z-50" />
        )}
        {isDropTarget && dropPos === "below" && (
          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-cyan-500 z-50" />
        )}
        <div
          draggable={partId !== "root"}
          onDragStart={(e) => handleDragStart(e, partId)}
          onDragOver={(e) => handleDragOver(e, partId)}
          onDrop={handleDrop}
          onClick={() => {
            setActivePartId(partId);
          }}
          onPointerDown={() => {
            const timer = setTimeout(() => {
              if (selectedPartIds.includes(partId)) {
                setSelectedPartIds(
                  selectedPartIds.filter((id) => id !== partId),
                );
              } else {
                setSelectedPartIds([...selectedPartIds, partId]);
              }
            }, 500);
            setLongPressTimer(timer);
          }}
          onPointerMove={() => {
            if (longPressTimer) {
              clearTimeout(longPressTimer);
              setLongPressTimer(null);
            }
          }}
          onPointerCancel={() => {
            if (longPressTimer) {
              clearTimeout(longPressTimer);
              setLongPressTimer(null);
            }
          }}
          onPointerUp={() => {
            if (longPressTimer) {
              clearTimeout(longPressTimer);
              setLongPressTimer(null);
            }
          }}
          className={`flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer transition-all border border-transparent ${isSelected ? "bg-cyan-900/20 text-cyan-400 border-cyan-500/30" : "hover:bg-white/5 text-gray-400 hover:text-white"} ${isDragging ? "opacity-50" : ""} ${isDropTarget && dropPos === "inside" ? "bg-cyan-500/20 border-cyan-500" : ""}`}
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          <button
            onClick={(e) => (hasChildren ? toggleOpen(partId, e) : null)}
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
              size={14}
              className={part.isOpen ? "text-amber-400" : "text-amber-600"}
              fill={part.isOpen ? "currentColor" : "none"}
            />
          ) : (
            <div className="w-3 h-3 rounded-sm bg-gray-600 border border-gray-500" />
          )}
          {isRenaming ? (
            <input
              autoFocus
              type="text"
              defaultValue={part.label || ""}
              onBlur={(e) => handleRename(partId, e.target.value)}
              onKeyDown={(e) =>
                e.key === "Enter" && handleRename(partId, e.currentTarget.value)
              }
              onClick={(e) => e.stopPropagation()}
              className="flex-1 min-w-0 bg-[#111] border border-cyan-500/50 rounded px-1 py-0 text-xs text-white outline-none"
            />
          ) : (
            <span
              className="flex-1 min-w-0 truncate text-xs font-medium select-none"
              onDoubleClick={() => setRenamingId(partId)}
            >
              {part.label}
            </span>
          )}
          <div className="flex items-center gap-1 opacity-100 transition-opacity">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setRenamingId(partId);
              }}
              className="p-1 hover:text-cyan-400 rounded hover:bg-white/10"
              title="Rename"
            >
              <Edit2 size={10} />
            </button>
            <button
              onClick={(e) => toggleVisibility(partId, e)}
              className={`p-1 rounded hover:bg-white/10 ${isVisible ? "text-gray-500 hover:text-white" : "text-gray-600"}`}
              title={isVisible ? "Hide" : "Show"}
            >
              {isVisible ? <Eye size={12} /> : <EyeOff size={12} />}
            </button>
            {partId !== "root" && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(partId);
                }}
                className="p-1 rounded hover:bg-white/10 text-gray-500 hover:text-red-400"
                title="Delete"
              >
                <Trash2 size={12} />
              </button>
            )}
          </div>
          <div className="cursor-grab active:cursor-grabbing text-gray-600 hover:text-gray-400 md:hidden">
            <GripVertical size={12} />
          </div>
        </div>
        {part.isOpen && part.children.length > 0 && (
          <div className="relative">
            <div
              className="absolute left-[12px] top-0 bottom-0 w-px bg-white/5"
              style={{ left: `${depth * 12 + 15}px` }}
            />
            {part.children.map((childId) =>
              renderHierarchyItem(childId, depth + 1),
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-[500] bg-black backdrop-blur-[60px] flex flex-col text-gray-200 animate-in fade-in duration-300">
      <Suspense
        fallback={
          isLoading || isSaving ? (
            <LoadingScreen
              message={isSaving ? "GENERATING THUMBNAIL..." : loadingText}
              logs={logsRef.current}
              onCancel={() => setIsLoading(false)}
            />
          ) : (
            <LoadingScreen onCancel={() => setIsLoading(false)} />
          )
        }
      >
        {(isLoading || isSaving) && (
          <LoadingScreen
            message={isSaving ? "GENERATING THUMBNAIL..." : loadingText}
            logs={logsRef.current}
            onCancel={() => setIsLoading(false)}
          />
        )}
        {isAssemblerOpen && (
          <CharacterPackImporter
            onClose={() => {
              setIsAssemblerOpen(false);
              setAssemblerFile(null);
            }}
            baseRig={character}
            onImplement={(newChar, newVisemeMap) => {
              handleAssemblerImplement(newChar, newVisemeMap);
              setAssemblerFile(null);
            }}
            savedSession={assemblerSession}
            onSaveSession={onSaveAssemblerSession}
            currentVisemeMap={visemeMap}
            initialFile={assemblerFile}
          />
        )}
        {isDesignerOpen && (
          <CharacterDesigner
            onClose={() => setIsDesignerOpen(false)}
            onSave={handleDesignerSave}
            initialCharacter={character}
          />
        )}
      </Suspense>



      {showDebug && (
        <DebugConsole
          logs={logsRef.current}
          onClose={() => setShowDebug(false)}
          clearLogs={() => {
            logsRef.current = [];
            setLogTick((t) => t + 1);
          }}
        />
      )}

      <input
        type="file"
        ref={rigImportInputRef}
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          opacity: 0,
          pointerEvents: "auto",
        }}
        onClick={(e) => {
          e.currentTarget.value = "";
        }}
        onChange={importRiggedCharacter}
      />

      <header className="h-14 border-b border-white/5 bg-[#0a0a0a] flex items-center justify-between px-4 z-50 shrink-0 shadow-lg relative">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-cyan-900/20 border border-cyan-500/30 rounded flex items-center justify-center">
            <UserCog size={18} className="text-cyan-400" />
          </div>
          <div>
            <h2 className="text-xs font-black tracking-[0.2em] text-cyan-500">
              {t("DESIGN STUDIO")}
            </h2>
            <p className="text-[9px] text-gray-500 font-mono tracking-wide hidden sm:block">
              {t("PROFESSIONAL EDITION")}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <button
            onClick={() => setShowDebug(!showDebug)}
            className={`p-1.5 rounded hover:bg-white/10 transition-colors ${showDebug ? "text-amber-500 bg-amber-500/10" : "text-gray-500"}`}
            title={t("Show Debug Logs")}
          >
            <Terminal size={14} />
          </button>
          <button
            onClick={() => setIsToolsMenuOpen(!isToolsMenuOpen)}
            className={`flex items-center gap-2 px-4 py-2 rounded-full transition-all group ${isToolsMenuOpen ? "bg-cyan-500 text-black" : "bg-white/5 hover:bg-white/10 border border-white/5"}`}
          >
            <Layout
              size={14}
              className={isToolsMenuOpen ? "text-black" : "text-cyan-500"}
            />
            <span
              className={`text-[10px] font-bold tracking-widest ${isToolsMenuOpen ? "text-black" : "text-gray-300"}`}
            >
              {t("STUDIO TOOLS")}
            </span>
            <ChevronDown
              size={12}
              className={`transition-transform ${isToolsMenuOpen ? "rotate-180 text-black" : "text-gray-500"}`}
            />
          </button>

          <button
            onClick={onClose}
            className="p-2 hover:bg-white/10 rounded-full text-gray-500 hover:text-white transition-colors ml-2"
            title={t("Close Designer Studio")}
          >
            <X size={20} />
          </button>
        </div>

        {isToolsMenuOpen && (
          <div className="absolute top-full left-0 right-0 z-[60] bg-[#0a0a0a]/95  border-b border-white/10 shadow-2xl animate-in slide-in-from-top-2 duration-200">
            <div className="max-w-screen-lg mx-auto w-full">
              <div className="p-4 flex items-center justify-between border-b border-white/5 bg-white/5">
                <span className="text-[10px] font-black tracking-widest text-gray-400 uppercase flex items-center gap-2">
                  <Settings size={12} className="text-cyan-500" />{" "}
                  {t("CONFIGURE WORKSPACE")}
                </span>
                <button
                  onClick={() => setIsToolsMenuOpen(false)}
                  className="p-1.5 hover:bg-white/10 rounded-full text-gray-400 hover:text-white transition-colors"
                >
                  <X size={14} />
                </button>
              </div>

              <div className="p-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 overflow-y-auto max-h-[50vh] custom-scrollbar">
                <button
                  disabled={lockTool && initialTool !== "ASSEMBLER"}
                  onClick={() => {
                    setIsAssemblerOpen(true);
                    setIsToolsMenuOpen(false);
                  }}
                  className={`flex items-center gap-4 p-4 rounded-lg transition-colors group text-left border border-transparent ${lockTool && initialTool !== "ASSEMBLER" ? "opacity-30 cursor-not-allowed" : "hover:bg-white/5 hover:border-white/5"}`}
                >
                  <div className="w-10 h-10 bg-cyan-900/10 border border-cyan-500/20 rounded-lg flex items-center justify-center group-hover:border-cyan-400/50 transition-colors">
                    <Folder size={20} className="text-cyan-400" />
                  </div>
                  <div>
                    <h3 className="text-xs font-bold text-white mb-0.5 tracking-wide group-hover:text-cyan-400 transition-colors">
                      {t("CHARACTER ASSEMBLER")}
                    </h3>
                    <p className="text-[9px] text-gray-500">
                      {t("Import parts and assemble layers.")}
                    </p>
                  </div>
                </button>

                <button
                  disabled={true}
                  className={`flex items-center gap-4 p-4 rounded-lg transition-colors group text-left border border-transparent`}
                >
                  <div className="w-10 h-10 bg-purple-900/10 border border-purple-500/20 rounded-lg flex items-center justify-center transition-colors relative">
                    <Edit2 size={20} className="text-purple-400" />
                    <div className="absolute -top-1 -right-1 bg-cyan-500 text-black text-[7px] font-black px-1 rounded-sm uppercase tracking-wider">
                      Soon
                    </div>
                  </div>
                  <div className="opacity-50">
                    <h3 className="text-xs font-bold text-white mb-0.5 tracking-wide transition-colors">
                      {t("DESIGN YOUR CHARACTER")} (COMING SOON)
                    </h3>
                    <p className="text-[9px] text-gray-500">
                      {t("Draw character parts in layers.")}
                    </p>
                  </div>
                </button>

                <button
                  disabled={lockTool && initialTool !== "IMPORTER"}
                  onClick={handleImportClick}
                  className={`flex items-center gap-4 p-4 rounded-lg transition-colors group text-left border border-transparent ${lockTool && initialTool !== "IMPORTER" ? "opacity-30 cursor-not-allowed" : "hover:bg-white/5 hover:border-white/5"}`}
                >
                  <div className="w-10 h-10 bg-white/5 border border-white/10 rounded-lg flex items-center justify-center group-hover:bg-white/10 transition-colors">
                    <Upload
                      size={20}
                      className="text-gray-400 group-hover:text-white"
                    />
                  </div>
                  <div>
                    <h3 className="text-xs font-bold text-white mb-0.5 tracking-wide group-hover:text-gray-300 transition-colors">
                      {t("IMPORT CONFIG OR PSD")}
                    </h3>
                    <p className="text-[9px] text-gray-500 mb-1">
                      {t("Load .psd, .animato, .onyx or .json file.")}
                    </p>
                    <p className="text-[8px] text-cyan-500/70 leading-tight">
                      {t("Tip: Draw all mouth shapes in identical dimensions/bounds inside a 'Mouth' folder for perfect lip sync alignment. Name them REST, AI, O, E, etc.")}
                    </p>
                  </div>
                </button>
              </div>
            </div>
          </div>
        )}
      </header>

      <div className="flex-1 flex overflow-hidden relative">
        <div
          className={`z-40 w-full sm:w-72 bg-[#111111] border-r border-white/10 flex flex-col transition-transform transform-gpu will-change-transform duration-300 ${isDesktopLike ? "relative translate-x-0" : "absolute inset-y-0 left-0"} ${!isDesktopLike && mobilePanel === "hierarchy" ? "translate-x-0" : !isDesktopLike ? "-translate-x-full" : ""} md:relative md:translate-x-0`}
        >
          <div className="p-3 border-b border-white/10 flex justify-between items-center bg-white/5">
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2">
              <Layers size={12} /> {t("HIERARCHY")}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleCreate("group")}
                className="p-1 hover:bg-white/10 rounded text-gray-400 hover:text-white"
                title={t("New Group")}
              >
                <FolderPlus size={14} />
              </button>
              <button
                onClick={() => handleCreate("layer")}
                className="p-1 hover:bg-white/10 rounded text-gray-400 hover:text-white"
                title={t("New Layer")}
              >
                <FilePlus size={14} />
              </button>
              <button
                onClick={() => {
                  setDesktopLeftPanel(false);
                  setMobilePanel(null);
                }}
                className="md:hidden p-1 hover:bg-white/10 rounded"
              >
                <X size={14} />
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto transform-gpu custom-scrollbar p-2 space-y-0.5">
            {renderHierarchyItem("root")}
          </div>
        </div>

        <div className="flex-1 relative bg-[#050505] flex flex-col overflow-hidden">
          <div className="absolute top-4 left-4 z-30 flex flex-col gap-2">
            <button
              onClick={() => setDesktopLeftPanel(!desktopLeftPanel)}
              className={`p-2 bg-[#151515] border border-white/10 rounded-lg text-gray-400 hover:text-white transition-all ${isDesktopLike ? "md:block" : "hidden md:block"} ${!desktopLeftPanel ? "bg-cyan-900/20 text-cyan-400 border-cyan-500/30" : ""}`}
              title={t("Toggle Hierarchy")}
            >
              <PanelLeftOpen size={18} />
            </button>
          </div>

          <div
            ref={containerRef}
            className="flex-1 relative overflow-visible flex items-center justify-center p-4 md:p-8"
          >
            <div
              className="relative shadow-2xl transition-all duration-300 pointer-events-none select-none transform-gpu will-change-transform"
              style={{
                width: 500,
                height: 500,
                transform: `scale(${stageScale})`,
              }}
            >
              <div ref={stageRef} style={{ width: "100%", height: "100%" }}>
                <CharacterStage
                  viseme={{
                    shape: VisemeShape.REST,
                    intensity: 0,
                    openness: 0,
                    spread: 0,
                    squeeze: 1,
                  }}
                  visemeMap={visemeMap}
                  character={character}
                  activePartId={activePartId}
                  showAnchors={true}
                  theme="dark"
                  onAnchorChange={(partId, x, y) => {
                    setCharacter((prev) => {
                      const part = prev[partId];
                      if (!part) return prev;

                      // Recalculate position to avoid jumping (compensate for anchor shift)
                      const t = part.transform;
                      const pos = compensateAnchorShift(
                        t.x, t.y, t.rotation, t.scaleX, t.scaleY, !!t.flipX, !!t.flipY,
                        t.anchorX, t.anchorY, x, y,
                        part.width || 150, part.height || 150
                      );

                      return {
                        ...prev,
                        [partId]: {
                          ...part,
                          transform: {
                            ...t,
                            x: pos.x,
                            y: pos.y,
                            anchorX: x,
                            anchorY: y,
                          },
                        },
                      };
                    });
                  }}
                />
              </div>
              <div className="absolute inset-0 border border-white/5 pointer-events-none rounded-lg"></div>
            </div>
          </div>
        </div>

        <div
          className={`z-40 w-full sm:w-72 bg-[#111111] border-l border-white/10 flex flex-col transition-transform transform-gpu will-change-transform duration-300 ${isDesktopLike ? "relative translate-x-0" : "absolute inset-y-0 right-0"} ${!isDesktopLike && mobilePanel === "inspector" ? "translate-x-0" : !isDesktopLike ? "translate-x-full" : ""} md:relative md:translate-x-0 h-full overflow-hidden rounded-tl-2xl rounded-bl-2xl`}
        >
          <div className="p-3 border-b border-white/10 flex justify-between items-center bg-white/5 shrink-0">
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2">
              <Sliders size={12} /> {t("PROPERTIES")}
            </span>
            <button
              onClick={() => {
                setDesktopRightPanel(false);
                setMobilePanel(null);
              }}
              className="md:hidden p-1 hover:bg-white/10 rounded"
            >
              <X size={14} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto transform-gpu custom-scrollbar p-4 space-y-6 rounded-bl-2xl">
            <div className="space-y-4">
              <label className="text-[9px] font-bold text-gray-500 uppercase">
                {t("Identity")}
              </label>
              <div className="space-y-2">
                <div className="flex justify-between items-center text-xs text-gray-300 bg-[#111] p-2 rounded border border-white/5">
                  <span className="text-gray-500">{t("ID")}</span>
                  <span className="font-mono text-[10px]">{activePartId}</span>
                </div>
                <input
                  type="text"
                  value={activePart?.label || ""}
                  onChange={(e) => handleRename(activePartId, e.target.value)}
                  className="w-full bg-[#111] border border-white/10 rounded px-3 py-2 text-xs text-white focus:border-cyan-500 outline-none transition-colors"
                  placeholder={t("Layer Label")}
                />
              </div>
            </div>

            <div className="space-y-4">
              <label className="text-[9px] font-bold text-gray-500 uppercase">
                {t("Transform")}
              </label>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <span className="text-[8px] text-gray-500">{t("POS X")}</span>
                  <input
                    type="number"
                    value={activePart?.transform.x ?? 0}
                    onChange={(e) =>
                      setCharacter((prev) => ({
                        ...prev,
                        [activePartId]: {
                          ...prev[activePartId],
                          transform: {
                            ...prev[activePartId].transform,
                            x: parseFloat(e.target.value),
                          },
                        },
                      }))
                    }
                    className="w-full bg-[#111] border border-white/10 rounded px-2 py-1.5 text-xs text-white"
                  />
                </div>
                <div className="space-y-1">
                  <span className="text-[8px] text-gray-500">{t("POS Y")}</span>
                  <input
                    type="number"
                    value={activePart?.transform.y ?? 0}
                    onChange={(e) =>
                      setCharacter((prev) => ({
                        ...prev,
                        [activePartId]: {
                          ...prev[activePartId],
                          transform: {
                            ...prev[activePartId].transform,
                            y: parseFloat(e.target.value),
                          },
                        },
                      }))
                    }
                    className="w-full bg-[#111] border border-white/10 rounded px-2 py-1.5 text-xs text-white"
                  />
                </div>
                <div className="space-y-1">
                  <span className="text-[8px] text-gray-500">
                    {t("SCALE X")}
                  </span>
                  <input
                    type="number"
                    step="0.1"
                    value={activePart?.transform.scaleX ?? 1}
                    onChange={(e) =>
                      setCharacter((prev) => ({
                        ...prev,
                        [activePartId]: {
                          ...prev[activePartId],
                          transform: {
                            ...prev[activePartId].transform,
                            scaleX: parseFloat(e.target.value),
                          },
                        },
                      }))
                    }
                    className="w-full bg-[#111] border border-white/10 rounded px-2 py-1.5 text-xs text-white"
                  />
                </div>
                <div className="space-y-1">
                  <span className="text-[8px] text-gray-500">
                    {t("SCALE Y")}
                  </span>
                  <input
                    type="number"
                    step="0.1"
                    value={activePart?.transform.scaleY ?? 1}
                    onChange={(e) =>
                      setCharacter((prev) => ({
                        ...prev,
                        [activePartId]: {
                          ...prev[activePartId],
                          transform: {
                            ...prev[activePartId].transform,
                            scaleY: parseFloat(e.target.value),
                          },
                        },
                      }))
                    }
                    className="w-full bg-[#111] border border-white/10 rounded px-2 py-1.5 text-xs text-white"
                  />
                </div>
                <div className="col-span-2 space-y-1">
                  <span className="text-[8px] text-gray-500">
                    {t("ROTATION")}
                  </span>
                  <input
                    type="number"
                    value={activePart?.transform.rotation ?? 0}
                    onChange={(e) =>
                      setCharacter((prev) => ({
                        ...prev,
                        [activePartId]: {
                          ...prev[activePartId],
                          transform: {
                            ...prev[activePartId].transform,
                            rotation: parseFloat(e.target.value),
                          },
                        },
                      }))
                    }
                    className="w-full bg-[#111] border border-white/10 rounded px-2 py-1.5 text-xs text-white"
                  />
                </div>
                <div className="col-span-2 flex gap-2 mt-2">
                  <button
                    onClick={() =>
                      setCharacter((prev) => {
                        if (!prev[activePartId]) return prev;
                        return {
                          ...prev,
                          [activePartId]: {
                            ...prev[activePartId],
                            transform: {
                              ...prev[activePartId].transform,
                              flipX: !prev[activePartId].transform.flipX,
                            },
                          },
                        };
                      })
                    }
                    className={`flex-1 py-1.5 rounded flex items-center justify-center gap-2 transition-colors text-[9px] font-bold ${activePart?.transform?.flipX ? "bg-cyan-500 text-black" : "bg-[#111] text-gray-400 border border-white/10 hover:border-cyan-500/50"}`}
                    title={t("Flip Horizontal")}
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M11 4L3 20H11V4Z" />
                      <path d="M13 4L21 20H13V4Z" />
                    </svg>
                    {t("FLIP X")}
                  </button>
                  <button
                    onClick={() =>
                      setCharacter((prev) => {
                        if (!prev[activePartId]) return prev;
                        return {
                          ...prev,
                          [activePartId]: {
                            ...prev[activePartId],
                            transform: {
                              ...prev[activePartId].transform,
                              flipY: !prev[activePartId].transform.flipY,
                            },
                          },
                        };
                      })
                    }
                    className={`flex-1 py-1.5 rounded flex items-center justify-center gap-2 transition-colors text-[9px] font-bold ${activePart?.transform?.flipY ? "bg-cyan-500 text-black" : "bg-[#111] text-gray-400 border border-white/10 hover:border-cyan-500/50"}`}
                    title={t("Flip Vertical")}
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M4 11L20 3V11H4Z" />
                      <path d="M4 13L20 21V13H4Z" />
                    </svg>
                    {t("FLIP Y")}
                  </button>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <label className="text-[9px] font-bold text-gray-500 uppercase">
                {t("Expression")}
              </label>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-[9px] font-bold text-gray-500">
                    {t("EYE SQUINT")}
                  </span>
                  <span className="text-[9px] font-mono text-cyan-400">
                    {characterFilters.eyeSquint ?? 0}%
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={characterFilters.eyeSquint ?? 0}
                  onChange={(e) =>
                    updateCharacterFilter(
                      "eyeSquint",
                      parseFloat(e.target.value),
                    )
                  }
                  className="w-full h-1 bg-white/10 rounded-full accent-cyan-500 touch-none"
                />
              </div>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-[9px] font-bold text-gray-500">
                    {t("PUPIL X")}
                  </span>
                  <span className="text-[9px] font-mono text-cyan-400">
                    {characterFilters.pupilX ?? 0}%
                  </span>
                </div>
                <input
                  type="range"
                  min="-100"
                  max="100"
                  value={characterFilters.pupilX ?? 0}
                  onChange={(e) =>
                    updateCharacterFilter("pupilX", parseFloat(e.target.value))
                  }
                  className="w-full h-1 bg-white/10 rounded-full accent-cyan-500 touch-none"
                />
              </div>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-[9px] font-bold text-gray-500">
                    {t("PUPIL Y")}
                  </span>
                  <span className="text-[9px] font-mono text-cyan-400">
                    {characterFilters.pupilY ?? 0}%
                  </span>
                </div>
                <input
                  type="range"
                  min="-100"
                  max="100"
                  value={characterFilters.pupilY ?? 0}
                  onChange={(e) =>
                    updateCharacterFilter("pupilY", parseFloat(e.target.value))
                  }
                  className="w-full h-1 bg-white/10 rounded-full accent-cyan-500 touch-none"
                />
              </div>
            </div>

            <div className="space-y-4">
              <label className="text-[9px] font-bold text-gray-500 uppercase">
                {t("Tags & Meta")}
              </label>
              <div className="flex flex-wrap gap-2 bg-[#111] p-2 rounded border border-white/5 min-h-[40px]">
                {activePart?.tags.map((tag) => (
                  <span
                    key={tag}
                    className="bg-cyan-900/20 text-cyan-400 border border-cyan-500/30 px-2 py-0.5 rounded text-[9px] font-bold"
                  >
                    {tag}
                  </span>
                ))}
                {activePart?.tags.length === 0 && (
                  <span className="text-[9px] text-gray-600 italic">
                    {t("No tags")}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="h-14 border-t border-white/5 bg-[#0a0a0a] flex justify-end items-center px-6 shrink-0 shadow-[0_-5px_20px_rgba(0,0,0,0.5)] z-50">
        <div className="flex gap-4">
          <button
            onClick={onClose}
            className="px-6 py-2 rounded-lg text-xs font-bold text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
          >
            {t("CANCEL")}
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className={`px-8 py-2 bg-cyan-500 hover:bg-cyan-400 text-black text-xs font-black tracking-wider rounded-lg shadow-[0_0_20px_rgba(6,182,212,0.2)] hover:shadow-[0_0_30px_rgba(6,182,212,0.4)] transition-all flex items-center gap-2 ${isSaving ? "opacity-50 cursor-wait" : ""}`}
          >
            {isSaving ? (
              <RefreshCcw size={16} className="animate-spin" />
            ) : (
              <Check size={16} />
            )}
            {isSaving ? "CAPTURING..." : "SAVE & APPLY"}
          </button>
        </div>
      </div>

      {/* Mobile Tabs */}
      <div className="md:hidden fixed bottom-16 left-1/2 -translate-x-1/2 bg-[#151515] border border-white/10 rounded-full p-1 flex gap-1 shadow-2xl z-[100]">
        <button
          onClick={() =>
            setMobilePanel(mobilePanel === "hierarchy" ? null : "hierarchy")
          }
          className={`p-3 rounded-full transition-colors ${mobilePanel === "hierarchy" ? "bg-cyan-500 text-black" : "text-gray-400 hover:text-white"}`}
        >
          <Layers size={18} />
        </button>
        <button
          onClick={() =>
            setMobilePanel(mobilePanel === "inspector" ? null : "inspector")
          }
          className={`p-3 rounded-full transition-colors border ${mobilePanel === "inspector" ? "bg-cyan-500 text-black border-cyan-500" : "bg-black/20 text-gray-400 hover:text-white hover:bg-black/40 border-white/10"}`}
        >
          <Sliders size={18} />
        </button>
      </div>

      {/* Loop Tuning Modal */}
      <AnimatePresence>
        {loopEditorLayers.length > 0 && selectedLoopId && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-md"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="bg-[#111] w-full max-w-lg rounded-2xl border border-cyan-500/30 shadow-[0_0_50px_rgba(6,182,212,0.1)] overflow-hidden flex flex-col"
            >
              <div className="p-6 border-b border-white/5 flex items-center justify-between">
                <h2 className="text-sm font-black text-white tracking-widest">
                  <RefreshCcw size={16} className="inline mr-2 text-cyan-400" />{" "}
                  {t("LOOP DETECTED")}
                </h2>
              </div>
              <div className="p-6 flex flex-col gap-6">
                <p className="text-xs text-gray-400 leading-relaxed">
                  {t(
                    'We detected folders labeled with "Loop". Configure their automatic animation speed base multipliers here.',
                  )}
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <div className="flex flex-wrap gap-2">
                      {loopEditorLayers.map((l) => (
                        <button
                          key={l.id}
                          className={`px-4 py-2 rounded-lg border text-xs font-bold transition-all ${selectedLoopId === l.id ? "bg-cyan-900/40 text-cyan-400 border-cyan-500" : "bg-black/50 text-gray-400 border-white/10 hover:border-white/20 hover:text-white"}`}
                          onClick={() => setSelectedLoopId(l.id)}
                        >
                          {l.label}
                        </button>
                      ))}
                    </div>

                    {selectedLoopId && character[selectedLoopId] && (
                      <div className="bg-white/5 p-4 rounded-xl border border-white/10 mt-4">
                        <div className="flex justify-between items-center mb-3">
                          <span className="text-xs font-bold text-gray-300">
                            {character[selectedLoopId].label} {t("Speed")}
                          </span>
                          <span className="text-xs font-mono text-cyan-400">
                            {character[selectedLoopId]?.loopSpeed ?? 1.0}x
                          </span>
                        </div>
                        <input
                          type="range"
                          min="0.1"
                          max="5.0"
                          step="0.1"
                          value={character[selectedLoopId]?.loopSpeed ?? 1.0}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value);
                            setCharacter((prev) => ({
                              ...prev,
                              [selectedLoopId]: { ...prev[selectedLoopId], loopSpeed: val },
                            }));
                          }}
                          className="w-full h-1.5 bg-black rounded-full accent-cyan-500 touch-none"
                        />
                        <div className="flex justify-between mt-2 text-[8px] text-gray-500 uppercase font-bold">
                          <span>{t("SLOWER (0.1x)")}</span>
                          <span>{t("DEFAULT (1.0x)")}</span>
                          <span>{t("FASTER (5.0x)")}</span>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="bg-black/60 rounded-xl border border-white/10 flex items-center justify-center p-4 min-h-[200px] overflow-hidden">
                      <div className="w-full h-full relative aspect-square scale-75">
                        <CharacterStage
                          viseme={{
                            shape: VisemeShape.REST,
                            intensity: 0,
                            openness: 0,
                            spread: 0,
                            squeeze: 1,
                          }}
                          visemeMap={visemeMap}
                          character={character}
                          theme="dark"
                        />
                      </div>
                  </div>
                </div>
              </div>
              <div className="p-4 bg-[#0a0a0a] border-t border-white/5 flex justify-end gap-3">
                <button
                  onClick={() => setLoopEditorLayers([])}
                  className="px-6 py-2 bg-cyan-500 hover:bg-cyan-400 text-black text-xs font-black tracking-wider rounded-lg shadow-[0_0_20px_rgba(6,182,212,0.2)] transition-all"
                >
                  <Check size={16} className="inline mr-2" />
                  {t("SAVE & PROCEED")}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default CharacterBuilder;
