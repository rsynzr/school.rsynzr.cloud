import { initializeApp } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-app.js";
import {
  GoogleAuthProvider,
  getAuth,
  getRedirectResult,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut
} from "https://www.gstatic.com/firebasejs/12.13.0/firebase-auth.js";
import {
  doc,
  getFirestore,
  serverTimestamp,
  setDoc
} from "https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js";
import {
  getMessaging,
  getToken,
  isSupported,
  onMessage
} from "https://www.gstatic.com/firebasejs/12.13.0/firebase-messaging.js";

const firebaseConfig = globalThis.FIREBASE_CONFIG || {};
const vapidKey = globalThis.FIREBASE_VAPID_KEY || "";

const placeholderTokens = ["ISI_", "PROJECT_ID", "SENDER_ID", "APP_ID"];
const requiredConfigKeys = ["apiKey", "authDomain", "projectId", "messagingSenderId", "appId"];

const elements = {
  authDot: document.querySelector("#authDot"),
  authStatus: document.querySelector("#authStatus"),
  clearFeedBtn: document.querySelector("#clearFeedBtn"),
  copyTokenBtn: document.querySelector("#copyTokenBtn"),
  feed: document.querySelector("#messageFeed"),
  firebaseDot: document.querySelector("#firebaseDot"),
  firebaseStatus: document.querySelector("#firebaseStatus"),
  originValue: document.querySelector("#originValue"),
  permissionDot: document.querySelector("#permissionDot"),
  permissionStatus: document.querySelector("#permissionStatus"),
  requestTokenBtn: document.querySelector("#requestTokenBtn"),
  sessionBadge: document.querySelector("#sessionBadge"),
  setupBanner: document.querySelector("#setupBanner"),
  signedInView: document.querySelector("#signedInView"),
  signedOutView: document.querySelector("#signedOutView"),
  signInBtn: document.querySelector("#signInBtn"),
  signOutBtn: document.querySelector("#signOutBtn"),
  testNotificationBtn: document.querySelector("#testNotificationBtn"),
  tokenDot: document.querySelector("#tokenDot"),
  tokenOutput: document.querySelector("#tokenOutput"),
  tokenStatus: document.querySelector("#tokenStatus"),
  userAvatar: document.querySelector("#userAvatar"),
  userEmail: document.querySelector("#userEmail"),
  userName: document.querySelector("#userName")
};

let auth;
let db;
let messaging;
let serviceWorkerRegistration;
let currentUser = null;
let currentToken = "";
let messagingReady = false;
let firebaseReady = false;
let vapidReady = false;

elements.originValue.textContent = window.location.origin;

function hasPlaceholder(value) {
  return !value || placeholderTokens.some((token) => String(value).includes(token));
}

function hasValidFirebaseConfig(config) {
  return requiredConfigKeys.every((key) => !hasPlaceholder(config[key]));
}

function hasValidVapidKey(key) {
  return !hasPlaceholder(key) && String(key).length > 40;
}

function setStatus(dot, label, text, state) {
  dot.className = `status-dot ${state || ""}`.trim();
  label.textContent = text;
}

function setButtonState() {
  const canRequestToken = firebaseReady && messagingReady && vapidReady && Boolean(currentUser);
  elements.requestTokenBtn.disabled = !canRequestToken;
  elements.copyTokenBtn.disabled = !currentToken;
  elements.testNotificationBtn.disabled = !("Notification" in window) || Notification.permission !== "granted";
}

function renderPermissionStatus() {
  if (!("Notification" in window)) {
    setStatus(elements.permissionDot, elements.permissionStatus, "Browser tidak mendukung Notification API", "danger");
    return;
  }

  if (Notification.permission === "granted") {
    setStatus(elements.permissionDot, elements.permissionStatus, "Diizinkan", "success");
    return;
  }

  if (Notification.permission === "denied") {
    setStatus(elements.permissionDot, elements.permissionStatus, "Ditolak oleh browser", "danger");
    return;
  }

  setStatus(elements.permissionDot, elements.permissionStatus, "Belum diminta", "warning");
}

function renderAuthState(user) {
  currentUser = user;

  if (!user) {
    currentToken = "";
    elements.tokenOutput.value = "";
    elements.signedOutView.classList.remove("is-hidden");
    elements.signedInView.classList.add("is-hidden");
    elements.sessionBadge.textContent = "Belum login";
    elements.sessionBadge.className = "badge badge-muted";
    setStatus(elements.authDot, elements.authStatus, "Belum login", "warning");
    setStatus(elements.tokenDot, elements.tokenStatus, "Belum tersedia", "warning");
    setButtonState();
    return;
  }

  elements.signedOutView.classList.add("is-hidden");
  elements.signedInView.classList.remove("is-hidden");
  elements.sessionBadge.textContent = "Login aktif";
  elements.sessionBadge.className = "badge badge-success";
  elements.userName.textContent = user.displayName || "Google User";
  elements.userEmail.textContent = user.email || "Email tidak tersedia";
  elements.userAvatar.src = user.photoURL || "../img/favicon.png";
  setStatus(elements.authDot, elements.authStatus, `Login sebagai ${user.email || user.uid}`, "success");
  setButtonState();
}

function showToast(message, type = "info") {
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  window.setTimeout(() => toast.classList.add("is-visible"), 20);
  window.setTimeout(() => {
    toast.classList.remove("is-visible");
    window.setTimeout(() => toast.remove(), 250);
  }, 3200);
}

function clearEmptyState() {
  const emptyState = elements.feed.querySelector(".empty-state");
  if (emptyState) {
    emptyState.remove();
  }
}

function appendMessage(payload, source = "FCM") {
  clearEmptyState();

  const title = payload?.notification?.title || payload?.data?.title || "Pesan baru";
  const body = payload?.notification?.body || payload?.data?.body || "Payload diterima oleh browser.";
  const data = payload?.data ? JSON.stringify(payload.data, null, 2) : "";

  const card = document.createElement("article");
  card.className = "message-item";

  const meta = document.createElement("div");
  meta.className = "message-meta";
  meta.innerHTML = `<span>${source}</span><time>${new Date().toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  })}</time>`;

  const heading = document.createElement("h3");
  heading.textContent = title;

  const content = document.createElement("p");
  content.textContent = body;

  card.append(meta, heading, content);

  if (data) {
    const pre = document.createElement("pre");
    pre.textContent = data;
    card.append(pre);
  }

  elements.feed.prepend(card);
}

async function tokenHash(token) {
  const bytes = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function saveTokenToFirestore(token) {
  if (!db || !currentUser) {
    return;
  }

  const tokenId = await tokenHash(token);
  const tokenRef = doc(db, "users", currentUser.uid, "fcmTokens", tokenId);

  await setDoc(tokenRef, {
    token,
    permission: Notification.permission,
    userAgent: navigator.userAgent,
    updatedAt: serverTimestamp(),
    createdAt: serverTimestamp()
  }, { merge: true });
}

async function getServiceWorkerRegistration() {
  if (!("serviceWorker" in navigator)) {
    throw new Error("Browser ini belum mendukung service worker.");
  }

  if (serviceWorkerRegistration) {
    return serviceWorkerRegistration;
  }

  serviceWorkerRegistration = await navigator.serviceWorker.register("./firebase-messaging-sw.js", {
    scope: "./"
  });

  await navigator.serviceWorker.ready;
  return serviceWorkerRegistration;
}

async function requestToken() {
  if (!currentUser) {
    showToast("Login dengan Google dulu.", "warning");
    return;
  }

  if (!vapidReady) {
    showToast("Public VAPID key belum diisi.", "warning");
    return;
  }

  try {
    elements.requestTokenBtn.disabled = true;
    elements.requestTokenBtn.textContent = "Memproses...";

    const permission = await Notification.requestPermission();
    renderPermissionStatus();

    if (permission !== "granted") {
      setStatus(elements.tokenDot, elements.tokenStatus, "Izin notifikasi belum diberikan", "danger");
      showToast("Izin notifikasi ditolak atau belum diberikan.", "warning");
      return;
    }

    const registration = await getServiceWorkerRegistration();
    currentToken = await getToken(messaging, {
      vapidKey,
      serviceWorkerRegistration: registration
    });

    if (!currentToken) {
      setStatus(elements.tokenDot, elements.tokenStatus, "Token belum tersedia", "warning");
      showToast("Firebase belum mengembalikan token untuk perangkat ini.", "warning");
      return;
    }

    elements.tokenOutput.value = currentToken;
    setStatus(elements.tokenDot, elements.tokenStatus, "Token aktif", "success");

    try {
      await saveTokenToFirestore(currentToken);
      showToast("Token aktif dan tersimpan ke Firestore.", "success");
    } catch (error) {
      showToast("Token aktif, tetapi belum tersimpan ke Firestore.", "warning");
      console.warn("Firestore token save failed:", error);
    }
  } catch (error) {
    console.error(error);
    setStatus(elements.tokenDot, elements.tokenStatus, "Gagal mengambil token", "danger");
    showToast(error.message || "Gagal mengambil token FCM.", "danger");
  } finally {
    elements.requestTokenBtn.textContent = "Aktifkan notifikasi";
    setButtonState();
  }
}

async function copyToken() {
  if (!currentToken) {
    return;
  }

  try {
    await navigator.clipboard.writeText(currentToken);
    showToast("Token disalin.", "success");
  } catch {
    elements.tokenOutput.select();
    document.execCommand("copy");
    showToast("Token disalin dari textarea.", "success");
  }
}

function testNotification() {
  if (!("Notification" in window) || Notification.permission !== "granted") {
    showToast("Aktifkan izin notifikasi dulu.", "warning");
    return;
  }

  const notification = new Notification("Tes Cloud Messaging", {
    body: "Notifikasi lokal berhasil tampil di browser ini.",
    icon: "../img/favicon.png",
    badge: "../img/favicon.png",
    tag: "cloud-messaging-local-test"
  });

  notification.onclick = () => window.focus();
  appendMessage({
    notification: {
      title: "Tes Cloud Messaging",
      body: "Notifikasi lokal berhasil tampil di browser ini."
    },
    data: {
      source: "local-preview"
    }
  }, "LOCAL");
}

async function signInWithGoogle() {
  if (!firebaseReady) {
    showToast("Lengkapi konfigurasi Firebase dulu.", "warning");
    return;
  }

  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });

  try {
    await signInWithPopup(auth, provider);
  } catch (error) {
    if (["auth/popup-blocked", "auth/cancelled-popup-request"].includes(error.code)) {
      await signInWithRedirect(auth, provider);
      return;
    }

    console.error(error);
    showToast(error.message || "Login Google gagal.", "danger");
  }
}

function bindEvents() {
  elements.signInBtn.addEventListener("click", signInWithGoogle);
  elements.signOutBtn.addEventListener("click", () => signOut(auth));
  elements.requestTokenBtn.addEventListener("click", requestToken);
  elements.copyTokenBtn.addEventListener("click", copyToken);
  elements.testNotificationBtn.addEventListener("click", testNotification);
  elements.clearFeedBtn.addEventListener("click", () => {
    elements.feed.innerHTML = `
      <article class="empty-state">
        <strong>Belum ada pesan.</strong>
        <span>Pesan foreground dari FCM dan tes lokal akan tampil di area ini.</span>
      </article>
    `;
  });
}

async function boot() {
  bindEvents();
  renderPermissionStatus();

  firebaseReady = hasValidFirebaseConfig(firebaseConfig);
  vapidReady = hasValidVapidKey(vapidKey);

  if (!firebaseReady) {
    setStatus(elements.firebaseDot, elements.firebaseStatus, "Config belum lengkap", "danger");
    setStatus(elements.tokenDot, elements.tokenStatus, "Menunggu Firebase config", "warning");
    setButtonState();
    return;
  }

  elements.setupBanner.classList.add("is-hidden");
  setStatus(elements.firebaseDot, elements.firebaseStatus, "Terhubung", "success");

  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);

  if (!vapidReady) {
    setStatus(elements.tokenDot, elements.tokenStatus, "VAPID key belum lengkap", "warning");
  }

  messagingReady = await isSupported().catch(() => false);

  if (!messagingReady) {
    setStatus(elements.tokenDot, elements.tokenStatus, "FCM web tidak didukung browser ini", "danger");
  } else {
    messaging = getMessaging(app);
    onMessage(messaging, (payload) => appendMessage(payload, "FCM"));
  }

  getRedirectResult(auth).catch((error) => {
    console.warn("Redirect sign-in result failed:", error);
  });

  onAuthStateChanged(auth, renderAuthState);
  setButtonState();
}

boot().catch((error) => {
  console.error(error);
  setStatus(elements.firebaseDot, elements.firebaseStatus, "Gagal inisialisasi", "danger");
  showToast(error.message || "Aplikasi gagal dimuat.", "danger");
});
