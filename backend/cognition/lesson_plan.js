/**
 * Lesson Plan Agent
 *
 * When a book finishes indexing, generates a short learning roadmap
 * from the book content — main topics in suggested order, with a
 * one-line "why" for each.
 *
 * Used to send the user a "✅ ready" message that includes a concrete
 * map of the territory, not just "done!".
 */

const llm = require('./adapters/llm_adapter');

const MODEL = 'gemini-3.5-flash';

/**
 * Build a short Hebrew learning roadmap (4-6 topics) from book content.
 * Falls back to a generic message if generation fails.
 *
 * @param {string} bookTitle
 * @param {string} bookContent  (typically truncated upstream)
 * @returns {Promise<string>}   Hebrew roadmap text, ~400-700 chars
 */
async function build(bookTitle, bookContent) {
  if (!bookContent || bookContent.length < 200) {
    return '';
  }

  // Use just the first 8000 chars (typically TOC + opening) to keep this cheap & fast
  const sample = bookContent.substring(0, 8000);

  const prompt = `הספר: "${bookTitle}"

הנה פתיחת הספר:
"""
${sample}
"""

המשימה שלך: לבנות **מפת דרכים קצרה ללמידה** בעברית. לא לסכם — להציע סדר.

החזר בפורמט בדיוק כך:

🗺️ *מפת דרכים שאני מציע*

1. *[שם הנושא הראשון]* — שורה אחת למה זה הבסיס.
2. *[שם הנושא השני]* — שורה אחת למה זה אחרי הראשון.
3. *[הבא]* — שורה.
4. *[הבא]* — שורה.
5. *[הבא]* — שורה.

המלצה: נתחיל מ-1, כי [סיבה קצרה].

חוקים:
- 4-6 נושאים בלבד
- כל שורה עד 12 מילים
- שמות נושאים בעברית (גם אם הספר באנגלית) — הצמד למושג המדויק של המחבר
- בלי הסברים נוספים, רק המבנה לעיל`;

  try {
    const text = await llm.generate({ provider: 'gemini', model: MODEL, prompt });
    return (text || '').trim();
  } catch (e) {
    console.warn('[lesson_plan] generation failed:', e.message);
    return '';
  }
}

module.exports = { build };
