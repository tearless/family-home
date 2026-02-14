const path = require('path');
const {
  isSupabaseEnabled,
  getUploadBucket,
  uploadBuffer,
  getPublicUrl
} = require('./supabase');

function safeExtname(file) {
  const ext = path.extname(file.originalname || '').toLowerCase() || '.jpg';
  if (['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext)) return ext;
  return '.jpg';
}

async function uploadImageFile({ file, folder }) {
  if (!file) throw new Error('No file uploaded.');
  const cleanFolder = String(folder || '').replace(/[^a-z0-9/_-]/gi, '') || 'misc';

  if (isSupabaseEnabled() && file.buffer) {
    const ext = safeExtname(file);
    const filename = `${Date.now()}-${Math.round(Math.random() * 1e8)}${ext}`;
    const objectPath = `uploads/${cleanFolder}/${filename}`;
    const bucket = getUploadBucket();

    await uploadBuffer({
      bucket,
      objectPath,
      buffer: file.buffer,
      contentType: file.mimetype || 'application/octet-stream'
    });
    return getPublicUrl({ bucket, objectPath });
  }

  if (file.filename) {
    return `/uploads/${cleanFolder}/${file.filename}`;
  }

  throw new Error('Unable to resolve uploaded image URL.');
}

module.exports = { uploadImageFile };
