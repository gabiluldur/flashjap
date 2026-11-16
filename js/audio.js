(function () {
  const FJ = (globalThis.FJ = globalThis.FJ || {});

  // Sons synthétisés (aucun fichier audio) : doux, courts, volume bas.
  let ctx = null;

  function context() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function tone(c, freq, start, dur, type, vol) {
    const t0 = c.currentTime + start;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  // Souffle de neige : bruit blanc filtré dont la coupure descend (un « pfff » doux)
  function puffNoise(c, start, dur, vol, f0, f1) {
    const t0 = c.currentTime + start;
    const n = Math.max(1, Math.floor(c.sampleRate * dur));
    const buf = c.createBuffer(1, n, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = c.createBufferSource();
    src.buffer = buf;
    const filt = c.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(f0, t0);
    filt.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    const gain = c.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filt).connect(gain).connect(c.destination);
    src.start(t0);
  }

  const SOUNDS = {
    flip: [[520, 0, 0.06, 'triangle', 0.04]],
    ok: [[660, 0, 0.12, 'sine', 0.09], [880, 0.09, 0.18, 'sine', 0.09]],
    ko: [[300, 0, 0.14, 'triangle', 0.07], [235, 0.1, 0.2, 'triangle', 0.06]],
    skip: [[440, 0, 0.07, 'triangle', 0.04]],
    validated: [[784, 0, 0.14, 'sine', 0.09], [988, 0.11, 0.14, 'sine', 0.09], [1319, 0.22, 0.32, 'sine', 0.1]],
    // Petite fanfare de fin de session
    victory: [
      [523, 0, 0.16, 'triangle', 0.08], [659, 0.14, 0.16, 'triangle', 0.08], [784, 0.28, 0.16, 'triangle', 0.08],
      [1047, 0.42, 0.24, 'triangle', 0.09], [784, 0.68, 0.12, 'triangle', 0.07], [1047, 0.8, 0.12, 'triangle', 0.08],
      [1319, 0.92, 0.7, 'sine', 0.1], [1047, 0.92, 0.7, 'sine', 0.05], [784, 0.92, 0.7, 'sine', 0.05],
    ],
    master: [[659, 0, 0.12, 'sine', 0.08], [880, 0.1, 0.12, 'sine', 0.08], [1175, 0.2, 0.12, 'sine', 0.08], [1568, 0.3, 0.45, 'sine', 0.09]],
    // Succès débloqué : dix notes qui montent (gamme pentatonique de do), la dernière tenue avec un accord léger
    ach: [
      [523, 0, 0.12, 'sine', 0.07], [587, 0.085, 0.12, 'sine', 0.07], [659, 0.17, 0.12, 'sine', 0.07],
      [784, 0.255, 0.12, 'sine', 0.075], [880, 0.34, 0.12, 'sine', 0.075], [1047, 0.425, 0.12, 'sine', 0.08],
      [1175, 0.51, 0.12, 'sine', 0.08], [1319, 0.595, 0.14, 'sine', 0.085], [1568, 0.68, 0.18, 'sine', 0.09],
      [2093, 0.765, 0.75, 'sine', 0.09], [1047, 0.765, 0.75, 'sine', 0.035], [1568, 0.765, 0.75, 'sine', 0.035],
    ],
    // Paquet de cartes intégré : cinq notes qui montent (la dernière tenue)
    pack: [[440, 0, 0.13, 'sine', 0.085], [554, 0.1, 0.13, 'sine', 0.085], [659, 0.2, 0.13, 'sine', 0.085], [880, 0.3, 0.14, 'sine', 0.09], [1109, 0.42, 0.55, 'sine', 0.1]],
    levelup: [[523, 0, 0.14, 'sine', 0.09], [659, 0.12, 0.14, 'sine', 0.09], [784, 0.24, 0.14, 'sine', 0.09], [1047, 0.36, 0.4, 'sine', 0.1]],
  };

  FJ.audio = {
    enabled: true,
    // Un "ding" de cloche par point de combo au décompte final : la gamme pentatonique monte d'un point à l'autre
    ding(i = 0) {
      if (!FJ.audio.enabled) return;
      try {
        const c = context();
        if (!c) return;
        const semis = [0, 2, 4, 7, 9][i % 5] + 12 * Math.min(Math.floor(i / 5), 1);
        const f = 784 * Math.pow(2, semis / 12);
        tone(c, f, 0, 0.34, 'sine', 0.08);
        tone(c, f * 2, 0, 0.18, 'sine', 0.025); // petit harmonique : un timbre de clochette
      } catch (e) { /* le son est optionnel */ }
    },
    // « Puff puff » du bonhomme de neige qu'on touche : deux souffles courts, le second un peu plus bas
    puff() {
      if (!FJ.audio.enabled) return;
      try {
        const c = context();
        if (!c) return;
        puffNoise(c, 0, 0.13, 0.16, 1400, 380);
        puffNoise(c, 0.11, 0.15, 0.13, 1100, 300);
      } catch (e) { /* le son est optionnel */ }
    },
    // « Pouf » : le bonhomme éclate (grand souffle + un petit choc grave)
    pouf() {
      if (!FJ.audio.enabled) return;
      try {
        const c = context();
        if (!c) return;
        puffNoise(c, 0, 0.7, 0.3, 1800, 160);
        tone(c, 110, 0, 0.32, 'sine', 0.16);
        tone(c, 60, 0.02, 0.4, 'sine', 0.12);
      } catch (e) { /* le son est optionnel */ }
    },
    // Morceau de Noël : une seule fois par chargement de page, doucement, avec un écho (retard + retours) généré par le
    // navigateur. À appeler au lancement d'une session (un son avant un premier geste de l'utilisateur serait bloqué).
    xmasPlayed: false,
    playXmas() {
      if (!FJ.audio.enabled || FJ.audio.xmasPlayed) return;
      FJ.audio.xmasPlayed = true;
      try {
        const a = new Audio('assets/xmas/noel.mp3');
        a.preload = 'auto';
        let routed = false;
        try {
          const c = context();
          if (c) {
            const src = c.createMediaElementSource(a);
            const dry = c.createGain(); dry.gain.value = 0.2;
            const delay = c.createDelay(1); delay.delayTime.value = 0.34;
            const fb = c.createGain(); fb.gain.value = 0.42;
            const wet = c.createGain(); wet.gain.value = 0.22;
            src.connect(dry).connect(c.destination);
            src.connect(delay);
            delay.connect(fb).connect(delay);
            delay.connect(wet).connect(c.destination);
            routed = true;
          }
        } catch (e) { /* sans routage : lecture simple, plus bas */ }
        if (!routed) a.volume = 0.2;
        a.play().catch(() => { FJ.audio.xmasPlayed = false; }); // refusé par le navigateur : on retentera à la prochaine session
      } catch (e) { /* le son est optionnel */ }
    },
    play(name) {
      if (!FJ.audio.enabled || !SOUNDS[name]) return;
      try {
        const c = context();
        if (!c) return;
        for (const [f, s, d, t, v] of SOUNDS[name]) tone(c, f, s, d, t, v);
      } catch (e) { /* le son est optionnel */ }
    },
  };
})();
