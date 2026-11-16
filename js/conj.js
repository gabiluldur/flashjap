(function () {
  const FJ = (globalThis.FJ = globalThis.FJ || {});

  // Conjugaison : moteur et données, sans aucun code d'écran (l'interface est dans app.js).
  //
  // Principe : on ne stocke QUE les verbes (lecture en kana, traduction, groupe). Toutes les formes sont calculées par
  // des règles, donc aucune forme n'est tapée à la main (pas de faute de saisie) et les mauvaises réponses proposées
  // au QCM sont de vraies erreurs : on applique la mauvaise règle au même verbe (ex. la règle des verbes en る à un
  // verbe en む). Une erreur dit alors exactement ce qu'on confond.
  //
  // Groupes (comme dans le manuel) : 1 = verbes en う (godan), 2 = verbes en る (ichidan), 3 = する et くる.
  // Drapeau 'h' : la traduction s'affiche d'office (verbe ambigu une fois écrit sans kanji : かえる, いる).
  const VERBS = [
    // 3e groupe
    ['する', 'faire', '3'], ['くる', 'venir', '3'], ['べんきょうする', 'étudier', '3'], ['でんわする', 'téléphoner', '3'],
    // 2e groupe
    ['たべる', 'manger', '2'], ['みる', 'regarder', '2'], ['ねる', 'dormir', '2'], ['おきる', 'se lever', '2'],
    ['でる', 'sortir', '2'], ['いる', 'être (pour un être vivant)', '2', 'h'], ['できる', 'pouvoir', '2'],
    ['おしえる', 'enseigner', '2'], ['わすれる', 'oublier', '2'], ['かりる', 'emprunter', '2'], ['あける', 'ouvrir', '2'],
    ['しめる', 'fermer', '2'], ['はじめる', 'commencer', '2'], ['つける', 'allumer', '2'],
    ['でかける', "sortir, s'absenter", '2'], ['おぼえる', 'mémoriser', '2'], ['きめる', 'décider', '2'],
    ['みせる', 'montrer', '2'], ['いれる', 'mettre dedans', '2'], ['こたえる', 'répondre', '2'], ['おりる', 'descendre', '2'],
    // 1er groupe : う
    ['かう', 'acheter', '1'], ['あう', 'rencontrer', '1'], ['いう', 'dire', '1'], ['おもう', 'penser', '1'],
    ['つかう', 'utiliser', '1'], ['もらう', 'recevoir', '1'], ['ならう', 'apprendre', '1'], ['てつだう', 'aider', '1'],
    ['うたう', 'chanter', '1'], ['あらう', 'laver', '1'],
    // む ぶ ぬ
    ['のむ', 'boire', '1'], ['よむ', 'lire', '1'], ['すむ', 'habiter', '1'], ['やすむ', 'se reposer', '1'],
    ['あそぶ', 'jouer', '1'], ['よぶ', 'appeler', '1'], ['しぬ', 'mourir', '1'],
    // く ぐ
    ['いく', 'aller', '1'], ['きく', 'écouter', '1'], ['かく', 'écrire', '1'], ['あるく', 'marcher', '1'],
    ['はたらく', 'travailler', '1'], ['ひく', "jouer d'un instrument", '1'], ['およぐ', 'nager', '1'], ['いそぐ', 'se dépêcher', '1'], ['ぬぐ', 'enlever (un vêtement)', '1'],
    // す
    ['はなす', 'parler', '1'], ['かえす', 'rendre', '1'], ['けす', 'éteindre', '1'], ['だす', 'sortir (quelque chose)', '1'],
    ['おす', 'pousser', '1'],
    // つ
    ['まつ', 'attendre', '1'], ['もつ', 'tenir, porter', '1'], ['たつ', 'se lever, se tenir debout', '1'],
    // る (1er groupe : les « faux る »)
    ['かえる', 'rentrer', '1', 'h'], ['はいる', 'entrer', '1'], ['しる', 'savoir, connaître', '1'], ['はしる', 'courir', '1'],
    ['のる', 'monter dans', '1'], ['とる', 'prendre en photo', '1'], ['つくる', 'fabriquer', '1'], ['わかる', 'comprendre', '1'],
    ['ある', 'il y a (pour une chose)', '1'], ['なる', 'devenir', '1'], ['かかる', 'prendre du temps', '1'], ['おわる', 'se terminer', '1'],
  ].map(([k, fr, g, flags]) => ({ k, fr, g, hint: !!(flags && flags.includes('h')) }));

  // Les 8 formes demandées (la forme du dictionnaire est toujours celle qu'on voit en haut de la question)
  const FORMS = {
    neg: { label: 'Négatif neutre', end: '〜ない', cls: 'neg' },
    negpast: { label: 'Passé négatif neutre', end: '〜なかった', cls: 'neg' },
    // La forme en た n'est pas encore au programme : jamais demandée, jamais proposée comme réponse (voir NEIGH et CLS_FORMS)
    past: { label: 'Passé neutre', end: '〜た', cls: 'te', hidden: true },
    te: { label: 'Forme en て', end: '〜て', cls: 'te' },
    pm: { label: 'Présent poli', end: '〜ます', cls: 'pol' },
    pn: { label: 'Négatif poli', end: '〜ません', cls: 'pol' },
    pp: { label: 'Passé poli', end: '〜ました', cls: 'pol' },
    pnp: { label: 'Passé négatif poli', end: '〜ませんでした', cls: 'pol' },
  };
  const CLS_FORMS = { neg: ['neg', 'negpast'], te: ['te'], pol: ['pm', 'pn', 'pp', 'pnp'] };
  const VISIBLE = Object.keys(FORMS).filter((k) => !FORMS[k].hidden);
  const POL = { pm: 'ます', pn: 'ません', pp: 'ました', pnp: 'ませんでした' };

  // Tables des terminaisons de la forme du dictionnaire (1er groupe)
  const E = ['う', 'つ', 'る', 'む', 'ぶ', 'ぬ', 'く', 'ぐ', 'す'];
  const A = { う: 'わ', つ: 'た', る: 'ら', む: 'ま', ぶ: 'ば', ぬ: 'な', く: 'か', ぐ: 'が', す: 'さ' }; // base en あ (ない)
  const I = { う: 'い', つ: 'ち', る: 'り', む: 'み', ぶ: 'び', ぬ: 'に', く: 'き', ぐ: 'ぎ', す: 'し' }; // base en い (ます)
  const T = { う: 'っ', つ: 'っ', る: 'っ', む: 'ん', ぶ: 'ん', ぬ: 'ん', く: 'い', ぐ: 'い', す: 'し' }; // て / た
  const teEnd = (e, te) => {
    const c = T[e];
    const voiced = c === 'ん' || e === 'ぐ';
    return c + (te ? (voiced ? 'で' : 'て') : (voiced ? 'だ' : 'た'));
  };

  // Les quatre bases d'un verbe : a (→ ない), i (→ ます), te, ta
  function parts(k, g) {
    if (g === '3') {
      if (k.endsWith('する')) { const p = k.slice(0, -2); return { a: p + 'し', i: p + 'し', te: p + 'して', ta: p + 'した' }; }
      return { a: 'こ', i: 'き', te: 'きて', ta: 'きた' }; // くる
    }
    if (g === '2') { const s = k.slice(0, -1); return { a: s, i: s, te: s + 'て', ta: s + 'た' }; }
    const s = k.slice(0, -1);
    const e = k.slice(-1);
    let te = s + teEnd(e, true);
    let ta = s + teEnd(e, false);
    if (k === 'いく') { te = 'いって'; ta = 'いった'; } // la seule exception en く
    return { a: s + A[e], i: s + I[e], te, ta };
  }

  function conj(v, f) {
    const p = parts(v.k, v.g);
    switch (f) {
      case 'neg': return v.k === 'ある' ? 'ない' : p.a + 'ない'; // ある : jamais あらない
      case 'negpast': return (v.k === 'ある' ? '' : p.a) + 'なかった';
      case 'past': return p.ta;
      case 'te': return p.te;
      default: return p.i + POL[f];
    }
  }

  // « Compétence » suivie dans les statistiques : famille de terminaison × type de forme
  function fam(v, f) {
    if (v.g === '3') return v.k.endsWith('する') ? 'する' : 'くる';
    if (v.g === '2') return 'ichidan';
    if (v.k === 'いく' && FORMS[f].cls === 'te') return 'いく';
    if (v.k === 'ある' && FORMS[f].cls === 'neg') return 'ある';
    const e = v.k.slice(-1);
    return e === 'る' ? 'る1' : e;
  }

  const FAM_LABEL = {
    ichidan: 'les verbes du 2e groupe (en る)', する: 'les verbes en する', くる: 'くる', いく: 'いく', ある: 'ある',
    る1: 'les verbes en る du 1er groupe (かえる, はいる…)',
  };
  const famLabel = (f) => FAM_LABEL[f] || `les verbes en ${f}`;
  const CLS_LABEL = { neg: 'le négatif', te: 'la forme en て', pol: 'la forme polie' };

  // ---- Règle rappelée après une erreur : une seule ligne ----
  // « のむ → のんで. » en tête de règle, sauf quand la règle le dit déjà (する → して)
  function withHead(v, f) { const body = ruleBody(v, f); const head = `${v.k} → ${conj(v, f)}.`; return body.includes(`${v.k} → ${conj(v, f)}`) ? body : `${head} ${body}`; }
  function rule(v, f) { return withHead(v, f); }

  function ruleBody(v, f) {
    const cls = FORMS[f].cls;
    const e = v.k.slice(-1);
    const endTxt = cls === 'neg' ? (f === 'negpast' ? 'なかった' : 'ない') : '';
    let txt;
    if (v.g === '3') {
      const kuru = !v.k.endsWith('する');
      const base = kuru ? (cls === 'neg' ? 'こ' : 'き') : 'し';
      const root = kuru ? 'くる' : 'する';
      if (cls === 'te') txt = `Verbe irrégulier du 3e groupe : ${root} → ${kuru ? 'き' : 'し'}${f === 'te' ? 'て' : 'た'}.`;
      else txt = `Verbe du 3e groupe : ${root} → ${base}, puis ${cls === 'neg' ? endTxt : POL[f]}.`;
    } else if (v.g === '2') {
      const suf = cls === 'neg' ? endTxt : cls === 'te' ? (f === 'te' ? 'て' : 'た') : POL[f];
      txt = `Verbe du 2e groupe : on enlève る, puis ${suf}.`;
    } else if (cls === 'te') {
      const ta = f === 'past';
      if (v.k === 'いく') txt = `Exception : いく fait ${ta ? 'いった' : 'いって'}, pas ${ta ? 'いいた' : 'いいて'}.`;
      else if (['う', 'つ', 'る'].includes(e)) txt = `Les verbes en う, つ, る font ${ta ? 'った' : 'って'}.`;
      else if (['む', 'ぶ', 'ぬ'].includes(e)) txt = `Les verbes en む, ぶ, ぬ font ${ta ? 'んだ' : 'んで'}.`;
      else txt = `Les verbes en ${e} font ${teEnd(e, !ta)}.`;
    } else if (cls === 'neg') {
      const nega = f === 'negpast';
      if (v.k === 'ある') txt = nega ? 'Exception : ある → ない → なかった.' : 'Exception : le négatif de ある est ない, pas あらない.';
      else if (e === 'る') txt = `Verbe du 1er groupe : る → らない${nega ? ', puis なかった' : ''}.`;
      else txt = `Les verbes en ${e} font ${A[e]}ない${nega ? ', puis なかった' : ''}.`;
    } else {
      txt = e === 'る' ? `Verbe du 1er groupe : る → り, puis ${POL[f]}.` : `Les verbes en ${e} : ${e} → ${I[e]}, puis ${POL[f]}.`;
    }
    return txt;
  }

  // ---- Mauvaises réponses : de vraies erreurs d'élève, jamais des mots qui n'existent pas au hasard ----
  const NEIGH = {
    neg: ['negpast', 'pn', 'pm'], negpast: ['neg', 'pnp', 'pn'], te: ['pm', 'neg', 'pp'],
    pm: ['pn', 'pp', 'neg', 'te'], pn: ['pm', 'pnp', 'neg', 'pp'], pp: ['pm', 'pnp', 'pn'], pnp: ['pn', 'pp', 'negpast', 'pm'],
  };
  // terminaisons qu'on confond entre elles (même famille de sons)
  const CONFUSE = { む: ['ぶ', 'ぬ'], ぶ: ['む', 'ぬ'], ぬ: ['む', 'ぶ'], く: ['ぐ', 'す'], ぐ: ['く', 'す'], す: ['つ', 'く'], つ: ['う', 'る'], う: ['つ', 'る'], る: ['う', 'つ'] };
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const shuffle = (arr) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const sufOf = (f) => (f === 'negpast' ? 'なかった' : f === 'neg' ? 'ない' : POL[f]);

  // Erreur n°1 : la règle de l'autre groupe (2e groupe traité comme un verbe en る du 1er, et l'inverse)
  function otherGroup(v, f) {
    const s = v.k.slice(0, -1);
    const cls = FORMS[f].cls;
    if (v.g === '2') {
      if (cls === 'neg') return s + 'ら' + sufOf(f);
      if (cls === 'pol') return s + 'り' + POL[f];
      return s + (f === 'te' ? 'って' : 'った');
    }
    if (v.g === '1' && v.k.slice(-1) === 'る') { // « faux る » traité comme un 2e groupe
      if (cls === 'neg') return s + sufOf(f);
      if (cls === 'pol') return s + POL[f];
      return s + (f === 'te' ? 'て' : 'た');
    }
    if (v.g === '3' && v.k.endsWith('する')) { // する traité comme un verbe en す, ou comme un 2e groupe
      const p = v.k.slice(0, -2);
      const pick2 = Math.random() < 0.5;
      if (cls === 'neg') return pick2 ? p + 'す' + sufOf(f) : p + 'さ' + sufOf(f);
      if (cls === 'pol') return pick2 ? p + 'す' + POL[f] : p + 'しり' + POL[f];
      return pick2 ? p + (f === 'te' ? 'すて' : 'すた') : p + (f === 'te' ? 'すって' : 'すった');
    }
    if (v.g === '3') { // くる : on garde le く
      if (cls === 'neg') return 'く' + sufOf(f);
      if (cls === 'pol') return 'く' + POL[f];
      return f === 'te' ? 'くて' : 'くた';
    }
    return null;
  }

  // Erreur n°2 : mauvaise base (la base du négatif servie pour ます, ou l'inverse), pour les verbes en う qui ne finissent pas par る
  function wrongBase(v, f) {
    const p = parts(v.k, v.g);
    const cls = FORMS[f].cls;
    if (v.g === '3') {
      if (v.k.endsWith('する')) return null;
      if (cls === 'neg') return 'き' + sufOf(f);
      if (cls === 'pol') return 'こ' + POL[f];
      return null;
    }
    if (v.g === '2') return null; // les deux bases sont identiques
    if (cls === 'neg') return p.i + sufOf(f);
    if (cls === 'pol') return p.a + POL[f];
    return p.i + (f === 'te' ? 'て' : 'た');
  }

  // Erreur n°3 : la règle d'une terminaison voisine (1er groupe seulement : seules ces confusions sont réalistes)
  function neighbourRules(v, f) {
    if (v.g !== '1') return [];
    const s = v.k.slice(0, -1);
    const e = v.k.slice(-1);
    const cls = FORMS[f].cls;
    if (cls === 'te') return E.filter((x) => x !== e).map((x) => s + teEnd(x, f === 'te')); // les 5 familles : toutes réalistes
    return (CONFUSE[e] || []).map((x) => s + (cls === 'neg' ? A[x] + sufOf(f) : I[x] + POL[f]));
  }

  function choices(v, f) {
    const right = conj(v, f);
    const bad = [];
    const add = (t) => { if (t && t !== right && !bad.includes(t)) bad.push(t); };
    add(wrongBase(v, f));
    add(otherGroup(v, f));
    add(conj(v, NEIGH[f][0])); // la forme voisine la plus proche (négatif poli pour négatif neutre…)
    for (const t of shuffle(neighbourRules(v, f))) { if (bad.length >= 4) break; add(t); }
    // L'énoncé ne donne plus la terminaison : n'importe quelle autre forme visible du même verbe devient une réponse
    // possible, y compris la forme du dictionnaire
    const others = shuffle([...VISIBLE.filter((g) => g !== f).map((g) => conj(v, g)), v.k]);
    for (const t of others) { if (bad.length >= 4) break; add(t); }
    return shuffle([{ t: right, right: true }, ...bad.slice(0, 4).map((t) => ({ t, right: false }))]);
  }

  function question(v, f) {
    const cls = FORMS[f].cls;
    return { kind: 'qcm', v, f, cls, fam: fam(v, f), ans: conj(v, f), choices: choices(v, f), rule: rule(v, f), form: FORMS[f] };
  }

  // Tirage pondéré : plus on s'est trompé, plus la compétence revient ; une compétence jamais vue a un petit bonus
  const weight = (stat, fm, cls) => { const { o, k } = stat(fm, cls); return 1 + 3 * (k / (o + k + 2)) + (o + k === 0 ? 0.5 : 0); };
  function weighted(list, w) {
    let r = Math.random() * w.reduce((a, b) => a + b, 0);
    for (let i = 0; i < list.length; i++) { r -= w[i]; if (r <= 0) return list[i]; }
    return list[list.length - 1];
  }

  // ---- Série de questions à choix ----
  // Les formes polies en ます sont simples et connues : elles ne font que 10 % du tirage. Le reste se partage entre le
  // négatif et la forme en て. stat(fam, cls) -> { o, k } (réussites / erreurs cumulées)
  const POL_SHARE = 0.1;
  function session(n = 8, stat = () => ({ o: 0, k: 0 }), skipVerbs = []) {
    const skills = new Map(); // "fam|cls" -> verbes concernés
    for (const v of VERBS) {
      for (const cls of Object.keys(CLS_FORMS)) {
        const fm = fam(v, CLS_FORMS[cls][0]);
        const key = fm + '|' + cls;
        if (!skills.has(key)) skills.set(key, { fam: fm, cls, verbs: [] });
        skills.get(key).verbs.push(v);
      }
    }
    const used = new Set(skipVerbs);
    const qs = [];
    let guard = 0;
    while (qs.length < n && guard++ < 300) {
      const r0 = Math.random();
      const cls = r0 < POL_SHARE ? 'pol' : r0 < POL_SHARE + (1 - POL_SHARE) / 2 ? 'neg' : 'te';
      const list = [...skills.values()].filter((s) => s.cls === cls);
      const sk = weighted(list, list.map((s) => weight(stat, s.fam, s.cls)));
      const f = pick(CLS_FORMS[cls]);
      const v = pick(sk.verbs);
      if (used.has(v.k)) continue; // pas deux fois le même verbe dans une série
      used.add(v.k);
      qs.push(question(v, f));
    }
    return qs;
  }

  // ---- Phrases courtes à compléter ----
  // Des phrases de la vie de tous les jours, écrites à la main (pas de modèle à trous), avec des structures et une
  // place des mots qui varient. Chaque phrase contient un indice qui impose UNE forme : ください → forme en て ;
  // ぜんぜん / あまり / なにも → négatif ; un mot de passé (きのう, おととい, せんしゅう…) + un mot négatif → passé négatif.
  // Pas de formes polies ici : sans repère de politesse, une forme polie serait aussi juste, et la réponse ne serait
  // plus unique. Les mauvaises réponses sont des formes fausses dans cette phrase.
  // [forme, avant le trou, verbe, après le trou, traduction française complète]
  const SENTENCES = [
    // ---- forme en て : demandes de tous les jours ----
    ['te', 'すみません、 ゆっくり ', 'はなす', ' ください。', "Excusez-moi, parlez lentement, s'il vous plaît."],
    ['te', 'もう いちど ', 'いう', ' ください。', "Dites-le encore une fois, s'il vous plaît."],
    ['te', 'ここに なまえを ', 'かく', ' ください。', "Écrivez votre nom ici, s'il vous plaît."],
    ['te', 'あとで でんわを ', 'する', ' ください。', "Appelez-moi plus tard, s'il vous plaît."],
    ['te', 'あした はやく ', 'くる', ' ください。', "Venez tôt demain, s'il vous plaît."],
    ['te', 'さむいから、 まどを ', 'しめる', ' ください。', "Il fait froid, fermez la fenêtre, s'il vous plaît."],
    ['te', 'べんきょうするから、 テレビを ', 'けす', ' ください。', "Je vais étudier, éteignez la télé, s'il vous plaît."],
    ['te', 'ここで すこし ', 'まつ', ' ください。', "Attendez un peu ici, s'il vous plaît."],
    ['te', 'ここで しゃしんを ', 'とる', ' ください。', "Prenez-nous en photo ici, s'il vous plaît."],
    ['te', 'どうぞ、 へやに ', 'はいる', ' ください。', 'Entrez dans la pièce, je vous en prie.'],
    ['te', 'この ほんを ', 'よむ', ' ください。', "Lisez ce livre, s'il vous plaît."],
    ['te', 'どうぞ、 ここで ', 'やすむ', ' ください。', 'Reposez-vous ici, je vous en prie.'],
    ['te', 'くらいから、 でんきを ', 'つける', ' ください。', "Il fait sombre, allumez la lumière, s'il vous plaît."],
    ['te', 'ここで くつを ', 'ぬぐ', ' ください。', "Enlevez vos chaussures ici, s'il vous plaît."],
    ['te', 'しゅくだいを ', 'だす', ' ください。', "Rendez vos devoirs, s'il vous plaît."],
    ['te', 'わたしの かばんを ', 'もつ', ' ください。', "Tenez mon sac, s'il vous plaît."],
    ['te', 'えいごで ', 'こたえる', ' ください。', "Répondez en anglais, s'il vous plaît."],
    ['te', 'もっと ゆっくり ', 'あるく', ' ください。', "Marchez plus lentement, s'il vous plaît."],
    // ---- négatif (habitudes) ----
    ['neg', 'わたしは さかなを ぜんぜん ', 'たべる', '。', 'Je ne mange pas du tout de poisson.'],
    ['neg', 'コーヒーは あまり ', 'のむ', '。', 'Je ne bois pas beaucoup de café.'],
    ['neg', 'うちでは テレビを あまり ', 'みる', '。', 'À la maison, je ne regarde pas beaucoup la télé.'],
    ['neg', 'しゅうまつは あまり いえを ', 'でる', '。', 'Le week-end, je ne sors pas beaucoup de chez moi.'],
    ['neg', 'ともだちは ここへ ぜんぜん ', 'くる', '。', 'Mes amis ne viennent jamais ici.'],
    ['neg', 'まだ えいごが あまり ', 'わかる', '。', "Je ne comprends pas encore beaucoup l'anglais."],
    ['neg', 'いまは おかねが ぜんぜん ', 'ある', '。', "En ce moment, je n'ai pas du tout d'argent."],
    ['neg', 'わたしは スポーツを ぜんぜん ', 'する', '。', 'Je ne fais pas du tout de sport.'],
    ['neg', 'あさは あまり はやく ', 'おきる', '。', 'Le matin, je ne me lève pas très tôt.'],
    ['neg', 'ざっしは あまり ', 'よむ', '。', 'Je ne lis pas beaucoup de magazines.'],
    ['neg', 'わたしは うみで ぜんぜん ', 'およぐ', '。', 'Je ne nage pas du tout dans la mer.'],
    ['neg', 'あまり おんがくを ', 'きく', '。', "Je n'écoute pas beaucoup de musique."],
    ['neg', 'バスには あまり ', 'のる', '。', 'Je ne prends pas souvent le bus.'],
    ['neg', 'あさは なにも ', 'たべる', '。', 'Le matin, je ne mange rien.'],
    ['neg', 'いそがしくて、 ぜんぜん ', 'べんきょうする', '。', "Je suis occupé, je n'étudie pas du tout."],
    // ---- passé négatif (ce qui ne s'est pas passé) ----
    ['negpast', 'きのうの よるは ぜんぜん ', 'ねる', '。', "Hier soir, je n'ai pas du tout dormi."],
    ['negpast', 'きのうは だれも ', 'くる', '。', "Hier, personne n'est venu."],
    ['negpast', 'せんしゅうは あまり ', 'べんきょうする', '。', "La semaine dernière, je n'ai pas beaucoup étudié."],
    ['negpast', 'きのうは あさから なにも ', 'たべる', '。', "Hier, je n'ai rien mangé depuis le matin."],
    ['negpast', 'せんげつは りょこうに ぜんぜん ', 'いく', '。', "Le mois dernier, je ne suis pas du tout parti en voyage."],
    ['negpast', 'きのうは ともだちに ぜんぜん ', 'あう', '。', "Hier, je n'ai pas du tout vu mes amis."],
    ['negpast', 'きのうは えいごが ぜんぜん ', 'わかる', '。', "Hier, je n'ai rien compris à l'anglais."],
    ['negpast', 'きのうは なにも ', 'のむ', '。', "Hier, je n'ai rien bu."],
    ['negpast', 'きのうは しごとが ぜんぜん ', 'おわる', '。', "Hier, je n'ai pas du tout fini mon travail."],
    ['negpast', 'おととい、 しゃしんを ぜんぜん ', 'とる', '。', "Avant-hier, je n'ai pas pris de photo du tout."],
    ['negpast', 'せんしゅうは ぜんぜん ', 'およぐ', '。', "La semaine dernière, je n'ai pas du tout nagé."],
    ['negpast', 'きのうは だれにも でんわを ', 'する', '。', "Hier, je n'ai téléphoné à personne."],
    ['negpast', 'きのうは おかねが ぜんぜん ', 'ある', '。', "Hier, je n'avais pas du tout d'argent."],
    ['negpast', 'おととい、 なにも ', 'かう', '。', "Avant-hier, je n'ai rien acheté."],
    ['negpast', 'せんしゅうは しゅくだいを ぜんぜん ', 'する', '。', "La semaine dernière, je n'ai pas du tout fait mes devoirs."],
    ['negpast', 'おとといは ざっしを あまり ', 'よむ', '。', "Avant-hier, je n'ai pas beaucoup lu de magazines."],
  ].map(([f, before, k, after, fr]) => ({ f, before, v: VERBS.find((x) => x.k === k), after, fr }));

  // Mots-indices, pour la phrase d'explication affichée après une erreur
  const NEG_CUES = ['ぜんぜん', 'あまり', 'なにも', 'だれも', 'だれにも'];
  const TIME_CUES = ['きのうの よる', 'きのう', 'おととい', 'せんしゅう', 'せんげつ'];
  const cueIn = (text, list) => list.find((c) => text.includes(c)) || '';
  function why(s) {
    const text = s.before + s.after;
    if (s.f === 'te') return 'ください demande la forme en て.';
    const neg = cueIn(text, NEG_CUES);
    if (s.f === 'neg') return `${neg} demande un négatif.`;
    return `${cueIn(text, TIME_CUES)} = passé, ${neg} = négatif : on veut le passé négatif.`;
  }

  function sentenceChoices(v, f) {
    const right = conj(v, f);
    const forms = (g) => (g === 'dict' ? v.k : conj(v, g));
    let picks;
    if (f === 'negpast') picks = ['neg', ...shuffle(['dict', 'te', 'pm', 'pp']).slice(0, 3)]; // « ない » : mauvais temps pour きのう
    else if (f === 'neg') picks = shuffle(['dict', 'te', 'pm', 'pp']);
    else picks = shuffle(['neg', 'negpast', 'dict', 'pm', 'pp']);
    const bad = [];
    for (const g of picks) { const t = forms(g); if (t !== right && !bad.includes(t)) bad.push(t); if (bad.length >= 4) break; }
    return shuffle([{ t: right, right: true }, ...bad.map((t) => ({ t, right: false }))]);
  }

  function sentence(s) {
    const v = s.v;
    return {
      kind: 'sent', v, f: s.f, cls: FORMS[s.f].cls, fam: fam(v, s.f), ans: conj(v, s.f), choices: sentenceChoices(v, s.f),
      before: s.before, after: s.after, fr: s.fr,
      rule: `${why(s)} ${withHead(v, s.f)}`,
    };
  }

  function sentences(n, stat = () => ({ o: 0, k: 0 }), skipVerbs = []) {
    const used = new Set(skipVerbs);
    const out = [];
    let guard = 0;
    while (out.length < n && guard++ < 300) {
      const pool = SENTENCES.filter((s) => !used.has(s.v.k));
      if (!pool.length) break;
      const c = weighted(pool, pool.map((x) => weight(stat, fam(x.v, x.f), FORMS[x.f].cls)));
      used.add(c.v.k);
      out.push(sentence(c));
    }
    return out;
  }

  const groupLabel = (v) => (v.g === '1' ? '1er groupe' : v.g === '2' ? '2e groupe' : '3e groupe');

  // Série complète : 8 questions à choix et 7 phrases à compléter, en alternance (15 questions), sans verbe répété
  function mixedSession(stat) {
    const qcm = session(8, stat);
    const sent = sentences(7, stat, qcm.map((q) => q.v.k));
    const out = [];
    qcm.forEach((q, i) => { out.push(q); if (sent[i]) out.push(sent[i]); });
    return out;
  }

  FJ.conj = { VERBS, FORMS, CLS_FORMS, VISIBLE, SENTENCES, groupLabel, conj, rule, ruleBody, question, sentence, choices, session, sentences, mixedSession, famLabel, CLS_LABEL, fam };
})();
