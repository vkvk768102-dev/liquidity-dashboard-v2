"use client";

import { useEffect, useState } from "react";
import IndicatorCard from "./IndicatorCard";

// 단위: 원본은 백만 달러 → 100으로 나누면 "억 달러"
function fmtEok(millions) {
  if (millions == null) return "-";
  const eok = millions / 100;
  const sign = eok >= 0 ? "" : "-";
  return `${sign}${Math.abs(eok).toLocaleString("ko-KR", { maximumFractionDigits: 0 })}억 달러`;
}
function fmtEokDiff(millions) {
  if (millions == null) return null;
  const eok = millions / 100;
  const sign = eok >= 0 ? "+" : "-";
  return `${sign}${Math.abs(eok).toLocaleString("ko-KR", { maximumFractionDigits: 0 })}억`;
}

export default function DealerTreasuryCard() {
  const [state, setState] = useState({ loading: true, error: null, data: null });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/pd-treasury", { cache: "no-store" });
        const data = await res.json();
        if (!res.ok || data.ok === false) {
          throw new Error(data.error || `요청 실패 (${res.status})`);
        }
        if (!cancelled) setState({ loading: false, error: null, data });
      } catch (e) {
        if (!cancelled) setState({ loading: false, error: e.message, data: null });
      }
    }

    load();
    const id = setInterval(load, 60 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const d = state.data;
  const changeUp = d?.change != null ? d.change > 0 : null;
  const interpretation =
    d?.change != null
      ? d.change > 0
        ? `국채 재고 증가(4주 전 대비 ${fmtEokDiff(d.change4w)}). 시장 소화 부담 주의`
        : d.change < 0
        ? `국채 재고 감소(4주 전 대비 ${fmtEokDiff(d.change4w)}). 시장에서 소화되는 중`
        : "전주 대비 변동 없음"
      : "";

  return (
    <IndicatorCard
      number={10}
      title="Dealer Treasury Inventory (국채 재고)"
      subtitle="프라이머리 딜러의 국채 순보유량 (TIPS 제외). 늘수록 국채가 딜러 창고에 쌓이고 있다는 뜻"
      loading={state.loading}
      error={state.error}
      latestDateLabel={d?.latestDate ?? "-"}
      valueLabel={fmtEok(d?.latestValue)}
      changeLabel={fmtEokDiff(d?.change)}
      changeIsUp={changeUp}
      sparklinePoints={
        d?.points?.map((p) => ({
          date: p.date,
          y: p.value,
          label: (p.value / 100).toLocaleString("ko-KR", { maximumFractionDigits: 0 }),
        })) ?? []
      }
      sparklineColor="#dc2626"
      interpretation={interpretation}
      interpretationBad={changeUp === true}
    />
  );
}
