'use strict';

const multer = require('multer');
const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const ALLOWED = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['image/gif', '.gif'],
  ['image/avif', '.avif'],
]);

const MAX_BYTES = Number(process.env.MAX_UPLOAD_MB || 15) * 1024 * 1024;

const storage = multer.memoryStorage();

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

function parseUpload(middleware) {
  return (req, res) =>
    new Promise((resolve, reject) => {
      middleware(req, res, (err) => (err ? reject(err) : resolve()));
    });
}

async function uploadToCloud(buffer, options = {}) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: 'circle-space', ...options },
      (err, result) => (err ? reject(err) : resolve(result))
    );
    stream.end(buffer);
  });
}

async function deleteFromCloud(publicId) {
  if (!publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId);
  } catch {
    // best-effort deletion
  }
}

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

module.exports = { upload, parseUpload, uploadToCloud, deleteFromCloud, describeUploadError, MAX_BYTES };
