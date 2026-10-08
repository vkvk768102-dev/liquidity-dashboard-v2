// 파일 위치: app/api/treasury-auction-tail/route.js
// helious.io가 무료로 공개하는 CSV(API 키 불필요)에서
// 2년·5년·10년·20년·30년물 국채 경매의 테일(bp)과 응찰률·입찰자 비중을 가져옵니다.
// CSV 컬럼: auction_date,cusip,offering_usd,high_yield,when_issued_yield,tail_bps,bid_to_cover,indirect_pct,direct_pct,dealer_pct,verdict,issue

const SOURCES = {
  "2Y": "https://helious.io/auctions/2-year-note.csv",
  "5Y": "https://helious.io/auctions/5-year-note.csv",
  "10Y": "https://helious.io/auctions/10-year-note.csv",
  "20Y": "https://helious.io/auctions/20-year-bond.csv",
  "30Y": "https://helious.io/auctions/30-year-bond.csv",
};

function num(v) {
  if (v === undefined || v === null || String(v).trim() === "") return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const header = lines[0].split(",").map((h) => h.trim());
  const idx = (name) => header.indexOf(name);
  const iDate = idx("auction_date");
  const iTail = idx("tail_bps");
  const iHigh = idx("high_yield");
  const iBtc = idx("bid_to_cover");
  const iInd = idx("indirect_pct");
  const iDir = idx("direct_pct");
  const iDeal = idx("dealer_pct");
  const iIssue = idx("issue");

  return lines.slice(1).map((line) => {
    const cols = line.split(",");
    return {
      date: (cols[iDate] || "").trim(),
      tailBp: num(cols[iTail]),
      highYield: iHigh >= 0 ? num(cols[iHigh]) : null,
      bidToCover: iBtc >= 0 ? num(cols[iBtc]) : null,
      indirectPct: iInd >= 0 ? num(cols[iInd]) : null,
      directPct: iDir >= 0 ? num(cols[iDir]) : null,
      dealerPct: iDeal >= 0 ? num(cols[iDeal]) : null,
      issue: iIssue >= 0 ? (cols[iIssue] || "").trim() || null : null,
    };
  });
}

async function fetchTenor(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`helious.io 요청 실패 (${res.status})`);
  const text = await res.text();
  const rows = parseCsv(text).filter((r) => r.date);
  // 최신순으로 정렬된 상태로 온다고 가정하되, 혹시 몰라 날짜 기준 내림차순 정렬
  rows.sort((a, b) => (a.date < b.date ? 1 : -1));
  const withTail = rows.filter((r) => r.tailBp != null);
  const latest = withTail[0] ?? null;
  const prev = withTail[1] ?? null;

  // 응찰률 비교 기준: 최신 입찰 바로 앞 6회 입찰의 응찰률 평균
  let btcAvg = null;
  let btcAvgCount = 0;
  if (latest) {
    const prior = rows.filter((r) => r.date < latest.date && r.bidToCover != null).slice(0, 6);
    btcAvgCount = prior.length;
    if (prior.length) {
      btcAvg = prior.reduce((sum, r) => sum + r.bidToCover, 0) / prior.length;
    }
  }
  return { latest, prev, btcAvg, btcAvgCount };
}

export async function GET() {
  try {
    const keys = Object.keys(SOURCES);
    // 만기 하나가 실패해도 나머지는 보여 주도록 따로따로 받아 옴
    const results = await Promise.all(
      keys.map((k) => fetchTenor(SOURCES[k]).catch((e) => ({ latest: null, prev: null, error: e.message })))
    );

    if (results.every((r) => !r.latest)) {
      const firstError = results.find((r) => r.error)?.error;
      return Response.json({ ok: false, error: firstError || "경매 테일 데이터가 비어 있습니다." }, { status: 502 });
    }

    const body = { ok: true, source: "helious.io (free, no API key)" };
    keys.forEach((k, i) => {
      body[k] = results[i];
    });
    return Response.json(body);
  } catch (e) {
    return Response.json({ ok: false, error: e.message }, { status: 500 });
  }
}
