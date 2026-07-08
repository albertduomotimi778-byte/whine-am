import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, GithubAuthProvider } from 'firebase/auth';
import { 
  getFirestore,
  collection as fsCollection,
  doc as fsDoc,
  query as fsQuery,
  where as fsWhere,
  getDoc as fsGetDoc,
  getDocs as fsGetDocs,
  setDoc as fsSetDoc,
  updateDoc as fsUpdateDoc,
  deleteDoc as fsDeleteDoc,
  onSnapshot as fsOnSnapshot,
  writeBatch as fsWriteBatch,
  serverTimestamp as fsServerTimestamp
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
  }
}

// 1. Initialize Real Firebase SDK
export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

export { GoogleAuthProvider, GithubAuthProvider };
export const googleProvider = new GoogleAuthProvider();
export const githubProvider = new GithubAuthProvider();
githubProvider.addScope('repo'); // Add repo scope for game files Sync

// 2. Error Handler Function
export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// 3. Re-export Modular Firestore Functions Wrapped with Error Handlers
export function collection(dbRef: any, path: string) {
  return fsCollection(dbRef, path);
}

export function doc(dbRef: any, path: string, id?: string) {
  if (id === undefined) {
    return fsDoc(dbRef, path);
  }
  return fsDoc(dbRef, path, id);
}

export function query(colRef: any, ...queryConstraints: any[]) {
  return fsQuery(colRef, ...queryConstraints);
}

export function where(fieldPath: string, opStr: any, value: any) {
  return fsWhere(fieldPath, opStr, value);
}

export function serverTimestamp() {
  return fsServerTimestamp();
}

export const getDoc = async (docRef: any): Promise<any> => {
  try {
    return await fsGetDoc(docRef) as any;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, docRef.path || null);
    throw error;
  }
};

export const getDocs = async (queryRef: any): Promise<any> => {
  try {
    return await fsGetDocs(queryRef) as any;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, queryRef.path || null);
    throw error;
  }
};

export const setDoc = async (docRef: any, data: any, options?: any) => {
  try {
    if (options) {
      return await fsSetDoc(docRef, data, options);
    }
    return await fsSetDoc(docRef, data);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, docRef.path || null);
    throw error;
  }
};

export const updateDoc = async (docRef: any, data: any) => {
  try {
    return await fsUpdateDoc(docRef, data);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, docRef.path || null);
    throw error;
  }
};

export const deleteDoc = async (docRef: any) => {
  try {
    return await fsDeleteDoc(docRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, docRef.path || null);
    throw error;
  }
};

export const onSnapshot = (
  reference: any,
  onNext: (snapshot: any) => void,
  onError?: (error: any) => void
) => {
  return fsOnSnapshot(
    reference,
    onNext,
    (error) => {
      if (onError) {
        onError(error);
      }
      handleFirestoreError(error, OperationType.GET, reference.path || null);
    }
  );
};

export const writeBatch = (dbRef: any) => {
  const batch = fsWriteBatch(dbRef);
  return {
    set: (docRef: any, data: any, options?: any) => {
      if (options) {
        batch.set(docRef, data, options);
      } else {
        batch.set(docRef, data);
      }
    },
    update: (docRef: any, data: any) => {
      batch.update(docRef, data);
    },
    delete: (docRef: any) => {
      batch.delete(docRef);
    },
    commit: async () => {
      try {
        await batch.commit();
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, null);
        throw error;
      }
    }
  };
};

// Simple helper to validate Firestore connection on boot
async function validateFirestoreConnection() {
  try {
    await getDoc(doc(db, 'products', 'connection_test_ping_123'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn("Please check your Firebase configuration or internet connection.");
    }
  }
}
validateFirestoreConnection();
