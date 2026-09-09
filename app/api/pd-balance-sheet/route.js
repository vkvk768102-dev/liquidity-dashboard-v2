// 데이터 출처: 뉴욕 연준 공식 Markets Data API (markets.newyorkfed.org). API 키 불필요.
// 지표 정의: 프라이머리 딜러(증권사) 보유 자산
//   - 국채 보유 = PDPOSGST-TOT (국채 순포지션)
//   - 총자산(프록시) = 국채 + 연방기관채(PDPOSFGS-TOT) + MBS(PDPOSMBS-TOT)
//                     + 회사채(PDPOSCS-TOT) + ABS(PDPOSABS-TOT) 순포지션 합계
//   - [참고] "총자산"은 공식 발표 항목이 아니라, PD 통계가 다루는 주요 자산군 순포지션을
//     모두 더한 근사치입니다. 다른 자산군(주식, 지방채 등)은 규모가 작아 제외했습니다.
const BASE = "https://markets.newyorkfed.org/api/pd/get/asof";
const UST_KEY = "PDPOSGST-TOT";
const OTHER_KEYS = ["PDPOSFGS-TOT", "PDPOSMBS-TOT", "PDPOSCS-TOT", "PDPOSABS-TOT"];

function lastWednesdays(count) {
  const dates = [];
  const d = new Date();
  while (dates.length < count) {
    if (d.getDay() === 3) dates.push(new Date(d));
    d.setDate(d.getDate() - 1);
  }
  return dates.map((dt) => dt.toISOString().slice(0, 10));
}

function extractValue(json, keyid) {
  let list = null;
  if (Array.isArray(json)) list = json;
  else if (json && Array.isArray(json.pd)) list = json.pd;
  else if (json && json.pd && Array.isArray(json.pd.timeseries)) list = json.pd.timeseries;
  else if (json && Array.isArray(json.timeseries)) list = json.timeseries;
  if (!list) return null;
  const row = list.find((r) => (r.keyid || r.key || r.timeSeries || r["Time Series"]) === keyid);
  if (!row) return null;
  const raw = row.value ?? row.Value ?? row["Value (millions)"];
  const num = typeof raw === "string" ? parseFloat(raw.replace(/[^0-9.-]/g, "")) : raw;
  return Number.isFinite(num) ? num : null;
}

async function fetchAsOf(date) {
  try {
    const res = await fetch(`${BASE}/${date}.json`, { cache: "no-store" });
    if (!res.ok) return null;
    const json = await res.json();
    const ust = extractValue(json, UST_KEY);
    if (ust == null) return null;
    let total = ust;
    let allFound = true;
    for (const k of OTHER_KEYS) {
      const v = extractValue(json, k);
      if (v == null) { allFound = false; continue; }
      total += v;
    }
    return { date, ust, total: allFound ? total : null };
  } catch (e) {
    return null;
  }
}

export async function GET() {
  try {
    const candidateDates = lastWednesdays(8);
    const results = await Promise.all(candidateDates.map(fetchAsOf));
    const valid = results.filter(Boolean).sort((a, b) => (a.date > b.date ? 1 : -1));

    if (valid.length === 0) {
      return Response.json({ ok: false, error: "원본 데이터를 가져오지 못했습니다 (NY Fed Primary Dealer 통계)." }, { status: 502 });
    }

    const last4 = valid.slice(-4);
    const points = last4.map((r) => ({ date: r.date, total: r.total, ust: r.ust }));

    const latest = points[points.length - 1];
    const prev = points.length > 1 ? points[points.length - 2] : null;
    const changeTotal = prev && latest.total != null && prev.total != null ? latest.total - prev.total : null;
    const changeUst = prev && latest.ust != null && prev.ust != null ? latest.ust - prev.ust : null;

    return Response.json({
      ok: true,
      latestDate: latest.date,
      latestTotal: latest.total, // 단위: 백만 달러
      latestUst: latest.ust, // 단위: 백만 달러
      changeTotal,
      changeUst,
      points,
      sourceNote: "NY Fed 공식 Markets Data API - 프라이머리 딜러 자산 (국채+연방기관채+MBS+회사채+ABS 순포지션 합계, 근사치)",
    });
  } catch (e) {
    return Response.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
