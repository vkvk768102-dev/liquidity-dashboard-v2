"use client";

import { useEffect, useState } from "react";

const NAVY = "#1e3a8a";
const SHORT_DROP_ALERT = 0.05; // 숏이 한 주에 5% 넘게 줄면 경고 (청산 가능성)

function man(v) {
  if (v == null) return "-";
  return (v / 10000).toLocaleString("ko-KR", { maximumFractionDigits: 1 });
}

function manDiff(v) {
  if (v == null) return "";
  const s = (Math.abs(v) / 10000).toLocaleString("ko-KR", { maximumFractionDigits: 1 });
  return `${v >= 0 ? "+" : "-"}${s}`;
}

function fmtMD(d) {
  if (!d) return "";
  const [, m, day] = d.split("-");
  return `${Number(m)}/${Number(day)}`;
}

function ContractTable({ c }) {
  const prevShort = c.points.length > 1 ? c.points[c.points.length - 2].short : null;
  const shortDrop =
    c.changeShort != null && prevShort ? -c.changeShort / prevShort : 0;
  const alert = shortDrop > SHORT_DROP_ALERT;

  const th = { padding: "4px 6px", fontWeight: 500, color: "#6b7280", textAlign: "right", whiteSpace: "nowrap" };
  const td = { padding: "4px 6px", textAlign: "right", whiteSpace: "nowrap", borderTop: "1px solid #f3f4f6" };
  const label = { ...td, textAlign: "left", color: "#6b7280" };

  const rows = [
    { key: "long", name: "롱", change: c.changeLong },
    { key: "short", name: "숏", change: c.changeShort },
    { key: "net", name: "순", change: c.changeNet, bold: true },
  ];

  return (
    <div style={{ paddingBottom: 10, borderBottom: "1px solid #eef0f2" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <div style={{ fontSize: 12.5, fontWeight: 700 }}>
          {c.label} <span style={{ color: "#9ca3af", fontWeight: 400, fontSize: 11 }}>{c.name}</span>
        </div>
        <div style={{ fontSize: 10.5, color: "#9ca3af" }}>{c.link}</div>
      </div>
      {alert && (
        <div style={{ fontSize: 11.5, color: "#dc2626", fontWeight: 700, marginTop: 2 }}>
          숏 {(shortDrop * 100).toFixed(1)}% 급감. 포지션 청산 가능성 주의
        </div>
      )}
      {c.points.length === 0 ? (
        <div style={{ fontSize: 11.5, color: "#9ca3af", marginTop: 4 }}>데이터 없음</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
            <thead>
              <tr>
                <th style={{ ...th, textAlign: "left" }}></th>
                {c.points.map((p) => (
                  <th key={p.date} style={th}>{fmtMD(p.date)}</th>
                ))}
                <th style={th}>전주 대비</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td style={label}>{r.name}</td>
                  {c.points.map((p) => (
                    <td key={p.date} style={{ ...td, fontWeight: r.bold ? 700 : 400 }}>{man(p[r.key])}</td>
                  ))}
                  <td
                    style={{
                      ...td,
                      fontWeight: 600,
                      color:
                        r.key === "short" && alert
                          ? "#dc2626"
                          : r.change == null || r.change === 0
                          ? "#6b7280"
                          : "#374151",
                    }}
                  >
                    {manDiff(r.change)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function CftcTreasuryCard() {
  const [state, setState] = useState({ loading: true, error: null, data: null });

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/cftc-treasury", { cache: "no-store" });
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
            14
          </span>
          <span style={{ fontWeight: 700, fontSize: 15 }}>국채선물 헤지펀드 포지션 (6종)</span>
        </div>
        <div style={{ fontSize: 12.5, opacity: 0.85, marginTop: 4 }}>
          CFTC TFF 레버리지드펀드 롱·숏 4주 추이. 숏은 보통 베이시스 거래(현물 매수 + 선물 매도)의 짝
        </div>
      </div>

      <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
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
            <div style={{ fontSize: 11.5, color: "#6b7280" }}>
              기준일 {data.latestDate} (화요일) · 단위: 만 계약 · 순 = 롱 − 숏
            </div>
            {data.contracts.map((c) => (
              <ContractTable key={c.code} c={c} />
            ))}
            <div style={{ fontSize: 10.5, color: "#9ca3af", lineHeight: 1.6 }}>
              매주 금요일 오후(미국) 발표, 한국 시간 토요일 새벽 반영. 숏이 한 주에 5% 넘게 줄면 빨간색으로
              경고합니다(베이시스 거래 청산 가능성).
            </div>
          </>
        )}
      </div>
    </div>
  );
}
