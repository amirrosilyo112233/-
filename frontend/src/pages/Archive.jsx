import React, { useState, useEffect, useRef } from 'react';

export default function Archive({ book, onBack }) {
  const [chapters, setChapters] = useState([]);
  const [activeChapter, setActiveChapter] = useState(null);

  useEffect(() => { load(); }, [book.id]);

  async function load() {
    const res = await fetch(`/api/books/${book.id}/chapters`);
    setChapters(await res.json());
  }

  if (activeChapter) {
    return <ChapterView chapter={activeChapter} onBack={() => setActiveChapter(null)} />;
  }

  return (
    <div style={{ maxWidth: 820, margin: '0 auto', padding: '40px 24px 80px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 26 }}>
        <button className="btn-ghost" onClick={onBack} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <Arrow /> חזור
        </button>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 26, fontWeight: 800, fontFamily: 'Heebo', color: 'var(--text)', letterSpacing: '-0.3px' }}>
            📂 ארכיון פרקים
          </h1>
          <p style={{ color: 'var(--muted)', fontSize: 14, marginTop: 4 }}>{book.title}</p>
        </div>
      </div>

      {chapters.length === 0 ? (
        <div className="card fade-up" style={{ textAlign: 'center', padding: '60px 30px' }}>
          <div style={{ display: 'inline-flex', padding: 18, background: 'rgba(30,58,95,0.10)', borderRadius: 20, marginBottom: 16, color: 'var(--gold)' }}>
            <BooksStack />
          </div>
          <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>אין פרקים בארכיון עדיין</h3>
          <p style={{ color: 'var(--muted)', fontSize: 14, lineHeight: 1.7 }}>
            כשתסיים פרק או מודל בשיחה — לחץ <strong style={{ color: 'var(--green)' }}>"סיים פרק"</strong> והוא יישמר כאן עם סיכום וגשר.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {chapters.map((ch, i) => (
            <div
              key={ch.id}
              className="fade-up"
              onClick={() => setActiveChapter(ch)}
              style={{
                animationDelay: `${i * 0.05}s`,
                background: 'var(--surface)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius)', padding: '20px 22px',
                cursor: 'pointer', display: 'flex', gap: 16, alignItems: 'flex-start',
                transition: 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
                boxShadow: 'var(--shadow-sm)'
              }}
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = 'var(--gold)';
                e.currentTarget.style.boxShadow = 'var(--shadow-lg)';
                e.currentTarget.style.transform = 'translateY(-2px)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = 'var(--border)';
                e.currentTarget.style.boxShadow = 'var(--shadow-sm)';
                e.currentTarget.style.transform = 'translateY(0)';
              }}
            >
              <div className="gold-bar" style={{ height: 64 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 5, color: 'var(--text)' }}>
                  {ch.title}
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10, fontWeight: 500 }}>
                  {new Date(ch.created_at).toLocaleDateString('he-IL', { day: 'numeric', month: 'long', year: 'numeric' })}
                </div>
                <div style={{ fontSize: 14, color: 'var(--text-soft)', lineHeight: 1.6,
                  display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                  {ch.summary}
                </div>
              </div>
              <span style={{ color: 'var(--gold)', display: 'flex' }}><ChevronLeft /></span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ChapterView({ chapter, onBack }) {
  const [tab, setTab] = useState('summary');
  const [qa, setQA] = useState([]);
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => { loadQA(); }, [chapter.id]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [qa, loading]);

  async function loadQA() {
    const res = await fetch(`/api/chapters/${chapter.id}/qa`);
    setQA(await res.json());
  }

  async function ask() {
    if (!question.trim() || loading) return;
    const q = question.trim();
    setQuestion(''); setLoading(true);
    setQA(prev => [...prev, { role: 'user', content: q }]);

    const res = await fetch(`/api/chapters/${chapter.id}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: q })
    });
    const data = await res.json();
    if (data.message) setQA(prev => [...prev, { role: 'assistant', content: data.message }]);
    setLoading(false);
  }

  return (
    <div style={{ maxWidth: 820, margin: '0 auto', padding: '32px 24px 80px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 22 }}>
        <button className="btn-ghost" onClick={onBack} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <Arrow /> ארכיון
        </button>
        <div className="gold-bar" style={{ height: 36 }} />
        <h2 style={{ fontSize: 20, fontWeight: 700, fontFamily: 'Heebo', color: 'var(--text)' }}>
          {chapter.title}
        </h2>
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid var(--border)' }}>
        <TabBtn active={tab === 'summary'} onClick={() => setTab('summary')}>📝 סיכום</TabBtn>
        {chapter.bridge && <TabBtn active={tab === 'bridge'} onClick={() => setTab('bridge')}>🌉 גשר</TabBtn>}
        <TabBtn active={tab === 'qa'} onClick={() => setTab('qa')}>💬 שאלות ותשובות</TabBtn>
      </div>

      {tab === 'summary' && (
        <div className="card fade-up" style={{ lineHeight: 1.85, whiteSpace: 'pre-wrap', fontSize: 15 }}>
          {chapter.summary}
        </div>
      )}

      {tab === 'bridge' && chapter.bridge && (
        <div className="card fade-up" style={{
          lineHeight: 1.85, whiteSpace: 'pre-wrap', fontSize: 15,
          background: 'rgba(30,58,95,0.06)', border: '1px solid rgba(30,58,95,0.30)'
        }}>
          {chapter.bridge}
        </div>
      )}

      {tab === 'qa' && (
        <div className="fade-up">
          <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 16 }}>
            שאל כל שאלה על הפרק הזה — לא משפיע על השיחה הראשית.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 18,
            maxHeight: 'calc(100vh - 400px)', overflowY: 'auto', paddingLeft: 4 }}>
            {qa.length === 0 && !loading && (
              <div style={{ textAlign: 'center', color: 'var(--muted)', padding: 36, fontSize: 14 }}>
                אין שאלות עדיין. שאל את הראשונה למטה 👇
              </div>
            )}
            {qa.map((m, i) => (
              <div key={i} style={{
                alignSelf: m.role === 'user' ? 'flex-start' : 'flex-end',
                maxWidth: '82%',
                background: m.role === 'user' ? 'var(--surface)' : 'var(--elevated)',
                border: m.role === 'user' ? '1px solid var(--border)' : '1px solid rgba(30,58,95,0.30)',
                borderRadius: m.role === 'user' ? '14px 14px 14px 4px' : '14px 14px 4px 14px',
                padding: '12px 16px', fontSize: 14, lineHeight: 1.7, whiteSpace: 'pre-wrap',
                color: 'var(--text)',
                boxShadow: m.role === 'assistant' ? '0 2px 8px rgba(30,58,95,0.08)' : 'var(--shadow-sm)'
              }}>
                {m.content}
              </div>
            ))}
            {loading && (
              <div style={{ alignSelf: 'flex-end', color: 'var(--gold)', fontSize: 13, padding: '4px 8px' }}>
                חושב... ✨
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <input
              className="input"
              style={{ marginBottom: 0, flex: 1 }}
              placeholder="שאל שאלה על הפרק..."
              value={question}
              onChange={e => setQuestion(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && ask()}
            />
            <button onClick={ask} disabled={loading || !question.trim()} style={{
              background: question.trim() ? 'linear-gradient(135deg, var(--gold), var(--coral))' : 'var(--elevated)',
              color: question.trim() ? '#FFFFFF' : 'var(--muted)',
              border: 'none', borderRadius: 12, padding: '0 22px', fontWeight: 700,
              cursor: question.trim() ? 'pointer' : 'not-allowed', fontFamily: 'Rubik',
              boxShadow: question.trim() ? 'var(--shadow-gold)' : 'none',
              transition: 'all 0.2s'
            }}>שאל</button>
          </div>
        </div>
      )}
    </div>
  );
}

function TabBtn({ active, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      background: 'transparent', border: 'none',
      color: active ? 'var(--gold)' : 'var(--muted)',
      padding: '12px 18px', cursor: 'pointer',
      fontFamily: 'Rubik', fontSize: 14, fontWeight: active ? 700 : 500,
      borderBottom: active ? '2px solid var(--gold)' : '2px solid transparent',
      marginBottom: -1, transition: 'all 0.2s'
    }}>{children}</button>
  );
}

function Arrow() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="9 18 15 12 9 6" /></svg>;
}
function ChevronLeft() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="15 18 9 12 15 6" /></svg>;
}
function BooksStack() {
  return <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" /></svg>;
}
