'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const { sql, getSettings, saveSettings, SETTING_KEYS } = require('../db');
const content = require('../content');
const { parseVideoUrl } = require('../lib/video');
const { upload, parseUpload, uploadToCloud, deleteFromCloud, describeUploadError } = require('../lib/upload');
const {
  createUser, verifyLogin, hasAnyUser, requireAuth,
  csrf, tokenMatches, rejectCsrf, normaliseEmail,
} = require('../middleware/auth');

const router = express.Router();

router.use(csrf);

router.use(async (req, res, next) => {
  res.locals.notice = req.session.notice || null;
  res.locals.errorMessage = req.session.errorMessage || null;
  delete req.session.notice;
  delete req.session.errorMessage;
  res.locals.counts = await content.counts();
  next();
});

const notice = (req, message) => { req.session.notice = message; };
const fail = (req, message) => { req.session.errorMessage = message; };

/* ------------------------- first-run / sign-in ------------------------- */

router.use(async (req, res, next) => {
  const isSetup = req.path === '/setup';
  if (!(await hasAnyUser())) return isSetup ? next() : res.redirect('/admin/setup');
  if (isSetup) return res.redirect('/admin/login');
  return next();
});

router.get('/setup', (req, res) => {
  res.render('admin/setup', { title: 'Create your admin account' });
});

router.post('/setup', async (req, res) => {
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

  await createUser(email, password);
  notice(req, 'Admin account created. Sign in to start filling out the site.');
  return res.redirect('/admin/login');
});

router.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/admin');
  res.render('admin/login', { title: 'Sign in' });
});

router.post('/login', async (req, res) => {
  const user = await verifyLogin(req.body.email, req.body.password);
  if (!user) {
    fail(req, 'Those details did not match an account.');
    return res.redirect('/admin/login');
  }
  const target = req.session.returnTo || '/admin';
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

router.get('/', async (req, res) => {
  res.render('admin/dashboard', {
    title: 'Dashboard',
    settings: await getSettings(),
    collections: await content.listCollections(),
    active: 'dashboard',
  });
});

/* ------------------------------ site text ------------------------------ */

router.get('/settings', async (req, res) => {
  res.render('admin/settings', {
    title: 'Site text',
    settings: await getSettings(),
    active: 'settings',
  });
});

router.post('/settings', async (req, res) => {
  const values = {};
  for (const key of SETTING_KEYS) {
    if (key !== 'home_image' && key !== 'home_image_public_id' &&
        Object.prototype.hasOwnProperty.call(req.body, key)) {
      values[key] = String(req.body[key] ?? '');
    }
  }
  await saveSettings(values);
  notice(req, 'Site text saved.');
  res.redirect('/admin/settings');
});

router.post('/settings/home-image', async (req, res) => {
  let uploadError = null;
  try {
    await parseUpload(upload.single('home_image'))(req, res);
  } catch (err) {
    uploadError = err;
  }

  if (req.csrfDeferred && !tokenMatches(req)) return rejectCsrf(res);

  if (uploadError) {
    fail(req, describeUploadError(uploadError) || 'That upload could not be accepted.');
    return res.redirect('/admin/settings');
  }
  if (!req.file) {
    fail(req, 'Choose an image to upload.');
    return res.redirect('/admin/settings');
  }

  const result = await uploadToCloud(req.file.buffer);
  const settings = await getSettings();
  const previousPublicId = settings.home_image_public_id;
  await saveSettings({ home_image: result.secure_url, home_image_public_id: result.public_id });
  if (previousPublicId) await deleteFromCloud(previousPublicId);
  notice(req, 'Home page image updated.');
  return res.redirect('/admin/settings');
});

router.post('/settings/home-image/delete', async (req, res) => {
  const settings = await getSettings();
  const previousPublicId = settings.home_image_public_id;
  await saveSettings({ home_image: '', home_image_public_id: '' });
  if (previousPublicId) await deleteFromCloud(previousPublicId);
  notice(req, 'Home page image removed.');
  res.redirect('/admin/settings');
});

/* ----------------------------- collections ----------------------------- */

router.get('/collections', async (req, res) => {
  const collections = await content.listCollections();
  const withCounts = [];
  for (const c of collections) {
    withCounts.push({ ...c, workCount: await content.countWorksIn(c.id) });
  }
  res.render('admin/collections', { title: 'Collections', collections: withCounts, active: 'collections' });
});

router.post('/collections', async (req, res) => {
  const title = String(req.body.title ?? '').trim();
  if (!title) {
    fail(req, 'Give the collection a title.');
    return res.redirect('/admin/collections');
  }
  const id = await content.addCollection({ title, kind: req.body.kind });
  notice(req, 'Collection created. Add the works, then publish it when you are ready.');
  res.redirect(`/admin/collections/${id}`);
});

router.get('/collections/:id', async (req, res) => {
  const collection = await content.getCollection(Number(req.params.id));
  if (!collection) {
    fail(req, 'That collection no longer exists.');
    return res.redirect('/admin/collections');
  }
  res.render('admin/collection-edit', {
    title: collection.title || 'Untitled collection',
    collection,
    works: await content.listWorks(collection.id),
    active: 'collections',
  });
});

router.post('/collections/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!(await content.getCollection(id))) {
    fail(req, 'That collection no longer exists.');
    return res.redirect('/admin/collections');
  }
  const title = String(req.body.title ?? '').trim();
  if (!title) {
    fail(req, 'Give the collection a title.');
    return res.redirect(`/admin/collections/${id}`);
  }
  await content.updateCollection(id, {
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

router.post('/collections/:id/delete', async (req, res) => {
  (await content.deleteCollection(Number(req.params.id)))
    ? notice(req, 'Collection deleted, along with everything in it.')
    : fail(req, 'That collection no longer exists.');
  res.redirect('/admin/collections');
});

router.post('/collections/:id/move', async (req, res) => {
  await content.move('collections', Number(req.params.id), req.body.direction === 'up' ? 'up' : 'down');
  res.redirect('/admin/collections');
});

/* -------------------------------- works -------------------------------- */

router.post('/collections/:id/images', async (req, res) => {
  const id = Number(req.params.id);
  const back = `/admin/collections/${id}`;

  let uploadError = null;
  try {
    await parseUpload(upload.array('images', 20))(req, res);
  } catch (err) {
    uploadError = err;
  }

  if (req.csrfDeferred && !tokenMatches(req)) return rejectCsrf(res);

  if (!(await content.getCollection(id))) {
    fail(req, 'That collection no longer exists.');
    return res.redirect('/admin/collections');
  }
  if (uploadError) {
    fail(req, describeUploadError(uploadError) || 'That upload could not be accepted.');
    return res.redirect(back);
  }
  const files = req.files ?? [];
  if (files.length === 0) {
    fail(req, 'Choose at least one image to upload.');
    return res.redirect(back);
  }
  for (const file of files) {
    const result = await uploadToCloud(file.buffer);
    await content.addImageWork(id, { filename: result.public_id, url: result.secure_url });
  }
  notice(req, `Added ${files.length} ${files.length === 1 ? 'work' : 'works'}.`);
  return res.redirect(back);
});

router.post('/collections/:id/videos', async (req, res) => {
  const id = Number(req.params.id);
  const back = `/admin/collections/${id}`;
  if (!(await content.getCollection(id))) {
    fail(req, 'That collection no longer exists.');
    return res.redirect('/admin/collections');
  }
  const parsed = parseVideoUrl(req.body.url);
  if (!parsed.ok) {
    fail(req, parsed.error);
    return res.redirect(back);
  }
  await content.addVideoWork(id, {
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

router.post('/works/:id', async (req, res) => {
  const work = await content.getWork(Number(req.params.id));
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
  await content.updateWork(work.id, fields);
  notice(req, 'Saved.');
  res.redirect(`/admin/collections/${work.collection_id}`);
});

router.post('/works/:id/delete', async (req, res) => {
  const work = await content.getWork(Number(req.params.id));
  if (!work) {
    fail(req, 'That work no longer exists.');
    return res.redirect('/admin/collections');
  }
  const collectionId = work.collection_id;
  await content.deleteWork(work.id);
  notice(req, 'Removed.');
  res.redirect(`/admin/collections/${collectionId}`);
});

router.post('/works/:id/move', async (req, res) => {
  const work = await content.getWork(Number(req.params.id));
  if (!work) {
    fail(req, 'That work no longer exists.');
    return res.redirect('/admin/collections');
  }
  await content.move('works', work.id, req.body.direction === 'up' ? 'up' : 'down', work.collection_id);
  res.redirect(`/admin/collections/${work.collection_id}`);
});

/* ------------------------------ messages ------------------------------- */

router.get('/messages', async (req, res) => {
  res.render('admin/messages', {
    title: 'Messages',
    messages: await content.listMessages(),
    active: 'messages',
  });
});

router.post('/messages/:id/read', async (req, res) => {
  await content.markMessageRead(Number(req.params.id));
  res.redirect('/admin/messages');
});

router.post('/messages/:id/delete', async (req, res) => {
  await content.deleteMessage(Number(req.params.id));
  notice(req, 'Message deleted.');
  res.redirect('/admin/messages');
});

/* ----------------------------- subscribers ----------------------------- */

router.get('/subscribers', async (req, res) => {
  res.render('admin/subscribers', {
    title: 'Studio updates',
    subscribers: await content.listSubscribers(),
    active: 'subscribers',
  });
});

router.get('/subscribers.csv', async (req, res) => {
  const rows = await content.listSubscribers();
  const csv = ['email,subscribed_at']
    .concat(rows.map((r) => `${r.email},${r.created_at}`))
    .join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="subscribers.csv"');
  res.send(`${csv}\n`);
});

router.post('/subscribers/:id/delete', async (req, res) => {
  await content.deleteSubscriber(Number(req.params.id));
  notice(req, 'Subscriber removed.');
  res.redirect('/admin/subscribers');
});

/* ------------------------------- account ------------------------------- */

router.get('/account', (req, res) => {
  res.render('admin/account', { title: 'Your account', active: 'account' });
});

router.post('/account/password', async (req, res) => {
  const current = String(req.body.current_password ?? '');
  const next = String(req.body.new_password ?? '');
  const confirm = String(req.body.confirm_password ?? '');

  const rows = await sql`SELECT * FROM users WHERE id = ${req.session.userId}`;
  const user = rows[0];
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
  const hash = bcrypt.hashSync(next, 12);
  await sql`UPDATE users SET password_hash = ${hash} WHERE id = ${user.id}`;
  notice(req, 'Password updated.');
  res.redirect('/admin/account');
});

module.exports = router;
