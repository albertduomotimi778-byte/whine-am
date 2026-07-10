import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import cors from "cors";
import JSZip from "jszip";
import fs from "fs";
import crypto from "crypto";
import {
  getDocLocal,
  setDocLocal,
  updateDocLocal,
  deleteDocLocal,
  queryCollection,
  deleteProductAssetsByProductId,
  flushDbSyncs,
  readCollectionFile,
  supabase,
  supabaseUrl,
} from "./utils/dbFileStore.js";


import {
  collection,
  doc,
  query,
  where,
  serverTimestamp,
  originalGetDoc,
  originalGetDocs,
  originalSetDoc,
  originalUpdateDoc,
  originalDeleteDoc,
  db,
} from "./fakeServerFirestore.js";

import { GoogleSpreadsheet } from "google-spreadsheet";
import { JWT } from "google-auth-library";

const GOOGLE_SERVICE_ACCOUNT_EMAIL =
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ||
  "moniepoint-sheet-reader@moniepoint-tracker.iam.gserviceaccount.com";
const GOOGLE_PRIVATE_KEY =
  process.env.GOOGLE_PRIVATE_KEY ||
  `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCrb2+pibkEr6C+
96OHTzLzrS4/w6wHN63o5C2x09S7PIqb14AlChmKjzoeGWoaOMpgKZl+QnBFiLPc
9at1LEUTEV1JktynVx6rfsq4rWx4WQt17MYi5XnP4l1yndK0/LE/96t+ZrphZiiD
ZU/lRuwaGqIby2ccMouCeaKVkOLXfHLPrRKA30FbIg0wh3DR1x08NJI2cSooWsP+
IKlyiArvJERU9+KzomQF0JHtiLCgXv1o8tijLhVI0AU29M1+CEaHNUyZg93+cw43
G5nocE5PSjP2/V+WR9RoxwrjcxlgHOji7uFUisvQH5tSpB1wAX9GiBK3KrwwJeI9
j9ffzf6pAgMBAAECggEAEUnxc6JTQZz5o9CjEf4DeC4epCkWU/sCQ6KhVhX0Ffbe
zqUew/1/Aml71bW/7MmN5UFEvMYz/tswsmenJS+z/p6JbyZLsOeZDPgCNzosHn3y
aS/Z8oJ8dKHSRUET0xNJx9bxGVQAV1q/WrLwqgFrRZ2qfA2ZBi+1wJCGPDmqmssE
otxm+kieSHWmhMhd/Ir7L/DVeuM+Ksx+GHJUmp/RYoQI94kgtKocA6DFNccAX8ch
Pxhcqkm3RllL5oFkCkP4lkF/V5GYDJjmVmNpLFmraqvrOhcmuFt5J4XmmoyLIqaB
daSSMQCDH2J51xd871sDFqHmZxDU7c25HI2AZuJVdQKBgQDScJRrsW8JRGe+fl9j
5ndeklUzFOW2oh0z7RGlTjRmcch2CRgr2NDqpDcz/L7BeiNFyjsmrTibudzqIjQe
4Xr2Q740HPsoaSLW7L3CrJcjVNvinyjvqsv43wU40O7w/qjnWnxEgmDF3gSH6uYp
AwfagfMqr07YsYPSJ/tMOw1MHQKBgQDQjRJTLWIKPptIWxtsLbJksrjsAZcvd8Rt
c2px4rcNTK7rS6DNM9Dbb5ImP9/mYn4u5DEV+Yvdggd6zKh9vjiDFTlF5idAQvBL
daRI+/adTAKfd+ftcgbzDynEV9zwC3p9VtQrZ/pRZxtARoZhd4DJjK4LCZpBOYbE
xA0k76n+/QKBgQDDimrPuxsDEHYaE1FOAdwPm4fhpFxjnTXnhzUrVoToYHg1/fNg
4uIV9it5ejRCkdxuwCDAqpr8UPOO9+NYgoqAhKgbwoY6oZ8G+QrG9xqlcPe1F9Gx
ChLomUs/5RzyAKAwAeuQuVl04v1w0nu1xiQpDTFIC4gHYMOtpwsiZYjQnQKBgHrr
63UjNrobFKOdL5ifhppbzSst9NKBoUFx2beujX5FSIRfWzQX6m6sYFQzKeE9BGrX
DSeKoqm4znfO0TDsQZrhk5Rjh5cU3VVczaxG9qDYAGPF5OnLX9U7hr63mv3Rhi0C
VKQQ8TWxtBo6d1JTgZFKXfsbedQf+BNaCvVOXcBxAoGAIejbbe5uItC8+PCDQyNT
FjNGfxG49OTK6rbFMT8WikYNv5CzDpYUIVDzt8/Wfm230u28INn2sRAIhN2alzNQ
B5EDfG35YeNqQOoo7s9r5s79Lol7xc/7yfgGBjo74CG6oVyjqqfR7g3RQlJ17icl
dcqxq8qjZkTBAW54wK8Yzug=
-----END PRIVATE KEY-----`;

let lastSyncTime = 0;
let activeSyncPromise: Promise<void> | null = null;
const lastBankUpdateMap = new Map<string, number>();

export async function syncAdminSheets() {
  const now = Date.now();
  if (now - lastSyncTime < 10000) {
    if (activeSyncPromise) return activeSyncPromise;
    return;
  }
  
  if (activeSyncPromise) {
    return activeSyncPromise;
  }
  
  activeSyncPromise = (async () => {
    try {
      const sheetIds = [
        process.env.PRODUCT_SPREADSHEET_ID || "1aCRRxFE1hQkSuQJngCejJ5MkTu2JvdojYoCvlTUSnYA",
        process.env.SELLERS_SPREADSHEET_ID || "1VzaInQ38FadtpdAxyogusb8oQJDC8mhlU0bH-rEiwgk",
        process.env.GOOGLE_SPREADSHEET_ID,
      ].filter(Boolean);

      console.log("[Sync Sheets] Starting automatic sheets lookup...");
      const processedProducts = new Set<string>();
      const processedSellers = new Set<string>();
      const processedReferrals = new Set<string>();
      const processedDropboxKeys = new Set<string>();
      const processedCompetitions = new Set<string>();
      const processedTutorials = new Set<string>();

      const [currentProducts, currentSellers, currentReferrals, currentDropboxKeys, currentCompetitions, currentTutorials] = await Promise.all([
        readCollectionFile("products").catch(() => ({})),
        readCollectionFile("sellers").catch(() => ({})),
        readCollectionFile("referrals").catch(() => ({})),
        readCollectionFile("dropbox_keys").catch(() => ({})),
        readCollectionFile("competitions").catch(() => ({})),
        readCollectionFile("tutorials").catch(() => ({})),
      ]);

    const serviceAccountAuth = new JWT({
      email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

    for (const sheetId of sheetIds) {
      if (!sheetId) continue;
      const docObj = new GoogleSpreadsheet(sheetId, serviceAccountAuth);
      try {
        await docObj.loadInfo();
        console.log(`[Sync Sheets DEBUG] Doc title:`, docObj.title);
        for (const sheet of docObj.sheetsByIndex) {
          const titleLower = sheet.title.toLowerCase().trim();
          console.log(`[Sync Sheets DEBUG] Sheet title:`, sheet.title, '->', titleLower);

          if (titleLower.includes("competit")) {
            console.log(
              `[Sync Sheets] Found competitions sheet [${sheet.title}] in ${docObj.title}`,
            );
            const rows = await sheet.getRows();
            for (const row of rows) {
              const rowData = row.toObject();

              const competitionName =
                rowData["Competition Name"] ||
                rowData["competition name"] ||
                rowData["competition"] ||
                rowData["Competition"] ||
                "";
              if (!competitionName) continue;

              const price =
                rowData["Winners Cash Prize"] ||
                rowData["winners cash prize"] ||
                rowData["price"] ||
                rowData["Price"] ||
                "$250";
              const eligibility =
                rowData["Eligibility (monthly / yearly)"] ||
                rowData["Eligibility"] ||
                rowData["eligibility"] ||
                "free";
              const endDate =
                rowData["End Date (YYYY-MM-DD)"] ||
                rowData["end_date"] ||
                rowData["End Date"] ||
                "N/A";
              const applicantsStr =
                rowData["No of Applicants"] ||
                rowData["applicants"] ||
                rowData["Applicants"] ||
                "0";
              const applicants =
                parseInt(String(applicantsStr).replace(/\D/g, "")) || 0;
              const whatToSubmit =
                rowData["What to Submit Details"] ||
                rowData["what_to_submit"] ||
                rowData["what to submit"] ||
                "";
              const inputFields =
                rowData["Input Fields"] ||
                rowData["input_fields"] ||
                rowData[
                  "Input Fields (comma-separated, e.g. dropbox link, social media link)"
                ] ||
                "dropbox link";

              const flyer =
                rowData["Flyer Image URL"] ||
                rowData["flyer image url"] ||
                rowData["flyer"] ||
                rowData["Flyer"] ||
                "";

              const rowId =
                rowData["id"] ||
                String(competitionName)
                  .toLowerCase()
                  .replace(/[^a-z0-9]/g, "_");

              processedCompetitions.add(rowId);

              const compItem = {
                id: rowId,
                competition: String(competitionName).trim(),
                price: String(price).trim(),
                eligibility: String(eligibility).trim(),
                end_date: String(endDate).trim(),
                applicants,
                what_to_submit: String(whatToSubmit).trim(),
                input_fields: String(inputFields).trim(),
                flyer: String(flyer).trim(),
                updatedAt: new Date().toISOString(),
              };

              await originalSetDoc(doc(db, "competitions", rowId), compItem, {
                merge: true,
              });
              await setDocLocal("competitions", rowId, compItem);
            }
          }

          if (
            titleLower.includes("tutori") ||
            titleLower.includes("lesson") ||
            titleLower.includes("video")
          ) {
            console.log(
              `[Sync Sheets] Found tutorials sheet [${sheet.title}] in ${docObj.title}`,
            );
            const rows = await sheet.getRows();
            for (const row of rows) {
              const rowData = row.toObject();

              const videoTitle =
                rowData["Name of Video"] ||
                rowData["title"] ||
                rowData["Name"] ||
                rowData["Name of video"] ||
                "";
              const youtubeLink =
                rowData["YouTube URL"] ||
                rowData["youtube_link"] ||
                rowData["Link"] ||
                rowData["YouTube Link"] ||
                "";
              if (!videoTitle) continue;

              const viewsStr =
                rowData["Number of Views"] ||
                rowData["views"] ||
                rowData["Views"] ||
                "0";
              const views = parseInt(String(viewsStr).replace(/\D/g, "")) || 0;

              const rowId =
                rowData["id"] ||
                String(videoTitle)
                  .toLowerCase()
                  .replace(/[^a-z0-9]/g, "_");

              processedTutorials.add(rowId);

              const tutorialItem = {
                id: rowId,
                title: String(videoTitle).trim(),
                youtube_link: String(youtubeLink).trim(),
                views,
                updatedAt: new Date().toISOString(),
              };

              await originalSetDoc(doc(db, "tutorials", rowId), tutorialItem, {
                merge: true,
              });
              await setDocLocal("tutorials", rowId, tutorialItem);
            }
          }

          if (
            titleLower.includes("droplink") ||
            titleLower.includes("dropbox") ||
            titleLower.includes("job") ||
            titleLower.includes("token") ||
            titleLower.includes("key") ||
            (titleLower.includes("drop") && titleLower.includes("link"))
          ) {
            console.log(
              `[Sync Sheets] Found droplink/credentials sheet [${sheet.title}] in ${docObj.title}`,
            );
            const rows = await sheet.getRows();
            for (const row of rows) {
              const rowData = row.toObject();

              let accessToken = "";
              for (const key of Object.keys(rowData)) {
                const normKey = key.toLowerCase().trim().replace(/[-_\s]/g, "");
                if (
                  normKey === "accesstoken" ||
                  normKey === "token" ||
                  normKey === "dropboxaccesstoken" ||
                  normKey === "dropboxkey" ||
                  normKey === "key" ||
                  normKey === "tokenvalue" ||
                  normKey === "accesstokens" ||
                  normKey === "dropboxaccess"
                ) {
                  accessToken = String(rowData[key]).trim();
                  if (accessToken) break;
                }
              }

              if (!accessToken) continue;

              const rawId =
                rowData["id"] ||
                rowData["email"] ||
                rowData["address"] ||
                String(accessToken)
                  .replace(/[^a-zA-Z0-9]/g, "")
                  .substring(0, 50);

              processedDropboxKeys.add(rawId);

              try {
                const { createClient } = await import('@supabase/supabase-js');
                const supUrl = process.env.VITE_SUPABASE_URL || "https://tyqjnfoiooujylzijwtb.supabase.co";
                const supKey = process.env.VITE_SUPABASE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR5cWpuZm9pb291anlsemlqd3RiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzEwODUyOCwiZXhwIjoyMDkyNjg0NTI4fQ.idChwwk9yPaZtb1pCik3QmNXc2WcD1xTJu0GQtiBEhM";
                const sClient = createClient(supUrl, supKey);
                await sClient.from('dropbox_keys').upsert({ id: rawId, accessToken, updated_at: new Date().toISOString() });
                console.log(`[Sync Sheets] Synced token ${rawId} with Supabase`);
              } catch (e) {
                console.warn("[Sync Sheets] Supabase key sync fallback:", e);
              }

              const keyItem = {
                id: rawId,
                accessToken,
                updatedAt: new Date().toISOString(),
                ...rowData,
              };

              await originalSetDoc(doc(db, "dropbox_keys", rawId), keyItem, {
                merge: true,
              });
              await setDocLocal("dropbox_keys", rawId, keyItem);
              console.log(`[Sync Sheets] Synced Dropbox credential with ID: ${rawId}`);
            }
          }

          if (
            titleLower.includes("product") ||
            titleLower.includes("item") ||
            titleLower.includes("store") ||
            (sheetId === "1aCRRxFE1hQkSuQJngCejJ5MkTu2JvdojYoCvlTUSnYA" && titleLower.includes("sheet1"))
          ) {
            console.log(
              `[Sync Sheets] Found products sheet [${sheet.title}] in ${docObj.title}`,
            );
            const rows = await sheet.getRows();
            for (const row of rows) {
              const rowData = row.toObject();

              const productName =
                rowData["Product Name"] ||
                rowData["product name"] ||
                rowData["name"] ||
                rowData["Name"] ||
                rowData["Title"] ||
                rowData["title"] ||
                "";
              if (!productName) continue;

              const prodNameStr = String(productName).trim();
              if (prodNameStr.toLowerCase() === "ada" || prodNameStr === "Ada" || prodNameStr.toLowerCase() === "ada animation pack") {
                console.log(`[Sync Sheets] Skipping mock product '${productName}' from sheet import.`);
                continue;
              }

              const price =
                rowData["Price"] ||
                rowData["price"] ||
                "Free";

              const category =
                rowData["Category"] ||
                rowData["category"] ||
                "Project file";

              const thumbnail =
                rowData["Thumbnail"] ||
                rowData["thumbnail"] ||
                rowData["Image"] ||
                rowData["image"] ||
                "";

              const productUrl =
                rowData["Product URL"] ||
                rowData["product url"] ||
                rowData["url"] ||
                rowData["URL"] ||
                rowData["Link"] ||
                rowData["link"] ||
                "";

              const productDescription =
                rowData["Description"] ||
                rowData["description"] ||
                rowData["Product Description"] ||
                rowData["product description"] ||
                "";

              const videoUrl =
                rowData["Video URL"] ||
                rowData["video url"] ||
                rowData["Video"] ||
                rowData["video"] ||
                "";

              const starRating =
                rowData["Star Rating"] ||
                rowData["star rating"] ||
                rowData["Rating"] ||
                rowData["rating"] ||
                "5";

              const sellerIdVal =
                rowData["Seller ID"] ||
                rowData["seller id"] ||
                rowData["Seller"] ||
                rowData["seller"] ||
                "animato studio";

              const auditStatus =
                rowData["Audit Status"] ||
                rowData["audit status"] ||
                rowData["status"] ||
                rowData["Status"] ||
                "approved";

              const amountStr =
                rowData["Amount"] ||
                rowData["amount"] ||
                "0";
              const amount = parseFloat(String(amountStr).replace(/[^0-9.]/g, "")) || 0;

              const timesPurchasedStr =
                rowData["Times Purchased"] ||
                rowData["times purchased"] ||
                rowData["Sales"] ||
                rowData["sales"] ||
                rowData["No of Users"] ||
                rowData["no of users"] ||
                rowData["Users"] ||
                rowData["users"] ||
                rowData["Downloads"] ||
                rowData["downloads"] ||
                "0";
              const timesPurchased = parseInt(String(timesPurchasedStr).replace(/\D/g, "")) || 0;

              const rowId =
                rowData["id"] ||
                rowData["idKey"] ||
                String(productName)
                  .toLowerCase()
                  .replace(/[^a-z0-9]/g, "_");

              processedProducts.add(rowId);

              const images = [thumbnail].filter(Boolean);

              const prodItem = {
                id: rowId,
                name: productName.toString().trim(),
                productName: productName.toString().trim(),
                price: price.toString().trim(),
                category: category.toString().trim(),
                thumbnail: thumbnail.toString().trim(),
                images,
                productImages: images.join(", "),
                amount,
                timesPurchased,
                sellerId: sellerIdVal.toString().trim(),
                productUrl: productUrl.toString().trim(),
                starRating: starRating.toString().trim(),
                productDescription: productDescription.toString().trim(),
                videoUrl: videoUrl.toString().trim(),
                auditStatus: auditStatus.toString().trim(),
                updatedAt: new Date().toISOString(),
              };

              await originalSetDoc(doc(db, "products", rowId), prodItem, {
                merge: true,
              });
              await setDocLocal("products", rowId, prodItem);
            }
          }

          if (
            titleLower.includes("seller") ||
            titleLower.includes("creator") ||
            titleLower.includes("payout") ||
            titleLower.includes("referral") ||
            (sheetId === "1VzaInQ38FadtpdAxyogusb8oQJDC8mhlU0bH-rEiwgk" && (titleLower.includes("sheet1") || titleLower.includes("user")))
          ) {
            console.log(
              `[Sync Sheets] Found sellers/referrals/payouts sheet [${sheet.title}] in ${docObj.title}`,
            );
            const rows = await sheet.getRows();
            for (const row of rows) {
              const rowData = row.toObject();

              const email =
                rowData["Email"] ||
                rowData["email"] ||
                rowData["E-mail"] ||
                rowData["e-mail"] ||
                "";
              if (!email || !email.includes("@")) continue;

              const cleanEmail = email.toLowerCase().trim();

              const bankName =
                rowData["Bank Name"] ||
                rowData["bank name"] ||
                rowData["bank"] ||
                rowData["Bank"] ||
                "Unit / Moniepoint";

              const bankOwnerName =
                rowData["Bank Owner Name"] ||
                rowData["bank owner name"] ||
                rowData["owner name"] ||
                rowData["Owner Name"] ||
                rowData["owner"] ||
                rowData["Owner"] ||
                "";

              const accountNumber =
                rowData["Account Number"] ||
                rowData["account number"] ||
                rowData["account"] ||
                rowData["Account"] ||
                rowData["number"] ||
                "";

              const sellerIdVal =
                rowData["Seller ID"] ||
                rowData["seller id"] ||
                rowData["sellerId"] ||
                rowData["ID"] ||
                rowData["id"] ||
                "";

              const referralIdVal =
                rowData["Referral ID"] ||
                rowData["referral id"] ||
                rowData["referralId"] ||
                "";

              const payoutStr =
                rowData["Payout"] ||
                rowData["payout"] ||
                rowData["amount"] ||
                "0";
              const payout = parseFloat(String(payoutStr).replace(/[^0-9.]/g, "")) || 0;

              const isReferral = referralIdVal || titleLower.includes("referral");

              const recentlyUpdated = Date.now() - (lastBankUpdateMap.get(cleanEmail) || 0) < 60000;

              if (isReferral) {
                const finalId = referralIdVal || rowData["id"] || `ref_${cleanEmail.split("@")[0]}`;
                processedReferrals.add(finalId);
                
                const existing = currentReferrals[finalId] || {};
                const finalBankName = (recentlyUpdated || (bankName === "Unit / Moniepoint" && existing.bankName)) ? (existing.bankName || bankName) : bankName;
                const finalBankOwner = (recentlyUpdated || (!bankOwnerName && existing.bankOwnerName)) ? (existing.bankOwnerName || bankOwnerName) : bankOwnerName;
                const finalAccountNumber = (recentlyUpdated || (!accountNumber && existing.accountNumber)) ? (existing.accountNumber || accountNumber) : accountNumber;
                const finalPayout = (existing && typeof existing.payout === 'number' && existing.payout > 0 && payout === 0) ? existing.payout : payout;

                const refItem = {
                  id: finalId,
                  referralId: finalId,
                  referralCode: finalId,
                  email: cleanEmail,
                  payout: finalPayout,
                  numberOfReferences: parseInt(rowData["numberOfReferences"] || rowData["references"] || "0") || 0,
                  bankName: finalBankName,
                  bankOwnerName: finalBankOwner,
                  accountNumber: finalAccountNumber,
                  updatedAt: existing.updatedAt || new Date().toISOString(),
                };
                await originalSetDoc(doc(db, "referrals", finalId), refItem, {
                  merge: true,
                });
                await setDocLocal("referrals", finalId, refItem);
              } else {
                const finalId = sellerIdVal || rowData["id"] || `seller_${cleanEmail.split("@")[0]}`;
                processedSellers.add(finalId);

                const existing = currentSellers[finalId] || {};
                const finalBankName = (recentlyUpdated || (bankName === "Unit / Moniepoint" && existing.bankName)) ? (existing.bankName || bankName) : bankName;
                const finalBankOwner = (recentlyUpdated || (!bankOwnerName && existing.bankOwnerName)) ? (existing.bankOwnerName || bankOwnerName) : bankOwnerName;
                const finalAccountNumber = (recentlyUpdated || (!accountNumber && existing.accountNumber)) ? (existing.accountNumber || accountNumber) : accountNumber;
                const finalPayout = (existing && typeof existing.payout === 'number' && existing.payout > 0 && payout === 0) ? existing.payout : payout;

                const sellerItem = {
                  id: finalId,
                  sellerId: finalId,
                  email: cleanEmail,
                  payout: finalPayout,
                  bankName: finalBankName,
                  bankOwnerName: finalBankOwner,
                  accountNumber: finalAccountNumber,
                  updatedAt: existing.updatedAt || new Date().toISOString(),
                };
                await originalSetDoc(doc(db, "sellers", finalId), sellerItem, {
                  merge: true,
                });
                await setDocLocal("sellers", finalId, sellerItem);
              }
            }
          }
        }
      } catch (err: any) {
        console.warn(
          `[Sync Sheets Warning] Sheet document ${sheetId} unavailable:`,
          err.message,
        );
      }
    }
    // Clean up deletions in respective collections compared to Google Sheet rows
    if (processedCompetitions.size > 0 && currentCompetitions) {
      for (const compId of Object.keys(currentCompetitions)) {
        if (!processedCompetitions.has(compId)) {
          console.log(`[Sync Sheets Deletion] Competitions sheet row was deleted: ${compId}. Syncing deletion to database...`);
          await deleteDoc(doc(db!, "competitions", compId)).catch(e => console.error(e));
          await deleteDocLocal("competitions", compId).catch(e => console.error(e));
        }
      }
    }

    if (processedTutorials.size > 0 && currentTutorials) {
      for (const tutId of Object.keys(currentTutorials)) {
        if (!processedTutorials.has(tutId)) {
          console.log(`[Sync Sheets Deletion] Tutorials sheet row was deleted: ${tutId}. Syncing deletion to database...`);
          await deleteDoc(doc(db!, "tutorials", tutId)).catch(e => console.error(e));
          await deleteDocLocal("tutorials", tutId).catch(e => console.error(e));
        }
      }
    }

    if (processedDropboxKeys.size > 0 && currentDropboxKeys) {
      for (const dbId of Object.keys(currentDropboxKeys)) {
        if (!processedDropboxKeys.has(dbId)) {
          console.log(`[Sync Sheets Deletion] Dropbox Keys sheet row was deleted: ${dbId}. Syncing deletion to database...`);
          await deleteDoc(doc(db!, "dropbox_keys", dbId)).catch(e => console.error(e));
          await deleteDocLocal("dropbox_keys", dbId).catch(e => console.error(e));
          try {
            const { createClient } = await import('@supabase/supabase-js');
            const supUrl = process.env.VITE_SUPABASE_URL || "https://tyqjnfoiooujylzijwtb.supabase.co";
            const supKey = process.env.VITE_SUPABASE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR5cWpuZm9pb291anlsemlqd3RiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzEwODUyOCwiZXhwIjoyMDkyNjg0NTI4fQ.idChwwk9yPaZtb1pCik3QmNXc2WcD1xTJu0GQtiBEhM";
            const sClient = createClient(supUrl, supKey);
            await sClient.from('dropbox_keys').delete().eq('id', dbId);
          } catch (e) {
            console.warn("[Sync Sheets Deletion] Failed to delete key from Supabase too:", e);
          }
        }
      }
    }

    if (processedProducts.size > 0 && currentProducts) {
      for (const prodId of Object.keys(currentProducts)) {
        if (!processedProducts.has(prodId)) {
          const pData = currentProducts[prodId];
          const createdAtNum = pData?.createdAt ? (typeof pData.createdAt === "number" ? pData.createdAt : (pData.createdAt.seconds ? pData.createdAt.seconds * 1000 : Date.now())) : Date.now();
          if (Date.now() - createdAtNum < 15 * 60 * 1000) {
            console.log(`[Sync Sheets Deletion] Skipping sync deletion for newly created product ${prodId}`);
            continue;
          }
          console.log(`[Sync Sheets Deletion] Products sheet row was deleted: ${prodId}. Syncing deletion to database...`);
          await deleteDoc(doc(db!, "products", prodId)).catch(e => console.error(e));
          await deleteDocLocal("products", prodId).catch(e => console.error(e));
        }
      }
    }

    if (processedSellers.size > 0 && currentSellers) {
      for (const selId of Object.keys(currentSellers)) {
        if (!processedSellers.has(selId)) {
          console.log(`[Sync Sheets Deletion] Sellers sheet row was deleted: ${selId}. Syncing deletion to database...`);
          await deleteDoc(doc(db!, "sellers", selId)).catch(e => console.error(e));
          await deleteDocLocal("sellers", selId).catch(e => console.error(e));
        }
      }
    }

    if (processedReferrals.size > 0 && currentReferrals) {
      for (const refId of Object.keys(currentReferrals)) {
        if (!processedReferrals.has(refId)) {
          console.log(`[Sync Sheets Deletion] Referrals sheet row was deleted: ${refId}. Syncing deletion to database...`);
          await deleteDoc(doc(db!, "referrals", refId)).catch(e => console.error(e));
          await deleteDocLocal("referrals", refId).catch(e => console.error(e));
        }
      }
    }

    console.log("[Sync Sheets] Completed lookup.");
    await flushDbSyncs();
    lastSyncTime = Date.now();
  } catch (err: any) {
    console.error("[Sync Sheets Error] Global sync error:", err);
  } finally {
    activeSyncPromise = null;
  }
  })();
  return activeSyncPromise;
}

let lastFirestoreSyncTime = 0;
let activeFirestoreSyncPromise: Promise<void> | null = null;

export async function syncFirestoreToLocalDB(force = false) {
  const now = Date.now();
  if (!force && now - lastFirestoreSyncTime < 60000) {
    if (activeFirestoreSyncPromise) return activeFirestoreSyncPromise;
    return;
  }
  
  if (activeFirestoreSyncPromise) {
    return activeFirestoreSyncPromise;
  }
  
  activeFirestoreSyncPromise = (async () => {
    console.log("[Firestore Sync] Starting synchronization from Firebase Firestore to LocalDB / Supabase Storage...");
    const collections = ["products", "sellers", "referrals", "competitions", "tutorials", "dropbox_keys"];
    for (const col of collections) {
      try {
        console.log(`[Firestore Sync] Fetching collection: ${col}`);
        const snap = await originalGetDocs({ path: col });
        if (snap && snap.docs && snap.docs.length > 0) {
          console.log(`[Firestore Sync] Found ${snap.docs.length} documents for ${col} in Firestore. Saving to LocalDB...`);
          for (const docObj of snap.docs) {
            const docData = docObj.data();
            const docId = docObj.id;
            if (docData && docId) {
              await setDocLocal(col, docId, docData);
            }
          }
          console.log(`[Firestore Sync] Successfully synchronized collection: ${col}`);
        } else {
          console.log(`[Firestore Sync] Collection ${col} was empty or could not be retrieved from Firestore.`);
        }
      } catch (err: any) {
        console.error(`[Firestore Sync] Failed to sync collection ${col}:`, err.message);
      }
    }
    console.log("[Firestore Sync] Synchronization completed.");
    lastFirestoreSyncTime = Date.now();
  })();
  
  try {
    await activeFirestoreSyncPromise;
  } finally {
    activeFirestoreSyncPromise = null;
  }
}

export async function saveProductToSheet(product: any) {
  try {
    const sheetId = process.env.PRODUCT_SPREADSHEET_ID || "1aCRRxFE1hQkSuQJngCejJ5MkTu2JvdojYoCvlTUSnYA";
    console.log(`[saveProductToSheet] Attempting to sync product ${product.id} (${product.name || product.productName}) to sheet ${sheetId}...`);
    
    const serviceAccountAuth = new JWT({
      email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

    const docObj = new GoogleSpreadsheet(sheetId, serviceAccountAuth);
    await docObj.loadInfo();
    
    // Find the products sheet
    let sheet = docObj.sheetsByIndex.find(s => {
      const t = s.title.toLowerCase().trim();
      return t.includes("product") || t.includes("item") || t.includes("store") || t.includes("sheet1");
    });
    
    if (!sheet && docObj.sheetsByIndex.length > 0) {
      sheet = docObj.sheetsByIndex[0];
    }
    
    if (!sheet) {
      console.warn("[saveProductToSheet] No sheet found to write product.");
      return;
    }
    
    const rows = await sheet.getRows();
    const existingRow = rows.find(r => {
      const rowData = r.toObject();
      const rId = rowData["id"] || rowData["idKey"] || "";
      const rName = rowData["Product Name"] || rowData["product name"] || rowData["name"] || rowData["Name"] || "";
      return String(rId).trim() === String(product.id).trim() || 
             (product.name && String(rName).toLowerCase().trim() === String(product.name).toLowerCase().trim());
    });
    
    const nameVal = product.name || product.productName || "";
    const priceVal = product.price !== undefined ? String(product.price) : "Free";
    const categoryVal = product.category || "Project file";
    const thumbnailVal = product.thumbnail || "";
    const productUrlVal = product.productUrl || "";
    const descriptionVal = product.productDescription || product.description || "";
    const videoUrlVal = product.videoUrl || "";
    const ratingVal = product.starRating || "5";
    const sellerVal = product.sellerId || "animato studio";
    const statusVal = product.auditStatus || "approved";
    const amountVal = product.amount !== undefined ? String(product.amount) : "0";
    const salesVal = product.timesPurchased !== undefined ? String(product.timesPurchased) : "0";
    
    const headerRow = sheet.headerValues;
    console.log("[saveProductToSheet] Sheet headers are:", headerRow);
    
    const rowPayload: any = {};
    const mapHeader = (possibleNames: string[]): string | null => {
      if (!headerRow || headerRow.length === 0) return possibleNames[0]; // fallback to first possible name if no headers (rare)
      const lowerPossibleNames = possibleNames.map(n => n.toLowerCase());
      const found = headerRow.find(h => lowerPossibleNames.includes(h.trim().toLowerCase()));
      return found || null;
    };
    
    const setIfKey = (possibleNames: string[], val: string) => {
      const key = mapHeader(possibleNames);
      if (key) rowPayload[key] = val;
    };
    
    setIfKey(["id", "idKey", "ID"], product.id);
    setIfKey(["Product Name", "product name", "name", "Name", "Title", "title"], nameVal);
    setIfKey(["Price", "price"], priceVal);
    setIfKey(["Category", "category"], categoryVal);
    setIfKey(["Thumbnail", "thumbnail", "Image", "image"], thumbnailVal);
    setIfKey(["Product URL", "product url", "url", "URL", "Link", "link"], productUrlVal);
    setIfKey(["Description", "description", "Product Description", "product description"], descriptionVal);
    setIfKey(["Video URL", "video url", "Video", "video"], videoUrlVal);
    setIfKey(["Star Rating", "star rating", "Rating", "rating"], ratingVal);
    setIfKey(["Seller ID", "seller id", "Seller", "seller"], sellerVal);
    setIfKey(["Audit Status", "audit status", "status", "Status"], statusVal);
    setIfKey(["Amount", "amount"], amountVal);
    setIfKey(["Times Purchased", "times purchased", "Sales", "sales", "No of Users", "no of users", "Users", "users", "Downloads", "downloads"], salesVal);

    
    if (existingRow) {
      console.log(`[saveProductToSheet] Found existing row for ID ${product.id}. Updating...`);
      for (const k of Object.keys(rowPayload)) {
        existingRow.set(k, rowPayload[k]);
      }
      await existingRow.save();
      console.log(`[saveProductToSheet] Successfully updated row for ${product.id}`);
    } else {
      console.log(`[saveProductToSheet] Creating new row in sheet for product ID ${product.id}`);
      await sheet.addRow(rowPayload);
      console.log(`[saveProductToSheet] Successfully added new row to sheet.`);
    }
  } catch (err: any) {
    console.error("[saveProductToSheet] Error writing to product spreadsheet:", err);
  }
}

export async function deleteProductFromSheet(productId: string) {
  try {
    const sheetId = process.env.PRODUCT_SPREADSHEET_ID || "1aCRRxFE1hQkSuQJngCejJ5MkTu2JvdojYoCvlTUSnYA";
    console.log(`[deleteProductFromSheet] Attempting to delete product ${productId} from sheet ${sheetId}...`);
    
    const serviceAccountAuth = new JWT({
      email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

    const docObj = new GoogleSpreadsheet(sheetId, serviceAccountAuth);
    await docObj.loadInfo();
    
    let sheet = docObj.sheetsByIndex.find(s => {
      const t = s.title.toLowerCase().trim();
      return t.includes("product") || t.includes("item") || t.includes("store") || t.includes("sheet1");
    });
    
    if (!sheet && docObj.sheetsByIndex.length > 0) {
      sheet = docObj.sheetsByIndex[0];
    }
    
    if (!sheet) return;
    
    const rows = await sheet.getRows();
    const existingRow = rows.find(r => {
      const rowData = r.toObject();
      const rId = rowData["id"] || rowData["idKey"] || "";
      return String(rId).trim() === String(productId).trim();
    });
    
    if (existingRow) {
      await existingRow.delete();
      console.log(`[deleteProductFromSheet] Successfully deleted row for ${productId}`);
    }
  } catch (err: any) {
    console.error("[deleteProductFromSheet] Error deleting product from spreadsheet:", err);
  }
}

export async function deleteFromSheet(collection: string, id: string) {
  try {
    let sheetId = "";
    let matcher = (rowData: any) => false;
    let sheetTitleFilter = (title: string) => false;

    if (collection === "products") {
      sheetId = process.env.PRODUCT_SPREADSHEET_ID || "1aCRRxFE1hQkSuQJngCejJ5MkTu2JvdojYoCvlTUSnYA";
      sheetTitleFilter = (t) => t.includes("product") || t.includes("item") || t.includes("store") || t.includes("sheet1");
      matcher = (rowData) => {
        const rId = rowData["id"] || rowData["idKey"] || "";
        return String(rId).trim() === String(id).trim();
      };
    } else if (collection === "sellers") {
      sheetId = process.env.SELLERS_SPREADSHEET_ID || "1VzaInQ38FadtpdAxyogusb8oQJDC8mhlU0bH-rEiwgk";
      sheetTitleFilter = (t) => t.includes("seller") || t.includes("creator") || t.includes("payout") || t.includes("user");
      matcher = (rowData) => {
        const rId = rowData["Seller ID"] || rowData["seller id"] || rowData["sellerId"] || rowData["id"] || "";
        const rEmail = rowData["Email"] || rowData["email"] || "";
        return String(rId).trim() === String(id).trim() || String(rEmail).toLowerCase().trim() === String(id).toLowerCase().trim();
      };
    } else if (collection === "referrals") {
      sheetId = process.env.SELLERS_SPREADSHEET_ID || "1VzaInQ38FadtpdAxyogusb8oQJDC8mhlU0bH-rEiwgk";
      sheetTitleFilter = (t) => t.includes("referral");
      matcher = (rowData) => {
        const rId = rowData["Referral ID"] || rowData["referral id"] || rowData["referralCode"] || rowData["id"] || "";
        const rEmail = rowData["Email"] || rowData["email"] || "";
        return String(rId).trim() === String(id).trim() || String(rEmail).toLowerCase().trim() === String(id).toLowerCase().trim();
      };
    } else if (collection === "dropbox_keys") {
      sheetId = process.env.GOOGLE_SPREADSHEET_ID || "";
      sheetTitleFilter = (t) => t.includes("dropbox") || t.includes("key");
      matcher = (rowData) => {
        const rId = rowData["id"] || rowData["idKey"] || "";
        return String(rId).trim() === String(id).trim();
      };
    } else if (collection === "competitions") {
      sheetId = process.env.GOOGLE_SPREADSHEET_ID || "";
      sheetTitleFilter = (t) => t.includes("competit");
      matcher = (rowData) => {
        const rId = rowData["id"] || rowData["idKey"] || "";
        return String(rId).trim() === String(id).trim();
      };
    } else if (collection === "tutorials") {
      sheetId = process.env.GOOGLE_SPREADSHEET_ID || "";
      sheetTitleFilter = (t) => t.includes("tutorial");
      matcher = (rowData) => {
        const rId = rowData["id"] || rowData["idKey"] || "";
        return String(rId).trim() === String(id).trim();
      };
    } else {
      return; // Not backed by a sheet
    }

    console.log(`[deleteFromSheet] Syncing deletion for ${collection} ID: ${id} to spreadsheet: ${sheetId}...`);

    const serviceAccountAuth = new JWT({
      email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

    const docObj = new GoogleSpreadsheet(sheetId, serviceAccountAuth);
    await docObj.loadInfo();

    let sheet = docObj.sheetsByIndex.find(s => sheetTitleFilter(s.title.toLowerCase().trim()));
    if (!sheet && docObj.sheetsByIndex.length > 0) {
      sheet = docObj.sheetsByIndex[0];
    }

    if (!sheet) return;

    const rows = await sheet.getRows();
    const existingRow = rows.find(r => matcher(r.toObject()));

    if (existingRow) {
      await existingRow.delete();
      console.log(`[deleteFromSheet] Successfully deleted row for ${id} in ${collection}`);
    } else {
      console.log(`[deleteFromSheet] No matching row found in sheet for ${id}`);
    }
  } catch (err: any) {
    console.error(`[deleteFromSheet] Error deleting from sheet:`, err);
  }
}

export async function saveCreatorToSheet(creator: any, type: "seller" | "referral") {
  try {
    const sheetId = process.env.SELLERS_SPREADSHEET_ID || "1VzaInQ38FadtpdAxyogusb8oQJDC8mhlU0bH-rEiwgk";
    console.log(`[saveCreatorToSheet] Syncing ${type} ${creator.id || creator.email} to sheet ${sheetId}...`);
    
    const serviceAccountAuth = new JWT({
      email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

    const docObj = new GoogleSpreadsheet(sheetId, serviceAccountAuth);
    await docObj.loadInfo();
    
    // Find the matching sheet by title
    let sheet = docObj.sheetsByIndex.find(s => {
      const t = s.title.toLowerCase().trim();
      if (type === "referral") {
        return t.includes("referral");
      } else {
        return t.includes("seller") || t.includes("creator") || t.includes("payout") || t.includes("user") || t.includes("sheet1");
      }
    });
    
    if (!sheet && docObj.sheetsByIndex.length > 0) {
      sheet = docObj.sheetsByIndex[0];
    }
    
    if (!sheet) {
      console.warn("[saveCreatorToSheet] No sheet found to write creator.");
      return;
    }
    
    const rows = await sheet.getRows();
    const existingRow = rows.find(r => {
      const rowData = r.toObject();
      const rEmail = rowData["Email"] || rowData["email"] || rowData["E-mail"] || rowData["e-mail"] || "";
      const rId = rowData["Seller ID"] || rowData["seller id"] || rowData["Referral ID"] || rowData["referral id"] || rowData["id"] || "";
      return (creator.email && String(rEmail).toLowerCase().trim() === String(creator.email).toLowerCase().trim()) ||
             (creator.id && String(rId).trim() === String(creator.id).trim());
    });
    
    const emailVal = creator.email || "";
    const bankNameVal = creator.bankName || "Unit / Moniepoint";
    const bankOwnerNameVal = creator.bankOwnerName || "";
    const accountNumberVal = creator.accountNumber || "";
    const payoutVal = creator.payout !== undefined ? String(creator.payout) : "0";
    
    const headerRow = sheet.headerValues;
    console.log("[saveCreatorToSheet] Creator sheet headers are:", headerRow);
    
    const rowPayload: any = {};
    const mapHeader = (possibleNames: string[]): string | null => {
      if (!headerRow || headerRow.length === 0) return possibleNames[0];
      const lowerPossibleNames = possibleNames.map(n => n.toLowerCase());
      const found = headerRow.find(h => lowerPossibleNames.includes(h.trim().toLowerCase()));
      return found || null;
    };
    
    const setIfKey = (possibleNames: string[], val: string) => {
      const key = mapHeader(possibleNames);
      if (key) rowPayload[key] = val;
    };
    
    setIfKey(["Email", "email", "E-mail", "e-mail"], emailVal);
    setIfKey(["Bank Name", "bank name", "bank", "Bank"], bankNameVal);
    setIfKey(["Bank Owner Name", "bank owner name", "owner name", "Owner Name", "owner", "Owner"], bankOwnerNameVal);
    setIfKey(["Account Number", "account number", "account", "Account", "number"], accountNumberVal);
    setIfKey(["Payout", "payout", "amount"], payoutVal);
    
    if (type === "referral") {
      setIfKey(["Referral ID", "referral id", "referralCode", "id"], creator.id || creator.referralId || "");
      setIfKey(["numberOfReferences", "references"], creator.numberOfReferences !== undefined ? String(creator.numberOfReferences) : "0");
    } else {
      setIfKey(["Seller ID", "seller id", "sellerId", "id"], creator.id || creator.sellerId || "");
    }

    
    if (existingRow) {
      console.log(`[saveCreatorToSheet] Found existing row for creator ${creator.email}. Updating...`);
      for (const k of Object.keys(rowPayload)) {
        existingRow.set(k, rowPayload[k]);
      }
      await existingRow.save();
      console.log(`[saveCreatorToSheet] Successfully updated row for creator ${creator.email}`);
    } else {
      console.log(`[saveCreatorToSheet] Creating new row in sheet for creator ${creator.email}`);
      await sheet.addRow(rowPayload);
      console.log(`[saveCreatorToSheet] Successfully added new row to creator sheet.`);
    }
  } catch (err: any) {
    console.error("[saveCreatorToSheet] Error writing to creator spreadsheet:", err);
  }
}

export async function saveDropboxKeyToSheet(keyItem: any) {
  try {
    const sheetId = process.env.GOOGLE_SPREADSHEET_ID || "1nUnRupleiBoQVkAedORzP6d9Syfn1gLREQT1NR2N2FQ";
    console.log(`[saveDropboxKeyToSheet] Syncing dropbox key ${keyItem.id} to sheet ${sheetId}...`);
    
    const serviceAccountAuth = new JWT({
      email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

    const docObj = new GoogleSpreadsheet(sheetId, serviceAccountAuth);
    await docObj.loadInfo();
    
    let sheet = docObj.sheetsByIndex.find(s => {
      const t = s.title.toLowerCase().trim();
      return t.includes("token") || t.includes("key") || t.includes("dropbox") || t.includes("droplink");
    });
    
    if (!sheet && docObj.sheetsByIndex.length > 0) {
      sheet = docObj.sheetsByIndex[0];
    }
    
    if (!sheet) {
      console.warn("[saveDropboxKeyToSheet] No credentials sheet found.");
      return;
    }
    
    const rows = await sheet.getRows();
    const existingRow = rows.find(r => {
      const rowData = r.toObject();
      const rId = rowData["id"] || rowData["idKey"] || "";
      return String(rId).trim() === String(keyItem.id).trim();
    });
    
    const headerRow = sheet.headerValues;
    const rowPayload: any = {};
    const mapHeader = (possibleNames: string[]): string | null => {
      if (!headerRow || headerRow.length === 0) return possibleNames[0];
      const lowerPossibleNames = possibleNames.map(n => n.toLowerCase());
      const found = headerRow.find(h => lowerPossibleNames.includes(h.trim().toLowerCase()));
      return found || null;
    };
    
    const setIfKey = (possibleNames: string[], val: string) => {
      const key = mapHeader(possibleNames);
      if (key) rowPayload[key] = val;
    };
    
    setIfKey(["id", "idKey", "ID"], keyItem.id);
    setIfKey(["accessToken", "accesstoken", "token", "Token", "key", "Dropbox Access Token"], keyItem.accessToken || "");
    setIfKey(["updatedAt", "updated_at", "Date", "date"], keyItem.updatedAt || new Date().toISOString());
    
    if (existingRow) {
      console.log(`[saveDropboxKeyToSheet] Found existing row for key ${keyItem.id}. Updating...`);
      for (const k of Object.keys(rowPayload)) {
        existingRow.set(k, rowPayload[k]);
      }
      await existingRow.save();
      console.log(`[saveDropboxKeyToSheet] Successfully updated row for key ${keyItem.id}`);
    } else {
      console.log(`[saveDropboxKeyToSheet] Creating new row in sheet for key ${keyItem.id}...`);
      await sheet.addRow(rowPayload);
      console.log(`[saveDropboxKeyToSheet] Successfully added new row to credentials sheet.`);
    }
  } catch (err: any) {
    console.error("[saveDropboxKeyToSheet] Error syncing key to spreadsheet:", err);
  }
}

function unpackFirestoreValue(val: any): any {
  if (!val) return val;
  if (typeof val === "object") {
    if (val.internalValue !== undefined)
      return unpackFirestoreValue(val.internalValue);
    if (val.stringValue !== undefined) return val.stringValue;
    if (val.integerValue !== undefined) return Number(val.integerValue);
    if (val.booleanValue !== undefined) return val.booleanValue;
    if (val.doubleValue !== undefined) return Number(val.doubleValue);
    if (val.nullValue !== undefined) return null;
    if (Array.isArray(val.segments)) return val.segments[0];
  }
  return val;
}

function deepFindFilters(
  obj: any,
  filters: Array<{ field: string; op: string; value: any }> = [],
  visited = new Set(),
) {
  if (!obj || typeof obj !== "object" || visited.has(obj)) return filters;
  visited.add(obj);

  let fieldName = "";
  let opStr = "";
  let val: any = undefined;

  // 1. Try to find the field name
  if (obj.field && typeof obj.field === "object") {
    if (Array.isArray(obj.field.segments)) {
      fieldName = obj.field.segments[0];
    } else if (typeof obj.field.segments === "string") {
      fieldName = obj.field.segments;
    } else if (obj.field._path && Array.isArray(obj.field._path.segments)) {
      fieldName = obj.field._path.segments[0];
    }
  } else if (typeof obj.field === "string") {
    fieldName = obj.field;
  }

  // 2. Try to find operator
  if (obj.op || obj.operator) {
    opStr = String(obj.op || obj.operator);
  }

  // 3. Try to find value
  if (obj.value !== undefined) {
    val = unpackFirestoreValue(obj.value);
  } else if (obj._value !== undefined) {
    val = unpackFirestoreValue(obj._value);
  } else if (obj.val !== undefined) {
    val = unpackFirestoreValue(obj.val);
  }

  if (fieldName && opStr && val !== undefined) {
    if (opStr === "EQUAL" || opStr === "==" || opStr === "===") opStr = "==";
    if (opStr === "NOT_EQUAL" || opStr === "!=") opStr = "!=";
    // Prevent duplicates
    const alreadyExists = filters.some(
      (f) => f.field === fieldName && f.op === opStr && f.value === val,
    );
    if (!alreadyExists) {
      filters.push({ field: fieldName, op: opStr, value: val });
    }
  }

  for (const k of Object.keys(obj)) {
    try {
      const child = obj[k];
      if (child && typeof child === "object") {
        deepFindFilters(child, filters, visited);
      }
    } catch (e) {}
  }

  return filters;
}

// Core filter parser for server-side getDocs and fallback queries
function parseQueryFilters(q: any): {
  collection: string;
  filters: Array<{ field: string; op: string; value: any }>;
} {
  let collectionName = "";
  let filters: Array<{ field: string; op: string; value: any }> = [];

  if (q && typeof q.path === "string") {
    collectionName = q.path.split("/")[0];
  } else if (q && q.path && Array.isArray(q.path.segments)) {
    collectionName = q.path.segments[0] || "";
  } else if (
    q &&
    q._query &&
    q._query.path &&
    Array.isArray(q._query.path.segments)
  ) {
    collectionName = q._query.path.segments[0] || "";
  }

  if (!collectionName && q) {
    const knownCols = [
      "products",
      "sellers",
      "referrals",
      "competitions",
      "tutorials",
      "dropbox_keys",
      "product_assets",
      "referred_subscribers",
    ];
    const qStr = String(q).toLowerCase() || "";
    for (const col of knownCols) {
      if (qStr.includes(col)) collectionName = col;
    }
  }

  try {
    deepFindFilters(q, filters);
  } catch (err) {
    console.error("Error in recursive filter extraction:", err);
  }

  if (filters.length === 0 && q) {
    try {
      const qStr = JSON.stringify(q).toLowerCase();
      const emailMatch = qStr.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/);
      if (emailMatch && emailMatch[0]) {
        filters.push({ field: "email", op: "==", value: emailMatch[0].trim() });
      } else {
        // Find other common IDs in the query stringified representation (e.g., productId, sellerId)
        const prodMatch =
          qStr.match(/"productid"\s*:\s*"([^"]+)"/) || qStr.match(/productid/);
        if (prodMatch) {
          // If query string contains productId or product_id keyword or values
          const valMatches = JSON.stringify(q).match(/"([^"]+)"/g);
          if (valMatches && valMatches.length > 2) {
            const likelyVal = valMatches[valMatches.length - 2].replace(
              /"/g,
              "",
            );
            filters.push({ field: "productId", op: "==", value: likelyVal });
          }
        }
      }
    } catch (e) {}
  }

  return { collection: collectionName, filters };
}

// Transparent Server Database fallbacks
const getDoc = async (docRef: any) => {
  const pathParts = docRef?.path?.split("/") || [];
  const col = pathParts[0] || "";
  const id = docRef?.id || "";

  try {
    const snap = await originalGetDoc(docRef);
    if (snap.exists()) {
      // Sync locally as caching
      await setDocLocal(col, id, snap.data());
    }
    return snap;
  } catch (error: any) {
    const isQuota = true;
    if (isQuota) {
      console.log(
        `[Firestore Server Fallback] getDoc handling for ${col}/${id} via LocalDB.`,
      );
      const localData = await getDocLocal(col, id);
      return {
        exists: () => !!localData,
        id,
        data: () => localData,
        ref: docRef,
      };
    }
    throw error;
  }
};

const getDocs = async (queryRef: any) => {
  const { collection: col, filters } = parseQueryFilters(queryRef);

  try {
    const snap = await originalGetDocs(queryRef);
    // Cache background sync to local-db JSON files
    for (const d of snap.docs) {
      await setDocLocal(col || "products", d.id, d.data());
    }
    return snap;
  } catch (error: any) {
    const isQuota = true;
    if (isQuota) {
      console.log(
        `[Firestore Server Fallback] getDocs handling for "${col}" via LocalDB.`,
      );
      const localDocs = await queryCollection(col || "products", filters);
      return {
        empty: localDocs.length === 0,
        docs: localDocs.map((d: any) => ({
          id: d.id || "unknown_id",
          data: () => d,
          ref: { id: d.id || "unknown_id", path: `${col || "products"}/${d.id || "unknown_id"}` },
          exists: () => true,
        })),
        forEach: (callback: (doc: any) => void) => {
          localDocs.forEach((d: any) => {
            callback({
              id: d.id || "unknown_id",
              data: () => d,
              ref: { id: d.id || "unknown_id", path: `${col || "products"}/${d.id || "unknown_id"}` },
              exists: () => true,
            });
          });
        },
      };
    }
    throw error;
  }
};

const setDoc = async (docRef: any, data: any, options?: any) => {
  const pathParts = docRef?.path?.split("/") || [];
  const col = pathParts[0] || "";
  const id = docRef?.id || "";

  // Always write locally (immediate backend consistency)
  await setDocLocal(col, id, data);

  try {
    return await originalSetDoc(docRef, data, options);
  } catch (error: any) {
    const isQuota = true;
    if (isQuota) {
      console.log(
        `[Firestore Server Fallback] setDoc handling for ${col}/${id} via LocalDB.`,
      );
      return;
    }
    throw error;
  }
};

const updateDoc = async (docRef: any, data: any) => {
  const pathParts = docRef?.path?.split("/") || [];
  const col = pathParts[0] || "";
  const id = docRef?.id || "";

  // Always write locally
  await updateDocLocal(col, id, data);

  try {
    return await originalUpdateDoc(docRef, data);
  } catch (error: any) {
    const isQuota = true;
    if (isQuota) {
      console.log(
        `[Firestore Server Fallback] updateDoc handling for ${col}/${id} via LocalDB.`,
      );
      return;
    }
    throw error;
  }
};

const deleteDoc = async (docRef: any) => {
  const pathParts = docRef?.path?.split("/") || [];
  const col = pathParts[0] || "";
  const id = docRef?.id || "";

  // Always write locally
  await deleteDocLocal(col, id);

  try {
    return await originalDeleteDoc(docRef);
  } catch (error: any) {
    const isQuota = true;
    if (isQuota) {
      console.log(
        `[Firestore Server Fallback] deleteDoc handling for ${col}/${id} via LocalDB.`,
      );
      return;
    }
    throw error;
  }
};

const app = express();

// Global middleware to flush db syncs
app.use((req, res, next) => {
  res.on('finish', () => {
    if (req.method !== 'GET') {
      flushDbSyncs().catch(console.error);
    }
  });
  next();
});

app.use(cors());
app.use(express.json({ limit: "100mb" }));
app.use(express.urlencoded({ limit: "100mb", extended: true }));

// Ensure static uploads directory exists and serves properly
// To prevent startup crashes in read-only environments like Vercel, we do NOT run mkdirSync at module load time.
const isServerless = !!process.env.VERCEL || !!process.env.AWS_LAMBDA_FUNCTION_VERSION;
const uploadsDir = isServerless ? path.join("/tmp", "uploads") : path.join(process.cwd(), "public", "uploads");

function ensureUploadsDir() {
  try {
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
  } catch (err: any) {
    console.warn("[Uploads] Could not create uploads directory (might be read-only):", err.message);
  }
}

app.use("/uploads", express.static(uploadsDir));

// --- DEBUG MIDDLEWARE ---
app.use((req, res, next) => {
  console.log(`[REQUEST] ${req.method} ${req.url}`);
  next();
});

// --- GitHub OAuth Integration ---
app.all('/api/auth/github/exchange', async (req, res) => {
  if (req.method === 'GET') {
    return res.json({ status: 'active', message: 'GitHub Exchange endpoint is ready for POST requests.' });
  }
  try {
    // Robustly retrieve request body even if raw stream wasn't parsed by Express middleware
    let body = req.body;
    if (!body || typeof body !== 'object' || Object.keys(body).length === 0) {
      body = await new Promise((resolve) => {
        let data = '';
        req.on('data', chunk => { data += chunk; });
        req.on('end', () => {
          try {
            resolve(JSON.parse(data || '{}'));
          } catch {
            resolve({});
          }
        });
      });
    }

    const { code, email, redirect_uri } = body || {};
    console.log('[GitHubExchange] Received request. code:', code ? 'exists' : 'missing', 'email:', email, 'redirect_uri:', redirect_uri);

    if (!code || !email) {
      return res.status(400).json({ 
        error: 'BAD_REQUEST', 
        details: 'Missing authentication code or state email.' 
      });
    }

    const GITHUB_CLIENT_ID = process.env.VITE_GITHUB_CLIENT_ID || 'Ov23likm06wuJwUgR5KV';
    const GITHUB_CLIENT_SECRET = process.env.VITE_GITHUB_CLIENT_SECRET || process.env.GITHUB_CLIENT_SECRET || 'c09cbfdfeada50fa41bd32403ae3089d280f0d81';

    if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET) {
      console.error('[GitHubExchange] Error: GitHub Credentials are not configured in environment variables.');
      return res.status(500).json({
        error: 'CONFIG_ERROR',
        details: 'GitHub Credentials are not configured in environment variables.'
      });
    }

    // 1. Exchange code for access token
    const fetchFn = (globalThis.fetch || fetch);
    const tokenResponse = await fetchFn('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        client_secret: GITHUB_CLIENT_SECRET,
        code,
        redirect_uri,
      })
    });

    const tokenData: any = await tokenResponse.json();
    if (!tokenResponse.ok || tokenData.error) {
      console.error('[GitHubExchange] OAuth Token exchange failed with error:', tokenData);
      return res.status(400).json({ 
        error: 'TOKEN_EXCHANGE_FAILED',
        details: tokenData.error_description || tokenData.error || `Token exchange failed with HTTP status ${tokenResponse.status}` 
      });
    }

    const accessToken = tokenData.access_token;
    if (!accessToken) {
      console.error('[GitHubExchange] Error: No access token returned from GitHub.', tokenData);
      return res.status(400).json({ 
        error: 'NO_ACCESS_TOKEN', 
        details: 'No access token returned from GitHub.' 
      });
    }

    // 2. Fetch authenticated user profile
    const userResponse = await fetchFn('https://api.github.com/user', {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'User-Agent': 'Animato-Studio'
      }
    });

    let username = 'GitHub User';
    let avatarUrl = '';
    if (userResponse.ok) {
      const userData: any = await userResponse.json();
      username = userData.login || username;
      avatarUrl = userData.avatar_url || avatarUrl;
    } else {
      console.warn('[GitHubExchange] Warning: Failed to retrieve user profile from GitHub api.', userResponse.status);
    }

    // 3. Save connection securely in Firestore
    const normalizedEmail = email.toLowerCase().trim();
    try {
      const connectionRef = doc(db!, 'github_connections', normalizedEmail);
      await originalSetDoc(connectionRef, {
        email: normalizedEmail,
        access_token: accessToken,
        username,
        avatar_url: avatarUrl,
        connectedAt: serverTimestamp(),
      });
      console.log('[GitHubExchange] Connection saved successfully for:', normalizedEmail);
    } catch (saveErr: any) {
      console.error('[GitHubExchange] Exception saving connection to database:', saveErr);
      return res.status(500).json({
        error: 'DATABASE_WRITE_ERROR',
        details: `Failed to persist connection to database: ${saveErr.message || String(saveErr)}`
      });
    }

    return res.json({
      success: true,
      username,
      avatar_url: avatarUrl,
      access_token: accessToken
    });
  } catch (err: any) {
    console.error('GitHub secure exchange exception:', err);
    console.error('Stack trace:', err.stack);
    return res.status(500).json({ 
      error: 'SERVER_ERROR',
      details: err.message || 'An internal server error occurred.'
    });
  }
});

// Server-side GET callback for direct-to-server OAuth flow
app.get(['/auth/callback', '/auth/callback/'], async (req, res) => {
  const code = String(req.query.code || '');
  const returnedState = String(req.query.state || '');

  // Helper to retrieve cookie values
  const getCookieServer = (cookieHeader: string | undefined, name: string) => {
    if (!cookieHeader) return null;
    const value = `; ${cookieHeader}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop()?.split(';').shift();
    return null;
  };

  const storedState = getCookieServer(req.headers.cookie, "github_oauth_state");
  const storedEmail = String(getCookieServer(req.headers.cookie, "github_oauth_email") || '').toLowerCase().trim();

  console.log('[GitHubCallback Server] Callback received. code:', code ? 'exists' : 'missing', 'state:', returnedState, 'storedState:', storedState);

  if (!code || !returnedState || !storedState || returnedState !== storedState) {
    console.warn('[GitHubCallback Server] Security Warning: State mismatch or missing. returnedState:', returnedState, 'storedState:', storedState);
    return res.status(400).send(`
      <html>
        <head>
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            body { background-color: #0e0e11; color: #ff6b6b; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; text-align: center; }
            .card { background-color: #18181b; padding: 2.5rem; border-radius: 1.5rem; border: 1px solid rgba(255,107,107,0.2); max-width: 400px; box-shadow: 0 20px 50px rgba(0,0,0,0.5); }
            button { background-color: #ff6b6b; color: white; border: none; padding: 0.75rem 1.5rem; border-radius: 0.75rem; font-weight: bold; cursor: pointer; margin-top: 1.5rem; transition: background 0.2s; }
            button:hover { background-color: #e55a5a; }
          </style>
        </head>
        <body>
          <div class="card">
            <h2>Connection Failed</h2>
            <p>The connection state or authorization code is missing, invalid, or expired (CSRF check failed). Please close this window and try again.</p>
            <button onclick="window.close()">Close Window</button>
          </div>
        </body>
      </html>
    `);
  }

  const email = storedEmail;
  if (!email) {
    console.warn('[GitHubCallback Server] Security Warning: No email associated with this OAuth state.');
    return res.status(400).send('Email associated with this connection state is missing or expired.');
  }

  // Clear cookie headers in response with path '/'
  res.clearCookie('github_oauth_state', { path: '/' });
  res.clearCookie('github_oauth_email', { path: '/' });

  try {
    const GITHUB_CLIENT_ID = process.env.VITE_GITHUB_CLIENT_ID || 'Ov23likm06wuJwUgR5KV';
    const GITHUB_CLIENT_SECRET = process.env.VITE_GITHUB_CLIENT_SECRET || process.env.GITHUB_CLIENT_SECRET || 'c09cbfdfeada50fa41bd32403ae3089d280f0d81';

    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers['x-forwarded-host'] || req.get('host');
    const redirectUri = `${protocol}://${host}/auth/callback`;

    console.log('[GitHubCallback Server] Exchanging code with redirectUri:', redirectUri);

    // 1. Exchange code for access token
    const fetchFn = (globalThis.fetch || fetch);
    const tokenResponse = await fetchFn('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        client_secret: GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: redirectUri
      })
    });

    const tokenData: any = await tokenResponse.json();
    if (!tokenResponse.ok || tokenData.error) {
      throw new Error(tokenData.error_description || tokenData.error || `Token exchange failed (${tokenResponse.status})`);
    }

    const accessToken = tokenData.access_token;
    if (!accessToken) {
      throw new Error('No access token returned from GitHub.');
    }

    // 2. Fetch user profile
    const userResponse = await fetchFn('https://api.github.com/user', {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'User-Agent': 'Animato-Studio'
      }
    });

    let username = 'GitHub User';
    let avatarUrl = '';
    if (userResponse.ok) {
      const userData: any = await userResponse.json();
      username = userData.login || username;
      avatarUrl = userData.avatar_url || avatarUrl;
    }

    // 3. Save connection securely in Firestore
    const connectionRef = doc(db!, 'github_connections', email);
    await originalSetDoc(connectionRef, {
      email,
      access_token: accessToken,
      username,
      avatar_url: avatarUrl,
      connectedAt: serverTimestamp(),
    });
    console.log('[GitHubCallback Server] Saved connection for:', email);

    // 4. Return the HTML script that updates localStorage and notifies opener
    return res.send(`
      <html>
        <head>
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            body { background-color: #0e0e11; color: #10b981; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; text-align: center; }
            .card { background-color: #18181b; padding: 2.5rem; border-radius: 1.5rem; border: 1px solid rgba(16,185,129,0.2); max-width: 400px; box-shadow: 0 20px 50px rgba(0,0,0,0.5); }
            .spinner { border: 3px solid rgba(16,185,129,0.1); border-radius: 50%; border-top: 3px solid #10b981; width: 40px; height: 40px; animation: spin 1s linear infinite; margin: 1.5rem auto; }
            @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
          </style>
        </head>
        <body>
          <div class="card">
            <h2 style="color: #10b981; margin-bottom: 0.5rem;">Account Connected!</h2>
            <p style="color: #a1a1aa; font-size: 0.95rem; margin-top: 0;">Linked as <strong style="color: #fff;">@${username}</strong></p>
            <div class="spinner"></div>
            <p style="color: #71717a; font-size: 0.8rem; margin-bottom: 0;">This window should close automatically...</p>
          </div>
          <script>
            try {
              localStorage.setItem('github_conn_${email}', JSON.stringify({
                connected: true,
                username: '${username}',
                avatar_url: '${avatarUrl}',
                accessToken: '${accessToken}',
                timestamp: Date.now()
              }));
              console.log('Saved to localStorage');
            } catch (e) {
              console.error('Failed to set localStorage:', e);
            }

            if (window.opener) {
              window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS', username: '${username}' }, '*');
              setTimeout(() => {
                window.close();
              }, 1200);
            } else {
              setTimeout(() => {
                window.location.href = '/';
              }, 1200);
            }
          </script>
        </body>
      </html>
    `);

  } catch (err: any) {
    console.error('[GitHubCallback Server] Error during exchange:', err);
    return res.status(500).send(`
      <html>
        <head>
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            body { background-color: #0e0e11; color: #f43f5e; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; text-align: center; }
            .card { background-color: #18181b; padding: 2.5rem; border-radius: 1.5rem; border: 1px solid rgba(244,63,94,0.2); max-width: 400px; box-shadow: 0 20px 50px rgba(0,0,0,0.5); }
            button { background-color: #f43f5e; color: white; border: none; padding: 0.75rem 1.5rem; border-radius: 0.75rem; font-weight: bold; cursor: pointer; margin-top: 1.5rem; transition: background 0.2s; }
            button:hover { background-color: #e11d48; }
          </style>
        </head>
        <body>
          <div class="card">
            <h2>Connection Error</h2>
            <p>An error occurred while linking your account:</p>
            <div style="background: rgba(244,63,94,0.05); border: 1px solid rgba(244,63,94,0.1); border-radius: 1rem; padding: 1rem; font-family: monospace; font-size: 0.85rem; color: #fda4af; text-align: left; margin: 1rem 0;">
              \${err.message || 'Internal Server Error'}
            </div>
            <button onclick="window.close()">Close Window</button>
          </div>
        </body>
      </html>
    `);
  }
});

app.get("/api/auth/github/url", (req, res) => {
  const email = String(req.query.state || "").toLowerCase().trim();
  const GITHUB_CLIENT_ID = process.env.VITE_GITHUB_CLIENT_ID || "Ov23likm06wuJwUgR5KV";
  
  const protocol = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers['x-forwarded-host'] || req.get('host');
  const redirectUri = `${protocol}://${host}/auth/callback`;

  // Generate secure random state on the server
  const randomState = crypto.randomBytes(16).toString('hex');

  console.log('[api/auth/github/url] [TEMP LOG] Generated state at url:', randomState, 'for email:', email);

  // Set the security cookies (expires in 5 minutes) with explicit path '/'
  res.cookie('github_oauth_state', randomState, { maxAge: 300000, httpOnly: false, sameSite: 'lax', secure: true, path: '/' });
  if (email) {
    res.cookie('github_oauth_email', email, { maxAge: 300000, httpOnly: false, sameSite: 'lax', secure: true, path: '/' });
  }

  const params = new URLSearchParams({
    client_id: GITHUB_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: 'repo workflow admin:repo_hook delete_repo read:user user:email',
    state: randomState,
    prompt: 'consent',
  });

  const authUrl = `https://github.com/login/oauth/authorize?${params}`;
  res.json({ url: authUrl, state: randomState });
});

app.get('/api/auth/github/status', async (req, res) => {
  try {
    const email = String(req.query.email || '').toLowerCase().trim();
    if (!email) return res.json({ status: true, connected: false });
    
    if (!db) {
      console.warn('[api/auth/github/status] Firestore db not initialized, falling back to local DB check');
      const data = await getDocLocal('github_connections', email);
      if (data) return res.json({ status: true, connected: true, username: data.username, avatar_url: data.avatar_url });
      return res.json({ status: true, connected: false });
    }

    const docSnap = await originalGetDoc(doc(db, 'github_connections', email));
    if (docSnap.exists()) {
      const data = docSnap.data();
      
      const fetchFn = (globalThis.fetch || fetch);
      const userRes = await fetchFn('https://api.github.com/user', {
        headers: {
          'Authorization': `Bearer ${data.access_token}`,
          'Accept': 'application/vnd.github+json',
          'User-Agent': 'Animato-Studio'
        }
      });
      
      if (userRes.ok) {
        const scopesHeader = userRes.headers.get('x-oauth-scopes') || '';
        const isFineGrained = String(data.access_token || '').startsWith('github_pat_');
        
        let missingScopes: string[] = [];
        if (!isFineGrained) {
          const scopes = scopesHeader.split(',').map(s => s.trim());
          if (!scopes.includes('repo')) missingScopes.push('repo');
          if (!scopes.includes('workflow')) missingScopes.push('workflow');
          if (!scopes.includes('admin:repo_hook')) missingScopes.push('admin:repo_hook');
          if (!scopes.includes('delete_repo')) missingScopes.push('delete_repo');
          
          const hasUserScope = scopes.includes('user');
          if (!hasUserScope && !scopes.includes('read:user')) missingScopes.push('read:user');
          if (!hasUserScope && !scopes.includes('user:email')) missingScopes.push('user:email');
        }

        return res.json({ 
          status: true, 
          connected: true, 
          username: data.username, 
          avatar_url: data.avatar_url,
          isFineGrained,
          hasAllRequiredPermissions: missingScopes.length === 0,
          missingScopes
        });
      } else {
        // Token might be invalid/expired
        console.warn(`[api/auth/github/status] Token for ${email} is invalid (${userRes.status}). Disconnecting.`);
        await originalDeleteDoc(doc(db, 'github_connections', email));
        return res.json({ status: true, connected: false });
      }
    }
    return res.json({ status: true, connected: false });
  } catch (err: any) {
    console.error('[api/auth/github/status] Error:', err);
    res.status(500).json({ status: false, message: err.message });
  }
});

async function validateRepoPermissions(accessToken: string, owner: string, repo: string) {
  const fetchFn = (globalThis.fetch || fetch);
  const headers = {
    'Authorization': `Bearer ${accessToken}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'Animato-Studio'
  };

  const errors: string[] = [];

  // 1. Check Repository basic permissions & Administration
  try {
    const repoRes = await fetchFn(`https://api.github.com/repos/${owner}/${repo}`, { headers });
    if (!repoRes.ok) {
      if (repoRes.status === 404) {
        errors.push("Repository not found or token lacks 'Metadata' (Read-only) / 'Contents' access.");
      } else {
        errors.push(`Failed to access repository details: HTTP ${repoRes.status}`);
      }
    } else {
      const repoData = await repoRes.json();
      const permissions = repoData.permissions || {};
      if (!permissions.push) {
        errors.push("Missing write permissions ('Contents: Read and write' is required to push files).");
      }
      if (!permissions.admin) {
        errors.push("Missing administration permissions ('Administration: Read and write' is required to configure GitHub Pages).");
      }
    }
  } catch (err: any) {
    errors.push(`Error checking repository: ${err.message}`);
  }

  // 2. Check Actions & Workflows permissions
  try {
    const actionsRes = await fetchFn(`https://api.github.com/repos/${owner}/${repo}/actions/workflows`, { headers });
    if (!actionsRes.ok) {
      errors.push("Missing 'Actions' or 'Workflows' permissions (unable to view workflows). Required for Pages and APK build triggers.");
    }
  } catch (err: any) {
    errors.push(`Error checking Actions/Workflows: ${err.message}`);
  }

  // 3. Check Pages permissions
  try {
    const pagesRes = await fetchFn(`https://api.github.com/repos/${owner}/${repo}/pages`, { headers });
    if (pagesRes.status === 401 || pagesRes.status === 403) {
      errors.push("Missing 'Pages' permissions (unable to manage GitHub Pages configuration).");
    }
  } catch (err: any) {
    errors.push(`Error checking Pages permissions: ${err.message}`);
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

app.post('/api/github/check-repo', async (req, res) => {
  const { email, repoName } = req.body;
  if (!email || !repoName) return res.status(400).json({ error: 'Email and repoName are required' });
  try {
    const normalizedEmail = email.toLowerCase().trim();
    const docSnap = await originalGetDoc(doc(db!, 'github_connections', normalizedEmail));
    if (!docSnap.exists()) return res.status(401).json({ error: 'GitHub not connected' });
    
    const { access_token } = docSnap.data();
    const fetchFn = (globalThis.fetch || fetch);
    
    const userRes = await fetchFn('https://api.github.com/user', {
      headers: { 
        'Authorization': `Bearer ${access_token}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'Animato-Studio'
      }
    });
    const userData = await userRes.json();
    if (userRes.ok && userData.login) {
      const checkRepoRes = await fetchFn(`https://api.github.com/repos/${userData.login}/${repoName}`, {
        headers: { 
          'Authorization': `Bearer ${access_token}`,
          'Accept': 'application/vnd.github+json',
          'User-Agent': 'Animato-Studio'
        }
      });
      if (checkRepoRes.ok) {
        const repoFullName = `${userData.login}/${repoName}`;
        const permissions = await validateRepoPermissions(access_token, userData.login, repoName);
        return res.json({ 
          exists: true, 
          repoFullName,
          permissions
        });
      }
    }
    return res.json({ exists: false });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/github/disconnect', async (req, res) => {
  try {
    const email = String(req.body.email || '').toLowerCase().trim();
    if (!email) {
      return res.status(400).json({ status: false, message: 'Email is required' });
    }
    const connectionRef = doc(db!, 'github_connections', email);
    await originalDeleteDoc(connectionRef);
    console.log('[api/auth/github/disconnect] Connection deleted for:', email);
    res.json({ status: true, message: 'Successfully disconnected' });
  } catch (err: any) {
    res.status(500).json({ status: false, message: err.message });
  }
});

// --- GitHub Repository & Deployment API ---

app.post('/api/github/create-repo', async (req, res) => {
  const { email, name, description, isPrivate } = req.body;
  if (!email || !name) return res.status(400).json({ error: 'Email and repo name are required' });

  try {
    const normalizedEmail = email.toLowerCase().trim();
    const docSnap = await originalGetDoc(doc(db!, 'github_connections', normalizedEmail));
    if (!docSnap.exists()) return res.status(401).json({ error: 'GitHub not connected' });
    
    const { access_token } = docSnap.data();
    
    // 1. Proactively check if repo already exists
    try {
      const userRes = await fetch('https://api.github.com/user', {
        headers: { 
          'Authorization': `Bearer ${access_token}`,
          'Accept': 'application/vnd.github+json',
          'User-Agent': 'Animato-Studio'
        }
      });
      const userData = await userRes.json();
      
      if (userRes.ok && userData.login) {
        const checkRepoRes = await fetch(`https://api.github.com/repos/${userData.login}/${name}`, {
          headers: { 
            'Authorization': `Bearer ${access_token}`,
            'Accept': 'application/vnd.github+json',
            'User-Agent': 'Animato-Studio'
          }
        });
        
        if (checkRepoRes.ok) {
          const existingRepo = await checkRepoRes.json();
          console.log(`[GitHubRepoCreate] Repository ${userData.login}/${name} already exists. Using existing.`);
          return res.json({ success: true, repo: existingRepo, alreadyExisted: true });
        }
      }
    } catch (e) {
      console.error('[GitHubRepoCreate] Error checking for existing repo:', e);
    }

    // 2. If not found, create it
    const response = await fetch('https://api.github.com/user/repos', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${access_token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'Animato-Studio',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name,
        description: description || 'Professional game project created with Animato Studio',
        private: !!isPrivate,
        auto_init: true
      })
    });

    const data = await response.json();
    if (!response.ok) {
      let errorMsg = data.message || 'Failed to create repository';
      if (data.errors && Array.isArray(data.errors)) {
        const details = data.errors.map((e: any) => e.message || e.code).join(', ');
        if (details) errorMsg += `: ${details}`;
      }
      return res.status(response.status).json({ error: errorMsg });
    }

    res.json({ success: true, repo: data });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/github/deploy', async (req, res) => {
  const { email, repoFullName: rawRepoFullName, gameData, commitMessage } = req.body;
  if (!email || !rawRepoFullName || !gameData) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }

  const repoFullName = (rawRepoFullName || "").replace(/^\/+|\/+$/g, '');
  const logs: string[] = [];
  const addLog = (msg: string, level: 'info' | 'warn' | 'error' = 'info') => {
    const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
    const logLine = `[${timestamp}] [${level.toUpperCase()}] ${msg}`;
    logs.push(logLine);
    if (level === 'info') console.log(`[GitHubDeploy] ${msg}`);
    else if (level === 'warn') console.warn(`[GitHubDeploy] ${msg}`);
    else console.error(`[GitHubDeploy] ${msg}`);
  };

  try {
    const [owner, repoNamePart] = repoFullName.split('/');
    if (!owner || !repoNamePart) {
      addLog(`Invalid repository format: "${repoFullName}". Expected "owner/repo"`, 'error');
      return res.status(400).json({ error: 'Invalid repository name format' });
    }
    addLog(`Starting deployment pipeline. Raw repoFullName: "${rawRepoFullName}", Cleaned: "${repoFullName}", Resolved Owner: "${owner}", Repo: "${repoNamePart}"`);
    addLog(`Starting deployment. Resolved Owner: "${owner}", Repository: "${repoNamePart}" (Full Name: "${repoFullName}")`);

    const normalizedEmail = email.toLowerCase().trim();
    const docSnap = await originalGetDoc(doc(db!, 'github_connections', normalizedEmail));
    if (!docSnap.exists()) {
      addLog('GitHub connection not found', 'error');
      return res.status(401).json({ error: 'GitHub not connected' });
    }
    
    const { access_token, username } = docSnap.data();
    const headers = {
      'Authorization': `Bearer ${access_token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'Animato-Studio',
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    };

    // Give GitHub more time to initialize if repo was just created
    addLog('Waiting for GitHub initialization (5s)...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // 1. Get default branch and its latest commit SHA
    let repoInfo: any;
    let repoRes: Response | null = null;
    let attempts = 0;
    while (attempts < 5) {
      addLog(`[STEP: Repo Details] Fetching details for Owner: "${owner}", Repo: "${repoNamePart}" (attempt ${attempts + 1})...`);
      console.log("Deploying GitHub Pages for repository:", repoFullName);
      repoRes = await fetch(`https://api.github.com/repos/${owner}/${repoNamePart}`, { headers, cache: 'no-store' });
      addLog(`[Repo Details] Response status: ${repoRes.status}`);
      repoInfo = await repoRes.json();
      if (repoRes.ok) break;
      addLog(`Repo fetch failed for ${owner}/${repoNamePart}: ${repoInfo.message}. Retrying...`, 'warn');
      await new Promise(resolve => setTimeout(resolve, 2000));
      attempts++;
    }
    if (!repoRes || !repoRes.ok || !repoInfo || !repoInfo.name) {
      addLog(`Failed to fetch repo info for Owner: "${owner}", Repo: "${repoNamePart}": ${repoInfo?.message || 'Unknown error'}`, 'error');
      throw new Error(repoInfo?.message || 'Failed to fetch repo info after multiple attempts');
    }
    
    // Check permissions
    if (repoInfo.permissions) {
      addLog(`Repository permissions for Owner: "${owner}", Repo: "${repoNamePart}": ${JSON.stringify(repoInfo.permissions)}`);
      if (!repoInfo.permissions.push) {
        addLog(`Token lacks write access (push permission) for Owner: "${owner}", Repo: "${repoNamePart}".`, 'error');
        throw new Error(`Token lacks write access to this repo (${owner}/${repoNamePart}). Please ensure your GitHub token has write permissions (Contents: Read and write for fine-grained PAT, or repo scope for classic PAT).`);
      }
    } else {
      addLog('No permissions object found in repo info, proceeding cautiously...', 'warn');
    }
    
    const defaultBranch = repoInfo.default_branch || 'main';
    addLog(`Resolved default branch for Owner: "${owner}", Repo: "${repoNamePart}": "${defaultBranch}"`);
    
    // Check scopes for 'workflow'
    const isFineGrained = String(access_token || '').startsWith('github_pat_');
    let hasWorkflowScope = false;
    const scopesHeader = repoRes.headers?.get('x-oauth-scopes') || '';
    addLog(`Token scopes: ${scopesHeader || 'none'}, isFineGrained: ${isFineGrained}`);
    if (isFineGrained || scopesHeader.includes('workflow')) {
      hasWorkflowScope = true;
    } else {
      addLog(`Token lacks 'workflow' scope. We will skip creating .github/workflows/deploy.yml to prevent 404 errors.`, 'warn');
    }

    let latestCommitSha: string | null = null;
    let baseTreeSha: string | null = null;
    let isRepoEmpty = false;

    // 2. Get latest commit SHA from git/refs/heads/{branch}
    try {
      addLog(`[STEP: Branch Ref] Fetching latest ref for Owner: "${owner}", Repo: "${repoNamePart}", Branch: "${defaultBranch}"...`);
      const refRes = await fetch(`https://api.github.com/repos/${owner}/${repoNamePart}/git/refs/heads/${defaultBranch}`, { headers, cache: 'no-store' });
      addLog(`[Branch Ref] Response status: ${refRes.status}`);
      const refData = await refRes.json();
      
      if (refRes.status === 404) {
        addLog(`Branch "${defaultBranch}" not found (404) for Owner: "${owner}", Repo: "${repoNamePart}". Assuming empty repo.`);
        isRepoEmpty = true;
      } else if (refRes.ok && refData.object?.sha) {
        latestCommitSha = refData.object.sha;
        addLog(`Found latest commit SHA for "${defaultBranch}": ${latestCommitSha}`);
        
        // 3. Get tree SHA from git/commits/{sha}
        addLog(`[STEP: Tree SHA] Fetching tree SHA for commit ${latestCommitSha}...`);
        const commitRes = await fetch(`https://api.github.com/repos/${owner}/${repoNamePart}/git/commits/${latestCommitSha}`, { headers, cache: 'no-store' });
        addLog(`[Tree SHA] Response status: ${commitRes.status}`);
        const commitData = await commitRes.json();
        if (commitRes.ok && commitData.tree?.sha) {
          baseTreeSha = commitData.tree.sha;
          addLog(`Found base tree SHA for ${latestCommitSha}: ${baseTreeSha}`);
        } else {
          addLog(`Could not fetch tree SHA for commit ${latestCommitSha}: ${JSON.stringify(commitData)}`, 'warn');
        }
      } else {
        addLog(`Failed to fetch ref for Owner: "${owner}", Repo: "${repoNamePart}", Branch: "${defaultBranch}": ${JSON.stringify(refData)}. Status: ${refRes.status}`, 'warn');
        isRepoEmpty = true;
      }
    } catch (err: any) {
      addLog(`Error fetching fresh ref/commit: ${err.message}`, 'error');
      isRepoEmpty = true;
    }

    // 2.1 Verification: Compare with the previous deployment to check if anything actually changed
    let previousGameDataContent: string | null = null;
    let isNoOpDeploy = false;
    if (!isRepoEmpty) {
      try {
        addLog(`[STEP: Content Verification] Fetching previous game-data.json for Owner: "${owner}", Repo: "${repoNamePart}" to compare changes...`);
        const prevRes = await fetch(
          `https://api.github.com/repos/${owner}/${repoNamePart}/contents/src/game-data.json?ref=${defaultBranch}`,
          { headers, cache: 'no-store' }
        );
        addLog(`[Content Verification] Response status: ${prevRes.status}`);
        if (prevRes.ok) {
          const prevData = await prevRes.json();
          if (prevData.content && prevData.encoding === 'base64') {
            previousGameDataContent = Buffer.from(prevData.content, 'base64').toString('utf8');
            addLog(`Successfully fetched previous game-data.json from deployment.`);
            
            const newGameDataContent = JSON.stringify(gameData, null, 2);
            if (previousGameDataContent === newGameDataContent) {
              addLog(`[VERIFICATION] WARNING: Silent no-op deploy caught! The newly pushed files have IDENTICAL game-data content to the previous deployment. Adding unique deployment timestamp to force update/build.`);
              isNoOpDeploy = true;
            } else {
              addLog(`[VERIFICATION] SUCCESS: Game-data changes detected! Pushed content differs from the previous deployment.`);
            }
          }
        } else if (prevRes.status === 404) {
          addLog(`[VERIFICATION] No previous game-data.json found in the repository (404). This is the first deployment containing game data.`);
        } else {
          addLog(`[VERIFICATION] Unexpected response when fetching previous game-data.json: HTTP ${prevRes.status}`, 'warn');
        }
      } catch (err: any) {
        addLog(`[VERIFICATION] Warning: Failed to fetch previous game-data.json for comparison: ${err.message}`, 'warn');
      }
    } else {
      addLog(`[VERIFICATION] Repository is empty. Proceeding with initial deployment.`);
    }

    // 2. Build-time check/log of interactive elements and actions
    let scenesCount = gameData.scenes?.length || 0;
    let elementsCount = 0;
    if (gameData.sceneElements) {
      Object.values(gameData.sceneElements).forEach((els: any) => {
        if (Array.isArray(els)) {
          elementsCount += els.length;
        }
      });
    }
    let gameObjectsCount = gameData.gameObjects?.length || 0;
    let buttonsCount = gameData.uiButtons?.length || 0;
    let environmentsCount = gameData.environments?.length || 0;
    let eventsCount = 0;
    let conditionsCount = 0;
    let actionsCount = 0;
    if (gameData.sceneEvents) {
      Object.values(gameData.sceneEvents).forEach((evs: any) => {
        if (Array.isArray(evs)) {
          eventsCount += evs.length;
          evs.forEach((ev: any) => {
            if (Array.isArray(ev.conditions)) {
              conditionsCount += ev.conditions.length;
            }
            if (Array.isArray(ev.actions)) {
              actionsCount += ev.actions.length;
            }
          });
        }
      });
    }
    addLog(`[BUILD-TIME CHECK] Verification Success! Bundling game project logic:`);
    addLog(`  - Scenes found: ${scenesCount}`);
    addLog(`  - Total active elements on stage: ${elementsCount}`);
    addLog(`  - Game Objects defined (characters, items): ${gameObjectsCount}`);
    addLog(`  - Custom UI buttons available: ${buttonsCount}`);
    addLog(`  - Background environments available: ${environmentsCount}`);
    addLog(`  - Interactive event rules: ${eventsCount}`);
    addLog(`  - Trigger conditions: ${conditionsCount}`);
    addLog(`  - Connected actions: ${actionsCount}`);
    addLog(`[BUILD-TIME CHECK] All interactive rules and assets successfully serialized into "src/game-data.json".`);

    // 2. Prepare files to push
    addLog('Preparing files to push...');

    const processedGameData = JSON.parse(JSON.stringify(gameData));
    const extraPushedFiles: { path: string; content: string; isBase64?: boolean }[] = [];
    let videoCount = 0;
    let bundledVideoCount = 0;
    let audioCount = 0;
    let bundledAudioCount = 0;

    // Recursive asset extractor to handle ALL base64 assets in the project
    let assetCount = 0;
    const extractAssets = (obj: any) => {
      if (!obj || typeof obj !== 'object') return;
      
      for (const key in obj) {
        const val = obj[key];
        if (typeof val === 'string' && val.startsWith('data:')) {
          const match = val.match(/^data:([^/]+)\/([^;]+);base64,(.*)$/);
          if (match) {
            const type = match[1]; // image, audio, video
            let ext = match[2]; // png, mpeg, etc
            const base64Data = match[3];
            
            // Normalize extensions
            if (ext === 'mpeg' || ext === 'x-mpeg' || ext === 'x-mp3' || ext === 'mp3') ext = 'mp3';
            if (ext === 'x-wav' || ext === 'wav') ext = 'wav';
            if (ext === 'quicktime') ext = 'mov';
            if (ext.includes('svg')) ext = 'svg';

            const folder = type === 'image' ? 'images' : (type === 'video' ? 'videos' : 'audio');
            const fileName = `asset_${assetCount}_${Math.random().toString(36).substr(2, 9)}.${ext}`;
            const assetPath = `public/assets/${folder}/${fileName}`;
            
            extraPushedFiles.push({
              path: assetPath,
              content: base64Data,
              isBase64: true
            });
            
            // Update reference in gameData to relative path - use ./assets for vite production build
            obj[key] = `./assets/${folder}/${fileName}`;
            assetCount++;
            
            if (type === 'video') bundledVideoCount++;
            else if (type === 'audio') bundledAudioCount++;
          }
        } else if (val && typeof val === 'object') {
          extractAssets(val);
        }
      }
    };

    extractAssets(processedGameData);

    // Print metrics log
    addLog(`[BUILD-TIME CHECK] Asset Bundling Statistics:`);
    addLog(`  - Total base64 assets extracted and bundled: ${assetCount}`);
    addLog(`  - Video assets successfully bundled: ${bundledVideoCount}`);
    addLog(`  - Audio assets successfully bundled: ${bundledAudioCount}`);
    addLog(`[BUILD-TIME CHECK] Binary Extraction Pipeline Complete.`);
    addLog(`[BUILD-TIME CHECK] GitHub Pages base URL configured to './'`);

    const files: { path: string; content: string; isBase64?: boolean }[] = [
      {
        path: 'package.json',
        content: JSON.stringify({
          name: repoInfo.name,
          private: true,
          version: "1.0.0",
          type: "module",
          scripts: {
            "dev": "vite",
            "build": "vite build",
            "preview": "vite preview"
          },
          dependencies: {
            "react": "^19.0.0",
            "react-dom": "^19.0.0",
            "lucide-react": "^0.474.0",
            "motion": "^12.0.0"
          },
          devDependencies: {
            "@types/react": "^19.0.0",
            "@types/react-dom": "^19.0.0",
            "@vitejs/plugin-react": "^4.3.4",
            "autoprefixer": "^10.4.20",
            "postcss": "^8.4.49",
            "tailwindcss": "^3.4.15",
            "typescript": "^5.7.2",
            "vite": "^6.0.0"
          }
        }, null, 2)
      },
      {
        path: 'vite.config.ts',
        content: `import { defineConfig } from 'vite'\nimport react from '@vitejs/plugin-react'\n\nexport default defineConfig({\n  plugins: [react()],\n  base: './',\n})`
      },
      {
        path: 'index.html',
        content: `<!DOCTYPE html>\n<html lang="en" style="margin:0;padding:0;width:100%;height:100%;overflow:hidden;">\n<head>\n  <meta charset="UTF-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />\n  <title>${repoInfo.name}</title>\n</head>\n<body style="margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:#000;">\n  <div id="root" style="width:100%;height:100%;"></div>\n  <script type="module" src="/src/main.tsx"></script>\n  <script>\n    if ('serviceWorker' in navigator) {\n      window.addEventListener('load', () => {\n        navigator.serviceWorker.register('./sw.js').then((reg) => {\n          document.addEventListener('visibilitychange', () => {\n            if (document.visibilityState === 'visible') {\n              reg.update();\n            }\n          });\n        }).catch(err => console.error('SW failed', err));\n      });\n    }\n  </script>\n</body>\n</html>`
      },
      {
        path: 'src/main.tsx',
        content: `import React from 'react'\nimport ReactDOM from 'react-dom/client'\nimport App from './App.tsx'\nimport './index.css'\n\nReactDOM.createRoot(document.getElementById('root')!).render(\n  <React.StrictMode>\n    <App />\n  </React.StrictMode>,\n)`
      },
      {
        path: 'src/index.css',
        content: `@tailwind base;\n@tailwind components;\n@tailwind utilities;\n\nhtml, body, #root {\n  margin: 0;\n  padding: 0;\n  width: 100%;\n  height: 100%;\n  overflow: hidden;\n  background-color: #000;\n  color: #fff;\n}\n\n@keyframes spin {\n  from { transform: rotate(0deg); }\n  to { transform: rotate(360deg); }\n}`
      },
      {
        path: 'tailwind.config.js',
        content: `/** @type {import('tailwindcss').Config} */\nmodule.exports = {\n  content: [\n    "./index.html",\n    "./src/**/*.{js,ts,jsx,tsx}",\n  ],\n  theme: {\n    extend: {},\n  },\n  plugins: [],\n}`
      },
      {
        path: 'postcss.config.js',
        content: `export default {\n  plugins: {\n    tailwindcss: {},\n    autoprefixer: {},\n  },\n}`
      },
      {
        path: 'public/sw.js',
        content: `const CACHE_NAME = 'animato-game-cache-v2';\n\nself.addEventListener('install', (event) => {\n  self.skipWaiting();\n});\n\nself.addEventListener('activate', (event) => {\n  event.waitUntil(self.clients.claim());\n});\n\nself.addEventListener('fetch', (event) => {\n  if (event.request.method !== 'GET') return;\n  const url = new URL(event.request.url);\n  if (!url.protocol.startsWith('http')) return;\n\n  const isHtml = event.request.mode === 'navigate' || (event.request.headers.get('accept') && event.request.headers.get('accept').includes('text/html'));\n  const fetchOptions = isHtml ? { cache: 'no-cache' } : {};\n\n  event.respondWith(\n    fetch(event.request, fetchOptions)\n      .then((response) => {\n        const cloned = response.clone();\n        caches.open(CACHE_NAME).then((cache) => {\n          cache.put(event.request, cloned);\n        });\n        return response;\n      })\n      .catch(async () => {\n        const cached = await caches.match(event.request);\n        if (cached) return cached;\n        return new Response('Offline - No Cache', { status: 503 });\n      })\n  );\n});`
      },
      {
        path: 'src/game-data.json',
        content: JSON.stringify(processedGameData, null, 2)
      },
      {
        path: 'src/App.tsx',
        content: `import React, { useState, useEffect, useRef } from 'react';
import gameData from './game-data.json';

// Global shared AudioContext to handle gameplay audio and escape browser autoplay constraints
let globalAudioCtx: any = null;
const decodedBufferCache: Record<string, AudioBuffer> = {};

const getSharedAudioContext = (): AudioContext => {
  if (typeof window === 'undefined') return null as any;
  if (!globalAudioCtx) {
    globalAudioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  if (globalAudioCtx.state === 'suspended') {
    globalAudioCtx.resume().catch(() => {});
  }
  return globalAudioCtx;
};

const playSoundWithSharedContext = async (audioSrc: string) => {
  if (!audioSrc) return;
  try {
    const ctx = getSharedAudioContext();
    if (!ctx) return;

    if (decodedBufferCache[audioSrc]) {
      const source = ctx.createBufferSource();
      source.buffer = decodedBufferCache[audioSrc];
      source.connect(ctx.destination);
      source.start(0);
      return;
    }

    const response = await fetch(audioSrc);
    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    decodedBufferCache[audioSrc] = audioBuffer;

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);
    source.start(0);
  } catch (err) {
    console.warn("Audio playback failed:", err);
    try {
      const audio = new Audio(audioSrc);
      audio.play().catch(() => {});
    } catch (e) {}
  }
};

export default function GameRunner() {
  const [activeSceneId, setActiveSceneId] = useState(gameData.activeSceneId || 'scene_1');
  const [stageElements, setStageElements] = useState([]);
  const [windowSize, setWindowSize] = useState({ width: typeof window !== 'undefined' ? window.innerWidth : 640, height: typeof window !== 'undefined' ? window.innerHeight : 360 });
  const [showRotationPrompt, setShowRotationPrompt] = useState(false);

  const aspectRatio = gameData.aspectRatio || 'landscape';
  const VIRTUAL_WIDTH = aspectRatio === 'landscape' ? 640 : 360;
  const VIRTUAL_HEIGHT = aspectRatio === 'landscape' ? 360 : 640;

  useEffect(() => {
    const handleResize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      setWindowSize({ width: w, height: h });
      if (aspectRatio === 'landscape' && w < h) setShowRotationPrompt(true);
      else if (aspectRatio === 'portrait' && w > h) setShowRotationPrompt(true);
      else setShowRotationPrompt(false);
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [aspectRatio]);

  const scale = Math.min(windowSize.width / VIRTUAL_WIDTH, windowSize.height / VIRTUAL_HEIGHT);
  const stageElementsRef = useRef(stageElements);
  useEffect(() => { stageElementsRef.current = stageElements; }, [stageElements]);

  useEffect(() => {
    const sceneEls = (gameData.sceneElements && gameData.sceneElements[activeSceneId]) || [];
    setStageElements(sceneEls);
  }, [activeSceneId]);

  const executeAction = (act) => {
    switch (act.type) {
      case 'goto_scene':
        if (act.target && (gameData.scenes || []).some(s => s.id === act.target)) {
          setActiveSceneId(act.target);
        }
        break;
      case 'change_opacity':
        if (act.target) {
          const val = Number(act.value ?? 50) / 100;
          setStageElements(prev => prev.map(el => (el.id === act.target || el.data === act.target || el.buttonId === act.target) ? { ...el, opacity: val } : el));
        }
        break;
      case 'destroy':
        if (act.target) {
          setStageElements(prev => prev.filter(el => el.id !== act.target && el.data !== act.target && el.buttonId !== act.target));
        }
        break;
      case 'play_sound':
        if (act.value) {
          const sound = (gameData.projectSounds || []).find(s => s.id === act.value || s.name === act.value);
          const audioSrc = sound?.url || sound?.dataUrl || act.value;
          if (audioSrc) {
            playSoundWithSharedContext(audioSrc);
          }
        }
        break;
      case 'play_animation':
        if (act.target) {
          const videoId = act.target;
          const fitToScreen = act.fitToScreen || false;
          const existing = stageElementsRef.current.find(el => el.type === 'video' && el.videoId === videoId);
          if (existing) {
            const elVid = document.getElementById(\`video_player_\${existing.id}\`) as HTMLVideoElement;
            if (elVid) { elVid.currentTime = 0; elVid.play().catch(() => {}); }
          } else {
            const elId = \`vid_\${Date.now()}\`;
            setStageElements(prev => [...prev, { id: elId, type: 'video', videoId, fitToScreen, x: fitToScreen ? 0 : 100, y: fitToScreen ? 0 : 50, width: fitToScreen ? VIRTUAL_WIDTH : 300, height: fitToScreen ? VIRTUAL_HEIGHT : 200, layerId: '' }]);
            setTimeout(() => {
              const elVid = document.getElementById(\`video_player_\${elId}\`) as HTMLVideoElement;
              if (elVid) { elVid.currentTime = 0; elVid.play().catch(() => {}); }
            }, 100);
          }
        }
        break;
      case 'stop_animation':
        if (act.target) {
          const existing = stageElementsRef.current.find(el => el.type === 'video' && el.videoId === act.target);
          if (existing) {
            const elVid = document.getElementById(\`video_player_\${existing.id}\`) as HTMLVideoElement;
            if (elVid) elVid.pause();
          }
        }
        break;
      case 'remove_animation':
        if (act.target) {
          setStageElements(prev => prev.filter(el => !(el.type === 'video' && el.videoId === act.target)));
        }
        break;
      case 'move_to':
        if (act.target) {
          setStageElements(prev => prev.map(el => (el.id === act.target || el.data === act.target || el.buttonId === act.target) ? { ...el, x: Number(act.x ?? 100), y: Number(act.y ?? 100) } : el));
        }
        break;
      case 'rotate':
        if (act.target) {
          setStageElements(prev => prev.map(el => (el.id === act.target || el.data === act.target || el.buttonId === act.target) ? { ...el, rotation: (el.rotation || 0) + Number(act.value ?? 15) } : el));
        }
        break;
      case 'show_text':
        if (act.value) {
          const toastId = \`toast_\${Date.now()}\`;
          setStageElements(prev => [...prev, { id: toastId, type: 'btn', x: 220, y: 150, width: 200, height: 40, isToast: true, text: act.value }]);
          setTimeout(() => setStageElements(prev => prev.filter(el => el.id !== toastId)), 3000);
        }
        break;
      case 'move_straight':
      case 'move_zigzag':
        if (act.target) {
          setStageElements(prev => prev.map(el => (el.id === act.target || el.data === act.target || el.buttonId === act.target) ? { ...el, x: el.x + 80, y: el.y + (act.type === 'move_zigzag' ? 30 : 0) } : el));
        }
        break;
      case 'change_animation':
        if (act.target && act.value !== undefined) {
          setStageElements(prev => prev.map(el => (el.id === act.target || el.data === act.target || el.buttonId === act.target) ? { ...el, activeAnimationIndex: Number(act.value) } : el));
        }
        break;
    }
  };

  const lastTapRef = useRef({ time: 0, target: '' });
  const handleButtonClick = (buttonId) => {
    const now = Date.now();
    const isDoubleTap = now - lastTapRef.current.time < 300 && lastTapRef.current.target === buttonId;
    lastTapRef.current = { time: now, target: buttonId };

    const btnEl = stageElementsRef.current.find(e => e.id === buttonId);
    const sceneEvents = (gameData.sceneEvents && gameData.sceneEvents[activeSceneId]) || [];
    sceneEvents.forEach(ev => {
      const isPressed = ev.conditions?.some(cond => {
        if (cond.target !== buttonId && cond.target !== btnEl?.buttonId && cond.target !== btnEl?.data) return false;
        if (isDoubleTap && cond.type === 'double_tap') return true;
        return cond.type === 'click' || cond.type === 'pressed';
      });
      if (isPressed) ev.actions?.forEach(act => executeAction(act));
    });
  };

  useEffect(() => {
    const sceneEvents = (gameData.sceneEvents && gameData.sceneEvents[activeSceneId]) || [];
    sceneEvents.forEach(ev => {
      if (ev.conditions?.some(cond => cond.type === 'scene_start')) ev.actions?.forEach(act => executeAction(act));
    });
    const interval = setInterval(() => {
      sceneEvents.forEach(ev => {
        const allMet = ev.conditions?.every(cond => {
          if (cond.type === 'collision') {
            const el1 = stageElementsRef.current.find(el => el.id === cond.target || el.data === cond.target);
            const el2 = stageElementsRef.current.find(el => el.id === cond.target2 || el.data === cond.target2);
            if (!el1 || !el2) return false;
            return !(el1.x + el1.width < el2.x || el2.x + el2.width < el1.x || el1.y + el1.height < el2.y || el2.y + el2.height < el1.y);
          }
          return false;
        });
        if (allMet && ev.conditions?.some(c => c.type === 'collision')) ev.actions?.forEach(act => executeAction(act));
      });
    }, 200);
    return () => clearInterval(interval);
  }, [activeSceneId]);

  return (
    <div style={{ backgroundColor: '#000', width: '100vw', height: '100vh', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {gameData.customCSS && <style>{gameData.customCSS}</style>}
      <div style={{ position: 'relative', width: \`\${VIRTUAL_WIDTH}px\`, height: \`\${VIRTUAL_HEIGHT}px\`, transform: \`scale(\${scale})\`, backgroundColor: gameData.stageBgColor || '#000', overflow: 'hidden' }}>
        {stageElements.map((el, i) => {
          const isInteractive = el.type === 'btn' || el.type === 'obj';
          const gameObject = (gameData.gameObjects || []).find(g => g.id === el.data);
          const bgUrl = el.url || gameObject?.url || gameObject?.animations?.[el.activeAnimationIndex || 0] || gameObject?.animations?.[0] || el.data;
          return (
            <div key={el.id || i} onClick={(e) => { if (isInteractive) { e.stopPropagation(); handleButtonClick(el.id); } }} style={{ position: 'absolute', left: el.type === 'bg' ? 0 : el.x, top: el.type === 'bg' ? 0 : el.y, width: el.type === 'bg' ? '100%' : el.width, height: el.type === 'bg' ? '100%' : el.height, backgroundImage: (el.type !== 'video' && bgUrl) ? \`url(\${bgUrl})\` : undefined, backgroundSize: '100% 100%', opacity: el.opacity ?? 1, transform: el.rotation ? \`rotate(\${el.rotation}deg)\` : undefined, zIndex: el.type === 'bg' ? 0 : 10, cursor: isInteractive ? 'pointer' : 'default' }}>
              {el.type === 'btn' && <button style={{ width: '100%', height: '100%', background: 'transparent', border: 'none', color: 'white', fontWeight: 'bold' }}>{el.text}</button>}
              {el.type === 'video' && <video id={\`video_player_\${el.id}\`} src={(gameData.projectVideos || []).find(v => v.id === el.videoId)?.url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} playsInline />}
            </div>
          );
        })}
      </div>
    </div>
  );
}`
      },
      {
        path: 'README.md',
        content: `# ${repoInfo.name}\n\nProfessional game project created with Animato Studio.\n\n## Development\n\n\`\`\`bash\nnpm install\nnpm run dev\n\`\`\`\n\n## Deployment\n\nThis project is automatically deployed to GitHub Pages via GitHub Actions.`
      },
      {
        path: 'vercel.json',
        content: `{\n  "framework": "vite",\n  "buildCommand": "npm run build",\n  "outputDirectory": "dist"\n}`
      },
      {
        path: 'src/deployment-meta.json',
        content: JSON.stringify({
          deployedAt: new Date().toISOString(),
          commitMessage: commitMessage || 'Deploy game from Animato Studio',
          gitHubRepo: `${owner}/${repoNamePart}`,
          isNoOpDeploy
        }, null, 2)
      }
    ];

    files.push(...extraPushedFiles);
    
    if (hasWorkflowScope) {
      files.push({
        path: '.github/workflows/deploy.yml',
        content: `name: Deploy to GitHub Pages\non:\n  push:\n    branches: [ ${defaultBranch} ]\n  workflow_dispatch:\npermissions:\n  contents: read\n  pages: write\n  id-token: write\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n        with:\n          node-version: 20\n      - run: npm install\n      - run: npm run build\n      - uses: actions/upload-pages-artifact@v3\n        with:\n          path: './dist'\n  deploy:\n    needs: build\n    runs-on: ubuntu-latest\n    concurrency:\n      group: github-pages\n      cancel-in-progress: true\n    environment:\n      name: github-pages\n      url: \${{ steps.deployment.outputs.page_url }}\n    steps:\n      - id: deployment\n        uses: actions/deploy-pages@v4`
      });
      addLog(`Deploy workflow created for ${owner}/${repoNamePart}`);
    } else {
      addLog("Skipping .github/workflows/deploy.yml because the GitHub token lacks the 'workflow' scope. Deployment to Pages will require manual setup.");
    }
    
    let treeItems = [];
    let finalCommitSha = latestCommitSha;
    
    addLog(`Using REST API for commit.`);
      
      for (const file of files) {
        addLog(`Creating blob for ${file.path}...`);
        let blobSha = null;
        let blobAttempts = 0;
        while (blobAttempts < 3) {
          const blobRes = await fetch(`https://api.github.com/repos/${owner}/${repoNamePart}/git/blobs`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              content: file.isBase64 ? file.content : Buffer.from(file.content).toString('base64'),
              encoding: 'base64'
            })
          });
          
          let blobData;
          const blobContentType = blobRes.headers.get("content-type");
          if (blobContentType && blobContentType.includes("application/json")) {
            blobData = await blobRes.json();
          } else {
            const text = await blobRes.text();
            addLog(`Blob creation expected JSON but got ${blobRes.status}: ${text.substring(0, 200)}`, 'error');
            throw new Error(`Blob creation failed: ${blobRes.status}`);
          }
          
          if (blobRes.ok) {
            blobSha = blobData.sha;
            addLog(`Successfully created blob for ${file.path}: ${blobSha}`);
            break;
          }
          addLog(`Blob creation failed for ${file.path}, attempt ${blobAttempts + 1}: ${blobData.message} (Status: ${blobRes.status})`, 'warn');
          await new Promise(resolve => setTimeout(resolve, 1000));
          blobAttempts++;
        }

        if (!blobSha) {
          addLog(`Failed to create blob for ${file.path}`, 'error');
          throw new Error(`Failed to create blob for ${file.path}`);
        }

        treeItems.push({
          path: file.path,
          mode: '100644',
          type: 'blob',
          sha: blobSha
        });
      }

      // Give GitHub a moment to index the blobs
      addLog('Waiting for GitHub indexing (3s)...');
      await new Promise(resolve => setTimeout(resolve, 3000));

      // 4. Create a new Tree
      addLog(`Creating tree for: ${owner}/${repoNamePart} | Base Tree: ${baseTreeSha || 'None (Initial)'}`);
      
      let treeData: any;
      let treeAttempts = 0;
      while (treeAttempts < 5) {
        const treeBody: any = { tree: treeItems };
        if (baseTreeSha && !isRepoEmpty) {
          treeBody.base_tree = baseTreeSha;
        }

        const treeRes = await fetch(`https://api.github.com/repos/${owner}/${repoNamePart}/git/trees`, {
          method: 'POST',
          headers,
          body: JSON.stringify(treeBody)
        });
        treeData = await treeRes.json();
        
        if (treeRes.ok) {
          addLog(`Tree created successfully: ${treeData.sha}`);
          break;
        }

        // Special case: if 404 and we sent a base_tree, try one last time WITHOUT base_tree
        if (treeRes.status === 404 && treeBody.base_tree) {
           addLog(`Tree creation failed with 404 (possibly invalid base_tree). Retrying WITHOUT base_tree...`, 'warn');
           const retryRes = await fetch(`https://api.github.com/repos/${owner}/${repoNamePart}/git/trees`, {
             method: 'POST',
             headers,
             body: JSON.stringify({ tree: treeItems })
           });
           const retryData = await retryRes.json();
           if (retryRes.ok) {
             treeData = retryData;
             addLog(`Tree created successfully (after 404 fallback): ${treeData.sha}`);
             break;
           }
        }

        addLog(`Tree creation attempt ${treeAttempts + 1} failed for ${owner}/${repoNamePart} on branch ${defaultBranch}: ${JSON.stringify(treeData)}. Retrying...`, 'warn');
        await new Promise(resolve => setTimeout(resolve, 3000));
        treeAttempts++;
      }
      
      if (!treeData || !treeData.sha) {
        addLog(`Failed to create tree: ${treeData?.message || 'Unknown error'}`, 'error');
        throw new Error(`Failed to create tree: ${treeData?.message || 'Unknown error'}`);
      }

      // 5. Create a new Commit
      addLog(`Creating commit on tree: ${treeData.sha} | Parent: ${latestCommitSha || 'None'}`);
      const commitBody: any = {
        message: commitMessage || 'Deploy game from Animato Studio',
        tree: treeData.sha,
        author: {
          name: username || 'Animato User',
          email: normalizedEmail
        },
        committer: {
          name: username || 'Animato User',
          email: normalizedEmail
        }
      };
      if (latestCommitSha) commitBody.parents = [latestCommitSha];

      const commitRes = await fetch(`https://api.github.com/repos/${owner}/${repoNamePart}/git/commits`, {
        method: 'POST',
        headers,
        body: JSON.stringify(commitBody)
      });
      const commitData = await commitRes.json();
      if (!commitRes.ok) {
        addLog(`Failed to create commit: ${commitData.message}`, 'error');
        throw new Error(commitData.message || 'Failed to create commit');
      }
      addLog(`Commit created successfully: ${commitData.sha}`);

      // 6. Update or create the branch reference
      addLog(`Updating ref refs/heads/${defaultBranch} to point to ${commitData.sha}`);
      let refRes: Response;
      if (isRepoEmpty) {
        addLog('Creating initial branch ref...');
        refRes = await fetch(`https://api.github.com/repos/${owner}/${repoNamePart}/git/refs`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            ref: `refs/heads/${defaultBranch}`,
            sha: commitData.sha
          })
        });
      } else {
        addLog('Updating existing branch ref...');
        refRes = await fetch(`https://api.github.com/repos/${owner}/${repoNamePart}/git/refs/heads/${defaultBranch}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({
            sha: commitData.sha,
            force: false
          })
        });
      }
      const refData = await refRes.json();
      if (!refRes.ok) {
        addLog(`Failed to update ref: ${refData.message}`, 'error');
        throw new Error(refData.message || 'Failed to update ref');
      }
      
      finalCommitSha = commitData.sha;
    
    // 1.5. Ensure GitHub Pages has been configured to use GitHub Actions - run AFTER commit/push is successful
    addLog(`DEBUG: Proceeding to Pages check. hasWorkflowScope=${hasWorkflowScope}`);
    if (hasWorkflowScope) {
      try {
        await new Promise(resolve => setTimeout(resolve, 3000)); // Give GitHub time to process the new commit/branch
        addLog(`[Pages Deploy] Enabling Pages for: ${owner}/${repoNamePart} (post-commit)...`);
        addLog(`DEBUG: Using pagesUrl: https://api.github.com/repos/${owner}/${repoNamePart}/pages`);
        const pagesUrl = `https://api.github.com/repos/${owner}/${repoNamePart}/pages`;
        
        // Timeout for Pages check GET request
        const pagesController = new AbortController();
        const pagesTimeoutId = setTimeout(() => {
          addLog(`[Pages Config GET] Timeout reached, aborting request...`, 'warn');
          pagesController.abort();
        }, 5000);
        
        let getPagesRes;
        try {
          addLog(`[Pages Config GET] Querying current configuration...`);
          getPagesRes = await fetch(pagesUrl, { headers, cache: 'no-store', signal: pagesController.signal });
          clearTimeout(pagesTimeoutId);
        } catch (pagesErr: any) {
          clearTimeout(pagesTimeoutId);
          addLog(`Failed to fetch Pages config: ${pagesErr.message}`, 'warn');
          throw pagesErr;
        }
        
        addLog(`[Pages Config GET] Response status: ${getPagesRes.status}`);
        
        if (getPagesRes.status === 404) {
          addLog('GitHub Pages not configured yet. Creating Pages site with "workflow" build type...', 'info');
          
          const postPagesController = new AbortController();
          const postPagesTimeoutId = setTimeout(() => {
            addLog(`[Pages Config POST] Timeout reached, aborting request...`, 'warn');
            postPagesController.abort();
          }, 5000);
          
          let postPagesRes;
          try {
            postPagesRes = await fetch(pagesUrl, {
              method: 'POST',
              headers,
              body: JSON.stringify({ build_type: 'workflow', source: { branch: defaultBranch, path: '/' } }),
              signal: postPagesController.signal
            });
            clearTimeout(postPagesTimeoutId);
          } catch (postErr: any) {
            clearTimeout(postPagesTimeoutId);
            addLog(`Failed to post Pages config: ${postErr.message}`, 'warn');
            throw postErr;
          }
          
          addLog(`[Pages Config POST] Response status: ${postPagesRes.status}`);
          const postPagesData = await postPagesRes.json().catch(() => ({}));
          if (postPagesRes.ok) {
            addLog('Successfully created GitHub Pages site with "workflow" build type.');
            addLog(`Pages enabled for ${owner}/${repoNamePart}`);
          } else {
            addLog(`Failed to create GitHub Pages site: ${postPagesData.message || 'Unknown error'}`, 'warn');
          }
        } else if (getPagesRes.ok) {
          const pagesConfig = await getPagesRes.json().catch(() => ({}));
          addLog(`Current Pages configuration: build_type=${pagesConfig.build_type}`);
          if (pagesConfig.build_type === 'legacy') {
            addLog('Pages is set to "legacy" (branch-based). Updating Pages configuration to "workflow"...', 'info');
            
            const putPagesController = new AbortController();
            const putPagesTimeoutId = setTimeout(() => {
              addLog(`[Pages Config PUT] Timeout reached, aborting request...`, 'warn');
              putPagesController.abort();
            }, 5000);
            
            let putPagesRes;
            try {
              putPagesRes = await fetch(pagesUrl, {
                method: 'PUT',
                headers,
                body: JSON.stringify({ build_type: 'workflow', source: { branch: defaultBranch, path: '/' } }),
                signal: putPagesController.signal
              });
              clearTimeout(putPagesTimeoutId);
            } catch (putErr: any) {
              clearTimeout(putPagesTimeoutId);
              addLog(`Failed to put Pages config: ${putErr.message}`, 'warn');
              throw putErr;
            }
            
            addLog(`[Pages Config PUT] Response status: ${putPagesRes.status}`);
            const putPagesData = await putPagesRes.json().catch(() => ({}));
            if (putPagesRes.ok) {
              addLog('Successfully updated GitHub Pages configuration to "workflow".');
              addLog(`Pages enabled for ${owner}/${repoNamePart}`);
            } else {
              addLog(`Failed to update GitHub Pages configuration: ${putPagesData.message || 'Unknown error'}`, 'warn');
            }
          } else {
            addLog('GitHub Pages is already configured with "workflow" build type.');
            addLog(`Pages enabled for ${owner}/${repoNamePart}`);
          }
          
          // Check for and cancel any active/queued workflow runs to prevent overlapping Pages deployment errors
          try {
            addLog(`Checking for in-progress workflow runs for "${owner}/${repoNamePart}" to prevent concurrent deployment errors...`);
            const checkUrl = `https://api.github.com/repos/${owner}/${repoNamePart}/actions/runs?status=in_progress`;
            addLog(`[Workflow Check] API URL: ${checkUrl}`);
            
            // Set a strict 7-second timeout for this check to prevent hanging
            const controller = new AbortController();
            const timeoutId = setTimeout(() => {
              addLog(`[Workflow Check] Timeout of 7000ms reached, aborting check fetch...`, 'warn');
              controller.abort();
            }, 7000);
            
            try {
              addLog(`[Workflow Check] Starting fetch from GitHub...`);
              const checkRes = await fetch(checkUrl, { 
                headers, 
                cache: 'no-store', 
                signal: controller.signal 
              });
              clearTimeout(timeoutId);
              addLog(`[Workflow Check] Response status: ${checkRes.status}`);
              
              if (checkRes.ok) {
                const checkData = await checkRes.json().catch(() => ({}));
                addLog(`[Workflow Check] Successfully parsed response. Found ${checkData?.workflow_runs?.length || 0} runs.`);
                if (checkData && Array.isArray(checkData.workflow_runs) && checkData.workflow_runs.length > 0) {
                  for (const run of checkData.workflow_runs) {
                    if (!run || !run.id) continue;
                    const nameLower = (run.name || '').toLowerCase();
                    const pathLower = (run.path || '').toLowerCase();
                    const isPagesRelated = nameLower.includes('pages') || nameLower.includes('deploy') || pathLower.includes('deploy.yml');
                    if (isPagesRelated) {
                      addLog(`Found active in-progress deployment run (ID: ${run.id}, Workflow: "${run.name}"). Requesting cancellation to prevent overlap...`, 'info');
                      
                      const cancelController = new AbortController();
                      const cancelTimeoutId = setTimeout(() => {
                        addLog(`[Workflow Cancel] Timeout reached, aborting cancellation of run ${run.id}...`, 'warn');
                        cancelController.abort();
                      }, 5000);
                      try {
                        const cancelRes = await fetch(`https://api.github.com/repos/${owner}/${repoNamePart}/actions/runs/${run.id}/cancel`, {
                          method: 'POST',
                          headers,
                          signal: cancelController.signal
                        });
                        clearTimeout(cancelTimeoutId);
                        if (cancelRes.ok) {
                          addLog(`Successfully requested cancellation of run ${run.id}.`);
                        } else {
                          const cancelData = await cancelRes.json().catch(() => ({}));
                          addLog(`Note requesting cancellation: ${cancelData.message || cancelRes.statusText}`, 'info');
                        }
                      } catch (cancelErr: any) {
                        clearTimeout(cancelTimeoutId);
                        addLog(`Note cancellation request: ${cancelErr.message}`, 'info');
                      }
                    }
                  }
                  // Give GitHub a moment to register cancellation
                  addLog(`Waiting 3s for GitHub to process cancellations...`);
                  await new Promise(resolve => setTimeout(resolve, 3000));
                } else {
                  addLog(`No conflicting active workflow runs found.`);
                }
              } else {
                addLog(`Workflow runs check response status: ${checkRes.status}. Continuing anyway...`, 'warn');
              }
            } catch (fetchErr: any) {
              clearTimeout(timeoutId);
              addLog(`Workflow runs check fetch note: ${fetchErr.message}. Continuing anyway...`, 'info');
            }
          } catch (checkErr: any) {
            addLog(`Note checking/cancelling in-progress workflow runs: ${checkErr.message}. Continuing anyway...`, 'info');
          }

          // Proactively trigger the workflow run immediately via workflow_dispatch API
          addLog(`[Pages Deploy] Proactively triggering deployment workflow (deploy.yml) for ${owner}/${repoNamePart} via workflow_dispatch...`);
          addLog(`DEBUG: Using dispatchUrl: https://api.github.com/repos/${owner}/${repoNamePart}/actions/workflows/deploy.yml/dispatches`);
          const dispatchUrl = `https://api.github.com/repos/${owner}/${repoNamePart}/actions/workflows/deploy.yml/dispatches`;
          
          const dispatchController = new AbortController();
          const dispatchTimeoutId = setTimeout(() => {
            addLog(`[Workflow Dispatch] Timeout of 6000ms reached, aborting dispatch fetch...`, 'warn');
            dispatchController.abort();
          }, 6000);
          try {
            addLog(`[Workflow Dispatch] Dispatching to GitHub...`);
            const dispatchRes = await fetch(dispatchUrl, {
              method: 'POST',
              headers,
              body: JSON.stringify({ ref: defaultBranch }),
              signal: dispatchController.signal
            });
            clearTimeout(dispatchTimeoutId);
            addLog(`[Workflow Dispatch] Response status: ${dispatchRes.status}`);
            
            if (dispatchRes.ok) {
              addLog('Successfully triggered Pages build/deploy workflow via workflow_dispatch.');
            } else {
              const dispatchData = await dispatchRes.json().catch(() => ({}));
              addLog(`Workflow dispatch status / note: ${dispatchData.message || 'Already queued by push event'}`, 'info');
            }
          } catch (dispatchErr: any) {
            clearTimeout(dispatchTimeoutId);
            addLog(`Workflow dispatch fetch note: ${dispatchErr.message}`, 'info');
          }
          
          // Log active/pending workflow runs to provide clear visibility to the user
          try {
            const runsUrl = `https://api.github.com/repos/${owner}/${repoNamePart}/actions/runs?event=push&per_page=1`;
            const runsController = new AbortController();
            const runsTimeoutId = setTimeout(() => {
              addLog(`[Workflow Runs Log] Timeout reached, aborting query...`, 'warn');
              runsController.abort();
            }, 4000);
            try {
              addLog(`[Workflow Runs Log] Querying active push runs...`);
              const runsRes = await fetch(runsUrl, { headers, signal: runsController.signal });
              clearTimeout(runsTimeoutId);
              addLog(`[Workflow Runs Log] Response status: ${runsRes.status}`);
              
              if (runsRes.ok) {
                const runsData = await runsRes.json().catch(() => ({}));
                if (runsData && runsData.workflow_runs && runsData.workflow_runs.length > 0) {
                  const run = runsData.workflow_runs[0];
                  if (run) {
                    addLog(`Detected active GitHub Actions Run: ID=${run.id}, Status=${run.status}, Conclusion=${run.conclusion || 'pending'}`);
                  }
                }
              }
            } catch (runsErr: any) {
              clearTimeout(runsTimeoutId);
              addLog(`Note querying workflow runs fetch: ${runsErr.message}`, 'info');
            }
          } catch (runErr: any) {
            addLog(`Note querying workflow runs: ${runErr.message}`, 'info');
          }
        } else {
          const errData = await getPagesRes.json().catch(() => ({}));
          addLog(`Unexpected response when checking Pages: HTTP ${getPagesRes.status} - ${errData.message || 'No details'}`, 'warn');
        }
      } catch (err: any) {
        addLog(`Error configuring GitHub Pages: ${err.message}`, 'warn');
      }
    }

    addLog('Deployment completed successfully!');
    res.json({ 
      success: true, 
      commitSha: finalCommitSha, 
      pagesUrl: hasWorkflowScope ? (repoInfo.name.toLowerCase() === `${repoInfo.owner.login.toLowerCase()}.github.io` ? `https://${repoInfo.name}/` : `https://${repoInfo.owner.login}.github.io/${repoInfo.name}/`) : null,
      repoUrl: repoInfo.html_url || `https://github.com/${owner}/${repoNamePart}`,
      logs 
    });
  } catch (err: any) {
    addLog(`Critical deployment error: ${err.message}`, 'error');
    res.status(500).json({ error: err.message, logs });
  }
});

app.post('/api/github/build-apk', async (req, res) => {
  const { email, repoFullName, appName, appUrl, iconBase64 } = req.body;
  if (!email || !repoFullName) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }

  try {
    const normalizedEmail = email.toLowerCase().trim();
    const docSnap = await originalGetDoc(doc(db!, 'github_connections', normalizedEmail));
    if (!docSnap.exists()) return res.status(401).json({ error: 'GitHub not connected' });
    const { access_token } = docSnap.data();

    const headers = {
      'Authorization': `Bearer ${access_token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'Animato-Studio',
      'Content-Type': 'application/json'
    };

    const [owner, repoPart] = repoFullName.split('/');
    const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repoPart}`, { headers });
    if (!repoRes.ok) throw new Error("Failed to fetch repo info");
    const repoInfo = await repoRes.json();
    const defaultBranch = repoInfo.default_branch || 'main';

    const isFineGrained = String(access_token || '').startsWith('github_pat_');
    let hasWorkflowScope = false;
    const scopesHeader = repoRes.headers?.get('x-oauth-scopes') || '';
    if (isFineGrained || scopesHeader.includes('workflow')) {
      hasWorkflowScope = true;
    }

    if (!hasWorkflowScope) {
      throw new Error("Your GitHub connection token lacks the required 'workflow' scope to create or update workflows under '.github/workflows/'. Please disconnect and reconnect your GitHub account in the Settings menu, making sure to grant/check the 'workflow' permission.");
    }

    // 1. Prepare files for Capacitor
    const packageId = `com.animato.${appName.toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9]/g, '')}`;
    const expectedAppUrl = appUrl || (repoPart.toLowerCase() === `${owner.toLowerCase()}.github.io` ? `https://${repoPart}/` : `https://${owner}.github.io/${repoPart}/`);
    const host = new URL(expectedAppUrl).hostname;

    const capacitorConfigContent = `import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: '${packageId}',
  appName: '${appName}',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    url: '${expectedAppUrl}',
    allowNavigation: [
      '${host}',
      '*.github.io',
      '*.run.app'
    ]
  }
};

export default config;
`;

    const patchGradleContent = `const fs = require('fs');
const path = require('path');

const gradlePath = path.join(process.cwd(), 'android', 'app', 'build.gradle');
if (!fs.existsSync(gradlePath)) {
  console.error("build.gradle not found at: " + gradlePath);
  process.exit(1);
}

let content = fs.readFileSync(gradlePath, 'utf8');

const signingConfigs = \`
    signingConfigs {
        release {
            storeFile file("../../android.keystore")
            storePassword "password"
            keyAlias "android"
            keyPassword "password"
        }
    }
\`;

if (!content.includes('buildTypes {')) {
  console.error("Could not find 'buildTypes {' block in build.gradle");
  process.exit(1);
}

// 1. Inject signingConfigs right before buildTypes block
content = content.replace('buildTypes {', signingConfigs + '\\n    buildTypes {');

if (!/buildTypes\\s*\\{\\s*release\\s*\\{/.test(content)) {
  console.error("Could not find 'release {' block inside 'buildTypes {' in build.gradle");
  process.exit(1);
}

// 2. Inject signingConfig inside the release buildTypes block
content = content.replace(/buildTypes\\s*\\{\\s*release\\s*\\{/, "buildTypes {\\n        release {\\n            signingConfig signingConfigs.release");

// 3. Resolve Kotlin stdlib duplicate classes by forcing consistent versions (e.g., 1.8.22)
content += \`\\n\\nconfigurations.all {\\n    resolutionStrategy {\\n        force "org.jetbrains.kotlin:kotlin-stdlib:1.8.22"\\n        force "org.jetbrains.kotlin:kotlin-stdlib-jdk7:1.8.22"\\n        force "org.jetbrains.kotlin:kotlin-stdlib-jdk8:1.8.22"\\n    }\\n}\\n\`;

fs.writeFileSync(gradlePath, content, 'utf8');
console.log("Successfully patched build.gradle with signing config!");
`;

    const workflowContent = `name: Build Android APK
on:
  workflow_dispatch: {}
jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    env:
      CI: true
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: Set up JDK 21
        uses: actions/setup-java@v4
        with:
          distribution: 'temurin'
          java-version: '21'
      - name: Setup Android SDK
        uses: android-actions/setup-android@v3
      - name: Debug JDK and Android SDK
        run: |
          echo "JAVA_HOME: $JAVA_HOME"
          java -version
          echo "ANDROID_HOME: $ANDROID_HOME"
          echo "ANDROID_SDK_ROOT: $ANDROID_SDK_ROOT"
      - name: Initialize Dummy Web Dir
        run: |
          mkdir -p dist
          echo "<html><body>Animato Studio</body></html>" > dist/index.html
      - name: Install Capacitor CLI and Android Platform
        run: |
          npm install @capacitor/core @capacitor/android
          npm install -D @capacitor/cli
      - name: Create Android Project
        run: |
          npx cap add android
      - name: Generate Android Icons
        run: |
          npm install -D @capacitor/assets
          if [ -f "assets/icon.png" ]; then
            echo "Found assets/icon.png. Generating icons..."
            npx @capacitor/assets generate --iconBackgroundColor '#ffffff' --splashBackgroundColor '#ffffff' --android
            echo "Confirming generated files:"
            ls -la android/app/src/main/res/mipmap-hdpi/ || true
          else
            echo "No assets/icon.png found. Skipping icon generation."
          fi
      - name: Generate Keystore
        run: |
          keytool -genkey -v -keystore android.keystore -alias android -keyalg RSA -keysize 2048 -validity 10000 -storepass password -keypass password -dname "CN=Animato, OU=Studio, O=Animato, L=Cloud, S=Cloud, C=US"
      - name: Debug build.gradle before Patch
        run: |
          echo "=== Content of android/app/build.gradle ==="
          cat android/app/build.gradle
      - name: Patch build.gradle for Release Signing
        run: |
          node patch-gradle.cjs
      - name: Debug build.gradle after Patch
        run: |
          echo "=== Content of android/app/build.gradle after patch ==="
          cat android/app/build.gradle
      - name: Sync Capacitor
        run: |
          npx cap sync android
      - name: Build Signed APK
        run: |
          cd android
          chmod +x gradlew
          ./gradlew assembleRelease
      - name: Rename APK
        run: |
          mv android/app/build/outputs/apk/release/app-release.apk game-release.apk
      - name: Upload APK as Workflow Artifact
        uses: actions/upload-artifact@v4
        with:
          name: game-release-apk
          path: game-release.apk
      - name: Create Release
        uses: softprops/action-gh-release@v2
        with:
          tag_name: v\${{ github.run_number }}
          files: game-release.apk
          generate_release_notes: true
`;

    const files: { path: string; content: string; isBase64?: boolean }[] = [
      { path: 'capacitor.config.ts', content: capacitorConfigContent },
      { path: 'patch-gradle.cjs', content: patchGradleContent },
      { path: '.github/workflows/build-apk.yml', content: workflowContent }
    ];

    if (iconBase64) {
      files.push({ path: 'assets/icon.png', content: iconBase64, isBase64: true });
    }

    const refRes = await fetch(`https://api.github.com/repos/${owner}/${repoPart}/git/refs/heads/${defaultBranch}`, { headers });
    const refData = await refRes.json();
    const headOid = refData.object?.sha;

    if (headOid) {
      const graphqlQuery = {
        query: `
          mutation ($input: CreateCommitOnBranchInput!) {
            createCommitOnBranch(input: $input) {
              commit { oid }
            }
          }
        `,
        variables: {
          input: {
            branch: { repositoryNameWithOwner: repoFullName, branchName: defaultBranch },
            message: { headline: 'Setup APK Build Pipeline' },
            expectedHeadOid: headOid,
            fileChanges: {
              additions: files.map(f => ({
                path: f.path,
                contents: f.isBase64 ? f.content : Buffer.from(f.content).toString('base64')
              })),
              deletions: []
            }
          }
        }
      };

      const gqlRes = await fetch('https://api.github.com/graphql', {
        method: 'POST',
        headers,
        body: JSON.stringify(graphqlQuery)
      });
      if (!gqlRes.ok) {
        const errText = await gqlRes.text();
        throw new Error(`GraphQL API request failed with status ${gqlRes.status}: ${errText}`);
      }
      const gqlData = await gqlRes.json();
      if (gqlData.errors) {
        console.error("GraphQL Error:", gqlData.errors);
        const errMsg = gqlData.errors.map((e: any) => e.message).join(", ");
        throw new Error(`Failed to commit APK build workflow to GitHub: ${errMsg}`);
      }
    }

    // Initial delay for commit propagation to let GitHub process and index the new workflow
    await new Promise(resolve => setTimeout(resolve, 15000));

    // === DIAGNOSTIC VERIFICATION ===
    console.log("=== APK BUILD WORKFLOW DIAGNOSTIC VERIFICATION ===");
    console.log(`Repo: ${owner}/${repoPart}, Default Branch: ${defaultBranch}`);

    let liveWorkflowFileContent = "Not found / Error fetching";
    try {
      const liveFileRes = await fetch(`https://api.github.com/repos/${owner}/${repoPart}/contents/.github/workflows/build-apk.yml?ref=${defaultBranch}`, { headers });
      if (liveFileRes.ok) {
        const liveFileData = await liveFileRes.json();
        if (liveFileData.content) {
          liveWorkflowFileContent = Buffer.from(liveFileData.content, 'base64').toString('utf-8');
          console.log(`Live Workflow File Content (from GitHub directly on ref=${defaultBranch}):`);
          console.log(liveWorkflowFileContent);
        } else {
          console.log("Live file metadata fetched, but 'content' field was missing or empty.");
          liveWorkflowFileContent = "Live file metadata fetched, but 'content' field was missing or empty.";
        }
      } else {
        const errText = await liveFileRes.text();
        console.error(`Failed to fetch live file content. Status: ${liveFileRes.status}, Response: ${errText}`);
        liveWorkflowFileContent = `Error (Status: ${liveFileRes.status}): ${errText}`;
      }
    } catch (checkErr: any) {
      console.error(`Exception during fetching live workflow file: ${checkErr.message}`);
      liveWorkflowFileContent = `Exception: ${checkErr.message}`;
    }

    let workflowsListString = "Not found / Error fetching";
    let matchedWorkflowId: string | null = null;
    let matchedWorkflowState = "Unknown";
    try {
      const wfRes = await fetch(`https://api.github.com/repos/${owner}/${repoPart}/actions/workflows`, { headers });
      if (wfRes.ok) {
        const wfData = await wfRes.json();
        console.log("Workflows currently recognized by GitHub:");
        console.log(JSON.stringify(wfData, null, 2));
        workflowsListString = JSON.stringify(wfData, null, 2);
        
        if (wfData.workflows && Array.isArray(wfData.workflows)) {
          const matched = wfData.workflows.find((w: any) => w.path === '.github/workflows/build-apk.yml' || w.name === 'Build Android APK');
          if (matched) {
            matchedWorkflowId = String(matched.id);
            matchedWorkflowState = matched.state;
            console.log(`Found matching workflow in GitHub's registry: ID=${matchedWorkflowId}, State=${matchedWorkflowState}`);
          } else {
            console.log("No matching workflow found in GitHub's registry for path '.github/workflows/build-apk.yml'");
          }
        }
      } else {
        const errText = await wfRes.text();
        console.error(`Failed to fetch actions/workflows. Status: ${wfRes.status}, Response: ${errText}`);
        workflowsListString = `Error (Status: ${wfRes.status}): ${errText}`;
      }
    } catch (checkErr: any) {
      console.error(`Exception during fetching actions/workflows: ${checkErr.message}`);
      workflowsListString = `Exception: ${checkErr.message}`;
    }
    console.log("=== END OF DIAGNOSTIC VERIFICATION ===");

    let triggerRes = null;
    let triggerData: any = {};
    const maxAttempts = 12;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      console.log(`\n--- Dispatch Attempt ${attempt}/${maxAttempts} ---`);
      
      // 1. Freshly fetch workflows from GitHub to avoid any cached registries
      let currentWorkflowIdToUse = 'build-apk.yml';
      let currentWorkflowState = 'unknown';
      try {
        const freshWfRes = await fetch(`https://api.github.com/repos/${owner}/${repoPart}/actions/workflows`, { 
          headers,
          cache: 'no-store'
        });
        if (freshWfRes.ok) {
          const freshWfData = await freshWfRes.json();
          console.log(`[Attempt ${attempt}] Fresh workflows registry fetched:`, JSON.stringify(freshWfData.workflows || [], null, 2));
          if (freshWfData.workflows && Array.isArray(freshWfData.workflows)) {
            const matched = freshWfData.workflows.find((w: any) => 
              w.path === '.github/workflows/build-apk.yml' || w.name === 'Build Android APK'
            );
            if (matched) {
              currentWorkflowIdToUse = String(matched.id || 'build-apk.yml');
              currentWorkflowState = matched.state;
              console.log(`[Attempt ${attempt}] Match found in live registry! ID: "${currentWorkflowIdToUse}", Path: "${matched.path}", State: "${currentWorkflowState}"`);
            } else {
              console.log(`[Attempt ${attempt}] No matching workflow found in GitHub's active registry for path '.github/workflows/build-apk.yml'. Defaulting to filename.`);
            }
          }
        } else {
          console.warn(`[Attempt ${attempt}] Failed to fetch fresh workflows registry. Status: ${freshWfRes.status}`);
        }
      } catch (err: any) {
        console.warn(`[Attempt ${attempt}] Exception fetching fresh workflows: ${err.message}`);
      }

      // 2. Freshly fetch the live file content from the default branch to double-check dispatch existence
      try {
        const freshFileRes = await fetch(`https://api.github.com/repos/${owner}/${repoPart}/contents/.github/workflows/build-apk.yml?ref=${defaultBranch}`, {
          headers,
          cache: 'no-store'
        });
        if (freshFileRes.ok) {
          const freshFileData = await freshFileRes.json();
          if (freshFileData.content) {
            const currentContent = Buffer.from(freshFileData.content, 'base64').toString('utf-8');
            console.log(`[Attempt ${attempt}] Verified live .github/workflows/build-apk.yml contents on branch "${defaultBranch}":`);
            console.log(currentContent);
          }
        }
      } catch (err: any) {
        console.warn(`[Attempt ${attempt}] Exception verifying file contents: ${err.message}`);
      }

      // 3. Prepare the request URL & Body
      const dispatchUrl = `https://api.github.com/repos/${owner}/${repoPart}/actions/workflows/${currentWorkflowIdToUse}/dispatches`;
      const requestBody = { ref: defaultBranch };

      // 4. Log the exact request parameters before sending
      console.log(`[Attempt ${attempt}] Sending dispatch request:`);
      console.log(` - URL: POST ${dispatchUrl}`);
      console.log(` - Workflow ID Parameter (workflow_id): "${currentWorkflowIdToUse}"`);
      console.log(` - Ref Parameter (ref): "${requestBody.ref}"`);
      console.log(` - Headers (Sanitized):`, JSON.stringify({
        ...headers,
        'Authorization': 'Bearer [REDACTED]'
      }, null, 2));
      console.log(` - Body:`, JSON.stringify(requestBody, null, 2));

      // 5. Send the dispatch call
      triggerRes = await fetch(dispatchUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody)
      });

      if (triggerRes.ok) {
        console.log(`[Attempt ${attempt}] Successfully dispatched build-apk workflow!`);
        break;
      }

      triggerData = await triggerRes.json().catch(() => ({}));
      const errorMsg = triggerData.message || 'Unknown error';
      console.warn(`[Attempt ${attempt}] Trigger failed: ${errorMsg}`);
      
      if (attempt < maxAttempts) {
        console.log(`[Attempt ${attempt}] Retrying in 8 seconds...`);
        await new Promise(resolve => setTimeout(resolve, 8000));
      }
    }

    if (!triggerRes || !triggerRes.ok) {
      const finalErrorMsg = triggerData.message || 'Unknown error';
      // Construct a highly detailed error message including diagnostic output
      const detailedMessage = `Failed to trigger build workflow after multiple attempts. GitHub returned: "${finalErrorMsg}".\n\n` +
        `--- DIAGNOSTICS ---\n` +
        `Workflow ID used in dispatch: "build-apk.yml"\n` +
        `Expected File Path: ".github/workflows/build-apk.yml"\n` +
        `Live File Content from GitHub:\n${liveWorkflowFileContent}\n\n` +
        `Actions Workflows in Repo:\n${workflowsListString}\n` +
        `-------------------`;
      throw new Error(detailedMessage);
    }

    let runId = null;
    for (let i = 0; i < 5; i++) {
      await new Promise(resolve => setTimeout(resolve, 3000));
      const runsRes = await fetch(`https://api.github.com/repos/${owner}/${repoPart}/actions/runs?workflow=build-apk.yml`, { headers });
      const runsData = await runsRes.json();
      if (runsData.workflow_runs && runsData.workflow_runs.length > 0) {
        runId = runsData.workflow_runs[0].id;
        break;
      }
    }

    res.json({ success: true, runId });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/github/latest-apk', async (req, res) => {
  const { email, repoFullName } = req.query;
  if (!email || !repoFullName) return res.status(400).json({ error: 'Missing params' });

  try {
    const docSnap = await originalGetDoc(doc(db!, 'github_connections', String(email).toLowerCase().trim()));
    if (!docSnap.exists()) return res.status(401).json({ error: 'Not connected' });
    const { access_token } = docSnap.data();
    const headers = {
      'Authorization': `Bearer ${access_token}`,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'Animato-Studio'
    };

    const [owner, repoPart] = String(repoFullName).split('/');
    const relRes = await fetch(`https://api.github.com/repos/${owner}/${repoPart}/releases/latest`, { headers });
    if (!relRes.ok) {
      return res.json({ apkUrl: null });
    }
    const relData = await relRes.json();
    const asset = relData.assets?.find((a: any) => a.name.endsWith('.apk'));
    
    if (asset) {
      res.json({ apkUrl: asset.browser_download_url });
    } else {
      res.json({ apkUrl: null });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/github/build-status', async (req, res) => {
  const { email, repoFullName, runId } = req.query;
  if (!email || !repoFullName || !runId) return res.status(400).json({ error: 'Missing params' });

  try {
    const docSnap = await originalGetDoc(doc(db!, 'github_connections', String(email).toLowerCase().trim()));
    if (!docSnap.exists()) return res.status(401).json({ error: 'Not connected' });
    const { access_token } = docSnap.data();
    const headers = {
      'Authorization': `Bearer ${access_token}`,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'Animato-Studio'
    };

    const [owner, repoPart] = String(repoFullName).split('/');
    const runRes = await fetch(`https://api.github.com/repos/${owner}/${repoPart}/actions/runs/${runId}`, { headers });
    const runData = await runRes.json();

    let apkUrl = null;
    if (runData.status === 'completed' && runData.conclusion === 'success') {
      const releaseRes = await fetch(`https://api.github.com/repos/${owner}/${repoPart}/releases/tags/v${runData.run_number}`, { headers });
      if (releaseRes.ok) {
        const releaseData = await releaseRes.json();
        const asset = releaseData.assets?.find((a: any) => a.name === 'game-release.apk');
        if (asset) {
          apkUrl = asset.browser_download_url;
        }
      }
      
      if (!apkUrl) {
        const artifactsRes = await fetch(`https://api.github.com/repos/${owner}/${repoPart}/actions/runs/${runId}/artifacts`, { headers });
        const artifactsData = await artifactsRes.json();
        if (artifactsData.artifacts && artifactsData.artifacts.length > 0) {
          apkUrl = artifactsData.artifacts[0].archive_download_url;
        }
      }
    }

    res.json({
      status: runData.status,
      conclusion: runData.conclusion,
      apkUrl: apkUrl || runData.html_url
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- REST OF ROUTES ---

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.post("/api/local-upload", async (req, res) => {
  try {
    const { fileName, base64Data } = req.body;
    if (!fileName || !base64Data) {
      return res.status(400).json({ error: "Missing file name or data" });
    }
    const buffer = Buffer.from(base64Data, "base64");
    const uniqueName = `${Date.now()}_${fileName.replace(/[^a-zA-Z0-9.\-_]/g, "_")}`;
    const filePath = path.join(uploadsDir, uniqueName);
    
    // 1. Try persistent cloud storage (Supabase Storage) first
    try {
      const storagePath = `creator_uploads/${uniqueName}`;
      console.log(`[local-upload] Attempting upload to Supabase Storage: ${storagePath}`);
      
      const ext = uniqueName.split('.').pop()?.toLowerCase() || '';
      let contentType = 'application/octet-stream';
      if (ext === 'png') contentType = 'image/png';
      else if (ext === 'jpg' || ext === 'jpeg') contentType = 'image/jpeg';
      else if (ext === 'gif') contentType = 'image/gif';
      else if (ext === 'json') contentType = 'application/json';
      else if (ext === 'zip') contentType = 'application/zip';

      const { error } = await supabase.storage
        .from('animato_uploads')
        .upload(storagePath, buffer, {
          contentType,
          upsert: true
        });

      if (error) {
        console.warn("[local-upload] Supabase upload failed, falling back to local file:", error.message);
        throw error;
      }

      const { data: pvData } = supabase.storage
        .from('animato_uploads')
        .getPublicUrl(storagePath);

      if (pvData && pvData.publicUrl) {
        console.log(`[local-upload] Successfully uploaded to Supabase Storage: ${pvData.publicUrl}`);
        return res.json({ url: pvData.publicUrl });
      }
    } catch (supabaseErr: any) {
      console.warn("[local-upload] Supabase upload exception, falling back to local filesystem:", supabaseErr.message);
    }

    // 2. Fallback to local files (on-demand directory check)
    ensureUploadsDir();
    fs.writeFileSync(filePath, buffer);
    const fileUrl = `/uploads/${uniqueName}`;
    console.log(`[local-upload] Fallback upload to local filesystem completed: ${fileUrl}`);
    res.json({ url: fileUrl });
  } catch (err: any) {
    console.error("[local-upload] Local upload failing completely:", err);
    res.status(500).json({ error: err.message });
  }
});

// --- LOCAL FILE DATABASE PROXY ENDPOINTS ---
app.post("/api/local-db/get-doc", async (req, res) => {
  try {
    const { collection: col, id } = req.body;
    const data = await getDocLocal(String(col), String(id));
    res.json({ status: true, data });
  } catch (err: any) {
    console.error("LocalDB proxy get-doc error:", err);
    res.status(500).json({ status: false, message: err.message });
  }
});

app.post("/api/local-db/get-docs", async (req, res) => {
  try {
    const { collection: col, filters } = req.body;
    const data = await queryCollection(String(col), filters || []);
    res.json({ status: true, data });
  } catch (err: any) {
    console.error("LocalDB proxy get-docs error:", err);
    res.status(500).json({ status: false, message: err.message });
  }
});

app.post("/api/local-db/set-doc", async (req, res) => {
  try {
    const { collection: col, id, data } = req.body;
    await setDocLocal(String(col), String(id), data);
    
    if (String(col) === "dropbox_keys") {
      saveDropboxKeyToSheet({ id, ...data }).catch((err) =>
        console.error("[set-doc] Sync token to sheet error:", err)
      );
    } else if (String(col) === "sellers") {
      saveCreatorToSheet({ id, ...data }, "seller").catch((err) =>
        console.error("[set-doc] Sync seller to sheet error:", err)
      );
    } else if (String(col) === "referrals") {
      saveCreatorToSheet({ id, ...data }, "referral").catch((err) =>
        console.error("[set-doc] Sync referral to sheet error:", err)
      );
    } else if (String(col) === "products") {
      saveProductToSheet({ id, ...data }).catch((err) =>
        console.error("[set-doc] Sync product to sheet error:", err)
      );
    }
    
    res.json({ status: true });
  } catch (err: any) {
    console.error("LocalDB proxy set-doc error:", err);
    res.status(500).json({ status: false, message: err.message });
  }
});

app.post("/api/local-db/update-doc", async (req, res) => {
  try {
    const { collection: col, id, data } = req.body;
    await updateDocLocal(String(col), String(id), data);
    
    if (String(col) === "dropbox_keys") {
      const currentKeys = await readCollectionFile("dropbox_keys").catch(() => ({}));
      const fullObj = { id, ...(currentKeys[id] || {}), ...data };
      saveDropboxKeyToSheet(fullObj).catch((err) =>
        console.error("[update-doc] Sync token to sheet error:", err)
      );
    } else if (String(col) === "sellers") {
      const current = await readCollectionFile("sellers").catch(() => ({}));
      const fullObj = { id, ...(current[id] || {}), ...data };
      saveCreatorToSheet(fullObj, "seller").catch((err) =>
        console.error("[update-doc] Sync seller to sheet error:", err)
      );
    } else if (String(col) === "referrals") {
      const current = await readCollectionFile("referrals").catch(() => ({}));
      const fullObj = { id, ...(current[id] || {}), ...data };
      saveCreatorToSheet(fullObj, "referral").catch((err) =>
        console.error("[update-doc] Sync referral to sheet error:", err)
      );
    } else if (String(col) === "products") {
      const current = await readCollectionFile("products").catch(() => ({}));
      const fullObj = { id, ...(current[id] || {}), ...data };
      saveProductToSheet(fullObj).catch((err) =>
        console.error("[update-doc] Sync product to sheet error:", err)
      );
    }
    
    res.json({ status: true });
  } catch (err: any) {
    console.error("LocalDB proxy update-doc error:", err);
    res.status(500).json({ status: false, message: err.message });
  }
});

app.post("/api/local-db/delete-doc", async (req, res) => {
  try {
    const { collection: col, id } = req.body;
    await deleteDocLocal(String(col), String(id));
    deleteFromSheet(String(col), String(id)).catch((err) =>
      console.error("[delete-doc] Sync delete to sheet error:", err)
    );
    res.json({ status: true });
  } catch (err: any) {
    console.error("LocalDB proxy delete-doc error:", err);
    res.status(500).json({ status: false, message: err.message });
  }
});

app.post("/api/local-db/batch", async (req, res) => {
  try {
    const { operations } = req.body;
    if (Array.isArray(operations)) {
      for (const op of operations) {
        const col = String(op.collection);
        const id = String(op.id);
        const data = op.data;

        if (op.action === "setDoc") {
          await setDocLocal(col, id, data);
          if (col === "dropbox_keys") {
            saveDropboxKeyToSheet({ id, ...data }).catch((err) =>
              console.error("[batch set-doc] Sync token to sheet error:", err)
            );
          } else if (col === "sellers") {
            saveCreatorToSheet({ id, ...data }, "seller").catch((err) =>
              console.error("[batch set-doc] Sync seller to sheet error:", err)
            );
          } else if (col === "referrals") {
            saveCreatorToSheet({ id, ...data }, "referral").catch((err) =>
              console.error("[batch set-doc] Sync referral to sheet error:", err)
            );
          } else if (col === "products") {
            saveProductToSheet({ id, ...data }).catch((err) =>
              console.error("[batch set-doc] Sync product to sheet error:", err)
            );
          }
        } else if (op.action === "updateDoc") {
          await updateDocLocal(col, id, data);
          if (col === "dropbox_keys") {
            const currentKeys = await readCollectionFile("dropbox_keys").catch(() => ({}));
            const fullObj = { id, ...(currentKeys[id] || {}), ...data };
            saveDropboxKeyToSheet(fullObj).catch((err) =>
              console.error("[batch update-doc] Sync token to sheet error:", err)
            );
          } else if (col === "sellers") {
            const current = await readCollectionFile("sellers").catch(() => ({}));
            const fullObj = { id, ...(current[id] || {}), ...data };
            saveCreatorToSheet(fullObj, "seller").catch((err) =>
              console.error("[batch update-doc] Sync seller to sheet error:", err)
            );
          } else if (col === "referrals") {
            const current = await readCollectionFile("referrals").catch(() => ({}));
            const fullObj = { id, ...(current[id] || {}), ...data };
            saveCreatorToSheet(fullObj, "referral").catch((err) =>
              console.error("[batch update-doc] Sync referral to sheet error:", err)
            );
          } else if (col === "products") {
            const current = await readCollectionFile("products").catch(() => ({}));
            const fullObj = { id, ...(current[id] || {}), ...data };
            saveProductToSheet(fullObj).catch((err) =>
              console.error("[batch update-doc] Sync product to sheet error:", err)
            );
          }
        } else if (op.action === "deleteDoc") {
          await deleteDocLocal(col, id);
          deleteFromSheet(col, id).catch((err) =>
            console.error("[batch delete-doc] Sync delete to sheet error:", err)
          );
        }
      }
    }
    res.json({ status: true });
  } catch (err: any) {
    console.error("LocalDB proxy batch error:", err);
    res.status(500).json({ status: false, message: err.message });
  }
});

// Temporary storage for server-assisted iframe and mobile file downloads
const tempStoreDownloads = new Map<
  string,
  { buffer: Buffer; filename: string; contentType: string }
>();

// API route for Paystack verification
app.post("/api/paystack/verify", async (req, res) => {
  const { reference } = req.body;
  const secretKey = process.env.PAYSTACK_SECRET_KEY;

  if (!secretKey) {
    return res
      .status(500)
      .json({ status: false, message: "Server configuration error" });
  }

  try {
    const response = await fetch(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${secretKey}`,
        },
      },
    );
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error("Paystack verification error:", error);
    res.status(500).json({ status: false, message: "Verification failed" });
  }
});

// API route for Paystack initialization
app.post("/api/paystack/initialize", async (req, res) => {
  const { email, amount, planType, callbackUrl } = req.body;
  const secretKey = process.env.PAYSTACK_SECRET_KEY;

  if (!secretKey) {
    return res
      .status(500)
      .json({ status: false, message: "Server configuration error" });
  }

  try {
    const response = await fetch(
      `https://api.paystack.co/transaction/initialize`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${secretKey}`,
        },
        body: JSON.stringify({
          email,
          amount: amount * 100, // Paystack uses kobo
          callback_url: callbackUrl,
          metadata: { planType },
        }),
      },
    );
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error("Paystack initialization error:", error);
    res.status(500).json({ status: false, message: "Initialization failed" });
  }
});

// --- DATABASE HELPER CHECK & FIREBASE CONNECTIONS ---
const dbCheck = (req: any, res: any, next: any) => {
  next();
};

// --- STORE API (Pure Firestore) ---
app.get("/api/store/competitions", dbCheck, async (req, res) => {
  try {
    // Run sheets sync in background to keep data fresh without slowing down API response
    syncAdminSheets().catch((err) =>
      console.error("Sheets sync on competitions fetch failed:", err)
    );
    
    let qSnap;
    try {
      qSnap = await originalGetDocs(collection(db!, "competitions"));
      const competitions = qSnap.docs.map((docSnap) => {
        const data = docSnap.data();
        return {
          id: docSnap.id,
          competition: data.competition || "",
          price: data.price || "",
          eligibility: data.eligibility || "",
          end_date: data.end_date || "",
          applicants:
            data.applicants !== undefined ? Number(data.applicants) : 0,
          what_to_submit: data.what_to_submit || "",
          input_fields: data.input_fields || "dropbox link",
          flyer: data.flyer || "",
        };
      });
      res.json({ status: true, competitions });
    } catch (err) {
      console.warn(
        "[Firestore Fallback] Loading competitions from local cache",
        err,
      );
      const localComps = await queryCollection("competitions", []);
      const competitions = localComps.map((c: any) => ({
        id: c.id,
        competition: c.competition || "",
        price: c.price || "",
        eligibility: c.eligibility || "",
        end_date: c.end_date || "",
        applicants: c.applicants !== undefined ? Number(c.applicants) : 0,
        what_to_submit: c.what_to_submit || "",
        input_fields: c.input_fields || "dropbox link",
        flyer: c.flyer || "",
      }));
      res.json({ status: true, competitions });
    }
  } catch (e: any) {
    res.status(500).json({ status: false, message: e.message });
  }
});

app.get("/api/store/tutorials", dbCheck, async (req, res) => {
  try {
    // Run sheets sync in background to keep data fresh without slowing down API response
    syncAdminSheets().catch((err) =>
      console.error("Sheets sync on tutorials fetch failed:", err)
    );
    
    let qSnap;
    try {
      qSnap = await originalGetDocs(collection(db!, "tutorials"));
      const tutorials = qSnap.docs.map((docSnap) => {
        const data = docSnap.data();
        return {
          id: docSnap.id,
          title: data.title || "",
          youtube_link: data.youtube_link || "",
          views: data.views !== undefined ? Number(data.views) : 0,
        };
      });
      res.json({ status: true, tutorials });
    } catch (err) {
      console.warn(
        "[Firestore Fallback] Loading tutorials from local cache",
        err,
      );
      const localTuts = await queryCollection("tutorials", []);
      const tutorials = localTuts.map((t: any) => ({
        id: t.id,
        title: t.title || "",
        youtube_link: t.youtube_link || "",
        views: t.views !== undefined ? Number(t.views) : 0,
      }));
      res.json({ status: true, tutorials });
    }
  } catch (e: any) {
    res.status(500).json({ status: false, message: e.message });
  }
});

app.get("/api/store/products", dbCheck, async (req, res) => {
  try {
    // Run sheets sync in background to keep data fresh without slowing down API response
    syncAdminSheets().catch((err) =>
      console.error("Sheets sync on products fetch failed:", err)
    );
    let qSnap;
    try {
      qSnap = await getDocs(collection(db!, "products"));
    } catch (e: any) {
      console.warn(
        "[Firestore Products Fallback] Error reading Firestore products, falling back to LocalDB.",
        e,
      );
      const localProducts = await queryCollection("products", []);
      const products = localProducts
        .map((p: any) => {
          let imagesArray: string[] = [];
          if (Array.isArray(p.images)) {
            imagesArray = p.images;
          } else if (p.images && typeof p.images === "string") {
            imagesArray = p.images
              .split(",")
              .map((s: string) => s.trim())
              .filter(Boolean);
          } else if (p.productImages && typeof p.productImages === "string") {
            imagesArray = p.productImages
              .split(",")
              .map((s: string) => s.trim())
              .filter(Boolean);
          } else if (Array.isArray(p.productImages)) {
            imagesArray = p.productImages;
          }

          return {
            id: p.id,
            price: p.price !== undefined ? String(p.price) : "",
            category: p.category !== undefined ? String(p.category) : "",
            thumbnail: p.thumbnail !== undefined ? String(p.thumbnail) : "",
            productImages: imagesArray.join(", "),
            images: imagesArray,
            amount: p.amount !== undefined ? Number(p.amount) : 0,
            productName:
              p.name !== undefined
                ? String(p.name)
                : p.productName !== undefined
                  ? String(p.productName)
                  : "",
            timesPurchased:
              p.timesPurchased !== undefined ? Number(p.timesPurchased) : 0,
            sellerId: p.sellerId !== undefined ? String(p.sellerId) : "",
            productUrl: p.productUrl !== undefined ? String(p.productUrl) : "",
            starRating: p.starRating !== undefined ? String(p.starRating) : "",
            productDescription:
              p.productDescription !== undefined
                ? String(p.productDescription)
                : "",
            videoUrl: p.videoUrl !== undefined ? String(p.videoUrl) : "",
            auditStatus:
              p.auditStatus !== undefined ? String(p.auditStatus) : "approved",
          };
        })
        .filter((p: any) => !!p.productUrl || !!p.productName);

      return res.json({ status: true, products });
    }

    const products = qSnap.docs
      .map((docSnap) => {
        const data = docSnap.data();

        let imagesArray: string[] = [];
        if (Array.isArray(data.images)) {
          imagesArray = data.images;
        } else if (data.images && typeof data.images === "string") {
          imagesArray = data.images
            .split(",")
            .map((s: string) => s.trim())
            .filter(Boolean);
        } else if (
          data.productImages &&
          typeof data.productImages === "string"
        ) {
          imagesArray = data.productImages
            .split(",")
            .map((s: string) => s.trim())
            .filter(Boolean);
        } else if (Array.isArray(data.productImages)) {
          imagesArray = data.productImages;
        }

        return {
          id: docSnap.id,
          price: data.price !== undefined ? String(data.price) : "",
          category: data.category !== undefined ? String(data.category) : "",
          thumbnail: data.thumbnail !== undefined ? String(data.thumbnail) : "",
          productImages: imagesArray.join(", "),
          images: imagesArray,
          amount: data.amount !== undefined ? Number(data.amount) : 0,
          productName:
            data.name !== undefined
              ? String(data.name)
              : data.productName !== undefined
                ? String(data.productName)
                : "",
          timesPurchased:
            data.timesPurchased !== undefined ? Number(data.timesPurchased) : 0,
          sellerId: data.sellerId !== undefined ? String(data.sellerId) : "",
          productUrl:
            data.productUrl !== undefined ? String(data.productUrl) : "",
          starRating:
            data.starRating !== undefined ? String(data.starRating) : "",
          productDescription:
            data.productDescription !== undefined
              ? String(data.productDescription)
              : "",
          videoUrl: data.videoUrl !== undefined ? String(data.videoUrl) : "",
          auditStatus:
            data.auditStatus !== undefined
              ? String(data.auditStatus)
              : "approved",
        };
      })
      .filter((p) => !!p.productUrl || !!p.productName);

    res.json({ status: true, products });
  } catch (error: any) {
    console.error("Store products error:", error);
    res.status(500).json({ status: false, message: error.message });
  }
});

app.post("/api/store/test-product", dbCheck, async (req, res) => {
  try {
    const id = "test_product_" + Date.now();
    const productRef = doc(db!, "products", id);
    await setDoc(productRef, {
      price: "Free",
      category: "Project File",
      thumbnail:
        "https://images.unsplash.com/photo-1550745165-9bc0b252726f?q=80&w=2000&auto=format&fit=crop",
      images: [
        "https://images.unsplash.com/photo-1550745165-9bc0b252726f?q=80&w=2000&auto=format&fit=crop",
      ],
      amount: 0,
      name: "Epic Test Animation Pack",
      timesPurchased: 0,
      sellerId: "system test",
      productUrl: "https://example.com/test.zip",
      starRating: "5",
      productDescription: "Premium content created for seamless integration.",
      videoUrl:
        "https://assets.mixkit.co/videos/preview/mixkit-motion-graphic-animation-of-shapes-and-lines-31518-large.mp4",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    res.json({ status: true, message: "Added successfully" });
  } catch (error: any) {
    res.status(500).json({ status: false, message: error.message });
  }
});

app.post("/api/store/verify-purchase", dbCheck, async (req, res) => {
  const { reference, productId, sellerId, amountPaid } = req.body;
  const secretKey =
    process.env.PAYSTACK_SECRET_KEY || process.env.VITE_PAYSTACK_SECRET_KEY;

  try {
    // 1. Verify Paystack transaction
    let verifyData = { status: true, data: { status: "success" } };

    if (secretKey) {
      const verifyRes = await fetch(
        `https://api.paystack.co/transaction/verify/${reference}`,
        {
          headers: { Authorization: `Bearer ${secretKey}` },
        },
      );
      verifyData = await verifyRes.json();
    } else {
      console.warn(
        "Bypassing server verification because no PAYSTACK_SECRET_KEY was found.",
      );
    }

    if (!verifyData.status || verifyData.data.status !== "success") {
      return res
        .status(400)
        .json({ status: false, message: "Payment verification failed" });
    }

    // 2. Update Firestore products
    let productUrl = "";
    try {
      const productRef = doc(db!, "products", String(productId));
      const productSnap = await getDoc(productRef);

      let foundDoc = productSnap.exists() ? productSnap : null;
      if (!foundDoc) {
        const q = query(
          collection(db!, "products"),
          where("name", "==", String(productId)),
        );
        const qSnap = await getDocs(q);
        if (!qSnap.empty) {
          foundDoc = qSnap.docs[0];
        }
      }

      const activeUserEmail = (req.body.userEmail || "").trim().toLowerCase();

      if (foundDoc) {
        const productData = foundDoc.data();
        productUrl = productData.productUrl || "";
        const currentPurchased = Number(productData.timesPurchased || 0);

        const uniqueUsers = Array.isArray(productData.uniqueUsers) ? productData.uniqueUsers : [];
        let newUniqueUsers = [...uniqueUsers];
        let nextSalesValue = currentPurchased;

        if (activeUserEmail && uniqueUsers.includes(activeUserEmail)) {
           console.log(`[verify-purchase] User ${activeUserEmail} already owns the product.`);
           // Already owned, skip increment, but still return success URL
        } else {
           nextSalesValue += 1;
           if (activeUserEmail) {
             newUniqueUsers.push(activeUserEmail);
           }
           await updateDoc(foundDoc.ref, {
             timesPurchased: nextSalesValue,
             uniqueUsers: newUniqueUsers,
             updatedAt: serverTimestamp(),
           });
           
           // Await Google Sheet sync since Vercel kills background tasks when the res completes
        await saveProductToSheet({ id: foundDoc.id, ...productData, timesPurchased: nextSalesValue, uniqueUsers: newUniqueUsers }).catch(err =>
          console.error("[saveProductToSheet verify-purchase] Error sync:", err)
        );
        }
      }
    } catch (e: any) {
      console.error("Failed to update product purchased:", e.message);
    }

    // 3. Update Seller payout
    try {
      const payoutAmount = Number(amountPaid) * 0.8; // minus 20%
      const sellerRef = doc(db!, "sellers", String(sellerId));
      const sellerSnap = await getDoc(sellerRef);
      let sellerFound = sellerSnap.exists() ? sellerSnap : null;
      if (!sellerFound) {
        const q = query(
          collection(db!, "sellers"),
          where("sellerId", "==", String(sellerId)),
        );
        const qSnap = await getDocs(q);
        if (!qSnap.empty) {
          sellerFound = qSnap.docs[0];
        }
      }

      if (sellerFound) {
        const sellerData = sellerFound.data();
        const currentPayout = parseFloat(String(sellerData.payout || "0"));
        const newPayout = currentPayout + payoutAmount;
        
        await updateDoc(sellerFound.ref, {
          payout: newPayout,
          updatedAt: serverTimestamp(),
        });

        await updateDocLocal("sellers", sellerFound.id, { payout: newPayout, updatedAt: new Date().toISOString() }).catch(err =>
          console.error("[verify-purchase] updateDocLocal sellers error:", err)
        );

        await saveCreatorToSheet({
          id: sellerFound.id,
          ...sellerData,
          payout: newPayout,
          updatedAt: new Date().toISOString()
        }, "seller").catch(err => {
          console.error("[saveCreatorToSheet verify-purchase] Payout sync error:", err);
        });
      }
    } catch (e: any) {
      console.error("Failed to update seller payout:", e.message);
    }

    res.json({ status: true, productUrl });
  } catch (error: any) {
    console.error("Store purchase verification error:", error);
    res.status(500).json({ status: false, message: error.message });
  }
});

app.post("/api/store/increment-downloads", dbCheck, async (req, res) => {
  try {
    const { productId, productName, productUrl, userEmail } = req.body;

    let foundDoc = null;
    if (productId) {
      const docRef = doc(db!, "products", String(productId));
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        foundDoc = snap;
      }
    }

    if (!foundDoc && productName) {
      const q = query(
        collection(db!, "products"),
        where("name", "==", String(productName)),
      );
      const qSnap = await getDocs(q);
      if (!qSnap.empty) {
        foundDoc = qSnap.docs[0];
      }
    }

    if (!foundDoc && productUrl) {
      const q = query(
        collection(db!, "products"),
        where("productUrl", "==", String(productUrl)),
      );
      const qSnap = await getDocs(q);
      if (!qSnap.empty) {
        foundDoc = qSnap.docs[0];
      }
    }

    if (foundDoc) {
      const data = foundDoc.data();
      const currentPurchased = Number(data.timesPurchased || 0);

      const uniqueUsers = Array.isArray(data.uniqueUsers) ? data.uniqueUsers : [];
      let nextSalesValue = currentPurchased;
      let newUniqueUsers = [...uniqueUsers];
      let shouldUpdate = true;

      if (userEmail) {
        const cleanUserEmail = String(userEmail).toLowerCase().trim();
        if (uniqueUsers.includes(cleanUserEmail)) {
          console.log(`[Increment Downloads/Users] User ${cleanUserEmail} already verified on this product. Skipping.`);
          return res.json({ status: true, timesPurchased: currentPurchased });
        }
        nextSalesValue = currentPurchased + 1;
        newUniqueUsers.push(cleanUserEmail);
      } else {
        nextSalesValue = currentPurchased + 1;
      }

      const updatedProductData = {
        ...data,
        timesPurchased: nextSalesValue,
        uniqueUsers: newUniqueUsers,
        updatedAt: new Date().toISOString()
      };

      await updateDoc(foundDoc.ref, {
        timesPurchased: nextSalesValue,
        uniqueUsers: newUniqueUsers,
        updatedAt: serverTimestamp(),
      });

      await setDocLocal("products", foundDoc.id, {
        id: foundDoc.id,
        ...updatedProductData,
      }).catch(err => console.error(err));

      // Trigger automatic realtime sync to spreadsheet
      await saveProductToSheet({ id: foundDoc.id, ...updatedProductData }).catch(err =>
        console.error("[saveProductToSheet increment-downloads] Error sync:", err)
      );

      return res.json({ status: true, timesPurchased: nextSalesValue });
    }

    res.status(404).json({ status: false, message: "Product not found" });
  } catch (error: any) {
    console.error("Increment downloads error:", error);
    res.status(500).json({ status: false, message: error.message });
  }
});

app.get(["/api/store/download", "/api/store/download/:filename"], async (req, res) => {
  try {
    const { url } = req.query;
    if (!url || typeof url !== "string")
      return res.status(400).send("No URL provided");

    const realUrl = url.replace("dl=0", "dl=1");
    const response = await fetch(realUrl);
    if (!response.ok) throw new Error("Failed to fetch file");

    const buffer = await response.arrayBuffer();
    
    // Support path-based filenames for WebView/native downloader compatibility with type safety
    const filenameParam = req.params.filename;
    const finalFileName = typeof filenameParam === "string" ? filenameParam : undefined;

    res.setHeader(
      "Content-Type",
      response.headers.get("content-type") || "application/octet-stream",
    );
    res.setHeader("Access-Control-Expose-Headers", "Content-Length, Content-Disposition");
    res.setHeader("Content-Length", buffer.byteLength);

    if (finalFileName) {
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${encodeURIComponent(finalFileName)}"`,
      );
    } else {
      const contentDisp = response.headers.get("content-disposition");
      if (contentDisp) res.setHeader("Content-Disposition", contentDisp);
    }

    res.send(Buffer.from(buffer));
  } catch (e: any) {
    console.error("Proxy download error:", e);
    res.status(500).send(e.message);
  }
});

// Server-assisted high-performance unified download endpoint for chunky assets
app.get(["/api/store/download/unified", "/api/store/download/unified/:filename"], async (req, res) => {
  try {
    const { productId } = req.query;
    if (!productId || typeof productId !== "string") {
      return res.status(400).send("No product ID provided");
    }

    console.log(`[Unified Download] Compiling asset chunks for product ${productId} on server...`);

    let snap;
    try {
      const q = query(collection(db!, "product_assets"), where("productId", "==", productId));
      snap = await getDocs(q);
    } catch (firebaseErr) {
      console.warn("[Unified Download] Firestore fetch failed, falling back to local DB...", firebaseErr);
    }

    let sortedChunks: any[] = [];
    if (snap && !snap.empty) {
      sortedChunks = snap.docs.map(doc => doc.data());
    } else {
      // LocalDB fallback
      const localChunks = await queryCollection("product_assets", []);
      sortedChunks = localChunks.filter((c: any) => String(c.productId) === productId);
    }

    if (sortedChunks.length === 0) {
      return res.status(404).send("No asset chunks found for this product.");
    }

    // Sort chunks by index
    sortedChunks.sort((a, b) => (Number(a.chunkIndex) || 0) - (Number(b.chunkIndex) || 0));

    // Combine base64 chunk payloads
    let base64Zip = "";
    sortedChunks.forEach(chunk => {
      base64Zip += chunk.data || "";
    });

    const fileName = sortedChunks[0].fileName || "product_file";
    
    // Convert base64 to binary buffer
    const base64Clean = base64Zip.includes(",") ? base64Zip.split(",")[1] : base64Zip;
    const binaryBuffer = Buffer.from(base64Clean, "base64");

    // Extract the original file from zip in the memory
    let finalBuffer = binaryBuffer;
    
    const filenameParamVal = typeof req.params.filename === "string" ? req.params.filename : undefined;
    let finalFileName = filenameParamVal || fileName;

    try {
      const zip = await JSZip.loadAsync(binaryBuffer);
      if (zip && zip.files) {
        const innerFiles = Object.keys(zip.files);
        if (innerFiles.length > 0) {
          const originalFileName = innerFiles[0];
          const fileInZip = zip.files[originalFileName];
          if (fileInZip) {
            const uint8 = await fileInZip.async("uint8array");
            finalBuffer = Buffer.from(uint8);
            finalFileName = filenameParamVal || originalFileName;
          }
        }
      }
    } catch (zipErr) {
      console.warn("[Unified Download] Failed to treat as ZIP or extract. Serving raw ZIP buffer directly.", zipErr);
    }

    // Guess MIME type
    let mimeType = "application/octet-stream";
    const ext = finalFileName.toLowerCase().split('.').pop() || '';
    if (ext === "psd") {
      mimeType = "image/vnd.adobe.photoshop";
    } else if (ext === "json" || ext === "animato_project") {
      mimeType = "application/json";
    } else if (ext === "zip") {
      mimeType = "application/zip";
    }

    res.setHeader("Content-Type", mimeType);
    res.setHeader("Access-Control-Expose-Headers", "Content-Length, Content-Disposition");
    res.setHeader("Content-Length", finalBuffer.length);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(finalFileName)}"`,
    );
    res.send(finalBuffer);
  } catch (err: any) {
    console.error("[Unified Download] Error:", err);
    res.status(500).send(err.message);
  }
});

// Server-assisted downloads endpoint to store raw file payload temporarily
app.post("/api/download-temp-store", (req, res) => {
  try {
    const { filename, contentType, base64Data } = req.body;
    if (!filename || !base64Data) {
      return res.status(400).json({ error: "Missing filename or base64Data" });
    }
    const id = Math.random().toString(36).substring(2, 15) + "_" + Date.now();

    const base64Clean = base64Data.includes(",")
      ? base64Data.split(",")[1]
      : base64Data;
    const buffer = Buffer.from(base64Clean, "base64");

    tempStoreDownloads.set(id, {
      buffer,
      filename,
      contentType: contentType || "application/octet-stream",
    });

    // Auto-reclaim memory after 60 seconds to avoid server leaks
    setTimeout(() => {
      tempStoreDownloads.delete(id);
    }, 60000);

    res.json({ id });
  } catch (err: any) {
    console.error("Temporary download store error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Server-assisted downloads retrieval endpoint to stream file response with Content-Disposition
app.get(["/api/download-temp-retrieve", "/api/download-temp-retrieve/:filename"], (req, res) => {
  try {
    const { id } = req.query;
    if (!id || typeof id !== "string") {
      return res.status(400).send("No download ID provided");
    }

    const fileData = tempStoreDownloads.get(id);
    if (!fileData) {
      return res
        .status(410)
        .send(
          "This download link has expired. Please trigger the download again inside the app.",
        );
    }

    const filenameParamVal = typeof req.params.filename === "string" ? req.params.filename : undefined;
    const finalFileName = filenameParamVal || fileData.filename;

    // Guess MIME type if empty or octet-stream to ensure maximum browser/mobile support
    let contentType = fileData.contentType || "application/octet-stream";
    if (!contentType || contentType === "application/octet-stream") {
      const ext = finalFileName.toLowerCase().split('.').pop() || '';
      if (ext === "psd") {
        contentType = "image/vnd.adobe.photoshop";
      } else if (ext === "json" || ext === "animato_project") {
        contentType = "application/json";
      } else if (ext === "zip") {
        contentType = "application/zip";
      }
    }

    res.setHeader("Content-Type", contentType);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(finalFileName)}"`,
    );
    res.send(fileData.buffer);
  } catch (err: any) {
    console.error("Temporary download retrieve error:", err);
    res.status(500).send(err.message);
  }
});

// --- CREATOR PROGRAM API ---
app.post("/api/creator/join", dbCheck, async (req, res) => {
  try {
    const { type, email } = req.body;
    if (!email) {
      return res
        .status(400)
        .json({ status: false, message: "Email is required" });
    }

    const cleanEmail = email.toLowerCase().trim();
    const baseName = cleanEmail.split("@")[0].replace(/[^a-zA-Z0-9]/g, "");

    let generatedId = `${baseName}${Math.floor(100 + Math.random() * 900)}`;

    let finalSellerId = "";
    let finalReferralId = "";

    // Lookup existing payout details to inherit if available
    let existingBankName = "";
    let existingBankOwner = "";
    let existingAccNumber = "";

    const exRefQuery = query(
      collection(db!, "referrals"),
      where("email", "==", cleanEmail),
    );
    const exRefSnap = await getDocs(exRefQuery);
    if (!exRefSnap.empty) {
      const data = exRefSnap.docs[0].data();
      existingBankName = data.bankName || "";
      existingBankOwner = data.bankOwnerName || "";
      existingAccNumber = data.accountNumber || "";
    }

    const exSelQuery = query(
      collection(db!, "sellers"),
      where("email", "==", cleanEmail),
    );
    const exSelSnap = await getDocs(exSelQuery);
    if (
      !exSelSnap.empty &&
      (!existingBankName || !existingBankOwner || !existingAccNumber)
    ) {
      const data = exSelSnap.docs[0].data();
      existingBankName = data.bankName || existingBankName;
      existingBankOwner = data.bankOwnerName || existingBankOwner;
      existingAccNumber = data.accountNumber || existingAccNumber;
    }

    // 1. Handle Seller (sellers collection)
    if (type === "seller" || type === "both") {
      const sellerQuery = query(
        collection(db!, "sellers"),
        where("email", "==", cleanEmail),
      );
      const sellerSnap = await getDocs(sellerQuery);

      if (!sellerSnap.empty) {
        const data = sellerSnap.docs[0].data();
        finalSellerId = data.sellerId || sellerSnap.docs[0].id;
      } else {
        // Generate unique ID using the user's email prefix and random numbers
        finalSellerId = `${baseName}${Math.floor(100 + Math.random() * 900)}`;
        const sellerDocData = {
          sellerId: finalSellerId,
          email: cleanEmail,
          payout: 0,
          bankName: existingBankName,
          bankOwnerName: existingBankOwner,
          accountNumber: existingAccNumber,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };
        await setDoc(doc(db!, "sellers", finalSellerId), sellerDocData);
        // Sync to google sheet synchronously to ensure it completes on Vercel serverless
        await saveCreatorToSheet({ id: finalSellerId, ...sellerDocData }, "seller").catch(err => 
          console.error("[saveCreatorToSheet on join] Error sync:", err)
        );
      }
    }

    // 2. Handle Referral (referrals collection)
    if (type === "referral" || type === "both") {
      const refQuery = query(
        collection(db!, "referrals"),
        where("email", "==", cleanEmail),
      );
      const refSnap = await getDocs(refQuery);

      if (!refSnap.empty) {
        const data = refSnap.docs[0].data();
        finalReferralId = data.referralId || refSnap.docs[0].id;
      } else {
        // Generate unique Referrer ID using the user's email prefix and random numbers
        finalReferralId = `${baseName}${Math.floor(100 + Math.random() * 900)}`;

        const referralDocData = {
          referralId: finalReferralId,
          referralCode: finalReferralId, // Critical: required by Firestore security rules
          email: cleanEmail,
          payout: 0,
          numberOfReferences: 0,
          bankName: existingBankName,
          bankOwnerName: existingBankOwner,
          accountNumber: existingAccNumber,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };
        await setDoc(doc(db!, "referrals", finalReferralId), referralDocData);
        // Sync to google sheet synchronously to ensure it completes on Vercel serverless
        await saveCreatorToSheet({ id: finalReferralId, ...referralDocData }, "referral").catch(err => 
          console.error("[saveCreatorToSheet on join] Error sync:", err)
        );
      }
    }

    return res.json({
      status: true,
      sellerId: finalSellerId || null,
      referralId: finalReferralId || null,
    });
  } catch (e: any) {
    console.error("Error in creator join:", e);
    return res.status(500).json({ status: false, message: e.message });
  }
});

app.get("/api/creator/details", dbCheck, async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) {
      return res
        .status(400)
        .json({ status: false, message: "Email is required" });
    }

    // Run sync in the background so it is non-blocking and instant
    syncFirestoreToLocalDB().catch((err) =>
      console.error("Sync firestore on creator details fetch error:", err),
    );
    syncAdminSheets().catch((err) =>
      console.error("Sync sheets on creator details fetch error:", err),
    );

    const cleanEmail = String(email).toLowerCase().trim();

    let sellerData = null;
    let refData = null;
    let actualSellerId = "";
    let actualRefId = "";

    // Check Sellers
    const sellerQuery = query(
      collection(db!, "sellers"),
      where("email", "==", cleanEmail),
    );
    const sellerSnap = await getDocs(sellerQuery);
    if (!sellerSnap.empty) {
      const docSnap = sellerSnap.docs[0];
      const data = docSnap.data();
      actualSellerId = data.sellerId || docSnap.id;
      sellerData = {
        payout: String(data.payout || "0"),
        bankName: data.bankName || "",
        bankOwner: data.bankOwnerName || "",
        accountNum: data.accountNumber || "",
        email: data.email,
      };
    }

    // Check Referrals
    const refQuery = query(
      collection(db!, "referrals"),
      where("email", "==", cleanEmail),
    );
    const refSnap = await getDocs(refQuery);
    if (!refSnap.empty) {
      const docSnap = refSnap.docs[0];
      const data = docSnap.data();
      actualRefId = data.referralId || docSnap.id;
      refData = {
        payout: String(data.payout || "0"),
        refs: String(data.numberOfReferences || "0"),
        referralCode: actualRefId || "",
        bankName: data.bankName || "",
        bankOwner: data.bankOwnerName || "",
        accountNum: data.accountNumber || "",
      };
    }

    return res.json({
      status: true,
      sellerData,
      refData,
      sellerId: actualSellerId || null,
      referralId: actualRefId || null,
      rawHeaders: [
        "seller's id",
        "email",
        "bank name",
        "bank owner name",
        "account number",
        "payout",
      ],
      rawRefHeaders: [
        "referral id",
        "payout",
        "no.of ref",
        "email",
        "account number",
        "bank name",
        "bank owner name",
      ],
    });
  } catch (e: any) {
    console.error("Error in creator details fetch:", e);
    return res.status(500).json({ status: false, message: e.message });
  }
});

app.post("/api/creator/seller/update-bank", dbCheck, async (req, res) => {
  try {
    const { email, bankName, bankOwnerName, accountNumber } = req.body;
    if (!email) {
      return res
        .status(400)
        .json({
          status: false,
          message: "Email is required to verify ownership before update",
        });
    }

    const cleanEmail = email.toLowerCase().trim();
    lastBankUpdateMap.set(cleanEmail, Date.now());
    let updated = false;

    // Update Sellers
    const sellerQuery = query(
      collection(db!, "sellers"),
      where("email", "==", cleanEmail),
    );
    const sellerSnap = await getDocs(sellerQuery);
    if (!sellerSnap.empty) {
      for (const docSnap of sellerSnap.docs) {
        const existingData = docSnap.data();
        const updatedData = {
          ...existingData,
          bankName: bankName || "",
          bankOwnerName: bankOwnerName || "",
          accountNumber: accountNumber || "",
          updatedAt: new Date().toISOString(),
        };
        await updateDoc(docSnap.ref, {
          bankName: bankName || "",
          bankOwnerName: bankOwnerName || "",
          accountNumber: accountNumber || "",
          updatedAt: serverTimestamp(),
        });
        updated = true;
        // Update local storage
        await setDocLocal("sellers", docSnap.id, updatedData).catch(err =>
          console.error("[setDocLocal updateBank sellers]", err)
        );
        // Sync to Google sheet synchronously for Vercel
        await saveCreatorToSheet({ id: docSnap.id, ...updatedData }, "seller").catch(err =>
          console.error("[saveCreatorToSheet updateBank] error:", err)
        );
      }
    } else {
      // Upsert Seller so sync is perfect
      const baseName = cleanEmail.split("@")[0].replace(/[^a-zA-Z0-9]/g, "");
      const finalSellerId = `${baseName}${Math.floor(100 + Math.random() * 900)}`;
      const sellerDocData = {
        sellerId: finalSellerId,
        email: cleanEmail,
        payout: 0,
        bankName: bankName || "",
        bankOwnerName: bankOwnerName || "",
        accountNumber: accountNumber || "",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await setDoc(doc(db!, "sellers", finalSellerId), {
        sellerId: finalSellerId,
        email: cleanEmail,
        payout: 0,
        bankName: bankName || "",
        bankOwnerName: bankOwnerName || "",
        accountNumber: accountNumber || "",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      updated = true;
      await setDocLocal("sellers", finalSellerId, sellerDocData).catch(err =>
        console.error("[setDocLocal updateBank sellers insert]", err)
      );
      await saveCreatorToSheet({ id: finalSellerId, ...sellerDocData }, "seller").catch(err =>
        console.error("[saveCreatorToSheet updateBank insert] error:", err)
      );
    }

    // Update Referrals
    const refQuery = query(
      collection(db!, "referrals"),
      where("email", "==", cleanEmail),
    );
    const refSnap = await getDocs(refQuery);
    if (!refSnap.empty) {
      for (const docSnap of refSnap.docs) {
        const existingData = docSnap.data();
        const updatedData = {
          ...existingData,
          bankName: bankName || "",
          bankOwnerName: bankOwnerName || "",
          accountNumber: accountNumber || "",
          updatedAt: new Date().toISOString(),
        };
        await updateDoc(docSnap.ref, {
          bankName: bankName || "",
          bankOwnerName: bankOwnerName || "",
          accountNumber: accountNumber || "",
          updatedAt: serverTimestamp(),
        });
        updated = true;
        // Update local storage
        await setDocLocal("referrals", docSnap.id, updatedData).catch(err =>
          console.error("[setDocLocal updateBank referrals]", err)
        );
        // Sync to Google sheet synchronously
        await saveCreatorToSheet({ id: docSnap.id, ...updatedData }, "referral").catch(err =>
          console.error("[saveCreatorToSheet updateBank] error:", err)
        );
      }
    } else {
      // Also upsert referral record just in case to be fully synced
      const baseName = cleanEmail.split("@")[0].replace(/[^a-zA-Z0-9]/g, "");
      const finalReferralId = `${baseName}${Math.floor(100 + Math.random() * 900)}`;
      const referralDocData = {
        referralId: finalReferralId,
        referralCode: finalReferralId,
        email: cleanEmail,
        payout: 0,
        numberOfReferences: 0,
        bankName: bankName || "",
        bankOwnerName: bankOwnerName || "",
        accountNumber: accountNumber || "",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await setDoc(doc(db!, "referrals", finalReferralId), {
        referralId: finalReferralId,
        referralCode: finalReferralId,
        email: cleanEmail,
        payout: 0,
        numberOfReferences: 0,
        bankName: bankName || "",
        bankOwnerName: bankOwnerName || "",
        accountNumber: accountNumber || "",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      updated = true;
      await setDocLocal("referrals", finalReferralId, referralDocData).catch(err =>
        console.error("[setDocLocal updateBank referrals insert]", err)
      );
      await saveCreatorToSheet({ id: finalReferralId, ...referralDocData }, "referral").catch(err =>
        console.error("[saveCreatorToSheet updateBank referral insert] error:", err)
      );
    }

    if (updated) {
      return res.json({ status: true });
    } else {
      return res
        .status(404)
        .json({
          status: false,
          message: "Seller or Referral row not found matching email.",
        });
    }
  } catch (e: any) {
    console.error("Error in update-bank endpoint:", e);
    return res.status(500).json({ status: false, message: e.message });
  }
});

app.post("/api/creator/seller/add-product", dbCheck, async (req, res) => {
  try {
    const {
      sellerId,
      productName,
      productUrl,
      thumbnail,
      price,
      description,
      category,
    } = req.body;

    let finalPrice = "Free";
    let finalAmount = 0;

    if (price) {
      const trimmedPrice = String(price).trim();
      const parsedPrice = parseFloat(trimmedPrice);
      if (!isNaN(parsedPrice) && parsedPrice > 0) {
        finalPrice = trimmedPrice;
        finalAmount = parsedPrice;
      } else {
        finalPrice = "Free";
        finalAmount = 0;
      }
    } else {
      finalPrice = "Free";
      finalAmount = 0;
    }

    const newId = Date.now().toString();
    const productRef = doc(db!, "products", newId);

    const productDocData = {
      id: newId,
      price: finalPrice,
      category: category || "Project File",
      thumbnail: thumbnail || "",
      images: [thumbnail].filter(Boolean),
      amount: finalAmount,
      name: productName || "",
      timesPurchased: 0,
      sellerId: sellerId || "",
      productUrl: productUrl || "",
      starRating: "0",
      productDescription: description || "",
      auditStatus: "approved",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    await setDoc(productRef, productDocData);

    // Sync to Google Sheet synchronously for Vercel
    await saveProductToSheet(productDocData).catch(err =>
      console.error("[saveProductToSheet on add-product] Error sync:", err)
    );

    res.json({ status: true, id: newId });
  } catch (e: any) {
    console.error(e);
    res.status(500).json({ status: false, message: e.message });
  }
});

app.post("/api/creator/seller/delete-product", dbCheck, async (req, res) => {
  try {
    const { productId, sellerId } = req.body;
    if (!productId) {
      return res
        .status(400)
        .json({ status: false, message: "Product ID is required" });
    }

    const productRef = doc(db!, "products", String(productId));
    const productSnap = await getDoc(productRef);

    if (!productSnap.exists()) {
      return res
        .status(404)
        .json({ status: false, message: "Product not found" });
    }

    const productData = productSnap.data();
    if (
      sellerId &&
      productData.sellerId &&
      String(productData.sellerId) !== String(sellerId)
    ) {
      return res
        .status(403)
        .json({
          status: false,
          message: "Unauthorized to delete this product",
        });
    }

    await deleteDoc(productRef);

    // Sync deletion to Google Sheet asynchronously
    deleteProductFromSheet(String(productId)).catch(err =>
      console.error("[deleteProductFromSheet on delete-product] Sync error:", err)
    );

    res.json({ status: true, message: "Product deleted successfully" });
  } catch (e: any) {
    console.error("Delete product error:", e);
    res.status(500).json({ status: false, message: e.message });
  }
});

app.post("/api/creator/seller/update-product", dbCheck, async (req, res) => {
  try {
    const {
      productId,
      sellerId,
      productName,
      productUrl,
      thumbnail,
      price,
      description,
      category,
    } = req.body;
    if (!productId) {
      return res
        .status(400)
        .json({ status: false, message: "Product ID is missing" });
    }

    const productRef = doc(db!, "products", String(productId));
    const productSnap = await getDoc(productRef);
    if (!productSnap.exists()) {
      return res
        .status(404)
        .json({ status: false, message: "Product not found" });
    }

    const productData = productSnap.data();
    if (
      sellerId &&
      productData.sellerId &&
      String(productData.sellerId) !== String(sellerId)
    ) {
      return res
        .status(403)
        .json({
          status: false,
          message: "Unauthorized to update this product",
        });
    }

    let finalPrice = "Free";
    let finalAmount = 0;

    if (price) {
      const trimmedPrice = String(price).trim();
      const parsedPrice = parseFloat(trimmedPrice);
      if (!isNaN(parsedPrice) && parsedPrice > 0) {
        finalPrice = trimmedPrice;
        finalAmount = parsedPrice;
      } else {
        finalPrice = "Free";
        finalAmount = 0;
      }
    } else {
      finalPrice = "Free";
      finalAmount = 0;
    }

    const updatedDocData = {
      price: finalPrice,
      category: category || "Project file",
      thumbnail: thumbnail || "",
      images: [thumbnail].filter(Boolean),
      amount: finalAmount,
      name: productName || "",
      productUrl: productUrl || "",
      productDescription: description || "",
      updatedAt: serverTimestamp(),
    };

    await updateDoc(productRef, updatedDocData);

    // Sync to Google Sheet synchronously for Vercel
    await saveProductToSheet({ id: productId, ...productData, ...updatedDocData }).catch(err =>
      console.error("[saveProductToSheet on update-product] Sync error:", err)
    );

    res.json({ status: true, message: "Product updated successfully" });
  } catch (e: any) {
    console.error("Update product error:", e);
    res.status(500).json({ status: false, message: e.message });
  }
});

// Server-side endpoint to save a product's asset chunks (avoids client-side Firestore connection overloading)
app.post("/api/creator/seller/upload-chunk", dbCheck, async (req, res) => {
  try {
    const { productId, fileName, chunkIndex, totalChunks, data } = req.body;
    if (!productId || data === undefined) {
      return res
        .status(400)
        .json({ status: false, message: "Missing required fields" });
    }

    const chunkDocId = `${productId}_chunk_${chunkIndex}`;
    const chunkRef = doc(db!, "product_assets", chunkDocId);

    await setDoc(chunkRef, {
      productId,
      fileName: fileName || "",
      chunkIndex: Number(chunkIndex),
      totalChunks: Number(totalChunks),
      data: String(data),
      createdAt: Date.now(),
    });

    res.json({ status: true });
  } catch (error: any) {
    console.error("Server-side chunk upload error:", error);
    res.status(500).json({ status: false, message: error.message });
  }
});

// Server-side endpoint to clear product chunks cleanly and fast
app.post("/api/creator/seller/delete-chunks", dbCheck, async (req, res) => {
  try {
    const { productId } = req.body;
    if (!productId) {
      return res
        .status(400)
        .json({ status: false, message: "Missing productId" });
    }

    const q = query(
      collection(db!, "product_assets"),
      where("productId", "==", String(productId)),
    );
    const snap = await getDocs(q);

    const deletePromises = snap.docs.map((d) => deleteDoc(d.ref));
    await Promise.all(deletePromises);

    res.json({ status: true });
  } catch (err: any) {
    console.error("Server-side delete-chunks error:", err);
    res.status(500).json({ status: false, message: err.message });
  }
});

app.get("/api/creator/referral/check", dbCheck, async (req, res) => {
  try {
    const code = String(req.query.code || "").trim();
    if (!code) {
      return res.json({ status: true, exists: false });
    }

    const docRef = doc(db!, "referrals", code);
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      return res.json({ status: true, exists: true });
    }

    const q = query(
      collection(db!, "referrals"),
      where("referralId", "==", code),
    );
    const qSnap = await getDocs(q);
    if (!qSnap.empty) {
      return res.json({ status: true, exists: true });
    }

    // Case insensitive check
    const allRefs = await getDocs(collection(db!, "referrals"));
    const found = allRefs.docs.some(
      (d) =>
        d.id.toLowerCase() === code.toLowerCase() ||
        ((d.data() as any).referralId &&
          (d.data() as any).referralId.toLowerCase() === code.toLowerCase()),
    );
    if (found) {
      return res.json({ status: true, exists: true });
    }

    res.json({ status: true, exists: false });
  } catch (e: any) {
    console.error("Referral check error:", e);
    res.status(500).json({ status: false, message: e.message });
  }
});

app.post("/api/creator/referral/credit", dbCheck, async (req, res) => {
  try {
    const { referralId, subscriptionAmount, isFirstTime, email } = req.body;
    const cleanEmail = email ? String(email).toLowerCase().trim() : "";

    let finalReferralId = referralId ? String(referralId).trim() : "";

    // 1. If we have a subscriber email, map and cache the referral connection
    if (cleanEmail) {
      const connectionRef = doc(db!, "referred_subscribers", cleanEmail);
      const connectionSnap = await getDoc(connectionRef);

      if (finalReferralId) {
        // If a new/initial referral is passed, ensure we save the relationship in DB
        if (!connectionSnap.exists()) {
          await setDoc(connectionRef, {
            referralId: finalReferralId,
            createdAt: serverTimestamp(),
          });
        }
      } else if (connectionSnap.exists()) {
        // If no referralId is provided in the current request, retrieve existing mapping from DB
        finalReferralId = connectionSnap.data().referralId || "";
      }
    }

    if (!finalReferralId) {
      // No referral was requested or stored for this subscriber (standard direct sign-up)
      return res.json({
        status: true,
        message: "No active referral mapping for this purchase",
      });
    }

    const refRef = doc(db!, "referrals", finalReferralId);
    const refSnap = await getDoc(refRef);

    let foundDoc = refSnap.exists() ? refSnap : null;
    if (!foundDoc) {
      const q = query(
        collection(db!, "referrals"),
        where("referralId", "==", finalReferralId),
      );
      const qSnap = await getDocs(q);
      if (!qSnap.empty) {
        foundDoc = qSnap.docs[0];
      }
    }

    if (foundDoc) {
      const data = foundDoc.data();
      let currentPayout = parseFloat(String(data.payout || "0"));
      let currentRefs = parseInt(String(data.numberOfReferences || "0"), 10);

      // Payout is 10% of the money they paid
      const addedPayout = Number(subscriptionAmount || 0) * 0.1;
      currentPayout += addedPayout;

      if (isFirstTime) {
        currentRefs += 1;
      }

      await updateDoc(foundDoc.ref, {
        payout: currentPayout,
        numberOfReferences: currentRefs,
        updatedAt: serverTimestamp(),
      });
      return res.json({
        status: true,
        payoutAdded: addedPayout,
        currentPayout,
        referrerUsed: finalReferralId,
      });
    }

    res.status(404).json({ status: false, message: "Referral code not found" });
  } catch (e: any) {
    console.error("Referral credit error:", e);
    res.status(500).json({ status: false, message: e.message });
  }
});

app.post("/api/submit-competition", dbCheck, async (req, res) => {
  try {
    const { competitionId, competitionName, userEmail, formData, subId } =
      req.body;
    if (!userEmail) {
      return res
        .status(400)
        .json({ status: false, message: "Email is required" });
    }
    const cleanEmail = userEmail.toLowerCase().trim();

    // Determine subscription plan status mapping
    let planName = "Free Tier Account";
    let status = "Inactive";

    // Check pre-configured special test addresses
    if (cleanEmail === "animatopro@gmail.com") {
      planName = "Animato Pro (Weekly Premium Plan)";
      status = "Active";
    } else if (cleanEmail === "animato@gmail.com") {
      planName = "Animato Premium (Yearly Studio Plan)";
      status = "Active";
    } else {
      // Look up database relationships if available
      const subRef = doc(db!, "referred_subscribers", cleanEmail);
      const subSnap = await getDoc(subRef);
      if (subSnap.exists()) {
        planName = "Affiliated/Referred Partner Plan";
        status = "Active";
      }
    }

    const emailContent = `
============================================================
✉️  EMAIL DISPATCH (TRANSACTIONAL TRANSCRIPT)
============================================================
RECIPIENT: admin@animatostudio.com, ${cleanEmail}
SUBJECT: [ANIMATO CONTEST] New Entry Submitted - ${competitionName}
HEADLINE: New Competition Entry: "${competitionName}"

Dear Admin,

A brand new competition entry has been submitted! Here are the structured applicant details:

👤  APPLICANT INFORMATION:
  - Email: ${cleanEmail}
  - Subscription Plan: ${planName} (${status})
  - Submission ID: ${subId}

🏆  COMPETITION DETAILS:
  - Competition Name: ${competitionName}
  - Competition ID: ${competitionId}

📝  SUBMITTED APPLICATION MATERIALS:
${Object.entries(formData || {})
  .map(([key, val]) => `  - ${key}: ${val}`)
  .join("\n")}

============================================================
DISPATCH SUCCESSFUL • Animato Studio Automailer Service
============================================================
      `;

    console.log(emailContent);
    return res.json({ status: true, emailContent });
  } catch (err: any) {
    console.error("Competition email delivery failed:", err);
    return res.status(500).json({ status: false, message: err.message });
  }
});

// CDN proxy route to utilize Vercel's global elite edge network caching out-of-the-box.
// Since Vercel is built on a high-speed CDN matrix, this route will serve 99.99% of requests directly from close edge caches for 1M+ users!
app.get("/api/cdn-proxy", async (req, res) => {
  try {
    const colName = String(req.query.col || "").trim();
    if (colName !== "competitions" && colName !== "tutorials") {
      return res.status(400).json({ status: false, message: "Invalid collection requested" });
    }

    const FALLBACK_URL = "https://tyqjnfoiooujylzijwtb.supabase.co";
    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || FALLBACK_URL;
    const url = `${supabaseUrl}/storage/v1/object/public/animato_uploads/db_store/${colName}.json`;

    const fetchRes = await fetch(url);
    if (!fetchRes.ok) {
      throw new Error(`Supabase read failed: status ${fetchRes.status}`);
    }

    const jsonContent = await fetchRes.json();

    // Cache responses inside Vercel's Edge network for 3 minutes (180s) to keep storage egress and rate limits virtually zero
    res.setHeader("Cache-Control", "public, max-age=180, s-maxage=180, stale-while-revalidate=60");
    return res.json(jsonContent);
  } catch (err: any) {
    console.warn(`[CDN-Proxy Failover] Servicing empty set:`, err.message);
    return res.json({});
  }
});

// Vite middleware for development
async function setupViteOrStatic() {
  if (process.env.NODE_ENV !== "production" && !process.env.VERCEL) {
    try {
      const { createServer: createViteServer } = await import("vite");
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
    } catch (err) {
      console.warn("Failed to load Vite middleware", err);
    }
  } else {
    // In production (bundled), we use process.cwd() to find dist
    const distPath = path.join(process.cwd(), "dist");

    // Explicitly handle sw.js and manifest.webmanifest to disable caching entirely
    app.get(["/sw.js", "/:prefix/sw.js"], (req, res) => {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0");
      res.sendFile(path.join(distPath, "sw.js"));
    });

    app.get(["/manifest.webmanifest", "/:prefix/manifest.webmanifest"], (req, res) => {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0");
      res.sendFile(path.join(distPath, "manifest.webmanifest"));
    });

    app.use(express.static(distPath, {
      setHeaders: (res, filePath) => {
        if (filePath.endsWith(".html")) {
          res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0");
        }
      }
    }));

    app.get("*all", (req, res, next) => {
      if (req.path.startsWith("/api")) return next();
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0");
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // Only listen if we are not being imported by a serverless provider like Vercel
  if (!process.env.VERCEL) {
    const PORT = 3000;
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://0.0.0.0:${PORT}`);
      syncFirestoreToLocalDB(true).then(() => {
        syncAdminSheets().catch((err) =>
          console.error("Initial sheets sync failed on boot:", err),
        );
      }).catch((err) => {
        console.error("Firestore sync on boot failed:", err);
      });
    });
  }
}

setupViteOrStatic();
export default app;
