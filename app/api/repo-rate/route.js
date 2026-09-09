// 데이터 출처: 뉴욕 연준 공식 Markets Data API (markets.newyorkfed.org). API 키 불필요.
// 지표 정의: SOFR (Secured Overnight Financing Rate) - 무위험 단기 자금시장의 실제 조달금리
const URL_ = "https://markets.newyorkfed.org/api/rates/secured/sofr/last/8.json";

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

export async function GET() {
  try {
    const res = await fetch(URL_, { cache: "no-store" });
    if (!res.ok) {
      return Response.json({ ok: false, error: "원본 데이터를 가져오지 못했습니다 (NY Fed SOFR)." }, { status: 502 });
    }
    const json = await res.json();
    const rows = extractRows(json)
      .map((r) => ({ date: getDate(r), value: getRate(r) }))
      .filter((r) => r.date && r.value != null)
      .sort((a, b) => (a.date > b.date ? 1 : -1));

    if (rows.length === 0) {
      return Response.json({ ok: false, error: "SOFR 데이터가 비어 있습니다." }, { status: 502 });
    }

    const points = rows.slice(-5);
    const latest = points[points.length - 1];
    const prev = points.length > 1 ? points[points.length - 2] : null;
    const change = prev ? latest.value - prev.value : null;

    return Response.json({
      ok: true,
      latestDate: latest.date.slice(0, 10),
      latestValue: latest.value,
      change,
      points: points.map((p) => ({ date: p.date.slice(0, 10), value: p.value })),
      sourceNote: "NY Fed 공식 API - SOFR (Secured Overnight Financing Rate)",
    });
  } catch (e) {
    return Response.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
