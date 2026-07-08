import React, { useState, useEffect } from 'react';
import { Smartphone, X, Check, Loader2, Download, AlertCircle, Image as ImageIcon, Github, Globe, RefreshCcw } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { processGameDataAssets } from '../utils/exportUtils';

interface MobileAppModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectName: string;
  gameData: any;
  userEmail: string;
}

export const MobileAppModal: React.FC<MobileAppModalProps> = ({
  isOpen,
  onClose,
  projectName,
  gameData,
  userEmail
}) => {
  const [status, setStatus] = useState<'idle' | 'deploying' | 'preparing' | 'building' | 'success' | 'error'>('idle');
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [icon, setIcon] = useState<File | null>(null);
  const [iconPreview, setIconPreview] = useState<string | null>(null);
  const [apkUrl, setApkUrl] = useState<string | null>(null);
  const [repoFullName, setRepoFullName] = useState<string | null>(null);
  const [liveUrl, setLiveUrl] = useState<string | null>(null);
  const [buildRunId, setBuildRunId] = useState<number | null>(null);

  const addLog = (msg: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [...prev, `[${timestamp}] ${msg}`]);
  };

  useEffect(() => {
    if (isOpen) {
      checkInitialStatus();
    } else {
      resetState();
    }
  }, [isOpen]);

  const resetState = () => {
    setStatus('idle');
    setLogs([]);
    setError(null);
    setIcon(null);
    setIconPreview(null);
    setApkUrl(null);
    setRepoFullName(null);
    setLiveUrl(null);
    setBuildRunId(null);
  };

  const checkInitialStatus = async () => {
    try {
      const repoName = projectName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-_]/g, '');
      const res = await fetch('/api/github/check-repo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: userEmail, repoName })
      });
      const data = await res.json();
      if (data.exists) {
        setRepoFullName(data.repoFullName);
        try {
          const relRes = await fetch(`/api/github/latest-apk?email=${encodeURIComponent(userEmail)}&repoFullName=${encodeURIComponent(data.repoFullName)}`);
          if (relRes.ok) {
            const relData = await relRes.json();
            if (relData.apkUrl) setApkUrl(relData.apkUrl);
          }
        } catch(e) {}
      }
    } catch (err) {
      console.error("Error checking repo status:", err);
    }
  };

  const handleIconChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setIcon(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setIconPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const startWorkflow = async () => {
    if (!icon) {
      setError("Please upload an app icon first.");
      return;
    }

    setStatus('preparing');
    setLogs([]);
    setError(null);

    try {
      let currentLiveUrl = liveUrl;
      let currentRepoFullName = repoFullName;

      // 1. Ensure Deployed (Scenario B)
      if (!currentLiveUrl) {
        setStatus('deploying');
        addLog("Checking deployment status...");
        
        const repoName = projectName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-_]/g, '');
        
        // Create repo if not exists
        addLog("Ensuring GitHub repository exists...");
        const createRes = await fetch('/api/github/create-repo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: userEmail,
            name: repoName,
            description: `Mobile app for ${projectName}`
          })
        });
        const createData = await createRes.json();
        if (!createRes.ok) throw new Error(createData.error || "Failed to create repo");
        currentRepoFullName = createData.repo.full_name;
        setRepoFullName(currentRepoFullName);

        // Deploy files
        addLog("Deploying game to GitHub Pages...");
        const processedGameData = await processGameDataAssets(gameData);
        const deployRes = await fetch('/api/github/deploy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: userEmail,
            repoFullName: currentRepoFullName,
            gameData: processedGameData,
            commitMessage: "Deploy for mobile app conversion"
          })
        });
        const deployData = await deployRes.json();
        if (!deployRes.ok) throw new Error(deployData.error || "Deployment failed");
        
        currentLiveUrl = deployData.pagesUrl;
        setLiveUrl(currentLiveUrl);
        addLog(`Game deployed successfully to: ${currentLiveUrl}`);
      } else {
        addLog(`Using existing live URL: ${currentLiveUrl}`);
      }

      // 2. Trigger APK Build
      setStatus('building');
      addLog("Initializing Android APK build pipeline...");
      
      const iconBase64 = iconPreview?.split(',')[1];
      
      const buildRes = await fetch('/api/github/build-apk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: userEmail,
          repoFullName: currentRepoFullName,
          appName: projectName,
          appUrl: currentLiveUrl,
          iconBase64
        })
      });
      
      const buildData = await buildRes.json();
      if (!buildRes.ok) throw new Error(buildData.error || "Failed to trigger build");
      
      setBuildRunId(buildData.runId);
      addLog("GitHub Action triggered. Wrapping URL into Android WebView...");
      addLog("This process typically takes 3-5 minutes. Please stay on this page.");

      // 3. Poll for completion
      pollBuildStatus(currentRepoFullName!, buildData.runId);

    } catch (err: any) {
      console.error("APK Build failed:", err);
      setError(err.message || "An error occurred");
      setStatus('error');
    }
  };

  const pollBuildStatus = async (repo: string, runId: number) => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/github/build-status?email=${encodeURIComponent(userEmail)}&repoFullName=${encodeURIComponent(repo)}&runId=${runId}`);
        const data = await res.json();
        
        if (data.logs && data.logs.length > 0) {
          // Update logs with new ones from the workflow if possible
          // For simplicity we just show status
        }

        if (data.status === 'completed') {
          clearInterval(interval);
          if (data.conclusion === 'success') {
            setApkUrl(data.apkUrl);
            setStatus('success');
            addLog("APK Build completed successfully!");
          } else {
            setError(`Build failed with conclusion: ${data.conclusion}`);
            setStatus('error');
          }
        } else {
          addLog(`Build status: ${data.status}...`);
        }
      } catch (err) {
        console.warn("Polling error:", err);
      }
    }, 5000);
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[12000] flex items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="absolute inset-0 bg-black/90 backdrop-blur-md"
        />
        
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 20 }}
          className="relative w-full max-w-lg bg-[#0d0d0f] border border-white/10 rounded-[32px] overflow-hidden shadow-2xl flex flex-col"
        >
          {/* Header */}
          <div className="px-8 py-6 border-b border-white/5 flex items-center justify-between bg-zinc-950/50">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center shadow-lg shadow-emerald-500/5">
                <Smartphone size={24} />
              </div>
              <div>
                <h3 className="text-xl font-bold text-white tracking-tight">Convert to Mobile App</h3>
                <p className="text-xs text-zinc-500">Generate a native Android APK for your game</p>
              </div>
            </div>
            <button onClick={onClose} className="w-10 h-10 rounded-full hover:bg-white/5 flex items-center justify-center text-zinc-400 hover:text-white transition-all">
              <X size={20} />
            </button>
          </div>

          <div className="p-8">
            {status === 'idle' && (
              <div className="space-y-8">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-zinc-400 uppercase tracking-widest">App Identity</label>
                  </div>
                  <div className="bg-zinc-950/50 border border-white/5 rounded-2xl p-4 flex items-center gap-4">
                    <div className="w-16 h-16 rounded-2xl bg-zinc-900 flex items-center justify-center border border-white/5 overflow-hidden">
                      {iconPreview ? (
                        <img src={iconPreview} alt="App Icon" className="w-full h-full object-cover" />
                      ) : (
                        <ImageIcon className="text-zinc-700" size={32} />
                      )}
                    </div>
                    <div>
                      <div className="text-sm font-bold text-white">{projectName}</div>
                      <div className="text-[10px] text-zinc-500 uppercase tracking-wider font-mono">com.animato.{projectName.toLowerCase().replace(/\s+/g, '')}</div>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <label className="text-xs font-bold text-zinc-400 uppercase tracking-widest block">Upload App Icon (512x512)</label>
                  <div 
                    onClick={() => document.getElementById('icon-upload')?.click()}
                    className="w-full h-32 border-2 border-dashed border-white/10 rounded-2xl flex flex-col items-center justify-center gap-2 hover:border-emerald-500/30 hover:bg-emerald-500/5 transition-all cursor-pointer group"
                  >
                    <input 
                      id="icon-upload"
                      type="file" 
                      accept="image/*"
                      onChange={handleIconChange}
                      className="hidden"
                    />
                    <div className="w-10 h-10 rounded-full bg-zinc-900 flex items-center justify-center text-zinc-400 group-hover:text-emerald-400 transition-colors">
                      <ImageIcon size={20} />
                    </div>
                    <div className="text-xs text-zinc-500 group-hover:text-zinc-300">Click to select PNG or JPG icon</div>
                  </div>
                </div>

                {apkUrl ? (
                  <div className="flex gap-3">
                    <a 
                      href={apkUrl}
                      className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-4 rounded-2xl transition-all shadow-xl shadow-emerald-950/20 flex items-center justify-center gap-2"
                    >
                      <Download size={18} />
                      Download APK
                    </a>
                    <button 
                      onClick={startWorkflow}
                      disabled={!icon}
                      className="flex-1 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed text-white font-bold py-4 rounded-2xl transition-all shadow-xl flex items-center justify-center gap-2 border border-white/5"
                    >
                      <RefreshCcw size={18} />
                      Rebuild APK
                    </button>
                  </div>
                ) : (
                  <button 
                    onClick={startWorkflow}
                    disabled={!icon}
                    className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-30 disabled:cursor-not-allowed text-white font-bold py-4 rounded-2xl transition-all shadow-xl shadow-emerald-950/20 flex items-center justify-center gap-2"
                  >
                    <Smartphone size={18} />
                    Start APK Generation
                  </button>
                )}
              </div>
            )}

            {(status === 'deploying' || status === 'preparing' || status === 'building') && (
              <div className="space-y-8 py-4">
                <div className="flex flex-col items-center text-center space-y-6">
                  <div className="relative">
                    <div className="w-24 h-24 border-4 border-emerald-500/10 border-t-emerald-500 rounded-full animate-spin" />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <Smartphone className="text-emerald-400 animate-pulse" size={32} />
                    </div>
                  </div>
                  <div>
                    <h4 className="text-xl font-bold text-white mb-2">
                      {status === 'deploying' ? 'Deploying to Web...' : (status === 'preparing' ? 'Preparing Build...' : 'Building Android APK...')}
                    </h4>
                    <p className="text-zinc-500 text-sm max-w-xs mx-auto">
                      Generating a secure native wrapper for your game. This will take a few minutes.
                    </p>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between px-1">
                    <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Build Logs</span>
                    <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest animate-pulse">Running</span>
                  </div>
                  <div className="w-full h-40 bg-black/60 border border-white/5 rounded-2xl p-4 overflow-y-auto text-left font-mono text-[10px] space-y-1.5 custom-scrollbar">
                    {logs.map((log, i) => (
                      <div key={i} className="text-emerald-500/80">
                        {log}
                      </div>
                    ))}
                    <div className="animate-pulse text-emerald-500">_</div>
                  </div>
                </div>
              </div>
            )}

            {status === 'success' && (
              <div className="py-6 flex flex-col items-center text-center space-y-6">
                <div className="w-20 h-20 bg-emerald-500/20 text-emerald-400 rounded-3xl flex items-center justify-center shadow-lg shadow-emerald-500/10 animate-bounce-subtle">
                  <Check size={36} />
                </div>
                <div className="space-y-2">
                  <h4 className="text-2xl font-bold text-white tracking-tight">APK Ready for Download</h4>
                  <p className="text-zinc-400 text-sm max-w-sm mx-auto">
                    Your native Android application has been successfully compiled and signed.
                  </p>
                </div>

                <div className="w-full p-4 bg-zinc-950/50 border border-white/5 rounded-2xl text-left space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Build Artifact</span>
                    <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest">Signed Release</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-zinc-900 border border-white/5 flex items-center justify-center text-zinc-400">
                      <Smartphone size={20} />
                    </div>
                    <div>
                      <div className="text-xs font-bold text-white">{projectName}.apk</div>
                      <div className="text-[10px] text-zinc-500">Android Application Package</div>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-3 w-full">
                  <a 
                    href={apkUrl || '#'} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-4 rounded-2xl transition-all shadow-xl shadow-emerald-950/20"
                  >
                    <Download size={18} />
                    Download APK File
                  </a>
                  <button 
                    onClick={onClose}
                    className="w-full bg-zinc-800 hover:bg-zinc-700 text-zinc-400 font-bold py-4 rounded-2xl transition-all"
                  >
                    Close
                  </button>
                </div>
              </div>
            )}

            {status === 'error' && (
              <div className="py-2 flex flex-col items-center text-center space-y-6">
                <div className="w-16 h-16 bg-red-500/20 text-red-400 rounded-2xl flex items-center justify-center shadow-lg shadow-red-500/10">
                  <AlertCircle size={32} />
                </div>
                <div className="space-y-2 w-full">
                  <h4 className="text-xl font-bold text-white tracking-tight">Build Failed</h4>
                  <p className="text-red-400/80 text-xs p-3 bg-red-500/5 rounded-xl border border-red-500/10 mb-4">
                    {error}
                  </p>
                  
                  <div className="space-y-3 text-left">
                    <div className="flex items-center justify-between px-1">
                      <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Build History</span>
                      <button 
                        onClick={() => {
                          navigator.clipboard.writeText(logs.join('\n'));
                          addLog("Logs copied to clipboard!");
                        }}
                        className="text-[10px] font-bold text-emerald-500 hover:text-emerald-400 uppercase tracking-widest transition-colors"
                      >
                        Copy Logs
                      </button>
                    </div>
                    <div className="w-full h-40 bg-black/60 border border-white/5 rounded-2xl p-4 overflow-y-auto text-left font-mono text-[10px] space-y-1.5 custom-scrollbar">
                      {logs.map((log, i) => (
                        <div key={i} className="text-zinc-500">
                          {log}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="flex gap-3 w-full">
                  <button 
                    onClick={() => setStatus('idle')}
                    className="flex-1 bg-white/5 hover:bg-white/10 text-white font-bold py-4 rounded-2xl transition-all"
                  >
                    Try Again
                  </button>
                  <button 
                    onClick={onClose}
                    className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 font-bold py-4 rounded-2xl transition-all"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
