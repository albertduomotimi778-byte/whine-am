import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, deleteDoc } from 'firebase/firestore';
import fs from 'fs';

const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf-8'));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function cleanup() {
    console.log("Starting cleanup...");
    
    // Clear products
    const productsSnap = await getDocs(collection(db, 'products'));
    for (const doc of productsSnap.docs) {
        await deleteDoc(doc.ref);
    }
    console.log(`Deleted ${productsSnap.docs.length} products.`);

    // Clear sellers
    const sellersSnap = await getDocs(collection(db, 'sellers'));
    for (const doc of sellersSnap.docs) {
        await deleteDoc(doc.ref);
    }
    console.log(`Deleted ${sellersSnap.docs.length} sellers.`);

    // Clear referrals
    const referralsSnap = await getDocs(collection(db, 'referrals'));
    for (const doc of referralsSnap.docs) {
        await deleteDoc(doc.ref);
    }
    console.log(`Deleted ${referralsSnap.docs.length} referrals.`);
    
    console.log("Cleanup complete!");
    process.exit(0);
}

cleanup().catch(console.error);
