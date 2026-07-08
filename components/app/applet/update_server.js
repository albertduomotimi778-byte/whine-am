const fs = require('fs');

let code = fs.readFileSync('server.ts', 'utf-8');

// 1. Add google-spreadsheet import
if(!code.includes('google-spreadsheet')) {
    code = 'import { GoogleSpreadsheet } from "google-spreadsheet";\nimport { JWT } from "google-auth-library";\n' + code;
}

// 2. Add Sheets Setup
const sheetsConfig = `
// --- Google Sheets Configuration ---
const SHEET_ID = process.env.GOOGLE_SPREADSHEET_ID;
const SA_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const SA_KEY = process.env.GOOGLE_PRIVATE_KEY ? process.env.GOOGLE_PRIVATE_KEY.replace(/\\\\n/g, '\\n') : '';

let doc: any = null;
if (SHEET_ID && SA_EMAIL && SA_KEY) {
  const serviceAccountAuth = new JWT({
    email: SA_EMAIL,
    key: SA_KEY,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  doc = new GoogleSpreadsheet(SHEET_ID, serviceAccountAuth);
} else {
  console.warn('[Google Sheets] Missing credentials. Subscriptions will not be correctly fetched or activated unless set in .env');
}

async function getSubscriptionFromSheet(email: string) {
  if (!doc) return null;
  try {
    await doc.loadInfo();
    let sheet = doc.sheetsByTitle['Subscriptions'];
    if (!sheet) return null;
    const rows = await sheet.getRows();
    const row = rows.find((r: any) => r.get('email') === email);
    if (!row) return null;
    return {
      email: row.get('email'),
      subscription_type: row.get('subscription_type'),
      subscription_name: row.get('subscription_name'),
      subscription_expiry: row.get('subscription_expiry'),
      subscription_status: row.get('subscription_status'),
      amount_paid: row.get('amount_paid'),
      currency: row.get('currency'),
      payment_reference: row.get('payment_reference'),
      timestamp: row.get('timestamp')
    };
  } catch (err: any) {
    console.error('[Google Sheets] Fetch Error:', err.message);
    return null;
  }
}

async function upsertSubscriptionToSheet(data: any) {
  if (!doc) {
    console.log('[Google Sheets] Simulated Upsert for', data.email, 'since no credentials.');
    return;
  }
  try {
    await doc.loadInfo();
    let sheet = doc.sheetsByTitle['Subscriptions'];
    if (!sheet) {
      sheet = await doc.addSheet({ 
          headerValues: ['email', 'subscription_type', 'subscription_name', 'subscription_expiry', 'subscription_status', 'amount_paid', 'currency', 'payment_reference', 'gateway', 'timestamp'],
          title: 'Subscriptions' 
      });
    }
    const rows = await sheet.getRows();
    const existingRow = rows.find((r: any) => r.get('email') === data.email);
    if (existingRow) {
      for (const [key, val] of Object.entries(data)) {
        existingRow.set(key, val as string);
      }
      await existingRow.save();
      console.log('[Google Sheets] Updated row for', data.email);
    } else {
      await sheet.addRow(data);
      console.log('[Google Sheets] Inserted row for', data.email);
    }
  } catch (err: any) {
    console.error('[Google Sheets] Upsert Error:', err.message);
  }
}
// --- end Google Sheets ---

`;

if(!code.includes('getSubscriptionFromSheet')) {
    code = code.replace('async function getDb() {', sheetsConfig + 'async function getDb() {');
}

fs.writeFileSync('server.ts', code);
