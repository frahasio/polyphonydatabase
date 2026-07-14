/**
 * Matcher: fill missing composer biographical data for review.
 *
 * Identity + life dates come from RISM (rism.online, the musicological
 * authority file for early-music sources — far more reliable for this
 * repertoire than fuzzy Wikidata name search, and namesakes from other
 * centuries mostly don't exist there). Birth/death PLACES are patchy in
 * RISM, so when the RISM record cross-references a Wikidata item we fetch
 * places from that exact Q-id — no name guessing involved.
 *
 * Writes 'composer_bio' suggestions for human review; accepting applies the
 * values (cited sources win over ours where they differ; the card shows
 * every replacement) and records composers.rism_id / wikidata_id.
 * Suggestions that would change nothing are not created.
 *
 * Usage: node scripts/suggest-composer-bios.js [batchSize] [--dry-run]
 * Polite ~2 req/s. Checkpoint: composers.wikidata_checked_at (kept from v1;
 * it now means "bio matcher checked"). --dry-run ignores the checkpoint and
 * writes nothing.
 */
import { pool } from '../src/db.js';

const args = process.argv.slice(2).filter((a) => a !== '--dry-run');
const DRY_RUN = process.argv.includes('--dry-run');
const BATCH = Math.min(Math.max(parseInt(args[0], 10) || 25, 1), 500);
const MIN_SCORE = Number(process.env.COMPOSER_BIO_MIN_SCORE) || 0.5;
// Renaissance-polyphony catalogue: anyone born after this year is a
// namesake from the wrong era.
const MAX_BIRTH_YEAR = parseInt(process.env.COMPOSER_BIO_MAX_BIRTH_YEAR, 10) || 1750;

const HEADERS = {
  Accept: 'application/json',
  'User-Agent': 'PolyphonyDatabase-Matcher/2 (polyphonydatabase@gmail.com)',
};
const WD_API = 'https://www.wikidata.org/w/api.php';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url) {
  const resp = await fetch(url, { headers: HEADERS });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  await sleep(500);
  return resp.json();
}

function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---- RISM ----

// RISM labels look like "Palestrina, Giovanni Pierluigi da (1525-1594)".
function splitRismLabel(label) {
  const m = String(label || '').match(/^(.*?)(?:\s*\(([^)]*)\))?\s*$/);
  return { name: (m && m[1] || '').trim(), dates: (m && m[2] || '').trim() };
}

// Parse one side of a RISM date string: "1525", "1525c", "1475p",
// "02.02.1594". Any letter/marker beside the year means approximate.
// Returns { year, approx } or null.
function parseDateSide(s) {
  const str = String(s || '').trim();
  const m = str.match(/(\d{4})/);
  if (!m) return null;
  const year = parseInt(m[1], 10);
  if (year < 1000 || year > 2100) return null;
  const approx = /[a-z?+~*]/i.test(str.replace(m[1], ''));
  return { year, approx };
}

/**
 * Parse a RISM date string into one of:
 *   { kind: 'life', born, died }   — genuine birth/death years
 *   { kind: 'fl', start, end }     — flourished/activity period
 *   null                           — unusable (century-only etc.)
 *
 * RISM conventions this understands:
 *   "1525-1594", "1510c-17.11.1573"  -> life dates
 *   "fl. 1547-1550"                  -> flourished period
 *   "1573+"                          -> documented in/after 1573 -> fl. 1573
 *   "16.sc", "1500-1599", 45+-year fl spans -> null: century placeholders,
 *      worthless as dates (per review feedback: "might as well have nothing")
 */
function parseRismDates(datesStr) {
  const str = String(datesStr || '').trim();
  if (!str || /\d\d?\s*\.?\s*sc/i.test(str)) return null; // "16.sc" century-only

  const isFl = /^fl/i.test(str);
  const body = str.replace(/^fl\.?\s*/i, '');

  // Single-sided "1573+": documented in/after that year -> flourished.
  if (!/[-\u2013]/.test(body)) {
    if (/\+\s*$/.test(body) || isFl) {
      const d = parseDateSide(body);
      return d ? { kind: 'fl', start: d, end: null } : null;
    }
    return null; // bare single year: too ambiguous
  }

  const parts = body.split(/[-\u2013]/);
  const a = parseDateSide(parts[0]);
  const b = parseDateSide(parts[1]);
  if (!a && !b) return null;

  if (isFl) {
    // Century-derived fl spans ("fl. 1500-1599", "fl. 1500-1549") carry no
    // real information; genuine activity periods are short.
    if (a && b && b.year - a.year >= 40) return null;
    return { kind: 'fl', start: a || b, end: a ? b : null };
  }
  // A "lifespan" of 90+ years is a century placeholder, not a person.
  if (a && b && b.year - a.year >= 90) return null;
  return { kind: 'life', born: a, died: b };
}

function bioValue(record, englishLabel) {
  const rows = (record.biographicalDetails && record.biographicalDetails.summary) || [];
  const row = rows.find((r) => r.label && r.label.en && r.label.en[0] === englishLabel);
  return row && row.value && row.value.none ? row.value.none[0] : null;
}

async function searchRism(name) {
  const url = 'https://rism.online/search?' + new URLSearchParams({ q: name, mode: 'people' });
  const data = await fetchJson(url);
  return data.items || [];
}

// ---- Wikidata (by exact Q-id from the RISM cross-reference) ----

function claimItemIds(entity, prop) {
  return ((entity.claims || {})[prop] || [])
    .map((c) => c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value && c.mainsnak.datavalue.value.id)
    .filter(Boolean);
}

function claimYear(entity, prop) {
  const c = ((entity.claims || {})[prop] || [])[0];
  const v = c && c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value;
  const m = v && v.time && v.time.match(/^([+-]\d+)-/);
  return m ? parseInt(m[1], 10) : null;
}

async function wdEntities(ids, props) {
  const url = WD_API + '?' + new URLSearchParams({
    format: 'json', action: 'wbgetentities', ids: [...new Set(ids)].join('|'), props, languages: 'en',
  });
  const data = await fetchJson(url);
  return data.entities || {};
}

// Fetch birth/death places (city + country) for one Wikidata item; the
// item's own dates are cross-checked against RISM's so a bad link on the
// RISM side can't smuggle in the wrong person's places. `dates` is the
// parseRismDates() result: life dates must agree within 5 years; a
// flourished period must fall inside the Wikidata lifetime.
async function wikidataPlaces(qid, dates) {
  const entities = await wdEntities([qid], 'claims');
  const entity = entities[qid];
  if (!entity) return null;
  const wdBorn = claimYear(entity, 'P569');
  const wdDied = claimYear(entity, 'P570');
  if (dates.kind === 'life') {
    if (dates.born && wdBorn && Math.abs(wdBorn - dates.born.year) > 5) return null;
    if (dates.died && wdDied && Math.abs(wdDied - dates.died.year) > 5) return null;
  } else if (dates.kind === 'fl' && dates.start) {
    if (wdBorn && wdBorn > dates.start.year + 5) return null;
    if (wdDied && wdDied < dates.start.year - 5) return null;
  }

  const birthPlaceId = claimItemIds(entity, 'P19')[0] || null;
  const deathPlaceId = claimItemIds(entity, 'P20')[0] || null;
  const placeIds = [birthPlaceId, deathPlaceId].filter(Boolean);
  if (!placeIds.length) return { birth: null, death: null };

  const places = await wdEntities(placeIds, 'labels|claims');
  const info = {};
  const countryIds = new Set();
  for (const [id, ent] of Object.entries(places)) {
    const country = claimItemIds(ent, 'P17')[0] || null;
    info[id] = { name: (ent.labels && ent.labels.en && ent.labels.en.value) || null, countryId: country };
    if (country) countryIds.add(country);
  }
  if (countryIds.size) {
    const countries = await wdEntities([...countryIds], 'labels');
    for (const p of Object.values(info)) {
      const c = p.countryId && countries[p.countryId];
      p.country = (c && c.labels && c.labels.en && c.labels.en.value) || null;
    }
  }
  return {
    birth: birthPlaceId ? info[birthPlaceId] : null,
    death: deathPlaceId ? info[deathPlaceId] : null,
  };
}

async function main() {
  const composers = await pool.query(`
    SELECT id, name, from_year, to_year, from_year_annotation, to_year_annotation,
           birthplace_1, birthplace_2, deathplace_1, deathplace_2
    FROM composers c
    WHERE ${DRY_RUN ? 'TRUE' : 'c.wikidata_checked_at IS NULL'}
      AND c.id != 23
      AND (c.from_year IS NULL OR c.to_year IS NULL
           OR c.birthplace_2 IS NULL OR c.birthplace_2 = '')
    ORDER BY c.id
    LIMIT $1
  `, [BATCH]);

  console.log(`Checking ${composers.rows.length} composers against RISM...${DRY_RUN ? ' [dry run]' : ''}`);
  let inserted = 0;

  for (const comp of composers.rows) {
    if (!DRY_RUN) {
      await pool.query('UPDATE composers SET wikidata_checked_at = NOW() WHERE id = $1', [comp.id]);
    }

    let hits;
    try {
      hits = await searchRism(comp.name);
      if (!hits.length) {
        // Spelling variants ("Gerardus"/"Gheerkin") defeat full-name search;
        // retry with the surname alone — the scorer filters the noise.
        hits = await searchRism(String(comp.name).split(',')[0].trim());
      }
    } catch (err) {
      console.warn(`  ${comp.id} "${comp.name}" rism search: ${err.message}`);
      continue;
    }
    if (!hits.length) continue;

    // Score candidates. Both sides use "Surname, Forenames"; surname must
    // match exactly, then a full-name match, the Composer role, and RISM
    // source count add confidence.
    const storedSurname = normalize(String(comp.name).split(',')[0]);
    const storedTokens = new Set(normalize(comp.name).split(' ').filter((w) => w.length >= 2));
    let best = null;
    for (const hit of hits.slice(0, 8)) {
      // Only native RISM person records: federated ones (external/diamm/...)
      // 500 on JSON fetch and carry no biographical data.
      if (!/rism\.online\/people\//.test(hit.id || '')) continue;
      const { name: hitName, dates } = splitRismLabel(hit.label && hit.label.none && hit.label.none[0]);
      if (!hitName) continue;
      const hitSurname = normalize(hitName.split(',')[0]);
      if (!hitSurname || hitSurname !== storedSurname) continue;

      // Label dates are optional here — many RISM records only carry dates
      // in the full record, fetched below. When present they act as guards.
      const labelDates = parseRismDates(dates);
      if (labelDates && labelDates.kind === 'life') {
        const { born, died } = labelDates;
        if (born && born.year > MAX_BIRTH_YEAR) continue;
        if (died && died.year > MAX_BIRTH_YEAR + 90) continue;
        if (comp.from_year && born && Math.abs(born.year - comp.from_year) > 5) continue;
        if (comp.to_year && died && Math.abs(died.year - comp.to_year) > 5) continue;
      }

      const hitTokens = new Set(normalize(hitName).split(' ').filter((w) => w.length >= 2));
      const fullNameMatch = [...storedTokens].every((t) => hitTokens.has(t));
      const roles = (hit.summary && hit.summary.roles && hit.summary.roles.value && hit.summary.roles.value.none) || [];
      const isComposer = roles.includes('Composer');
      const numSources = (hit.flags && hit.flags.numberOfSources) || 0;
      const agreesWithKnown = Boolean(labelDates && labelDates.kind === 'life' &&
        ((comp.from_year && labelDates.born) || (comp.to_year && labelDates.died)));
      const score = Math.round((0.3
        + (fullNameMatch ? 0.25 : 0)
        + (isComposer ? 0.2 : 0)
        + (numSources >= 3 ? 0.1 : 0)
        + (agreesWithKnown ? 0.15 : 0)) * 100) / 100;
      if (!best || score > best.score || (score === best.score && numSources > best.numSources)) {
        best = { id: hit.id, label: hitName, datesStr: dates, labelDates, roles, numSources, score };
      }
    }
    if (!best || best.score < MIN_SCORE) continue;

    // Full RISM record: more precise "other life dates" + Wikidata x-ref.
    let record = null;
    try {
      record = await fetchJson(best.id);
    } catch (err) {
      console.warn(`  ${comp.id} rism record: ${err.message}`);
    }
    const recStr = record
      ? (bioValue(record, 'Other life dates') || bioValue(record, 'Life dates'))
      : null;
    const recDates = parseRismDates(recStr);
    // Prefer genuine life dates over a flourished period; prefer the full
    // record's string over the label's within the same kind.
    const parsedCandidates = [recDates, best.labelDates].filter(Boolean);
    const dates = parsedCandidates.find((d) => d.kind === 'life') || parsedCandidates[0] || null;
    if (!dates) continue; // century-only or undated -> nothing trustworthy

    if (dates.kind === 'life') {
      if (!dates.born && !dates.died) continue;
      if (dates.born && dates.born.year > MAX_BIRTH_YEAR) continue;
      if (dates.died && dates.died.year > MAX_BIRTH_YEAR + 90) continue;
      if (comp.from_year && dates.born && Math.abs(dates.born.year - comp.from_year) > 5) continue;
      if (comp.to_year && dates.died && Math.abs(dates.died.year - comp.to_year) > 5) continue;
    } else {
      // Flourished period: must sit plausibly inside any known lifetime,
      // and within the catalogue's era.
      if (!dates.start) continue;
      if (dates.start.year > MAX_BIRTH_YEAR + 40) continue;
      if (comp.from_year && dates.start.year < comp.from_year - 5) continue;
      if (comp.to_year && dates.start.year > comp.to_year + 5) continue;
    }

    let qid = null;
    const authorities = (record && record.externalAuthorities && record.externalAuthorities.items) || [];
    const wd = authorities.find((a) => String(a.base || '').includes('wikidata.org'));
    if (wd) qid = wd.value;

    let places = null;
    if (qid) {
      try {
        places = await wikidataPlaces(qid, dates);
      } catch (err) {
        console.warn(`  ${comp.id} wikidata places: ${err.message}`);
      }
    }

    // Year fields: life dates go in as-is; a flourished period is only
    // offered when the composer has NO years at all, using the house
    // "fl." / "fl.c." annotation convention (so it displays as fl.1547-1550
    // and can never masquerade as birth/death).
    let years = { from_year: null, from_year_annotation: null, to_year: null, to_year_annotation: null };
    if (dates.kind === 'life') {
      years = {
        from_year: dates.born ? dates.born.year : null,
        from_year_annotation: dates.born && dates.born.approx ? 'c.' : null,
        to_year: dates.died ? dates.died.year : null,
        to_year_annotation: dates.died && dates.died.approx ? 'c.' : null,
      };
    } else if (!comp.from_year && !comp.to_year) {
      years = {
        from_year: dates.start.year,
        from_year_annotation: dates.start.approx ? 'fl.c.' : 'fl.',
        to_year: dates.end ? dates.end.year : null,
        to_year_annotation: dates.end && dates.end.approx ? 'c.' : null,
      };
    }

    const rismId = String(best.id).replace('https://rism.online/', ''); // "people/1904"
    const payload = {
      rism_id: rismId,
      rism_label: best.label,
      rism_dates: recStr || best.datesStr || null,
      rism_sources: best.numSources,
      rism_roles: best.roles.slice(0, 5),
      wikidata_id: qid,
      ...years,
      birthplace_1: places && places.birth ? places.birth.name : null,
      birthplace_2: places && places.birth ? places.birth.country : null,
      deathplace_1: places && places.death ? places.death.name : null,
      deathplace_2: places && places.death ? places.death.country : null,
    };

    // Pointless to review a suggestion that changes nothing.
    const wouldChange =
      (payload.from_year !== null && payload.from_year !== comp.from_year) ||
      (payload.to_year !== null && payload.to_year !== comp.to_year) ||
      (payload.birthplace_1 && payload.birthplace_1 !== comp.birthplace_1) ||
      (payload.birthplace_2 && payload.birthplace_2 !== comp.birthplace_2) ||
      (payload.deathplace_1 && payload.deathplace_1 !== comp.deathplace_1) ||
      (payload.deathplace_2 && payload.deathplace_2 !== comp.deathplace_2);
    if (!wouldChange) continue;

    const yearsLog = `${payload.from_year_annotation || ''}${payload.from_year || '?'}-${payload.to_year_annotation || ''}${payload.to_year || '?'}`;
    const placesLog = `${payload.birthplace_1 || '?'}, ${payload.birthplace_2 || '?'} / ${payload.deathplace_1 || '?'}, ${payload.deathplace_2 || '?'}`;
    if (DRY_RUN) {
      inserted++;
      console.log(`  ${comp.id} "${comp.name}" -> ${rismId} ${best.label} (${yearsLog}; ${placesLog}; ${best.numSources} srcs) ${Math.round(best.score * 100)}%`);
      continue;
    }
    const result = await pool.query(
      `INSERT INTO suggestions (kind, composer_id, payload, score, source, dedupe_key)
       VALUES ('composer_bio', $1, $2, $3, 'rism.online', $4)
       ON CONFLICT (dedupe_key) DO NOTHING`,
      [comp.id, JSON.stringify(payload), best.score, `cb:${comp.id}`]
    );
    if (result.rowCount) {
      inserted++;
      console.log(`  ${comp.id} "${comp.name}" -> ${rismId} ${best.label} (${yearsLog}) ${Math.round(best.score * 100)}%`);
    }
  }

  console.log(`Done. ${DRY_RUN ? 'Would insert' : 'Inserted'} ${inserted} composer bio suggestions.`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
