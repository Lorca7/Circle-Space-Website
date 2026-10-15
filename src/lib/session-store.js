'use strict';

const { Store } = require('express-session');

/**
 * Minimal session store on top of the site's existing better-sqlite3 handle,
 * so the app needs only one SQLite driver.
 */
module.exports = function createStore(db) {
  const stmt = {
    get: db.prepare('SELECT data, expires FROM sessions WHERE sid = ?'),
    set: db.prepare(
      'INSERT INTO sessions (sid, expires, data) VALUES (@sid, @expires, @data) ' +
        'ON CONFLICT(sid) DO UPDATE SET expires = excluded.expires, data = excluded.data'
    ),
    destroy: db.prepare('DELETE FROM sessions WHERE sid = ?'),
    touch: db.prepare('UPDATE sessions SET expires = ? WHERE sid = ?'),
    clear: db.prepare('DELETE FROM sessions'),
    length: db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE expires > ?'),
    reap: db.prepare('DELETE FROM sessions WHERE expires <= ?'),
    all: db.prepare('SELECT sid, data FROM sessions WHERE expires > ?'),
  };

  const DEFAULT_TTL_MS = 14 * 24 * 60 * 60 * 1000;

  function expiryOf(session) {
    const cookieExpires = session?.cookie?.expires;
    if (cookieExpires) return new Date(cookieExpires).getTime();
    return Date.now() + DEFAULT_TTL_MS;
  }

  class SqliteStore extends Store {
    get(sid, done) {
      try {
        const row = stmt.get.get(sid);
        if (!row) return done(null, null);
        if (row.expires <= Date.now()) {
          stmt.destroy.run(sid);
          return done(null, null);
        }
        return done(null, JSON.parse(row.data));
      } catch (err) {
        return done(err);
      }
    }

    set(sid, session, done) {
      try {
        stmt.set.run({
          sid,
          expires: expiryOf(session),
          data: JSON.stringify(session),
        });
        return done(null);
      } catch (err) {
        return done(err);
      }
    }

    destroy(sid, done) {
      try {
        stmt.destroy.run(sid);
        return done(null);
      } catch (err) {
        return done(err);
      }
    }

    touch(sid, session, done) {
      try {
        stmt.touch.run(expiryOf(session), sid);
        return done(null);
      } catch (err) {
        return done(err);
      }
    }

    clear(done) {
      try {
        stmt.clear.run();
        return done(null);
      } catch (err) {
        return done(err);
      }
    }

    length(done) {
      try {
        return done(null, stmt.length.get(Date.now()).n);
      } catch (err) {
        return done(err);
      }
    }

    all(done) {
      try {
        const rows = stmt.all.all(Date.now());
        return done(null, rows.map((r) => JSON.parse(r.data)));
      } catch (err) {
        return done(err);
      }
    }
  }

  const store = new SqliteStore();

  // Drop expired rows hourly so the table does not grow without bound.
  const timer = setInterval(() => {
    try {
      stmt.reap.run(Date.now());
    } catch {
      /* a failed sweep is retried on the next tick */
    }
  }, 60 * 60 * 1000);
  timer.unref();

  return store;
};
