(function () {
  const FJ = (globalThis.FJ = globalThis.FJ || {});

  const COLORS = ['#e0ad3c', '#d1435b', '#3f6fd8', '#22a58f', '#9a5bd6', '#f08a1c', '#ffffff'];
  const reduced = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const STEP = 1000 / 60; // les vitesses ci-dessous sont exprimées "par image à 60 Hz" ; `dt` vaut 1 pour une image à 60 Hz

  // Petits sprites de Noël mêlés aux confettis (chargés une fois ; tant qu'un sprite n'est pas prêt, ses places sont
  // simplement tenues par des confettis classiques).
  const SPRITE_FILES = {
    candy: 'assets/xmas/candy.svg', bauble: 'assets/xmas/bauble.svg',
    mistletoe: 'assets/xmas/mistletoe.svg', flake: 'assets/xmas/snowflake.svg',
  };
  const SPRITES = {};
  for (const k of Object.keys(SPRITE_FILES)) {
    const img = new Image();
    img.src = SPRITE_FILES[k];
    SPRITES[k] = img;
  }
  const spriteReady = (k) => SPRITES[k] && SPRITES[k].complete && SPRITES[k].naturalWidth > 0;

  // Canvas plein écran temporaire + boucle suivant le temps réel (même vitesse à 60 Hz ou 144 Hz).
  // `frame(ctx, dt, t, W, H)` dessine une image et renvoie true tant qu'il reste quelque chose à animer.
  function overlay(frame, maxFrames) {
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
    let last = null;
    let t0 = null;
    function tick(now) {
      if (last === null) { last = now; t0 = now; }
      const dt = Math.min((now - last) / STEP, 3); // plafonné : pas de saut si l'onglet était en pause
      last = now;
      const t = (now - t0) / STEP;
      ctx.clearRect(0, 0, W, H);
      if (frame(ctx, dt, t, W, H) && t < maxFrames) requestAnimationFrame(tick);
      else canvas.remove();
    }
    requestAnimationFrame(tick);
  }

  // Étoile à quatre branches (étincelle)
  function star(ctx, x, y, r) {
    ctx.beginPath();
    ctx.moveTo(x, y - r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.quadraticCurveTo(x, y, x, y + r);
    ctx.quadraticCurveTo(x, y, x - r, y);
    ctx.quadraticCurveTo(x, y, x, y - r);
    ctx.fill();
  }

  // Explosion de fête : deux canons en bas de l'écran projettent confettis et sprites de Noël en gerbe ; quelques
  // étincelles clignotent environ une seconde au centre.
  function confetti({ count = 120 } = {}) {
    if (reduced()) return;
    const W0 = window.innerWidth;
    const H0 = window.innerHeight;
    const parts = [];
    const kinds = ['candy', 'bauble', 'mistletoe', 'flake'];
    for (let i = 0; i < count; i++) {
      const left = i % 2 === 0;
      const angle = -(Math.PI / 180) * (50 + Math.random() * 40); // vers le haut
      const speed = 11 + Math.random() * 11;
      const p = {
        x: left ? W0 * 0.08 : W0 * 0.92,
        y: H0 * 0.9,
        vx: Math.cos(angle) * speed * (left ? 1 : -1) * (0.5 + Math.random() * 0.7),
        vy: Math.sin(angle) * speed,
        w: 6 + Math.random() * 6,
        h: 3 + Math.random() * 4,
        rot: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 0.4,
        color: COLORS[(Math.random() * COLORS.length) | 0],
        round: Math.random() < 0.25,
        g: 1,
      };
      // Environ un confetti sur trois devient un sprite de Noël, plus lent et plus léger
      if (Math.random() < 0.32) {
        const kind = kinds[(Math.random() * kinds.length) | 0];
        if (spriteReady(kind)) {
          p.sprite = SPRITES[kind];
          p.size = 24 + Math.random() * 14;
          p.vr = (Math.random() - 0.5) * 0.12;
          p.vx *= 0.6;
          p.vy *= 0.6;
          p.g = 0.3;
        }
      }
      parts.push(p);
    }
    // quelques étincelles : chacune naît à un instant propre, vit ~1 s et pulse (taille et opacité) avant de s'éteindre
    const sparks = Array.from({ length: Math.min(14, 6 + Math.round(count / 20)) }, () => ({
      x: W0 * (0.18 + Math.random() * 0.64),
      y: H0 * (0.2 + Math.random() * 0.4),
      r: 7 + Math.random() * 9,
      start: Math.random() * 28, // en images à 60 Hz
      life: 50 + Math.random() * 20,
      color: Math.random() < 0.5 ? '#fff6c8' : '#ffd24a',
    }));

    overlay((ctx, dt, t, W, H) => {
      const drag = Math.pow(0.992, dt);
      let alive = 0;
      for (const p of parts) {
        p.vy += 0.32 * p.g * dt;
        p.vx *= drag;
        p.vy *= drag;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
        if (p.y > H + 20) continue;
        alive++;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        if (p.sprite) {
          ctx.drawImage(p.sprite, -p.size / 2, -p.size / 2, p.size, p.size);
        } else {
          ctx.fillStyle = p.color;
          if (p.round) { ctx.beginPath(); ctx.arc(0, 0, p.h, 0, Math.PI * 2); ctx.fill(); }
          else ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        }
        ctx.restore();
      }
      for (const s of sparks) {
        const k = (t - s.start) / s.life;
        if (k < 0 || k > 1) { if (k < 0) alive++; continue; }
        alive++;
        const pulse = Math.sin(k * Math.PI); // 0 -> 1 -> 0
        ctx.globalAlpha = pulse * (0.65 + 0.35 * Math.sin(t * 0.7 + s.x)); // clignote pendant qu'elle brille
        ctx.fillStyle = s.color;
        star(ctx, s.x, s.y, s.r * (0.5 + pulse));
        ctx.globalAlpha = 1;
      }
      return alive > 0;
    }, 640);
  }

  // Pluie de neige au lancement : flocons ronds (et quelques flocons dessinés) qui tombent du haut de l'écran en
  // dérivant, pendant quelques secondes, puis plus rien.
  function snowfall({ flakes = 110 } = {}) {
    if (reduced()) return;
    const W0 = window.innerWidth;
    const parts = Array.from({ length: flakes }, () => ({
      x: Math.random() * W0,
      y: -20,
      delay: Math.random() * 200, // les flocons partent en continu pendant ~3 s
      vy: 1.2 + Math.random() * 1.8,
      sway: 10 + Math.random() * 22,
      ph: Math.random() * 6.28,
      sp: 0.015 + Math.random() * 0.02,
      r: 1.6 + Math.random() * 2.6,
      a: 0.5 + Math.random() * 0.45,
      sprite: Math.random() < 0.12 && spriteReady('flake') ? SPRITES.flake : null,
      size: 11 + Math.random() * 8,
      rot: Math.random() * 6.28,
    }));
    overlay((ctx, dt, t, W, H) => {
      let alive = 0;
      for (const p of parts) {
        if (t < p.delay) { alive++; continue; }
        p.y += p.vy * dt;
        p.rot += 0.01 * dt;
        if (p.y > H + 20) continue;
        alive++;
        const x = p.x + Math.sin((t - p.delay) * p.sp + p.ph) * p.sway;
        ctx.globalAlpha = p.a;
        if (p.sprite) {
          ctx.save();
          ctx.translate(x, p.y);
          ctx.rotate(p.rot);
          ctx.drawImage(p.sprite, -p.size / 2, -p.size / 2, p.size, p.size);
          ctx.restore();
        } else {
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(x, p.y, p.r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      return alive > 0;
    }, 900);
  }

  // Éclaboussures de neige (un toucher sur le bonhomme) : une poignée de boules blanches qui jaillissent et retombent.
  function splash(x, y, n = 14) {
    if (reduced()) return;
    const parts = Array.from({ length: n }, () => {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
      const s = 2.5 + Math.random() * 5;
      return { x: x + (Math.random() - 0.5) * 30, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, r: 2 + Math.random() * 3.5 };
    });
    overlay((ctx, dt, t) => {
      let alive = 0;
      for (const p of parts) {
        p.vy += 0.28 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        const life = 1 - t / 45;
        if (life <= 0) continue;
        alive++;
        ctx.globalAlpha = Math.min(1, life * 1.4);
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * (0.5 + life * 0.5), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      return alive > 0;
    }, 60);
  }

  // « Pouf » : le bonhomme éclate en poudre de neige qui s'étale largement sur le sol (nuage de fines particules
  // douces, surtout horizontales, qui retombent doucement).
  function poof(x, y) {
    if (reduced()) return;
    const parts = Array.from({ length: 150 }, () => {
      const a = (Math.random() - 0.5) * Math.PI * 1.15 - Math.PI / 2; // éventail vers le haut
      const s = 1.5 + Math.random() * 6.5;
      return {
        x: x + (Math.random() - 0.5) * 24, y: y - Math.random() * 40,
        vx: Math.cos(a) * s * 1.7, vy: Math.sin(a) * s * 0.75,
        r: 3 + Math.random() * 9, life: 70 + Math.random() * 60,
      };
    });
    overlay((ctx, dt, t) => {
      let alive = 0;
      for (const p of parts) {
        p.vy += 0.07 * dt;
        p.vx *= Math.pow(0.975, dt);
        p.vy *= Math.pow(0.985, dt);
        p.x += p.vx * dt;
        p.y = Math.min(p.y + p.vy * dt, y + 6); // la poudre s'étale sur le sol, elle ne s'y enfonce pas
        const k = 1 - t / p.life;
        if (k <= 0) continue;
        alive++;
        ctx.globalAlpha = Math.min(0.9, k * 1.2);
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * (1.4 - k * 0.4));
        g.addColorStop(0, 'rgba(255,255,255,1)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * (1.4 - k * 0.4), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      return alive > 0;
    }, 160);
  }

  // Compteur qui monte de 0 à la valeur cible
  function countUp(el, target, ms = 900, prefix = '') {
    if (reduced()) { el.textContent = prefix + target.toLocaleString('fr-FR'); return; }
    const t0 = performance.now();
    (function step(now) {
      const k = Math.min((now - t0) / ms, 1);
      const eased = 1 - Math.pow(1 - k, 3);
      el.textContent = prefix + Math.round(target * eased).toLocaleString('fr-FR');
      if (k < 1) requestAnimationFrame(step);
    })(t0);
  }

  FJ.fx = { confetti, snowfall, splash, poof, countUp };
})();
