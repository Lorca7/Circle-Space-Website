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

  /* A body of work: a titled series holding either images or videos. */
  CREATE TABLE IF NOT EXISTS collections (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    slug        TEXT NOT NULL UNIQUE,
    title       TEXT NOT NULL DEFAULT '',
    subtitle    TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    kind        TEXT NOT NULL DEFAULT 'images',
    columns     INTEGER NOT NULL DEFAULT 3,
    published   INTEGER NOT NULL DEFAULT 0,
    position    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  /* One piece inside a collection: an uploaded image or an embedded video. */
  CREATE TABLE IF NOT EXISTS works (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    collection_id INTEGER NOT NULL REFERENCES collections (id) ON DELETE CASCADE,
    kind          TEXT NOT NULL DEFAULT 'image',
    filename      TEXT NOT NULL DEFAULT '',
    original_name TEXT NOT NULL DEFAULT '',
    url           TEXT NOT NULL DEFAULT '',
    provider      TEXT NOT NULL DEFAULT '',
    video_id      TEXT NOT NULL DEFAULT '',
    title         TEXT NOT NULL DEFAULT '',
    year          TEXT NOT NULL DEFAULT '',
    medium        TEXT NOT NULL DEFAULT '',
    alt_text      TEXT NOT NULL DEFAULT '',
    position      INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  /* Contact form submissions, kept here so none are lost if email is not set up. */
  CREATE TABLE IF NOT EXISTS messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL DEFAULT '',
    email      TEXT NOT NULL DEFAULT '',
    subject    TEXT NOT NULL DEFAULT '',
    body       TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    read_at    TEXT
  );

  CREATE TABLE IF NOT EXISTS subscribers (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    email      TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_collections_position ON collections (position, id);
  CREATE INDEX IF NOT EXISTS idx_works_collection     ON works (collection_id, position, id);
  CREATE INDEX IF NOT EXISTS idx_messages_created     ON messages (created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_sessions_expires     ON sessions (expires);
`);

// Every setting ships blank: the site has no content until the owner enters it.
const SETTING_KEYS = [
  'site_title',
  'home_image',
  'home_image_alt',
  'home_caption',
  'about_heading',
  'about_body',
  'contact_heading',
  'contact_intro',
  'contact_email',
  'newsletter_heading',
  'newsletter_intro',
  'footer_text',
];

const insertSetting = db.prepare(
  "INSERT INTO settings (key, value) VALUES (?, '') ON CONFLICT(key) DO NOTHING"
);

db.transaction(() => {
  for (const key of SETTING_KEYS) insertSetting.run(key);
})();

const readSettings = db.prepare('SELECT key, value FROM settings');
const writeSetting = db.prepare(
  'INSERT INTO settings (key, value) VALUES (@key, @value) ' +
    'ON CONFLICT(key) DO UPDATE SET value = excluded.value'
);

const KNOWN_KEYS = new Set(SETTING_KEYS);

function getSettings() {
  const out = Object.create(null);
  for (const key of SETTING_KEYS) out[key] = '';
  for (const row of readSettings.all()) {
    if (KNOWN_KEYS.has(row.key)) out[row.key] = row.value;
  }
  return out;
}

/** Writes only the keys present in `values`, so partial forms are safe. */
const saveSettings = db.transaction((values) => {
  for (const key of SETTING_KEYS) {
    if (Object.prototype.hasOwnProperty.call(values, key)) {
      writeSetting.run({ key, value: String(values[key] ?? '') });
    }
  }
});

module.exports = { db, getSettings, saveSettings, SETTING_KEYS, DATA_DIR, UPLOAD_DIR };
