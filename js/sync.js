// Synchronisation en ligne : connexion Google + Firestore. Chargé à la demande (import dynamique) : si ce fichier ou
// Firebase est inaccessible (fichier ouvert en local, réseau absent au premier lancement), l'appli reste 100 % locale.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, onSnapshot, writeBatch, addDoc, deleteDoc, query, orderBy, limit,
} from 'https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

const FJ = globalThis.FJ;
const { store } = FJ;
const ui = () => FJ.ui || {};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
auth.languageCode = 'fr';

// Cache hors-ligne persistant (les révisions faites sans réseau partent au retour de la connexion).
let db;
try {
  db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
} catch (e) {
  db = initializeFirestore(app, {}); // ex. navigation privée : cache en mémoire seulement
}

const state = (FJ.syncUi = FJ.syncUi || {});
Object.assign(state, { phase: 'signedout', email: '', name: '', status: 'connecting', error: '' });

let core = null;

function publish() {
  if (ui().syncChanged) ui().syncChanged();
}

function setStatus(status, err) {
  state.status = status;
  state.error = err ? explain(err) : '';
  publish();
}

function explain(err) {
  const code = (err && err.code) || '';
  if (code.includes('permission-denied')) return "Accès refusé : l'application est peut-être temporairement fermée aux nouveaux comptes, ou les règles Firestore ne sont pas encore publiées (voir README).";
  if (code.includes('unavailable')) return 'Serveur injoignable pour le moment.';
  return (err && err.message) || 'Erreur inconnue.';
}

function makeBackend(uid) {
  const cards = collection(db, 'users', uid, 'cards');
  const meta = doc(db, 'users', uid, 'meta', 'state');
  const onError = (err) => setStatus('error', err);
  return {
    subscribeCards: (cb) => onSnapshot(cards, (snap) => {
      cb(snap.docChanges().map((ch) => ({ type: ch.type, id: ch.doc.id, data: ch.doc.data() })), { fromCache: snap.metadata.fromCache, empty: snap.empty });
    }, onError),
    subscribeMeta: (cb) => onSnapshot(meta, (snap) => {
      cb(snap.exists() ? snap.data() : null, { fromCache: snap.metadata.fromCache });
    }, onError),
    write(ops) {
      const batch = writeBatch(db);
      for (const op of ops) {
        if (op.kind === 'setCard') batch.set(doc(cards, op.id), op.data);
        else if (op.kind === 'deleteCard') batch.delete(doc(cards, op.id));
        else if (op.kind === 'setMeta') batch.set(meta, op.data);
      }
      return batch.commit();
    },
  };
}

function startSync(user) {
  stopSync();
  Object.assign(state, { phase: 'signedin', email: user.email || '', name: user.displayName || '', status: 'connecting', error: '' });
  core = FJ.syncCore.create({
    store,
    backend: makeBackend(user.uid),
    onStatus: (s, err) => setStatus(!navigator.onLine && s !== 'error' ? 'offline' : s, err),
    onRemote: () => ui().refresh && ui().refresh(),
  });
  store.onChange = () => core.notifyChange();
  FJ.sync.replaceAll = () => core.replaceAll();
  core.start();
  startFeedbackInbox();
  publish();
}

function stopSync() {
  if (core) core.stop();
  core = null;
  store.onChange = null;
  FJ.sync.replaceAll = () => Promise.resolve();
  stopFeedbackInbox();
}

// ---------- Petits mots des amis ("feedback") ----------
// Collection à part (hors de users/{uid}) : n'importe qui de connecté peut y déposer un mot (règle "create" seule),
// mais seul le compte propriétaire peut les lire ou les supprimer. On ne code aucune adresse e-mail ici (ça
// l'exposerait dans le code public) : on tente simplement la lecture, et ce sont les règles Firestore, côté
// serveur, qui décident si ça passe. Ça réussit -> on est le propriétaire ; ça échoue -> on n'affiche rien.
const fb = (FJ.feedbackUi = FJ.feedbackUi || {});
Object.assign(fb, { isOwner: false, items: [] });
let unsubFeedback = null;

function startFeedbackInbox() {
  const q = query(collection(db, 'feedback'), orderBy('createdAt', 'desc'), limit(100));
  unsubFeedback = onSnapshot(q, (snap) => {
    fb.isOwner = true;
    fb.items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (ui().feedbackChanged) ui().feedbackChanged();
  }, () => {
    fb.isOwner = false; // accès refusé par les règles : ce n'est pas le compte propriétaire
    fb.items = [];
    if (ui().feedbackChanged) ui().feedbackChanged();
  });
}

function stopFeedbackInbox() {
  fb.isOwner = false;
  fb.items = [];
  if (unsubFeedback) unsubFeedback();
  unsubFeedback = null;
}

FJ.sync = {
  replaceAll: () => Promise.resolve(),
  async signIn() {
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (e) {
      const code = (e && e.code) || '';
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return;
      const msg = code === 'auth/popup-blocked'
        ? 'La fenêtre de connexion a été bloquée : autorisez les pop-ups pour ce site puis réessayez.'
        : code === 'auth/unauthorized-domain'
          ? "Ce domaine n'est pas autorisé dans Firebase (Authentication > Paramètres > Domaines autorisés)."
          : 'Connexion impossible : ' + ((e && e.message) || code);
      if (ui().toast) ui().toast(msg);
    }
  },
  async signOut() {
    await signOut(auth);
  },
  // Envoie un petit mot au créateur. Ne fonctionne que connecté (le bouton n'est de toute façon proposé qu'à ce moment-là).
  async sendFeedback({ text, mood, anonymous }) {
    const user = auth.currentUser;
    if (!user) return false;
    const clean = (text || '').trim().slice(0, 300);
    if (!clean && !mood) return false;
    try {
      await addDoc(collection(db, 'feedback'), {
        uid: user.uid,
        text: clean,
        mood: mood || null,
        name: anonymous ? null : (user.displayName || null),
        createdAt: Date.now(),
      });
      return true;
    } catch (e) {
      if (ui().toast) ui().toast("Envoi impossible pour le moment.");
      return false;
    }
  },
  async deleteFeedback(id) {
    try { await deleteDoc(doc(db, 'feedback', id)); } catch (e) { /* tant pis, réessayable */ }
  },
};

onAuthStateChanged(auth, (user) => {
  if (user) startSync(user);
  else {
    stopSync();
    Object.assign(state, { phase: 'signedout', email: '', name: '', status: 'connecting', error: '' });
    publish();
  }
});

// Retour du réseau / changement d'application : on pousse sans attendre le délai habituel.
window.addEventListener('online', () => { if (core) { setStatus(state.status === 'offline' ? 'syncing' : state.status); core.flush(); } });
window.addEventListener('offline', () => { if (state.phase === 'signedin') setStatus('offline'); });
document.addEventListener('visibilitychange', () => { if (document.hidden && core) core.flush(); });
