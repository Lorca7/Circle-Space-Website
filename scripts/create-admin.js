#!/usr/bin/env node
'use strict';

/**
 * Creates or resets the admin account from the command line.
 * Useful on a host where you cannot reach the one-time /admin/setup page,
 * or if the password is lost.
 *
 *   node scripts/create-admin.js you@example.com 'a-long-password'
 */

require('dotenv').config();

const bcrypt = require('bcryptjs');
const { db } = require('../src/db');

const [email, password] = process.argv.slice(2);

if (!email || !password) {
  console.error("Usage: node scripts/create-admin.js <email> '<password>'");
  process.exit(1);
}
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error('That does not look like a valid email address.');
  process.exit(1);
}
if (password.length < 10) {
  console.error('Use a password of at least 10 characters.');
  process.exit(1);
}

const normalised = email.trim().toLowerCase();
const hash = bcrypt.hashSync(password, 12);
const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(normalised);

if (existing) {
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, existing.id);
  console.log(`Password reset for ${normalised}.`);
} else {
  db.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)').run(normalised, hash);
  console.log(`Admin account created for ${normalised}.`);
}

// Signing out everywhere makes a password reset actually take effect.
db.prepare('DELETE FROM sessions').run();
console.log('All existing sign-ins have been cleared.');
