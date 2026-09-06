# Booklet body fonts (self-hosted)

Same-origin `.woff2` files for every face in the liturgy-booklet font picker,
plus `booklet-fonts.css`. Capo Sfogliato remains a separate file in this folder.

**Why:** loading faces from Google Fonts during Puppeteer PDF export caused
Chrome to embed body text as anonymous **Type3** fonts, which look fine on
screen but print faint/wobbly on many printers. Local woff2 embeds as
TrueType CID (same as Capo Sfogliato).

**Regenerate** (after adding a picker face):

```bash
node scripts/fetch-booklet-fonts.mjs
```

Sources: [Fontsource](https://fontsource.org/) via jsDelivr (OFL / Apache /
SIL licenses as applicable to each family).
