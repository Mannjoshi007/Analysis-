'use client'
import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense } from 'react'

function LoginForm() {
  const router = useRouter()
  const params = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPass, setShowPass] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Login failed'); setLoading(false); return }
      router.push(params.get('from') || '/analyze')
    } catch {
      setError('Connection error — please try again')
      setLoading(false)
    }
  }

  return (
    <div className="login-root">
      <div className="login-bg">
        <div className="login-grid" />
        <div className="login-glow" />
      </div>

      <div className="login-card">
        {/* Logo + Title */}
        <div className="login-header">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/kailash-cosmos-logo.jpg" alt="Kailash Cosmos" className="login-logo" />
          <h1 className="login-brand">Kailash Cosmos</h1>
          <p className="login-tagline">अन्तरिक्षं प्रति महिमा</p>
          <div className="login-divider" />
          <p className="login-sub">Agni — Motor Analysis Platform</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="login-form">
          <div className="login-field">
            <label htmlFor="email">Email Address</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="you@kailashcosmos.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              disabled={loading}
            />
          </div>

          <div className="login-field">
            <label htmlFor="password">Password</label>
            <div className="pass-wrap">
              <input
                id="password"
                type={showPass ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                disabled={loading}
              />
              <button type="button" className="pass-toggle" onClick={() => setShowPass(v => !v)} tabIndex={-1}>
                {showPass ? '🙈' : '👁'}
              </button>
            </div>
          </div>

          {error && <div className="login-error">⚠ {error}</div>}

          <button type="submit" className="login-btn" disabled={loading}>
            {loading ? <span className="login-spinner" /> : '→'}
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

        <p className="login-footer">Access restricted to authorised personnel only</p>
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:wght@400;500;600&display=swap');

        .login-root {
          min-height: 100vh; display: flex; align-items: center; justify-content: center;
          background: #080a0f; position: relative; overflow: hidden; font-family: 'Inter', system-ui, sans-serif;
        }
        .login-bg { position: fixed; inset: 0; z-index: 0; pointer-events: none; }
        .login-grid {
          position: absolute; inset: 0;
          background-image: linear-gradient(rgba(255,94,26,.07) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,94,26,.07) 1px, transparent 1px);
          background-size: 40px 40px;
        }
        .login-glow {
          position: absolute; top: -200px; left: 50%; transform: translateX(-50%);
          width: 600px; height: 600px; border-radius: 50%;
          background: radial-gradient(circle, rgba(255,94,26,.12) 0%, transparent 70%);
        }
        .login-card {
          position: relative; z-index: 1; width: 420px; max-width: calc(100vw - 32px);
          background: rgba(22,25,32,.92); border: 1px solid rgba(255,255,255,.1);
          border-radius: 20px; padding: 40px 36px; backdrop-filter: blur(20px);
          box-shadow: 0 24px 64px rgba(0,0,0,.6), 0 0 0 1px rgba(255,94,26,.08);
        }
        .login-header { text-align: center; margin-bottom: 28px; }
        .login-logo { width: 80px; height: 80px; object-fit: contain; border-radius: 50%; margin-bottom: 12px; }
        .login-brand {
          font-family: 'Bank Gothic LT BT','BankGothic Lt BT','Bebas Neue', sans-serif;
          font-size: 28px; letter-spacing: .14em; color: #ff5e1a; margin: 0 0 2px;
          text-transform: uppercase;
        }
        .login-tagline { font-size: 12px; color: #8b90a0; margin: 0 0 14px; letter-spacing: .04em; }
        .login-divider { height: 1px; background: rgba(255,255,255,.08); margin: 0 0 10px; }
        .login-sub { font-size: 11px; color: #555b6e; letter-spacing: .06em; text-transform: uppercase; }
        .login-form { display: flex; flex-direction: column; gap: 16px; }
        .login-field { display: flex; flex-direction: column; gap: 6px; }
        .login-field label { font-size: 11px; color: #8b90a0; text-transform: uppercase; letter-spacing: .06em; font-weight: 500; }
        .login-field input {
          background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.12);
          border-radius: 10px; padding: 11px 14px; color: #e8e9ed; font-size: 14px;
          outline: none; transition: border-color .2s, box-shadow .2s; width: 100%;
        }
        .login-field input:focus { border-color: rgba(255,94,26,.6); box-shadow: 0 0 0 3px rgba(255,94,26,.1); }
        .login-field input:disabled { opacity: .5; cursor: not-allowed; }
        .pass-wrap { position: relative; }
        .pass-wrap input { padding-right: 42px; }
        .pass-toggle {
          position: absolute; right: 12px; top: 50%; transform: translateY(-50%);
          background: none; border: none; cursor: pointer; font-size: 15px; opacity: .6;
          padding: 0; line-height: 1;
        }
        .login-error {
          background: rgba(255,77,77,.12); border: 1px solid rgba(255,77,77,.3);
          border-radius: 8px; padding: 10px 12px; font-size: 13px; color: #ff6b6b;
        }
        .login-btn {
          display: flex; align-items: center; justify-content: center; gap: 8px;
          background: linear-gradient(135deg, #ff5e1a, #e04010);
          border: none; border-radius: 10px; padding: 13px; color: #fff;
          font-size: 14px; font-weight: 600; cursor: pointer; letter-spacing: .04em;
          transition: opacity .2s, transform .15s; margin-top: 4px;
        }
        .login-btn:hover:not(:disabled) { opacity: .9; transform: translateY(-1px); }
        .login-btn:disabled { opacity: .6; cursor: not-allowed; }
        .login-spinner {
          width: 16px; height: 16px; border: 2px solid rgba(255,255,255,.3);
          border-top-color: #fff; border-radius: 50%; animation: spin .7s linear infinite;
          display: inline-block;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        .login-footer { text-align: center; font-size: 11px; color: #3a3f4e; margin-top: 20px; }
      `}</style>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}
