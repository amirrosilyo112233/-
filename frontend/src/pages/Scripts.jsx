import React, { useState, useEffect } from 'react';

export default function Scripts() {
  const [scripts, setScripts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const res = await fetch('/api/scripts');
    setScripts(await res.json());
    setLoading(false);
  }

  return (
    <div style={{ maxWidth: 780, margin: '0 auto', padding: '40px 24px 80px' }}>
      <div className="fade-up" style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, fontFamily: 'Heebo', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 12 }}>
          <div className="icon-circle" style={{ width: 40, height: 40, borderRadius: 12 }}>
            <ScrollIcon />
          </div>
          התסריטים שלי
        </h1>
        <p style={{ color: 'var(--muted)', fontSize: 15 }}>
          התסריטים שהמורה זיהה אצלך לאורך הלימוד — דפוסים שעולים בחיים שלך.
        </p>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>טוען...</div>
      ) : scripts.length === 0 ? (
        <div className="card fade-up" style={{ textAlign: 'center', padding: '50px 24px' }}>
          <div style={{ display: 'inline-flex', padding: 18, background: 'rgba(220,38,38,0.08)', borderRadius: 20, marginBottom: 16, color: 'var(--gold)' }}>
            <ScrollIcon size={36} />
          </div>
          <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 8 }}>אין תסריטים עדיין</h3>
          <p style={{ color: 'var(--muted)', fontSize: 14, lineHeight: 1.7 }}>
            כשהמורה יזהה תסריט חיים תוך כדי שיחה — הוא יסומן ב-🛑 וישמר כאן אוטומטית.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {scripts.map((s, i) => (
            <div key={s.id} className="card fade-up" style={{ animationDelay: `${i * 0.04}s` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10, gap: 12 }}>
                <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--text)', flex: 1 }}>
                  🛑 {s.name}
                </div>
                <span style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                  {new Date(s.created_at).toLocaleDateString('he-IL', { day: 'numeric', month: 'short' })}
                </span>
              </div>
              {s.description && (
                <div style={{ fontSize: 14, color: 'var(--text-soft)', lineHeight: 1.7, marginBottom: s.context ? 10 : 0, whiteSpace: 'pre-wrap' }}>
                  {s.description}
                </div>
              )}
              {s.context && (
                <div style={{
                  borderTop: '1px solid var(--border)',
                  paddingTop: 10, fontSize: 13, color: 'var(--muted)', fontStyle: 'italic'
                }}>
                  בהקשר של: "{s.context}"
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ScrollIcon({ size = 20 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 17V5a2 2 0 0 0-2-2H4" /><path d="M22 17H2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2z" />
  </svg>;
}
