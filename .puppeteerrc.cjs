const { join } = require('path');

/**
 * Heroku prunes /app/.cache after build, so Puppeteer's downloaded Chrome
 * disappears before runtime. Redirecting the cache into node_modules keeps
 * it inside the slug.
 */
module.exports = {
  cacheDirectory: join(__dirname, 'node_modules', '.cache', 'puppeteer'),
};
