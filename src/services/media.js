const path = require('path');
const { getStorageBucket, isFirebaseEnabled } = require('./firebase');

function safeExtname(file) {
  const ext = path.extname(file.originalname || '').toLowerCase() || '.jpg';
  if (['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext)) return ext;
  return '.jpg';
}

async function uploadImageFile({ file, folder }) {
  if (!file) throw new Error('No file uploaded.');
  const cleanFolder = String(folder || '').replace(/[^a-z0-9/_-]/gi, '') || 'misc';

  if (isFirebaseEnabled() && file.buffer) {
    const bucket = getStorageBucket();
    if (!bucket) throw new Error('Firebase Storage is not configured.');

    const ext = safeExtname(file);
    const filename = `${Date.now()}-${Math.round(Math.random() * 1e8)}${ext}`;
    const objectPath = `uploads/${cleanFolder}/${filename}`;
    const gcsFile = bucket.file(objectPath);

    await gcsFile.save(file.buffer, {
      contentType: file.mimetype || 'application/octet-stream',
      resumable: false,
      metadata: {
        cacheControl: 'public, max-age=31536000'
      }
    });

    try {
      await gcsFile.makePublic();
    } catch (_) {
      // Bucket may use uniform bucket-level access; URL can still work if bucket is public.
    }

    return `https://storage.googleapis.com/${bucket.name}/${objectPath}`;
  }

  if (file.filename) {
    return `/uploads/${cleanFolder}/${file.filename}`;
  }

  throw new Error('Unable to resolve uploaded image URL.');
}

module.exports = { uploadImageFile };
