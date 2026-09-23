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
    const prioFresh = fresh.filter((c) => c.prio); // les nouvelles cartes prioritaires ignorent la limite
    let normal = fresh.filter((c) => !c.prio);
    if (settings.shuffle) normal = shuffle(normal);
    if (settings.newPerSession >= 0) normal = normal.slice(0, settings.newPerSession);

    let queue = [...due, ...prioFresh, ...normal];
    if (settings.shuffle) queue = shuffle(queue);
    queue.sort((a, b) => (b.prio ? 1 : 0) - (a.prio ? 1 : 0)); // prioritaires d'abord (tri stable)
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
      </div>
      <button class="btn ghost small-text" data-action="feedback" style="margin-top:8px">✉️ Envoyer un mot au créateur</button>`;
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

  const MOODS = ['😍', '🙂', '😐', '🐛', '💡'];
  let feedbackMood = null;

  function renderFeedbackForm() {
    view = 'feedback';
    feedbackMood = null;
    $('#app').innerHTML = `
      <section class="panel">
        <div class="words-head">
          <button class="btn ghost" data-action="home">← Accueil</button>
          <h2 style="margin:0">Un mot pour le créateur</h2>
        </div>
        <form id="feedbackForm" class="add-form">
          <label for="fbText">Votre message (facultatif)</label>
          <textarea id="fbText" rows="3" maxlength="100" placeholder="Un merci, un bug, une idée…"></textarea>
          <label>Comment ça se passe ? (facultatif)</label>
          <div class="mood-row">
            ${MOODS.map((m) => `<button type="button" class="mood" data-action="fb-mood" data-val="${m}" aria-pressed="false">${m}</button>`).join('')}
          </div>
          <label class="checkbox-row"><input type="checkbox" id="fbAnon"> Envoyer anonymement (votre prénom ne sera pas affiché)</label>
          <button class="btn primary big" type="submit">Envoyer</button>
        </form>
      </section>`;
    $('#fbText').focus();
  }

  async function submitFeedback(e) {
    e.preventDefault();
    const text = $('#fbText').value.trim();
    const anonymous = $('#fbAnon').checked;
    if (!text && !feedbackMood) return toast('Ajoutez un message ou choisissez un smiley.');
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    const ok = await (FJ.sync && FJ.sync.sendFeedback({ text, mood: feedbackMood, anonymous }));
    btn.disabled = false;
    if (ok) { toast('Message envoyé, merci !', true); sess = null; renderHome(); }
    else toast('Envoi impossible : vérifiez votre connexion.');
  }

  // Boîte de réception des petits mots : uniquement construite/affichée pour le compte propriétaire
  // (FJ.feedbackUi.isOwner n'est mis à true par js/sync.js qu'après vérification de l'e-mail connecté).
  function feedbackInner() {
    const items = (FJ.feedbackUi && FJ.feedbackUi.items) || [];
    if (!items.length) return '<p class="muted small" style="text-align:center">Rien pour l\'instant.</p>';
    return items.map((it) => `
      <div class="fb-item">
        <div class="fb-head">
          ${it.mood ? `<span class="fb-mood">${esc(it.mood)}</span>` : ''}
          <b>${esc(it.name || 'Anonyme')}</b>
          <span class="muted small">${agoText(it.createdAt)}</span>
          <button class="btn ghost small-text" data-action="fb-delete" data-id="${it.id}" aria-label="Supprimer">✕</button>
        </div>
        ${it.text ? `<p class="fb-text">${esc(it.text)}</p>` : ''}
      </div>`).join('');
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
  }

  // Appelé quand des données arrivent d'un autre appareil : rafraîchit l'affichage sans toucher à une session en cours.
  function refresh() {
    updateHeader();
    if (view === 'home') renderHome();
    else if (view === 'words') renderWordsList();
  }

  function feedbackChanged() {
    if (view === 'home') renderHome();
  }

  FJ.ui = { refresh, syncChanged, feedbackChanged, toast };

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

  // Sélection des leçons/catégories à réviser (le "pool"). Par défaut toutes ; toucher une leçon depuis "Toutes"
  // l'isole (mode concentration), ensuite chaque touche ajoute ou retire une leçon. Panneau masqué tant qu'aucune
  // carte n'a de catégorie.
  function catPanel() {
    const list = store.categoryList(Date.now());
    if (!list.some((e) => e.key !== '')) return '';
    const pool = store.state.settings.catPool;
    const inPool = (key) => !pool || pool.includes(key);
    const chips = list.map((e) => `<button class="chip" data-action="cat-toggle" data-key="${esc(e.key)}" aria-pressed="${!!pool && pool.includes(e.key)}"
      title="${esc(`${plural(e.total, 'carte', 'cartes')} · ${e.due} à réviser · ${e.fresh} nouvelles`)}">${esc(e.key || 'Sans catégorie')}${e.due ? ` <b class="badge-due">${e.due}</b>` : ''}</button>`).join('');
    const outsideDue = list.filter((e) => !inPool(e.key)).reduce((n, e) => n + e.due, 0);
    const outside = outsideDue
      ? `<p class="small" style="margin:10px 0 0">⏳ ${plural(outsideDue, 'révision en attente', 'révisions en attente')} dans d'autres leçons.
           <button class="btn ghost small-text" data-action="cat-add-due">Les inclure</button></p>`
      : '';
    return `<section class="panel" id="catBox">
      <h2>Leçons à réviser</h2>
      <div class="chips"><button class="chip" data-action="cat-all" aria-pressed="${!pool}">Toutes</button>${chips}</div>
      <p class="muted small" style="margin:0">${pool ? `${plural(pool.length, 'leçon sélectionnée', 'leçons sélectionnées')} : les cartes sont tirées au hasard parmi elles.` : 'Touchez une leçon pour ne réviser qu\'elle, puis ajoutez-en d\'autres quand vous êtes prêt.'}</p>
      ${outside}
    </section>`;
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

    const startMain = c.total
      ? startBlock('main', cp, 'Commencer la révision')
      : `<div class="empty"><p>Aucune carte pour le moment.</p>
         <button class="btn primary big" data-action="starter-vocab">📦 Commencer avec le pack de base (1000 mots)</button>
         <p class="muted small" style="margin:10px 0 6px">ou</p>
         <div class="actions" style="justify-content:center">
           <button class="btn" data-action="import-csv">Importer votre CSV</button>
           <button class="btn" data-action="add-card">＋ Ajouter une carte</button>
         </div></div>`;

    const extras = [];
    if (c.priority) extras.push(`★ ${plural(c.priority, 'carte prioritaire', 'cartes prioritaires')}`);
    if (c.mastered) extras.push(`✓ ${plural(c.mastered, 'mot masterisé', 'mots masterisés')}`);
    if (c.aside) extras.push(`⏸ ${c.aside} de côté`);

    const showFeedback = FJ.feedbackUi && FJ.feedbackUi.isOwner;
    $('#app').innerHTML = `
      <section class="panel sync-panel" id="syncBox">${syncInner()}</section>

      ${showFeedback ? `<section class="panel" id="feedbackBox">
        <h2>💌 Petits mots${FJ.feedbackUi.items.length ? ` (${FJ.feedbackUi.items.length})` : ''}</h2>
        ${feedbackInner()}
      </section>` : ''}

      <section class="panel">${startMain}</section>

      ${catPanel()}

      ${k.total ? `<section class="panel">
        <h2>Kanji Only</h2>
        <p class="muted small">Le japonais d'abord, pour apprendre à reconnaître les kanjis. ${fmtN(k.total)} cartes concernées, avec une progression à part.</p>
        ${startBlock('kanji', kp, 'Réviser les kanjis')}
        <div style="margin-top:12px">${stackBlock(k)}</div>
      </section>` : ''}

      <section class="panel">
        <h2>Options de session</h2>
        <div class="options">
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
        </div>
      </section>

      <section class="panel">
        <h2>Ma mémoire</h2>
        ${stackBlock(c)}
        <p class="recent">Aujourd'hui : ${plural(todayReviews, 'carte revue', 'cartes revues')} · 7 derniers jours : ${fmtN(store.periodTotals(7))}${extras.length ? '<br>' + extras.join(' · ') : ''}</p>
      </section>

      <section class="panel">
        <h2>Mes compteurs</h2>
        <div class="tiles">
          <div class="tile"><b>${fmtN(s.stats.reviews)}</b><small>cartes révisées</small></div>
          <div class="tile"><b>${fmtN(s.stats.sessions)}</b><small>sessions de révision</small></div>
          <div class="tile"><b>${fmtN(c.known)}</b><small>mots connus</small></div>
          <div class="tile"><b>${srs.fmtDuration(s.stats.ms)}</b><small>temps en session</small></div>
        </div>
      </section>

      <section class="panel">
        <h2>Progression par jour</h2>
        <div id="chartBox">${chartInner()}</div>
      </section>

      <section class="panel">
        <h2>Cartes</h2>
        <div class="actions">
          <button class="btn" data-action="add-card">＋ Ajouter une carte</button>
          <button class="btn" data-action="import-csv">Importer un CSV</button>
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
      </section>`;
  }

  // ---------- Session ----------
  const heatOf = (n) => (n >= 20 ? 4 : n >= 10 ? 3 : n >= 5 ? 2 : n >= 3 ? 1 : 0);

  function startSession(track) {
    const q = buildQueue(track);
    if (!q.items.length) return;
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

  function renderControls() {
    $('#controls').innerHTML = sess.flipped
      ? `<button class="btn ko big" data-action="ko">✗ À revoir</button>
         <button class="btn big small" data-action="skip" title="Repasser à la fin de la boucle" aria-label="Repasser à la fin">↻</button>
         <button class="btn ok big" data-action="ok">✓ Je savais</button>`
      : `<button class="btn primary big" data-action="flip">Retourner</button>
         <button class="btn big small" data-action="skip" title="Repasser à la fin de la boucle" aria-label="Repasser à la fin">↻</button>`;
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

  function grade(kind) {
    if (!sess || sess.busy) return;
    if (kind !== 'skip' && !sess.flipped) return;
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
      const ok = kind === 'ok';
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

        if (ok) pop(`+${xp} XP`, r.validated ? 'Carte validée !' : `Revient ${srs.fmtDue(r.due, now)}`);
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
      else if (c.state === 'mastered') buttons = btn('w-unmaster', '↩ Remettre en révision') + btn('w-remove', '✕ Éliminer', 'danger');
      else {
        const kanjiLabel = c.kanjiForce === true ? '漢 Kanji Only : forcé' : c.kanjiForce === false ? '漢 Kanji Only : exclu' : '漢 Kanji Only : auto';
        buttons = btn('w-prio', c.prio ? '★ Retirer la priorité' : '☆ Priorité') +
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
            <div class="w-b" lang="${lang(first(c.verso))}">${esc(first(c.verso))}${c.cat ? ` <span class="w-cat">· ${esc(c.cat)}</span>` : ''}</div>
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

  // ---------- Import / export ----------
  async function readText(file) {
    return new TextDecoder('utf-8').decode(await file.arrayBuffer());
  }

  async function importCsv(file) {
    const text = await readText(file);
    if (text.includes('�')) toast('Attention : caractères illisibles. Enregistrez le CSV en UTF-8.');
    const res = FJ.csv.parseCards(text);
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
    feedback: renderFeedbackForm,
    'fb-mood'(el) {
      feedbackMood = feedbackMood === el.dataset.val ? null : el.dataset.val;
      document.querySelectorAll('[data-action="fb-mood"]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.val === feedbackMood)));
    },
    'fb-delete': (el) => FJ.sync && FJ.sync.deleteFeedback(el.dataset.id),
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
    } else if (el.id === 'wordsCat') {
      wordsCat = el.value === '*' ? null : el.value;
      renderWordsList();
    } else if (el.id === 'csvFile' || el.id === 'jsonFile') {
      const file = el.files && el.files[0];
      el.value = '';
      if (file) (el.id === 'csvFile' ? importCsv : importJson)(file);
    }
  });

  document.addEventListener('submit', (e) => {
    if (e.target.id === 'addForm') submitAddCard(e);
    else if (e.target.id === 'feedbackForm') submitFeedback(e);
  });

  document.addEventListener('input', (e) => {
    if (e.target.id === 'addRecto' || e.target.id === 'addVerso') {
      updateAddPreview();
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
