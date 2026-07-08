import { db, collection, getDocs } from "./firebase";
import { getBackendApiUrl } from "./api";

export interface DropboxKeyData {
  id?: string;
  accessToken?: string;
}

// Fetches all available Dropbox API access tokens from Firestore
export async function getDropboxTokens(): Promise<string[]> {
  // Query Supabase first as the master source of truth
  try {
    const { supabase } = await import("./supabase");
    if (supabase) {
      console.log("[Dropbox] Querying keys from Supabase...");
      const { data, error } = await supabase
        .from('dropbox_keys')
        .select('*');
      if (data && data.length > 0 && !error) {
        const tokens = data.map((d: any) => d.accessToken || d.access_token || '').map(s => s.trim()).filter(Boolean);
        if (tokens.length > 0) {
          console.log("[Dropbox] Successfully fetched keys from Supabase:", tokens.length);
          return tokens;
        }
      }
      if (error) {
        console.warn("[Dropbox] Supabase fetch error (will fall back to Firestore):", error.message);
      }
    }
  } catch (err) {
    console.warn("[Dropbox] Supabase fetch failed (falling back to Firestore):", err);
  }

  try {
    const qSnapshot = await getDocs(collection(db, "dropbox_keys"));
    if (qSnapshot.empty) {
      console.warn("[Dropbox] No Dropbox API keys configured in the database.");
      return [];
    }

    const tokens: string[] = [];
    qSnapshot.docs.forEach((docSnap) => {
      const data = docSnap.data();
      if (data.accessToken) {
        tokens.push(data.accessToken.trim());
      }
    });

    return tokens;
  } catch (err) {
    console.error("[Dropbox] Failed to retrieve Dropbox credentials:", err);
    return [];
  }
}

// Converts generic Dropbox shared links to direct raw data fetching resources
export function convertToDirectLink(sharedUrl: string): string {
  if (!sharedUrl) return "";
  let direct = sharedUrl;
  
  // Replace standard dl=0 with raw=1 to fetch binary or render raw pixels directly
  if (direct.includes("dl=0")) {
    direct = direct.replace("dl=0", "raw=1");
  } else if (!direct.includes("raw=1")) {
    direct += (direct.includes("?") ? "&" : "?") + "raw=1";
  }
  
  // Optionally map clean domain to skip HTML preview wrappers completely
  if (direct.includes("www.dropbox.com")) {
    direct = direct.replace("www.dropbox.com", "dl.dropboxusercontent.com");
  }
  return direct;
}

// Helper to upload files locally when Dropbox API is unavailable or tokens fail
async function uploadLocallyFallback(file: any, fileName: string, preloadedBase64?: string): Promise<string> {
  if (typeof file === "string") {
    console.info("[Local Backup Storage] File is already a string:", file);
    return file;
  }
  try {
    let base64Data = preloadedBase64;
    if (!base64Data) {
      if (!file) {
        throw new Error("No file was specified for local storage fallback.");
      }
      if (file && typeof file === "object" && "base64" in file) {
        base64Data = file.base64;
      } else {
        const reader = new FileReader();
        const base64Promise = new Promise<string>((resolve, reject) => {
          reader.onload = () => {
            const result = reader.result;
            if (typeof result === "string") {
              const base64 = result.indexOf(",") !== -1 ? result.substring(result.indexOf(",") + 1) : result;
              resolve(base64);
            } else {
              reject(new Error("FileReader result is not a string"));
            }
          };
          reader.onerror = () => {
            const message = reader.error ? reader.error.message : "FileReader error occurred while decoding file";
            reject(new Error(message));
          };
          reader.readAsDataURL(file);
        });
        base64Data = await base64Promise;
      }
    }
    
    const res = await fetch(getBackendApiUrl("/api/local-upload"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName, base64Data }),
    });
    if (!res.ok) {
      throw new Error(`Local upload API responded with status ${res.status}`);
    }
    const resJson = await res.json();
    return resJson.url;
  } catch (err: any) {
    console.error("[Local Backup Storage] Local storage write failed:", err);
    throw new Error("Local and Dropbox backends both failed: " + (err && err.message ? err.message : String(err)));
  }
}

// Uploads any Blob/File directly to Dropbox path and yields shared direct download link
export async function uploadToDropbox(file: any, fileName: string, folder: string = "creator_uploads", onProgress?: (percent: number) => void): Promise<string> {
  // Attempt to upload to Supabase Storage first for instant, centralized synchronization across all environments (Vercel, Local, Rapper WebView wrapper)
  try {
    const { uploadToSupabase } = await import("./supabase");
    const supabaseUrl = await uploadToSupabase(file, fileName, folder, onProgress);
    if (supabaseUrl) {
      console.log("[Dropbox proxy] Successfully routed upload to Supabase Storage:", supabaseUrl);
      return supabaseUrl;
    }
  } catch (err: any) {
    console.warn("[Dropbox proxy] Supabase Storage upload failed, leaning on Dropbox/Local backends:", err.message);
  }

  // Read the file buffer immediately (starts synchronously) to prevent browser sandbox revocation
  let fileBufferAndBase64: { arrayBuffer: ArrayBuffer, base64: string } | null = null;
  try {
    if (file && typeof file === "object" && "base64" in file) {
      const preData = file as { base64: string, arrayBuffer?: ArrayBuffer };
      let arrBuf = preData.arrayBuffer;
      if (!arrBuf) {
        const binaryString = atob(preData.base64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        arrBuf = bytes.buffer;
      }
      fileBufferAndBase64 = { arrayBuffer: arrBuf, base64: preData.base64 };
    } else if (file && typeof (file as any).arrayBuffer === "function") {
      const arrayBuffer = await (file as Blob).arrayBuffer();
      // Use optimized FileReader for blazing-fast native browser performance
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          const base = result.substring(result.indexOf(",") + 1);
          resolve(base);
        };
        reader.onerror = () => reject(reader.error || new Error("FileReader decoding failed"));
        reader.readAsDataURL(file as Blob);
      });
      fileBufferAndBase64 = { arrayBuffer, base64 };
    }
  } catch (err) {
    console.warn("[Dropbox] Immediate pre-reading/unpacking failed:", err);
  }

  let tokens: string[] = [];
  try {
    tokens = await getDropboxTokens();
  } catch (err) {
    console.warn("[Dropbox] Failed to fetch tokens, falling back to local storage:", err);
  }

  if (!tokens || tokens.length === 0) {
    console.info("[Dropbox] No credentials found. Falling back to secure disk storage instead.");
    return await uploadLocallyFallback(file, fileName, fileBufferAndBase64?.base64);
  }

  // Sanitize path names for Dropbox compliance
  const sanitizedFolder = folder.replace(/^\/+|\/+$/g, "");
  const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.\-_]/g, "_");
  const pathOnDropbox = `/${sanitizedFolder}/${sanitizedFileName}`;

  for (const token of tokens) {
    if (!token) continue;
    try {
      console.log(`[Dropbox] Starting upload to path: ${pathOnDropbox}...`);

      // 1. Send file binary to Files Upload endpoint
      const uploadResponse = await fetch("https://content.dropboxapi.com/2/files/upload", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Dropbox-API-Arg": JSON.stringify({
            path: pathOnDropbox,
            mode: "overwrite",
            autorename: true,
            mute: false,
          }),
          "Content-Type": "application/octet-stream",
        },
        body: fileBufferAndBase64 ? fileBufferAndBase64.arrayBuffer : file,
      });

      if (!uploadResponse.ok) {
        const errorBody = await uploadResponse.text();
        throw new Error(`Dropbox binary upload failed: ${uploadResponse.status} - ${errorBody}`);
      }

      const uploadResult = await uploadResponse.json();
      const actualPath = uploadResult.path_display || pathOnDropbox;

      console.log(`[Dropbox] Uploaded successfully to: ${actualPath}. Initiating sharing link generation...`);

      // 2. Create sharing link for public delivery
      let sharedLinkUrl = "";
      try {
        const linkResponse = await fetch("https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            path: actualPath,
            settings: {
              requested_visibility: "public",
            },
          }),
        });

        if (linkResponse.ok) {
          const linkResult = await linkResponse.json();
          sharedLinkUrl = linkResult.url;
        } else {
          const errBody = await linkResponse.json();
          const isConflict = linkResponse.status === 409 || errBody?.error?.['.tag']?.includes("shared_link_already_exists");
          if (isConflict) {
            console.log("[Dropbox] Sharing link already exists. Querying existing active links...");
            const listResponse = await fetch("https://api.dropboxapi.com/2/sharing/list_shared_links", {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${token}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                path: actualPath,
                direct_only: true,
              }),
            });

            if (listResponse.ok) {
              const listResult = await listResponse.json();
              if (listResult.links && listResult.links.length > 0) {
                sharedLinkUrl = listResult.links[0].url;
              }
            }
          } else {
            throw new Error(`Sharing endpoint answered: ${linkResponse.status} - ${JSON.stringify(errBody)}`);
          }
        }
      } catch (sharingError) {
        console.error("[Dropbox] Link generation crashed, trying list lookup lookup:", sharingError);
        try {
          const listResponse = await fetch("https://api.dropboxapi.com/2/sharing/list_shared_links", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              path: actualPath,
              direct_only: true,
            }),
          });
          if (listResponse.ok) {
            const listResult = await listResponse.json();
            if (listResult.links && listResult.links.length > 0) {
              sharedLinkUrl = listResult.links[0].url;
            }
          }
        } catch (_) {}
      }

      if (sharedLinkUrl) {
         const directDownloadLink = convertToDirectLink(sharedLinkUrl);
         console.log(`[Dropbox] Shared direct link established: ${directDownloadLink}`);
         return directDownloadLink;
      }
      throw new Error(`Could not generate or locate a public sharing link for Dropbox path: ${actualPath}`);
    } catch (tokenErr: any) {
      console.warn(`[Dropbox] Token failed: ${tokenErr.message}. Trying next available token...`);
    }
  }

  console.info("[Dropbox] All active Dropbox keys failed or expired. Using automatic local disk storage fallback...");
  return await uploadLocallyFallback(file, fileName, fileBufferAndBase64?.base64);
}
