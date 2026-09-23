(function () {
  const FJ = (globalThis.FJ = globalThis.FJ || {});

  const RECTO_HEADERS = ['recto_texte', 'recto', 'front', 'question'];
  const VERSO_HEADERS = ['verso_texte', 'verso', 'back', 'reponse', 'réponse', 'answer'];
  const CAT_HEADERS = ['categorie', 'catégorie', 'category', 'cat', 'lecon', 'leçon', 'lesson', 'deck'];

  function detectDelimiter(text) {
    const firstLine = text.split(/\r?\n/, 1)[0];
    const counts = { ',': 0, ';': 0, '\t': 0 };
    for (const ch of firstLine) if (ch in counts) counts[ch]++;
    return Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
  }

  // Parseur CSV avec champs entre guillemets, guillemets doublés ("") et retours à la ligne dans les champs.
  function parseRows(text, delim) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
        } else field += c;
      } else if (c === '"' && field === '') {
        inQuotes = true;
      } else if (c === delim) {
        row.push(field);
        field = '';
      } else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field);
        field = '';
        rows.push(row);
        row = [];
      } else field += c;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  // Nettoie une cellule : <br> -> saut de ligne, autres balises retirées, espaces superflus retirés.
  function clean(s) {
    return (s || '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .join('\n')
      .normalize('NFC');
  }

  // Hash 53 bits (cyrb53) : identifiant stable d'une carte = même recto + même verso -> même id (dédoublonnage).
  function hash(str) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  }

  function cardId(recto, verso) {
    return hash(recto + '' + verso);
  }

  // Renvoie { cards: [{id, recto, verso}], skipped, error }
  function parseCards(text) {
    text = text.replace(/^﻿/, '');
    const rows = parseRows(text, detectDelimiter(text)).filter((r) => r.some((v) => v.trim() !== ''));
    if (!rows.length) return { cards: [], skipped: 0, error: 'Fichier vide.' };

    const head = rows[0].map((h) => h.trim().toLowerCase());
    const ri = head.findIndex((h) => RECTO_HEADERS.includes(h));
    const vi = head.findIndex((h) => VERSO_HEADERS.includes(h));
    if (ri < 0 || vi < 0) {
      // needsMapping : format inconnu (autre site) -> l'appli propose l'assistant d'import pour choisir les colonnes
      return { cards: [], skipped: 0, needsMapping: true, error: 'Colonnes introuvables : il faut au moins "recto_texte" et "verso_texte".' };
    }

    // Colonnes d'images facultatives : URL https ou chemin relatif (ex. images/chien.jpg)
    const rii = head.findIndex((h) => ['recto_image', 'recto_img'].includes(h));
    const vii = head.findIndex((h) => ['verso_image', 'verso_img'].includes(h));

    const ei = head.findIndex((h) => ['emoji', 'émoji'].includes(h)); // un seul emoji par carte, facultatif
    const ki = head.findIndex((h) => ['kanji_only', 'kanjionly'].includes(h)); // "on"/"force" ou "off" : voir js/kanji.js
    const ci = head.findIndex((h) => CAT_HEADERS.includes(h)); // catégorie / leçon : une seule par carte

    const cards = [];
    let skipped = 0;
    for (const row of rows.slice(1)) {
      const recto = clean(row[ri]);
      const verso = clean(row[vi]);
      if (!recto || !verso) { skipped++; continue; }
      const card = { id: cardId(recto, verso), recto, verso };
      const rimg = cleanImage(row[rii]);
      const vimg = cleanImage(row[vii]);
      const emoji = cleanEmoji(row[ei]);
      if (rimg) card.rimg = rimg;
      if (vimg) card.vimg = vimg;
      if (emoji) card.emoji = emoji;
      const cat = cleanCategory(row[ci]);
      if (cat) card.cat = cat;
      const kanjiOnly = (row[ki] || '').trim().toLowerCase();
      if (kanjiOnly === 'off') card.kanjiForce = false;
      else if (kanjiOnly === 'on' || kanjiOnly === 'force') card.kanjiForce = true;
      cards.push(card);
    }
    return { cards, skipped, error: null };
  }

  // Garde le premier "caractère" (emoji composé compris) et refuse le texte ordinaire
  function cleanEmoji(s) {
    const v = (s || '').trim();
    if (!v || /[A-Za-z0-9]/.test(v)) return '';
    if (typeof Intl !== 'undefined' && Intl.Segmenter) return [...new Intl.Segmenter().segment(v)][0].segment;
    return [...v][0];
  }

  // Nom de catégorie : une seule ligne, espaces normalisés, 60 caractères max
  function cleanCategory(s) {
    return (s || '').replace(/\s+/g, ' ').trim().normalize('NFC').slice(0, 60);
  }

  function cleanImage(s) {
    const v = (s || '').trim();
    if (!v || /^(javascript|data|vbscript|file):/i.test(v)) return '';
    return v;
  }

  FJ.csv = {
    parseCards, parseRows, clean, cleanCategory, cleanEmoji, cardId,
    HEADERS: { recto: RECTO_HEADERS, verso: VERSO_HEADERS, cat: CAT_HEADERS },
  };
})();
