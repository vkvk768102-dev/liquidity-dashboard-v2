// 파일 위치: app/lib/cdsSnapshot.js
// 18번 카드(주요 국가 5년 CDS)용 "저장된 값".
// investing.com 자동 조회가 막혔을 때만 이 값을 대신 보여 줍니다 (카드에 "저장된 값"이라고 표시됨).
// 2026-10-08에 investing.com에서 확인한 값입니다. 단위: bp

export const SNAPSHOT_TAKEN = "2026-10-08";

// en: investing.com 표기, date: 그 값의 기준일
export const SNAPSHOT_COUNTRIES = [
  { en: "Egypt", value: 306.54, change: 2.88, changePct: 0.95, date: "2026-09-30" },
  { en: "Turkey", value: 252.1, change: 5.69, changePct: 2.31, date: "2026-10-01" },
  { en: "South Africa", value: 140.17, change: 5.34, changePct: 3.96, date: "2026-10-01" },
  { en: "Brazil", value: 131.05, change: -0.83, changePct: -0.63, date: "2026-10-02" },
  { en: "Mexico", value: 99.67, change: 1.98, changePct: 2.03, date: "2026-10-02" },
  { en: "Indonesia", value: 92.79, change: 1.25, changePct: 1.37, date: "2026-10-01" },
  { en: "India", value: 87.67, change: 1.21, changePct: 1.4, date: "2026-09-26" },
  { en: "France", value: 79.75, change: 9.61, changePct: 13.7, date: "2026-10-01" },
  { en: "Saudi Arabia", value: 66.73, change: 0.09, changePct: 0.13, date: "2026-09-30" },
  { en: "Italy", value: 65.63, change: 14.28, changePct: 27.8, date: "2026-10-01" },
  { en: "Israel", value: 61.4, change: 1.0, changePct: 1.65, date: "2026-10-02" },
  { en: "Canada", value: 39.6, change: 0, changePct: 0, date: "2025-11-21" },
  { en: "US", value: 37.34, change: 0.9, changePct: 2.48, date: "2026-10-01" },
  { en: "China", value: 35.8, change: 0.74, changePct: 2.13, date: "2026-10-01" },
  { en: "Japan", value: 26.37, change: 0.98, changePct: 3.88, date: "2026-10-01" },
  { en: "Spain", value: 24.59, change: 2.25, changePct: 10.06, date: "2026-10-01" },
  { en: "UK", value: 24.22, change: 1.62, changePct: 7.19, date: "2026-10-01" },
  { en: "South Korea", value: 22.8, change: 0.43, changePct: 1.92, date: "2026-10-01" },
  { en: "Australia", value: 15.94, change: 0.25, changePct: 1.57, date: "2026-10-01" },
  { en: "Germany", value: 10.53, change: 0.27, changePct: 2.61, date: "2026-10-01" },
  { en: "Switzerland", value: 8.0, change: 0.25, changePct: 3.21, date: "2026-10-01" },
];

// 미국 5년 CDS 일별 종가 (오래된 날짜 → 최근 날짜)
export const SNAPSHOT_US_HISTORY = [
  { date: "2026-08-31", value: 33.29 },
  { date: "2026-09-01", value: 33.28 },
  { date: "2026-09-02", value: 32.85 },
  { date: "2026-09-03", value: 32.38 },
  { date: "2026-09-04", value: 31.94 },
  { date: "2026-09-07", value: 31.94 },
  { date: "2026-09-08", value: 31.94 },
  { date: "2026-09-09", value: 31.94 },
  { date: "2026-09-10", value: 31.95 },
  { date: "2026-09-11", value: 32.41 },
  { date: "2026-09-14", value: 31.94 },
  { date: "2026-09-15", value: 31.93 },
  { date: "2026-09-16", value: 32.39 },
  { date: "2026-09-17", value: 32.39 },
  { date: "2026-09-18", value: 31.5 },
  { date: "2026-09-21", value: 32.62 },
  { date: "2026-09-22", value: 33.29 },
  { date: "2026-09-23", value: 33.29 },
  { date: "2026-09-24", value: 33.75 },
  { date: "2026-09-25", value: 33.75 },
];
