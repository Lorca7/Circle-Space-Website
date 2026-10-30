'use strict';

const { Store } = require('express-session');

module.exports = function createStore(sql) {
  const DEFAULT_TTL_MS = 14 * 24 * 60 * 60 * 1000;

  function expiryOf(session) {
    const cookieExpires = session?.cookie?.expires;
    if (cookieExpires) return new Date(cookieExpires).getTime();
    return Date.now() + DEFAULT_TTL_MS;
  }

  class NeonStore extends Store {
    get(sid, done) {
      sql`SELECT data, expires FROM sessions WHERE sid = ${sid}`
        .then((rows) => {
          if (!rows.length) return done(null, null);
          if (Number(rows[0].expires) <= Date.now()) {
            return sql`DELETE FROM sessions WHERE sid = ${sid}`.then(() => done(null, null));
          }
          return done(null, JSON.parse(rows[0].data));
        })
        .catch(done);
    }

    set(sid, session, done) {
      sql(
        'INSERT INTO sessions (sid, expires, data) VALUES ($1, $2, $3) ' +
          'ON CONFLICT (sid) DO UPDATE SET expires = EXCLUDED.expires, data = EXCLUDED.data',
        [sid, expiryOf(session), JSON.stringify(session)]
      )
        .then(() => done(null))
        .catch(done);
    }

    destroy(sid, done) {
      sql`DELETE FROM sessions WHERE sid = ${sid}`
        .then(() => done(null))
        .catch(done);
    }

    touch(sid, session, done) {
      sql('UPDATE sessions SET expires = $1 WHERE sid = $2', [expiryOf(session), sid])
        .then(() => done(null))
        .catch(done);
    }

    clear(done) {
      sql`DELETE FROM sessions`
        .then(() => done(null))
        .catch(done);
    }

    length(done) {
      sql('SELECT COUNT(*) AS n FROM sessions WHERE expires > $1', [Date.now()])
        .then((rows) => done(null, Number(rows[0].n)))
        .catch(done);
    }

    all(done) {
      sql('SELECT sid, data FROM sessions WHERE expires > $1', [Date.now()])
        .then((rows) => done(null, rows.map((r) => JSON.parse(r.data))))
        .catch(done);
    }
  }

  return new NeonStore();
};
