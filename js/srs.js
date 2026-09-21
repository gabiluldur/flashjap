(function () {
  const FJ = (globalThis.FJ = globalThis.FJ || {});

  const MIN = 60 * 1000;

  // Échelle de Leitner : étape 0 = nouvelle, 1..8 = en cours, 9 = validée.
  // Chaque réussite passe à l'intervalle suivant ; un échec renvoie à l'étape 1 (10 min).
  const STEPS = [
    { label: '10 min', ms: 10 * MIN },
    { label: '1 jour', days: 1 },
    { label: '2 jours', days: 2 },
    { label: '3 jours', days: 3 },
    { label: '1 semaine', days: 7 },
    { label: '2 semaines', days: 14 },
    { label: '1 mois', days: 30 },
    { label: '3 mois', days: 90 },
  ];
  const VALIDATED = STEPS.length + 1;
  const FAIL_STAGE = 1;

  // Les intervalles en jours tombent à 4h du matin du jour cible : on ne rate pas une carte "due demain" parce qu'on
  // révise le matin plus tôt que la veille.
  function dayDue(now, days) {
    const d = new Date(now - 4 * 60 * MIN);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + days);
    d.setHours(4, 0, 0, 0);
    return d.getTime();
  }

  function dueFor(stage, now) {
    const step = STEPS[stage - 1];
    return step.ms ? now + step.ms : dayDue(now, step.days);
  }

  // Applique une révision (à ne faire que pour une vraie révision, pas une "repasse" de fin de session).
  function review(card, ok, now) {
    const before = card.stage;
    card.last = now;
    if (ok) {
      card.ok++;
      card.stage = before + 1;
    } else {
      card.ko++;
      card.stage = FAIL_STAGE;
    }
    const validated = card.stage >= VALIDATED;
    card.due = validated ? 0 : dueFor(card.stage, now);
    return { before, after: card.stage, due: card.due, validated, first: before === 0 };
  }

  // XP : plus la carte est avancée, plus elle rapporte. Le combo ajoute un petit bonus plafonné. Un échec ne rapporte rien.
  function xpFor(result, ok, combo) {
    if (!ok) return 0;
    let xp = 10 + 2 * result.before + Math.min(Math.max(combo - 1, 0), 5);
    if (result.first) xp += 5;
    if (result.validated) xp += 40;
    return xp;
  }

  function fmtDue(due, now) {
    const diff = due - now;
    if (diff <= 0) return 'maintenant';
    const min = Math.round(diff / MIN);
    if (min < 60) return `dans ${Math.max(min, 1)} min`;
    const h = Math.round(min / 60);
    if (h < 20) return `dans ${h} h`;
    const days = Math.round(diff / (24 * 60 * MIN));
    if (days <= 1) return 'demain';
    if (days < 14) return `dans ${days} j`;
    if (days < 60) return `dans ${Math.round(days / 7)} sem`;
    return `dans ${Math.round(days / 30)} mois`;
  }

  function fmtDuration(ms) {
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s} s`;
    const m = Math.round(s / 60);
    if (m < 60) return `${m} min`;
    return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
  }

  FJ.srs = { STEPS, VALIDATED, review, xpFor, fmtDue, fmtDuration, dueFor };
})();
