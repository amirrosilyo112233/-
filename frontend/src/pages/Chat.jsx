import React, { useState, useEffect, useRef } from 'react';
import { speak, stop, hasVoice, startListening, stopListening, hasRecognition, splitSentences, HEBREW_VOICES, getVoice, setVoice, getSpeed, setSpeed } from '../voice';

export default function Chat({ book, onBack }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(false);
  const [speakingId, setSpeakingId] = useState(null);
  const [speakingSentence, setSpeakingSentence] = useState(-1);
  const [listening, setListening] = useState(false);
  const [showCompleteDialog, setShowCompleteDialog] = useState(false);
  const [chapterTitle, setChapterTitle] = useState('');
  const [completing, setCompleting] = useState(false);
  const [completedChapter, setCompletedChapter] = useState(null);
  const [showVoicePicker, setShowVoicePicker] = useState(false);
  const [voice, setVoiceState] = useState(getVoice());
  const [speed, setSpeedState] = useState(getSpeed());
  const [previewingId, setPreviewingId] = useState(null);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => { loadMessages(); return () => stop(); }, [book.id]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, loading]);

  async function loadMessages() {
    const res = await fetch(`/api/books/${book.id}/messages`);
    const data = await res.json();
    if (data.length === 0) {
      send('התחל ללמד אותי את הספר הזה');
    } else {
      setMessages(data);
    }
  }

  async function send(text) {
    const msg = text || input.trim();
    if (!msg || loading) return;
    setInput('');
    setLoading(true);
    stop();
    setSpeakingId(null);
    setMessages(prev => [...prev, { role: 'user', content: msg }]);
    inputRef.current?.focus();

    const res = await fetch(`/api/books/${book.id}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: msg })
    });
    const data = await res.json();
    if (data.message) {
      const newIdx = messages.length + 1;
      setMessages(prev => [...prev, { role: 'assistant', content: data.message }]);
      if (autoSpeak) handleSpeak(data.message, newIdx);
    }
    setLoading(false);
  }

  function handleSpeak(text, idx) {
    if (speakingId === idx) {
      stop();
      setSpeakingId(null);
      setSpeakingSentence(-1);
      return;
    }
    setSpeakingId(idx);
    setSpeakingSentence(0);
    speak(text, {
      onSentence: (sIdx) => setSpeakingSentence(sIdx),
      onEnd: () => { setSpeakingId(null); setSpeakingSentence(-1); }
    });
  }

  function handleKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  }

  async function completeChapter() {
    if (!chapterTitle.trim()) return;
    setCompleting(true);
    try {
      const res = await fetch(`/api/books/${book.id}/chapters/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: chapterTitle.trim() })
      });
      const data = await res.json();
      if (data.id) {
        setCompletedChapter(data);
        setChapterTitle('');
        setShowCompleteDialog(false);
      }
    } catch (e) { alert('שגיאה בסיום הפרק'); }
    setCompleting(false);
  }

  function toggleMic() {
    if (listening) { stopListening(); setListening(false); }
    else {
      stop();
      const ok = startListening(
        (text) => setInput(text),
        (final) => { setListening(false); if (final) setInput(final); }
      );
      if (ok) setListening(true);
      else alert('הדפדפן שלך לא תומך בקלט קולי. נסה Chrome.');
    }
  }

  const quickMsg = {
    clarify: 'לא הבנתי — תסביר מזווית אחרת',
    challenge: 'תאתגר אותי יותר',
    example: 'תן לי דוגמה מהחיים שלי',
    save: 'שמור את התובנה הזו'
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 64px)' }}>
      {/* Header */}
      <div style={{
        background: 'var(--surface)', borderBottom: '1px solid var(--border)',
        padding: '14px 22px', display: 'flex', alignItems: 'center', gap: 14,
        boxShadow: 'var(--shadow-sm)'
      }}>
        <button className="btn-ghost" onClick={onBack} style={{ padding: '6px 12px', fontSize: 13, display: 'flex', alignItems: 'center', gap: 4 }}>
          <ArrowRight /> חזור
        </button>
        <div className="gold-bar" style={{ height: 32 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {book.title}
          </div>
          <div style={{ color: 'var(--muted)', fontSize: 12 }}>
            {book.language === 'en' ? '🇺🇸 מקור באנגלית · מלמד בעברית' : '🇮🇱 עברית'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            onClick={() => setShowCompleteDialog(true)}
            style={{
              background: 'rgba(92,138,92,0.10)',
              border: '1px solid rgba(92,138,92,0.30)',
              borderRadius: 20, padding: '6px 12px', cursor: 'pointer',
              color: 'var(--green)', fontSize: 12, fontWeight: 600,
              display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'Rubik',
              transition: 'all 0.2s'
            }}
          >
            <CheckIcon /> סיים פרק
          </button>
          {hasVoice() && (
            <>
              <button
                onClick={() => setShowVoicePicker(true)}
                style={{
                  background: 'transparent',
                  border: '1px solid var(--border)',
                  borderRadius: 20, padding: '6px 10px', cursor: 'pointer',
                  color: 'var(--muted)', fontSize: 12, fontFamily: 'Rubik',
                  display: 'flex', alignItems: 'center', gap: 4,
                  transition: 'all 0.2s'
                }}
                title="הגדרות קול"
              >
                <Speaker /> קול
              </button>
              <button
                onClick={() => { setAutoSpeak(!autoSpeak); if (autoSpeak) stop(); }}
                style={{
                  background: autoSpeak ? 'rgba(220,38,38,0.12)' : 'transparent',
                  border: '1px solid ' + (autoSpeak ? 'var(--gold)' : 'var(--border)'),
                  borderRadius: 20, padding: '6px 12px', cursor: 'pointer',
                  color: autoSpeak ? 'var(--gold)' : 'var(--muted)',
                  fontSize: 12, fontFamily: 'Rubik',
                  display: 'flex', alignItems: 'center', gap: 5,
                  transition: 'all 0.2s'
                }}
                title={autoSpeak ? 'הקראה אוטומטית פעילה' : 'הקראה אוטומטית כבויה'}
              >
                {autoSpeak ? <Speaker /> : <SpeakerOff />} אוטו
              </button>
            </>
          )}
        </div>
      </div>

      {/* Messages */}
      <div style={{
        flex: 1, overflowY: 'auto', padding: '28px 20px',
        display: 'flex', flexDirection: 'column', gap: 18,
        maxWidth: 820, width: '100%', margin: '0 auto', alignSelf: 'center'
      }}>
        {messages.map((m, i) => (
          <MessageBubble
            key={i}
            message={m}
            index={i}
            isSpeaking={speakingId === i}
            activeSentence={speakingId === i ? speakingSentence : -1}
            onSpeak={() => handleSpeak(m.content, i)}
          />
        ))}
        {loading && <TypingIndicator />}
        <div ref={bottomRef} />
      </div>

      {/* Quick actions */}
      <div style={{
        background: 'var(--surface)', borderTop: '1px solid var(--border)',
        padding: '10px 20px', display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center'
      }}>
        {[
          { id: 'clarify', emoji: '🟢', label: 'לא הבנתי' },
          { id: 'challenge', emoji: '🔴', label: 'אתגר יותר' },
          { id: 'example', emoji: '🟡', label: 'דוגמה מחיי' },
          { id: 'save', emoji: '📌', label: 'שמור תובנה' },
        ].map(a => (
          <button key={a.id} onClick={() => send(quickMsg[a.id])} style={{
            background: 'var(--elevated)', border: '1px solid var(--border)',
            borderRadius: 20, padding: '7px 14px', cursor: 'pointer',
            color: 'var(--text-soft)', fontSize: 13, fontFamily: 'Rubik',
            display: 'flex', alignItems: 'center', gap: 5,
            transition: 'all 0.2s', fontWeight: 500
          }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--gold)'; e.currentTarget.style.color = 'var(--gold)'; e.currentTarget.style.background = 'rgba(220,38,38,0.06)'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-soft)'; e.currentTarget.style.background = 'var(--elevated)'; }}
          >
            {a.emoji} {a.label}
          </button>
        ))}
      </div>

      {/* Input */}
      <div style={{
        background: 'var(--bg)', borderTop: '1px solid var(--border)',
        padding: '14px 20px', display: 'flex', gap: 10, alignItems: 'flex-end',
        maxWidth: 820, width: '100%', margin: '0 auto', alignSelf: 'center'
      }}>
        <textarea
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKey}
          placeholder={listening ? '🎤 מקשיב... דבר עכשיו' : 'כתוב תשובה או שאלה...'}
          style={{
            flex: 1, background: 'var(--surface)',
            border: '1.5px solid ' + (listening ? 'var(--gold)' : 'var(--border)'),
            borderRadius: 14, padding: '12px 16px', color: 'var(--text)',
            fontFamily: 'Rubik', fontSize: 15, resize: 'none',
            direction: 'rtl', outline: 'none', lineHeight: 1.6,
            transition: 'all 0.2s',
            boxShadow: listening ? '0 0 0 4px rgba(220,38,38,0.12)' : 'var(--shadow-sm)'
          }}
          rows={2}
          onFocus={e => { if (!listening) e.target.style.borderColor = 'var(--gold)'; }}
          onBlur={e => { if (!listening) e.target.style.borderColor = 'var(--border)'; }}
        />
        {hasRecognition() && (
          <button
            onClick={toggleMic}
            style={{
              background: listening ? 'linear-gradient(135deg, #DC5454, var(--coral))' : 'var(--surface)',
              border: '1px solid ' + (listening ? '#DC5454' : 'var(--border)'),
              borderRadius: 14, width: 48, height: 48,
              cursor: 'pointer',
              color: listening ? '#FFFFFF' : 'var(--text-soft)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: listening ? '0 4px 14px rgba(220,84,84,0.35)' : 'var(--shadow-sm)',
              transition: 'all 0.2s', flexShrink: 0
            }}
            title={listening ? 'עצור הקלטה' : 'דבר עם המורה'}
          >
            {listening ? <StopIcon /> : <MicIcon />}
          </button>
        )}
        <button
          onClick={() => send()}
          disabled={loading || !input.trim()}
          style={{
            background: input.trim() ? 'linear-gradient(135deg, var(--gold), var(--coral))' : 'var(--elevated)',
            color: input.trim() ? '#FFFFFF' : 'var(--muted)',
            border: 'none', borderRadius: 14, padding: '12px 22px',
            cursor: input.trim() ? 'pointer' : 'not-allowed',
            fontWeight: 700, fontSize: 15, fontFamily: 'Rubik',
            whiteSpace: 'nowrap', height: 48, transition: 'all 0.2s',
            boxShadow: input.trim() ? 'var(--shadow-gold)' : 'none',
            display: 'flex', alignItems: 'center', gap: 6
          }}
        >
          שלח <ArrowLeft />
        </button>
      </div>

      {/* Complete Chapter Dialog */}
      {showCompleteDialog && (
        <Modal onClose={() => setShowCompleteDialog(false)}>
          <h3 style={{ marginBottom: 8, color: 'var(--text)', fontSize: 19, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: 'var(--green)' }}><CheckIcon /></span> סיום פרק
          </h3>
          <p style={{ color: 'var(--muted)', fontSize: 14, marginBottom: 18 }}>
            איזה פרק/מודל סיימת? המורה יכין סיכום מורחב + גשר לפרקים הקודמים.
          </p>
          <input
            autoFocus
            className="input"
            placeholder="לדוגמה: מודל FATE"
            value={chapterTitle}
            onChange={e => setChapterTitle(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && completeChapter()}
          />
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => setShowCompleteDialog(false)} className="btn-ghost" style={{ flex: 1 }}>ביטול</button>
            <button onClick={completeChapter} disabled={completing || !chapterTitle.trim()} className="btn-primary" style={{ flex: 2 }}>
              {completing ? 'מכין סיכום...' : 'סיים ושמור לארכיון'}
            </button>
          </div>
        </Modal>
      )}

      {/* Completed Chapter Result */}
      {completedChapter && (
        <Modal onClose={() => setCompletedChapter(null)}>
          <h3 style={{ color: 'var(--green)', marginBottom: 12, fontSize: 19, fontWeight: 700 }}>
            ✨ הפרק נשמר בארכיון
          </h3>
          <div style={{ fontWeight: 700, marginBottom: 16, color: 'var(--gold)', fontSize: 16 }}>
            {completedChapter.title}
          </div>

          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>
              📝 סיכום
            </div>
            <div style={{ background: 'var(--elevated)', padding: 14, borderRadius: 12, fontSize: 14, lineHeight: 1.7, whiteSpace: 'pre-wrap', maxHeight: 220, overflowY: 'auto', border: '1px solid var(--border)' }}>
              {completedChapter.summary}
            </div>
          </div>

          {completedChapter.bridge && (
            <div style={{ marginBottom: 18 }}>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>
                🌉 גשר לנושאים קודמים
              </div>
              <div style={{ background: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.25)', padding: 14, borderRadius: 12, fontSize: 14, lineHeight: 1.7, whiteSpace: 'pre-wrap', maxHeight: 200, overflowY: 'auto' }}>
                {completedChapter.bridge}
              </div>
            </div>
          )}

          <button onClick={() => setCompletedChapter(null)} className="btn-primary">סגור</button>
        </Modal>
      )}

      {/* Voice Picker */}
      {showVoicePicker && (
        <Modal onClose={() => { stop(); setPreviewingId(null); setShowVoicePicker(false); }}>
          <h3 style={{ marginBottom: 10, color: 'var(--text)', fontSize: 19, fontWeight: 700 }}>
            🎤 בחירת קול
          </h3>
          <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 18 }}>
            לחץ ▶️ ליד כל קול לדגימה. הקול שתבחר יישמר.
          </p>

          {/* Speed slider */}
          <div style={{ marginBottom: 20, padding: '12px 14px', background: 'var(--elevated)', borderRadius: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>מהירות דיבור</span>
              <span style={{ fontSize: 13, color: 'var(--gold)', fontWeight: 700 }}>{speed.toFixed(2)}×</span>
            </div>
            <input
              type="range"
              min="0.5"
              max="1.5"
              step="0.05"
              value={speed}
              onChange={e => {
                const s = parseFloat(e.target.value);
                setSpeedState(s);
                setSpeed(s);
              }}
              style={{ width: '100%', accentColor: 'var(--gold)' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
              <span>איטי</span>
              <span>רגיל</span>
              <span>מהיר</span>
            </div>
          </div>

          {/* Voice list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 360, overflowY: 'auto' }}>
            {HEBREW_VOICES.map(v => (
              <div
                key={v.id}
                onClick={() => { setVoiceState(v.id); setVoice(v.id); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '12px 14px',
                  background: voice === v.id ? 'rgba(220,38,38,0.08)' : 'var(--surface)',
                  border: '1px solid ' + (voice === v.id ? 'var(--gold)' : 'var(--border)'),
                  borderRadius: 10, cursor: 'pointer', transition: 'all 0.2s'
                }}
              >
                <span style={{
                  width: 22, height: 22, borderRadius: '50%',
                  border: '2px solid ' + (voice === v.id ? 'var(--gold)' : 'var(--border-strong)'),
                  background: voice === v.id ? 'var(--gold)' : 'transparent',
                  flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#fff', fontSize: 12, fontWeight: 700
                }}>{voice === v.id ? '✓' : ''}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{v.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                    {v.gender === 'male' ? '♂ גברי' : '♀ נשי'} · {v.tier === 'premium' ? 'איכות מעולה' : 'בסיסי'}
                  </div>
                </div>
                <button
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (previewingId === v.id) {
                      stop();
                      setPreviewingId(null);
                      return;
                    }
                    stop();
                    setPreviewingId(v.id);
                    // Temporarily set the voice for preview
                    const prevVoice = getVoice();
                    setVoice(v.id);
                    await speak('שלום, אני המורה הפרטי שלך. נעים מאוד.', {
                      onEnd: () => setPreviewingId(null)
                    });
                    // Restore the actual selected voice if user didn't choose this one
                    if (voice !== v.id) setVoice(prevVoice);
                  }}
                  style={{
                    background: previewingId === v.id ? 'var(--gold)' : 'var(--elevated)',
                    border: '1px solid ' + (previewingId === v.id ? 'var(--gold)' : 'var(--border)'),
                    borderRadius: 8, padding: '6px 12px', cursor: 'pointer',
                    color: previewingId === v.id ? '#fff' : 'var(--text-soft)',
                    fontSize: 12, fontFamily: 'Rubik', fontWeight: 600,
                    whiteSpace: 'nowrap', transition: 'all 0.2s'
                  }}
                >
                  {previewingId === v.id ? '⏸ עצור' : '▶ דגימה'}
                </button>
              </div>
            ))}
          </div>

          <button
            onClick={() => { stop(); setPreviewingId(null); setShowVoicePicker(false); }}
            className="btn-primary"
            style={{ marginTop: 18 }}
          >
            סגור ושמור
          </button>
        </Modal>
      )}
    </div>
  );
}

function MessageBubble({ message, index, isSpeaking, activeSentence, onSpeak }) {
  const isUser = message.role === 'user';
  const sentences = (!isUser && isSpeaking && activeSentence >= 0) ? splitSentences(message.content) : null;

  return (
    <div className="fade-up" style={{
      animationDelay: `${Math.min(index * 0.03, 0.3)}s`,
      display: 'flex', flexDirection: 'column',
      alignItems: isUser ? 'flex-start' : 'flex-end', gap: 5
    }}>
      {!isUser && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 2 }}>
          <div className="icon-circle" style={{ width: 26, height: 26, borderRadius: 7 }}>
            <GraduationIcon />
          </div>
          <span style={{ fontSize: 12, color: 'var(--gold)', fontWeight: 700 }}>מורה פרטי</span>
          {hasVoice() && (
            <button
              onClick={onSpeak}
              style={{
                background: isSpeaking ? 'rgba(220,38,38,0.20)' : 'transparent',
                border: '1px solid ' + (isSpeaking ? 'var(--gold)' : 'var(--border)'),
                borderRadius: 14, padding: '2px 9px', cursor: 'pointer',
                color: isSpeaking ? 'var(--gold)' : 'var(--muted)',
                fontSize: 11, display: 'flex', alignItems: 'center',
                transition: 'all 0.2s'
              }}
              title={isSpeaking ? 'עצור' : 'הקרא בקול'}
            >
              {isSpeaking ? <StopIconSm /> : <SpeakerSm />}
            </button>
          )}
        </div>
      )}
      <div style={{
        maxWidth: '80%',
        background: isUser ? 'var(--surface)' : 'var(--elevated)',
        border: isUser ? '1px solid var(--border)' : '1px solid ' + (isSpeaking ? 'var(--gold)' : 'rgba(220,38,38,0.25)'),
        borderRadius: isUser ? '16px 16px 16px 4px' : '16px 16px 4px 16px',
        padding: '14px 18px', fontSize: 15, lineHeight: 1.85,
        whiteSpace: 'pre-wrap', color: 'var(--text)',
        boxShadow: !isUser ? '0 2px 8px rgba(220,38,38,0.08)' : 'var(--shadow-sm)',
        transition: 'all 0.2s'
      }}>
        {sentences ? (
          sentences.map((s, i) => (
            <span key={i} style={{
              background: i === activeSentence ? 'linear-gradient(180deg, transparent 50%, #FFE57F 50%)' : 'transparent',
              padding: i === activeSentence ? '2px 4px' : '0',
              borderRadius: 4,
              transition: 'background 0.25s ease',
              fontWeight: i === activeSentence ? 600 : 'inherit',
              boxShadow: i === activeSentence ? '0 0 0 2px rgba(255,229,127,0.5)' : 'none'
            }}>
              {s}{i < sentences.length - 1 ? ' ' : ''}
            </span>
          ))
        ) : message.content}
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <div className="icon-circle" style={{ width: 26, height: 26, borderRadius: 7 }}>
          <GraduationIcon />
        </div>
        <span style={{ fontSize: 12, color: 'var(--gold)', fontWeight: 700 }}>חושב...</span>
      </div>
      <div style={{
        background: 'var(--elevated)', border: '1px solid rgba(220,38,38,0.25)',
        borderRadius: '16px 16px 4px 16px', padding: '14px 20px',
        display: 'flex', gap: 6, alignItems: 'center'
      }}>
        <div className="typing-dot" />
        <div className="typing-dot" />
        <div className="typing-dot" />
      </div>
    </div>
  );
}

function Modal({ children, onClose }) {
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0,
      background: 'rgba(42,37,32,0.40)',
      backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000, padding: 20
    }} className="fade-in">
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--surface)', borderRadius: 20, padding: 28,
        maxWidth: 580, width: '100%', maxHeight: '85vh', overflowY: 'auto',
        border: '1px solid var(--border)', boxShadow: '0 24px 60px rgba(120,90,50,0.25)'
      }} className="fade-up">
        {children}
      </div>
    </div>
  );
}

// Icons
function GraduationIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z" /><path d="M6 12v5c3 3 9 3 12 0v-5" /></svg>;
}
function CheckIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>;
}
function Speaker() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14" /></svg>;
}
function SpeakerSm() {
  return <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /></svg>;
}
function SpeakerOff() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><line x1="22" y1="9" x2="16" y2="15" /><line x1="16" y1="9" x2="22" y2="15" /></svg>;
}
function MicIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /></svg>;
}
function StopIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>;
}
function StopIconSm() {
  return <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>;
}
function ArrowRight() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="9 18 15 12 9 6" /></svg>;
}
function ArrowLeft() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="15 18 9 12 15 6" /></svg>;
}
