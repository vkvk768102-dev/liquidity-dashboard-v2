// lib/bondMath.js
// 미국 국채(T-Note/Bond) 수익률 -> 클린가격 변환 유틸
// Actual/Actual (ICMA), semiannual bond basis 기준

/**
 * 날짜에서 n개월을 뺀 날짜를 반환. 원래 날짜가 "그 달의 마지막 날"이면
 * 결과도 "그 달의 마지막 날"로 맞춰줌 (예: 8/31 - 6개월 = 2/28 또는 2/29)
 */
function subtractMonths(date, n) {
  const d = new Date(date.getTime());
  const isLastDayOfMonth =
    new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate() === d.getDate();

  d.setMonth(d.getMonth() - n);

  if (isLastDayOfMonth) {
    // 결과 달의 마지막 날로 스냅
    const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(lastDay);
  }
  return d;
}

function daysBetween(d1, d2) {
  const MS_PER_DAY = 1000 * 60 * 60 * 24;
  return Math.round((d2.getTime() - d1.getTime()) / MS_PER_DAY);
}

/**
 * 만기일로부터 거꾸로 6개월씩 쿠폰 지급일을 생성해서,
 * settlement 이후의 쿠폰 지급일들만 오름차순으로 반환.
 */
function generateCouponDates(settlement, maturity) {
  const dates = [];
  let cur = new Date(maturity.getTime());

  // maturity 자체도 쿠폰+원금 지급일이므로 포함
  while (cur > settlement) {
    dates.push(new Date(cur.getTime()));
    cur = subtractMonths(cur, 6);
  }
  // cur은 이제 settlement 이전(직전 쿠폰일 또는 발행일)
  dates.reverse(); // 오름차순
  return { couponDates: dates, prevCouponDate: cur };
}

/**
 * @param {Date} settlement - 결제일
 * @param {Date} maturity - 만기일
 * @param {number} couponRate - 연 쿠폰율 (예: 0.045 = 4.5%)
 * @param {number} ytm - 연 수익률(만기수익률), semiannual compounding 기준 (예: 0.048527)
 * @returns {{cleanPrice: number, dirtyPrice: number, accrued: number}}
 */
export function priceFromYield(settlement, maturity, couponRate, ytm) {
  const { couponDates, prevCouponDate } = generateCouponDates(settlement, maturity);
  const n = couponDates.length;
  if (n === 0) {
    throw new Error("만기가 이미 지났거나 계산할 쿠폰 기간이 없습니다.");
  }

  const nextCoupon = couponDates[0];
  const periodDays = daysBetween(prevCouponDate, nextCoupon);
  const daysToNext = daysBetween(settlement, nextCoupon);
  const w = daysToNext / periodDays; // 다음 쿠폰까지 남은 기간 비율

  const C = (couponRate / 2) * 100; // 반기 쿠폰 (액면 100 기준)
  const y2 = ytm / 2;

  let dirtyPrice = 0;
  for (let k = 1; k <= n; k++) {
    const cf = C + (k === n ? 100 : 0);
    const disc = Math.pow(1 + y2, k - 1 + w);
    dirtyPrice += cf / disc;
  }

  const accruedDays = periodDays - daysToNext;
  const accrued = C * (accruedDays / periodDays);
  const cleanPrice = dirtyPrice - accrued;

  return { cleanPrice, dirtyPrice, accrued };
}

export function decimalToTicks(price) {
  const whole = Math.trunc(price);
  const frac = Math.abs(price - whole) * 32;
  const sign = price < 0 ? "-" : "";
  return `${sign}${Math.abs(whole)}-${frac.toFixed(1).padStart(4, "0")}`;
}
