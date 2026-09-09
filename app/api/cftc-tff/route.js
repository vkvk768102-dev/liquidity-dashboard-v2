// 데이터 출처: OFR Hedge Fund Monitor가 제공하는 CFTC "Traders in Financial Futures"(TFF)
// 리포트 가공 데이터 (data.financialresearch.gov/hf). API 키 불필요.
// 지표 정의: 레버리지드 펀드(헤지펀드 등 투기적 투자자)의 미국 국채 선물 순포지션(명목가치, 달러)
//   - 음수(순매도/숏)가 커질수록 국채 선물 약세(하락) 베팅이 심화되고 있다는 뜻
const BASE = "https://data.financialresearch.gov/hf/v1/series/timeseries";
const MNEMONIC_CANDIDATES = ["TFF-LF_TREAS_NET_POSITION", "TFF-LF_TY_NET_POSITION"];

async function fetchSeries(candidates) {
  for (const mnemonic of candidates) {
    try {
      const res = await fetch(`${BASE}?mnemonic=${mnemonic}`, { cache: "no-store" });
      if (!res.ok) continue;
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        return { mnemonic, series: data };
      }
    } catch (e) {
      // 다음 후보로 넘어감
    }
  }
  return null;
}

export async function GET() {
  try {
    const result = await fetchSeries(MNEMONIC_CANDIDATES);
    if (!result) {
      return Response.json(
        { ok: false, error: "원본 데이터를 가져오지 못했습니다 (CFTC TFF, OFR 경유)." },
        { status: 502 }
      );
    }

    const sorted = [...result.series].sort((a, b) => (a[0] > b[0] ? 1 : -1));
    const last4 = sorted.slice(-4);
    const points = last4.map(([date, value]) => ({ date, value }));

    const latest = points[points.length - 1];
    const prev = points.length > 1 ? points[points.length - 2] : null;
    const change = prev ? latest.value - prev.value : null;

    return Response.json({
      ok: true,
      mnemonic: result.mnemonic,
      latestDate: latest.date,
      latestValue: latest.value,
      change,
      points, // [{date, value}] 최근 4주, 단위: 달러(명목가치)
      sourceNote: "CFTC TFF 리포트 - 레버리지드펀드 국채선물 순포지션 (OFR Hedge Fund Monitor 경유)",
    });
  } catch (e) {
    return Response.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
