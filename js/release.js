(function () {
  const FJ = (globalThis.FJ = globalThis.FJ || {});

  // Version de l'appli et annonce de mise à jour (fenêtre "Quoi de neuf ?", affichée UNE SEULE FOIS par appareil).
  //
  // Pour annoncer une mise à jour :
  //   1. augmenter `version` (ex. 1.1.0 -> 1.2.0) : c'est ce qui redéclenche la fenêtre chez tout le monde ;
  //   2. réécrire `items` (3 à 5 lignes courtes) ;
  //   3. mettre `announce` à true, puis publier.
  // Tant que `announce` vaut false, personne ne voit la fenêtre (le numéro de version reste affiché en bas de l'accueil).
  // Aperçu sans rien déclencher chez les autres : ajouter ?news=1 à l'adresse de l'appli.
  FJ.release = {
    version: '1.1.0',
    announce: false,
    title: 'Quoi de neuf ?',
    items: [
      '💬 Petits mots publics : un mot par jour, visible de tous, dans une zone discrète en bas de l\'accueil.',
      '📦 Mises à jour : de nouveaux paquets de cartes à intégrer quand vous voulez, avec aperçu du contenu.',
      '✨ Combos : un feu doux derrière la carte dès 10 réussites d\'affilée, et chaque série laisse un point qui rapporte 1 XP bonus en fin de session.',
      '🛠 Correctif : l\'XP ne recule plus d\'un appareil à l\'autre.',
    ],
  };
})();
