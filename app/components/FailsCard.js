"use client";

import { useEffect, useState } from "react";

// 15번 카드: 프라이머리 딜러 국채 결제 실패 (인도 실패 / 수령 실패), 8주 추이
// 단위: API는 백만 달러 → 화면은 억 달러

const NAVY = "#1e3a8a";
const DELIVER = "#dc2626";
const RECEIVE = "#9ca3af";
const ALERT_RATIO = 1.5; // 이전 주 평균의 1.5배 이상이면 경계

function eok(m) {
  return m / 100;
}
function fmtEok(m) {
  if (m == null) return "-";
  return `${eok(m).toLocaleString("ko-KR", { maximumFractionDigits: 0 })}억 달러`;
}
function fmtEokDiff(m) {
  if (m == null) return null;
  const v = eok(m);
  return `${v >= 0 ? "+" : "-"}${Math.abs(v).toLocaleString("ko-KR", { maximumFractionDigits: 0 })}억`;
}
function fmtMD(d) {
  if (!d) return "";
  const [, m, day] = d.split("-");
  return `${Number(m)}/${Number(day)}`;
}

function ValueBox({ label, sub, value, change }) {
  const up = change != null && change > 0;
  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: "10px 8px", textAlign: "center" }}>
      <div style={{ fontSize: 12, color: "#374151", fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 10.5, color: "#9ca3af" }}>{sub}</div>
      <div style={{ margin: "4px 0 2px", whiteSpace: "nowrap" }}>
        {value == null ? (
          <span style={{ fontSize: 20, fontWeight: 800 }}>-</span>
        ) : (
          <>
            <span style={{ fontSize: 20, fontWeight: 800 }}>
              {(value / 100).toLocaleString("ko-KR", { maximumFractionDigits: 0 })}
            </span>
            <span style={{ fontSize: 12, fontWeight: 700, marginLeft: 2 }}>억 달러</span>
          </>
        )}
      </div>
      {change != null && (
        <div style={{ fontSize: 11.5, color: up ? "#dc2626" : "#16a34a", fontWeight: 600 }}>
          (전주 대비 {fmtEokDiff(change)})
        </div>
      )}
    </div>
  );
}

function TwoLineChart({ points, avg }) {
  if (!points || points.length === 0) return null;
  const w = 320;
  const h = 140;
  const left = 40;
  const right = 14;
  const top = 18;
  const bottom = 22;

  const vals = points.flatMap((p) => [p.deliver, p.receive]).filter((v) => v != null).map(eok);
  if (avg != null) vals.push(eok(avg));
  const max = Math.max(...vals, 1);
  const step = Math.pow(10, Math.floor(Math.log10(max / 3)));
  const niceStep = [1, 2, 2.5, 5, 10].map((m) => m * step).find((s) => s * 4 >= max) || step;
  const maxT = Math.ceil(max / niceStep) * niceStep;
  const ticks = [];
  for (let v = 0; v <= maxT + niceStep / 2; v += niceStep) ticks.push(v);

  const xAt = (i) => left + (i * (w - left - right)) / Math.max(points.length - 1, 1);
  const yAt = (v) => top + (1 - v / maxT) * (h - top - bottom);
  const path = (key) =>
    points
      .map((p, i) => (p[key] == null ? null : `${xAt(i)} ${yAt(eok(p[key]))}`))
      .filter(Boolean)
      .map((s, i) => `${i === 0 ? "M" : "L"} ${s}`)
      .join(" ");

  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} style={{ display: "block" }}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={left} x2={w - right} y1={yAt(t)} y2={yAt(t)} stroke="#e5e7eb" />
          <text x={left - 6} y={yAt(t) + 3.5} fontSize="10" fill="#6b7280" textAnchor="end">
            {t.toLocaleString("ko-KR")}
          </text>
        </g>
      ))}
      {avg != null && (
        <line
          x1={left}
          x2={w - right}
          y1={yAt(eok(avg))}
          y2={yAt(eok(avg))}
          stroke={DELIVER}
          strokeDasharray="4 4"
          strokeOpacity="0.5"
        />
      )}
      <path d={path("receive")} fill="none" stroke={RECEIVE} strokeWidth="2" />
      <path d={path("deliver")} fill="none" stroke={DELIVER} strokeWidth="2.5" />
      {points.map((p, i) => (
        <g key={p.date}>
          {p.deliver != null && <circle cx={xAt(i)} cy={yAt(eok(p.deliver))} r="3.5" fill={DELIVER} />}
          {i === points.length - 1 && p.deliver != null && (
            <text x={xAt(i)} y={yAt(eok(p.deliver)) - 8} fontSize="11" fontWeight="700" fill={DELIVER} textAnchor="end">
              {Math.round(eok(p.deliver)).toLocaleString("ko-KR")}
            </text>
          )}
          <text x={xAt(i)} y={h - 5} fontSize="10" fill="#374151" textAnchor="middle">
            {fmtMD(p.date)}
          </text>
        </g>
      ))}
    </svg>
  );
}

export default function FailsCard() {
  const [state, setState] = useState({ loading: true, error: null, data: null });

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/pd-fails", { cache: "no-store" });
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
  const ratio = data?.ratioToAvg ?? null;
  const bad = ratio != null && ratio >= ALERT_RATIO;
  const interpretation =
    ratio == null
      ? ""
      : bad
      ? `인도 실패가 평소의 ${ratio.toFixed(1)}배. 특정 국채를 구하지 못하는 결제 마찰 가능성`
      : ratio >= 1
      ? `평소보다 조금 많음 (평균의 ${ratio.toFixed(1)}배). 지켜보기`
      : `평소 수준 이하 (평균의 ${ratio.toFixed(1)}배). 결제 마찰 낮음`;

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
            15
          </span>
          <span style={{ fontWeight: 700, fontSize: 15 }}>Treasury Fails (국채 결제 실패)</span>
        </div>
        <div style={{ fontSize: 12.5, opacity: 0.85, marginTop: 4 }}>
          딜러가 결제일에 국채를 넘기거나 받지 못한 금액 (주간 누적). 늘어나면 특정 국채를 구하기 어렵다는 뜻
        </div>
      </div>

      <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
        {loading && <div style={{ color: "#6b7280", fontSize: 13 }}>불러오는 중...</div>}
        {error && !loading && (
          <div style={{ color: "#dc2626", fontSize: 12.5, lineHeight: 1.5 }}>
            데이터를 불러오지 못했습니다.
            <br />
            <span style={{ color: "#9ca3af" }}>{error}</span>
          </div>
        )}

        {!loading && !error && data && (
          <>
            <div style={{ fontSize: 11.5, color: "#6b7280" }}>기준: {data.latestDate}로 끝나는 주</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <ValueBox label="인도 실패" sub="넘겨줄 국채를 못 넘김" value={data.latestDeliver} change={data.changeDeliver} />
              <ValueBox label="수령 실패" sub="받을 국채를 못 받음" value={data.latestReceive} change={data.changeReceive} />
            </div>

            <div>
              <div style={{ fontSize: 12, color: "#374151", fontWeight: 600, marginBottom: 4 }}>
                최근 {data.points.length}주 추이 (억 달러)
              </div>
              <TwoLineChart points={data.points} avg={data.avgDeliver} />
              <div style={{ display: "flex", gap: 12, fontSize: 11, color: "#6b7280", marginTop: 2, flexWrap: "wrap" }}>
                <span><span style={{ color: DELIVER }}>●</span> 인도 실패</span>
                <span><span style={{ color: RECEIVE }}>●</span> 수령 실패</span>
                <span><span style={{ color: DELIVER, opacity: 0.6 }}>- -</span> 인도 실패 평균</span>
              </div>
            </div>

            <div style={{ background: "#f9fafb", borderRadius: 10, padding: "10px 12px", fontSize: 12.5, lineHeight: 1.5 }}>
              <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 4 }}>해석</div>
              <div style={{ color: bad ? "#dc2626" : "#16a34a", fontWeight: 700 }}>
                {ratio != null && ratio >= 1 ? "▲" : "▼"} {interpretation}
              </div>
              <div style={{ fontSize: 10.5, color: "#9ca3af", marginTop: 6, lineHeight: 1.6 }}>
                인도 실패가 이전 주 평균의 {ALERT_RATIO}배 이상이면 경계로 표시합니다. 시장 전체 합계라 어떤 종목인지는
                알 수 없으니, 13번 카드에서 수수료가 높은 종목과 같이 보세요.
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
