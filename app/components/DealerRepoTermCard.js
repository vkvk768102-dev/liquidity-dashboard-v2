"use client";

import { useEffect, useState } from "react";
import IndicatorCard from "./IndicatorCard";

// 하루짜리 비중이 이 값(%p) 이상 변하면 "증가/감소"로 해석 (작은 흔들림은 무시)
const CHANGE_THRESHOLD = 0.5;

function fmtPctDiff(v) {
  if (v == null) return null;
  const sign = v >= 0 ? "+" : "-";
  return `${sign}${Math.abs(v).toFixed(1)}%p`;
}

export default function DealerRepoTermCard() {
  const [state, setState] = useState({ loading: true, error: null, data: null });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/pd-repo-term", { cache: "no-store" });
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
  const change = d?.change ?? null;
  const changeUp = change != null ? change > 0 : null;

  let interpretation = "";
  let bad = false;
  if (d && change != null) {
    const b = d.breakdown;
    const detail = `(30일 미만 ${b.under30.toFixed(1)}% · 30일 이상 ${b.over30.toFixed(1)}%)`;
    if (change >= CHANGE_THRESHOLD) {
      interpretation = `하루짜리 비중 증가. 조달이 단기화되는 중, 주의 ${detail}`;
      bad = true;
    } else if (change <= -CHANGE_THRESHOLD) {
      interpretation = `하루짜리 비중 감소. 조달이 장기화되어 안정적 ${detail}`;
    } else {
      interpretation = `비중 큰 변화 없음. 안정적 ${detail}`;
    }
  }

  return (
    <IndicatorCard
      number={11}
      title="Dealer Repo Term (레포 만기 구성)"
      subtitle="딜러 국채 레포 자금조달 중 하루짜리(자동연장 포함) 비중. 높아질수록 매일 새로 빌려야 하는 부담이 커짐"
      loading={state.loading}
      error={state.error}
      latestDateLabel={d?.latestDate ?? "-"}
      valueLabel={d?.latestValue != null ? `${d.latestValue.toFixed(1)}%` : "-"}
      changeLabel={fmtPctDiff(change)}
      changeIsUp={changeUp}
      sparklinePoints={
        d?.points?.map((p) => ({
          date: p.date,
          y: p.value,
          label: p.value.toFixed(1),
        })) ?? []
      }
      sparklineColor="#dc2626"
      interpretation={interpretation}
      interpretationBad={bad}
    />
  );
}
