// 파일 위치: app/components/TreasuryAuctionTailCard.js
"use client";

import { useEffect, useState } from "react";

const TENORS = [
  { key: "20Y", label: "20년물" },
  { key: "30Y", label: "30년물" },
];

async function fetchJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json();
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `요청 실패 (${res.status})`);
  }
  return data;
}

export default function TreasuryAuctionTailCard() {
  const [state, setState] = useState({ loading: true, error: null, data: null });

  useEffect(() => {
    let cancelled = false;
    fetchJson("/api/treasury-auction-tail")
      .then((d) => {
        if (!cancelled) setState({ loading: false, error: null, data: d });
      })
      .catch((e) => {
        if (!cancelled) setState({ loading: false, error: e.message, data: null });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const data = state.data;
  const rows = TENORS.map(({ key, label }) => ({
    key,
    label,
    latest: data?.[key]?.latest ?? null,
    prev: data?.[key]?.prev ?? null,
  }));

  const latestVals = rows.filter((r) => r.latest).map((r) => r.latest.tailBp);
  const prevVals = rows.filter((r) => r.prev).map((r) => r.prev.tailBp);

  let interpretation = "데이터를 불러오는 중입니다";
  let bad = false;
  let hasLatest = latestVals.length > 0;

  if (state.error) {
    interpretation = `데이터를 가져오지 못했습니다 (${state.error})`;
  } else if (hasLatest && prevVals.length) {
    const latestAvg = latestVals.reduce((a, b) => a + b, 0) / latestVals.length;
    const prevAvg = prevVals.reduce((a, b) => a + b, 0) / prevVals.length;
    if (latestAvg > prevAvg) {
      interpretation = "TAIL 확대. 수요 약화, 프리미엄 요구 증가";
      bad = true;
    } else if (latestAvg < prevAvg) {
      interpretation = "TAIL 축소. 수요 견조";
    } else {
      interpretation = "전회 경매와 동일한 수준";
    }
  } else if (hasLatest) {
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
        <span style={{ fontSize: 10.5, color: "#9ca3af" }}>자동 갱신</span>
      </div>
      <div style={{ fontSize: 11.5, color: "#6b7280", margin: "4px 0 12px" }}>
        국채 입찰 응찰률 꼬리 (낙찰금리 - 발행금리). 매월 20년물/30년물 경매 결과를 자동으로 반영합니다.
      </div>

      {state.loading ? (
        <div style={{ fontSize: 12.5, color: "#9ca3af", padding: "12px 0" }}>불러오는 중...</div>
      ) : (
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
                <td
                  style={{
                    padding: "6px 4px",
                    textAlign: "center",
                    fontWeight: 700,
                    color: r.latest?.tailBp != null && r.latest.tailBp < 0 ? "#16a34a" : "#111827",
                  }}
                >
                  {r.latest?.tailBp != null ? r.latest.tailBp.toFixed(1) : "-"}
                </td>
                <td style={{ padding: "6px 4px", textAlign: "center", color: "#6b7280" }}>
                  {r.prev?.tailBp != null ? r.prev.tailBp.toFixed(1) : "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div style={{ fontSize: 11.5, color: bad ? "#dc2626" : "#374151" }}>
        {bad ? "▲ " : hasLatest ? "▼ " : ""}
        {interpretation}
      </div>

      <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 10 }}>
        데이터 출처: helious.io (무료, API 키 불필요). 양수(+)는 테일(수요 약함), 음수(-)는 스탑스루(수요 강함)를 의미합니다.
      </div>
    </div>
  );
}
