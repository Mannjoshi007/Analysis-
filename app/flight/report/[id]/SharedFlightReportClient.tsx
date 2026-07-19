'use client'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Chart, registerables } from 'chart.js'
import type { FlightSession } from '@/lib/supabase-flight'

Chart.register(...registerables)

interface RawRow { t: number; alt: number; climb: number; accel: number; roll: number; pitch: number; yaw: number; rssi: number; snr: number }

function fmt(n: number, d = 2) { return n === null || n === undefined || isNaN(n) ? '--' : n.toFixed(d) }
function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}
function verdictColor(v: string) {
  if (v === 'safe') return '#1fd1a0'
  if (v === 'marginal') return '#ffb347'
  if (v === 'danger') return '#ff4d4d'
  return '#8b90a0'
}

export default function SharedFlightReportClient({ session }: { session: FlightSession }) {
  const chartsRef = useRef<Record<string, Chart>>({})
  const [copied, setCopied] = useState(false)

  const raw = (session.raw_data || []) as unknown as RawRow[]
  const stats = (session.stats || {}) as Record<string, number & string & boolean>
  const verdict = session.descent_verdict || 'unknown'

  const allT = raw.map(r => (r.t - (stats.liftoffT || 0)).toFixed(3))
  const alt = raw.map(r => r.alt)
  const climb = raw.map(r => r.climb)
  const accel = raw.map(r => r.accel)

  function mkChart(id: string, cfg: object) {
    const canvas = document.getElementById(id) as HTMLCanvasElement
    if (!canvas) return
    if (chartsRef.current[id]) chartsRef.current[id].destroy()
    chartsRef.current[id] = new Chart(canvas, cfg as never)
  }

  const chartBase = {
    responsive: true, maintainAspectRatio: false, animation: false,
    interaction: { intersect: false, mode: 'index' as const },
    plugins: { legend: { display: false }, tooltip: { backgroundColor: '#1e222d', titleColor: '#ff5e1a', bodyColor: '#e8e9ed', borderColor: 'rgba(255,255,255,.1)', borderWidth: 1 } },
    scales: {
      x: { grid: { color: 'rgba(255,255,255,.04)' }, ticks: { color: '#8b90a0', font: { size: 10 }, maxTicksLimit: 8 } },
      y: { grid: { color: 'rgba(255,255,255,.04)' }, ticks: { color: '#8b90a0', font: { size: 10 }, maxTicksLimit: 6 } }
    }
  }

  useEffect(() => {
    if (!raw.length) return
    setTimeout(() => {
      mkChart('rpt-alt', { type: 'line', data: { labels: allT, datasets: [{ label: 'Altitude', data: alt, borderColor: '#ff5e1a', borderWidth: 2, pointRadius: 0, tension: 0.2, fill: true, backgroundColor: 'rgba(255,94,26,.08)' }] }, options: { ...chartBase, scales: { x: { ...chartBase.scales.x, title: { display: true, text: 'Time (s)', color: '#8b90a0', font: { size: 10 } } }, y: { ...chartBase.scales.y, title: { display: true, text: 'm', color: '#8b90a0', font: { size: 10 } } } } } })
      mkChart('rpt-climb', { type: 'line', data: { labels: allT, datasets: [{ label: 'Climb Rate', data: climb, borderColor: '#4ea8de', borderWidth: 1.5, pointRadius: 0, tension: 0.2, fill: true, backgroundColor: 'rgba(78,168,222,.07)' }] }, options: { ...chartBase, scales: { x: { ...chartBase.scales.x, title: { display: true, text: 'Time (s)', color: '#8b90a0', font: { size: 10 } } }, y: { ...chartBase.scales.y, title: { display: true, text: 'm/s', color: '#8b90a0', font: { size: 10 } } } } } })
      mkChart('rpt-accel', { type: 'line', data: { labels: allT, datasets: [{ label: 'Accel', data: accel, borderColor: '#1fd1a0', borderWidth: 1.5, pointRadius: 0, tension: 0.2, fill: true, backgroundColor: 'rgba(31,209,160,.07)' }] }, options: { ...chartBase, scales: { x: { ...chartBase.scales.x, title: { display: true, text: 'Time (s)', color: '#8b90a0', font: { size: 10 } } }, y: { ...chartBase.scales.y, title: { display: true, text: 'G', color: '#8b90a0', font: { size: 10 } } } } } })
    }, 80)
    return () => { Object.values(chartsRef.current).forEach(c => c.destroy()) }
  }, [])

  async function copyLink() {
    await navigator.clipboard.writeText(window.location.href)
    setCopied(true); setTimeout(() => setCopied(false), 2000)
  }

  return (
    <>
      <div className="hdr">
        <div className="hdr-left">
          <Link href="/flight" className="logo">🪂 KC DAQ <span>Flight Analysis</span></Link>
          <span className="badge ok">SHARED REPORT</span>
        </div>
        <div className="hdr-right">
          <button className="btn" onClick={copyLink}>{copied ? '✓ Copied!' : '🔗 Copy Link'}</button>
          <Link href="/flight/analyze" className="btn primary">⚡ New Flight Analysis</Link>
          <Link href="/flight" className="btn">📋 Flight History</Link>
        </div>
      </div>

      <div className="report-view">
        <div className="report-banner">
          <div>
            <h1>{session.name}</h1>
            <div className="rb-meta">📄 {session.filename} · 🕐 {fmtDate(session.created_at)}</div>
          </div>
          <span className="class-badge" style={{ fontSize: '18px', padding: '6px 20px', color: verdictColor(verdict), background: `${verdictColor(verdict)}18`, borderColor: `${verdictColor(verdict)}44` }}>
            {verdict.toUpperCase()}
          </span>
        </div>

        <div className="report-stats">
          {[
            { lbl: 'Apogee', val: `${fmt(session.apogee_m, 1)} m`, color: 'var(--orange)' },
            { lbl: 'Max Climb', val: `${fmt(session.max_climb_rate, 1)} m/s`, color: 'var(--blue)' },
            { lbl: 'Max Descent', val: `${fmt(Math.abs(session.max_descent_rate), 1)} m/s`, color: 'var(--green)' },
            { lbl: 'Deploy Alt.', val: `${fmt(session.deploy_alt_m, 1)} m`, color: 'var(--tx)' },
            { lbl: 'Max Accel', val: `${fmt(session.max_accel_g, 2)} G`, color: 'var(--purple)' },
            { lbl: 'Duration', val: `${fmt(session.flight_duration, 1)} s`, color: 'var(--amber)' },
          ].map(it => (
            <div key={it.lbl} className="report-stat">
              <div className="rs-lbl">{it.lbl}</div>
              <div className="rs-val" style={{ color: it.color }}>{it.val}</div>
            </div>
          ))}
        </div>

        {raw.length > 0 && (
          <>
            <div className="chart-panel">
              <div className="chart-hdr"><span className="chart-title">Altitude vs Time</span></div>
              <div className="chart-wrap-tall"><canvas id="rpt-alt" /></div>
            </div>
            <div className="two-col">
              <div className="chart-panel"><div className="chart-hdr"><span className="chart-title">Climb Rate</span></div><div className="chart-wrap"><canvas id="rpt-climb" /></div></div>
              <div className="chart-panel"><div className="chart-hdr"><span className="chart-title">Acceleration</span></div><div className="chart-wrap"><canvas id="rpt-accel" /></div></div>
            </div>
          </>
        )}

        <div className="two-col" style={{ marginTop: '14px' }}>
          <div className="section">
            <div className="section-title">Flight Performance</div>
            <table className="kv-table">
              {[
                ['Apogee', `${fmt(session.apogee_m, 2)} m`],
                ['Max Climb Rate', `${fmt(session.max_climb_rate, 2)} m/s`],
                ['Max Descent Rate', `${fmt(Math.abs(session.max_descent_rate), 2)} m/s`],
                ['Deployment Altitude', `${fmt(session.deploy_alt_m, 2)} m`],
                ['Max Acceleration', `${fmt(session.max_accel_g, 2)} G`],
                ['Flight Duration', `${fmt(session.flight_duration, 2)} s`],
                ['Sample Rate', `${fmt(session.sample_rate, 1)} Hz`],
                ['Total Samples', session.total_samples],
              ].map(([k, v]) => <tr key={String(k)}><td>{k}</td><td>{v}</td></tr>)}
            </table>
          </div>
          <div className="section">
            <div className="section-title">Recovery & Telemetry</div>
            <table className="kv-table">
              {[
                ['Descent Verdict', verdict.toUpperCase()],
                ['Telemetry Gaps', `${stats.gapCount ?? 0} (${fmt(stats.totalGapS as number, 1)}s lost)`],
                ['Baro Uptime', `${fmt(stats.baroUptimePct as number, 1)}%`],
                ['IMU Uptime', `${fmt(stats.imuUptimePct as number, 1)}%`],
              ].map(([k, v]) => <tr key={String(k)}><td>{k}</td><td>{v}</td></tr>)}
            </table>
            <div className={`conclusion${verdict === 'danger' ? ' warn' : ''}`} style={{ marginTop: '14px' }}>
              <p><strong style={{ color: verdictColor(verdict) }}>{verdict.toUpperCase()}</strong> descent · apogee {fmt(session.apogee_m, 1)} m · deployed at {fmt(session.deploy_alt_m, 1)} m</p>
            </div>
          </div>
        </div>

        <div className="footer" style={{ marginTop: '8px' }}>
          KC DAQ Flight Analysis Platform · <Link href="/flight" style={{ color: 'var(--orange)', textDecoration: 'none' }}>View all flights</Link>
        </div>
      </div>
    </>
  )
}
