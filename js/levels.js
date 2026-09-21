(function () {
  const FJ = (globalThis.FJ = globalThis.FJ || {});

  // 50 statuts, puis "Japaniste Suprême ✦N" au-delà
  const TITLES = [
    'Curieux du Japon', 'Jeune apprenti', 'Pousse de bambou', 'Japaniste en herbe', 'Petit tanuki',
    "Croqueur d'onigiri", 'Passager du Shinkansen', 'Buveur de thé vert', 'Chasseur de kanji', 'Habitué du konbini',
    'Lecteur de menus', 'Petit samouraï', 'Apprenti calligraphe', 'Dompteur de particules', 'Lanterne de festival',
    'Voyageur du dernier train', "Explorateur d'izakaya", 'Cueilleur de sakura', 'Promeneur de Kyoto', 'Ninja des conjugaisons',
    'Fan de ramen', 'Randonneur du Fuji', 'Gardien de temple', 'Moine du vocabulaire', 'Chef sushi en formation',
    'Artisan du hiragana', 'Rônin studieux', 'Poète de haïku', "Chineur d'Akihabara", 'Chevalier du katakana',
    'Marchand de takoyaki', 'Sage du bambou', 'Traducteur de panneaux', 'Maître du thé', 'Renard de Fushimi Inari',
    'Dompteur de keigo', 'Guide de Tokyo', 'Forgeron de phrases', "Grue d'origami", 'Sensei de comptoir',
    'Kitsune rusé', 'Calligraphe accompli', 'Shogun du vocabulaire', 'Tisseur de kanji', 'Maître de dojo',
    'Dragon de Kyoto', 'Sage de la montagne', 'Grand érudit', 'Légende vivante', 'Japaniste Suprême',
  ];

  // Un rang tous les 5 niveaux (niveaux 1-5, 6-10, …, 46-50). Le badge de l'en-tête évolue avec le rang.
  const TIERS = [
    { name: 'Pousse', kanji: '苗', color: '#7aa36b', ink: '#ffffff' },
    { name: 'Bambou', kanji: '竹', color: '#3f8f5f', ink: '#ffffff' },
    { name: 'Bronze', kanji: '銅', color: '#b07a45', ink: '#ffffff' },
    { name: 'Argent', kanji: '銀', color: '#b4bccb', ink: '#1f2430' },
    { name: 'Or', kanji: '金', color: '#e0ad3c', ink: '#1f2430' },
    { name: 'Jade', kanji: '翠', color: '#22a58f', ink: '#ffffff' },
    { name: 'Saphir', kanji: '蒼', color: '#3f6fd8', ink: '#ffffff' },
    { name: 'Rubis', kanji: '紅', color: '#d1435b', ink: '#ffffff' },
    { name: 'Améthyste', kanji: '紫', color: '#9a5bd6', ink: '#ffffff' },
    { name: 'Dragon', kanji: '龍', color: '#f08a1c', ink: '#1f2430' },
  ];

  // Calibrage : ~350 000 XP cumulés pour atteindre le niveau 50. À 30 cartes/jour en moyenne (~18 XP par bonne
  // réponse), cela représente environ 2 ans. Pour raccourcir/allonger : changer LEVEL_BASE / LEVEL_SCALE.
  const LEVEL_BASE = 80;
  const LEVEL_SCALE = 50;

  // XP nécessaire pour passer du niveau n au niveau n+1 : rapide au début, de plus en plus long ensuite
  const cost = (n) => Math.round((LEVEL_BASE + LEVEL_SCALE * Math.pow(n, 1.5)) / 10) * 10;

  const titleOf = (level) => (level <= TITLES.length ? TITLES[level - 1] : `${TITLES[TITLES.length - 1]} ✦${level - TITLES.length}`);
  const tierIndex = (level) => Math.min(Math.floor((level - 1) / 5), TIERS.length - 1);

  function fromXp(xp) {
    let level = 1;
    let left = Math.max(0, Math.floor(xp));
    while (left >= cost(level)) {
      left -= cost(level);
      level++;
    }
    const need = cost(level);
    const tier = tierIndex(level);
    return { level, into: left, need, pct: Math.round((left / need) * 100), title: titleOf(level), tier, tierInfo: TIERS[tier] };
  }

  // XP cumulé nécessaire pour atteindre un niveau donné (utile pour ajuster la courbe)
  function xpToReach(level) {
    let total = 0;
    for (let n = 1; n < level; n++) total += cost(n);
    return total;
  }

  FJ.levels = { TITLES, TIERS, cost, titleOf, tierIndex, fromXp, xpToReach };
})();
