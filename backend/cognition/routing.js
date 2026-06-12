/**
 * Cognitive Routing Agent — deterministic decision tree.
 *
 * Input:  AntiPseudoResult (+ optional context: userMessage)
 * Output: { strategy: Strategy, instruction: string, ruleId: string }
 *
 * No LLM. Pure rules. Fast (< 1ms). Easy to audit.
 *
 * Updated May 2026:
 *   - Softer BACKTRACK / CHALLENGE language (mentor, not police)
 *   - New RICH_TEACHING strategy for genuine+deep+open-ended questions
 *     (flowing prose, weaves models together, no bullet lists)
 */

const STRATEGIES = {
  TEACH_MODEL: 'TEACH_MODEL',
  CHALLENGE: 'CHALLENGE',
  BACKTRACK: 'BACKTRACK',
  EXPLAIN_DEEPER: 'EXPLAIN_DEEPER',
  EXAMPLE: 'EXAMPLE',
  MOVE_FORWARD: 'MOVE_FORWARD',
  RICH_TEACHING: 'RICH_TEACHING',
  WAIT_FOR_USER: 'WAIT_FOR_USER'
};

// Hebrew directives — short, surgical. Prepended to the existing buildPrompt.
const INSTRUCTIONS = {
  TEACH_MODEL:
    'הלומד ביקש במפורש ללמוד מודל/נושא/ספר מהתחלה. הפעל את מנוע ההוראה המלא מהפרומפט: שיעור זורם שנפתח בסצנה מהעולם שלו (בלי שם המודל, בלי הגדרה), שאלה פתוחה, חשיפה, שם רק אחרי החוויה, שטח, גרסת 20 שניות, ושאלה אמיתית בסוף. חלק ל-3-5 הודעות עם שורת ⸻ בין כל אחת. התעלם מהיסטוריית שיחה שמושכת לכיוון אחר — זו התחלה חדשה.',
  CHALLENGE:
    'הלומד נתן תגובה שחוזרת על מה שאמרת בלי תוכן משלו. אל תמשיך לתוך תוכן חדש. במקום זה — שאל אותו במשפט אחד או שניים שינסח את הרעיון במילים שלו, או יביא דוגמה מהחיים שלו. שאל בחום, לא בעצירה דרמטית. בלי "🛑". בלי "עצור".',
  BACKTRACK:
    'התשובה הייתה קצרה מאוד ולא הראתה הבנה. שאל אותו שאלה אחת פתוחה וחמה שמזמינה אותו לספר מהחיים שלו. משפט אחד, טון של שותף לא שופט. לא "הוכח לי", לא "עצור", לא "אסור". פשוט שאלה שפותחת דלת.',
  EXPLAIN_DEEPER:
    'הלומד הבין חלקית. תעמיק את החלק שהוא פספס — לא תוסיף מסגרות חדשות, רק תחדד את מה שלא היה ברור. ענה קצר וממוקד (3-5 שורות).',
  EXAMPLE:
    'הלומד הבין את הרעיון אבל ברמה תיאורטית. תן דוגמה אחת קונקרטית מחיים אמיתיים — קצרה (4-6 שורות) — ושאל אותו לזהות את אותו דפוס במקרה משלו.',
  MOVE_FORWARD:
    'הלומד הראה הבנה אמיתית. תמשיך הלאה לנושא או לרמה הבאה. אל תחזור על מה שכבר ברור לו. תקדם.',
  RICH_TEACHING:
    'הלומד שאל שאלה עמוקה ופתוחה — הוא רוצה ללמוד, לא לקבל בולטים. ענה כפרק זורם, גוף ראשון ("אני חושב על זה ככה"), כורך את המודלים הרלוונטיים מהספר לשיטה אחת קוהרנטית. בלי בולטים. בלי רשימות. בלי כותרות מסגרות עם ═══. פסקאות בגובה העיניים, מטאפורות מהשטח של אמיר (אבא, מטפל לנוער בסיכון). 1500-2200 תווים — מספיק כדי להעמיק, לא יותר.',
  WAIT_FOR_USER:
    'משוב מינימלי בלבד. אל תפתח נושא חדש. שאלה קצרה אחת או הכרה במה שנאמר.'
};

/**
 * @param {Object} args
 * @param {{signal: string, depth: number}} args.pseudo
 * @param {string} [args.userMessage]   For RICH_TEACHING detection (length + question mark)
 * @returns {{strategy: string, instruction: string, ruleId: string}}
 */
function decide({ pseudo, userMessage }) {
  const { signal, depth } = pseudo || { signal: 'partial', depth: 1 };

  // ── Rule table (top-to-bottom; first match wins) ───────────────────────────

  // R-1: explicit teach-me request → full lesson engine, overrides classification.
  // "תלמד אותי X", "תלמד אותה", "נתחיל מהתחלה", "בוא נלמד", "נמשיך לפרק/מודל הבא"
  const teachMsg = (userMessage || '').trim();
  const TEACH_REQUEST = /(תלמד\s+אות|בוא\s+נלמד|נלמד\s+את|מהתחלה|נתחיל\s+את\s+(הפרק|המודל|הנושא|הספר)|(הפרק|המודל|הנושא)\s+הבא)/;
  if (TEACH_REQUEST.test(teachMsg)) {
    return { strategy: STRATEGIES.TEACH_MODEL, instruction: INSTRUCTIONS.TEACH_MODEL, ruleId: 'R_teach_request' };
  }

  // R0: deep + open question → rich teaching (NEW)
  // Triggers when user asks a genuine, substantive question (long, with ?)
  const msg = userMessage || '';
  const hasQuestion = msg.includes('?') || msg.includes('؟');
  const isLong = msg.length >= 60;
  if (signal === 'genuine' && depth >= 2 && hasQuestion && isLong) {
    return { strategy: STRATEGIES.RICH_TEACHING, instruction: INSTRUCTIONS.RICH_TEACHING, ruleId: 'R0_rich_question' };
  }

  if (signal === 'evasion') {
    return { strategy: STRATEGIES.BACKTRACK, instruction: INSTRUCTIONS.BACKTRACK, ruleId: 'R1_evasion' };
  }
  if (signal === 'parrot') {
    return { strategy: STRATEGIES.CHALLENGE, instruction: INSTRUCTIONS.CHALLENGE, ruleId: 'R2_parrot' };
  }
  if (signal === 'partial') {
    return { strategy: STRATEGIES.EXPLAIN_DEEPER, instruction: INSTRUCTIONS.EXPLAIN_DEEPER, ruleId: 'R3_partial' };
  }
  // signal === 'genuine'
  if (depth >= 3) {
    return { strategy: STRATEGIES.MOVE_FORWARD, instruction: INSTRUCTIONS.MOVE_FORWARD, ruleId: 'R4_genuine_deep' };
  }
  if (depth === 2) {
    return { strategy: STRATEGIES.EXAMPLE, instruction: INSTRUCTIONS.EXAMPLE, ruleId: 'R5_genuine_mid' };
  }
  // depth 0-1 with signal=genuine — default to deeper explanation
  return { strategy: STRATEGIES.EXPLAIN_DEEPER, instruction: INSTRUCTIONS.EXPLAIN_DEEPER, ruleId: 'R6_genuine_shallow' };
}

module.exports = { decide, STRATEGIES, INSTRUCTIONS };
