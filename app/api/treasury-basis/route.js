// app/api/treasury-basis/route.js
// 10년 국채선물(ZN) Gross Basis = CTD 현물가격 − 선물가격 × 전환계수(CF)
// - 자동 모드(기본): 재무부 FedInvest 실제 종가 + 선물 종가로 Implied Repo가 가장 높은 국채를 CTD로 자동 선택
// - 수동 모드: 직접 입력한 CTD(쿠폰·만기·CF) 사용. 현물가격은 실제 종가에서 찾고, 없으면 금리곡선으로 추정
// - 최근 4주 일별 추이(CTD가 바뀐 날 표시) 함께 제공
import { priceFromYield, decimalToTicks } from "@/lib/bondMath";
import { fetchFedInvestPrices, fetchFedInvestDebug } from "../../lib/treasuryPrices.js";
import { fetchSecurityInfo, fetchFuturesHistory, closeOn, pickCtd, rankCtd } from "../../lib/ctd.js";

export const dynamic = "force-dynamic";

const WEEKS = 4;
const HYSTERESIS = 0.05; // 새 후보가 Implied Repo로 0.05%p 이상 앞설 때만 CTD 교체
const SIGNAL_WATCH = 25; // Implied Repo − SOFR 차이(bp) 주의 기준
const SIGNAL_BAD = 50; // 경계 기준

// 뉴욕연은 SOFR 최근 값들: Map(날짜 → %)
async function fetchSofr() {
  try {
    const res = await fetch("https://markets.newyorkfed.org/api/rates/secured/sofr/last/40.json", { next: { revalidate: 3600 } });
    if (!res.ok) return new Map();
    const list = (await res.json())?.refRates ?? [];
    return new Map(list.filter((r) => r.percentRate != null).map((r) => [r.effectiveDate, Number(r.percentRate)]));
  } catch {
    return new Map();
  }
}

function sofrOn(map, date) {
  if (map.has(date)) return map.get(date);
  const keys = [...map.keys()].filter((k) => k <= date).sort();
  return keys.length ? map.get(keys[keys.length - 1]) : null;
}

const TREASURY_CSV_URL =
  "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/{YEAR}/all?field_tdr_date_value={YEAR}&type=daily_treasury_yield_curve&page&_format=csv";
const CURVE_TENORS = [
  { years: 1 / 12, col: "1 Mo" }, { years: 2 / 12, col: "2 Mo" }, { years: 3 / 12, col: "3 Mo" },
  { years: 6 / 12, col: "6 Mo" }, { years: 1, col: "1 Yr" }, { years: 2, col: "2 Yr" },
  { years: 3, col: "3 Yr" }, { years: 5, col: "5 Yr" }, { years: 7, col: "7 Yr" },
  { years: 10, col: "10 Yr" }, { years: 20, col: "20 Yr" }, { years: 30, col: "30 Yr" },
];

// 최근 N일 중 평일 날짜 (오래된 순)
function recentWeekdays(days) {
  const out = [];
  const d = new Date();
  for (let i = 0; i <= days; i++) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return out.reverse();
}

// 예비용: 금리곡선으로 현물가격 추정 (기존 방식)
async function curveCashPrice(ctdCoupon, ctdMaturity) {
  const settlement = new Date();
  const maturityDate = new Date(ctdMaturity + "T00:00:00");
  const years = (maturityDate - settlement) / (1000 * 60 * 60 * 24 * 365.25);
  const res = await fetch(TREASURY_CSV_URL.replace(/{YEAR}/g, String(settlement.getFullYear())), { next: { revalidate: 3600 } });
  const lines = (await res.text()).trim().split("\n");
  const header = lines[0].split(",").map((h) => h.replace(/"/g, "").trim());
  const first = lines[1].split(",").map((v) => v.replace(/"/g, "").trim());
  const row = {};
  header.forEach((h, i) => (row[h] = first[i]));
  const pts = CURVE_TENORS.map((t) => ({ years: t.years, y: parseFloat(row[t.col]) })).filter((p) => !isNaN(p.y));
  let y = pts[pts.length - 1].y;
  if (years <= pts[0].years) y = pts[0].y;
  for (let i = 0; i < pts.length - 1; i++) {
    if (years >= pts[i].years && years <= pts[i + 1].years) {
      y = pts[i].y + ((years - pts[i].years) / (pts[i + 1].years - pts[i].years)) * (pts[i + 1].y - pts[i].y);
      break;
    }
  }
  return priceFromYield(settlement, maturityDate, ctdCoupon / 100, y / 100).cleanPrice;
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const mode = searchParams.get("mode") === "manual" ? "manual" : "auto";
    const futuresSymbol = searchParams.get("futuresSymbol") || "ZN=F";
    const mCoupon = parseFloat(searchParams.get("ctdCoupon"));
    const mMaturity = searchParams.get("ctdMaturity");
    const mCf = parseFloat(searchParams.get("cf"));

    const dates = recentWeekdays(WEEKS * 7);
    const [hist, info, priceLists, sofrMap] = await Promise.all([
      fetchFuturesHistory(futuresSymbol),
      fetchSecurityInfo(),
      Promise.all(dates.map((d) => fetchFedInvestPrices(d))),
      fetchSofr(),
    ]);
    if (!hist && !searchParams.get("debug")) return Response.json({ error: "선물가격을 가져오지 못했습니다." }, { status: 502 });

    // 선물 종가 날짜 맞추기: 사이트마다 날짜 표기가 하루씩 어긋날 수 있어서
    // −1/0/+1 거래일 중 같은 국채의 베이시스가 가장 매끄럽게 이어지는 쪽을 자동 선택
    // i번째 날짜의 선물 종가 = (i + shift)번째 평일 날짜로 표기된 종가
    const futAtIdx = (i, shift) => {
      if (!hist) return null;
      const label = dates[i + shift];
      if (label && hist.closes.has(label)) return hist.closes.get(label);
      return shift === 0 ? closeOn(hist, dates[i]) : null;
    };
    let futuresShift = 0;
    if (hist && mode === "auto") {
      const lastIdx = priceLists.map((l) => l?.length > 0).lastIndexOf(true);
      const ref = lastIdx >= 0 ? pickCtd("ZN", priceLists[lastIdx], info, futAtIdx(lastIdx, 0), dates[lastIdx]) : null;
      if (ref) {
        let bestScore = Infinity;
        for (const shift of [0, -1, 1]) {
          const series = [];
          dates.forEach((date, i) => {
            const row = priceLists[i]?.find((r) => r.cusip === ref.cusip);
            const f = futAtIdx(i, shift);
            if (row && f) series.push(row.price - f * ref.cf);
          });
          if (series.length < 5) continue;
          let sum = 0;
          for (let k = 1; k < series.length; k++) sum += Math.abs(series[k] - series[k - 1]);
          const score = sum / (series.length - 1);
          if (score < bestScore - 1e-9) {
            bestScore = score;
            futuresShift = shift;
          }
        }
      }
    }

    // 일별 계산
    const history = [];
    let currentCtd = null;
    dates.forEach((date, i) => {
      const rows = priceLists[i];
      const futures = futAtIdx(i, futuresShift);
      if (!rows?.length || !futures) return;

      if (mode === "auto") {
        const ranked = rankCtd("ZN", rows, info, futures, date);
        if (!ranked.length) return;
        const top = ranked[0];
        // 기존 CTD를 유지하다가, 새 후보가 확실히 앞설 때만 교체 (오락가락 방지)
        let chosen = top;
        if (currentCtd && top.cusip !== currentCtd) {
          const cur = ranked.find((c) => c.cusip === currentCtd);
          if (cur && top.irr != null && cur.irr != null && top.irr - cur.irr < HYSTERESIS) chosen = cur;
        }
        currentCtd = chosen.cusip;
        const other = ranked.find((c) => c.cusip !== chosen.cusip);
        history.push({
          date, futures, cash: chosen.price, cf: chosen.cf,
          basis: chosen.price - futures * chosen.cf,
          cusip: chosen.cusip, coupon: chosen.coupon, maturity: chosen.maturity,
          irr: chosen.irr,
          runnerUp: other ? { cusip: other.cusip, coupon: other.coupon, maturity: other.maturity, cf: other.cf, irr: other.irr } : null,
          gap: other && chosen.irr != null && other.irr != null ? chosen.irr - other.irr : null,
        });
      } else if (mCoupon && mMaturity && mCf) {
        const row = rows.find((r) => Math.abs(r.coupon - mCoupon) < 1e-6 && r.maturity === mMaturity);
        if (!row) return;
        history.push({
          date, futures, cash: row.price, cf: mCf,
          basis: row.price - futures * mCf,
          cusip: row.cusip, coupon: mCoupon, maturity: mMaturity,
        });
      }
    });

    // 진단 모드: /api/treasury-basis?debug=1
    if (searchParams.get("debug")) {
      const withRows = dates.map((d, i) => ({ date: d, rows: priceLists[i]?.length ?? 0 }));
      const sample = priceLists.find((l) => l?.length)?.slice(0, 3) ?? [];
      const lastWeekday = dates[dates.length - 1];
      return Response.json({
        debug: true,
        fedInvestTry: await fetchFedInvestDebug(lastWeekday),
        fedInvestDays: withRows,
        fedInvestSample: sample,
        futuresDays: hist ? [...hist.closes.keys()].slice(-8) : null,
        futuresLast: hist?.last ?? null,
        auctionInfoCount: info.size,
        futuresShift,
        historyCount: history.length,
      });
    }

    // CTD가 바뀐 날 표시
    history.forEach((h, i) => {
      h.ctdChanged = i > 0 && history[i - 1].cusip !== h.cusip;
    });

    const latest = history[history.length - 1];

    // 실제 가격을 하나도 못 구한 경우 → 기존 금리곡선 추정 방식으로 대체
    if (!latest) {
      if (!mCoupon || !mMaturity || !mCf) {
        return Response.json({ error: "실제 국채 가격을 가져오지 못했고, CTD 설정값도 없습니다." }, { status: 502 });
      }
      const futuresPrice = hist.last;
      const cash = await curveCashPrice(mCoupon, mMaturity);
      const grossBasis = cash - futuresPrice * mCf;
      return Response.json({
        mode, method: "금리곡선 추정", futuresSymbol, futuresPrice, cf: mCf,
        ctdCoupon: mCoupon, ctdMaturity: mMaturity, ctdCusip: null, priceDate: null,
        cashPrice: Number(cash.toFixed(4)), cashPriceTicks: decimalToTicks(cash),
        futuresPriceTicks: decimalToTicks(futuresPrice),
        grossBasis: Number(grossBasis.toFixed(4)), grossBasisTicks: decimalToTicks(grossBasis),
        history: [],
        note: "실제 국채 가격을 가져오지 못해 재무부 금리곡선으로 추정한 값입니다 (CTD는 수동 설정값).",
      });
    }

    // 신호: Implied Repo − SOFR (최근 5일 평균, bp)
    const spreads = history
      .map((h) => {
        const sofr = sofrOn(sofrMap, h.date);
        return h.irr != null && sofr != null ? (h.irr - sofr) * 100 : null;
      })
      .filter((v) => v != null);
    const recent = spreads.slice(-5);
    const spreadBp = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : null;
    const latestSofr = sofrOn(sofrMap, latest.date);
    let signal = null;
    if (spreadBp != null) {
      const abs = Math.abs(spreadBp);
      const level = abs >= SIGNAL_BAD ? "bad" : abs >= SIGNAL_WATCH ? "watch" : "ok";
      const dir = spreadBp < 0 ? "낮음" : "높음";
      const message =
        level === "ok"
          ? "Implied Repo와 SOFR가 비슷함. 베이시스 거래 유인 중립"
          : spreadBp < 0
          ? level === "bad"
            ? "베이시스 거래가 손해 나는 구간(역캐리). 헤지펀드 청산 유인 커짐"
            : "베이시스 거래 수익성 낮음. 새로 쌓을 유인 약함"
          : level === "bad"
          ? "베이시스 거래 수익성 높음. 레버리지가 빠르게 쌓이기 쉬움"
          : "베이시스 거래 수익성 양호. 포지션이 늘어날 수 있음";
      signal = {
        level,
        spreadBp: Number(spreadBp.toFixed(1)),
        spreadTodayBp: spreads.length ? Number(spreads[spreads.length - 1].toFixed(1)) : null,
        sofr: latestSofr,
        direction: dir,
        message,
      };
    }

    return Response.json({
      mode,
      method: "실제 종가",
      signal,
      futuresSymbol,
      futuresPrice: latest.futures,
      cf: latest.cf,
      ctdCoupon: latest.coupon,
      ctdMaturity: latest.maturity,
      ctdCusip: latest.cusip,
      priceDate: latest.date,
      cashPrice: Number(latest.cash.toFixed(4)),
      cashPriceTicks: decimalToTicks(latest.cash),
      futuresPriceTicks: decimalToTicks(latest.futures),
      grossBasis: Number(latest.basis.toFixed(4)),
      grossBasisTicks: decimalToTicks(latest.basis),
      impliedRepo: latest.irr != null ? Number(latest.irr.toFixed(3)) : null,
      futuresShift, // 선물 종가 날짜 보정 (거래일 단위)
      runnerUp: latest.runnerUp ?? null,
      gap: latest.gap != null ? Number(latest.gap.toFixed(3)) : null,
      history: history.map((h) => ({
        date: h.date,
        basis: Number(h.basis.toFixed(4)),
        irr: h.irr != null ? Number(h.irr.toFixed(3)) : null,
        cusip: h.cusip,
        coupon: h.coupon,
        maturity: h.maturity,
        ctdChanged: h.ctdChanged,
      })),
      note:
        mode === "auto"
          ? `CTD는 재무부 FedInvest 실제 종가와 선물 종가로 Implied Repo가 가장 높은 국채를 자동 선택했습니다 (${latest.date} 종가 기준).`
          : `CTD는 수동 설정값이고, 현물가격은 재무부 FedInvest 실제 종가입니다 (${latest.date} 기준).`,
    });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
