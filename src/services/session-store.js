const session = require('express-session');
const { db } = require('../db');

class PgSessionStore extends session.Store {
  constructor(options = {}) {
    super();
    this.ttlMs = Number(options.ttlMs || 1000 * 60 * 60 * 24 * 7);
  }

  get(sid, callback) {
    this._getSession(sid)
      .then((data) => callback(null, data))
      .catch((error) => callback(error));
  }

  set(sid, sessionData, callback) {
    this._setSession(sid, sessionData)
      .then(() => callback && callback(null))
      .catch((error) => callback && callback(error));
  }

  destroy(sid, callback) {
    db.run('DELETE FROM family_sessions WHERE sid = ?', sid)
      .then(() => callback && callback(null))
      .catch((error) => callback && callback(error));
  }

  touch(sid, sessionData, callback) {
    const expireAt = this._resolveExpireAt(sessionData);
    db.run('UPDATE family_sessions SET expire = ? WHERE sid = ?', expireAt, sid)
      .then(() => callback && callback(null))
      .catch((error) => callback && callback(error));
  }

  async _getSession(sid) {
    const row = await db.get(
      `SELECT sess
       FROM family_sessions
       WHERE sid = ? AND expire > CURRENT_TIMESTAMP`,
      sid
    );
    if (!row || !row.sess) return null;

    try {
      return JSON.parse(row.sess);
    } catch (_) {
      return null;
    }
  }

  async _setSession(sid, sessionData) {
    const payload = JSON.stringify(sessionData || {});
    const expireAt = this._resolveExpireAt(sessionData);

    await db.run(
      `INSERT INTO family_sessions (sid, sess, expire)
       VALUES (?, ?, ?)
       ON CONFLICT(sid) DO UPDATE SET
         sess = excluded.sess,
         expire = excluded.expire`,
      sid,
      payload,
      expireAt
    );

    if (Math.random() < 0.02) {
      db.run('DELETE FROM family_sessions WHERE expire <= CURRENT_TIMESTAMP').catch(() => {});
    }
  }

  _resolveExpireAt(sessionData) {
    const expires = sessionData && sessionData.cookie && sessionData.cookie.expires;
    if (expires) return new Date(expires).toISOString();
    return new Date(Date.now() + this.ttlMs).toISOString();
  }
}

module.exports = { PgSessionStore };
