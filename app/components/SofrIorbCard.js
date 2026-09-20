"use client";

import { useEffect, useState } from "react";
import IndicatorCard from "./IndicatorCard";

// bp = 0.01%p. "경색" 기준은 연준 천장(상시 레포 금리)과 IORB의 간격으로 자동 계산되고,
// "주의" 기준은 그 절반입니다(공식 기준이 아니라 경험칙). 간격을 못 받으면 10bp로 계산합니다.
const DEFAULT_GAP_BP = 10;

function fmtBp(v) {
  if (v == null) return "-";
  const sign = v > 0 ? "+" : v < 0 ? "-" : "";
  return `${sign}${Math.abs(v)}bp`;
}
function fmtBpDiff(v) {
  if (v == null) return null;
  const sign = v >= 0 ? "+" : "-";
  return `${sign}${Math.abs(v)}bp`;
}

export default function SofrIorbCard() {
  const [state, setState] = useState({ loading: true, error: null, data: null });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/sofr-iorb", { cache: "no-store" });
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
  const spread = d?.latestValue ?? null;
  const prevSpread = d?.points && d.points.length > 1 ? d.points[d.points.length - 2].value : null;
  const changeUp = d?.change != null ? d.change > 0 : null;

  const stressBp = d?.gapBp ?? DEFAULT_GAP_BP;
  const warnBp = Math.max(1, Math.round(stressBp / 2));

  let interpretation = "";
  let bad = false;
  if (d && spread != null) {
    const tgcrPart = d.tgcr != null ? ` · TGCR ${d.tgcr.toFixed(2)}% ${fmtBp(d.tgcrBp)}` : "";
    const ceilPart =
      d.ceiling != null ? ` · 천장(${d.ceilingSource || "상시 레포"}) ${d.ceiling.toFixed(2)}%` : "";
    const rates = `(SOFR ${d.sofr.toFixed(2)}% ${fmtBp(d.sofrBp)}${tgcrPart} · IORB ${d.iorb.toFixed(2)}%${ceilPart})`;
    if (spread >= stressBp) {
      interpretation = `경색 수준. 연준 천장 금리(상시 레포) 부근까지 상승 ${rates}`;
      bad = true;
    } else if (spread >= warnBp) {
      interpretation =
        prevSpread != null && prevSpread >= warnBp
          ? `주의. IORB 위 상승이 이틀 이상 이어짐 ${rates}`
          : `주의. IORB 위로 상승 (하루 튐일 수 있음: 월말·국채 결제일 확인) ${rates}`;
      bad = true;
    } else if (spread > 0) {
      interpretation = `정상 범위. IORB보다 소폭 높음 ${rates}`;
    } else {
      interpretation = `정상. IORB 이하 ${rates}`;
    }
  }

  return (
    <IndicatorCard
      number={12}
      title="SOFR·TGCR − IORB (연준 정책금리 대비)"
      subtitle="SOFR과 TGCR 중 더 높은 쪽이 연준 지급금리(IORB)보다 얼마나 높은지. 0 이하면 정상, 위로 벌어질수록 자금 압박. 경색 기준은 연준 상시 레포 금리와 IORB의 간격으로 자동 계산"
      loading={state.loading}
      error={state.error}
      latestDateLabel={d?.latestDate ?? "-"}
      valueLabel={fmtBp(spread)}
      changeLabel={fmtBpDiff(d?.change)}
      changeIsUp={changeUp}
      sparklinePoints={
        d?.points?.map((p) => ({
          date: p.date,
          y: p.value,
          label: String(p.value),
        })) ?? []
      }
      sparklineColor="#dc2626"
      interpretation={interpretation}
      interpretationBad={bad}
    />
  );
}
