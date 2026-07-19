'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { listFlightSessions, deleteFlightSession, type FlightSession } from '@/lib/supabase-flight'

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}
function fmt(n: number, d = 1) { return n === null || n === undefined || isNaN(n) ? '--' : n.toFixed(d) }
function verdictColor(v: string) {
  if (v === 'safe') return 'var(--green)'
  if (v === 'marginal') return 'var(--amber)'
  if (v === 'danger') return 'var(--red)'
  return 'var(--tx2)'
}

export default function FlightHomePage() {
  const [sessions, setSessions] = useState<FlightSession[]>([])
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState<string | null>(null)

  useEffect(() => {
    listFlightSessions().then(data => { setSessions(data); setLoading(false) })
  }, [])

  async function handleDelete(e: React.MouseEvent, id: string) {
    e.preventDefault(); e.stopPropagation()
    if (!confirm('Delete this flight session?')) return
    setDeleting(id)
    await deleteFlightSession(id)
    setSessions(prev => prev.filter(s => s.id !== id))
    setDeleting(null)
  }

  async function handleCopyLink(e: React.MouseEvent, id: string) {
    e.preventDefault(); e.stopPropagation()
    await navigator.clipboard.writeText(`${window.location.origin}/flight/report/${id}`)
    alert('Link copied!')
  }

  return (
    <>
      <div className="hdr">
        <div className="hdr-left">
          <Link href="/flight" className="logo">🪂 KC DAQ <span>Flight Analysis</span></Link>
          <span className="badge info">{sessions.length} FLIGHTS</span>
        </div>
        <div className="hdr-right">
          <Link href="/flight/analyze" className="btn primary">⚡ New Flight Analysis</Link>
          <Link href="/" className="btn">🔥 Static Tests</Link>
        </div>
      </div>

      <div className="home-hero">
        <h1>Flight Test <span>History</span></h1>
        <p>All saved dynamic flight-log sessions — click any card for the full interactive report, or share via link.</p>
        <div className="hero-btns">
          <Link href="/flight/analyze" className="btn primary" style={{ padding: '10px 24px', fontSize: '13px' }}>⚡ New Flight Analysis</Link>
          <Link href="/" className="btn" style={{ fontSize: '13px' }}>🔥 Static Motor Tests</Link>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px' }}>
          <div className="spinner" />
          <p style={{ marginTop: '14px', color: 'var(--tx2)', fontFamily: 'var(--font-mono)', fontSize: '13px' }}>Loading flight sessions…</p>
        </div>
      ) : sessions.length === 0 ? (
        <div className="empty" style={{ paddingTop: '40px' }}>
          <div className="empty-icon">🪂</div>
          <h3>No flight sessions yet</h3>
          <p>Run a flight analysis and click <strong style={{ color: 'var(--orange)' }}>Save to Cloud</strong> to see it here.</p>
          <br />
          <Link href="/flight/analyze" className="btn primary" style={{ marginTop: '8px' }}>⚡ Start Flight Analysis</Link>
        </div>
      ) : (
        <div className="history-grid">
          {sessions.map(s => (
            <Link href={`/flight/report/${s.id}`} key={s.id} className="session-card" style={{ textDecoration: 'none' }}>
              <div className="session-card-header">
                <div>
                  <div className="session-card-title">{s.name || 'Unnamed Flight'}</div>
                  <div className="session-card-file">📄 {s.filename}</div>
                </div>
                <span className="class-badge" style={{ fontSize: '12px', padding: '3px 12px', color: verdictColor(s.descent_verdict), background: `${verdictColor(s.descent_verdict)}18`, borderColor: `${verdictColor(s.descent_verdict)}44` }}>
                  {(s.descent_verdict || 'unknown').toUpperCase()}
                </span>
              </div>
              <div className="session-meta">
                <div className="session-meta-item">
                  <div className="ml">Apogee</div>
                  <div className="mv" style={{ color: 'var(--orange)' }}>{fmt(s.apogee_m)} m</div>
                </div>
                <div className="session-meta-item">
                  <div className="ml">Max Climb</div>
                  <div className="mv" style={{ color: 'var(--blue)' }}>{fmt(s.max_climb_rate)} m/s</div>
                </div>
                <div className="session-meta-item">
                  <div className="ml">Max Descent</div>
                  <div className="mv" style={{ color: 'var(--green)' }}>{fmt(Math.abs(s.max_descent_rate))} m/s</div>
                </div>
                <div className="session-meta-item">
                  <div className="ml">Duration</div>
                  <div className="mv" style={{ color: 'var(--amber)' }}>{fmt(s.flight_duration, 1)} s</div>
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

      <div className="footer">KC DAQ Flight Analysis Platform · Powered by Supabase + Vercel</div>
    </>
  )
}
