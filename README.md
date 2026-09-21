# Flash Jap

Prototype local de flashcards (HTML/CSS/JS pur, sans build). Ouvrir `index.html` dans Chrome.
Les données (cartes + progression) sont stockées dans le `localStorage` du navigateur : rien n'est envoyé nulle part.

## Utilisation
1. **Importer un CSV** (colonnes `recto_texte` et `verso_texte` ; `,` `;` ou tabulation ; UTF-8).
   Les cartes déjà présentes (même recto + même verso) sont ignorées ; les autres sont ajoutées comme nouvelles.
   Fichiers d'exemple dans `data/`.
2. **Commencer la révision** : Espace = retourner, ← à revoir, → je savais, ↓ repasser à la fin.
3. Sauvegarde manuelle : Accueil > Données > Exporter / Restaurer.

## Fonctions
- **Kanji Only** : toutes les cartes contenant un kanji (`js/kanji.js`), japonais d'abord, avec leur propre progression Leitner.
- **Mettre de côté** (en session ou dans Mes mots) : la carte sort des sessions et des compteurs, récupérable à tout moment.
- **Éliminer** : idem mais rangé dans le filtre « Éliminés » (restaurable). Un CSV réimporté ne les fait pas réapparaître.
- **Priorité** ★ : la carte passe en tête des sessions et ignore la limite de nouvelles cartes.
- **Masterisé** ✓ (en session ou dans Mes mots, avec confirmation) : le mot sort de toutes les révisions et rapporte 100 XP (une seule fois par carte). Annulable depuis le filtre « Masterisés ».
- **Kanji Only** : uniquement des mots (les phrases sont exclues), les kanjis seuls au recto (`食`), les traductions seules au verso (`Manger`). Règles dans `js/kanji.js`.
- **Emojis** : un emoji par carte quand il est pertinent, affiché sur la face réponse. Ils viennent d'une colonne `emoji` du CSV importé (réimporter un CSV met à jour les cartes existantes sans toucher à leur progression).
- **Progression par jour** : graphique (cartes / XP / temps, 7 ou 30 jours) sous les compteurs. Le temps ne compte que pendant une session (onglet masqué = en pause).
- **Images** : colonnes `recto_image` / `verso_image` du CSV (URL https ou chemin relatif, ex. `images/chien.jpg`). Réimporter un CSV met à jour les images des cartes existantes sans toucher à leur progression.
- **Fin de session** : fanfare, confettis, étoiles (selon la réussite), XP qui monte. Le combo tremble au-delà de 10.
- **Enregistrement** : à chaque carte (localStorage). Rien à sauvegarder à la main.

## Synchronisation (Firebase)
- Connexion Google + base Firestore (`users/{uid}/cards/{idCarte}` et `users/{uid}/meta/state`). Code : `js/sync.js` (Firebase), `js/sync-core.js` (logique de fusion, indépendante de Firebase), configuration publique dans `js/firebase-config.js`.
- « Local d'abord » : chaque action est enregistrée tout de suite sur l'appareil, puis envoyée en arrière-plan (cache hors-ligne : les révisions faites sans réseau partent au retour de la connexion).
- Conflit : le dernier écrit gagne, carte par carte. Réinitialiser ou restaurer une sauvegarde s'applique à tous les appareils.
- Les règles de sécurité Firestore se publient dans la console Firebase (*Firestore → Règles*) : chaque compte n'accède qu'à `users/{son uid}`, et le site étant public, seul le compte du propriétaire est accepté.
- Première utilisation : se connecter, puis importer le CSV **sur un seul appareil** ; les autres n'ont qu'à se connecter.

## Règles
- Échelle de Leitner : 10 min → 1 j → 2 j → 3 j → 1 sem → 2 sem → 1 mois → 3 mois → **validée**.
  Un échec renvoie à l'étape 1 (10 min). Les intervalles en jours reviennent à 4 h du matin du jour cible.
- « À revoir » et « Repasser » remettent la carte en fin de boucle. Les repasses après un échec ne changent ni le planning ni l'XP.
- XP : 10 + 2 × étape (+5 première fois, +40 à la validation, + combo plafonné à +5). Un échec ne rapporte rien.
- Niveaux : 50 statuts, ~349 000 XP cumulés pour le niveau 50. Courbe réglable via `LEVEL_BASE` / `LEVEL_SCALE` (`js/levels.js`).
- Rangs : un tous les 5 niveaux (Pousse, Bambou, Bronze, Argent, Or, Jade, Saphir, Rubis, Améthyste, Dragon).

## Fichiers
- `js/csv.js` import CSV · `js/srs.js` Leitner + XP · `js/levels.js` niveaux · `js/store.js` stockage · `js/audio.js` sons · `js/app.js` interface.
- `js/store.js` est le seul point d'accès aux données : c'est là que se branchera la synchro plus tard.
