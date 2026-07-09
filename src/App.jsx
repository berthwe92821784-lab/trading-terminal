import { useState, useEffect, useCallback, useRef } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { TrendingUp, TrendingDown, Minus, AlertTriangle, RefreshCw, Activity } from "lucide-react";

const SYMBOLS = [
  { value: "BTCUSDT", label: "BTC / USDT" },
  { value: "ETHUSDT", label: "ETH / USDT" },
  { value: "SOLUSDT", label: "SOL / USDT" },
  { value: "BNBUSDT", label: "BNB / USDT" },
  { value: "XRPUSDT", label: "XRP / USDT" },
  { value: "LTCUSDT", label: "LTC / USDT" },
];

const REFRESH_MS = 15000;

function sma(values, period) {
  const out = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += values[j];
    out[i] = sum / period;
  }
  return out;
}

function ema(values, period) {
  const out = new Array(values.length).fill(null);
  const k = 2 / (period + 1);
  let prev = null;
  for (let i = 0; i < values.length; i++) {
    if (values[i] == null) continue;
    if (prev == null) {
      if (i >= period - 1) {
        const slice = values.slice(i - period + 1, i + 1);
        prev = slice.reduce((a, b) => a + b, 0) / period;
        out[i] = prev;
      }
    } else {
      prev = values[i] * k + prev * (1 - k);
      out[i] = prev;
    }
  }
  return out;
}

function rsi(values, period = 14) {
  const out = new Array(values.length).fill(null);
  let gains = 0, losses = 0;
  for (let i = 1; i <= period && i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  out[period] = 100 - 100 / (1 + (avgLoss === 0 ? 100 : avgGain / avgLoss));
  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    out[i] = 100 - 100 / (1 + rs);
  }
  return out;
}

function macd(values) {
  const ema12 = ema(values, 12);
  const ema26 = ema(values, 26);
  const macdLine = values.map((_, i) =>
    ema12[i] != null && ema26[i] != null ? ema12[i] - ema26[i] : null
  );
  const signalLine = ema(macdLine, 9);
  const hist = macdLine.map((v, i) =>
    v != null && signalLine[i] != null ? v - signalLine[i] : null
  );
  return { macdLine, signalLine, hist };
}

function lastValid(arr) {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i] != null) return arr[i];
  }
  return null;
}

export default function TradingSignalTerminal() {
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [candles, setCandles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [pulse, setPulse] = useState(false);
  const timerRef = useRef(null);

  const fetchData = useCallback(async (sym) => {
    setPulse(true);
    try {
      const res = await fetch(
        `https://api.binance.com/api/v3/klines?symbol=${sym}&interval=1m&limit=120`
      );
      if (!res.ok) throw new Error("Réponse réseau invalide");
      const raw = await res.json();
      const parsed = raw.map((k) => ({
        time: k[0],
        close: parseFloat(k[4]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
      }));
      setCandles(parsed);
      setError(null);
      setLastUpdate(new Date());
    } catch (e) {
      setError("Impossible de récupérer les données de marché. Réessai en cours...");
    } finally {
      setLoading(false);
      setTimeout(() => setPulse(false), 600);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchData(symbol);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => fetchData(symbol), REFRESH_MS);
    return () => clearInterval(timerRef.current);
  }, [symbol, fetchData]);

  const closes = candles.map((c) => c.close);
  const sma9 = sma(closes, 9);
  const sma21 = sma(closes, 21);
  const rsiArr = rsi(closes, 14);
  const { macdLine, signalLine, hist } = macd(closes);

  const lastClose = lastValid(closes);
  const lastSma9 = lastValid(sma9);
  const lastSma21 = lastValid(sma21);
  const lastRsi = lastValid(rsiArr);
  const lastMacd = lastValid(macdLine);
  const lastSignal = lastValid(signalLine);
  const lastHist = lastValid(hist);
  const prevHist = hist.filter((h) => h != null).slice(-2)[0] ?? null;

  let score = 0;
  const reasons = [];
  if (lastSma9 != null && lastSma21 != null) {
    if (lastSma9 > lastSma21) {
      score += 1;
      reasons.push({ text: "Moyenne courte (9) au-dessus de la longue (21) — tendance haussière", dir: "up" });
    } else {
      score -= 1;
      reasons.push({ text: "Moyenne courte (9) sous la longue (21) — tendance baissière", dir: "down" });
    }
  }
  if (lastRsi != null) {
    if (lastRsi < 30) {
      score += 1;
      reasons.push({ text: `RSI à ${lastRsi.toFixed(1)} — zone de survente`, dir: "up" });
    } else if (lastRsi > 70) {
      score -= 1;
      reasons.push({ text: `RSI à ${lastRsi.toFixed(1)} — zone de surachat`, dir: "down" });
    } else {
      reasons.push({ text: `RSI à ${lastRsi.toFixed(1)} — zone neutre`, dir: "flat" });
    }
  }
  if (lastMacd != null && lastSignal != null) {
    if (lastMacd > lastSignal) {
      score += 1;
      reasons.push({ text: "MACD au-dessus de sa ligne de signal — momentum haussier", dir: "up" });
    } else {
      score -= 1;
      reasons.push({ text: "MACD sous sa ligne de signal — momentum baissier", dir: "down" });
    }
  }
  if (lastHist != null && prevHist != null) {
    if (lastHist > prevHist) {
      reasons.push({ text: "Histogramme MACD en accélération", dir: "up" });
    } else {
      reasons.push({ text: "Histogramme MACD en ralentissement", dir: "down" });
    }
  }

  let signalLabel = "ATTENDRE";
  let signalColor = "#B8860B";
  let SignalIcon = Minus;
  if (score >= 2) {
    signalLabel = "ACHETER";
    signalColor = "#4ADE80";
    SignalIcon = TrendingUp;
  } else if (score <= -2) {
    signalLabel = "VENDRE";
    signalColor = "#F87171";
    SignalIcon = TrendingDown;
  }

  const chartData = candles.map((c, i) => ({
    idx: i,
    time: new Date(c.time).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }),
    close: c.close,
    sma9: sma9[i],
    sma21: sma21[i],
  })).slice(-60);

  return (
    <div className="min-h-screen w-full" style={{ background: "#0A0E0C", fontFamily: "'IBM Plex Mono', monospace" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=Oswald:wght@500;600;700&display=swap');
        @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
        @keyframes scan { 0% { transform: translateY(-100%); } 100% { transform: translateY(100%); } }
        .pulse-dot { animation: blink 1s ease-in-out; }
        .amber-glow { text-shadow: 0 0 12px rgba(255, 176, 0, 0.35); }
      `}</style>

      <div className="max-w-5xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-center justify-between border-b pb-4 mb-6" style={{ borderColor: "#2A2F28" }}>
          <div className="flex items-center gap-3">
            <Activity className={`w-5 h-5 ${pulse ? "pulse-dot" : ""}`} style={{ color: "#FFB000" }} />
            <h1
              className="text-xl tracking-wide amber-glow"
              style={{ fontFamily: "'Oswald', sans-serif", color: "#FFB000", fontWeight: 600, letterSpacing: "0.05em" }}
            >
              TERMINAL D'ANALYSE — SIGNAUX MARCHÉ
            </h1>
          </div>
          <div className="text-xs" style={{ color: "#6B7268" }}>
            {lastUpdate ? `MAJ ${lastUpdate.toLocaleTimeString("fr-FR")}` : "—"}
          </div>
        </div>

        {/* Risk banner */}
        <div
          className="flex items-start gap-3 px-4 py-3 mb-6 text-sm"
          style={{ background: "#1A1410", border: "1px solid #4A3A1A", color: "#E8B85C" }}
        >
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <p>
            Ceci est un outil d'aide à la décision, pas un conseiller financier. Le trading très court terme (quelques minutes)
            comporte un risque élevé de perte. Aucun signal ne garantit un résultat — validez toujours vous-même avant d'agir,
            et ne misez jamais plus que ce que vous pouvez perdre.
          </p>
        </div>

        {/* Symbol selector */}
        <div className="flex gap-2 mb-6 flex-wrap">
          {SYMBOLS.map((s) => (
            <button
              key={s.value}
              onClick={() => setSymbol(s.value)}
              className="px-3 py-1.5 text-sm transition-colors"
              style={{
                background: symbol === s.value ? "#FFB000" : "transparent",
                color: symbol === s.value ? "#0A0E0C" : "#B8B098",
                border: `1px solid ${symbol === s.value ? "#FFB000" : "#3A3F35"}`,
                fontWeight: symbol === s.value ? 600 : 400,
              }}
            >
              {s.label}
            </button>
          ))}
        </div>

        {error && (
          <div className="mb-6 px-4 py-2 text-sm flex items-center gap-2" style={{ background: "#1A1010", color: "#F87171", border: "1px solid #4A1A1A" }}>
            <RefreshCw className="w-3.5 h-3.5" /> {error}
          </div>
        )}

        {loading ? (
          <div className="py-24 text-center" style={{ color: "#6B7268" }}>Chargement des données de marché...</div>
        ) : (
          <>
            {/* Signal panel */}
            <div
              className="mb-6 px-6 py-6 flex items-center justify-between flex-wrap gap-4"
              style={{ background: "#12160F", border: `1px solid ${signalColor}55` }}
            >
              <div className="flex items-center gap-4">
                <SignalIcon className="w-10 h-10" style={{ color: signalColor }} />
                <div>
                  <div className="text-xs mb-1 tracking-widest" style={{ color: "#6B7268" }}>SIGNAL — {symbol}</div>
                  <div
                    className="text-3xl tracking-wide"
                    style={{ fontFamily: "'Oswald', sans-serif", color: signalColor, fontWeight: 700 }}
                  >
                    {signalLabel}
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs mb-1" style={{ color: "#6B7268" }}>DERNIER PRIX</div>
                <div className="text-2xl" style={{ color: "#EDE9DD", fontWeight: 600 }}>
                  {lastClose ? lastClose.toLocaleString("fr-FR", { maximumFractionDigits: 4 }) : "—"}
                </div>
              </div>
            </div>

            {/* Reasons */}
            <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 gap-2">
              {reasons.map((r, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 px-3 py-2 text-sm"
                  style={{ background: "#0F130D", border: "1px solid #23281F", color: "#B8B098" }}
                >
                  {r.dir === "up" && <TrendingUp className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "#4ADE80" }} />}
                  {r.dir === "down" && <TrendingDown className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "#F87171" }} />}
                  {r.dir === "flat" && <Minus className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "#B8860B" }} />}
                  {r.text}
                </div>
              ))}
            </div>

            {/* Chart */}
            <div className="mb-6 px-4 py-4" style={{ background: "#0F130D", border: "1px solid #23281F" }}>
              <div className="text-xs mb-3 tracking-widest" style={{ color: "#6B7268" }}>PRIX / MOYENNES MOBILES (60 DERNIÈRES MINUTES)</div>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="2 4" stroke="#23281F" />
                  <XAxis dataKey="time" tick={{ fill: "#6B7268", fontSize: 10 }} interval={9} />
                  <YAxis domain={["auto", "auto"]} tick={{ fill: "#6B7268", fontSize: 10 }} width={70} />
                  <Tooltip
                    contentStyle={{ background: "#12160F", border: "1px solid #3A3F35", fontSize: 12 }}
                    labelStyle={{ color: "#B8B098" }}
                  />
                  <Line type="monotone" dataKey="close" stroke="#EDE9DD" dot={false} strokeWidth={1.5} name="Prix" />
                  <Line type="monotone" dataKey="sma9" stroke="#FFB000" dot={false} strokeWidth={1.5} name="SMA 9" />
                  <Line type="monotone" dataKey="sma21" stroke="#6FA8D6" dot={false} strokeWidth={1.5} name="SMA 21" />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Indicator readouts */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { label: "RSI (14)", value: lastRsi != null ? lastRsi.toFixed(1) : "—" },
                { label: "SMA 9", value: lastSma9 != null ? lastSma9.toFixed(2) : "—" },
                { label: "SMA 21", value: lastSma21 != null ? lastSma21.toFixed(2) : "—" },
                { label: "MACD", value: lastMacd != null ? lastMacd.toFixed(3) : "—" },
              ].map((it, i) => (
                <div key={i} className="px-3 py-3 text-center" style={{ background: "#0F130D", border: "1px solid #23281F" }}>
                  <div className="text-xs mb-1" style={{ color: "#6B7268" }}>{it.label}</div>
                  <div style={{ color: "#EDE9DD", fontWeight: 600 }}>{it.value}</div>
                </div>
              ))}
            </div>

            <div className="mt-6 text-center text-xs" style={{ color: "#4A4F42" }}>
              Actualisation automatique toutes les 15 secondes · Données : Binance (marché crypto au comptant)
            </div>
          </>
        )}
      </div>
    </div>
  );
}
