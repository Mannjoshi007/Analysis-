'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { listSessions, deleteSession, type TestSession } from '@/lib/supabase'

const MOTOR_COLORS: Record<string, string> = {
  G: 'var(--purple)', H: 'var(--blue)', I: 'var(--green)',
  J: 'var(--teal)', K: 'var(--orange)', F: 'var(--amber)',
  default: 'var(--tx2)'
}

function motorColor(cls: string) {
  return MOTOR_COLORS[cls] || MOTOR_COLORS.default
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function HomePage() {
  const [sessions, setSessions] = useState<TestSession[]>([])
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState<string | null>(null)

  useEffect(() => {
    listSessions().then(data => { setSessions(data); setLoading(false) })
  }, [])

  async function handleDelete(e: React.MouseEvent, id: string) {
    e.preventDefault(); e.stopPropagation()
    if (!confirm('Delete this test session?')) return
    setDeleting(id)
    await deleteSession(id)
    setSessions(prev => prev.filter(s => s.id !== id))
    setDeleting(null)
  }

  async function handleCopyLink(e: React.MouseEvent, id: string) {
    e.preventDefault(); e.stopPropagation()
    await navigator.clipboard.writeText(`${window.location.origin}/report/${id}`)
    alert('Link copied!')
  }

  return (
    <>
      <div className="hdr">
        <div className="hdr-left">
          <a href="/" className="logo">🚀 KC DAQ <span>Motor Analysis</span></a>
          <span className="badge info">{sessions.length} SESSIONS</span>
        </div>
        <div className="hdr-right">
          <Link href="/analyze" className="btn primary">⚡ New Analysis</Link>
        </div>
      </div>

      <div className="home-hero">
        <h1>Motor Test <span>History</span></h1>
        <p>All saved KC DAQ test sessions — click any card to view the full interactive report, or share via link.</p>
        <div className="hero-btns">
          <Link href="/analyze" className="btn primary" style={{ padding: '10px 24px', fontSize: '13px' }}>⚡ New Analysis</Link>
          <a href="https://ynhdsdlkmkumcozccrdg.supabase.co" target="_blank" rel="noopener noreferrer" className="btn" style={{ fontSize: '13px' }}>🗄 Supabase Dashboard</a>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px' }}>
          <div className="spinner" />
          <p style={{ marginTop: '14px', color: 'var(--tx2)', fontFamily: 'var(--font-mono)', fontSize: '13px' }}>Loading sessions…</p>
        </div>
      ) : sessions.length === 0 ? (
        <div className="empty" style={{ paddingTop: '40px' }}>
          <div className="empty-icon">📡</div>
          <h3>No test sessions yet</h3>
          <p>Run an analysis and click <strong style={{ color: 'var(--orange)' }}>Save to Cloud</strong> to see it here.</p>
          <br />
          <Link href="/analyze" className="btn primary" style={{ marginTop: '8px' }}>⚡ Start Analysis</Link>
        </div>
      ) : (
        <div className="history-grid">
          {sessions.map(s => (
            <Link href={`/report/${s.id}`} key={s.id} className="session-card" style={{ textDecoration: 'none' }}>
              <div className="session-card-header">
                <div>
                  <div className="session-card-title">{s.name || 'Unnamed Test'}</div>
                  <div className="session-card-file">📄 {s.filename}</div>
                </div>
                <span className="class-badge" style={{ fontSize: '13px', padding: '3px 12px', color: motorColor(s.motor_class), background: `rgba(${motorColor(s.motor_class)}, .1)` }}>
                  {s.motor_class}
                </span>
              </div>
              <div className="session-meta">
                <div className="session-meta-item">
                  <div className="ml">Peak Thrust</div>
                  <div className="mv" style={{ color: 'var(--orange)' }}>{s.peak_thrust?.toFixed(1)} N</div>
                </div>
                <div className="session-meta-item">
                  <div className="ml">Total Impulse</div>
                  <div className="mv" style={{ color: 'var(--green)' }}>{s.total_impulse?.toFixed(2)} N·s</div>
                </div>
                <div className="session-meta-item">
                  <div className="ml">Burn Time</div>
                  <div className="mv" style={{ color: 'var(--blue)' }}>{s.burn_time?.toFixed(3)} s</div>
                </div>
                <div className="session-meta-item">
                  <div className="ml">Avg Temp</div>
                  <div className="mv" style={{ color: 'var(--amber)' }}>{s.avg_temp?.toFixed(1)} °C</div>
                </div>
              </div>
              <div className="session-date">
                <span>{fmtDate(s.created_at)}</span>
                <div className="session-actions" onClick={e => e.preventDefault()}>
                  <button className="btn" style={{ padding: '4px 10px', fontSize: '11px' }} onClick={e => handleCopyLink(e, s.id)}>🔗 Copy</button>
                  <button className="btn danger" style={{ padding: '4px 10px', fontSize: '11px' }}
                    onClick={e => handleDelete(e, s.id)} disabled={deleting === s.id}>
                    {deleting === s.id ? '…' : '🗑'}
                  </button>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      <div className="footer">KC DAQ Motor Analysis Platform · Powered by Supabase + Vercel</div>
    </>
  )
}
