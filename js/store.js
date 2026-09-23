(function () {
  const FJ = (globalThis.FJ = globalThis.FJ || {});

  const KEY = 'flashjap.v1';

  const fresh = () => ({
    version: 1,
    cards: [], // { id, recto, verso, stage, due, ok, ko, last, added }
    stats: { reviews: 0, sessions: 0, ms: 0, xp: 0 },
    daily: {}, // 'YYYY-MM-DD' -> { reviews, ms, xp }
    // catPool : sélection de catégories à réviser (null = toutes) ; addCat : dernière catégorie choisie à l'ajout d'une carte
    settings: { reverse: false, shuffle: true, newPerSession: 10, sound: true, chartMetric: 'reviews', chartRange: 7, catPool: null, addCat: '' },
    metaU: 0, // version (horodatage) des compteurs/réglages pour la synchro ; chaque carte porte la sienne dans `_u`
  });

  const store = { state: fresh(), onChange: null };

  // Point d'accès unique au stockage. La synchro (js/sync-core.js) s'y branche via `onChange`.
  function merge(raw) {
    const base = fresh();
    return {
      version: 1,
      cards: Array.isArray(raw.cards) ? raw.cards : [],
      stats: Object.assign(base.stats, raw.stats),
      daily: raw.daily || {},
      settings: Object.assign(base.settings, raw.settings),
      metaU: raw.metaU || 0,
    };
  }

  store.load = function () {
    try {
      const raw = localStorage.getItem(KEY);
      store.state = raw ? merge(JSON.parse(raw)) : fresh();
    } catch (e) {
      store.state = fresh();
    }
    store.index();
  };

  // Écriture locale seule (utilisée aussi par la synchro pour ne pas se rappeler elle-même)
  store.saveLocal = function () {
    try {
      localStorage.setItem(KEY, JSON.stringify(store.state));
      return true;
    } catch (e) {
      return false;
    }
  };

  // Sauvegarde immédiate en local, puis prévient la synchro qu'il y a peut-être quelque chose à envoyer.
  store.save = function () {
    const ok = store.saveLocal();
    if (ok && store.onChange) store.onChange();
    return ok;
  };

  store.index = function () {
    store.map = new Map(store.state.cards.map((c) => [c.id, c]));
  };

  store.byId = (id) => store.map.get(id);

  store.dayKey = function (t) {
    const d = new Date(t || Date.now());
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };

  store.today = function () {
    const key = store.dayKey();
    return (store.state.daily[key] = store.state.daily[key] || { reviews: 0, ms: 0, xp: 0 });
  };

  // Ajoute les cartes inconnues (comme "nouvelles"). Une carte déjà connue n'est pas recréée (sa progression est
  // conservée) ; seuls ses images/emoji sont complétés si le CSV en apporte, et sa catégorie si elle n'en a pas encore.
  // Si une carte existante a DÉJÀ une autre catégorie, on ne la change pas : le conflit est renvoyé dans
  // `catConflicts`, à l'appelant de demander (voir store.applyCatChanges).
  store.addCards = function (parsed) {
    const now = Date.now();
    let added = 0;
    let duplicates = 0;
    let imagesUpdated = 0;
    let catFilled = 0;
    let textFixed = 0;
    const catConflicts = [];
    // Une carte modifiée garde son identifiant d'origine : on reconnaît donc aussi un doublon par son texte actuel
    // (recto + verso), pour qu'un import ne recrée ni l'ancienne ni la nouvelle version d'une carte corrigée.
    const byContent = new Map(store.state.cards.map((c) => [c.recto + '\u0001' + c.verso, c]));
    for (const c of parsed) {
      let existing = store.map.get(c.id) || byContent.get(c.recto + '\u0001' + c.verso);
      let fixed = false;
      // Correction d'un pack : la ligne donne l'ancien texte. Si la carte d'origine est là et n'a pas été modifiée par
      // l'utilisateur, on la corrige sur place (même identifiant, progression conservée), sans doublon. Si
      // l'utilisateur l'a modifiée lui-même, on garde sa version et on n'en ajoute pas une seconde.
      if (!existing && c.was) {
        const old = store.map.get(FJ.csv.cardId(c.was.recto, c.was.verso));
        if (old) {
          existing = old;
          if (old.recto === c.was.recto && old.verso === c.was.verso) {
            byContent.delete(old.recto + '\u0001' + old.verso);
            old.recto = c.recto;
            old.verso = c.verso;
            byContent.set(old.recto + '\u0001' + old.verso, old);
            fixed = true;
            textFixed++;
          }
        }
      }
      if (existing) {
        if (!fixed) duplicates++;
        let changed = false;
        for (const f of ['rimg', 'vimg', 'emoji']) {
          if (c[f] && existing[f] !== c[f]) { existing[f] = c[f]; changed = true; }
        }
        if (c.emojiClear && existing.emoji) { delete existing.emoji; changed = true; }
        if (changed) imagesUpdated++;
        if (c.cat) {
          if (!existing.cat) { existing.cat = c.cat; catFilled++; }
          else if (existing.cat !== c.cat) catConflicts.push({ id: existing.id, cat: c.cat });
        }
        continue;
      }
      const card = { id: c.id, recto: c.recto, verso: c.verso, stage: 0, due: 0, ok: 0, ko: 0, last: 0, added: now };
      if (c.rimg) card.rimg = c.rimg;
      if (c.vimg) card.vimg = c.vimg;
      if (c.emoji) card.emoji = c.emoji;
      if (c.cat) card.cat = c.cat;
      if (c.kanjiForce !== undefined) card.kanjiForce = c.kanjiForce; // réglage manuel Kanji Only (true/false)
      store.state.cards.push(card);
      store.map.set(card.id, card);
      byContent.set(card.recto + '\u0001' + card.verso, card);
      added++;
    }
    store.save();
    return { added, duplicates, imagesUpdated, catFilled, textFixed, catConflicts };
  };

  // Applique les changements de catégorie refusés par défaut par addCards (après confirmation de l'utilisateur).
  store.applyCatChanges = function (changes) {
    let n = 0;
    for (const ch of changes) {
      const c = store.map.get(ch.id);
      if (c && c.cat !== ch.cat) { c.cat = ch.cat; n++; }
    }
    if (n) store.save();
    return n;
  };

  // ---------- Catégories (une par carte, c.cat ; absente = "Sans catégorie", clé '') ----------
  // Liste triée (ordre naturel : "Genki L2" avant "Genki L10"), avec quelques compteurs pour l'affichage.
  store.categoryList = function (now = Date.now()) {
    const m = new Map();
    for (const c of store.state.cards) {
      if (c.state === 'removed') continue;
      const key = c.cat || '';
      let e = m.get(key);
      if (!e) m.set(key, (e = { key, total: 0, due: 0, fresh: 0 }));
      if (c.state) continue; // de côté / masterisée : la catégorie existe, mais ses cartes ne comptent pas
      e.total++;
      if (c.stage === 0) e.fresh++;
      else if (c.stage < FJ.srs.VALIDATED && c.due <= now) e.due++;
    }
    return [...m.values()].sort((a, b) => (a.key === '' ? 1 : b.key === '' ? -1 : a.key.localeCompare(b.key, 'fr', { numeric: true })));
  };

  // La carte fait-elle partie de la sélection de catégories à réviser ? (null = toutes)
  store.inPool = function (c) {
    const pool = store.state.settings.catPool;
    return !pool || pool.includes(c.cat || '');
  };

  // Deux pistes de progression indépendantes : "main" (la carte elle-même) et "kanji" (c.k, créée à la demande).
  const EMPTY = Object.freeze({ stage: 0, due: 0, ok: 0, ko: 0, last: 0 });
  store.progress = (c, track) => (track === 'kanji' ? c.k || EMPTY : c);
  store.ensureProgress = (c, track) => (track === 'kanji' ? (c.k = c.k || { stage: 0, due: 0, ok: 0, ko: 0, last: 0 }) : c);

  // Une carte "de côté" ou "éliminée" (c.state) sort de toutes les sessions et de tous les compteurs.
  store.isActive = (c) => !c.state;

  // Compteurs pour le tableau de bord
  // poolOnly : ne compte que les cartes des catégories sélectionnées (utilisé pour les boutons de révision)
  store.counts = function (now, track = 'main', poolOnly = false) {
    const out = { total: 0, fresh: 0, learning: 0, validated: 0, due: 0, known: 0, nextDue: 0, aside: 0, removed: 0, mastered: 0, priority: 0 };
    for (const c of store.state.cards) {
      if (c.state === 'aside') { out.aside++; continue; }
      if (c.state === 'removed') { out.removed++; continue; }
      if (track === 'kanji' && !FJ.kanji.view(c)) continue;
      if (poolOnly && !store.inPool(c)) continue;
      if (c.state === 'mastered') { // masterisé : compte comme validé et connu, ne revient plus en révision
        out.total++;
        out.validated++;
        out.known++;
        out.mastered++;
        continue;
      }
      const p = store.progress(c, track);
      out.total++;
      if (c.prio) out.priority++;
      if (p.stage === 0) out.fresh++;
      else if (p.stage >= FJ.srs.VALIDATED) out.validated++;
      else {
        out.learning++;
        if (p.due <= now) out.due++;
        else if (!out.nextDue || p.due < out.nextDue) out.nextDue = p.due;
      }
      if (p.ok > 0) out.known++;
    }
    return out;
  };

  store.periodTotals = function (days) {
    let reviews = 0;
    const now = Date.now();
    for (let i = 0; i < days; i++) {
      const d = store.state.daily[store.dayKey(now - i * 86400000)];
      if (d) reviews += d.reviews;
    }
    return reviews;
  };

  store.exportJson = () => JSON.stringify(store.state, null, 1);

  store.importJson = function (text) {
    const raw = JSON.parse(text);
    if (!raw || !Array.isArray(raw.cards)) throw new Error('Fichier de sauvegarde invalide.');
    store.state = merge(raw);
    store.index();
    store.save();
  };

  store.reset = function () {
    store.state = fresh();
    store.index();
    store.save();
  };

  FJ.store = store;
})();
