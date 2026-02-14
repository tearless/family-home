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

module.exports = {
  getSupabaseClient,
  isSupabaseEnabled,
  getUploadBucket,
  uploadBuffer,
  getPublicUrl
};
