'use client'
import { useEffect, useRef, useState, useCallback } from 'react'
import Link from 'next/link'
import { Chart, registerables } from 'chart.js'
import { saveFlightSession } from '@/lib/supabase-flight'

Chart.register(...registerables)

// ─── Types ───────────────────────────────────────────────────────────────────
interface RawRow {
  t_ms: number; seq: number; state: string; armed: number
  alt: number; peakAlt: number; climb: number
  roll: number; pitch: number; yaw: number; accel: number
  baroOK: number; imuOK: number; servo: number
  rssi: number; snr: number; t: number
}

interface GapInfo { t: number; dur: number }

interface Stats {
  liftoffT: number; apogee: number; apogeeTime: number
  deployDetected: boolean; deployAlt: number; deployTime: number; deployDelay: number; earlyDeployment: boolean
  maxClimbRate: number; maxClimbTime: number
  maxDescentRate: number; avgDescentRate: number
  maxAccel: number; maxAccelTime: number
  landingDetected: boolean; flightDuration: number
  totalSamples: number; sampleRateHz: number; avgDt: number
  avgRssi: number; minRssi: number; avgSnr: number; minSnr: number
  baroUptimePct: number; imuUptimePct: number
  gapCount: number; maxGapS: number; totalGapS: number; gaps: GapInfo[]
  stateDurations: Record<string, number>
  descentVerdict: 'safe' | 'marginal' | 'danger' | 'unknown'
  liftoffIdx: number; apogeeIdx: number; deployIdx: number
}

// ─── Helpers ───────────────────────────────────────────────────────────────────
function fmt(n: number, d = 3) { return isNaN(n) || n === undefined ? '--' : n.toFixed(d) }

function verdictColor(v: string) {
  if (v === 'safe') return 'var(--green)'
  if (v === 'marginal') return 'var(--amber)'
  if (v === 'danger') return 'var(--red)'
  return 'var(--tx2)'
}
function verdictLabel(v: string) {
  if (v === 'safe') return 'SAFE'
  if (v === 'marginal') return 'MARGINAL'
  if (v === 'danger') return 'DANGER'
  return 'UNKNOWN'
}

const CD_TABLE: [string, number, string][] = [
  ['Flat Circular', 0.75, 'Simple, fast descent, common on drogues'],
  ['Hemispherical', 1.5, 'Standard main canopy, most hobby kits'],
  ['Cruciform (X-form)', 0.65, 'Easy to build, slightly less efficient'],
  ['Toroidal', 1.9, 'Compact, efficient, more complex to sew'],
  ['Ballistic (none)', 0.3, 'Body drag only — nosecone-first tumble'],
]

const DESCENT_GUIDE: [string, string][] = [
  ['< 1 kg', '≤ 8 m/s'],
  ['1 – 5 kg', '≤ 7 m/s'],
  ['5 – 15 kg', '≤ 6 m/s'],
  ['> 15 kg', '≤ 5 m/s'],
]

export default function FlightAnalyzePage() {
  const [raw, setRaw] = useState<RawRow[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [filename, setFilename] = useState('')
  const [activeTab, setActiveTab] = useState('dashboard')
  const [drag, setDrag] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveModal, setSaveModal] = useState(false)
  const [sessionName, setSessionName] = useState('')
  const [shareUrl, setShareUrl] = useState('')
  const [toast, setToast] = useState<{ msg: string; type: string } | null>(null)

  // Calculator state
  const [sizeCalc, setSizeCalc] = useState({ mass: 1.2, targetV: 5, cd: 1.5, rho: 1.225 })
  const [rateCalc, setRateCalc] = useState({ mass: 1.2, dia: 60, cd: 1.5, rho: 1.225 })

  const chartsRef = useRef<Record<string, Chart>>({})
  const dropRef = useRef<HTMLDivElement>(null)

  const showToast = useCallback((msg: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3500)
  }, [])

  // ─── CSV Parse ─────────────────────────────────────────────────────────────
  function parseCSV(text: string) {
    const lines = text.trim().split('\n')
    const rows: RawRow[] = []
    for (let i = 1; i < lines.length; i++) {
      const p = lines[i].split(',')
      if (p.length < 14) continue
      const t_ms = parseFloat(p[0]), alt = parseFloat(p[4])
      if (isNaN(t_ms) || isNaN(alt)) continue
      rows.push({
        t_ms, seq: +p[1], state: (p[2] || '').trim(), armed: +p[3],
        alt, peakAlt: parseFloat(p[5]), climb: parseFloat(p[6]),
        roll: parseFloat(p[7]), pitch: parseFloat(p[8]), yaw: parseFloat(p[9]),
        accel: parseFloat(p[10]), baroOK: +p[11], imuOK: +p[12], servo: parseFloat(p[13]),
        rssi: parseFloat(p[14]), snr: parseFloat(p[15]), t: 0
      })
    }
    if (!rows.length) { showToast('No valid data in CSV', 'error'); return }
    processData(rows)
  }

  // ─── Process Data ──────────────────────────────────────────────────────────
  function processData(rows: RawRow[]) {
    const t0ms = rows[0].t_ms
    rows.forEach(r => { r.t = (r.t_ms - t0ms) / 1000 })

    let liftoffIdx = rows.findIndex(r => r.state.toUpperCase() !== 'ARMED' && r.state.toUpperCase() !== 'IDLE')
    if (liftoffIdx < 0) liftoffIdx = 0
    const liftoffT = rows[liftoffIdx].t

    let apogeeIdx = 0
    rows.forEach((r, i) => { if (r.alt > rows[apogeeIdx].alt) apogeeIdx = i })
    const apogee = rows[apogeeIdx].alt
    const apogeeTime = rows[apogeeIdx].t - liftoffT

    let deployIdx = rows.findIndex((r, i) => i >= liftoffIdx && r.servo && r.servo !== 0)
    if (deployIdx < 0) deployIdx = rows.findIndex((r, i) => i >= liftoffIdx && r.state.toUpperCase() === 'EJECTED')
    const deployDetected = deployIdx >= 0
    const deployAlt = deployDetected ? rows[deployIdx].alt : 0
    const deployTime = deployDetected ? rows[deployIdx].t - liftoffT : 0
    const deployDelay = deployDetected ? deployTime - apogeeTime : 0
    const earlyDeployment = deployDetected && deployIdx < apogeeIdx && deployAlt < apogee * 0.95

    const ascentRows = rows.slice(liftoffIdx, apogeeIdx + 1)
    let maxClimbIdx = liftoffIdx
    ascentRows.forEach((r, i) => { if (r.climb > rows[maxClimbIdx].climb) maxClimbIdx = liftoffIdx + i })
    const maxClimbRate = ascentRows.length ? rows[maxClimbIdx].climb : 0
    const maxClimbTime = ascentRows.length ? rows[maxClimbIdx].t - liftoffT : 0

    const descentRows = rows.slice(apogeeIdx + 1)
    const maxDescentRate = descentRows.length ? Math.min(...descentRows.map(r => r.climb)) : 0
    const stableDescentRows = deployDetected
      ? rows.slice(deployIdx).filter(r => (r.t - rows[deployIdx].t) > 0.5 && r.climb < 0)
      : descentRows.filter(r => r.climb < 0)
    const avgDescentRate = stableDescentRows.length
      ? stableDescentRows.reduce((a, r) => a + r.climb, 0) / stableDescentRows.length
      : maxDescentRate

    let maxAccelIdx = 0
    rows.forEach((r, i) => { if (r.accel > rows[maxAccelIdx].accel) maxAccelIdx = i })
    const maxAccel = rows[maxAccelIdx].accel
    const maxAccelTime = rows[maxAccelIdx].t - liftoffT

    let landingIdx = rows.length - 1
    let landingDetected = false
    for (let i = rows.length - 1; i > Math.max(apogeeIdx, 0); i--) {
      if (Math.abs(rows[i].climb) < 1 && rows[i].alt < Math.max(5, apogee * 0.1)) { landingIdx = i; landingDetected = true; break }
    }
    const flightDuration = rows[landingIdx].t - liftoffT

    const dts: number[] = []
    for (let i = 1; i < rows.length; i++) dts.push(rows[i].t_ms - rows[i - 1].t_ms)
    const sortedDts = [...dts].sort((a, b) => a - b)
    const medianDt = sortedDts.length ? sortedDts[Math.floor(sortedDts.length / 2)] : 1000
    const gapThreshold = Math.max(medianDt * 4, 3000)
    const gaps: GapInfo[] = []
    for (let i = 1; i < rows.length; i++) {
      const dt = rows[i].t_ms - rows[i - 1].t_ms
      if (dt > gapThreshold) gaps.push({ t: rows[i - 1].t - liftoffT, dur: dt / 1000 })
    }
    const avgDt = dts.length ? dts.reduce((a, b) => a + b, 0) / dts.length : 0
    const sampleRateHz = avgDt > 0 ? 1000 / avgDt : 0

    const rssis = rows.map(r => r.rssi).filter(v => !isNaN(v))
    const snrs = rows.map(r => r.snr).filter(v => !isNaN(v))
    const avgRssi = rssis.length ? rssis.reduce((a, b) => a + b, 0) / rssis.length : 0
    const minRssi = rssis.length ? Math.min(...rssis) : 0
    const avgSnr = snrs.length ? snrs.reduce((a, b) => a + b, 0) / snrs.length : 0
    const minSnr = snrs.length ? Math.min(...snrs) : 0

    const baroUptimePct = rows.length ? rows.filter(r => r.baroOK === 1).length / rows.length * 100 : 0
    const imuUptimePct = rows.length ? rows.filter(r => r.imuOK === 1).length / rows.length * 100 : 0

    const stateDurations: Record<string, number> = {}
    for (let i = 1; i < rows.length; i++) {
      const dt = (rows[i].t_ms - rows[i - 1].t_ms) / 1000
      if (dt > 0 && dt < gapThreshold / 1000) {
        const st = rows[i - 1].state.toUpperCase() || 'UNKNOWN'
        stateDurations[st] = (stateDurations[st] || 0) + dt
      }
    }

    const descAbs = Math.abs(avgDescentRate)
    const descentVerdict: Stats['descentVerdict'] = !deployDetected || descAbs === 0 ? 'unknown' : descAbs <= 6 ? 'safe' : descAbs <= 9 ? 'marginal' : 'danger'

    const newStats: Stats = {
      liftoffT, apogee, apogeeTime, deployDetected, deployAlt, deployTime, deployDelay, earlyDeployment,
      maxClimbRate, maxClimbTime, maxDescentRate, avgDescentRate, maxAccel, maxAccelTime,
      landingDetected, flightDuration, totalSamples: rows.length, sampleRateHz, avgDt,
      avgRssi, minRssi, avgSnr, minSnr, baroUptimePct, imuUptimePct,
      gapCount: gaps.length, maxGapS: gaps.length ? Math.max(...gaps.map(g => g.dur)) : 0,
      totalGapS: gaps.reduce((a, g) => a + g.dur, 0), gaps, stateDurations, descentVerdict,
      liftoffIdx, apogeeIdx, deployIdx
    }

    setRaw(rows)
    setStats(newStats)
    setSessionName(filename.replace('.csv', '') || 'Flight Test')
    showToast(`Loaded ${rows.length} samples — apogee ${apogee.toFixed(1)} m`, 'success')
  }

  // ─── Chart Rendering ───────────────────────────────────────────────────────
  function mkChart(id: string, cfg: object) {
    const canvas = document.getElementById(id) as HTMLCanvasElement
    if (!canvas) return
    if (chartsRef.current[id]) chartsRef.current[id].destroy()
    chartsRef.current[id] = new Chart(canvas, cfg as never)
  }

  const chartDefaults = {
    responsive: true, maintainAspectRatio: false, animation: false,
    interaction: { intersect: false, mode: 'index' as const },
    plugins: { legend: { display: false }, tooltip: { backgroundColor: '#1e222d', titleColor: '#ff5e1a', bodyColor: '#e8e9ed', borderColor: 'rgba(255,255,255,.1)', borderWidth: 1 } },
    scales: {
      x: { display: true, grid: { color: 'rgba(255,255,255,.04)' }, ticks: { color: '#8b90a0', font: { size: 10 }, maxTicksLimit: 8 } },
      y: { grid: { color: 'rgba(255,255,255,.04)' }, ticks: { color: '#8b90a0', font: { size: 10 }, maxTicksLimit: 6 } }
    }
  }
  function axisTitle(text: string) { return { display: true, text, color: '#8b90a0', font: { size: 10 } } }

  useEffect(() => {
    if (!stats || !raw.length) return
    const t0 = stats.liftoffT
    const allT = raw.map(r => (r.t - t0).toFixed(3))
    const alt = raw.map(r => r.alt)
    const climb = raw.map(r => r.climb)
    const accel = raw.map(r => r.accel)
    const roll = raw.map(r => r.roll)
    const pitch = raw.map(r => r.pitch)
    const yaw = raw.map(r => r.yaw)
    const rssi = raw.map(r => r.rssi)
    const snr = raw.map(r => r.snr)
    const dts = raw.slice(1).map((r, i) => r.t_ms - raw[i].t_ms)

    setTimeout(() => {
      mkChart('alt-chart', { type: 'line', data: { labels: allT, datasets: [{ label: 'Altitude', data: alt, borderColor: '#ff5e1a', borderWidth: 2, pointRadius: 0, tension: 0.2, fill: true, backgroundColor: 'rgba(255,94,26,.07)' }] }, options: { ...chartDefaults, scales: { x: { ...chartDefaults.scales.x, title: axisTitle('Time (s)') }, y: { ...chartDefaults.scales.y, title: axisTitle('m') } } } })
      mkChart('climb-chart', { type: 'line', data: { labels: allT, datasets: [{ label: 'Climb Rate', data: climb, borderColor: '#4ea8de', borderWidth: 1.5, pointRadius: 0, tension: 0.2, fill: true, backgroundColor: 'rgba(78,168,222,.07)' }] }, options: { ...chartDefaults, scales: { x: { ...chartDefaults.scales.x, title: axisTitle('Time (s)') }, y: { ...chartDefaults.scales.y, title: axisTitle('m/s') } } } })
      mkChart('accel-chart', { type: 'line', data: { labels: allT, datasets: [{ label: 'Accel', data: accel, borderColor: '#1fd1a0', borderWidth: 1.5, pointRadius: 0, tension: 0.2, fill: true, backgroundColor: 'rgba(31,209,160,.07)' }] }, options: { ...chartDefaults, scales: { x: { ...chartDefaults.scales.x, title: axisTitle('Time (s)') }, y: { ...chartDefaults.scales.y, title: axisTitle('G') } } } })
      mkChart('full-alt-chart', { type: 'line', data: { labels: allT, datasets: [{ label: 'Altitude', data: alt, borderColor: '#ff5e1a', borderWidth: 2, pointRadius: 0, tension: 0.2, fill: true, backgroundColor: 'rgba(255,94,26,.07)' }] }, options: { ...chartDefaults, scales: { x: { ...chartDefaults.scales.x, title: axisTitle('Time (s)') }, y: { ...chartDefaults.scales.y, title: axisTitle('m') } } } })

      mkChart('orient-chart', { type: 'line', data: { labels: allT, datasets: [
        { label: 'Roll', data: roll, borderColor: '#a78bfa', borderWidth: 1.3, pointRadius: 0, tension: 0.2, fill: false },
        { label: 'Pitch', data: pitch, borderColor: '#4ea8de', borderWidth: 1.3, pointRadius: 0, tension: 0.2, fill: false },
        { label: 'Yaw', data: yaw, borderColor: '#ffb347', borderWidth: 1.3, pointRadius: 0, tension: 0.2, fill: false },
      ] }, options: { ...chartDefaults, scales: { x: { ...chartDefaults.scales.x, title: axisTitle('Time (s)') }, y: { ...chartDefaults.scales.y, title: axisTitle('deg') } } } })

      mkChart('link-chart', { type: 'line', data: { labels: allT, datasets: [
        { label: 'RSSI', data: rssi, borderColor: '#4ea8de', borderWidth: 1.5, pointRadius: 0, tension: 0.2, fill: false, yAxisID: 'y' },
        { label: 'SNR', data: snr, borderColor: '#1fd1a0', borderWidth: 1.5, pointRadius: 0, tension: 0.2, fill: false, yAxisID: 'y2' },
      ] }, options: { responsive: true, maintainAspectRatio: false, animation: false, interaction: { intersect: false, mode: 'index' as const },
        plugins: { legend: { display: false }, tooltip: { backgroundColor: '#1e222d', titleColor: '#ff5e1a', bodyColor: '#e8e9ed', borderColor: 'rgba(255,255,255,.1)', borderWidth: 1 } },
        scales: { x: { grid: { color: 'rgba(255,255,255,.04)' }, ticks: { color: '#8b90a0', font: { size: 10 }, maxTicksLimit: 8 }, title: axisTitle('Time (s)') }, y: { grid: { color: 'rgba(255,255,255,.04)' }, ticks: { color: '#4ea8de', font: { size: 10 } }, title: { display: true, text: 'RSSI (dBm)', color: '#4ea8de', font: { size: 10 } } }, y2: { position: 'right' as const, grid: { display: false }, ticks: { color: '#1fd1a0', font: { size: 10 } }, title: { display: true, text: 'SNR (dB)', color: '#1fd1a0', font: { size: 10 } } } } } })

      mkChart('dt-chart', { type: 'line', data: { labels: raw.slice(1).map(r => (r.t - t0).toFixed(3)), datasets: [{ label: 'Δt', data: dts, borderColor: '#1fd1a0', borderWidth: 1, pointRadius: 0, tension: 0.1, fill: false }] }, options: { ...chartDefaults, scales: { x: { ...chartDefaults.scales.x, title: axisTitle('Time (s)') }, y: { ...chartDefaults.scales.y, title: axisTitle('ms') } } } })

      // Deployment tab — descent-zoomed altitude & climb
      if (stats.deployDetected) {
        const zoomStart = Math.max(0, stats.deployIdx - 3)
        const zoomRows = raw.slice(zoomStart)
        mkChart('deploy-chart', { type: 'line', data: { labels: zoomRows.map(r => (r.t - t0).toFixed(3)), datasets: [
          { label: 'Altitude (m)', data: zoomRows.map(r => r.alt), borderColor: '#ff5e1a', borderWidth: 2, pointRadius: 0, tension: 0.2, fill: true, backgroundColor: 'rgba(255,94,26,.08)', yAxisID: 'y' },
          { label: 'Climb Rate (m/s)', data: zoomRows.map(r => r.climb), borderColor: '#4ea8de', borderWidth: 1.5, pointRadius: 0, tension: 0.2, fill: false, yAxisID: 'y2' },
        ] }, options: { responsive: true, maintainAspectRatio: false, animation: false, interaction: { intersect: false, mode: 'index' as const },
          plugins: { legend: { display: false }, tooltip: { backgroundColor: '#1e222d', titleColor: '#ff5e1a', bodyColor: '#e8e9ed', borderColor: 'rgba(255,255,255,.1)', borderWidth: 1 } },
          scales: { x: { grid: { color: 'rgba(255,255,255,.04)' }, ticks: { color: '#8b90a0', font: { size: 10 }, maxTicksLimit: 8 }, title: axisTitle('Time (s)') }, y: { grid: { color: 'rgba(255,255,255,.04)' }, ticks: { color: '#ff5e1a', font: { size: 10 } }, title: { display: true, text: 'Altitude (m)', color: '#ff5e1a', font: { size: 10 } } }, y2: { position: 'right' as const, grid: { display: false }, ticks: { color: '#4ea8de', font: { size: 10 } }, title: { display: true, text: 'Climb Rate (m/s)', color: '#4ea8de', font: { size: 10 } } } } } })
      }
    }, 50)
  }, [raw, stats, activeTab])

  // ─── Save to Supabase ─────────────────────────────────────────────────────
  async function handleSave() {
    if (!stats || !raw.length) return
    setSaving(true)
    const result = await saveFlightSession(sessionName || 'Flight Test', filename, stats as unknown as Record<string, unknown>, raw.map(r => ({ ...r })))
    setSaving(false)
    setSaveModal(false)
    if (result) {
      const url = `${window.location.origin}/flight/report/${result.id}`
      setShareUrl(url)
      showToast('Saved! Share URL ready.', 'success')
    } else {
      showToast('Save failed — check Supabase connection / flight_sessions table', 'error')
    }
  }

  // ─── File Handlers ────────────────────────────────────────────────────────
  function onCsvFile(file: File) {
    setFilename(file.name)
    const reader = new FileReader()
    reader.onload = e => parseCSV(e.target?.result as string)
    reader.readAsText(file)
  }

  const hasData = !!stats

  // ─── Calculator derived values ────────────────────────────────────────────
  const g = 9.81
  const sizeAreaM2 = sizeCalc.targetV > 0 ? (2 * sizeCalc.mass * g) / (sizeCalc.cd * sizeCalc.rho * sizeCalc.targetV ** 2) : 0
  const sizeDiaCm = sizeAreaM2 > 0 ? Math.sqrt((4 * sizeAreaM2) / Math.PI) * 100 : 0
  const rateAreaM2 = Math.PI * Math.pow(rateCalc.dia / 100 / 2, 2)
  const rateVms = rateAreaM2 > 0 ? Math.sqrt((2 * rateCalc.mass * g) / (rateCalc.cd * rateCalc.rho * rateAreaM2)) : 0

  // ─── Status items ──────────────────────────────────────────────────────────
  const statusItems = stats ? [
    { ok: stats.liftoffIdx > 0 || raw[0]?.state.toUpperCase() !== 'ARMED', label: 'Liftoff detected', sub: `t = ${fmt(0, 1)} s ref.` },
    { ok: stats.apogee > 0, label: 'Apogee detected', sub: `${fmt(stats.apogee, 1)} m` },
    { ok: stats.deployDetected, label: 'Deployment detected', sub: stats.deployDetected ? `${fmt(stats.deployAlt, 1)} m` : 'Not found', cls: stats.deployDetected ? undefined : 'bad' },
    { ok: stats.gapCount === 0, label: 'Telemetry link', sub: stats.gapCount === 0 ? 'No gaps' : `${stats.gapCount} gap(s), ${fmt(stats.totalGapS, 1)}s lost`, cls: stats.gapCount === 0 ? 'ok' : 'warn' },
    { ok: stats.baroUptimePct > 95 && stats.imuUptimePct > 95, label: 'Sensor health', sub: `Baro ${fmt(stats.baroUptimePct, 0)}% · IMU ${fmt(stats.imuUptimePct, 0)}%` },
    { ok: !stats.earlyDeployment, label: 'Deployment timing', sub: stats.earlyDeployment ? '⚠ Before apogee' : 'Nominal', cls: stats.earlyDeployment ? 'warn' : undefined },
  ] : []

  const stateList = stats ? Object.entries(stats.stateDurations).sort((a, b) => b[1] - a[1]) : []
  const stateTotal = stateList.reduce((a, [, v]) => a + v, 0) || 1

  return (
    <>
      {/* HEADER */}
      <div className="hdr">
        <div className="hdr-left">
          <Link href="/flight" className="logo">🪂 KC DAQ <span>Flight Analysis</span></Link>
          <span className={`badge ${hasData ? 'ok' : 'warn'}`}>{hasData ? 'DATA LOADED' : 'NO DATA'}</span>
        </div>
        <div className="hdr-right">
          <label className="btn" style={{ cursor: 'pointer' }}>
            📂 Load Flight CSV <input type="file" accept=".csv" style={{ display: 'none' }} onChange={e => e.target.files?.[0] && onCsvFile(e.target.files[0])} />
          </label>
          <button className="btn primary" disabled={!hasData} onClick={() => setSaveModal(true)}>☁ Save to Cloud</button>
          <Link href="/flight" className="btn">📋 Flight History</Link>
          <Link href="/" className="btn">🔥 Static Tests</Link>
        </div>
      </div>

      {shareUrl && (
        <div className="share-bar" style={{ margin: '12px 24px 0' }}>
          <span style={{ color: 'var(--green)', fontSize: '12px' }}>✓ Saved!</span>
          <span className="share-url">{shareUrl}</span>
          <button className="btn primary" style={{ padding: '4px 12px', fontSize: '11px' }} onClick={() => { navigator.clipboard.writeText(shareUrl); showToast('Link copied!', 'info') }}>Copy Link</button>
          <a href={shareUrl} target="_blank" rel="noopener noreferrer" className="btn" style={{ padding: '4px 12px', fontSize: '11px' }}>Open ↗</a>
        </div>
      )}

      {/* TABS */}
      <div className="tabs">
        {[['dashboard', '📊 Dashboard'], ['charts', '📈 Curves'], ['analysis', '🔬 Analysis'], ['deployment', '🪂 Deployment'], ['report', '📄 Report'], ['calculator', '🔧 Calculator']].map(([id, label]) => (
          <button key={id} className={`tab${activeTab === id ? ' active' : ''}`} onClick={() => setActiveTab(id)}>{label}</button>
        ))}
      </div>

      {/* DASHBOARD */}
      <div className={`page${activeTab === 'dashboard' ? ' active' : ''}`}>
        {!hasData ? (
          <div className={`drop-zone${drag ? ' drag' : ''}`} ref={dropRef}
            onDragOver={e => { e.preventDefault(); setDrag(true) }}
            onDragLeave={() => setDrag(false)}
            onDrop={e => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f?.name.endsWith('.csv')) onCsvFile(f) }}>
            <div className="drop-zone-icon">🪂</div>
            <p><strong>Drop a flight log CSV here</strong></p>
            <p>or <label style={{ color: 'var(--orange)', cursor: 'pointer' }}>click to browse <input type="file" accept=".csv" style={{ display: 'none' }} onChange={e => e.target.files?.[0] && onCsvFile(e.target.files[0])} /></label></p>
            <p style={{ marginTop: '10px', fontSize: '11px', color: 'var(--tx3)' }}>Expected columns: phoneTime, seq, state, armed, altitude_m, peakAltitude_m, climbRate_mps, roll, pitch, yaw, accelG, baroOK, imuOK, servoAngle, rssi, snr</p>
          </div>
        ) : (
          <>
            <div className="grid">
              <div className="card"><div className="lbl">Apogee</div><div className="val" style={{ color: 'var(--orange)' }}>{fmt(stats!.apogee, 1)} m</div><div className="sub">at t = {fmt(stats!.apogeeTime, 2)} s</div></div>
              <div className="card"><div className="lbl">Max Climb Rate</div><div className="val" style={{ color: 'var(--blue)' }}>{fmt(stats!.maxClimbRate, 1)} m/s</div><div className="sub">at t = {fmt(stats!.maxClimbTime, 2)} s</div></div>
              <div className="card"><div className="lbl">Max Descent Rate</div><div className="val" style={{ color: verdictColor(stats!.descentVerdict) }}>{fmt(Math.abs(stats!.maxDescentRate), 1)} m/s</div><div className="sub">{verdictLabel(stats!.descentVerdict)}</div></div>
              <div className="card"><div className="lbl">Deployment Alt.</div><div className="val">{stats!.deployDetected ? `${fmt(stats!.deployAlt, 1)} m` : '--'}</div><div className="sub">{stats!.deployDetected ? `Δ${stats!.deployDelay >= 0 ? '+' : ''}${fmt(stats!.deployDelay, 2)}s vs apogee` : 'not detected'}</div></div>
              <div className="card"><div className="lbl">Max Acceleration</div><div className="val" style={{ color: 'var(--green)' }}>{fmt(stats!.maxAccel, 2)} G</div><div className="sub">at t = {fmt(stats!.maxAccelTime, 2)} s</div></div>
              <div className="card"><div className="lbl">Flight Duration</div><div className="val" style={{ color: 'var(--purple)' }}>{fmt(stats!.flightDuration, 1)} s</div><div className="sub">{stats!.landingDetected ? 'liftoff → landing' : 'liftoff → last sample'}</div></div>
            </div>
            <div className="chart-panel">
              <div className="chart-hdr"><span className="chart-title">Altitude vs Time</span><div className="legend"><span className="leg-item"><span className="leg-dot" style={{ background: 'var(--orange)' }} />Altitude (m)</span></div></div>
              <div className="chart-wrap"><canvas id="alt-chart" /></div>
            </div>
            <div className="two-col">
              <div className="chart-panel"><div className="chart-hdr"><span className="chart-title">Climb Rate vs Time</span></div><div className="chart-wrap"><canvas id="climb-chart" /></div></div>
              <div className="chart-panel"><div className="chart-hdr"><span className="chart-title">Acceleration vs Time</span></div><div className="chart-wrap"><canvas id="accel-chart" /></div></div>
            </div>
          </>
        )}
      </div>

      {/* CHARTS */}
      <div className={`page${activeTab === 'charts' ? ' active' : ''}`}>
        {!hasData ? <div className="empty"><div className="empty-icon">📈</div><h3>Load a flight CSV to view curves</h3></div> : (
          <>
            <div className="chart-panel">
              <div className="chart-hdr"><span className="chart-title">Full Altitude Curve</span></div>
              <div className="chart-wrap-tall"><canvas id="full-alt-chart" /></div>
            </div>
            <div className="chart-panel">
              <div className="chart-hdr"><span className="chart-title">Orientation (Roll / Pitch / Yaw)</span>
                <div className="legend">
                  <span className="leg-item"><span className="leg-dot" style={{ background: '#a78bfa' }} />Roll</span>
                  <span className="leg-item"><span className="leg-dot" style={{ background: '#4ea8de' }} />Pitch</span>
                  <span className="leg-item"><span className="leg-dot" style={{ background: '#ffb347' }} />Yaw</span>
                </div>
              </div>
              <div className="chart-wrap"><canvas id="orient-chart" /></div>
            </div>
            <div className="chart-panel">
              <div className="chart-hdr"><span className="chart-title">Telemetry Link Quality (RSSI / SNR)</span>
                <div className="legend">
                  <span className="leg-item"><span className="leg-dot" style={{ background: '#4ea8de' }} />RSSI (dBm)</span>
                  <span className="leg-item"><span className="leg-dot" style={{ background: '#1fd1a0' }} />SNR (dB)</span>
                </div>
              </div>
              <div className="chart-wrap"><canvas id="link-chart" /></div>
            </div>
            <div className="chart-panel"><div className="chart-hdr"><span className="chart-title">Log Interval (ms between samples) — gaps = telemetry dropout</span></div><div className="chart-wrap"><canvas id="dt-chart" /></div></div>
          </>
        )}
      </div>

      {/* ANALYSIS */}
      <div className={`page${activeTab === 'analysis' ? ' active' : ''}`}>
        {!hasData ? <div className="empty"><div className="empty-icon">🔬</div><h3>Load a flight CSV to analyse</h3></div> : (
          <>
            <div className="status-grid">
              {statusItems.map((it, i) => (
                <div key={i} className="status-item">
                  <div className={`status-dot ${it.cls ?? (it.ok ? 'ok' : 'bad')}`} />
                  <div className="status-text"><strong>{it.label}</strong><span>{it.sub}</span></div>
                </div>
              ))}
            </div>
            <div className="two-col">
              <div className="section">
                <div className="section-title">Flight Performance Metrics</div>
                <table className="kv-table">
                  {[
                    ['Apogee', `${fmt(stats!.apogee, 2)} m`],
                    ['Time to Apogee', `${fmt(stats!.apogeeTime, 3)} s`],
                    ['Max Climb Rate', `${fmt(stats!.maxClimbRate, 2)} m/s`],
                    ['Max Descent Rate', `${fmt(Math.abs(stats!.maxDescentRate), 2)} m/s`],
                    ['Avg Descent Rate (stable)', `${fmt(Math.abs(stats!.avgDescentRate), 2)} m/s`],
                    ['Max Acceleration', `${fmt(stats!.maxAccel, 2)} G`],
                    ['Deployment Altitude', stats!.deployDetected ? `${fmt(stats!.deployAlt, 2)} m` : '--'],
                    ['Deployment Delay vs Apogee', stats!.deployDetected ? `${stats!.deployDelay >= 0 ? '+' : ''}${fmt(stats!.deployDelay, 2)} s` : '--'],
                    ['Flight Duration', `${fmt(stats!.flightDuration, 2)} s`],
                  ].map(([k, v]) => <tr key={k}><td>{k}</td><td>{v}</td></tr>)}
                </table>
              </div>
              <div className="section">
                <div className="section-title">Recovery Verdict</div>
                <div style={{ textAlign: 'center', padding: '12px 0 8px' }}>
                  <span className="class-badge" style={{ color: verdictColor(stats!.descentVerdict), background: `${verdictColor(stats!.descentVerdict)}22`, borderColor: `${verdictColor(stats!.descentVerdict)}55` }}>{verdictLabel(stats!.descentVerdict)}</span>
                </div>
                <table className="kv-table">
                  {[
                    ['Descent classification', 'Based on stable post-deployment descent rate'],
                    ['Safe', '≤ 6 m/s'],
                    ['Marginal', '6 – 9 m/s'],
                    ['Danger', '> 9 m/s'],
                    ['Early deployment?', stats!.earlyDeployment ? '⚠ Yes — triggered before apogee' : 'No'],
                  ].map(([k, v]) => <tr key={k}><td>{k}</td><td className={k.startsWith('Early') && stats!.earlyDeployment ? 'warn-val' : ''}>{v}</td></tr>)}
                </table>
              </div>
            </div>
            <div className="section">
              <div className="section-title">Flight Phase Breakdown</div>
              {stateList.map(([st, dur]) => {
                const pct = dur / stateTotal * 100
                const color = st === 'ARMED' ? '#4ea8de' : st === 'ASCENT' ? '#ff5e1a' : st === 'EJECTED' ? '#1fd1a0' : '#a78bfa'
                return (
                  <div key={st} className="prog-row">
                    <div className="prog-lbl"><span>{st}</span><span>{fmt(dur, 1)} s ({pct.toFixed(0)}%)</span></div>
                    <div className="prog-bar"><div className="prog-fill" style={{ width: `${pct.toFixed(1)}%`, background: color }} /></div>
                  </div>
                )
              })}
            </div>
            <div className="section">
              <div className="section-title">Data Quality & Telemetry</div>
              <table className="kv-table">
                {[
                  ['Total samples', stats!.totalSamples],
                  ['Log rate', `${fmt(stats!.sampleRateHz, 2)} Hz (avg Δt ${fmt(stats!.avgDt, 0)} ms)`],
                  ['Telemetry gaps', stats!.gapCount === 0 ? 'None' : `${stats!.gapCount} gap(s)`],
                  ['Largest gap', stats!.gapCount ? `${fmt(stats!.maxGapS, 1)} s` : '--'],
                  ['Total time lost to gaps', `${fmt(stats!.totalGapS, 1)} s`],
                  ['Baro sensor uptime', `${fmt(stats!.baroUptimePct, 1)}%`],
                  ['IMU sensor uptime', `${fmt(stats!.imuUptimePct, 1)}%`],
                  ['Avg RSSI', `${fmt(stats!.avgRssi, 1)} dBm`],
                  ['Worst RSSI', `${fmt(stats!.minRssi, 1)} dBm`],
                  ['Avg SNR', `${fmt(stats!.avgSnr, 1)} dB`],
                  ['Worst SNR', `${fmt(stats!.minSnr, 1)} dB`],
                ].map(([k, v]) => <tr key={String(k)}><td>{k}</td><td>{v}</td></tr>)}
              </table>
            </div>
          </>
        )}
      </div>

      {/* DEPLOYMENT */}
      <div className={`page${activeTab === 'deployment' ? ' active' : ''}`}>
        {!hasData ? <div className="empty"><div className="empty-icon">🪂</div><h3>Load a flight CSV to analyse deployment</h3></div> : (
          <>
            <div className="section">
              <div className="section-title">Recovery Deployment Analysis</div>
              <div style={{ fontSize: '13px', color: 'var(--tx2)', lineHeight: '1.7', marginBottom: '14px' }}>
                Deployment is detected from the servo/ejection channel and the <strong style={{ color: 'var(--tx)' }}>EJECTED</strong> state flag. Descent rate is averaged over the stable portion of the descent (excluding the first 0.5 s post-deployment transient).
              </div>
              <div className="calc-result">
                <div className="res-title">Deployment Results</div>
                <div className="res-grid">
                  <div className="res-item"><div className="rl">Deployment Altitude</div><div className="rv">{stats!.deployDetected ? `${fmt(stats!.deployAlt, 1)} m` : '--'}</div></div>
                  <div className="res-item"><div className="rl">Delay vs Apogee</div><div className="rv">{stats!.deployDetected ? `${stats!.deployDelay >= 0 ? '+' : ''}${fmt(stats!.deployDelay, 2)} s` : '--'}</div></div>
                  <div className="res-item"><div className="rl">Avg Descent Rate</div><div className="rv" style={{ color: verdictColor(stats!.descentVerdict) }}>{fmt(Math.abs(stats!.avgDescentRate), 2)} m/s</div></div>
                  <div className="res-item"><div className="rl">Peak Descent Rate</div><div className="rv">{fmt(Math.abs(stats!.maxDescentRate), 2)} m/s</div></div>
                </div>
              </div>
              {stats!.earlyDeployment && (
                <div className="conclusion warn" style={{ marginTop: '14px' }}>
                  <p>⚠ Deployment triggered at {fmt(stats!.deployAlt, 1)} m, before the baro-measured apogee of {fmt(stats!.apogee, 1)} m. This can indicate accelerometer-based apogee detection firing early, sensor noise, or a manual/backup trigger — worth checking your trigger logic if unintended.</p>
                </div>
              )}
            </div>
            {stats!.deployDetected && (
              <div className="chart-panel">
                <div className="chart-hdr"><span className="chart-title">Altitude & Climb Rate — Deployment Window</span>
                  <div className="legend">
                    <span className="leg-item"><span className="leg-dot" style={{ background: 'var(--orange)' }} />Altitude (m)</span>
                    <span className="leg-item"><span className="leg-dot" style={{ background: 'var(--blue)' }} />Climb Rate (m/s)</span>
                  </div>
                </div>
                <div className="chart-wrap-tall"><canvas id="deploy-chart" /></div>
              </div>
            )}
            <div className="section">
              <div className="section-title">Canopy Reference Data (typical Cd)</div>
              <table className="class-table">
                <thead><tr><th>Canopy Type</th><th>Cd (approx.)</th><th>Notes</th></tr></thead>
                <tbody>
                  {CD_TABLE.map(r => <tr key={r[0]}><td>{r[0]}</td><td>{r[1]}</td><td>{r[2]}</td></tr>)}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* REPORT */}
      <div className={`page${activeTab === 'report' ? ' active' : ''}`}>
        {!hasData ? <div className="empty"><div className="empty-icon">📄</div><h3>Load a flight CSV to generate report</h3></div> : (
          <>
            <div className="section">
              <div className="section-title">Flight Information</div>
              <table className="kv-table">
                {[['File', filename], ['Samples', stats!.totalSamples], ['Log Rate', `${fmt(stats!.sampleRateHz, 1)} Hz`], ['Deployment Detected', stats!.deployDetected ? 'Yes' : 'No'], ['Landing Detected', stats!.landingDetected ? 'Yes' : 'No (log ends in-flight)']].map(([k, v]) => <tr key={String(k)}><td>{k}</td><td>{v}</td></tr>)}
              </table>
            </div>
            <div className={`conclusion${stats!.descentVerdict === 'danger' || stats!.earlyDeployment ? ' warn' : ''}`}>
              <p>Apogee reached <strong style={{ color: 'var(--orange)' }}>{fmt(stats!.apogee, 1)} m</strong> at t = {fmt(stats!.apogeeTime, 2)} s. {stats!.deployDetected ? `Recovery deployed at ${fmt(stats!.deployAlt, 1)} m, descending at ${fmt(Math.abs(stats!.avgDescentRate), 1)} m/s average — descent rate is ` : 'No deployment event was detected in this log — '}<strong style={{ color: verdictColor(stats!.descentVerdict) }}>{verdictLabel(stats!.descentVerdict)}</strong>.</p>
              {stats!.gapCount > 0 && <p style={{ color: 'var(--amber)' }}>⚠ {stats!.gapCount} telemetry gap(s) detected, totalling {fmt(stats!.totalGapS, 1)}s of lost link during the flight.</p>}
              {stats!.earlyDeployment && <p style={{ color: 'var(--amber)' }}>⚠ Deployment triggered before baro apogee was reached — review trigger logic.</p>}
            </div>
            <div className="section">
              <div className="section-title">Complete Flight Data</div>
              <table className="kv-table">
                {[
                  ['Apogee', `${fmt(stats!.apogee, 2)} m`],
                  ['Time to Apogee', `${fmt(stats!.apogeeTime, 3)} s`],
                  ['Max Climb Rate', `${fmt(stats!.maxClimbRate, 2)} m/s`],
                  ['Max Descent Rate', `${fmt(Math.abs(stats!.maxDescentRate), 2)} m/s`],
                  ['Avg Descent Rate', `${fmt(Math.abs(stats!.avgDescentRate), 2)} m/s`],
                  ['Max Acceleration', `${fmt(stats!.maxAccel, 2)} G`],
                  ['Deployment Altitude', stats!.deployDetected ? `${fmt(stats!.deployAlt, 2)} m` : '--'],
                  ['Flight Duration', `${fmt(stats!.flightDuration, 2)} s`],
                  ['Baro Uptime', `${fmt(stats!.baroUptimePct, 1)}%`],
                  ['IMU Uptime', `${fmt(stats!.imuUptimePct, 1)}%`],
                  ['Telemetry Gaps', `${stats!.gapCount} (${fmt(stats!.totalGapS, 1)}s lost)`],
                ].map(([k, v]) => <tr key={String(k)}><td>{k}</td><td>{v}</td></tr>)}
              </table>
            </div>
            <div className="section">
              <div className="section-title">Parameter Definitions</div>
              <table className="kv-table">
                {[
                  ['Apogee', 'Maximum altitude reached during the flight (baro-derived)'],
                  ['Deployment Altitude', 'Altitude at the moment the recovery servo/ejection channel fires'],
                  ['Deployment Delay', 'Time between apogee and deployment — near-zero is ideal for apogee-triggered recovery'],
                  ['Descent Rate', 'Rate of altitude loss under recovery — determines landing impact energy'],
                  ['Telemetry Gap', 'A jump in log timestamps far larger than the typical sample interval — indicates lost radio link'],
                ].map(([k, v]) => <tr key={String(k)}><td>{k}</td><td className="highlight">{v}</td></tr>)}
              </table>
            </div>
          </>
        )}
      </div>

      {/* CALCULATOR */}
      <div className={`page${activeTab === 'calculator' ? ' active' : ''}`}>
        <div className="section">
          <div className="section-title">Parachute Sizing Calculator</div>
          <div style={{ fontSize: '12px', color: 'var(--tx2)', marginBottom: '10px' }}>Given a target descent rate, find the required canopy diameter.</div>
          <div className="calc-input-row">
            {([['Rocket Mass (kg)', 'mass', 0.1], ['Target Descent Rate (m/s)', 'targetV', 0.5], ['Drag Coefficient (Cd)', 'cd', 0.05], ['Air Density (kg/m³)', 'rho', 0.005]] as [string, keyof typeof sizeCalc, number][]).map(([label, key, step]) => (
              <div key={key} className="inp-group"><label>{label}</label><input type="number" value={sizeCalc[key]} step={step} onChange={e => setSizeCalc(s => ({ ...s, [key]: parseFloat(e.target.value) }))} /></div>
            ))}
          </div>
          <div className="calc-result">
            <div className="res-title">Sizing Results</div>
            <div className="res-grid">
              <div className="res-item"><div className="rl">Canopy Diameter</div><div className="rv">{fmt(sizeDiaCm, 1)} cm</div></div>
              <div className="res-item"><div className="rl">Canopy Area</div><div className="rv">{fmt(sizeAreaM2, 3)} m²</div></div>
            </div>
          </div>
        </div>
        <div className="section">
          <div className="section-title">Descent Rate Calculator</div>
          <div style={{ fontSize: '12px', color: 'var(--tx2)', marginBottom: '10px' }}>Given a canopy diameter, find the resulting descent rate.</div>
          <div className="calc-input-row">
            {([['Rocket Mass (kg)', 'mass', 0.1], ['Canopy Diameter (cm)', 'dia', 1], ['Drag Coefficient (Cd)', 'cd', 0.05], ['Air Density (kg/m³)', 'rho', 0.005]] as [string, keyof typeof rateCalc, number][]).map(([label, key, step]) => (
              <div key={key} className="inp-group"><label>{label}</label><input type="number" value={rateCalc[key]} step={step} onChange={e => setRateCalc(r => ({ ...r, [key]: parseFloat(e.target.value) }))} /></div>
            ))}
          </div>
          <div className="calc-result">
            <div className="res-title">Descent Results</div>
            <div className="res-grid">
              <div className="res-item"><div className="rl">Descent Rate</div><div className="rv">{fmt(rateVms, 2)} m/s</div></div>
              <div className="res-item"><div className="rl">Canopy Area</div><div className="rv">{fmt(rateAreaM2, 3)} m²</div></div>
            </div>
          </div>
        </div>
        <div className="section">
          <div className="section-title">Canopy Reference (Cd)</div>
          <table className="class-table">
            <thead><tr><th>Canopy Type</th><th>Cd (approx.)</th><th>Notes</th></tr></thead>
            <tbody>{CD_TABLE.map(r => <tr key={r[0]}><td>{r[0]}</td><td>{r[1]}</td><td>{r[2]}</td></tr>)}</tbody>
          </table>
        </div>
        <div className="section">
          <div className="section-title">Descent Rate Guidance by Mass</div>
          <table className="class-table">
            <thead><tr><th>Rocket Mass</th><th>Recommended Max Descent Rate</th></tr></thead>
            <tbody>{DESCENT_GUIDE.map(r => <tr key={r[0]}><td>{r[0]}</td><td>{r[1]}</td></tr>)}</tbody>
          </table>
        </div>
      </div>

      <div className="footer">KC DAQ Flight Analysis System · Phone-linked telemetry · Baro + IMU · Radio link RSSI/SNR</div>

      {/* SAVE MODAL */}
      {saveModal && (
        <div className="modal-overlay" onClick={() => setSaveModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>☁ Save to Cloud</h3>
            <p>Give this flight session a name. It will be saved to Supabase and a shareable link will be generated.</p>
            <input className="modal-inp" value={sessionName} onChange={e => setSessionName(e.target.value)}
              placeholder="e.g. Flight #4 — July 2026" onKeyDown={e => e.key === 'Enter' && handleSave()} autoFocus />
            <div className="modal-btns">
              <button className="btn" onClick={() => setSaveModal(false)}>Cancel</button>
              <button className="btn primary" onClick={handleSave} disabled={saving}>{saving ? '⏳ Saving…' : '☁ Save & Share'}</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className={`toast ${toast.type}`}>{toast.type === 'success' ? '✓' : toast.type === 'error' ? '✕' : 'ℹ'} {toast.msg}</div>}
    </>
  )
}
