"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "treasury-basis-ctd-config";

const DEFAULT_CONFIG = {
  ctdCoupon: "4.5",
  ctdMaturity: "2033-08-31",
  cf: "0.9202",
  futuresSymbol: "ZN=F",
};

export default function TreasuryBasisCard() {
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [editing, setEditing] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // 저장된 CTD 설정 불러오기
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setConfig(JSON.parse(saved));
    } catch (e) {
      // ignore
    }
  }, []);

  const fetchBasis = async (cfg) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
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

  useEffect(() => {
    fetchBasis(config);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    setEditing(false);
    fetchBasis(config);
  };

  return (
    <div style={styles.card}>
      <div style={styles.header}>
        <h3 style={styles.title}>Treasury Basis (10Y)</h3>
        <button style={styles.editBtn} onClick={() => setEditing((v) => !v)}>
          {editing ? "닫기" : "CTD 설정"}
        </button>
      </div>

      {editing && (
        <div style={styles.editBox}>
          <label style={styles.label}>
            CTD 쿠폰(%)
            <input
              style={styles.input}
              value={config.ctdCoupon}
              onChange={(e) => setConfig({ ...config, ctdCoupon: e.target.value })}
            />
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
            <input
              style={styles.input}
              value={config.cf}
              onChange={(e) => setConfig({ ...config, cf: e.target.value })}
            />
          </label>
          <p style={styles.hint}>
            CME Treasury Analytics → Delivery Basket에서 분기마다 CTD가 바뀔 때 갱신하세요.
          </p>
          <button style={styles.saveBtn} onClick={handleSave}>
            저장 & 재계산
          </button>
        </div>
      )}

      {loading && <div style={styles.loading}>불러오는 중...</div>}
      {error && <div style={styles.error}>{error}</div>}

      {data && !loading && (
        <div style={styles.body}>
          <div style={styles.row}>
            <span style={styles.label2}>선물가격 ({data.futuresSymbol})</span>
            <span>{data.futuresPriceTicks}</span>
          </div>
          <div style={styles.row}>
            <span style={styles.label2}>현물가격 (추정)</span>
            <span>{data.cashPriceTicks}</span>
          </div>
          <div style={styles.row}>
            <span style={styles.label2}>CF</span>
            <span>{data.cf}</span>
          </div>
          <div style={styles.mainRow}>
            <span>Gross Basis</span>
            <span style={{ color: data.grossBasis >= 0 ? "#12b76a" : "#f04438" }}>
              {data.grossBasis >= 0 ? "+" : ""}
              {data.grossBasis} ({data.grossBasisTicks})
            </span>
          </div>
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
  label: { fontSize: 11, color: "#98a2b3", display: "flex", flexDirection: "column", gap: 4 },
  input: {
    background: "#1a1e27",
    border: "1px solid #363b46",
    borderRadius: 6,
    padding: "6px 8px",
    color: "#e4e7ec",
    fontSize: 13,
  },
  hint: { fontSize: 10, color: "#667085", margin: "4px 0" },
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
  row: { display: "flex", justifyContent: "space-between", fontSize: 12, color: "#98a2b3" },
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
