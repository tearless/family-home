const fs = require('fs');
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

function getDbBucket() {
  return process.env.SUPABASE_DB_BUCKET || 'family-home-state';
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

function getPublicUrl({ bucket, objectPath }) {
  const sb = getSupabaseClient();
  if (!sb) throw new Error('Supabase is not configured.');

  const { data } = sb.storage.from(bucket).getPublicUrl(objectPath);
  return data ? data.publicUrl : '';
}

async function downloadObjectToFile({ bucket, objectPath, destination }) {
  const sb = getSupabaseClient();
  if (!sb) return false;

  const { data, error } = await sb.storage.from(bucket).download(objectPath);
  if (error || !data) return false;

  const bytes = Buffer.from(await data.arrayBuffer());
  fs.writeFileSync(destination, bytes);
  return true;
}

async function uploadFileToObject({ bucket, objectPath, sourcePath }) {
  const bytes = fs.readFileSync(sourcePath);
  await uploadBuffer({
    bucket,
    objectPath,
    buffer: bytes,
    contentType: 'application/octet-stream'
  });
}

module.exports = {
  getSupabaseClient,
  isSupabaseEnabled,
  getUploadBucket,
  getDbBucket,
  uploadBuffer,
  getPublicUrl,
  downloadObjectToFile,
  uploadFileToObject
};
