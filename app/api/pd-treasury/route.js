// 데이터 출처: 뉴욕 연준 공식 Markets Data API (markets.newyorkfed.org). API 키 불필요.
// 지표 정의: 프라이머리 딜러의 국채 순포지션 (PDPOSGST-TOT, TIPS 제외)
//   - 딜러가 보유한 국채(롱) - 빌려서 판 국채(숏). 단위: 백만 달러
//   - 늘어나면 시장이 국채를 다 소화하지 못하고 딜러 재고로 쌓이고 있다는 뜻
const BASE = "https://markets.newyorkfed.org/api/pd/get/asof";
const UST_KEY = "PDPOSGST-TOT";

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

async function fetchUst(date) {
  try {
    const res = await fetch(`${BASE}/${date}.json`, { cache: "no-store" });
    if (!res.ok) return null;
    const json = await res.json();
    const value = extractValue(json, UST_KEY);
    if (value == null) return null;
    return { date, value };
  } catch (e) {
    return null;
  }
}

export async function GET() {
  try {
    const candidateDates = lastWednesdays(9);
    const results = await Promise.all(candidateDates.map(fetchUst));
    const valid = results.filter(Boolean).sort((a, b) => (a.date > b.date ? 1 : -1));

    if (valid.length < 2) {
      return Response.json(
        { ok: false, error: "원본 데이터를 가져오지 못했습니다 (NY Fed Primary Dealer 국채 포지션)." },
        { status: 502 }
      );
    }

    // 5개 지점 = 4주 간격
    const points = valid.slice(-5).map((r) => ({ date: r.date, value: r.value }));
    const latest = points[points.length - 1];
    const prev = points[points.length - 2];
    const first = points[0];

    return Response.json({
      ok: true,
      latestDate: latest.date,
      latestValue: latest.value, // 단위: 백만 달러
      change: latest.value - prev.value, // 전주 대비
      change4w: latest.value - first.value, // 가장 오래된 지점 대비
      points,
      sourceNote: "NY Fed 공식 Markets Data API - 프라이머리 딜러 국채 순포지션 (PDPOSGST-TOT, TIPS 제외)",
    });
  } catch (e) {
    return Response.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
