// 16번 카드용: 프라이머리 딜러 국채 순포지션의 "몇 달간 추세"
// 데이터 출처: 뉴욕 연준 공식 Markets Data API (markets.newyorkfed.org). API 키 불필요.
// 지표: PDPOSGST-TOT = 국채(TIPS 제외) 순포지션 = 딜러가 가진 국채(롱) - 빌려서 판 국채(숏). 단위: 백만 달러
//
// 보는 방법 (숫자 크기나 역사적 최고치가 아니라 "방향"):
//   - 최근 4주 평균을 3개월 전 4주 평균, 6개월 전 4주 평균과 비교
//   - 3개월 전보다 10% 이상 줄었으면 "감소 추세" (딜러가 시장을 떠받치던 손을 빼는 중)
//   - 유지되거나 늘면 정상 (딜러가 아직 국채를 받아주고 있음)
export const dynamic = "force-dynamic";

const ROOT = "https://markets.newyorkfed.org/api/pd/get";
const KEY = "PDPOSGST-TOT";
const CHART_WEEKS = 26; // 화면에 그리는 기간 (약 6개월)
const NEED_WEEKS = 30; // 계산에 쓰는 기간 (6개월 전 4주 평균까지 구하려면 30주 필요)
const DOWN_PCT = -10; // 3개월 전 대비 이만큼(%) 이하로 줄면 "감소 추세"
const UP_PCT = 10; // 3개월 전 대비 이만큼(%) 이상 늘면 "증가"

function listOf(json) {
  if (Array.isArray(json)) return json;
  if (json && Array.isArray(json.pd)) return json.pd;
  if (json && json.pd && Array.isArray(json.pd.timeseries)) return json.pd.timeseries;
  if (json && Array.isArray(json.timeseries)) return json.timeseries;
  return null;
}
function keyOf(r) {
  return r.keyid || r.key || r.timeSeries || r["Time Series"];
}
function dateOf(r) {
  const d = r.asofdate || r.asOfDate || r.asof || r.date || r["As Of Date"];
  return typeof d === "string" ? d.slice(0, 10) : null;
}
function valueOf(r) {
  const raw = r?.value ?? r?.Value ?? r?.["Value (millions)"];
  const num = typeof raw === "string" ? parseFloat(raw.replace(/[^0-9.-]/g, "")) : raw;
  return Number.isFinite(num) ? num : null;
}

// 방법 1: 이 지표의 전체 기간을 한 번에 받기 (요청 1번)
async function fetchWholeSeries() {
  try {
    const res = await fetch(`${ROOT}/${KEY}.json`, { cache: "no-store" });
    if (!res.ok) return [];
    const list = listOf(await res.json());
    if (!list) return [];
    const byDate = new Map();
    for (const r of list) {
      const k = keyOf(r);
      if (k && k !== KEY) continue;
      const date = dateOf(r);
      const value = valueOf(r);
      if (date && value != null) byDate.set(date, value);
    }
    return [...byDate.entries()].map(([date, value]) => ({ date, value }));
  } catch {
    return [];
  }
}

// 방법 2 (예비): 다른 카드들처럼 수요일 날짜마다 하나씩 받기
function lastWednesdays(count) {
  const dates = [];
  const d = new Date();
  while (dates.length < count) {
    if (d.getUTCDay() === 3) dates.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return dates;
}
async function fetchAsOf(date) {
  try {
    const res = await fetch(`${ROOT}/asof/${date}.json`, { cache: "no-store" });
    if (!res.ok) return null;
    const list = listOf(await res.json());
    if (!list) return null;
    const row = list.find((r) => keyOf(r) === KEY);
    const value = row ? valueOf(row) : null;
    return value == null ? null : { date, value };
  } catch {
    return null;
  }
}
async function fetchWeekByWeek() {
  const results = await Promise.all(lastWednesdays(NEED_WEEKS + 3).map(fetchAsOf));
  return results.filter(Boolean);
}

function mean(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
}
function pctChange(now, before) {
  if (now == null || before == null || before === 0) return null;
  return ((now - before) / Math.abs(before)) * 100;
}

export async function GET() {
  try {
    let all = await fetchWholeSeries();
    let method = "timeseries";
    // 전체 기간 받기가 안 되거나, 17주(3개월 비교에 필요)가 안 되거나,
    // 마지막 날짜가 3주 넘게 오래됐으면 예비 방법으로 다시 받아서 더 최신인 쪽을 사용
    const newest = (arr) => arr.reduce((m, p) => (p.date > m ? p.date : m), "");
    const staleLimit = new Date(Date.now() - 21 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    if (all.length < 17 || newest(all) < staleLimit) {
      const alt = await fetchWeekByWeek();
      if (alt.length && (newest(alt) > newest(all) || alt.length > all.length)) {
        all = alt;
        method = "asof";
      }
    }
    all.sort((a, b) => (a.date > b.date ? 1 : -1));
    const series = all.slice(-NEED_WEEKS);

    if (series.length < 2) {
      return Response.json(
        { ok: false, error: "원본 데이터를 가져오지 못했습니다 (NY Fed Primary Dealer 국채 순포지션)." },
        { status: 502 }
      );
    }

    const n = series.length;
    const vals = series.map((p) => p.value);
    const latest = series[n - 1];
    const prev = series[n - 2];

    // 4주 평균 3개: 최근 / 3개월 전(13~16주 전) / 6개월 전(26~29주 전)
    const avgRecent = n >= 4 ? mean(vals.slice(n - 4)) : null;
    const avg3m = n >= 17 ? mean(vals.slice(n - 17, n - 13)) : null;
    const avg6m = n >= 30 ? mean(vals.slice(n - 30, n - 26)) : null;
    const pct3m = pctChange(avgRecent, avg3m);
    const pct6m = pctChange(avgRecent, avg6m);

    // 판정
    let trend = "unknown";
    if (pct3m != null) {
      if (pct3m <= DOWN_PCT) trend = avg6m != null && avg3m < avg6m ? "down-sustained" : "down";
      else if (pct3m >= UP_PCT) trend = "up";
      else trend = "flat";
    }

    // 그래프용: 주간 값 + 4주 이동평균 (최근 26주만)
    const withMa = series.map((p, i) => ({
      date: p.date,
      value: p.value,
      ma4: i >= 3 ? mean(vals.slice(i - 3, i + 1)) : null,
    }));
    const points = withMa.slice(-CHART_WEEKS);

    return Response.json({
      ok: true,
      latestDate: latest.date,
      latestValue: latest.value, // 백만 달러
      change: latest.value - prev.value, // 전주 대비
      avgRecent,
      avg3m,
      avg6m,
      diff3m: avgRecent != null && avg3m != null ? avgRecent - avg3m : null,
      diff6m: avgRecent != null && avg6m != null ? avgRecent - avg6m : null,
      pct3m,
      pct6m,
      trend, // "down-sustained" | "down" | "flat" | "up" | "unknown"
      downPct: DOWN_PCT,
      upPct: UP_PCT,
      weeksLoaded: n,
      points,
      method,
      sourceNote: "NY Fed 공식 Markets Data API - 프라이머리 딜러 국채 순포지션 (PDPOSGST-TOT, TIPS 제외)",
    });
  } catch (e) {
    return Response.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
