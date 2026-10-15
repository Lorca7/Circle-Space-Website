'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { db, UPLOAD_DIR } = require('./db');
const { embedUrlFor } = require('./lib/video');

/* ----------------------------- collections ----------------------------- */

const q = {
  allCollections: db.prepare('SELECT * FROM collections ORDER BY position, id'),
  publishedCollections: db.prepare(
    'SELECT * FROM collections WHERE published = 1 ORDER BY position, id'
  ),
  collection: db.prepare('SELECT * FROM collections WHERE id = ?'),
  collectionBySlug: db.prepare('SELECT * FROM collections WHERE slug = ?'),
  insertCollection: db.prepare(
    'INSERT INTO collections (slug, title, subtitle, description, kind, columns, published, position) ' +
      'VALUES (@slug, @title, @subtitle, @description, @kind, @columns, @published, @position)'
  ),
  updateCollection: db.prepare(
    'UPDATE collections SET slug = @slug, title = @title, subtitle = @subtitle, ' +
      'description = @description, kind = @kind, columns = @columns, published = @published, ' +
      "updated_at = datetime('now') WHERE id = @id"
  ),
  deleteCollection: db.prepare('DELETE FROM collections WHERE id = ?'),
  maxCollectionPos: db.prepare('SELECT COALESCE(MAX(position), 0) AS p FROM collections'),

  worksIn: db.prepare('SELECT * FROM works WHERE collection_id = ? ORDER BY position, id'),
  work: db.prepare('SELECT * FROM works WHERE id = ?'),
  insertWork: db.prepare(
    'INSERT INTO works (collection_id, kind, filename, original_name, url, provider, ' +
      'video_id, title, year, medium, alt_text, position) ' +
      'VALUES (@collection_id, @kind, @filename, @original_name, @url, @provider, ' +
      '@video_id, @title, @year, @medium, @alt_text, @position)'
  ),
  updateWork: db.prepare(
    'UPDATE works SET title = @title, year = @year, medium = @medium, ' +
      'alt_text = @alt_text, url = @url, provider = @provider, video_id = @video_id WHERE id = @id'
  ),
  deleteWork: db.prepare('DELETE FROM works WHERE id = ?'),
  maxWorkPos: db.prepare(
    'SELECT COALESCE(MAX(position), 0) AS p FROM works WHERE collection_id = ?'
  ),
  countWorks: db.prepare('SELECT COUNT(*) AS n FROM works WHERE collection_id = ?'),
  filenamesIn: db.prepare(
    "SELECT filename FROM works WHERE collection_id = ? AND filename <> ''"
  ),
};

const KINDS = new Set(['images', 'videos']);

function slugify(input, fallback = 'collection') {
  const slug = String(input ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
  return slug || fallback;
}

/** Appends -2, -3 … until the slug is free. */
function uniqueSlug(desired, excludeId = null) {
  const base = slugify(desired);
  let candidate = base;
  let n = 2;
  for (;;) {
    const existing = q.collectionBySlug.get(candidate);
    if (!existing || existing.id === excludeId) return candidate;
    candidate = `${base}-${n++}`;
  }
}

const listCollections = () => q.allCollections.all();
const getCollection = (id) => q.collection.get(id);
const getCollectionBySlug = (slug) => q.collectionBySlug.get(slug);
const countWorksIn = (id) => q.countWorks.get(id).n;

/** Published collections only, for the public nav. */
function listPublishedCollections() {
  return q.publishedCollections.all();
}

function addCollection({ title, kind }) {
  return q.insertCollection.run({
    slug: uniqueSlug(title),
    title: title ?? '',
    subtitle: '',
    description: '',
    kind: KINDS.has(kind) ? kind : 'images',
    columns: 3,
    published: 0,
    position: q.maxCollectionPos.get().p + 1,
  });
}

function updateCollection(id, { title, slug, subtitle, description, kind, columns, published }) {
  const cols = Number(columns);
  return q.updateCollection.run({
    id,
    slug: uniqueSlug(slug || title, id),
    title: title ?? '',
    subtitle: subtitle ?? '',
    description: description ?? '',
    kind: KINDS.has(kind) ? kind : 'images',
    columns: [2, 3, 4].includes(cols) ? cols : 3,
    published: published ? 1 : 0,
  });
}

/** Removes the collection, its works (via cascade) and their image files. */
function deleteCollection(id) {
  const collection = q.collection.get(id);
  if (!collection) return false;
  const files = q.filenamesIn.all(id);
  q.deleteCollection.run(id);
  for (const { filename } of files) removeUpload(filename);
  return true;
}

/* -------------------------------- works -------------------------------- */

function listWorks(collectionId) {
  return q.worksIn.all(collectionId).map((w) => ({ ...w, embedUrl: embedUrlFor(w) }));
}

const getWork = (id) => q.work.get(id);

function addImageWork(collectionId, { filename, originalName }) {
  return q.insertWork.run({
    collection_id: collectionId,
    kind: 'image',
    filename,
    original_name: originalName ?? '',
    url: '',
    provider: '',
    video_id: '',
    title: '',
    year: '',
    medium: '',
    alt_text: '',
    position: q.maxWorkPos.get(collectionId).p + 1,
  });
}

function addVideoWork(collectionId, { url, provider, videoId, title, year, medium }) {
  return q.insertWork.run({
    collection_id: collectionId,
    kind: 'video',
    filename: '',
    original_name: '',
    url,
    provider: provider ?? 'link',
    video_id: videoId ?? '',
    title: title ?? '',
    year: year ?? '',
    medium: medium ?? '',
    alt_text: '',
    position: q.maxWorkPos.get(collectionId).p + 1,
  });
}

function updateWork(id, { title, year, medium, altText, url, provider, videoId }) {
  const existing = q.work.get(id);
  if (!existing) return false;
  q.updateWork.run({
    id,
    title: title ?? '',
    year: year ?? '',
    medium: medium ?? '',
    alt_text: altText ?? existing.alt_text,
    url: url ?? existing.url,
    provider: provider ?? existing.provider,
    video_id: videoId ?? existing.video_id,
  });
  return true;
}

function deleteWork(id) {
  const work = q.work.get(id);
  if (!work) return false;
  q.deleteWork.run(id);
  if (work.filename) removeUpload(work.filename);
  return true;
}

function removeUpload(filename) {
  if (!filename) return;
  fs.rm(path.join(UPLOAD_DIR, path.basename(filename)), { force: true }, () => {});
}

/* ------------------------------ reordering ----------------------------- */

/**
 * Swaps a row with its neighbour. Positions are renumbered from the current
 * display order first, so rows that predate a position value still sort cleanly.
 */
const move = db.transaction((table, id, direction, scope = null) => {
  const where = table === 'works' ? 'WHERE collection_id = ?' : '';
  const params = table === 'works' ? [scope] : [];
  const rows = db.prepare(`SELECT id FROM ${table} ${where} ORDER BY position, id`).all(...params);
  const index = rows.findIndex((r) => r.id === Number(id));
  if (index === -1) return false;
  const target = direction === 'up' ? index - 1 : index + 1;
  if (target < 0 || target >= rows.length) return false;
  [rows[index], rows[target]] = [rows[target], rows[index]];
  const stmt = db.prepare(`UPDATE ${table} SET position = ? WHERE id = ?`);
  rows.forEach((row, i) => stmt.run(i + 1, row.id));
  return true;
});

/* ------------------------- messages & subscribers ---------------------- */

const messages = {
  list: db.prepare('SELECT * FROM messages ORDER BY created_at DESC, id DESC'),
  get: db.prepare('SELECT * FROM messages WHERE id = ?'),
  add: db.prepare(
    'INSERT INTO messages (name, email, subject, body) VALUES (@name, @email, @subject, @body)'
  ),
  markRead: db.prepare("UPDATE messages SET read_at = datetime('now') WHERE id = ?"),
  remove: db.prepare('DELETE FROM messages WHERE id = ?'),
  unread: db.prepare('SELECT COUNT(*) AS n FROM messages WHERE read_at IS NULL'),
};

const subscribers = {
  list: db.prepare('SELECT * FROM subscribers ORDER BY created_at DESC, id DESC'),
  add: db.prepare(
    'INSERT INTO subscribers (email) VALUES (?) ON CONFLICT(email) DO NOTHING'
  ),
  remove: db.prepare('DELETE FROM subscribers WHERE id = ?'),
  count: db.prepare('SELECT COUNT(*) AS n FROM subscribers'),
};

function counts() {
  return {
    collections: db.prepare('SELECT COUNT(*) AS n FROM collections').get().n,
    works: db.prepare('SELECT COUNT(*) AS n FROM works').get().n,
    messages: db.prepare('SELECT COUNT(*) AS n FROM messages').get().n,
    unread: messages.unread.get().n,
    subscribers: subscribers.count.get().n,
  };
}

module.exports = {
  listCollections, listPublishedCollections, getCollection, getCollectionBySlug,
  addCollection, updateCollection, deleteCollection, countWorksIn,
  listWorks, getWork, addImageWork, addVideoWork, updateWork, deleteWork,
  move, counts, slugify, uniqueSlug, removeUpload,
  messages, subscribers,
};
