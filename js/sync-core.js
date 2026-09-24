(function () {
  const FJ = (globalThis.FJ = globalThis.FJ || {});

  // Cœur de la synchronisation, indépendant de Firebase (testé avec un faux serveur, voir README).
  //
  // Principe : "local d'abord". Le navigateur reste la référence immédiate (localStorage) ; ce module
  //  - envoie au serveur ce qui a changé (comparaison avec `shadow`, l'image de ce que le serveur possède),
  //  - reçoit les changements des autres appareils et les fusionne.
  // Conflit : le dernier écrit gagne, carte par carte, d'après `_u` (horodatage posé au moment de l'envoi).
  //
  // `backend` (fourni par js/sync.js pour Firebase) :
  //   subscribeCards(cb)  cb(changes[{type:'added'|'modified'|'removed', id, data}], {fromCache, empty})
  //   subscribeMeta(cb)   cb(data|null, {fromCache})
  //   write(ops)          ops = [{kind:'setCard',id,data} | {kind:'deleteCard',id} | {kind:'setMeta',data}] -> Promise
  const CHUNK = 400; // limite Firestore : 500 opérations par lot

  // JSON à clés triées : deux objets identiques donnent le même texte, quel que soit l'ordre des champs.
  function canon(v) {
    if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
    if (v && typeof v === 'object') {
      return '{' + Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
    }
    return JSON.stringify(v);
  }

  const cardBody = (c) => { const { _u, ...rest } = c; return canon(rest); };
  const plain = (o) => JSON.parse(JSON.stringify(o)); // retire les `undefined` (refusés par Firestore)

  function create({ store, backend, now = Date.now, onStatus = () => {}, onRemote = () => {}, debounceMs = 1200 }) {
    const shadow = new Map(); // id -> corps de la carte tel que le serveur le connaît
    let shadowMeta = null;
    const remoteIds = new Set();
    let cardsReady = false;
    let metaReady = false;
    let pending = 0;
    let lastU = 0;
    let timer = null;
    let unsubs = [];
    let stopped = false;
    let pushing = Promise.resolve();

    const ready = () => cardsReady && metaReady;
    const nextU = () => (lastU = Math.max(now(), lastU + 1));
    const metaBody = () => {
      const { stats, daily, settings } = store.state;
      return canon({ stats, daily, settings });
    };

    function status() {
      if (!ready()) return onStatus('connecting');
      onStatus(pending > 0 ? 'syncing' : 'synced');
    }

    // ---- Réception ----
    function replaceCard(local, data) {
      for (const k of Object.keys(local)) delete local[k];
      Object.assign(local, data);
    }

    function applyRemoteCard(id, data) {
      remoteIds.add(id);
      const local = store.map.get(id);
      if (!local) {
        store.state.cards.push(data);
        store.map.set(id, data);
        shadow.set(id, cardBody(data));
        lastU = Math.max(lastU, data._u || 0);
        return true;
      }
      const lu = local._u || 0;
      const ru = data._u || 0;
      lastU = Math.max(lastU, ru);
      if (ru > lu) {
        replaceCard(local, data);
        shadow.set(id, cardBody(data));
        return true;
      }
      // égal : le serveur a la même version ; local plus récent : notre écriture est en route
      shadow.set(id, ru === lu ? cardBody(data) : cardBody(local));
      return false;
    }

    function removeCard(id) {
      remoteIds.delete(id);
      shadow.delete(id);
      const local = store.map.get(id);
      if (!local) return false;
      const i = store.state.cards.indexOf(local);
      if (i >= 0) store.state.cards.splice(i, 1);
      store.map.delete(id);
      return true;
    }

    // Les compteurs (XP, cartes révisées, sessions, temps, et le détail par jour) ne font que croître : on les
    // fusionne en gardant le plus grand de chaque côté, jamais "le dernier écrit gagne". Sinon un appareil resté
    // en retard (hors-ligne, cache) qui envoie plus tard ses chiffres écrase la progression de l'autre.
    // `stats.epoch` marque une réinitialisation / restauration volontaire : une époque plus récente remplace tout.
    function maxInto(target, source) {
      for (const k of Object.keys(source || {})) {
        if (typeof source[k] === 'number') target[k] = Math.max(target[k] || 0, source[k]);
        else if (target[k] === undefined) target[k] = source[k];
      }
    }

    function mergeCounters(s, data) {
      const rs = data.stats || {};
      const re = rs.epoch || 0;
      const le = (s.stats && s.stats.epoch) || 0;
      if (re > le) { // le serveur vient d'une réinitialisation / restauration plus récente : il fait foi
        s.stats = Object.assign({}, rs);
        s.daily = JSON.parse(JSON.stringify(data.daily || {}));
        return;
      }
      if (re < le) return; // notre réinitialisation est plus récente : on la garde
      s.stats = s.stats || {};
      maxInto(s.stats, rs);
      s.daily = s.daily || {};
      for (const day of Object.keys(data.daily || {})) {
        s.daily[day] = s.daily[day] || {};
        maxInto(s.daily[day], data.daily[day]);
      }
    }

    function applyRemoteMeta(data) {
      if (!data) { shadowMeta = null; return false; }
      const s = store.state;
      const before = metaBody();
      const lu = s.metaU || 0;
      const ru = data._u || 0;
      lastU = Math.max(lastU, ru);
      mergeCounters(s, data);
      if (ru > lu) { // réglages : le plus récent gagne
        s.settings = Object.assign({}, s.settings, data.settings);
        s.metaU = ru;
      }
      // Le serveur a `data` ; si notre fusion contient davantage, le prochain envoi le corrigera.
      shadowMeta = canon({ stats: data.stats, daily: data.daily, settings: data.settings });
      return metaBody() !== before;
    }

    function afterRemote(changed) {
      if (changed) {
        store.index();
        store.saveLocal();
        onRemote();
      }
      if (ready()) schedule(0);
      status();
    }

    // ---- Envoi ----
    function schedule(delay = debounceMs) {
      clearTimeout(timer);
      timer = setTimeout(push, delay);
    }

    function collect(deleteMissing) {
      const ops = [];
      for (const c of store.state.cards) {
        const b = cardBody(c);
        if (shadow.get(c.id) !== b) {
          c._u = nextU();
          shadow.set(c.id, b);
          ops.push({ kind: 'setCard', id: c.id, data: plain(c) });
        }
      }
      const mb = metaBody();
      if (mb !== shadowMeta) {
        store.state.metaU = nextU();
        shadowMeta = mb;
        const { stats, daily, settings } = store.state;
        ops.push({ kind: 'setMeta', data: plain({ stats, daily, settings, _u: store.state.metaU }) });
      }
      if (deleteMissing) {
        for (const id of remoteIds) {
          if (!store.map.has(id)) { ops.push({ kind: 'deleteCard', id }); shadow.delete(id); }
        }
      }
      return ops;
    }

    function push(deleteMissing = false) {
      if (stopped || !ready()) return pushing;
      const ops = collect(deleteMissing === true);
      if (!ops.length) { status(); return pushing; }
      store.saveLocal(); // les `_u` posés sont conservés localement
      pending++;
      status();
      const chunks = [];
      for (let i = 0; i < ops.length; i += CHUNK) chunks.push(ops.slice(i, i + CHUNK));
      pushing = pushing
        .then(() => Promise.all(chunks.map((c) => backend.write(c))))
        .then(() => { pending--; status(); }, (err) => {
          pending--;
          // Échec (droits, quota…) : on oublie ces envois pour qu'ils soient retentés au prochain changement
          for (const op of ops) if (op.kind === 'setCard') shadow.delete(op.id);
          if (ops.some((o) => o.kind === 'setMeta')) shadowMeta = null;
          onStatus('error', err);
        });
      return pushing;
    }

    // ---- Démarrage ----
    function start() {
      stopped = false;
      unsubs.push(backend.subscribeCards((changes, meta) => {
        let changed = false;
        for (const ch of changes) {
          if (ch.type === 'removed') changed = removeCard(ch.id) || changed;
          else changed = applyRemoteCard(ch.id, ch.data) || changed;
        }
        // Un cache vide n'est pas une réponse du serveur : on ne pousse rien tant qu'on ne sait pas ce que le serveur a.
        if (!meta.fromCache || !meta.empty) cardsReady = true;
        afterRemote(changed);
      }));
      unsubs.push(backend.subscribeMeta((data, meta) => {
        const changed = applyRemoteMeta(data);
        if (!meta.fromCache || data) metaReady = true;
        afterRemote(changed);
      }));
      status();
    }

    function stop() {
      stopped = true;
      clearTimeout(timer);
      unsubs.forEach((u) => u && u());
      unsubs = [];
    }

    // Après une restauration de sauvegarde ou une réinitialisation : l'état local devient la vérité, y compris
    // face à des versions plus récentes sur le serveur.
    function replaceAll() {
      shadow.clear();
      shadowMeta = null;
      store.state.stats.epoch = nextU(); // nouvelle époque : les autres appareils adoptent ces compteurs tels quels
      return push(true);
    }

    return { start, stop, notifyChange: () => schedule(), flush: () => push(), replaceAll, isReady: ready, _shadow: shadow };
  }

  FJ.syncCore = { create, canon };
})();
