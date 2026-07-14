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
