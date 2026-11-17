// Shared Firebase bootstrap. SDK modules load from the official CDN (no build step).
// The SDK version is pinned here only; every page imports from this file.
import { initializeApp } from "https://www.gstatic.com/firebasejs/13.3.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/13.3.0/firebase-auth.js";
import {
  getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager
} from "https://www.gstatic.com/firebasejs/13.3.0/firebase-firestore.js";
import { firebaseConfig, APP_VERSION } from "./firebase-config.js";

export { initializeApp, getAuth, getFirestore, APP_VERSION };
export {
  signInAnonymously, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut
} from "https://www.gstatic.com/firebasejs/13.3.0/firebase-auth.js";
export {
  doc, collection, query, where, limit, getDoc, getDocFromServer, getDocs, getDocsFromServer,
  setDoc, updateDoc, deleteDoc, onSnapshot, serverTimestamp, Timestamp, writeBatch,
  waitForPendingWrites, deleteField
} from "https://www.gstatic.com/firebasejs/13.3.0/firebase-firestore.js";

export const configMissing = firebaseConfig.apiKey === "REPLACE_ME";
export { firebaseConfig };

// Default app instance used by join.html and control.html.
// Offline cache (plan, risk table) only on the student page: writes made without network are queued and
// sent on reconnect. The instructor pages use the memory cache on purpose: with a shared multi-tab cache,
// one hidden tab holds the network lease and can delay the instructor's state changes by tens of seconds
// (seen in the Phase 1 load test).
const isStudentPage = /\/join\.html$/.test(location.pathname);
export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = (() => {
  if (!isStudentPage) return getFirestore(app);
  try {
    return initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  } catch {
    return getFirestore(app); // browsers without IndexedDB (some in-app browsers) fall back to memory cache
  }
})();
