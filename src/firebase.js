import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDZlKnL3loHdWOACg3rwwMlXvx8A0E1wxE",
  authDomain: "task-timer-14626.firebaseapp.com",
  projectId: "task-timer-14626",
  storageBucket: "task-timer-14626.firebasestorage.app",
  messagingSenderId: "19287279358",
  appId: "1:19287279358:web:65aaf2af80998dacfd47af",
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
// Calendar sync disabled until app is verified by Google
// googleProvider.addScope("https://www.googleapis.com/auth/calendar.events");
export const db = getFirestore(app);
