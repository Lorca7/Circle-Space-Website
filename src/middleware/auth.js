'use strict';

const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { db } = require('../db');

const findUserByEmail = db.prepare('SELECT * FROM users WHERE email = ?');
const countUsers = db.prepare('SELECT COUNT(*) AS n FROM users');
const insertUser = db.prepare(
  'INSERT INTO users (email, password_hash) VALUES (?, ?)'
);

function normaliseEmail(email) {
  return String(email ?? '').trim().toLowerCase();
}

function createUser(email, password) {
  const hash = bcrypt.hashSync(password, 12);
  return insertUser.run(normaliseEmail(email), hash);
}

function verifyLogin(email, password) {
  const user = findUserByEmail.get(normaliseEmail(email));
  if (!user) {
    // Spend comparable time on a missing user so timing does not reveal
    // whether the address exists.
    bcrypt.compareSync(String(password ?? ''), '$2a$12$' + 'x'.repeat(53));
    return null;
  }
  if (!bcrypt.compareSync(String(password ?? ''), user.password_hash)) return null;
  return user;
}

function hasAnyUser() {
  return countUsers.get().n > 0;
}

function requireAuth(req, res, next) {
  if (req.session?.userId) return next();
  const target = req.originalUrl.startsWith('/admin') ? req.originalUrl : '/admin';
  req.session.returnTo = target;
  return res.redirect('/admin/login');
}

/** Compares the token on the request against the one held in the session. */
function tokenMatches(req) {
  const sent = String(req.body?._csrf ?? req.get('x-csrf-token') ?? '');
  const expected = String(req.session?.csrfToken ?? '');
  if (!expected) return false;
  const a = Buffer.from(sent);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function rejectCsrf(res) {
  return res.status(403).render('admin/error', {
    title: 'Session expired',
    message:
      'This form could not be submitted because your session expired. ' +
      'Go back, reload the page and try again.',
  });
}

/**
 * Synchroniser-token CSRF guard for the admin forms.
 *
 * Multipart uploads are the exception: their body is parsed by multer inside
 * the route, so no token is visible this early. Those requests are flagged and
 * the route checks the token itself once the body has been read.
 */
function csrf(req, res, next) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  res.locals.csrfToken = req.session.csrfToken;

  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

  if (req.is('multipart/form-data')) {
    req.csrfDeferred = true;
    return next();
  }

  return tokenMatches(req) ? next() : rejectCsrf(res);
}

module.exports = {
  createUser, verifyLogin, hasAnyUser, requireAuth,
  csrf, tokenMatches, rejectCsrf, normaliseEmail,
};
