(function () {
  const FJ = (globalThis.FJ = globalThis.FJ || {});

  const COLORS = ['#e0ad3c', '#d1435b', '#3f6fd8', '#22a58f', '#9a5bd6', '#f08a1c', '#ffffff'];

  // Petits sprites mêlés aux confettis : chauves-souris et bonbons (chargés une fois ; tant qu'un sprite n'est pas
  // prêt, ses places sont simplement tenues par des confettis classiques).
  const SPRITE_FILES = { bat: 'assets/confetti/bat.svg', candyA: 'assets/confetti/candy-a.svg', candyB: 'assets/confetti/candy-b.svg' };
  const SPRITES = {};
  for (const k of Object.keys(SPRITE_FILES)) {
    const img = new Image();
    img.src = SPRITE_FILES[k];
    SPRITES[k] = img;
  }
  const spriteReady = (k) => SPRITES[k] && SPRITES[k].complete && SPRITES[k].naturalWidth > 0;

  // Confettis : deux canons en bas de l'écran, sur un canvas temporaire (aucune dépendance).
  function confetti({ count = 120 } = {}) {
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const canvas = document.createElement('canvas');
    canvas.className = 'confetti';
    document.body.appendChild(canvas);

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = window.innerWidth;
    const H = window.innerHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const parts = [];
    for (let i = 0; i < count; i++) {
      const left = i % 2 === 0;
      const angle = -(Math.PI / 180) * (50 + Math.random() * 40); // vers le haut
      const speed = 11 + Math.random() * 11;
      parts.push({
        x: left ? W * 0.08 : W * 0.92,
        y: H * 0.9,
        vx: Math.cos(angle) * speed * (left ? 1 : -1) * (0.5 + Math.random() * 0.7),
        vy: Math.sin(angle) * speed,
        w: 6 + Math.random() * 6,
        h: 3 + Math.random() * 4,
        rot: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 0.4,
        color: COLORS[(Math.random() * COLORS.length) | 0],
        round: Math.random() < 0.25,
      });
      // Environ un confetti sur quatre devient un sprite : chauve-souris (qui plane en oscillant) ou bonbon (qui tourne)
      const r = Math.random();
      const kind = r < 0.12 ? 'bat' : r < 0.18 ? 'candyA' : r < 0.25 ? 'candyB' : '';
      if (kind && spriteReady(kind)) {
        const p = parts[parts.length - 1];
        p.sprite = SPRITES[kind];
        p.size = kind === 'bat' ? 20 + Math.random() * 12 : 22 + Math.random() * 12;
        p.phase = Math.random() * Math.PI * 2;
        p.bat = kind === 'bat';
        if (p.bat) { p.vx *= 0.8; p.vr = 0; }
        else p.vr = (Math.random() - 0.5) * 0.18;
      }
    }

    let frame = 0;
    (function tick() {
      ctx.clearRect(0, 0, W, H);
      let alive = 0;
      for (const p of parts) {
        p.vy += 0.32;
        p.vx *= 0.992;
        p.vy *= 0.992;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        if (p.y > H + 20) continue;
        alive++;
        ctx.save();
        ctx.translate(p.x, p.y);
        if (p.sprite) {
          // la chauve-souris flotte : elle retombe moins vite et balance doucement d'un côté à l'autre
          if (p.bat) { p.vy -= 0.12; ctx.rotate(Math.sin(frame * 0.08 + p.phase) * 0.45); }
          else ctx.rotate(p.rot);
          ctx.drawImage(p.sprite, -p.size / 2, -p.size / 2, p.size, p.size);
          ctx.restore();
          continue;
        }
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        if (p.round) { ctx.beginPath(); ctx.arc(0, 0, p.h, 0, Math.PI * 2); ctx.fill(); }
        else ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
      if (alive && ++frame < 320) requestAnimationFrame(tick);
      else canvas.remove();
    })();
  }

  // Compteur qui monte de 0 à la valeur cible
  function countUp(el, target, ms = 900, prefix = '') {
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) { el.textContent = prefix + target.toLocaleString('fr-FR'); return; }
    const t0 = performance.now();
    (function step(now) {
      const k = Math.min((now - t0) / ms, 1);
      const eased = 1 - Math.pow(1 - k, 3);
      el.textContent = prefix + Math.round(target * eased).toLocaleString('fr-FR');
      if (k < 1) requestAnimationFrame(step);
    })(t0);
  }

  FJ.fx = { confetti, countUp };
})();
