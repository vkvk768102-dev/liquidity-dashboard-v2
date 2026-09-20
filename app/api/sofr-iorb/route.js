// 데이터 출처:
//   - SOFR, TGCR: 뉴욕 연준 공식 Markets Data API (markets.newyorkfed.org) - API 키 불필요
//   - IORB, 상시 레포 금리(SRFTSYD), 목표금리 범위 상단(DFEDTARU): FRED(세인트루이스 연준) CSV 주소 - API 키 불필요
// 지표 정의: 레포 금리 - IORB (bp). SOFR과 TGCR 각각 IORB와 비교하고, 더 높은 쪽을 대표값으로 사용.
//   - 0 이하면 정상, IORB 위로 벌어질수록 레포 시장 자금 압박.
//   - "경색" 기준선 = 연준 상시 레포 금리(SRF 최소 응찰 금리)와 IORB의 간격.
//     상시 레포 금리 데이터가 없는 날은 목표금리 범위 상단(현재 상시 레포 금리와 같음)으로 대신함.
//     연준이 금리나 이 간격을 바꾸면 FRED에 자동 반영되므로 직접 고칠 필요 없음.
const SOFR_URL = "https://markets.newyorkfed.org/api/rates/secured/sofr/last/8.json";
const TGCR_URL = "https://markets.newyorkfed.org/api/rates/secured/tgcr/last/8.json";
const FRED_CSV_URL = "https://fred.stlouisfed.org/graph/fredgraph.csv";
const DEFAULT_GAP_BP = 10; // 천장 데이터를 전혀 못 받을 때 쓰는 기본 간격

function extractRows(json) {
  if (Array.isArray(json)) return json;
  if (json && Array.isArray(json.refRates)) return json.refRates;
  if (json && Array.isArray(json.secured)) return json.secured;
  if (json && json.rates && Array.isArray(json.rates.secured)) return json.rates.secured;
  return [];
}
function getDate(row) {
  return row.effectiveDate || row.date || row.Date || null;
}
function getRate(row) {
  const raw = row.percentRate ?? row.rate ?? row.Rate;
  const n = typeof raw === "string" ? parseFloat(raw) : raw;
  return Number.isFinite(n) ? n : null;
}

async function fetchRates(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return null;
  const json = await res.json();
  return extractRows(json)
    .map((r) => ({ date: (getDate(r) || "").slice(0, 10), value: getRate(r) }))
    .filter((r) => r.date && r.value != null);
}

// FRED CSV: 첫 줄은 제목, 이후 "날짜,값" 형태. 값이 "."이면 비어 있는 날.
async function fetchFred(seriesId, startDate) {
  const res = await fetch(`${FRED_CSV_URL}?id=${seriesId}&cosd=${startDate}`, {
    cache: "no-store",
    headers: { "User-Agent": "Mozilla/5.0", Accept: "text/csv" },
  });
  if (!res.ok) return null;
  const text = (await res.text()).trim();
  if (!text || text.startsWith("<")) return null; // HTML이 오면 실패로 처리
  const map = new Map();
  for (const line of text.split(/\r?\n/).slice(1)) {
    const [d, v] = line.split(",");
    const n = parseFloat(v);
    if (d && Number.isFinite(n)) map.set(d.trim().slice(0, 10), n);
  }
  return map.size > 0 ? map : null;
}

export async function GET() {
  try {
    const start = new Date(Date.now() - 45 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const [sofrRows, tgcrRows, iorbMap, srfMap, ceilMap] = await Promise.all([
      fetchRates(SOFR_URL),
      fetchRates(TGCR_URL).catch(() => null), // TGCR이 실패해도 SOFR만으로 계속 진행
      fetchFred("IORB", start),
      fetchFred("SRFTSYD", start).catch(() => null), // 상시 레포 금리 (없으면 아래 대체값 사용)
      fetchFred("DFEDTARU", start).catch(() => null), // 목표금리 범위 상단 (대체값)
    ]);

    if (!sofrRows) {
      return Response.json({ ok: false, error: "SOFR을 가져오지 못했습니다 (NY Fed)." }, { status: 502 });
    }
    if (!iorbMap) {
      return Response.json({ ok: false, error: "IORB를 가져오지 못했습니다 (FRED)." }, { status: 502 });
    }

    const tgcrMap = new Map((tgcrRows || []).map((r) => [r.date, r.value]));

    // 같은 날짜에 SOFR과 IORB가 모두 있는 날만 사용 (IORB가 아직 안 올라온 날은 제외해서 오경보 방지)
    const joined = sofrRows
      .filter((r) => iorbMap.has(r.date))
      .sort((a, b) => (a.date > b.date ? 1 : -1))
      .map((r) => {
        const iorb = iorbMap.get(r.date);
        const tgcr = tgcrMap.has(r.date) ? tgcrMap.get(r.date) : null;
        const sofrBp = Math.round((r.value - iorb) * 100);
        const tgcrBp = tgcr != null ? Math.round((tgcr - iorb) * 100) : null;
        const spread = tgcrBp != null ? Math.max(sofrBp, tgcrBp) : sofrBp; // 더 높은 쪽

        // 천장(상시 레포 금리)과 IORB의 간격. 1순위 상시 레포 금리, 2순위 목표범위 상단, 3순위 기본 10bp
        let ceiling = null;
        let ceilingSource = null;
        if (srfMap && srfMap.has(r.date)) {
          ceiling = srfMap.get(r.date);
          ceilingSource = "상시 레포";
        } else if (ceilMap && ceilMap.has(r.date)) {
          ceiling = ceilMap.get(r.date);
          ceilingSource = "목표범위 상단";
        }
        const gapRaw = ceiling != null ? Math.round((ceiling - iorb) * 100) : null;
        const gapBp = gapRaw != null && gapRaw > 0 ? gapRaw : DEFAULT_GAP_BP;

        return { date: r.date, sofr: r.value, tgcr, iorb, sofrBp, tgcrBp, spread, ceiling, ceilingSource, gapBp };
      });

    if (joined.length < 2) {
      return Response.json({ ok: false, error: "SOFR과 IORB의 공통 날짜 데이터가 부족합니다." }, { status: 502 });
    }

    const points = joined.slice(-5).map((r) => ({ date: r.date, value: r.spread }));
    const latest = joined[joined.length - 1];
    const prev = joined[joined.length - 2];

    return Response.json({
      ok: true,
      latestDate: latest.date,
      latestValue: latest.spread, // bp (SOFR·TGCR 중 더 높은 쪽 - IORB)
      sofr: latest.sofr,
      tgcr: latest.tgcr,
      iorb: latest.iorb,
      sofrBp: latest.sofrBp,
      tgcrBp: latest.tgcrBp,
      ceiling: latest.ceiling, // 상시 레포 금리(또는 대체값), 없으면 null
      ceilingSource: latest.ceilingSource, // "상시 레포" 또는 "목표범위 상단"
      gapBp: latest.gapBp, // 천장 - IORB (bp), "경색" 기준선
      change: latest.spread - prev.spread, // 전일 대비 (bp)
      points,
      sourceNote: "SOFR·TGCR: NY Fed 공식 API / IORB·상시 레포 금리·목표범위 상단: FRED",
    });
  } catch (e) {
    return Response.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
