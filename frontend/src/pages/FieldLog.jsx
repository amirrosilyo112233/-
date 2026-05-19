import React, { useState, useEffect } from 'react';

export default function FieldLog({ books }) {
  const [logs, setLogs] = useState([]);
  const [text, setText] = useState('');
  const [bookId, setBookId] = useState('');
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState('');

  useEffect(() => { loadLogs(); }, []);

  async function loadLogs() {
    const res = await fetch('/api/field-log');
    setLogs(await res.json());
  }

  async function submit(e) {
    e.preventDefault();
    if (!text.trim()) return;
    setLoading(true); setResponse('');
    const res = await fetch('/api/field-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: text, book_id: bookId || null })
    });
    const data = await res.json();
    setResponse(data.response);
    setText(''); loadLogs(); setLoading(false);
  }

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '40px 24px 80px' }}>
      <div className="fade-up" style={{ marginBottom: 30 }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, fontFamily: 'Heebo', marginBottom: 8, color: 'var(--text)', letterSpacing: '-0.3px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div className="icon-circle" style={{ width: 40, height: 40, borderRadius: 12 }}>
            <NotebookIcon />
          </div>
          יומן שטח
        </h1>
        <p style={{ color: 'var(--muted)', fontSize: 15 }}>
          מה ניסית היום? מה קרה? המורה יקשיב, ישאל שאלות, ויחבר לחומר שלמדת.
        </p>
      </div>

      <form onSubmit={submit} className="card fade-up" style={{ marginBottom: 24 }}>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="כתוב מה ניסית, מה קרה, מה הרגשת..."
          style={{
            width: '100%', background: 'var(--elevated)',
            border: '1px solid var(--border)',
            borderRadius: 12, padding: '14px 16px', color: 'var(--text)',
            fontFamily: 'Rubik', fontSize: 15, resize: 'vertical',
            direction: 'rtl', outline: 'none', lineHeight: 1.7,
            marginBottom: 12, minHeight: 110,
            transition: 'all 0.2s'
          }}
          onFocus={e => { e.target.style.borderColor = 'var(--gold)'; e.target.style.background = 'var(--surface)'; }}
          onBlur={e => { e.target.style.borderColor = 'var(--border)'; e.target.style.background = 'var(--elevated)'; }}
        />
        <select value={bookId} onChange={e => setBookId(e.target.value)} className="input">
          <option value="">🔗 קשר לספר (אופציונלי)</option>
          {books.map(b => <option key={b.id} value={b.id}>{b.title}</option>)}
        </select>
        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? 'שולח...' : '✉️ שלח ליומן'}
        </button>
      </form>

      {response && (
        <div className="card fade-up" style={{
          marginBottom: 26,
          border: '1px solid rgba(200,132,61,0.35)',
          background: 'rgba(200,132,61,0.06)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <div className="icon-circle" style={{ width: 32, height: 32, borderRadius: 10 }}>
              <GraduationIcon />
            </div>
            <span style={{ fontWeight: 700, color: 'var(--gold)', fontSize: 15 }}>תגובת המורה</span>
          </div>
          <div style={{ lineHeight: 1.8, whiteSpace: 'pre-wrap', color: 'var(--text)' }}>{response}</div>
        </div>
      )}

      {logs.length > 0 && (
        <div>
          <h3 style={{
            color: 'var(--muted)', fontSize: 12, fontWeight: 700,
            marginBottom: 14, textTransform: 'uppercase', letterSpacing: 1.5
          }}>
            רשומות קודמות
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {logs.map((log, i) => (
              <div key={log.id} className="card fade-up" style={{ animationDelay: `${i * 0.04}s` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <span style={{ color: 'var(--muted)', fontSize: 12, fontWeight: 500 }}>
                    {new Date(log.created_at).toLocaleDateString('he-IL', { day: 'numeric', month: 'long' })}
                  </span>
                  {log.book_title && <span className="tag">{log.book_title}</span>}
                </div>
                <p style={{ marginBottom: 12, color: 'var(--text)', lineHeight: 1.7 }}>{log.content}</p>
                {log.ai_response && (
                  <div style={{
                    borderTop: '1px solid var(--border)',
                    paddingTop: 12, color: 'var(--text-soft)',
                    fontSize: 14, lineHeight: 1.7,
                    display: 'flex', gap: 8, alignItems: 'flex-start'
                  }}>
                    <span style={{ color: 'var(--gold)', fontWeight: 700, flexShrink: 0 }}>🎓</span>
                    <span>{log.ai_response}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function NotebookIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 6h4M2 10h4M2 14h4M2 18h4M6 4h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6V4z" /></svg>;
}
function GraduationIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z" /><path d="M6 12v5c3 3 9 3 12 0v-5" /></svg>;
}
