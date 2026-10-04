// app/api/treasury-basis/route.js
// 10년 국채선물(ZN) Gross Basis = CTD 현물가격 − 선물가격 × 전환계수(CF)
// - 자동 모드(기본): 재무부 FedInvest 실제 종가 + 선물 종가로 Implied Repo가 가장 높은 국채를 CTD로 자동 선택
// - 수동 모드: 직접 입력한 CTD(쿠폰·만기·CF) 사용. 현물가격은 실제 종가에서 찾고, 없으면 금리곡선으로 추정
// - 최근 4주 일별 추이(CTD가 바뀐 날 표시) 함께 제공
// - 장이 끝나 확정된 종가만 사용 (장중 가격을 섞으면 숫자가 하루에도 여러 번 바뀜)
import { priceFromYield, decimalToTicks } from "@/lib/bondMath";
import { fetchFedInvestPrices, fetchFedInvestDebug, isFinalDay } from "../../lib/treasuryPrices.js";
import { fetchSecurityInfo, pickCtd, rankCtd, deliveryMonth } from "../../lib/ctd.js";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // 재무부 가격을 날짜마다 따로 받아 오느라 처음 한 번은 몇 초 걸릴 수 있음

const WEEKS = 4;
const HYSTERESIS = 0.05; // 새 후보가 Implied Repo로 0.05%p 이상 앞설 때만 CTD 교체
const SIGNAL_WATCH = 25; // Implied Repo − SOFR 차이(bp) 주의 기준
const SIGNAL_BAD = 50; // 경계 기준
const UNSTABLE_RANGE = 100; // 최근 5일 값의 최대−최소가 이보다 크면(bp) "데이터 흔들림"으로 표시
const SHIFT_MARGIN = 0.7; // 날짜 보정은 확실히(30% 이상) 더 매끄러울 때만 적용

// 그 날짜의 미국 장이 끝났는지: 선물 마감(뉴욕 17시 = UTC 21~22시) 이후만 "끝난 날"로 봄
const isClosed = (dateIso) => Date.now() >= Date.parse(dateIso + "T22:30:00Z");

const median = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// 선물 거래일 읽기: 뉴욕시간 18시에 다음 거래일이 시작되므로 6시간을 더한 뒤 뉴욕 날짜를 읽음
// (UTC 날짜로 읽으면 저녁 시간대의 진행 중 가격이 전날 종가를 덮어쓰는 문제가 생김)
const NY_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
const tradeDate = (tsSec) => NY_DATE.format(new Date((tsSec + 6 * 3600) * 1000));

/** Yahoo 선물 일별 종가: { closes: Map(거래일 → 종가), last } */
async function fetchFuturesCloses(symbol) {
  try {
    const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=3mo&interval=1d`, {
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
      if (cl[i] != null) closes.set(tradeDate(t), cl[i]);
    });
    return { closes, last: r.meta?.regularMarketPrice ?? null };
  } catch {
    return null;
  }
}

// 그 날짜에 계산 기준이 되는 선물 월물 기호 (예: 2026년 12월물 → ZNZ26.CBT)
// ZN=F(연결 선물)는 월물이 바뀌는 시기(3·6·9·12월 초~하순)에 이전 월물 가격이 나와서,
// 전환계수·인도일(다음 월물 기준)과 서로 다른 월물이 섞이는 문제가 있음 → 월물을 직접 지정
const MONTH_CODE = { 2: "H", 5: "M", 8: "U", 11: "Z" };
function contractSymbol(dateIso) {
  const dm = deliveryMonth(new Date(dateIso + "T00:00:00Z"));
  if (!dm) return null;
  return `ZN${MONTH_CODE[dm.first.getUTCMonth()]}${String(dm.first.getUTCFullYear()).slice(2)}.CBT`;
}
// ZN=F가 아직 이전 월물일 수 있는 기간 (인도월 1일~26일): 월물 지정 가격을 못 구하면 이 기간은 계산에서 뺌
function genericMismatch(dateIso) {
  const [, m, d] = dateIso.split("-").map(Number);
  return m % 3 === 0 && d <= 26;
}

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
    const auto = futuresSymbol === "ZN=F"; // 기본값이면 날짜별 월물을 자동 지정
    const symByDate = dates.map((d) => (auto ? contractSymbol(d) : futuresSymbol));
    const symbols = [...new Set(symByDate.filter(Boolean))];
    const [generic, contractHists, info, priceLists, sofrMap] = await Promise.all([
      auto ? fetchFuturesCloses("ZN=F") : null,
      Promise.all(symbols.map((sym) => fetchFuturesCloses(sym))),
      fetchSecurityInfo(),
      Promise.all(dates.map((d) => fetchFedInvestPrices(d))),
      fetchSofr(),
    ]);
    const histBySym = new Map(symbols.map((sym, k) => [sym, contractHists[k]?.closes?.size ? contractHists[k] : null]));
    // 날짜별로 쓸 선물 자료: 월물 지정 가격 → (없으면) ZN=F. 단, ZN=F가 이전 월물일 수 있는 기간은 제외
    const histByDate = dates.map((d, i) => {
      const own = histBySym.get(symByDate[i]);
      if (own) return { hist: own, symbol: symByDate[i] };
      if (auto && generic && !genericMismatch(d)) return { hist: generic, symbol: "ZN=F" };
      return null;
    });
    const hist = [...histByDate].reverse().find(Boolean)?.hist ?? generic ?? null;
    if (!hist && !searchParams.get("debug")) return Response.json({ error: "선물가격을 가져오지 못했습니다." }, { status: 502 });

    // 계산에 쓸 날짜: 장이 끝났고(시계 기준) 재무부 확정 종가가 올라온 날만
    // (확정 여부를 알 수 없는 형식이면 시계 기준만 적용)
    const finalFlags = priceLists.map((l) => isFinalDay(l));
    const anyFinal = finalFlags.some(Boolean);
    const usable = dates.map((d, i) => !!priceLists[i]?.length && isClosed(d) && (!anyFinal || finalFlags[i]));

    // i번째 날짜의 선물 종가 = (i + shift)번째 평일 날짜로 표기된 종가. 끝나지 않은 날이거나 그날 종가가 없으면 그날은 건너뜀
    const futAtIdx = (i, shift) => {
      const h = histByDate[i]?.hist;
      if (!h) return null;
      const label = dates[i + shift];
      return label && isClosed(label) && h.closes.has(label) ? h.closes.get(label) : null;
    };

    // 선물 날짜 보정(안전장치): 기본은 보정 없음(0). −1/+1일 쪽이 확실히 더 매끄러울 때만 적용
    let futuresShift = 0;
    if (hist && mode === "auto") {
      const lastIdx = usable.lastIndexOf(true);
      const ref = lastIdx >= 0 ? pickCtd("ZN", priceLists[lastIdx], info, futAtIdx(lastIdx, 0), dates[lastIdx]) : null;
      if (ref) {
        const scoreOf = (shift) => {
          const series = [];
          dates.forEach((date, i) => {
            if (!usable[i]) return;
            const row = priceLists[i].find((r) => r.cusip === ref.cusip);
            const f = futAtIdx(i, shift);
            if (row && f) series.push(row.price - f * ref.cf);
          });
          if (series.length < 5) return Infinity;
          let sum = 0;
          for (let k = 1; k < series.length; k++) sum += Math.abs(series[k] - series[k - 1]);
          return sum / (series.length - 1);
        };
        const base = scoreOf(0);
        let bestScore = base;
        for (const shift of [-1, 1]) {
          const sc = scoreOf(shift);
          if (sc < base * SHIFT_MARGIN && sc < bestScore) {
            bestScore = sc;
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
      if (!usable[i] || !futures) return;

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
          date, futures, cash: chosen.price, cf: chosen.cf, symbol: histByDate[i].symbol,
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
          date, futures, cash: row.price, cf: mCf, symbol: histByDate[i].symbol,
          basis: row.price - futures * mCf,
          cusip: row.cusip, coupon: mCoupon, maturity: mMaturity,
        });
      }
    });

    // 진단 모드: /api/treasury-basis?debug=1
    if (searchParams.get("debug")) {
      const withRows = dates.map((d, i) => ({ date: d, rows: priceLists[i]?.length ?? 0, final: finalFlags[i], closed: isClosed(d), used: usable[i] }));
      const sample = priceLists.find((l) => l?.length)?.slice(0, 3) ?? [];
      const lastWeekday = dates[dates.length - 1];
      return Response.json({
        debug: true,
        fedInvestTry: await fetchFedInvestDebug(lastWeekday),
        fedInvestDays: withRows,
        fedInvestSample: sample,
        futuresSymbols: symbols.map((sym) => ({ symbol: sym, ok: !!histBySym.get(sym), lastDays: histBySym.get(sym) ? [...histBySym.get(sym).closes.keys()].slice(-5) : null })),
        genericDays: generic ? [...generic.closes.keys()].slice(-5) : null,
        futuresByDate: dates.map((d, i) => ({ date: d, symbol: histByDate[i]?.symbol ?? null, close: futAtIdx(i, 0) })),
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

    // 신호: Implied Repo − SOFR (최근 5일 중앙값, bp). 평균은 하루만 튀어도 크게 흔들려서 중앙값 사용
    const spreads = history
      .map((h) => {
        const sofr = sofrOn(sofrMap, h.date);
        return h.irr != null && sofr != null ? (h.irr - sofr) * 100 : null;
      })
      .filter((v) => v != null);
    const recent = spreads.slice(-5);
    const spreadBp = recent.length ? median(recent) : null;
    const unstable = recent.length >= 3 && Math.max(...recent) - Math.min(...recent) > UNSTABLE_RANGE;
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
        latestDate: latest.date,
        unstable,
        sofr: latestSofr,
        direction: dir,
        message,
      };
    }

    return Response.json({
      mode,
      method: "실제 종가",
      signal,
      futuresSymbol: latest.symbol ?? futuresSymbol,
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
        futures: Number(h.futures.toFixed(4)),
        cash: Number(h.cash.toFixed(4)),
        symbol: h.symbol,
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
