#!/usr/bin/env node
'use strict';

/**
 * Empties the site back to a blank slate: every collection, work, message and
 * subscriber is removed, all site text is cleared, and uploaded images are
 * deleted from disk. The admin account is kept. Requires --yes.
 *
 *   node scripts/reset-content.js --yes
 */

require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const { db, UPLOAD_DIR, SETTING_KEYS, getSettings } = require('../src/db');

if (!process.argv.includes('--yes')) {
  console.error(
    'This deletes every collection, work, message and subscriber, and all site text.\n' +
      'Re-run with --yes if that is what you want:\n' +
      '  node scripts/reset-content.js --yes'
  );
  process.exit(1);
}

// Gather every file the database refers to before the rows are gone.
const files = db
  .prepare("SELECT filename FROM works WHERE filename <> ''")
  .all()
  .map((row) => row.filename);

const homeImage = getSettings().home_image;
if (homeImage) files.push(homeImage);

const summary = db.transaction(() => {
  const counts = {
    collections: db.prepare('SELECT COUNT(*) AS n FROM collections').get().n,
    works: db.prepare('SELECT COUNT(*) AS n FROM works').get().n,
    messages: db.prepare('SELECT COUNT(*) AS n FROM messages').get().n,
    subscribers: db.prepare('SELECT COUNT(*) AS n FROM subscribers').get().n,
  };
  // Works go with their collection through the foreign key, but clear both
  // explicitly so the script still works if that constraint is ever relaxed.
  db.prepare('DELETE FROM works').run();
  db.prepare('DELETE FROM collections').run();
  db.prepare('DELETE FROM messages').run();
  db.prepare('DELETE FROM subscribers').run();
  const blank = db.prepare("UPDATE settings SET value = '' WHERE key = ?");
  for (const key of SETTING_KEYS) blank.run(key);
  return counts;
})();

let removed = 0;
for (const filename of files) {
  try {
    fs.rmSync(path.join(UPLOAD_DIR, path.basename(filename)), { force: true });
    removed += 1;
  } catch {
    /* a file already gone is fine */
  }
}

console.log(
  `Content cleared: ${summary.collections} collections, ${summary.works} works, ` +
    `${summary.messages} messages, ${summary.subscribers} subscribers. ` +
    `${removed} image ${removed === 1 ? 'file' : 'files'} deleted. ` +
    'The admin account was kept.'
);
