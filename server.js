'use strict';

require('dotenv').config();

const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const session = require('express-session');

const { db, getSettings, UPLOAD_DIR } = require('./src/db');
const createStore = require('./src/lib/session-store');
const content = require('./src/content');
const publicRoutes = require('./src/routes/public');
const adminRoutes = require('./src/routes/admin');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const IN_PRODUCTION = process.env.NODE_ENV === 'production';

// Hosting platforms terminate TLS in front of the app; trusting the proxy lets
// secure cookies and req.protocol work behind it.
app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.disable('x-powered-by');

let sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  if (IN_PRODUCTION) {
    console.error(
      'SESSION_SECRET must be set in production, otherwise every restart signs ' +
        'everyone out. Generate one with:\n' +
        "  node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
    process.exit(1);
  }
  sessionSecret = crypto.randomBytes(32).toString('hex');
  console.warn('No SESSION_SECRET set — using a temporary one for this run.');
}

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  next();
});

app.use(express.urlencoded({ extended: false, limit: '1mb' }));

app.use(
  session({
    name: 'sid',
    store: createStore(db),
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: IN_PRODUCTION,
      maxAge: 14 * 24 * 60 * 60 * 1000,
    },
  })
);

app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d', index: false }));

// Shared template data: the site's own text, nav and links, on every render.
app.use((req, res, next) => {
  const settings = getSettings();
  res.locals.settings = settings;
  res.locals.siteTitle = settings.site_title || 'Untitled site';
  res.locals.siteTitleIsPlaceholder = !settings.site_title;
  res.locals.navCollections = content.listPublishedCollections();
  res.locals.currentYear = new Date().getFullYear();
  res.locals.path = req.path;
  res.locals.active = '';
  res.locals.pageTitle = '';
  res.locals.notice = null;
  res.locals.errorMessage = null;
  res.locals.currentUser = null;
  next();
});

app.use('/admin', adminRoutes);
app.use('/', publicRoutes);

app.use((req, res) => {
  res.status(404).render('public/404', { pageTitle: 'Page not found' });
});

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  const isAdmin = req.path.startsWith('/admin');
  res.status(500);
  return isAdmin
    ? res.render('admin/error', {
        title: 'Something went wrong',
        message: 'The admin panel hit an unexpected error. Try again.',
      })
    : res.render('public/500', { pageTitle: 'Something went wrong' });
});

if (require.main === module) {
  const server = app.listen(PORT, () => {
    console.log(`Site running at http://localhost:${PORT}`);
    console.log(`Admin panel at  http://localhost:${PORT}/admin`);
  });
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, () => server.close(() => process.exit(0)));
  }
}

module.exports = app;
