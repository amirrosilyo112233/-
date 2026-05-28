import React, { useState, useEffect } from 'react';

export default function Insights() {
  const [insights, setInsights] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const res = await fetch('/api/insights');
    setInsights(await res.json());
    setLoading(false);
  }

  return (
    <div style={{ maxWidth: 780, margin: '0 auto', padding: '40px 24px 80px' }}>
      <div className="fade-up" style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, fontFamily: 'Heebo', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 12 }}>
          <div className="icon-circle" style={{ width: 40, height: 40, borderRadius: 12 }}>
            <SparkIcon />
          </div>
          רגעי וואו
        </h1>
        <p style={{ color: 'var(--muted)', fontSize: 15 }}>
          התובנות החזקות שגילית לאורך הלימוד — הרגעים שבהם המורה אמר "🔥 זה בדיוק".
        </p>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>טוען...</div>
      ) : insights.length === 0 ? (
        <div className="card fade-up" style={{ textAlign: 'center', padding: '50px 24px' }}>
          <div style={{ display: 'inline-flex', padding: 18, background: 'rgba(30,58,95,0.08)', borderRadius: 20, marginBottom: 16, color: 'var(--gold)' }}>
            <SparkIcon size={36} />
          </div>
          <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 8 }}>אין רגעי וואו עדיין</h3>
          <p style={{ color: 'var(--muted)', fontSize: 14, lineHeight: 1.7 }}>
            כשתאמר משהו עמוק והמורה יגיב ב-🔥 — הרגע יישמר כאן אוטומטית.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {insights.map((insight, i) => (
            <div key={insight.id} className="card fade-up" style={{
              animationDelay: `${i * 0.04}s`,
              background: 'rgba(255,255,255,0.78)',
              borderInlineStartColor: 'var(--gold)',
              borderInlineStartWidth: 4
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10, gap: 12 }}>
                <div style={{ fontSize: 22 }}>🔥</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'left' }}>
                  {new Date(insight.created_at).toLocaleDateString('he-IL', { day: 'numeric', month: 'short' })}
                  {insight.book_title && <div style={{ marginTop: 2, fontWeight: 600 }}>{insight.book_title}</div>}
                </div>
              </div>
              <div style={{
                fontSize: 15, color: 'var(--text)', lineHeight: 1.8,
                fontStyle: 'italic', fontWeight: 500,
                whiteSpace: 'pre-wrap'
              }}>
                "{insight.content}"
              </div>
              {insight.topic && insight.topic !== 'כללי' && (
                <div style={{
                  marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)',
                  fontSize: 13, color: 'var(--muted)'
                }}>
                  בנושא: {insight.topic.replace(/🔥/g, '').trim()}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SparkIcon({ size = 20 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2v6m0 8v6M4.93 4.93l4.24 4.24m5.66 5.66l4.24 4.24M2 12h6m8 0h6M4.93 19.07l4.24-4.24m5.66-5.66l4.24-4.24" />
  </svg>;
}
