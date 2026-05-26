importScripts("./firebase-config.js");
importScripts("https://www.gstatic.com/firebasejs/12.13.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/12.13.0/firebase-messaging-compat.js");

const placeholderTokens = ["ISI_", "PROJECT_ID", "SENDER_ID", "APP_ID"];
const requiredConfigKeys = ["apiKey", "authDomain", "projectId", "messagingSenderId", "appId"];

function hasPlaceholder(value) {
  return !value || placeholderTokens.some((token) => String(value).includes(token));
}

function hasValidFirebaseConfig(config) {
  return requiredConfigKeys.every((key) => !hasPlaceholder(config[key]));
}

if (hasValidFirebaseConfig(self.FIREBASE_CONFIG || {})) {
  firebase.initializeApp(self.FIREBASE_CONFIG);

  const messaging = firebase.messaging();

  messaging.onBackgroundMessage((payload) => {
    const notification = payload.notification || {};
    const data = payload.data || {};
    const title = notification.title || data.title || "Cloud Messaging";
    const options = {
      body: notification.body || data.body || "Ada pesan baru untuk kamu.",
      icon: notification.icon || "../img/favicon.png",
      badge: "../img/favicon.png",
      data: {
        url: payload.fcmOptions?.link || data.url || new URL("./", self.location.href).href,
        payload
      }
    };

    self.registration.showNotification(title, options);
  });
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = event.notification?.data?.url || new URL("./", self.location.href).href;

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === targetUrl && "focus" in client) {
          return client.focus();
        }
      }

      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }

      return undefined;
    })
  );
});
