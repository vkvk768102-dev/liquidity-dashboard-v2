// 17번 카드용: SLOOS (연준 대출 담당자 설문) - 은행 대출 기준 강화/완화
// 데이터 출처: FRED (세인트루이스 연준) 공개 CSV. API 키 불필요.
// 지표: DRTSCILM = 중대형 기업 대상 상업·산업(C&I) 대출 기준을 "강화했다"는 은행 비율 - "완화했다"는 은행 비율 (%)
//   - 0보다 크면: 강화한 은행이 더 많음 (대출 문턱이 높아지는 중)
//   - 0보다 작으면: 완화한 은행이 더 많음 (평상시)
//   - 분기 데이터 (1·4·7·10월 조사 → 2·5·8·11월 초 발표)
//
// 보는 방법 (숫자 크기보다 "0선 위에 몇 분기 연속으로 있는가"):
//   - 1단계 정상: 0선 아래이거나, 위로 1분기만 튄 상태
//   - 2단계 선별 시작: 0선 위 2분기 연속
//   - 3단계 긴축 고착: 0선 위 3분기 이상 연속
export const dynamic = "force-dynamic";

const SERIES = "DRTSCILM";
const CSV_URL = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${SERIES}`;
const STAGE2_QUARTERS = 2; // 0선 위 연속 분기 수가 이 이상이면 2단계
const STAGE3_QUARTERS = 3; // 이 이상이면 3단계

// FRED CSV: 첫 줄은 제목(observation_date,DRTSCILM), 값이 없는 분기는 "."
function parseCsv(text) {
  const points = [];
  for (const line of text.split(/\r?\n/)) {
    const [d, v] = line.split(",");
    if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d.trim())) continue;
    const value = parseFloat(v);
    if (!Number.isFinite(value)) continue;
    points.push({ date: d.trim(), value });
  }
  return points;
}

async function fetchFromCsv() {
  const res = await fetch(CSV_URL, {
    cache: "no-store",
    headers: { "User-Agent": "Mozilla/5.0 (liquidity-dashboard)" },
  });
  if (!res.ok) throw new Error(`FRED CSV 응답 오류 (${res.status})`);
  const points = parseCsv(await res.text());
  if (!points.length) throw new Error("FRED CSV에서 값을 읽지 못했습니다");
  return points;
}

// 예비: CSV가 막힐 때만 사용. Vercel 환경변수에 FRED_API_KEY가 있을 때만 작동
async function fetchFromApi(apiKey) {
  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${SERIES}&api_key=${apiKey}&file_type=json`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`FRED API 응답 오류 (${res.status})`);
  const json = await res.json();
  const points = (json.observations || [])
    .map((o) => ({ date: o.date, value: parseFloat(o.value) }))
    .filter((p) => Number.isFinite(p.value));
  if (!points.length) throw new Error("FRED API에서 값을 읽지 못했습니다");
  return points;
}

export async function GET() {
  try {
    let points;
    try {
      points = await fetchFromCsv();
    } catch (e) {
      if (!process.env.FRED_API_KEY) throw e;
      points = await fetchFromApi(process.env.FRED_API_KEY);
    }
    points.sort((a, b) => (a.date < b.date ? -1 : 1));

    const latest = points[points.length - 1];
    const prev = points.length > 1 ? points[points.length - 2] : null;

    // 최신 분기부터 거꾸로 세어, 0선 위(강화)에 연속으로 있는 분기 수
    let streakAbove = 0;
    for (let i = points.length - 1; i >= 0 && points[i].value > 0; i--) streakAbove++;
    // 반대로 0 이하(완화·중립)에 연속으로 있는 분기 수
    let streakBelow = 0;
    for (let i = points.length - 1; i >= 0 && points[i].value <= 0; i--) streakBelow++;

    const stage = streakAbove >= STAGE3_QUARTERS ? 3 : streakAbove >= STAGE2_QUARTERS ? 2 : 1;

    // 지금 이어지는 0선 위 구간 안에서의 최고점 (긴축 강도가 꺾였는지 보기 위함)
    const streakPoints = streakAbove > 0 ? points.slice(points.length - streakAbove) : [];
    const streakPeak = streakPoints.reduce((m, p) => (m == null || p.value > m.value ? p : m), null);

    return Response.json({
      ok: true,
      series: SERIES,
      latestDate: latest.date,
      latestValue: latest.value,
      change: prev ? latest.value - prev.value : null,
      streakAbove,
      streakBelow,
      stage,
      streakStartDate: streakPoints.length ? streakPoints[0].date : null,
      streakPeak,
      points,
    });
  } catch (e) {
    return Response.json({ ok: false, error: e.message }, { status: 500 });
  }
}
