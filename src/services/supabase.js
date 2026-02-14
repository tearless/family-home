const { createClient } = require('@supabase/supabase-js');

let client = undefined;

function getSupabaseClient() {
  if (client !== undefined) return client;

  const url = process.env.SUPABASE_URL || '';
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !serviceRoleKey) {
    client = null;
    return client;
  }

  client = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  return client;
}

function isSupabaseEnabled() {
  return Boolean(getSupabaseClient());
}

function getUploadBucket() {
  return process.env.SUPABASE_UPLOAD_BUCKET || 'family-home-media';
}

function getSignedUrlTtlSeconds() {
  const raw = Number(process.env.SUPABASE_SIGNED_URL_EXPIRES_IN || 60 * 60 * 24 * 3);
  if (!Number.isFinite(raw) || raw <= 0) return 60 * 60 * 24 * 3;
  return Math.floor(raw);
}

async function uploadBuffer({ bucket, objectPath, buffer, contentType }) {
  const sb = getSupabaseClient();
  if (!sb) throw new Error('Supabase is not configured.');

  const { error } = await sb.storage.from(bucket).upload(objectPath, buffer, {
    contentType: contentType || 'application/octet-stream',
    upsert: true
  });
  if (error) throw new Error(error.message || 'Supabase upload failed.');
}

async function createSignedUrl({ bucket, objectPath, expiresIn }) {
  const sb = getSupabaseClient();
  if (!sb) throw new Error('Supabase is not configured.');

  const ttl = Number(expiresIn) > 0 ? Math.floor(Number(expiresIn)) : getSignedUrlTtlSeconds();
  const { data, error } = await sb.storage.from(bucket).createSignedUrl(objectPath, ttl);
  if (error) throw new Error(error.message || 'Failed to create signed URL.');
  return data ? data.signedUrl : '';
}

module.exports = {
  getSupabaseClient,
  isSupabaseEnabled,
  getUploadBucket,
  getSignedUrlTtlSeconds,
  uploadBuffer,
  createSignedUrl
};
