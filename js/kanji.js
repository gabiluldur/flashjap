(function () {
  const FJ = (globalThis.FJ = globalThis.FJ || {});

  const HAN = /[㐀-䶿一-鿿]/;
  const HAN_RUNS = /[㐀-䶿一-鿿]+/g;
  const KANA = /[぀-ヿ]/;
  const KANA_G = /[぀-ヿ]/g;
  const LATIN = /[A-Za-zÀ-ÿ]{2,}/;
  const JP_CHAR = /[぀-ヿ㐀-鿿]/;

  const MAX_OKURIGANA = 4; // au-delà, ce n'est plus "un mot avec ses kanjis" mais une expression ou une phrase
  const MAX_TRANSLATION_WORDS = 5;

  function jpRatio(s) {
    const chars = [...s.replace(/\s/g, '')];
    return chars.length ? chars.filter((ch) => JP_CHAR.test(ch)).length / chars.length : 0;
  }

  const firstLine = (t) => t.split('\n')[0];

  // Ne garde que la partie "traduction" d'une ligne : lignes avec kana (lectures, notes en japonais) retirées,
  // kanjis éventuels retirés aussi.
  function translationOnly(line) {
    if (KANA.test(line)) return '';
    return frenchPart(line);
  }

  // Le texte français d'une ligne : tous les caractères japonais retirés, parenthèses vides nettoyées
  function frenchPart(line) {
    const l = line
      .replace(/[぀-ヿ㐀-鿿]+/g, ' ')
      .replace(/[（(]\s*[）)]/g, ' ')
      .replace(/\s+-\s+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return LATIN.test(l) ? l : '';
  }

  const translations = (text) => text.split('\n').map(translationOnly).filter(Boolean);
  const kanjiOnly = (line) => (line.match(HAN_RUNS) || []).join('');

  // La forme écrite avec kanjis quand la lecture est donnée à côté : "はれ (晴れ)" -> "晴れ", "経済 - けいざい" -> "経済"
  function kanjiForm(line) {
    const m = line.match(/^(.+?)\s*[（(]([^）)]+)[）)]\s*$/) || line.match(/^(.+?)\s+[-–]\s+(.+)$/);
    if (m) {
      const [, a, b] = m;
      if (HAN.test(b) && !HAN.test(a)) return b;
      if (HAN.test(a) && !HAN.test(b)) return a;
    }
    return line;
  }

  // Phrase = ponctuation, plusieurs mots séparés, trop de hiragana, ou traduction qui ressemble à une phrase.
  function looksLikeSentence(form, translation) {
    if (form !== null) {
      const plain = form.replace(/[（(][^）)]*[）)]/g, '').trim();
      if (/[。、？！?!]/.test(plain) || /\s/.test(plain)) return true;
      if ((plain.match(KANA_G) || []).length > MAX_OKURIGANA) return true;
    }
    if (/[?!]/.test(translation) || /[^.]\.\s*$/.test(translation)) return true; // "..." n'est pas une fin de phrase
    return translation.split(/\s+/).length > MAX_TRANSLATION_WORDS;
  }

  // Vue "Kanji Only" d'une carte : { front, back } ou null si ce n'est pas un mot avec kanji.
  //  - front : uniquement les kanjis du mot (ni hiragana, ni katakana, ni lecture)   ex. "食"
  //  - back  : uniquement les traductions                                             ex. "Manger"
  // Les phrases sont exclues.
  function build(card) {
    const r = card.recto;
    const v = card.verso;
    const rh = HAN.test(r);
    const vh = HAN.test(v);
    if (!rh && !vh) return null;

    let jp;
    let other;
    let frenchHoldsKanji = false;
    if (rh && vh) [jp, other] = jpRatio(r) >= jpRatio(v) ? [r, v] : [v, r];
    else if (vh) [jp, other] = [v, r];
    else if (LATIN.test(r) && !LATIN.test(v)) { [jp, other] = [r, v]; frenchHoldsKanji = true; } // "Pas pratique 不便" / "ふべん"
    else [jp, other] = [r, v];

    const form = frenchHoldsKanji ? firstLine(jp).match(HAN_RUNS).join('') : kanjiForm(firstLine(jp));
    const front = kanjiOnly(form);
    if (!front) return null;

    // Traductions : le côté "autre" et, quand c'est le français qui porte les kanjis, ce texte français aussi.
    // (Les lectures en romaji collées au japonais, ex. "九月(kugatsu)", ne sont pas des traductions.)
    let lines = translations(other);
    if (frenchHoldsKanji) lines = [frenchPart(firstLine(jp)), ...lines].filter(Boolean);
    lines = [...new Set(lines)];
    if (!lines.length) lines = [firstLine(other)]; // filet de sécurité : jamais de verso vide

    if (looksLikeSentence(frenchHoldsKanji ? null : form, lines[0])) return null;
    return { front, back: lines.join('\n') };
  }

  const cache = new Map();
  function view(card) {
    const key = card.id + '|' + card.recto.length + '|' + card.verso.length;
    if (!cache.has(key)) cache.set(key, build(card));
    return cache.get(key);
  }

  FJ.kanji = { view, build, HAN };
})();
