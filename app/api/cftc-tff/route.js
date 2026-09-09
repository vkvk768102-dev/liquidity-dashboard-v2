// 데이터 출처: CFTC(미국 상품선물거래위원회) 공식 공개 API (publicreporting.cftc.gov, Socrata 기반).
// OFR을 거치지 않고 CFTC 원본 "Traders in Financial Futures" 리포트를 직접 가져옵니다.
// API 키 불필요 (CFTC는 과도한 사용만 아니면 토큰 없이도 접근을 허용합니다).
//
// 지표 정의: 레버리지드 펀드(헤지펀드 등 투기적 투자자)의 "10년물 국채선물" 순포지션
//   순포지션(계약 수) = Lev_Money_Positions_Long - Lev_Money_Positions_Short
//   - 원본 이미지와 동일하게 "계약 수" 단위를 사용합니다 (이전 버전은 달러 명목가치였음).
//   - 음수(순매도/숏)가 커질수록 10년물 국채 선물 약세(하락) 베팅이 심화되고 있다는 뜻
const BASE = "https://publicreporting.cftc.gov/resource/gpe5-46if.json";
// CBT 10-Year U.S. Treasury Note futures의 CFTC 계약시장코드
const CONTRACT_CODE = "043602";

export async function GET() {
  try {
    const url = `${BASE}?cftc_contract_market_code=${CONTRACT_CODE}&$order=report_date_as_yyyy_mm_dd DESC&$limit=6`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      return Response.json(
        { ok: false, error: "원본 데이터를 가져오지 못했습니다 (CFTC TFF API)." },
        { status: 502 }
      );
    }
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) {
      return Response.json(
        { ok: false, error: "CFTC 데이터가 비어 있습니다." },
        { status: 502 }
      );
    }

    const toNum = (v) => {
      if (v == null) return null;
      const n = parseFloat(String(v).replace(/,/g, ""));
      return Number.isFinite(n) ? n : null;
    };

    // 오래된 -> 최신 순으로 정렬
    const sorted = [...rows].sort((a, b) =>
      a.report_date_as_yyyy_mm_dd > b.report_date_as_yyyy_mm_dd ? 1 : -1
    );

    const points = sorted.slice(-4).map((r) => {
      const long = toNum(r.lev_money_positions_long);
      const short = toNum(r.lev_money_positions_short);
      const net = long != null && short != null ? long - short : null;
      return { date: r.report_date_as_yyyy_mm_dd.slice(0, 10), value: net };
    });

    const latest = points[points.length - 1];
    const prev = points.length > 1 ? points[points.length - 2] : null;
    const change = prev && latest.value != null && prev.value != null ? latest.value - prev.value : null;

    return Response.json({
      ok: true,
      latestDate: latest.date,
      latestValue: latest.value, // 단위: 계약 수 (contracts)
      change,
      points, // [{date, value}] 최근 4주, 단위: 계약 수
      sourceNote: "CFTC TFF 리포트 원본 - 레버리지드펀드 10년물 국채선물 순포지션 (계약 수)",
    });
  } catch (e) {
    return Response.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
