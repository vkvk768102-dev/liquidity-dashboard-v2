// 파일 위치: app/components/SwapSpreadCard.js
"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "swapSpread10Y";

export default function SwapSpreadCard({ treasury }) {
  const [swapRate, setSwapRate] = useState("");
  const [history, setHistory] = useState([]);
  const [savedAt, setSavedAt] = useState(null);

  // 저장된 값 불러오기 (브라우저 localStorage)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        const h = parsed.history ?? [];
        setHistory(h);
        if (h.length) {
          setSwapRate(String(h[h.length - 1].swapRate));
          setSavedAt(h[h.length - 1].date);
        }
      }
    } catch {
      // 저장된 값이 없거나 파싱 실패 시 무시
    }
  }, []);

  const handleSave = () => {
    const val = parseFloat(swapRate);
    if (Number.isNaN(val)) return;

    const today = new Date().toISOString().slice(0, 10);
    const entry = { date: today, swapRate: val };
    // 같은 날 재입력 시 덮어쓰기, 최근 60개만 보관
    const nextHistory = [...history.filter((h) => h.date !== today), entry].slice(-60);

    setHistory(nextHistory);
    setSavedAt(today);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ history: nextHistory }));
  };

  const treasuryValue = treasury?.latestValue ?? null;
  const latestSwap = history.length ? history[history.length - 1].swapRate : null;
  const spreadBp =
    latestSwap != null && treasuryValue != null
      ? (latestSwap - treasuryValue) * 100
      : null;

  const interpretation =
    spreadBp == null
      ? "10년물 스왑금리를 입력하면 스프레드가 자동 계산됩니다"
      : spreadBp < 0
      ? "마이너스 스프레드. 국채금리가 스왑금리보다 높은 상태 — 유동성 스트레스 국면에서 흔히 나타남"
      : "플러스 스프레드. 통상적인 범위";

  const spreadColor = spreadBp != null && spreadBp < 0 ? "#dc2626" : "#16a34a";

  return (
    <div
      style={{
        background: "#fff",
        borderRadius: 14,
        boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
        padding: 16,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>8. Swap Spread (10년물)</div>
        <span style={{ fontSize: 10.5, color: "#9ca3af" }}>수동 입력</span>
      </div>
      <div style={{ fontSize: 11.5, color: "#6b7280", margin: "4px 0 12px" }}>
        10Y 스왑금리 − 10Y 국채금리. 스왑금리는 무료 자동 소스가 없어 직접 입력합니다.
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
        <input
          type="number"
          step="0.01"
          inputMode="decimal"
          placeholder="예: 3.85"
          value={swapRate}
          onChange={(e) => setSwapRate(e.target.value)}
          style={{
            flex: 1,
            padding: "8px 10px",
            borderRadius: 8,
            border: "1px solid #d1d5db",
            fontSize: 13,
          }}
        />
        <button
          onClick={handleSave}
          style={{
            fontSize: 12.5,
            padding: "8px 12px",
            borderRadius: 8,
            border: "1px solid #d1d5db",
            background: "#f9fafb",
            cursor: "pointer",
          }}
        >
          저장
        </button>
      </div>

      <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 12 }}>
        bluegamma.io/usd-swap-rates/10-year-sofr-swap-rate 에서 값 확인 (전일 종가 기준)
      </div>

      <div style={{ display: "flex", gap: 20, marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 10.5, color: "#9ca3af" }}>10Y 국채금리</div>
          <div style={{ fontSize: 15, fontWeight: 700 }}>
            {treasuryValue != null ? `${treasuryValue.toFixed(2)}%` : "-"}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 10.5, color: "#9ca3af" }}>스프레드</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: spreadColor }}>
            {spreadBp != null ? `${spreadBp >= 0 ? "+" : ""}${spreadBp.toFixed(0)}bp` : "-"}
          </div>
        </div>
      </div>

      <div style={{ fontSize: 11.5, color: spreadBp != null && spreadBp < 0 ? "#dc2626" : "#374151" }}>
        {interpretation}
      </div>

      {savedAt && (
        <div style={{ fontSize: 10.5, color: "#9ca3af", marginTop: 8 }}>
          마지막 입력: {savedAt}
        </div>
      )}
    </div>
  );
}
