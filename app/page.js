"use client";

import { useEffect, useState, useCallback } from "react";
import IndicatorCard from "./components/IndicatorCard";

function fmtManGyeyak(contracts) {
  // 계약 수 -> "만 계약" (1만 = 10,000)
  const man = contracts / 10000;
  const sign = man >= 0 ? "" : "-";
  return `${sign}${Math.abs(man).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}만 계약`;
}

function fmtManGyeyakDiff(contracts) {
  const man = contracts / 10000;
  const sign = man >= 0 ? "+" : "-";
  return `${sign}${Math.abs(man).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}만`;
}

async function fetchJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json();
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `요청 실패 (${res.status})`);
  }
  return data;
}

export default function Home() {
  const [dealer, setDealer] = useState({ loading: true, error: null, data: null });
  const [tff, setTff] = useState({ loading: true, error: null, data: null });
  const [lastRefreshed, setLastRefreshed] = useState(null);

  const load = useCallback(async () => {
    setDealer((s) => ({ ...s, loading: true, error: null }));
    setTff((s) => ({ ...s, loading: true, error: null }));

    try {
      const d = await fetchJson("/api/dealer-financing");
      setDealer({ loading: false, error: null, data: d });
    } catch (e) {
      setDealer({ loading: false, error: e.message, data: null });
    }

    try {
      const t = await fetchJson("/api/cftc-tff");
      setTff({ loading: false, error: null, data: t });
    } catch (e) {
      setTff({ loading: false, error: e.message, data: null });
    }

    setLastRefreshed(new Date());
  }, []);

  useEffect(() => {
    load();
    // 매일 확인하는 용도이므로 1시간마다 자동으로 최신 데이터를 다시 불러옵니다.
    const id = setInterval(load, 60 * 60 * 1000);
    return () => clearInterval(id);
  }, [load]);

  const dealerData = dealer.data;
  const dealerChangeUp = dealerData && dealerData.change != null ? dealerData.change > 0 : null;
  const dealerInterpretation =
    dealerData && dealerData.change != null
      ? dealerData.change > 0
        ? "레버리지 소폭 상승. 경계 필요"
        : dealerData.change < 0
        ? "레버리지 하락. 스트레스 완화"
        : "전주 대비 변동 없음"
      : "";

  const tffData = tff.data;
  const tffChangeUp = tffData && tffData.change != null ? tffData.change > 0 : null;
  const tffInterpretation =
    tffData && tffData.change != null
      ? tffData.change < 0
        ? "숏 포지션 확대(더 마이너스). 약세 심화"
        : tffData.change > 0
        ? "숏 포지션 축소. 약세 완화"
        : "전주 대비 변동 없음"
      : "";

  return (
    <main
      style={{
        maxWidth: 900,
        margin: "0 auto",
        padding: "20px 14px 40px",
      }}
    >
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 19, fontWeight: 800, margin: 0 }}>
          월가 유동성 스트레스 대시보드
        </h1>
        <p style={{ fontSize: 12.5, color: "#6b7280", margin: "6px 0 0" }}>
          딜러 파이낸싱 레버리지 · CFTC 국채선물 포지셔닝을 공개 데이터로 자동 갱신합니다.
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
          <button
            onClick={load}
            style={{
              fontSize: 12.5,
              padding: "6px 12px",
              borderRadius: 8,
              border: "1px solid #d1d5db",
              background: "#fff",
              cursor: "pointer",
            }}
          >
            지금 새로고침
          </button>
          {lastRefreshed && (
            <span style={{ fontSize: 11.5, color: "#9ca3af" }}>
              마지막 확인: {lastRefreshed.toLocaleString("ko-KR")}
            </span>
          )}
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
          gap: 14,
        }}
      >
        <IndicatorCard
          number={5}
          title="Dealer Financing (자금조달 레버리지)"
          subtitle="딜러의 자금조달 레버리지 지표 (프록시: 국채 레포 자금조달 ÷ 국채 순포지션)"
          loading={dealer.loading}
          error={dealer.error}
          latestDateLabel={dealerData?.latestDate ?? "-"}
          valueLabel={dealerData?.latestValue != null ? `${dealerData.latestValue.toFixed(2)}배` : "-"}
          changeLabel={dealerData?.change != null ? `${dealerData.change >= 0 ? "+" : ""}${dealerData.change.toFixed(2)}배` : null}
          changeIsUp={dealerChangeUp}
          sparklinePoints={
            dealerData?.points?.map((p) => ({
              date: p.date,
              y: p.ratio,
              label: p.ratio != null ? p.ratio.toFixed(2) : "-",
            })) ?? []
          }
          sparklineColor="#dc2626"
          interpretation={dealerInterpretation}
          interpretationBad={dealerChangeUp !== false}
        />

        <IndicatorCard
          number={6}
          title="CFTC TFF Positioning (10년물)"
          subtitle="레버리지드펀드 10년물 국채선물 순포지션 (계약 수)"
          loading={tff.loading}
          error={tff.error}
          latestDateLabel={tffData?.latestDate ?? "-"}
          valueLabel={tffData?.latestValue != null ? fmtManGyeyak(tffData.latestValue) : "-"}
          changeLabel={tffData?.change != null ? fmtManGyeyakDiff(tffData.change) : null}
          changeIsUp={tffChangeUp}
          sparklinePoints={
            tffData?.points?.map((p) => ({
              date: p.date,
              y: p.value,
              label: (p.value / 10000).toLocaleString("ko-KR", { maximumFractionDigits: 1 }),
            })) ?? []
          }
          sparklineColor="#16a34a"
          interpretation={tffInterpretation}
          interpretationBad={tffChangeUp === false || tffChangeUp === null ? true : false}
        />
      </div>

      <p style={{ fontSize: 11, color: "#9ca3af", marginTop: 18, lineHeight: 1.6 }}>
        * 데이터 출처: NY Fed Primary Dealer Statistics (공식 API), CFTC Traders in Financial
        Futures (공식 API, publicreporting.cftc.gov). 별도 API 키 불필요.
        <br />
        * &quot;레버리지 배수&quot;는 공식 발표 지표가 아니라 &quot;국채 레포 자금조달 ÷ 딜러
        국채 순포지션&quot;으로 계산한 프록시(근사) 지표입니다.
      </p>
    </main>
  );
}
