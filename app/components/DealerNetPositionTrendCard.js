"use client";

import { useEffect, useState } from "react";

// 16번 카드: 프라이머리 딜러 국채 순포지션의 "몇 달간 추세"
// - 10번 카드와 같은 숫자(PDPOSGST-TOT)지만 보는 관점이 다름
//   10번: 재고 부담 (늘면 주의)  /  16번: 딜러가 시장을 떠받칠 의지 (몇 달째 줄면 주의)
// - 단위: API는 백만 달러 → 화면은 억 달러

const NAVY = "#1e3a8a";
const WEEKLY = "#9ca3af";
const RED = "#dc2626";
const GREEN = "#16a34a";
const NEUTRAL = "#374151";

function eok(m) {
  return m / 100;
}
function fmtEokDiff(m) {
  if (m == null) return null;
  const v = eok(m);
  return `${v >= 0 ? "+" : "-"}${Math.abs(v).toLocaleString("ko-KR", { maximumFractionDigits: 0 })}억`;
}
function fmtPct(v) {
  if (v == null) return "-";
  return `${v >= 0 ? "+" : "-"}${Math.abs(v).toFixed(1)}%`;
}
function monthOf(d) {
  return d ? Number(d.split("-")[1]) : null;
}

function CompareBox({ label, sub, pct, diff, downPct, upPct }) {
  const color = pct == null ? NEUTRAL : pct <= downPct ? RED : pct >= upPct ? GREEN : NEUTRAL;
  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: "10px 8px", textAlign: "center" }}>
      <div style={{ fontSize: 12, color: "#374151", fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 10.5, color: "#9ca3af" }}>{sub}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color, margin: "4px 0 2px", whiteSpace: "nowrap" }}>
        {fmtPct(pct)}
      </div>
      <div style={{ fontSize: 11.5, color: "#6b7280", fontWeight: 600 }}>
        {diff == null ? "데이터 부족" : `(${fmtEokDiff(diff)} 달러)`}
      </div>
    </div>
  );
}

function TrendChart({ points }) {
  if (!points || points.length < 2) return null;
  const w = 320;
  const h = 150;
  const left = 44;
  const right = 14;
  const top = 20;
  const bottom = 22;
  const len = points.length;

  const vals = points.flatMap((p) => [p.value, p.ma4]).filter((v) => v != null).map(eok);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const raw = (max - min || 1) / 3;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) || pow;
  const minT = Math.floor(min / step) * step;
  const maxT = Math.ceil(max / step) * step || minT + step;
  const ticks = [];
  for (let v = minT; v <= maxT + step / 2; v += step) ticks.push(v);

  const stepX = (w - left - right) / Math.max(len - 1, 1);
  const xAt = (i) => left + i * stepX;
  const yAt = (v) => top + (1 - (v - minT) / (maxT - minT || 1)) * (h - top - bottom);
  const path = (key) =>
    points
      .map((p, i) => (p[key] == null ? null : `${xAt(i)} ${yAt(eok(p[key]))}`))
      .filter(Boolean)
      .map((s, i) => `${i === 0 ? "M" : "L"} ${s}`)
      .join(" ");

  // 비교하는 두 구간(최근 4주, 3개월 전 4주)을 옅은 띠로 표시
  const band = (i0, i1) => {
    const x0 = Math.max(xAt(i0) - stepX / 2, left);
    const x1 = Math.min(xAt(i1) + stepX / 2, w - right);
    return { x: x0, width: x1 - x0, mid: (x0 + x1) / 2 };
  };
  const recentBand = len >= 4 ? band(len - 4, len - 1) : null;
  const oldBand = len >= 17 ? band(len - 17, len - 14) : null;

  const last = points[len - 1];

  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} style={{ display: "block" }}>
      {[oldBand, recentBand].map(
        (b, i) =>
          b && (
            <g key={i}>
              <rect x={b.x} y={top - 6} width={b.width} height={h - top - bottom + 6} fill="#eef2ff" />
              <text x={b.mid} y={top - 9} fontSize="9.5" fill={NAVY} textAnchor="middle" fontWeight="600">
                {i === 0 ? "3개월 전" : "최근 4주"}
              </text>
            </g>
          )
      )}
      {ticks.map((t) => (
        <g key={t}>
          <line x1={left} x2={w - right} y1={yAt(t)} y2={yAt(t)} stroke="#e5e7eb" />
          <text x={left - 6} y={yAt(t) + 3.5} fontSize="10" fill="#6b7280" textAnchor="end">
            {t.toLocaleString("ko-KR")}
          </text>
        </g>
      ))}
      <path d={path("value")} fill="none" stroke={WEEKLY} strokeWidth="1.5" />
      <path d={path("ma4")} fill="none" stroke={NAVY} strokeWidth="2.5" />
      {last.ma4 != null && <circle cx={xAt(len - 1)} cy={yAt(eok(last.ma4))} r="3.5" fill={NAVY} />}
      {points.map((p, i) =>
        i > 0 && monthOf(p.date) !== monthOf(points[i - 1].date) ? (
          <text key={p.date} x={xAt(i)} y={h - 5} fontSize="10" fill="#374151" textAnchor="middle">
            {monthOf(p.date)}월
          </text>
        ) : null
      )}
    </svg>
  );
}

export default function DealerNetPositionTrendCard() {
  const [state, setState] = useState({ loading: true, error: null, data: null });

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/pd-net-position", { cache: "no-store" });
        const d = await res.json();
        if (!res.ok || d.ok === false) throw new Error(d.error || `요청 실패 (${res.status})`);
        if (alive) setState({ loading: false, error: null, data: d });
      } catch (e) {
        if (alive) setState({ loading: false, error: e.message, data: null });
      }
    };
    load();
    const id = setInterval(load, 60 * 60 * 1000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const { loading, error, data } = state;
  const trend = data?.trend;
  const bad = trend === "down" || trend === "down-sustained";
  const p3 = data?.pct3m != null ? Math.abs(data.pct3m).toFixed(1) : null;
  const band = data ? Math.abs(data.downPct) : 10;
  const interpretation =
    trend === "down-sustained"
      ? `3개월 전보다 ${p3}% 줄었고, 6개월 전부터 계속 감소 중. 딜러가 국채 보유를 줄이는 추세 → 시장이 얇아지는 신호`
      : trend === "down"
      ? `3개월 전보다 ${p3}% 감소. 딜러가 발을 빼기 시작했는지 주의`
      : trend === "up"
      ? `3개월 전보다 ${p3}% 증가. 딜러가 국채를 받아주고 있음 (정상)`
      : trend === "flat"
      ? `3개월 전과 비슷한 수준 유지 (±${band}% 이내). 딜러가 아직 시장을 떠받치는 중 (정상)`
      : "3개월 비교에 필요한 데이터가 아직 부족합니다";
  const arrow = trend === "up" ? "▲" : bad ? "▼" : "■";

  return (
    <div
      style={{
        background: "#fff",
        borderRadius: 14,
        overflow: "hidden",
        boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ background: NAVY, color: "#fff", padding: "12px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              background: "#fff",
              color: NAVY,
              borderRadius: "50%",
              width: 22,
              height: 22,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 13,
              fontWeight: 700,
              flexShrink: 0,
            }}
          >
            16
          </span>
          <span style={{ fontWeight: 700, fontSize: 15 }}>Dealer Net Position 추세 (국채 순포지션)</span>
        </div>
        <div style={{ fontSize: 12.5, opacity: 0.85, marginTop: 4 }}>
          딜러가 실제로 들고 있는 국채 위험(순포지션)이 최근 몇 달간 줄어드는지. 숫자 크기가 아니라 방향을 봅니다
        </div>
      </div>

      <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
        {loading && <div style={{ color: "#6b7280", fontSize: 13 }}>불러오는 중...</div>}
        {error && !loading && (
          <div style={{ color: RED, fontSize: 12.5, lineHeight: 1.5 }}>
            데이터를 불러오지 못했습니다.
            <br />
            <span style={{ color: "#9ca3af" }}>{error}</span>
          </div>
        )}

        {!loading && !error && data && (
          <>
            <div
              style={{
                background: "#f9fafb",
                border: "1px solid #eef0f2",
                borderRadius: 10,
                padding: "10px 12px",
              }}
            >
              <div style={{ fontSize: 11.5, color: "#6b7280", marginBottom: 4 }}>
                최신 순포지션 ({data.latestDate})
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 22, fontWeight: 800 }}>
                  {eok(data.latestValue).toLocaleString("ko-KR", { maximumFractionDigits: 0 })}억 달러
                </span>
                <span style={{ fontSize: 12.5, color: "#6b7280", fontWeight: 600 }}>
                  (전주 대비 {fmtEokDiff(data.change)})
                </span>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <CompareBox
                label="3개월 전 대비"
                sub="4주 평균끼리 비교"
                pct={data.pct3m}
                diff={data.diff3m}
                downPct={data.downPct}
                upPct={data.upPct}
              />
              <CompareBox
                label="6개월 전 대비"
                sub="4주 평균끼리 비교"
                pct={data.pct6m}
                diff={data.diff6m}
                downPct={data.downPct}
                upPct={data.upPct}
              />
            </div>

            <div>
              <div style={{ fontSize: 12, color: "#374151", fontWeight: 600, marginBottom: 4 }}>
                최근 {data.points.length}주 추이 (억 달러)
              </div>
              <TrendChart points={data.points} />
              <div style={{ display: "flex", gap: 12, fontSize: 11, color: "#6b7280", marginTop: 2, flexWrap: "wrap" }}>
                <span><span style={{ color: NAVY }}>●</span> 4주 평균 (추세)</span>
                <span><span style={{ color: WEEKLY }}>●</span> 주간 값</span>
              </div>
            </div>

            <div style={{ background: "#f9fafb", borderRadius: 10, padding: "10px 12px", fontSize: 12.5, lineHeight: 1.5 }}>
              <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 4 }}>해석</div>
              <div style={{ color: bad ? RED : trend === "unknown" ? "#6b7280" : GREEN, fontWeight: 700 }}>
                {arrow} {interpretation}
              </div>
              <div style={{ fontSize: 10.5, color: "#9ca3af", marginTop: 6, lineHeight: 1.6 }}>
                최근 4주 평균이 3개월 전 4주 평균보다 {band}% 이상 낮으면 감소 추세로 표시합니다. 주간 값은 원래
                출렁이므로 한두 주 변동은 무시하세요. 10번 카드는 같은 숫자를 재고 부담 관점(늘면 주의)으로
                보므로 두 카드를 함께 보세요.
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
