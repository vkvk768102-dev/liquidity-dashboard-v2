// 데이터 출처: 뉴욕 연준 공식 Markets Data API (markets.newyorkfed.org). API 키 불필요.
// 지표 정의: SOFR (Secured Overnight Financing Rate) - 무위험 단기 자금시장의 실제 조달금리
const URL_ = "https://markets.newyorkfed.org/api/rates/secured/sofr/last/8.json";

// 함께 보여줄 참고 금리 (1번 카드 아래 한 줄): 최신 값만 사용
const EXTRA = [
  { key: "EFFR", url: "https://markets.newyorkfed.org/api/rates/unsecured/effr/last/3.json" },
  { key: "BGCR", url: "https://markets.newyorkfed.org/api/rates/secured/bgcr/last/3.json" },
  { key: "TGCR", url: "https://markets.newyorkfed.org/api/rates/secured/tgcr/last/3.json" },
];

// 실패해도 SOFR 카드는 그대로 나오도록, 못 가져오면 null
async function fetchLatestRate(url) {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const rows = extractRows(await res.json())
      .map((r) => ({ date: getDate(r), value: getRate(r) }))
      .filter((r) => r.date && r.value != null)
      .sort((a, b) => (a.date > b.date ? 1 : -1));
    const last = rows[rows.length - 1];
    return last ? { date: last.date.slice(0, 10), value: last.value } : null;
  } catch {
    return null;
  }
}

function extractRows(json) {
  if (Array.isArray(json)) return json;
  if (json && Array.isArray(json.refRates)) return json.refRates;
  if (json && Array.isArray(json.secured)) return json.secured;
  if (json && Array.isArray(json.unsecured)) return json.unsecured;
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
    const [res, ...extraResults] = await Promise.all([
      fetch(URL_, { cache: "no-store" }),
      ...EXTRA.map((e) => fetchLatestRate(e.url)),
    ]);
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
      extraRates: EXTRA.map((e, i) => ({ key: e.key, date: extraResults[i]?.date ?? null, value: extraResults[i]?.value ?? null })),
      sourceNote: "NY Fed 공식 API - SOFR (Secured Overnight Financing Rate)",
    });
  } catch (e) {
    return Response.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
