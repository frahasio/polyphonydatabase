/**
 * One-off import of hand-made booklet JSONs from templates-incoming/ into
 * booklet_templates as OFFICIAL templates. Existing official templates with
 * the same name are replaced. Usage: node scripts/import-template-jsons.js
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from '../src/db.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates-incoming');

function seasonFor(name) {
  const n = name.toLowerCase();
  if (/vespers|lauds|compline|matins|office/.test(n)) return 'Office';
  if (/requiem|funeral|burial/.test(n)) return 'Requiem & funerals';
  if (/pentecost/.test(n)) return 'Pentecost & after';
  if (/advent/.test(n)) return 'Advent';
  if (/easter|pasch/.test(n)) return 'Eastertide';
  return 'Special occasions';
}

async function main() {
  const files = fs.readdirSync(DIR).filter((f) => f.toLowerCase().endsWith('.json'));
  let imported = 0;
  for (const f of files) {
    const project = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
    if (!Array.isArray(project.blocks)) {
      console.warn(`skip ${f}: no blocks array`);
      continue;
    }
    const name = String(project.projectTitle || f.replace(/\.json$/i, '').replace(/-/g, ' ')).trim();
    const season = seasonFor(name);
    await pool.query('DELETE FROM booklet_templates WHERE name = $1 AND official = true', [name]);
    await pool.query(`
      INSERT INTO booklet_templates (name, description, season, official, owner_name, project)
      VALUES ($1, $2, $3, true, '', $4)
    `, [name, 'Hand-made template', season, JSON.stringify(project)]);
    console.log(`imported "${name}" (${season}, ${project.blocks.length} blocks)`);
    imported++;
  }
  console.log(`Done. ${imported} templates imported.`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
