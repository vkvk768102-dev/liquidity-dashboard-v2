// 국채선물 CTD(Cheapest To Deliver) 자동 판별
// 1순위: 재무부 FedInvest 종목별 실제 종가 + 선물가격(Yahoo)으로 Implied Repo가 가장 높은 국채 (CME와 같은 방식)
// 2순위(실패 시): 재무부 금리곡선으로 가격을 추정해 (가격 ÷ 전환계수)가 가장 작은 국채
// 인도 가능 목록·원래 만기: 재무부 Fiscal Data 입찰 자료 / 전환계수: CME 공식 계산식

import { fetchFedInvestPrices, fetchLatestFedInvest } from "./treasuryPrices.js";

const AUCTIONS = "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/od/auctions_query";
const CACHE = { next: { revalidate: 6 * 60 * 60 } };
const DAY = 86400000;

// 계약별 인도 조건 (개월). orig = 원래 만기, rem = 인도월 첫날(또는 마지막 날) 기준 남은 만기
export const CONTRACTS = {
  ZT: { label: "2년 선물", symbol: "ZT=F", origMax: 63, remFromLastMin: 21, remFromLastMax: 24, monthly: true },
  ZF: { label: "5년 선물", symbol: "ZF=F", origMax: 63, remMin: 50, monthly: true },
  ZN: { label: "10년 선물", symbol: "ZN=F", origMax: 120, remMin: 78, remMax: 120 },
  TN: { label: "울트라10년 선물", symbol: "TN=F", origExact: 120, remMin: 113, remMax: 120 },
  ZB: { label: "본드 선물", symbol: "ZB=F", remMin: 180, remMaxExclusive: 300 },
  UB: { label: "울트라본드 선물", symbol: "UB=F", remMin: 300 },
};

// ---------- 날짜 도구 ----------
const iso = (d) => d.toISOString().slice(0, 10);
const parse = (s) => new Date(s + "T00:00:00Z");
const lastDayOfMonth = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

/** 기준일 이후 다음 인도월(3·6·9·12월)의 첫날·마지막 날 */
export function deliveryMonth(asOf = new Date()) {
  for (let i = 0; i < 15; i++) {
    const d = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() + i, 1));
    if (d.getUTCMonth() % 3 === 2 && d > asOf) {
      return { first: d, last: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)) };
    }
  }
  return null;
}

function monthsBetween(from, toStr) {
  const [y, m, d] = toStr.split("-").map(Number);
  let months = (y - from.getUTCFullYear()) * 12 + (m - 1 - from.getUTCMonth());
  if (d < from.getUTCDate()) months -= 1;
  return months;
}

// 만기에서 6개월씩 거슬러 올라간 이표 지급일 (월말 만기는 월말 유지)
function couponDate(maturityStr, k) {
  const [y, m, d] = maturityStr.split("-").map(Number);
  const eom = d === lastDayOfMonth(y, m - 1);
  const total = (y * 12 + (m - 1)) - 6 * k;
  const yy = Math.floor(total / 12);
  const mm = total % 12;
  const dd = eom ? lastDayOfMonth(yy, mm) : Math.min(d, lastDayOfMonth(yy, mm));
  return new Date(Date.UTC(yy, mm, dd));
}

function couponPeriod(maturityStr, date) {
  // date가 속한 이표 기간 [prev, next)
  for (let k = 0; k < 80; k++) {
    const prev = couponDate(maturityStr, k + 1);
    if (prev <= date) return { prev, next: couponDate(maturityStr, k) };
  }
  return null;
}

function accrued(coupon, maturityStr, date) {
  const p = couponPeriod(maturityStr, date);
  if (!p) return 0;
  return (coupon / 2) * ((date - p.prev) / (p.next - p.prev));
}

function couponsBetween(coupon, maturityStr, from, to) {
  let sum = 0;
  for (let k = 0; k < 80; k++) {
    const c = couponDate(maturityStr, k);
    if (c <= from) break;
    if (c <= to) sum += coupon / 2;
  }
  return sum;
}

// ---------- 계산식 ----------

/** CME 전환계수 (6% 기준) */
export function conversionFactor(coupon, remMonthsFromFirst, monthly) {
  const c = coupon / 100;
  const n = Math.floor(remMonthsFromFirst / 12);
  let z = remMonthsFromFirst - n * 12;
  if (!monthly) z = Math.floor(z / 3) * 3;
  const v = z < 7 ? z : monthly ? z - 6 : 3;
  const a = 1 / Math.pow(1.03, v / 6);
  const b = (c / 2) * ((6 - v) / 6);
  const C = z < 7 ? 1 / Math.pow(1.03, 2 * n) : 1 / Math.pow(1.03, 2 * n + 1);
  const d = (c / 0.06) * (1 - C);
  return Math.round((a * (c / 2 + C + d) - b) * 10000) / 10000;
}

/** 인도 가능 여부 + 남은 만기(인도월 첫날 기준, 개월) */
export function eligibility(key, sec, dm) {
  const rule = CONTRACTS[key];
  if (sec.origMonths == null) return null;
  const remFirst = monthsBetween(dm.first, sec.maturity);
  const remLast = monthsBetween(dm.last, sec.maturity);
  if (rule.origMax != null && sec.origMonths > rule.origMax) return null;
  if (rule.origExact != null && sec.origMonths !== rule.origExact) return null;
  if (rule.remMin != null && remFirst < rule.remMin) return null;
  if (rule.remMax != null && remFirst > rule.remMax) return null;
  if (rule.remMaxExclusive != null && remFirst >= rule.remMaxExclusive) return null;
  if (rule.remFromLastMin != null && remLast < rule.remFromLastMin) return null;
  if (rule.remFromLastMax != null && remLast > rule.remFromLastMax) return null;
  return { remFirst };
}

/** Implied Repo (연율, %) : 오늘 현물을 사서 인도월 마지막 날 선물로 넘길 때의 수익률 */
export function impliedRepo({ coupon, maturity, price, futures, cf, settle, delivery }) {
  const cost = price + accrued(coupon, maturity, settle);
  const invoice = futures * cf + accrued(coupon, maturity, delivery);
  const cpn = couponsBetween(coupon, maturity, settle, delivery);
  const days = (delivery - settle) / DAY;
  if (days <= 0) return null;
  return ((invoice + cpn - cost) / cost) * (360 / days) * 100;
}

// ---------- 데이터 ----------

/** 재무부 입찰 자료: cusip → { origMonths, coupon, maturity, issueDate } */
export async function fetchSecurityInfo() {
  const from = iso(new Date(Date.now() + 365 * DAY));
  const base = "cusip,security_type,security_term,original_security_term,issue_date,maturity_date";
  for (const rateField of ["int_rate", "interest_rate", null]) {
    try {
      const params = new URLSearchParams({
        fields: rateField ? `${base},${rateField}` : base,
        filter: `security_type:in:(Note,Bond),maturity_date:gte:${from}`,
        sort: "-issue_date",
        "page[size]": "10000",
      });
      const res = await fetch(`${AUCTIONS}?${params.toString()}`, CACHE);
      if (!res.ok) continue;
      const rows = (await res.json())?.data ?? [];
      if (!rows.length) continue;
      const map = new Map();
      for (const r of rows) {
        if (!r.cusip || map.has(r.cusip)) continue;
        const term = r.original_security_term && r.original_security_term !== "null" ? r.original_security_term : r.security_term;
        const y = /(\d+)-Year/.exec(term || "");
        const mo = /(\d+)-Month/.exec(term || "");
        const coupon = rateField ? parseFloat(r[rateField]) : NaN;
        map.set(r.cusip, {
          origMonths: y || mo ? (y ? Number(y[1]) * 12 : 0) + (mo ? Number(mo[1]) : 0) : null,
          coupon: Number.isFinite(coupon) ? coupon : null,
          maturity: r.maturity_date,
          issueDate: r.issue_date,
        });
      }
      return map;
    } catch {
      // 다음 필드 이름 시도
    }
  }
  return new Map();
}

/** Yahoo 선물 일별 종가: { closes: Map(날짜 → 종가), last } */
export async function fetchFuturesHistory(symbol, range = "3mo") {
  try {
    const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=${range}&interval=1d`, {
      headers: { "User-Agent": "Mozilla/5.0" },
      next: { revalidate: 300 },
    });
    if (!res.ok) return null;
    const r = (await res.json())?.chart?.result?.[0];
    if (!r) return null;
    const ts = r.timestamp ?? [];
    const cl = r.indicators?.quote?.[0]?.close ?? [];
    const closes = new Map();
    ts.forEach((t, i) => {
      if (cl[i] != null) closes.set(new Date(t * 1000).toISOString().slice(0, 10), cl[i]);
    });
    return { closes, last: r.meta?.regularMarketPrice ?? null };
  } catch {
    return null;
  }
}

/** 해당 날짜 또는 그 직전의 선물 종가 */
export function closeOn(hist, dateIso) {
  if (!hist) return null;
  if (hist.closes.has(dateIso)) return hist.closes.get(dateIso);
  const keys = [...hist.closes.keys()].filter((k) => k <= dateIso).sort();
  return keys.length ? hist.closes.get(keys[keys.length - 1]) : null;
}

/**
 * 실제 가격으로 인도 후보 전체를 Implied Repo 높은 순으로 정렬 (선물가격이 없으면 가격÷CF 낮은 순)
 * @returns [{ cusip, coupon, maturity, cf, price, irr, score }] 1번이 CTD
 */
export function rankCtd(key, rows, info, futures, dateIso) {
  const asOf = parse(dateIso);
  const dm = deliveryMonth(asOf);
  if (!dm) return [];
  const list = [];
  for (const r of rows) {
    if (!/NOTE|BOND/.test(r.type) || /TIPS|FRN|BILL/.test(r.type)) continue;
    const meta = info.get(r.cusip);
    // 입찰 자료에 없으면: 본드는 30년, 노트는 10년 이하로 간주 (10년 선물 판별에는 충분)
    const origMonths = meta?.origMonths ?? (/BOND/.test(r.type) ? 360 : 120);
    if (meta?.issueDate && meta.issueDate !== "null" && meta.issueDate > iso(dm.last)) continue;
    const el = eligibility(key, { origMonths, maturity: r.maturity }, dm);
    if (!el) continue;
    const cf = conversionFactor(r.coupon, el.remFirst, !!CONTRACTS[key].monthly);
    const irr = futures
      ? impliedRepo({ coupon: r.coupon, maturity: r.maturity, price: r.price, futures, cf, settle: asOf, delivery: dm.last })
      : null;
    const score = futures ? irr : -(r.price / cf);
    if (score == null) continue;
    list.push({ cusip: r.cusip, coupon: r.coupon, maturity: r.maturity, cf, price: r.price, irr, score });
  }
  return list.sort((a, b) => b.score - a.score);
}

/** 1위(CTD)와 2위 후보 */
export function pickCtd(key, rows, info, futures, dateIso) {
  const ranked = rankCtd(key, rows, info, futures, dateIso);
  if (!ranked.length) return null;
  const [best, second] = ranked;
  const dm = deliveryMonth(parse(dateIso));
  return {
    ...best,
    deliveryMonth: iso(dm.first).slice(0, 7),
    runnerUp: second ? { cusip: second.cusip, coupon: second.coupon, maturity: second.maturity, cf: second.cf, irr: second.irr } : null,
    gap: second && best.irr != null && second.irr != null ? best.irr - second.irr : null,
  };
}

// ---------- 금리곡선 추정 (예비용) ----------

async function fetchYieldCurve(now = new Date()) {
  for (const year of [now.getUTCFullYear(), now.getUTCFullYear() - 1]) {
    try {
      const url =
        `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${year}/all` +
        `?type=daily_treasury_yield_curve&field_tdr_date_value=${year}&page&_format=csv`;
      const res = await fetch(url, CACHE);
      if (!res.ok) continue;
      const lines = (await res.text()).trim().split(/\r?\n/);
      if (lines.length < 2) continue;
      const headers = lines[0].split(",").map((h) => h.replace(/"/g, "").trim());
      const rows = lines.slice(1).map((l) => l.split(",").map((x) => x.replace(/"/g, "").trim()));
      rows.sort((a, b) => new Date(b[0]) - new Date(a[0]));
      const row = rows[0];
      const points = [];
      headers.forEach((h, i) => {
        const mo = /^([\d.]+)\s*(Mo|Month)/i.exec(h);
        const yr = /^([\d.]+)\s*(Yr|Year)/i.exec(h);
        const t = mo ? Number(mo[1]) / 12 : yr ? Number(yr[1]) : null;
        const v = parseFloat(row[i]);
        if (t != null && Number.isFinite(v)) points.push({ t, y: v });
      });
      points.sort((a, b) => a.t - b.t);
      if (points.length >= 5) return points;
    } catch {
      // 다음 연도
    }
  }
  return null;
}

function interp(points, t) {
  if (t <= points[0].t) return points[0].y;
  for (let i = 1; i < points.length; i++) {
    if (t <= points[i].t) {
      const a = points[i - 1];
      const b = points[i];
      return a.y + ((b.y - a.y) * (t - a.t)) / (b.t - a.t);
    }
  }
  return points[points.length - 1].y;
}

function curvePrice(coupon, y, T) {
  const r = y / 100 / 2;
  const N = T * 2;
  return (coupon / 2) * (1 - Math.pow(1 + r, -N)) / r + 100 * Math.pow(1 + r, -N);
}

// ---------- 6종 CTD 한꺼번에 ----------

/**
 * @param {{ couponByCusip?: Map<string, number> }} opts
 * @returns {{ deliveryMonth, priceDate, method: "실제 가격"|"금리곡선 추정", ctd: { [key]: {cusip, coupon, maturity, cf, label} } } | null}
 */
export async function estimateCtd({ couponByCusip } = {}) {
  const [latest, info] = await Promise.all([fetchLatestFedInvest(), fetchSecurityInfo()]);

  // 1순위: 실제 가격
  if (latest?.rows?.length) {
    const hists = await Promise.all(Object.values(CONTRACTS).map((c) => fetchFuturesHistory(c.symbol)));
    const ctd = {};
    Object.keys(CONTRACTS).forEach((key, i) => {
      const fut = closeOn(hists[i], latest.date);
      const best = pickCtd(key, latest.rows, info, fut, latest.date);
      if (best) ctd[key] = { cusip: best.cusip, coupon: best.coupon, maturity: best.maturity, cf: best.cf, label: CONTRACTS[key].label };
    });
    if (Object.keys(ctd).length) {
      const dm = deliveryMonth(parse(latest.date));
      return { deliveryMonth: iso(dm.first).slice(0, 7), priceDate: latest.date, method: "실제 가격", ctd };
    }
  }

  // 2순위: 금리곡선 추정
  const now = new Date();
  const dm = deliveryMonth(now);
  const curve = await fetchYieldCurve(now);
  if (!dm || !curve || !info.size) return null;
  const ctd = {};
  for (const [key, rule] of Object.entries(CONTRACTS)) {
    let best = null;
    for (const [cusip, s] of info) {
      const coupon = s.coupon ?? couponByCusip?.get(cusip) ?? null;
      if (coupon == null || !s.maturity) continue;
      if (s.issueDate && s.issueDate !== "null" && s.issueDate > iso(dm.last)) continue;
      const el = eligibility(key, s, dm);
      if (!el) continue;
      const T = (parse(s.maturity) - now) / (365.25 * DAY);
      const cf = conversionFactor(coupon, el.remFirst, !!rule.monthly);
      const score = curvePrice(coupon, interp(curve, T), T) / cf;
      if (!best || score < best.score) best = { cusip, coupon, maturity: s.maturity, cf, score };
    }
    if (best) ctd[key] = { cusip: best.cusip, coupon: best.coupon, maturity: best.maturity, cf: best.cf, label: rule.label };
  }
  return { deliveryMonth: iso(dm.first).slice(0, 7), priceDate: null, method: "금리곡선 추정", ctd };
}
