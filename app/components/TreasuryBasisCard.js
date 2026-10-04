"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "treasury-basis-ctd-config";
const LEVEL_COLOR = { ok: "#12b76a", watch: "#fdb022", bad: "#f04438" };
const LEVEL_LABEL = { ok: "정상", watch: "주의", bad: "경계" };

const DEFAULT_CONFIG = {
  mode: "auto", // auto = CTD 자동 선택, manual = 직접 입력
  ctdCoupon: "3.875",
  ctdMaturity: "2033-08-15",
  cf: "0.8870",
  futuresSymbol: "ZN=F",
};

function fmtMDY(d) {
  if (!d) return "";
  const [y, m, day] = d.split("-");
  return `${m}/${day}/${y.slice(2)}`;
}
function fmtMD(d) {
  if (!d) return "";
  const [, m, day] = d.split("-");
  return `${Number(m)}/${Number(day)}`;
}

function BasisChart({ history }) {
  if (!history || history.length < 2) return null;
  const w = 320;
  const h = 130;
  const left = 36;
  const right = 10;
  const top = 14;
  const bottom = 22;

  const vals = history.map((p) => p.basis);
  let lo = Math.min(...vals, 0);
  let hi = Math.max(...vals, 0);
  const pad = Math.max((hi - lo) * 0.15, 0.02);
  lo -= pad;
  hi += pad;
  const xAt = (i) => left + (i * (w - left - right)) / (history.length - 1);
  const yAt = (v) => top + (1 - (v - lo) / (hi - lo)) * (h - top - bottom);
  const path = history.map((p, i) => `${i === 0 ? "M" : "L"} ${xAt(i)} ${yAt(p.basis)}`).join(" ");
  const ticks = [lo + pad, (lo + hi) / 2, hi - pad];
  const labelEvery = Math.ceil(history.length / 5);

  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} style={{ display: "block" }}>
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={left} x2={w - right} y1={yAt(t)} y2={yAt(t)} stroke="#262a33" />
          <text x={left - 4} y={yAt(t) + 3} fontSize="9" fill="#667085" textAnchor="end">
            {t.toFixed(2)}
          </text>
        </g>
      ))}
      {lo < 0 && hi > 0 && <line x1={left} x2={w - right} y1={yAt(0)} y2={yAt(0)} stroke="#475467" strokeDasharray="3 3" />}
      <path d={path} fill="none" stroke="#2970ff" strokeWidth="2" />
      {history.map((p, i) => (
        <g key={p.date}>
          {p.ctdChanged ? (
            <circle cx={xAt(i)} cy={yAt(p.basis)} r="4.5" fill="#a855f7" />
          ) : (
            i === history.length - 1 && <circle cx={xAt(i)} cy={yAt(p.basis)} r="3.5" fill="#2970ff" />
          )}
          {(i % labelEvery === 0 || i === history.length - 1) && (
            <text x={xAt(i)} y={h - 5} fontSize="9" fill="#98a2b3" textAnchor="middle">
              {fmtMD(p.date)}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}

export default function TreasuryBasisCard() {
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [editing, setEditing] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchBasis = async (cfg) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        mode: cfg.mode ?? "auto",
        ctdCoupon: cfg.ctdCoupon,
        ctdMaturity: cfg.ctdMaturity,
        cf: cfg.cf,
        futuresSymbol: cfg.futuresSymbol,
      });
      const res = await fetch(`/api/treasury-basis?${params.toString()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "계산 실패");
      setData(json);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  // 저장된 설정 불러온 뒤 계산 (예전 설정에는 mode가 없으므로 자동으로 시작)
  useEffect(() => {
    let cfg = DEFAULT_CONFIG;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) cfg = { ...DEFAULT_CONFIG, ...JSON.parse(saved) };
      if (!cfg.mode) cfg.mode = "auto";
    } catch {
      // ignore
    }
    setConfig(cfg);
    fetchBasis(cfg);
  }, []);

  const save = (cfg) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
    } catch {
      // ignore
    }
    setConfig(cfg);
    setEditing(false);
    fetchBasis(cfg);
  };

  const auto = (config.mode ?? "auto") === "auto";
  const hist = data?.history ?? [];
  const first = hist[0];
  const change4w = first && data ? data.grossBasis - first.basis : null;
  const changes = hist.filter((h) => h.ctdChanged);
  const sig = data?.signal ?? null;

  return (
    <div style={styles.card}>
      <div style={styles.header}>
        <h3 style={styles.title}>Treasury Basis (10Y)</h3>
        <button style={styles.editBtn} onClick={() => setEditing((v) => !v)}>
          {editing ? "닫기" : auto ? "CTD 자동" : "CTD 수동"}
        </button>
      </div>

      {editing && (
        <div style={styles.editBox}>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              style={{ ...styles.modeBtn, ...(auto ? styles.modeOn : {}) }}
              onClick={() => save({ ...config, mode: "auto" })}
            >
              자동 (추천)
            </button>
            <button
              style={{ ...styles.modeBtn, ...(!auto ? styles.modeOn : {}) }}
              onClick={() => setConfig({ ...config, mode: "manual" })}
            >
              수동 입력
            </button>
          </div>

          {auto ? (
            <p style={styles.hint}>
              매일 재무부 실제 종가와 선물 종가로 Implied Repo가 가장 높은 국채를 CTD로 자동 선택해요. 따로
              입력할 필요 없어요.
            </p>
          ) : (
            <>
              <label style={styles.label}>
                CTD 쿠폰(%)
                <input style={styles.input} value={config.ctdCoupon} onChange={(e) => setConfig({ ...config, ctdCoupon: e.target.value })} />
              </label>
              <label style={styles.label}>
                CTD 만기일
                <input
                  style={styles.input}
                  type="date"
                  value={config.ctdMaturity}
                  onChange={(e) => setConfig({ ...config, ctdMaturity: e.target.value })}
                />
              </label>
              <label style={styles.label}>
                Conversion Factor
                <input style={styles.input} value={config.cf} onChange={(e) => setConfig({ ...config, cf: e.target.value })} />
              </label>
              <p style={styles.hint}>CME Treasury Analytics의 파란 줄(CTD) 값을 그대로 넣으세요.</p>
              <button style={styles.saveBtn} onClick={() => save({ ...config, mode: "manual" })}>
                저장 & 재계산
              </button>
            </>
          )}
        </div>
      )}

      {loading && <div style={styles.loading}>불러오는 중...</div>}
      {error && <div style={styles.error}>{error}</div>}

      {data && !loading && (
        <div style={styles.body}>
          <div style={styles.ctdBox}>
            <div style={{ fontSize: 11, color: "#98a2b3" }}>CTD ({data.mode === "auto" ? "자동 선택" : "수동 설정"})</div>
            <div style={{ fontSize: 14, fontWeight: 700, marginTop: 2 }}>
              T {Number(data.ctdCoupon).toFixed(3)} {fmtMDY(data.ctdMaturity)}
              {data.ctdCusip && <span style={{ fontSize: 11, color: "#667085", fontWeight: 400 }}> {data.ctdCusip}</span>}
            </div>
            {data.runnerUp && data.gap != null && Math.abs(data.gap) < 0.1 && (
              <div style={{ fontSize: 10.5, color: "#fdb022", marginTop: 3, lineHeight: 1.4 }}>
                2위 후보 T {Number(data.runnerUp.coupon).toFixed(3)} {fmtMDY(data.runnerUp.maturity)}와 차이가 작아요
                (Implied Repo {Math.abs(data.gap).toFixed(2)}%p 차이). 0.05%p 넘게 앞서야 CTD를 바꿔요.
              </div>
            )}
          </div>

          <div style={styles.row}>
            <span style={styles.label2}>
              선물가격 ({data.futuresSymbol}{data.priceDate ? `, ${fmtMD(data.priceDate)} 종가` : ""})
            </span>
            <span>{data.futuresPriceTicks}</span>
          </div>
          <div style={styles.row}>
            <span style={styles.label2}>현물가격 ({data.method === "실제 종가" ? "실제 종가" : "추정"})</span>
            <span>{data.cashPriceTicks}</span>
          </div>
          <div style={styles.row}>
            <span style={styles.label2}>CF</span>
            <span>{data.cf}</span>
          </div>
          {data.impliedRepo != null && (
            <div style={styles.row}>
              <span style={styles.label2}>Implied Repo</span>
              <span>{data.impliedRepo.toFixed(2)}%</span>
            </div>
          )}
          {sig?.sofr != null && (
            <div style={styles.row}>
              <span style={styles.label2}>SOFR (레포 조달금리)</span>
              <span>{Number(sig.sofr).toFixed(2)}%</span>
            </div>
          )}
          <div style={styles.mainRow}>
            <span>Gross Basis</span>
            <span>
              {data.grossBasis >= 0 ? "+" : ""}
              {data.grossBasis} ({data.grossBasisTicks})
            </span>
          </div>

          {sig && (
            <div style={{ ...styles.ctdBox, marginTop: 6, borderLeft: `3px solid ${LEVEL_COLOR[sig.level]}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#98a2b3" }}>
                <span>베이시스 거래 매력도 (Implied Repo − SOFR, 최근 5일 중앙값)</span>
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 2 }}>
                <span style={{ fontSize: 18, fontWeight: 800, color: LEVEL_COLOR[sig.level] }}>
                  {sig.spreadBp >= 0 ? "+" : ""}
                  {sig.spreadBp}bp
                </span>
                <span style={{ fontSize: 11, fontWeight: 700, color: LEVEL_COLOR[sig.level] }}>{LEVEL_LABEL[sig.level]}</span>
              </div>
              <div style={{ fontSize: 11.5, color: "#e4e7ec", marginTop: 2, lineHeight: 1.4 }}>{sig.message}</div>
              {sig.spreadTodayBp != null && (
                <div style={{ fontSize: 11, color: "#98a2b3", marginTop: 4, lineHeight: 1.4 }}>
                  가장 최근 종가일{sig.latestDate ? `(${fmtMD(sig.latestDate)})` : ""} 하루 값: {sig.spreadTodayBp >= 0 ? "+" : ""}
                  {sig.spreadTodayBp}bp
                </div>
              )}
              {sig.unstable && (
                <div style={{ fontSize: 10.5, color: "#fdb022", marginTop: 2, lineHeight: 1.4 }}>
                  최근 5일 값이 서로 크게 달라요. 가격 데이터 오차일 수 있으니 참고만 하세요.
                </div>
              )}
              <div style={{ fontSize: 10, color: "#667085", marginTop: 4, lineHeight: 1.4 }}>
                ±25bp 안이면 정상, 25~50bp 주의, 50bp 이상 경계. 마이너스면 레포로 돈 빌려 베이시스 거래 시 손해, 플러스면 이익. 미국 장이 끝나 확정된 종가로만 계산해서 하루에 한 번만 바뀌어요.
              </div>
            </div>
          )}

          {hist.length >= 2 && (
            <div style={{ marginTop: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#98a2b3", marginBottom: 2 }}>
                <span>최근 4주 추이</span>
                {change4w != null && (
                  <span>
                    4주 전 대비 {change4w >= 0 ? "+" : ""}
                    {change4w.toFixed(4)}
                  </span>
                )}
              </div>
              <BasisChart history={hist} />
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", fontSize: 10, color: "#667085" }}>
                <span><span style={{ color: "#a855f7" }}>●</span> CTD 바뀐 날</span>
                <span><span style={{ color: "#475467" }}>- -</span> 0선</span>
              </div>
              {changes.length > 0 && (
                <div style={{ fontSize: 10.5, color: "#c4b5fd", marginTop: 4, lineHeight: 1.5 }}>
                  {changes.map((c) => (
                    <div key={c.date}>
                      {fmtMD(c.date)} CTD 변경 → T {Number(c.coupon).toFixed(3)} {fmtMDY(c.maturity)}
                    </div>
                  ))}
                  <div style={{ color: "#667085" }}>CTD가 바뀐 날의 움직임은 종목 교체 때문일 수 있어요.</div>
                </div>
              )}
            </div>
          )}

          <div style={styles.footnote}>{data.note}</div>
        </div>
      )}
    </div>
  );
}

const styles = {
  card: {
    background: "#12151c",
    border: "1px solid #262a33",
    borderRadius: 12,
    padding: 16,
    color: "#e4e7ec",
    fontFamily: "-apple-system, sans-serif",
    maxWidth: 360,
  },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  title: { margin: 0, fontSize: 15 },
  editBtn: {
    background: "transparent",
    border: "1px solid #363b46",
    color: "#98a2b3",
    fontSize: 11,
    borderRadius: 6,
    padding: "4px 8px",
    cursor: "pointer",
  },
  editBox: { marginTop: 12, display: "flex", flexDirection: "column", gap: 8 },
  modeBtn: {
    flex: 1,
    background: "#1a1e27",
    border: "1px solid #363b46",
    color: "#98a2b3",
    fontSize: 12,
    borderRadius: 6,
    padding: "6px 8px",
    cursor: "pointer",
  },
  modeOn: { background: "#2970ff", borderColor: "#2970ff", color: "white", fontWeight: 700 },
  label: { fontSize: 11, color: "#98a2b3", display: "flex", flexDirection: "column", gap: 4 },
  input: {
    background: "#1a1e27",
    border: "1px solid #363b46",
    borderRadius: 6,
    padding: "6px 8px",
    color: "#e4e7ec",
    fontSize: 13,
  },
  hint: { fontSize: 10.5, color: "#667085", margin: "4px 0", lineHeight: 1.5 },
  saveBtn: {
    background: "#2970ff",
    color: "white",
    border: "none",
    borderRadius: 6,
    padding: "8px",
    fontSize: 12,
    cursor: "pointer",
  },
  loading: { fontSize: 12, color: "#667085", marginTop: 12 },
  error: { fontSize: 12, color: "#f04438", marginTop: 12 },
  body: { marginTop: 12, display: "flex", flexDirection: "column", gap: 6 },
  ctdBox: { background: "#1a1e27", borderRadius: 8, padding: "8px 10px", marginBottom: 4 },
  row: { display: "flex", justifyContent: "space-between", fontSize: 12, color: "#98a2b3" },
  label2: {},
  mainRow: {
    display: "flex",
    justifyContent: "space-between",
    fontSize: 16,
    fontWeight: 700,
    borderTop: "1px solid #262a33",
    marginTop: 6,
    paddingTop: 8,
  },
  footnote: { fontSize: 10, color: "#667085", marginTop: 4, lineHeight: 1.4 },
};
