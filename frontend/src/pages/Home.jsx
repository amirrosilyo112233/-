import React, { useState, useRef } from 'react';

function parseTopics(topics) {
  if (!topics) return [];
  if (Array.isArray(topics)) return topics;
  try { return JSON.parse(topics); } catch { return []; }
}

export default function Home({ books, onOpenBook, onOpenArchive, onRefresh }) {
  const [uploading, setUploading] = useState(false);
  const [title, setTitle] = useState('');
  const [lang, setLang] = useState('en');
  const [files, setFiles] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const fileInputRef = useRef(null);

  function addFiles(newFiles) {
    setFiles(prev => [...prev, ...Array.from(newFiles)]);
  }

  function removeFile(idx) {
    setFiles(prev => prev.filter((_, i) => i !== idx));
  }

  function moveFile(idx, direction) {
    setFiles(prev => {
      const arr = [...prev];
      const newIdx = idx + direction;
      if (newIdx < 0 || newIdx >= arr.length) return prev;
      [arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]];
      return arr;
    });
  }

  async function handleUpload(e) {
    e.preventDefault();
    if (files.length === 0 && !title) return;
    setUploading(true);
    const form = new FormData();
    form.append('title', title || files[0]?.name?.replace(/\.[^.]+$/, '') || 'ספר חדש');
    form.append('language', lang);
    files.forEach(f => form.append('files', f));
    try {
      const res = await fetch('/api/books/upload', { method: 'POST', body: form });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(`שגיאה בהעלאה: ${data.error || res.status}`);
        setUploading(false);
        return;
      }
      setTitle(''); setFiles([]); setShowForm(false);
      await onRefresh();
    } catch (err) {
      alert('שגיאת רשת: ' + err.message);
    }
    setUploading(false);
  }

  async function deleteBook(id, e) {
    e.stopPropagation();
    if (!confirm('למחוק את הספר?')) return;
    await fetch(`/api/books/${id}`, { method: 'DELETE' });
    onRefresh();
  }

  const totalTopics = books.reduce((a, b) => a + parseTopics(b.completed_topics).length, 0);

  return (
    <div style={{ maxWidth: 820, margin: '0 auto', padding: '40px 24px 80px' }}>

      {/* Header */}
      <div className="fade-up" style={{ marginBottom: 36 }}>
        <h1 style={{ fontSize: 32, fontWeight: 800, fontFamily: 'Heebo', marginBottom: 8, color: 'var(--text)', letterSpacing: '-0.5px' }}>
          הספרייה שלי
        </h1>
        <p style={{ color: 'var(--muted)', fontSize: 16 }}>
          העלה ספר. שלח קובץ. תן למורה ללמד אותך בעברית — בקצב שלך, בשיטה שעובדת עליך.
        </p>
      </div>

      {/* Stats row */}
      {books.length > 0 && (
        <div className="fade-up" style={{ display: 'flex', gap: 14, marginBottom: 30 }}>
          <StatCard icon={<BookSt />} value={books.length} label="ספרים" />
          <StatCard icon={<CheckSt />} value={totalTopics} label="נושאים שנלמדו" />
          <StatCard icon={<TargetSt />} value={books.filter(b => b.current_chapter).length} label="בתהליך" />
        </div>
      )}

      {/* Add button */}
      <div style={{ marginBottom: 24 }}>
        {!showForm ? (
          <button onClick={() => setShowForm(true)} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            background: 'var(--elevated)',
            border: '1.5px dashed var(--border-strong)',
            borderRadius: 'var(--radius)', padding: '16px 22px',
            color: 'var(--gold)', cursor: 'pointer', width: '100%',
            fontFamily: 'Rubik', fontSize: 15, fontWeight: 600,
            transition: 'all 0.2s',
            justifyContent: 'center'
          }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--gold)'; e.currentTarget.style.background = 'rgba(220,38,38,0.06)'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-strong)'; e.currentTarget.style.background = 'var(--elevated)'; }}
          >
            <PlusIcon /> הוסף ספר חדש
          </button>
        ) : (
          <form onSubmit={handleUpload} className="card fade-up">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ fontWeight: 700, fontSize: 17 }}>📖 ספר חדש</h3>
              <button type="button" onClick={() => { setShowForm(false); setFiles([]); }} style={{
                background: 'none', border: 'none', color: 'var(--muted)',
                cursor: 'pointer', fontSize: 22, lineHeight: 1, padding: 4
              }}>×</button>
            </div>
            <input className="input" placeholder="שם הספר (אופציונלי)" value={title} onChange={e => setTitle(e.target.value)} />
            <select value={lang} onChange={e => setLang(e.target.value)} className="input">
              <option value="en">🇺🇸 אנגלית</option>
              <option value="he">🇮🇱 עברית</option>
            </select>

            {/* File picker */}
            <input
              id="book-file-input"
              type="file"
              multiple
              onChange={e => {
                if (e.target.files && e.target.files.length > 0) {
                  addFiles(Array.from(e.target.files));
                }
                e.target.value = '';
              }}
              style={{
                position: 'absolute', left: '-100vw', top: 0,
                width: 1, height: 1, opacity: 0
              }}
            />
            <label
              htmlFor="book-file-input"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                background: 'var(--elevated)', border: '1.5px dashed var(--border-strong)',
                borderRadius: 12, padding: '14px 16px',
                color: 'var(--gold)', fontSize: 14, fontWeight: 600,
                marginBottom: 12, cursor: 'pointer', userSelect: 'none',
                WebkitTapHighlightColor: 'transparent'
              }}
            >
              <ClipIcon /> {files.length > 0 ? `הוסף עוד קבצים (${files.length} נבחרו)` : 'בחר קבצים — PDF / טקסט / תמונות'}
            </label>

            {/* Files list with order */}
            {files.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8, fontWeight: 600 }}>
                  סדר הלימוד (גרור או השתמש בחיצים):
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 280, overflowY: 'auto' }}>
                  {files.map((f, i) => (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      background: 'var(--surface)', border: '1px solid var(--border)',
                      borderRadius: 10, padding: '8px 10px', fontSize: 13
                    }}>
                      <span style={{
                        width: 22, height: 22, borderRadius: 6,
                        background: 'linear-gradient(135deg, var(--gold), var(--coral))',
                        color: '#fff', fontWeight: 700,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 11, flexShrink: 0
                      }}>{i + 1}</span>
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {f.name}
                      </span>
                      <button type="button" onClick={() => moveFile(i, -1)} disabled={i === 0} style={miniBtn}>↑</button>
                      <button type="button" onClick={() => moveFile(i, 1)} disabled={i === files.length - 1} style={miniBtn}>↓</button>
                      <button type="button" onClick={() => removeFile(i)} style={{ ...miniBtn, color: 'var(--gold)' }}>✕</button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <button type="submit" className="btn-primary" disabled={uploading || files.length === 0}>
              {uploading ? `מעלה ${files.length} קבצים...` : `הוסף ${files.length > 0 ? `(${files.length} קבצים)` : ''}`}
            </button>
          </form>
        )}
      </div>

      {/* Book list */}
      {books.length === 0 ? (
        <div className="card fade-up" style={{ textAlign: 'center', padding: '60px 30px' }}>
          <div style={{ display: 'inline-flex', padding: 18, background: 'rgba(220,38,38,0.10)', borderRadius: 20, marginBottom: 16, color: 'var(--gold)' }}>
            <BookOpenIcon size={36} />
          </div>
          <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>הספרייה שלך ריקה</h3>
          <p style={{ color: 'var(--muted)', fontSize: 14 }}>
            הוסף את הספר הראשון שלך ונתחיל ללמוד יחד.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {books.map((book, i) => (
            <BookCard key={book.id} book={book} index={i} onOpen={onOpenBook} onArchive={onOpenArchive} onDelete={deleteBook} />
          ))}
        </div>
      )}
    </div>
  );
}

function StatCard({ icon, value, label }) {
  return (
    <div style={{
      flex: 1, textAlign: 'center', padding: '20px 12px',
      background: 'rgba(255,255,255,0.72)',
      backdropFilter: 'blur(18px) saturate(150%)',
      WebkitBackdropFilter: 'blur(18px) saturate(150%)',
      border: '1px solid var(--border-glass)',
      borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-float)',
      transition: 'all 0.3s'
    }}>
      <div style={{ display: 'inline-flex', padding: 8, background: 'rgba(220,38,38,0.10)', borderRadius: 10, marginBottom: 8, color: 'var(--gold)' }}>
        {icon}
      </div>
      <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--text)', fontFamily: 'Heebo', lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4, fontWeight: 500 }}>{label}</div>
    </div>
  );
}

function BookCard({ book, index, onOpen, onArchive, onDelete }) {
  const completed = parseTopics(book.completed_topics);
  return (
    <div
      className="fade-up"
      style={{
        animationDelay: `${index * 0.05}s`,
        display: 'flex', alignItems: 'center', gap: 14,
        background: 'rgba(255,255,255,0.72)',
        backdropFilter: 'blur(18px) saturate(150%)',
        WebkitBackdropFilter: 'blur(18px) saturate(150%)',
        border: '1px solid var(--border-glass)',
        borderRadius: 'var(--radius)', padding: '18px 20px',
        cursor: 'pointer', transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
        boxShadow: 'var(--shadow-float)'
      }}
      onClick={() => onOpen(book)}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = 'rgba(225,29,44,0.35)';
        e.currentTarget.style.boxShadow = 'var(--shadow-lg), 0 0 0 1px rgba(225,29,44,0.10)';
        e.currentTarget.style.transform = 'translateY(-4px)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = 'var(--border-glass)';
        e.currentTarget.style.boxShadow = 'var(--shadow-float)';
        e.currentTarget.style.transform = 'translateY(0)';
      }}
    >
      <div style={{
        width: 44, height: 56,
        background: 'linear-gradient(135deg, var(--gold), var(--coral))',
        borderRadius: '4px 8px 8px 4px',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#FFFFFF', boxShadow: 'var(--shadow-gold)',
        flexShrink: 0
      }}>
        <BookOpenIcon size={22} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--text)', marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {book.title}
        </div>
        <div style={{ color: 'var(--muted)', fontSize: 13, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <span>{book.language === 'en' ? '🇺🇸 אנגלית' : '🇮🇱 עברית'}</span>
          {book.current_chapter && <span>· 📍 {book.current_chapter}</span>}
          {completed.length > 0 && <span>· ✓ {completed.length} נושאים</span>}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        {completed.length > 0 && (
          <button
            onClick={e => { e.stopPropagation(); onArchive(book); }}
            className="btn-ghost"
            style={{ padding: '7px 11px', fontSize: 13, display: 'flex', alignItems: 'center', gap: 4 }}
            title="ארכיון פרקים"
          >
            <FolderIcon /> {completed.length}
          </button>
        )}
        <button style={{
          background: 'linear-gradient(135deg, var(--gold), var(--coral))',
          color: '#FFFFFF', border: 'none', borderRadius: 10,
          padding: '8px 16px', cursor: 'pointer', fontWeight: 700,
          fontSize: 14, fontFamily: 'Rubik', whiteSpace: 'nowrap',
          boxShadow: 'var(--shadow-gold)',
          display: 'flex', alignItems: 'center', gap: 4
        }}>
          התחל <ArrowIcon />
        </button>
        <button onClick={e => onDelete(book.id, e)} className="btn-ghost" style={{ padding: '7px 9px', display: 'flex' }}>
          <TrashIcon />
        </button>
      </div>
    </div>
  );
}

const miniBtn = {
  background: 'transparent', border: '1px solid var(--border)',
  borderRadius: 6, width: 24, height: 24,
  cursor: 'pointer', color: 'var(--muted)', fontSize: 12,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontFamily: 'inherit', transition: 'all 0.2s'
};

// Icons
function PlusIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>;
}
function ClipIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 17.93 8.8l-8.58 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>;
}
function FolderIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" /></svg>;
}
function ArrowIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="15 18 9 12 15 6" /></svg>;
}
function TrashIcon() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>;
}
function BookOpenIcon({ size = 18 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" /></svg>;
}
function BookSt() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>;
}
function CheckSt() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>;
}
function TargetSt() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /></svg>;
}
