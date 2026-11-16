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
    version: '1.2.0',
    announce: false,
    title: 'Édition de Noël',
    items: [
      '🎄 Noël : de la neige, un bonnet sur l\'appli et un bonhomme de neige à ne pas trop chatouiller.',
      '🏆 Succès cachés : une petite surprise à chaque étape. À vous de les trouver !',
      '🌙 Mode sombre par défaut, avec un interrupteur ☀️ en bas de l\'accueil.',
      '🌍 Un compteur de toutes les cartes révisées par la communauté.',
    ],
  };
})();
