/**
 * Matcher: fill missing composer biographical data (birth/death years,
 * birth/death places) from Wikidata. Writes rows to the suggestions table
 * for human review — accepting fills ONLY the missing fields, never
 * overwriting existing data, and records the Wikidata id on the composer.
 *
 * Usage: node scripts/suggest-composer-bios.js [batchSize] [--dry-run]
 * Wikidata has no hard quota but asks for politeness: ~2 requests/sec and a
 * descriptive User-Agent. Intended for Heroku Scheduler (daily) or manual
 * runs. composers.wikidata_checked_at is the checkpoint so runs advance
 * (--dry-run writes nothing and ignores the checkpoint).
 */
import { pool } from '../src/db.js';

const args = process.argv.slice(2).filter((a) => a !== '--dry-run');
const DRY_RUN = process.argv.includes('--dry-run');
const BATCH = Math.min(Math.max(parseInt(args[0], 10) || 25, 1), 500);
const MIN_SCORE = Number(process.env.COMPOSER_BIO_MIN_SCORE) || 0.5;
// This is a renaissance-polyphony catalogue: a candidate born after this
// year (or dying ~a lifetime later) is a modern namesake — the first live
// run matched a Tudor "Taylor, John" to a jazz pianist born 1960.
const MAX_BIRTH_YEAR = parseInt(process.env.COMPOSER_BIO_MAX_BIRTH_YEAR, 10) || 1750;
const API = 'https://www.wikidata.org/w/api.php';
const HEADERS = { 'User-Agent': 'PolyphonyDatabase-Matcher/1 (polyphonydatabase@gmail.com)' };
const Q_COMPOSER = 'Q36834';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(params) {
  const url = API + '?' + new URLSearchParams({ format: 'json', ...params }).toString();
  const resp = await fetch(url, { headers: HEADERS });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  await sleep(400);
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

// Names are stored "Surname(s), Forenames" — Wikidata labels are
// "Forenames Surname(s)".
function displayName(stored) {
  const [surname, forenames] = String(stored || '').split(',').map((s) => s.trim());
  return forenames ? `${forenames} ${surname}` : surname;
}

// Wikidata time value → { year, approx }. Precision 9 = year, 8 = decade,
// 7 = century; anything below a year is flagged approximate ("c.").
function parseTime(snak) {
  const v = snak && snak.mainsnak && snak.mainsnak.datavalue && snak.mainsnak.datavalue.value;
  if (!v || !v.time) return null;
  const m = v.time.match(/^([+-]\d+)-/);
  if (!m) return null;
  const year = parseInt(m[1], 10);
  if (!year || year < 1000 || year > 2000) return null;
  return { year, approx: (v.precision || 9) < 9 };
}

function claimItemIds(entity, prop) {
  return ((entity.claims || {})[prop] || [])
    .map((c) => c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value && c.mainsnak.datavalue.value.id)
    .filter(Boolean);
}

async function main() {
  // Same criteria as the dashboard's composers_missing_data alert, plus the
  // checkpoint. Anonymous (23) excluded as always.
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

  console.log(`Checking ${composers.rows.length} composers against Wikidata...${DRY_RUN ? ' [dry run]' : ''}`);
  let inserted = 0;

  for (const comp of composers.rows) {
    if (!DRY_RUN) {
      await pool.query('UPDATE composers SET wikidata_checked_at = NOW() WHERE id = $1', [comp.id]);
    }

    const searchName = displayName(comp.name);
    let hits;
    try {
      const data = await api({ action: 'wbsearchentities', search: searchName, language: 'en', type: 'item', limit: '5' });
      hits = data.search || [];
    } catch (err) {
      console.warn(`  ${comp.id} "${searchName}" search: ${err.message}`);
      continue;
    }
    if (!hits.length) continue;

    let entities;
    try {
      const data = await api({
        action: 'wbgetentities',
        ids: hits.map((h) => h.id).join('|'),
        props: 'claims|labels|descriptions',
        languages: 'en',
      });
      entities = data.entities || {};
    } catch (err) {
      console.warn(`  ${comp.id} "${searchName}" entities: ${err.message}`);
      continue;
    }

    // Score each hit: surname must appear in the label; being a composer
    // (occupation or description) and a full name match add confidence.
    // A conflict with data we already hold means it's the wrong person.
    const surname = normalize(String(comp.name).split(',')[0]);
    const nameTokens = normalize(searchName).split(' ').filter((w) => w.length >= 2);
    let best = null;
    for (const hit of hits) {
      const entity = entities[hit.id];
      if (!entity) continue;
      const label = normalize((entity.labels && entity.labels.en && entity.labels.en.value) || hit.label || '');
      const description = ((entity.descriptions && entity.descriptions.en && entity.descriptions.en.value) || hit.description || '');
      if (!surname || !label.includes(surname)) continue;

      const born = parseTime(((entity.claims || {}).P569 || [])[0]);
      const died = parseTime(((entity.claims || {}).P570 || [])[0]);
      if (comp.from_year && born && Math.abs(born.year - comp.from_year) > 5) continue;
      if (comp.to_year && died && Math.abs(died.year - comp.to_year) > 5) continue;
      if (!born && !died) continue; // nothing useful to suggest
      if (born && born.year > MAX_BIRTH_YEAR) continue; // modern namesake
      if (died && died.year > MAX_BIRTH_YEAR + 90) continue;

      const isComposer = claimItemIds(entity, 'P106').includes(Q_COMPOSER)
        || /composer/i.test(description);
      const fullNameMatch = nameTokens.every((t) => label.includes(t));
      const agreesWithKnown = Boolean((comp.from_year && born) || (comp.to_year && died));
      const score = Math.round((0.35 + (isComposer ? 0.3 : 0) + (fullNameMatch ? 0.2 : 0) + (agreesWithKnown ? 0.15 : 0)) * 100) / 100;
      if (!best || score > best.score) {
        best = { id: hit.id, entity, description, born, died, score };
      }
    }
    if (!best || best.score < MIN_SCORE) continue;

    // Resolve birth/death place labels and their countries (P17) in one
    // batched entity fetch each.
    const birthPlaceId = claimItemIds(best.entity, 'P19')[0] || null;
    const deathPlaceId = claimItemIds(best.entity, 'P20')[0] || null;
    const places = {};
    const placeIds = [birthPlaceId, deathPlaceId].filter(Boolean);
    if (placeIds.length) {
      try {
        const data = await api({ action: 'wbgetentities', ids: [...new Set(placeIds)].join('|'), props: 'labels|claims', languages: 'en' });
        const countryIds = new Set();
        for (const [qid, ent] of Object.entries(data.entities || {})) {
          const country = claimItemIds(ent, 'P17')[0] || null;
          places[qid] = { name: (ent.labels && ent.labels.en && ent.labels.en.value) || null, countryId: country };
          if (country) countryIds.add(country);
        }
        if (countryIds.size) {
          const cdata = await api({ action: 'wbgetentities', ids: [...countryIds].join('|'), props: 'labels', languages: 'en' });
          for (const p of Object.values(places)) {
            const c = p.countryId && cdata.entities && cdata.entities[p.countryId];
            p.country = (c && c.labels && c.labels.en && c.labels.en.value) || null;
          }
        }
      } catch (err) {
        console.warn(`  ${comp.id} places: ${err.message}`);
      }
    }

    const label = (best.entity.labels && best.entity.labels.en && best.entity.labels.en.value) || searchName;
    const payload = {
      wikidata_id: best.id,
      wikidata_label: label,
      wikidata_description: best.description || null,
      from_year: best.born ? best.born.year : null,
      from_year_annotation: best.born && best.born.approx ? 'c.' : null,
      to_year: best.died ? best.died.year : null,
      to_year_annotation: best.died && best.died.approx ? 'c.' : null,
      birthplace_1: birthPlaceId && places[birthPlaceId] ? places[birthPlaceId].name : null,
      birthplace_2: birthPlaceId && places[birthPlaceId] ? places[birthPlaceId].country : null,
      deathplace_1: deathPlaceId && places[deathPlaceId] ? places[deathPlaceId].name : null,
      deathplace_2: deathPlaceId && places[deathPlaceId] ? places[deathPlaceId].country : null,
    };

    const years = `${payload.from_year_annotation || ''}${payload.from_year || '?'}-${payload.to_year_annotation || ''}${payload.to_year || '?'}`;
    const placesLog = `${payload.birthplace_1 || '?'}, ${payload.birthplace_2 || '?'} / ${payload.deathplace_1 || '?'}, ${payload.deathplace_2 || '?'}`;
    if (DRY_RUN) {
      inserted++;
      console.log(`  ${comp.id} "${comp.name}" -> ${best.id} ${label} (${years}; ${placesLog}) ${Math.round(best.score * 100)}%`);
      continue;
    }
    const result = await pool.query(
      `INSERT INTO suggestions (kind, composer_id, payload, score, source, dedupe_key)
       VALUES ('composer_bio', $1, $2, $3, 'wikidata.org', $4)
       ON CONFLICT (dedupe_key) DO NOTHING`,
      [comp.id, JSON.stringify(payload), best.score, `cb:${comp.id}`]
    );
    if (result.rowCount) {
      inserted++;
      console.log(`  ${comp.id} "${comp.name}" -> ${best.id} ${label} (${years}) ${Math.round(best.score * 100)}%`);
    }
  }

  console.log(`Done. ${DRY_RUN ? 'Would insert' : 'Inserted'} ${inserted} composer bio suggestions.`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
