// Firebase web config for this project.
// Paste the values from: Firebase console > Project settings > General > Your apps > Web app.
// These values are public by design; access control lives in firestore.rules, not here.
// measurementId is omitted on purpose: the app does not load Google Analytics.
export const firebaseConfig = {
  apiKey: "AIzaSyCAIRymRA51QSHDA5dCjHcoxN0WV-PPPZM",
  authDomain: "class-experiments-85e21.firebaseapp.com",
  projectId: "class-experiments-85e21",
  storageBucket: "class-experiments-85e21.firebasestorage.app",
  messagingSenderId: "415372112162",
  appId: "1:415372112162:web:e85fd64bd13cfabe8d757b"
};

// App version, stored with every session so the comparison archive can tell builds apart.
export const APP_VERSION = "0.4.0-phase4";
