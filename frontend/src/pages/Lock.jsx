import React, { useState, useEffect } from 'react';

const PIN_KEY = 'app_pin_hash';
const UNLOCK_KEY = 'app_unlocked';

async function hashPin(pin) {
  const data = new TextEncoder().encode(pin + 'tutor-salt');
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export default function Lock({ onUnlock }) {
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [mode, setMode] = useState('check'); // check | create | confirm
  const [error, setError] = useState('');
  const [shake, setShake] = useState(false);

  useEffect(() => {
    const hash = localStorage.getItem(PIN_KEY);
    setMode(hash ? 'check' : 'create');
  }, []);

  async function handleSubmit() {
    setError('');

    if (mode === 'create') {
      if (pin.length < 4) { setError('PIN חייב להיות לפחות 4 ספרות'); return; }
      setConfirmPin('');
      setMode('confirm');
      return;
    }

    if (mode === 'confirm') {
      if (confirmPin !== pin) {
        setError('הקודים לא תואמים. נסה שוב.');
        setShake(true);
        setTimeout(() => setShake(false), 500);
        setConfirmPin('');
        setMode('create');
        setPin('');
        return;
      }
      const hash = await hashPin(pin);
      localStorage.setItem(PIN_KEY, hash);
      sessionStorage.setItem(UNLOCK_KEY, '1');
      onUnlock();
      return;
    }

    // mode === 'check'
    const inputHash = await hashPin(pin);
    const savedHash = localStorage.getItem(PIN_KEY);
    if (inputHash === savedHash) {
      sessionStorage.setItem(UNLOCK_KEY, '1');
      onUnlock();
    } else {
      setError('קוד שגוי. נסה שוב.');
      setShake(true);
      setTimeout(() => setShake(false), 500);
      setPin('');
    }
  }

  function press(digit) {
    if (mode === 'confirm') {
      if (confirmPin.length < 6) setConfirmPin(p => p + digit);
      if (confirmPin.length + 1 >= 4 && confirmPin.length + 1 === pin.length) {
        // Auto-submit when length matches
        setTimeout(() => {
          const newConfirm = confirmPin + digit;
          if (newConfirm === pin) {
            hashPin(pin).then(hash => {
              localStorage.setItem(PIN_KEY, hash);
              sessionStorage.setItem(UNLOCK_KEY, '1');
              onUnlock();
            });
          } else {
            setError('הקודים לא תואמים. נסה שוב.');
            setShake(true);
            setTimeout(() => setShake(false), 500);
            setConfirmPin('');
            setMode('create');
            setPin('');
          }
        }, 200);
      }
    } else {
      if (pin.length < 6) setPin(p => p + digit);
    }
  }

  function backspace() {
    if (mode === 'confirm') setConfirmPin(p => p.slice(0, -1));
    else setPin(p => p.slice(0, -1));
  }

  function reset() {
    if (confirm('לאפס את הקוד? תאבד גישה זמנית עד שתגדיר חדש.')) {
      localStorage.removeItem(PIN_KEY);
      setMode('create');
      setPin('');
      setConfirmPin('');
      setError('');
    }
  }

  const currentPin = mode === 'confirm' ? confirmPin : pin;
  const title = mode === 'create' ? 'הגדר קוד אישי' : mode === 'confirm' ? 'אשר את הקוד' : 'הזן קוד';
  const subtitle = mode === 'create' ? 'בחר קוד בן 4-6 ספרות לאבטחת האפליקציה' :
                   mode === 'confirm' ? 'הקלד שוב את אותו קוד' :
                   'הקלד את הקוד שלך כדי להיכנס';

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', padding: 20,
      gap: 20
    }}>
      <div style={{
        background: 'rgba(255,255,255,0.78)',
        backdropFilter: 'blur(18px)',
        WebkitBackdropFilter: 'blur(18px)',
        border: '1px solid var(--border-glass)',
        borderRadius: 24,
        padding: '32px 28px',
        maxWidth: 360, width: '100%',
        boxShadow: 'var(--shadow-lg)',
        textAlign: 'center',
        animation: shake ? 'shake 0.4s' : 'fadeUp 0.4s'
      }}>
        <div className="icon-circle" style={{
          width: 56, height: 56, borderRadius: 16, margin: '0 auto 16px'
        }}>
          <LockIcon />
        </div>

        <h2 style={{ fontFamily: 'Heebo', fontSize: 22, fontWeight: 800, marginBottom: 6 }}>
          {title}
        </h2>
        <p style={{ color: 'var(--muted)', fontSize: 14, marginBottom: 22 }}>
          {subtitle}
        </p>

        {/* PIN dots */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginBottom: 22 }}>
          {[0, 1, 2, 3, 4, 5].map(i => (
            <div key={i} style={{
              width: 12, height: 12, borderRadius: '50%',
              background: i < currentPin.length ? 'var(--gold)' : 'transparent',
              border: '2px solid ' + (i < currentPin.length ? 'var(--gold)' : 'var(--border-strong)'),
              transition: 'all 0.15s',
              opacity: i < 4 || (i < pin.length || i < 4) ? 1 : (currentPin.length > i || pin.length > 4 ? 1 : 0.3)
            }} />
          ))}
        </div>

        {error && (
          <div style={{ color: 'var(--gold)', fontSize: 13, marginBottom: 14, fontWeight: 600 }}>
            {error}
          </div>
        )}

        {/* Numpad */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => (
            <button key={n} onClick={() => press(String(n))} style={numBtn}>{n}</button>
          ))}
          <button onClick={reset} style={{...numBtn, fontSize: 13, color: 'var(--muted)'}}>
            {mode === 'check' ? 'איפוס' : ''}
          </button>
          <button onClick={() => press('0')} style={numBtn}>0</button>
          <button onClick={backspace} style={{...numBtn, fontSize: 22}}>⌫</button>
        </div>

        {/* Submit for create/check */}
        {(mode === 'create' || (mode === 'check' && pin.length >= 4)) && (
          <button onClick={handleSubmit} className="btn-primary" style={{ marginTop: 18 }}>
            {mode === 'create' ? 'המשך' : 'כנס'}
          </button>
        )}
      </div>

      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-8px); }
          75% { transform: translateX(8px); }
        }
      `}</style>
    </div>
  );
}

const numBtn = {
  background: 'rgba(255,255,255,0.6)',
  border: '1px solid var(--border)',
  borderRadius: 14, padding: '16px 0',
  fontSize: 22, fontWeight: 600,
  cursor: 'pointer', color: 'var(--text)',
  fontFamily: 'inherit',
  transition: 'all 0.15s'
};

function LockIcon() {
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="11" rx="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>;
}
