const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const { slugify } = require('./services/text');

const connectionString = process.env.SUPABASE_DB_URL || process.env.POSTGRES_URL || '';
const sslEnabled = String(process.env.SUPABASE_DB_SSL || 'true').toLowerCase() !== 'false';
const sslMode = String(process.env.DB_SSL_MODE || 'no-verify').trim().toLowerCase();
const connectionTimeoutMillis = Number(process.env.DB_CONNECTION_TIMEOUT_MS || 8000);
const statementTimeout = Number(process.env.DB_STATEMENT_TIMEOUT_MS || 12000);
const queryTimeout = Number(process.env.DB_QUERY_TIMEOUT_MS || 12000);

function withSslMode(url, mode) {
  const raw = String(url || '').trim();
  if (!raw || !mode) return raw;
  if (/[?&]sslmode=/i.test(raw)) {
    return raw.replace(/([?&]sslmode=)[^&]*/i, `$1${encodeURIComponent(mode)}`);
  }
  const separator = raw.includes('?') ? '&' : '?';
  return `${raw}${separator}sslmode=${encodeURIComponent(mode)}`;
}

function buildPoolConfig() {
  if (!connectionString) return null;
  const preparedConnectionString = sslEnabled
    ? withSslMode(connectionString, sslMode || 'no-verify')
    : connectionString;

  return {
    connectionString: preparedConnectionString,
    ssl: sslEnabled
      ? {
          rejectUnauthorized: false,
          requestCert: false
        }
      : false,
    connectionTimeoutMillis: Number.isFinite(connectionTimeoutMillis) ? connectionTimeoutMillis : 8000,
    statement_timeout: Number.isFinite(statementTimeout) ? statementTimeout : 12000,
    query_timeout: Number.isFinite(queryTimeout) ? queryTimeout : 12000
  };
}

const pool = connectionString
  ? new Pool(buildPoolConfig())
  : null;

let initPromise = null;

function normalizeParams(params) {
  if (params.length === 1 && Array.isArray(params[0])) return params[0];
  return params;
}

function normalizeSql(sql) {
  let text = String(sql || '').trim();
  text = text.replace(/datetime\('now'\)/gi, 'CURRENT_TIMESTAMP');
  text = text.replace(/datetime\(([^)]+)\)/gi, '($1)::timestamp');

  let index = 0;
  text = text.replace(/\?/g, () => {
    index += 1;
    return `$${index}`;
  });
  return text;
}

async function query(sql, params = []) {
  if (!pool) {
    throw new Error('SUPABASE_DB_URL is not configured.');
  }
  const text = normalizeSql(sql);
  return pool.query(text, params);
}

const db = {
  async all(sql, ...rawParams) {
    const params = normalizeParams(rawParams);
    const result = await query(sql, params);
    return result.rows;
  },

  async get(sql, ...rawParams) {
    const params = normalizeParams(rawParams);
    const result = await query(sql, params);
    return result.rows[0];
  },

  async run(sql, ...rawParams) {
    const params = normalizeParams(rawParams);
    const result = await query(sql, params);
    const first = result.rows && result.rows[0] ? result.rows[0] : {};
    return {
      changes: result.rowCount || 0,
      lastInsertRowid: first.id || first.inserted_id || null,
      rows: result.rows || []
    };
  },

  async query(sql, ...rawParams) {
    const params = normalizeParams(rawParams);
    return query(sql, params);
  }
};

async function getOrCreateCategory(name) {
  const cleanName = (name || '').trim() || 'Everyday';
  const existing = await db.get('SELECT * FROM photo_categories WHERE name = ?', cleanName);
  if (existing) return existing;

  const baseSlug = slugify(cleanName) || 'everyday';
  let slug = baseSlug;
  let index = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const slugRow = await db.get('SELECT id FROM photo_categories WHERE slug = ?', slug);
    if (!slugRow) break;
    slug = `${baseSlug}-${index}`;
    index += 1;
  }

  const inserted = await db.get(
    `INSERT INTO photo_categories (name, slug)
     VALUES (?, ?)
     RETURNING *`,
    cleanName,
    slug
  );
  return inserted;
}

async function migrate() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS family_users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      profile_image TEXT,
      profile_bio TEXT,
      role TEXT NOT NULL DEFAULT 'family'
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS member_requests (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      approved_at TIMESTAMPTZ,
      approved_by TEXT
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS member_accounts (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      is_approved INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      approved_at TIMESTAMPTZ
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS member_login_codes (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      code TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS projects (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      owner TEXT NOT NULL,
      summary TEXT NOT NULL,
      content TEXT NOT NULL,
      published INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS photo_categories (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      slug TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS album_photos (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      caption TEXT,
      image_url TEXT NOT NULL,
      category_id INTEGER REFERENCES photo_categories(id),
      created_by TEXT NOT NULL DEFAULT 'system',
      highlight_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS blog_posts (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      author TEXT NOT NULL,
      summary TEXT NOT NULL,
      content TEXT NOT NULL,
      content_format TEXT NOT NULL DEFAULT 'markdown',
      cover_image TEXT,
      published INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS api_settings (
      setting_key TEXT PRIMARY KEY,
      setting_value TEXT NOT NULL DEFAULT ''
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS album_comments (
      id SERIAL PRIMARY KEY,
      photo_id INTEGER NOT NULL REFERENCES album_photos(id),
      parent_comment_id INTEGER REFERENCES album_comments(id),
      member_email TEXT NOT NULL,
      display_name TEXT NOT NULL,
      content TEXT NOT NULL,
      content_type TEXT NOT NULL DEFAULT 'text',
      filtered INTEGER NOT NULL DEFAULT 0,
      deleted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS emoji_reactions (
      id SERIAL PRIMARY KEY,
      photo_id INTEGER NOT NULL REFERENCES album_photos(id),
      member_email TEXT NOT NULL,
      emoji TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS comment_delete_tokens (
      id SERIAL PRIMARY KEY,
      comment_id INTEGER NOT NULL REFERENCES album_comments(id),
      token TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS comment_reactions (
      id SERIAL PRIMARY KEY,
      comment_id INTEGER NOT NULL REFERENCES album_comments(id),
      member_email TEXT NOT NULL,
      emoji TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await db.query('CREATE INDEX IF NOT EXISTS idx_album_comments_photo_parent ON album_comments(photo_id, parent_comment_id, id)');
  await db.query('CREATE INDEX IF NOT EXISTS idx_comment_reactions_comment ON comment_reactions(comment_id, emoji)');
}

async function seedFamilyUsers() {
  const users = ['Anton', 'Olivia', 'Eliana'];
  for (const name of users) {
    const hash = bcrypt.hashSync('0000', 10);
    await db.run(
      `INSERT INTO family_users (name, password_hash, role)
       VALUES (?, ?, ?)
       ON CONFLICT(name) DO NOTHING`,
      name,
      hash,
      'family'
    );
  }
}

async function backfillFamilyBios() {
  const defaults = [
    ['Anton', '기획과 구현을 담당하는 패밀리 메이커.'],
    ['Olivia', '감성과 색감을 채우는 크리에이터.'],
    ['Eliana', '작은 일상을 특별하게 만드는 주인공.']
  ];
  for (const [name, bio] of defaults) {
    await db.run(
      `UPDATE family_users
       SET profile_bio = ?
       WHERE name = ? AND (profile_bio IS NULL OR trim(profile_bio) = '')`,
      bio,
      name
    );
  }
}

async function seedCategories() {
  const names = ['Everyday', 'Travel', 'Celebration', 'Food', 'Outdoor'];
  for (const name of names) {
    await getOrCreateCategory(name);
  }
}

async function seedPhotos() {
  const row = await db.get('SELECT COUNT(*)::int AS c FROM album_photos');
  if (row && row.c > 0) return;

  const travel = await getOrCreateCategory('Travel');
  const food = await getOrCreateCategory('Food');
  const outdoor = await getOrCreateCategory('Outdoor');

  const photos = [
    [
      'Summer Picnic',
      'Laughter, fruits, and sunshine all afternoon.',
      'https://images.unsplash.com/photo-1473116763249-2faaef81ccda?auto=format&fit=crop&w=1200&q=80',
      outdoor.id,
      'system',
      1
    ],
    [
      'Home Baking Day',
      'Flour everywhere and warm cookies for everyone.',
      'https://images.unsplash.com/photo-1499636136210-6f4ee915583e?auto=format&fit=crop&w=1200&q=80',
      food.id,
      'system',
      2
    ],
    [
      'Beach Walk',
      'Windy walk with bright skies and tiny footprints.',
      'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1200&q=80',
      travel.id,
      'system',
      3
    ]
  ];

  for (const p of photos) {
    await db.run(
      `INSERT INTO album_photos (title, caption, image_url, category_id, created_by, highlight_order)
       VALUES (?, ?, ?, ?, ?, ?)`,
      p
    );
  }
}

async function backfillPhotoCategory() {
  const defaultCategory = await getOrCreateCategory('Everyday');
  await db.run('UPDATE album_photos SET category_id = ? WHERE category_id IS NULL', defaultCategory.id);
  await db.run("UPDATE album_photos SET created_by = 'system' WHERE created_by IS NULL OR created_by = ''");
}

async function seedBlogs() {
  const row = await db.get('SELECT COUNT(*)::int AS c FROM blog_posts');
  if (row && row.c > 0) return;

  const rows = [
    {
      title: 'Blue Morning at Home',
      slug: 'blue-morning-at-home',
      author: 'Anton',
      summary: 'A short note about cozy routines and calm starts.',
      content:
        '## Today\nWe started with simple breakfast and music.\n\n## Small Wins\n- Shared reading time\n- A quick family walk\n- New drawing on the fridge',
      content_format: 'markdown',
      cover_image:
        'https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=1200&q=80'
    },
    {
      title: 'Olivia Color Diary',
      slug: 'olivia-color-diary',
      author: 'Olivia',
      summary: 'Palette ideas inspired by sky, ocean, and afternoon light.',
      content:
        '## Palette\nSoft blue, silver gray, and warm cream.\n\n## Notes\nThese tones feel calm and bright at the same time.',
      content_format: 'markdown',
      cover_image:
        'https://images.unsplash.com/photo-1517694712202-14dd9538aa97?auto=format&fit=crop&w=1200&q=80'
    }
  ];

  for (const rowData of rows) {
    await db.run(
      `INSERT INTO blog_posts (title, slug, author, summary, content, content_format, cover_image)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(slug) DO NOTHING`,
      [
        rowData.title,
        rowData.slug,
        rowData.author,
        rowData.summary,
        rowData.content,
        rowData.content_format,
        rowData.cover_image
      ]
    );
  }
}

async function seedApiSettings() {
  const defaults = [
    ['ai_provider', ''],
    ['ai_url', ''],
    ['ai_key', ''],
    ['ai_model', ''],
    ['landing_background_image', ''],
    ['ai_blog_system_prompt', 'Write warm family blog posts in concise markdown.'],
    ['ai_category_system_prompt', 'Classify family photos into short category names.']
  ];

  for (const [key, value] of defaults) {
    await db.run(
      `INSERT INTO api_settings (setting_key, setting_value)
       VALUES (?, ?)
       ON CONFLICT(setting_key) DO NOTHING`,
      key,
      value
    );
  }
}

async function initDb() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    await migrate();
    await seedFamilyUsers();
    await backfillFamilyBios();
    await seedCategories();
    await seedPhotos();
    await backfillPhotoCategory();
    await seedBlogs();
    await seedApiSettings();
  })();
  return initPromise;
}

module.exports = { db, initDb, getOrCreateCategory };
