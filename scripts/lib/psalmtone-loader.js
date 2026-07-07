/**
 * Load the vendored jgabc psalmtone.node.js without its jQuery dependency
 * (jQuery is only used by getPsalm's AJAX path, which we never call — we read
 * psalm texts from disk ourselves).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC_PATH = path.join(ROOT, 'public', 'vendor', 'jgabc', 'psalmtone.node.js');

let cached = null;

export function loadPsalmtone() {
  if (cached) return cached;
  let src = fs.readFileSync(SRC_PATH, 'latin1');
  src = src.replace("var $=require('jquery');", 'var $=null;');
  // Expose internals the psalmtone UI uses but the module doesn't export.
  src += '\nexports.g_tones = g_tones;\nexports.getGabcTones = getGabcTones;\nexports.normalizePsalm = normalizePsalm;\nexports.gloria_patri = gloria_patri;\n';
  const module = { exports: {} };
  const fn = new Function('exports', 'module', 'require', src);
  fn(module.exports, module, () => null);
  cached = module.exports;
  return cached;
}
