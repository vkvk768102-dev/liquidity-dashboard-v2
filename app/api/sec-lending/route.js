// 11번 카드용: 뉴욕연은 증권대차(Securities Lending) CUSIP별 결과
// 공개 API, 키 불필요
export const dynamic = "force-dynamic";

const BASE = "https://markets.newyorkfed.org/api/seclending/all/results/details";

function num(v) {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

async function getOps(path) {
  const res = await fetch(`${BASE}/${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`뉴욕연은 응답 오류 (${res.status})`);
  const json = await res.json();
  return json?.seclending?.operations ?? [];
}

export async function GET() {
  try {
    let ops = await getOps("latest.json");
    let withDetails = ops.filter((o) => Array.isArray(o.details) && o.details.length);

    // latest에 상세가 없으면 최근 2주 데이터에서 가장 최근 날짜를 사용
    if (!withDetails.length) {
      ops = await getOps("lastTwoWeeks.json");
      withDetails = ops.filter((o) => Array.isArray(o.details) && o.details.length);
    }
    if (!withDetails.length) throw new Error("대차 결과 상세 데이터가 없습니다");

    const latestDate = withDetails
      .map((o) => o.operationDate)
      .filter(Boolean)
      .sort()
      .pop();
    const todays = withDetails.filter((o) => o.operationDate === latestDate);

    // 같은 날 여러 운영(정규/연장)이 있으면 CUSIP별로 합산
    const map = new Map();
    for (const op of todays) {
      for (const d of op.details) {
        const cusip = d.cusip;
        if (!cusip) continue;
        const submitted = num(d.parAmtSubmitted) ?? 0;
        const accepted = num(d.parAmtAccepted) ?? 0;
        const rate = num(d.weightedAverageRate);
        const prev = map.get(cusip);
        if (prev) {
          prev.submitted += submitted;
          prev.accepted += accepted;
          if (rate != null && (prev.rate == null || rate > prev.rate)) prev.rate = rate;
        } else {
          map.set(cusip, {
            cusip,
            description: d.securityDescription ?? "",
            submitted,
            accepted,
            rate,
          });
        }
      }
    }

    const rows = [...map.values()];
    const lent = rows.filter((r) => r.accepted > 0);

    const topByRate = [...lent]
      .filter((r) => r.rate != null)
      .sort((a, b) => b.rate - a.rate || b.accepted - a.accepted)
      .slice(0, 5);

    const biggest = [...lent].sort((a, b) => b.accepted - a.accepted)[0] ?? null;

    const shortfalls = rows
      .filter((r) => r.submitted > r.accepted)
      .map((r) => ({ ...r, gap: r.submitted - r.accepted }))
      .sort((a, b) => b.gap - a.gap);

    const totalAccepted = lent.reduce((s, r) => s + r.accepted, 0);
    const totalSubmitted = rows.reduce((s, r) => s + r.submitted, 0);

    return Response.json({
      ok: true,
      latestDate,
      count: rows.length,
      totalSubmitted,
      totalAccepted,
      topByRate,
      biggest,
      shortfalls,
    });
  } catch (e) {
    return Response.json({ ok: false, error: e.message }, { status: 500 });
  }
}
