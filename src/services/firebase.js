let admin = null;
try {
  // Optional dependency at runtime. App still works locally without Firebase.
  // eslint-disable-next-line global-require
  admin = require('firebase-admin');
} catch (_) {
  admin = null;
}

let firebaseApp = undefined;
let storageBucket = undefined;

function normalizePrivateKey(input) {
  if (!input) return '';
  return String(input).replace(/\\n/g, '\n');
}

function parseServiceAccountFromEnv() {
  const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (rawJson) {
    try {
      return JSON.parse(rawJson);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Invalid FIREBASE_SERVICE_ACCOUNT_JSON:', error.message);
      return null;
    }
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY);
  if (!projectId || !clientEmail || !privateKey) return null;

  return {
    projectId,
    clientEmail,
    privateKey
  };
}

function getFirebaseApp() {
  if (firebaseApp !== undefined) return firebaseApp;
  if (!admin) {
    firebaseApp = null;
    return firebaseApp;
  }

  const serviceAccount = parseServiceAccountFromEnv();
  if (!serviceAccount) {
    firebaseApp = null;
    return firebaseApp;
  }

  try {
    if (admin.apps.length > 0) {
      firebaseApp = admin.app();
    } else {
      const options = {
        credential: admin.credential.cert(serviceAccount)
      };
      if (process.env.FIREBASE_STORAGE_BUCKET) {
        options.storageBucket = process.env.FIREBASE_STORAGE_BUCKET;
      }
      firebaseApp = admin.initializeApp(options);
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Firebase init failed:', error.message);
    firebaseApp = null;
  }

  return firebaseApp;
}

function getStorageBucket() {
  if (storageBucket !== undefined) return storageBucket;
  const app = getFirebaseApp();
  if (!app || !admin) {
    storageBucket = null;
    return storageBucket;
  }

  try {
    const bucketName = process.env.FIREBASE_STORAGE_BUCKET || undefined;
    storageBucket = admin.storage().bucket(bucketName);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Firebase Storage bucket init failed:', error.message);
    storageBucket = null;
  }

  return storageBucket;
}

function isFirebaseEnabled() {
  return Boolean(getStorageBucket());
}

module.exports = {
  getFirebaseApp,
  getStorageBucket,
  isFirebaseEnabled
};
