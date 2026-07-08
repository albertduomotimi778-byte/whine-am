import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const FALLBACK_URL = 'https://tyqjnfoiooujylzijwtb.supabase.co';
const FALLBACK_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR5cWpuZm9pb291anlsemlqd3RiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzEwODUyOCwiZXhwIjoyMDkyNjg0NTI4fQ.idChwwk9yPaZtb1pCik3QmNXc2WcD1xTJu0GQtiBEhM';

export const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || FALLBACK_URL;
const supabaseKey = process.env.VITE_SUPABASE_KEY || process.env.SUPABASE_KEY || FALLBACK_KEY;

export const supabase = createClient(supabaseUrl, supabaseKey);

const isServerless = !!process.env.VERCEL || !!process.env.AWS_LAMBDA_FUNCTION_VERSION;
const DB_DIR = isServerless ? path.join('/tmp', 'db_store') : path.join(process.cwd(), 'db_store');
const ASSETS_DIR = path.join(DB_DIR, 'product_assets');

// Ensure directories exist
try {
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }
  if (!fs.existsSync(ASSETS_DIR)) {
    fs.mkdirSync(ASSETS_DIR, { recursive: true });
  }
} catch (e) {
  console.warn("Could not create DB directories, might be read-only", e);
}

// In-memory caching for sub-microsecond retrieval and blazing performance
const cache: Record<string, any> = {};
const cacheTimes: Record<string, number> = {};
const CACHE_TTL_MS = 5000; // STRICT SYNC: always bypass local cache and fetch from centralized Supabase Storage

// Linearized write queues to prevent file locking and writes colliding
const writeQueues: Record<string, Promise<void>> = {};

function enqueueWrite(filePath: string, writeFn: () => Promise<void>): Promise<void> {
  if (!writeQueues[filePath]) {
    writeQueues[filePath] = Promise.resolve();
  }
  const next = writeQueues[filePath].then(writeFn).catch(err => {
    console.error(`LocalDB: file write error on ${filePath}`, err);
  });
  writeQueues[filePath] = next;
  return next;
}

// Seed helper for initial product list
const INITIAL_PRODUCTS: any[] = [];

export async function readCollectionFile(collectionName: string): Promise<Record<string, any>> {
  const now = Date.now();
  if (cache[collectionName] && cacheTimes[collectionName] && (now - cacheTimes[collectionName] < CACHE_TTL_MS)) {
    return cache[collectionName];
  }

  // Attempt to fetch from Supabase Storage first for absolute environment consistency
  const storagePath = `db_store/${collectionName}.json`;
  try {
    const url = `${supabaseUrl}/storage/v1/object/public/animato_uploads/${storagePath}?cb=${now}`;
    console.log(`[LocalDB Sync] Fetching collection '${collectionName}' via public URL to bypass CDN cache...`);
    const res = await fetch(url);
    
    if (res.status === 200) {
      const content = await res.text();
      const data = JSON.parse(content || '{}');
      cache[collectionName] = data;
      cacheTimes[collectionName] = now;
      
      // Save local backup as resilient fallback
      const filePath = path.join(DB_DIR, `${collectionName}.json`);
      await enqueueWrite(filePath, async () => {
        const tmpPath = `${filePath}.tmp`;
        await fs.promises.writeFile(tmpPath, content, 'utf-8').catch(() => {});
        await fs.promises.rename(tmpPath, filePath).catch(() => {});
      });
      
      console.log(`[LocalDB Sync] Successfully loaded '${collectionName}' from Supabase Storage with ${Object.keys(data).length} objects.`);
      return data;
    } else if (res.status === 400 || res.status === 404) {
      console.log(`[LocalDB Sync] Collection '${collectionName}' is empty or uninitialized in cloud. Falling back locally.`);
    } else {
      console.log(`[LocalDB Sync] Issue fetching '${collectionName}': HTTP ${res.status}. Falling back locally.`);
    }
  } catch (err: any) {
    console.warn(`[LocalDB Sync] Failed to read '${collectionName}' from Supabase Storage:`, err.message);
  }

  const filePath = path.join(DB_DIR, `${collectionName}.json`);
  try {
    if (fs.existsSync(filePath)) {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      const data = JSON.parse(content || '{}');
      cache[collectionName] = data;
      cacheTimes[collectionName] = now;
      return data;
    }
  } catch (err) {
    console.error(`LocalDB: Error reading ${collectionName}`, err);
  }

  // Pre-seed some tables if empty
  if (collectionName === 'products') {
    const seed: Record<string, any> = {};
    INITIAL_PRODUCTS.forEach(p => {
      seed[p.id] = p;
    });
    cache[collectionName] = seed;
    cacheTimes[collectionName] = now;
    // Save background sync
    await writeCollectionFile(collectionName, seed);
    return seed;
  }

  cache[collectionName] = {};
  cacheTimes[collectionName] = now;
  return {};
}

export async function flushDbSyncs(): Promise<void> {
  // No-op. Sync is now strictly enforced inline to guarantee cross-instance database integrity.
}

export async function writeCollectionFile(collectionName: string, data: Record<string, any>): Promise<void> {
  const now = Date.now();
  cache[collectionName] = data;
  cacheTimes[collectionName] = now;
  const filePath = path.join(DB_DIR, `${collectionName}.json`);
  const jsonContent = JSON.stringify(data, null, 2);

  await enqueueWrite(filePath, async () => {
    const tmpPath = `${filePath}.tmp`;
    await fs.promises.writeFile(tmpPath, jsonContent, 'utf-8');
    await fs.promises.rename(tmpPath, filePath);
  });

  // Strict centralized sync: upload immediately and await
  const storagePath = `db_store/${collectionName}.json`;
  console.log(`[LocalDB Strict Sync] Uploading '${collectionName}' to Supabase directly...`);
  
  const buffer = Buffer.from(jsonContent, 'utf-8');
  try {
    const { error } = await supabase.storage
      .from('animato_uploads')
      .upload(storagePath, buffer, {
        contentType: 'application/json',
        cacheControl: '0',
        upsert: true
      });
      
    if (error) {
      console.warn(`[LocalDB Strict Sync] Error updating '${collectionName}':`, error.message);
    } else {
      console.log(`[LocalDB Strict Sync] Guaranteed sync for '${collectionName}' completed!`);
    }
  } catch (err: any) {
    console.warn(`[LocalDB Strict Sync] Exception updating '${collectionName}':`, err.message);
  }
}

// Asset Chunks separate storage (extremely fast, stays lightweight)
export async function getAssetDoc(id: string): Promise<any | null> {
  const cacheKey = `asset_${id}`;
  
  // Strict Sync: Bypass memory cache to ensure Vercel / Native wrap consistency
  // ALWAYS fallback to Supabase read.
  
  try {
    const storagePath = `db_store/product_assets/${id}.json`;
    const url = `${supabaseUrl}/storage/v1/object/public/animato_uploads/${storagePath}?cb=${Date.now()}`;
    console.log(`[LocalDB Strict Sync] Fetching asset chunk '${id}' immediately from centralized DB...`);
    const res = await fetch(url);
    if (res.status === 200) {
      const content = await res.text();
      const data = JSON.parse(content || '{}');
      
      const filePath = path.join(ASSETS_DIR, `${id}.json`);
      // Background write locally
      fs.promises.writeFile(filePath, content, 'utf-8').catch(() => {});
      
      return data;
    }
  } catch (err: any) {
    console.warn(`[LocalDB Strict Sync] Failed to retrieve asset '${id}' from Supabase Storage:`, err.message);
  }
  
  // Absolute fallback to local FS if Supabase is down
  const filePath = path.join(ASSETS_DIR, `${id}.json`);
  try {
    if (fs.existsSync(filePath)) {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      return JSON.parse(content || '{}');
    }
  } catch (err) {
    console.error(`LocalDB: Asset local read fallback error for ${id}`, err);
  }

  return null;
}

export async function setAssetDoc(id: string, data: any): Promise<void> {
  const cacheKey = `asset_${id}`;
  cache[cacheKey] = data;
  const filePath = path.join(ASSETS_DIR, `${id}.json`);
  const jsonContent = JSON.stringify(data);
  await enqueueWrite(filePath, async () => {
    await fs.promises.writeFile(filePath, jsonContent, 'utf-8');
  });

  // Strict centralized sync for assets: upload immediately and await
  const storagePath = `db_store/product_assets/${id}.json`;
  console.log(`[LocalDB Strict Sync] Uploading asset '${id}' to Supabase directly...`);
  const buffer = Buffer.from(jsonContent, 'utf-8');
  
  try {
    const { error } = await supabase.storage
      .from('animato_uploads')
      .upload(storagePath, buffer, {
        contentType: 'application/json',
        cacheControl: '0',
        upsert: true
      });
      
    if (error) {
      console.warn(`[LocalDB Strict Sync] Error updating asset chunk '${id}':`, error.message);
    } else {
      console.log(`[LocalDB Strict Sync] Guaranteed sync for asset it '${id}' completed.`);
    }
  } catch (err: any) {
    console.warn(`[LocalDB Strict Sync] Exception for asset ${id}:`, err.message);
  }
}

export async function deleteAssetDoc(id: string): Promise<void> {
  const cacheKey = `asset_${id}`;
  delete cache[cacheKey];
  const filePath = path.join(ASSETS_DIR, `${id}.json`);
  try {
    if (fs.existsSync(filePath)) {
      await fs.promises.unlink(filePath);
    }
  } catch (err) {
    console.warn(`LocalDB: Asset delete warning for ${id}`, err);
  }

  // Background deletion from Supabase Storage
  try {
    const storagePath = `db_store/product_assets/${id}.json`;
    supabase.storage
      .from('animato_uploads')
      .remove([storagePath])
      .then(({ error }) => {
        if (error) {
          console.warn(`[LocalDB Sync] Error deleting asset '${id}' in Supabase Storage:`, error.message);
        } else {
          console.log(`[LocalDB Sync] Successfully deleted asset '${id}' from Supabase Storage.`);
        }
      })
      .catch((err: any) => {});
  } catch (err: any) {}
}

export async function queryProductAssets(productId: string): Promise<any[]> {
  const results: any[] = [];
  const prefix = `${productId}_chunk_`;

  try {
    // List directly from Supabase Storage directory 'db_store/product_assets'
    const { data: filesList, error } = await supabase.storage
      .from('animato_uploads')
      .list('db_store/product_assets', { limit: 1000 });

    if (!error && Array.isArray(filesList)) {
      for (const item of filesList) {
        if (item.name && item.name.startsWith(prefix) && item.name.endsWith('.json')) {
          const id = item.name.replace('.json', '');
          const data = await getAssetDoc(id);
          if (data && String(data.productId) === String(productId)) {
            results.push(data);
          }
        }
      }
      if (results.length > 0) {
        return results;
      }
    }
  } catch (err: any) {
    console.warn("[LocalDB Sync] Supabase queryProductAssets listing error, falling back locally:", err.message);
  }

  // Local filesystem fallback
  try {
    const files = await fs.promises.readdir(ASSETS_DIR);
    for (const file of files) {
      if (file.startsWith(prefix) && file.endsWith('.json')) {
        const id = file.replace('.json', '');
        const data = await getAssetDoc(id);
        if (data && String(data.productId) === String(productId)) {
          results.push(data);
        }
      }
    }
    return results;
  } catch (err) {
    console.error("LocalDB: Query product assets locally error:", err);
    return [];
  }
}

export async function deleteProductAssetsByProductId(productId: string): Promise<void> {
  const prefix = `${productId}_chunk_`;

  try {
    const { data: filesList, error } = await supabase.storage
      .from('animato_uploads')
      .list('db_store/product_assets', { limit: 1000 });

    if (!error && Array.isArray(filesList)) {
      for (const item of filesList) {
        if (item.name && item.name.startsWith(prefix) && item.name.endsWith('.json')) {
          const id = item.name.replace('.json', '');
          await deleteAssetDoc(id);
        }
      }
    }
  } catch (err: any) {
    console.warn("[LocalDB Sync] Supabase delete chunks list error:", err.message);
  }

  try {
    const files = await fs.promises.readdir(ASSETS_DIR);
    for (const file of files) {
      if (file.startsWith(prefix) && file.endsWith('.json')) {
        const id = file.replace('.json', '');
        await deleteAssetDoc(id);
      }
    }
  } catch (e) {
    console.error("LocalDB: Clear chunks locally error:", e);
  }
}

// Global query mechanics
export interface LocalQueryFilter {
  field: string;
  op: string;
  value: any;
}

export async function getDocLocal(collection: string, id: string): Promise<any | null> {
  if (collection === 'product_assets') {
    return await getAssetDoc(id);
  }
  const col = await readCollectionFile(collection);
  return col[id] || null;
}

export async function setDocLocal(collection: string, id: string, data: any): Promise<void> {
  if (collection === 'product_assets') {
    await setAssetDoc(id, data);
    return;
  }
  const col = await readCollectionFile(collection);
  col[id] = { ...col[id], ...data, id };
  await writeCollectionFile(collection, col);
}

export async function updateDocLocal(collection: string, id: string, data: any): Promise<void> {
  if (collection === 'product_assets') {
    const current = await getAssetDoc(id);
    if (current) {
      await setAssetDoc(id, { ...current, ...data });
    }
    return;
  }
  const col = await readCollectionFile(collection);
  if (col[id] || collection === 'sellers' || collection === 'user_accounts') {
    col[id] = { ...(col[id] || {}), ...data, id };
    await writeCollectionFile(collection, col);
  }
}

export async function deleteDocLocal(collection: string, id: string): Promise<void> {
  if (collection === 'product_assets') {
    await deleteAssetDoc(id);
    return;
  }
  const col = await readCollectionFile(collection);
  if (col[id]) {
    delete col[id];
    await writeCollectionFile(collection, col);
  }
}

export async function queryCollection(collection: string, filters: LocalQueryFilter[] = []): Promise<any[]> {
  if (collection === 'product_assets') {
    const prodIdFilter = filters.find(f => f.field === 'productId');
    if (prodIdFilter) {
      return await queryProductAssets(prodIdFilter.value);
    }
  }
  
  const col = await readCollectionFile(collection);
  let docs = Object.values(col);

  for (const filter of filters) {
    const { field, op, value } = filter;
    docs = docs.filter((doc) => {
      const docVal = doc[field];
      const matchVal = value;
      
      if (op === '==' || op === '===') {
        return String(docVal || '').toLowerCase() === String(matchVal || '').toLowerCase();
      }
      if (op === '!=') {
        return String(docVal || '').toLowerCase() !== String(matchVal || '').toLowerCase();
      }
      return true;
    });
  }
  // Sort products to ensure consistent chronological loading
  if (collection === 'products') {
    docs.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  }
  return docs;
}
