const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const useDb = !!process.env.DATABASE_URL;
let pool = null;

// Legacy JSON fallback (for local dev without DATABASE_URL)
const DATA_DIR = path.join(__dirname, 'data');
if (!useDb && !fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

if (useDb) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
}

async function q(text, params) {
  const res = await pool.query(text, params);
  return res.rows;
}

async function initSchema() {
  if (!useDb) return;
  await q(`
    CREATE TABLE IF NOT EXISTS profile (
      id INT PRIMARY KEY DEFAULT 1,
      name TEXT DEFAULT 'אמיר',
      profession TEXT DEFAULT 'מטפל וקואצ''ר לנוער בסיכון, אבא',
      children JSONB DEFAULT '[]'::jsonb,
      challenges JSONB DEFAULT '[]'::jsonb,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    INSERT INTO profile (id) VALUES (1) ON CONFLICT DO NOTHING;
  `);
  await q(`
    CREATE TABLE IF NOT EXISTS books (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      language TEXT DEFAULT 'en',
      content TEXT DEFAULT '',
      current_chapter TEXT,
      completed_topics JSONB DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await q(`
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      book_id INT REFERENCES books(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_messages_book_id ON messages(book_id, id);
  `);
  await q(`
    CREATE TABLE IF NOT EXISTS insights (
      id SERIAL PRIMARY KEY,
      book_id INT REFERENCES books(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      topic TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await q(`
    CREATE TABLE IF NOT EXISTS scripts (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      context TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await q(`
    CREATE TABLE IF NOT EXISTS field_log (
      id SERIAL PRIMARY KEY,
      book_id INT REFERENCES books(id) ON DELETE SET NULL,
      content TEXT NOT NULL,
      ai_response TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await q(`
    CREATE TABLE IF NOT EXISTS chapters (
      id SERIAL PRIMARY KEY,
      book_id INT REFERENCES books(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      summary TEXT,
      bridge TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await q(`
    CREATE TABLE IF NOT EXISTS chapter_qa (
      id SERIAL PRIMARY KEY,
      chapter_id INT REFERENCES chapters(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  // ── Cognition runtime events ────────────────────────────────────────────────
  await q(`
    CREATE TABLE IF NOT EXISTS events (
      id SERIAL PRIMARY KEY,
      book_id INT,
      type TEXT NOT NULL,
      agent TEXT,
      payload JSONB DEFAULT '{}'::jsonb,
      latency_ms INT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_events_book_id ON events(book_id, id);
    CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
  `);
  console.log('✅ Postgres schema ready');
}

// ── JSON fallback helpers ─────────────────────────────────────────────────────
function jLoad(name) {
  const file = path.join(DATA_DIR, `${name}.json`);
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function jSave(name, data) {
  fs.writeFileSync(path.join(DATA_DIR, `${name}.json`), JSON.stringify(data, null, 2));
}
function jNextId(arr) { return arr.length === 0 ? 1 : Math.max(...arr.map(x => x.id)) + 1; }

// ── API ───────────────────────────────────────────────────────────────────────
const db = {
  async getProfile() {
    if (useDb) {
      const rows = await q('SELECT * FROM profile WHERE id=1');
      return rows[0];
    }
    const file = path.join(DATA_DIR, 'profile.json');
    if (!fs.existsSync(file)) {
      const p = { id: 1, name: 'אמיר', profession: 'מטפל וקואצ\'ר לנוער בסיכון, אבא', children: [], challenges: [] };
      fs.writeFileSync(file, JSON.stringify(p, null, 2));
      return p;
    }
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  },

  async saveProfile(data) {
    if (useDb) {
      await q(
        `UPDATE profile SET name=$1, profession=$2, children=$3, challenges=$4, updated_at=NOW() WHERE id=1`,
        [data.name, data.profession, JSON.stringify(data.children || []), JSON.stringify(data.challenges || [])]
      );
      return;
    }
    fs.writeFileSync(path.join(DATA_DIR, 'profile.json'), JSON.stringify({ id: 1, ...data }, null, 2));
  },

  async getBooks() {
    if (useDb) {
      return await q(`SELECT id, title, language, current_chapter, completed_topics, created_at, updated_at FROM books ORDER BY updated_at DESC`);
    }
    return jLoad('books').sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
  },

  async getBook(id) {
    if (useDb) {
      const rows = await q('SELECT * FROM books WHERE id=$1', [parseInt(id)]);
      return rows[0];
    }
    return jLoad('books').find(b => b.id === parseInt(id));
  },

  async addBook(data) {
    if (useDb) {
      const rows = await q(
        `INSERT INTO books (title, language, content) VALUES ($1, $2, $3) RETURNING *`,
        [data.title, data.language || 'en', data.content || '']
      );
      return rows[0];
    }
    const books = jLoad('books');
    const book = { id: jNextId(books), ...data, completed_topics: [], created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    books.push(book);
    jSave('books', books);
    return book;
  },

  async updateBook(id, data) {
    if (useDb) {
      const fields = [];
      const vals = [];
      let i = 1;
      for (const k of ['title', 'current_chapter']) {
        if (data[k] !== undefined) { fields.push(`${k}=$${i++}`); vals.push(data[k]); }
      }
      fields.push(`updated_at=NOW()`);
      vals.push(parseInt(id));
      await q(`UPDATE books SET ${fields.join(',')} WHERE id=$${i}`, vals);
      return;
    }
    const books = jLoad('books');
    const idx = books.findIndex(b => b.id === parseInt(id));
    if (idx >= 0) { books[idx] = { ...books[idx], ...data, updated_at: new Date().toISOString() }; jSave('books', books); }
  },

  async deleteBook(id) {
    if (useDb) {
      await q('DELETE FROM books WHERE id=$1', [parseInt(id)]);
      return;
    }
    jSave('books', jLoad('books').filter(b => b.id !== parseInt(id)));
    jSave('messages', jLoad('messages').filter(m => m.book_id !== parseInt(id)));
  },

  async getMessages(bookId) {
    if (useDb) {
      return await q(`SELECT role, content, created_at FROM messages WHERE book_id=$1 ORDER BY id ASC`, [parseInt(bookId)]);
    }
    return jLoad('messages').filter(m => m.book_id === parseInt(bookId));
  },

  async addMessage(bookId, role, content) {
    if (useDb) {
      const rows = await q(
        `INSERT INTO messages (book_id, role, content) VALUES ($1, $2, $3) RETURNING *`,
        [parseInt(bookId), role, content]
      );
      return rows[0];
    }
    const msgs = jLoad('messages');
    const msg = { id: jNextId(msgs), book_id: parseInt(bookId), role, content, created_at: new Date().toISOString() };
    msgs.push(msg);
    jSave('messages', msgs);
    return msg;
  },

  async getRecentMessages(bookId, limit = 20) {
    if (useDb) {
      const rows = await q(
        `SELECT role, content FROM messages WHERE book_id=$1 ORDER BY id DESC LIMIT $2`,
        [parseInt(bookId), limit]
      );
      return rows.reverse();
    }
    const msgs = jLoad('messages').filter(m => m.book_id === parseInt(bookId));
    return msgs.slice(-limit);
  },

  async getInsights() {
    if (useDb) {
      return await q(`
        SELECT i.*, b.title AS book_title
        FROM insights i LEFT JOIN books b ON i.book_id=b.id
        ORDER BY i.created_at DESC LIMIT 50
      `);
    }
    const insights = jLoad('insights').reverse().slice(0, 50);
    const books = jLoad('books');
    return insights.map(i => ({ ...i, book_title: books.find(b => b.id === i.book_id)?.title || '' }));
  },

  async addInsight(bookId, content, topic) {
    if (useDb) {
      await q(
        `INSERT INTO insights (book_id, content, topic) VALUES ($1, $2, $3)`,
        [parseInt(bookId), content, topic]
      );
      return;
    }
    const ins = jLoad('insights');
    ins.push({ id: jNextId(ins), book_id: parseInt(bookId), content, topic, created_at: new Date().toISOString() });
    jSave('insights', ins);
  },

  async getFieldLog() {
    if (useDb) {
      return await q(`
        SELECT f.*, b.title AS book_title
        FROM field_log f LEFT JOIN books b ON f.book_id=b.id
        ORDER BY f.created_at DESC LIMIT 30
      `);
    }
    const logs = jLoad('field_log').reverse().slice(0, 30);
    const books = jLoad('books');
    return logs.map(l => ({ ...l, book_title: books.find(b => b.id === l.book_id)?.title || '' }));
  },

  async addFieldLog(bookId, content, aiResponse) {
    if (useDb) {
      await q(
        `INSERT INTO field_log (book_id, content, ai_response) VALUES ($1, $2, $3)`,
        [bookId ? parseInt(bookId) : null, content, aiResponse]
      );
      return;
    }
    const logs = jLoad('field_log');
    logs.push({ id: jNextId(logs), book_id: bookId ? parseInt(bookId) : null, content, ai_response: aiResponse, created_at: new Date().toISOString() });
    jSave('field_log', logs);
  },

  async getScripts() {
    if (useDb) {
      return await q(`SELECT * FROM scripts ORDER BY created_at DESC`);
    }
    return jLoad('scripts').reverse();
  },

  async addScript(name, description, context) {
    if (useDb) {
      await q(
        `INSERT INTO scripts (name, description, context) VALUES ($1, $2, $3)`,
        [name, description, context]
      );
      return;
    }
    const s = jLoad('scripts');
    s.push({ id: jNextId(s), name, description, context, created_at: new Date().toISOString() });
    jSave('scripts', s);
  },

  async getChapters(bookId) {
    if (useDb) {
      return await q(
        `SELECT * FROM chapters WHERE book_id=$1 ORDER BY created_at DESC`,
        [parseInt(bookId)]
      );
    }
    const all = jLoad('chapters').filter(c => c.book_id === parseInt(bookId));
    return all.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  },

  async getChapter(id) {
    if (useDb) {
      const rows = await q('SELECT * FROM chapters WHERE id=$1', [parseInt(id)]);
      return rows[0];
    }
    return jLoad('chapters').find(c => c.id === parseInt(id));
  },

  async addChapter(bookId, title, summary, bridge) {
    if (useDb) {
      const rows = await q(
        `INSERT INTO chapters (book_id, title, summary, bridge) VALUES ($1, $2, $3, $4) RETURNING *`,
        [parseInt(bookId), title, summary, bridge || '']
      );
      // append to book.completed_topics
      await q(
        `UPDATE books SET
          completed_topics = (
            CASE WHEN completed_topics ? $1
              THEN completed_topics
              ELSE completed_topics || $2::jsonb
            END
          ),
          updated_at = NOW()
         WHERE id = $3`,
        [title, JSON.stringify([title]), parseInt(bookId)]
      );
      return rows[0];
    }
    const chapters = jLoad('chapters');
    const chapter = { id: jNextId(chapters), book_id: parseInt(bookId), title, summary, bridge: bridge || '', created_at: new Date().toISOString() };
    chapters.push(chapter);
    jSave('chapters', chapters);
    const books = jLoad('books');
    const bookIdx = books.findIndex(b => b.id === parseInt(bookId));
    if (bookIdx >= 0) {
      const topics = Array.isArray(books[bookIdx].completed_topics) ? books[bookIdx].completed_topics : [];
      if (!topics.includes(title)) topics.push(title);
      books[bookIdx].completed_topics = topics;
      books[bookIdx].updated_at = new Date().toISOString();
      jSave('books', books);
    }
    return chapter;
  },

  async getChapterQA(chapterId) {
    if (useDb) {
      return await q(
        `SELECT * FROM chapter_qa WHERE chapter_id=$1 ORDER BY id ASC`,
        [parseInt(chapterId)]
      );
    }
    return jLoad('chapter_qa').filter(q => q.chapter_id === parseInt(chapterId));
  },

  async addChapterQA(chapterId, role, content) {
    if (useDb) {
      const rows = await q(
        `INSERT INTO chapter_qa (chapter_id, role, content) VALUES ($1, $2, $3) RETURNING *`,
        [parseInt(chapterId), role, content]
      );
      return rows[0];
    }
    const qa = jLoad('chapter_qa');
    const item = { id: jNextId(qa), chapter_id: parseInt(chapterId), role, content, created_at: new Date().toISOString() };
    qa.push(item);
    jSave('chapter_qa', qa);
    return item;
  },

  // ── Cognition events ────────────────────────────────────────────────────────
  async addEvent({ type, bookId = null, agent = null, payload = {}, latencyMs = null }) {
    if (useDb) {
      await q(
        `INSERT INTO events (book_id, type, agent, payload, latency_ms) VALUES ($1, $2, $3, $4, $5)`,
        [bookId ? parseInt(bookId) : null, type, agent, JSON.stringify(payload || {}), latencyMs]
      );
      return;
    }
    const events = jLoad('events');
    events.push({
      id: jNextId(events),
      book_id: bookId ? parseInt(bookId) : null,
      type, agent, payload: payload || {},
      latency_ms: latencyMs,
      created_at: new Date().toISOString()
    });
    jSave('events', events);
  },

  async getRecentEvents(limit = 100) {
    if (useDb) {
      return await q(`SELECT * FROM events ORDER BY id DESC LIMIT $1`, [limit]);
    }
    return jLoad('events').slice(-limit).reverse();
  },

  initSchema
};

module.exports = db;
