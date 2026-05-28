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

  // Extract text content (only text messages in MVP)
  let text = null;
  const m = payload.messageData;
  if (m?.typeMessage === 'textMessage') text = m.textMessageData?.textMessage;
  else if (m?.typeMessage === 'extendedTextMessage') text = m.extendedTextMessageData?.text;

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
    payload: { from: phone, messageLength: text.length, chatId, idMessage: incomingMessageId }
  });

  // ── Instant ack reaction so the user knows the bot is "thinking" ─────────
  // Fire-and-forget; doesn't block the cognition flow.
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

  // ── Format reply for WhatsApp + send as quote-reply to original message ──
  const formatted = formatForWhatsApp(reply);
  await sendReply(chatId, formatted, incomingMessageId);

  eventLog.log({
    type: 'whatsapp_sent',
    bookId: book.id,
    agent: 'whatsapp',
    payload: {
      to: phone,
      replyLength: formatted.length,
      originalLength: reply.length,
      chatId,
      quoted: !!incomingMessageId
    }
  });

  return { status: 'sent', bookId: book.id };
}

module.exports = { handleIncomingWebhook, sendReply, sendReaction, normalizePhone, formatForWhatsApp };
