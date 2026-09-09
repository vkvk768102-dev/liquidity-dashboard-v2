// 데이터 출처: 뉴욕 연준(New York Fed) 공식 Markets Data API (markets.newyorkfed.org)
// - OFR을 거치지 않고 뉴욕 연준이 직접 운영하는 원본 API를 사용합니다. API 키 불필요.
// - 이 API는 실제로 살아있는 최신 데이터를 제공합니다 (2026년 데이터까지 확인됨).
//
// 지표 정의: "레버리지 배수" = 국채담보 레포 자금조달 총액(PDSORA-UTSETTOT)
//                           ÷ 딜러의 국채 순포지션(PDPOSGST-TOT, 보유분)
//   - 딜러가 실제로 보유 중인 국채 재고(자기 포지션) 대비 얼마나 빚(레포)을 내서
//     조달하고 있는지를 보여주는 지표입니다.
const BASE = "https://markets.newyorkfed.org/api/pd/get/asof";
const REPO_KEY = "PDSORA-UTSETTOT"; // 국채담보 레포 자금조달, 총액
const NETPOS_KEY = "PDPOSGST-TOT"; // 국채(TIPS 제외) 순포지션, 총액

function lastWednesdays(count) {
  const dates = [];
  const d = new Date();
  // 오늘부터 거슬러 올라가며 수요일(주간 서베이 기준일) 날짜를 count개 만큼 구함
  while (dates.length < count) {
    if (d.getDay() === 3) {
      dates.push(new Date(d));
    }
    d.setDate(d.getDate() - 1);
  }
  return dates.map((dt) => dt.toISOString().slice(0, 10));
}

function extractValue(json, keyid) {
  // API가 반환하는 정확한 JSON 구조가 문서마다 달라 여러 형태를 방어적으로 처리
  let list = null;
  if (Array.isArray(json)) list = json;
  else if (json && Array.isArray(json.pd)) list = json.pd;
  else if (json && json.pd && Array.isArray(json.pd.timeseries)) list = json.pd.timeseries;
  else if (json && Array.isArray(json.timeseries)) list = json.timeseries;

  if (!list) return null;
  const row = list.find(
    (r) => (r.keyid || r.key || r.timeSeries || r["Time Series"]) === keyid
  );
  if (!row) return null;
  const raw = row.value ?? row.Value ?? row["Value (millions)"];
  const num = typeof raw === "string" ? parseFloat(raw.replace(/[^0-9.-]/g, "")) : raw;
  return Number.isFinite(num) ? num : null;
}

async function fetchAsOf(date) {
  try {
    const res = await fetch(`${BASE}/${date}.json`, { cache: "no-store" });
    if (!res.ok) return null;
    const json = await res.json();
    const repo = extractValue(json, REPO_KEY);
    const netPos = extractValue(json, NETPOS_KEY);
    if (repo == null || netPos == null) return null;
    return { date, repo, netPos };
  } catch (e) {
    return null;
  }
}

export async function GET() {
  try {
    const candidateDates = lastWednesdays(8); // 여유있게 8주치 시도해서 최근 4개 확보
    const results = await Promise.all(candidateDates.map(fetchAsOf));
    const valid = results.filter(Boolean).sort((a, b) => (a.date > b.date ? 1 : -1));

    if (valid.length === 0) {
      return Response.json(
        { ok: false, error: "원본 데이터를 가져오지 못했습니다 (NY Fed Primary Dealer 통계)." },
        { status: 502 }
      );
    }

    const last4 = valid.slice(-4);
    const points = last4.map((r) => ({
      date: r.date,
      ratio: r.netPos !== 0 ? r.repo / Math.abs(r.netPos) : null,
    }));

    const latest = points[points.length - 1];
    const prev = points.length > 1 ? points[points.length - 2] : null;
    const change =
      prev && latest.ratio != null && prev.ratio != null ? latest.ratio - prev.ratio : null;

    return Response.json({
      ok: true,
      latestDate: latest.date,
      latestValue: latest.ratio,
      change,
      points,
      sourceNote: "NY Fed 공식 Markets Data API (국채 레포 자금조달 ÷ 국채 순포지션)",
    });
  } catch (e) {
    return Response.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
