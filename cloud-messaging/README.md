# Cloud Messaging Console

Aplikasi static untuk Firebase Authentication Google dan Firebase Cloud Messaging web push.

## File

- `index.html` untuk struktur halaman.
- `styles.css` untuk tema biru-putih.
- `firebase-config.js` untuk Firebase web config dan public VAPID key.
- `app.js` untuk Google sign-in, izin notifikasi, FCM token, foreground message, dan penyimpanan token ke Firestore.
- `firebase-messaging-sw.js` untuk background message service worker.

## Setup Firebase

1. Buat Firebase project, lalu tambahkan Web App.
2. Buka Authentication, aktifkan provider Google.
3. Tambahkan domain deploy ke Authentication Authorized domains. Untuk testing lokal tambahkan `localhost`.
4. Buka Project settings, tab Cloud Messaging, lalu generate Web Push certificate.
5. Isi `firebase-config.js` dengan Firebase web config dan public VAPID key.
6. Deploy lewat HTTPS atau jalankan dari `localhost`.

## Firestore rules opsional

Pakai rules ini kalau token ingin disimpan otomatis di koleksi `users/{uid}/fcmTokens/{tokenId}`.

```txt
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/fcmTokens/{tokenId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

## Kirim pesan uji

Setelah token muncul di halaman, kirim pesan dari Firebase Console Cloud Messaging atau dari server yang memakai Firebase Admin SDK. Jangan menaruh server key/Admin credential di file frontend.
