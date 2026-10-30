'use strict';

const { neon } = require('@neondatabase/serverless');

const sql = neon(process.env.DATABASE_URL);

const SETTING_KEYS = [
  'site_title',
  'home_image',
  'home_image_alt',
  'home_image_public_id',
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

async function migrate() {
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`;

  await sql`
    CREATE TABLE IF NOT EXISTS sessions (
      sid TEXT PRIMARY KEY,
      expires BIGINT NOT NULL,
      data TEXT NOT NULL
    )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires)`;

  await sql`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT ''
    )`;

  await sql`
    CREATE TABLE IF NOT EXISTS collections (
      id SERIAL PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL DEFAULT '',
      subtitle TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL DEFAULT 'images',
      columns INTEGER NOT NULL DEFAULT 3,
      published INTEGER NOT NULL DEFAULT 0,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`;

  await sql`
    CREATE TABLE IF NOT EXISTS works (
      id SERIAL PRIMARY KEY,
      collection_id INTEGER NOT NULL REFERENCES collections (id) ON DELETE CASCADE,
      kind TEXT NOT NULL DEFAULT 'image',
      filename TEXT NOT NULL DEFAULT '',
      original_name TEXT NOT NULL DEFAULT '',
      url TEXT NOT NULL DEFAULT '',
      provider TEXT NOT NULL DEFAULT '',
      video_id TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      year TEXT NOT NULL DEFAULT '',
      medium TEXT NOT NULL DEFAULT '',
      alt_text TEXT NOT NULL DEFAULT '',
      position INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`;

  await sql`
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      subject TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      read_at TIMESTAMP
    )`;

  await sql`
    CREATE TABLE IF NOT EXISTS subscribers (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`;

  await sql`CREATE INDEX IF NOT EXISTS idx_collections_position ON collections (position, id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_works_collection ON works (collection_id, position, id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_messages_created ON messages (created_at DESC)`;

  for (const key of SETTING_KEYS) {
    await sql('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING', [key, '']);
  }
}

async function getSettings() {
  const rows = await sql`SELECT key, value FROM settings`;
  const out = Object.create(null);
  const known = new Set(SETTING_KEYS);
  for (const key of SETTING_KEYS) out[key] = '';
  for (const row of rows) {
    if (known.has(row.key)) out[row.key] = row.value;
  }
  return out;
}

async function saveSettings(values) {
  for (const key of SETTING_KEYS) {
    if (Object.prototype.hasOwnProperty.call(values, key)) {
      await sql(
        'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
        [key, String(values[key] ?? '')]
      );
    }
  }
}

module.exports = { sql, migrate, getSettings, saveSettings, SETTING_KEYS };
