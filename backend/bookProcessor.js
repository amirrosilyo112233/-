/**
 * bookProcessor.js — shared book content extraction logic.
 *
 * Used by:
 *  - server.js (web upload via multipart form)
 *  - whatsapp.js (WhatsApp document message)
 *
 * Returns a string of extracted text content ready to save as book.content.
 */

const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');

let _genAI = null;
function genAI() {
  if (!_genAI) _genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  return _genAI;
}

/**
 * Extract readable text from a file buffer.
 *
 * @param {Buffer} buffer
 * @param {string} filename   e.g. "book.pdf" — used to detect type
 * @param {number} [index]    position in a multi-file upload (for labelling)
 * @param {number} [total]    total files in upload (for labelling)
 * @returns {Promise<string>} extracted text, or '' on failure
 */
async function extractContent(buffer, filename, index = 1, total = 1) {
  const ext = path.extname(filename).toLowerCase();
  const label = total > 1 ? `--- קובץ ${index} מתוך ${total}: ${filename} ---\n` : `--- ${filename} ---\n`;

  try {
    if (ext === '.pdf') {
      const pdfParse = require('pdf-parse');
      const data = await pdfParse(buffer);
      // Count REAL content chars (letters/digits), not whitespace.
      // A scanned PDF often returns kilobytes of pure whitespace which fooled the old check.
      const real = (data.text || '').replace(/\s+/g, '');
      if (real.length > 200) {
        return label + data.text.substring(0, 40000);
      }
      // Scanned PDF (or empty text layer) → Vision fallback
      // Buffer size guard: Gemini's inline data limit is ~20MB.
      if (buffer.length > 18 * 1024 * 1024) {
        return label + `(הקובץ סרוק (${(buffer.length / 1024 / 1024).toFixed(1)}MB) וגדול מדי ל-Vision. הרץ OCR קודם — למשל https://www.ilovepdf.com/ocr-pdf — והעלה את הקובץ המתורגם בחזרה.)`;
      }
      return label + await visionExtract(buffer, 'application/pdf',
        'תאר בפירוט מלא את כל התוכן של הקובץ הזה — כל הטקסט, הכותרות, הדיאגרמות, הטבלאות, וכל מידע חזותי חשוב. שמור על הסדר המקורי.');
    }

    if (ext === '.txt') {
      return label + buffer.toString('utf8').substring(0, 40000);
    }

    if (['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext)) {
      const mimeMap = { '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };
      const mimeType = mimeMap[ext] || 'image/jpeg';
      const prompt = `זוהי תמונה מספר ${index} מתוך ${total}. תאר בפירוט מלא את כל מה שכתוב בתמונה — טקסט, כותרות, רשימות, דיאגרמות, ציורים. אל תפרש או תוסיף — רק תאר את התוכן.`;
      return label + await visionExtract(buffer, mimeType, prompt);
    }

    // Unknown extension — try UTF-8 text
    const text = buffer.toString('utf8');
    if (text.length > 20) return label + text.substring(0, 40000);

    return label + '(סוג קובץ לא נתמך)';
  } catch (e) {
    console.error(`[bookProcessor] failed on ${filename}:`, e.message);
    return label + `(שגיאה בעיבוד: ${e.message.substring(0, 100)})`;
  }
}

async function visionExtract(buffer, mimeType, prompt) {
  const model = genAI().getGenerativeModel({ model: 'gemini-2.5-pro' });
  const b64 = buffer.toString('base64');
  const result = await model.generateContent([
    { inlineData: { data: b64, mimeType } },
    prompt
  ]);
  return result.response.text();
}

module.exports = { extractContent };
