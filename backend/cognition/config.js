/**
 * Cognition config — central registry of providers and models.
 *
 * Phase A (current):
 *   - Teacher defaults unchanged (Gemini Flash + Pro hybrid).
 *   - A/B test config exposes "fast" and "pro" comparison modes.
 *
 * All values are env-overridable. Default keeps the live behaviour intact.
 */

module.exports = {
  // The teacher's main path. Today still hardcoded inside teacher.js;
  // exposed here for future centralization without breaking that path.
  teacher: {
    default: {
      provider: process.env.TEACHER_PROVIDER || 'gemini',
      model: process.env.TEACHER_MODEL || 'gemini-3.5-flash'
    },
    deep: {
      provider: process.env.TEACHER_DEEP_PROVIDER || 'gemini',
      model: process.env.TEACHER_DEEP_MODEL || 'gemini-2.5-pro'
    }
  },

  // A/B comparison — top-of-line Gemini vs top-of-line OpenAI.
  // Mode "fast" = mid-tier models; mode "pro" = flagship models.
  abTest: {
    fast: {
      baseline: {
        provider: 'gemini',
        model: process.env.AB_FAST_BASELINE || 'gemini-3.5-flash'
      },
      challenger: {
        provider: 'openai',
        model: process.env.AB_FAST_CHALLENGER || 'gpt-5-mini'
      }
    },
    pro: {
      baseline: {
        provider: 'gemini',
        model: process.env.AB_PRO_BASELINE || 'gemini-2.5-pro'
      },
      challenger: {
        provider: 'openai',
        model: process.env.AB_PRO_CHALLENGER || 'gpt-5'
      }
    },
    // Soft timeout per provider call. After this we report failure for that side
    // but still deliver whichever side did return in time.
    timeoutMs: parseInt(process.env.AB_TIMEOUT_MS, 10) || 60000,

    // How long after a comparison we still accept a 1/2/3 preference vote
    // from the same user. After this window, the comparison is sealed as "no vote".
    voteWindowMs: parseInt(process.env.AB_VOTE_WINDOW_MS, 10) || 15 * 60 * 1000
  }
};
