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
 * Pick the user's active book — the most recently updated one.
 * In single-user MVP, this is almost always "the book they were last using".
 */
async function pickActiveBook() {
  const books = await db.getBooks();
  if (!books || books.length === 0) return null;
  return await db.getBook(books[0].id); // getBooks returns sorted by updated_at DESC
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
      const content = await extractContent(buf, fileName);

      const title = fileName.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ').trim() || 'ספר חדש';
      const book = await db.addBook({ title, language: 'en', content });

      await sendReply(chatId,
        `📚 *${book.title}* עלה בהצלחה!\n\nמסדר עכשיו את אינדקס החיפוש — בעוד כמה דקות תוכל לשאול אותי שאלות מהחומר ואני אצטט בדיוק.`,
        incomingMessageId
      );
      // Background RAG ingestion
      if (content.length > 100) {
        knowledgeMap.ingest(book.id, content).catch(e =>
          console.error('[whatsapp] RAG ingestion error:', e.message)
        );
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

  // ── Format + split + send ─────────────────────────────────────────────────
  const formatted = formatForWhatsApp(reply);
  const chunks = splitForWhatsApp(formatted, 900); // ~8 lines per message on mobile

  // First chunk: quote-reply to the original message
  await sendReply(chatId, chunks[0], incomingMessageId);

  // Subsequent chunks: plain follow-up, 800ms apart so they arrive as a readable sequence
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

module.exports = { handleIncomingWebhook, sendReply, sendReaction, transcribeAudio, notifyUser, normalizePhone, formatForWhatsApp, splitForWhatsApp };
