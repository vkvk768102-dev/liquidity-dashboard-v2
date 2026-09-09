"use client";

import { useEffect, useState, useCallback } from "react";
import IndicatorCard from "./components/IndicatorCard";

function fmtManGyeyak(contracts) {
  const man = contracts / 10000;
  const sign = man >= 0 ? "" : "-";
  return `${sign}${Math.abs(man).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}만 계약`;
}

function fmtManGyeyakDiff(contracts) {
  const man = contracts / 10000;
  const sign = man >= 0 ? "+" : "-";
  return `${sign}${Math.abs(man).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}만`;
}

function fmtPct(v) {
  if (v == null) return "-";
  return `${v.toFixed(2)}%`;
}
function fmtPctDiff(v) {
  if (v == null) return null;
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%p`;
}
function fmtPctP(v) {
  if (v == null) return "-";
  return `${v >= 0 ? "" : "-"}${Math.abs(v).toFixed(2)}%p`;
}
function fmtPctPDiff(v) {
  if (v == null) return null;
  return `${v >= 0 ? "+" : "-"}${Math.abs(v).toFixed(2)}%p`;
}
function fmtEokFromMillions(millions) {
  if (millions == null) return "-";
  const eok = millions / 100; // 백만달러 -> 억달러
  const sign = eok >= 0 ? "" : "-";
  return `${sign}${Math.abs(eok).toLocaleString("ko-KR", { maximumFractionDigits: 0 })}억 달러`;
}
function fmtEokFromMillionsDiff(millions) {
  if (millions == null) return null;
  const eok = millions / 100;
  const sign = eok >= 0 ? "+" : "-";
  return `${sign}${Math.abs(eok).toLocaleString("ko-KR", { maximumFractionDigits: 0 })}억`;
}

async function fetchJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json();
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `요청 실패 (${res.status})`);
  }
  return data;
}

const EMPTY = { loading: true, error: null, data: null };

export default function Home() {
  const [sofr, setSofr] = useState(EMPTY);
  const [basis, setBasis] = useState(EMPTY);
  const [pdbs, setPdbs] = useState(EMPTY);
  const [dealer, setDealer] = useState(EMPTY);
  const [tff, setTff] = useState(EMPTY);
  const [lastRefreshed, setLastRefreshed] = useState(null);

  const load = useCallback(async () => {
    setSofr((s) => ({ ...s, loading: true, error: null }));
    setBasis((s) => ({ ...s, loading: true, error: null }));
    setPdbs((s) => ({ ...s, loading: true, error: null }));
    setDealer((s) => ({ ...s, loading: true, error: null }));
    setTff((s) => ({ ...s, loading: true, error: null }));

    const jobs = [
      ["repo-rate", setSofr],
      ["repo-basis", setBasis],
      ["pd-balance-sheet", setPdbs],
      ["dealer-financing", setDealer],
      ["cftc-tff", setTff],
    ];

    await Promise.all(
      jobs.map(async ([path, setter]) => {
        try {
          const d = await fetchJson(`/api/${path}`);
          setter({ loading: false, error: null, data: d });
        } catch (e) {
          setter({ loading: false, error: e.message, data: null });
        }
      })
    );

    setLastRefreshed(new Date());
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 60 * 60 * 1000);
    return () => clearInterval(id);
  }, [load]);

  const sofrData = sofr.data;
  const sofrChangeUp = sofrData?.change != null ? sofrData.change > 0 : null;
  const sofrInterp =
    sofrData?.change != null
      ? Math.abs(sofrData.change) < 0.05
        ? "안정적. 단기 자금시장 긴장 낮음"
        : sofrData.change > 0
        ? "금리 상승. 단기 자금조달 부담 증가"
        : "금리 하락. 단기 자금시장 완화"
      : "";

  const basisData = basis.data;
  const basisChangeUp = basisData?.change != null ? basisData.change > 0 : null;
  const basisInterp =
    basisData?.latestValue != null
      ? Math.abs(basisData.latestValue) <= 0.1
        ? "정상 범위(0~0.10%p). 스트레스 낮음"
        : "정상 범위 이탈. 레포시장 스트레스 주의"
      : "";

  const pdbsData = pdbs.data;
  const pdbsChangeUp = pdbsData?.changeTotal != null ? pdbsData.changeTotal > 0 : null;
  const pdbsInterp =
    pdbsData?.changeTotal != null
      ? pdbsData.changeTotal < 0
        ? "감소 추세. 딜러의 흡수 여력 소폭 축소"
        : "증가 추세. 딜러의 흡수 여력 확대"
      : "";

  const dealerData = dealer.data;
  const dealerChangeUp = dealerData?.change != null ? dealerData.change > 0 : null;
  const dealerInterpretation =
    dealerData?.change != null
      ? dealerData.change > 0
        ? "레버리지 소폭 상승. 경계 필요"
        : dealerData.change < 0
        ? "레버리지 하락. 스트레스 완화"
        : "전주 대비 변동 없음"
      : "";

  const tffData = tff.data;
  const tffChangeUp = tffData?.change != null ? tffData.change > 0 : null;
  const tffInterpretation =
    tffData?.change != null
      ? tffData.change < 0
        ? "숏 포지션 확대(더 마이너스). 약세 심화"
        : tffData.change > 0
        ? "숏 포지션 축소. 약세 완화"
        : "전주 대비 변동 없음"
      : "";

  const gridStyle = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
    gap: 14,
  };

  return (
    <main style={{ maxWidth: 1200, margin: "0 auto", padding: "20px 14px 40px" }}>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 19, fontWeight: 800, margin: 0 }}>
          월가 유동성 스트레스 대시보드
        </h1>
        <p style={{ fontSize: 12.5, color: "#6b7280", margin: "6px 0 0" }}>
          단기 자금시장 금리 · 딜러 레버리지 · CFTC 국채선물 포지셔닝을 공개 데이터로 자동 갱신합니다.
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
          <button
            onClick={load}
            style={{ fontSize: 12.5, padding: "6px 12px", borderRadius: 8, border: "1px solid #d1d5db", background: "#fff", cursor: "pointer" }}
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

      <div style={{ ...gridStyle, marginBottom: 14 }}>
        <IndicatorCard
          number={1}
          title="Repo Rate (SOFR)"
          subtitle="무위험 단기 자금시장의 실제 조달금리"
          loading={sofr.loading}
          error={sofr.error}
          latestDateLabel={sofrData?.latestDate ?? "-"}
          valueLabel={fmtPct(sofrData?.latestValue)}
          changeLabel={fmtPctDiff(sofrData?.change)}
          changeIsUp={sofrChangeUp}
          sparklinePoints={
            sofrData?.points?.map((p) => ({ date: p.date, y: p.value, label: p.value.toFixed(2) })) ?? []
          }
          sparklineColor="#16a34a"
          interpretation={sofrInterp}
          interpretationBad={sofrChangeUp === true}
        />

        <IndicatorCard
          number={2}
          title="Repo Basis (GC-SOFR 스프레드)"
          subtitle="레포시장 스트레스 지표"
          loading={basis.loading}
          error={basis.error}
          latestDateLabel={basisData?.latestDate ?? "-"}
          valueLabel={fmtPctP(basisData?.latestValue)}
          changeLabel={fmtPctPDiff(basisData?.change)}
          changeIsUp={basisChangeUp}
          sparklinePoints={
            basisData?.points?.map((p) => ({ date: p.date, y: p.value, label: p.value.toFixed(2) })) ?? []
          }
          sparklineColor="#16a34a"
          interpretation={basisInterp}
          interpretationBad={basisData?.latestValue != null && Math.abs(basisData.latestValue) > 0.1}
        />

        <IndicatorCard
          number={4}
          title="Primary Dealer Balance Sheet"
          subtitle="프라이머리 딜러(증권사) 보유 자산 (근사치, 국채 포함 5개 자산군 합계)"
          loading={pdbs.loading}
          error={pdbs.error}
          latestDateLabel={pdbsData?.latestDate ?? "-"}
          valueLabel={fmtEokFromMillions(pdbsData?.latestTotal)}
          changeLabel={fmtEokFromMillionsDiff(pdbsData?.changeTotal)}
          changeIsUp={pdbsChangeUp}
          sparklinePoints={
            pdbsData?.points
              ?.filter((p) => p.total != null)
              .map((p) => ({
                date: p.date,
                y: p.total,
                label: (p.total / 100).toLocaleString("ko-KR", { maximumFractionDigits: 0 }),
              })) ?? []
          }
          sparklineColor="#2563eb"
          interpretation={pdbsInterp}
          interpretationBad={pdbsChangeUp === false}
        />
      </div>

      <div style={gridStyle}>
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
        * 데이터 출처: NY Fed 공식 Markets Data API (SOFR/TGCR 금리, Primary Dealer 통계),
        CFTC 공식 API (publicreporting.cftc.gov). 별도 API 키 불필요.
        <br />
        * &quot;레버리지 배수&quot;와 &quot;프라이머리 딜러 총자산&quot;은 공식 발표 지표가
        아니라 공개 데이터를 조합해 계산한 프록시(근사) 지표입니다.
      </p>
    </main>
  );
}
