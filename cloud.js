// Cloud sign-in and saves (Firebase). Loaded as a module after game.js; talks to the game through window.Cloud
// and a "cloud-auth" event. The config below is meant to be public; the Firestore rules protect each player's save.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, addDoc, deleteDoc, updateDoc, collection, query, orderBy, limit, getDocs, onSnapshot, runTransaction, increment } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

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
/* ---------- Alliances ----------
   alliances/{id}            name, tag, desc, leader, members (count), xp, bank, active (contract id or null), createdAt
   alliances/{id}/members    one doc per player: company, level, loads, joinedAt, lastSeen
   alliances/{id}/contracts  shared contracts: kind, cargo, target, delivered, contributions{uid:n}, claimed{uid:true}, status, deadline
   alliances/{id}/feed       short activity messages */
const MAX_MEMBERS = 20;
const aRef = id => doc(db, "alliances", id), mRef = (id, uid) => doc(db, "alliances", id, "members", uid);
const cRef = (id, cid) => doc(db, "alliances", id, "contracts", cid);
const uid = () => { if(!Cloud.user) throw new Error("signed-out"); return Cloud.user.uid; };
Cloud.al = {
  MAX_MEMBERS,
  async list(){ const q = await getDocs(query(collection(db, "alliances"), orderBy("createdAt", "desc"), limit(60))); return q.docs.map(d=>({id:d.id, ...d.data()})); },
  async create(a, me){
    const u = uid(), ref = await addDoc(collection(db, "alliances"), {name:a.name, tag:a.tag, desc:a.desc||"", leader:u, members:1, xp:0, bank:0, active:null, createdAt:Date.now()});
    await setDoc(mRef(ref.id, u), {...me, loads:0, joinedAt:Date.now(), lastSeen:Date.now()});
    await Cloud.al.post(ref.id, `${me.company} founded the alliance`);
    return ref.id;
  },
  async join(id, me){
    const u = uid();
    await runTransaction(db, async tx => {
      const a = await tx.get(aRef(id)); if(!a.exists()) throw new Error("gone");
      if((a.data().members||0) >= MAX_MEMBERS) throw new Error("full");
      tx.set(mRef(id, u), {...me, loads:0, joinedAt:Date.now(), lastSeen:Date.now()});
      tx.update(aRef(id), {members: increment(1)});
    });
    await Cloud.al.post(id, `${me.company} joined`);
  },
  async leave(id, company){
    const u = uid(), a = await getDoc(aRef(id)); if(!a.exists()) return;
    const d = a.data();
    if(d.leader === u){
      const ms = (await getDocs(collection(db, "alliances", id, "members"))).docs.filter(x=>x.id!==u).sort((x,y)=>(x.data().joinedAt||0)-(y.data().joinedAt||0));
      if(!ms.length){ await deleteDoc(mRef(id, u)); await deleteDoc(aRef(id)); return; }   // last one out closes it
      await updateDoc(aRef(id), {leader: ms[0].id});
    }
    await Cloud.al.post(id, `${company} left`);
    await deleteDoc(mRef(id, u)); await updateDoc(aRef(id), {members: increment(-1)});
  },
  async kick(id, who, name){ await deleteDoc(mRef(id, who)); await updateDoc(aRef(id), {members: increment(-1)}); await Cloud.al.post(id, `${name} was removed by the leader`); },
  async makeLeader(id, who){ await updateDoc(aRef(id), {leader: who}); },
  async touch(id, me){ await updateDoc(mRef(id, uid()), {...me, lastSeen:Date.now()}); },
  async post(id, text){ try{ await addDoc(collection(db, "alliances", id, "feed"), {t:Date.now(), uid:Cloud.user?.uid||"", text}); }catch(_){} },
  async donate(id, amount, company){ await updateDoc(aRef(id), {bank: increment(amount)}); await Cloud.al.post(id, `${company} put $${amount.toLocaleString("en-US")} in the alliance bank`); },
  // Start a shared contract. Only one runs at a time; some cost money from the alliance bank.
  async start(id, c, company){
    const ref = doc(collection(db, "alliances", id, "contracts"));
    await runTransaction(db, async tx => {
      const a = await tx.get(aRef(id)), d = a.data();
      if(d.active) throw new Error("busy");
      if((c.cost||0) > (d.bank||0)) throw new Error("bank");
      tx.set(ref, {...c, delivered:0, contributions:{}, claimed:{}, status:"active", startedBy:uid(), createdAt:Date.now()});
      tx.update(aRef(id), {active: ref.id, bank: increment(-(c.cost||0))});
    });
    await Cloud.al.post(id, `${company} started the contract: ${c.n}`);
  },
  // Add your deliveries to the running contract; whoever pushes it over the line closes it out.
  async contribute(id, cid, n){
    const u = uid();
    await updateDoc(cRef(id, cid), {delivered: increment(n), [`contributions.${u}`]: increment(n)});
    await updateDoc(mRef(id, u), {loads: increment(n), lastSeen: Date.now()});
    await runTransaction(db, async tx => {
      const c = await tx.get(cRef(id, cid)), d = c.data();
      if(!d || d.status!=="active" || d.delivered < d.target) return;
      tx.update(cRef(id, cid), {status:"done", endedAt:Date.now()});
      tx.update(aRef(id), {active:null, xp: increment(d.xp||0)});
    }).then(async ()=>{ const c = (await getDoc(cRef(id, cid))).data(); if(c?.status==="done" && c.endedAt > Date.now()-15000) await Cloud.al.post(id, `Contract complete: ${c.n}! Claim your rewards.`); });
  },
  async expire(id, cid){
    await runTransaction(db, async tx => {
      const c = await tx.get(cRef(id, cid)), d = c.data();
      if(!d || d.status!=="active" || Date.now() <= d.deadline) return;
      tx.update(cRef(id, cid), {status:"failed", endedAt:Date.now()});
      tx.update(aRef(id), {active:null});
    });
  },
  // Mark your share of a finished contract as paid; returns how many loads you delivered for it.
  async claim(id, cid){
    const u = uid(); let n = 0;
    await runTransaction(db, async tx => {
      const c = await tx.get(cRef(id, cid)), d = c.data();
      if(!d || d.status!=="done" || d.claimed?.[u]) return;
      n = d.contributions?.[u] || 0; if(!n) return;
      tx.update(cRef(id, cid), {[`claimed.${u}`]: true});
    });
    return n;
  },
  // Live updates for one alliance. cb gets {alliance, members, contracts, feed} on every change.
  watch(id, cb){
    const st = {alliance:null, members:[], contracts:[], feed:[], la:false, lm:false}, emit = () => cb({...st});
    const subs = [
      onSnapshot(aRef(id), d=>{ st.alliance = d.exists() ? {id:d.id, ...d.data()} : null; st.la = true; emit(); }, ()=>{}),
      onSnapshot(collection(db, "alliances", id, "members"), q=>{ st.members = q.docs.map(d=>({uid:d.id, ...d.data()})); st.lm = true; emit(); }, ()=>{}),
      onSnapshot(query(collection(db, "alliances", id, "contracts"), orderBy("createdAt", "desc"), limit(8)), q=>{ st.contracts = q.docs.map(d=>({id:d.id, ...d.data()})); emit(); }, ()=>{}),
      onSnapshot(query(collection(db, "alliances", id, "feed"), orderBy("t", "desc"), limit(25)), q=>{ st.feed = q.docs.map(d=>({id:d.id, ...d.data()})); emit(); }, ()=>{})
    ];
    return () => subs.forEach(f=>f());
  }
};
onAuthStateChanged(auth, u => {
  Cloud.user = u ? {uid:u.uid, email:u.email} : null; Cloud.ready = true;
  window.dispatchEvent(new CustomEvent("cloud-auth", {detail: Cloud.user}));
});
