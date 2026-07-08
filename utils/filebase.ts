import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { db, collection, getDocs } from './firebase';

export interface FilebaseAccount {
  accessKey: string;
  secretKey: string;
  bucketName: string;
}

export async function getFilebaseAccounts(): Promise<FilebaseAccount[]> {
  try {
    const list: FilebaseAccount[] = [];
    const querySnapshot = await getDocs(collection(db, 'filebase_accounts'));
    querySnapshot.forEach((doc) => {
      const data = doc.data();
      if (data.accessKey && data.secretKey && data.bucketName) {
        list.push({
          accessKey: data.accessKey.trim(),
          secretKey: data.secretKey.trim(),
          bucketName: data.bucketName.trim()
        });
      }
    });
    return list;
  } catch (err) {
    console.error("Failed to load filebase accounts", err);
    return [];
  }
}

function getS3Client(account: FilebaseAccount) {
  return new S3Client({
    endpoint: 'https://s3.filebase.com',
    region: 'us-east-1',
    credentials: {
      accessKeyId: account.accessKey,
      secretAccessKey: account.secretKey
    }
  });
}

export async function uploadToFilebaseFallback(fileName: string, dataStr: string): Promise<{ success: boolean; account?: FilebaseAccount; error?: any }> {
  const accounts = await getFilebaseAccounts();
  if (accounts.length === 0) {
    return { success: false, error: 'No Filebase accounts available' };
  }

  for (const account of accounts) {
    try {
      const s3 = getS3Client(account);
      const command = new PutObjectCommand({
        Bucket: account.bucketName,
        Key: fileName,
        Body: dataStr,
        ContentType: 'application/json'
      });
      await s3.send(command);
      return { success: true, account };
    } catch (err: any) {
      console.warn(`Filebase upload failed for account ${account.accessKey}:`, err.message);
      // Depending on the exact Quota error, we might only want to continue if it's a sizing/quota error.
      // But let's try the next account anyway if it fails.
      continue;
    }
  }

  return { success: false, error: 'All Filebase accounts exhausted or failed.' };
}

export async function loadFromFilebase(fileName: string, account: { accessKey: string, secretKey: string, bucketName: string }): Promise<string | null> {
  try {
    const s3 = getS3Client(account as FilebaseAccount);
    const command = new GetObjectCommand({
      Bucket: account.bucketName,
      Key: fileName
    });
    const response = await s3.send(command);
    if (response.Body) {
      const str = await response.Body.transformToString();
      return str;
    }
  } catch (err: any) {
    console.warn(`Filebase load failed for ${fileName}:`, err.message);
  }
  return null;
}

export async function deleteFromFilebase(fileName: string, account: { accessKey: string, secretKey: string, bucketName: string }): Promise<boolean> {
  try {
    const s3 = getS3Client(account as FilebaseAccount);
    const command = new DeleteObjectCommand({
      Bucket: account.bucketName,
      Key: fileName
    });
    await s3.send(command);
    return true;
  } catch (err: any) {
    console.warn(`Filebase delete failed for ${fileName}:`, err.message);
    return false;
  }
}
