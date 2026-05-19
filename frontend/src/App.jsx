import React, { useState, useEffect } from 'react';
import Home from './pages/Home';
import Chat from './pages/Chat';
import FieldLog from './pages/FieldLog';
import Archive from './pages/Archive';
import Lock from './pages/Lock';
import Scripts from './pages/Scripts';
import Insights from './pages/Insights';

export default function App() {
  const [unlocked, setUnlocked] = useState(() =>
    sessionStorage.getItem('app_unlocked') === '1'
  );
  const [page, setPage] = useState('home');
  const [activeBook, setActiveBook] = useState(null);
  const [books, setBooks] = useState([]);
  const [installPrompt, setInstallPrompt] = useState(null);

  useEffect(() => { if (unlocked) loadBooks(); }, [unlocked]);

  useEffect(() => {
    const handler = (e) => { e.preventDefault(); setInstallPrompt(e); };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  async function loadBooks() {
    const res = await fetch('/api/books');
    setBooks(await res.json());
  }

  function openBook(book) { setActiveBook(book); setPage('chat'); }
  function openArchive(book) { setActiveBook(book); setPage('archive'); }

  async function installApp() {
    if (!installPrompt) return;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === 'accepted') setInstallPrompt(null);
  }

  function lockApp() {
    sessionStorage.removeItem('app_unlocked');
    setUnlocked(false);
  }

  if (!unlocked) return <Lock onUnlock={() => setUnlocked(true)} />;

  // Chat takes full screen, no bottom nav
  if (page === 'chat' && activeBook) {
    return <Chat book={activeBook} onBack={() => { setPage('home'); loadBooks(); }} />;
  }
  if (page === 'archive' && activeBook) {
    return <Archive book={activeBook} onBack={() => setPage('home')} />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', paddingBottom: 76 }}>
      {/* Prominent top header */}
      <header style={{
        background: 'linear-gradient(135deg, #C8843D 0%, #D99858 100%)',
        borderBottom: 'none',
        padding: '14px 18px',
        display: 'flex', alignItems: 'center',
        position: 'sticky', top: 0, zIndex: 50,
        gap: 10,
        boxShadow: '0 4px 20px rgba(120,80,30,0.22)'
      }}>
        <div style={{ marginInlineEnd: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 38, height: 38, borderRadius: 12,
            background: 'rgba(255,255,255,0.18)',
            backdropFilter: 'blur(8px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', flexShrink: 0,
            border: '1px solid rgba(255,255,255,0.25)'
          }}>
            <BookIcon />
          </div>
          <div style={{
            fontWeight: 800, fontSize: 17, color: '#FFFFFF',
            fontFamily: 'Heebo', lineHeight: 1.1,
            letterSpacing: '-0.2px'
          }}>
            המורה הפרטי שלי
          </div>
        </div>
        {installPrompt && (
          <button onClick={installApp} style={{
            background: 'rgba(255,255,255,0.18)',
            backdropFilter: 'blur(8px)',
            color: '#FFFFFF',
            border: '1px solid rgba(255,255,255,0.25)',
            borderRadius: 10, padding: '7px 12px', cursor: 'pointer',
            fontFamily: 'inherit', fontSize: 13, fontWeight: 600,
            display: 'flex', alignItems: 'center', gap: 5
          }}>
            <DownloadIcon /> התקן
          </button>
        )}
        <button onClick={lockApp} title="נעל" style={{
          background: 'rgba(255,255,255,0.12)',
          border: '1px solid rgba(255,255,255,0.20)',
          borderRadius: 10, padding: '7px 9px', cursor: 'pointer',
          color: '#FFFFFF', display: 'flex'
        }}>
          <LockSmIcon />
        </button>
      </header>

      {/* Page content */}
      <main style={{ flex: 1 }}>
        {page === 'home' && (
          <Home books={books} onOpenBook={openBook} onOpenArchive={openArchive} onRefresh={loadBooks} />
        )}
        {page === 'insights' && <Insights />}
        {page === 'scripts' && <Scripts />}
        {page === 'log' && <FieldLog books={books} />}
      </main>

      {/* Bottom Navigation */}
      <nav className="pb-safe" style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        background: 'rgba(255,255,255,0.96)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderTop: '1px solid var(--border)',
        padding: '8px 8px 20px',
        display: 'flex', justifyContent: 'space-around',
        zIndex: 100,
        boxShadow: '0 -2px 12px rgba(80,55,25,0.08)'
      }}>
        <TabBtn active={page === 'home'} onClick={() => setPage('home')} icon={<HomeIcon />} label="בית" />
        <TabBtn active={page === 'insights'} onClick={() => setPage('insights')} icon={<SparkIcon />} label="וואו" />
        <TabBtn active={page === 'scripts'} onClick={() => setPage('scripts')} icon={<ScriptIcon />} label="תסריטים" />
        <TabBtn active={page === 'log'} onClick={() => setPage('log')} icon={<BookmarkIcon />} label="יומן" />
      </nav>
    </div>
  );
}

function TabBtn({ active, onClick, icon, label }) {
  return (
    <button onClick={onClick} style={{
      background: 'transparent',
      border: 'none',
      cursor: 'pointer',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
      padding: '8px 10px',
      color: active ? 'var(--primary)' : 'var(--muted)',
      fontFamily: 'inherit', fontSize: 11, fontWeight: 600,
      flex: 1,
      transition: 'color 0.2s'
    }}>
      <div style={{
        width: 36, height: 36,
        borderRadius: 12,
        background: active ? 'var(--primary-pale)' : 'transparent',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'background 0.2s'
      }}>
        {icon}
      </div>
      <span>{label}</span>
    </button>
  );
}

function BookIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>;
}
function HomeIcon() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></svg>;
}
function SparkIcon() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" /></svg>;
}
function ScriptIcon() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 17V5a2 2 0 0 0-2-2H4" /><path d="M22 17H2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2z" /></svg>;
}
function BookmarkIcon() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" /></svg>;
}
function DownloadIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>;
}
function LockSmIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>;
}
