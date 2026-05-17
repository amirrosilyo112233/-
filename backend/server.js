require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const db = require('./db');

const app = express();
const upload = multer({ dest: 'uploads/' });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

app.use(cors());
app.use(express.json({ limit: '50mb' }));

const { buildPrompt } = require('./tutor-style');

// ── Profile ───────────────────────────────────────────────────────────────────
app.get('/api/profile', (req, res) => res.json(db.getProfile()));
app.put('/api/profile', (req, res) => { db.saveProfile(req.body); res.json({ ok: true }); });

// ── Books ─────────────────────────────────────────────────────────────────────
app.get('/api/books', (req, res) => res.json(db.getBooks()));

// Accept up to 30 files (images, PDFs, TXT) — in order
app.post('/api/books/upload', upload.array('files', 30), async (req, res) => {
  try {
    const { title, language } = req.body;
    const files = req.files || [];
    if (files.length === 0) return res.status(400).json({ error: 'לא הועלו קבצים' });

    const visionModel = genAI.getGenerativeModel({ model: 'gemini-2.5-pro' });
    const parts = [];

    // Process files in the order they arrived (frontend keeps order)
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const ext = path.extname(file.originalname).toLowerCase();
      const buf = fs.readFileSync(file.path);

      try {
        if (ext === '.pdf') {
          const pdfParse = require('pdf-parse');
          const data = await pdfParse(buf);
          if (data.text && data.text.trim().length > 50) {
            parts.push(`--- קובץ ${i + 1}: ${file.originalname} ---\n${data.text.substring(0, 40000)}`);
          } else {
            // PDF likely scanned - send to Gemini Vision
            const b64 = buf.toString('base64');
            const result = await visionModel.generateContent([
              { inlineData: { data: b64, mimeType: 'application/pdf' } },
              'תאר בפירוט מלא את כל התוכן של הקובץ הזה — כל הטקסט, הכותרות, הדיאגרמות, הטבלאות, וכל מידע חזותי חשוב. שמור על הסדר המקורי.'
            ]);
            parts.push(`--- קובץ ${i + 1}: ${file.originalname} ---\n${result.response.text()}`);
          }
        } else if (ext === '.txt') {
          parts.push(`--- קובץ ${i + 1}: ${file.originalname} ---\n${buf.toString('utf8').substring(0, 40000)}`);
        } else if (['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext)) {
          // Image — use Gemini Vision to extract content in order
          const mimeType = ext === '.png' ? 'image/png' :
                           ext === '.webp' ? 'image/webp' :
                           ext === '.gif' ? 'image/gif' : 'image/jpeg';
          const b64 = buf.toString('base64');
          const result = await visionModel.generateContent([
            { inlineData: { data: b64, mimeType } },
            `זוהי תמונה מספר ${i + 1} מתוך ${files.length} בסדר הלימוד. תאר בפירוט מלא את כל מה שכתוב בתמונה — טקסט, כותרות, רשימות, דיאגרמות, ציורים, ונקודות מרכזיות. אל תפרש או תוסיף — רק תאר את התוכן עצמו בצורה מקיפה.`
          ]);
          parts.push(`--- תמונה ${i + 1} מתוך ${files.length}: ${file.originalname} ---\n${result.response.text()}`);
        }
      } catch (e) {
        console.error(`Failed to process ${file.originalname}:`, e.message);
        parts.push(`--- קובץ ${i + 1}: ${file.originalname} (שגיאה בעיבוד) ---`);
      }

      fs.unlinkSync(file.path);
    }

    const content = parts.join('\n\n');
    const finalTitle = title || files[0]?.originalname?.replace(/\.[^.]+$/, '') || 'ספר חדש';

    const book = db.addBook({
      title: finalTitle,
      language: language || 'en',
      content
    });

    res.json({ id: book.id, title: book.title, filesProcessed: files.length });
  } catch (err) {
    console.error('Upload error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/books/:id', (req, res) => {
  db.deleteBook(req.params.id);
  res.json({ ok: true });
});

// ── Chat ──────────────────────────────────────────────────────────────────────
app.get('/api/books/:id/messages', (req, res) => {
  res.json(db.getMessages(req.params.id));
});

app.post('/api/books/:id/chat', async (req, res) => {
  try {
    const { message } = req.body;
    const bookId = req.params.id;

    const book = db.getBook(bookId);
    if (!book) return res.status(404).json({ error: 'ספר לא נמצא' });

    const profile = db.getProfile();
    db.addMessage(bookId, 'user', message);

    const history = db.getRecentMessages(bookId, 20);
    const systemPrompt = buildPrompt(profile, book);

    // Build Gemini history (exclude last user message)
    const geminiHistory = history.slice(0, -1).map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }));

    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-pro',
      systemInstruction: systemPrompt
    });

    const chat = model.startChat({ history: geminiHistory });
    const result = await chat.sendMessage(message);
    const reply = result.response.text();

    db.addMessage(bookId, 'assistant', reply);
    db.updateBook(bookId, {});

    // Auto-save insight on "wow" moments
    if (reply.includes('🔥')) {
      const wowMatch = reply.match(/🔥[^\n]*/);
      const topic = wowMatch ? wowMatch[0].substring(0, 200) : (book.current_chapter || 'כללי');
      db.addInsight(bookId, message, topic);
    }

    // Auto-save script when tutor identifies one
    if (reply.includes('🛑')) {
      const nameMatch = reply.match(/🛑[^\n.]+/);
      const name = nameMatch ? nameMatch[0].replace(/[🛑*"']/g, '').substring(0, 80).trim() : 'תסריט שזוהה';
      db.addScript(name, reply.substring(0, 500), message.substring(0, 300));
    }

    res.json({ message: reply });
  } catch (err) {
    console.error('Chat error:', err.message);
    res.status(500).json({ error: err.message, message: 'מצטער, הייתה שגיאה. נסה שוב.' });
  }
});

// ── Field Log ─────────────────────────────────────────────────────────────────
app.get('/api/field-log', (req, res) => res.json(db.getFieldLog()));

app.post('/api/field-log', async (req, res) => {
  try {
    const { content, book_id } = req.body;
    const book = book_id ? db.getBook(book_id) : null;
    const prompt = `אמיר כתב: "${content}"\n${book ? `ספר: ${book.title}` : ''}\nתגיב בעברית קצר: שאל שאלת עומק, חבר לחומר, הצע לנסות מחר.`;
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-pro' });
    const result = await model.generateContent(prompt);
    const aiResponse = result.response.text();
    db.addFieldLog(book_id, content, aiResponse);
    res.json({ response: aiResponse });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Chapters (Archive) ────────────────────────────────────────────────────────
app.get('/api/books/:id/chapters', (req, res) => {
  res.json(db.getChapters(req.params.id));
});

app.post('/api/books/:id/chapters/complete', async (req, res) => {
  try {
    const { title } = req.body;
    const bookId = req.params.id;

    const book = db.getBook(bookId);
    if (!book) return res.status(404).json({ error: 'ספר לא נמצא' });

    const messages = db.getMessages(bookId);
    const previousChapters = db.getChapters(bookId);

    // Build text of the recent conversation about this chapter
    const recent = messages.slice(-40).map(m => `${m.role === 'user' ? 'המשתמש' : 'המורה'}: ${m.content}`).join('\n\n');

    const prompt = `המשתמש סיים ללמוד את הנושא: "${title}" בספר "${book.title}".

הנה השיחה האחרונה שלהם על הנושא:
${recent}

${previousChapters.length > 0 ? `נושאים קודמים שכבר נלמדו: ${previousChapters.map(c => c.title).join(', ')}` : ''}

תכין שני דברים בעברית:

1. **סיכום מורחב** (10-15 משפטים) — מה למדנו, מה המשתמש הביא מהחיים שלו, לאיזה מסקנות הגענו ביחד. שיקוף השיחה.

2. **גשר** ${previousChapters.length > 0 ? `(8-10 משפטים) — איך הנושא הזה מתחבר לנושאים הקודמים. איפה הם משלימים אחד את השני, איפה הם מתחזקים, איזה תמונה גדולה יותר עולה כשמחברים אותם.` : `(הנושא הראשון, אז כתוב משפט אחד שמסביר למה זה היסוד שעליו נבנה הכל)`}

החזר בפורמט הזה בדיוק:
---סיכום---
[הסיכום]
---גשר---
[הגשר]`;

    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-pro' });
    const result = await model.generateContent(prompt);
    const text = result.response.text();

    const sumMatch = text.match(/---סיכום---\s*([\s\S]*?)\s*---גשר---/);
    const brMatch = text.match(/---גשר---\s*([\s\S]*?)$/);

    const summary = sumMatch ? sumMatch[1].trim() : text;
    const bridge = brMatch ? brMatch[1].trim() : '';

    const chapter = db.addChapter(bookId, title, summary, bridge);
    res.json(chapter);
  } catch (err) {
    console.error('Complete chapter error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Chapter Q&A ───────────────────────────────────────────────────────────────
app.get('/api/chapters/:id/qa', (req, res) => {
  res.json(db.getChapterQA(req.params.id));
});

app.post('/api/chapters/:id/ask', async (req, res) => {
  try {
    const { question } = req.body;
    const chapter = db.getChapter(req.params.id);
    if (!chapter) return res.status(404).json({ error: 'פרק לא נמצא' });

    db.addChapterQA(chapter.id, 'user', question);

    const qaHistory = db.getChapterQA(chapter.id);
    const history = qaHistory.slice(-10, -1).map(q => ({
      role: q.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: q.content }]
    }));

    const systemPrompt = `אתה המורה הפרטי. המשתמש שואל שאלה על פרק שכבר סיים ללמוד.

הפרק: "${chapter.title}"

הסיכום של מה שלמדנו ביחד:
${chapter.summary}

${chapter.bridge ? `הקשר לנושאים אחרים:\n${chapter.bridge}` : ''}

ענה בעברית, קצר ומדויק, על סמך מה שלמדנו ביחד. אם המשתמש חופר — תאתגר אותו. אם הוא לא הבין משהו — תסביר אחרת.`;

    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-pro', systemInstruction: systemPrompt });
    const chat = model.startChat({ history });
    const result = await chat.sendMessage(question);
    const reply = result.response.text();

    db.addChapterQA(chapter.id, 'assistant', reply);
    res.json({ message: reply });
  } catch (err) {
    console.error('Chapter Q&A error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Text-to-Speech (Google Cloud TTS) ─────────────────────────────────────────
app.post('/api/tts', async (req, res) => {
  try {
    const { text, voice = 'he-IL-Wavenet-D', speakingRate = 1.0, pitch = -2.0 } = req.body;
    const apiKey = process.env.GOOGLE_TTS_API_KEY || process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'אין מפתח API' });
    if (!text || !text.trim()) return res.status(400).json({ error: 'טקסט ריק' });

    const response = await fetch(
      `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: { text: text.trim() },
          voice: { languageCode: 'he-IL', name: voice },
          audioConfig: { audioEncoding: 'MP3', speakingRate, pitch }
        })
      }
    );

    const data = await response.json();
    if (data.error) {
      console.error('TTS API error:', data.error.message);
      return res.status(500).json({ error: data.error.message });
    }
    res.json({ audio: data.audioContent });
  } catch (err) {
    console.error('TTS error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Other ─────────────────────────────────────────────────────────────────────
app.get('/api/insights', (req, res) => res.json(db.getInsights()));
app.get('/api/scripts', (req, res) => res.json(db.getScripts()));
app.get('/api/health', (req, res) => res.json({ ok: true }));

// In production, serve the built frontend
if (process.env.NODE_ENV === 'production') {
  const frontendDist = path.join(__dirname, '..', 'frontend', 'dist');
  app.use(express.static(frontendDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
}

process.on('uncaughtException', err => console.error('שגיאה:', err.message));
process.on('unhandledRejection', err => console.error('שגיאה async:', err?.message));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`✅ שרת פועל על פורט ${PORT}`));
