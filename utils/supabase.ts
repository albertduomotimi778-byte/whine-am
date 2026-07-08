import { createClient } from '@supabase/supabase-js';

const FALLBACK_URL = 'https://tyqjnfoiooujylzijwtb.supabase.co';
const FALLBACK_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR5cWpuZm9pb291anlsemlqd3RiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzEwODUyOCwiZXhwIjoyMDkyNjg0NTI4fQ.idChwwk9yPaZtb1pCik3QmNXc2WcD1xTJu0GQtiBEhM';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || FALLBACK_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_KEY || FALLBACK_KEY;

export const supabase = (supabaseUrl && supabaseKey) 
    ? createClient(supabaseUrl, supabaseKey) 
    : null;

export async function uploadToSupabase(file: any, fileName: string, folder: string = "creator_uploads", onProgress?: (percent: number) => void): Promise<string> {
  if (!supabase) {
    throw new Error("Supabase client is not initialized.");
  }

  // Sanitize folder and file name for bucket path
  const sanitizedFolder = folder.replace(/^\/+|\/+$/g, "");
  const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.\-_]/g, "_");
  const path = `${sanitizedFolder}/${sanitizedFileName}`;

  // Process file input into a compatible binary or ArrayBuffer body
  let fileBody: any = file;
  let contentType = "application/octet-stream";

  if (file && typeof file === "object" && "base64" in file) {
    const preData = file as { base64: string; arrayBuffer?: ArrayBuffer; mimeType?: string };
    if (preData.mimeType) contentType = preData.mimeType;
    if (preData.arrayBuffer) {
      fileBody = preData.arrayBuffer;
    } else {
      const binaryString = atob(preData.base64);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      fileBody = bytes.buffer;
    }
  } else if (file && typeof file.arrayBuffer === "function") {
    if (file.type) contentType = file.type;
    fileBody = file;
  } else if (typeof file === "string") {
    if (file.startsWith("http://") || file.startsWith("https://") || file.startsWith("data:")) {
      return file;
    }
    const binaryString = atob(file);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    fileBody = bytes.buffer;
  }

  const ext = sanitizedFileName.split('.').pop()?.toLowerCase() || '';
  if (ext === 'png') contentType = 'image/png';
  else if (ext === 'jpg' || ext === 'jpeg') contentType = 'image/jpeg';
  else if (ext === 'gif') contentType = 'image/gif';
  else if (ext === 'json') contentType = 'application/json';
  else if (ext === 'zip') contentType = 'application/zip';

  console.log(`[Supabase Storage] Uploading to bucket 'animato_uploads/${path}'`);

  const { data, error } = await supabase.storage
    .from('animato_uploads')
    .upload(path, fileBody, {
      upsert: true,
      contentType: contentType,
      onUploadProgress: (progress) => {
        if (progress.total > 0) {
          const percent = Math.round((progress.loaded / progress.total) * 100);
          onProgress?.(percent);
        }
      }
    } as any);

  if (error) {
    console.error("[Supabase Storage] Upload failed details:", error);
    throw new Error(`Supabase upload error: ${error.message}`);
  }

  const { data: pvData } = supabase.storage
    .from('animato_uploads')
    .getPublicUrl(path);

  if (!pvData || !pvData.publicUrl) {
    throw new Error(`Could not construct public URL for path: ${path}`);
  }

  console.log(`[Supabase Storage] Success! Public URL: ${pvData.publicUrl}`);
  return pvData.publicUrl;
}
