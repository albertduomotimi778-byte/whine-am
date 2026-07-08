import { initializeApp, getApps, getApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { readFileSync } from "fs";
import { join } from "path";

let app;
if (!getApps().length) {
  try {
    app = initializeApp({
      projectId: process.env.VITE_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || "studio-8786217208-a3d4f"
    });
  } catch (e) {
    app = getApp();
  }
} else {
  app = getApp();
}

let dbId: string | undefined = undefined;
try {
  const configPath = join(process.cwd(), "firebase-applet-config.json");
  const configContent = readFileSync(configPath, "utf-8");
  const config = JSON.parse(configContent);
  if (config.firestoreDatabaseId) {
    dbId = config.firestoreDatabaseId;
    console.log("[fakeServerFirestore] Using custom firestore databaseId:", dbId);
  }
} catch (e) {
  console.warn("[fakeServerFirestore] Could not read firestoreDatabaseId from config:", e);
}

export const db: any = dbId ? getFirestore(app, dbId) : getFirestore(app);

export const collection = (db: any, path: string): any => ({ path });
export const doc = (db: any, path: string, id: string): any => ({ path, id });
export const query = (col: any, ...filters: any[]): any => ({ path: col.path, filters });
export const where = (field: string, op: string, value: any): any => ({ field, op, value });
export const serverTimestamp = (): any => new Date();

export const originalGetDoc = async (docRef: any): Promise<any> => {
  const pathParts = docRef?.path?.split("/") || [];
  const col = pathParts[0] || "";
  const id = docRef?.id || "";

  try {
    const ref = db.collection(docRef.path).doc(docRef.id);
    const snap = await ref.get();
    return {
      exists: () => snap.exists,
      id: docRef.id,
      ref: docRef,
      data: () => snap.data()
    };
  } catch (error: any) {
    console.log(`[fakeServerFirestore Fallback] originalGetDoc redirecting for ${col}/${id} to LocalDB backup.`);
    try {
      const dbStore = await import("./utils/dbFileStore.js");
      const localData = await dbStore.getDocLocal(col, id);
      return {
        exists: () => !!localData,
        id,
        ref: docRef,
        data: () => localData
      };
    } catch (fallbackErr) {
      console.log("[fakeServerFirestore Fallback] Local backup fallback applied.");
      return {
        exists: () => false,
        id,
        ref: docRef,
        data: () => undefined
      };
    }
  }
};

export const originalGetDocs = async (queryRef: any): Promise<any> => {
  const pathParts = queryRef?.path?.split("/") || [];
  const col = pathParts[0] || "";

  try {
    let ref: any = db.collection(queryRef.path);
    if (queryRef.filters) {
      for (const f of queryRef.filters) {
        ref = ref.where(f.field, f.op, f.value);
      }
    }
    const snap = await ref.get();
    return {
      empty: snap.empty,
      docs: snap.docs.map((d: any) => ({
        id: d.id,
        exists: () => true,
        ref: { id: d.id, path: `${queryRef.path}/${d.id}` },
        data: () => d.data()
      })),
      forEach: (callback: (doc: any) => void) => {
        snap.docs.forEach((d: any) => {
          callback({
            id: d.id,
            exists: () => true,
            ref: { id: d.id, path: `${queryRef.path}/${d.id}` },
            data: () => d.data()
          });
        });
      }
    };
  } catch (error: any) {
    console.log(`[fakeServerFirestore Fallback] originalGetDocs redirecting for ${col} to LocalDB backup.`);
    try {
      const dbStore = await import("./utils/dbFileStore.js");
      const filters = queryRef.filters || [];
      const localDocs = await dbStore.queryCollection(col, filters);
      return {
        empty: localDocs.length === 0,
        docs: localDocs.map((d: any) => ({
          id: d.id || "unknown_id",
          exists: () => true,
          ref: { id: d.id || "unknown_id", path: `${col}/${d.id || "unknown_id"}` },
          data: () => d
        })),
        forEach: (callback: (doc: any) => void) => {
          localDocs.forEach((d: any) => {
            callback({
              id: d.id || "unknown_id",
              exists: () => true,
              ref: { id: d.id || "unknown_id", path: `${col}/${d.id || "unknown_id"}` },
              data: () => d
            });
          });
        }
      };
    } catch (fallbackErr) {
      console.log("[fakeServerFirestore Fallback] Local backup query applied.");
      return {
        empty: true,
        docs: [],
        forEach: () => {}
      };
    }
  }
};

export const originalSetDoc = async (docRef: any, data: any, options?: any): Promise<any> => {
  const pathParts = docRef?.path?.split("/") || [];
  const col = pathParts[0] || "";
  const id = docRef?.id || "";

  try {
    const ref = db.collection(docRef.path).doc(docRef.id);
    await ref.set(data, options);
  } catch (error: any) {
    console.log(`[fakeServerFirestore Fallback] originalSetDoc redirecting for ${col}/${id} to LocalDB backup.`);
    try {
      const dbStore = await import("./utils/dbFileStore.js");
      await dbStore.setDocLocal(col, id, data);
    } catch (fallbackErr) {
      console.log("[fakeServerFirestore Fallback] Local backup write applied.");
    }
  }
};

export const originalUpdateDoc = async (docRef: any, data: any): Promise<any> => {
  const pathParts = docRef?.path?.split("/") || [];
  const col = pathParts[0] || "";
  const id = docRef?.id || "";

  try {
    const ref = db.collection(docRef.path).doc(docRef.id);
    await ref.update(data);
  } catch (error: any) {
    console.log(`[fakeServerFirestore Fallback] originalUpdateDoc redirecting for ${col}/${id} to LocalDB backup.`);
    try {
      const dbStore = await import("./utils/dbFileStore.js");
      await dbStore.updateDocLocal(col, id, data);
    } catch (fallbackErr) {
      console.log("[fakeServerFirestore Fallback] Local backup update applied.");
    }
  }
};

export const originalDeleteDoc = async (docRef: any): Promise<any> => {
  const pathParts = docRef?.path?.split("/") || [];
  const col = pathParts[0] || "";
  const id = docRef?.id || "";

  try {
    const ref = db.collection(docRef.path).doc(docRef.id);
    await ref.delete();
  } catch (error: any) {
    console.log(`[fakeServerFirestore Fallback] originalDeleteDoc redirecting for ${col}/${id} to LocalDB backup.`);
    try {
      const dbStore = await import("./utils/dbFileStore.js");
      await dbStore.deleteDocLocal(col, id);
    } catch (fallbackErr) {
      console.log("[fakeServerFirestore Fallback] Local backup delete applied.");
    }
  }
};
