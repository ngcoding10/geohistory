// The public Firebase web config of the shared project (backend: github.com/ngcoding10/backend-combination).
// Neither value is a secret. GeoHistory reuses The Pantry's registered web app (same site address,
// ngcoding10.github.io, already set up with App Check and Google sign-in), so no console step was needed.
// Registering GeoHistory's own web app later would only change appId (Firebase console -> Project settings
// -> Your apps, then App Check -> Apps -> register it with the same reCAPTCHA Enterprise key).
// Loaded only when the suggestion form opens or on admin.html, never with the map.
export const firebaseConfig = {
  apiKey: 'AIzaSyBS9L5-lAQXibNvtXDXDeBDRXVIWRIg7v0',
  authDomain: 'combination-23e84.firebaseapp.com',
  projectId: 'combination-23e84',
  storageBucket: 'combination-23e84.firebasestorage.app',
  messagingSenderId: '102320113071',
  appId: '1:102320113071:web:b7b91336dd83b42d181b5a',
};
export const appCheckSiteKey = '6LeG7S4uAAAAABOlsa7JG8j-B_Cy7d9EWDMP8iJH';
