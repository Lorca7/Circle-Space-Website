'use strict';

const express = require('express');
const content = require('../content');

const router = express.Router();

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

router.get('/', (req, res) => {
  res.render('public/home', { pageTitle: '', active: 'home' });
});

router.get('/about', (req, res) => {
  res.render('public/about', { pageTitle: 'About', active: 'about' });
});

router.get('/c/:slug', (req, res, next) => {
  const collection = content.getCollectionBySlug(String(req.params.slug));
  if (!collection || !collection.published) return next();
  res.render('public/collection', {
    pageTitle: collection.title,
    collection,
    works: content.listWorks(collection.id),
    active: `collection-${collection.id}`,
  });
});

router.get('/contact', (req, res) => {
  res.render('public/contact', {
    pageTitle: 'Contact',
    active: 'contact',
    form: {},
    sent: req.query.sent === '1',
    subscribed: req.query.subscribed === '1',
    formError: null,
    signupError: null,
  });
});

router.post('/contact', (req, res) => {
  const form = {
    name: String(req.body.name ?? '').trim().slice(0, 200),
    email: String(req.body.email ?? '').trim().slice(0, 200),
    subject: String(req.body.subject ?? '').trim().slice(0, 300),
    body: String(req.body.message ?? '').trim().slice(0, 5000),
  };

  // Hidden field that people never see; anything filling it in is a bot.
  if (String(req.body.website ?? '').trim() !== '') {
    return res.redirect('/contact?sent=1');
  }

  let formError = null;
  if (!form.name) formError = 'Please add your name.';
  else if (!EMAIL_RE.test(form.email)) formError = 'Please add a valid email address.';
  else if (!form.body) formError = 'Please write a message.';

  if (formError) {
    return res.status(400).render('public/contact', {
      pageTitle: 'Contact',
      active: 'contact',
      form,
      sent: false,
      subscribed: false,
      formError,
      signupError: null,
    });
  }

  content.messages.add.run(form);
  return res.redirect('/contact?sent=1#contact-form');
});

router.post('/subscribe', (req, res) => {
  const email = String(req.body.email ?? '').trim().toLowerCase().slice(0, 200);

  if (String(req.body.website ?? '').trim() !== '') {
    return res.redirect('/contact?subscribed=1');
  }

  if (!EMAIL_RE.test(email)) {
    return res.status(400).render('public/contact', {
      pageTitle: 'Contact',
      active: 'contact',
      form: {},
      sent: false,
      subscribed: false,
      formError: null,
      signupError: 'Please enter a valid email address.',
    });
  }

  content.subscribers.add.run(email);
  return res.redirect('/contact?subscribed=1#studio-updates');
});

module.exports = router;
