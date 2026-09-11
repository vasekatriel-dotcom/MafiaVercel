// ============================================================
// PASTE YOUR FIREBASE CONFIG HERE
// ------------------------------------------------------------
// 1. Go to https://console.firebase.google.com and create a
//    free project (any name, e.g. "underworld-mafia").
// 2. In the left sidebar: Build > Realtime Database > Create Database.
//    Choose any region, and start in "test mode" (see README for
//    the recommended security rules to paste in afterwards).
// 3. In the left sidebar: Project settings (gear icon) > General.
//    Scroll to "Your apps", click the "</>" (Web) icon, register
//    an app (any nickname), and copy the firebaseConfig object
//    it gives you into the object below, replacing the example.
// ============================================================

const firebaseConfig = {
 apiKey: "AIzaSyD6vb6smfI6w1Z5WejPNZBEXwt_kWzW7m4",
  authDomain: "mafiavercel.firebaseapp.com",
  databaseURL: "https://mafiavercel-default-rtdb.firebaseio.com",
  projectId: "mafiavercel",
  storageBucket: "mafiavercel.firebasestorage.app",
  messagingSenderId: "856881061942",
  appId: "1:856881061942:web:560784301fed4db045b897",
  measurementId: "G-KN7LJPLKP8"
};

firebase.initializeApp(firebaseConfig);
