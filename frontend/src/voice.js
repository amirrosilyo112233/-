// Voice utilities - browser STT + Google Cloud TTS for deep Hebrew voice

let currentAudio = null;
let stopRequested = false;

function cleanText(text) {
  return text
    .replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{27BF}]|[\u{1F000}-\u{1F02F}]/gu, '')
    .replace(/[*_`#]/g, '')
    .trim();
}

export function splitSentences(text) {
  if (!text) return [];
  const clean = cleanText(text);
  const parts = clean
    .split(/(?<=[.!?׃])\s+|\n+/)
    .map(s => s.trim())
    .filter(Boolean);
  return parts.length ? parts : [clean];
}

// Voice list
export const HEBREW_VOICES = [
  { id: 'he-IL-Wavenet-D', label: 'דניאל — גברי עמוק (Wavenet)', gender: 'male', tier: 'premium' },
  { id: 'he-IL-Wavenet-B', label: 'בני — גברי רגיל (Wavenet)', gender: 'male', tier: 'premium' },
  { id: 'he-IL-Wavenet-A', label: 'הילה — נשי חם (Wavenet)', gender: 'female', tier: 'premium' },
  { id: 'he-IL-Wavenet-C', label: 'כרמל — נשי בוגר (Wavenet)', gender: 'female', tier: 'premium' },
  { id: 'he-IL-Standard-D', label: 'דוד — גברי בסיסי', gender: 'male', tier: 'standard' },
  { id: 'he-IL-Standard-B', label: 'בועז — גברי בסיסי', gender: 'male', tier: 'standard' },
  { id: 'he-IL-Standard-A', label: 'אביגיל — נשי בסיסי', gender: 'female', tier: 'standard' },
  { id: 'he-IL-Standard-C', label: 'חני — נשי בסיסי', gender: 'female', tier: 'standard' },
];

export function getVoice() {
  return localStorage.getItem('tts_voice') || 'he-IL-Wavenet-D';
}

export function setVoice(id) {
  localStorage.setItem('tts_voice', id);
}

export function getSpeed() {
  return parseFloat(localStorage.getItem('tts_speed') || '1.0');
}

export function setSpeed(s) {
  localStorage.setItem('tts_speed', String(s));
}

// Fetch audio for one sentence from backend
async function fetchAudio(sentence) {
  const res = await fetch('/api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: sentence,
      voice: getVoice(),
      speakingRate: getSpeed()
    })
  });
  const data = await res.json();
  if (data.audio) return data.audio;
  throw new Error(data.error || 'TTS failed');
}

// Browser fallback TTS
function browserSpeak(sentence) {
  return new Promise((resolve) => {
    if (!window.speechSynthesis) { resolve(); return; }
    const utt = new SpeechSynthesisUtterance(sentence);
    utt.lang = 'he-IL';
    utt.rate = 1.0;
    utt.onend = resolve;
    utt.onerror = resolve;
    window.speechSynthesis.speak(utt);
  });
}

// Play one audio sentence and wait for it to finish
function playAudio(base64) {
  return new Promise((resolve) => {
    const audio = new Audio(`data:audio/mp3;base64,${base64}`);
    currentAudio = audio;
    audio.onended = () => { currentAudio = null; resolve(); };
    audio.onerror = () => { currentAudio = null; resolve(); };
    audio.play().catch(() => { currentAudio = null; resolve(); });
  });
}

// Main speak function - cloud TTS with sentence callback
export async function speak(text, options = {}) {
  stop();
  if (!text) return false;
  stopRequested = false;

  const { onSentence, onEnd } = options;
  const sentences = splitSentences(text);
  if (sentences.length === 0) {
    if (onEnd) onEnd();
    return false;
  }

  // Try cloud TTS first, fall back to browser if it fails
  let useCloud = true;
  let cloudErrorShown = false;
  let nextPromise = fetchAudio(sentences[0]).catch(e => { console.error('Cloud TTS error:', e.message); return { error: e.message }; });

  for (let i = 0; i < sentences.length; i++) {
    if (stopRequested) break;

    if (onSentence) onSentence(i);

    const audioPromise = nextPromise;
    nextPromise = i + 1 < sentences.length && useCloud
      ? fetchAudio(sentences[i + 1]).catch(e => { console.error('Cloud TTS error:', e.message); return { error: e.message }; })
      : Promise.resolve(null);

    try {
      const result = await audioPromise;
      if (typeof result === 'string' && !stopRequested) {
        await playAudio(result);
      } else if (!stopRequested) {
        // Cloud failed - show error once, then fall back to browser
        if (!cloudErrorShown && result?.error) {
          cloudErrorShown = true;
          console.warn('TTS Cloud failed:', result.error, '— using browser voice as fallback');
        }
        useCloud = false;
        await browserSpeak(sentences[i]);
      }
    } catch (e) {
      console.error('Speak error:', e);
      if (!stopRequested) await browserSpeak(sentences[i]);
    }
  }

  if (onSentence) onSentence(-1);
  if (onEnd) onEnd();
  return true;
}

export function stop() {
  stopRequested = true;
  if (currentAudio) {
    try { currentAudio.pause(); currentAudio.currentTime = 0; } catch (e) {}
    currentAudio = null;
  }
}

export function isSpeaking() {
  return !!currentAudio && !currentAudio.paused;
}

export function hasVoice() {
  return true; // Always available - server handles it
}

// ── Speech Recognition (voice input) ─────────────────────────────────────────
let recognition = null;

export function hasRecognition() {
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

export function startListening(onResult, onEnd) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return false;

  stopListening();

  recognition = new SR();
  recognition.lang = 'he-IL';
  recognition.continuous = true;
  recognition.interimResults = true;

  let finalText = '';

  recognition.onresult = (event) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) finalText += transcript + ' ';
      else interim = transcript;
    }
    if (onResult) onResult(finalText + interim);
  };

  recognition.onend = () => {
    if (onEnd) onEnd(finalText.trim());
    recognition = null;
  };

  recognition.onerror = () => {
    if (onEnd) onEnd(finalText.trim());
    recognition = null;
  };

  try { recognition.start(); return true; }
  catch (e) { return false; }
}

export function stopListening() {
  if (recognition) {
    try { recognition.stop(); } catch (e) {}
    recognition = null;
  }
}

export function isListening() {
  return !!recognition;
}
