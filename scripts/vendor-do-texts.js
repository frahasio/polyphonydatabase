/**
 * Vendor Divinum Officium Mass texts into data/divinumofficium/.
 *
 * Copies the missa Latin/English folders (Tempora, Sancti, Ordo) and the
 * horas Commune folders (which hold the Mass sections for the commons) from
 * a local clone of https://github.com/DivinumOfficium/divinum-officium,
 * converting Latin-1 to UTF-8.
 *
 * Usage: node scripts/vendor-do-texts.js <path-to-divinum-officium-clone>
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEST = path.join(ROOT, 'data', 'divinumofficium');

const src = process.argv[2];
if (!src || !fs.existsSync(path.join(src, 'web', 'www', 'missa'))) {
  console.error('Usage: node scripts/vendor-do-texts.js <path-to-divinum-officium-clone>');
  process.exit(1);
}

const FOLDERS = [
  ['web/www/missa/Latin/Tempora', 'missa/Latin/Tempora'],
  ['web/www/missa/English/Tempora', 'missa/English/Tempora'],
  ['web/www/missa/Latin/Sancti', 'missa/Latin/Sancti'],
  ['web/www/missa/English/Sancti', 'missa/English/Sancti'],
  ['web/www/missa/Latin/Ordo', 'missa/Latin/Ordo'],
  ['web/www/missa/English/Ordo', 'missa/English/Ordo'],
  ['web/www/horas/Latin/Commune', 'horas/Latin/Commune'],
  ['web/www/horas/English/Commune', 'horas/English/Commune'],
];

let copied = 0;
for (const [from, to] of FOLDERS) {
  const fromDir = path.join(src, ...from.split('/'));
  const toDir = path.join(DEST, ...to.split('/'));
  fs.mkdirSync(toDir, { recursive: true });
  for (const f of fs.readdirSync(fromDir)) {
    if (!f.endsWith('.txt')) continue;
    const buf = fs.readFileSync(path.join(fromDir, f));
    // DO files are ISO-8859-1; re-encode as UTF-8 unless already valid UTF-8.
    const utf8 = buf.toString('utf8');
    const text = utf8.includes('\uFFFD') ? buf.toString('latin1') : utf8;
    fs.writeFileSync(path.join(toDir, f), text, 'utf8');
    copied++;
  }
}
console.log(`Vendored ${copied} files into ${DEST}`);
