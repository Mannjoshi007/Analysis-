'use client'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Chart, registerables } from 'chart.js'
import type { TestSession } from '@/lib/supabase'

Chart.register(...registerables)

interface RawRow { t: number; force: number; temp: number; impulse: number; t_ms: number }

function fmt(n: number, d = 3) { return isNaN(n) ? '--' : n.toFixed(d) }
function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const MOTOR_COLORS: Record<string, string> = {
  G: '#a78bfa', H: '#4ea8de', I: '#1fd1a0', J: '#00d4c8', K: '#ff5e1a', F: '#ffb347', default: '#8b90a0'
}

export default function SharedReportClient({ session }: { session: TestSession }) {
  const chartsRef = useRef<Record<string, Chart>>({})
  const [copied, setCopied] = useState(false)

  const raw = (session.raw_data || []) as unknown as RawRow[]
  const stats = session.stats as Record<string, number & string>
  const motorColor = MOTOR_COLORS[session.motor_class] || MOTOR_COLORS.default

  // Build burn data
  const peak = session.peak_thrust
  const thresh = Math.max(0.1, peak * 0.005)
  const burnData = raw.filter(r => r.force >= thresh)
  const t0 = burnData.length > 0 ? burnData[0].t : 0

  const bt = burnData.map(r => (r.t - t0).toFixed(3))
  const bf = burnData.map(r => r.force)
  const allT = raw.map(r => r.t.toFixed(3))
  const allTemp = raw.map(r => r.temp)
  const allImp = raw.map(r => r.impulse)

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
      mkChart('rpt-thrust', { type: 'line', data: { labels: bt, datasets: [{ label: 'Thrust', data: bf, borderColor: '#ff5e1a', borderWidth: 2, pointRadius: 0, tension: 0.25, fill: true, backgroundColor: 'rgba(255,94,26,.08)' }] }, options: { ...chartBase, scales: { x: { ...chartBase.scales.x, title: { display: true, text: 'Time (s)', color: '#8b90a0', font: { size: 10 } } }, y: { ...chartBase.scales.y, title: { display: true, text: 'N', color: '#8b90a0', font: { size: 10 } } } } } })
      mkChart('rpt-impulse', { type: 'line', data: { labels: allT, datasets: [{ label: 'Impulse', data: allImp, borderColor: '#1fd1a0', borderWidth: 2, pointRadius: 0, tension: 0.25, fill: true, backgroundColor: 'rgba(31,209,160,.07)' }] }, options: { ...chartBase, scales: { x: { ...chartBase.scales.x, title: { display: true, text: 'Time (s)', color: '#8b90a0', font: { size: 10 } } }, y: { ...chartBase.scales.y, title: { display: true, text: 'N·s', color: '#8b90a0', font: { size: 10 } } } } } })
      mkChart('rpt-temp', { type: 'line', data: { labels: allT, datasets: [{ label: 'Temp', data: allTemp, borderColor: '#ffb347', borderWidth: 1.5, pointRadius: 0, tension: 0.3, fill: true, backgroundColor: 'rgba(255,179,71,.07)' }] }, options: { ...chartBase, scales: { x: { ...chartBase.scales.x, title: { display: true, text: 'Time (s)', color: '#8b90a0', font: { size: 10 } } }, y: { ...chartBase.scales.y, title: { display: true, text: '°C', color: '#8b90a0', font: { size: 10 } } } } } })

      const dfdt = [0, ...burnData.slice(1).map((r, i) => {
        const dt = r.t - burnData[i].t; return dt > 0 ? (r.force - burnData[i].force) / dt : 0
      })]
      mkChart('rpt-dfdt', { type: 'line', data: { labels: bt, datasets: [{ label: 'dF/dt', data: dfdt, borderColor: '#4ea8de', borderWidth: 1.5, pointRadius: 0, tension: 0.2, fill: true, backgroundColor: 'rgba(78,168,222,.07)' }] }, options: { ...chartBase, scales: { x: { ...chartBase.scales.x, title: { display: true, text: 'Time (s)', color: '#8b90a0', font: { size: 10 } } }, y: { ...chartBase.scales.y, title: { display: true, text: 'N/s', color: '#8b90a0', font: { size: 10 } } } } } })
      mkChart('rpt-norm', { type: 'line', data: { labels: bt, datasets: [{ label: 'Norm', data: bf.map(v => peak > 0 ? v / peak : 0), borderColor: '#a78bfa', borderWidth: 1.5, pointRadius: 0, tension: 0.25, fill: true, backgroundColor: 'rgba(167,139,250,.07)' }] }, options: { ...chartBase, scales: { x: { ...chartBase.scales.x, title: { display: true, text: 'Time (s)', color: '#8b90a0', font: { size: 10 } } }, y: { ...chartBase.scales.y, min: 0, max: 1, title: { display: true, text: 'F/Fpeak', color: '#8b90a0', font: { size: 10 } } } } } })
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
          <Link href="/" className="logo">🚀 KC DAQ <span>Motor Analysis</span></Link>
          <span className="badge ok">SHARED REPORT</span>
        </div>
        <div className="hdr-right">
          <button className="btn" onClick={copyLink}>{copied ? '✓ Copied!' : '🔗 Copy Link'}</button>
          <Link href="/analyze" className="btn primary">⚡ New Analysis</Link>
          <Link href="/" className="btn">📋 History</Link>
        </div>
      </div>

      <div className="report-view">
        {/* Banner */}
        <div className="report-banner">
          <div>
            <h1>{session.name}</h1>
            <div className="rb-meta">📄 {session.filename} · 🕐 {fmtDate(session.created_at)}</div>
          </div>
          <span className="class-badge" style={{ fontSize: '20px', padding: '6px 20px', color: motorColor, background: `${motorColor}18`, borderColor: `${motorColor}44` }}>
            {session.motor_class} Class
          </span>
        </div>

        {/* Key Stats */}
        <div className="report-stats">
          {[
            { lbl: 'Peak Thrust', val: `${fmt(session.peak_thrust, 2)} N`, color: 'var(--orange)' },
            { lbl: 'Avg Thrust', val: `${fmt(session.avg_thrust, 2)} N`, color: 'var(--blue)' },
            { lbl: 'Total Impulse', val: `${fmt(session.total_impulse, 3)} N·s`, color: 'var(--green)' },
            { lbl: 'Burn Time', val: `${fmt(session.burn_time, 3)} s`, color: 'var(--tx)' },
            { lbl: 'Est. Isp', val: `${session.isp} s`, color: 'var(--purple)' },
            { lbl: 'Avg Temp', val: `${fmt(session.avg_temp, 1)} °C`, color: 'var(--amber)' },
          ].map(it => (
            <div key={it.lbl} className="report-stat">
              <div className="rs-lbl">{it.lbl}</div>
              <div className="rs-val" style={{ color: it.color }}>{it.val}</div>
            </div>
          ))}
        </div>

        {/* Thrust Chart */}
        {raw.length > 0 && (
          <>
            <div className="chart-panel">
              <div className="chart-hdr"><span className="chart-title">Thrust Curve</span><div className="legend"><span className="leg-item"><span className="leg-dot" style={{ background: 'var(--orange)' }} />Thrust (N)</span></div></div>
              <div className="chart-wrap-tall"><canvas id="rpt-thrust" /></div>
            </div>
            <div className="two-col">
              <div className="chart-panel"><div className="chart-hdr"><span className="chart-title">Cumulative Impulse</span></div><div className="chart-wrap"><canvas id="rpt-impulse" /></div></div>
              <div className="chart-panel"><div className="chart-hdr"><span className="chart-title">Temperature</span></div><div className="chart-wrap"><canvas id="rpt-temp" /></div></div>
            </div>
            <div className="two-col">
              <div className="chart-panel"><div className="chart-hdr"><span className="chart-title">dF/dt — Thrust Rate</span></div><div className="chart-wrap"><canvas id="rpt-dfdt" /></div></div>
              <div className="chart-panel"><div className="chart-hdr"><span className="chart-title">Normalised Thrust</span></div><div className="chart-wrap"><canvas id="rpt-norm" /></div></div>
            </div>
          </>
        )}

        {/* Analysis */}
        <div className="two-col" style={{ marginTop: '14px' }}>
          <div className="section">
            <div className="section-title">Performance Metrics</div>
            <table className="kv-table">
              {[
                ['Peak Thrust', `${fmt(session.peak_thrust, 3)} N`],
                ['Average Thrust', `${fmt(session.avg_thrust, 3)} N`],
                ['Total Impulse', `${fmt(session.total_impulse, 4)} N·s`],
                ['Motor Class', session.motor_class],
                ['Burn Duration (t₅)', `${fmt(session.burn_time, 3)} s`],
                ['Estimated Isp', `${session.isp} s`],
                ['Burn Profile', session.profile_type],
                ['Sample Rate', `${fmt(session.sample_rate, 1)} Hz`],
                ['Total Samples', session.total_samples],
                ['Burn Samples', session.burn_samples],
              ].map(([k, v]) => <tr key={String(k)}><td>{k}</td><td>{v}</td></tr>)}
            </table>
          </div>
          <div className="section">
            <div className="section-title">Signal Quality</div>
            <table className="kv-table">
              {[
                ['SNR', `${fmt(session.snr_db, 1)} dB`],
                ['Pressure Sensor', '⚠ Not connected'],
                ['Load Cell', '10 kg (98.1 N max)'],
                ['Over-range?', session.peak_thrust > 98.1 ? `⚠ YES — ${fmt(session.peak_thrust, 1)} N` : `No (${((session.peak_thrust / 98.1) * 100).toFixed(0)}% of range)`],
              ].map(([k, v]) => <tr key={String(k)}><td>{k}</td><td>{v}</td></tr>)}
            </table>
            <div className={`conclusion${session.peak_thrust > 90 ? ' warn' : ''}`} style={{ marginTop: '14px' }}>
              <p><strong style={{ color: 'var(--purple)' }}>{session.motor_class}-class</strong> motor · {session.profile_type} burn profile · {fmt(session.total_impulse, 3)} N·s</p>
            </div>
          </div>
        </div>

        <div className="footer" style={{ marginTop: '8px' }}>
          KC DAQ Motor Analysis Platform · <Link href="/" style={{ color: 'var(--orange)', textDecoration: 'none' }}>View all sessions</Link>
        </div>
      </div>
    </>
  )
}
