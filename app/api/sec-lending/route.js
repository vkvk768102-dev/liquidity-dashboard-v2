// 13번 카드용: 뉴욕연은 증권대차(Securities Lending) CUSIP별 결과 + 최근 영업일 추이
// 공개 API, 키 불필요
export const dynamic = "force-dynamic";

const BASE = "https://markets.newyorkfed.org/api/seclending/all/results/details";
const HISTORY_DAYS = 5; // 추이에 보여줄 영업일 수

function num(v) {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

async function getOps(path) {
  try {
    const res = await fetch(`${BASE}/${path}`, { cache: "no-store" });
    if (!res.ok) return [];
    const json = await res.json();
    return json?.seclending?.operations ?? [];
  } catch {
    return [];
  }
}

// 운영 목록 → { 날짜: Map(cusip → {cusip, description, submitted, accepted, rate}) }
function groupByDate(ops) {
  const byDate = {};
  for (const op of ops) {
    if (!op?.operationDate || !Array.isArray(op.details) || !op.details.length) continue;
    // 기존 대출의 '연장' 운영은 중복 집계가 될 수 있어 제외
    const label = String(op.operation ?? op.operationType ?? "").toLowerCase();
    if (label.includes("extension")) continue;

    const map = (byDate[op.operationDate] ??= new Map());
    for (const d of op.details) {
      if (!d?.cusip) continue;
      const submitted = num(d.parAmtSubmitted) ?? 0;
      const accepted = num(d.parAmtAccepted) ?? 0;
      const rate = num(d.weightedAverageRate);
      const prev = map.get(d.cusip);
      if (prev) {
        prev.submitted += submitted;
        prev.accepted += accepted;
        if (rate != null && (prev.rate == null || rate > prev.rate)) prev.rate = rate;
      } else {
        map.set(d.cusip, { cusip: d.cusip, description: d.securityDescription ?? "", submitted, accepted, rate });
      }
    }
  }
  return byDate;
}

export async function GET() {
  try {
    const [latestOps, historyOps] = await Promise.all([getOps("latest.json"), getOps("lastTwoWeeks.json")]);
    const byDate = { ...groupByDate(historyOps), ...groupByDate(latestOps) };
    const dates = Object.keys(byDate).sort();
    if (!dates.length) throw new Error("대차 결과 상세 데이터가 없습니다");

    const latestDate = dates[dates.length - 1];
    const rows = [...byDate[latestDate].values()];
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

    // 추이: 오늘 수수료 1위 종목과 물량 1위 종목의 최근 영업일 기록
    const histDates = dates.slice(-HISTORY_DAYS);
    const trackCusips = [...new Set([topByRate[0]?.cusip, biggest?.cusip].filter(Boolean))];
    const tracked = trackCusips.map((cusip) => {
      const today = byDate[latestDate].get(cusip);
      return {
        cusip,
        description: today?.description ?? "",
        history: histDates.map((date) => {
          const r = byDate[date].get(cusip);
          return {
            date,
            submitted: r?.submitted ?? 0,
            accepted: r?.accepted ?? 0,
            rate: r && r.accepted > 0 ? r.rate : null,
          };
        }),
      };
    });

    const totalHistory = histDates.map((date) => ({
      date,
      accepted: [...byDate[date].values()].reduce((s, r) => s + r.accepted, 0),
    }));

    return Response.json({
      ok: true,
      latestDate,
      count: rows.length,
      totalSubmitted,
      totalAccepted,
      topByRate,
      biggest,
      shortfalls,
      tracked,
      totalHistory,
    });
  } catch (e) {
    return Response.json({ ok: false, error: e.message }, { status: 500 });
  }
}
