const { join } = require('path');

/**
 * Keep Puppeteer's Chrome in a top-level dir (not node_modules, which Heroku
 * wipes on every `npm ci`, and not /app/.cache, which Heroku prunes from the
 * slug). Listing this dir in package.json "cacheDirectories" lets Heroku
 * persist it between builds, so Chrome is only downloaded when it changes.
 */
module.exports = {
  cacheDirectory: join(__dirname, 'puppeteer-cache'),
};
