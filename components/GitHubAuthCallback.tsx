import React, { useEffect, useState, useRef } from "react";
import { db, doc, getDoc, setDoc } from "../utils/firebase";
import { Loader2, CheckCircle, XCircle, ArrowLeft } from "lucide-react";

export function GitHubAuthCallback() {
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [username, setUsername] = useState("");
  const exchangeStarted = useRef(false);

  useEffect(() => {
    if (exchangeStarted.current) {
      console.log("[GitHubCallback] Exchange already in progress or completed, skipping duplicate call.");
      return;
    }
    exchangeStarted.current = true;

    const handleCallback = async () => {
      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");
      const returnedState = params.get("state");

      console.log("[GitHubCallback] Handling callback with code:", code ? "exists" : "missing", "state:", returnedState);

      if (!code || !returnedState) {
        setStatus("error");
        setErrorMsg("The connection state is missing or invalid. Please try again.");
        return;
      }

      // CSRF / OAuth State Validation: Get stored state from cookies or localStorage
      const getCookie = (name: string) => {
        const value = `; ${document.cookie}`;
        const parts = value.split(`; ${name}=`);
        if (parts.length === 2) return parts.pop()?.split(';').shift();
        return null;
      };
      
      const storedState = getCookie("github_oauth_state") || localStorage.getItem("github_oauth_state");
      
      console.log("[GitHubCallback] [TEMP LOG] Verifying state. Returned state:", returnedState, "Stored state:", storedState);
      
      if (!storedState || returnedState !== storedState) {
        console.warn("[GitHubCallback] Security Alert: State mismatch! Returned state:", returnedState, "Stored state:", storedState);
        setStatus("error");
        setErrorMsg("Security validation failed (OAuth state mismatch). The request was rejected to prevent session hijacking.");
        return;
      }

      // Clear the security cookies and localStorage
      document.cookie = "github_oauth_state=; max-age=0; path=/; SameSite=Lax; Secure";
      localStorage.removeItem("github_oauth_state");

      // Retrieve authenticated user context securely
      const userStr = typeof window !== 'undefined' ? localStorage.getItem('app_user') : null;
      const loggedInUser = userStr ? JSON.parse(userStr) : null;
      const loggedInEmail = (loggedInUser?.email || '').toLowerCase().trim();
      const storedEmail = (getCookie("github_oauth_email") || localStorage.getItem("github_oauth_email") || "").toLowerCase().trim();
      const email = loggedInEmail || storedEmail;

      if (!email) {
        setStatus("error");
        setErrorMsg("You must be logged in to connect your GitHub account.");
        return;
      }

      // Clean up email cookies
      document.cookie = "github_oauth_email=; max-age=0; path=/; SameSite=Lax; Secure";
      localStorage.removeItem("github_oauth_email");

      try {
        // 1. Exchange code for access token via our own backend API
        const response = await fetch(`/api/auth/github/exchange?t=${Date.now()}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            code,
            email,
            redirect_uri: window.location.origin + "/auth/callback",
          }),
        });

        const data = await resToJSON(response);
        
        if (!response.ok || data.error) {
          console.error("[GitHubCallback] Exchange failed:", data);
          let errorInfo = data.details || data.error || `Server error (${response.status})`;
          if (response.status === 404) {
            errorInfo = "API Endpoint Not Found (404). The server could not find the requested route. Please ensure you are using the correct connection URL.";
          }
          if (data.error === "SERVER_ERROR" && data.details) {
            errorInfo = `Server Error: ${data.details}`;
          }
          throw new Error(errorInfo);
        }

        console.log("[GitHubCallback] Exchange success for user:", data.username);
        setUsername(data.username);
        setStatus("success");

        // Save local cache for immediate feedback in other tabs
        localStorage.setItem(`github_conn_${email}`, JSON.stringify({
          connected: true,
          username: data.username,
          avatar_url: data.avatar_url,
          accessToken: data.access_token,
          timestamp: Date.now()
        }));

        // Notify parent window (if opened as popup)
        if (window.opener) {
          try {
            window.opener.postMessage({ type: "OAUTH_AUTH_SUCCESS" }, "*");
            // Brief delay to ensure message is received before closing
            setTimeout(() => {
              window.close();
            }, 1500);
          } catch (e) {
            console.warn("[GitHubCallback] Failed to notify opener:", e);
          }
        }
      } catch (err: any) {
        console.error("[GitHubCallback] Error:", err);
        setStatus("error");
        setErrorMsg(err.message || "A secure connection could not be established with GitHub.");
      }
    };

    handleCallback();
  }, []);

  async function resToJSON(res: Response) {
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch (e) {
      return { error: text || `Server error (${res.status})` };
    }
  }

  return (
    <div className="min-h-screen bg-[#0e0e11] flex items-center justify-center p-6 text-white font-sans selection:bg-blue-500/30">
      <div className="w-full max-w-md bg-[#18181b] rounded-[2rem] p-10 border border-white/5 shadow-[0_20px_50px_rgba(0,0,0,0.5)] text-center space-y-8 relative overflow-hidden">
        {/* Ambient background glow */}
        <div className="absolute -top-20 -left-20 w-40 h-40 bg-blue-500/10 blur-[80px] rounded-full" />
        <div className="absolute -bottom-20 -right-20 w-40 h-40 bg-purple-500/10 blur-[80px] rounded-full" />

        <div className="relative z-10 space-y-8">
          {status === "loading" && (
            <>
              <div className="flex justify-center">
                <div className="relative">
                  <Loader2 className="w-16 h-16 text-blue-500 animate-spin stroke-[2.5]" />
                  <div className="absolute inset-0 bg-blue-500/20 blur-[15px] animate-pulse rounded-full" />
                </div>
              </div>
              <div>
                <h1 className="text-3xl font-bold tracking-tight mb-2">Finalizing Connection</h1>
                <p className="text-zinc-400 text-sm leading-relaxed">
                  We're securely linking your GitHub account to Animato Studio.
                </p>
              </div>
            </>
          )}

          {status === "success" && (
            <>
              <div className="flex justify-center">
                <div className="w-20 h-20 bg-emerald-500/10 rounded-full flex items-center justify-center border border-emerald-500/20">
                  <CheckCircle className="w-12 h-12 text-emerald-500" />
                </div>
              </div>
              <div>
                <h1 className="text-3xl font-bold tracking-tight text-emerald-400 mb-2">Account Linked!</h1>
                <p className="text-zinc-400 text-sm">
                  You are now connected as <span className="text-white font-semibold underline underline-offset-4 decoration-emerald-500/30">@{username}</span>
                </p>
              </div>
              <div className="pt-4">
                <p className="text-xs text-zinc-500 animate-pulse">
                  {window.opener ? "This window will close automatically..." : "You can now return to the app."}
                </p>
                {!window.opener && (
                  <button 
                    onClick={() => window.location.href = '/'}
                    className="mt-6 w-full py-4 bg-zinc-800 hover:bg-zinc-700 text-white font-bold rounded-2xl transition-all active:scale-[0.98] flex items-center justify-center gap-2"
                  >
                    <ArrowLeft size={18} />
                    Back to Studio
                  </button>
                )}
              </div>
            </>
          )}

          {status === "error" && (
            <>
              <div className="flex justify-center">
                <div className="w-20 h-20 bg-rose-500/10 rounded-full flex items-center justify-center border border-rose-500/20">
                  <XCircle className="w-12 h-12 text-rose-500" />
                </div>
              </div>
              <div>
                <h1 className="text-3xl font-bold tracking-tight text-rose-400 mb-2">Connection Failed</h1>
                <div className="bg-rose-500/5 border border-rose-500/10 rounded-2xl p-5 text-sm text-rose-200/80 leading-relaxed font-mono">
                  {errorMsg}
                </div>
              </div>
              <div className="space-y-3 pt-4">
                <button
                  onClick={async () => {
                    try {
                      const regs = await navigator.serviceWorker.getRegistrations();
                      for (const r of regs) {
                        await r.unregister();
                      }
                      const cachesKeys = await caches.keys();
                      for (const key of cachesKeys) {
                        await caches.delete(key);
                      }
                    } catch (e) {
                      console.error("Failed to unregister SW:", e);
                    }
                    window.location.href = window.location.href.split('?')[0] + '?t=' + Date.now();
                  }}
                  className="w-full py-4 bg-zinc-800 hover:bg-zinc-700 text-white font-bold rounded-2xl transition-all active:scale-[0.98]"
                >
                  Hard Refresh App
                </button>
                <button
                  onClick={() => window.close()}
                  className="w-full py-4 bg-transparent hover:bg-white/5 text-zinc-400 font-medium rounded-2xl transition-all"
                >
                  Close Window
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default GitHubAuthCallback;
