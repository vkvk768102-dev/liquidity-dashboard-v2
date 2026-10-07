"use client";

// 4번 카드: 프라이머리 딜러 보유 자산 (총 자산 + 국채 보유 2칸, 축 있는 추이 그래프)
// 단위: API는 백만 달러 → 화면은 억 달러 (1억 달러 = 100 백만 달러)

const NAVY = "#1e3a8a";
const LINE = "#2563eb";

function eok(millions) {
  return millions / 100;
}

function fmtEok(millions) {
  if (millions == null) return "-";
  return `${eok(millions).toLocaleString("ko-KR", { maximumFractionDigits: 0 })}억 달러`;
}

function fmtEokDiff(millions) {
  if (millions == null) return null;
  const v = eok(millions);
  return `${v >= 0 ? "+" : "-"}${Math.abs(v).toLocaleString("ko-KR", { maximumFractionDigits: 0 })}억 달러`;
}

function fmtMD(d) {
  if (!d) return "";
  const [, m, day] = d.split("-");
  return `${Number(m)}/${Number(day)}`;
}

function shortDate(d) {
  if (!d) return "-";
  const [, m, day] = d.split("-");
  return `${m}/${day}`;
}

function ValueBox({ label, date, value, change }) {
  const up = change != null && change > 0;
  return (
    <div
      style={{
        border: "1px solid #e5e7eb",
        borderRadius: 10,
        padding: "10px 8px",
        textAlign: "center",
        background: "#fff",
      }}
    >
      <div style={{ fontSize: 12, color: "#374151", fontWeight: 600 }}>
        {label} ({shortDate(date)})
      </div>
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

function niceTicks(min, max, count = 4) {
  const range = max - min || Math.abs(max) || 1;
  const rough = range / count;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= rough) || rough;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(v);
  return ticks;
}

function AxisChart({ points }) {
  if (!points || points.length === 0) return null;
  const w = 320;
  const h = 130;
  const left = 44;
  const right = 18;
  const top = 18;
  const bottom = 22;

  const ys = points.map((p) => p.y);
  const ticks = niceTicks(Math.min(...ys), Math.max(...ys));
  const minT = ticks[0];
  const maxT = ticks[ticks.length - 1];
  const span = maxT - minT || 1;

  const xAt = (i) => left + (i * (w - left - right)) / Math.max(points.length - 1, 1);
  const yAt = (v) => top + (1 - (v - minT) / span) * (h - top - bottom);

  const path = points.map((p, i) => `${i === 0 ? "M" : "L"} ${xAt(i)} ${yAt(p.y)}`).join(" ");

  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} style={{ display: "block" }}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={left} x2={w - right} y1={yAt(t)} y2={yAt(t)} stroke="#e5e7eb" strokeWidth="1" />
          <text x={left - 6} y={yAt(t) + 3.5} fontSize="10" fill="#6b7280" textAnchor="end">
            {t.toLocaleString("ko-KR")}
          </text>
        </g>
      ))}
      <path d={path} fill="none" stroke={LINE} strokeWidth="2.5" />
      {points.map((p, i) => (
        <g key={p.date}>
          <circle cx={xAt(i)} cy={yAt(p.y)} r="4" fill={LINE} />
          <text x={xAt(i)} y={yAt(p.y) - 9} fontSize="11" fontWeight="700" fill="#111827" textAnchor="middle">
            {p.y.toLocaleString("ko-KR", { maximumFractionDigits: 0 })}
          </text>
          <text x={xAt(i)} y={h - 5} fontSize="10.5" fill="#374151" textAnchor="middle">
            {fmtMD(p.date)}
          </text>
        </g>
      ))}
    </svg>
  );
}

export default function PdBalanceSheetCard({ loading, error, data, interpretation, interpretationBad }) {
  const chartPoints =
    data?.points
      ?.filter((p) => p.total != null)
      .map((p) => ({ date: p.date, y: Math.round(eok(p.total)) })) ?? [];
  const down = data?.changeTotal != null && data.changeTotal < 0;

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
            4
          </span>
          <span style={{ fontWeight: 700, fontSize: 15 }}>Primary Dealer Balance Sheet</span>
        </div>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: "#fde68a", marginTop: 6, lineHeight: 1.4 }}>
          국채를 받아줄 딜러에게 공간이 남았는지 확인
        </div>
        <div style={{ fontSize: 12.5, opacity: 0.85, marginTop: 4 }}>프라이머리 딜러(증권사) 보유 자산</div>
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
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <ValueBox label="총 자산" date={data.latestDate} value={data.latestTotal} change={data.changeTotal} />
              <ValueBox label="국채 보유" date={data.latestDate} value={data.latestUst} change={data.changeUst} />
            </div>

            <div>
              <div style={{ fontSize: 12, color: "#374151", fontWeight: 600, marginBottom: 4 }}>
                최근 4주 추이 (총 자산, 억 달러)
              </div>
              <AxisChart points={chartPoints} />
            </div>

            <div
              style={{
                background: "#f9fafb",
                borderRadius: 10,
                padding: "10px 12px",
                fontSize: 12.5,
                lineHeight: 1.5,
              }}
            >
              <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 4 }}>해석</div>
              <div style={{ color: interpretationBad ? "#dc2626" : "#16a34a", fontWeight: 700 }}>
                {down ? "▼" : "▲"} {interpretation}
              </div>
              <div style={{ fontSize: 10.5, color: "#9ca3af", marginTop: 6 }}>
                총 자산은 국채·연방기관채·MBS·회사채·ABS 순포지션 합계(근사치)
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
