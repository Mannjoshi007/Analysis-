'use client'
import { useEffect, useRef, useState, useCallback } from 'react'
import Link from 'next/link'
import { Chart, registerables } from 'chart.js'
import { saveSession } from '@/lib/supabase'

Chart.register(...registerables)

// ─── Types ───────────────────────────────────────────────────────────────────
interface RawRow {
  sample: number; t_ms: number; force: number; force_kg: number
  temp: number; pres: number; impulse: number; t: number
}

interface Stats {
  peak: number; peakTime: number; avgThrust: number; totalImpulse: number
  burnTime5: number; motorClass: string; avgTemp: number; maxTemp: number
  isp: number; burnSamples: number; totalSamples: number; sampleRate: number
  avgDt: number; profileType: string; snrDb: number; bfStd: number; t0ms: number
}

// ─── Motor Classes ────────────────────────────────────────────────────────────
const MOTOR_CLASSES = [
  {cls:'1/4A',min:0,max:0.3125},{cls:'1/2A',min:0.313,max:0.625},
  {cls:'A',min:0.626,max:1.25},{cls:'B',min:1.251,max:2.5},
  {cls:'C',min:2.501,max:5.0},{cls:'D',min:5.001,max:10.0},
  {cls:'E',min:10.001,max:20.0},{cls:'F',min:20.001,max:40.0},
  {cls:'G',min:40.001,max:80.0},{cls:'H',min:80.001,max:160.0},
  {cls:'I',min:160.001,max:320.0},{cls:'J',min:320.001,max:640.0},
  {cls:'K',min:640.001,max:1280.0},
]
function classifyMotor(imp: number) {
  for (const mc of MOTOR_CLASSES) if (imp >= mc.min && imp <= mc.max) return mc.cls
  return imp > 1280 ? 'L+' : '?'
}
function classifyProfile(bd: RawRow[]) {
  if (bd.length < 10) return 'Unknown'
  const third = Math.floor(bd.length / 3)
  const q1 = bd.slice(0, third).reduce((a, b) => a + b.force, 0) / third
  const q3 = bd.slice(2 * third).reduce((a, b) => a + b.force, 0) / (bd.length - 2 * third)
  const r = q3 / q1
  if (r > 1.15) return 'Progressive'
  if (r < 0.85) return 'Regressive'
  return 'Neutral'
}

// ─── Helper ───────────────────────────────────────────────────────────────────
function fmt(n: number, d = 3) { return isNaN(n) ? '--' : n.toFixed(d) }

export default function AnalyzePage() {
  const [raw, setRaw] = useState<RawRow[]>([])
  const [burnData, setBurnData] = useState<RawRow[]>([])
  const [refData, setRefData] = useState<{ t: number; f: number }[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [filename, setFilename] = useState('')
  const [refName, setRefName] = useState('')
  const [activeTab, setActiveTab] = useState('dashboard')
  const [drag, setDrag] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveModal, setSaveModal] = useState(false)
  const [sessionName, setSessionName] = useState('')
  const [shareUrl, setShareUrl] = useState('')
  const [toast, setToast] = useState<{ msg: string; type: string } | null>(null)

  // Nozzle / grain calc state
  const [nozzle, setNozzle] = useState({ thrust: 80, pc: 3.5, cf: 1.3, exp: 3.0 })
  const [grain, setGrain] = useState({ imp: 73.7, isp: 164, dens: 1.879, od: 20, id: 6 })
  const [press, setPress] = useState({ throatD: 8, exitD: 14, cf: 1.3, propDens: 1.879, brA: 8.26, brN: 0.319, kn: 150 })

  const chartsRef = useRef<Record<string, Chart>>({})
  const pressChartRef = useRef<Chart | null>(null)
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
      if (p.length < 7) continue
      const t_ms = parseFloat(p[1]), force = parseFloat(p[2])
      if (isNaN(t_ms) || isNaN(force)) continue
      rows.push({ sample: +p[0], t_ms, force, force_kg: parseFloat(p[3]), temp: parseFloat(p[4]), pres: parseFloat(p[5]), impulse: parseFloat(p[6]), t: 0 })
    }
    if (!rows.length) { showToast('No valid data in CSV', 'error'); return }
    processData(rows)
  }

  function parseRef(text: string, fname: string) {
    const lines = text.trim().split('\n')
    const pts: { t: number; f: number }[] = []
    let t0: number | null = null
    for (const line of lines) {
      const p = line.split(',')
      if (p.length < 2) continue
      const tv = parseFloat(p[0]), fv = parseFloat(p[1])
      if (isNaN(tv) || isNaN(fv)) continue
      if (t0 === null) t0 = tv
      pts.push({ t: tv - t0!, f: fv })
    }
    setRefData(pts)
    setRefName(fname)
    showToast(`Reference loaded: ${fname}`, 'info')
  }

  // ─── Process Data ──────────────────────────────────────────────────────────
  function processData(rows: RawRow[]) {
    const t0ms = rows[0].t_ms
    rows.forEach(r => { r.t = (r.t_ms - t0ms) / 1000 })

    const peak = Math.max(...rows.map(r => r.force))
    const thresh = Math.max(0.1, peak * 0.005)
    const t5thresh = peak * 0.05

    let bStart = rows.findIndex(r => r.force >= thresh)
    let bEnd = rows.length - 1 - [...rows].reverse().findIndex(r => r.force >= thresh)
    if (bStart < 0) bStart = 0
    const burn = rows.slice(bStart, bEnd + 1)

    let t5start = rows.findIndex(r => r.force >= t5thresh)
    let t5end = rows.length - 1 - [...rows].reverse().findIndex(r => r.force >= t5thresh)
    if (t5start < 0) t5start = 0
    const burnTime5 = rows[t5end] && rows[t5start] ? rows[t5end].t - rows[t5start].t : burn.length > 0 ? burn[burn.length - 1].t - burn[0].t : 0

    let totalImpulse = rows[rows.length - 1].impulse
    if (!totalImpulse || totalImpulse === 0) {
      totalImpulse = 0
      for (let i = 1; i < rows.length; i++)
        totalImpulse += (rows[i].t - rows[i - 1].t) * (rows[i].force + rows[i - 1].force) / 2
    }

    const avgThrust = burnTime5 > 0 ? totalImpulse / burnTime5 : 0
    const peakIdx = rows.reduce((a, _, i) => rows[i].force > rows[a].force ? i : a, 0)
    const temps = rows.map(r => r.temp).filter(v => !isNaN(v))
    const avgTemp = temps.reduce((a, b) => a + b, 0) / temps.length
    const maxTemp = Math.max(...temps)

    const dts = rows.slice(1).map((r, i) => r.t_ms - rows[i].t_ms)
    const avgDt = dts.reduce((a, b) => a + b, 0) / dts.length
    const sampleRate = 1000 / avgDt

    const burnForces = burn.map(r => r.force)
    const bfMean = burnForces.reduce((a, b) => a + b, 0) / burnForces.length
    const bfStd = Math.sqrt(burnForces.map(v => (v - bfMean) ** 2).reduce((a, b) => a + b, 0) / burnForces.length)
    const snrDb = bfMean > 0 ? 20 * Math.log10(bfMean / bfStd) : 0

    const newStats: Stats = {
      peak, peakTime: rows[peakIdx].t, avgThrust, totalImpulse, burnTime5,
      motorClass: classifyMotor(totalImpulse), avgTemp, maxTemp,
      isp: 164, burnSamples: burn.length, totalSamples: rows.length,
      sampleRate, avgDt, profileType: classifyProfile(burn),
      snrDb, bfStd, t0ms
    }

    setRaw(rows)
    setBurnData(burn)
    setStats(newStats)
    setSessionName(filename.replace('.csv', '') || 'Motor Test')
    showToast(`Loaded ${rows.length} samples — ${classifyMotor(totalImpulse)} class motor`, 'success')
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

  useEffect(() => {
    if (!stats || !burnData.length) return
    const t0 = burnData[0].t
    const bt = burnData.map(r => (r.t - t0).toFixed(3))
    const bf = burnData.map(r => r.force)
    const allT = raw.map(r => r.t.toFixed(3))
    const allTemp = raw.map(r => r.temp)
    const allImp = raw.map(r => r.impulse)

    const refDs = refData.length > 0 ? [{
      label: 'Reference', data: refData.map(r => r.f),
      borderColor: 'rgba(255,255,255,.6)', borderWidth: 1.5,
      borderDash: [6, 4], pointRadius: 0, tension: 0.3, fill: false
    }] : []

    const thrustDs = { label: 'Thrust', data: bf, borderColor: '#ff5e1a', borderWidth: 2, pointRadius: 0, tension: 0.25, fill: true, backgroundColor: 'rgba(255,94,26,.07)' }

    setTimeout(() => {
      mkChart('main-thrust-chart', { type: 'line', data: { labels: bt, datasets: [thrustDs, ...refDs] }, options: { ...chartDefaults, scales: { x: { ...chartDefaults.scales.x, title: { display: true, text: 'Time (s)', color: '#8b90a0', font: { size: 10 } } }, y: { ...chartDefaults.scales.y, title: { display: true, text: 'N', color: '#8b90a0', font: { size: 10 } } } } } })
      mkChart('temp-chart', { type: 'line', data: { labels: allT, datasets: [{ label: 'Temp', data: allTemp, borderColor: '#ffb347', borderWidth: 1.5, pointRadius: 0, tension: 0.3, fill: true, backgroundColor: 'rgba(255,179,71,.07)' }] }, options: { ...chartDefaults, scales: { x: { ...chartDefaults.scales.x, title: { display: true, text: 'Time (s)', color: '#8b90a0', font: { size: 10 } } }, y: { ...chartDefaults.scales.y, title: { display: true, text: '°C', color: '#8b90a0', font: { size: 10 } } } } } })
      mkChart('impulse-chart', { type: 'line', data: { labels: allT, datasets: [{ label: 'Impulse', data: allImp, borderColor: '#1fd1a0', borderWidth: 2, pointRadius: 0, tension: 0.25, fill: true, backgroundColor: 'rgba(31,209,160,.07)' }] }, options: { ...chartDefaults, scales: { x: { ...chartDefaults.scales.x, title: { display: true, text: 'Time (s)', color: '#8b90a0', font: { size: 10 } } }, y: { ...chartDefaults.scales.y, title: { display: true, text: 'N·s', color: '#8b90a0', font: { size: 10 } } } } } })
      mkChart('full-thrust-chart', { type: 'line', data: { labels: bt, datasets: [thrustDs, ...refDs] }, options: { ...chartDefaults, scales: { x: { ...chartDefaults.scales.x, title: { display: true, text: 'Time (s)', color: '#8b90a0', font: { size: 10 } } }, y: { ...chartDefaults.scales.y, title: { display: true, text: 'N', color: '#8b90a0', font: { size: 10 } } } } } })

      const dfdt = [0, ...burnData.slice(1).map((r, i) => {
        const dt = r.t - burnData[i].t; return dt > 0 ? (r.force - burnData[i].force) / dt : 0
      })]
      mkChart('thrust-rate-chart', { type: 'line', data: { labels: bt, datasets: [{ label: 'dF/dt', data: dfdt, borderColor: '#4ea8de', borderWidth: 1.5, pointRadius: 0, tension: 0.2, fill: true, backgroundColor: 'rgba(78,168,222,.07)' }] }, options: { ...chartDefaults, scales: { x: { ...chartDefaults.scales.x, title: { display: true, text: 'Time (s)', color: '#8b90a0', font: { size: 10 } } }, y: { ...chartDefaults.scales.y, title: { display: true, text: 'N/s', color: '#8b90a0', font: { size: 10 } } } } } })
      mkChart('norm-chart', { type: 'line', data: { labels: bt, datasets: [{ label: 'Norm', data: bf.map(v => stats.peak > 0 ? v / stats.peak : 0), borderColor: '#a78bfa', borderWidth: 1.5, pointRadius: 0, tension: 0.25, fill: true, backgroundColor: 'rgba(167,139,250,.07)' }] }, options: { ...chartDefaults, scales: { x: { ...chartDefaults.scales.x, title: { display: true, text: 'Time (s)', color: '#8b90a0', font: { size: 10 } } }, y: { ...chartDefaults.scales.y, min: 0, max: 1, title: { display: true, text: 'F/Fpeak', color: '#8b90a0', font: { size: 10 } } } } } })

      const dts2 = raw.slice(1).map((r, i) => r.t_ms - raw[i].t_ms)
      mkChart('dt-chart', { type: 'line', data: { labels: raw.slice(1).map(r => r.t.toFixed(3)), datasets: [{ label: 'Δt', data: dts2, borderColor: '#1fd1a0', borderWidth: 1, pointRadius: 0, tension: 0.1, fill: false }] }, options: { ...chartDefaults, scales: { x: { ...chartDefaults.scales.x, title: { display: true, text: 'Time (s)', color: '#8b90a0', font: { size: 10 } } }, y: { ...chartDefaults.scales.y, title: { display: true, text: 'ms', color: '#8b90a0', font: { size: 10 } } } } } })
    }, 50)
  }, [raw, burnData, stats, refData, activeTab])

  // ─── Pressure Chart ────────────────────────────────────────────────────────
  function calcPressureChart() {
    if (!burnData.length) return null
    const At_m2 = Math.PI * Math.pow(press.throatD / 2, 2) * 1e-6
    const t0b = burnData[0].t
    return burnData.map(r => ({ t: r.t - t0b, Pc: r.force / (press.cf * At_m2) / 1e6, f: r.force }))
  }

  useEffect(() => {
    if (!burnData.length || activeTab !== 'pressure') return
    const pts = calcPressureChart()
    if (!pts) return
    const canvas = document.getElementById('press-chart') as HTMLCanvasElement
    if (!canvas) return
    if (pressChartRef.current) { pressChartRef.current.destroy(); pressChartRef.current = null }
    pressChartRef.current = new Chart(canvas, {
      type: 'line',
      data: { labels: pts.map(r => r.t.toFixed(3)), datasets: [
        { label: 'Est. Pressure (MPa)', data: pts.map(r => r.Pc), borderColor: '#4ea8de', borderWidth: 2, pointRadius: 0, tension: 0.25, fill: true, backgroundColor: 'rgba(78,168,222,.08)', yAxisID: 'y' },
        { label: 'Thrust (N)', data: pts.map(r => r.f), borderColor: 'rgba(255,94,26,.7)', borderWidth: 1.5, pointRadius: 0, tension: 0.25, fill: false, yAxisID: 'y2' },
      ]},
      options: { responsive: true, maintainAspectRatio: false, animation: false, interaction: { intersect: false, mode: 'index' as const },
        plugins: { legend: { display: false }, tooltip: { backgroundColor: '#1e222d', titleColor: '#ff5e1a', bodyColor: '#e8e9ed', borderColor: 'rgba(255,255,255,.1)', borderWidth: 1 } },
        scales: { x: { grid: { color: 'rgba(255,255,255,.04)' }, ticks: { color: '#8b90a0', font: { size: 10 }, maxTicksLimit: 8 }, title: { display: true, text: 'Time (s)', color: '#8b90a0', font: { size: 10 } } }, y: { grid: { color: 'rgba(255,255,255,.04)' }, ticks: { color: '#4ea8de', font: { size: 10 } }, title: { display: true, text: 'Pressure (MPa)', color: '#4ea8de', font: { size: 10 } } }, y2: { position: 'right' as const, grid: { display: false }, ticks: { color: '#ff5e1a', font: { size: 10 } }, title: { display: true, text: 'Thrust (N)', color: '#ff5e1a', font: { size: 10 } } } } }
    } as never)
  }, [burnData, press, activeTab])

  // ─── Nozzle Calc ──────────────────────────────────────────────────────────
  const At_nozzle = Math.PI * Math.pow((nozzle.thrust / (nozzle.cf * nozzle.pc * 1e6)) / Math.PI, 0.5) ** 2
  const throatDmm = 2 * Math.sqrt(nozzle.thrust / (nozzle.cf * nozzle.pc * 1e6) / Math.PI) * 1000
  const exitDmm = throatDmm * Math.sqrt(nozzle.exp)
  const At_actual = Math.PI * Math.pow(throatDmm / 2 / 1000, 2)

  // ─── Grain Calc ───────────────────────────────────────────────────────────
  const propMassG = (grain.imp / (grain.isp * 9.81)) * 1000
  const grainVol = propMassG / grain.dens
  const xsArea = Math.PI / 4 * (Math.pow(grain.od / 10, 2) - Math.pow(grain.id / 10, 2))
  const grainLen = xsArea > 0 ? grainVol / xsArea : 0

  // ─── Pressure Calc ────────────────────────────────────────────────────────
  const At_press_mm2 = Math.PI * Math.pow(press.throatD / 2, 2)
  const At_press_m2 = At_press_mm2 * 1e-6
  const pressPts = burnData.length > 0 ? calcPressureChart() ?? [] : []
  const peakPc = pressPts.length > 0 ? Math.max(...pressPts.map(r => r.Pc)) : 0
  const avgPc = pressPts.length > 0 ? pressPts.reduce((a, r) => a + r.Pc, 0) / pressPts.length : 0
  const expRatio = press.exitD > press.throatD ? Math.pow(press.exitD / press.throatD, 2) : 0

  // ─── Save to Supabase ─────────────────────────────────────────────────────
  async function handleSave() {
    if (!stats || !raw.length) return
    setSaving(true)
    const result = await saveSession(sessionName || 'Motor Test', filename, stats as unknown as Record<string, unknown>, raw.map(r => ({ ...r })))
    setSaving(false)
    setSaveModal(false)
    if (result) {
      const url = `${window.location.origin}/report/${result.id}`
      setShareUrl(url)
      showToast('Saved! Share URL ready.', 'success')
    } else {
      showToast('Save failed — check Supabase connection', 'error')
    }
  }

  // ─── Download Report ──────────────────────────────────────────────────────
  function downloadReport() {
    if (!stats) return
    const now = new Date().toLocaleString('en-IN')
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>KC DAQ Report — ${filename}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0d0f14;color:#e8e9ed;font-family:monospace;font-size:13px;padding:24px;line-height:1.6}
h1{color:#ff5e1a;font-size:20px;margin-bottom:4px}
h2{color:#ff5e1a;font-size:12px;text-transform:uppercase;letter-spacing:.08em;margin:20px 0 8px;padding-bottom:6px;border-bottom:1px solid rgba(255,255,255,.08)}
.meta{color:#8b90a0;font-size:11px;margin-bottom:20px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-bottom:20px}
.card{background:#161920;border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:12px}
.card .lbl{font-size:10px;color:#8b90a0;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px}
.card .val{font-size:18px;font-weight:700}
table{width:100%;border-collapse:collapse;margin-bottom:16px}
td{padding:7px 6px;border-bottom:1px solid rgba(255,255,255,.04);font-size:12px}
td:first-child{color:#8b90a0;width:55%}
td:last-child{font-weight:600;text-align:right}
.badge{display:inline-block;background:rgba(167,139,250,.15);color:#a78bfa;border:1px solid rgba(167,139,250,.3);padding:3px 14px;border-radius:20px;font-size:14px;font-weight:700;letter-spacing:.1em}
.footer{color:#555b6e;font-size:11px;margin-top:24px;padding-top:12px;border-top:1px solid rgba(255,255,255,.06)}
</style>
</head>
<body>
<h1>🚀 KC DAQ — Motor Analysis Report</h1>
<div class="meta">File: ${filename} &nbsp;|&nbsp; Generated: ${now} &nbsp;|&nbsp; KC DAQ Motor Analysis Platform</div>

<h2>Motor Classification</h2>
<div style="margin-bottom:16px"><span class="badge">${stats.motorClass} Class</span></div>

<h2>Key Performance Metrics</h2>
<div class="grid">
  <div class="card"><div class="lbl">Peak Thrust</div><div class="val" style="color:#ff5e1a">${fmt(stats.peak, 2)} N</div></div>
  <div class="card"><div class="lbl">Avg Thrust</div><div class="val" style="color:#4ea8de">${fmt(stats.avgThrust, 2)} N</div></div>
  <div class="card"><div class="lbl">Total Impulse</div><div class="val" style="color:#1fd1a0">${fmt(stats.totalImpulse, 3)} N·s</div></div>
  <div class="card"><div class="lbl">Burn Time (t₅)</div><div class="val">${fmt(stats.burnTime5, 3)} s</div></div>
  <div class="card"><div class="lbl">Time to Peak</div><div class="val">${fmt(stats.peakTime, 3)} s</div></div>
  <div class="card"><div class="lbl">Est. Isp</div><div class="val" style="color:#a78bfa">${stats.isp} s</div></div>
  <div class="card"><div class="lbl">Avg Temp</div><div class="val" style="color:#ffb347">${fmt(stats.avgTemp, 1)} °C</div></div>
  <div class="card"><div class="lbl">Max Temp</div><div class="val" style="color:#ffb347">${fmt(stats.maxTemp, 1)} °C</div></div>
</div>

<h2>Full Performance Data</h2>
<table>
  <tr><td>Peak Thrust</td><td>${fmt(stats.peak, 3)} N</td></tr>
  <tr><td>Average Thrust</td><td>${fmt(stats.avgThrust, 3)} N</td></tr>
  <tr><td>Total Impulse</td><td>${fmt(stats.totalImpulse, 4)} N·s</td></tr>
  <tr><td>Motor Class</td><td>${stats.motorClass}</td></tr>
  <tr><td>Burn Duration (t₅)</td><td>${fmt(stats.burnTime5, 3)} s</td></tr>
  <tr><td>Time to Peak Thrust</td><td>${fmt(stats.peakTime, 3)} s</td></tr>
  <tr><td>Estimated Isp</td><td>${stats.isp} s (KNDX default)</td></tr>
  <tr><td>Burn Profile</td><td>${stats.profileType}</td></tr>
  <tr><td>Thrust-to-Weight (10 kg cell)</td><td>${fmt(stats.peak / 98.1, 3)}</td></tr>
</table>

<h2>Data Quality</h2>
<table>
  <tr><td>Total Samples</td><td>${stats.totalSamples}</td></tr>
  <tr><td>Burn Phase Samples</td><td>${stats.burnSamples}</td></tr>
  <tr><td>Sample Rate</td><td>${fmt(stats.sampleRate, 1)} Hz</td></tr>
  <tr><td>Avg Sample Interval</td><td>${fmt(stats.avgDt, 1)} ms</td></tr>
  <tr><td>Thrust Noise σ (burn)</td><td>${fmt(stats.bfStd, 3)} N</td></tr>
  <tr><td>Signal-to-Noise Ratio</td><td>${fmt(stats.snrDb, 1)} dB</td></tr>
  <tr><td>Pressure Sensor</td><td>⚠ Not connected</td></tr>
  <tr><td>Load Cell Capacity</td><td>10 kg (98.1 N max)</td></tr>
  <tr><td>Over-range?</td><td>${stats.peak > 98.1 ? '⚠ YES — ' + fmt(stats.peak, 1) + ' N exceeds capacity' : 'No (' + ((stats.peak / 98.1) * 100).toFixed(0) + '% of range)'}</td></tr>
</table>

<h2>Parameter Definitions</h2>
<table>
  <tr><td>Total Impulse (J)</td><td>∫F dt — area under thrust curve, determines motor class</td></tr>
  <tr><td>Specific Impulse (Isp)</td><td>J / (m₀g₀) — efficiency metric in seconds; higher = better</td></tr>
  <tr><td>Average Thrust (F̄)</td><td>J / t_burn — mean thrust over burn duration</td></tr>
  <tr><td>Peak Thrust (Fp)</td><td>Maximum instantaneous thrust measured</td></tr>
  <tr><td>Thrust Coefficient (CF)</td><td>F / (Pc × At) — nozzle efficiency, typically 1.2–1.8</td></tr>
  <tr><td>Burn Rate (r)</td><td>r = a × Pc^n (Vieille's law) — mm/s</td></tr>
  <tr><td>Kn (Klemmung)</td><td>As/At — pressure-thrust coupling, drives Pc</td></tr>
  <tr><td>Progressive / Neutral / Regressive</td><td>dF/dt trend during mid-burn defines burn profile</td></tr>
</table>

<div class="footer">KC DAQ Motor Analysis System · ESP32 + Teensy · Load cell 10 kg · Thermocouple · No pressure data</div>
</body>
</html>`
    const blob = new Blob([html], { type: 'text/html' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = filename.replace('.csv', '') + '_report.html'
    a.click()
    URL.revokeObjectURL(a.href)
    showToast('Report downloaded!', 'success')
  }

  // ─── File Handlers ────────────────────────────────────────────────────────
  function onCsvFile(file: File) {
    setFilename(file.name)
    const reader = new FileReader()
    reader.onload = e => parseCSV(e.target?.result as string)
    reader.readAsText(file)
  }
  function onRefFile(file: File) {
    const reader = new FileReader()
    reader.onload = e => parseRef(e.target?.result as string, file.name)
    reader.readAsText(file)
  }

  const hasData = !!stats

  // ─── Analysis Status Items ────────────────────────────────────────────────
  const statusItems = stats ? [
    { ok: stats.burnSamples > 5, label: 'Burn detected', sub: `${stats.burnSamples} burn samples` },
    { ok: stats.totalImpulse > 0, label: 'Impulse data', sub: `${fmt(stats.totalImpulse)} N·s` },
    { ok: stats.snrDb > 20, label: 'Signal quality', sub: `SNR ${fmt(stats.snrDb, 1)} dB` },
    { ok: stats.avgDt < 60, label: 'Sample rate', sub: `${fmt(stats.sampleRate, 1)} Hz` },
    { ok: true, label: 'Temperature', sub: `${fmt(stats.avgTemp, 1)}°C avg` },
    { ok: false, label: 'Pressure sensor', sub: 'Not connected', cls: 'warn' },
  ] : []

  // ─── Profile Segments ─────────────────────────────────────────────────────
  const profileSegs = burnData.length > 0 && stats ? Array.from({ length: 5 }, (_, s) => {
    const segSize = Math.floor(burnData.length / 5)
    const seg = burnData.slice(s * segSize, (s + 1) * segSize)
    if (!seg.length) return null
    const segAvg = seg.reduce((a, b) => a + b.force, 0) / seg.length
    const pct = stats.peak > 0 ? segAvg / stats.peak * 100 : 0
    const prev = s > 0 ? burnData.slice((s - 1) * segSize, s * segSize).reduce((a, b) => a + b.force, 0) / segSize : segAvg
    const color = s === 0 ? '#ff5e1a' : segAvg > prev ? '#1fd1a0' : segAvg < prev * 0.9 ? '#ff5e1a' : '#4ea8de'
    const tStart = burnData[s * segSize] ? (burnData[s * segSize].t - burnData[0].t).toFixed(3) : '0'
    return { s, segAvg, pct, color, tStart }
  }).filter(Boolean) : []

  return (
    <>
      {/* HEADER */}
      <div className="hdr">
        <div className="hdr-left">
          <Link href="/" className="logo">🚀 KC DAQ <span>Motor Analysis</span></Link>
          <span className={`badge ${hasData ? 'ok' : 'warn'}`}>{hasData ? 'DATA LOADED' : 'NO DATA'}</span>
        </div>
        <div className="hdr-right">
          <label className="btn" style={{ cursor: 'pointer' }}>
            📂 Load CSV <input type="file" accept=".csv" style={{ display: 'none' }} onChange={e => e.target.files?.[0] && onCsvFile(e.target.files[0])} />
          </label>
          <label className="btn" style={{ cursor: 'pointer' }}>
            📎 Reference <input type="file" accept=".csv" style={{ display: 'none' }} onChange={e => e.target.files?.[0] && onRefFile(e.target.files[0])} />
          </label>
          <button className="btn orange" disabled={!hasData} onClick={downloadReport}>
            ⬇ Download Report
          </button>
          <button className="btn primary" disabled={!hasData} onClick={() => setSaveModal(true)}>
            ☁ Save to Cloud
          </button>
          <Link href="/" className="btn">📋 History</Link>
        </div>
      </div>

      {/* SHARE BAR */}
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
        {[['dashboard','📊 Dashboard'],['charts','📈 Curves'],['analysis','🔬 Analysis'],['pressure','⚡ Pressure'],['report','📄 Report'],['calculator','🔧 Calculator']].map(([id, label]) => (
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
            <div className="drop-zone-icon">📡</div>
            <p><strong>Drop a KC DAQ CSV here</strong></p>
            <p>or <label style={{ color: 'var(--orange)', cursor: 'pointer' }}>click to browse <input type="file" accept=".csv" style={{ display: 'none' }} onChange={e => e.target.files?.[0] && onCsvFile(e.target.files[0])} /></label></p>
          </div>
        ) : (
          <>
            <div className="grid">
              <div className="card"><div className="lbl">Peak Thrust</div><div className="val" style={{ color: 'var(--orange)' }}>{fmt(stats!.peak, 2)} N</div><div className="sub">at t = {fmt(stats!.peakTime, 3)} s</div></div>
              <div className="card"><div className="lbl">Avg Thrust</div><div className="val" style={{ color: 'var(--blue)' }}>{fmt(stats!.avgThrust, 2)} N</div><div className="sub">during burn</div></div>
              <div className="card"><div className="lbl">Total Impulse</div><div className="val" style={{ color: 'var(--green)' }}>{fmt(stats!.totalImpulse, 3)} N·s</div><div className="sub">Class: {stats!.motorClass}</div></div>
              <div className="card"><div className="lbl">Burn Time</div><div className="val">{fmt(stats!.burnTime5, 3)} s</div><div className="sub">t₅ threshold</div></div>
              <div className="card"><div className="lbl">Spec. Impulse</div><div className="val" style={{ color: 'var(--purple)' }}>{stats!.isp} s</div><div className="sub">est. Isp</div></div>
              <div className="card"><div className="lbl">Avg Temperature</div><div className="val" style={{ color: 'var(--amber)' }}>{fmt(stats!.avgTemp, 1)} °C</div><div className="sub">ambient</div></div>
            </div>
            <div className="chart-panel">
              <div className="chart-hdr">
                <span className="chart-title">Thrust Curve</span>
                <div className="legend">
                  <span className="leg-item"><span className="leg-dot" style={{ background: 'var(--orange)' }} />Thrust (N)</span>
                  {refData.length > 0 && <span className="leg-item"><span className="leg-dot" style={{ background: 'rgba(255,255,255,.7)' }} />Reference</span>}
                </div>
              </div>
              <div className="chart-wrap"><canvas id="main-thrust-chart" /></div>
            </div>
            <div className="two-col">
              <div className="chart-panel"><div className="chart-hdr"><span className="chart-title">Temperature vs Time</span></div><div className="chart-wrap"><canvas id="temp-chart" /></div></div>
              <div className="chart-panel"><div className="chart-hdr"><span className="chart-title">Cumulative Impulse</span></div><div className="chart-wrap"><canvas id="impulse-chart" /></div></div>
            </div>
          </>
        )}
      </div>

      {/* CHARTS */}
      <div className={`page${activeTab === 'charts' ? ' active' : ''}`}>
        {!hasData ? <div className="empty"><div className="empty-icon">📈</div><h3>Load a CSV to view curves</h3></div> : (
          <>
            <div className="chart-panel">
              <div className="chart-hdr">
                <span className="chart-title">Full Thrust Curve — Burn Region</span>
                <div className="ref-controls">
                  {refName ? <><span style={{ fontSize: '11px', color: 'var(--tx2)' }}>✓ {refName}</span><button className="btn" style={{ padding: '4px 10px', fontSize: '11px' }} onClick={() => { setRefData([]); setRefName('') }}>✕ Remove</button></> : <span style={{ fontSize: '11px', color: 'var(--tx2)' }}>No reference loaded</span>}
                </div>
              </div>
              <div className="chart-wrap-tall"><canvas id="full-thrust-chart" /></div>
            </div>
            <div className="two-col">
              <div className="chart-panel"><div className="chart-hdr"><span className="chart-title">Thrust Rate of Change (dF/dt)</span></div><div className="chart-wrap"><canvas id="thrust-rate-chart" /></div></div>
              <div className="chart-panel"><div className="chart-hdr"><span className="chart-title">Normalised Thrust Profile</span></div><div className="chart-wrap"><canvas id="norm-chart" /></div></div>
            </div>
            <div className="chart-panel"><div className="chart-hdr"><span className="chart-title">Sampling Rate (ms between samples)</span></div><div className="chart-wrap"><canvas id="dt-chart" /></div></div>
          </>
        )}
      </div>

      {/* ANALYSIS */}
      <div className={`page${activeTab === 'analysis' ? ' active' : ''}`}>
        {!hasData ? <div className="empty"><div className="empty-icon">🔬</div><h3>Load a CSV to analyse</h3></div> : (
          <>
            <div className="status-grid">
              {statusItems.map((it, i) => (
                <div key={i} className="status-item">
                  <div className={`status-dot ${it.cls ?? (it.ok ? 'ok' : 'warn')}`} />
                  <div className="status-text"><strong>{it.label}</strong><span>{it.sub}</span></div>
                </div>
              ))}
            </div>
            <div className="two-col">
              <div className="section">
                <div className="section-title">Performance Metrics</div>
                <table className="kv-table">
                  {[
                    ['Peak Thrust', `${fmt(stats!.peak, 3)} N`],
                    ['Time to Peak', `${fmt(stats!.peakTime, 3)} s`],
                    ['Average Thrust', `${fmt(stats!.avgThrust, 3)} N`],
                    ['Total Impulse', `${fmt(stats!.totalImpulse, 4)} N·s`],
                    ['Motor Class', stats!.motorClass],
                    ['Burn Duration (t₅)', `${fmt(stats!.burnTime5, 3)} s`],
                    ['Estimated Isp', `${stats!.isp} s (KNDX default)`],
                    ['Burn Profile', stats!.profileType],
                    ['T/W (10 kg cell)', fmt(stats!.peak / 98.1, 3)],
                  ].map(([k, v]) => <tr key={k}><td>{k}</td><td>{v}</td></tr>)}
                </table>
              </div>
              <div className="section">
                <div className="section-title">Motor Classification</div>
                <div style={{ textAlign: 'center', padding: '12px 0 8px' }}>
                  <span className="class-badge">{stats!.motorClass} Class</span>
                </div>
                <table className="class-table">
                  <thead><tr><th>Class</th><th>Range (N·s)</th><th></th></tr></thead>
                  <tbody>
                    {MOTOR_CLASSES.map(mc => (
                      <tr key={mc.cls} className={mc.cls === stats!.motorClass ? 'highlight-row' : ''}>
                        <td>{mc.cls}</td><td>{mc.min} – {mc.max}</td>
                        <td>{mc.cls === stats!.motorClass ? '← THIS MOTOR' : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="section">
              <div className="section-title">Thrust Profile Decomposition</div>
              {profileSegs.map(seg => seg && (
                <div key={seg.s} className="prog-row">
                  <div className="prog-lbl"><span>Segment {seg.s + 1} (t = {seg.tStart} s)</span><span>{fmt(seg.segAvg, 1)} N ({seg.pct.toFixed(0)}%)</span></div>
                  <div className="prog-bar"><div className="prog-fill" style={{ width: `${seg.pct.toFixed(1)}%`, background: seg.color }} /></div>
                </div>
              ))}
            </div>
            <div className="section">
              <div className="section-title">Data Quality & Signal Analysis</div>
              <table className="kv-table">
                {[
                  ['Total samples', stats!.totalSamples],
                  ['Burn phase samples', stats!.burnSamples],
                  ['Avg sample interval', `${fmt(stats!.avgDt, 1)} ms`],
                  ['Sample rate', `${fmt(stats!.sampleRate, 1)} Hz`],
                  ['Thrust noise σ (burn)', `${fmt(stats!.bfStd, 3)} N`],
                  ['Signal-to-noise ratio', `${fmt(stats!.snrDb, 1)} dB`],
                  ['Pressure sensor', '⚠ Not connected'],
                  ['Load cell capacity', '10 kg (98.1 N max)'],
                  ['Over-range?', stats!.peak > 98.1 ? `⚠ YES — ${fmt(stats!.peak, 1)} N` : `No (${((stats!.peak / 98.1) * 100).toFixed(0)}% of range)`],
                ].map(([k, v]) => <tr key={String(k)}><td>{k}</td><td>{v}</td></tr>)}
              </table>
            </div>
          </>
        )}
      </div>

      {/* PRESSURE */}
      <div className={`page${activeTab === 'pressure' ? ' active' : ''}`}>
        <div className="section">
          <div className="section-title">Estimated Chamber Pressure (from Thrust)</div>
          <div style={{ fontSize: '13px', color: 'var(--tx2)', lineHeight: '1.7', marginBottom: '14px' }}>
            Chamber pressure estimated via <strong style={{ color: 'var(--tx)' }}>F = CF × At × Pc</strong>. Enter nozzle parameters below.
          </div>
          <div className="calc-input-row">
            {([['Throat Ø (mm)', 'throatD'], ['Exit Ø (mm)', 'exitD'], ['CF', 'cf']] as [string, keyof typeof press][]).map(([label, key]) => (
              <div key={key} className="inp-group"><label>{label}</label><input type="number" value={press[key]} step="0.1" onChange={e => setPress(p => ({ ...p, [key]: parseFloat(e.target.value) }))} /></div>
            ))}
          </div>
          {burnData.length > 0 && (
            <div className="calc-result" style={{ marginBottom: '14px' }}>
              <div className="res-title">Estimated Pressure Results</div>
              <div className="res-grid">
                {[{ l: 'Peak Pc (est.)', v: `${fmt(peakPc, 2)} MPa` }, { l: 'Avg Pc (est.)', v: `${fmt(avgPc, 2)} MPa` }, { l: 'Throat Area', v: `${fmt(At_press_mm2, 2)} mm²` }, { l: 'Exp. Ratio', v: fmt(expRatio, 2) }, { l: 'CF', v: fmt(press.cf, 2) }].map(it => (
                  <div key={it.l} className="res-item"><div className="rl">{it.l}</div><div className="rv">{it.v}</div></div>
                ))}
              </div>
            </div>
          )}
        </div>
        {burnData.length > 0 && (
          <div className="chart-panel">
            <div className="chart-hdr">
              <span className="chart-title">Estimated Chamber Pressure vs Time</span>
              <div className="legend">
                <span className="leg-item"><span className="leg-dot" style={{ background: 'var(--blue)' }} />Est. Pressure (MPa)</span>
                <span className="leg-item"><span className="leg-dot" style={{ background: 'var(--orange)' }} />Thrust (N)</span>
              </div>
            </div>
            <div className="chart-wrap-tall"><canvas id="press-chart" /></div>
          </div>
        )}
        <div className="section">
          <div className="section-title">Propellant Reference Data</div>
          <table className="class-table">
            <thead><tr><th>Propellant</th><th>ρ (g/cm³)</th><th>Isp (s)</th><th>T flame (°C)</th><th>a</th><th>n</th></tr></thead>
            <tbody>
              {[['KNDX',1.879,164,1720,8.26,0.319],['KNSU',1.889,164,1720,8.13,0.319],['KNSB',1.841,162,1680,10.71,0.625],['AP/HTPB',1.70,250,3300,4.78,0.30],['Black Powder',1.70,80,2100,7.0,0.40]].map(r => (
                <tr key={String(r[0])}>{r.map((v, i) => <td key={i}>{v}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* REPORT */}
      <div className={`page${activeTab === 'report' ? ' active' : ''}`}>
        {!hasData ? <div className="empty"><div className="empty-icon">📄</div><h3>Load a CSV to generate report</h3></div> : (
          <>
            <div className="section">
              <div className="section-title">Test Information</div>
              <table className="kv-table">
                {[['File', filename],['Motor Class', stats!.motorClass],['Profile', stats!.profileType],['Samples', stats!.totalSamples],['Burn Samples', stats!.burnSamples],['Sample Rate', `${fmt(stats!.sampleRate, 1)} Hz`]].map(([k,v]) => <tr key={String(k)}><td>{k}</td><td>{v}</td></tr>)}
              </table>
            </div>
            <div className={`conclusion${stats!.peak > 90 ? ' warn' : ''}`}>
              <p>Motor classified as <strong style={{ color: 'var(--purple)' }}>{stats!.motorClass}-class</strong> with {fmt(stats!.totalImpulse, 3)} N·s total impulse. {stats!.profileType} burn profile. Peak thrust {fmt(stats!.peak, 2)} N at t = {fmt(stats!.peakTime, 3)} s.</p>
              {stats!.peak > 98.1 && <p style={{ color: 'var(--amber)' }}>⚠ Peak thrust exceeds 10 kg load cell capacity — consider upgrading sensor.</p>}
            </div>
            <div className="section">
              <div className="section-title">Complete Performance Data</div>
              <table className="kv-table">
                {[
                  ['Total Impulse', `${fmt(stats!.totalImpulse, 4)} N·s`],
                  ['Peak Thrust', `${fmt(stats!.peak, 3)} N`],
                  ['Average Thrust', `${fmt(stats!.avgThrust, 3)} N`],
                  ['Burn Duration (t₅)', `${fmt(stats!.burnTime5, 3)} s`],
                  ['Time to Peak', `${fmt(stats!.peakTime, 3)} s`],
                  ['Estimated Isp', `${stats!.isp} s`],
                  ['Motor Class', stats!.motorClass],
                  ['Avg Temperature', `${fmt(stats!.avgTemp, 1)} °C`],
                  ['Max Temperature', `${fmt(stats!.maxTemp, 1)} °C`],
                  ['Thrust Noise σ', `${fmt(stats!.bfStd, 3)} N`],
                  ['SNR', `${fmt(stats!.snrDb, 1)} dB`],
                ].map(([k,v]) => <tr key={String(k)}><td>{k}</td><td>{v}</td></tr>)}
              </table>
            </div>
            <div className="section">
              <div className="section-title">Parameter Definitions</div>
              <table className="kv-table">
                {[['Total Impulse (J)','∫F dt — area under thrust curve, determines motor class'],['Specific Impulse (Isp)','J / (m₀g₀) — efficiency metric in seconds'],['Average Thrust (F̄)','J / t_burn — mean thrust over burn duration'],['Peak Thrust (Fp)','Maximum instantaneous thrust measured'],['Thrust Coefficient (CF)','F / (Pc × At) — nozzle efficiency, typically 1.2–1.8'],['Burn Rate (r)','r = a × Pc^n (Vieille\'s law) — mm/s'],['Kn (Klemmung)','As/At — pressure-thrust coupling, drives Pc']].map(([k,v]) => <tr key={String(k)}><td>{k}</td><td className="highlight">{v}</td></tr>)}
              </table>
            </div>
          </>
        )}
      </div>

      {/* CALCULATOR */}
      <div className={`page${activeTab === 'calculator' ? ' active' : ''}`}>
        <div className="section">
          <div className="section-title">Nozzle Design Calculator</div>
          <div className="calc-input-row">
            {([['Desired Thrust (N)','thrust',1],['Chamber Pressure (MPa)','pc',0.1],['Thrust Coefficient CF','cf',0.05],['Expansion Ratio (Ae/At)','exp',0.1]] as [string, keyof typeof nozzle, number][]).map(([label, key, step]) => (
              <div key={key} className="inp-group"><label>{label}</label><input type="number" value={nozzle[key]} step={step} onChange={e => setNozzle(n => ({ ...n, [key]: parseFloat(e.target.value) }))} /></div>
            ))}
          </div>
          <div className="calc-result">
            <div className="res-title">Nozzle Results</div>
            <div className="res-grid">
              {[{ l: 'Throat Ø', v: `${fmt(throatDmm, 2)} mm` }, { l: 'Exit Ø', v: `${fmt(exitDmm, 2)} mm` }, { l: 'Throat Area', v: `${fmt(At_actual * 1e6, 2)} mm²` }, { l: 'Half-Angle', v: '15°' }].map(it => (
                <div key={it.l} className="res-item"><div className="rl">{it.l}</div><div className="rv">{it.v}</div></div>
              ))}
            </div>
          </div>
        </div>
        <div className="section">
          <div className="section-title">Propellant Mass / Grain Calculator</div>
          <div className="calc-input-row">
            {([['Total Impulse (N·s)','imp',0.1],['Isp (s)','isp',1],['Density (g/cm³)','dens',0.001],['Grain OD (mm)','od',0.5],['Grain core ID (mm)','id',0.5]] as [string, keyof typeof grain, number][]).map(([label, key, step]) => (
              <div key={key} className="inp-group"><label>{label}</label><input type="number" value={grain[key]} step={step} onChange={e => setGrain(g => ({ ...g, [key]: parseFloat(e.target.value) }))} /></div>
            ))}
          </div>
          <div className="calc-result">
            <div className="res-title">Grain Results</div>
            <div className="res-grid">
              {[{ l: 'Prop Mass', v: `${fmt(propMassG, 2)} g` }, { l: 'Prop Volume', v: `${fmt(grainVol, 2)} cm³` }, { l: 'Grain Length', v: `${fmt(grainLen, 1)} mm` }].map(it => (
                <div key={it.l} className="res-item"><div className="rl">{it.l}</div><div className="rv">{it.v}</div></div>
              ))}
            </div>
          </div>
        </div>
        <div className="section">
          <div className="section-title">Motor Class Reference Table</div>
          <table className="class-table">
            <thead><tr><th>Class</th><th>Min N·s</th><th>Max N·s</th><th>Common use</th></tr></thead>
            <tbody>
              {[['1/4A',0,0.3125,'Micro'],['1/2A',0.313,0.625,'Micro'],['A',0.626,1.25,'Beginner'],['B',1.251,2.5,'Small'],['C',2.501,5.0,'Small'],['D',5.001,10.0,'Mid'],['E',10.001,20.0,'Mid'],['F',20.001,40.0,'Sport'],['G',40.001,80.0,'High power entry'],['H',80.001,160.0,'High power'],['I',160.001,320.0,'High power'],['J',320.001,640.0,'High power'],['K',640.001,1280.0,'High power']].map(r => (
                <tr key={String(r[0])}><td style={{ color: r[0] === 'G' ? 'var(--purple)' : undefined, fontWeight: r[0] === 'G' ? 600 : undefined }}>{r[0]}</td><td>{r[1]}</td><td>{r[2]}</td><td>{r[3]}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="footer">KC DAQ Motor Analysis System · ESP32 + Teensy · Load cell 10 kg · Thermocouple · No pressure data</div>

      {/* SAVE MODAL */}
      {saveModal && (
        <div className="modal-overlay" onClick={() => setSaveModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>☁ Save to Cloud</h3>
            <p>Give this test session a name. It will be saved to Supabase and a shareable link will be generated.</p>
            <input className="modal-inp" value={sessionName} onChange={e => setSessionName(e.target.value)}
              placeholder="e.g. KNDX Test #3 — June 2026" onKeyDown={e => e.key === 'Enter' && handleSave()} autoFocus />
            <div className="modal-btns">
              <button className="btn" onClick={() => setSaveModal(false)}>Cancel</button>
              <button className="btn primary" onClick={handleSave} disabled={saving}>{saving ? '⏳ Saving…' : '☁ Save & Share'}</button>
            </div>
          </div>
        </div>
      )}

      {/* TOAST */}
      {toast && <div className={`toast ${toast.type}`}>{toast.type === 'success' ? '✓' : toast.type === 'error' ? '✕' : 'ℹ'} {toast.msg}</div>}
    </>
  )
}
