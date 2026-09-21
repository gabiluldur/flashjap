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
    levelup: [[523, 0, 0.14, 'sine', 0.09], [659, 0.12, 0.14, 'sine', 0.09], [784, 0.24, 0.14, 'sine', 0.09], [1047, 0.36, 0.4, 'sine', 0.1]],
  };

  FJ.audio = {
    enabled: true,
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
