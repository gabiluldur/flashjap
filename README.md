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
- **Kanji Only** : uniquement des mots (les phrases sont exclues), les kanjis seuls au recto (`食`), la traduction puis la lecture en hiragana au verso quand elle est connue (`Manger` / `たべる`). Règles dans `js/kanji.js`.
- **Ajouter une carte** (Accueil → Cartes → ＋ Ajouter une carte) : formulaire recto/verso + emoji facultatif, pour compléter le CSV sans repasser par un fichier. Le champ verso porte `lang="ja"`, ce qui fait basculer automatiquement le clavier japonais sur mobile si l'utilisateur en a un installé (aucun effet garanti sur PC, qui n'a pas de clavier virtuel).
- **Kanji Only, forcer/exclure une carte** : à l'ajout (segment Auto/Kanji/Classique, avec aperçu en direct) ou depuis Mes mots (bouton qui fait défiler Auto → Forcé → Exclu). Stocké dans `card.kanjiForce` (`undefined` = détection automatique). Utile quand la détection automatique se trompe sur une carte précise.
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

## Catégories (leçons) et sélection à réviser
- Une seule catégorie par carte (`card.cat`, ex. `Genki L03`). Colonne CSV `categorie` (aussi `catégorie`, `category`, `cat`, `lecon`, `leçon`, `lesson`, `deck`).
- Réimporter un CSV catégorisé range les cartes existantes sans toucher à leur progression : la catégorie n'est complétée que si la carte n'en avait pas ; si elle en a déjà une autre, l'appli demande avant de la remplacer (par défaut : on garde celle de l'utilisateur).
- Accueil, engrenage de la bulle « Réviser » → tiroir de réglages (fermé par défaut), rubrique « Leçons à réviser » (visible dès qu'une carte a une catégorie) : sélection (`settings.catPool`, `null` = toutes) qui filtre les sessions classique **et** Kanji Only (nouvelles + à réviser). Toucher une leçon depuis « Toutes » l'isole ; ensuite chaque touche ajoute/retire une leçon ; le tirage est aléatoire si « Mélanger les cartes » est actif. Tiroir fermé, une sélection active reste visible sous le bouton de révision (📚 nom des leçons, point sur l'engrenage) avec le rappel des révisions dues hors sélection et un bouton « Les inclure ».

## Organisation de l'accueil
- Ordre : bulle **Réviser** (classique + Kanji Only ; l'engrenage ouvre le tiroir « leçons + options de session »), **Ma progression** (mémoire, compteurs, graphique par jour), **Cartes**, puis la connexion / synchronisation tout en bas.
- Les réglages de session (sens, mélange, nouvelles par session, sons) s'appliquent aussi à Kanji Only, sauf le sens des cartes.
- Ajout de carte : menu Catégorie (dernière utilisée mémorisée) + « Nouvelle catégorie… » (une catégorie créée pendant une sélection en cours rejoint cette sélection). Mes mots : filtre et affichage par catégorie.

## Modifier une carte
- Mes mots → toucher une carte → « ✎ Modifier » : recto, verso (notes sur les lignes suivantes), emoji, catégorie (avec création), réglage Kanji Only, et deux menus de maîtrise (classique : Nouvelle, Étapes 1–8, Validée, Masterisée ; Kanji Only : sans « Masterisée »).
- La carte garde son identifiant : la progression est conservée. `store.addCards` reconnaît aussi un doublon par son texte actuel, donc réimporter le CSV d'origine (ou la version corrigée) ne recrée rien. Corriger une maîtrise ne donne ni ne retire d'XP ; passer en « Masterisée » marque `masterXp` pour éviter un double gain plus tard.

## « Je savais, mais pas le kanji »
- En révision classique, après avoir retourné une carte qui a une version Kanji Only (hors repasse de fin de boucle) : bouton « ✓ Je savais, mais pas le kanji 漢 » (raccourci clavier : K). La carte compte comme réussie normalement (XP, planning, combo) **et** passe en tête de la prochaine session Kanji Only (`card.kprio`), à réviser tout de suite ; si sa progression Kanji était validée, elle repart de l'étape 1.
- La priorité Kanji est effacée dès que la carte est révisée en Kanji Only (elle reste tant qu'elle ne l'a pas été) et ne s'applique qu'à cette piste.

## Importer depuis un autre site (assistant d'import)
- Accueil → Cartes → « Importer depuis un autre site… », ou automatiquement quand « Importer un CSV » reçoit un fichier dont les colonnes ne sont pas reconnues (`parseCards` renvoie `needsMapping`).
- Fichier ou texte collé ; entièrement local. Détection du séparateur (tabulation, virgule, point-virgule, barre verticale), de l'encodage (UTF-8, Windows-1252, Shift-JIS, EUC-JP, modifiable) et de l'en-tête ; lignes `#separator:` / `#html:` d'Anki lues ; HTML, `[sound:…]` et entités nettoyés.
- Rôle de chaque colonne au choix (Recto, Verso, Emoji, Catégorie, Ignorer), « Inverser recto/verso », catégorie par défaut, aperçu et compteurs (prêtes / déjà présentes / incomplètes), préréglages Anki, Quizlet, Excel/Sheets. Ensuite `runImport` : même import additif que partout ailleurs. Non géré : paquets Anki `.apkg`.

## Packs de démarrage
- `starter/vocab-genki.csv` (1000 mots) et `starter/kanji-genki.csv` (145 kanjis, déjà écrits kanji → lecture(s) + sens) : fichiers publics, versionnés avec le code (contrairement à `data/`, réservé à vos données personnelles).
- Les deux packs sont **catégorisés par leçon de Genki** (colonne `categorie`) : vocabulaire `Genki L01`–`Genki L12` + `Hors Genki` (408 mots), kanji `Genki L03`–`Genki L12`. Ré-importer un pack sur un compte qui a déjà ces cartes les range dans leur leçon sans rien recréer ni toucher à la progression (les textes sont identiques, donc mêmes cartes).
- **Corriger un pack déjà importé** (colonnes CSV optionnelles) : `ancien_recto` + `ancien_verso` donnent l'ancien texte d'une carte ; à l'import, si cette carte existe et n'a pas été modifiée par l'utilisateur, elle est corrigée **sur place** (même identifiant, progression conservée, pas de doublon) ; si l'utilisateur l'a modifiée lui-même, sa version est gardée. Un `-` dans la colonne `emoji` retire l'emoji des cartes déjà importées (une cellule vide ne change rien).
- Accessibles via deux boutons (accueil, état vide + section Cartes → « Packs de démarrage »), qui passent par le même chemin que l'import CSV classique : purement additif, jamais de remplacement.
- Colonne `kanji_only` (valeurs `off`/`on`, lue par `js/csv.js`) : le pack kanji la met à `off` sur toutes ses cartes, pour ne pas dupliquer son propre travail dans le mode Kanji Only (chaque carte y est déjà construite comme kanji → sens).
- Pour mettre à jour ces fichiers plus tard : même format CSV que d'habitude (`recto_texte,verso_texte,emoji[,kanji_only]`).

## Petits mots publics
- Zone discrète en bas de l'accueil (au-dessus de la connexion), visible une fois connecté : les mots des 7 derniers jours, sans pop-up. Chaque bulle a une petite ✕ pour la fermer une fois lue (mémorisé sur l'appareil).
- « ✏️ Laisser un petit mot » : 100 caractères max + un smiley (😍 🙂 😐 🐛 💡) + case « rester anonyme » (sinon le prénom Google est affiché). Le formulaire précise que le mot est **visible par tous les utilisateurs**. Pas de réponses, pas de chat.
- Un seul mot par personne et par jour : appliqué côté serveur (identifiant du document `{uid}_{jour}`, un second envoi le même jour est refusé par les règles) et rappelé dans l'interface.
- Collection Firestore `notes` : lecture pour tout compte connecté admis, création seule (jamais modifiable), suppression réservée au propriétaire (modération depuis la console Firebase). Règles : `data/firestore.rules`.

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
