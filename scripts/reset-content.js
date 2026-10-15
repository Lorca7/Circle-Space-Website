#!/usr/bin/env node
'use strict';

/**
 * Empties the site back to a blank slate: all photos, videos, pages, links and
 * site text are removed, and uploaded image files are deleted from disk.
 * The admin account is kept. Requires --yes, because it cannot be undone.
 *
 *   node scripts/reset-content.js --yes
 */

require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const { db, UPLOAD_DIR, SETTING_KEYS } = require('../src/db');

if (!process.argv.includes('--yes')) {
  console.error(
    'This deletes every photo, video, page, link and all site text.\n' +
      'Re-run with --yes if that is what you want:\n' +
      '  node scripts/reset-content.js --yes'
  );
  process.exit(1);
}

const photos = db.prepare('SELECT filename FROM photos').all();

db.transaction(() => {
  db.prepare('DELETE FROM photos').run();
  db.prepare('DELETE FROM videos').run();
  db.prepare('DELETE FROM pages').run();
  db.prepare('DELETE FROM links').run();
  const blank = db.prepare('UPDATE settings SET value = \'\' WHERE key = ?');
  for (const key of SETTING_KEYS) blank.run(key);
})();

let removed = 0;
for (const { filename } of photos) {
  try {
    fs.rmSync(path.join(UPLOAD_DIR, path.basename(filename)), { force: true });
    removed += 1;
  } catch {
    /* a file already gone is fine */
  }
}

console.log(
  `Content cleared. ${photos.length} photo ${photos.length === 1 ? 'row' : 'rows'} ` +
    `removed, ${removed} image ${removed === 1 ? 'file' : 'files'} deleted. ` +
    'The admin account was kept.'
);
