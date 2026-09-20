// 파일 위치: app/api/treasury-10y/route.js
// 10년물 미국 국채금리(Constant Maturity)를 미국 재무부 공식 무료 CSV 피드에서 가져옵니다.
// API 키 불필요.
//
// [수정 내용] 재무부 CSV는 최신 날짜가 맨 위에 오는데, 예전 코드는 맨 아래(가장 오래된 날짜)부터 읽어서
// 연초 값(4.19%)이 나왔습니다. 이제는 CSV 순서와 상관없이 "날짜가 가장 최근인 행"을 고릅니다.

const BASE =
  "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv";

function csvUrl(year) {
  return `${BASE}/${year}/all?type=daily_treasury_yield_curve&field_tdr_date_value=${year}&page&_format=csv`;
}

// "MM/DD/YYYY" 또는 "YYYY-MM-DD" 형태의 날짜를 숫자(비교용)로 바꿉니다.
function toTime(s) {
  if (!s) return NaN;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return Date.UTC(Number(m[3]), Number(m[1]) - 1, Number(m[2]));
  return Date.parse(s);
}

// CSV 본문에서 10년물 값이 있는 행 중 날짜가 가장 최근인 행을 찾습니다. (없으면 null)
function findLatest(text) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return null;

  const header = lines[0].split(",").map((h) => h.replace(/"/g, "").trim());
  const idxDate = header.findIndex((h) => h === "Date");
  const idx10y = header.findIndex((h) => h === "10 Yr");
  if (idxDate === -1 || idx10y === -1) {
    throw new Error("10년물 컬럼을 찾을 수 없습니다 (재무부 CSV 포맷 변경 가능성)");
  }

  let best = null;
  let bestTime = -Infinity;
  for (const line of lines.slice(1)) {
    const cols = line.split(",").map((c) => c.replace(/"/g, "").trim());
    const raw = cols[idx10y];
    if (!raw || raw === "N/A") continue;
    const value = parseFloat(raw);
    const time = toTime(cols[idxDate]);
    if (!Number.isFinite(value) || !Number.isFinite(time)) continue;
    if (time > bestTime) {
      bestTime = time;
      best = { date: cols[idxDate], value };
    }
  }
  return best;
}

export async function GET() {
  try {
    const year = new Date().getFullYear();

    const res = await fetch(csvUrl(year), { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`재무부 데이터 요청 실패 (${res.status})`);
    }
    let latest = findLatest(await res.text());

    // 올해 데이터가 아직 없으면(1월 초 등) 작년 데이터로 재시도
    if (!latest) {
      const fallbackRes = await fetch(csvUrl(year - 1), { cache: "no-store" });
      if (fallbackRes.ok) {
        latest = findLatest(await fallbackRes.text());
      }
    }

    if (!latest) {
      throw new Error("최근 10년물 국채금리를 찾을 수 없습니다");
    }

    return Response.json({
      ok: true,
      latestDate: latest.date,
      latestValue: latest.value,
    });
  } catch (e) {
    return Response.json({ ok: false, error: e.message }, { status: 500 });
  }
}
