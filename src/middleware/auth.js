'use strict';

const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { sql } = require('../db');

function normaliseEmail(email) {
  return String(email ?? '').trim().toLowerCase();
}

async function createUser(email, password) {
  const hash = bcrypt.hashSync(password, 12);
  await sql`INSERT INTO users (email, password_hash) VALUES (${normaliseEmail(email)}, ${hash})`;
}

async function verifyLogin(email, password) {
  const rows = await sql`SELECT * FROM users WHERE email = ${normaliseEmail(email)}`;
  const user = rows[0];
  if (!user) {
    bcrypt.compareSync(String(password ?? ''), '$2a$12$' + 'x'.repeat(53));
    return null;
  }
  if (!bcrypt.compareSync(String(password ?? ''), user.password_hash)) return null;
  return user;
}

async function hasAnyUser() {
  const rows = await sql`SELECT COUNT(*) AS n FROM users`;
  return Number(rows[0].n) > 0;
}

function requireAuth(req, res, next) {
  if (req.session?.userId) return next();
  const target = req.originalUrl.startsWith('/admin') ? req.originalUrl : '/admin';
  req.session.returnTo = target;
  return res.redirect('/admin/login');
}

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
