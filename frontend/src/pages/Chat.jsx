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
  const lastAssistantRef = useRef(null);
  const inputRef = useRef(null);
  const prevMsgCount = useRef(0);

  useEffect(() => { loadMessages(); return () => stop(); }, [book.id]);

  // Keep cache in sync as conversation grows
  useEffect(() => {
    if (messages.length > 0) {
      try {
        localStorage.setItem(`msgs_${book.id}`, JSON.stringify(messages));
      } catch (e) {}
    }
  }, [messages, book.id]);

  useEffect(() => {
    // Only react when messages array length changes (not on loading flicker)
    const grew = messages.length > prevMsgCount.current;
    if (!grew) return;
    const lastMsg = messages[messages.length - 1];
    prevMsgCount.current = messages.length;

    setTimeout(() => {
      if (lastMsg?.role === 'assistant' && lastAssistantRef.current) {
        // New assistant reply — anchor to its TOP so user reads from the start
        lastAssistantRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        // User just sent — show input area / typing
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
      }
    }, 80);
  }, [messages]);

  async function loadMessages() {
    // 1. Show cached messages instantly
    const cacheKey = `msgs_${book.id}`;
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) setMessages(parsed);
      } catch (e) {}
    }

    // 2. Fetch fresh in background — but only overwrite if server has MORE messages
    try {
      const res = await fetch(`/api/books/${book.id}/messages`);
      const data = await res.json();
      if (Array.isArray(data)) {
        if (data.length === 0 && !cached) {
          send('התחל ללמד אותי את הספר הזה');
        } else if (data.length > 0) {
          // Use functional setMessages to avoid stale state — only update if server has equal or more messages
          setMessages(prev => (data.length >= prev.length ? data : prev));
          localStorage.setItem(cacheKey, JSON.stringify(data));
        }
      }
    } catch (e) {
      console.error('Load messages failed:', e);
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

    try {
      const res = await fetch(`/api/books/${book.id}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg })
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        // Show error to user
        const errMsg = data.message || data.error || 'שגיאה לא צפויה';
        setMessages(prev => [...prev, { role: 'assistant', content: `⚠️ ${errMsg}` }]);
      } else if (data.message) {
        const newIdx = messages.length + 1;
        setMessages(prev => [...prev, { role: 'assistant', content: data.message }]);
        if (autoSpeak) handleSpeak(data.message, newIdx);
      }
    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', content: `⚠️ שגיאת רשת: ${err.message}` }]);
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
    if (listening) {
      stopListening();
      setListening(false);
      return;
    }
    if (loading) return; // don't start mic during loading
    stop();
    const ok = startListening(
      (text) => setInput(text),
      (final) => {
        setListening(false);
        const clean = (final || '').trim();
        // Only auto-send if there's meaningful text and we're not loading
        if (clean.length >= 2 && !loading) {
          setInput(clean);
          setTimeout(() => {
            if (!loading) send(clean);
          }, 300);
        } else if (clean.length > 0) {
          setInput(clean); // keep it in input but don't auto-send
        }
      }
    );
    if (ok) setListening(true);
    else alert('הדפדפן שלך לא תומך בקלט קולי. נסה Chrome.');
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
          position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.40)',
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
        padding: '20px 14px 180px',
        display: 'flex', flexDirection: 'column', gap: 0,
        maxWidth: 720, width: '100%', margin: '0 auto'
      }}>
        {messages.map((m, i) => {
          const isLastAssistant = m.role === 'assistant' && i === messages.length - 1;
          return (
            <MessageBlock
              key={i}
              ref={isLastAssistant ? lastAssistantRef : null}
              message={m}
              isSpeaking={speakingId === i}
              activeSentence={speakingId === i ? speakingSentence : -1}
              onSpeak={() => handleSpeak(m.content, i)}
            />
          );
        })}
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

function renderRich(text) {
  // Split by double newline for paragraphs
  const paragraphs = text.split(/\n{2,}/);
  return paragraphs.map((p, pi) => {
    const trimmed = p.trim();
    if (!trimmed) return null;

    // Heading (## or ###)
    if (/^#{2,3}\s/.test(trimmed)) {
      const level = trimmed.match(/^#+/)[0].length;
      const content = trimmed.replace(/^#+\s*/, '');
      return (
        <h3 key={pi} style={{
          fontSize: level === 2 ? 25 : 22,
          fontWeight: 800,
          color: 'var(--primary)',
          fontFamily: 'Heebo',
          margin: '20px 0 12px',
          letterSpacing: '-0.2px'
        }}>{renderInline(content)}</h3>
      );
    }

    // Divider
    if (trimmed === '---' || trimmed === '═══') {
      return <hr key={pi} style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '18px 0' }} />;
    }

    // Bullet list
    if (/^[•\-\*]\s/.test(trimmed) || trimmed.includes('\n• ') || trimmed.includes('\n- ')) {
      const items = trimmed.split('\n').filter(l => /^[•\-\*]\s/.test(l.trim()));
      if (items.length >= 2) {
        return (
          <ul key={pi} style={{ margin: '12px 0', paddingInlineStart: 20, listStyle: 'none' }}>
            {items.map((it, ii) => (
              <li key={ii} style={{
                marginBottom: 8, display: 'flex', gap: 10, alignItems: 'flex-start',
                fontSize: 17, lineHeight: 1.7
              }}>
                <span style={{ color: 'var(--accent-gold)', fontSize: 20, lineHeight: 1, marginTop: 2 }}>•</span>
                <span>{renderInline(it.trim().replace(/^[•\-\*]\s*/, ''))}</span>
              </li>
            ))}
          </ul>
        );
      }
    }

    // Blockquote style for emoji-led paragraphs (🔥 🎯 🛑 🏠 💡)
    const emojiMatch = trimmed.match(/^(🔥|🎯|🛑|🏠|💡|📌|⏱️|⚖️|🎬)\s/);
    if (emojiMatch) {
      const bgColor = {
        '🔥': 'rgba(245,158,11,0.06)',
        '🎯': 'rgba(30,58,95,0.05)',
        '🛑': 'rgba(220,38,38,0.05)',
        '🏠': 'rgba(16,185,129,0.05)',
        '💡': 'rgba(245,158,11,0.06)',
        '📌': 'rgba(30,58,95,0.05)',
        '⏱️': 'rgba(30,58,95,0.05)',
        '⚖️': 'rgba(30,58,95,0.05)',
        '🎬': 'rgba(30,58,95,0.05)',
      }[emojiMatch[1]] || 'transparent';
      const borderColor = {
        '🔥': 'var(--accent-gold)',
        '🎯': 'var(--primary)',
        '🛑': 'var(--error)',
        '🏠': 'var(--green)',
        '💡': 'var(--accent-gold)',
      }[emojiMatch[1]] || 'var(--primary)';
      return (
        <div key={pi} style={{
          background: bgColor,
          borderInlineStart: `3px solid ${borderColor}`,
          padding: '12px 14px',
          borderRadius: '0 12px 12px 0',
          margin: '12px 0',
          fontSize: 17, lineHeight: 1.8
        }}>{renderInline(trimmed)}</div>
      );
    }

    // Regular paragraph
    return (
      <p key={pi} style={{
        fontSize: 19, lineHeight: 1.8, fontWeight: 500,
        margin: '12px 0',
        color: 'var(--text)'
      }}>{renderInline(trimmed)}</p>
    );
  });
}

function renderInline(text) {
  // Parse **bold**, *italic*, "quotes"
  const parts = [];
  let remaining = text;
  let key = 0;
  while (remaining.length > 0) {
    const boldMatch = remaining.match(/^(.*?)\*\*(.+?)\*\*/s);
    const quoteMatch = remaining.match(/^(.*?)"(.+?)"/s);

    if (boldMatch && (!quoteMatch || boldMatch[1].length < quoteMatch[1].length)) {
      if (boldMatch[1]) parts.push(<span key={key++}>{boldMatch[1]}</span>);
      parts.push(<strong key={key++} style={{ color: 'var(--primary)', fontWeight: 800 }}>{boldMatch[2]}</strong>);
      remaining = remaining.slice(boldMatch[0].length);
    } else if (quoteMatch) {
      if (quoteMatch[1]) parts.push(<span key={key++}>{quoteMatch[1]}</span>);
      parts.push(<em key={key++} style={{ color: 'var(--accent-gold)', fontStyle: 'normal', fontWeight: 600 }}>"{quoteMatch[2]}"</em>);
      remaining = remaining.slice(quoteMatch[0].length);
    } else {
      parts.push(<span key={key++}>{remaining}</span>);
      break;
    }
  }
  return parts;
}

const MessageBlock = React.forwardRef(({ message, isSpeaking, activeSentence, onSpeak }, ref) => {
  const isUser = message.role === 'user';

  // WhatsApp-style bubble — user on the left (RTL "outgoing"), assistant on the right
  const bubbleStyle = isUser
    ? {
        background: '#DCF8C6',                  // WhatsApp-style soft green (warm-friendly)
        border: '1px solid #C6E9AE',
        borderRadius: '18px 18px 4px 18px',     // tail bottom-left
        color: '#1A2F1A',
        boxShadow: '0 1px 2px rgba(30,58,95,0.08)'
      }
    : {
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: '18px 18px 18px 4px',     // tail bottom-right
        color: 'var(--text)',
        boxShadow: 'var(--shadow-sm)'
      };

  return (
    <div ref={ref} className="fade-up" style={{
      display: 'flex',
      justifyContent: isUser ? 'flex-start' : 'flex-end',
      padding: '6px 4px',
      scrollMarginTop: 80
    }}>
      <div style={{ maxWidth: '85%', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {/* Tiny role label above bubble */}
        <div style={{
          fontSize: 11, fontWeight: 700, color: isUser ? '#5C8A5C' : 'var(--primary)',
          paddingInline: 10, opacity: 0.85
        }}>
          {isUser ? 'אני' : 'מורה פרטי'}
        </div>

        <div style={{
          ...bubbleStyle,
          padding: '12px 16px',
          position: 'relative'
        }}>
          {isUser ? (
            <div style={{ fontSize: 18, lineHeight: 1.7, fontWeight: 500, whiteSpace: 'pre-wrap' }}>{message.content}</div>
          ) : (
            isSpeaking && activeSentence >= 0 ? (
              <div style={{ fontSize: 18, lineHeight: 1.8, fontWeight: 500, whiteSpace: 'pre-wrap' }}>
                {splitSentences(message.content).map((s, i) => (
                  <span key={i} style={{
                    background: i === activeSentence ? 'linear-gradient(180deg, transparent 55%, #FFE57F 55%)' : 'transparent',
                    padding: i === activeSentence ? '2px 4px' : '0',
                    borderRadius: 4,
                    transition: 'background 0.25s ease',
                    fontWeight: i === activeSentence ? 600 : 'inherit'
                  }}>
                    {s}{i < splitSentences(message.content).length - 1 ? ' ' : ''}
                  </span>
                ))}
              </div>
            ) : (
              <div>{(() => {
                try { return renderRich(message.content); }
                catch (e) {
                  return <div style={{ fontSize: 18, lineHeight: 1.8, fontWeight: 500, whiteSpace: 'pre-wrap' }}>{message.content}</div>;
                }
              })()}</div>
            )
          )}

          {/* Speaker button only on assistant bubbles */}
          {!isUser && hasVoice() && (
            <button onClick={onSpeak} style={{
              marginTop: 8,
              background: isSpeaking ? 'rgba(30,58,95,0.15)' : 'transparent',
              border: '1px solid ' + (isSpeaking ? 'var(--primary)' : 'var(--border)'),
              borderRadius: 16, padding: '4px 10px', cursor: 'pointer',
              color: isSpeaking ? 'var(--primary)' : 'var(--muted)',
              fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4
            }} title={isSpeaking ? 'עצור' : 'הקרא בקול'}>
              {isSpeaking ? <StopIconSm /> : <SpeakerSm />}
            </button>
          )}
        </div>
      </div>
    </div>
  );
});

function TypingBlock() {
  return (
    <div className="fade-up" style={{
      display: 'flex', justifyContent: 'flex-end', padding: '6px 4px'
    }}>
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: '18px 18px 18px 4px', padding: '14px 18px',
        boxShadow: 'var(--shadow-sm)',
        display: 'flex', gap: 6, alignItems: 'center'
      }}>
        <div className="typing-dot" /><div className="typing-dot" /><div className="typing-dot" />
      </div>
    </div>
  );
}

function Modal({ children, onClose }) {
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.40)',
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
