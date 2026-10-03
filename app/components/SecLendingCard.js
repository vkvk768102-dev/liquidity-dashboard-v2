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

const TAG_STYLE = {
  otr: { background: "#dbeafe", color: "#1d4ed8" },
  offrun: { background: "#f1f5f9", color: "#475569" },
  ctd: { background: "#f3e8ff", color: "#7e22ce" },
};

function Tags({ tags }) {
  if (!tags || !tags.length) return null;
  return (
    <span style={{ display: "inline-flex", gap: 4, marginLeft: 4, verticalAlign: "middle", flexWrap: "wrap" }}>
      {tags.map((t) => (
        <span
          key={t.label}
          style={{
            ...(TAG_STYLE[t.type] ?? TAG_STYLE.offrun),
            fontSize: 10,
            fontWeight: 700,
            padding: "1px 6px",
            borderRadius: 999,
            whiteSpace: "nowrap",
          }}
        >
          {t.label}
        </span>
      ))}
    </span>
  );
}

function readCtdConfig() {
  try {
    const raw = localStorage.getItem("treasury-basis-ctd-config");
    const c = raw ? JSON.parse(raw) : null;
    return { ctdCoupon: c?.ctdCoupon ?? "4.5", ctdMaturity: c?.ctdMaturity ?? "2033-08-31" };
  } catch {
    return { ctdCoupon: "4.5", ctdMaturity: "2033-08-31" };
  }
}

function fmtMD(d) {
  if (!d) return "";
  const [, m, day] = d.split("-");
  return `${Number(m)}/${Number(day)}`;
}

// 끝에서부터 수수료가 연속으로 오른 날 수
function risingStreak(history) {
  const rates = history.map((h) => h.rate).filter((r) => r != null);
  let n = 0;
  for (let i = rates.length - 1; i > 0; i--) {
    if (rates[i] > rates[i - 1]) n += 1;
    else break;
  }
  return n;
}

function TrendTable({ item }) {
  const streak = risingStreak(item.history);
  const th = { padding: "4px 6px", fontWeight: 500, color: "#6b7280", textAlign: "right", whiteSpace: "nowrap" };
  const td = { padding: "4px 6px", textAlign: "right", whiteSpace: "nowrap", borderTop: "1px solid #f3f4f6" };
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 12, fontWeight: 600 }}>
        {item.description} <span style={{ color: "#9ca3af", fontWeight: 400 }}>{item.cusip}</span>
        <Tags tags={item.tags} />
      </div>
      {streak >= 2 && (
        <div style={{ fontSize: 11.5, color: "#dc2626", fontWeight: 600 }}>수수료 {streak}일 연속 상승</div>
      )}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: "left" }}></th>
              {item.history.map((h) => (
                <th key={h.date} style={th}>{fmtMD(h.date)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ ...td, textAlign: "left", color: "#6b7280" }}>신청</td>
              {item.history.map((h) => {
                const short = h.submitted > h.accepted;
                return (
                  <td key={h.date} style={{ ...td, color: short ? "#dc2626" : undefined, fontWeight: short ? 700 : 400 }}>
                    {h.submitted > 0 ? (h.submitted / 1e8).toLocaleString("ko-KR", { maximumFractionDigits: 1 }) : "-"}
                  </td>
                );
              })}
            </tr>
            <tr>
              <td style={{ ...td, textAlign: "left", color: "#6b7280" }}>배정</td>
              {item.history.map((h) => (
                <td key={h.date} style={td}>
                  {h.accepted > 0 ? (h.accepted / 1e8).toLocaleString("ko-KR", { maximumFractionDigits: 1 }) : "-"}
                </td>
              ))}
            </tr>
            <tr>
              <td style={{ ...td, textAlign: "left", color: "#6b7280" }}>수수료</td>
              {item.history.map((h) => (
                <td key={h.date} style={{ ...td, fontWeight: 700 }}>{h.rate != null ? h.rate.toFixed(3) : "-"}</td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function SecLendingCard() {
  const [state, setState] = useState({ loading: true, error: null, data: null });

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const qs = new URLSearchParams(readCtdConfig()).toString();
        const res = await fetch(`/api/sec-lending?${qs}`, { cache: "no-store" });
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
                          <div>
                            {r.description}
                            <Tags tags={r.tags} />
                          </div>
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
                {data.biggest.description}
                <Tags tags={data.biggest.tags} /> ({data.biggest.cusip}) {fmtEok(data.biggest.accepted)}, 수수료{" "}
                {fmtRate(data.biggest.rate)}
              </div>
            )}

            {data.benchmarks?.length > 0 && (
              <div>
                <div style={{ fontSize: 11.5, color: "#6b7280", marginBottom: 4 }}>최신물·CTD 오늘 현황</div>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
                    <thead>
                      <tr style={{ color: "#6b7280" }}>
                        <th style={{ ...cell, textAlign: "left", fontWeight: 500 }}>구분</th>
                        <th style={{ ...cell, textAlign: "left", fontWeight: 500 }}>종목</th>
                        <th style={{ ...num, fontWeight: 500 }}>배정</th>
                        <th style={{ ...num, fontWeight: 500 }}>수수료</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.benchmarks.map((b) => (
                        <tr key={b.kind + b.cusip}>
                          <td style={{ ...cell, whiteSpace: "nowrap", fontWeight: 600 }}>{b.kind}</td>
                          <td style={cell}>
                            <div>{b.description || "-"}</div>
                            <div style={{ color: "#9ca3af", fontSize: 10.5 }}>{b.cusip}</div>
                          </td>
                          {b.listed && b.accepted > 0 ? (
                            <>
                              <td style={{ ...num, color: b.submitted > b.accepted ? "#dc2626" : undefined }}>
                                {fmtEok(b.accepted)}
                              </td>
                              <td style={{ ...num, fontWeight: 700, color: b.rate != null && b.rate > MIN_FEE * 2 ? "#dc2626" : undefined }}>
                                {fmtRate(b.rate)}
                              </td>
                            </>
                          ) : (
                            <td style={{ ...num, color: "#9ca3af" }} colSpan={2}>
                              오늘 대차 없음
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{ fontSize: 10.5, color: "#9ca3af", marginTop: 4, lineHeight: 1.6 }}>
                  최신물 = 가장 최근 발행된 국채, 직전물 = 바로 전에 발행된 국채(재무부 입찰 자료로 자동 판별).
                  {data.ctdAuto
                    ? ` CTD = 국채선물별 인도에 가장 싼 국채를 재무부 금리곡선으로 자동 추정(${data.ctdDeliveryMonth} 인도월 기준). 실제 CTD와 다를 수 있어요.`
                    : " CTD = 자동 추정에 실패해 Treasury Basis 카드 설정값(10년 선물)을 사용 중이에요."}
                  {!data.otrAvailable && " (오늘은 재무부 자료를 불러오지 못해 최신물 구분이 빠졌어요)"}
                </div>
              </div>
            )}

            {data.tracked?.length > 0 && data.tracked[0].history.length > 1 && (
              <div>
                <div style={{ fontSize: 11.5, color: "#6b7280", marginBottom: 6 }}>
                  주목 종목 최근 추이 (신청·배정: 억 달러, 수수료: %)
                </div>
                {data.tracked.map((item) => (
                  <TrendTable key={item.cusip} item={item} />
                ))}
                <div style={{ fontSize: 10.5, color: "#9ca3af" }}>
                  신청이 빨간색인 날은 신청보다 적게 배정된 날(못 빌린 수요가 있었던 날)이에요.
                </div>
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
