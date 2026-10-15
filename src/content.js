'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { db, UPLOAD_DIR } = require('./db');
const { embedUrlFor } = require('./lib/video');

/* ------------------------------- photos -------------------------------- */

const q = {
  allPhotos: db.prepare('SELECT * FROM photos ORDER BY position, id'),
  photo: db.prepare('SELECT * FROM photos WHERE id = ?'),
  insertPhoto: db.prepare(
    'INSERT INTO photos (filename, original_name, caption, alt_text, position) ' +
      'VALUES (@filename, @original_name, @caption, @alt_text, @position)'
  ),
  updatePhoto: db.prepare(
    'UPDATE photos SET caption = @caption, alt_text = @alt_text WHERE id = @id'
  ),
  deletePhoto: db.prepare('DELETE FROM photos WHERE id = ?'),
  maxPhotoPos: db.prepare('SELECT COALESCE(MAX(position), 0) AS p FROM photos'),

  allVideos: db.prepare('SELECT * FROM videos ORDER BY position, id'),
  video: db.prepare('SELECT * FROM videos WHERE id = ?'),
  insertVideo: db.prepare(
    'INSERT INTO videos (title, url, provider, video_id, description, position) ' +
      'VALUES (@title, @url, @provider, @video_id, @description, @position)'
  ),
  updateVideo: db.prepare(
    'UPDATE videos SET title = @title, url = @url, provider = @provider, ' +
      'video_id = @video_id, description = @description WHERE id = @id'
  ),
  deleteVideo: db.prepare('DELETE FROM videos WHERE id = ?'),
  maxVideoPos: db.prepare('SELECT COALESCE(MAX(position), 0) AS p FROM videos'),

  allPages: db.prepare('SELECT * FROM pages ORDER BY position, id'),
  publishedPages: db.prepare('SELECT * FROM pages WHERE published = 1 ORDER BY position, id'),
  page: db.prepare('SELECT * FROM pages WHERE id = ?'),
  pageBySlug: db.prepare('SELECT * FROM pages WHERE slug = ?'),
  insertPage: db.prepare(
    'INSERT INTO pages (slug, title, body, published, position) ' +
      'VALUES (@slug, @title, @body, @published, @position)'
  ),
  updatePage: db.prepare(
    'UPDATE pages SET slug = @slug, title = @title, body = @body, ' +
      "published = @published, updated_at = datetime('now') WHERE id = @id"
  ),
  deletePage: db.prepare('DELETE FROM pages WHERE id = ?'),
  maxPagePos: db.prepare('SELECT COALESCE(MAX(position), 0) AS p FROM pages'),

  allLinks: db.prepare('SELECT * FROM links ORDER BY position, id'),
  insertLink: db.prepare(
    'INSERT INTO links (label, url, position) VALUES (@label, @url, @position)'
  ),
  deleteLink: db.prepare('DELETE FROM links WHERE id = ?'),
  maxLinkPos: db.prepare('SELECT COALESCE(MAX(position), 0) AS p FROM links'),

  setPos: {
    photos: db.prepare('UPDATE photos SET position = ? WHERE id = ?'),
    videos: db.prepare('UPDATE videos SET position = ? WHERE id = ?'),
    pages: db.prepare('UPDATE pages SET position = ? WHERE id = ?'),
    links: db.prepare('UPDATE links SET position = ? WHERE id = ?'),
  },
};

const listPhotos = () => q.allPhotos.all();
const getPhoto = (id) => q.photo.get(id);

function addPhoto({ filename, originalName }) {
  return q.insertPhoto.run({
    filename,
    original_name: originalName ?? '',
    caption: '',
    alt_text: '',
    position: q.maxPhotoPos.get().p + 1,
  });
}

function updatePhoto(id, { caption, altText }) {
  return q.updatePhoto.run({ id, caption: caption ?? '', alt_text: altText ?? '' });
}

/** Removes the row and the file on disk together. */
function deletePhoto(id) {
  const photo = q.photo.get(id);
  if (!photo) return false;
  q.deletePhoto.run(id);
  const file = path.join(UPLOAD_DIR, path.basename(photo.filename));
  fs.rm(file, { force: true }, () => {});
  return true;
}

/* ------------------------------- videos -------------------------------- */

function listVideos() {
  return q.allVideos.all().map((v) => ({ ...v, embedUrl: embedUrlFor(v) }));
}
const getVideo = (id) => q.video.get(id);

function addVideo({ title, url, provider, videoId, description }) {
  return q.insertVideo.run({
    title: title ?? '',
    url,
    provider: provider ?? 'link',
    video_id: videoId ?? '',
    description: description ?? '',
    position: q.maxVideoPos.get().p + 1,
  });
}

function updateVideo(id, { title, url, provider, videoId, description }) {
  return q.updateVideo.run({
    id,
    title: title ?? '',
    url,
    provider: provider ?? 'link',
    video_id: videoId ?? '',
    description: description ?? '',
  });
}
const deleteVideo = (id) => q.deleteVideo.run(id).changes > 0;

/* -------------------------------- pages -------------------------------- */

const listPages = () => q.allPages.all();
const listPublishedPages = () => q.publishedPages.all();
const getPage = (id) => q.page.get(id);
const getPageBySlug = (slug) => q.pageBySlug.get(slug);

function slugify(input, fallback = 'page') {
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
    const existing = q.pageBySlug.get(candidate);
    if (!existing || existing.id === excludeId) return candidate;
    candidate = `${base}-${n++}`;
  }
}

function addPage({ title, body, published }) {
  return q.insertPage.run({
    slug: uniqueSlug(title),
    title: title ?? '',
    body: body ?? '',
    published: published ? 1 : 0,
    position: q.maxPagePos.get().p + 1,
  });
}

function updatePage(id, { title, body, published, slug }) {
  return q.updatePage.run({
    id,
    slug: uniqueSlug(slug || title, id),
    title: title ?? '',
    body: body ?? '',
    published: published ? 1 : 0,
  });
}
const deletePage = (id) => q.deletePage.run(id).changes > 0;

/* -------------------------------- links -------------------------------- */

const listLinks = () => q.allLinks.all();
function addLink({ label, url }) {
  return q.insertLink.run({
    label: label ?? '',
    url,
    position: q.maxLinkPos.get().p + 1,
  });
}
const deleteLink = (id) => q.deleteLink.run(id).changes > 0;

/* ------------------------------ reordering ----------------------------- */

/**
 * Swaps an item with its neighbour. Positions are renumbered from the current
 * display order first, so rows created before this feature still order cleanly.
 */
const move = db.transaction((table, id, direction) => {
  const stmt = q.setPos[table];
  if (!stmt) throw new Error(`unknown table: ${table}`);
  const rows = db.prepare(`SELECT id FROM ${table} ORDER BY position, id`).all();
  const index = rows.findIndex((r) => r.id === Number(id));
  if (index === -1) return false;
  const target = direction === 'up' ? index - 1 : index + 1;
  if (target < 0 || target >= rows.length) return false;
  [rows[index], rows[target]] = [rows[target], rows[index]];
  rows.forEach((row, i) => stmt.run(i + 1, row.id));
  return true;
});

function counts() {
  return {
    photos: db.prepare('SELECT COUNT(*) AS n FROM photos').get().n,
    videos: db.prepare('SELECT COUNT(*) AS n FROM videos').get().n,
    pages: db.prepare('SELECT COUNT(*) AS n FROM pages').get().n,
    links: db.prepare('SELECT COUNT(*) AS n FROM links').get().n,
  };
}

module.exports = {
  listPhotos, getPhoto, addPhoto, updatePhoto, deletePhoto,
  listVideos, getVideo, addVideo, updateVideo, deleteVideo,
  listPages, listPublishedPages, getPage, getPageBySlug, addPage, updatePage, deletePage,
  listLinks, addLink, deleteLink,
  move, counts, slugify, uniqueSlug,
};
