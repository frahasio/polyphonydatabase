/**
 * Shared text-matching helpers for the title->function matchers
 * (suggest-title-functions.js = Cantus Index, suggest-title-functions-do.js
 * = Divinum Officium). Extracted so both use identical normalization and
 * the same feast-name -> catalogue-function mapping.
 */

// Latin feast names (and stems) -> function names in this catalogue.
// Keys are in NORMALIZED form (lowercase, accents stripped, abbreviations
// expanded, roman numerals -> digits, no dots) so they match the output of
// normalizeFeast(). Matched by substring, longest-first.
export const FEAST_MAP = new Map(Object.entries({
  'dominica 1 adventus': 'Advent I',
  'dominica 2 adventus': 'Advent II',
  'dominica 3 adventus': 'Advent III',
  'dominica 4 adventus': 'Advent IV',
  // Ferias are named "Feria X infra Hebdomadam N ..." — same week, same
  // function as the Sunday.
  'hebdomadam 1 adventus': 'Advent I',
  'hebdomadam 2 adventus': 'Advent II',
  'hebdomadam 3 adventus': 'Advent III',
  'hebdomadam 4 adventus': 'Advent IV',
  'adventus': 'Advent',
  'hebdomadam 1 in quadragesima': 'Lent I',
  'hebdomadam 2 in quadragesima': 'Lent II',
  'hebdomadam 3 in quadragesima': 'Lent III',
  'hebdomadam 4 in quadragesima': 'Lent IV',
  'hebdomadam passionis': 'Lent V',
  'hebdomadam 2 post epiphaniam': 'Epiphany II (Ordinary Time 2)',
  'hebdomadam 3 post epiphaniam': 'Epiphany III (Ordinary Time 3)',
  // Pre-Lent and Lent Sundays (Divinum Officium day names). Function names
  // use the OLD calendar first, Ordinary Time in brackets (renamed by
  // migration 019).
  'septuagesima': 'Septuagesima (Ordinary Time 4)',
  'sexagesima': 'Sexagesima (Ordinary Time 5)',
  'quinquagesima': 'Quinquagesima (Ordinary Time 6)',
  'dominica 1 in quadragesima': 'Lent I',
  'dominica 2 in quadragesima': 'Lent II',
  'dominica 3 in quadragesima': 'Lent III',
  'dominica 4 in quadragesima': 'Lent IV',
  'quadragesima': 'Lent',
  'dominica de passione': 'Lent V',
  'dominica 1 passionis': 'Lent V',
  // Sundays after Epiphany / Pentecost -> the catalogue's Ordinary Time
  // functions (old-calendar name first). These MUST outrank the bare
  // 'pentecosten'/'epiphania' stems (longest-first sorting guarantees it).
  'dominica 2 post epiphaniam': 'Epiphany II (Ordinary Time 2)',
  'dominica 3 post epiphaniam': 'Epiphany III (Ordinary Time 3)',
  'dominica 1 post pentecosten': 'Post Pentecost I (Ordinary Time 7)',
  'dominica 2 post pentecosten': 'Sunday in the octave of Corpus Christi (Ordinary Time 8)',
  'dominica 3 post pentecosten': 'Post Pentecost III (Ordinary Time 9)',
  'dominica 4 post pentecosten': 'Post Pentecost IV (Ordinary Time 10)',
  'dominica 5 post pentecosten': 'Post Pentecost V (Ordinary Time 11)',
  'dominica 6 post pentecosten': 'Post Pentecost VI (Ordinary Time 12)',
  'dominica 7 post pentecosten': 'Post Pentecost VII (Ordinary Time 13)',
  'dominica 8 post pentecosten': 'Post Pentecost VIII (Ordinary Time 14)',
  'dominica 9 post pentecosten': 'Post Pentecost IX (Ordinary Time 16)',
  'dominica 10 post pentecosten': 'Post Pentecost X (Ordinary Time 15)',
  'dominica 11 post pentecosten': 'Post Pentecost XI (Ordinary Time 17)',
  'dominica 12 post pentecosten': 'Post Pentecost XII (Ordinary Time 18)',
  'dominica 13 post pentecosten': 'Post Pentecost XIII (Ordinary Time 19)',
  'dominica 14 post pentecosten': 'Post Pentecost XIV (Ordinary Time 20)',
  'dominica 15 post pentecosten': 'Post Pentecost XV (Ordinary Time 21)',
  'dominica 16 post pentecosten': 'Post Pentecost XVI (Ordinary Time 22)',
  'dominica 17 post pentecosten': 'Post Pentecost XVII (Ordinary Time 23)',
  'dominica 18 post pentecosten': 'Post Pentecost XVIII (Ordinary Time 24)',
  'dominica 19 post pentecosten': 'Post Pentecost XIX (Ordinary Time 25)',
  'dominica 20 post pentecosten': 'Post Pentecost XX (Ordinary Time 26)',
  'dominica 21 post pentecosten': 'Post Pentecost XXI (Ordinary Time 27)',
  'dominica 22 post pentecosten': 'Post Pentecost XXII (Ordinary Time 28)',
  'dominica 23 post pentecosten': 'Post Pentecost XXIII (Ordinary Time 33)',
  'pentecostes': 'Pentecost',
  'sacratissimi cordis': 'Sacred Heart',
  'christi regis': 'Christ the King',
  'vigilia nativitas domini': 'Christmas Vigil',
  'nativitas domini': 'Christmas',
  'in nativitate domini': 'Christmas',
  'circumcisio domini': 'Circumcision',
  'epiphania': 'Epiphany',
  'purificatio': 'Candlemas',
  'annuntiatio': 'Annunciation',
  'visitatio': 'Visitation',
  'assumptio': 'Assumption',
  'nativitas mariae': 'Nativity of BVM',
  'nativitas beatae mariae virginis': 'Nativity of BVM',
  'praesentatio': 'Presentation of BVM',
  'conceptio': 'Immaculate Conception',
  'beatae mariae virginis': 'BVM',
  'de sancta maria': 'BVM',
  'dominica in palmis': 'Palm Sunday',
  'feria 4 cinerum': 'Ash Wednesday',
  'feria 5 in cena domini': 'Maundy Thursday',
  'ad mandatum': 'Maundy Thursday',
  'feria 6 in parasceve': 'Good Friday',
  'sabbato sancto': 'Holy Saturday',
  'dominica resurrectionis': 'Easter',
  'sabbato in albis': 'Easter',
  'feria 2 paschae': 'Easter Monday',
  'dominica in albis': 'Low Sunday (Easter I)',
  'octava paschae': 'Low Sunday (Easter I)',
  'dominica 2 post pascha': 'Easter II',
  'dominica 3 post pascha': 'Easter III',
  'dominica 4 post pascha': 'Easter IV',
  'dominica 5 post pascha': 'Easter V',
  'ascensio domini': 'Ascension',
  'ascensio': 'Ascension',
  'dominica pentecostes': 'Pentecost',
  'pentecosten': 'Pentecost',
  'trinitate': 'Trinity',
  'trinitatis': 'Trinity',
  'corporis christi': 'Corpus Christi',
  'corpore christi': 'Corpus Christi',
  'exaltatio sancti crucis': 'Holy Cross',
  'exaltatio crucis': 'Holy Cross',
  'inventio crucis': 'Holy Cross',
  'sancti crucis': 'Holy Cross',
  'transfiguratio': 'Transfiguration',
  'omnium sanctorum': 'All Saints',
  'dedicatione ecclesiae': 'Dedication of Church',
  'dedicatio ecclesiae': 'Dedication of Church',
  'pro defunctis': 'Requiem',
  'defunctorum': 'Office for the dead',
  'johannis baptistae': 'John the Baptist',
  'iohannis baptistae': 'John the Baptist',
  'joannis baptistae': 'John the Baptist',
  'nativitas iohannis': 'John the Baptist',
  'petri et pauli': 'Ss Peter & Paul',
  'petri pauli': 'Ss Peter & Paul',
  'conversio sancti pauli': 'Conversion of St Paul',
  'conversione sancti pauli': 'Conversion of St Paul',
  'petri ad vincula': 'St Peter in chains',
  'joannis apostoli et evangelistae': 'St John',
  'johannis apostoli et evangelistae': 'St John',
  'in nativitatis domini': 'Christmas',
  'sancti michaelis': 'St Michael',
  'michaelis': 'St Michael',
  'sancti stephani': 'St Stephen',
  'stephani': 'St Stephen',
  'laurentii': 'St Lawrence',
  'andreae': 'St Andrew',
  'nicolai': 'St Nicholas',
  'martini': 'St Martin',
  'ceciliae': 'St Cecilia',
  'caeciliae': 'St Cecilia',
  'catharinae': 'St Catherine',
  'katharinae': 'St Catherine',
  'agathae': 'St Agatha',
  'agnetis': 'St Agnes',
  'luciae': 'St Lucy',
  'barbarae': 'St Barbara',
  'annae': 'St Anne',
  'mariae magdalenae': 'Mary Magdalene',
  'iosephi': 'St Joseph',
  'josephi': 'St Joseph',
  'benedicti': 'St Benedict',
  'bernardi': 'St Bernard',
  'francisci': 'St Francis',
  'dominici': 'St Dominic',
  'augustini': 'St Augustine',
  'ambrosii': 'St Ambrose',
  'gregorii': 'St Gregory',
  'sebastiani': 'St Sebastian',
  'innocentium': 'Holy Innocents',
  'nominis jesu': 'Holy Name of Jesus',
  'nominis iesu': 'Holy Name of Jesus',
  // Commons of saints ("Commune ..." after expansion). These MUST outrank
  // specific saints when the source labels the text as a common.
  'commune virginis': 'Comm. Virgins',
  'commune virginum': 'Comm. Virgins',
  'commune plurimorum virginum': 'Comm. Virgins',
  'commune martyris': 'Comm. Martyrs',
  'commune martyrum': 'Comm. Martyrs',
  'commune plurimorum martyrum': 'Comm. Martyrs',
  'commune unius martyris': 'Comm. Martyrs',
  'commune apostolorum': 'Comm. Apostles & Evangelists',
  'commune evangelistarum': 'Comm. Apostles & Evangelists',
  'commune confessoris pontificis': 'Comm. Pontiffs',
  'commune confessoris': 'Comm. Confessors',
  'commune confessorum': 'Comm. Confessors',
  'commune doctorum': 'Comm. Doctors',
  'commune abbatis': 'Comm. Abbots',
  'commune abbatum': 'Comm. Abbots',
  'commune sanctarum mulierum': 'Comm. Holy Women',
  'commune non virginum': 'Comm. Holy Women',
}));

// Substring matching must prefer the most specific (longest) key.
export const FEAST_MAP_SORTED = Array.from(FEAST_MAP.entries())
  .sort((a, b) => b[0].length - a[0].length);

// The æ/œ ligatures (ubiquitous in Divinum Officium: "sǽcula", "Cæciliæ")
// must expand to two letters BEFORE the non-alpha strip, or every ligature
// word breaks in half.
function expandLigatures(s) {
  return String(s || '')
    .replace(/\u00e6|\u01fd/g, 'ae').replace(/\u00c6|\u01fc/g, 'AE')
    .replace(/\u0153/g, 'oe').replace(/\u0152/g, 'OE');
}

export function normalizeIncipit(text) {
  return expandLigatures(String(text || ''))
    .toLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '') // strip accents
    .replace(/\[.*?\]/g, ' ')      // editorial brackets e.g. "[I]"
    .replace(/\{.*?\}/g, ' ')      // placeholder braces e.g. "{psalm}"
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Multipart motets are stored as "Prima pars - Secunda pars" (space-hyphen-
// space, sometimes en/em dashes). Each part is a searchable incipit.
export function splitIncipitParts(text) {
  return String(text || '')
    .split(/\s+[-\u2013\u2014]\s+/)
    .map(normalizeIncipit)
    .filter((p) => p && p.split(' ').length >= 2)
    .slice(0, 3);
}

// Fold the mediaeval spelling variants both our titles and the sources mix
// freely (i/j, u/v) so "Iustorum" matches "Justorum".
export function foldSpelling(s) {
  return String(s || '').replace(/j/g, 'i').replace(/v/g, 'u');
}

// Roman numerals I-XXIV -> digits, for feast names like "Dominica II Adventus".
const ROMAN = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10, xi: 11, xii: 12, xiii: 13, xiv: 14, xv: 15, xvi: 16, xvii: 17, xviii: 18, xix: 19, xx: 20, xxi: 21, xxii: 22, xxiii: 23, xxiv: 24 };

/**
 * Normalize a feast name: lowercase, strip accents, expand the common
 * abbreviations ("Dom.", "Nat.", "S."...), roman numerals -> digits.
 */
export function normalizeFeast(feast) {
  let f = expandLigatures(String(feast || ''))
    .toLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  const expansions = [
    [/\bdom\./g, 'dominica'],
    [/\bnat\./g, 'nativitas'],
    [/\bfer\./g, 'feria'],
    [/\bp\./g, 'post'],
    [/\bvig\./g, 'vigilia'],
    [/\boct\./g, 'octava'],
    // "Comm." in feast names is the COMMON of saints (Commune), not a
    // commemoration — critical for routing common texts to Comm.* functions.
    [/\bcomm?\./g, 'commune'],
    [/\bconf\./g, 'confessoris'],
    [/\bmart\./g, 'martyris'],
    [/\bapost\./g, 'apostolorum'],
    [/\bevang\./g, 'evangelistarum'],
    [/\bpont\./g, 'pontificis'],
    [/\bvirg\./g, 'virginis'],
    [/\babb\./g, 'abbatis'],
    [/\bconv\./g, 'conversio'],
    [/\bexalt\./g, 'exaltatio'],
    [/\binv\./g, 'inventio'],
    [/\bpurif\./g, 'purificatio'],
    [/\bassumpt\./g, 'assumptio'],
    [/\bpraesent\./g, 'praesentatio'],
    [/\bconcept\./g, 'conceptio'],
    [/\bannunt\./g, 'annuntiatio'],
    [/\bss\./g, 'sancti'],
    [/\bs\./g, 'sancti'],
    [/\bb\./g, 'beati'],
    [/\bbmv\b/g, 'beatae mariae virginis'],
    [/\bbvm\b/g, 'beatae mariae virginis'],
  ];
  for (const [re, to] of expansions) f = f.replace(re, to);
  f = f.replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();
  // Roman numerals -> digits (DO uses "Dominica II Adventus"; Cantus "2").
  f = f.split(' ').map((w) => (ROMAN[w] !== undefined ? String(ROMAN[w]) : w)).join(' ');
  return f;
}

export function mapFeast(feast) {
  const f = normalizeFeast(feast);
  if (!f) return null;
  for (const [stem, name] of FEAST_MAP_SORTED) {
    if (f.includes(stem)) return name;
  }
  return null;
}

// Display form for a feast we can't map to an existing function: the
// normalized (expanded-abbreviation) name, title-cased. The reviewer edits
// this into house style before accepting.
export function titleCase(s) {
  return String(s || '').replace(/\b[a-z]/g, (c) => c.toUpperCase()).trim();
}
