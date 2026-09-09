// 데이터 출처: OFR(미국 재무부 산하 금융조사국) 공개 API (data.financialresearch.gov). API 키 불필요.
// 지표 정의: GCF 레포(트라이파티 레포의 일부) 시장의 일일 "잔액"(Outstanding, 그 시점 쌓여있는 총량)
//   - 만기 구간(익일물/1개월미만/1개월이상 등)별 잔액을 모두 더한 총 잔액입니다.
//   - [참고] 뉴욕 연준이 발표하는 "월간 트라이파티 레포 전체 통계"(원본 이미지가 참고한 것으로
//     보이는 자료)는 API가 아니라 매달 파일명이 바뀌는 엑셀 파일로만 배포되어, 자동 갱신
//     대시보드에 넣기에는 너무 불안정해 제외했습니다. 대신 매일 공개되는 GCF 잔액 데이터를 씁니다.
const BASE = "https://data.financialresearch.gov/v1/series/timeseries";
const TENOR_MNEMONICS = [
  "REPO-GCF_OV_OO-P",
  "REPO-GCF_OV_LE30-P",
  "REPO-GCF_OV_B27-P",
  "REPO-GCF_OV_B830-P",
  "REPO-GCF_OV_G30-P",
];

async function fetchSeries(mnemonic) {
  try {
    const res = await fetch(`${BASE}?mnemonic=${mnemonic}`, { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data) && data.length > 0 ? data : null;
  } catch (e) {
    return null;
  }
}

export async function GET() {
  try {
    const results = await Promise.all(TENOR_MNEMONICS.map(fetchSeries));
    const validSeries = results.filter(Boolean);
    if (validSeries.length === 0) {
      return Response.json({ ok: false, error: "원본 데이터를 가져오지 못했습니다 (OFR GCF 레포 잔액)." }, { status: 502 });
    }

    // 날짜별로 여러 만기 구간 값을 합산
    const totalsByDate = new Map();
    for (const series of validSeries) {
      for (const [date, value] of series) {
        if (typeof value !== "number") continue;
        totalsByDate.set(date, (totalsByDate.get(date) || 0) + value);
      }
    }

    const sortedDates = [...totalsByDate.keys()].sort();
    const last5 = sortedDates.slice(-5);
    const points = last5.map((date) => ({ date, value: totalsByDate.get(date) }));

    const latest = points[points.length - 1];
    const prev = points.length > 1 ? points[points.length - 2] : null;
    const change = prev ? latest.value - prev.value : null;

    const daysSinceLatest = (Date.now() - new Date(latest.date).getTime()) / (1000 * 60 * 60 * 24);
    const stale = daysSinceLatest > 21;

    return Response.json({
      ok: true,
      latestDate: latest.date,
      latestValue: latest.value,
      change,
      points,
      stale,
      sourceNote: "OFR 공개 API - GCF 레포 일일 잔액(Outstanding), 만기 구간 합계",
    });
  } catch (e) {
    return Response.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
