import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getAnalytics, isSupported } from "firebase/analytics";

const firebaseConfig = {
  apiKey: "AIzaSyB4GS5qdfQ482OSjLHl42VwjPKH-BsbsDA",
  authDomain: "design-11649.firebaseapp.com",
  projectId: "design-11649",
  storageBucket: "design-11649.firebasestorage.app",
  messagingSenderId: "146365646843",
  appId: "1:146365646843:web:4ccd4be267a5e0b3806d5e",
  measurementId: "G-MNLL48RPJH",
};

export const firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);
export const db = getFirestore(firebaseApp);
export const storage = getStorage(firebaseApp);

// Explicit opt-in only: never connect an application build to production data during emulator tests.
if (import.meta.env.VITE_USE_FIREBASE_EMULATOR === "true") {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
}

// Analytics is optional and only initialized in supported browser environments.
export const analyticsReady = isSupported()
  .then((supported) => (supported ? getAnalytics(firebaseApp) : null))
  .catch(() => null);
