"use client";

function fmtDate(d) {
  if (!d) return "-";
  const dt = new Date(d + "T00:00:00");
  if (isNaN(dt.getTime())) return d;
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${mm}/${dd}`;
}

function Sparkline({ points, color }) {
  // points: [{date, y}] where y is already the numeric value to plot
  if (!points || points.length === 0) return null;
  const w = 320;
  const h = 90;
  const padX = 28;
  const padY = 22;
  const ys = points.map((p) => p.y);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const range = maxY - minY || 1;

  const coords = points.map((p, i) => {
    const x = padX + (i * (w - padX * 2)) / Math.max(points.length - 1, 1);
    const y = h - padY - ((p.y - minY) / range) * (h - padY * 2);
    return { x, y, label: p.label, date: p.date };
  });

  const path = coords.map((c, i) => `${i === 0 ? "M" : "L"} ${c.x} ${c.y}`).join(" ");

  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} style={{ display: "block" }}>
      <path d={path} fill="none" stroke={color} strokeWidth="2.5" />
      {coords.map((c, i) => (
        <g key={i}>
          <circle cx={c.x} cy={c.y} r="3.5" fill={color} />
          <text
            x={c.x}
            y={c.y - 10}
            fontSize="11"
            fontWeight="700"
            fill={color}
            textAnchor="middle"
          >
            {c.label}
          </text>
          <text x={c.x} y={h - 4} fontSize="10" fill="#6b7280" textAnchor="middle">
            {fmtDate(c.date)}
          </text>
        </g>
      ))}
    </svg>
  );
}

export default function IndicatorCard({
  number,
  title,
  subtitle,
  loading,
  error,
  latestDateLabel,
  valueLabel,
  changeLabel,
  changeIsUp,
  sparklinePoints,
  sparklineColor,
  interpretation,
  interpretationBad,
}) {
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
      <div style={{ background: "#1e3a8a", color: "#fff", padding: "12px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              background: "#fff",
              color: "#1e3a8a",
              borderRadius: "50%",
              width: 22,
              height: 22,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 13,
              fontWeight: 700,
            }}
          >
            {number}
          </span>
          <span style={{ fontWeight: 700, fontSize: 15 }}>{title}</span>
        </div>
        <div style={{ fontSize: 12.5, opacity: 0.85, marginTop: 4 }}>{subtitle}</div>
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

        {!loading && !error && (
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
                최신 값 ({latestDateLabel})
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 22, fontWeight: 800 }}>{valueLabel}</span>
                {changeLabel && (
                  <span
                    style={{
                      fontSize: 12.5,
                      color: changeIsUp ? "#dc2626" : "#16a34a",
                      fontWeight: 600,
                    }}
                  >
                    (전주 대비 {changeLabel})
                  </span>
                )}
              </div>
            </div>

            <div>
              <div style={{ fontSize: 11.5, color: "#6b7280", marginBottom: 4 }}>
                최근 4주 추이
              </div>
              <Sparkline points={sparklinePoints} color={sparklineColor} />
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
                ▲ {interpretation}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
