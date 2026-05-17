const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

function load(name) {
  const file = path.join(DATA_DIR, `${name}.json`);
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function save(name, data) {
  fs.writeFileSync(path.join(DATA_DIR, `${name}.json`), JSON.stringify(data, null, 2));
}

function nextId(arr) {
  return arr.length === 0 ? 1 : Math.max(...arr.map(x => x.id)) + 1;
}

// ── Profile ───────────────────────────────────────────────────────────────────
const db = {
  getProfile() {
    const file = path.join(DATA_DIR, 'profile.json');
    if (!fs.existsSync(file)) {
      const p = { id: 1, name: 'אמיר', profession: 'מטפל וקואצ\'ר לנוער בסיכון, אבא', children: [], challenges: [] };
      fs.writeFileSync(file, JSON.stringify(p, null, 2));
      return p;
    }
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  },

  saveProfile(data) {
    fs.writeFileSync(path.join(DATA_DIR, 'profile.json'), JSON.stringify({ id: 1, ...data }, null, 2));
  },

  // ── Books ───────────────────────────────────────────────────────────────────
  getBooks() {
    return load('books').sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
  },

  getBook(id) {
    return load('books').find(b => b.id === parseInt(id));
  },

  addBook(data) {
    const books = load('books');
    const book = { id: nextId(books), ...data, completed_topics: [], created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    books.push(book);
    save('books', books);
    return book;
  },

  updateBook(id, data) {
    const books = load('books');
    const i = books.findIndex(b => b.id === parseInt(id));
    if (i >= 0) { books[i] = { ...books[i], ...data, updated_at: new Date().toISOString() }; save('books', books); }
  },

  deleteBook(id) {
    save('books', load('books').filter(b => b.id !== parseInt(id)));
    save('messages', load('messages').filter(m => m.book_id !== parseInt(id)));
  },

  // ── Messages ────────────────────────────────────────────────────────────────
  getMessages(bookId) {
    return load('messages').filter(m => m.book_id === parseInt(bookId));
  },

  addMessage(bookId, role, content) {
    const msgs = load('messages');
    const msg = { id: nextId(msgs), book_id: parseInt(bookId), role, content, created_at: new Date().toISOString() };
    msgs.push(msg);
    save('messages', msgs);
    return msg;
  },

  getRecentMessages(bookId, limit = 20) {
    const msgs = load('messages').filter(m => m.book_id === parseInt(bookId));
    return msgs.slice(-limit);
  },

  // ── Insights ────────────────────────────────────────────────────────────────
  getInsights() {
    const insights = load('insights').reverse().slice(0, 50);
    const books = load('books');
    return insights.map(i => ({ ...i, book_title: books.find(b => b.id === i.book_id)?.title || '' }));
  },

  addInsight(bookId, content, topic) {
    const ins = load('insights');
    ins.push({ id: nextId(ins), book_id: parseInt(bookId), content, topic, created_at: new Date().toISOString() });
    save('insights', ins);
  },

  // ── Field Log ───────────────────────────────────────────────────────────────
  getFieldLog() {
    const logs = load('field_log').reverse().slice(0, 30);
    const books = load('books');
    return logs.map(l => ({ ...l, book_title: books.find(b => b.id === l.book_id)?.title || '' }));
  },

  addFieldLog(bookId, content, aiResponse) {
    const logs = load('field_log');
    logs.push({ id: nextId(logs), book_id: bookId ? parseInt(bookId) : null, content, ai_response: aiResponse, created_at: new Date().toISOString() });
    save('field_log', logs);
  },

  // ── Scripts ─────────────────────────────────────────────────────────────────
  getScripts() { return load('scripts').reverse(); },

  addScript(name, description, context) {
    const s = load('scripts');
    s.push({ id: nextId(s), name, description, context, created_at: new Date().toISOString() });
    save('scripts', s);
  },

  // ── Chapters (completed modules with summaries) ─────────────────────────────
  getChapters(bookId) {
    const all = load('chapters').filter(c => c.book_id === parseInt(bookId));
    return all.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  },

  getChapter(id) {
    return load('chapters').find(c => c.id === parseInt(id));
  },

  addChapter(bookId, title, summary, bridge) {
    const chapters = load('chapters');
    const chapter = {
      id: nextId(chapters),
      book_id: parseInt(bookId),
      title,
      summary,
      bridge: bridge || '',
      created_at: new Date().toISOString()
    };
    chapters.push(chapter);
    save('chapters', chapters);

    // Also update book's completed_topics
    const books = load('books');
    const bookIdx = books.findIndex(b => b.id === parseInt(bookId));
    if (bookIdx >= 0) {
      const topics = Array.isArray(books[bookIdx].completed_topics) ? books[bookIdx].completed_topics : [];
      if (!topics.includes(title)) topics.push(title);
      books[bookIdx].completed_topics = topics;
      books[bookIdx].updated_at = new Date().toISOString();
      save('books', books);
    }

    return chapter;
  },

  // ── Chapter Q&A ─────────────────────────────────────────────────────────────
  getChapterQA(chapterId) {
    return load('chapter_qa').filter(q => q.chapter_id === parseInt(chapterId));
  },

  addChapterQA(chapterId, role, content) {
    const qa = load('chapter_qa');
    const item = {
      id: nextId(qa),
      chapter_id: parseInt(chapterId),
      role, content,
      created_at: new Date().toISOString()
    };
    qa.push(item);
    save('chapter_qa', qa);
    return item;
  }
};

module.exports = db;
