"use client";

import { useEffect, useState } from "react";

const MIN_FEE = 0.05; // 연준 대차 최저 수수료(%)

function fmtEok(usd) {
  if (usd == null) return "-";
  return `${(usd / 1e8).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}억 달러`;
}

function fmtRate(v) {
  return v == null ? "-" : `${v.toFixed(3)}%`;
}

export default function SecLendingCard() {
  const [state, setState] = useState({ loading: true, error: null, data: null });

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/sec-lending", { cache: "no-store" });
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
  const topRate = data?.topByRate?.[0]?.rate ?? null;
  const hasShortfall = (data?.shortfalls?.length ?? 0) > 0;
  const feeUp = topRate != null && topRate > MIN_FEE * 2;
  const bad = hasShortfall || feeUp;

  const interpretation = !data
    ? ""
    : hasShortfall
    ? "신청보다 적게 배정된 종목 있음. 특정 국채 희소 신호"
    : feeUp
    ? "일부 종목 수수료 상승. 해당 CUSIP 수요 집중 여부 확인"
    : "전 종목 신청량 전액 배정, 수수료 낮음. 쏠림 신호 없음";

  const cell = { padding: "5px 4px", borderBottom: "1px solid #f3f4f6" };
  const num = { ...cell, textAlign: "right", whiteSpace: "nowrap" };

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
              flexShrink: 0,
            }}
          >
            13
          </span>
          <span style={{ fontWeight: 700, fontSize: 15 }}>Fed 국채 대차 수요 (CUSIP별)</span>
        </div>
        <div style={{ fontSize: 12.5, opacity: 0.85, marginTop: 4 }}>
          딜러가 연준에서 특정 국채를 빌린 결과. 수수료가 높을수록 그 국채가 귀하다는 뜻
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
            <div
              style={{
                background: "#f9fafb",
                border: "1px solid #eef0f2",
                borderRadius: 10,
                padding: "10px 12px",
              }}
            >
              <div style={{ fontSize: 11.5, color: "#6b7280", marginBottom: 4 }}>
                최고 수수료 ({data.latestDate})
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 22, fontWeight: 800 }}>{fmtRate(topRate)}</span>
                {topRate != null && (
                  <span style={{ fontSize: 12.5, color: feeUp ? "#dc2626" : "#16a34a", fontWeight: 600 }}>
                    (최저 수수료의 {(topRate / MIN_FEE).toFixed(1)}배)
                  </span>
                )}
              </div>
              <div style={{ fontSize: 11.5, color: "#6b7280", marginTop: 4 }}>
                총 배정 {fmtEok(data.totalAccepted)}, {data.count}개 종목
              </div>
            </div>

            <div>
              <div style={{ fontSize: 11.5, color: "#6b7280", marginBottom: 4 }}>수수료 높은 순 상위 5개</div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
                  <thead>
                    <tr style={{ color: "#6b7280" }}>
                      <th style={{ ...cell, textAlign: "left", fontWeight: 500 }}>종목</th>
                      <th style={{ ...num, fontWeight: 500 }}>신청</th>
                      <th style={{ ...num, fontWeight: 500 }}>배정</th>
                      <th style={{ ...num, fontWeight: 500 }}>수수료</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.topByRate.map((r) => (
                      <tr key={r.cusip}>
                        <td style={cell}>
                          <div>{r.description}</div>
                          <div style={{ color: "#9ca3af", fontSize: 10.5 }}>{r.cusip}</div>
                        </td>
                        <td style={num}>{fmtEok(r.submitted)}</td>
                        <td style={{ ...num, color: r.submitted > r.accepted ? "#dc2626" : undefined }}>
                          {fmtEok(r.accepted)}
                        </td>
                        <td style={{ ...num, fontWeight: 700 }}>{fmtRate(r.rate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {data.biggest && (
              <div style={{ fontSize: 12, lineHeight: 1.5 }}>
                <span style={{ fontWeight: 600 }}>물량 최대: </span>
                {data.biggest.description} ({data.biggest.cusip}) {fmtEok(data.biggest.accepted)}, 수수료{" "}
                {fmtRate(data.biggest.rate)}
              </div>
            )}

            {hasShortfall && (
              <div style={{ fontSize: 12, lineHeight: 1.5, color: "#dc2626" }}>
                <div style={{ fontWeight: 600 }}>신청 대비 덜 배정된 종목</div>
                {data.shortfalls.slice(0, 3).map((r) => (
                  <div key={r.cusip}>
                    {r.description} ({r.cusip}): 신청 {fmtEok(r.submitted)} / 배정 {fmtEok(r.accepted)}
                  </div>
                ))}
              </div>
            )}

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
              <div style={{ color: bad ? "#dc2626" : "#16a34a", fontWeight: 700 }}>▲ {interpretation}</div>
              <div style={{ fontSize: 10.5, color: "#9ca3af", marginTop: 6 }}>
                최저 수수료 {MIN_FEE.toFixed(3)}%의 2배를 넘는 종목이 있으면 경계로 표시합니다.
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
