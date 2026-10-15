'use strict';

const express = require('express');
const content = require('../content');

const router = express.Router();

router.get('/', (req, res) => {
  res.render('public/home', {
    pageTitle: '',
    photos: content.listPhotos().slice(0, 6),
    videos: content.listVideos().slice(0, 3),
    active: 'home',
  });
});

router.get('/gallery', (req, res) => {
  res.render('public/gallery', {
    pageTitle: 'Gallery',
    photos: content.listPhotos(),
    active: 'gallery',
  });
});

router.get('/videos', (req, res) => {
  res.render('public/videos', {
    pageTitle: 'Videos',
    videos: content.listVideos(),
    active: 'videos',
  });
});

router.get('/about', (req, res) => {
  res.render('public/about', { pageTitle: 'About', active: 'about' });
});

router.get('/contact', (req, res) => {
  res.render('public/contact', { pageTitle: 'Contact', active: 'contact' });
});

router.get('/p/:slug', (req, res, next) => {
  const page = content.getPageBySlug(String(req.params.slug));
  if (!page || !page.published) return next();
  res.render('public/page', { pageTitle: page.title, page, active: `page-${page.slug}` });
});

module.exports = router;
