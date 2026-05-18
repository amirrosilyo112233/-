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
  const [showMenu, setShowMenu] = useState(false);
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
    if (speakingId === idx) { stop(); setSpeakingId(null); setSpeakingSentence(-1); return; }
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
        (final) => { setListening(false); if (final) { setInput(final); setTimeout(() => send(final), 200); } }
      );
      if (ok) setListening(true);
      else alert('הדפדפן שלך לא תומך בקלט קולי. נסה Chrome.');
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 60px)' }}>
      {/* Compact header */}
      <div style={{
        background: 'var(--surface)', borderBottom: '1px solid var(--border)',
        padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10,
        boxShadow: 'var(--shadow-sm)'
      }}>
        <button className="btn-ghost" onClick={onBack} style={{ padding: '6px 10px', fontSize: 13, display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          <ArrowRight />
        </button>
        <div className="gold-bar" style={{ height: 26 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {book.title}
          </div>
        </div>
        <button onClick={() => setShowMenu(!showMenu)} style={{
          background: 'transparent', border: '1px solid var(--border)',
          borderRadius: 10, padding: '8px 10px', cursor: 'pointer',
          color: 'var(--text-soft)', display: 'flex'
        }}>
          <MenuIcon />
        </button>
      </div>

      {/* Menu overlay */}
      {showMenu && (
        <div onClick={() => setShowMenu(false)} style={{
          position: 'fixed', inset: 0, background: 'rgba(42,37,32,0.40)',
          backdropFilter: 'blur(4px)', zIndex: 1000,
          display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
          padding: '70px 16px 16px'
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: 'var(--surface)', borderRadius: 16, padding: 16,
            width: '100%', maxWidth: 400, boxShadow: 'var(--shadow-lg)',
            display: 'flex', flexDirection: 'column', gap: 8
          }} className="fade-up">
            {/* Quick actions */}
            <div style={{
              fontSize: 11, color: 'var(--muted)', fontWeight: 700,
              letterSpacing: 1, padding: '6px 4px 2px'
            }}>פעולות מהירות</div>
            <button onClick={() => { setShowMenu(false); send('לא הבנתי — תסביר מזווית אחרת'); }} style={menuBtn}>
              <span style={{ fontSize: 18 }}>🟢</span>
              <span>לא הבנתי</span>
            </button>
            <button onClick={() => { setShowMenu(false); send('תאתגר אותי יותר'); }} style={menuBtn}>
              <span style={{ fontSize: 18 }}>🔴</span>
              <span>אתגר יותר</span>
            </button>
            <button onClick={() => { setShowMenu(false); send('תן לי דוגמה מהחיים שלי'); }} style={menuBtn}>
              <span style={{ fontSize: 18 }}>🟡</span>
              <span>דוגמה מחיי</span>
            </button>
            <button onClick={() => { setShowMenu(false); send('שמור את התובנה הזו'); }} style={menuBtn}>
              <span style={{ fontSize: 18 }}>📌</span>
              <span>שמור תובנה</span>
            </button>

            <div style={{ height: 1, background: 'var(--border)', margin: '6px 0' }} />

            <div style={{
              fontSize: 11, color: 'var(--muted)', fontWeight: 700,
              letterSpacing: 1, padding: '6px 4px 2px'
            }}>כלים</div>
            <button onClick={() => { setShowMenu(false); setShowCompleteDialog(true); }} style={menuBtn}>
              <span style={{ color: 'var(--green)' }}><CheckIcon /></span>
              <span>סיים פרק</span>
            </button>
            <button onClick={() => { setShowMenu(false); setShowVoicePicker(true); }} style={menuBtn}>
              <SpeakerIcon /> <span>בחירת קול</span>
            </button>
            <button onClick={() => { setAutoSpeak(!autoSpeak); if (autoSpeak) stop(); setShowMenu(false); }} style={menuBtn}>
              {autoSpeak ? <SpeakerIcon /> : <SpeakerOffIcon />}
              <span>{autoSpeak ? 'הקראה אוטומטית פעילה ✓' : 'הקראה אוטומטית כבויה'}</span>
            </button>
          </div>
        </div>
      )}

      {/* Single-column messages */}
      <div style={{
        flex: 1, overflowY: 'auto',
        padding: '20px 14px 100px',
        display: 'flex', flexDirection: 'column', gap: 0,
        maxWidth: 720, width: '100%', margin: '0 auto'
      }}>
        {messages.map((m, i) => (
          <MessageBlock
            key={i}
            message={m}
            isSpeaking={speakingId === i}
            activeSentence={speakingId === i ? speakingSentence : -1}
            onSpeak={() => handleSpeak(m.content, i)}
          />
        ))}
        {loading && <TypingBlock />}
        <div ref={bottomRef} />
      </div>

      {/* Big voice-first input bar */}
      <div style={{
        background: 'linear-gradient(to top, var(--bg) 70%, transparent)',
        padding: '14px 14px 20px',
        position: 'fixed', bottom: 0, left: 0, right: 0,
        zIndex: 50
      }}>
        <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', gap: 10, alignItems: 'flex-end' }}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder={listening ? '🎤 מקשיב...' : 'הקלד או דבר...'}
            style={{
              flex: 1, background: 'var(--surface)',
              border: '2px solid ' + (listening ? 'var(--gold)' : 'var(--border)'),
              borderRadius: 22, padding: '14px 18px', color: 'var(--text)',
              fontFamily: 'Rubik', fontSize: 16, resize: 'none',
              direction: 'rtl', outline: 'none', lineHeight: 1.5,
              transition: 'all 0.2s',
              boxShadow: listening ? '0 0 0 4px rgba(30,58,95,0.12)' : 'var(--shadow)',
              maxHeight: 120, minHeight: 50
            }}
            rows={1}
          />
          {hasRecognition() && !input.trim() ? (
            <button
              onClick={toggleMic}
              style={{
                background: listening
                  ? 'linear-gradient(135deg, #DC5454, var(--coral))'
                  : 'linear-gradient(135deg, var(--gold), var(--coral))',
                border: 'none',
                borderRadius: '50%', width: 56, height: 56,
                cursor: 'pointer', color: '#FFFFFF',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: 'var(--shadow-accent)',
                animation: listening ? 'pulse 1.4s ease infinite' : 'none',
                transition: 'all 0.2s', flexShrink: 0
              }}
              title={listening ? 'עצור' : 'דבר'}
            >
              {listening ? <StopIcon /> : <MicIcon />}
            </button>
          ) : (
            <button
              onClick={() => send()}
              disabled={loading || !input.trim()}
              style={{
                background: input.trim() ? 'linear-gradient(135deg, var(--gold), var(--coral))' : 'var(--elevated)',
                color: input.trim() ? '#FFFFFF' : 'var(--muted)',
                border: 'none', borderRadius: '50%', width: 56, height: 56,
                cursor: input.trim() ? 'pointer' : 'not-allowed',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: input.trim() ? 'var(--shadow-accent)' : 'none',
                transition: 'all 0.2s', flexShrink: 0
              }}
            >
              <SendIcon />
            </button>
          )}
        </div>
      </div>

      {/* Dialogs (Complete chapter, completion result, voice picker) */}
      {showCompleteDialog && (
        <Modal onClose={() => setShowCompleteDialog(false)}>
          <h3 style={{ marginBottom: 10, fontSize: 20, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: 'var(--green)' }}><CheckIcon /></span> סיום פרק
          </h3>
          <p style={{ color: 'var(--muted)', fontSize: 14, marginBottom: 18, lineHeight: 1.6 }}>
            איזה פרק/מודל סיימת? המורה יכין סיכום מורחב + גשר לפרקים הקודמים.
          </p>
          <input autoFocus className="input" placeholder="לדוגמה: מודל FATE"
            value={chapterTitle} onChange={e => setChapterTitle(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && completeChapter()} />
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => setShowCompleteDialog(false)} className="btn-ghost" style={{ flex: 1 }}>ביטול</button>
            <button onClick={completeChapter} disabled={completing || !chapterTitle.trim()} className="btn-primary" style={{ flex: 2 }}>
              {completing ? 'מכין סיכום...' : 'סיים ושמור לארכיון'}
            </button>
          </div>
        </Modal>
      )}

      {completedChapter && (
        <Modal onClose={() => setCompletedChapter(null)}>
          <h3 style={{ color: 'var(--green)', marginBottom: 12, fontSize: 20, fontWeight: 700 }}>
            ✨ הפרק נשמר בארכיון
          </h3>
          <div style={{ fontWeight: 700, marginBottom: 16, color: 'var(--gold)', fontSize: 17 }}>
            {completedChapter.title}
          </div>
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8, fontWeight: 700, letterSpacing: 1 }}>📝 סיכום</div>
            <div style={{ background: 'var(--elevated)', padding: 14, borderRadius: 12, fontSize: 15, lineHeight: 1.7, whiteSpace: 'pre-wrap', maxHeight: 240, overflowY: 'auto' }}>
              {completedChapter.summary}
            </div>
          </div>
          {completedChapter.bridge && (
            <div style={{ marginBottom: 18 }}>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8, fontWeight: 700, letterSpacing: 1 }}>🌉 גשר לנושאים קודמים</div>
              <div style={{ background: 'rgba(30,58,95,0.06)', border: '1px solid rgba(30,58,95,0.25)', padding: 14, borderRadius: 12, fontSize: 15, lineHeight: 1.7, whiteSpace: 'pre-wrap', maxHeight: 200, overflowY: 'auto' }}>
                {completedChapter.bridge}
              </div>
            </div>
          )}
          <button onClick={() => setCompletedChapter(null)} className="btn-primary">סגור</button>
        </Modal>
      )}

      {showVoicePicker && (
        <Modal onClose={() => { stop(); setPreviewingId(null); setShowVoicePicker(false); }}>
          <h3 style={{ marginBottom: 10, fontSize: 20, fontWeight: 700 }}>🎤 בחירת קול</h3>
          <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 18 }}>לחץ ▶️ ליד כל קול לדגימה. הקול שתבחר יישמר.</p>
          <div style={{ marginBottom: 20, padding: '12px 14px', background: 'var(--elevated)', borderRadius: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>מהירות דיבור</span>
              <span style={{ fontSize: 13, color: 'var(--gold)', fontWeight: 700 }}>{speed.toFixed(2)}×</span>
            </div>
            <input type="range" min="0.5" max="1.5" step="0.05" value={speed}
              onChange={e => { const s = parseFloat(e.target.value); setSpeedState(s); setSpeed(s); }}
              style={{ width: '100%', accentColor: 'var(--gold)' }} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 360, overflowY: 'auto' }}>
            {HEBREW_VOICES.map(v => (
              <div key={v.id} onClick={() => { setVoiceState(v.id); setVoice(v.id); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px',
                  background: voice === v.id ? 'rgba(30,58,95,0.08)' : 'var(--surface)',
                  border: '1px solid ' + (voice === v.id ? 'var(--gold)' : 'var(--border)'),
                  borderRadius: 12, cursor: 'pointer'
                }}>
                <span style={{
                  width: 22, height: 22, borderRadius: '50%',
                  border: '2px solid ' + (voice === v.id ? 'var(--gold)' : 'var(--border-strong)'),
                  background: voice === v.id ? 'var(--gold)' : 'transparent',
                  flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#fff', fontSize: 12, fontWeight: 700
                }}>{voice === v.id ? '✓' : ''}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>{v.label}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                    {v.gender === 'male' ? '♂ גברי' : '♀ נשי'} · {v.tier === 'premium' ? 'איכות מעולה' : 'בסיסי'}
                  </div>
                </div>
                <button onClick={async (e) => {
                  e.stopPropagation();
                  if (previewingId === v.id) { stop(); setPreviewingId(null); return; }
                  stop(); setPreviewingId(v.id);
                  const prev = getVoice(); setVoice(v.id);
                  await speak('שלום, אני המורה הפרטי שלך.', { onEnd: () => setPreviewingId(null) });
                  if (voice !== v.id) setVoice(prev);
                }} style={{
                  background: previewingId === v.id ? 'var(--gold)' : 'var(--elevated)',
                  border: '1px solid ' + (previewingId === v.id ? 'var(--gold)' : 'var(--border)'),
                  borderRadius: 10, padding: '8px 14px', cursor: 'pointer',
                  color: previewingId === v.id ? '#fff' : 'var(--text-soft)',
                  fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap'
                }}>{previewingId === v.id ? '⏸' : '▶'}</button>
              </div>
            ))}
          </div>
          <button onClick={() => { stop(); setPreviewingId(null); setShowVoicePicker(false); }} className="btn-primary" style={{ marginTop: 18 }}>
            סגור ושמור
          </button>
        </Modal>
      )}
    </div>
  );
}

function MessageBlock({ message, isSpeaking, activeSentence, onSpeak }) {
  const isUser = message.role === 'user';
  const sentences = (!isUser && isSpeaking && activeSentence >= 0) ? splitSentences(message.content) : null;

  return (
    <div className="fade-up" style={{
      padding: '18px 4px',
      borderBottom: '1px solid rgba(225,180,140,0.15)',
      position: 'relative'
    }}>
      {/* Speaker label */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        {isUser ? (
          <>
            <div style={{
              width: 32, height: 32, borderRadius: 10,
              background: 'var(--elevated)', border: '1px solid var(--border)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--text-soft)', fontWeight: 700, fontSize: 14
            }}>א</div>
            <span style={{ fontSize: 13, color: 'var(--text-soft)', fontWeight: 700 }}>אני</span>
          </>
        ) : (
          <>
            <div className="icon-circle" style={{ width: 32, height: 32, borderRadius: 10 }}>
              <GraduationIcon />
            </div>
            <span style={{ fontSize: 13, color: 'var(--gold)', fontWeight: 700 }}>מורה פרטי</span>
            {hasVoice() && (
              <button onClick={onSpeak} style={{
                marginInlineStart: 'auto',
                background: isSpeaking ? 'rgba(30,58,95,0.20)' : 'transparent',
                border: '1px solid ' + (isSpeaking ? 'var(--gold)' : 'var(--border)'),
                borderRadius: 16, padding: '4px 10px', cursor: 'pointer',
                color: isSpeaking ? 'var(--gold)' : 'var(--muted)',
                fontSize: 12, display: 'flex', alignItems: 'center', gap: 4
              }} title={isSpeaking ? 'עצור' : 'הקרא בקול'}>
                {isSpeaking ? <StopIconSm /> : <SpeakerSm />}
              </button>
            )}
          </>
        )}
      </div>

      {/* Content */}
      <div style={{
        fontSize: 17, lineHeight: 1.85, color: 'var(--text)',
        whiteSpace: 'pre-wrap',
        paddingInlineStart: 42
      }}>
        {sentences ? (
          sentences.map((s, i) => (
            <span key={i} style={{
              background: i === activeSentence ? 'linear-gradient(180deg, transparent 55%, #FFE57F 55%)' : 'transparent',
              padding: i === activeSentence ? '2px 4px' : '0',
              borderRadius: 4,
              transition: 'background 0.25s ease',
              fontWeight: i === activeSentence ? 600 : 'inherit'
            }}>
              {s}{i < sentences.length - 1 ? ' ' : ''}
            </span>
          ))
        ) : message.content}
      </div>
    </div>
  );
}

function TypingBlock() {
  return (
    <div className="fade-up" style={{ padding: '18px 4px', borderBottom: '1px solid rgba(225,180,140,0.15)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <div className="icon-circle" style={{ width: 32, height: 32, borderRadius: 10 }}>
          <GraduationIcon />
        </div>
        <span style={{ fontSize: 13, color: 'var(--gold)', fontWeight: 700 }}>חושב...</span>
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', paddingInlineStart: 42 }}>
        <div className="typing-dot" /><div className="typing-dot" /><div className="typing-dot" />
      </div>
    </div>
  );
}

function Modal({ children, onClose }) {
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(42,37,32,0.40)',
      backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000, padding: 20
    }} className="fade-in">
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--surface)', borderRadius: 20, padding: 24,
        maxWidth: 580, width: '100%', maxHeight: '85vh', overflowY: 'auto',
        border: '1px solid var(--border)', boxShadow: '0 24px 60px rgba(120,90,50,0.25)'
      }} className="fade-up">
        {children}
      </div>
    </div>
  );
}

const menuBtn = {
  display: 'flex', alignItems: 'center', gap: 12,
  background: 'var(--elevated)', border: '1px solid var(--border)',
  borderRadius: 12, padding: '14px 16px', cursor: 'pointer',
  color: 'var(--text)', fontFamily: 'Rubik', fontSize: 15, fontWeight: 500,
  textAlign: 'right', width: '100%'
};

// Icons
function GraduationIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z" /><path d="M6 12v5c3 3 9 3 12 0v-5" /></svg>;
}
function CheckIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>;
}
function SpeakerIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14" /></svg>;
}
function SpeakerOffIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><line x1="22" y1="9" x2="16" y2="15" /><line x1="16" y1="9" x2="22" y2="15" /></svg>;
}
function SpeakerSm() {
  return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /></svg>;
}
function MicIcon() {
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /></svg>;
}
function StopIcon() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>;
}
function StopIconSm() {
  return <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>;
}
function SendIcon() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>;
}
function ArrowRight() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="9 18 15 12 9 6" /></svg>;
}
function MenuIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>;
}
