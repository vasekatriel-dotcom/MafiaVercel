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
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT_ID-default-rtdb.firebaseio.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

firebase.initializeApp(firebaseConfig);
