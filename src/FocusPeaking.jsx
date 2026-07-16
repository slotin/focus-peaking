import { useEffect, useRef, useState, useCallback } from 'react'

// Analysis is done on a downscaled offscreen frame for performance — never on full resolution.
const ANALYSIS_WIDTH = 240
const ROI_FRACTION = 0.6
const EDGE_THRESHOLD = 18
const EMA_ALPHA = 0.2
const TREND_WINDOW_MS = 800
const HISTORY_WINDOW_MS = 6000
const PEAK_PROXIMITY_PCT = 97

// checked against the package.json on the main branch to detect a newer release
const VERSION_CHECK_URL = 'https://raw.githubusercontent.com/slotin/focus-peaking/main/package.json'
const VERSION_CHECK_INTERVAL_MS = 60 * 60 * 1000

function isNewerVersion(latest, current) {
  const a = String(latest).split('.').map(Number)
  const b = String(current).split('.').map(Number)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || 0
    const y = b[i] || 0
    if (x > y) return true
    if (x < y) return false
  }
  return false
}

// 3x3 Laplacian kernel: [0,1,0; 1,-4,1; 0,1,0]
function laplacianVarianceAndEdges(gray, w, h, roi, threshold, edgeOut) {
  let sum = 0
  let sumSq = 0
  let count = 0
  for (let y = roi.y0; y < roi.y1; y++) {
    for (let x = roi.x0; x < roi.x1; x++) {
      if (x <= 0 || y <= 0 || x >= w - 1 || y >= h - 1) continue
      const i = y * w + x
      const lap = gray[i - 1] + gray[i + 1] + gray[i - w] + gray[i + w] - 4 * gray[i]
      sum += lap
      sumSq += lap * lap
      count++
      if (edgeOut && Math.abs(lap) > threshold) edgeOut[i] = 1
    }
  }
  if (count === 0) return 0
  const mean = sum / count
  return sumSq / count - mean * mean
}

// red (0%) → orange → yellow → green (100% of session peak)
function peakProximityColor(pct) {
  const clamped = Math.max(0, Math.min(100, pct))
  const hue = (clamped / 100) * 120 // 0=red, 60=yellow, 120=green
  return `hsl(${hue}, 80%, 88%)`
}

const STRINGS = {
  uk: {
    noCameras: 'Камер не знайдено',
    camera: n => `Камера ${n}`,
    connecting: 'Підключення…',
    showEdges: 'Показувати підсвітку країв',
    size: 'Розмір',
    sharpness: 'Різкість',
    sessionPeak: 'Пік сесії',
    reset: 'reset',
    pctOfPeak: '% від піку',
    trend: 'Тренд',
    trendStable: 'стабільно',
    trendNearPeak: '🎯 біля піку',
    trendRising: '↑ росте',
    trendFalling: '↓ падає',
    errNotFound: 'Камеру не знайдено.',
    errNotAllowed: 'Немає доступу до камери — дозвольте доступ у браузері.',
    errOverconstrained: 'Обрана камера недоступна — спробуйте вибрати іншу зі списку.',
    errGeneric: (msg) => `Не вдалося підключити камеру: ${msg}`,
    errUnsupported: 'Цей браузер не підтримує доступ до камери (mediaDevices API відсутній).',
    updateAvailable: 'Доступна нова версія застосунку — оновіть (git pull && npm install)',
    updateDismiss: 'Приховати',
  },
  en: {
    noCameras: 'No cameras found',
    camera: n => `Camera ${n}`,
    connecting: 'Connecting…',
    showEdges: 'Show edge highlighting',
    size: 'Size',
    sharpness: 'Sharpness',
    sessionPeak: 'Session peak',
    reset: 'reset',
    pctOfPeak: '% of peak',
    trend: 'Trend',
    trendStable: 'stable',
    trendNearPeak: '🎯 near peak',
    trendRising: '↑ rising',
    trendFalling: '↓ falling',
    errNotFound: 'Camera not found.',
    errNotAllowed: 'No camera access — please allow access in the browser.',
    errOverconstrained: 'Selected camera is unavailable — try picking another one from the list.',
    errGeneric: (msg) => `Could not connect to the camera: ${msg}`,
    errUnsupported: 'This browser does not support camera access (mediaDevices API missing).',
    updateAvailable: 'A new version is available — please update (git pull && npm install)',
    updateDismiss: 'Dismiss',
  },
}

function cameraErrorMessage(e, s) {
  if (e.name === 'NotFoundError') return s.errNotFound
  if (e.name === 'NotAllowedError') return s.errNotAllowed
  if (e.name === 'OverconstrainedError') return s.errOverconstrained
  return s.errGeneric(e.message || e.name)
}

export default function FocusPeaking() {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const analysisCanvasRef = useRef(null)
  const streamRef = useRef(null)
  const rafRef = useRef(null)
  const emaRef = useRef(null)
  const historyRef = useRef([]) // { t, value }
  const peakRef = useRef(0)
  const showEdgesRef = useRef(false)

  const [devices, setDevices] = useState([])
  const [selectedDeviceId, setSelectedDeviceId] = useState('')
  const [error, setError] = useState('')
  const [starting, setStarting] = useState(false)
  const [sharpness, setSharpness] = useState(0)
  const [peak, setPeak] = useState(0)
  const [trendKey, setTrendKey] = useState('trendStable')
  const [showEdges, setShowEdges] = useState(false)
  const [maxWidth, setMaxWidth] = useState(() => Number(localStorage.getItem('focus-peaking-width')) || 640)
  const [lang, setLang] = useState(() => localStorage.getItem('focus-peaking-lang') || (navigator.language?.startsWith('uk') ? 'uk' : 'en'))
  const s = STRINGS[lang]
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const [updateDismissed, setUpdateDismissed] = useState(false)

  useEffect(() => { localStorage.setItem('focus-peaking-lang', lang) }, [lang])
  useEffect(() => { localStorage.setItem('focus-peaking-width', String(maxWidth)) }, [maxWidth])
  useEffect(() => { showEdgesRef.current = showEdges }, [showEdges])

  // periodic check against the repo's main branch for a newer released version
  useEffect(() => {
    let cancelled = false
    const check = async () => {
      try {
        const res = await fetch(`${VERSION_CHECK_URL}?t=${Date.now()}`, { cache: 'no-store' })
        const { version } = await res.json()
        if (!cancelled && version && isNewerVersion(version, __APP_VERSION__)) setUpdateAvailable(true)
      } catch {
        // offline or rate-limited — silently skip, will retry on the next interval
      }
    }
    check()
    const interval = setInterval(check, VERSION_CHECK_INTERVAL_MS)
    return () => { cancelled = true; clearInterval(interval) }
  }, [])

  // labels (and, on some browsers, the full device count) are only populated once
  // permission has been granted at least once — safe to call any time after that
  const refreshDevices = useCallback(async () => {
    try {
      const list = await navigator.mediaDevices.enumerateDevices()
      setDevices(list.filter(d => d.kind === 'videoinput'))
    } catch {
      // ignore — enumerateDevices can fail before any getUserMedia permission exists on some browsers
    }
  }, [])

  const stopStream = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop())
      streamRef.current = null
    }
  }, [])

  const startLoop = useCallback(() => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return
    const ctx = canvas.getContext('2d')

    if (!analysisCanvasRef.current) analysisCanvasRef.current = document.createElement('canvas')
    const aCanvas = analysisCanvasRef.current
    const aCtx = aCanvas.getContext('2d', { willReadFrequently: true })

    const tick = () => {
      if (video.videoWidth && video.videoHeight) {
        if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
          canvas.width = video.videoWidth
          canvas.height = video.videoHeight
        }
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

        const aw = ANALYSIS_WIDTH
        const ah = Math.max(1, Math.round(aw * (video.videoHeight / video.videoWidth)))
        if (aCanvas.width !== aw || aCanvas.height !== ah) { aCanvas.width = aw; aCanvas.height = ah }
        aCtx.drawImage(video, 0, 0, aw, ah)

        const frame = aCtx.getImageData(0, 0, aw, ah)
        const gray = new Float32Array(aw * ah)
        for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
          gray[i] = 0.299 * frame.data[p] + 0.587 * frame.data[p + 1] + 0.114 * frame.data[p + 2]
        }

        const roi = {
          x0: Math.round(aw * (1 - ROI_FRACTION) / 2),
          x1: Math.round(aw * (1 + ROI_FRACTION) / 2),
          y0: Math.round(ah * (1 - ROI_FRACTION) / 2),
          y1: Math.round(ah * (1 + ROI_FRACTION) / 2),
        }

        const edgeOut = showEdgesRef.current ? new Uint8Array(aw * ah) : null
        const variance = laplacianVarianceAndEdges(gray, aw, ah, roi, EDGE_THRESHOLD, edgeOut)

        emaRef.current = emaRef.current == null ? variance : emaRef.current + EMA_ALPHA * (variance - emaRef.current)
        const now = performance.now()
        historyRef.current.push({ t: now, value: emaRef.current })
        historyRef.current = historyRef.current.filter(h => now - h.t <= HISTORY_WINDOW_MS)

        if (emaRef.current > peakRef.current) peakRef.current = emaRef.current

        const past = historyRef.current.find(h => now - h.t >= TREND_WINDOW_MS)
        const pctOfPeak = peakRef.current > 0 ? (emaRef.current / peakRef.current) * 100 : 0
        let trendLabelKey = 'trendStable'
        if (pctOfPeak >= PEAK_PROXIMITY_PCT) trendLabelKey = 'trendNearPeak'
        else if (past) {
          const diff = emaRef.current - past.value
          const relDiff = past.value > 0 ? diff / past.value : 0
          if (relDiff > 0.03) trendLabelKey = 'trendRising'
          else if (relDiff < -0.03) trendLabelKey = 'trendFalling'
        }

        setSharpness(emaRef.current)
        setPeak(peakRef.current)
        setTrendKey(trendLabelKey)

        // overlay: edges highlighted green, scaled back up to canvas resolution
        if (edgeOut) {
          const scaleX = canvas.width / aw
          const scaleY = canvas.height / ah
          ctx.fillStyle = 'rgba(0, 255, 80, 0.55)'
          for (let y = 0; y < ah; y++) {
            for (let x = 0; x < aw; x++) {
              if (edgeOut[y * aw + x]) ctx.fillRect(x * scaleX, y * scaleY, Math.ceil(scaleX), Math.ceil(scaleY))
            }
          }
        }

        // ROI dashed frame
        ctx.save()
        ctx.setLineDash([8, 6])
        ctx.strokeStyle = 'rgba(255,255,255,0.8)'
        ctx.lineWidth = 2
        ctx.strokeRect(
          canvas.width * (1 - ROI_FRACTION) / 2,
          canvas.height * (1 - ROI_FRACTION) / 2,
          canvas.width * ROI_FRACTION,
          canvas.height * ROI_FRACTION,
        )
        ctx.restore()

        drawHistoryChart(canvas, ctx, historyRef.current, peakRef.current)
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [])

  // shared by the initial mount (unconstrained — also triggers the permission prompt)
  // and by explicit device switches (constrained to an exact deviceId)
  const openCamera = useCallback(async (constraints) => {
    setError('')
    setStarting(true)
    stopStream()
    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      streamRef.current = stream
      const actualId = stream.getVideoTracks()[0]?.getSettings()?.deviceId || ''
      const video = videoRef.current
      if (video) {
        video.srcObject = stream
        // in dev, React StrictMode mounts/unmounts/remounts this effect once, which can
        // tear the stream down again mid-play() — that rejects with AbortError, which
        // isn't a real camera failure and shouldn't surface as one
        try {
          await video.play()
        } catch (playErr) {
          if (playErr.name === 'AbortError') return
          throw playErr
        }
      }
      await refreshDevices() // labels/ids become available post-permission
      if (actualId) setSelectedDeviceId(actualId)
      peakRef.current = 0
      setPeak(0)
      emaRef.current = null
      historyRef.current = []
      startLoop()
    } catch (e) {
      if (e.name === 'AbortError') return
      setError(cameraErrorMessage(e, s))
    } finally {
      setStarting(false)
    }
  }, [stopStream, refreshDevices, startLoop, s])

  // mount: enumerate what we can pre-permission, then request the default camera
  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(s.errUnsupported)
      return
    }
    refreshDevices()
    navigator.mediaDevices.addEventListener?.('devicechange', refreshDevices)
    openCamera({ video: true })
    return () => {
      navigator.mediaDevices.removeEventListener?.('devicechange', refreshDevices)
      stopStream()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleDeviceChange = (id) => {
    if (!id || id === selectedDeviceId) return
    setSelectedDeviceId(id)
    openCamera({ video: { deviceId: { exact: id } } })
  }

  const resetPeak = () => {
    peakRef.current = 0
    setPeak(0)
  }

  const pctOfPeak = peak > 0 ? Math.round((sharpness / peak) * 100) : 0

  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--r-lg)] p-4">
      {updateAvailable && !updateDismissed && (
        <div className="flex items-center justify-between gap-3 text-xs mb-3 px-3 py-2 rounded-[var(--r-md)]" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>
          <span>🔄 {s.updateAvailable}</span>
          <button onClick={() => setUpdateDismissed(true)} className="underline shrink-0">{s.updateDismiss}</button>
        </div>
      )}
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <div className="flex items-center gap-2">
          <select
            value={selectedDeviceId}
            onChange={e => handleDeviceChange(e.target.value)}
            className="px-2.5 py-1.5 text-sm rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface)] outline-none focus:border-[var(--accent)]"
          >
            {devices.length === 0 && <option value="">{s.noCameras}</option>}
            {devices.map((d, i) => (
              <option key={d.deviceId} value={d.deviceId}>{d.label || s.camera(i + 1)}</option>
            ))}
          </select>
          {starting && <span className="text-xs text-[var(--text-3)]">{s.connecting}</span>}
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-[var(--text-2)] cursor-pointer">
            <input type="checkbox" checked={showEdges} onChange={e => setShowEdges(e.target.checked)} className="rounded" />
            {s.showEdges}
          </label>
          <label className="flex items-center gap-1.5 text-xs text-[var(--text-2)]">
            {s.size}
            <input
              type="range"
              min={320}
              max={1600}
              step={20}
              value={maxWidth}
              onChange={e => setMaxWidth(Number(e.target.value))}
              className="w-20 align-middle"
            />
          </label>
          <div className="flex rounded-[var(--r-md)] border border-[var(--border)] overflow-hidden text-xs font-medium">
            <button
              onClick={() => setLang('uk')}
              className="px-2 py-1"
              style={{ background: lang === 'uk' ? 'var(--accent)' : 'var(--surface)', color: lang === 'uk' ? '#fff' : 'var(--text-2)' }}
            >
              UK
            </button>
            <button
              onClick={() => setLang('en')}
              className="px-2 py-1"
              style={{ background: lang === 'en' ? 'var(--accent)' : 'var(--surface)', color: lang === 'en' ? '#fff' : 'var(--text-2)' }}
            >
              EN
            </button>
          </div>
        </div>
      </div>

      {error ? (
        <div className="text-sm text-[var(--danger)] bg-[var(--danger-soft)] rounded-[var(--r-md)] px-3 py-2">{error}</div>
      ) : (
        <>
          <div className="relative bg-black rounded-[var(--r-md)] overflow-hidden" style={{ maxWidth, margin: '0 auto' }}>
            {/* not display:none — some browsers (Safari) suspend frame decoding for hidden video elements */}
            <video ref={videoRef} className="absolute w-px h-px opacity-0 pointer-events-none -z-10" muted playsInline />
            <canvas ref={canvasRef} className="w-full h-auto block" />
          </div>

          <div
            className="grid grid-cols-4 gap-4 mt-3 p-4 rounded-[var(--r-lg)] transition-colors duration-300"
            style={{ backgroundColor: peakProximityColor(pctOfPeak), color: '#0D0D0F' }}
          >
            <div>
              <div className="text-xs mb-1" style={{ color: 'rgba(13,13,15,0.6)' }}>{s.sharpness}</div>
              <div className="text-3xl font-bold">{Math.round(sharpness)}</div>
            </div>
            <div>
              <div className="text-xs mb-1" style={{ color: 'rgba(13,13,15,0.6)' }}>{s.sessionPeak}</div>
              <div className="text-3xl font-bold flex items-center gap-2">
                {Math.round(peak)}
                <button onClick={resetPeak} className="text-sm px-3 py-1.5 rounded-[var(--r-md)] border border-[var(--border)] font-medium bg-[var(--surface)] text-[var(--text-2)]">
                  {s.reset}
                </button>
              </div>
            </div>
            <div>
              <div className="text-xs mb-1" style={{ color: 'rgba(13,13,15,0.6)' }}>{s.pctOfPeak}</div>
              <div className="text-3xl font-bold">{pctOfPeak}%</div>
            </div>
            <div>
              <div className="text-xs mb-1" style={{ color: 'rgba(13,13,15,0.6)' }}>{s.trend}</div>
              <div className="text-3xl font-bold">{s[trendKey]}</div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function drawHistoryChart(canvas, ctx, history, peak) {
  if (history.length < 2) return
  const chartH = 60
  const chartW = 220
  const pad = 8
  const x0 = canvas.width - chartW - pad
  const y0 = canvas.height - chartH - pad

  ctx.save()
  ctx.fillStyle = 'rgba(0,0,0,0.45)'
  ctx.fillRect(x0, y0, chartW, chartH)

  const max = Math.max(peak, ...history.map(h => h.value), 1)
  const now = history[history.length - 1].t
  const minT = now - HISTORY_WINDOW_MS

  ctx.beginPath()
  ctx.strokeStyle = '#22ff66'
  ctx.lineWidth = 1.5
  history.forEach((h, i) => {
    const x = x0 + ((h.t - minT) / HISTORY_WINDOW_MS) * chartW
    const y = y0 + chartH - (h.value / max) * chartH
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  })
  ctx.stroke()
  ctx.restore()
}
