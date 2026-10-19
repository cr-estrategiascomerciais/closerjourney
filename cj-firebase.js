/* Inicialização única do Firebase (Auth + Firestore) */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

export { firebaseConfig };

export const configured =
  !!firebaseConfig.apiKey && !/COLE_AQUI/i.test(firebaseConfig.apiKey) && !/COLE_AQUI/i.test(firebaseConfig.projectId);

export const app = configured ? initializeApp(firebaseConfig) : null;
export const auth = app ? getAuth(app) : null;
export const db = app ? getFirestore(app) : null;
