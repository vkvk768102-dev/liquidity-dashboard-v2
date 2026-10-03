// 국채선물 CTD(Cheapest To Deliver) 자동 추정
// - 인도 가능 국채 목록: 미국 재무부 Fiscal Data 입찰 자료 (키 불필요)
// - 가격: 미국 재무부 공식 Par Yield Curve로 각 국채의 이론가격을 추정
// - 전환계수(CF): CME 공식 계산식
// - CTD = (가격 ÷ 전환계수)가 가장 작은 국채 (선물 매도자가 가장 싸게 인도할 수 있는 국채)
// [주의] 실제 시장가격이 아니라 금리곡선으로 추정한 값이라, 후보끼리 차이가 아주 작을 때는
//        실제 CTD와 다를 수 있습니다. 확인은 CME Treasury Analytics에서 하세요.

const AUCTIONS = "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/od/auctions_query";
const CACHE = { next: { revalidate: 6 * 60 * 60 } }; // 6시간 캐시

// 계약별 인도 조건 (단위: 개월). orig = 원래 만기 조건, rem = 남은 만기 조건
export const CONTRACTS = {
  ZT: { label: "2년 선물", origMax: 63, remFromLastMin: 21, remFromLastMax: 24, monthly: true },
  ZF: { label: "5년 선물", origMax: 63, remMin: 50, monthly: true },
  ZN: { label: "10년 선물", origMax: 120, remMin: 78, remMax: 120 },
  TN: { label: "울트라10년 선물", origExact: 120, remMin: 113, remMax: 120 },
  ZB: { label: "본드 선물", remMin: 180, remMaxExclusive: 300 },
  UB: { label: "울트라본드 선물", remMin: 300 },
};

function ymd(d) {
  return d.toISOString().slice(0, 10);
}

// 다음 인도월(3·6·9·12월)의 첫날과 마지막 날
function deliveryMonth(now = new Date()) {
  for (let i = 0; i < 15; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1));
    if (d.getUTCMonth() % 3 === 2 && d > now) {
      const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
      return { first: d, last };
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

function termMonths(term) {
  if (!term) return null;
  const y = /(\d+)-Year/.exec(term);
  const m = /(\d+)-Month/.exec(term);
  if (!y && !m) return null;
  return (y ? Number(y[1]) * 12 : 0) + (m ? Number(m[1]) : 0);
}

// CME 전환계수 공식 (6% 기준)
function conversionFactor(coupon, remMonthsFromFirst, monthly) {
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

// 반기 이표 채권 이론가격 (수익률 y, 남은 기간 T년)
function bondPrice(coupon, y, T) {
  const r = y / 100 / 2;
  const N = T * 2;
  const cpn = coupon / 2;
  if (r === 0) return cpn * N + 100;
  return cpn * (1 - Math.pow(1 + r, -N)) / r + 100 * Math.pow(1 + r, -N);
}

// ---------- 데이터 가져오기 ----------

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
      rows.sort((a, b) => new Date(b[0]) - new Date(a[0])); // 최신 날짜 먼저
      const row = rows[0];
      const points = [];
      headers.forEach((h, i) => {
        const mo = /^([\d.]+)\s*(Mo|Month)/i.exec(h);
        const yr = /^([\d.]+)\s*(Yr|Year)/i.exec(h);
        const years = mo ? Number(mo[1]) / 12 : yr ? Number(yr[1]) : null;
        const v = parseFloat(row[i]);
        if (years != null && Number.isFinite(v)) points.push({ t: years, y: v });
      });
      points.sort((a, b) => a.t - b.t);
      if (points.length >= 5) return { date: row[0], points };
    } catch {
      // 다음 연도 시도
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

async function fetchSecurities(now = new Date()) {
  const from = ymd(new Date(now.getTime() + 365 * 86400000)); // 1년 이상 남은 것만
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
      const json = await res.json();
      const rows = Array.isArray(json?.data) ? json.data : [];
      if (!rows.length) continue;
      const map = new Map();
      for (const r of rows) {
        if (!r.cusip || map.has(r.cusip)) continue;
        const term = r.original_security_term && r.original_security_term !== "null" ? r.original_security_term : r.security_term;
        const coupon = rateField ? parseFloat(r[rateField]) : NaN;
        map.set(r.cusip, {
          cusip: r.cusip,
          maturity: r.maturity_date,
          origMonths: termMonths(term),
          issueDate: r.issue_date,
          coupon: Number.isFinite(coupon) ? coupon : null,
        });
      }
      return [...map.values()];
    } catch {
      // 다음 필드 이름 시도
    }
  }
  return [];
}

// ---------- CTD 계산 ----------

/**
 * @param {Object} opts
 * @param {Map<string, number>} [opts.couponByCusip] 재무부 자료에 쿠폰이 없을 때 보충용 (예: NY Fed 대차 종목 설명에서 읽은 쿠폰)
 * @returns {Promise<{deliveryMonth: string, curveDate: string, ctd: Object<string, {cusip, coupon, maturity, cf}>} | null>}
 */
export async function estimateCtd({ couponByCusip } = {}) {
  const now = new Date();
  const dm = deliveryMonth(now);
  if (!dm) return null;
  const [curve, secs] = await Promise.all([fetchYieldCurve(now), fetchSecurities(now)]);
  if (!curve || !secs.length) return null;

  const ctd = {};
  for (const [key, rule] of Object.entries(CONTRACTS)) {
    let best = null;
    for (const s of secs) {
      const coupon = s.coupon ?? couponByCusip?.get(s.cusip) ?? null;
      if (coupon == null || !s.maturity || s.origMonths == null) continue;
      if (s.issueDate && s.issueDate !== "null" && s.issueDate > ymd(dm.last)) continue;

      const remFirst = monthsBetween(dm.first, s.maturity);
      const remLast = monthsBetween(dm.last, s.maturity);
      if (rule.origMax != null && s.origMonths > rule.origMax) continue;
      if (rule.origExact != null && s.origMonths !== rule.origExact) continue;
      if (rule.remMin != null && remFirst < rule.remMin) continue;
      if (rule.remMax != null && remFirst > rule.remMax) continue;
      if (rule.remMaxExclusive != null && remFirst >= rule.remMaxExclusive) continue;
      if (rule.remFromLastMin != null && remLast < rule.remFromLastMin) continue;
      if (rule.remFromLastMax != null && remLast > rule.remFromLastMax) continue;

      const T = (new Date(s.maturity) - now) / (365.25 * 86400000);
      const price = bondPrice(coupon, interp(curve.points, T), T);
      const cf = conversionFactor(coupon, remFirst, !!rule.monthly);
      const score = price / cf; // 낮을수록 인도에 유리 (= CTD)
      if (!best || score < best.score) best = { cusip: s.cusip, coupon, maturity: s.maturity, cf, score };
    }
    if (best) ctd[key] = { cusip: best.cusip, coupon: best.coupon, maturity: best.maturity, cf: best.cf, label: rule.label };
  }

  return { deliveryMonth: ymd(dm.first).slice(0, 7), curveDate: curve.date, ctd };
}
