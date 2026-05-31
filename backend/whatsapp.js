/**
 * WhatsApp integration via Green API.
 *
 * Host-shell module (NOT inside cognition/) — handles:
 *   - parsing incoming Green API webhook payloads
 *   - whitelist enforcement
 *   - routing to the user's most-recently-used book
 *   - sending replies back via Green API
 *   - emitting telemetry events
 *
 * The cognition capsule is invoked unchanged through coordinator.handleChatMessage.
 */

const db = require('./db');
const coordinator = require('./cognition/coordinator');
const eventLog = require('./cognition/event_log');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { extractContent } = require('./bookProcessor');
const knowledgeMap = require('./cognition/knowledge_map');
const lessonPlan = require('./cognition/lesson_plan');
const abTest = require('./cognition/ab_test');
const { generate: llmGen } = require('./cognition/adapters/llm_adapter');

// Lazy Gemini client for voice transcription (host code — not via llm_adapter)
let _gemini = null;
function gemini() {
  if (!_gemini) _gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  return _gemini;
}

// ── Config from env ──────────────────────────────────────────────────────────
function cfg() {
  return {
    instanceId: process.env.GREEN_API_INSTANCE,
    token: process.env.GREEN_API_TOKEN,
    apiUrl: process.env.GREEN_API_URL || 'https://api.greenapi.com',
    whitelist: (process.env.WHATSAPP_WHITELIST || '').split(',').map(s => s.trim()).filter(Boolean)
  };
}

/**
 * Normalize a Green API senderId to a plain digit string.
 *   "972587440557@c.us" → "972587440557"
 */
function normalizePhone(senderId) {
  if (!senderId) return null;
  return String(senderId).split('@')[0].replace(/\D/g, '');
}

/**
 * Split a long WhatsApp message into chunks at natural paragraph/sentence boundaries.
 * WhatsApp has no hard limit but >1300 chars = bad UX on mobile.
 * @param {string} text
 * @param {number} [maxChars=1300]
 * @returns {string[]}
 */
function splitForWhatsApp(text, maxChars = 1300) {
  if (!text || text.length <= maxChars) return [text];

  const chunks = [];
  const paragraphs = text.split(/\n{2,}/);
  let current = '';

  for (const para of paragraphs) {
    const candidate = current ? current + '\n\n' + para : para;
    if (candidate.length <= maxChars) {
      current = candidate;
    } else {
      // Flush current buffer if it has content
      if (current) { chunks.push(current.trim()); current = ''; }

      if (para.length <= maxChars) {
        current = para;
      } else {
        // Split oversized paragraph at sentence boundaries
        const parts = para.split(/(?<=[.!?])\s+/);
        for (const part of parts) {
          const cand = current ? current + ' ' + part : part;
          if (cand.length <= maxChars) {
            current = cand;
          } else {
            if (current) { chunks.push(current.trim()); }
            current = part;
          }
        }
      }
    }
  }
  if (current) chunks.push(current.trim());
  return chunks.filter(Boolean);
}

/**
 * Convert Gemini-flavored markdown to WhatsApp's text formatting syntax.
 * - **bold** → *bold*
 * - __italic__ or *italic* (single, non-bold) → _italic_
 * - ## Title / # Title → *Title*
 * - markdown bullets (* or -) → • bullet character
 * - code fences ``` are kept (WhatsApp supports them)
 * - excessive blank lines collapsed (3+ newlines → 2)
 */
function formatForWhatsApp(text) {
  if (!text) return text;
  let s = text;

  // Headers (## or # at line start) → bold line
  s = s.replace(/^#{1,6}\s+(.+)$/gm, '*$1*');

  // **bold** → *bold*  (do this BEFORE single-asterisk italics)
  s = s.replace(/\*\*(.+?)\*\*/g, '*$1*');

  // markdown bullets at line start: "* item" or "- item" → "• item"
  // (but only if it's clearly a list marker, not part of emphasis)
  s = s.replace(/^(\s*)[*\-]\s+/gm, '$1• ');

  // __italic__ → _italic_
  s = s.replace(/__([^_]+)__/g, '_$1_');

  // Collapse 3+ blank lines to 2
  s = s.replace(/\n{3,}/g, '\n\n');

  // Trim trailing whitespace per line
  s = s.split('\n').map(line => line.replace(/[ \t]+$/, '')).join('\n');

  return s.trim();
}

/**
 * Send a text message via Green API.
 * @param {string} chatId             e.g. "972587440557@c.us"
 * @param {string} text               message body
 * @param {string} [quotedMessageId]  optional Green API message id to quote-reply to
 */
async function sendReply(chatId, text, quotedMessageId) {
  const { instanceId, token, apiUrl } = cfg();
  if (!instanceId || !token) {
    throw new Error('GREEN_API_INSTANCE or GREEN_API_TOKEN not set');
  }
  const base = apiUrl.replace(/\/+$/, '');
  const url = `${base}/waInstance${instanceId}/sendMessage/${token}`;
  const body = { chatId, message: text };
  if (quotedMessageId) body.quotedMessageId = quotedMessageId;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`Green API sendMessage failed: ${res.status} ${errBody.substring(0, 300)}`);
  }
  return res.json();
}

/**
 * Download an audio file from a URL and transcribe it to Hebrew text via Gemini.
 * Returns the transcript or throws.
 * @param {string} downloadUrl
 * @param {string} [mimeType]   defaults to 'audio/ogg' (WhatsApp PTT format)
 * @returns {Promise<{ text: string, durationMs: number, mimeType: string, sizeBytes: number }>}
 */
async function transcribeAudio(downloadUrl, mimeType) {
  const t0 = Date.now();
  const res = await fetch(downloadUrl);
  if (!res.ok) throw new Error(`download failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const sizeBytes = buf.length;
  const detectedMime = mimeType || res.headers.get('content-type')?.split(';')[0]?.trim() || 'audio/ogg';
  const base64 = buf.toString('base64');

  const model = gemini().getGenerativeModel({ model: 'gemini-3.5-flash' });
  const result = await model.generateContent([
    { inlineData: { data: base64, mimeType: detectedMime } },
    'תמלל את ההקלטה הזו לעברית בלבד. החזר אך ורק את הטקסט המדויק שנאמר — בלי הסברים, בלי כותרות, בלי הערות שלך. אם ההקלטה ריקה או לא מובנת, החזר את המחרוזת "[לא ברור]".'
  ]);
  const text = (result.response.text() || '').trim();
  return { text, durationMs: Date.now() - t0, mimeType: detectedMime, sizeBytes };
}

/**
 * Generate Hebrew speech from text via Google Cloud TTS and send to WhatsApp
 * as a voice note. Uses OGG_OPUS so it appears as a proper voice message
 * (round play button), not as a file attachment.
 *
 * @param {string} chatId           e.g. "972587440557@c.us"
 * @param {string} text             text to speak (markdown will be stripped)
 * @param {string} [quotedMessageId] optional message to quote-reply to
 * @returns {Promise<{ durationMs: number, audioBytes: number, charsSpoken: number }>}
 */
async function sendVoiceReply(chatId, text, quotedMessageId) {
  const t0 = Date.now();
  const apiKey = process.env.GOOGLE_TTS_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_TTS_API_KEY (or GEMINI_API_KEY) not set');

  // Clean text for natural speech:
  //   - strip markdown formatting chars
  //   - remove emojis and decorative symbols
  //   - collapse divider lines and excess whitespace
  const cleanText = (text || '')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/[`~]/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^---+\s*$/gm, '')
    .replace(/^•\s+/gm, '')
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, '')
    .replace(/[\u{2600}-\u{27BF}]/gu, '')
    .replace(/[\u{1F000}-\u{1F02F}]/gu, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!cleanText) throw new Error('text empty after markdown cleanup');

  // Google TTS hard limit is 5000 chars; we cap a bit lower for safety
  const truncated = cleanText.substring(0, 4800);

  // Synthesize speech (Hebrew Wavenet — deep male voice that matches the warm tutor persona)
  const ttsRes = await fetch(
    `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: { text: truncated },
        voice: { languageCode: 'he-IL', name: 'he-IL-Wavenet-D' },
        audioConfig: { audioEncoding: 'OGG_OPUS', speakingRate: 1.05, pitch: -1.0 }
      })
    }
  );
  const data = await ttsRes.json();
  if (data.error) throw new Error(`TTS API: ${data.error.message}`);
  if (!data.audioContent) throw new Error('TTS returned no audio');

  const audioBuffer = Buffer.from(data.audioContent, 'base64');

  // Send via Green API as voice note (OGG/Opus → shows as proper WhatsApp voice msg)
  const { instanceId, token, apiUrl } = cfg();
  if (!instanceId || !token) throw new Error('Green API credentials missing');
  const base = apiUrl.replace(/\/+$/, '');
  const url = `${base}/waInstance${instanceId}/sendFileByUpload/${token}`;

  const form = new FormData();
  form.append('chatId', chatId);
  form.append('file', new Blob([audioBuffer], { type: 'audio/ogg' }), 'voice.ogg');
  if (quotedMessageId) form.append('quotedMessageId', quotedMessageId);

  const sendRes = await fetch(url, { method: 'POST', body: form });
  if (!sendRes.ok) {
    const body = await sendRes.text().catch(() => '');
    throw new Error(`Green API sendFileByUpload failed: ${sendRes.status} ${body.substring(0, 200)}`);
  }

  return {
    durationMs: Date.now() - t0,
    audioBytes: audioBuffer.length,
    charsSpoken: truncated.length
  };
}

/**
 * Send a reaction emoji to a specific message via Green API.
 * Fire-and-forget; failures are logged but do not propagate.
 */
async function sendReaction(chatId, messageId, emoji) {
  try {
    const { instanceId, token, apiUrl } = cfg();
    if (!instanceId || !token || !messageId) return;
    const base = apiUrl.replace(/\/+$/, '');
    const url = `${base}/waInstance${instanceId}/sendReaction/${token}`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId, messageId, reaction: emoji })
    });
  } catch (e) {
    console.warn('[whatsapp] sendReaction failed:', e.message);
  }
}

/**
 * Pick the user's active book.
 * Priority: profile.active_book_id (explicit) → most recently updated book.
 */
async function pickActiveBook() {
  const explicitId = await db.getActiveBookId();
  if (explicitId) {
    const book = await db.getBook(explicitId);
    if (book) return book;
  }
  const books = await db.getBooks();
  if (!books || books.length === 0) return null;
  return await db.getBook(books[0].id);
}

/**
 * Format a status overview of all books for WhatsApp.
 */
async function formatBooksOverview() {
  const books = await db.getBooks();
  const activeId = await db.getActiveBookId();
  if (!books || books.length === 0) {
    return '📚 הספרייה ריקה. תעלה PDF דרך הוואטסאפ הזה או דרך האתר ונתחיל.';
  }

  const lines = ['📚 *הספרייה שלך:*\n'];
  books.forEach((b, idx) => {
    const num = idx + 1;
    const isActive = b.id === activeId || (!activeId && idx === 0);
    const indexed = b.indexed_at ? '✅ אינדקס מוכן' : '⏳ אינדקס בעיבוד';
    const topics = Array.isArray(b.completed_topics) ? b.completed_topics
      : (typeof b.completed_topics === 'string' ? JSON.parse(b.completed_topics || '[]') : []);
    const topicsLine = topics.length > 0 ? `📖 ${topics.length} נושאים נלמדו` : '📖 התחלה';
    const where = b.current_chapter ? `📍 ${b.current_chapter}` : '';
    const star = isActive ? '👈 *פעיל*' : '';
    lines.push(`*${num}. ${b.title}* ${star}`);
    lines.push(`   ${indexed}`);
    lines.push(`   ${topicsLine}`);
    if (where) lines.push(`   ${where}`);
    lines.push('');
  });

  lines.push('---');
  lines.push('*פקודות:*');
  lines.push('• */ספר 2* — להחליף ספר פעיל');
  lines.push('• */אינדקס 1* — לאנדקס ספר שעדיין לא מוכן');
  lines.push('• */יומן [טקסט]* — להוסיף ליומן השטח');
  lines.push('• */קול* / */טקסט* — להפעיל/לבטל תשובות קוליות');
  lines.push('• */השווה [שאלה]* — להריץ אותה שאלה ב-Gemini Flash + GPT-5 Mini');
  lines.push('• */השווה pro [שאלה]* — להריץ ב-Gemini Pro + GPT-5');

  return lines.join('\n');
}

/**
 * Try to handle the message as a command. Returns true if handled.
 */
async function tryCommand(chatId, text, incomingMessageId, phone) {
  const t = (text || '').trim();
  if (!t) return false;

  const lc = t.toLowerCase();

  // ── A/B vote: bare "1" / "2" / "3" within vote window of a recent comparison
  if (/^[123]$/.test(t)) {
    const result = await abTest.recordVote(phone, parseInt(t, 10));
    if (result.recorded) {
      const labels = { 1: '🟢 Gemini', 2: '🔵 OpenAI', 3: '⚖️ תיקו' };
      await sendReply(chatId, `📊 הצבעה נרשמה: ${labels[parseInt(t, 10)]}\n\nתודה — עוזר לנו למדוד איכות לאורך זמן.`, incomingMessageId);
      return true;
    }
    // No pending comparison → fall through; user might have meant something else.
  }

  // ── A/B comparison: /השווה [pro|שיעור] <text>
  const compareMatch = t.match(/^\/?(?:השווה|compare)(?:\s+(pro|שיעור|lesson))?\s+([\s\S]+)$/i);
  if (compareMatch && compareMatch[2].trim().length > 2) {
    const modifier = (compareMatch[1] || '').toLowerCase();
    const payload = compareMatch[2].trim();
    const isLesson = modifier === 'שיעור' || modifier === 'lesson';
    const mode = modifier === 'pro' ? 'pro' : 'fast';
    const type = isLesson ? 'lesson' : 'question';

    const activeBook = await pickActiveBook();
    if (!activeBook) {
      await sendReply(chatId, '❌ אין ספר פעיל. שלח */ספרים* לרשימה ובחר ספר.', incomingMessageId);
      return true;
    }

    sendReaction(chatId, incomingMessageId, '🆎');
    const baselineLabel = mode === 'pro' ? 'Gemini 2.5 Pro' : 'Gemini 3.5 Flash';
    const challengerLabel = mode === 'pro' ? 'GPT-5' : 'GPT-5 Mini';
    await sendReply(chatId,
      `⏳ מריץ את אותה שאלה ב-${baselineLabel} וגם ב-${challengerLabel}. זה ייקח ${mode === 'pro' ? '20-40' : '10-20'} שניות...`,
      incomingMessageId
    );

    const result = await abTest.compareProviders({
      bookId: activeBook.id, mode, type, payload, userPhone: phone
    });

    if (!result.ok && result.error) {
      await sendReply(chatId, `❌ ההשוואה נכשלה: ${result.error}`, incomingMessageId);
      return true;
    }

    const formatSide = (icon, label, side) => {
      if (!side.ok) return `${icon} *${label}* — שגיאה: ${side.error || 'unknown'}`;
      const head = `${icon} *${label}* _(${(side.ms / 1000).toFixed(1)}s)_`;
      const formatted = formatForWhatsApp(side.text || '');
      return `${head}\n\n${formatted}`;
    };

    // Send baseline first, then challenger
    const baseChunks = splitForWhatsApp(formatSide('🟢', baselineLabel, result.baseline), 1200);
    for (let i = 0; i < baseChunks.length; i++) {
      await sendReply(chatId, baseChunks[i]);
      if (i < baseChunks.length - 1) await new Promise(r => setTimeout(r, 700));
    }
    await new Promise(r => setTimeout(r, 900));
    const chalChunks = splitForWhatsApp(formatSide('🔵', challengerLabel, result.challenger), 1200);
    for (let i = 0; i < chalChunks.length; i++) {
      await sendReply(chatId, chalChunks[i]);
      if (i < chalChunks.length - 1) await new Promise(r => setTimeout(r, 700));
    }

    await new Promise(r => setTimeout(r, 700));
    await sendReply(chatId,
      `📊 *איזה היה טוב יותר?*\n\nשלח לי:\n• *1* — 🟢 Gemini\n• *2* — 🔵 OpenAI\n• *3* — ⚖️ תיקו\n\n_(עוזר לנו למדוד איכות לאורך זמן)_`
    );
    return true;
  }

  // Help / list books
  if (/^(\/?ספרים|\/?רשימה|\/?ספריה|איזה ספרים|מה יש לי|איפה אנחנו|\/list|\/books|\/help)\b/i.test(lc)) {
    const overview = await formatBooksOverview();
    await sendReply(chatId, overview, incomingMessageId);
    return true;
  }

  // Switch active book: "/ספר N" or "/book N" or "עבור ל N"
  const switchMatch = t.match(/^(?:\/?ספר|\/?book|עבור\s*ל-?)\s+(\d+)\b/i);
  if (switchMatch) {
    const idx = parseInt(switchMatch[1], 10) - 1;
    const books = await db.getBooks();
    if (idx < 0 || idx >= books.length) {
      await sendReply(chatId, `❌ אין ספר במספר ${idx + 1}. שלח */ספרים* כדי לראות את הרשימה.`, incomingMessageId);
      return true;
    }
    const target = books[idx];
    await db.setActiveBookId(target.id);
    await sendReply(chatId, `✅ עברנו ל-*${target.title}*. כל שאלה שתשאל מכאן והלאה תופנה לספר הזה.`, incomingMessageId);
    return true;
  }

  // Field log entry: starts with "יומן" or "/יומן" — save to journal + brief AI response
  const journalMatch = t.match(/^(?:\/?יומן|\/?journal|\/?log)\s*:?\s*([\s\S]+)$/i);
  if (journalMatch && journalMatch[1].trim().length > 5) {
    const entry = journalMatch[1].trim();
    const activeBook = await pickActiveBook();
    const bookId = activeBook?.id || null;
    const bookTitle = activeBook?.title || '';

    try {
      const prompt = `אמיר כתב ביומן השטח שלו: "${entry}"\n${bookTitle ? `הספר הפעיל: ${bookTitle}` : ''}\nתגיב בעברית בקצר (2-4 משפטים): שאל שאלת עומק אחת, חבר לחומר אם רלוונטי, הצע משהו קונקרטי לנסות מחר.`;
      const aiText = await llmGen({ provider: 'gemini', model: 'gemini-3.5-flash', prompt });
      await db.addFieldLog(bookId, entry, aiText);
      await sendReply(chatId, `📔 *נשמר ביומן*\n\n${aiText}`, incomingMessageId);
      eventLog.log({ type: 'field_log_added', agent: 'whatsapp', bookId, payload: { from: phone, entryLength: entry.length } });
    } catch (e) {
      console.error('[whatsapp] field log error:', e.message);
      await db.addFieldLog(bookId, entry, '');
      await sendReply(chatId, `📔 *נשמר ביומן* (שגיאה בתגובת AI)`, incomingMessageId);
    }
    return true;
  }

  // Toggle voice replies on
  if (/^(\/?קול|\/?voice|ענה\s+ב?קול)\b/i.test(lc)) {
    await db.setVoicePref(true);
    await sendReply(chatId, `🔊 מצב קולי *פעיל*. כשתשלח לי הודעה קולית — אענה בקול. הודעות טקסט יישארו טקסט.\n\nלכיבוי שלח: */טקסט*`, incomingMessageId);
    return true;
  }
  // Toggle voice replies off
  if (/^(\/?טקסט|\/?text|ענה\s+ב?טקסט|בלי\s+קול)\b/i.test(lc)) {
    await db.setVoicePref(false);
    await sendReply(chatId, `📝 מצב טקסט בלבד. אענה רק בכתב.\n\nלהפעלת קול שלח: */קול*`, incomingMessageId);
    return true;
  }

  // Reindex: "/אינדקס N" or "/reindex N"
  const reindexMatch = t.match(/^(?:\/?אינדקס|\/?reindex|\/?index)\s+(\d+)\b/i);
  if (reindexMatch) {
    const idx = parseInt(reindexMatch[1], 10) - 1;
    const books = await db.getBooks();
    if (idx < 0 || idx >= books.length) {
      await sendReply(chatId, `❌ אין ספר במספר ${idx + 1}.`, incomingMessageId);
      return true;
    }
    const target = await db.getBook(books[idx].id);
    if (!target.content || target.content.length < 100) {
      await sendReply(chatId, `❌ אין מספיק תוכן בספר *${target.title}* כדי לאנדקס.`, incomingMessageId);
      return true;
    }
    await sendReply(chatId, `🔄 מתחיל לאנדקס את *${target.title}*. זה ירוץ ברקע, ייקח 2-5 דקות. אחר כך הוא יציין מהקטעים בדיוק.`, incomingMessageId);
    knowledgeMap.ingest(target.id, target.content).catch(e =>
      console.error('[whatsapp] manual reindex error:', e.message)
    );
    return true;
  }

  return false;
}

/**
 * Process an incoming Green API webhook payload.
 * Returns one of: 'sent' | 'skipped:reason'.
 */
async function handleIncomingWebhook(payload) {
  const { whitelist } = cfg();

  // Green API "incomingMessageReceived" payload shape:
  //   { typeWebhook: 'incomingMessageReceived',
  //     senderData: { chatId: '...@c.us', sender: '...@c.us', senderName, chatName },
  //     messageData: { typeMessage: 'textMessage', textMessageData: { textMessage: '...' } },
  //     ... }
  if (!payload || payload.typeWebhook !== 'incomingMessageReceived') {
    return { status: 'skipped', reason: 'not an incoming message webhook' };
  }

  const senderRaw = payload.senderData?.sender || payload.senderData?.chatId;
  const phone = normalizePhone(senderRaw);
  const chatId = payload.senderData?.chatId; // we reply to the same chatId
  const incomingMessageId = payload.idMessage; // for quote-reply + ack-reaction

  // ── Extract content (text directly, or voice → transcribe) ──────────────
  let text = null;
  let voiceMeta = null; // populated when message was a voice note
  const m = payload.messageData;

  if (m?.typeMessage === 'textMessage') {
    text = m.textMessageData?.textMessage;
  } else if (m?.typeMessage === 'extendedTextMessage') {
    text = m.extendedTextMessageData?.text;
  } else if (m?.typeMessage === 'audioMessage' || m?.typeMessage === 'pttMessage') {
    // Voice note — download + transcribe via Gemini
    const fd = m.fileMessageData || {};
    const downloadUrl = fd.downloadUrl;
    const mimeType = fd.mimeType;
    if (!downloadUrl) {
      eventLog.log({ type: 'whatsapp_skipped', agent: 'whatsapp', payload: { reason: 'audio_no_url', from: phone, typeMessage: m.typeMessage } });
      return { status: 'skipped', reason: 'audio without download url' };
    }
    // Instant ack so user knows the bot is processing the voice note
    sendReaction(chatId, incomingMessageId, '🎙️');
    try {
      const t = await transcribeAudio(downloadUrl, mimeType);
      text = t.text;
      voiceMeta = { durationMs: t.durationMs, mimeType: t.mimeType, sizeBytes: t.sizeBytes };
      eventLog.log({
        type: 'voice_transcribed',
        agent: 'whatsapp',
        payload: { from: phone, sizeBytes: t.sizeBytes, mimeType: t.mimeType, transcriptLength: text.length },
        latencyMs: t.durationMs
      });
      if (!text || text === '[לא ברור]') {
        await sendReply(chatId, '🎙️ שמעתי את ההודעה אבל לא הצלחתי להבין. נסה שוב או כתוב בטקסט.', incomingMessageId);
        return { status: 'skipped', reason: 'unclear voice' };
      }
    } catch (err) {
      eventLog.log({ type: 'voice_failed', agent: 'whatsapp', payload: { from: phone, error: err.message } });
      await sendReply(chatId, '🎙️ ניסיתי לתמלל אבל לא הצלחתי. נסה שוב או כתוב בטקסט.', incomingMessageId);
      return { status: 'skipped', reason: 'transcription failed' };
    }
  }

  // ── Document upload (PDF / image / txt) ─────────────────────────────────
  if (!text && (m?.typeMessage === 'documentMessage' || m?.typeMessage === 'imageMessage')) {
    const fd = m.fileMessageData || m.imageMessageData || {};
    const downloadUrl = fd.downloadUrl;
    const fileName = fd.fileName || (m.typeMessage === 'imageMessage' ? 'image.jpg' : 'document.pdf');

    if (!downloadUrl) {
      eventLog.log({ type: 'whatsapp_skipped', agent: 'whatsapp', payload: { reason: 'doc_no_url', from: phone } });
      return { status: 'skipped', reason: 'document without download url' };
    }

    sendReaction(chatId, incomingMessageId, '📚');
    try {
      const fileRes = await fetch(downloadUrl);
      if (!fileRes.ok) throw new Error(`download failed: ${fileRes.status}`);
      const buf = Buffer.from(await fileRes.arrayBuffer());

      // For larger PDFs, let user know it'll take a few minutes (OCR pipeline)
      if (buf.length > 5 * 1024 * 1024) {
        await sendReply(chatId,
          `📚 קובץ של ${(buf.length / 1024 / 1024).toFixed(1)}MB התקבל. עיבוד וOCR ייקח כמה דקות, אעדכן אותך כשמוכן.`,
          incomingMessageId
        );
      }

      const content = await extractContent(buf, fileName);

      const title = fileName.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ').trim() || 'ספר חדש';

      // Content quality check — fail fast if extraction returned almost nothing
      const realContent = (content || '').replace(/\s+/g, '');
      if (realContent.length < 500) {
        await sendReply(chatId,
          `⚠️ *${title}* — חילצתי רק ${realContent.length} תווים אמיתיים. זה נראה כמו PDF סרוק (תמונות, לא טקסט).\n\nפתרון: עבור ל-https://www.ilovepdf.com/ocr-pdf, העלה את הקובץ, הורד את הגרסה עם OCR, והעלה אותה לכאן.\n\nאני לא יוצר ספר ריק.`,
          incomingMessageId
        );
        eventLog.log({ type: 'whatsapp_upload_low_content', agent: 'whatsapp', payload: { from: phone, fileName, realChars: realContent.length } });
        return { status: 'skipped', reason: 'low content quality' };
      }

      const book = await db.addBook({ title, language: 'en', content });

      await sendReply(chatId,
        `📚 *${book.title}* עלה בהצלחה (${(realContent.length / 1000).toFixed(0)}K תווים אמיתיים)!\n\nמסדר עכשיו אינדקס...`,
        incomingMessageId
      );
      // Background RAG ingestion → roadmap → notify on completion
      if (content.length > 100) {
        knowledgeMap.ingest(book.id, content)
          .then(async () => {
            const roadmap = await lessonPlan.build(book.title, content);
            const msg = roadmap
              ? `✅ *${book.title}* מוכן ללמידה!\n\n${roadmap}\n\n_ספר לי מאיפה להתחיל או שאל משהו ספציפי._`
              : `✅ *${book.title}* מוכן ללמידה!`;
            await sendReply(chatId, msg);
          })
          .catch(e => console.error('[whatsapp] RAG ingestion error:', e.message));
      }
      eventLog.log({ type: 'whatsapp_book_uploaded', agent: 'whatsapp', bookId: book.id, payload: { from: phone, title: book.title, fileName } });
      return { status: 'book_uploaded', bookId: book.id };
    } catch (err) {
      await sendReply(chatId, `⚠️ לא הצלחתי לעבד את הקובץ: ${err.message.substring(0, 100)}. נסה שוב או העלה דרך האתר.`, incomingMessageId);
      eventLog.log({ type: 'whatsapp_upload_failed', agent: 'whatsapp', payload: { from: phone, error: err.message } });
      return { status: 'skipped', reason: 'document processing failed' };
    }
  }

  if (!text) {
    eventLog.log({ type: 'whatsapp_skipped', agent: 'whatsapp', payload: { reason: 'no_text', from: phone, typeMessage: m?.typeMessage } });
    return { status: 'skipped', reason: 'unsupported message type' };
  }

  // ── Try command handlers BEFORE running cognition ────────────────────────
  // /ספרים, /ספר N, /אינדקס N, etc.
  if (await tryCommand(chatId, text, incomingMessageId, phone)) {
    eventLog.log({ type: 'whatsapp_command', agent: 'whatsapp', payload: { from: phone, text: text.substring(0, 60) } });
    return { status: 'command_handled' };
  }

  // ── Whitelist gate ───────────────────────────────────────────────────────
  if (whitelist.length === 0) {
    eventLog.log({ type: 'whatsapp_skipped', agent: 'whatsapp', payload: { reason: 'whitelist_empty', from: phone } });
    return { status: 'skipped', reason: 'whitelist not configured' };
  }
  if (!whitelist.includes(phone)) {
    eventLog.log({ type: 'whatsapp_skipped', agent: 'whatsapp', payload: { reason: 'not_whitelisted', from: phone } });
    return { status: 'skipped', reason: 'sender not in whitelist' };
  }

  // ── Find active book ─────────────────────────────────────────────────────
  const book = await pickActiveBook();
  if (!book) {
    await sendReply(chatId, 'אין ספר פעיל באפליקציה. פתח ספר באתר ואז כתוב שוב.');
    eventLog.log({ type: 'whatsapp_skipped', agent: 'whatsapp', payload: { reason: 'no_active_book', from: phone } });
    return { status: 'skipped', reason: 'no active book' };
  }

  eventLog.log({
    type: 'whatsapp_received',
    bookId: book.id,
    agent: 'whatsapp',
    payload: {
      from: phone,
      messageLength: text.length,
      chatId,
      idMessage: incomingMessageId,
      source: voiceMeta ? 'voice' : 'text',
      voice: voiceMeta || undefined
    }
  });

  // ── Instant ack reaction so the user knows the bot is "thinking" ─────────
  // (For voice, we already sent 🎙️ above; this 👀 indicates cognition started.)
  sendReaction(chatId, incomingMessageId, '👀');

  // ── Save user message + run cognition ────────────────────────────────────
  await db.addMessage(book.id, 'user', text);
  const recentMessages = await db.getRecentMessages(book.id, 20);
  const profile = await db.getProfile();

  const { reply } = await coordinator.handleChatMessage({
    bookId: book.id,
    userMessage: text,
    profile,
    book,
    recentMessages
  });

  await db.addMessage(book.id, 'assistant', reply);
  await db.updateBook(book.id, {});

  // ── Format + decide delivery mode ─────────────────────────────────────────
  const formatted = formatForWhatsApp(reply);

  // Voice replies require explicit opt-in via /קול command (default off)
  const voicePrefOn = await db.getVoicePref();

  // Speak back ONLY if (a) user spoke AND (b) opted in
  if (voiceMeta && voicePrefOn) {
    try {
      const v = await sendVoiceReply(chatId, formatted, incomingMessageId);
      eventLog.log({
        type: 'whatsapp_sent',
        bookId: book.id,
        agent: 'whatsapp',
        payload: {
          to: phone,
          mode: 'voice',
          replyLength: formatted.length,
          charsSpoken: v.charsSpoken,
          audioBytes: v.audioBytes,
          chatId,
          quoted: !!incomingMessageId
        },
        latencyMs: v.durationMs
      });
      return { status: 'sent', bookId: book.id, mode: 'voice' };
    } catch (e) {
      console.warn('[whatsapp] voice reply failed, falling back to text:', e.message);
      eventLog.log({ type: 'voice_reply_failed', agent: 'whatsapp', payload: { error: e.message, from: phone } });
      // Fall through to text reply below
    }
  }

  // Text mode (default, or voice fallback)
  const chunks = splitForWhatsApp(formatted, 900);
  await sendReply(chatId, chunks[0], incomingMessageId);
  for (let i = 1; i < chunks.length; i++) {
    await new Promise(r => setTimeout(r, 800));
    await sendReply(chatId, chunks[i]);
  }

  eventLog.log({
    type: 'whatsapp_sent',
    bookId: book.id,
    agent: 'whatsapp',
    payload: {
      to: phone,
      mode: 'text',
      replyLength: formatted.length,
      originalLength: reply.length,
      chunks: chunks.length,
      chatId,
      quoted: !!incomingMessageId
    }
  });

  return { status: 'sent', bookId: book.id };
}

/**
 * Send a notification to the first number in the whitelist.
 * Used by server.js to notify the user when a web-app upload completes.
 * Fire-and-forget — failures are logged but not thrown.
 */
async function notifyUser(text) {
  try {
    const { whitelist } = cfg();
    if (!whitelist.length) return;
    const chatId = whitelist[0] + '@c.us';
    await sendReply(chatId, text);
  } catch (e) {
    console.warn('[whatsapp] notifyUser failed:', e.message);
  }
}

module.exports = { handleIncomingWebhook, sendReply, sendReaction, sendVoiceReply, transcribeAudio, notifyUser, normalizePhone, formatForWhatsApp, splitForWhatsApp };
