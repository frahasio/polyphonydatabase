/**
 * Latin -> English feast-name dictionary, used when a Divinum Officium day
 * can't be mapped to an existing catalogue function and a NEW function has
 * to be proposed. Translating "Sancti Bartholomaei Apostoli" to
 * "St Bartholomew" up front saves the reviewer respelling every proposal
 * into house style — and when the translation matches a function that
 * already exists, the matcher links it directly instead of proposing a
 * duplicate.
 *
 * EDIT FREELY: add saints to SAINT_NAMES (keys are normalized Latin
 * genitives — lowercase, no accents/ligatures) as new ones crop up in the
 * queue.
 */

// Latin genitive (as it appears in normalized DO day titles) -> English.
export const SAINT_NAMES = new Map(Object.entries({
  'agathae': 'Agatha', 'agnetis': 'Agnes', 'albani': 'Alban',
  'alexii': 'Alexis', 'aloisii': 'Aloysius', 'alphonsi': 'Alphonsus',
  'ambrosii': 'Ambrose', 'andreae': 'Andrew', 'angelorum': 'the Angels',
  'annae': 'Anne', 'anselmi': 'Anselm', 'antonii': 'Anthony',
  'antonini': 'Antoninus', 'apolloniae': 'Apollonia',
  'athanasii': 'Athanasius', 'augustini': 'Augustine',
  'barbarae': 'Barbara', 'barnabae': 'Barnabas',
  'bartholomaei': 'Bartholomew', 'basilii': 'Basil', 'bedae': 'Bede',
  'benedicti': 'Benedict', 'bernardi': 'Bernard',
  'bernardini': 'Bernardine', 'bibianae': 'Bibiana', 'blasii': 'Blaise',
  'bonaventurae': 'Bonaventure', 'bonifatii': 'Boniface',
  'brigittae': 'Bridget', 'brunonis': 'Bruno',
  'caeciliae': 'Cecilia', 'caietani': 'Cajetan', 'camilli': 'Camillus',
  'canuti': 'Canute', 'caroli': 'Charles', 'casimiri': 'Casimir',
  'catharinae': 'Catherine', 'christophori': 'Christopher',
  'clarae': 'Clare', 'clementis': 'Clement', 'cornelii': 'Cornelius',
  'cypriani': 'Cyprian', 'cyrilli': 'Cyril', 'damasi': 'Damasus',
  'davidis': 'David', 'dionysii': 'Denis', 'dominici': 'Dominic',
  'donati': 'Donatus', 'dorotheae': 'Dorothy', 'dunstani': 'Dunstan',
  'eduardi': 'Edward', 'elisabeth': 'Elizabeth',
  'emerentianae': 'Emerentiana', 'eusebii': 'Eusebius',
  'fabiani': 'Fabian', 'felicis': 'Felix', 'fidelis': 'Fidelis',
  'francisci': 'Francis', 'gabrielis': 'Gabriel', 'georgii': 'George',
  'gertrudis': 'Gertrude', 'gregorii': 'Gregory', 'henrici': 'Henry',
  'hieronymi': 'Jerome', 'hilarii': 'Hilary', 'hyacinthi': 'Hyacinth',
  'ignatii': 'Ignatius', 'irenaei': 'Irenaeus', 'isidori': 'Isidore',
  'iacobi': 'James', 'jacobi': 'James', 'ioannae': 'Joan',
  'joannae': 'Joan', 'ioannis': 'John', 'joannis': 'John',
  'iosephi': 'Joseph', 'josephi': 'Joseph', 'judae': 'Jude',
  'iudae': 'Jude', 'julianae': 'Juliana', 'justini': 'Justin',
  'laurentii': 'Lawrence', 'leonis': 'Leo', 'lucae': 'Luke',
  'luciae': 'Lucy', 'ludovici': 'Louis', 'marcelli': 'Marcellus',
  'marci': 'Mark', 'margaritae': 'Margaret', 'mariae': 'Mary',
  'marthae': 'Martha', 'martinae': 'Martina', 'martini': 'Martin',
  'matthaei': 'Matthew', 'matthiae': 'Matthias', 'mauritii': 'Maurice',
  'michaelis': 'Michael', 'monicae': 'Monica', 'nicolai': 'Nicholas',
  'norberti': 'Norbert', 'pancratii': 'Pancras', 'patricii': 'Patrick',
  'pauli': 'Paul', 'paulini': 'Paulinus', 'petri': 'Peter',
  'philippi': 'Philip', 'pii': 'Pius', 'polycarpi': 'Polycarp',
  'praxedis': 'Praxedes', 'priscae': 'Prisca', 'raphaelis': 'Raphael',
  'raymundi': 'Raymond', 'remigii': 'Remigius', 'roberti': 'Robert',
  'rochi': 'Roch', 'romualdi': 'Romuald', 'rosae': 'Rose',
  'scholasticae': 'Scholastica', 'sebastiani': 'Sebastian',
  'silvestri': 'Sylvester', 'sylvestri': 'Sylvester', 'simonis': 'Simon',
  'stanislai': 'Stanislaus', 'stephani': 'Stephen', 'teresiae': 'Teresa',
  'theresiae': 'Teresa', 'thomae': 'Thomas', 'timothei': 'Timothy',
  'titi': 'Titus', 'urbani': 'Urban', 'ursulae': 'Ursula',
  'valentini': 'Valentine', 'venceslai': 'Wenceslaus',
  'vincentii': 'Vincent', 'viti': 'Vitus', 'wilfridi': 'Wilfrid',
  'zachariae': 'Zachary',
  // Epithets/surnames that follow a first name ("Thomae Aquinatis").
  'aquinatis': 'Aquinas', 'chrysostomi': 'Chrysostom',
  'chrysologi': 'Chrysologus', 'nazianzeni': 'Nazianzen',
  'damiani': 'Damian', 'gonzagae': 'Gonzaga', 'loyolae': 'Loyola',
  'xaverii': 'Xavier', 'nepomuceni': 'Nepomucene', 'kostka': 'Kostka',
  'ferrerii': 'Ferrer', 'cantalicii': 'of Cantalice',
  'assisiensis': 'of Assisi', 'paduani': 'of Padua',
  'senensis': 'of Siena', 'cantuariensis': 'of Canterbury',
  'magni': 'the Great', 'majoris': 'Major', 'minoris': 'Minor',
}));

// Rank/description genitives that follow saints' names — dropped in the
// English name ("Sancti Laurentii Martyris" -> "St Lawrence").
const RANK_WORDS = new Set([
  'apostoli', 'apostolorum', 'evangelistae', 'evangelistarum',
  'martyris', 'martyrum', 'confessoris', 'confessorum', 'pontificis',
  'pontificum', 'episcopi', 'episcoporum', 'virginis', 'virginum',
  'viduae', 'papae', 'abbatis', 'abbatum', 'presbyteri', 'diaconi',
  'levitae', 'archangeli', 'angeli', 'doctoris', 'ecclesiae', 'regis',
  'reginae', 'ducis', 'militis', 'monachi', 'eremitae', 'imperatoris',
  'sociorum', 'socii', 'eius', 'ejus',
]);

const SANCTUS_WORDS = new Set(['sancti', 'sanctae', 'sanctorum', 'sanctarum', 'beati', 'beatae', 'beatorum']);

/**
 * Translate a NORMALIZED Latin day label (output of normalizeFeast) into an
 * English feast name in house style ("St Philip & St James", "Vigil of
 * St Lawrence"). Returns null when the label isn't a recognisable saint's
 * feast — the caller falls back to title-casing the Latin.
 */
export function translateFeastLabel(norm) {
  let label = String(norm || '').trim();
  if (!label) return null;

  let prefix = '';
  const vigil = label.match(/^(?:in )?vigilia (.+)$/);
  const octave = label.match(/^(?:die \d+ )?(?:in|infra) octavam? (.+)$/);
  const translation = label.match(/^translatio (.+)$/);
  if (vigil) { prefix = 'Vigil of '; label = vigil[1]; }
  else if (octave) { prefix = 'Octave of '; label = octave[1]; }
  else if (translation) { prefix = 'Translation of '; label = translation[1]; }

  const words = label.split(' ').filter(Boolean);
  // Every word must be accounted for (sanctus-word, rank word, or a known
  // name) — an unknown word means we'd silently drop part of the feast's
  // identity, so bail out instead.
  const persons = [];
  let current = [];
  let sawSanctus = false;
  for (const w of words) {
    if (SANCTUS_WORDS.has(w)) { sawSanctus = true; continue; }
    if (w === 'et') {
      if (current.length) persons.push(current.join(' '));
      current = [];
      continue;
    }
    if (RANK_WORDS.has(w)) continue;
    const name = SAINT_NAMES.get(w);
    if (!name) return null;
    current.push(name);
  }
  if (current.length) persons.push(current.join(' '));
  if (!sawSanctus || !persons.length) return null;

  const name = persons.length > 1 ? `Ss ${persons.join(' & ')}` : `St ${persons[0]}`;
  return (prefix + name).trim();
}

// Vocative / nominative forms used in titles and the Litany of the Saints
// (SAINT_NAMES keys are genitives from day labels).
const INVOCATION_ALIASES = new Map(Object.entries({
  petre: 'Peter', paule: 'Paul', andrea: 'Andrew',
  stephane: 'Stephen', laurenti: 'Lawrence', vincenti: 'Vincent',
  gregori: 'Gregory', augustine: 'Augustine', antoni: 'Anthony',
  benedicte: 'Benedict', dominice: 'Dominic', francisce: 'Francis',
  ioannes: 'John', joannes: 'John', iohannes: 'John',
  ioseph: 'Joseph', joseph: 'Joseph',
  michael: 'Michael', gabriel: 'Gabriel', raphael: 'Raphael',
  agnes: 'Agnes', agatha: 'Agatha', anastasia: 'Anastasia',
  caecilia: 'Cecilia', cecilia: 'Cecilia',
  silvester: 'Sylvester', siluestre: 'Sylvester',
  magdalena: 'Mary Magdalene',
  marce: 'Mark',
}));

function saintStem(w) {
  return String(w || '').replace(/(ae|es|is|um|us|em|am|as|os|i|o|e|a)$/, '');
}

/**
 * A title that *is* a saint invocation ("Sancte Nicolae", "O beata
 * Caecilia") is almost certainly for that saint, even when the words
 * never appear as a Mass/Office proper. Returns { kind, english } or null.
 */
function foldNorm(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/j/g, 'i')
    .replace(/v/g, 'u');
}

function titleCaseWord(s) {
  return String(s || '').replace(/\b[a-z]/g, (c) => c.toUpperCase()).trim();
}

export function saintInvocationFromTitle(titleText) {
  const firstPart = String(titleText || '').split(/\s+[-\u2013\u2014]\s+/)[0];
  const n = foldNorm(firstPart);
  const m = n.match(/^(o )?(sanct[aeu]s?|beat[aeu]s?) (.+)$/);
  if (!m) return null;
  const isSanctus = /^sanct/.test(m[2]);
  // "Beata nobis gaudia" is a hymn incipit, not a saint. Beate/Beata
  // only counts with O + a known name, or a name we can resolve.
  let rest = m[3]
    .replace(/\b(ora|orate|pro nobis|intercede|miserere nobis|archangele|apostole)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!rest) return null;
  if (/maria magdalena/.test(rest)) return { kind: 'saint', english: 'Mary Magdalene' };
  if (/dei genetrix|uirgo uirginum/.test(rest) || /^(maria)\b/.test(rest)) return { kind: 'bvm' };
  if (/trinitas/.test(rest)) return { kind: 'trinity' };
  if (/\b(ioannes|joannes|iohannes) baptista\b/.test(rest)) {
    return { kind: 'saint', english: 'John the Baptist' };
  }
  const token = rest.split(' ')[0];
  if (!token || token.length < 4) return null;
  if (/^(trinitas|deus|spiritus|kyrie|christe|omnes|angeli|pater|mater|iesu|domine|immaculata)$/.test(token)) return null;
  if (INVOCATION_ALIASES.has(token)) return { kind: 'saint', english: INVOCATION_ALIASES.get(token) };
  if (SAINT_NAMES.has(token)) return { kind: 'saint', english: SAINT_NAMES.get(token) };
  const stem = saintStem(token);
  if (stem.length >= 4) {
    let best = null;
    for (const [gen, eng] of SAINT_NAMES) {
      const gstem = saintStem(gen);
      if (gstem === stem || (stem.length >= 5 && (token.startsWith(gstem) || gen.startsWith(stem)))) {
        if (!best || gen.length > best.gen.length) best = { gen, eng };
      }
    }
    if (best) return { kind: 'saint', english: best.eng };
  }
  if (!isSanctus) return null;
  return { kind: 'saint', english: titleCaseWord(token) };
}

/** Map a saint-invocation result onto a catalogue function name. */
export function resolveNamedSaint(invoked, functionNames) {
  if (!invoked) return null;
  const names = functionNames || [];
  const byLower = new Map(names.map((n) => [n.toLowerCase(), n]));
  const pick = (...cands) => {
    for (const c of cands) {
      const hit = byLower.get(String(c).toLowerCase());
      if (hit) return { function_name: hit, new_function: false };
    }
    return null;
  };
  if (invoked.kind === 'bvm') return pick('BVM') || { function_name: 'BVM', new_function: true };
  if (invoked.kind === 'trinity') {
    return pick('Trinity Sunday', 'Trinity', 'The Most Holy Trinity')
      || { function_name: 'Trinity Sunday', new_function: true };
  }
  const eng = invoked.english;
  if (eng === 'John the Baptist') {
    return pick('John the Baptist', 'St John the Baptist', 'Nativity of John the Baptist')
      || { function_name: 'John the Baptist', new_function: true };
  }
  if (eng === 'Mary Magdalene') {
    return pick('Mary Magdalene', 'St Mary Magdalene', 'St Mary Magdalen')
      || { function_name: 'St Mary Magdalene', new_function: true };
  }
  const exact = pick(`St ${eng}`, `St. ${eng}`, eng);
  if (exact) return exact;
  const needle = String(eng).toLowerCase();
  if (needle.length >= 5) {
    const hits = names.filter((n) => {
      const nl = n.toLowerCase();
      return nl === needle || nl === `st ${needle}` || nl.startsWith(`st ${needle} `);
    });
    if (hits.length === 1) return { function_name: hits[0], new_function: false };
  }
  return { function_name: `St ${eng}`, new_function: true };
}
