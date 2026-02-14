const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const { slugify } = require('./services/text');
const {
  isSupabaseEnabled,
  getDbBucket,
  downloadObjectToFile,
  uploadFileToObject
} = require('./services/supabase');

const isVercel = process.env.VERCEL === '1';
const dbDir = isVercel ? '/tmp' : path.join(__dirname, '..', 'data');
const dbPath = path.join(dbDir, 'family-home.db');
const dbRemoteObject = process.env.SUPABASE_DB_OBJECT || 'state/family-home.db';

let internalDb = null;
let initPromise = null;

let persistenceEnabled = false;
let dbBooting = true;
let persistTimer = null;
let persistDirty = false;
let persistInFlight = Promise.resolve();

const mutationRegex = /^(insert|update|delete|replace|create|alter|drop|vacuum|reindex|begin|commit|rollback|pragma)\b/i;

const db = new Proxy(
  {},
  {
    get(_target, prop) {
      if (!internalDb) {
        throw new Error('Database is not initialized yet.');
      }
      const value = internalDb[prop];
      return typeof value === 'function' ? value.bind(internalDb) : value;
    }
  }
);

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function isMutatingSql(sql = '') {
  return mutationRegex.test(String(sql).trim());
}

function scheduleDbPersist() {
  if (!persistenceEnabled || dbBooting) return;
  persistDirty = true;
  if (persistTimer) return;

  persistTimer = setTimeout(() => {
    persistTimer = null;
    persistInFlight = persistInFlight
      .then(async () => {
        if (!persistDirty || !internalDb) return;
        persistDirty = false;

        if (!isSupabaseEnabled()) return;

        try {
          internalDb.pragma('wal_checkpoint(TRUNCATE)');
        } catch (_) {
          // ignore when WAL is not active
        }

        await uploadFileToObject({
          bucket: getDbBucket(),
          objectPath: dbRemoteObject,
          sourcePath: dbPath
        });
      })
      .catch((error) => {
        // eslint-disable-next-line no-console
        console.error('DB persistence upload failed:', error.message);
      });
  }, 1200);
}

async function hydrateDbFromRemote() {
  if (!isSupabaseEnabled()) return false;
  return downloadObjectToFile({
    bucket: getDbBucket(),
    objectPath: dbRemoteObject,
    destination: dbPath
  });
}

function patchDbPersistenceHooks() {
  if (!internalDb) return;

  const rawPrepare = internalDb.prepare.bind(internalDb);
  internalDb.prepare = (sql) => {
    const stmt = rawPrepare(sql);
    if (!isMutatingSql(sql)) return stmt;

    return new Proxy(stmt, {
      get(target, prop) {
        const value = target[prop];
        if (prop === 'run' && typeof value === 'function') {
          return (...args) => {
            const result = value.apply(target, args);
            scheduleDbPersist();
            return result;
          };
        }
        return typeof value === 'function' ? value.bind(target) : value;
      }
    });
  };

  const rawExec = internalDb.exec.bind(internalDb);
  internalDb.exec = (sql) => {
    const result = rawExec(sql);
    if (isMutatingSql(sql)) scheduleDbPersist();
    return result;
  };
}

function hasColumn(table, column) {
  const columns = internalDb.prepare(`PRAGMA table_info(${table})`).all();
  return columns.some((entry) => entry.name === column);
}

function getOrCreateCategory(name) {
  const cleanName = (name || '').trim() || 'Everyday';
  let row = internalDb.prepare('SELECT * FROM photo_categories WHERE name = ?').get(cleanName);
  if (row) return row;

  const baseSlug = slugify(cleanName) || 'everyday';
  let slug = baseSlug;
  let index = 1;
  while (internalDb.prepare('SELECT id FROM photo_categories WHERE slug = ?').get(slug)) {
    slug = `${baseSlug}-${index}`;
    index += 1;
  }

  const result = internalDb
    .prepare('INSERT INTO photo_categories (name, slug) VALUES (?, ?)')
    .run(cleanName, slug);
  return internalDb.prepare('SELECT * FROM photo_categories WHERE id = ?').get(result.lastInsertRowid);
}

function migrate() {
  internalDb.exec(`
    CREATE TABLE IF NOT EXISTS family_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      profile_image TEXT,
      profile_bio TEXT,
      role TEXT NOT NULL DEFAULT 'family'
    );

    CREATE TABLE IF NOT EXISTS member_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      approved_at TEXT,
      approved_by TEXT
    );

    CREATE TABLE IF NOT EXISTS member_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      is_approved INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      approved_at TEXT
    );

    CREATE TABLE IF NOT EXISTS member_login_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      code TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT
    );

    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      owner TEXT NOT NULL,
      summary TEXT NOT NULL,
      content TEXT NOT NULL,
      published INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS photo_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      slug TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS album_photos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      caption TEXT,
      image_url TEXT NOT NULL,
      category_id INTEGER,
      created_by TEXT NOT NULL DEFAULT 'system',
      highlight_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(category_id) REFERENCES photo_categories(id)
    );

    CREATE TABLE IF NOT EXISTS blog_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      author TEXT NOT NULL,
      summary TEXT NOT NULL,
      content TEXT NOT NULL,
      content_format TEXT NOT NULL DEFAULT 'markdown',
      cover_image TEXT,
      published INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS api_settings (
      setting_key TEXT PRIMARY KEY,
      setting_value TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS album_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      photo_id INTEGER NOT NULL,
      parent_comment_id INTEGER,
      member_email TEXT NOT NULL,
      display_name TEXT NOT NULL,
      content TEXT NOT NULL,
      content_type TEXT NOT NULL DEFAULT 'text',
      filtered INTEGER NOT NULL DEFAULT 0,
      deleted_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(photo_id) REFERENCES album_photos(id),
      FOREIGN KEY(parent_comment_id) REFERENCES album_comments(id)
    );

    CREATE TABLE IF NOT EXISTS emoji_reactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      photo_id INTEGER NOT NULL,
      member_email TEXT NOT NULL,
      emoji TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(photo_id) REFERENCES album_photos(id)
    );

    CREATE TABLE IF NOT EXISTS comment_delete_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      comment_id INTEGER NOT NULL,
      token TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      FOREIGN KEY(comment_id) REFERENCES album_comments(id)
    );

    CREATE TABLE IF NOT EXISTS comment_reactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      comment_id INTEGER NOT NULL,
      member_email TEXT NOT NULL,
      emoji TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(comment_id) REFERENCES album_comments(id)
    );
  `);

  if (!hasColumn('album_photos', 'category_id')) {
    internalDb.exec('ALTER TABLE album_photos ADD COLUMN category_id INTEGER');
  }

  if (!hasColumn('album_photos', 'created_by')) {
    internalDb.exec("ALTER TABLE album_photos ADD COLUMN created_by TEXT NOT NULL DEFAULT 'system'");
  }

  if (!hasColumn('blog_posts', 'cover_image')) {
    internalDb.exec('ALTER TABLE blog_posts ADD COLUMN cover_image TEXT');
  }

  if (!hasColumn('blog_posts', 'content_format')) {
    internalDb.exec("ALTER TABLE blog_posts ADD COLUMN content_format TEXT NOT NULL DEFAULT 'markdown'");
  }

  if (!hasColumn('family_users', 'profile_image')) {
    internalDb.exec('ALTER TABLE family_users ADD COLUMN profile_image TEXT');
  }

  if (!hasColumn('family_users', 'profile_bio')) {
    internalDb.exec('ALTER TABLE family_users ADD COLUMN profile_bio TEXT');
  }

  if (!hasColumn('album_comments', 'parent_comment_id')) {
    internalDb.exec('ALTER TABLE album_comments ADD COLUMN parent_comment_id INTEGER');
  }

  internalDb.exec('CREATE INDEX IF NOT EXISTS idx_album_comments_photo_parent ON album_comments(photo_id, parent_comment_id, id)');
  internalDb.exec('CREATE INDEX IF NOT EXISTS idx_comment_reactions_comment ON comment_reactions(comment_id, emoji)');
}

function seedFamilyUsers() {
  const users = ['Anton', 'Olivia', 'Eliana'];
  const insert = internalDb.prepare(
    'INSERT OR IGNORE INTO family_users (name, password_hash, role) VALUES (?, ?, ?)'
  );

  users.forEach((name) => {
    const hash = bcrypt.hashSync('0000', 10);
    insert.run(name, hash, 'family');
  });
}

function backfillFamilyBios() {
  const defaults = [
    ['Anton', '기획과 구현을 담당하는 패밀리 메이커.'],
    ['Olivia', '감성과 색감을 채우는 크리에이터.'],
    ['Eliana', '작은 일상을 특별하게 만드는 주인공.']
  ];
  const update = internalDb.prepare(
    `UPDATE family_users
     SET profile_bio = ?
     WHERE name = ? AND (profile_bio IS NULL OR trim(profile_bio) = '')`
  );
  defaults.forEach(([name, bio]) => update.run(bio, name));
}

function seedCategories() {
  ['Everyday', 'Travel', 'Celebration', 'Food', 'Outdoor'].forEach((name) => {
    getOrCreateCategory(name);
  });
}

function seedPhotos() {
  const count = internalDb.prepare('SELECT COUNT(*) AS c FROM album_photos').get().c;
  if (count > 0) return;

  const insert = internalDb.prepare(`
    INSERT INTO album_photos (title, caption, image_url, category_id, created_by, highlight_order)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const travel = getOrCreateCategory('Travel');
  const food = getOrCreateCategory('Food');
  const outdoor = getOrCreateCategory('Outdoor');

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

  photos.forEach((p) => insert.run(...p));
}

function backfillPhotoCategory() {
  const defaultCategory = getOrCreateCategory('Everyday');
  internalDb.prepare('UPDATE album_photos SET category_id = ? WHERE category_id IS NULL').run(defaultCategory.id);
  internalDb.prepare("UPDATE album_photos SET created_by = 'system' WHERE created_by IS NULL OR created_by = ''").run();
}

function seedBlogs() {
  const count = internalDb.prepare('SELECT COUNT(*) AS c FROM blog_posts').get().c;
  if (count > 0) return;

  const insert = internalDb.prepare(`
    INSERT INTO blog_posts (title, slug, author, summary, content, content_format, cover_image)
    VALUES (@title, @slug, @author, @summary, @content, @content_format, @cover_image)
  `);

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

  rows.forEach((row) => insert.run(row));
}

function seedApiSettings() {
  const defaults = [
    ['ai_provider', ''],
    ['ai_url', ''],
    ['ai_key', ''],
    ['ai_model', ''],
    ['landing_background_image', ''],
    ['ai_blog_system_prompt', 'Write warm family blog posts in concise markdown.'],
    ['ai_category_system_prompt', 'Classify family photos into short category names.']
  ];

  const insert = internalDb.prepare(
    'INSERT OR IGNORE INTO api_settings (setting_key, setting_value) VALUES (?, ?)'
  );

  defaults.forEach(([key, value]) => insert.run(key, value));
}

async function initDb() {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    ensureDir(dbDir);
    await hydrateDbFromRemote();

    internalDb = new Database(dbPath);
    try {
      internalDb.pragma('journal_mode = DELETE');
    } catch (_) {
      // Keep default mode if lock/state prevents pragma change.
    }
    patchDbPersistenceHooks();

    migrate();
    seedFamilyUsers();
    backfillFamilyBios();
    seedCategories();
    seedPhotos();
    backfillPhotoCategory();
    seedBlogs();
    seedApiSettings();

    persistenceEnabled = isSupabaseEnabled();
    dbBooting = false;
    scheduleDbPersist();
  })();

  return initPromise;
}

module.exports = { db, initDb, getOrCreateCategory };
