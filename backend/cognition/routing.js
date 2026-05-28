/**
 * Cognitive Routing Agent — deterministic decision tree.
 *
 * Input:  AntiPseudoResult (+ optional context)
 * Output: { strategy: Strategy, instruction: string }
 *
 * No LLM. Pure rules. Fast (< 1ms). Easy to audit.
 *
 * Strategy → what the teacher should do this turn.
 * Instruction → a short directive prepended to the teacher's system prompt.
 */

const STRATEGIES = {
  CHALLENGE: 'CHALLENGE',
  BACKTRACK: 'BACKTRACK',
  EXPLAIN_DEEPER: 'EXPLAIN_DEEPER',
  EXAMPLE: 'EXAMPLE',
  MOVE_FORWARD: 'MOVE_FORWARD',
  WAIT_FOR_USER: 'WAIT_FOR_USER'
};

// Hebrew directives — short, surgical. Prepended to the existing buildPrompt.
// Designed to OVERRIDE the teacher's default "lecture-heavy" tendency.
const INSTRUCTIONS = {
  CHALLENGE:
    'הלומד חזר על המילים שלך בלי תוכן משלו. אל תרצה. ענה במשפט אחד בלבד: בקש שיסביר במילים שלו או יביא דוגמה מהחיים שלו. אל תוסיף הסברים. אל תוסיף מסגרות. אל תוסיף תוכן חדש.',
  BACKTRACK:
    'הלומד התחמק או ענה תשובה ריקה ("הבנתי", "כן", "אוקיי"). אסור לתת לזה לעבור. ענה ב-2 שורות בלבד: עצור, החזר אותו לנקודה האחרונה, ובקש הוכחה ספציפית להבנה (דוגמה, ניסוח שלו, מקרה מהשטח). אל תרצה. אל תרחיב.',
  EXPLAIN_DEEPER:
    'הלומד הבין חלקית. תעמיק את החלק שהוא פספס — לא תוסיף מסגרות חדשות, רק תחדד את מה שלא היה ברור. ענה קצר וממוקד (3-5 שורות).',
  EXAMPLE:
    'הלומד הבין את הרעיון אבל ברמה תיאורטית. תן דוגמה אחת קונקרטית מחיים אמיתיים — קצרה (4-6 שורות) — ושאל אותו לזהות את אותו דפוס במקרה משלו.',
  MOVE_FORWARD:
    'הלומד הראה הבנה אמיתית. תמשיך הלאה לנושא או לרמה הבאה. אל תחזור על מה שכבר ברור לו. תקדם.',
  WAIT_FOR_USER:
    'משוב מינימלי בלבד. אל תפתח נושא חדש. שאלה קצרה אחת או הכרה במה שנאמר.'
};

/**
 * @param {Object} args
 * @param {{signal: string, depth: number}} args.pseudo
 * @returns {{strategy: string, instruction: string, ruleId: string}}
 */
function decide({ pseudo }) {
  const { signal, depth } = pseudo || { signal: 'partial', depth: 1 };

  // ── Rule table (top-to-bottom; first match wins) ───────────────────────────
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
  // depth 0-1 with signal=genuine — odd combo, default to deeper explanation
  return { strategy: STRATEGIES.EXPLAIN_DEEPER, instruction: INSTRUCTIONS.EXPLAIN_DEEPER, ruleId: 'R6_genuine_shallow' };
}

module.exports = { decide, STRATEGIES, INSTRUCTIONS };
