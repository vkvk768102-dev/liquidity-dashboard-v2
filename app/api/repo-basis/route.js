// 데이터 출처: 뉴욕 연준 공식 Markets Data API (markets.newyorkfed.org). API 키 불필요.
// 지표 정의: Repo Basis (GC-SOFR 스프레드) = TGCR(트라이파티 GC 레포 금리) - SOFR
//   - 레포시장 내부의 자금조달 스트레스를 보여주는 지표. 0에 가까울수록 정상, 벌어질수록 스트레스.
const SOFR_URL = "https://markets.newyorkfed.org/api/rates/secured/sofr/last/8.json";
const TGCR_URL = "https://markets.newyorkfed.org/api/rates/secured/tgcr/last/8.json";

function extractRows(json) {
  if (Array.isArray(json)) return json;
  if (json && Array.isArray(json.refRates)) return json.refRates;
  if (json && Array.isArray(json.secured)) return json.secured;
  if (json && json.rates && Array.isArray(json.rates.secured)) return json.rates.secured;
  return [];
}
function getDate(row) {
  return row.effectiveDate || row.date || row.Date || null;
}
function getRate(row) {
  const raw = row.percentRate ?? row.rate ?? row.Rate;
  const n = typeof raw === "string" ? parseFloat(raw) : raw;
  return Number.isFinite(n) ? n : null;
}

async function fetchRates(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return null;
  const json = await res.json();
  const rows = extractRows(json)
    .map((r) => ({ date: (getDate(r) || "").slice(0, 10), value: getRate(r) }))
    .filter((r) => r.date && r.value != null);
  return rows;
}

export async function GET() {
  try {
    const [sofrRows, tgcrRows] = await Promise.all([fetchRates(SOFR_URL), fetchRates(TGCR_URL)]);
    if (!sofrRows || !tgcrRows) {
      return Response.json({ ok: false, error: "원본 데이터를 가져오지 못했습니다 (NY Fed SOFR/TGCR)." }, { status: 502 });
    }

    const sofrMap = new Map(sofrRows.map((r) => [r.date, r.value]));
    const commonDates = tgcrRows.map((r) => r.date).filter((d) => sofrMap.has(d)).sort();

    if (commonDates.length === 0) {
      return Response.json({ ok: false, error: "공통 날짜 데이터가 없습니다." }, { status: 502 });
    }

    const tgcrMap = new Map(tgcrRows.map((r) => [r.date, r.value]));
    const last5 = commonDates.slice(-5);
    const points = last5.map((date) => ({
      date,
      value: tgcrMap.get(date) - sofrMap.get(date), // %p
    }));

    const latest = points[points.length - 1];
    const prev = points.length > 1 ? points[points.length - 2] : null;
    const change = prev ? latest.value - prev.value : null;

    return Response.json({
      ok: true,
      latestDate: latest.date,
      latestValue: latest.value,
      change,
      points,
      sourceNote: "NY Fed 공식 API - GC-SOFR 스프레드 (TGCR - SOFR)",
    });
  } catch (e) {
    return Response.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
