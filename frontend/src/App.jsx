import React, { useState, useEffect } from 'react';
import Home from './pages/Home';
import Chat from './pages/Chat';
import FieldLog from './pages/FieldLog';
import Archive from './pages/Archive';

export default function App() {
  const [page, setPage] = useState('home');
  const [activeBook, setActiveBook] = useState(null);
  const [books, setBooks] = useState([]);

  useEffect(() => { loadBooks(); }, []);

  async function loadBooks() {
    const res = await fetch('/api/books');
    setBooks(await res.json());
  }

  function openBook(book) { setActiveBook(book); setPage('chat'); }
  function openArchive(book) { setActiveBook(book); setPage('archive'); }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <nav style={{
        background: 'rgba(248,241,229,0.85)',
        backdropFilter: 'blur(14px)',
        WebkitBackdropFilter: 'blur(14px)',
        borderBottom: '1px solid var(--border)',
        padding: '0 28px',
        display: 'flex',
        alignItems: 'center',
        height: 64,
        position: 'sticky',
        top: 0,
        zIndex: 100,
        gap: 8,
        boxShadow: '0 1px 0 rgba(120,90,50,0.04)'
      }}>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div className="icon-circle" style={{ width: 36, height: 36, fontSize: 18 }}>
            <BookIcon />
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 17, color: 'var(--text)', fontFamily: 'Heebo', lineHeight: 1.2 }}>
              המורה הפרטי שלי
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)', letterSpacing: 0.3 }}>
              לימוד מעמיק. בקצב שלך.
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 6 }}>
          <NavBtn active={page === 'home'} onClick={() => setPage('home')} icon={<HomeIcon />}>בית</NavBtn>
          <NavBtn active={page === 'log'} onClick={() => setPage('log')} icon={<BookmarkIcon />}>יומן שטח</NavBtn>
        </div>
      </nav>

      {page === 'home' && (
        <Home books={books} onOpenBook={openBook} onOpenArchive={openArchive} onRefresh={loadBooks} />
      )}
      {page === 'chat' && activeBook && (
        <Chat book={activeBook} onBack={() => { setPage('home'); loadBooks(); }} />
      )}
      {page === 'archive' && activeBook && (
        <Archive book={activeBook} onBack={() => setPage('home')} />
      )}
      {page === 'log' && (
        <FieldLog books={books} />
      )}
    </div>
  );
}

function NavBtn({ active, onClick, children, icon }) {
  return (
    <button onClick={onClick} style={{
      background: active ? 'rgba(220,38,38,0.10)' : 'transparent',
      color: active ? 'var(--gold)' : 'var(--text-soft)',
      border: active ? '1px solid rgba(220,38,38,0.30)' : '1px solid transparent',
      borderRadius: 10,
      padding: '7px 14px',
      cursor: 'pointer',
      fontFamily: 'Rubik',
      fontSize: 14,
      fontWeight: active ? 600 : 500,
      transition: 'all 0.2s',
      display: 'flex',
      alignItems: 'center',
      gap: 6
    }}>
      {icon}
      {children}
    </button>
  );
}

function BookIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  );
}

function HomeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}

function BookmarkIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" />
    </svg>
  );
}
