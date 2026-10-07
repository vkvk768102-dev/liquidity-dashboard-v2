// 파일 위치: app/components/TreasuryAuctionTailCard.js
"use client";

import { useEffect, useState } from "react";

const TENORS = [
  { key: "2Y", label: "2년물", long: false },
  { key: "5Y", label: "5년물", long: false },
  { key: "10Y", label: "10년물", long: true },
  { key: "20Y", label: "20년물", long: true },
  { key: "30Y", label: "30년물", long: true },
];

const WEAK_BP = 1.0; // 테일이 이 이상이면 "수요 약함"
const BIG_BP = 2.0; // 이 이상이면 "수요 부진"
const LEVEL = {
  ok: { label: "정상", color: "#16a34a" },
  watch: { label: "주의", color: "#d97706" },
  bad: { label: "경계", color: "#dc2626" },
};

const joinLabels = (list) => list.map((r) => r.label).join("·");

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
  const rows = TENORS.map(({ key, label, long }) => ({
    key,
    label,
    long,
    latest: data?.[key]?.latest ?? null,
    prev: data?.[key]?.prev ?? null,
  }));

  const live = rows.filter((r) => r.latest?.tailBp != null);
  const hasLatest = live.length > 0;

  // 종합 해석
  const weak = live.filter((r) => r.latest.tailBp >= WEAK_BP);
  const big = live.filter((r) => r.latest.tailBp >= BIG_BP);
  const withPrev = live.filter((r) => r.prev?.tailBp != null);
  const widened = withPrev.filter((r) => r.latest.tailBp - r.prev.tailBp >= 0.05);
  const narrowed = withPrev.filter((r) => r.prev.tailBp - r.latest.tailBp >= 0.05);

  let level = "ok";
  let interpretation = "데이터를 불러오는 중입니다";
  let extra = [];

  if (state.error) {
    interpretation = `데이터를 가져오지 못했습니다 (${state.error})`;
  } else if (hasLatest) {
    level = big.length >= 2 || weak.length >= 3 ? "bad" : weak.length >= 1 ? "watch" : "ok";
    const weakLong = weak.filter((r) => r.long);
    if (level === "ok") {
      interpretation = `${live.length}개 만기 모두 테일 ${WEAK_BP}bp 미만. 국채 수요 양호`;
    } else if (level === "watch") {
      interpretation = `${joinLabels(weak)}에서 테일. 해당 만기 수요 약함`;
    } else {
      interpretation = `여러 만기(${joinLabels(weak)})에서 테일. 국채 수요 전반 약함`;
    }
    if (weakLong.length) extra.push(`장기물(${joinLabels(weakLong)}) 약세 → 장기금리 상승 압력, 성장주 부담`);
    else if (weak.length) extra.push("단기·중기물 약세 → 물량 부담이나 금리 인하 기대 약화일 수 있음");
    if (withPrev.length) extra.push(`직전 입찰 대비 테일 확대 ${widened.length}개, 축소 ${narrowed.length}개`);
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
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>7. Treasury Auction Tail (2·5·10·20·30년물)</div>
        <span style={{ fontSize: 10.5, color: "#9ca3af", whiteSpace: "nowrap", flexShrink: 0 }}>자동 갱신</span>
      </div>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: "#b45309", marginTop: 6, lineHeight: 1.4 }}>
        시장 예상보다 얼마나 비싸게 받아들이는가?
      </div>
      <div style={{ fontSize: 11.5, color: "#6b7280", margin: "4px 0 12px" }}>
        국채 입찰 테일 (낙찰금리 − 입찰 직전 시장금리). 매월 2·5·10·20·30년물 경매 결과를 자동으로 반영합니다.
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
                    color:
                      r.latest?.tailBp == null
                        ? "#111827"
                        : r.latest.tailBp < 0
                        ? "#16a34a"
                        : r.latest.tailBp >= WEAK_BP
                        ? "#dc2626"
                        : "#111827",
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

      <div style={{ background: "#f9fafb", borderRadius: 10, padding: "10px 12px", fontSize: 12, lineHeight: 1.55 }}>
        <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 4 }}>종합 해석</div>
        <div style={{ color: hasLatest && !state.error ? LEVEL[level].color : state.error ? "#dc2626" : "#374151", fontWeight: 700 }}>
          {hasLatest && !state.error ? `[${LEVEL[level].label}] ` : ""}
          {interpretation}
        </div>
        {extra.map((line) => (
          <div key={line} style={{ color: "#374151", marginTop: 3 }}>
            · {line}
          </div>
        ))}
      </div>

      <div style={{ fontSize: 10.5, color: "#6b7280", marginTop: 8 }}>
        1bp 이상 테일이 1개면 주의, 3개 이상(또는 2bp 이상 2개)이면 경계.
      </div>

      <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 10 }}>
        데이터 출처: helious.io (무료, API 키 불필요). 양수(+)는 테일(수요 약함), 음수(-)는 스탑스루(수요 강함)를 의미합니다.
      </div>
    </div>
  );
}
