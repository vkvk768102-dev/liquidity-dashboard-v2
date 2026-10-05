"use client";

import { useEffect, useState } from "react";

// 17번 카드: SLOOS (연준 대출 담당자 설문) - 은행 대출 기준 강화/완화
// - 지표: FRED DRTSCILM (중대형 기업 C&I 대출 기준을 강화한 은행 비율 - 완화한 은행 비율, %)
// - 숫자 크기보다 "0선 위에 몇 분기 연속으로 있는가"를 봅니다
//   1단계 정상(0선 아래 또는 1분기만 튐) / 2단계 선별 시작(2분기 연속) / 3단계 긴축 고착(3분기 이상)
// - 분기 데이터라 석 달에 한 번만 바뀝니다

const NAVY = "#1e3a8a";
const RED = "#dc2626";
const GREEN = "#16a34a";
const AMBER = "#d97706";
const ZERO = "#6b7280"; // 값이 정확히 0인 분기 표시용
const RECENT_QUARTERS = 20; // "최근 5년" = 20분기

const STAGES = [
  { n: 1, name: "정상", color: GREEN, bg: "#f0fdf4" },
  { n: 2, name: "선별 시작", color: AMBER, bg: "#fffbeb" },
  { n: 3, name: "긴축 고착", color: RED, bg: "#fef2f2" },
];

function yearOf(d) {
  return Number(d.slice(0, 4));
}
function monthOf(d) {
  return Number(d.slice(5, 7));
}
function quarterLabel(d) {
  if (!d) return "-";
  return `${yearOf(d)}년 ${Math.floor((monthOf(d) - 1) / 3) + 1}분기`;
}
function fmtVal(v) {
  if (v == null) return "-";
  return `${v > 0 ? "+" : v < 0 ? "-" : ""}${Math.abs(v).toFixed(1)}%`;
}
function fmtDiff(v) {
  if (v == null) return null;
  return `${v >= 0 ? "+" : "-"}${Math.abs(v).toFixed(1)}%p`;
}

function StageSteps({ stage, watch }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
      {STAGES.map((s) => {
        const on = s.n === stage;
        // 1단계지만 다음 분기를 지켜봐야 하는 경우는 노란색으로 표시
        const color = on && watch ? AMBER : s.color;
        const bg = on && watch ? "#fffbeb" : s.bg;
        return (
          <div
            key={s.n}
            style={{
              border: `1px solid ${on ? color : "#e5e7eb"}`,
              background: on ? bg : "#fff",
              borderRadius: 10,
              padding: "8px 4px",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 10.5, color: on ? color : "#9ca3af", fontWeight: 600, whiteSpace: "nowrap" }}>
              {s.n}단계
            </div>
            <div
              style={{
                fontSize: 13,
                fontWeight: on ? 800 : 600,
                color: on ? color : "#9ca3af",
                whiteSpace: "nowrap",
              }}
            >
              {on && watch ? "확인 필요" : s.name}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BarChart({ points, streakAbove, showAll }) {
  if (!points || points.length < 2) return null;
  const w = 320;
  const h = 170;
  const left = 34;
  const right = 10;
  const top = 20;
  const bottom = 22;
  const len = points.length;

  const vals = points.map((p) => p.value);
  const min = Math.min(0, ...vals);
  const max = Math.max(0, ...vals);
  const raw = (max - min || 1) / 4;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) || pow;
  const minT = Math.floor(min / step) * step;
  const maxT = Math.ceil(max / step) * step || minT + step;
  const ticks = [];
  for (let v = minT; v <= maxT + step / 2; v += step) ticks.push(Math.round(v * 100) / 100);

  const slot = (w - left - right) / len;
  const barW = Math.max(slot * (showAll ? 0.8 : 0.62), 1);
  const xAt = (i) => left + i * slot + (slot - barW) / 2;
  const yAt = (v) => top + (1 - (v - minT) / (maxT - minT || 1)) * (h - top - bottom);
  const y0 = yAt(0);

  // 지금 이어지는 "0선 위 연속" 구간을 옅은 띠로 표시
  const shown = Math.min(streakAbove, len);
  const band =
    shown >= 2
      ? { x: left + (len - shown) * slot, width: shown * slot }
      : null;

  // 가로축 연도: 5년 보기는 매년, 전체 보기는 5년마다
  const yearEvery = showAll ? 5 : 1;

  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} style={{ display: "block" }}>
      {band && (
        <g>
          <rect x={band.x} y={top - 6} width={band.width} height={h - top - bottom + 6} fill="#fef2f2" />
          <text
            x={Math.min(Math.max(band.x + band.width / 2, left + 30), w - right - 30)}
            y={top - 9}
            fontSize="9.5"
            fill={RED}
            textAnchor="middle"
            fontWeight="600"
          >
            0선 위 {streakAbove}분기 연속
          </text>
        </g>
      )}
      {ticks.map((t) => (
        <g key={t}>
          <line
            x1={left}
            x2={w - right}
            y1={yAt(t)}
            y2={yAt(t)}
            stroke={t === 0 ? "#374151" : "#e5e7eb"}
            strokeWidth={t === 0 ? 1.2 : 1}
          />
          <text
            x={left - 5}
            y={yAt(t) + 3.5}
            fontSize="10"
            fill={t === 0 ? "#111827" : "#6b7280"}
            fontWeight={t === 0 ? 700 : 400}
            textAnchor="end"
          >
            {t}
          </text>
        </g>
      ))}
      {points.map((p, i) => {
        const y = yAt(p.value);
        const up = p.value > 0;
        if (p.value === 0) {
          return <circle key={p.date} cx={xAt(i) + barW / 2} cy={y0} r={Math.min(Math.max(barW / 2, 1.2), 3.2)} fill={ZERO} />;
        }
        return (
          <rect
            key={p.date}
            x={xAt(i)}
            y={up ? y : y0}
            width={barW}
            height={Math.max(Math.abs(y - y0), 0.8)}
            fill={up ? RED : GREEN}
            opacity={i === len - 1 ? 1 : 0.7}
          />
        );
      })}
      {points.map((p, i) =>
        monthOf(p.date) === 1 && yearOf(p.date) % yearEvery === 0 ? (
          <text key={p.date} x={left + i * slot + slot / 2} y={h - 6} fontSize="10" fill="#374151" textAnchor="middle">
            {showAll ? yearOf(p.date) : `${String(yearOf(p.date)).slice(2)}년`}
          </text>
        ) : null
      )}
    </svg>
  );
}

function RangeButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        fontSize: 11.5,
        padding: "4px 10px",
        borderRadius: 8,
        border: `1px solid ${active ? NAVY : "#d1d5db"}`,
        background: active ? NAVY : "#fff",
        color: active ? "#fff" : "#374151",
        fontWeight: 600,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

export default function SloosCard() {
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/sloos", { cache: "no-store" });
        const d = await res.json();
        if (!res.ok || d.ok === false) throw new Error(d.error || `요청 실패 (${res.status})`);
        if (alive) setState({ loading: false, error: null, data: d });
      } catch (e) {
        if (alive) setState({ loading: false, error: e.message, data: null });
      }
    };
    load();
    const id = setInterval(load, 6 * 60 * 60 * 1000); // 분기 데이터라 6시간마다만 확인
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const { loading, error, data } = state;
  const stage = data?.stage ?? 1;
  const n = data?.streakAbove ?? 0;
  const stageInfo = STAGES[stage - 1];
  // 0선 위로 처음 올라온 분기는 아직 1단계지만 "지켜볼 것"으로 노란색 표시
  const firstCross = stage === 1 && n === 1;

  // "0선 아래"(마이너스)와 "0선에 걸침"(정확히 0)을 구분해서 셉니다
  const pts = data?.points ?? [];
  const onZero = data != null && data.latestValue === 0;
  let belowRun = 0; // 최신 분기부터 연속으로 마이너스인 분기 수
  for (let i = pts.length - 1; i >= 0 && pts[i].value < 0; i--) belowRun++;
  let prevAboveRun = 0; // 최신 값이 0일 때, 그 직전까지 연속으로 0선 위였던 분기 수
  if (onZero) {
    for (let i = pts.length - 2; i >= 0 && pts[i].value > 0; i--) prevAboveRun++;
  }
  // 긴축(2분기 이상 연속 0선 위) 직후 0에 걸친 경우: 풀린 건지 아직 모르므로 "확인 필요"
  const zeroAfterTightening = onZero && prevAboveRun >= 2;
  const watch = firstCross || zeroAfterTightening;
  const tone = watch ? AMBER : stageInfo.color;
  const positionLabel =
    n > 0
      ? `${quarterLabel(data?.streakStartDate)}부터`
      : onZero
      ? prevAboveRun > 0
        ? `이번엔 0선에 걸침 · 직전 ${prevAboveRun}분기는 0선 위`
        : "이번 분기는 0선에 걸침"
      : `0선 아래 ${belowRun}분기째`;

  let interpretation = "";
  if (data) {
    const peak = data.streakPeak;
    const easing = peak && data.latestValue < peak.value && data.change != null && data.change < 0;
    const strength = easing
      ? ` 다만 최고점(${fmtVal(peak.value)}, ${quarterLabel(peak.date)})보다 낮아져 강도는 약해지는 중`
      : data.change != null && data.change > 0
      ? " 강화하는 은행 비율도 전분기보다 늘어남"
      : "";
    if (stage === 3) {
      interpretation = `0선 위 ${n}분기 연속. 은행의 대출 조이기가 굳어진 구간.${strength}`;
    } else if (stage === 2) {
      interpretation = `0선 위 2분기 연속. 은행이 내부 대출 기준을 바꾼 것으로 볼 수 있는 구간 (대출이 심사 대상이 됨). 이 시점의 증시는 아직 강세인 경우가 많음.${strength}`;
    } else if (firstCross) {
      interpretation = "0선 위로 올라온 첫 분기. 잠깐 튄 것인지 다음 분기에도 유지되는지 확인 필요";
    } else if (zeroAfterTightening) {
      interpretation = `이번 값이 정확히 0 (강화한 은행 = 완화한 은행). 0선 아래로 내려간 것은 아니고, 직전까지 ${prevAboveRun}분기 연속 0선 위였음. 조이기가 풀리는 중인지 다음 분기에 확인 필요`;
    } else if (onZero) {
      interpretation = "이번 값이 정확히 0 (강화한 은행 = 완화한 은행). 조이는 은행이 더 많지 않은 상태";
    } else {
      interpretation = `0선 아래 ${belowRun}분기째. 완화한 은행이 더 많은 평상시 상태`;
    }
  }
  const arrow = "●";

  const visible = data ? (showAll ? data.points : data.points.slice(-RECENT_QUARTERS)) : [];

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
            17
          </span>
          <span style={{ fontWeight: 700, fontSize: 15 }}>SLOOS 은행 대출 기준 (강화 − 완화)</span>
        </div>
        <div style={{ fontSize: 12.5, opacity: 0.85, marginTop: 4 }}>
          기업 대출 기준을 강화한 은행이 완화한 은행보다 얼마나 많은지. 숫자 크기보다 0선 위에 몇 분기 연속
          있는지를 봅니다
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
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div
                style={{
                  background: "#f9fafb",
                  border: "1px solid #eef0f2",
                  borderRadius: 10,
                  padding: "10px 12px",
                }}
              >
                <div style={{ fontSize: 11.5, color: "#6b7280", marginBottom: 4 }}>
                  최신 값 ({quarterLabel(data.latestDate)})
                </div>
                <div style={{ fontSize: 22, fontWeight: 800, color: data.latestValue > 0 ? RED : data.latestValue < 0 ? GREEN : "#111827" }}>
                  {fmtVal(data.latestValue)}
                </div>
                <div style={{ fontSize: 11.5, color: "#6b7280", fontWeight: 600 }}>
                  {data.latestValue > 0 ? "강화 우세" : data.latestValue < 0 ? "완화 우세" : "강화 = 완화"}
                  {data.change != null && ` · 전분기 대비 ${fmtDiff(data.change)}`}
                </div>
              </div>
              <div
                style={{
                  background: "#f9fafb",
                  border: "1px solid #eef0f2",
                  borderRadius: 10,
                  padding: "10px 12px",
                }}
              >
                <div style={{ fontSize: 11.5, color: "#6b7280", marginBottom: 4 }}>0선 위 연속</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: n > 0 ? tone : "#111827" }}>{n}분기</div>
                <div style={{ fontSize: 11.5, color: "#6b7280", fontWeight: 600 }}>
                  {positionLabel}
                </div>
              </div>
            </div>

            <StageSteps stage={stage} watch={watch} />

            <div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                  marginBottom: 6,
                }}
              >
                <div style={{ fontSize: 12, color: "#374151", fontWeight: 600 }}>분기별 추이 (%)</div>
                <div style={{ display: "flex", gap: 6 }}>
                  <RangeButton active={!showAll} onClick={() => setShowAll(false)}>
                    최근 5년
                  </RangeButton>
                  <RangeButton active={showAll} onClick={() => setShowAll(true)}>
                    전체
                  </RangeButton>
                </div>
              </div>
              <BarChart points={visible} streakAbove={n} showAll={showAll} />
              <div style={{ display: "flex", gap: 12, fontSize: 11, color: "#6b7280", marginTop: 2, flexWrap: "wrap" }}>
                <span><span style={{ color: RED }}>■</span> 0선 위: 강화한 은행이 더 많음</span>
                <span><span style={{ color: GREEN }}>■</span> 0선 아래: 완화한 은행이 더 많음</span>
                <span><span style={{ color: ZERO }}>●</span> 정확히 0: 강화 = 완화</span>
              </div>
            </div>

            <div style={{ background: "#f9fafb", borderRadius: 10, padding: "10px 12px", fontSize: 12.5, lineHeight: 1.5 }}>
              <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 4 }}>해석</div>
              <div style={{ color: tone, fontWeight: 700 }}>
                {arrow} {stageInfo.n}단계 {watch ? "(확인 필요)" : stageInfo.name}: {interpretation}
              </div>
              <div style={{ fontSize: 10.5, color: "#9ca3af", marginTop: 6, lineHeight: 1.6 }}>
                0선 위 2분기 연속이면 2단계, 3분기 이상이면 3단계로 표시합니다. 분기에 한 번(2·5·8·11월 초)만 새
                값이 나옵니다. 2022~2024년처럼 0선 위가 2년 넘게 이어지는 동안 증시가 오른 적도 있으니, 이 카드
                하나로 결론 내리지 말고 다른 카드와 함께 보세요.
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
