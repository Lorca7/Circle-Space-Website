'use strict';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const bcrypt = require('bcryptjs');
const { db, getSettings, saveSettings, SETTING_KEYS } = require('../db');
const content = require('../content');
const { parseVideoUrl } = require('../lib/video');
const { upload, describeUploadError, UPLOAD_DIR } = require('../lib/upload');
const {
  createUser, verifyLogin, hasAnyUser, requireAuth,
  csrf, tokenMatches, rejectCsrf, normaliseEmail,
} = require('../middleware/auth');

const router = express.Router();

router.use(csrf);

/** Flash-style messages carried across the redirect that follows a POST. */
router.use((req, res, next) => {
  res.locals.notice = req.session.notice || null;
  res.locals.errorMessage = req.session.errorMessage || null;
  delete req.session.notice;
  delete req.session.errorMessage;
  res.locals.counts = content.counts();
  next();
});

function notice(req, message) {
  req.session.notice = message;
}
function fail(req, message) {
  req.session.errorMessage = message;
}

/* ------------------------- first-run / sign-in ------------------------- */

// With no account yet, every admin URL leads to setup; once one exists the
// setup page is closed off so it can never be used to add a second owner.
router.use((req, res, next) => {
  const isSetup = req.path === '/setup';
  if (!hasAnyUser()) {
    return isSetup ? next() : res.redirect('/admin/setup');
  }
  if (isSetup) return res.redirect('/admin/login');
  return next();
});

router.get('/setup', (req, res) => {
  res.render('admin/setup', { title: 'Create your admin account' });
});

router.post('/setup', (req, res) => {
  const email = normaliseEmail(req.body.email);
  const password = String(req.body.password ?? '');
  const confirm = String(req.body.confirm ?? '');

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    fail(req, 'Enter a valid email address.');
    return res.redirect('/admin/setup');
  }
  if (password.length < 10) {
    fail(req, 'Use a password of at least 10 characters.');
    return res.redirect('/admin/setup');
  }
  if (password !== confirm) {
    fail(req, 'The two passwords did not match.');
    return res.redirect('/admin/setup');
  }

  createUser(email, password);
  notice(req, 'Admin account created. Sign in to start filling out the site.');
  return res.redirect('/admin/login');
});

router.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/admin');
  res.render('admin/login', { title: 'Sign in' });
});

router.post('/login', (req, res) => {
  const user = verifyLogin(req.body.email, req.body.password);
  if (!user) {
    fail(req, 'Those details did not match an account.');
    return res.redirect('/admin/login');
  }
  const target = req.session.returnTo || '/admin';
  // A fresh session id on sign-in prevents session fixation.
  return req.session.regenerate((err) => {
    if (err) {
      fail(req, 'Something went wrong signing in. Try again.');
      return res.redirect('/admin/login');
    }
    req.session.userId = user.id;
    req.session.userEmail = user.email;
    return res.redirect(target);
  });
});

router.post('/logout', requireAuth, (req, res) => {
  req.session.destroy(() => res.redirect('/admin/login'));
});

/* ------------------------- everything below: auth ---------------------- */

router.use(requireAuth);

router.use((req, res, next) => {
  res.locals.currentUser = { id: req.session.userId, email: req.session.userEmail };
  next();
});

router.get('/', (req, res) => {
  res.render('admin/dashboard', {
    title: 'Dashboard',
    settings: getSettings(),
    active: 'dashboard',
  });
});

/* ------------------------------ settings ------------------------------- */

router.get('/settings', (req, res) => {
  res.render('admin/settings', {
    title: 'Site text',
    settings: getSettings(),
    active: 'settings',
  });
});

router.post('/settings', (req, res) => {
  const values = {};
  for (const key of SETTING_KEYS) values[key] = String(req.body[key] ?? '');
  saveSettings(values);
  notice(req, 'Site text saved.');
  res.redirect('/admin/settings');
});

/* ------------------------------- photos -------------------------------- */

router.get('/photos', (req, res) => {
  res.render('admin/photos', {
    title: 'Photos',
    photos: content.listPhotos(),
    active: 'photos',
  });
});

/** Deletes files multer already wrote, for a request we end up rejecting. */
function discardUploads(files) {
  for (const file of files ?? []) {
    fs.rm(path.join(UPLOAD_DIR, path.basename(file.filename)), { force: true }, () => {});
  }
}

router.post('/photos', (req, res) => {
  upload.array('photos', 20)(req, res, (err) => {
    // The multipart body only exists now, so this is where its CSRF token can
    // be checked. Anything already written to disk is thrown away.
    if (req.csrfDeferred && !tokenMatches(req)) {
      discardUploads(req.files);
      return rejectCsrf(res);
    }
    if (err) {
      discardUploads(req.files);
      fail(req, describeUploadError(err) || 'That upload could not be accepted.');
      return res.redirect('/admin/photos');
    }
    const files = req.files ?? [];
    if (files.length === 0) {
      fail(req, 'Choose at least one image to upload.');
      return res.redirect('/admin/photos');
    }
    for (const file of files) {
      content.addPhoto({ filename: file.filename, originalName: file.originalname });
    }
    notice(req, `Added ${files.length} ${files.length === 1 ? 'photo' : 'photos'}.`);
    return res.redirect('/admin/photos');
  });
});

router.post('/photos/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!content.getPhoto(id)) {
    fail(req, 'That photo no longer exists.');
    return res.redirect('/admin/photos');
  }
  content.updatePhoto(id, { caption: req.body.caption, altText: req.body.alt_text });
  notice(req, 'Photo details saved.');
  res.redirect('/admin/photos');
});

router.post('/photos/:id/delete', (req, res) => {
  content.deletePhoto(Number(req.params.id))
    ? notice(req, 'Photo deleted.')
    : fail(req, 'That photo no longer exists.');
  res.redirect('/admin/photos');
});

router.post('/photos/:id/move', (req, res) => {
  content.move('photos', Number(req.params.id), req.body.direction === 'up' ? 'up' : 'down');
  res.redirect('/admin/photos');
});

/* ------------------------------- videos -------------------------------- */

router.get('/videos', (req, res) => {
  res.render('admin/videos', {
    title: 'Video links',
    videos: content.listVideos(),
    active: 'videos',
  });
});

router.post('/videos', (req, res) => {
  const parsed = parseVideoUrl(req.body.url);
  if (!parsed.ok) {
    fail(req, parsed.error);
    return res.redirect('/admin/videos');
  }
  content.addVideo({
    title: req.body.title,
    url: parsed.url,
    provider: parsed.provider,
    videoId: parsed.videoId,
    description: req.body.description,
  });
  notice(req, 'Video added.');
  res.redirect('/admin/videos');
});

router.post('/videos/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!content.getVideo(id)) {
    fail(req, 'That video no longer exists.');
    return res.redirect('/admin/videos');
  }
  const parsed = parseVideoUrl(req.body.url);
  if (!parsed.ok) {
    fail(req, parsed.error);
    return res.redirect('/admin/videos');
  }
  content.updateVideo(id, {
    title: req.body.title,
    url: parsed.url,
    provider: parsed.provider,
    videoId: parsed.videoId,
    description: req.body.description,
  });
  notice(req, 'Video saved.');
  res.redirect('/admin/videos');
});

router.post('/videos/:id/delete', (req, res) => {
  content.deleteVideo(Number(req.params.id))
    ? notice(req, 'Video removed.')
    : fail(req, 'That video no longer exists.');
  res.redirect('/admin/videos');
});

router.post('/videos/:id/move', (req, res) => {
  content.move('videos', Number(req.params.id), req.body.direction === 'up' ? 'up' : 'down');
  res.redirect('/admin/videos');
});

/* -------------------------------- pages -------------------------------- */

router.get('/pages', (req, res) => {
  res.render('admin/pages', { title: 'Pages', pages: content.listPages(), active: 'pages' });
});

router.post('/pages', (req, res) => {
  const title = String(req.body.title ?? '').trim();
  if (!title) {
    fail(req, 'Give the page a title.');
    return res.redirect('/admin/pages');
  }
  const info = content.addPage({ title, body: '', published: false });
  notice(req, 'Page created. Add the text, then publish it when you are ready.');
  res.redirect(`/admin/pages/${info.lastInsertRowid}`);
});

router.get('/pages/:id', (req, res) => {
  const page = content.getPage(Number(req.params.id));
  if (!page) {
    fail(req, 'That page no longer exists.');
    return res.redirect('/admin/pages');
  }
  res.render('admin/page-edit', { title: 'Edit page', page, active: 'pages' });
});

router.post('/pages/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!content.getPage(id)) {
    fail(req, 'That page no longer exists.');
    return res.redirect('/admin/pages');
  }
  const title = String(req.body.title ?? '').trim();
  if (!title) {
    fail(req, 'Give the page a title.');
    return res.redirect(`/admin/pages/${id}`);
  }
  content.updatePage(id, {
    title,
    slug: req.body.slug,
    body: req.body.body,
    published: req.body.published === 'on',
  });
  notice(req, 'Page saved.');
  res.redirect(`/admin/pages/${id}`);
});

router.post('/pages/:id/delete', (req, res) => {
  content.deletePage(Number(req.params.id))
    ? notice(req, 'Page deleted.')
    : fail(req, 'That page no longer exists.');
  res.redirect('/admin/pages');
});

router.post('/pages/:id/move', (req, res) => {
  content.move('pages', Number(req.params.id), req.body.direction === 'up' ? 'up' : 'down');
  res.redirect('/admin/pages');
});

/* -------------------------------- links -------------------------------- */

router.get('/links', (req, res) => {
  res.render('admin/links', { title: 'Links', links: content.listLinks(), active: 'links' });
});

router.post('/links', (req, res) => {
  const label = String(req.body.label ?? '').trim();
  const raw = String(req.body.url ?? '').trim();
  if (!label) {
    fail(req, 'Give the link a label.');
    return res.redirect('/admin/links');
  }
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('scheme');
  } catch {
    fail(req, 'That does not look like a valid link.');
    return res.redirect('/admin/links');
  }
  content.addLink({ label, url: url.href });
  notice(req, 'Link added.');
  res.redirect('/admin/links');
});

router.post('/links/:id/delete', (req, res) => {
  content.deleteLink(Number(req.params.id))
    ? notice(req, 'Link removed.')
    : fail(req, 'That link no longer exists.');
  res.redirect('/admin/links');
});

router.post('/links/:id/move', (req, res) => {
  content.move('links', Number(req.params.id), req.body.direction === 'up' ? 'up' : 'down');
  res.redirect('/admin/links');
});

/* ------------------------------- account ------------------------------- */

router.get('/account', (req, res) => {
  res.render('admin/account', { title: 'Your account', active: 'account' });
});

router.post('/account/password', (req, res) => {
  const current = String(req.body.current_password ?? '');
  const next = String(req.body.new_password ?? '');
  const confirm = String(req.body.confirm_password ?? '');

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  if (!user || !bcrypt.compareSync(current, user.password_hash)) {
    fail(req, 'Your current password was not correct.');
    return res.redirect('/admin/account');
  }
  if (next.length < 10) {
    fail(req, 'Use a new password of at least 10 characters.');
    return res.redirect('/admin/account');
  }
  if (next !== confirm) {
    fail(req, 'The two new passwords did not match.');
    return res.redirect('/admin/account');
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
    .run(bcrypt.hashSync(next, 12), user.id);
  notice(req, 'Password updated.');
  res.redirect('/admin/account');
});

module.exports = router;
