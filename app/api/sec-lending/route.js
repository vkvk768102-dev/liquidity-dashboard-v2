// 13번 카드용: 뉴욕연은 증권대차(Securities Lending) CUSIP별 결과 + 최근 영업일 추이
// + 최신발행물(On-the-run) / 직전물 / 국채선물 CTD(자동 추정) 구분
// 데이터 출처: NY Fed Markets API, 미국 재무부 Fiscal Data API (둘 다 키 불필요)
import { estimateCtd } from "../../lib/ctd.js";

export const dynamic = "force-dynamic";

const BASE = "https://markets.newyorkfed.org/api/seclending/all/results/details";
const AUCTIONS = "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/od/auctions_query";
const HISTORY_DAYS = 5;

// 최신발행물을 찾을 만기 종류 (재무부 표기 → 화면 표기)
const OTR_TERMS = {
  "2-Year": "2년",
  "3-Year": "3년",
  "5-Year": "5년",
  "7-Year": "7년",
  "10-Year": "10년",
  "20-Year": "20년",
  "30-Year": "30년",
};

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

// 재무부 입찰 자료에서 만기 종류별 가장 최근 발행(이미 발행일이 지난) CUSIP을 찾음
async function getOnTheRun() {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 450 * 86400000).toISOString().slice(0, 10);
    const params = new URLSearchParams({
      fields: "cusip,security_type,security_term,original_security_term,issue_date",
      filter: `security_type:in:(Note,Bond),issue_date:gte:${from}`,
      sort: "-issue_date",
      "page[size]": "500",
    });
    const res = await fetch(`${AUCTIONS}?${params.toString()}`, { cache: "no-store" });
    if (!res.ok) return {};
    const json = await res.json();
    const rows = Array.isArray(json?.data) ? json.data : [];
    // cusip → { term: "10년", rank: 0(최신물) | 1(직전물) }
    const otr = {};
    const countByTerm = {};
    for (const r of rows) {
      if (!r.issue_date || r.issue_date === "null" || r.issue_date > today) continue; // 아직 발행 전 제외
      const term = r.original_security_term && r.original_security_term !== "null" ? r.original_security_term : r.security_term;
      const label = OTR_TERMS[term];
      if (!label || otr[r.cusip]) continue; // 재발행(같은 CUSIP)은 한 번만
      const rank = countByTerm[label] ?? 0;
      if (rank > 1) continue;
      countByTerm[label] = rank + 1;
      otr[r.cusip] = { term: label, rank };
    }
    return otr;
  } catch {
    return {};
  }
}

// "T 04.625 08/15/36" → { coupon: 4.625, maturity: "2036-08-15" }
function parseDesc(desc) {
  const m = String(desc || "").match(/^\s*T\s+([\d.]+)\s+(\d{2})\/(\d{2})\/(\d{2})/);
  if (!m) return null;
  return { coupon: parseFloat(m[1]), maturity: `20${m[4]}-${m[2]}-${m[3]}` };
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

export async function GET(request) {
  try {
    const sp = new URL(request.url).searchParams;
    const ctdCoupon = num(sp.get("ctdCoupon"));
    const ctdMaturity = sp.get("ctdMaturity") || null;

    const [latestOps, historyOps, otrMap] = await Promise.all([
      getOps("latest.json"),
      getOps("lastTwoWeeks.json"),
      getOnTheRun(),
    ]);
    const byDate = { ...groupByDate(historyOps), ...groupByDate(latestOps) };
    const dates = Object.keys(byDate).sort();
    if (!dates.length) throw new Error("대차 결과 상세 데이터가 없습니다");

    const latestDate = dates[dates.length - 1];
    const todayMap = byDate[latestDate];

    // CTD: 자동 추정 (실패하면 Treasury Basis 카드 설정값으로 10년 선물 CTD만 대체)
    const couponByCusip = new Map();
    for (const r of todayMap.values()) {
      const p = parseDesc(r.description);
      if (p) couponByCusip.set(r.cusip, p.coupon);
    }
    let ctdInfo = null;
    try {
      ctdInfo = await estimateCtd({ couponByCusip });
    } catch {
      ctdInfo = null;
    }
    const ctdList = []; // [{ key, label, cusip, coupon, maturity, auto }]
    if (ctdInfo?.ctd) {
      for (const [key, c] of Object.entries(ctdInfo.ctd)) ctdList.push({ key, ...c, auto: true });
    }
    if (!ctdList.some((c) => c.key === "ZN") && ctdCoupon != null && ctdMaturity) {
      let cusip = null;
      for (const r of todayMap.values()) {
        const p = parseDesc(r.description);
        if (p && Math.abs(p.coupon - ctdCoupon) < 1e-6 && p.maturity === ctdMaturity) {
          cusip = r.cusip;
          break;
        }
      }
      ctdList.push({ key: "ZN", label: "10년 선물", cusip, coupon: ctdCoupon, maturity: ctdMaturity, auto: false });
    }
    const ctdByCusip = new Map();
    for (const c of ctdList) if (c.cusip) ctdByCusip.set(c.cusip, [...(ctdByCusip.get(c.cusip) ?? []), c]);

    const tagsFor = (cusip) => {
      const tags = [];
      const o = otrMap[cusip];
      if (o) tags.push({ type: o.rank === 0 ? "otr" : "offrun", label: `${o.term} ${o.rank === 0 ? "최신물" : "직전물"}` });
      for (const c of ctdByCusip.get(cusip) ?? []) tags.push({ type: "ctd", label: `${c.label} CTD` });
      return tags;
    };
    const withTags = (r) => (r ? { ...r, tags: tagsFor(r.cusip) } : r);

    const rows = [...todayMap.values()];
    const lent = rows.filter((r) => r.accepted > 0);

    const topByRate = [...lent]
      .filter((r) => r.rate != null)
      .sort((a, b) => b.rate - a.rate || b.accepted - a.accepted)
      .slice(0, 5)
      .map(withTags);

    const biggest = withTags([...lent].sort((a, b) => b.accepted - a.accepted)[0] ?? null);

    const shortfalls = rows
      .filter((r) => r.submitted > r.accepted)
      .map((r) => withTags({ ...r, gap: r.submitted - r.accepted }))
      .sort((a, b) => b.gap - a.gap);

    const totalAccepted = lent.reduce((s, r) => s + r.accepted, 0);
    const totalSubmitted = rows.reduce((s, r) => s + r.submitted, 0);

    // 추이: 오늘 수수료 1위 종목과 물량 1위 종목
    const histDates = dates.slice(-HISTORY_DAYS);
    const trackCusips = [...new Set([topByRate[0]?.cusip, biggest?.cusip].filter(Boolean))];
    const tracked = trackCusips.map((cusip) => ({
      cusip,
      description: todayMap.get(cusip)?.description ?? "",
      tags: tagsFor(cusip),
      history: histDates.map((date) => {
        const r = byDate[date].get(cusip);
        return { date, submitted: r?.submitted ?? 0, accepted: r?.accepted ?? 0, rate: r && r.accepted > 0 ? r.rate : null };
      }),
    }));

    const totalHistory = histDates.map((date) => ({
      date,
      accepted: [...byDate[date].values()].reduce((s, r) => s + r.accepted, 0),
    }));

    // 최신물·CTD 오늘 현황 (상위권에 없어도 보여줌)
    const order = Object.values(OTR_TERMS);
    const benchmarks = Object.entries(otrMap)
      .map(([cusip, { term, rank }]) => {
        const r = todayMap.get(cusip);
        return { kind: `${term} ${rank === 0 ? "최신물" : "직전물"}`, sort: order.indexOf(term) * 2 + rank, cusip, description: r?.description ?? "", submitted: r?.submitted ?? 0, accepted: r?.accepted ?? 0, rate: r && r.accepted > 0 ? r.rate : null, listed: !!r };
      })
      .sort((a, b) => a.sort - b.sort);
    const CTD_ORDER = ["ZT", "ZF", "ZN", "TN", "ZB", "UB"];
    for (const c of [...ctdList].sort((a, b) => CTD_ORDER.indexOf(a.key) - CTD_ORDER.indexOf(b.key))) {
      const r = c.cusip ? todayMap.get(c.cusip) : null;
      const [yy, mm, dd] = String(c.maturity || "").split("-");
      benchmarks.push({
        kind: `CTD (${c.label})${c.auto ? "" : " · 수동"}`,
        cusip: c.cusip ?? "",
        description: r?.description ?? (yy ? `T ${Number(c.coupon).toFixed(3)} ${mm}/${dd}/${yy.slice(2)}` : ""),
        submitted: r?.submitted ?? 0,
        accepted: r?.accepted ?? 0,
        rate: r && r.accepted > 0 ? r.rate : null,
        listed: !!r,
      });
    }

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
      benchmarks,
      otrAvailable: Object.keys(otrMap).length > 0,
      ctdAuto: !!ctdInfo?.ctd && Object.keys(ctdInfo.ctd).length > 0,
      ctdDeliveryMonth: ctdInfo?.deliveryMonth ?? null,
    });
  } catch (e) {
    return Response.json({ ok: false, error: e.message }, { status: 500 });
  }
}
