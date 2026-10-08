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
const BTC_GAP = 0.05; // 응찰률이 직전 6회 평균보다 이만큼 높으면 "강함", 낮으면 "약함"
const fmtMd = (d) => (d ? d.slice(5).replace("-", "/") : "-");
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
  const rows = TENORS.map(({ key, label, long }) => {
    const latest = data?.[key]?.latest ?? null;
    const btc = latest?.bidToCover ?? null;
    const btcAvg = data?.[key]?.btcAvg ?? null;
    // 응찰률이 직전 6회 평균보다 얼마나 높은지(+) 낮은지(-)
    const btcDiff = btc != null && btcAvg != null ? Math.round((btc - btcAvg) * 100) / 100 : null;
    return { key, label, long, latest, prev: data?.[key]?.prev ?? null, btc, btcAvg, btcDiff };
  });

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

  // 응찰률 (Bid-to-Cover): 직전 6회 평균과 비교
  const btcLive = live.filter((r) => r.btcDiff != null);
  const btcStrong = btcLive.filter((r) => r.btcDiff >= BTC_GAP);
  const btcWeak = btcLive.filter((r) => r.btcDiff <= -BTC_GAP);
  // 가장 최근에 열린 입찰
  const newest = live.length ? [...live].sort((a, b) => (a.latest.date < b.latest.date ? 1 : -1))[0] : null;

  if (!state.error && btcLive.length) {
    extra.push(`응찰률: 평균보다 높음 ${joinLabels(btcStrong) || "없음"} / 낮음 ${joinLabels(btcWeak) || "없음"}`);
  }

  // 주식시장과 연결한 해석: 테일과 응찰률을 함께 봄
  const demandStrong = live.filter((r) => r.latest.tailBp < WEAK_BP && r.btcDiff != null && r.btcDiff >= BTC_GAP);
  const demandWeak = live.filter((r) => r.latest.tailBp >= WEAK_BP || (r.btcDiff != null && r.btcDiff <= -BTC_GAP));
  let stock = null;
  if (!state.error && hasLatest && btcLive.length) {
    if (demandStrong.length && !demandWeak.length) {
      stock = {
        color: "#16a34a",
        head: `국채가 잘 팔리는 중 (${joinLabels(demandStrong)})`,
        lines: [
          "장기금리가 급등할 위험이 줄어 주식, 특히 성장주·기술주의 금리 부담이 완화됩니다.",
          "단, 주가가 빠지는 날 국채가 잘 팔렸다면 안전자산으로 피신한 것일 수 있으니 주가 방향과 함께 보세요.",
        ],
      };
    } else if (demandWeak.length && !demandStrong.length) {
      stock = {
        color: "#dc2626",
        head: `국채가 잘 안 팔리는 중 (${joinLabels(demandWeak)})`,
        lines: [
          "금리를 더 줘야 팔리므로 장기금리 상승 압력이 생깁니다.",
          "주식 할인율이 올라 성장주·고PER주에 부담입니다.",
        ],
      };
    } else if (demandStrong.length && demandWeak.length) {
      const newestStrong = newest && demandStrong.some((r) => r.key === newest.key);
      const newestWeak = newest && demandWeak.some((r) => r.key === newest.key);
      stock = {
        color: "#d97706",
        head: `만기별로 엇갈림: 잘 팔림 ${joinLabels(demandStrong)} / 부진 ${joinLabels(demandWeak)}`,
        lines: [
          newestStrong
            ? `가장 최근 입찰(${newest.label})이 강해 수요가 회복되는 흐름일 수 있습니다. 주식의 금리 부담은 다소 완화.`
            : newestWeak
            ? `가장 최근 입찰(${newest.label})이 부진해 금리 상승 압력이 남아 있습니다. 주식에는 부담.`
            : "금리 방향에 주는 신호가 뚜렷하지 않습니다. 주식에는 중립.",
          "다음 입찰에서도 같은 방향이 이어지는지 확인하세요.",
        ],
      };
    } else {
      stock = {
        color: "#374151",
        head: "응찰률·테일 모두 평소 수준",
        lines: ["국채 수요가 주식시장에 주는 금리 신호는 중립입니다."],
      };
    }
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
        국채 입찰 테일 (낙찰금리 − 입찰 직전 시장금리)과 응찰률 (응찰액 ÷ 발행액). 매월 2·5·10·20·30년물 경매 결과를 자동으로 반영합니다.
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
              <th style={{ padding: "6px 4px", textAlign: "center" }}>응찰률 (배)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} style={{ borderBottom: "1px solid #e5e7eb" }}>
                <td style={{ padding: "6px 4px", textAlign: "center", fontWeight: 600, whiteSpace: "nowrap" }}>{r.label}</td>
                <td style={{ padding: "6px 4px", textAlign: "center", whiteSpace: "nowrap" }}>{r.latest?.date ?? "-"}</td>
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
                <td style={{ padding: "6px 4px", textAlign: "center", lineHeight: 1.25 }}>
                  <div
                    style={{
                      fontWeight: 700,
                      color:
                        r.btcDiff == null
                          ? "#111827"
                          : r.btcDiff >= BTC_GAP
                          ? "#16a34a"
                          : r.btcDiff <= -BTC_GAP
                          ? "#dc2626"
                          : "#111827",
                    }}
                  >
                    {r.btc != null ? r.btc.toFixed(2) : "-"}
                  </div>
                  {r.btcAvg != null && (
                    <div style={{ fontSize: 10, color: "#9ca3af", whiteSpace: "nowrap" }}>평균 {r.btcAvg.toFixed(2)}</div>
                  )}
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

      {stock && (
        <div style={{ background: "#f9fafb", borderRadius: 10, padding: "10px 12px", fontSize: 12, lineHeight: 1.55, marginTop: 8 }}>
          <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 4 }}>주식시장과 연결해 보면</div>
          <div style={{ color: stock.color, fontWeight: 700 }}>{stock.head}</div>
          {newest && newest.btc != null && (
            <div style={{ color: "#374151", marginTop: 3 }}>
              · 가장 최근 입찰 {newest.label}({fmtMd(newest.latest.date)}): 응찰률 {newest.btc.toFixed(2)}배
              {newest.btcAvg != null ? ` (평균 ${newest.btcAvg.toFixed(2)}배)` : ""}, 테일 {newest.latest.tailBp.toFixed(1)}bp
              {newest.latest.highYield != null ? `, 낙찰금리 ${newest.latest.highYield.toFixed(2)}%` : ""}
            </div>
          )}
          {stock.lines.map((line) => (
            <div key={line} style={{ color: "#374151", marginTop: 3 }}>
              · {line}
            </div>
          ))}
          <div style={{ color: "#6b7280", marginTop: 3 }}>
            · 응찰률이 높다는 건 &quot;그 금리면 사겠다&quot;는 수요가 많다는 뜻입니다. 낙찰금리 자체가 높으면 주식 부담은 남습니다.
          </div>
        </div>
      )}

      <div style={{ fontSize: 10.5, color: "#6b7280", marginTop: 8 }}>
        1bp 이상 테일이 1개면 주의, 3개 이상(또는 2bp 이상 2개)이면 경계. 응찰률은 직전 6회 평균보다 0.05배 이상 높으면 초록, 낮으면 빨강.
      </div>

      <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 10 }}>
        데이터 출처: helious.io (무료, API 키 불필요). 양수(+)는 테일(수요 약함), 음수(-)는 스탑스루(수요 강함)를 의미합니다.
      </div>
    </div>
  );
}
