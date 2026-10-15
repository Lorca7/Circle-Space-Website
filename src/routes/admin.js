'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const { db, getSettings, saveSettings, SETTING_KEYS } = require('../db');
const content = require('../content');
const { parseVideoUrl } = require('../lib/video');
const { upload, describeUploadError } = require('../lib/upload');
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

const notice = (req, message) => { req.session.notice = message; };
const fail = (req, message) => { req.session.errorMessage = message; };

/** Throws away files multer already wrote, for a request being rejected. */
function discardUploads(files) {
  for (const file of files ?? []) content.removeUpload(file.filename);
}

/* ------------------------- first-run / sign-in ------------------------- */

// With no account yet every admin URL leads to setup; once one exists the
// setup page is closed off so it can never add a second owner.
router.use((req, res, next) => {
  const isSetup = req.path === '/setup';
  if (!hasAnyUser()) return isSetup ? next() : res.redirect('/admin/setup');
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
    collections: content.listCollections(),
    active: 'dashboard',
  });
});

/* ------------------------------ site text ------------------------------ */

router.get('/settings', (req, res) => {
  res.render('admin/settings', {
    title: 'Site text',
    settings: getSettings(),
    active: 'settings',
  });
});

router.post('/settings', (req, res) => {
  const values = {};
  // home_image is managed by its own upload route, not this form.
  for (const key of SETTING_KEYS) {
    if (key !== 'home_image' && Object.prototype.hasOwnProperty.call(req.body, key)) {
      values[key] = String(req.body[key] ?? '');
    }
  }
  saveSettings(values);
  notice(req, 'Site text saved.');
  res.redirect('/admin/settings');
});

router.post('/settings/home-image', (req, res) => {
  upload.single('home_image')(req, res, (err) => {
    if (req.csrfDeferred && !tokenMatches(req)) {
      discardUploads(req.file ? [req.file] : []);
      return rejectCsrf(res);
    }
    if (err) {
      discardUploads(req.file ? [req.file] : []);
      fail(req, describeUploadError(err) || 'That upload could not be accepted.');
      return res.redirect('/admin/settings');
    }
    if (!req.file) {
      fail(req, 'Choose an image to upload.');
      return res.redirect('/admin/settings');
    }
    const previous = getSettings().home_image;
    saveSettings({ home_image: req.file.filename });
    if (previous) content.removeUpload(previous);
    notice(req, 'Home page image updated.');
    return res.redirect('/admin/settings');
  });
});

router.post('/settings/home-image/delete', (req, res) => {
  const previous = getSettings().home_image;
  saveSettings({ home_image: '' });
  if (previous) content.removeUpload(previous);
  notice(req, 'Home page image removed.');
  res.redirect('/admin/settings');
});

/* ----------------------------- collections ----------------------------- */

router.get('/collections', (req, res) => {
  const collections = content.listCollections().map((c) => ({
    ...c,
    workCount: content.countWorksIn(c.id),
  }));
  res.render('admin/collections', { title: 'Collections', collections, active: 'collections' });
});

router.post('/collections', (req, res) => {
  const title = String(req.body.title ?? '').trim();
  if (!title) {
    fail(req, 'Give the collection a title.');
    return res.redirect('/admin/collections');
  }
  const info = content.addCollection({ title, kind: req.body.kind });
  notice(req, 'Collection created. Add the works, then publish it when you are ready.');
  res.redirect(`/admin/collections/${info.lastInsertRowid}`);
});

router.get('/collections/:id', (req, res) => {
  const collection = content.getCollection(Number(req.params.id));
  if (!collection) {
    fail(req, 'That collection no longer exists.');
    return res.redirect('/admin/collections');
  }
  res.render('admin/collection-edit', {
    title: collection.title || 'Untitled collection',
    collection,
    works: content.listWorks(collection.id),
    active: 'collections',
  });
});

router.post('/collections/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!content.getCollection(id)) {
    fail(req, 'That collection no longer exists.');
    return res.redirect('/admin/collections');
  }
  const title = String(req.body.title ?? '').trim();
  if (!title) {
    fail(req, 'Give the collection a title.');
    return res.redirect(`/admin/collections/${id}`);
  }
  content.updateCollection(id, {
    title,
    slug: req.body.slug,
    subtitle: req.body.subtitle,
    description: req.body.description,
    kind: req.body.kind,
    columns: req.body.columns,
    published: req.body.published === 'on',
  });
  notice(req, 'Collection saved.');
  res.redirect(`/admin/collections/${id}`);
});

router.post('/collections/:id/delete', (req, res) => {
  content.deleteCollection(Number(req.params.id))
    ? notice(req, 'Collection deleted, along with everything in it.')
    : fail(req, 'That collection no longer exists.');
  res.redirect('/admin/collections');
});

router.post('/collections/:id/move', (req, res) => {
  content.move('collections', Number(req.params.id), req.body.direction === 'up' ? 'up' : 'down');
  res.redirect('/admin/collections');
});

/* -------------------------------- works -------------------------------- */

router.post('/collections/:id/images', (req, res) => {
  const id = Number(req.params.id);
  const back = `/admin/collections/${id}`;

  upload.array('images', 20)(req, res, (err) => {
    // The multipart body only exists now, so this is where its token is checked.
    if (req.csrfDeferred && !tokenMatches(req)) {
      discardUploads(req.files);
      return rejectCsrf(res);
    }
    if (!content.getCollection(id)) {
      discardUploads(req.files);
      fail(req, 'That collection no longer exists.');
      return res.redirect('/admin/collections');
    }
    if (err) {
      discardUploads(req.files);
      fail(req, describeUploadError(err) || 'That upload could not be accepted.');
      return res.redirect(back);
    }
    const files = req.files ?? [];
    if (files.length === 0) {
      fail(req, 'Choose at least one image to upload.');
      return res.redirect(back);
    }
    for (const file of files) {
      content.addImageWork(id, { filename: file.filename, originalName: file.originalname });
    }
    notice(req, `Added ${files.length} ${files.length === 1 ? 'work' : 'works'}.`);
    return res.redirect(back);
  });
});

router.post('/collections/:id/videos', (req, res) => {
  const id = Number(req.params.id);
  const back = `/admin/collections/${id}`;
  if (!content.getCollection(id)) {
    fail(req, 'That collection no longer exists.');
    return res.redirect('/admin/collections');
  }
  const parsed = parseVideoUrl(req.body.url);
  if (!parsed.ok) {
    fail(req, parsed.error);
    return res.redirect(back);
  }
  content.addVideoWork(id, {
    url: parsed.url,
    provider: parsed.provider,
    videoId: parsed.videoId,
    title: req.body.title,
    year: req.body.year,
    medium: req.body.medium,
  });
  notice(req, 'Video added.');
  res.redirect(back);
});

router.post('/works/:id', (req, res) => {
  const work = content.getWork(Number(req.params.id));
  if (!work) {
    fail(req, 'That work no longer exists.');
    return res.redirect('/admin/collections');
  }
  const fields = {
    title: req.body.title,
    year: req.body.year,
    medium: req.body.medium,
    altText: req.body.alt_text,
  };
  if (work.kind === 'video') {
    const parsed = parseVideoUrl(req.body.url);
    if (!parsed.ok) {
      fail(req, parsed.error);
      return res.redirect(`/admin/collections/${work.collection_id}`);
    }
    Object.assign(fields, {
      url: parsed.url,
      provider: parsed.provider,
      videoId: parsed.videoId,
    });
  }
  content.updateWork(work.id, fields);
  notice(req, 'Saved.');
  res.redirect(`/admin/collections/${work.collection_id}`);
});

router.post('/works/:id/delete', (req, res) => {
  const work = content.getWork(Number(req.params.id));
  if (!work) {
    fail(req, 'That work no longer exists.');
    return res.redirect('/admin/collections');
  }
  const collectionId = work.collection_id;
  content.deleteWork(work.id);
  notice(req, 'Removed.');
  res.redirect(`/admin/collections/${collectionId}`);
});

router.post('/works/:id/move', (req, res) => {
  const work = content.getWork(Number(req.params.id));
  if (!work) {
    fail(req, 'That work no longer exists.');
    return res.redirect('/admin/collections');
  }
  content.move('works', work.id, req.body.direction === 'up' ? 'up' : 'down', work.collection_id);
  res.redirect(`/admin/collections/${work.collection_id}`);
});

/* ------------------------------ messages ------------------------------- */

router.get('/messages', (req, res) => {
  res.render('admin/messages', {
    title: 'Messages',
    messages: content.messages.list.all(),
    active: 'messages',
  });
});

router.post('/messages/:id/read', (req, res) => {
  content.messages.markRead.run(Number(req.params.id));
  res.redirect('/admin/messages');
});

router.post('/messages/:id/delete', (req, res) => {
  content.messages.remove.run(Number(req.params.id));
  notice(req, 'Message deleted.');
  res.redirect('/admin/messages');
});

/* ----------------------------- subscribers ----------------------------- */

router.get('/subscribers', (req, res) => {
  res.render('admin/subscribers', {
    title: 'Studio updates',
    subscribers: content.subscribers.list.all(),
    active: 'subscribers',
  });
});

router.get('/subscribers.csv', (req, res) => {
  const rows = content.subscribers.list.all();
  const csv = ['email,subscribed_at']
    .concat(rows.map((r) => `${r.email},${r.created_at}`))
    .join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="subscribers.csv"');
  res.send(`${csv}\n`);
});

router.post('/subscribers/:id/delete', (req, res) => {
  content.subscribers.remove.run(Number(req.params.id));
  notice(req, 'Subscriber removed.');
  res.redirect('/admin/subscribers');
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
