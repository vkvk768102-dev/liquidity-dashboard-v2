// 파일 위치: app/components/TreasuryAuctionTailCard.js
"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "treasuryAuctionTail";
const TENORS = [
  { key: "20Y", label: "20년물" },
  { key: "30Y", label: "30년물" },
];

function loadHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { "20Y": [], "30Y": [] };
    const parsed = JSON.parse(raw);
    return {
      "20Y": parsed["20Y"] ?? [],
      "30Y": parsed["30Y"] ?? [],
    };
  } catch {
    return { "20Y": [], "30Y": [] };
  }
}

export default function TreasuryAuctionTailCard() {
  const [history, setHistory] = useState({ "20Y": [], "30Y": [] });
  const [inputs, setInputs] = useState({
    "20Y": { date: "", tailBp: "" },
    "30Y": { date: "", tailBp: "" },
  });

  useEffect(() => {
    setHistory(loadHistory());
  }, []);

  const handleChange = (tenorKey, field, value) => {
    setInputs((prev) => ({
      ...prev,
      [tenorKey]: { ...prev[tenorKey], [field]: value },
    }));
  };

  const handleAdd = (tenorKey) => {
    const { date, tailBp } = inputs[tenorKey];
    const val = parseFloat(tailBp);
    if (!date || Number.isNaN(val)) return;

    const next = { ...history };
    const filtered = next[tenorKey].filter((e) => e.date !== date);
    const updated = [...filtered, { date, tailBp: val }]
      .sort((a, b) => (a.date > b.date ? 1 : -1))
      .slice(-10); // 최근 10개만 보관

    next[tenorKey] = updated;
    setHistory(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setInputs((prev) => ({ ...prev, [tenorKey]: { date: "", tailBp: "" } }));
  };

  // 각 만기별 최신값/직전값 계산
  const rows = TENORS.map(({ key, label }) => {
    const list = history[key] ?? [];
    const latest = list.length ? list[list.length - 1] : null;
    const prev = list.length > 1 ? list[list.length - 2] : null;
    return { key, label, latest, prev };
  });

  // 전체 해석: 최신 테일 평균이 직전 대비 확대됐는지
  const latestVals = rows.filter((r) => r.latest).map((r) => r.latest.tailBp);
  const prevVals = rows.filter((r) => r.prev).map((r) => r.prev.tailBp);
  let interpretation = "20년물/30년물 경매 결과를 입력하면 해석이 표시됩니다";
  let bad = false;
  if (latestVals.length && prevVals.length) {
    const latestAvg = latestVals.reduce((a, b) => a + b, 0) / latestVals.length;
    const prevAvg = prevVals.reduce((a, b) => a + b, 0) / prevVals.length;
    if (latestAvg > prevAvg) {
      interpretation = "TAIL 확대. 수요 약화, 프리미엄 요구 증가";
      bad = true;
    } else if (latestAvg < prevAvg) {
      interpretation = "TAIL 축소. 수요 견조";
      bad = false;
    } else {
      interpretation = "전회 경매와 동일한 수준";
    }
  } else if (latestVals.length) {
    const avg = latestVals.reduce((a, b) => a + b, 0) / latestVals.length;
    interpretation = avg >= 2 ? "TAIL 다소 높은 편. 수요 약화 가능성" : "TAIL 낮은 편. 수요 양호";
    bad = avg >= 2;
  }

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
        <div style={{ fontWeight: 700, fontSize: 14 }}>7. Treasury Auction Tail (최근 20-30년물)</div>
        <span style={{ fontSize: 10.5, color: "#9ca3af" }}>수동 입력</span>
      </div>
      <div style={{ fontSize: 11.5, color: "#6b7280", margin: "4px 0 12px" }}>
        국채 입찰 응찰률 꼬리 (낙찰금리 - 발행금리). 경매 당일 경제기사에서 값 확인 후 입력.
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, marginBottom: 12 }}>
        <thead>
          <tr style={{ background: "#1e3a8a", color: "#fff" }}>
            <th style={{ padding: "6px 4px", textAlign: "center" }}>구분</th>
            <th style={{ padding: "6px 4px", textAlign: "center" }}>최근 입찰일</th>
            <th style={{ padding: "6px 4px", textAlign: "center" }}>TAIL (bp)</th>
            <th style={{ padding: "6px 4px", textAlign: "center" }}>직전 입찰 TAIL (bp)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} style={{ borderBottom: "1px solid #e5e7eb" }}>
              <td style={{ padding: "6px 4px", textAlign: "center", fontWeight: 600 }}>{r.label}</td>
              <td style={{ padding: "6px 4px", textAlign: "center" }}>{r.latest?.date ?? "-"}</td>
              <td style={{ padding: "6px 4px", textAlign: "center", fontWeight: 700 }}>
                {r.latest ? r.latest.tailBp.toFixed(1) : "-"}
              </td>
              <td style={{ padding: "6px 4px", textAlign: "center", color: "#6b7280" }}>
                {r.prev ? r.prev.tailBp.toFixed(1) : "-"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {TENORS.map(({ key, label }) => (
        <div key={key} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 8 }}>
          <span style={{ fontSize: 11.5, color: "#374151", width: 44 }}>{label}</span>
          <input
            type="date"
            value={inputs[key].date}
            onChange={(e) => handleChange(key, "date", e.target.value)}
            style={{ flex: 1, padding: "6px 8px", borderRadius: 8, border: "1px solid #d1d5db", fontSize: 12 }}
          />
          <input
            type="number"
            step="0.1"
            placeholder="TAIL(bp)"
            value={inputs[key].tailBp}
            onChange={(e) => handleChange(key, "tailBp", e.target.value)}
            style={{ width: 80, padding: "6px 8px", borderRadius: 8, border: "1px solid #d1d5db", fontSize: 12 }}
          />
          <button
            onClick={() => handleAdd(key)}
            style={{ fontSize: 11.5, padding: "6px 10px", borderRadius: 8, border: "1px solid #d1d5db", background: "#f9fafb", cursor: "pointer" }}
          >
            저장
          </button>
        </div>
      ))}

      <div style={{ fontSize: 11.5, color: bad ? "#dc2626" : "#374151", marginTop: 4 }}>
        {bad ? "▲ " : latestVals.length ? "▼ " : ""}
        {interpretation}
      </div>
    </div>
  );
}
