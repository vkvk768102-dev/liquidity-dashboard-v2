// 데이터 출처: 뉴욕 연준 공식 Markets Data API (markets.newyorkfed.org). API 키 불필요.
// 지표 정의: 프라이머리 딜러의 "국채(TIPS 제외) 레포 자금조달" 중 만기별 비중
//   - 하루짜리·자동연장(Overnight and Continuing) / 30일 미만 / 30일 이상
//   - 거래 방식 8종(청산 안 되는 양자간, 청산되는 양자간, GCF, 트라이파티)의 값을 모두 합산
//   - 항목 이름 규칙: PDSORA-{방식}UTSET{기간}  (기간: 없음=하루짜리, TAL30=30일 미만, TAG30=30일 이상)
const BASE = "https://markets.newyorkfed.org/api/pd/get/asof";

// UBS/UBG = 청산 안 되는 양자간, CBS/CBG/CBSP = 청산되는 양자간, GCF, TRIG/TRISP = 트라이파티
const VENUES = ["UBS", "UBG", "CBS", "CBG", "CBSP", "GCF", "TRIG", "TRISP"];
const makeKey = (venue, suffix) => `PDSORA-${venue}UTSET${suffix}`;

function round1(n) {
  return Math.round(n * 10) / 10;
}

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

async function fetchShare(date) {
  try {
    const res = await fetch(`${BASE}/${date}.json`, { cache: "no-store" });
    if (!res.ok) return null;
    const json = await res.json();

    let overnight = 0;
    let under30 = 0;
    let over30 = 0;
    let found = 0;
    for (const v of VENUES) {
      const a = extractValue(json, makeKey(v, ""));
      const b = extractValue(json, makeKey(v, "TAL30"));
      const c = extractValue(json, makeKey(v, "TAG30"));
      if (a != null) {
        overnight += a;
        found += 1;
      }
      if (b != null) under30 += b; // 값이 가려져 있으면(*) 0으로 계산
      if (c != null) over30 += c;
    }

    const total = overnight + under30 + over30;
    if (found < 4 || total <= 0) return null;

    return {
      date,
      overnight: round1((overnight / total) * 100),
      under30: round1((under30 / total) * 100),
      over30: round1((over30 / total) * 100),
    };
  } catch (e) {
    return null;
  }
}

export async function GET() {
  try {
    const candidateDates = lastWednesdays(9);
    const results = await Promise.all(candidateDates.map(fetchShare));
    const valid = results.filter(Boolean).sort((a, b) => (a.date > b.date ? 1 : -1));

    if (valid.length < 2) {
      return Response.json(
        { ok: false, error: "원본 데이터를 가져오지 못했습니다 (NY Fed Primary Dealer 레포 만기 구성)." },
        { status: 502 }
      );
    }

    // 5개 지점 = 4주 간격
    const points = valid.slice(-5).map((r) => ({ date: r.date, value: r.overnight }));
    const latest = valid[valid.length - 1];
    const prev = valid[valid.length - 2];
    const first = points[0];

    return Response.json({
      ok: true,
      latestDate: latest.date,
      latestValue: latest.overnight, // 하루짜리 비중 (%)
      change: round1(latest.overnight - prev.overnight), // 전주 대비 (%p)
      change4w: round1(latest.overnight - first.value), // 가장 오래된 지점 대비 (%p)
      breakdown: { overnight: latest.overnight, under30: latest.under30, over30: latest.over30 },
      points,
      sourceNote: "NY Fed 공식 Markets Data API - 프라이머리 딜러 국채(TIPS 제외) 레포 만기 구성",
    });
  } catch (e) {
    return Response.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
