(function () {
  const FJ = (globalThis.FJ = globalThis.FJ || {});

  const KEY = 'flashjap.v1';

  const fresh = () => ({
    version: 1,
    cards: [], // { id, recto, verso, stage, due, ok, ko, last, added }
    stats: { reviews: 0, sessions: 0, ms: 0, xp: 0 },
    daily: {}, // 'YYYY-MM-DD' -> { reviews, ms, xp }
    settings: { reverse: false, shuffle: true, newPerSession: 10, sound: true, chartMetric: 'reviews', chartRange: 7 },
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
  // conservée) ; seules ses images sont mises à jour si le CSV en apporte de nouvelles.
  store.addCards = function (parsed) {
    const now = Date.now();
    let added = 0;
    let duplicates = 0;
    let imagesUpdated = 0;
    for (const c of parsed) {
      const existing = store.map.get(c.id);
      if (existing) {
        duplicates++;
        let changed = false;
        for (const f of ['rimg', 'vimg', 'emoji']) {
          if (c[f] && existing[f] !== c[f]) { existing[f] = c[f]; changed = true; }
        }
        if (changed) imagesUpdated++;
        continue;
      }
      const card = { id: c.id, recto: c.recto, verso: c.verso, stage: 0, due: 0, ok: 0, ko: 0, last: 0, added: now };
      if (c.rimg) card.rimg = c.rimg;
      if (c.vimg) card.vimg = c.vimg;
      if (c.emoji) card.emoji = c.emoji;
      store.state.cards.push(card);
      store.map.set(card.id, card);
      added++;
    }
    store.save();
    return { added, duplicates, imagesUpdated };
  };

  // Deux pistes de progression indépendantes : "main" (la carte elle-même) et "kanji" (c.k, créée à la demande).
  const EMPTY = Object.freeze({ stage: 0, due: 0, ok: 0, ko: 0, last: 0 });
  store.progress = (c, track) => (track === 'kanji' ? c.k || EMPTY : c);
  store.ensureProgress = (c, track) => (track === 'kanji' ? (c.k = c.k || { stage: 0, due: 0, ok: 0, ko: 0, last: 0 }) : c);

  // Une carte "de côté" ou "éliminée" (c.state) sort de toutes les sessions et de tous les compteurs.
  store.isActive = (c) => !c.state;

  // Compteurs pour le tableau de bord
  store.counts = function (now, track = 'main') {
    const out = { total: 0, fresh: 0, learning: 0, validated: 0, due: 0, known: 0, nextDue: 0, aside: 0, removed: 0, mastered: 0, priority: 0 };
    for (const c of store.state.cards) {
      if (c.state === 'aside') { out.aside++; continue; }
      if (c.state === 'removed') { out.removed++; continue; }
      if (track === 'kanji' && !FJ.kanji.view(c)) continue;
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
