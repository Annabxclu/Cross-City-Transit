// Cloud sign-in and saves (Firebase). Loaded as a module after game.js; talks to the game through window.Cloud
// and a "cloud-auth" event. The config below is meant to be public; the Firestore rules protect each player's save.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCkIYSuglCbQ0puSZOSQHZLWdD6ocw9rxg",
  authDomain: "cross-city-transit.firebaseapp.com",
  projectId: "cross-city-transit",
  storageBucket: "cross-city-transit.firebasestorage.app",
  messagingSenderId: "896397118508",
  appId: "1:896397118508:web:43aa9a6090512fdc8cd589"
};
const app = initializeApp(firebaseConfig), auth = getAuth(app), db = getFirestore(app);

const Cloud = window.Cloud = {
  user: null, ready: false,
  signIn: (email, pw) => signInWithEmailAndPassword(auth, email, pw),
  signUp: (email, pw) => createUserWithEmailAndPassword(auth, email, pw),
  signOut: () => signOut(auth),
  reset: email => sendPasswordResetEmail(auth, email),
  async pull(){ if(!Cloud.user) return null; const s = await getDoc(doc(db, "saves", Cloud.user.uid)); return s.exists() ? s.data() : null; },
  async push(data, meta){ if(!Cloud.user) return; await setDoc(doc(db, "saves", Cloud.user.uid), {data, ...meta}); }
};
onAuthStateChanged(auth, u => {
  Cloud.user = u ? {uid:u.uid, email:u.email} : null; Cloud.ready = true;
  window.dispatchEvent(new CustomEvent("cloud-auth", {detail: Cloud.user}));
});
