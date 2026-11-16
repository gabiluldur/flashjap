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
    announce: true,
    title: 'Édition de Noël',
    items: [
      '🎄 Mode Noël ! Attention au bonhomme chatouilleux.',
      '🏆 Succès à débloquer',
      '🌍 Compteur communautaire : Objectif révision ensemble avant 2027 !',
      '📖 Nouveau mode : Conjugaison ✨ Maîtrise les 5 formes 👊 (ou presque...)',
    ],
  };
})();
