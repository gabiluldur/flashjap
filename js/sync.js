// Synchronisation en ligne : connexion Google + Firestore. Chargé à la demande (import dynamique) : si ce fichier ou
// Firebase est inaccessible (fichier ouvert en local, réseau absent au premier lancement), l'appli reste 100 % locale.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, onSnapshot, writeBatch, setDoc, serverTimestamp, query, orderBy, limit,
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
  startNotes(user.uid);
  publish();
}

function stopSync() {
  if (core) core.stop();
  core = null;
  store.onChange = null;
  FJ.sync.replaceAll = () => Promise.resolve();
  stopNotes();
}

// ---------- Petits mots publics ("notes") ----------
// Un mur de messages courts, visibles par tous les comptes connectés (pas de réponses, pas de chat).
// Limite d'un mot par personne et par jour, appliquée côté serveur par les règles Firestore grâce à l'identifiant
// du document, "{uid}_{numéro du jour UTC}" : un second envoi le même jour vise un document déjà existant et est refusé.
const notes = (FJ.notesUi = FJ.notesUi || {});
Object.assign(notes, { items: [], sentToday: false });
let unsubNotes = null;
const dayNumber = () => Math.floor(Date.now() / 86400000);
const NOTE_DAYS = 7; // on n'affiche que les mots récents

function startNotes(uid) {
  const q = query(collection(db, 'notes'), orderBy('createdAt', 'desc'), limit(40));
  unsubNotes = onSnapshot(q, (snap) => {
    const since = Date.now() - NOTE_DAYS * 86400000;
    notes.items = snap.docs
      .map((d) => {
        const data = d.data({ serverTimestamps: 'estimate' });
        return { id: d.id, ...data, createdAt: data.createdAt && data.createdAt.toMillis ? data.createdAt.toMillis() : Date.now() };
      })
      .filter((n) => n.createdAt >= since);
    notes.sentToday = notes.items.some((n) => n.id === uid + '_' + dayNumber());
    if (ui().notesChanged) ui().notesChanged();
  }, () => {
    notes.items = []; // accès refusé (ex. appli fermée aux nouveaux comptes) : la zone reste vide
    if (ui().notesChanged) ui().notesChanged();
  });
}

function stopNotes() {
  notes.items = [];
  notes.sentToday = false;
  if (unsubNotes) unsubNotes();
  unsubNotes = null;
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
  // Dépose un petit mot public (1 par jour). Retourne 'ok', 'already' (déjà envoyé aujourd'hui) ou 'error'.
  async sendNote({ text, mood, anonymous }) {
    const user = auth.currentUser;
    if (!user) return 'error';
    const clean = (text || '').trim().slice(0, 100);
    if (!clean && !mood) return 'error';
    if (notes.sentToday) return 'already';
    try {
      await setDoc(doc(db, 'notes', user.uid + '_' + dayNumber()), {
        uid: user.uid,
        text: clean,
        mood: mood || null,
        name: anonymous ? null : ((user.displayName || '').split(' ')[0] || null), // prénom seulement
        createdAt: serverTimestamp(),
      });
      return 'ok';
    } catch (e) {
      return ((e && e.code) || '').includes('permission-denied') ? 'already' : 'error';
    }
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
