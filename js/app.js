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

  // ---------- Fenêtre de confirmation ----------
  let modalResolve = null;

  function askConfirm({ title, text, ok }) {
    return new Promise((resolve) => {
      modalResolve = resolve;
      $('#modalTitle').textContent = title;
      $('#modalText').textContent = text;
      $('#modalOk').textContent = ok;
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
    const pool = cards.filter((c) => store.isActive(c) && (track === 'main' || kanji.view(c)));

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

  // ---------- Accueil ----------
  function startBlock(track, counts, label) {
    const now = Date.now();
    const q = buildQueue(track);
    if (!counts.total) return '';
    if (!q.items.length) {
      const next = counts.nextDue ? `Prochaine carte ${srs.fmtDue(counts.nextDue, now)}.` : 'Tout est validé, bravo !';
      return `<div class="start"><button class="btn primary big" disabled>Rien à réviser</button><p class="start-sub">${next}</p></div>`;
    }
    return `<div class="start"><button class="btn primary big" data-action="start" data-track="${track}">${label}</button>
      <p class="start-sub">${plural(q.dueN, 'carte à réviser', 'cartes à réviser')} · ${plural(q.newN, 'nouvelle', 'nouvelles')}</p></div>`;
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
    const todayReviews = (s.daily[store.dayKey()] || {}).reviews || 0;

    const startMain = c.total
      ? startBlock('main', c, 'Commencer la révision')
      : `<div class="empty"><p>Aucune carte pour le moment.<br>Importez votre fichier CSV pour commencer.</p>
         <button class="btn primary big" data-action="import-csv">Importer un CSV</button></div>`;

    const extras = [];
    if (c.priority) extras.push(`★ ${plural(c.priority, 'carte prioritaire', 'cartes prioritaires')}`);
    if (c.mastered) extras.push(`✓ ${plural(c.mastered, 'mot masterisé', 'mots masterisés')}`);
    if (c.aside) extras.push(`⏸ ${c.aside} de côté`);

    $('#app').innerHTML = `
      <section class="panel">${startMain}</section>

      ${k.total ? `<section class="panel">
        <h2>Kanji Only</h2>
        <p class="muted small">Le japonais d'abord, pour apprendre à reconnaître les kanjis. ${fmtN(k.total)} cartes concernées, avec une progression à part.</p>
        ${startBlock('kanji', k, 'Réviser les kanjis')}
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
          <button class="btn" data-action="import-csv">Importer un CSV</button>
          <button class="btn" data-action="words">Voir mes mots (${fmtN(c.total + c.aside)})</button>
        </div>
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
            <div class="face front"><span class="tag">${tag}</span>${imgHtml(qi)}${textBlock(q)}</div>
            <div class="face back">${card.emoji ? `<div class="card-emoji" aria-hidden="true">${esc(card.emoji)}</div>` : ''}${imgHtml(ai)}${textBlock(a)}</div>
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

  // ---------- Liste des mots ----------
  const FILTERS = [
    ['all', 'Tous'], ['fresh', 'Nouveaux'], ['learning', 'En cours'], ['validated', 'Validés'],
    ['prio', '★ Priorité'], ['kanji', '漢 Kanji'], ['mastered', '✓ Masterisés'], ['aside', 'De côté'], ['removed', 'Éliminés'],
  ];

  function matchesFilter(c) {
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
        buttons = btn('w-prio', c.prio ? '★ Retirer la priorité' : '☆ Priorité') +
          btn('w-master', '✓ Masterisé') +
          btn('w-aside', c.state === 'aside' ? '↩ Remettre dans le paquet' : '⏸ Mettre de côté') +
          btn('w-remove', '✕ Éliminer', 'danger');
      }
      const actions = open ? `<div class="w-actions">${buttons}</div>` : '';
      return `<div class="word${open ? ' open' : ''}">
        <div class="word-main" data-action="w-toggle" data-id="${c.id}" role="button" tabindex="0">
          <div class="w-text">
            <div class="w-a" lang="${lang(first(c.recto))}">${c.prio ? '<span class="star">★</span> ' : ''}${c.emoji ? esc(c.emoji) + ' ' : ''}${esc(first(c.recto))}</div>
            <div class="w-b" lang="${lang(first(c.verso))}">${esc(first(c.verso))}</div>
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
    const { added, duplicates, imagesUpdated } = store.addCards(res.cards);
    const parts = [plural(added, 'nouvelle carte ajoutée', 'nouvelles cartes ajoutées')];
    if (duplicates) parts.push(plural(duplicates, 'doublon ignoré', 'doublons ignorés'));
    if (imagesUpdated) parts.push(plural(imagesUpdated, 'carte enrichie (emoji/image)', 'cartes enrichies (emoji/image)'));
    if (res.skipped) parts.push(plural(res.skipped, 'ligne incomplète ignorée', 'lignes incomplètes ignorées'));
    toast(parts.join(' · '));
    if (view === 'words') renderWords(); else renderHome();
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
    if (!confirm('Remplacer toutes les données actuelles par cette sauvegarde ?')) return;
    try {
      store.importJson(await readText(file));
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
    aside: setAside,
    master: masterFromSession,
    prio: togglePrio,
    quit: quitSession,
    home() { sess = null; renderHome(); },
    words() { wordsFilter = 'all'; wordsQuery = ''; expandedId = null; renderWords(); },
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
    'w-remove': (el) => wordAction(el.dataset.id, (c) => { c.state = 'removed'; }, 'Carte éliminée · récupérable dans « Éliminés »'),
    'w-restore': (el) => wordAction(el.dataset.id, (c) => { c.state = undefined; }, 'Carte restaurée'),
    'chart-metric'(el) { store.state.settings.chartMetric = el.dataset.val; persist(); refreshChart(); },
    'chart-range'(el) { store.state.settings.chartRange = Number(el.dataset.val); persist(); refreshChart(); },
    'set-reverse'(el) { store.state.settings.reverse = el.dataset.val === '1'; persist(); renderHome(); },
    'import-csv': () => $('#csvFile').click(),
    'import-json': () => $('#jsonFile').click(),
    'export-json': exportJson,
    reset() {
      if (!confirm('Effacer toutes les cartes et toute la progression ? Cette action est définitive.')) return;
      store.reset();
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
    } else if (el.id === 'csvFile' || el.id === 'jsonFile') {
      const file = el.files && el.files[0];
      el.value = '';
      if (file) (el.id === 'csvFile' ? importCsv : importJson)(file);
    }
  });

  document.addEventListener('input', (e) => {
    if (e.target.id === 'wordsSearch') {
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
  renderHome();
})();
