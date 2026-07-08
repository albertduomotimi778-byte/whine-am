// Use environment variables or fallback values like the original server.ts
import { supabase } from './supabase';
import { db, collection, doc, setDoc, getDoc, getDocs, query, where, deleteDoc } from './firebase';
import { uploadToFilebaseFallback, loadFromFilebase, deleteFromFilebase } from './filebase';

const PLANS = [
  { id: 'daily', name: 'Day Pass' },
  { id: 'weekly', name: 'Weekly' },
  { id: 'monthly', name: 'Monthly' },
  { id: 'yearly', name: 'Yearly' }
];

async function getSubscriptionFromDb(email: string) {
  if (!email) return null;
  const activeEmail = email.toLowerCase().trim();
  
  // Read local cache first
  let localSub = null;
  try {
    const existingStr = localStorage.getItem('user_subscriptions');
    if (existingStr) {
      const subs = JSON.parse(existingStr);
      if (subs[activeEmail]) {
        localSub = subs[activeEmail];
      }
    }
  } catch(e) {}
  
  if (supabase) {
    try {
      const { data, error } = await supabase.from('user_subscriptions_v3').select('*').eq('email', activeEmail).single();
      if (!error && data) {
         // If we have an active subscription locally, but the remote database doesn't have it active or is missing it,
         // we prefer the active local one and heal/re-sync the db in the background!
         if (localSub && localSub.subscription_status === 'active' && data.subscription_status !== 'active') {
             supabase.from('user_subscriptions_v3').update(localSub).eq('email', activeEmail).then(({ error: syncErr }) => {
                 if (syncErr) console.error('[DB] Background healing update failed:', syncErr);
                 else console.log('[DB] Background healing update succeeded');
             });
             return localSub;
         }
         return data;
      }
      if (error) {
         console.warn('[DB] Supabase Fetch warning:', error.message);
      }
    } catch (e: any) {
      console.error('[DB] Fetch Error:', e.message);
    }
  }

  return localSub;
}

export async function deleteSubscriptionFromDb(email: string) {
  if (!email) return;
  const targetEmail = email.toLowerCase().trim();
  
  if (supabase) {
      try {
          await supabase.from('user_subscriptions_v3').delete().eq('email', targetEmail);
      } catch (e: any) {
          console.error('[DB] Delete Error (Supabase):', e.message);
      }
  }
  
  try {
    const existingStr = localStorage.getItem('user_subscriptions');
    if (existingStr) {
      let subs = JSON.parse(existingStr);
      if (subs[targetEmail]) {
        delete subs[targetEmail];
        localStorage.setItem('user_subscriptions', JSON.stringify(subs));
      }
    }
  } catch (e: any) {
    console.error('[DB] Delete Error (Local):', e.message);
  }
}

export async function register(userData: any) {
  const { password, country, language } = userData;
  const email = userData.email?.toLowerCase().trim();
  if (!email || !password || !country || !language) {
    throw new Error('Email, password, country, and language are required');
  }

  const newUser = { email, password, country, language, timestamp: new Date().toISOString() };
  
  if (supabase) {
    try {
        console.log('[Backend] Registering via Supabase:', email);
        // Using a simple select instead of single() to avoid throwing on "not found"
        const { data: existing, error: checkError } = await supabase.from('user_accounts').select('email').eq('email', email);
        
        if (checkError) {
          console.error('[Backend] Supabase Check Error:', checkError.message);
        }

        if (existing && existing.length > 0) {
          throw new Error('Email already registered');
        }
        
        const { error } = await supabase.from('user_accounts').insert([newUser]);
        if (error) {
          if (error.code === '23505') { // Unique constraint violation
            throw new Error('Email already registered');
          }
          throw new Error(`Supabase error: ${error.message}`);
        }
        console.log('[Backend] Register success (Supabase)');
    } catch (e: any) {
        if (e.message !== 'Email already registered') {
            console.error('[Backend] Supabase Register Error:', e.message);
            // If it's a generic supabase error that looks like a conflict, handle it
            if (e.message.includes('duplicate key value')) {
              throw new Error('Email already registered');
            }
            throw e; // Re-throw other errors
        } else {
            throw e;
        }
    }
  }

  try {
      const existingAccounts = JSON.parse(localStorage.getItem('user_accounts') || '[]');
      if (existingAccounts.find((a: any) => a.email === email)) {
        if (!supabase) throw new Error('Email already registered');
      } else {
        localStorage.setItem('user_accounts', JSON.stringify([...existingAccounts, newUser]));
      }
  } catch (e: any) {
      if (e.message === 'Email already registered') throw e;
  }

  return { success: true, user: { ...newUser, subscription_status: 'none' } };
}

export async function login(credentials: any) {
  const { password } = credentials;
  const email = credentials.email?.toLowerCase().trim();
  if (!email || !password) {
    throw new Error('Email and password are required');
  }

  let account = null;
  
  if (supabase) {
    try {
        console.log('[Backend] Logging in via Supabase:', email);
        const { data, error } = await supabase.from('user_accounts').select('*').eq('email', email).single();
        if (data) {
            account = data;
            console.log('[Backend] Login found user (Supabase)');
        }
        if (error && error.code !== 'PGRST116') { // PGRST116 is single record not found
            console.error('[Backend] Supabase Login Error:', error.message);
        }
    } catch (e: any) {
        console.error('[Backend] Supabase Login Exception:', e.message);
    }
  }
  
  if (!account) {
      const existingAccounts = JSON.parse(localStorage.getItem('user_accounts') || '[]');
      account = existingAccounts.find((a: any) => a.email === email);
  }

  if (!account || account.password !== password) {
    throw new Error('Invalid email or password.');
  }

  const sub = await getSubscriptionFromDb(email) || null;

  let user = { ...account, ...sub };
  if (!sub) {
    user.subscription_status = 'none';
    user.subscription_type = 'none';
    user.subscription_expiry = null;
  }

  if (user.subscription_status === 'active' && user.subscription_expiry) {
    const expiryDate = new Date(user.subscription_expiry);
    if (new Date() > expiryDate) {
      user.subscription_status = 'expired';
    }
  }

  if (user.email === 'animato@gmail.com') {
    user.subscription_status = 'active';
    user.subscription_type = 'yearly';
    const nextYear = new Date();
    nextYear.setFullYear(nextYear.getFullYear() + 1);
    user.subscription_expiry = nextYear.toISOString();
  }

  if (user.email === 'animatopro@gmail.com') {
    user.subscription_status = 'active';
    user.subscription_type = 'weekly';
    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 7);
    user.subscription_expiry = nextWeek.toISOString();
  }

  return { success: true, user };
}

export async function syncUser(emailInput: string) {
  const email = emailInput?.toLowerCase().trim();
  if (!email) throw new Error('Email is required');

  let account = null;
  if (supabase) {
      try {
          const { data } = await supabase.from('user_accounts').select('*').eq('email', email).single();
          if (data) account = data;
      } catch (e) {
          console.error('[DB] SyncUser Error:', e);
      }
  }
  
  if (!account) {
      const existingAccounts = JSON.parse(localStorage.getItem('user_accounts') || '[]');
      account = existingAccounts.find((a: any) => a.email === email);
  }

  if (!account) throw new Error('User not found');

  const sub = await getSubscriptionFromDb(email) || null;

  let user = { ...account, ...sub };
  if (!sub) {
    user.subscription_status = 'none';
    user.subscription_type = 'none';
    user.subscription_expiry = null;
  }

  if (user.subscription_status === 'active' && user.subscription_expiry) {
    const expiryDate = new Date(user.subscription_expiry);
    if (new Date() > expiryDate) {
      user.subscription_status = 'expired';
    }
  }

  if (user.email === 'animato@gmail.com') {
    user.subscription_status = 'active';
    user.subscription_type = 'yearly';
    const nextYear = new Date();
    nextYear.setFullYear(nextYear.getFullYear() + 1);
    user.subscription_expiry = nextYear.toISOString();
  }

  if (user.email === 'animatopro@gmail.com') {
    user.subscription_status = 'active';
    user.subscription_type = 'weekly';
    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 7);
    user.subscription_expiry = nextWeek.toISOString();
  }

  return { success: true, user };
}

export async function activateSubscription(email: string, planType: string, expiryDate: Date, paymentInfo?: any, userInfo?: any) {
  const activeEmail = email.toLowerCase().trim();
  const expiryStr = expiryDate.toISOString();
  console.log(`[Activation] Starting for ${activeEmail}, Plan: ${planType}`);

  let account = null;
  
  if (supabase) {
      try {
          const { data } = await supabase.from('user_accounts').select('*').eq('email', activeEmail).single();
          if (data) account = data;
      } catch(e) {}
  }
  
  const existingAccounts = JSON.parse(localStorage.getItem('user_accounts') || '[]');
  if (!account) {
      account = existingAccounts.find((a: any) => a.email === activeEmail);
  }

  if (!account) {
    account = {
      email: activeEmail,
      password: userInfo?.password || 'Animato-Auto-Pass-123!',
      country: userInfo?.country || 'Nigeria',
      language: userInfo?.language || 'English',
      timestamp: new Date().toISOString()
    };
    if (supabase) {
        try {
            await supabase.from('user_accounts').insert([account]);
        } catch(e) {}
    }
    localStorage.setItem('user_accounts', JSON.stringify([...existingAccounts, account]));
  }

  const reference = paymentInfo?.reference || 'SYSTEM_ACTIVATED';
  const amountStr = paymentInfo?.amount ? (paymentInfo.amount / 100).toString() : '0';
  const planName = paymentInfo?.planName || planType.toUpperCase();
  const currency = paymentInfo?.currency || 'NGN';

  const subData = {
    email: activeEmail,
    subscription_type: planType,
    subscription_name: planName,
    subscription_expiry: expiryStr,
    subscription_status: 'active',
    amount_paid: amountStr,
    currency,
    payment_reference: reference,
    gateway: 'paystack',
    timestamp: new Date().toISOString()
  };

  if (supabase) {
      try {
          const { data: existing, error: existError } = await supabase.from('user_subscriptions_v3').select('email').eq('email', activeEmail).single();
          if (existing) {
             const { error: updateErr } = await supabase.from('user_subscriptions_v3').update(subData).eq('email', activeEmail);
             if (updateErr) console.error('[Activation] Supabase Update Error:', updateErr);
          } else {
             const { error: insertErr } = await supabase.from('user_subscriptions_v3').insert([subData]);
             if (insertErr) console.error('[Activation] Supabase Insert Error:', insertErr);
          }
      } catch (e) {
          console.error('[Activation] Supabase Operation Error:', e);
      }
  }
  
  try {
    const existingStr = localStorage.getItem('user_subscriptions');
    let subs = existingStr ? JSON.parse(existingStr) : {};
    subs[activeEmail] = subData;
    localStorage.setItem('user_subscriptions', JSON.stringify(subs));
  } catch (e: any) {
    console.error('[Activation] Write Error:', e);
    throw new Error('Persistence failed: ' + e.message);
  }

  return {
    ...account,
    ...subData
  };
}

export async function devActivate(data: any) {
  const { email: emailInput, plan, expiryMs, amount, reference } = data;
  if (!emailInput || !plan || !expiryMs) throw new Error('Missing email, plan, or expiryMs');
  
  const paymentInfo = { 
    amount: amount ? amount * 100 : 0, 
    reference: reference || 'SYSTEM_ACTIVATED' 
  };
  
  const updatedUser = await activateSubscription(emailInput, plan, new Date(expiryMs), paymentInfo);
  return { success: true, user: updatedUser };
}

export async function activateInManager(email: string) {
  const expiry = new Date();
  expiry.setFullYear(expiry.getFullYear() + 10);
  const updatedUser = await activateSubscription(email, 'yearly', expiry, { reference: 'SYSTEM_GRANTED_BACKUP' });
  return { success: true, user: updatedUser };
}

export async function paystackInitialize(data: any) {
  // Simulate Paystack initialization locally
  return { status: true, message: 'Initialization successful', data: { authorization_url: 'javascript:alert("Simulated Paystack Flow")' } };
}

export async function paystackCancel(emailInput: string) {
  const email = emailInput?.toLowerCase().trim();
  if (!email) throw new Error('Email required');
  await deleteSubscriptionFromDb(email);
  return { success: true };
}

export async function paystackVerify(data: any) {
  const { reference, country, language, password, amount: urlAmount } = data;
  const emailInput = (data.email || '').toLowerCase().trim();
  const planTypeInput = data.planType || null;
  
  if (!reference) throw new Error('Transaction reference is required');

  let targetEmail = emailInput;
  let planType = planTypeInput || 'monthly';

  if (!targetEmail) throw new Error('No user email found for activation');

  const expiry = new Date();
  if (planType === 'daily') expiry.setDate(expiry.getDate() + 1);
  else if (planType === 'weekly') expiry.setDate(expiry.getDate() + 7);
  else if (planType === 'yearly') expiry.setFullYear(expiry.getFullYear() + 1);
  else expiry.setMonth(expiry.getMonth() + 1);

  const amount = urlAmount ? parseInt(urlAmount) * 100 : 0; 
  const currency = 'NGN';
  const planName = PLANS.find(p => p.id === planType)?.name || planType.toUpperCase();
  
  const updatedUser = await activateSubscription(targetEmail, planType, expiry, { 
      reference, amount, planName, currency
  }, { country, language, password });

  return { success: true, user: updatedUser, plan: planType, expiry: expiry.toISOString() };
}

// BUGS Mock endpoints
// Previously local sqlite, we can use localStorage fallback if no real table
export async function getBugs() {
  const local = localStorage.getItem('user_bugs');
  return local ? JSON.parse(local) : [];
}

export async function createBug(bugData: any) {
  const local = JSON.parse(localStorage.getItem('user_bugs') || '[]');
  const newBug = { ...bugData, id: Date.now(), timestamp: new Date().toISOString() };
  localStorage.setItem('user_bugs', JSON.stringify([...local, newBug]));
  return newBug;
}

export async function deleteBug(id: number) {
  const local = JSON.parse(localStorage.getItem('user_bugs') || '[]');
  localStorage.setItem('user_bugs', JSON.stringify(local.filter((b: any) => b.id !== id)));
  return { success: true };
}

export async function changePassword(emailInput: string, newPassword: string) {
  const email = emailInput?.toLowerCase().trim();
  if (!email || !newPassword) {
    throw new Error('Email and password are required');
  }

  if (supabase) {
    try {
      const { data, error: fetchErr } = await supabase.from('user_accounts').select('*').eq('email', email);
      if (data && data.length > 0) {
        const { error: updateErr } = await supabase.from('user_accounts').update({ password: newPassword }).eq('email', email);
        if (updateErr) {
          console.error('[Backend] Supabase update password error:', updateErr.message);
        }
      } else {
        const account = {
          email,
          password: newPassword,
          country: 'Nigeria',
          language: 'English',
          timestamp: new Date().toISOString()
        };
        await supabase.from('user_accounts').insert([account]);
      }
    } catch (e: any) {
      console.error('[Backend] Supabase update password exception:', e.message);
    }
  }

  try {
    const existingAccounts = JSON.parse(localStorage.getItem('user_accounts') || '[]');
    const idx = existingAccounts.findIndex((a: any) => a.email === email);
    if (idx !== -1) {
      existingAccounts[idx].password = newPassword;
      localStorage.setItem('user_accounts', JSON.stringify(existingAccounts));
    } else {
      const newUser = {
        email,
        password: newPassword,
        country: 'Nigeria',
        language: 'English',
        timestamp: new Date().toISOString()
      };
      existingAccounts.push(newUser);
      localStorage.setItem('user_accounts', JSON.stringify(existingAccounts));
    }
  } catch (e: any) {
    console.error('[Backend] Local Storage update password error:', e.message);
  }

  return { success: true };
}

export async function saveCloudProject(email: string, projectId: string, projectName: string, projectData: any, sizeBytes: number) {
  const activeEmail = email?.toLowerCase().trim();
  if (!activeEmail) return { success: false, error: 'Email required' };
  
  try {
    const dataStr = typeof projectData === 'string' ? projectData : JSON.stringify(projectData);
    
    // Only upload real projects to filebase, not the cloud_tag metadata
    let filebaseMeta = null;
    let chunksCount = null;
    
    if (projectId.startsWith('cloud_tag_')) {
       // Save tag compactly in firestore
       const docRef = doc(db, 'user_cloud_projects', projectId);
       await setDoc(docRef, {
         id: projectId,
         email: activeEmail,
         name: projectName || '__CLOUD_TAG__',
         project_data: dataStr,
         size_bytes: sizeBytes,
         updated_at: new Date().toISOString()
       });
       return { success: true };
    }

    const { uploadToDropbox } = await import('./dropbox');
    
    // Convert string to blob
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    let dropboxUrl = null;
    let inlineData = null;
    try {
        dropboxUrl = await uploadToDropbox(dataBlob, `${activeEmail}_${projectId}.json`, "backend_syncs");
    } catch (fbRes) {
        // Fallback to firestore chunks
        console.warn(`Dropbox upload failed for ${projectName}, falling back to Firestore chunks.`, fbRes);
        const CHUNK_SIZE = 500000;
        
        if (dataStr.length > CHUNK_SIZE) {
          chunksCount = Math.ceil(dataStr.length / CHUNK_SIZE);
          const promises = [];
          for (let i = 0; i < chunksCount; i++) {
            const chunkData = dataStr.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
            const chunkRef = doc(db, 'user_cloud_projects', `${projectId}_chunk_${i}`);
            promises.push(setDoc(chunkRef, { 
              chunk_data: chunkData, 
              email: activeEmail, 
              parentProjectId: projectId 
            }));
          }
          await Promise.all(promises);
        } else {
          inlineData = dataStr;
        }
    }

    const docRef = doc(db, 'user_cloud_projects', projectId);
    const payload = {
      id: projectId,
      email: activeEmail,
      name: projectName || 'Untitled',
      project_data: inlineData,
      filebase: filebaseMeta,
      dropbox: dropboxUrl,
      chunks: chunksCount,
      size_bytes: sizeBytes,
      updated_at: new Date().toISOString()
    };
    await setDoc(docRef, payload);
    
    console.log(`[Firestore] Successfully saved cloud project metadata: ${projectName} for ${activeEmail}`);
  } catch (error: any) {
    console.warn('[Firestore] Could not sync user_cloud_projects online:', error.message);
    return { success: false, error: error.message };
  }

  return { success: true };
}

export async function loadCloudProjectChunks(projectId: string, chunks: number) {
  let fullData = '';
  for (let i = 0; i < chunks; i++) {
    const chunkRef = doc(db, 'user_cloud_projects', `${projectId}_chunk_${i}`);
    const snap = await getDoc(chunkRef);
    if (snap.exists()) {
      fullData += snap.data().chunk_data;
    }
  }
  try {
    return JSON.parse(fullData);
  } catch(e) {
    return null;
  }
}

export async function loadCloudProjectFilebase(email: string, projectId: string, filebaseMeta: any) {
  const { loadFromFilebase } = await import('./filebase');
  const activeEmail = email?.toLowerCase().trim();
  const rawStr = await loadFromFilebase(`${activeEmail}_${projectId}.json`, filebaseMeta);
  if (rawStr) {
    try {
      return JSON.parse(rawStr);
    } catch(e) {
      return null;
    }
  }
  return null;
}

export async function loadCloudProjectDropbox(dropboxUrl: string) {
  if (!dropboxUrl) return null;
  try {
    const res = await fetch(dropboxUrl);
    if (res.ok) {
       return await res.json();
    }
  } catch(e) {
    console.error('[Dropbox] Error loading project from Dropbox link:', e);
  }
  return null;
}

export async function getCloudProjects(email: string) {
  const activeEmail = email?.toLowerCase().trim();
  if (!activeEmail) return [];
  
  const allProjects: any[] = [];
  
  // 1. Try Firestore (Primary)
  try {
    const q = query(collection(db, 'user_cloud_projects'), where('email', '==', activeEmail));
    const querySnapshot = await getDocs(q);
    if (!querySnapshot.empty) {
      const mapped = querySnapshot.docs.map((docSnap: any) => {
        const d = docSnap.data();
        let projectData = d.project_data;
        if (typeof projectData === 'string') {
          try {
            projectData = JSON.parse(projectData);
          } catch (e) {}
        }
        return {
          id: docSnap.id,
          name: d.name,
          project_data: projectData,
          chunks: d.chunks,
          filebase: d.filebase || null,
          dropbox: d.dropbox || null,
          size_bytes: d.size_bytes,
          updated_at: d.updated_at
        };
      });
      allProjects.push(...mapped);
    }
  } catch (e: any) {
    console.warn('[Firestore] getCloudProjects error:', e.message);
  }

  // 2. Fallback to Supabase Storage JSON (Legacy migration support)
  try {
    const { supabase } = await import('./supabase');
    if (supabase) {
      const { data, error } = await supabase.storage.from('animato_uploads').download('db_store/user_cloud_projects.json');
      if (!error && data) {
        const text = await data.text();
        const legacyProjects = JSON.parse(text || '{}');
        const userLegacy = Object.values(legacyProjects).filter((p: any) => 
          p.email?.toLowerCase().trim() === activeEmail && 
          !allProjects.some(ap => ap.id === p.id)
        );
        allProjects.push(...userLegacy);
      }
    }
  } catch (e: any) {
    console.warn('[Supabase Fallback] getCloudProjects error:', e.message);
  }
  
  return allProjects.filter((p: any) => p.id && !p.id.startsWith('cloud_tag_') && p.name !== '__CLOUD_TAG__');
}

export async function deleteCloudProject(email: string, projectId: string) {
  const activeEmail = email?.toLowerCase().trim();
  if (!activeEmail) return { success: false };
  
  try {
    const docRef = doc(db, 'user_cloud_projects', projectId);
    const snap = await getDoc(docRef);
    
    if (snap.exists()) {
       const data = snap.data();
       if (data.filebase) {
         await deleteFromFilebase(`${activeEmail}_${projectId}.json`, data.filebase);
       }
       if (data.chunks) {
         for (let i = 0; i < Math.min(data.chunks, 150); i++) {
           try {
             const chunkRef = doc(db, 'user_cloud_projects', `${projectId}_chunk_${i}`);
             await deleteDoc(chunkRef);
           } catch (ce) {}
         }
       }
       await deleteDoc(docRef);
    } else {
       // Try just deleting the metadata doc if not fully loaded
       await deleteDoc(docRef);
    }
  } catch (e: any) {
    console.warn('[Firestore] deleteCloudProject error:', e.message);
  }
  
  return { success: true };
}

export async function addCloudTag(email: string) {
  const activeEmail = email?.toLowerCase().trim();
  if (!activeEmail) return { success: false, error: 'Email required' };
  try {
    // Save in DB via saveCloudProject
    await saveCloudProject(activeEmail, `cloud_tag_${activeEmail}`, '__CLOUD_TAG__', { joined: true }, 0);
    // Save in localStorage
    localStorage.setItem(`user_cloud_joined_${activeEmail}`, 'true');
    return { success: true };
  } catch (e: any) {
    console.error('[Backend] addCloudTag error:', e.message);
    return { success: false, error: e.message };
  }
}

export async function hasCloudTag(email: string) {
  const activeEmail = email?.toLowerCase().trim();
  if (!activeEmail) return false;
  try {
    const docRef = doc(db, 'user_cloud_projects', `cloud_tag_${activeEmail}`);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      return true;
    }
  } catch (e: any) {
    console.warn('[Firestore] Exception checking cloud tag:', e.message);
  }
  // Fallback to local
  try {
    const key = `user_cloud_joined_${activeEmail}`;
    return localStorage.getItem(key) === 'true';
  } catch (e) {
    return false;
  }
}



