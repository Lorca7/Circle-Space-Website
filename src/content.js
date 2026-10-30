'use strict';

const { sql } = require('./db');
const { embedUrlFor } = require('./lib/video');
const { deleteFromCloud } = require('./lib/upload');

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

async function uniqueSlug(desired, excludeId = null) {
  const base = slugify(desired);
  let candidate = base;
  let n = 2;
  for (;;) {
    const rows = await sql`SELECT id FROM collections WHERE slug = ${candidate}`;
    if (rows.length === 0 || (rows[0] && rows[0].id === excludeId)) return candidate;
    candidate = `${base}-${n++}`;
  }
}

/* ----------------------------- collections ----------------------------- */

async function listCollections() {
  return sql`SELECT * FROM collections ORDER BY position, id`;
}

async function listPublishedCollections() {
  return sql`SELECT * FROM collections WHERE published = 1 ORDER BY position, id`;
}

async function getCollection(id) {
  const rows = await sql`SELECT * FROM collections WHERE id = ${id}`;
  return rows[0] || null;
}

async function getCollectionBySlug(slug) {
  const rows = await sql`SELECT * FROM collections WHERE slug = ${slug}`;
  return rows[0] || null;
}

async function countWorksIn(id) {
  const rows = await sql`SELECT COUNT(*) AS n FROM works WHERE collection_id = ${id}`;
  return Number(rows[0].n);
}

async function addCollection({ title, kind }) {
  const slug = await uniqueSlug(title);
  const posRows = await sql`SELECT COALESCE(MAX(position), 0) AS p FROM collections`;
  const position = posRows[0].p + 1;
  const rows = await sql`
    INSERT INTO collections (slug, title, subtitle, description, kind, columns, published, position)
    VALUES (${slug}, ${title ?? ''}, '', '', ${KINDS.has(kind) ? kind : 'images'}, 3, 0, ${position})
    RETURNING id`;
  return rows[0].id;
}

async function updateCollection(id, { title, slug, subtitle, description, kind, columns, published }) {
  const cols = Number(columns);
  const finalSlug = await uniqueSlug(slug || title, id);
  await sql`
    UPDATE collections
    SET slug = ${finalSlug}, title = ${title ?? ''}, subtitle = ${subtitle ?? ''},
        description = ${description ?? ''}, kind = ${KINDS.has(kind) ? kind : 'images'},
        columns = ${[2, 3, 4].includes(cols) ? cols : 3},
        published = ${published ? 1 : 0}, updated_at = NOW()
    WHERE id = ${id}`;
}

async function deleteCollection(id) {
  const collection = await getCollection(id);
  if (!collection) return false;
  const files = await sql`SELECT filename FROM works WHERE collection_id = ${id} AND filename <> ''`;
  await sql`DELETE FROM collections WHERE id = ${id}`;
  for (const { filename } of files) await deleteFromCloud(filename);
  return true;
}

/* -------------------------------- works -------------------------------- */

async function listWorks(collectionId) {
  const rows = await sql`SELECT * FROM works WHERE collection_id = ${collectionId} ORDER BY position, id`;
  return rows.map((w) => ({ ...w, embedUrl: embedUrlFor(w) }));
}

async function getWork(id) {
  const rows = await sql`SELECT * FROM works WHERE id = ${id}`;
  return rows[0] || null;
}

async function addImageWork(collectionId, { filename, url }) {
  const posRows = await sql`SELECT COALESCE(MAX(position), 0) AS p FROM works WHERE collection_id = ${collectionId}`;
  await sql`
    INSERT INTO works (collection_id, kind, filename, original_name, url, provider,
      video_id, title, year, medium, alt_text, position)
    VALUES (${collectionId}, 'image', ${filename}, '', ${url}, '', '', '', '', '', '', ${posRows[0].p + 1})`;
}

async function addVideoWork(collectionId, { url, provider, videoId, title, year, medium }) {
  const posRows = await sql`SELECT COALESCE(MAX(position), 0) AS p FROM works WHERE collection_id = ${collectionId}`;
  await sql`
    INSERT INTO works (collection_id, kind, filename, original_name, url, provider,
      video_id, title, year, medium, alt_text, position)
    VALUES (${collectionId}, 'video', '', '', ${url}, ${provider ?? 'link'},
      ${videoId ?? ''}, ${title ?? ''}, ${year ?? ''}, ${medium ?? ''}, '', ${posRows[0].p + 1})`;
}

async function updateWork(id, { title, year, medium, altText, url, provider, videoId }) {
  const existing = await getWork(id);
  if (!existing) return false;
  await sql`
    UPDATE works SET title = ${title ?? ''}, year = ${year ?? ''}, medium = ${medium ?? ''},
      alt_text = ${altText ?? existing.alt_text}, url = ${url ?? existing.url},
      provider = ${provider ?? existing.provider}, video_id = ${videoId ?? existing.video_id}
    WHERE id = ${id}`;
  return true;
}

async function deleteWork(id) {
  const work = await getWork(id);
  if (!work) return false;
  await sql`DELETE FROM works WHERE id = ${id}`;
  if (work.filename) await deleteFromCloud(work.filename);
  return true;
}

/* ------------------------------ reordering ----------------------------- */

async function move(table, id, direction, scope = null) {
  const allowed = { collections: 'collections', works: 'works' };
  const t = allowed[table];
  if (!t) return false;

  const rows =
    t === 'works'
      ? await sql('SELECT id FROM works WHERE collection_id = $1 ORDER BY position, id', [scope])
      : await sql('SELECT id FROM collections ORDER BY position, id');

  const index = rows.findIndex((r) => r.id === Number(id));
  if (index === -1) return false;
  const target = direction === 'up' ? index - 1 : index + 1;
  if (target < 0 || target >= rows.length) return false;
  [rows[index], rows[target]] = [rows[target], rows[index]];

  for (let i = 0; i < rows.length; i++) {
    await sql(`UPDATE ${t} SET position = $1 WHERE id = $2`, [i + 1, rows[i].id]);
  }
  return true;
}

/* ------------------------- messages & subscribers ---------------------- */

async function listMessages() {
  return sql`SELECT * FROM messages ORDER BY created_at DESC, id DESC`;
}

async function addMessage({ name, email, subject, body }) {
  await sql`INSERT INTO messages (name, email, subject, body) VALUES (${name}, ${email}, ${subject}, ${body})`;
}

async function markMessageRead(id) {
  await sql`UPDATE messages SET read_at = NOW() WHERE id = ${id}`;
}

async function deleteMessage(id) {
  await sql`DELETE FROM messages WHERE id = ${id}`;
}

async function unreadCount() {
  const rows = await sql`SELECT COUNT(*) AS n FROM messages WHERE read_at IS NULL`;
  return Number(rows[0].n);
}

async function listSubscribers() {
  return sql`SELECT * FROM subscribers ORDER BY created_at DESC, id DESC`;
}

async function addSubscriber(email) {
  await sql`INSERT INTO subscribers (email) VALUES (${email}) ON CONFLICT (email) DO NOTHING`;
}

async function deleteSubscriber(id) {
  await sql`DELETE FROM subscribers WHERE id = ${id}`;
}

async function counts() {
  const [c, w, m, u, s] = await Promise.all([
    sql`SELECT COUNT(*) AS n FROM collections`,
    sql`SELECT COUNT(*) AS n FROM works`,
    sql`SELECT COUNT(*) AS n FROM messages`,
    sql`SELECT COUNT(*) AS n FROM messages WHERE read_at IS NULL`,
    sql`SELECT COUNT(*) AS n FROM subscribers`,
  ]);
  return {
    collections: Number(c[0].n),
    works: Number(w[0].n),
    messages: Number(m[0].n),
    unread: Number(u[0].n),
    subscribers: Number(s[0].n),
  };
}

module.exports = {
  listCollections, listPublishedCollections, getCollection, getCollectionBySlug,
  addCollection, updateCollection, deleteCollection, countWorksIn,
  listWorks, getWork, addImageWork, addVideoWork, updateWork, deleteWork,
  move, counts, slugify, uniqueSlug,
  listMessages, addMessage, markMessageRead, deleteMessage, unreadCount,
  listSubscribers, addSubscriber, deleteSubscriber,
};
