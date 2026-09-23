(function () {
  const FJ = globalThis.FJ;
  const { store, srs, levels, audio, kanji } = FJ;

  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hasCjk = (s) => /[぀-ヿ㐀-鿿]/.test(s);
  const lang = (s) => (hasCjk(s) ? 'ja' : 'fr');
  const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
  const fmtN = (n) => n.toLocaleString('fr-FR');

  const CARD_TIME_CAP = 60 * 1000; // une carte laissée ouverte ne compte pas plus d'une minute de "temps passé"
  const ADVANCE_DELAY = 380;
  const POP_DURATION = 2400;
  const MASTER_XP = 100; // bonus unique quand on déclare un mot "masterisé"

  let view = 'home'; // home | session | summary | words
  let sess = null;
  let wordsFilter = 'all';
  let wordsQuery = '';
  let wordsCat = null; // null = toutes les catégories, '' = sans catégorie
  let expandedId = null;

  // ---------- Utilitaires ----------
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function toast(msg, gold) {
    const el = document.createElement('div');
    el.className = 'toast' + (gold ? ' gold' : '');
    el.textContent = msg;
    $('#toasts').appendChild(el);
    setTimeout(() => el.remove(), gold ? 4600 : 3200);
  }

  // Sauvegarde immédiate après chaque action (localStorage est synchrone : rien n'est en attente).
  let saveWarned = false;
  function persist() {
    if (store.save() || saveWarned) return;
    saveWarned = true;
    toast("⚠ Enregistrement impossible dans ce navigateur. Exportez une sauvegarde (Accueil > Données).");
  }

  // ---------- Lecture audio (voix du navigateur, gratuite) ----------
  // On précharge la liste des voix : sur Chrome elle arrive de façon asynchrone (événement voiceschanged),
  // et sans ça le premier clic sur 🔊 risque de ne pas trouver de voix japonaise installée.
  let jaVoice = null;
  function pickJaVoice() {
    if (!('speechSynthesis' in window)) return;
    const voices = speechSynthesis.getVoices();
    jaVoice = voices.find((v) => v.lang && v.lang.toLowerCase().startsWith('ja')) || null;
  }
  if ('speechSynthesis' in window) {
    pickJaVoice();
    speechSynthesis.addEventListener('voiceschanged', pickJaVoice);
  }

  // Nettoie le texte avant de le lire : retire la lecture entre parenthèses en double, ex. "空港 (くうこう)" -> "空港"
  // (sinon la voix lit parfois le mot deux fois de suite).
  function speakJapanese(text) {
    if (!('speechSynthesis' in window)) return toast("Ce navigateur ne sait pas lire de texte à voix haute.");
    const clean = text.replace(/[（(][^）)]*[）)]\s*$/, '').trim();
    if (!clean) return;
    try {
      speechSynthesis.cancel(); // interrompt une lecture en cours plutôt que de les superposer
      const u = new SpeechSynthesisUtterance(clean);
      u.lang = 'ja-JP';
      u.rate = 0.95;
      if (jaVoice) u.voice = jaVoice;
      speechSynthesis.speak(u);
    } catch (e) {
      toast('Lecture audio impossible.');
    }
  }

  function speakBtn(text) {
    const first = text.split('\n')[0];
    if (!hasCjk(first)) return '';
    return `<button type="button" class="speak" data-action="speak" data-text="${esc(first)}" aria-label="Écouter la prononciation" title="Écouter">🔊</button>`;
  }

  // ---------- Fenêtre de confirmation ----------
  let modalResolve = null;

  function askConfirm({ title, text, ok, cancel = 'Annuler' }) {
    return new Promise((resolve) => {
      modalResolve = resolve;
      $('#modalTitle').textContent = title;
      $('#modalText').textContent = text;
      $('#modalOk').textContent = ok;
      $('#modalCancel').textContent = cancel;
      $('#modal').hidden = false;
      $('#modalOk').focus();
    });
  }

  function closeModal(value) {
    $('#modal').hidden = true;
    const resolve = modalResolve;
    modalResolve = null;
    if (resolve) resolve(value);
  }

  const modalOpen = () => !$('#modal').hidden;

  function imgHtml(src) {
    return src ? `<img class="card-img" src="${esc(src)}" alt="" loading="lazy" onerror="this.remove()">` : '';
  }

  function textBlock(text) {
    const lines = text.split('\n');
    const first = lines[0];
    const long = first.length > 45 ? ' long' : '';
    return (
      `<div class="main${long}" lang="${lang(first)}">${esc(first)}</div>` +
      lines.slice(1).map((l) => `<div class="note" lang="${lang(l)}">${esc(l)}</div>`).join('')
    );
  }

  // ---------- En-tête niveau / XP / rang ----------
  function updateHeader(pulse) {
    const L = levels.fromXp(store.state.stats.xp);
    const t = L.tierInfo;
    const badge = $('#lvlBadge');
    $('#lvlNum').textContent = L.level;
    $('#lvlSeal').textContent = t.kanji;
    $('#lvlTitle').textContent = L.title;
    $('#lvlTier').textContent = `· ${t.name}`;
    $('#lvlFill').style.width = L.pct + '%';
    $('#lvlXp').textContent = `${fmtN(L.into)} / ${fmtN(L.need)} XP`;
    badge.style.setProperty('--tier', t.color);
    badge.style.setProperty('--tier-ink', t.ink);
    badge.dataset.tier = L.tier;
    if (pulse) {
      badge.classList.remove('pulse');
      void badge.offsetWidth;
      badge.classList.add('pulse');
    }
  }

  // ---------- Files de révision ----------
  // track : 'main' (recto/verso, sens au choix) ou 'kanji' (japonais d'abord, progression indépendante)
  function buildQueue(track) {
    const { cards, settings } = store.state;
    const now = Date.now();
    const P = (c) => store.progress(c, track);
    const pool = cards.filter((c) => store.isActive(c) && store.inPool(c) && (track === 'main' || kanji.view(c)));

    const due = pool.filter((c) => P(c).stage >= 1 && P(c).stage < srs.VALIDATED && P(c).due <= now).sort((a, b) => P(a).due - P(b).due);
    const fresh = pool.filter((c) => P(c).stage === 0);
    // Priorité : ★ (partout) ou, en Kanji Only, "je savais le mot mais pas le kanji" (c.kprio)
    const isPrio = (c) => !!(c.prio || (track === 'kanji' && c.kprio));
    const prioFresh = fresh.filter(isPrio); // les nouvelles cartes prioritaires ignorent la limite
    let normal = fresh.filter((c) => !isPrio(c));
    if (settings.shuffle) normal = shuffle(normal);
    if (settings.newPerSession >= 0) normal = normal.slice(0, settings.newPerSession);

    let queue = [...due, ...prioFresh, ...normal];
    if (settings.shuffle) queue = shuffle(queue);
    queue.sort((a, b) => (isPrio(b) ? 1 : 0) - (isPrio(a) ? 1 : 0)); // prioritaires d'abord (tri stable)
    return { items: queue.map((c) => ({ id: c.id, practice: false })), dueN: due.length, newN: queue.length - due.length };
  }

  // ---------- Graphique de progression par jour ----------
  const METRICS = {
    reviews: { label: 'Cartes', unit: '', get: (d) => d.reviews },
    xp: { label: 'XP', unit: ' XP', get: (d) => d.xp },
    ms: { label: 'Temps', unit: ' min', get: (d) => Math.round(d.ms / 60000) },
  };

  function chartInner() {
    const s = store.state.settings;
    const metric = METRICS[s.chartMetric] ? s.chartMetric : 'reviews';
    const m = METRICS[metric];
    const days = s.chartRange === 30 ? 30 : 7;

    const pts = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const entry = store.state.daily[store.dayKey(d.getTime())];
      pts.push({ date: d, v: entry ? m.get(entry) : 0, today: i === 0 });
    }
    const total = pts.reduce((a, p) => a + p.v, 0);
    const max = Math.max(...pts.map((p) => p.v), 1);
    const best = Math.max(...pts.map((p) => p.v));

    const W = 320, H = 150, top = 18, bottom = 22, slot = W / days, bw = slot * (days === 7 ? 0.56 : 0.66);
    const plotH = H - top - bottom;
    const fmtDay = (d) => d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    const bars = pts.map((p, i) => {
      const x = i * slot + (slot - bw) / 2;
      const h = p.v ? Math.max(plotH * (p.v / max), 3) : 2;
      const y = top + plotH - h;
      const label = days === 7
        ? p.date.toLocaleDateString('fr-FR', { weekday: 'narrow' })
        : (i % 5 === 0 || p.today ? String(p.date.getDate()) : '');
      return `<g><title>${esc(fmtDay(p.date))} : ${fmtN(p.v)}${m.unit}</title>
        <rect class="cbar${p.v ? '' : ' zero'}${p.today ? ' today' : ''}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="3"/>
        ${days === 7 && p.v ? `<text class="val" x="${(x + bw / 2).toFixed(1)}" y="${(y - 4).toFixed(1)}" text-anchor="middle">${fmtN(p.v)}</text>` : ''}
        ${label ? `<text x="${(x + bw / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle">${label}</text>` : ''}</g>`;
    }).join('');

    const chip = (act, val, label, on) => `<button class="chip" data-action="${act}" data-val="${val}" aria-pressed="${on}">${label}</button>`;
    return `
      <div class="chart-controls">
        <div class="chips">${Object.entries(METRICS).map(([k, v]) => chip('chart-metric', k, v.label, k === metric)).join('')}</div>
        <div class="segment" role="group" aria-label="Période">
          <button data-action="chart-range" data-val="7" aria-pressed="${days === 7}">7 j</button>
          <button data-action="chart-range" data-val="30" aria-pressed="${days === 30}">30 j</button>
        </div>
      </div>
      ${total
        ? `<svg class="chart-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(m.label)} par jour sur ${days} jours">${bars}</svg>
           <p class="recent">Total : <b>${fmtN(total)}${m.unit}</b> · Moyenne : <b>${fmtN(Math.round(total / days))}${m.unit}</b>/jour · Meilleur jour : <b>${fmtN(best)}${m.unit}</b></p>`
        : '<p class="muted" style="text-align:center;margin:18px 0">Pas encore de données sur cette période. Lancez une session !</p>'}`;
  }

  function refreshChart() {
    const box = $('#chartBox');
    if (box) box.innerHTML = chartInner();
  }

  // ---------- Synchronisation (l'état est tenu à jour par js/sync.js) ----------
  FJ.syncUi = FJ.syncUi || { phase: /^https?:$/.test(location.protocol) ? 'loading' : 'unavailable', status: 'connecting', email: '' };

  function syncInner() {
    const u = FJ.syncUi;
    if (u.phase === 'unavailable') return '<p class="muted small">Mode local : vos données restent sur cet appareil. La synchronisation fonctionne depuis l\'adresse en ligne de l\'appli.</p>';
    if (u.phase === 'loading') return '<p class="muted small">⟳ Chargement du service de synchronisation…</p>';
    if (u.phase === 'signedout') {
      return `<div class="sync-row"><div><b>Sauvegarde et synchronisation</b>
        <p class="muted small">Connectez-vous pour retrouver vos cartes et votre progression sur tous vos appareils. Vos données actuelles sont conservées.</p></div>
        <button class="btn primary" data-action="sync-signin">Se connecter avec Google</button></div>`;
    }
    const label = {
      connecting: '⟳ Connexion…', syncing: '⟳ Envoi en cours…', synced: '✓ Synchronisé',
      offline: '⚠ Hors-ligne : les changements partiront au retour du réseau', error: '⚠ ' + (u.error || 'Erreur'),
    }[u.status] || '';
    return `<div class="sync-row"><div><b>${esc(u.email || 'Connecté')}</b><p class="muted small sync-${u.status}">${esc(label)}</p></div>
        <button class="btn" data-action="sync-signout">Se déconnecter</button>
      </div>`;
  }

  // Distance en français pour un horodatage passé (petits mots des amis)
  function agoText(ts) {
    const min = Math.round((Date.now() - ts) / 60000);
    if (min < 1) return "à l'instant";
    if (min < 60) return `il y a ${min} min`;
    const h = Math.round(min / 60);
    if (h < 24) return `il y a ${h} h`;
    return `il y a ${Math.round(h / 24)} j`;
  }

  // ---------- Petits mots publics : un mur de messages courts, sans réponse, un envoi par jour ----------
  const MOODS = ['😍', '🙂', '😐', '🐛', '💡'];
  const SEEN_KEY = 'flashjap.notesSeen';
  const noteDraft = { open: false, text: '', mood: null, anon: false };

  function seenNotes() {
    try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')); } catch (e) { return new Set(); }
  }

  function dismissNote(id) {
    const seen = seenNotes();
    seen.add(id);
    // on ne garde que les 200 derniers identifiants lus (les vieux mots ne s'affichent plus de toute façon)
    try { localStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-200))); } catch (e) { /* stockage indisponible */ }
    refreshNotes();
  }

  function notesInner() {
    const nu = FJ.notesUi || { items: [], sentToday: false };
    const seen = seenNotes();
    const items = nu.items.filter((n) => !seen.has(n.id));
    const bubbles = items.map((n) => `
      <div class="note">
        <div class="note-head">
          ${n.mood ? `<span class="note-mood">${esc(n.mood)}</span>` : ''}
          <b>${esc(n.name || 'Anonyme')}</b>
          <span class="muted small">${agoText(n.createdAt)}</span>
          <button class="note-x" data-action="note-dismiss" data-id="${esc(n.id)}" aria-label="Fermer ce mot" title="Fermer">✕</button>
        </div>
        ${n.text ? `<p class="note-text">${esc(n.text)}</p>` : ''}
      </div>`).join('');
    const form = nu.sentToday
      ? '<p class="muted small" style="margin:10px 0 0">Votre mot du jour est parti. À demain pour un nouveau !</p>'
      : `<details id="noteDetails"${noteDraft.open ? ' open' : ''}>
          <summary>✏️ Laisser un petit mot</summary>
          <form id="noteForm" class="add-form">
            <p class="note-public">🌍 Votre mot sera <b>visible par tous les utilisateurs</b> de l'appli. Un seul par jour, sans réponse possible.</p>
            <textarea id="noteText" rows="2" maxlength="100" placeholder="Un merci, une astuce, un encouragement… (100 caractères)">${esc(noteDraft.text)}</textarea>
            <div class="mood-row">
              ${MOODS.map((m) => `<button type="button" class="mood" data-action="note-mood" data-val="${m}" aria-pressed="${noteDraft.mood === m}">${m}</button>`).join('')}
            </div>
            <label class="checkbox-row"><input type="checkbox" id="noteAnon"${noteDraft.anon ? ' checked' : ''}> Rester anonyme (votre prénom ne sera pas affiché)</label>
            <button class="btn primary" type="submit" style="margin-top:10px">Publier</button>
          </form>
        </details>`;
    return `<h2>💬 Petits mots</h2>${bubbles || '<p class="muted small" style="margin:0">Aucun nouveau mot pour le moment.</p>'}${form}`;
  }

  // Ne touche qu'à cette zone (jamais tout l'accueil) pour ne pas perdre un mot en cours de rédaction
  function refreshNotes() {
    const box = $('#notesBox');
    if (box) box.innerHTML = notesInner();
  }

  async function submitNote(e) {
    e.preventDefault();
    const text = $('#noteText').value.trim();
    if (!text && !noteDraft.mood) return toast('Ajoutez un message ou choisissez un smiley.');
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    const res = await (FJ.sync ? FJ.sync.sendNote({ text, mood: noteDraft.mood, anonymous: $('#noteAnon').checked }) : 'error');
    if (res === 'ok') {
      Object.assign(noteDraft, { open: false, text: '', mood: null, anon: $('#noteAnon').checked });
      if (FJ.notesUi) FJ.notesUi.sentToday = true;
      toast('Mot publié, merci !', true);
    } else if (res === 'already') {
      if (FJ.notesUi) FJ.notesUi.sentToday = true;
      toast("Vous avez déjà publié un mot aujourd'hui.");
    } else toast('Envoi impossible : vérifiez votre connexion.');
    refreshNotes();
  }

  function updateSyncBadge() {
    const b = $('#syncBadge');
    const u = FJ.syncUi;
    if (u.phase !== 'signedin') { b.hidden = true; return; }
    b.hidden = false;
    b.textContent = '☁';
    b.dataset.state = u.status;
    b.title = { synced: 'Synchronisé', syncing: 'Envoi en cours…', connecting: 'Connexion…', offline: 'Hors-ligne', error: 'Erreur de synchronisation' }[u.status] || '';
  }

  function syncChanged() {
    updateSyncBadge();
    const box = $('#syncBox');
    if (box) box.innerHTML = syncInner();
    if (view === 'home' && (!!$('#notesBox') || !!$('#packsBox')) && FJ.syncUi.phase !== 'signedin') renderHome(); // déconnexion : les zones disparaissent
  }

  // Appelé quand des données arrivent d'un autre appareil : rafraîchit l'affichage sans toucher à une session en cours.
  function refresh() {
    updateHeader();
    if (view === 'home') renderHome();
    else if (view === 'words') renderWordsList();
  }

  function notesChanged() {
    if (view !== 'home') return;
    const shown = !!$('#notesBox');
    if (shown !== (FJ.syncUi.phase === 'signedin')) renderHome(); // la zone apparaît / disparaît avec la connexion
    else refreshNotes();
  }

  FJ.ui = { refresh, syncChanged, notesChanged, packsChanged: (...a) => packsChanged(...a), toast };

  // ---------- Accueil ----------
  function startBlock(track, counts, label) {
    const now = Date.now();
    const q = buildQueue(track);
    if (!counts.total) {
      return store.state.settings.catPool
        ? '<div class="start"><button class="btn primary big" disabled>Aucune carte dans la sélection</button><p class="start-sub">Choisissez d\'autres leçons ci-dessous.</p></div>'
        : '';
    }
    if (!q.items.length) {
      const next = counts.nextDue ? `Prochaine carte ${srs.fmtDue(counts.nextDue, now)}.` : 'Tout est validé, bravo !';
      return `<div class="start"><button class="btn primary big" disabled>Rien à réviser</button><p class="start-sub">${next}</p></div>`;
    }
    return `<div class="start"><button class="btn primary big" data-action="start" data-track="${track}">${label}</button>
      <p class="start-sub">${plural(q.dueN, 'carte à réviser', 'cartes à réviser')} · ${plural(q.newN, 'nouvelle', 'nouvelles')}</p></div>`;
  }

  // Enregistre la sélection ; vide ou complète = null ("Toutes").
  function setPool(pool) {
    const all = store.categoryList().map((e) => e.key);
    if (pool && (!pool.length || all.every((k) => pool.includes(k)))) pool = null;
    store.state.settings.catPool = pool;
    persist();
    renderHome();
  }

  // Le tiroir des réglages de révision (engrenage de la bulle "Réviser") est fermé par défaut : on cache le
  // paramétrage pour alléger l'accueil. Il s'applique à la révision classique ET à Kanji Only.
  let settingsOpen = false;

  const GEAR_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';

  // Leçons/catégories à réviser (le "pool") : par défaut toutes ; toucher une leçon depuis "Toutes" l'isole (mode
  // concentration), ensuite chaque touche ajoute ou retire une leçon. Absent tant qu'aucune carte n'a de catégorie.
  function catChips() {
    const list = store.categoryList(Date.now());
    if (!list.some((e) => e.key !== '')) return '';
    const pool = store.state.settings.catPool;
    const chips = list.map((e) => `<button class="chip" data-action="cat-toggle" data-key="${esc(e.key)}" aria-pressed="${!!pool && pool.includes(e.key)}"
      title="${esc(`${plural(e.total, 'carte', 'cartes')} · ${e.due} à réviser · ${e.fresh} nouvelles`)}">${esc(e.key || 'Sans catégorie')}${e.due ? ` <b class="badge-due">${e.due}</b>` : ''}</button>`).join('');
    return `<div class="set-block">
      <h3 class="sub">Leçons à réviser</h3>
      <div class="chips"><button class="chip" data-action="cat-all" aria-pressed="${!pool}">Toutes</button>${chips}</div>
      <p class="muted small" style="margin:0">${pool ? `${plural(pool.length, 'leçon sélectionnée', 'leçons sélectionnées')} : les cartes sont tirées au hasard parmi elles.` : 'Touchez une leçon pour ne réviser qu\'elle, puis ajoutez-en d\'autres quand vous êtes prêt.'}</p>
    </div>`;
  }

  // Rappel discret sous le bouton de révision quand une sélection de leçons est active (le tiroir étant fermé) :
  // on sait toujours pourquoi la file est réduite, et les révisions dues hors sélection ne s'accumulent pas en silence.
  function filterNote() {
    const pool = store.state.settings.catPool;
    if (!pool) return '';
    const names = pool.map((k) => k || 'Sans catégorie');
    const label = names.length <= 2 ? names.join(' · ') : `${names.slice(0, 2).join(' · ')} +${names.length - 2}`;
    const outsideDue = store.categoryList(Date.now()).filter((e) => !pool.includes(e.key)).reduce((n, e) => n + e.due, 0);
    return `<p class="filter-note"><button class="linkish" data-action="toggle-settings" title="Modifier la sélection">📚 ${esc(label)}</button>${outsideDue
      ? `<br>⏳ ${plural(outsideDue, 'révision en attente', 'révisions en attente')} hors sélection · <button class="linkish" data-action="cat-add-due">Les inclure</button>`
      : ''}</p>`;
  }

  function optionsHtml() {
    const s = store.state;
    return `<div class="options">
      <div class="opt-row"><span>Sens des cartes <small class="muted">(hors Kanji Only)</small></span>
        <div class="segment" role="group" aria-label="Sens des cartes">
          <button data-action="set-reverse" data-val="0" aria-pressed="${!s.settings.reverse}">Recto → Verso</button>
          <button data-action="set-reverse" data-val="1" aria-pressed="${s.settings.reverse}">Verso → Recto</button>
        </div>
      </div>
      <div class="opt-row"><label for="optShuffle">Mélanger les cartes</label>
        <span class="switch"><input type="checkbox" id="optShuffle" data-setting="shuffle" ${s.settings.shuffle ? 'checked' : ''}><i></i></span>
      </div>
      <div class="opt-row"><label for="optNew">Nouvelles cartes par session</label>
        <select id="optNew" data-setting="newPerSession">
          ${[[0, 'Aucune'], [5, '5'], [10, '10'], [20, '20'], [50, '50'], [-1, 'Toutes']]
            .map(([v, l]) => `<option value="${v}" ${s.settings.newPerSession === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      </div>
      <div class="opt-row"><label for="optSound">Sons</label>
        <span class="switch"><input type="checkbox" id="optSound" data-setting="sound" ${s.settings.sound ? 'checked' : ''}><i></i></span>
      </div>
    </div>`;
  }

  function settingsPanel() {
    return `<div class="settings">
      <p class="muted small" style="margin:0 0 12px">Ces réglages s'appliquent à la révision classique et à Kanji Only.</p>
      ${catChips()}
      <h3 class="sub">Sessions</h3>
      ${optionsHtml()}
    </div>`;
  }

  function stackBlock(c) {
    const pct = (n) => (c.total ? (n / c.total) * 100 : 0);
    return `<div class="stack" aria-hidden="true">
        <span style="width:${pct(c.validated)}%;background:var(--done)"></span>
        <span style="width:${pct(c.learning)}%;background:var(--learning)"></span>
        <span style="width:${pct(c.fresh)}%;background:var(--new)"></span>
      </div>
      <div class="legend">
        <span><i class="dot" style="background:var(--done)"></i><b>${fmtN(c.validated)}</b> validés</span>
        <span><i class="dot" style="background:var(--learning)"></i><b>${fmtN(c.learning)}</b> en cours</span>
        <span><i class="dot" style="background:var(--new)"></i><b>${fmtN(c.fresh)}</b> nouveaux</span>
      </div>`;
  }

  function renderHome() {
    view = 'home';
    const s = store.state;
    const now = Date.now();
    const c = store.counts(now, 'main');
    const k = store.counts(now, 'kanji');
    const cp = store.counts(now, 'main', true); // cartes des seules catégories sélectionnées : pour les boutons de révision
    const kp = store.counts(now, 'kanji', true);
    const todayReviews = (s.daily[store.dayKey()] || {}).reviews || 0;

    // Bulle principale : la révision. L'engrenage ouvre le tiroir des réglages (sélection de leçons + options de session).
    const review = c.total
      ? `<section class="panel review">
          <div class="review-head">
            <h2>Réviser</h2>
            <button class="gear${s.settings.catPool ? ' on' : ''}" data-action="toggle-settings" aria-expanded="${settingsOpen}" aria-label="Réglages de révision" title="Réglages de révision">${GEAR_SVG}</button>
          </div>
          ${settingsOpen ? settingsPanel() : ''}
          ${startBlock('main', cp, 'Commencer la révision')}
          ${filterNote()}
          ${k.total ? `<div class="kanji-block">
            <h3 class="sub">Kanji Only</h3>
            ${startBlock('kanji', kp, 'Réviser les kanjis')}
            <div style="margin-top:12px">${stackBlock(k)}</div>
          </div>` : ''}
        </section>`
      : `<section class="panel"><div class="empty"><p>Aucune carte pour le moment.</p>
         <button class="btn primary big" data-action="starter-vocab">📦 Commencer avec le pack de base (1000 mots)</button>
         <p class="muted small" style="margin:10px 0 6px">ou</p>
         <div class="actions" style="justify-content:center">
           <button class="btn" data-action="import-csv">Importer votre CSV</button>
           <button class="btn" data-action="add-card">＋ Ajouter une carte</button>
         </div></div></section>`;

    const extras = [];
    if (c.priority) extras.push(`★ ${plural(c.priority, 'carte prioritaire', 'cartes prioritaires')}`);
    if (c.mastered) extras.push(`✓ ${plural(c.mastered, 'mot masterisé', 'mots masterisés')}`);
    if (c.aside) extras.push(`⏸ ${c.aside} de côté`);

    $('#app').innerHTML = `
      ${review}

      ${packsVisible() ? `<section class="panel packs" id="packsBox">${packsInner()}</section>` : ''}

      <section class="panel">
        <h2>Ma progression</h2>
        <div class="prog-sec">
          <h3 class="sub">Mémoire</h3>
          ${stackBlock(c)}
          <p class="recent">Aujourd'hui : ${plural(todayReviews, 'carte revue', 'cartes revues')} · 7 derniers jours : ${fmtN(store.periodTotals(7))}${extras.length ? '<br>' + extras.join(' · ') : ''}</p>
        </div>
        <div class="prog-sec">
          <h3 class="sub">Compteurs</h3>
          <div class="tiles">
            <div class="tile"><b>${fmtN(s.stats.reviews)}</b><small>cartes révisées</small></div>
            <div class="tile"><b>${fmtN(s.stats.sessions)}</b><small>sessions de révision</small></div>
            <div class="tile"><b>${fmtN(c.known)}</b><small>mots connus</small></div>
            <div class="tile"><b>${srs.fmtDuration(s.stats.ms)}</b><small>temps en session</small></div>
          </div>
        </div>
        <div class="prog-sec">
          <h3 class="sub">Par jour</h3>
          <div id="chartBox">${chartInner()}</div>
        </div>
      </section>

      <section class="panel">
        <h2>Cartes</h2>
        <div class="actions">
          <button class="btn" data-action="add-card">＋ Ajouter une carte</button>
          <button class="btn" data-action="import-csv">Importer un CSV</button>
          <button class="btn" data-action="wiz-open">Importer depuis un autre site…</button>
          <button class="btn" data-action="words">Voir mes mots (${fmtN(c.total + c.aside)})</button>
        </div>
        <details>
          <summary>Packs de démarrage</summary>
          <p class="muted small">Ajoute des cartes toutes prêtes (jamais de remplacement, seulement de l'ajout — comme un import CSV classique).</p>
          <div class="actions">
            <button class="btn" data-action="starter-vocab">📦 Vocabulaire de base (1000 mots)</button>
            <button class="btn" data-action="starter-kanji">🈶 Kanji de base (145 kanjis)</button>
          </div>
        </details>
        <details>
          <summary>Données</summary>
          <p class="muted small">Chaque carte est enregistrée dès que vous la validez, sur cet appareil : pas besoin de réimporter le CSV ni de sauvegarder à la main.</p>
          <div class="actions">
            <button class="btn" data-action="export-json">Exporter une sauvegarde</button>
            <button class="btn" data-action="import-json">Restaurer une sauvegarde</button>
            <button class="btn danger" data-action="reset">Tout réinitialiser</button>
          </div>
        </details>
      </section>

      ${FJ.syncUi.phase === 'signedin' ? `<section class="panel notes" id="notesBox">${notesInner()}</section>` : ''}

      <section class="panel sync-panel" id="syncBox">${syncInner()}</section>`;
  }

  // ---------- Session ----------
  const heatOf = (n) => (n >= 20 ? 4 : n >= 10 ? 3 : n >= 5 ? 2 : n >= 3 ? 1 : 0);

  function startSession(track) {
    const q = buildQueue(track);
    if (!q.items.length) return;
    settingsOpen = false; // au retour de la session, le tiroir des réglages est refermé
    sess = {
      track,
      queue: q.items,
      idx: 0,
      total: q.items.length,
      done: new Set(),
      flipped: false,
      busy: false,
      combo: 0,
      bestCombo: 0,
      bump: false,
      xp: 0,
      startXp: store.state.stats.xp,
      ok: 0,
      ko: 0,
      ms: 0,
      counted: false,
      levelUps: [],
      cardStart: 0,
    };
    renderSession();
  }

  // Chaque face porte l'image de son côté (recto_image / verso_image). En Kanji Only, l'image éventuelle est au verso.
  function faces(card) {
    if (sess.track === 'kanji') {
      const kv = kanji.view(card);
      return { q: kv.front, a: kv.back, qi: '', ai: card.rimg || card.vimg || '' };
    }
    return store.state.settings.reverse
      ? { q: card.verso, a: card.recto, qi: card.vimg, ai: card.rimg }
      : { q: card.recto, a: card.verso, qi: card.rimg, ai: card.vimg };
  }

  function renderSession() {
    if ('speechSynthesis' in window) speechSynthesis.cancel(); // pas de lecture qui continue sur la carte suivante
    if (sess.idx >= sess.queue.length) return sess.done.size ? renderSummary() : (sess = null, renderHome());
    view = 'session';
    sess.flipped = false;
    sess.busy = false;
    sess.cardStart = Date.now();

    const item = sess.queue[sess.idx];
    const card = store.byId(item.id);
    const { q, a, qi, ai } = faces(card);
    const p = store.progress(card, sess.track);
    const tag = (sess.track === 'kanji' ? '漢 ' : '') + (item.practice ? 'À repasser' : p.stage === 0 ? 'Nouvelle' : `Étape ${p.stage}/${srs.VALIDATED}`);
    const pct = Math.round((sess.done.size / sess.total) * 100);

    $('#app').innerHTML = `
      <section class="session" data-heat="${heatOf(sess.combo)}">
        <div class="s-top">
          <button class="btn ghost" data-action="quit">✕ Terminer</button>
          <span class="s-count">${sess.done.size} / ${sess.total}</span>
          <span class="combo" id="combo"></span>
        </div>
        <div class="bar thin"><div class="fill" style="width:${pct}%"></div></div>
        <div class="scene" id="scene">
          <div class="fcard${sess.track === 'kanji' ? ' kanji' : ''}" id="fcard" role="button" tabindex="0" aria-label="Retourner la carte" data-action="flip">
            <div class="face front"><span class="tag">${tag}</span>${speakBtn(q)}${imgHtml(qi)}${textBlock(q)}</div>
            <div class="face back">${speakBtn(a)}${card.emoji ? `<div class="card-emoji" aria-hidden="true">${esc(card.emoji)}</div>` : ''}${imgHtml(ai)}${textBlock(a)}</div>
          </div>
        </div>
        <div class="controls" id="controls"></div>
        <div class="controls-extra" id="controlsExtra"></div>
        <div class="tools">
          <button class="btn ghost small-text" id="prioBtn" data-action="prio"></button>
          <button class="btn ghost small-text" data-action="master" title="Je maîtrise ce mot : il ne reviendra plus en révision">✓ Masterisé</button>
          <button class="btn ghost small-text" data-action="aside" title="Retire cette carte des sessions ; récupérable dans Mes mots">⏸ De côté</button>
        </div>
        <p class="hint">Espace : retourner · ← à revoir · ↓ repasser · → je savais</p>
      </section>`;
    renderControls();
    updateCombo(sess.bump);
    sess.bump = false;
    updatePrioBtn(card);
  }

  // "Je savais le mot mais pas son kanji" : proposé en révision classique, sur une vraie révision (pas une repasse),
  // pour une carte qui a une version Kanji Only.
  function canNoKanji() {
    if (!sess || sess.track !== 'main') return false;
    const item = sess.queue[sess.idx];
    const card = item && store.byId(item.id);
    return !!card && !item.practice && !!kanji.view(card);
  }

  function renderControls() {
    $('#controls').innerHTML = sess.flipped
      ? `<button class="btn ko big" data-action="ko">✗ À revoir</button>
         <button class="btn big small" data-action="skip" title="Repasser à la fin de la boucle" aria-label="Repasser à la fin">↻</button>
         <button class="btn ok big" data-action="ok">✓ Je savais</button>`
      : `<button class="btn primary big" data-action="flip">Retourner</button>
         <button class="btn big small" data-action="skip" title="Repasser à la fin de la boucle" aria-label="Repasser à la fin">↻</button>`;
    $('#controlsExtra').innerHTML = sess.flipped && canNoKanji()
      ? '<button class="btn kanji-miss" data-action="ok-kanji" title="Réussi en révision classique, et ce mot passe en priorité dans Kanji Only">✓ Je savais, mais pas le kanji <span lang="ja">漢</span></button>'
      : '';
  }

  // Ce mot a été réussi en classique mais pas son kanji : il passe en tête de la prochaine session Kanji Only,
  // à réviser tout de suite. Sa progression Kanji déjà validée repart de l'étape 1.
  function flagKanjiPriority(card, now) {
    const kp = store.ensureProgress(card, 'kanji');
    if (kp.stage >= srs.VALIDATED) kp.stage = 1;
    if (kp.stage >= 1) kp.due = now;
    card.kprio = true;
  }

  function updatePrioBtn(card) {
    const b = $('#prioBtn');
    if (b) b.textContent = card.prio ? '★ Prioritaire' : '☆ Priorité';
  }

  // Le combo "s'échauffe" : taille, couleur, lueur autour de la carte et flammes montent avec le score.
  function updateCombo(bump) {
    const el = $('#combo');
    if (!el) return;
    const h = heatOf(sess.combo);
    $('.session').dataset.heat = h;
    el.dataset.heat = h;
    el.textContent = h ? `${h >= 2 ? '🔥'.repeat(Math.min(h - 1, 2)) + ' ' : ''}${h <= 2 ? 'Combo ' : ''}×${sess.combo}` : '';
    el.title = h ? `Combo ×${sess.combo}` : '';
    el.classList.toggle('shake', sess.combo > 10); // au-delà de 10, le combo tremble
    if (bump && h) {
      el.classList.add('bump');
      setTimeout(() => el.classList.remove('bump'), 500); // laisse la place au tremblement ensuite
    }
  }

  function flip() {
    if (!sess || sess.flipped || sess.busy) return;
    sess.flipped = true;
    $('#fcard').classList.add('flipped');
    $('#fcard').setAttribute('aria-label', 'Carte retournée');
    renderControls();
    audio.play('flip');
  }

  // Le pop-up vit hors de l'écran de session : il continue de flotter pendant que la carte suivante s'affiche.
  function pop(main, sub, kind) {
    const rect = $('#scene').getBoundingClientRect();
    const el = document.createElement('div');
    el.className = 'xp-pop' + (kind ? ' ' + kind : '');
    el.style.left = rect.left + rect.width / 2 + 'px';
    el.style.top = rect.top + 30 + 'px';
    el.innerHTML = `<b>${esc(main)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), POP_DURATION + 100);
  }

  function addTime(ms) {
    const capped = Math.min(ms, CARD_TIME_CAP);
    store.state.stats.ms += capped;
    store.today().ms += capped;
    sess.ms += capped;
  }

  function advance() {
    setTimeout(() => {
      if (!sess || view !== 'session') return;
      sess.idx++;
      renderSession();
    }, ADVANCE_DELAY);
  }

  // kind : 'ok' | 'ko' | 'skip' | 'ok-kanji' (réussi, mais le kanji est à retravailler)
  function grade(kind) {
    if (!sess || sess.busy) return;
    if (kind !== 'skip' && !sess.flipped) return;
    if (kind === 'ok-kanji' && !canNoKanji()) return;
    sess.busy = true;

    const s = store.state;
    const now = Date.now();
    const item = sess.queue[sess.idx];
    const card = store.byId(item.id);
    addTime(now - sess.cardStart);

    let sound = 'skip';
    let flash = '';

    if (kind === 'skip') {
      sess.queue.push({ id: item.id, practice: item.practice });
    } else {
      const ok = kind === 'ok' || kind === 'ok-kanji';
      flash = ok ? 'flash-ok' : 'flash-ko';
      sound = ok ? 'ok' : 'ko';

      if (item.practice) {
        // Repasse de fin de boucle : entraînement, sans effet sur le planning ni sur l'XP.
        if (!ok) sess.queue.push({ id: item.id, practice: true });
        pop(ok ? 'Bien vu !' : 'On la reverra', '', ok ? '' : 'miss');
      } else {
        if (!sess.counted) { sess.counted = true; s.stats.sessions++; }
        sess.combo = ok ? sess.combo + 1 : 0;
        sess.bestCombo = Math.max(sess.bestCombo, sess.combo);
        sess.bump = ok;

        const r = srs.review(store.ensureProgress(card, sess.track), ok, now);
        const xp = srs.xpFor(r, ok, sess.combo);
        s.stats.reviews++;
        store.today().reviews++;
        gainXp(xp);
        ok ? sess.ok++ : sess.ko++;
        sess.done.add(item.id);
        if (!ok) sess.queue.push({ id: item.id, practice: true });
        if (sess.track === 'kanji') delete card.kprio; // la priorité Kanji ne dure que jusqu'à cette révision
        if (kind === 'ok-kanji') flagKanjiPriority(card, now);

        if (kind === 'ok-kanji') pop(`+${xp} XP`, `Revient ${srs.fmtDue(r.due, now)} · kanji en priorité`);
        else if (ok) pop(`+${xp} XP`, r.validated ? 'Carte validée !' : `Revient ${srs.fmtDue(r.due, now)}`);
        else pop('À revoir', `Revient ${srs.fmtDue(r.due, now)}`, 'miss');
        if (r.validated) sound = 'validated';
      }
    }

    persist();
    audio.play(sound);
    if (flash) $('#fcard').classList.add(flash);
    updateCombo(false);
    advance();
  }

  // Ajoute de l'XP partout où elle est affichée (total, jour, session) et annonce les niveaux / rangs gagnés.
  function gainXp(xp) {
    if (!xp) return;
    const s = store.state;
    const before = levels.fromXp(s.stats.xp);
    s.stats.xp += xp;
    store.today().xp += xp;
    if (sess) sess.xp += xp;
    const after = levels.fromXp(s.stats.xp);
    updateHeader(after.level > before.level);
    if (after.level > before.level) {
      if (sess) sess.levelUps.push(after.level);
      const newTier = after.tier > before.tier;
      toast(newTier
        ? `Niveau ${after.level} · nouveau rang ${after.tierInfo.name} ${after.tierInfo.kanji}`
        : `Niveau ${after.level} : ${after.title}`, true);
      setTimeout(() => audio.play('levelup'), 350);
      FJ.fx.confetti({ count: newTier ? 160 : 70 });
    }
  }

  // Sort la carte courante de la file de session (mise de côté ou masterisée).
  function leaveSession(card) {
    sess.queue = sess.queue.filter((it, i) => i <= sess.idx || it.id !== card.id);
    if (!sess.done.has(card.id)) sess.total--;
  }

  // Retire la carte courante des sessions (récupérable depuis "Mes mots").
  function setAside() {
    if (!sess || sess.busy) return;
    sess.busy = true;
    const card = store.byId(sess.queue[sess.idx].id);
    addTime(Date.now() - sess.cardStart);
    card.state = 'aside';
    leaveSession(card);
    persist();
    toast('Carte mise de côté · à retrouver dans Mes mots');
    audio.play('skip');
    advance();
  }

  // "Masterisé" : le mot est parfaitement maîtrisé. Il sort de toutes les pistes de révision et rapporte MASTER_XP
  // (une seule fois par carte, même si on le remet ensuite en révision). Toujours après confirmation.
  async function confirmMaster(card) {
    const title = card.recto.split('\n')[0];
    const gain = card.masterXp ? 0 : MASTER_XP;
    return askConfirm({
      title: 'Marquer comme masterisé ?',
      text: `« ${title} » ne sera plus jamais proposé en révision (ni en Kanji Only)` +
        (gain ? ` et vous gagnez ${gain} XP.` : '. (Vous avez déjà reçu l\'XP de ce mot.)') +
        ' Vous pourrez le remettre en révision depuis Mes mots.',
      ok: gain ? `Oui, +${gain} XP` : 'Oui, masteriser',
    });
  }

  function applyMaster(card) {
    const xp = card.masterXp ? 0 : MASTER_XP;
    card.state = 'mastered';
    card.masterXp = true;
    return xp;
  }

  async function masterFromSession() {
    if (!sess || sess.busy) return;
    sess.busy = true; // bloque les réponses pendant la fenêtre de confirmation
    const card = store.byId(sess.queue[sess.idx].id);
    if (!(await confirmMaster(card))) { sess.busy = false; return; }
    addTime(Date.now() - sess.cardStart);
    const xp = applyMaster(card);
    leaveSession(card);
    gainXp(xp);
    persist();
    audio.play('master');
    pop(xp ? `+${xp} XP` : 'Masterisé', 'Mot masterisé !');
    FJ.fx.confetti({ count: 50 });
    advance();
  }

  function togglePrio() {
    if (!sess) return;
    const card = store.byId(sess.queue[sess.idx].id);
    card.prio = !card.prio;
    persist();
    updatePrioBtn(card);
  }

  function quitSession() {
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    // Le temps de la carte en cours compte : il n'y a de "temps passé" que pendant une session.
    if (sess && view === 'session' && !sess.busy) { addTime(Date.now() - sess.cardStart); persist(); }
    if (sess && sess.done.size) return renderSummary();
    sess = null;
    renderHome();
  }

  function renderSummary() {
    view = 'summary';
    const done = sess.done.size;
    const rate = sess.ok + sess.ko ? Math.round((sess.ok / (sess.ok + sess.ko)) * 100) : 0;
    const more = buildQueue(sess.track).items.length > 0;
    const lastLevel = sess.levelUps[sess.levelUps.length - 1];

    // Étoiles selon la réussite (sans pression : une étoile minimum) + niveau atteint avec barre animée
    const stars = rate >= 90 ? 3 : rate >= 70 ? 2 : 1;
    const headline = ['', 'Belle séance !', 'Bien joué !', 'Parfait !'][stars];
    const from = levels.fromXp(sess.startXp);
    const to = levels.fromXp(store.state.stats.xp);
    const startPct = to.level === from.level ? from.pct : 0;

    $('#app').innerHTML = `
      <section class="panel summary">
        <div class="stars" role="img" aria-label="${stars} étoile${stars > 1 ? 's' : ''} sur 3">
          ${[1, 2, 3].map((n) => `<i class="${n <= stars ? 'on' : ''}" style="--d:${0.15 + n * 0.22}s">★</i>`).join('')}
        </div>
        <h1>${headline}</h1>
        <p class="muted">${sess.track === 'kanji' ? 'Session Kanji · ' : ''}${plural(done, 'carte revue', 'cartes revues')}</p>
        ${lastLevel ? `<p class="lvl-up">Niveau ${lastLevel} atteint : ${esc(levels.titleOf(lastLevel))}</p>` : ''}
        <div class="lvl-block">
          <div class="lvl-line"><span>Niveau ${to.level} · ${esc(to.title)}</span><span>${fmtN(to.into)} / ${fmtN(to.need)} XP</span></div>
          <div class="bar"><div class="fill" id="sumFill" style="width:${startPct}%"></div></div>
        </div>
        <div class="tiles">
          <div class="tile gold"><b id="sumXp">+0</b><small>XP gagnés</small></div>
          <div class="tile"><b>${rate} %</b><small>réussite</small></div>
          <div class="tile"><b>${srs.fmtDuration(sess.ms)}</b><small>temps passé</small></div>
          <div class="tile"><b>×${sess.bestCombo}</b><small>meilleur combo</small></div>
        </div>
        <div class="actions" style="justify-content:center">
          <button class="btn primary" data-action="home">Retour à l'accueil</button>
          ${more ? `<button class="btn" data-action="start" data-track="${sess.track}">Nouvelle session</button>` : ''}
        </div>
      </section>`;

    document.querySelectorAll('.xp-pop').forEach((el) => el.remove()); // évite un pop-up qui flotte sur le bilan

    // Fête : fanfare, confettis (plus généreux si la séance est réussie), XP qui monte, barre qui se remplit
    audio.play('victory');
    FJ.fx.confetti({ count: [0, 70, 120, 180][stars] });
    FJ.fx.countUp($('#sumXp'), sess.xp, 1000, '+');
    setTimeout(() => { const f = $('#sumFill'); if (f) f.style.width = to.pct + '%'; }, 80);
  }

  // ---------- Ajouter une carte à la main ----------
  let addedThisSession = []; // {recto, verso} les plus récentes en premier, pour la relecture rapide
  let addKanjiMode = 'auto'; // 'auto' | 'force' | 'off' — voir card.kanjiForce dans js/kanji.js

  const KANJI_MODES = [['auto', 'Auto'], ['force', 'Kanji'], ['off', 'Classique']];

  function renderAddCard() {
    view = 'add';
    addKanjiMode = 'auto';
    $('#app').innerHTML = `
      <section class="panel">
        <div class="words-head">
          <button class="btn ghost" data-action="home">← Accueil</button>
          <h2 style="margin:0">Ajouter une carte</h2>
        </div>
        <form id="addForm" class="add-form">
          <label for="addRecto">Recto (français)</label>
          <input id="addRecto" type="text" lang="fr" autocomplete="off" autocapitalize="sentences" placeholder="Ex. Manger">
          <label for="addVerso">Verso (japonais)</label>
          <input id="addVerso" type="text" lang="ja" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Ex. たべる">
          <p class="muted small">Sur téléphone, le clavier passe en japonais tout seul si vous avez installé un clavier japonais (Gboard : Réglages → Langues → 日本語). Sur PC, basculez votre clavier système (ex. Windows + Barre d'espace, ou l'IME que vous utilisez).</p>
          <label for="addEmoji">Emoji (facultatif)</label>
          <input id="addEmoji" type="text" autocomplete="off" placeholder="🍚" maxlength="8" class="add-emoji">
          <label for="addCat">Catégorie (leçon, thème…)</label>
          <div id="addCatWrap">${catPickerHtml('addCat', store.state.settings.addCat || '')}</div>
          <label>Kanji Only</label>
          <div class="segment" role="group" aria-label="Présence dans Kanji Only">
            ${KANJI_MODES.map(([k, l]) => `<button type="button" data-action="add-kanji-mode" data-val="${k}" aria-pressed="${addKanjiMode === k}">${l}</button>`).join('')}
          </div>
          <p class="muted small" id="addKanjiHint"></p>
          <button class="btn primary big" type="submit">Ajouter la carte</button>
        </form>
      </section>
      <section class="panel" id="addRecent"></section>`;
    renderAddRecent();
    updateAddPreview();
    $('#addRecto').focus();
  }

  // Sélecteur de catégorie réutilisable (ajout et modification de carte) : catégories existantes + création à la volée.
  function catPickerHtml(id, current) {
    const opts = ['<option value="">Sans catégorie</option>']
      .concat(store.categoryList().filter((e) => e.key !== '').map((e) => `<option value="${esc(e.key)}"${e.key === current ? ' selected' : ''}>${esc(e.key)}</option>`));
    opts.push('<option value="__new__">＋ Nouvelle catégorie…</option>');
    return `<select id="${id}" data-catpicker="${id}Text">${opts.join('')}</select>
      <input id="${id}Text" type="text" maxlength="60" placeholder="Nom de la nouvelle catégorie" autocomplete="off" hidden>`;
  }

  // Lit le choix : { cat, isNew } ou { error }
  function readCatPicker(id) {
    const value = $('#' + id).value;
    if (value !== '__new__') return { cat: value, isNew: false };
    const name = FJ.csv.cleanCategory($('#' + id + 'Text').value);
    if (!name) return { error: 'Donnez un nom à la nouvelle catégorie.' };
    return { cat: name, isNew: !store.categoryList().some((e) => e.key === name) };
  }

  const ADD_KANJI_HINTS = {
    auto: "Elle rejoint Kanji Only toute seule si elle contient un kanji reconnu comme un mot.",
    force: "Elle sera toujours proposée dans Kanji Only, même si sa forme ressemble à une phrase.",
    off: "Elle n'apparaîtra jamais dans Kanji Only, même si elle contient un kanji.",
  };

  // Aperçu en direct de ce que donnerait la carte dans Kanji Only, pour que le choix Auto/Kanji/Classique soit concret.
  function updateAddPreview() {
    const box = $('#addKanjiHint');
    if (!box) return;
    const recto = $('#addRecto').value.trim();
    const verso = $('#addVerso').value.trim();
    let extra = '';
    if (recto && verso) {
      const fake = { id: '_preview', recto: FJ.csv.clean(recto), verso: FJ.csv.clean(verso), kanjiForce: addKanjiMode === 'off' ? false : addKanjiMode === 'force' ? true : undefined };
      const v = kanji.view(fake);
      extra = v ? ` Aperçu : ${v.front} → ${v.back.split('\n').join(' / ')}` : addKanjiMode === 'off' ? '' : ' Aucun kanji détecté dans cette carte pour le moment.';
    }
    box.textContent = ADD_KANJI_HINTS[addKanjiMode] + extra;
  }

  function renderAddRecent() {
    const box = $('#addRecent');
    if (!box) return;
    if (!addedThisSession.length) { box.innerHTML = '<p class="muted small" style="text-align:center">Les cartes que vous ajoutez apparaissent ici.</p>'; return; }
    box.innerHTML = '<h2>Ajoutées à l\'instant</h2>' + addedThisSession.slice(0, 12).map((c) =>
      `<div class="word"><div class="word-main" style="cursor:default"><div class="w-text">
        <div class="w-a" lang="${lang(c.recto)}">${c.emoji ? esc(c.emoji) + ' ' : ''}${esc(c.recto)}</div>
        <div class="w-b" lang="${lang(c.verso)}">${esc(c.verso)}</div>
      </div></div></div>`
    ).join('');
  }

  // Remise à zéro du sélecteur Kanji Only : appelée après tout essai d'ajout (réussi ou non), pour qu'un réglage
  // "Kanji" ou "Classique" ne reste jamais collé sur la carte suivante par erreur.
  function resetAddKanjiMode() {
    addKanjiMode = 'auto';
    document.querySelectorAll('[data-action="add-kanji-mode"]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.val === 'auto')));
    updateAddPreview();
  }

  function submitAddCard(e) {
    e.preventDefault();
    const recto = FJ.csv.clean($('#addRecto').value);
    const verso = FJ.csv.clean($('#addVerso').value);
    const emoji = FJ.csv.clean($('#addEmoji').value);
    if (!recto || !verso) return toast('Le recto et le verso sont obligatoires.');
    const pick = readCatPicker('addCat');
    if (pick.error) return toast(pick.error);
    const card = { id: FJ.csv.cardId(recto, verso), recto, verso };
    if (emoji) card.emoji = emoji;
    if (pick.cat) card.cat = pick.cat;
    if (addKanjiMode === 'force') card.kanjiForce = true;
    else if (addKanjiMode === 'off') card.kanjiForce = false;
    const { added, duplicates } = store.addCards([card]);
    if (!added) { toast(duplicates ? 'Cette carte existe déjà.' : 'Carte non ajoutée.'); resetAddKanjiMode(); return; }
    // La catégorie reste sélectionnée pour enchaîner plusieurs cartes d'une même leçon. Une catégorie qu'on vient de
    // créer rejoint la sélection en cours (sinon la carte n'apparaîtrait jamais dans les révisions).
    const s = store.state.settings;
    s.addCat = pick.cat;
    if (pick.isNew && s.catPool) s.catPool = [...s.catPool, pick.cat];
    persist();
    $('#addCatWrap').innerHTML = catPickerHtml('addCat', pick.cat);
    addedThisSession.unshift({ recto, verso, emoji });
    renderAddRecent();
    toast('Carte ajoutée ✓');
    $('#addRecto').value = '';
    $('#addVerso').value = '';
    $('#addEmoji').value = '';
    resetAddKanjiMode();
    $('#addRecto').focus();
  }

  // ---------- Assistant d'import (exports d'autres sites : Anki, Quizlet, Excel…) ----------
  // Tout se passe dans le navigateur, rien n'est envoyé nulle part. Le fichier est lu, on devine séparateur,
  // encodage et en-tête, l'utilisateur choisit le rôle de chaque colonne sur un aperçu, puis les cartes passent par le
  // même import additif que d'habitude (runImport).
  const WIZ_ROLES = [['recto', 'Recto'], ['verso', 'Verso'], ['emoji', 'Emoji'], ['cat', 'Catégorie'], ['ignore', 'Ignorer']];
  const WIZ_DELIMS = [['\t', 'Tabulation'], [',', 'Virgule'], [';', 'Point-virgule'], ['|', 'Barre verticale |']];
  const WIZ_ENCODINGS = [['utf-8', 'UTF-8'], ['windows-1252', 'Windows (Excel européen)'], ['shift_jis', 'Shift-JIS (japonais)'], ['euc-jp', 'EUC-JP (japonais)']];
  let wiz = null;

  function decodeEntities(s) {
    const t = document.createElement('textarea'); // contenu non interprété : seules les entités (&amp;, &#39;…) sont décodées
    t.innerHTML = s.replace(/</g, '&lt;');
    return t.value;
  }

  // Nettoyage d'une cellule : balises HTML, [sound:…] d'Anki, entités, espaces
  function wizClean(s) {
    return decodeEntities(FJ.csv.clean(String(s || '').replace(/\[sound:[^\]]*\]/gi, ''))).trim();
  }

  const decodeBuf = (buf, enc) => new TextDecoder(enc).decode(buf);

  function guessEncoding(buf) {
    if (!decodeBuf(buf, 'utf-8').includes('�')) return 'utf-8';
    const sj = decodeBuf(buf, 'shift_jis');
    if (!sj.includes('�') && /[぀-ヿ一-鿿]/.test(sj)) return 'shift_jis';
    return 'windows-1252';
  }

  // Séparateur le plus régulier sur les 20 premières lignes (même nombre d'occurrences d'une ligne à l'autre)
  function detectDelim(lines) {
    const sample = lines.filter((l) => l.trim()).slice(0, 20);
    let best = ',';
    let bestScore = 0;
    for (const d of ['\t', ';', ',', '|']) {
      const counts = sample.map((l) => l.split(d).length - 1).sort((a, b) => a - b);
      const mode = counts[Math.floor(counts.length / 2)];
      if (!mode) continue;
      const score = counts.filter((n) => n === mode).length;
      if (score > bestScore) { best = d; bestScore = score; }
    }
    return best;
  }

  // Rôle deviné d'après le nom d'une colonne d'en-tête (null si inconnu)
  function wizRole(name) {
    const h = String(name || '').trim().toLowerCase();
    const H = FJ.csv.HEADERS;
    if (H.recto.includes(h) || ['term', 'terme', 'mot', 'word', 'français', 'francais', 'french'].includes(h)) return 'recto';
    if (H.verso.includes(h) || ['definition', 'définition', 'traduction', 'translation', 'japonais', 'japanese', 'meaning', 'sens'].includes(h)) return 'verso';
    if (['emoji', 'émoji'].includes(h)) return 'emoji';
    if (H.cat.includes(h)) return 'cat';
    return null;
  }

  const looksLikeHeader = (row) => row.some((h) => wizRole(h));

  // Ouvre l'assistant : sans argument = choix de la source ; avec un tampon (fichier) ou du texte collé = analyse.
  function wizSetSource(source, enc) {
    let raw;
    let buf = null;
    if (typeof source === 'string') raw = source;
    else if (source) { buf = source; enc = enc || guessEncoding(buf); raw = decodeBuf(buf, enc); }
    if (raw === undefined) { wiz = { stage: 'source' }; return renderWizard(); }

    // En-tête Anki : lignes "#separator:tab", "#html:true"… en tête de fichier
    const lines = raw.replace(/^﻿/, '').split(/\r?\n/);
    let i = 0;
    let sep = null;
    while (i < lines.length && lines[i].startsWith('#')) {
      const m = lines[i].match(/^#separator:(.+)$/i);
      if (m) sep = m[1].trim().toLowerCase();
      i++;
    }
    const named = { tab: '\t', comma: ',', semicolon: ';', pipe: '|' };
    const body = lines.slice(i).join('\n');
    wiz = { stage: 'map', buf, enc: enc || 'utf-8', delim: named[sep] || detectDelim(lines.slice(i)), body, swap: false };
    wizReparse(true);
    renderWizard();
  }

  function wizReparse(detectHeader) {
    wiz.rows = FJ.csv.parseRows(wiz.body, wiz.delim).filter((r) => r.some((v) => v.trim() !== ''));
    wiz.cols = wiz.rows.slice(0, 50).reduce((n, r) => Math.max(n, r.length), 0);
    if (detectHeader) wiz.header = wiz.rows.length > 0 && looksLikeHeader(wiz.rows[0]);
    wizAutoMap();
  }

  // Rôle de chaque colonne : d'après l'en-tête s'il est reconnu, sinon 1re colonne = recto, 2e = verso
  function wizAutoMap() {
    const head = wiz.header && wiz.rows[0] ? wiz.rows[0] : [];
    const map = Array.from({ length: wiz.cols }, (_, i) => (head[i] ? wizRole(head[i]) : null));
    if (!map.includes('recto') && !map.includes('verso')) {
      map.fill(null);
      if (wiz.cols >= 1) map[0] = 'recto';
      if (wiz.cols >= 2) map[1] = 'verso';
    } else {
      const free = () => map.findIndex((r) => !r);
      if (!map.includes('verso') && free() >= 0) map[free()] = 'verso';
      if (!map.includes('recto') && free() >= 0) map[free()] = 'recto';
    }
    wiz.map = map.map((r) => r || 'ignore');
  }

  // Cartes que produirait l'import avec les réglages actuels
  function wizBuild() {
    const data = wiz.header ? wiz.rows.slice(1) : wiz.rows;
    const ri = wiz.map.indexOf('recto');
    const vi = wiz.map.indexOf('verso');
    const ei = wiz.map.indexOf('emoji');
    const ci = wiz.map.indexOf('cat');
    const cards = [];
    const seen = new Set();
    let skipped = 0;
    let repeated = 0;
    for (const row of data) {
      if (ri < 0 || vi < 0) { skipped++; continue; }
      let a = wizClean(row[ri]);
      let b = wizClean(row[vi]);
      if (wiz.swap) [a, b] = [b, a];
      if (!a || !b) { skipped++; continue; }
      const id = FJ.csv.cardId(a, b);
      if (seen.has(id)) { repeated++; continue; }
      seen.add(id);
      const card = { id, recto: a, verso: b };
      const emoji = ei >= 0 ? FJ.csv.cleanEmoji(row[ei]) : '';
      if (emoji) card.emoji = emoji;
      // Étiquettes d'Anki : "genki::L08" -> "genki › L08" ; "_" -> espace
      const cat = ci >= 0 ? FJ.csv.cleanCategory(wizClean(row[ci]).replace(/::/g, ' › ').replace(/_/g, ' ')) : '';
      if (cat) card.cat = cat;
      cards.push(card);
    }
    const known = new Set(store.state.cards.map((c) => c.recto + '\u0001' + c.verso));
    const existing = cards.filter((c) => store.map.has(c.id) || known.has(c.recto + '\u0001' + c.verso)).length;
    return { cards, skipped, repeated, existing };
  }

  function renderWizard() {
    view = 'import';
    if (!wiz || wiz.stage === 'source') {
      $('#app').innerHTML = `
        <section class="panel">
          <div class="words-head">
            <button class="btn ghost" data-action="home">← Accueil</button>
            <h2 style="margin:0">Importer depuis un autre site</h2>
          </div>
          <p class="muted small">Exportez vos cartes depuis Anki (« Notes en texte brut »), Quizlet (« Exporter »), Excel ou Google Sheets (CSV), puis ouvrez le fichier ici, ou collez son contenu. Rien n'est envoyé sur internet.</p>
          <div class="actions"><button class="btn primary" data-action="wiz-file">Choisir un fichier…</button></div>
          <div class="add-form" style="margin-top:14px">
            <label for="wizPaste">… ou collez le contenu</label>
            <textarea id="wizPaste" rows="6" placeholder="mot[Tab]traduction, un par ligne"></textarea>
            <button class="btn" data-action="wiz-paste">Analyser</button>
          </div>
        </section>`;
      return;
    }
    const opt = (list, cur) => list.map(([k, l]) => `<option value="${esc(k)}"${k === cur ? ' selected' : ''}>${esc(l)}</option>`).join('');
    $('#app').innerHTML = `
      <section class="panel">
        <div class="words-head">
          <button class="btn ghost" data-action="home">← Accueil</button>
          <h2 style="margin:0">Importer depuis un autre site</h2>
        </div>
        <div class="add-form">
          <label for="wizPreset">Format du fichier</label>
          <select id="wizPreset">
            <option value="auto">Détection automatique</option>
            <option value="anki">Anki : « Notes en texte brut »</option>
            <option value="quizlet">Quizlet : export texte</option>
            <option value="sheet">Excel / Google Sheets (CSV)</option>
          </select>
          <label for="wizDelim">Séparateur de colonnes</label>
          <select id="wizDelim">${opt(WIZ_DELIMS, wiz.delim)}</select>
          ${wiz.buf ? `<label for="wizEnc">Encodage du fichier</label><select id="wizEnc">${opt(WIZ_ENCODINGS, wiz.enc)}</select>` : ''}
          <label class="checkbox-row"><input type="checkbox" id="wizHeader"${wiz.header ? ' checked' : ''}> La première ligne est un en-tête</label>
          <label class="checkbox-row"><input type="checkbox" id="wizSwap"${wiz.swap ? ' checked' : ''}> Inverser recto et verso</label>
          <label for="wizCat">Catégorie des cartes du fichier qui n'en ont pas</label>
          ${catPickerHtml('wizCat', '')}
        </div>
        <div id="wizDyn"></div>
        <button class="btn ghost" data-action="wiz-open" style="margin-top:10px">Changer de fichier</button>
      </section>`;
    updateWizard();
  }

  // Colonnes + aperçu + bouton d'import (recalculés à chaque changement de réglage)
  function updateWizard() {
    const box = $('#wizDyn');
    if (!box || !wiz || wiz.stage !== 'map') return;
    const b = wizBuild();
    wiz.built = b;
    const first = (t) => t.split('\n')[0];
    const data = wiz.header ? wiz.rows.slice(1) : wiz.rows;
    const example = (i) => (data[0] && data[0][i] ? wizClean(data[0][i]).slice(0, 28) : '');
    box.innerHTML = `
      <h2>Colonnes</h2>
      <div class="wiz-cols">${wiz.map.map((role, i) => `
        <div class="wiz-col"><span class="muted small">Colonne ${i + 1}${example(i) ? ` · ${esc(example(i))}` : ''}</span>
          <select data-wizcol="${i}">${WIZ_ROLES.map(([k, l]) => `<option value="${k}"${k === role ? ' selected' : ''}>${l}</option>`).join('')}</select></div>`).join('')}
      </div>
      <h2 style="margin-top:14px">Aperçu</h2>
      ${b.cards.slice(0, 6).map((c) => `<div class="word"><div class="word-main" style="cursor:default"><div class="w-text">
          <div class="w-a" lang="${lang(first(c.recto))}">${c.emoji ? esc(c.emoji) + ' ' : ''}${esc(first(c.recto))}</div>
          <div class="w-b" lang="${lang(first(c.verso))}">${esc(first(c.verso))}${c.cat ? ` <span class="w-cat">· ${esc(c.cat)}</span>` : ''}</div>
        </div></div></div>`).join('') || '<p class="muted small">Aucune carte valide pour l\'instant : vérifiez qu\'une colonne est « Recto » et une autre « Verso ».</p>'}
      <p class="muted small">${plural(b.cards.length, 'carte prête', 'cartes prêtes')} · ${b.existing} déjà présente${b.existing > 1 ? 's' : ''} · ${plural(b.skipped, 'ligne incomplète', 'lignes incomplètes')}${b.repeated ? ` · ${b.repeated} répétée${b.repeated > 1 ? 's' : ''} dans le fichier` : ''}</p>
      <button class="btn primary big" data-action="wiz-import"${b.cards.length ? '' : ' disabled'}>Importer ${plural(b.cards.length, 'carte', 'cartes')}</button>`;
  }

  async function wizImport() {
    if (!wiz || !wiz.built || !wiz.built.cards.length) return;
    const pick = readCatPicker('wizCat');
    if (pick.error) return toast(pick.error);
    const cards = wiz.built.cards.map((c) => (pick.cat && !c.cat ? { ...c, cat: pick.cat } : c));
    const s = store.state.settings;
    if (pick.isNew && s.catPool) s.catPool = [...s.catPool, pick.cat];
    const parts = await runImport(cards);
    toast(parts.join(' · '));
    wiz = null;
    renderHome();
  }

  function wizPickFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,.tsv,.txt,text/csv,text/plain,text/tab-separated-values';
    input.onchange = async () => { if (input.files[0]) wizSetSource(await input.files[0].arrayBuffer()); };
    input.click();
  }

  // Préréglages : simples raccourcis vers des réglages usuels
  function wizPreset(name) {
    if (name === 'anki' || name === 'quizlet') {
      wiz.delim = '\t';
      wiz.header = false;
      wizReparse(false);
      wiz.map = wiz.map.map((_, i) => (i === 0 ? 'recto' : i === 1 ? 'verso' : 'ignore'));
    } else {
      wiz.delim = detectDelim(wiz.body.split(/\r?\n/));
      wizReparse(true);
    }
    renderWizard();
    $('#wizPreset').value = name;
  }

  // Changements de réglages de l'assistant (délégués depuis l'écouteur "change" global)
  function wizChange(el) {
    if (!wiz || wiz.stage !== 'map') return false;
    if (el.dataset.wizcol !== undefined) {
      const i = Number(el.dataset.wizcol);
      if (el.value !== 'ignore') wiz.map = wiz.map.map((r, j) => (j !== i && r === el.value ? 'ignore' : r)); // un seul rôle par type
      wiz.map[i] = el.value;
      updateWizard();
      return true;
    }
    switch (el.id) {
      case 'wizPreset': wizPreset(el.value); return true;
      case 'wizDelim': wiz.delim = el.value; wizReparse(false); updateWizard(); return true;
      case 'wizEnc': wizSetSource(wiz.buf, el.value); return true;
      case 'wizHeader': wiz.header = el.checked; wizAutoMap(); renderWizard(); return true;
      case 'wizSwap': wiz.swap = el.checked; updateWizard(); return true;
      default: return false;
    }
  }

  // ---------- Modifier une carte ----------
  // La carte garde son identifiant : modifier le texte ne perd pas la progression, et réimporter le CSV d'origine
  // ne recrée ni l'ancienne ni la nouvelle version (voir la détection de doublons dans store.addCards).
  let edit = null; // { id, kanjiMode, stage0, kstage0 }

  function stageOptions(current, withMastered) {
    const opts = [['0', 'Nouvelle']];
    for (let s = 1; s < srs.VALIDATED; s++) opts.push([String(s), `Étape ${s} · ${srs.STEPS[s - 1].label}`]);
    opts.push([String(srs.VALIDATED), 'Validée']);
    if (withMastered) opts.push(['mastered', 'Masterisée']);
    return opts.map(([v, l]) => `<option value="${v}"${current === v ? ' selected' : ''}>${l}</option>`).join('');
  }

  const masteryOf = (card) => (card.state === 'mastered' ? 'mastered' : String(card.stage || 0));

  function renderEditCard(id) {
    const card = store.byId(id);
    if (!card) return renderWords();
    view = 'edit';
    const kview = card.state !== 'mastered' && kanji.view(card) ? true : card.kanjiForce === true;
    edit = {
      id,
      kanjiMode: card.kanjiForce === true ? 'force' : card.kanjiForce === false ? 'off' : 'auto',
      stage0: masteryOf(card),
      kstage0: String((card.k && card.k.stage) || 0),
    };
    $('#app').innerHTML = `
      <section class="panel">
        <div class="words-head">
          <button class="btn ghost" data-action="edit-cancel">← Retour</button>
          <h2 style="margin:0">Modifier la carte</h2>
        </div>
        <form id="editForm" class="add-form">
          <label for="edRecto">Recto (français)</label>
          <textarea id="edRecto" rows="2" lang="fr" autocomplete="off">${esc(card.recto)}</textarea>
          <label for="edVerso">Verso (japonais, notes sur les lignes suivantes)</label>
          <textarea id="edVerso" rows="3" lang="ja" autocomplete="off" spellcheck="false">${esc(card.verso)}</textarea>
          <label for="edEmoji">Emoji (facultatif)</label>
          <input id="edEmoji" type="text" autocomplete="off" maxlength="8" class="add-emoji" value="${esc(card.emoji || '')}">
          <label for="edCat">Catégorie</label>
          <div>${catPickerHtml('edCat', card.cat || '')}</div>
          <label>Kanji Only</label>
          <div class="segment" role="group" aria-label="Présence dans Kanji Only">
            ${KANJI_MODES.map(([k, l]) => `<button type="button" data-action="edit-kanji-mode" data-val="${k}" aria-pressed="${edit.kanjiMode === k}">${l}</button>`).join('')}
          </div>
          <p class="muted small" id="edKanjiHint">${ADD_KANJI_HINTS[edit.kanjiMode]}</p>
          <label for="edStage">Maîtrise (révision classique)</label>
          <select id="edStage">${stageOptions(edit.stage0, true)}</select>
          ${kview ? `<label for="edKStage">Maîtrise (Kanji Only)</label>
          <select id="edKStage">${stageOptions(edit.kstage0, false)}</select>` : ''}
          <p class="muted small">Corriger une maîtrise ne rend et ne retire aucun XP. Une carte remise à une étape en cours revient en révision tout de suite.</p>
          <button class="btn primary big" type="submit">Enregistrer</button>
        </form>
      </section>`;
    $('#edRecto').focus();
  }

  // Change l'étape d'une carte (piste classique ou Kanji) : correction d'un accident, sans XP.
  function applyMastery(card, value, track) {
    if (value === 'mastered') { card.state = 'mastered'; card.masterXp = true; return; }
    if (track === 'main' && card.state === 'mastered') delete card.state; // on quitte l'état masterisé
    const p = store.ensureProgress(card, track);
    p.stage = Number(value);
    p.due = p.stage >= 1 && p.stage < srs.VALIDATED ? Date.now() : 0;
  }

  function submitEditCard(e) {
    e.preventDefault();
    const card = edit && store.byId(edit.id);
    if (!card) return renderWords();
    const recto = FJ.csv.clean($('#edRecto').value);
    const verso = FJ.csv.clean($('#edVerso').value);
    if (!recto || !verso) return toast('Le recto et le verso sont obligatoires.');
    if (store.state.cards.some((c) => c !== card && c.recto === recto && c.verso === verso)) return toast('Une autre carte a déjà ce recto et ce verso.');
    const pick = readCatPicker('edCat');
    if (pick.error) return toast(pick.error);

    card.recto = recto;
    card.verso = verso;
    const emoji = FJ.csv.clean($('#edEmoji').value);
    if (emoji) card.emoji = emoji; else delete card.emoji;
    if (pick.cat) card.cat = pick.cat; else delete card.cat;
    const s = store.state.settings;
    if (pick.isNew && s.catPool) s.catPool = [...s.catPool, pick.cat];
    if (edit.kanjiMode === 'force') card.kanjiForce = true;
    else if (edit.kanjiMode === 'off') card.kanjiForce = false;
    else delete card.kanjiForce;

    const stage = $('#edStage').value;
    if (stage !== edit.stage0) applyMastery(card, stage, 'main');
    const kstage = $('#edKStage');
    if (kstage && kstage.value !== edit.kstage0) applyMastery(card, kstage.value, 'kanji');

    persist();
    toast('Carte modifiée ✓');
    expandedId = card.id;
    edit = null;
    renderWords();
  }

  // ---------- Liste des mots ----------
  const FILTERS = [
    ['all', 'Tous'], ['fresh', 'Nouveaux'], ['learning', 'En cours'], ['validated', 'Validés'],
    ['prio', '★ Priorité'], ['kanji', '漢 Kanji'], ['mastered', '✓ Masterisés'], ['aside', 'De côté'], ['removed', 'Éliminés'],
  ];

  function matchesFilter(c) {
    if (wordsCat !== null && (c.cat || '') !== wordsCat) return false;
    if (['removed', 'aside', 'mastered'].includes(wordsFilter)) return c.state === wordsFilter;
    if (c.state === 'removed') return false;
    switch (wordsFilter) {
      case 'fresh': return !c.state && c.stage === 0;
      case 'learning': return !c.state && c.stage >= 1 && c.stage < srs.VALIDATED;
      case 'validated': return !c.state && c.stage >= srs.VALIDATED;
      case 'prio': return !!c.prio;
      case 'kanji': return !!kanji.view(c);
      default: return true;
    }
  }

  // Filtre par catégorie (affiché seulement si au moins une carte a une catégorie)
  function catFilterHtml() {
    const list = store.categoryList();
    if (!list.some((e) => e.key !== '')) return '';
    const opts = list.map((e) => `<option value="${esc(e.key)}"${wordsCat === e.key ? ' selected' : ''}>${esc(e.key || 'Sans catégorie')}</option>`).join('');
    return `<div class="cat-filter"><select id="wordsCat" aria-label="Catégorie"><option value="*">Toutes les catégories</option>${opts}</select></div>`;
  }

  function renderWords() {
    view = 'words';
    const cards = store.state.cards;
    const count = (f) => (['aside', 'removed', 'mastered'].includes(f) ? cards.filter((c) => c.state === f).length : null);
    $('#app').innerHTML = `
      <section class="panel">
        <div class="words-head">
          <button class="btn ghost" data-action="home">← Accueil</button>
          <input type="search" id="wordsSearch" placeholder="Rechercher…" value="${esc(wordsQuery)}" autocomplete="off">
        </div>
        <div class="chips">
          ${FILTERS.map(([k, l]) => `<button class="chip" data-action="words-filter" data-val="${k}" aria-pressed="${wordsFilter === k}">${l}${count(k) ? ` (${count(k)})` : ''}</button>`).join('')}
        </div>
        ${catFilterHtml()}
        <div id="wordsList"></div>
      </section>`;
    renderWordsList();
  }

  function renderWordsList() {
    const now = Date.now();
    const q = wordsQuery.trim().toLowerCase();
    const rows = store.state.cards.filter((c) => matchesFilter(c) && (!q || c.recto.toLowerCase().includes(q) || c.verso.toLowerCase().includes(q)));
    const shown = rows.slice(0, 300);
    const first = (t) => t.split('\n')[0];

    const row = (c) => {
      let pill = '<span class="pill">Nouveau</span>';
      if (c.stage >= srs.VALIDATED) pill = '<span class="pill done">Validé</span>';
      else if (c.stage >= 1) pill = `<span class="pill learning">Étape ${c.stage}/${srs.VALIDATED} · ${srs.fmtDue(c.due, now)}</span>`;
      if (c.state === 'aside') pill = '<span class="pill">De côté</span>';
      if (c.state === 'removed') pill = '<span class="pill">Éliminé</span>';
      if (c.state === 'mastered') pill = '<span class="pill done">✓ Masterisé</span>';
      const open = expandedId === c.id;
      const btn = (act, label, cls = '') => `<button class="btn ${cls}" data-action="${act}" data-id="${c.id}">${label}</button>`;
      let buttons;
      if (c.state === 'removed') buttons = btn('w-restore', '↩ Restaurer');
      else if (c.state === 'mastered') buttons = btn('w-edit', '✎ Modifier') + btn('w-unmaster', '↩ Remettre en révision') + btn('w-remove', '✕ Éliminer', 'danger');
      else {
        const kanjiLabel = c.kanjiForce === true ? '漢 Kanji Only : forcé' : c.kanjiForce === false ? '漢 Kanji Only : exclu' : '漢 Kanji Only : auto';
        buttons = btn('w-edit', '✎ Modifier') +
          btn('w-prio', c.prio ? '★ Retirer la priorité' : '☆ Priorité') +
          btn('w-master', '✓ Masterisé') +
          btn('w-kanji', kanjiLabel) +
          btn('w-aside', c.state === 'aside' ? '↩ Remettre dans le paquet' : '⏸ Mettre de côté') +
          btn('w-remove', '✕ Éliminer', 'danger');
      }
      const actions = open ? `<div class="w-actions">${buttons}</div>` : '';
      return `<div class="word${open ? ' open' : ''}">
        <div class="word-main" data-action="w-toggle" data-id="${c.id}" role="button" tabindex="0">
          <div class="w-text">
            <div class="w-a" lang="${lang(first(c.recto))}">${c.prio ? '<span class="star">★</span> ' : ''}${c.emoji ? esc(c.emoji) + ' ' : ''}${esc(first(c.recto))}</div>
            <div class="w-b" lang="${lang(first(c.verso))}">${esc(first(c.verso))}${c.cat ? ` <span class="w-cat">· ${esc(c.cat)}</span>` : ''}${c.kprio ? ' <span class="w-cat">· 漢 en priorité</span>' : ''}</div>
          </div>${pill}
        </div>${actions}</div>`;
    };

    $('#wordsList').innerHTML = rows.length
      ? shown.map(row).join('') + (rows.length > shown.length ? `<p class="muted" style="text-align:center">${rows.length - shown.length} autres — affinez la recherche.</p>` : '')
      : '<p class="muted" style="text-align:center">Aucun mot.</p>';
  }

  function wordAction(id, fn, msg) {
    const c = store.byId(id);
    if (!c) return;
    fn(c);
    persist();
    if (msg) toast(msg);
    renderWordsList();
  }

  // ---------- Paquets de mises à jour ----------
  // Le propriétaire publie des paquets (CSV) ; chacun décide de les intégrer. Le choix (intégré / plus tard) est
  // gardé dans les réglages, donc synchronisé entre appareils. L'intégration passe par runImport : additive.
  const packDraft = { open: false, title: '', desc: '', csv: '', count: 0, info: '' };
  const packUi = { allOpen: false };
  const MAX_PACK_BYTES = 900000; // un document Firestore est limité à 1 Mo

  const packList = () => (FJ.packsUi && FJ.packsUi.items) || [];
  const packStatus = (id) => store.state.settings.packs[id] || '';
  function setPackStatus(id, v) {
    const p = Object.assign({}, store.state.settings.packs);
    if (v) p[id] = v; else delete p[id];
    store.state.settings.packs = p;
    persist();
  }
  const packsVisible = () => FJ.syncUi.phase === 'signedin' && !!FJ.packsUi && (FJ.packsUi.items.length > 0 || FJ.packsUi.admin);

  function packRow(p, pending) {
    const st = packStatus(p.id);
    const badge = st === 'done' ? '<span class="pill done">✓ Intégré</span>' : st === 'later' ? '<span class="pill">Plus tard</span>' : '';
    return `<div class="pack">
      <div class="pack-head"><b>📦 ${esc(p.title)}</b>${badge}</div>
      <p class="muted small" style="margin:2px 0 0">${plural(p.count, 'carte', 'cartes')} · ${agoText(p.createdAt)}</p>
      ${p.desc ? `<p class="pack-desc">${esc(p.desc)}</p>` : ''}
      <div class="actions">
        <button class="btn" data-action="pack-view" data-id="${esc(p.id)}">Voir le contenu</button>
        <button class="btn primary" data-action="pack-integrate" data-id="${esc(p.id)}">${st === 'done' ? 'Réintégrer' : 'Intégrer'}</button>
        ${pending ? `<button class="btn ghost" data-action="pack-later" data-id="${esc(p.id)}">Plus tard</button>` : ''}
        ${FJ.packsUi.admin ? `<button class="btn ghost danger" data-action="pack-delete" data-id="${esc(p.id)}">Retirer</button>` : ''}
      </div></div>`;
  }

  function packAdminHtml() {
    const d = packDraft;
    return `<details id="packAdmin"${d.open ? ' open' : ''}>
      <summary>🛠 Publier un paquet (administrateur)</summary>
      <div class="add-form">
        <label for="packFile">Fichier CSV (même format que les packs de base)</label>
        <input type="file" id="packFile" accept=".csv,text/csv">
        <label for="packTitle">Titre</label>
        <input type="text" id="packTitle" maxlength="60" value="${esc(d.title)}" placeholder="Ex. Leçon 9 — la santé">
        <label for="packDesc">Description (facultatif)</label>
        <input type="text" id="packDesc" maxlength="140" value="${esc(d.desc)}" placeholder="Une phrase pour présenter le paquet">
        ${d.csv ? `<p class="muted small">${esc(d.info)}</p>
        <div class="actions">
          <button class="btn" data-action="pack-view" data-id="__draft">Aperçu</button>
          <button class="btn primary" data-action="pack-publish">Envoyer à tous</button>
        </div>` : ''}
      </div>
    </details>`;
  }

  function packsInner() {
    const items = packList();
    const pending = items.filter((p) => !packStatus(p.id));
    const head = pending.length
      ? `<h2>📦 Nouveau paquet disponible</h2><p class="muted small" style="margin:0 0 8px">Souhaitez-vous l'intégrer ? Vous pouvez d'abord en voir le contenu. Rien n'est remplacé : seules les cartes que vous n'avez pas encore sont ajoutées.</p>${pending.map((p) => packRow(p, true)).join('')}`
      : '<h2>📦 Mises à jour</h2>';
    const all = items.length
      ? `<details id="packsAll"${packUi.allOpen ? ' open' : ''}><summary>Toutes les mises à jour (${items.length})</summary>${items.map((p) => packRow(p, false)).join('')}</details>`
      : '<p class="muted small" style="margin:0">Aucun paquet publié pour le moment.</p>';
    return head + all + (FJ.packsUi.admin ? packAdminHtml() : '');
  }

  function refreshPacks() {
    const box = $('#packsBox');
    if (box) box.innerHTML = packsInner();
  }

  function packsChanged() {
    if (view !== 'home') return;
    if (!!$('#packsBox') !== packsVisible()) renderHome();
    else refreshPacks();
  }

  function ownedKeys() {
    return { ids: store.map, content: new Set(store.state.cards.map((c) => c.recto + '\u0001' + c.verso)) };
  }
  const isOwned = (c, o) => o.ids.has(c.id) || o.content.has(c.recto + '\u0001' + c.verso);

  async function readPackFile(file) {
    const text = await readText(file);
    if (text.length > MAX_PACK_BYTES) return toast('Fichier trop volumineux pour un paquet (900 Ko max).');
    const res = FJ.csv.parseCards(text);
    if (res.needsMapping) return toast('Format inconnu : utilisez les colonnes recto_texte, verso_texte, emoji, categorie.');
    if (res.error) return toast(res.error);
    if (!res.cards.length) return toast('Aucune carte valide dans ce fichier.');
    const owned = ownedKeys();
    const fresh = res.cards.filter((c) => !isOwned(c, owned)).length;
    const cats = [...new Set(res.cards.map((c) => c.cat).filter(Boolean))];
    packDraft.csv = text;
    packDraft.count = res.cards.length;
    packDraft.open = true;
    if (!packDraft.title) packDraft.title = file.name.replace(/\.csv$/i, '');
    packDraft.info = `${plural(res.cards.length, 'carte', 'cartes')} (${fresh} nouvelle${fresh > 1 ? 's' : ''} pour vous)${cats.length ? ' · ' + cats.slice(0, 6).join(', ') + (cats.length > 6 ? '…' : '') : ''}${res.skipped ? ` · ${plural(res.skipped, 'ligne ignorée', 'lignes ignorées')}` : ''}`;
    refreshPacks();
  }

  async function publishPack() {
    const title = packDraft.title.trim();
    if (!title) return toast('Donnez un titre au paquet.');
    if (!packDraft.csv) return toast("Choisissez d'abord un fichier CSV.");
    const ok = await askConfirm({
      title: 'Envoyer à tous ?',
      text: `« ${title} » (${plural(packDraft.count, 'carte', 'cartes')}) sera proposé à tous les utilisateurs. Vous pourrez le retirer ensuite.`,
      ok: 'Envoyer',
    });
    if (!ok) return;
    const sent = await (FJ.sync && FJ.sync.publishPack({ title, desc: packDraft.desc.trim(), csv: packDraft.csv, count: packDraft.count }));
    if (!sent) return toast('Envoi impossible : vérifiez la connexion et les règles Firestore.');
    Object.assign(packDraft, { open: false, title: '', desc: '', csv: '', count: 0, info: '' });
    toast('Paquet publié !', true);
    refreshPacks();
  }

  function packById(id) {
    return id === '__draft' ? { id, title: packDraft.title.trim() || 'Aperçu', csv: packDraft.csv, draft: true } : packList().find((p) => p.id === id);
  }

  // Contenu d'un paquet en lecture seule, avec les cartes que l'on possède déjà
  function renderPackView(id) {
    const p = packById(id);
    if (!p) return renderHome();
    view = 'pack';
    const cards = FJ.csv.parseCards(p.csv).cards || [];
    const o = ownedKeys();
    const fresh = cards.filter((c) => !isOwned(c, o)).length;
    const first = (t) => t.split('\n')[0];
    const shown = cards.slice(0, 400);
    $('#app').innerHTML = `
      <section class="panel">
        <div class="words-head">
          <button class="btn ghost" data-action="home">← Accueil</button>
          <h2 style="margin:0">📦 ${esc(p.title)}</h2>
        </div>
        <p class="muted small">${plural(cards.length, 'carte', 'cartes')} · ${fresh} nouvelle${fresh > 1 ? 's' : ''} pour vous, ${cards.length - fresh} déjà présente${cards.length - fresh > 1 ? 's' : ''}.</p>
        ${p.draft ? '' : `<div class="actions" style="margin-bottom:8px"><button class="btn primary" data-action="pack-integrate" data-id="${esc(p.id)}">Intégrer ce paquet</button></div>`}
        <div>${shown.map((c) => `<div class="word"><div class="word-main"><div class="w-text">
          <div class="w-a" lang="${lang(first(c.recto))}">${c.emoji ? esc(c.emoji) + ' ' : ''}${esc(first(c.recto))}</div>
          <div class="w-b" lang="${lang(first(c.verso))}">${esc(first(c.verso))}${c.cat ? ` <span class="w-cat">· ${esc(c.cat)}</span>` : ''}</div>
        </div>${isOwned(c, o) ? '<span class="pill">Déjà présente</span>' : '<span class="pill learning">Nouvelle</span>'}</div></div>`).join('')}
        ${cards.length > shown.length ? `<p class="muted" style="text-align:center">${cards.length - shown.length} autres cartes non affichées.</p>` : ''}</div>
      </section>`;
    window.scrollTo(0, 0);
  }

  async function integratePack(id) {
    const p = packById(id);
    if (!p || p.draft) return;
    const res = FJ.csv.parseCards(p.csv);
    if (res.error || !res.cards.length) return toast('Ce paquet est illisible.');
    const parts = await runImport(res.cards);
    setPackStatus(id, 'done');
    toast(`${p.title} : ${parts.join(' · ')}`);
    renderHome();
  }

  // ---------- Import / export ----------
  async function readText(file) {
    return new TextDecoder('utf-8').decode(await file.arrayBuffer());
  }

  async function importCsv(file) {
    const buf = await file.arrayBuffer();
    const text = new TextDecoder('utf-8').decode(buf);
    const res = FJ.csv.parseCards(text);
    // Format inconnu (export d'un autre site) : au lieu d'une erreur, on ouvre l'assistant de choix des colonnes
    if (res.needsMapping) { toast('Format inconnu : choisissez les colonnes.'); return wizSetSource(buf); }
    if (text.includes('�')) toast('Attention : caractères illisibles. Enregistrez le CSV en UTF-8.');
    if (res.error) return toast(res.error);
    const parts = await runImport(res.cards);
    if (res.skipped) parts.push(plural(res.skipped, 'ligne incomplète ignorée', 'lignes incomplètes ignorées'));
    toast(parts.join(' · '));
    if (view === 'words') renderWords(); else renderHome();
  }

  // Import additif commun (CSV, packs de démarrage). Renvoie les morceaux du message récapitulatif.
  // Une carte déjà connue garde sa progression ; sa catégorie n'est complétée que si elle n'en avait pas. Si le fichier
  // en propose une autre, on demande avant de remplacer (par défaut : on garde celle de l'utilisateur).
  async function runImport(cards) {
    const r = store.addCards(cards);
    const parts = [plural(r.added, 'nouvelle carte ajoutée', 'nouvelles cartes ajoutées')];
    if (r.duplicates) parts.push(plural(r.duplicates, 'déjà présente', 'déjà présentes'));
    if (r.textFixed) parts.push(plural(r.textFixed, 'carte corrigée', 'cartes corrigées'));
    if (r.imagesUpdated) parts.push(plural(r.imagesUpdated, 'carte enrichie (emoji/image)', 'cartes enrichies (emoji/image)'));
    if (r.catFilled) parts.push(plural(r.catFilled, 'carte rangée dans sa catégorie', 'cartes rangées dans leur catégorie'));
    if (r.catConflicts.length) {
      const n = r.catConflicts.length;
      const replace = await askConfirm({
        title: 'Catégories différentes',
        text: `${plural(n, 'carte a', 'cartes ont')} déjà une autre catégorie que celle du fichier. Voulez-vous la remplacer par celle du fichier ? (Sinon, vos catégories actuelles sont conservées.)`,
        ok: 'Remplacer',
        cancel: 'Garder les miennes',
      });
      if (replace) parts.push(plural(store.applyCatChanges(r.catConflicts), 'catégorie remplacée', 'catégories remplacées'));
    }
    return parts;
  }

  // Pack de démarrage (starter/*.csv, dans le dépôt public) : même chemin que l'import CSV normal — additif,
  // jamais de remplacement. Le fichier reste dans le repo, pas besoin de le télécharger à part.
  async function importStarter(label, path) {
    try {
      const res = await fetch(path, { cache: 'no-store' });
      if (!res.ok) throw new Error('http ' + res.status);
      const text = await res.text();
      const parsed = FJ.csv.parseCards(text);
      if (parsed.error) return toast(`${label} : ${parsed.error}`);
      const parts = await runImport(parsed.cards);
      toast(`${label} : ${parts.join(' · ')}`);
      if (view === 'words') renderWords(); else renderHome();
    } catch (e) {
      toast(`${label} : chargement impossible pour le moment.`);
    }
  }

  function exportJson() {
    const blob = new Blob([store.exportJson()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `flash-jap-sauvegarde-${store.dayKey()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async function importJson(file) {
    const online = FJ.syncUi.phase === 'signedin';
    if (!confirm('Remplacer toutes les données actuelles par cette sauvegarde' + (online ? ' (en ligne et sur vos autres appareils aussi)' : '') + ' ?')) return;
    try {
      store.importJson(await readText(file));
      if (FJ.sync) FJ.sync.replaceAll();
      audio.enabled = store.state.settings.sound;
      updateHeader();
      renderHome();
      toast('Sauvegarde restaurée.');
    } catch (e) {
      toast(e.message || 'Sauvegarde illisible.');
    }
  }

  // ---------- Événements ----------
  const actions = {
    start: (el) => startSession((el && el.dataset.track) || 'main'),
    flip,
    ok: () => grade('ok'),
    'ok-kanji': () => grade('ok-kanji'),
    ko: () => grade('ko'),
    skip: () => grade('skip'),
    speak: (el) => speakJapanese(el.dataset.text),
    aside: setAside,
    master: masterFromSession,
    prio: togglePrio,
    quit: quitSession,
    home() { sess = null; renderHome(); },
    words() { wordsFilter = 'all'; wordsQuery = ''; wordsCat = null; expandedId = null; renderWords(); },
    'words-filter'(el) { wordsFilter = el.dataset.val; expandedId = null; renderWords(); },
    'w-toggle'(el) { expandedId = expandedId === el.dataset.id ? null : el.dataset.id; renderWordsList(); },
    'w-prio': (el) => wordAction(el.dataset.id, (c) => { c.prio = !c.prio; }),
    'w-aside': (el) => wordAction(el.dataset.id, (c) => { c.state = c.state === 'aside' ? undefined : 'aside'; }, 'Carte déplacée'),
    async 'w-master'(el) {
      const c = store.byId(el.dataset.id);
      if (!c || !(await confirmMaster(c))) return;
      gainXp(applyMaster(c));
      persist();
      audio.play('master');
      FJ.fx.confetti({ count: 50 });
      toast(`« ${c.recto.split('\n')[0]} » masterisé`, true);
      renderWordsList();
    },
    'w-unmaster': (el) => wordAction(el.dataset.id, (c) => { c.state = undefined; }, 'Mot remis en révision'),
    'w-kanji': (el) => wordAction(el.dataset.id, (c) => {
      // Cycle : auto -> forcé dans Kanji Only -> exclu de Kanji Only -> auto
      c.kanjiForce = c.kanjiForce === undefined ? true : c.kanjiForce === true ? false : undefined;
    }, 'Réglage Kanji Only mis à jour'),
    'w-remove': (el) => wordAction(el.dataset.id, (c) => { c.state = 'removed'; }, 'Carte éliminée · récupérable dans « Éliminés »'),
    'w-restore': (el) => wordAction(el.dataset.id, (c) => { c.state = undefined; }, 'Carte restaurée'),
    'chart-metric'(el) { store.state.settings.chartMetric = el.dataset.val; persist(); refreshChart(); },
    'chart-range'(el) { store.state.settings.chartRange = Number(el.dataset.val); persist(); refreshChart(); },
    'set-reverse'(el) { store.state.settings.reverse = el.dataset.val === '1'; persist(); renderHome(); },
    'add-card'() { addedThisSession = []; renderAddCard(); },
    'wiz-open': () => wizSetSource(),
    'wiz-file': wizPickFile,
    'wiz-paste'() {
      const text = $('#wizPaste').value;
      if (!text.trim()) return toast('Collez d\'abord le contenu à importer.');
      wizSetSource(text);
    },
    'wiz-import': wizImport,
    'w-edit': (el) => renderEditCard(el.dataset.id),
    'edit-cancel'() { expandedId = edit ? edit.id : expandedId; edit = null; renderWords(); },
    'edit-kanji-mode'(el) {
      edit.kanjiMode = el.dataset.val;
      document.querySelectorAll('[data-action="edit-kanji-mode"]').forEach((b) => b.setAttribute('aria-pressed', String(b === el)));
      $('#edKanjiHint').textContent = ADD_KANJI_HINTS[edit.kanjiMode];
    },
    'toggle-settings'() { settingsOpen = !settingsOpen; renderHome(); },
    'cat-all'() { setPool(null); },
    'cat-toggle'(el) {
      const key = el.dataset.key;
      const pool = store.state.settings.catPool;
      setPool(!pool ? [key] : pool.includes(key) ? pool.filter((k) => k !== key) : [...pool, key]);
    },
    'cat-add-due'() {
      const pool = store.state.settings.catPool || [];
      setPool([...pool, ...store.categoryList().filter((e) => e.due && !pool.includes(e.key)).map((e) => e.key)]);
    },
    'starter-vocab': () => importStarter('Vocabulaire de base', 'starter/vocab-genki.csv'),
    'starter-kanji': () => importStarter('Kanji de base', 'starter/kanji-genki.csv'),
    'add-kanji-mode'(el) {
      addKanjiMode = el.dataset.val;
      document.querySelectorAll('[data-action="add-kanji-mode"]').forEach((b) => b.setAttribute('aria-pressed', String(b === el)));
      updateAddPreview();
    },
    'import-csv': () => $('#csvFile').click(),
    'import-json': () => $('#jsonFile').click(),
    'export-json': exportJson,
    'sync-signin': () => FJ.sync && FJ.sync.signIn(),
    'note-mood'(el) {
      noteDraft.mood = noteDraft.mood === el.dataset.val ? null : el.dataset.val;
      document.querySelectorAll('[data-action="note-mood"]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.val === noteDraft.mood)));
    },
    'note-dismiss': (el) => dismissNote(el.dataset.id),
    'pack-view': (el) => renderPackView(el.dataset.id),
    'pack-integrate': (el) => integratePack(el.dataset.id),
    'pack-later'(el) { setPackStatus(el.dataset.id, 'later'); refreshPacks(); },
    'pack-publish': publishPack,
    async 'pack-delete'(el) {
      const p = packById(el.dataset.id);
      const ok = await askConfirm({ title: 'Retirer ce paquet ?', text: `« ${p ? p.title : ''} » ne sera plus proposé. Les cartes déjà intégrées par les utilisateurs restent chez eux.`, ok: 'Retirer' });
      if (ok && FJ.sync) { if (!(await FJ.sync.deletePack(el.dataset.id))) toast('Suppression impossible.'); }
    },
    'sync-signout': () => FJ.sync && FJ.sync.signOut(),
    reset() {
      const online = FJ.syncUi.phase === 'signedin';
      if (!confirm('Effacer toutes les cartes et toute la progression' + (online ? ', y compris en ligne et sur vos autres appareils' : '') + ' ? Cette action est définitive.')) return;
      store.reset();
      if (FJ.sync) FJ.sync.replaceAll();
      updateHeader();
      renderHome();
    },
  };

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (el && actions[el.dataset.action]) actions[el.dataset.action](el);
  });

  document.addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset.setting) {
      const key = el.dataset.setting;
      store.state.settings[key] = el.type === 'checkbox' ? el.checked : Number(el.value);
      if (key === 'sound') audio.enabled = el.checked;
      persist();
      renderHome();
    } else if (el.dataset.catpicker) { // sélecteur de catégorie : "Nouvelle catégorie…" fait apparaître le champ de saisie
      const input = $('#' + el.dataset.catpicker);
      input.hidden = el.value !== '__new__';
      if (!input.hidden) input.focus();
    } else if (wizChange(el)) {
      // géré par l'assistant d'import
    } else if (el.id === 'wordsCat') {
      wordsCat = el.value === '*' ? null : el.value;
      renderWordsList();
    } else if (el.id === 'packFile') {
      const file = el.files && el.files[0];
      if (file) readPackFile(file);
    } else if (el.id === 'csvFile' || el.id === 'jsonFile') {
      const file = el.files && el.files[0];
      el.value = '';
      if (file) (el.id === 'csvFile' ? importCsv : importJson)(file);
    }
  });

  // L'événement "toggle" ne remonte pas : on l'écoute en phase de capture pour mémoriser l'état de "Petits mots"
  document.addEventListener('toggle', (e) => {
    if (e.target.id === 'noteDetails') noteDraft.open = e.target.open;
    else if (e.target.id === 'packsAll') packUi.allOpen = e.target.open;
    else if (e.target.id === 'packAdmin') packDraft.open = e.target.open;
  }, true);

  document.addEventListener('submit', (e) => {
    if (e.target.id === 'addForm') submitAddCard(e);
    else if (e.target.id === 'noteForm') submitNote(e);
    else if (e.target.id === 'editForm') submitEditCard(e);
  });

  document.addEventListener('input', (e) => {
    if (e.target.id === 'addRecto' || e.target.id === 'addVerso') {
      updateAddPreview();
    } else if (e.target.id === 'noteText') {
      noteDraft.text = e.target.value;
    } else if (e.target.id === 'packTitle') {
      packDraft.title = e.target.value;
    } else if (e.target.id === 'packDesc') {
      packDraft.desc = e.target.value;
    } else if (e.target.id === 'wordsSearch') {
      wordsQuery = e.target.value;
      renderWordsList();
    }
  });

  $('#modalOk').addEventListener('click', () => closeModal(true));
  $('#modalCancel').addEventListener('click', () => closeModal(false));
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(false); });

  document.addEventListener('keydown', (e) => {
    if (modalOpen()) { // pendant une confirmation, seules Échap (annuler) et le focus sur les boutons comptent
      if (e.key === 'Escape') closeModal(false);
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (view === 'words' && e.target.dataset && e.target.dataset.action === 'w-toggle' && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      return actions['w-toggle'](e.target);
    }
    if (view !== 'session' || !sess) return;
    if (e.target.tagName === 'BUTTON' && (e.key === ' ' || e.key === 'Enter')) return; // laisse le bouton focalisé réagir
    const k = e.key;
    if (!sess.flipped) {
      if (k === ' ' || k === 'Enter') { e.preventDefault(); flip(); }
      else if (k === 'ArrowDown' || k === '2') { e.preventDefault(); grade('skip'); }
    } else if (k === 'ArrowLeft' || k === '1') grade('ko');
    else if (k === 'ArrowRight' || k === '3') grade('ok');
    else if (k === 'k' || k === 'K') grade('ok-kanji'); // "je savais, mais pas le kanji" (si proposé)
    else if (k === 'ArrowDown' || k === '2') { e.preventDefault(); grade('skip'); }
    if (k === 'Escape') quitSession();
  });

  // Le chronomètre de session s'arrête quand l'onglet est masqué (autre appli, écran verrouillé…).
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (sess && view === 'session') sess.hiddenAt = Date.now();
      return;
    }
    if (sess && sess.hiddenAt) {
      sess.cardStart += Date.now() - sess.hiddenAt;
      sess.hiddenAt = null;
    }
    if (view === 'home') renderHome(); // rafraîchit le nombre de cartes "à réviser"
  });

  // ---------- Démarrage ----------
  store.load();
  audio.enabled = store.state.settings.sound;
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* facultatif */ }
  updateHeader();
  updateSyncBadge();
  renderHome();
})();
