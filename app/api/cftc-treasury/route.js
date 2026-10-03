// 14번 카드용: CFTC TFF(Futures Only) 국채선물 6종의 레버리지드펀드(헤지펀드) 롱/숏 4주 추이
// 데이터 출처: CFTC 공식 API (publicreporting.cftc.gov, 데이터셋 gpe5-46if). API 키 불필요.
// 발표: 매주 금요일 오후(미국 동부), 기준일은 그 주 화요일
import { estimateCtd } from "../../lib/ctd.js";

export const dynamic = "force-dynamic";

const URL = "https://publicreporting.cftc.gov/resource/gpe5-46if.json";
const WEEKS = 4;

const CONTRACTS = [
  { code: "042601", ctdKey: "ZT", name: "UST 2Y NOTE", label: "2년물", link: "2년물" },
  { code: "044601", ctdKey: "ZF", name: "UST 5Y NOTE", label: "5년물", link: "5년물" },
  { code: "043602", ctdKey: "ZN", name: "UST 10Y NOTE", label: "10년물 (일반)", link: "남은 만기 6.5~10년 (구형 10년물)" },
  { code: "043607", ctdKey: "TN", name: "ULTRA UST 10Y", label: "울트라 10년물", link: "최신 10년물" },
  { code: "020601", ctdKey: "ZB", name: "UST BOND", label: "장기물 (본드)", link: "남은 만기 15~25년" },
  { code: "020604", ctdKey: "UB", name: "ULTRA UST BOND", label: "울트라 본드", link: "30년물" },
];

function n(v) {
  const x = parseFloat(v);
  return Number.isFinite(x) ? x : null;
}

export async function GET() {
  try {
    const codes = CONTRACTS.map((c) => `'${c.code}'`).join(",");
    const params = new URLSearchParams({
      $where: `cftc_contract_market_code in (${codes})`,
      $order: "report_date_as_yyyy_mm_dd DESC",
      $limit: "80",
    });
    const [res, ctdInfo] = await Promise.all([
      fetch(`${URL}?${params.toString()}`, { cache: "no-store" }),
      estimateCtd().catch(() => null),
    ]);
    if (!res.ok) throw new Error(`CFTC 응답 오류 (${res.status})`);
    const rows = await res.json();
    if (!Array.isArray(rows) || !rows.length) throw new Error("CFTC 데이터가 비어 있습니다");

    const contracts = CONTRACTS.map((c) => {
      const mine = rows
        .filter((r) => String(r.cftc_contract_market_code).trim() === c.code)
        .map((r) => {
          const long = n(r.lev_money_positions_long);
          const short = n(r.lev_money_positions_short);
          return {
            date: String(r.report_date_as_yyyy_mm_dd || "").slice(0, 10),
            long,
            short,
            net: long != null && short != null ? long - short : null,
          };
        })
        .filter((r) => r.date)
        .sort((a, b) => (a.date > b.date ? 1 : -1));

      // 같은 날짜 중복 제거
      const uniq = [];
      for (const r of mine) if (!uniq.length || uniq[uniq.length - 1].date !== r.date) uniq.push(r);
      const points = uniq.slice(-WEEKS);
      const latest = points[points.length - 1] ?? null;
      const prev = points.length > 1 ? points[points.length - 2] : null;

      const ctd = ctdInfo?.ctd?.[c.ctdKey] ?? null;
      return {
        ...c,
        ctd: ctd ? { cusip: ctd.cusip, coupon: ctd.coupon, maturity: ctd.maturity, cf: ctd.cf } : null,
        points,
        latest,
        changeLong: latest && prev ? latest.long - prev.long : null,
        changeShort: latest && prev ? latest.short - prev.short : null,
        changeNet: latest && prev && latest.net != null && prev.net != null ? latest.net - prev.net : null,
      };
    });

    const latestDate = contracts
      .map((c) => c.latest?.date)
      .filter(Boolean)
      .sort()
      .pop();

    return Response.json({ ok: true, latestDate, contracts, ctdDeliveryMonth: ctdInfo?.deliveryMonth ?? null });
  } catch (e) {
    return Response.json({ ok: false, error: e.message }, { status: 502 });
  }
}
