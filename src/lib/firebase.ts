import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";

// Config web Firebase — ini AMAN ditaruh di kode client (bukan rahasia).
// Keamanan datanya diatur lewat Security Rules di Firebase Console, bukan
// dengan menyembunyikan apiKey ini.
const firebaseConfig = {
  apiKey: "AIzaSyBZEe5u0ItpNPt-W8U0Px6uiNZSbb4Ivkw",
  authDomain: "wiwok-c9f4b.firebaseapp.com",
  databaseURL:
    "https://wiwok-c9f4b-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "wiwok-c9f4b",
  storageBucket: "wiwok-c9f4b.firebasestorage.app",
  messagingSenderId: "964224113985",
  appId: "1:964224113985:web:dd775fdc9ad51c4a3295c0",
  measurementId: "G-JVETJV8VVR",
};

export const firebaseApp = initializeApp(firebaseConfig);
export const db = getDatabase(firebaseApp);
