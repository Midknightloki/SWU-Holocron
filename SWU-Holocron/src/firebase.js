import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

// Replace this with your actual Firebase config from the console
const firebaseConfig = {
  apiKey: "AIzaSyAUeQLo1TtsWANeMWHvQooeIBfHZDA2bq4",
  authDomain: "swu-holocron-93a18.firebaseapp.com",
  projectId: "swu-holocron-93a18",
  storageBucket: "swu-holocron-93a18.firebasestorage.app",
  messagingSenderId: "151643530726",
  appId: "1:151643530726:web:6111fd3f2cc4be2ccde227"
};

let app, auth, db, storage;
let isConfigured = false;

try {
  // Check if config values are placeholders
  if (firebaseConfig.apiKey !== "YOUR_API_KEY") {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    storage = getStorage(app);
    isConfigured = true;
  } else {
    console.warn("Firebase not configured. Please update src/firebase.js");
  }
} catch (e) {
  console.error("Firebase init failed:", e);
}

export { auth, db, storage, isConfigured };
export const APP_ID = 'swu-holocron-v1'; // Namespace for your database path
