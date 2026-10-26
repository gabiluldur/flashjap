(function () {
  const FJ = (globalThis.FJ = globalThis.FJ || {});

  // Succès : une liste de définitions, chacune avec un test calculé à partir de données que l'appli garde déjà
  // (stats, historique par jour, compteurs de cartes). Rien n'est stocké en plus que la date de déblocage de chaque
  // succès (settings.ach) et deux petits compteurs (settings.cnt : touchers de citrouille, bascules de thème).
  // Les succès sont "cachés" : l'appli n'affiche que ceux déjà débloqués.
  //
  // Une entrée : [id, icône, nom, phrase, test(contexte)]. Sans test, le succès est débloqué par un événement
  // (FJ.ach.unlockId). Le contexte est paresseux : une donnée n'est calculée que si un test la lit.
  const H = 3600000;
  const A = [
    // Cartes révisées au total
    ['c100', '🖌️', 'Premier coup de pinceau', "L'encre est encore fraîche.", (c) => c.reviews >= 100],
    ['c500', '🍙', 'Onigiri de mémoire', 'Ça tient bien au corps et à la tête !', (c) => c.reviews >= 500],
    ['c1000', '🥋', 'Ceinture blanche du Mémo', 'Tu ne manques pas d\'air !', (c) => c.reviews >= 1000],
    ['c2000', '🎋', 'Forêt de bambous', 'Ça pousse vite par ici.', (c) => c.reviews >= 2000],
    ['c5000', '🗻', 'Mont Fuji, face nord', 'On s\'organise pour escalader ta mémoire.', (c) => c.reviews >= 5000],
    ['c10000', '⛩️', 'Même les cartes te saluent', 'Dix mille révisions. Respect.', (c) => c.reviews >= 10000],

    // Jours d'affilée (au moins une carte révisée par jour) et retour après une pause
    ['s5', '🖐️', 'Sur les doigts d\'une main', 'Tu es régulier. Comme tes doigts de pieds.', (c) => c.streak >= 5],
    ['s10', '🍵', 'Rituel du thé', 'C\'est devenu une habitude.', (c) => c.streak >= 10],
    ['s20', '🥷', 'Ninja régulier', 'Personne ne t\'a vu rater un jour.', (c) => c.streak >= 20],
    ['s30', '🌸', 'Un mois de sakura', 'Les cerisiers en pleurent.', (c) => c.streak >= 30],
    ['back', '🌱', 'Le retour du héros', 'Pas de souci, les kanji t\'attendaient.', (c) => c.comeback],

    // Découvertes
    ['cit5', '🎃', 'Tripoteur de citrouille', 'Elle a rebondi 5 fois. Elle n\'est pas rancunière.', (c) => c.cnt.pumpkin >= 5],
    ['cit50', '🎃', 'Dresseur de citrouille', 'Cinquante rebonds. Elle te fait confiance.', (c) => c.cnt.pumpkin >= 50],
    ['theme', '🌗', 'Hésitant du soir', 'Clair, sombre, clair… C\'est normal, c\'est l\'automne.', (c) => c.cnt.theme >= 5],
    ['night', '🦉', 'Oiseau de nuit', 'Les kanji dorment. Pas toi.'],
    ['early', '🌅', 'Lève-tôt', 'Même le coq n\'est pas encore levé.'],
    ['note', '✉️', 'Message dans une bouteille', 'Tout le monde l\'a lu. Bravo pour le courage.'],
    ['pack', '📦', 'Livraison reçue', 'Le facteur a sonné deux fois.'],
    ['cloud', '☁️', 'Nuagiste', 'Tes cartes ont maintenant un compte.', (c) => c.signedin],
    ['export', '🛟', 'Ceinture de sécurité', 'Ton futur toi te remercie.'],
    ['author', '✍️', 'Auteur', 'Tu as écrit ta propre carte.'],

    // Sessions et combos
    ['ses10', '🧘', 'Habitué des lieux', 'Le tatami a ton empreinte.', (c) => c.sessions >= 10],
    ['ses50', '🏯', 'Gardien du dojo', 'Tu as les clés.', (c) => c.sessions >= 50],
    ['ses100', '🛖', 'Moine résident', 'On t\'a donné une chambre.', (c) => c.sessions >= 100],
    ['cb10', '🔥', 'Ça chauffe', 'Dix d\'affilée.', (c) => c.combo >= 10],
    ['cb20', '🎆', 'Brasier', 'Les neurones en détresse.', (c) => c.combo >= 20],
    ['cb30', '🌋', 'Volcan de la mémoire', 'Trente d\'affilée. Les voisins appellent les pompiers.', (c) => c.combo >= 30],
    ['perfect', '✨', 'Sans faute', '20 cartes, 0 erreur. De la magie (ou du travail).', (c) => c.done >= 20 && c.sessKo === 0],
    ['marathon', '🏃', 'Marathonien', '100 cartes d\'un coup. Les genoux vont bien ?', (c) => c.done >= 100],
    ['stubborn', '🪨', 'Têtu', 'Cette carte est coriace. Toi aussi.', (c) => c.maxKo >= 5],

    // Mots connus et maîtrise
    ['w50', '🌿', 'Vocabulaire en herbe', 'Les premiers mots s\'installent.', (c) => c.known >= 50],
    ['w100', '🍱', 'Bento de vocabulaire', 'Un peu de tout, bien rangé.', (c) => c.known >= 100],
    ['w250', '📚', 'Rat de bibliothèque', 'Tu connais des mots que tes amis ignorent.', (c) => c.known >= 250],
    ['w500', '🧠', 'Dico ambulant', 'On te demande l\'heure en japonais.', (c) => c.known >= 500],
    ['w1000', '🏆', 'Les mille et un mots', 'La base est complète.', (c) => c.known >= 1000],
    ['valid', '🎓', 'Diplômé', 'Une carte a gravi toute l\'échelle de Leitner.', (c) => c.validated >= 1],
    ['master', '🥇', 'Sensei', 'Ce mot-là, tu pourrais l\'enseigner.', (c) => c.mastered >= 1],

    // Temps de révision total (en session)
    ['t1', '☕', 'Une heure, un thé', 'Le thé a refroidi.', (c) => c.ms >= H],
    ['t5', '🎬', 'Séance cinéma', 'Sans le pop-corn.', (c) => c.ms >= 5 * H],
    ['t10', '🚄', 'Shinkansen de la mémoire', 'Ça file.', (c) => c.ms >= 10 * H],
    ['t24', '🌞', 'Une journée de kanji', '24 h cumulées. Réparties, heureusement.', (c) => c.ms >= 24 * H],
    ['t50', '🧙', 'Sensei en devenir', 'Cinquante heures. Tu pourrais ouvrir une école.', (c) => c.ms >= 50 * H],

    // Niveaux
    ['l5', '🪜', 'Premier barreau', 'Le niveau 5 est derrière toi.', (c) => c.level >= 5],
    ['l10', '🔟', 'Double chiffre', 'On passe à deux chiffres.', (c) => c.level >= 10],
    ['l25', '⛰️', 'À mi-pente', 'Le niveau 25. Ne regarde pas en bas.', (c) => c.level >= 25],
    ['l50', '🌟', 'Sommet atteint', 'Niveau 50. Tu es la légende du coin.', (c) => c.level >= 50],

    // Kanji (mode Kanji Only)
    ['k25', '🈶', 'Calligraphe en herbe', 'Premiers traits, premiers kanji.', (c) => c.kanji >= 25],
    ['k100', '🖋️', 'Pinceau d\'or', '100 kanji dans la poche.', (c) => c.kanji >= 100],
    ['k145', '💯', 'Les 145 sont à toi', '145 kanji connus, autant que dans le pack de base.', (c) => c.kanji >= 145],
    ['miss', '🤝', 'Presque !', 'Tu connaissais le mot, pas le kanji. Honnêteté récompensée.'],
  ];
  const BY_ID = new Map(A.map((a) => [a[0], { id: a[0], icon: a[1], name: a[2], text: a[3], test: a[4] }]));
  const dayNum = (key) => { const [y, m, d] = key.split('-').map(Number); return Math.floor(Date.UTC(y, m - 1, d) / 86400000); };

  // Contexte paresseux : chaque donnée n'est calculée qu'à la première lecture, une seule fois par vérification
  function makeCtx(extra) {
    const { store, levels } = FJ;
    const s = store.state;
    const now = Date.now();
    const lazy = (f) => { let done = false; let v; return { enumerable: true, get() { if (!done) { v = f(); done = true; } return v; } }; };
    // jours où au moins une carte a été révisée, triés
    const activeDays = lazy(() => Object.keys(s.daily).filter((k) => (s.daily[k].reviews || 0) > 0).sort().map(dayNum));
    const runs = lazy(() => {
      const d = activeDays.get(); // plus longue série de jours consécutifs, et au moins un retour après 7 jours d'absence ou plus
      let best = 0; let run = 0; let comeback = false;
      for (let i = 0; i < d.length; i++) {
        run = i && d[i] - d[i - 1] === 1 ? run + 1 : 1;
        if (run > best) best = run;
        if (i && d[i] - d[i - 1] >= 8) comeback = true;
      }
      return { best, comeback };
    });
    const main = lazy(() => store.counts(now, 'main'));
    return Object.defineProperties({
      reviews: s.stats.reviews || 0, sessions: s.stats.sessions || 0, ms: s.stats.ms || 0,
      cnt: s.settings.cnt || {}, signedin: FJ.syncUi && FJ.syncUi.phase === 'signedin',
      combo: 0, done: 0, sessKo: 1, // renseignés par l'appli quand ils ont un sens (combo en cours, fin de session)
      ...extra,
    }, {
      streak: lazy(() => runs.get().best),
      comeback: lazy(() => runs.get().comeback),
      known: lazy(() => main.get().known),
      validated: lazy(() => main.get().validated),
      mastered: lazy(() => main.get().mastered),
      kanji: lazy(() => store.counts(now, 'kanji').known),
      level: lazy(() => levels.fromXp(s.stats.xp).level),
      maxKo: lazy(() => s.cards.reduce((m, c) => Math.max(m, c.ko || 0), 0)),
    });
  }

  const got = () => FJ.store.state.settings.ach || (FJ.store.state.settings.ach = {});

  // ---- Notifications : en bas à droite, une à la fois, jamais bloquantes ----
  const queue = [];
  let showing = false;
  function pump() {
    const box = document.getElementById('achToasts');
    if (showing || !queue.length || !box) return;
    showing = true;
    const item = queue.shift();
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'ach-toast';
    el.innerHTML = `<span class="ach-ico" aria-hidden="true">${item.icon}</span><span class="ach-txt"><b></b><small></small></span>`;
    el.querySelector('b').textContent = item.name;
    el.querySelector('small').textContent = item.text;
    el.addEventListener('click', () => { if (FJ.ui && FJ.ui.openAch) FJ.ui.openAch(); end(); });
    box.appendChild(el);
    let ended = false;
    function end() {
      if (ended) return;
      ended = true;
      el.classList.add('out');
      setTimeout(() => { el.remove(); showing = false; pump(); }, 350);
    }
    setTimeout(end, 5200);
  }

  function notify(list) {
    if (FJ.audio) FJ.audio.play('ach');
    if (list.length >= 3) {
      queue.push({ icon: '🏆', name: `${list.length} succès débloqués !`, text: 'Touche ici pour les découvrir.' });
    } else {
      for (const a of list) queue.push(a);
    }
    pump();
    if (FJ.ui && FJ.ui.achChanged) FJ.ui.achChanged();
  }

  function unlockMany(list) {
    if (!list.length) return [];
    const ach = got();
    const t = Date.now();
    for (const a of list) ach[a.id] = t;
    FJ.store.save();
    notify(list);
    return list;
  }

  FJ.ach = {
    count: () => Object.keys(got()).filter((id) => BY_ID.has(id)).length,
    total: () => BY_ID.size,
    // succès débloqués, du plus récent au plus ancien
    unlocked: () => Object.keys(got()).filter((id) => BY_ID.has(id)).map((id) => ({ ...BY_ID.get(id), at: got()[id] })).sort((a, b) => b.at - a.at),
    // Évalue les succès non débloqués (tous, ou seulement `ids`), avec des valeurs fournies par l'appli (`extra`)
    check(ids, extra) {
      const todo = (ids || [...BY_ID.keys()]).map((id) => BY_ID.get(id)).filter((a) => a && a.test && !got()[a.id]);
      if (!todo.length) return [];
      const ctx = makeCtx(extra);
      return unlockMany(todo.filter((a) => a.test(ctx)));
    },
    // Succès débloqués par un événement précis
    unlockId(id) {
      const a = BY_ID.get(id);
      return a && !got()[id] ? unlockMany([a]) : [];
    },
    // Compteur (touchers de citrouille, bascules de thème) puis vérification des succès qui en dépendent
    bump(name, ids) {
      const s = FJ.store.state.settings;
      s.cnt = s.cnt || {};
      s.cnt[name] = (s.cnt[name] || 0) + 1;
      FJ.store.save();
      this.check(ids);
    },
    // À chaque carte révisée : seulement l'heure du jour (aucun calcul lourd)
    tick() {
      const h = new Date().getHours();
      if (h < 4) this.unlockId('night');
      else if (h < 7) this.unlockId('early');
    },
  };
})();
