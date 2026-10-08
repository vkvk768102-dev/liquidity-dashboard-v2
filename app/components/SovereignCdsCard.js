// 파일 위치: app/components/SovereignCdsCard.js
"use client";

import { useEffect, useState } from "react";

const NAVY = "#1e3a8a";
const STALE_DAYS = 10; // 기준일보다 이만큼 오래된 값은 "오래된 값"으로 표시
const WATCH_PCT = 10; // 미국 CDS가 기간 시작 대비 이만큼(%) 오르면 주의
const BAD_PCT = 20; // 이만큼(%) 오르면 경계
const US_BAD_BP = 50; // 미국 CDS가 이 수준(bp) 이상이면 경계

// 위험도 구간 (bp). 위에서부터 차례로 확인
const GRADES = [
  { min: 200, label: "매우 높음", color: "#b91c1c", bg: "#fee2e2" },
  { min: 100, label: "높음", color: "#dc2626", bg: "#fef2f2" },
  { min: 50, label: "주의", color: "#b45309", bg: "#fffbeb" },
  { min: 30, label: "보통", color: "#374151", bg: "#f3f4f6" },
  { min: 15, label: "낮음", color: "#15803d", bg: "#f0fdf4" },
  { min: -Infinity, label: "매우 낮음", color: "#166534", bg: "#dcfce7" },
];
const gradeOf = (bp) => GRADES.find((g) => bp >= g.min);

const LEVEL = {
  ok: { label: "정상", color: "#16a34a" },
  watch: { label: "주의", color: "#d97706" },
  bad: { label: "경계", color: "#dc2626" },
};

const fmtMd = (d) => (d ? d.slice(5).replace("-", "/") : "-");
const fmtBp = (v) => (v == null ? "-" : v.toFixed(1));
const signed = (v, digits = 1) => `${v >= 0 ? "+" : "-"}${Math.abs(v).toFixed(digits)}`;
const dayMs = (d) => new Date(d + "T00:00:00Z").getTime();

async function fetchJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json();
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `요청 실패 (${res.status})`);
  }
  return data;
}

// 미국 5년 CDS 추이 (선 하나). 차트를 누르거나 마우스를 올리면 그 날짜의 값을 보여 줌
function UsTrendChart({ points }) {
  const [active, setActive] = useState(null);
  if (!points || points.length < 2) return null;

  const w = 320;
  const h = 150;
  const left = 30;
  const right = 16;
  const top = 22;
  const bottom = 22;

  const t0 = dayMs(points[0].date);
  const t1 = dayMs(points[points.length - 1].date);
  const tRange = t1 - t0 || 1;
  const vals = points.map((p) => p.value);
  const rawMin = Math.min(...vals);
  const rawMax = Math.max(...vals);
  const pad = (rawMax - rawMin) * 0.15 || 1;
  const yMin = rawMin - pad;
  const yMax = rawMax + pad;

  const xAt = (d) => left + ((dayMs(d) - t0) / tRange) * (w - left - right);
  const yAt = (v) => top + (1 - (v - yMin) / (yMax - yMin)) * (h - top - bottom);
  const coords = points.map((p) => ({ ...p, x: xAt(p.date), y: yAt(p.value) }));

  const line = coords.map((c, i) => `${i === 0 ? "M" : "L"} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(" ");
  const base = h - bottom;
  const area = `${line} L ${coords[coords.length - 1].x.toFixed(1)} ${base} L ${coords[0].x.toFixed(1)} ${base} Z`;

  // 값 표시는 시작·끝·최고·최저에만
  const iMax = vals.indexOf(rawMax);
  const iMin = vals.indexOf(rawMin);
  const labeled = [...new Set([0, coords.length - 1, iMax, iMin])];
  const ticks = [rawMin, (rawMin + rawMax) / 2, rawMax];
  const xLabels = [...new Set([0, Math.floor((coords.length - 1) / 2), coords.length - 1])];

  const pick = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * w;
    let best = 0;
    coords.forEach((c, i) => {
      if (Math.abs(c.x - x) < Math.abs(coords[best].x - x)) best = i;
    });
    setActive(best);
  };

  const cur = active != null ? coords[active] : null;

  return (
    // 카드가 넓어져도 차트가 지나치게 커지지 않도록 최대 폭을 둠
    <div style={{ maxWidth: 460 }}>
      <div style={{ fontSize: 11.5, color: "#6b7280", marginBottom: 2, minHeight: 17 }}>
        {cur ? (
          <span>
            <b style={{ color: "#111827" }}>{fmtMd(cur.date)}</b> · {cur.value.toFixed(2)}bp
          </span>
        ) : (
          "차트를 누르면 날짜별 값을 볼 수 있습니다"
        )}
      </div>
      <svg
        width="100%"
        viewBox={`0 0 ${w} ${h}`}
        style={{ display: "block", touchAction: "pan-y", cursor: "crosshair" }}
        onPointerDown={pick}
        onPointerMove={pick}
        onPointerLeave={() => setActive(null)}
      >
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={left} x2={w - right} y1={yAt(t)} y2={yAt(t)} stroke="#e5e7eb" strokeWidth="1" />
            <text x={left - 5} y={yAt(t) + 3.5} fontSize="9.5" fill="#9ca3af" textAnchor="end">
              {t.toFixed(0)}
            </text>
          </g>
        ))}
        <path d={area} fill={NAVY} opacity="0.08" />
        <path d={line} fill="none" stroke={NAVY} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {cur && <line x1={cur.x} x2={cur.x} y1={top - 6} y2={base} stroke="#9ca3af" strokeWidth="1" strokeDasharray="3 3" />}
        {labeled.map((i) => {
          const c = coords[i];
          const anchor = i === 0 ? "start" : i === coords.length - 1 ? "end" : "middle";
          const below = i === iMin && i !== iMax;
          return (
            <g key={i}>
              <circle cx={c.x} cy={c.y} r="4" fill={NAVY} stroke="#fff" strokeWidth="2" />
              <text
                x={c.x}
                y={below ? c.y + 15 : c.y - 9}
                fontSize="11"
                fontWeight="700"
                fill="#111827"
                textAnchor={anchor}
              >
                {c.value.toFixed(1)}
              </text>
            </g>
          );
        })}
        {cur && <circle cx={cur.x} cy={cur.y} r="4.5" fill="#fff" stroke={NAVY} strokeWidth="2" />}
        {xLabels.map((i) => (
          <text
            key={i}
            x={coords[i].x}
            y={h - 5}
            fontSize="10"
            fill="#6b7280"
            textAnchor={i === 0 ? "start" : i === coords.length - 1 ? "end" : "middle"}
          >
            {fmtMd(coords[i].date)}
          </text>
        ))}
      </svg>
    </div>
  );
}

export default function SovereignCdsCard() {
  const [state, setState] = useState({ loading: true, error: null, data: null });

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetchJson("/api/sovereign-cds")
        .then((d) => {
          if (!cancelled) setState({ loading: false, error: null, data: d });
        })
        .catch((e) => {
          if (!cancelled) setState({ loading: false, error: e.message, data: null });
        });
    load();
    const id = setInterval(load, 60 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const data = state.data;
  const countries = data?.countries ?? [];
  const points = data?.us?.points ?? [];
  const asOf = data?.asOf ?? null;
  const isSnapshot = data?.source === "snapshot";
  const historySnapshot = data?.historySource === "snapshot";

  const isStale = (c) => c.date && asOf && dayMs(asOf) - dayMs(c.date) > STALE_DAYS * 86400000;

  // 미국 CDS: 최신 값, 일주일 전(7일 이상 앞선 값 중 가장 가까운 날), 기간 시작 대비
  const usLatest = points.length ? points[points.length - 1] : null;
  const usStart = points.length > 1 ? points[0] : null;
  const usWeek = usLatest
    ? [...points].reverse().find((p) => dayMs(usLatest.date) - dayMs(p.date) >= 7 * 86400000) ?? null
    : null;
  const weekDiff = usLatest && usWeek ? usLatest.value - usWeek.value : null;
  const startDiff = usLatest && usStart ? usLatest.value - usStart.value : null;
  const startPct = startDiff != null ? (startDiff / usStart.value) * 100 : null;

  // 해석
  let level = "ok";
  let headline = "";
  const lines = [];
  if (usLatest) {
    const g = gradeOf(usLatest.value);
    if (usLatest.value >= US_BAD_BP || (startPct != null && startPct >= BAD_PCT)) level = "bad";
    else if (startPct != null && startPct >= WATCH_PCT) level = "watch";

    const trend =
      startPct == null
        ? ""
        : startPct >= WATCH_PCT
        ? "상승 중"
        : startPct <= -WATCH_PCT
        ? "하락 중"
        : "큰 변화 없음";
    headline = `미국 5년 CDS ${usLatest.value.toFixed(1)}bp (${g.label})${trend ? `, ${trend}` : ""}`;
    if (startDiff != null) {
      lines.push(`${fmtMd(usStart.date)} 이후 ${signed(startDiff)}bp (${signed(startPct)}%)`);
    }
    if (level === "ok") {
      lines.push("미국 국채의 신용 불안 신호는 약합니다. 주식시장에 주는 부담도 크지 않습니다.");
    } else {
      lines.push("미국 국채에 신용 프리미엄이 붙는 중 → 장기금리·달러·주식 변동성이 커질 수 있습니다.");
    }
  }
  const high = countries.filter((c) => c.value >= 100);
  if (high.length) lines.push(`100bp 이상(높음 이상): ${high.map((c) => c.name).join("·")}`);
  const movers = countries
    .filter((c) => c.changePct != null && c.changePct >= 5 && !isStale(c))
    .sort((a, b) => b.changePct - a.changePct)
    .slice(0, 3);
  if (movers.length) {
    lines.push(`하루 새 많이 오른 곳: ${movers.map((c) => `${c.name} ${signed(c.changePct)}%`).join(" · ")}`);
  }

  // 표를 좌우 두 개로 나눠 보여 주므로 칸 여백을 작게 두고 줄바꿈을 막음
  const th = { padding: "6px 1px", textAlign: "center", whiteSpace: "nowrap", fontSize: 10.5 };
  const td = { padding: "6px 1px", textAlign: "center", whiteSpace: "nowrap" };
  const half = Math.ceil(countries.length / 2);

  return (
    <div
      className="card-span-2"
      style={{
        background: "#fff",
        borderRadius: 14,
        boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
        padding: 16,
        minWidth: 0,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>18. 주요 국가 5년 CDS · 미국 CDS 추이</div>
        <span style={{ fontSize: 10.5, color: isSnapshot ? "#b45309" : "#9ca3af", whiteSpace: "nowrap", flexShrink: 0 }}>
          {isSnapshot ? "저장된 값" : "자동 갱신"}
        </span>
      </div>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: "#b45309", marginTop: 6, lineHeight: 1.4 }}>
        국가가 빚을 못 갚을 위험에 시장이 매긴 보험료는 얼마인가?
      </div>
      <div style={{ fontSize: 11.5, color: "#6b7280", margin: "4px 0 12px" }}>
        5년 CDS 프리미엄 (bp, 1bp = 0.01%p). 숫자가 클수록 시장이 그 나라의 부도 위험을 크게 본다는 뜻입니다.
      </div>

      {state.loading && <div style={{ fontSize: 12.5, color: "#9ca3af", padding: "12px 0" }}>불러오는 중...</div>}
      {state.error && !state.loading && (
        <div style={{ color: "#dc2626", fontSize: 12.5, lineHeight: 1.5 }}>
          데이터를 불러오지 못했습니다.
          <br />
          <span style={{ color: "#9ca3af" }}>{state.error}</span>
        </div>
      )}

      {data && !state.loading && (
        <>
          {(isSnapshot || historySnapshot) && (
            <div
              style={{
                background: "#fffbeb",
                border: "1px solid #fde68a",
                borderRadius: 10,
                padding: "8px 10px",
                fontSize: 11.5,
                lineHeight: 1.5,
                color: "#92400e",
                marginBottom: 12,
              }}
            >
              investing.com 자동 조회가 막혀 {isSnapshot && historySnapshot ? "표와 추이 모두" : isSnapshot ? "국가별 표는" : "미국 추이는"}{" "}
              저장해 둔 값({fmtMd(data.snapshotTaken)} 확인)을 보여 주는 중입니다. 최신 값이 아닐 수 있습니다.
            </div>
          )}

          {usLatest && (
            <div style={{ marginBottom: 14 }}>
              <div
                style={{
                  background: "#f9fafb",
                  border: "1px solid #eef0f2",
                  borderRadius: 10,
                  padding: "10px 12px",
                  marginBottom: 10,
                }}
              >
                <div style={{ fontSize: 11.5, color: "#6b7280", marginBottom: 4 }}>
                  🇺🇸 미국 5년 CDS ({fmtMd(usLatest.date)})
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 22, fontWeight: 800 }}>{usLatest.value.toFixed(1)}bp</span>
                  {weekDiff != null && (
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: weekDiff > 0 ? "#dc2626" : "#16a34a" }}>
                      ({fmtMd(usWeek.date)} 대비 {signed(weekDiff)}bp)
                    </span>
                  )}
                </div>
              </div>
              <div style={{ fontSize: 11.5, color: "#6b7280", marginBottom: 2 }}>
                미국 5년 CDS 추이 (bp, {fmtMd(points[0].date)}~{fmtMd(usLatest.date)})
              </div>
              <UsTrendChart points={points} />
            </div>
          )}

          <div style={{ fontSize: 11.5, color: "#6b7280", marginBottom: 4 }}>
            주요 국가 5년 CDS (bp{asOf ? `, ${fmtMd(asOf)} 기준` : ""})
          </div>
          {/* 위험도가 높은 절반은 왼쪽, 낮은 절반은 오른쪽에 나란히 */}
          <div style={{ display: "grid", gridTemplateColumns: "auto auto", gap: 4, alignItems: "start", marginBottom: 12 }}>
            {[countries.slice(0, half), countries.slice(half)].map((list, i) => (
              <table key={i} style={{ width: "100%", minWidth: 0, borderCollapse: "collapse", fontSize: 11 }}>
                <thead>
                  <tr style={{ background: NAVY, color: "#fff" }}>
                    <th style={{ ...th, textAlign: "left", paddingLeft: 3 }}>국가</th>
                    <th style={th}>CDS</th>
                    <th style={th}>위험도</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((c) => {
                    const g = gradeOf(c.value);
                    const stale = isStale(c);
                    const focus = c.key === "US" || c.key === "KR";
                    return (
                      <tr key={c.key} style={{ borderBottom: "1px solid #e5e7eb", background: focus ? "#eff6ff" : "transparent" }}>
                        <td style={{ ...td, textAlign: "left", paddingLeft: 3, fontWeight: focus ? 700 : 600, lineHeight: 1.25 }}>
                          {c.flag} {c.name}
                          {stale && <div style={{ fontSize: 9.5, color: "#9ca3af", fontWeight: 400 }}>{fmtMd(c.date)} 값</div>}
                        </td>
                        <td style={{ ...td, fontWeight: 700, color: stale ? "#9ca3af" : "#111827" }}>{fmtBp(c.value)}</td>
                        {/* 화면이 아주 좁으면 "매우 높음"만 두 줄로 접힘 */}
                        <td style={{ ...td, fontSize: 10, fontWeight: 700, color: g.color, whiteSpace: "normal", wordBreak: "keep-all", lineHeight: 1.15 }}>
                          {g.label}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ))}
          </div>

          <div style={{ background: "#f9fafb", borderRadius: 10, padding: "10px 12px", fontSize: 12, lineHeight: 1.55 }}>
            <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 4 }}>해석</div>
            {headline && (
              <div style={{ color: LEVEL[level].color, fontWeight: 700 }}>
                [{LEVEL[level].label}] {headline}
              </div>
            )}
            {lines.map((line) => (
              <div key={line} style={{ color: "#374151", marginTop: 3 }}>
                · {line}
              </div>
            ))}
            <div style={{ color: "#6b7280", marginTop: 3 }}>
              · 미국 CDS는 거래가 적어 부채한도·셧다운 같은 정치 일정에 크게 튑니다. 국채 입찰(7번)과 함께 보세요.
            </div>
          </div>

          <div style={{ fontSize: 10.5, color: "#6b7280", marginTop: 8 }}>
            위험도: 200bp 이상 매우 높음, 100 이상 높음, 50 이상 주의, 30 이상 보통, 15 이상 낮음, 그 아래 매우 낮음. 미국 CDS가 기간
            시작보다 {WATCH_PCT}% 이상 오르면 주의, {BAD_PCT}% 이상 오르거나 {US_BAD_BP}bp를 넘으면 경계.
          </div>
          <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 10 }}>
            데이터 출처: investing.com (무료, API 키 불필요). 국가마다 값이 갱신된 날짜가 달라 며칠씩 차이 날 수 있습니다. 종합 신호등
            계산에는 포함하지 않습니다.
          </div>
        </>
      )}
    </div>
  );
}
