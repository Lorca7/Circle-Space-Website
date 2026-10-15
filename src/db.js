'use strict';

const path = require('node:path');
const fs = require('node:fs');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '..', 'data');

const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'site.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    sid     TEXT PRIMARY KEY,
    expires INTEGER NOT NULL,
    data    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS photos (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    filename      TEXT NOT NULL,
    original_name TEXT NOT NULL DEFAULT '',
    caption       TEXT NOT NULL DEFAULT '',
    alt_text      TEXT NOT NULL DEFAULT '',
    position      INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS videos (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL DEFAULT '',
    url         TEXT NOT NULL,
    provider    TEXT NOT NULL DEFAULT 'link',
    video_id    TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    position    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS pages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    slug       TEXT NOT NULL UNIQUE,
    title      TEXT NOT NULL DEFAULT '',
    body       TEXT NOT NULL DEFAULT '',
    published  INTEGER NOT NULL DEFAULT 0,
    position   INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS links (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    label    TEXT NOT NULL DEFAULT '',
    url      TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_photos_position ON photos (position, id);
  CREATE INDEX IF NOT EXISTS idx_videos_position ON videos (position, id);
  CREATE INDEX IF NOT EXISTS idx_pages_position  ON pages (position, id);
  CREATE INDEX IF NOT EXISTS idx_links_position  ON links (position, id);
  CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires);
`);

// Every setting ships blank on purpose: the site has no content until the
// owner types it into the admin panel.
const SETTING_KEYS = [
  'site_title',
  'tagline',
  'hero_heading',
  'hero_subheading',
  'about_heading',
  'about_body',
  'contact_heading',
  'contact_body',
  'contact_email',
  'footer_text',
];

const insertSetting = db.prepare(
  'INSERT INTO settings (key, value) VALUES (?, \'\') ON CONFLICT(key) DO NOTHING'
);

db.transaction(() => {
  for (const key of SETTING_KEYS) insertSetting.run(key);
})();

const statements = {
  getSettings: db.prepare('SELECT key, value FROM settings'),
  setSetting: db.prepare(
    'INSERT INTO settings (key, value) VALUES (@key, @value) ' +
      'ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ),
};

function getSettings() {
  const out = Object.create(null);
  for (const key of SETTING_KEYS) out[key] = '';
  for (const row of statements.getSettings.all()) out[row.key] = row.value;
  return out;
}

const saveSettings = db.transaction((values) => {
  for (const key of SETTING_KEYS) {
    if (Object.prototype.hasOwnProperty.call(values, key)) {
      statements.setSetting.run({ key, value: String(values[key] ?? '') });
    }
  }
});

module.exports = { db, getSettings, saveSettings, SETTING_KEYS, DATA_DIR, UPLOAD_DIR };
