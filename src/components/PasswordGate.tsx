"use client";

import { useState, useEffect } from 'react';

const AUTH_KEY = 'social-listening-auth';

export default function PasswordGate({ children }: { children: React.ReactNode }) {
  const [authed, setAuthed] = useState(false);
  const [checking, setChecking] = useState(true);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const saved = localStorage.getItem(AUTH_KEY);
    if (saved === 'true') {
      setAuthed(true);
    }
    setChecking(false);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });

    const data = await res.json();
    if (data.success) {
      localStorage.setItem(AUTH_KEY, 'true');
      setAuthed(true);
    } else {
      setError('密碼錯誤，請重新輸入');
    }
  };

  if (checking) return null;

  if (authed) return <>{children}</>;

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#fafaf8' }}>
      <div className="w-full max-w-sm rounded-xl p-8" style={{ backgroundColor: '#ffffff', border: '1px solid #e8e8e5' }}>
        <h1 className="text-xl font-bold mb-1 text-center" style={{ color: '#1a1a1a' }}>
          只要輿情
        </h1>
        <p className="text-sm text-center mb-6" style={{ color: '#6b6b6b' }}>
          請輸入密碼以繼續
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="密碼"
            autoFocus
            className="w-full rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#2d2d2d] focus:outline-none"
            style={{
              border: error ? '1px solid #f87171' : '1px solid #e8e8e5',
              backgroundColor: '#ffffff',
              color: '#1a1a1a',
            }}
          />
          {error && (
            <p className="text-xs" style={{ color: '#c75c5c' }}>{error}</p>
          )}
          <button
            type="submit"
            className="w-full py-2 rounded-lg text-sm font-medium transition"
            style={{ backgroundColor: '#1a1a1a', color: '#ffffff' }}
          >
            進入
          </button>
        </form>
      </div>
    </div>
  );
}
