// Shared Firebase bootstrap. SDK modules load from the official CDN (no build step).
// The SDK version is pinned here only; every page imports from this file.
import { initializeApp } from "https://www.gstatic.com/firebasejs/13.3.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/13.3.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/13.3.0/firebase-firestore.js";
import { firebaseConfig, APP_VERSION } from "./firebase-config.js";

export { initializeApp, getAuth, getFirestore, APP_VERSION };
export {
  signInAnonymously, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut
} from "https://www.gstatic.com/firebasejs/13.3.0/firebase-auth.js";
export {
  doc, collection, query, limit, getDoc, getDocFromServer, getDocs, getDocsFromServer,
  setDoc, updateDoc, deleteDoc, onSnapshot, serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/13.3.0/firebase-firestore.js";

export const configMissing = firebaseConfig.apiKey === "REPLACE_ME";
export { firebaseConfig };

// Default app instance used by join.html and control.html.
export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
