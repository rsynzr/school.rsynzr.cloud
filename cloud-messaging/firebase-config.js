(function attachFirebaseConfig(root) {
  root.FIREBASE_CONFIG = {
    apiKey: "ISI_API_KEY_FIREBASE_KAMU",
    authDomain: "PROJECT_ID.firebaseapp.com",
    projectId: "PROJECT_ID",
    storageBucket: "PROJECT_ID.firebasestorage.app",
    messagingSenderId: "SENDER_ID",
    appId: "APP_ID"
  };

  root.FIREBASE_VAPID_KEY = "ISI_PUBLIC_VAPID_KEY_WEB_PUSH_KAMU";
})(typeof self !== "undefined" ? self : window);
