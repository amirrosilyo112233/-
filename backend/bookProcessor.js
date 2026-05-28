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
const fs = require('fs');
const os = require('os');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { GoogleAIFileManager, FileState } = require('@google/generative-ai/server');

let _genAI = null;
function genAI() {
  if (!_genAI) _genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  return _genAI;
}

let _fileManager = null;
function fileManager() {
  if (!_fileManager) _fileManager = new GoogleAIFileManager(process.env.GEMINI_API_KEY);
  return _fileManager;
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
      const real = (data.text || '').replace(/\s+/g, '');
      // Path A — PDF has a real text layer
      if (real.length > 200) {
        return label + data.text.substring(0, 200000);
      }
      // Path B — scanned PDF, no text layer → server-side OCR
      // Use Files API (handles any size) for full automatic extraction.
      const totalPages = data.numpages || 1;
      try {
        const ocrText = await extractScannedPdf(buffer, filename, totalPages);
        if (ocrText && ocrText.replace(/\s+/g, '').length > 200) {
          return label + ocrText.substring(0, 1000000);
        }
        return label + `(OCR לא הצליח לחלץ טקסט. ייתכן שהקובץ פגום.)`;
      } catch (e) {
        console.error(`[bookProcessor] OCR failed on ${filename}:`, e.message);
        return label + `(שגיאה ב-OCR: ${e.message.substring(0, 200)})`;
      }
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

/**
 * Server-side OCR for scanned PDFs of any size, via Gemini Files API + Pro.
 *
 * Flow:
 *  1. Save buffer to temp file
 *  2. Upload to Gemini Files API (handles up to 2GB)
 *  3. Wait until file is ACTIVE
 *  4. Extract text in batches of ~80 pages (Pro output limit ~65K tokens)
 *  5. Concatenate; delete remote file; remove temp
 *
 * @param {Buffer} buffer
 * @param {string} filename
 * @param {number} totalPages
 * @returns {Promise<string>} extracted text (all pages concatenated)
 */
async function extractScannedPdf(buffer, filename, totalPages) {
  console.log(`[bookProcessor] OCR pipeline starting: ${filename} (${(buffer.length/1024/1024).toFixed(1)}MB, ${totalPages} pages)`);

  // Write to temp
  const safeName = filename.replace(/[^a-zA-Z0-9_.-]/g, '_');
  const tmpPath = path.join(os.tmpdir(), `ocr-${Date.now()}-${safeName}`);
  fs.writeFileSync(tmpPath, buffer);

  let file = null;
  try {
    // Upload
    console.log(`[bookProcessor] uploading to Files API...`);
    const uploadResult = await fileManager().uploadFile(tmpPath, {
      mimeType: 'application/pdf',
      displayName: filename
    });
    file = uploadResult.file;

    // Wait for ACTIVE (poll every 3s, max 5 minutes)
    let waited = 0;
    while (file.state === FileState.PROCESSING && waited < 300000) {
      await new Promise(r => setTimeout(r, 3000));
      waited += 3000;
      file = await fileManager().getFile(file.name);
    }
    if (file.state !== FileState.ACTIVE) {
      throw new Error(`upload finished in state ${file.state}`);
    }
    console.log(`[bookProcessor] file ACTIVE (waited ${waited}ms). Beginning extraction.`);

    // Batched extraction
    const model = genAI().getGenerativeModel({ model: 'gemini-2.5-pro' });
    const PAGES_PER_BATCH = 80;
    const batches = Math.max(1, Math.ceil(totalPages / PAGES_PER_BATCH));
    const parts = [];

    for (let i = 0; i < batches; i++) {
      const startPage = i * PAGES_PER_BATCH + 1;
      const endPage = Math.min((i + 1) * PAGES_PER_BATCH, totalPages);

      const prompt = `חלץ את כל הטקסט מעמודים ${startPage} עד ${endPage} של ה-PDF הזה.
- כתוב את התוכן עמוד אחר עמוד ברצף, בלי הסברים שלך.
- בתחילת כל עמוד כתוב: [עמוד X]
- אל תדלג על כותרות, הערות שוליים, או תיבות צד
- שמור את השפה המקורית (אנגלית/עברית/מעורב)
- אם יש דיאגרמה — תאר אותה ב-3-5 מילים: [דיאגרמה: ...]`;

      console.log(`[bookProcessor] extracting batch ${i + 1}/${batches} (pages ${startPage}-${endPage})...`);
      const result = await model.generateContent([
        { fileData: { mimeType: 'application/pdf', fileUri: file.uri } },
        prompt
      ]);
      parts.push(result.response.text());

      // Brief pause between batches to be kind to API
      if (i < batches - 1) await new Promise(r => setTimeout(r, 1500));
    }

    const fullText = parts.join('\n\n');
    console.log(`[bookProcessor] extraction complete: ${fullText.length} chars from ${batches} batches`);
    return fullText;
  } finally {
    // Cleanup: delete remote file (saves quota) + temp file
    if (file?.name) {
      try { await fileManager().deleteFile(file.name); } catch (e) {
        console.warn('[bookProcessor] remote cleanup failed:', e.message);
      }
    }
    try { fs.unlinkSync(tmpPath); } catch (e) {}
  }
}

module.exports = { extractContent };
