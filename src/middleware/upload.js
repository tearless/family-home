const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { isFirebaseEnabled } = require('../services/firebase');

const isVercel = process.env.VERCEL === '1';
const uploadBaseDir = isVercel
  ? path.join('/tmp', 'family-home-uploads')
  : path.join(__dirname, '..', '..', 'public', 'uploads');
const useMemoryStorage = isFirebaseEnabled();

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function makeStorage(subdir) {
  if (useMemoryStorage) {
    return multer.memoryStorage();
  }

  const targetDir = path.join(uploadBaseDir, subdir);
  ensureDir(targetDir);

  return multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, targetDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase() || '.jpg';
      const safeExt = ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext) ? ext : '.jpg';
      const name = `${Date.now()}-${Math.round(Math.random() * 1e8)}${safeExt}`;
      cb(null, name);
    }
  });
}

function imageFilter(_req, file, cb) {
  if (!file.mimetype || !file.mimetype.startsWith('image/')) {
    cb(new Error('Only image uploads are allowed.'));
    return;
  }
  cb(null, true);
}

const photoUpload = multer({
  storage: makeStorage('photos'),
  fileFilter: imageFilter,
  limits: { fileSize: 8 * 1024 * 1024 }
});

const blogUpload = multer({
  storage: makeStorage('blog'),
  fileFilter: imageFilter,
  limits: { fileSize: 8 * 1024 * 1024 }
});

const profileUpload = multer({
  storage: makeStorage('profiles'),
  fileFilter: imageFilter,
  limits: { fileSize: 8 * 1024 * 1024 }
});

const landingUpload = multer({
  storage: makeStorage('landing'),
  fileFilter: imageFilter,
  limits: { fileSize: 8 * 1024 * 1024 }
});

module.exports = { photoUpload, blogUpload, profileUpload, landingUpload };
