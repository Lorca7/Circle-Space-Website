'use strict';

const path = require('node:path');
const crypto = require('node:crypto');
const multer = require('multer');
const { UPLOAD_DIR } = require('../db');

const ALLOWED = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['image/gif', '.gif'],
  ['image/avif', '.avif'],
]);

const MAX_BYTES = Number(process.env.MAX_UPLOAD_MB || 15) * 1024 * 1024;

const storage = multer.diskStorage({
  destination(req, file, done) {
    done(null, UPLOAD_DIR);
  },
  // Never trust the client filename: generate our own and take the extension
  // from the vetted MIME type, so nothing can escape the upload directory.
  filename(req, file, done) {
    const ext = ALLOWED.get(file.mimetype) || '.bin';
    done(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_BYTES, files: 20 },
  fileFilter(req, file, done) {
    if (!ALLOWED.has(file.mimetype)) {
      return done(new multer.MulterError('LIMIT_UNEXPECTED_FILE', file.fieldname));
    }
    return done(null, true);
  },
});

function describeUploadError(err) {
  if (!(err instanceof multer.MulterError)) return null;
  if (err.code === 'LIMIT_FILE_SIZE') {
    return `That image is too large. The limit is ${Math.round(MAX_BYTES / (1024 * 1024))} MB.`;
  }
  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    return 'Only JPG, PNG, WebP, GIF and AVIF images can be uploaded.';
  }
  return 'That upload could not be accepted.';
}

module.exports = { upload, describeUploadError, MAX_BYTES, UPLOAD_DIR, safeExt: path.extname };
