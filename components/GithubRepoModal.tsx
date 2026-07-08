import React, { useState, useEffect } from 'react';
import { Github, X, Check, Loader2, ExternalLink, Globe, Lock, AlertCircle, RotateCw, Smartphone, Monitor, Copy } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { processGameDataAssets } from '../utils/exportUtils';

interface GithubRepoModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectName: string;
  gameData: any;
  userEmail: string;
}

export const GithubRepoModal: React.FC<GithubRepoModalProps> = ({
  isOpen,
  onClose,
  projectName,
  gameData,
  userEmail
}) => {
  const [repoName, setRepoName] = useState(projectName.toLowerCase().replace(/\s+/g, '-'));
  const [description, setDescription] = useState('My awesome game created with Animato Studio');
  const [isPrivate, setIsPrivate] = useState(false);
  const [status, setStatus] = useState<'checking' | 'idle' | 'creating' | 'deploying' | 'success' | 'error'>('checking');
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [deployedUrl, setDeployedUrl] = useState<string | null>(null);
  const [repoFullName, setRepoFullName] = useState<string | null>(null);
  const [repoExists, setRepoExists] = useState(false);
  const [permissions, setPermissions] = useState<{ valid: boolean, errors: string[] } | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>('');
  const [iframeLoading, setIframeLoading] = useState(true);
  const [apkUrl, setApkUrl] = useState<string | null>(null);
  const [isBuildingAPK, setIsBuildingAPK] = useState(false);
  const [apkError, setApkError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      const initialRepoName = projectName.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-_]/g, '');
      setRepoName(initialRepoName);
      checkRepoExistence(initialRepoName);
    } else {
      setStatus('checking');
      setRepoExists(false);
      setRepoFullName(null);
      setPermissions(null);
      setPreviewUrl('');
    }
  }, [isOpen, projectName]);

  const checkRepoExistence = async (nameToCheck?: string) => {
    const activeName = nameToCheck || repoName;
    setStatus('checking');
    try {
      const res = await fetch('/api/github/check-repo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: userEmail, repoName: activeName })
      });
      const data = await res.json();
      if (data.exists) {
        setRepoExists(true);
        setRepoFullName(data.repoFullName);
        setPermissions(data.permissions || null);
      } else {
        setRepoExists(false);
        setPermissions(null);
      }
      setStatus('idle');
    } catch (err) {
      setStatus('idle');
    }
  };

  const handleDeploy = async () => {
    setStatus(repoExists ? 'deploying' : 'creating');
    setError(null);
    setLogs([]);
    try {
      let targetRepoFullName = repoFullName;

      if (!repoExists) {
        // 1. Create Repository
        const createRes = await fetch('/api/github/create-repo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: userEmail,
            name: repoName,
            description,
            isPrivate
          })
        });
        
        const createData = await createRes.json();
        if (!createRes.ok) {
          if (createData.logs) setLogs(createData.logs);
          throw new Error(createData.error || 'Failed to create repository');
        }
        targetRepoFullName = createData.repo.full_name;
        setRepoFullName(targetRepoFullName);
      }

      // 2. Deploy Files
      setStatus('deploying');
      
      // Convert any local/temporary browser blob URLs to base64 before deploying
      const processedGameData = await processGameDataAssets(gameData);

      const deployRes = await fetch('/api/github/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: userEmail,
          repoFullName: targetRepoFullName,
          gameData: processedGameData,
          commitMessage: repoExists ? `Update game via Animato Studio` : `Initial deployment of ${projectName}`
        })
      });

      const deployData = await deployRes.json();
      if (deployData.logs) setLogs(deployData.logs);
      
      if (!deployRes.ok) throw new Error(deployData.error || 'Failed to deploy files');

      setDeployedUrl(deployData.pagesUrl);
      setStatus('success');
      
      // Check for existing APK after successful deployment
      checkLatestAPK(targetRepoFullName || '');
    } catch (err: any) {
      console.error('Deployment error:', err);
      setError(err.message || 'An unexpected error occurred during deployment');
      setStatus('error');
    }
  };

  const copyLogs = () => {
    const logText = logs.join('\n');
    navigator.clipboard.writeText(logText);
  };

  const checkLatestAPK = async (fullName: string) => {
    try {
      const res = await fetch(`/api/github/latest-apk?email=${encodeURIComponent(userEmail)}&repoFullName=${encodeURIComponent(fullName)}`);
      const data = await res.json();
      if (data.apkUrl) {
        setApkUrl(data.apkUrl);
      }
    } catch (err) {
      console.error('Error checking latest APK:', err);
    }
  };

  const handleBuildAPK = async () => {
    if (!repoFullName) return;
    setIsBuildingAPK(true);
    setApkError(null);
    try {
      const res = await fetch('/api/github/build-apk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: userEmail,
          repoFullName: repoFullName,
          appName: projectName || 'AnimatoGame',
          appUrl: deployedUrl,
          // We could pass an icon here if we had a dedicated one, 
          // for now we'll let the server use the default or look for assets/icon.png
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to trigger APK build');
      
      setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] Android APK build triggered! (Run ID: ${data.runId})`]);
      setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] It will take 5-7 minutes to build. You can check the 'Actions' tab on GitHub.`]);
      
    } catch (err: any) {
      setApkError(err.message);
    } finally {
      setIsBuildingAPK(false);
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[11000] flex items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        />
        
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="relative w-full max-w-lg bg-zinc-900 border border-white/10 rounded-3xl overflow-hidden shadow-2xl"
        >
          {/* Header */}
          <div className="px-8 py-6 border-b border-white/5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-purple-500/20 text-purple-400 flex items-center justify-center">
                <Github size={20} />
              </div>
              <div>
                <h3 className="text-xl font-bold text-white">
                  {repoExists ? 'Update GitHub Page' : 'Deploy to GitHub'}
                </h3>
                <p className="text-xs text-gray-500">
                  {repoExists ? 'Push updates to your existing hosted game.' : 'Host your game on GitHub Pages or Vercel.'}
                </p>
              </div>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-full text-gray-400 transition-colors">
              <X size={20} />
            </button>
          </div>

          <div className="p-8">
            {status === 'checking' && (
               <div className="py-12 flex flex-col items-center justify-center space-y-4">
                 <Loader2 className="animate-spin text-purple-500" size={32} />
                 <p className="text-gray-400 font-medium">Checking repository status...</p>
               </div>
            )}

            {status === 'idle' && (
              <div className="space-y-6">
                {!repoExists ? (
                  <>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Repository Name</label>
                      <input 
                        type="text" 
                        value={repoName}
                        onChange={(e) => setRepoName(e.target.value.toLowerCase().replace(/\s+/g, '-'))}
                        onBlur={checkRepoExistence}
                        className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-purple-500/50 transition-colors"
                        placeholder="my-awesome-game"
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Description (Optional)</label>
                      <textarea 
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-purple-500/50 transition-colors h-24 resize-none"
                        placeholder="A professional game project..."
                      />
                    </div>

                    <div className="flex items-center gap-4">
                      <button 
                        onClick={() => setIsPrivate(false)}
                        className={`flex-1 flex items-center justify-center gap-2 p-4 rounded-2xl border-2 transition-all ${!isPrivate ? 'bg-purple-500/10 border-purple-500 text-white' : 'bg-transparent border-white/5 text-gray-500 hover:border-white/10'}`}
                      >
                        <Globe size={18} />
                        <div className="text-left">
                          <div className="text-sm font-bold">Public</div>
                          <div className="text-[10px] opacity-70">Anyone can see this repo</div>
                        </div>
                      </button>
                      <button 
                        onClick={() => setIsPrivate(true)}
                        className={`flex-1 flex items-center justify-center gap-2 p-4 rounded-2xl border-2 transition-all ${isPrivate ? 'bg-zinc-800 border-zinc-600 text-white' : 'bg-transparent border-white/5 text-gray-500 hover:border-white/10'}`}
                      >
                        <Lock size={18} />
                        <div className="text-left">
                          <div className="text-sm font-bold">Private</div>
                          <div className="text-[10px] opacity-70">Only you can see this repo</div>
                        </div>
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="bg-purple-500/10 border border-purple-500/20 rounded-2xl p-5 mb-4">
                    <h4 className="text-white font-bold mb-1">Update Existing Project</h4>
                    <p className="text-sm text-gray-400">
                      The repository <strong>{repoFullName}</strong> already exists. 
                      Click below to push your latest changes.
                    </p>
                    {repoFullName && (
                      <div className="mt-4 pt-4 border-t border-purple-500/20">
                        <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">GitHub Pages URL</label>
                        <div className="flex items-center gap-2 mt-1 bg-black/40 border border-white/10 rounded-xl px-4 py-3">
                          <input 
                            readOnly 
                            value={repoFullName.toLowerCase().split('/')[1].endsWith('.github.io') 
                                ? `https://${repoFullName.split('/')[1]}/`
                                : `https://${repoFullName.split('/')[0]}.github.io/${repoFullName.split('/')[1]}/`}
                            className="bg-transparent text-white text-xs w-full outline-none"
                          />
                          <button 
                            onClick={() => navigator.clipboard.writeText(repoFullName.toLowerCase().split('/')[1].endsWith('.github.io') 
                                ? `https://${repoFullName.split('/')[1]}/`
                                : `https://${repoFullName.split('/')[0]}.github.io/${repoFullName.split('/')[1]}/`)}
                            title="Copy URL"
                            className="text-purple-400 hover:text-purple-300 p-1 bg-white/5 rounded-md transition-colors"
                          >
                            <Copy size={16} />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {permissions && !permissions.valid && (
                  <div className="p-4 bg-red-500/5 border border-red-500/15 rounded-2xl text-[11px] space-y-2 text-left mb-4">
                    <div className="flex items-center gap-1.5 text-red-400 font-bold text-[10px] uppercase tracking-wider">
                      <AlertCircle size={13} className="text-red-400" />
                      Missing Repository Permissions
                    </div>
                    <p className="text-[10px] text-zinc-400 leading-relaxed">
                      Your connected GitHub token is missing crucial permissions for this repository:
                    </p>
                    <ul className="list-disc list-inside space-y-1 pl-1 text-[10px] text-zinc-300">
                      {permissions.errors.map((err, idx) => (
                        <li key={idx} className="leading-relaxed">{err}</li>
                      ))}
                    </ul>
                    <p className="text-[10px] text-zinc-500 leading-relaxed pt-1 border-t border-white/5">
                      To resolve this, please ensure your Classic PAT has the <strong className="text-zinc-400">repo</strong> scope, or your Fine-grained PAT has <strong className="text-zinc-400 font-semibold">Read & Write</strong> permissions enabled for Contents, Workflows, Pages, Actions, and Administration.
                    </p>
                  </div>
                )}

                <button 
                  onClick={handleDeploy}
                  disabled={!repoName.trim()}
                  className="w-full bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-4 rounded-2xl transition-all shadow-lg shadow-purple-900/20"
                >
                  {repoExists ? 'Update GitHub Page' : 'Create & Deploy'}
                </button>
              </div>
            )}

            {(status === 'creating' || status === 'deploying') && (
              <div className="py-12 flex flex-col items-center text-center space-y-6">
                <div className="relative">
                  <div className="w-20 h-20 border-4 border-purple-500/20 border-t-purple-500 rounded-full animate-spin" />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Github className="text-purple-400" size={32} />
                  </div>
                </div>
                <div>
                  <h4 className="text-xl font-bold text-white mb-2">
                    {status === 'creating' ? 'Creating Repository...' : (repoExists ? 'Updating Source Files...' : 'Pushing Source Files...')}
                  </h4>
                  <p className="text-gray-500 text-sm max-w-xs">
                    Please wait while we set up your professional GitHub environment.
                  </p>
                </div>
              </div>
            )}

            {status === 'success' && (
              <div className="py-6 flex flex-col items-center text-center space-y-4">
                <div className="w-16 h-16 bg-green-500/20 text-green-400 rounded-full flex items-center justify-center">
                  <Check size={32} />
                </div>
                <div className="w-full space-y-4">
                  <div>
                    <h4 className="text-xl font-bold text-white mb-2">
                      {repoExists ? 'Successfully Updated!' : 'Successfully Deployed!'}
                    </h4>
                    <p className="text-gray-400 text-sm max-w-sm mx-auto mb-4 bg-white/5 p-3 rounded-xl border border-white/10 text-left">
                      <strong>Vercel users:</strong> Your app will auto-deploy shortly.<br/>
                      {deployedUrl ? (
                        <><strong>GitHub Pages:</strong> It may take 1-3 minutes for the site to become available. If you see a 404, please wait and refresh.</>
                      ) : (
                        <><strong>GitHub Pages:</strong> Skipped because your token lacks 'workflow' scope. Deploy via Vercel or Netlify instead.</>
                      )}
                    </p>
                  </div>

                  {logs.length > 0 && (
                    <div className="w-full space-y-2">
                      <div className="flex items-center justify-between px-1">
                        <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Deployment Logs</span>
                        <button 
                          onClick={copyLogs}
                          className="text-[10px] font-bold text-purple-400 hover:text-purple-300 uppercase tracking-widest flex items-center gap-1 transition-colors"
                        >
                          Copy All Logs
                        </button>
                      </div>
                      <div className="w-full h-24 bg-black/60 border border-white/5 rounded-xl p-3 overflow-y-auto text-left font-mono text-[10px] space-y-1 custom-scrollbar">
                        {logs.map((log, i) => (
                          <div key={i} className={`${log.includes('error') ? 'text-red-400' : log.includes('warn') ? 'text-amber-400' : 'text-gray-400'}`}>
                            {log}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  <div className="space-y-3 w-full">
                    {deployedUrl && (
                      <div className="flex flex-col gap-3 w-full">
                        <div className="flex items-center gap-2 bg-black/40 border border-white/10 rounded-xl px-4 py-3">
                          <input 
                            readOnly 
                            value={deployedUrl} 
                            className="bg-transparent text-white text-xs w-full outline-none"
                          />
                          <button 
                            onClick={() => navigator.clipboard.writeText(deployedUrl)}
                            title="Copy URL"
                            className="text-purple-400 hover:text-purple-300 p-1 bg-white/5 rounded-md transition-colors"
                          >
                            <Copy size={16} />
                          </button>
                        </div>
                        <a 
                          href={`${deployedUrl}?t=${Date.now()}`} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="w-full flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-500 text-white font-bold py-3 rounded-xl transition-all text-sm shadow-lg shadow-purple-950/30"
                        >
                          <ExternalLink size={18} />
                          Open GitHub Pages
                        </a>
                      </div>
                    )}
                    {repoFullName && (
                      <a 
                        href={`https://github.com/${repoFullName}`} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="w-full flex items-center justify-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-white font-bold py-3 rounded-xl transition-all text-sm"
                      >
                        <Github size={18} />
                        View Repository
                      </a>
                    )}
                  </div>

                  <button 
                    onClick={onClose}
                    className="w-full bg-zinc-800 hover:bg-zinc-700 text-gray-400 font-bold py-3 rounded-xl transition-all text-sm"
                  >
                    Close
                  </button>
                </div>
              </div>
            )}

            {status === 'error' && (
              <div className="py-6 flex flex-col items-center text-center space-y-4">
                <div className="w-16 h-16 bg-red-500/20 text-red-400 rounded-full flex items-center justify-center">
                  <AlertCircle size={32} />
                </div>
                <div className="w-full space-y-4">
                  <div>
                    <h4 className="text-xl font-bold text-white mb-2">Deployment Failed</h4>
                    <p className="text-red-400/80 text-sm max-w-sm mx-auto mb-4 bg-red-500/5 p-3 rounded-xl border border-red-500/10">
                      {error}
                    </p>
                  </div>

                  {logs.length > 0 && (
                    <div className="w-full space-y-2">
                      <div className="flex items-center justify-between px-1">
                        <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Deployment Logs</span>
                        <button 
                          onClick={copyLogs}
                          className="text-[10px] font-bold text-purple-400 hover:text-purple-300 uppercase tracking-widest flex items-center gap-1 transition-colors"
                        >
                          Copy All Logs
                        </button>
                      </div>
                      <div className="w-full h-40 bg-black/60 border border-white/5 rounded-xl p-3 overflow-y-auto text-left font-mono text-[10px] space-y-1 custom-scrollbar">
                        {logs.map((log, i) => (
                          <div key={i} className={`${log.includes('error') ? 'text-red-400' : log.includes('warn') ? 'text-amber-400' : 'text-gray-400'}`}>
                            {log}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex gap-3 w-full">
                    <button 
                      onClick={() => setStatus('idle')}
                      className="flex-1 bg-white/5 hover:bg-white/10 text-white font-bold py-3 rounded-xl transition-all text-sm"
                    >
                      Try Again
                    </button>
                    <button 
                      onClick={onClose}
                      className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-gray-400 font-bold py-3 rounded-xl transition-all text-sm"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};

