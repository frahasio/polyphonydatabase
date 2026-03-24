const fs = require("fs");
const path = require("path");
const { svgPathBbox } = require("svg-path-bbox");

const clefsDir = path.join(
  __dirname,
  "..",
  "public",
  "svg",
  "clefs"
);

const files = fs.readdirSync(clefsDir).filter((f) => f.endsWith("-clef.svg"));

function parseSvg(text) {
  const vb = text.match(/viewBox\s*=\s*"([^"]+)"/);
  const parts = vb[1].trim().split(/\s+/).map(Number);
  const [, , vw, vh] = parts;
  const tm = text.match(/transform\s*=\s*"translate\(([^,]+),([^)]+)\)"/);
  const tx = parseFloat(tm[1]);
  const ty = parseFloat(tm[2]);
  const paths = [];
  const pathRe = /<path\s[^>]*\bid\s*=\s*"([^"]+)"[^>]*\bd\s*=\s*"([^"]+)"/g;
  let m;
  while ((m = pathRe.exec(text)) !== null) {
    paths.push({ id: m[1], d: m[2] });
  }
  if (paths.length === 0) {
    const pathRe2 = /<path\s[^>]*\bd\s*=\s*"([^"]+)"[^>]*\bid\s*=\s*"([^"]+)"/g;
    while ((m = pathRe2.exec(text)) !== null) {
      paths.push({ id: m[2], d: m[1] });
    }
  }
  return { vw, vh, tx, ty, paths };
}

// User viewport: viewBox "0 0 vw vh". Layer translate(tx,ty). Point in path data P
// appears at P + (tx, ty) in SVG user space.
const intersects = (bb, px0, py0, px1, py1) => {
  const [xmin, ymin, xmax, ymax] = bb;
  const ix0 = Math.max(xmin, px0);
  const iy0 = Math.max(ymin, py0);
  const ix1 = Math.min(xmax, px1);
  const iy1 = Math.min(ymax, py1);
  return ix0 <= ix1 && iy0 <= iy1;
};

for (const fname of files.sort()) {
  const text = fs.readFileSync(path.join(clefsDir, fname), "utf8");
  const { vw, vh, tx, ty, paths } = parseSvg(text);
  const px0 = -tx;
  const px1 = -tx + vw;
  const py0 = -ty;
  const py1 = -ty + vh;
  console.log(`\n${fname}`);
  console.log(`  viewBox: 0 0 ${vw} ${vh}`);
  console.log(`  translate(${tx}, ${ty})`);
  console.log(
    `  path-space visible AABB (where P+translate lies in viewBox): x [${px0}, ${px1}] y [${py0}, ${py1}]`
  );
  const visible = [];
  for (const { id, d } of paths) {
    let bb;
    try {
      bb = svgPathBbox(d);
    } catch (e) {
      console.log(`  ${id}: bbox error ${e.message}`);
      continue;
    }
    const ok = intersects(bb, px0, py0, px1, py1);
    const [xmin, ymin, xmax, ymax] = bb;
    console.log(
      `  ${id}: bbox [${xmin.toFixed(5)},${ymin.toFixed(5)}]-[${xmax.toFixed(5)},${ymax.toFixed(5)}] ${ok ? "VISIBLE" : "hidden"}`
    );
    if (ok) visible.push(id);
  }
  console.log(`  => visible ids: ${visible.join(", ")}`);
}
