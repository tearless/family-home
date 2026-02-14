const path = require('path');
const {
  isSupabaseEnabled,
  getUploadBucket,
  uploadBuffer,
  createSignedUrl
} = require('./supabase');

const STORAGE_REF_PREFIX = 'sb://';
const signedUrlCacheMs = Number(process.env.MEDIA_SIGNED_URL_CACHE_MS || 120000);
const signedUrlCache = new Map();
const signedUrlInFlight = new Map();
const signedUrlCacheMax = Number(process.env.MEDIA_SIGNED_URL_CACHE_MAX || 1000);

function safeExtname(file) {
  const ext = path.extname(file.originalname || '').toLowerCase() || '.jpg';
  if (['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext)) return ext;
  return '.jpg';
}

function isStorageRef(value) {
  return String(value || '').startsWith(STORAGE_REF_PREFIX);
}

function createStorageRef({ bucket, objectPath }) {
  return `${STORAGE_REF_PREFIX}${bucket}/${objectPath}`;
}

function parseStorageRef(value) {
  const raw = String(value || '').trim();
  if (!isStorageRef(raw)) return null;
  const payload = raw.slice(STORAGE_REF_PREFIX.length);
  const firstSlash = payload.indexOf('/');
  if (firstSlash <= 0) return null;
  const bucket = payload.slice(0, firstSlash);
  const objectPath = payload.slice(firstSlash + 1);
  if (!bucket || !objectPath) return null;
  return { bucket, objectPath };
}

function readAttr(tag, attrName) {
  const attrRegex = new RegExp(`\\b${attrName}=(["'])(.*?)\\1`, 'i');
  const match = tag.match(attrRegex);
  return match ? match[2] : '';
}

function setAttr(tag, attrName, value) {
  const escaped = String(value || '').replace(/"/g, '&quot;');
  const attrRegex = new RegExp(`\\b${attrName}=(["'])(.*?)\\1`, 'i');
  if (attrRegex.test(tag)) {
    return tag.replace(attrRegex, `${attrName}="${escaped}"`);
  }
  return tag.replace(/\/?>$/, ` ${attrName}="${escaped}"$&`);
}

function removeAttr(tag, attrName) {
  const attrRegex = new RegExp(`\\s${attrName}=(["'])(.*?)\\1`, 'i');
  return tag.replace(attrRegex, '');
}

async function transformImageTags(html, transformTag) {
  const source = String(html || '');
  if (!source || source.indexOf('<img') === -1) return source;

  const regex = /<img\b[^>]*>/gi;
  let cursor = 0;
  let output = '';
  let match = regex.exec(source);

  while (match) {
    output += source.slice(cursor, match.index);
    // eslint-disable-next-line no-await-in-loop
    output += await transformTag(match[0]);
    cursor = regex.lastIndex;
    match = regex.exec(source);
  }

  output += source.slice(cursor);
  return output;
}

async function resolveImageUrl(input, options = {}) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  const parsed = parseStorageRef(raw);
  if (!parsed) return raw;

  const expiresIn = Number(options.expiresIn) > 0 ? Math.floor(Number(options.expiresIn)) : undefined;
  const cacheKey = `${raw}|${expiresIn || ''}`;
  const now = Date.now();
  const cached = signedUrlCache.get(cacheKey);
  if (cached && cached.expiresAt > now && cached.url) {
    return cached.url;
  }

  const inFlight = signedUrlInFlight.get(cacheKey);
  if (inFlight) {
    return inFlight;
  }

  const task = (async () => {
    try {
      const url = await createSignedUrl({
        bucket: parsed.bucket,
        objectPath: parsed.objectPath,
        expiresIn
      });

      if (url && signedUrlCacheMs > 0) {
        signedUrlCache.set(cacheKey, {
          url,
          expiresAt: now + signedUrlCacheMs
        });

        if (signedUrlCache.size > signedUrlCacheMax) {
          const oldestKey = signedUrlCache.keys().next().value;
          if (oldestKey) signedUrlCache.delete(oldestKey);
        }
      }
      return url;
    } catch (_) {
      return '';
    } finally {
      signedUrlInFlight.delete(cacheKey);
    }
  })();

  signedUrlInFlight.set(cacheKey, task);

  try {
    return await task;
  } catch (_) {
    return '';
  }
}

async function resolveHtmlImageSources(html, options = {}) {
  const withDataRef = Boolean(options.withDataRef);
  return transformImageTags(html, async (tag) => {
    const srcAttr = readAttr(tag, 'src');
    const mediaRef = readAttr(tag, 'data-media-ref');
    const ref = mediaRef || srcAttr;
    if (!isStorageRef(ref)) return tag;

    const signedUrl = await resolveImageUrl(ref, options);
    if (!signedUrl) return tag;

    let nextTag = setAttr(tag, 'src', signedUrl);
    if (withDataRef) {
      nextTag = setAttr(nextTag, 'data-media-ref', ref);
    }
    return nextTag;
  });
}

function normalizeHtmlForStorage(html) {
  const source = String(html || '');
  if (!source || source.indexOf('<img') === -1) return source;

  return source.replace(/<img\b[^>]*>/gi, (tag) => {
    const mediaRef = readAttr(tag, 'data-media-ref');
    if (!isStorageRef(mediaRef)) return removeAttr(tag, 'data-media-ref');
    const withRef = setAttr(tag, 'src', mediaRef);
    return removeAttr(withRef, 'data-media-ref');
  });
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
    const ref = createStorageRef({ bucket, objectPath });
    const url = await resolveImageUrl(ref);
    if (!url) throw new Error('Failed to create signed URL for uploaded image.');
    return { ref, url };
  }

  if (file.filename) {
    const url = `/uploads/${cleanFolder}/${file.filename}`;
    return { ref: url, url };
  }

  throw new Error('Unable to resolve uploaded image URL.');
}

module.exports = {
  isStorageRef,
  parseStorageRef,
  resolveImageUrl,
  resolveHtmlImageSources,
  normalizeHtmlForStorage,
  uploadImageFile
};
