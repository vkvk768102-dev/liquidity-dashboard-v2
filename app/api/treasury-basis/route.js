// app/api/treasury-basis/route.js
import { priceFromYield, decimalToTicks } from "@/lib/bondMath";

// 재무부 공식 일일 Par Yield Curve (CSV, 무료, 키 불필요)
const TREASURY_CSV_URL =
  "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/{YEAR}/all?field_tdr_date_value={YEAR}&type=daily_treasury_yield_curve&page&_format=csv";

// 커브 만기 포인트 (연 단위)와 CSV 컬럼 순서
const CURVE_TENORS = [
  { years: 1 / 12, col: "1 Mo" },
  { years: 2 / 12, col: "2 Mo" },
  { years: 3 / 12, col: "3 Mo" },
  { years: 6 / 12, col: "6 Mo" },
  { years: 1, col: "1 Yr" },
  { years: 2, col: "2 Yr" },
  { years: 3, col: "3 Yr" },
  { years: 5, col: "5 Yr" },
  { years: 7, col: "7 Yr" },
  { years: 10, col: "10 Yr" },
  { years: 20, col: "20 Yr" },
  { years: 30, col: "30 Yr" },
];

function parseCsv(text) {
  const lines = text.trim().split("\n");
  const header = lines[0].split(",").map((h) => h.replace(/"/g, "").trim());
  // 재무부 CSV는 최신 날짜가 맨 위(헤더 바로 다음 줄)에 옵니다.
  const firstDataRow = lines[1].split(",").map((v) => v.replace(/"/g, "").trim());
  const row = {};
  header.forEach((h, i) => (row[h] = firstDataRow[i]));
  return row;
}

// 선형보간으로 targetYears 시점의 par yield(%) 추정
function interpolateYield(row, targetYears) {
  const points = CURVE_TENORS
    .map((t) => ({ years: t.years, yield: parseFloat(row[t.col]) }))
    .filter((p) => !isNaN(p.yield));

  if (points.length === 0) {
    throw new Error("재무부 CSV 데이터를 파싱하지 못했습니다 (컬럼명이 바뀌었을 수 있음)");
  }
  if (targetYears <= points[0].years) return points[0].yield;
  if (targetYears >= points[points.length - 1].years)
    return points[points.length - 1].yield;

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (targetYears >= a.years && targetYears <= b.years) {
      const frac = (targetYears - a.years) / (b.years - a.years);
      return a.yield + frac * (b.yield - a.yield);
    }
  }
  return points[points.length - 1].yield;
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);

    // --- 클라이언트가 보내는 CTD/선물 정보 (분기마다 수동 갱신) ---
    const ctdCoupon = parseFloat(searchParams.get("ctdCoupon")); // 예: 4.5 (%)
    const ctdMaturity = searchParams.get("ctdMaturity"); // 예: "2033-08-31"
    const cf = parseFloat(searchParams.get("cf")); // 예: 0.9202
    const futuresSymbol = searchParams.get("futuresSymbol") || "ZN=F";

    if (!ctdCoupon || !ctdMaturity || !cf) {
      return Response.json(
        { error: "ctdCoupon, ctdMaturity, cf 파라미터가 필요합니다." },
        { status: 400 }
      );
    }

    const settlement = new Date();
    const maturityDate = new Date(ctdMaturity + "T00:00:00");
    const yearsToMaturity =
      (maturityDate.getTime() - settlement.getTime()) / (1000 * 60 * 60 * 24 * 365.25);

    // 1) 선물가격 (Yahoo Finance, 비공식)
    const yfRes = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${futuresSymbol}`,
      { headers: { "User-Agent": "Mozilla/5.0" }, next: { revalidate: 60 } }
    );
    const yfJson = await yfRes.json();
    const futuresPrice = yfJson?.chart?.result?.[0]?.meta?.regularMarketPrice;

    if (!futuresPrice) {
      return Response.json({ error: "선물가격을 가져오지 못했습니다." }, { status: 502 });
    }

    // 2) 재무부 공식 Par Yield Curve -> CTD 만기 지점 보간
    const year = settlement.getFullYear();
    const csvRes = await fetch(
      TREASURY_CSV_URL.replace(/{YEAR}/g, String(year)),
      { next: { revalidate: 3600 } }
    );
    const csvText = await csvRes.text();
    const row = parseCsv(csvText);
    const estYieldPct = interpolateYield(row, yearsToMaturity);
    const estYield = estYieldPct / 100;

    // 3) 추정 수익률로 CTD 현물 클린가격 역산
    const { cleanPrice } = priceFromYield(settlement, maturityDate, ctdCoupon / 100, estYield);

    // 4) Gross Basis 계산
    const adj = futuresPrice * cf;
    const grossBasis = cleanPrice - adj;

    return Response.json({
      asOf: settlement.toISOString(),
      futuresSymbol,
      futuresPrice,
      cf,
      ctdCoupon,
      ctdMaturity,
      estimatedYieldPct: estYieldPct,
      cashPrice: Number(cleanPrice.toFixed(4)),
      cashPriceTicks: decimalToTicks(cleanPrice),
      futuresPriceTicks: decimalToTicks(futuresPrice),
      grossBasis: Number(grossBasis.toFixed(4)),
      grossBasisTicks: decimalToTicks(grossBasis),
      note: "cashPrice는 재무부 Par Yield Curve 보간값으로 추정한 근사치입니다. 실제 CTD 시장가와 소폭 차이가 있을 수 있습니다.",
    });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
