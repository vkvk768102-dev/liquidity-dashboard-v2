// 파일 위치: app/api/treasury-auction-tail/route.js
// helious.io가 무료로 공개하는 CSV(API 키 불필요)에서
// 20년물/30년물 국채 경매의 테일(bp)을 가져옵니다.
// CSV 컬럼: auction_date,cusip,offering_usd,high_yield,when_issued_yield,tail_bps,bid_to_cover,indirect_pct,direct_pct,dealer_pct,verdict,issue

const SOURCES = {
  "20Y": "https://helious.io/auctions/20-year-bond.csv",
  "30Y": "https://helious.io/auctions/30-year-bond.csv",
};

function parseCsv(text) {
  const lines = text.trim().split("\n").filter(Boolean);
  if (lines.length < 2) return [];
  const header = lines[0].split(",");
  const idx = (name) => header.indexOf(name);
  const iDate = idx("auction_date");
  const iTail = idx("tail_bps");

  return lines.slice(1).map((line) => {
    const cols = line.split(",");
    return {
      date: cols[iDate],
      tailBp: cols[iTail] === "" || cols[iTail] === undefined ? null : parseFloat(cols[iTail]),
    };
  });
}

async function fetchTenor(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`helious.io 요청 실패 (${res.status})`);
  const text = await res.text();
  const rows = parseCsv(text);
  // 최신순으로 정렬된 상태로 온다고 가정하되, 혹시 몰라 날짜 기준 내림차순 정렬
  rows.sort((a, b) => (a.date < b.date ? 1 : -1));
  const withTail = rows.filter((r) => r.tailBp != null);
  const latest = withTail[0] ?? null;
  const prev = withTail[1] ?? null;
  return { latest, prev };
}

export async function GET() {
  try {
    const [y20, y30] = await Promise.all([
      fetchTenor(SOURCES["20Y"]),
      fetchTenor(SOURCES["30Y"]),
    ]);

    return Response.json({
      ok: true,
      "20Y": y20,
      "30Y": y30,
      source: "helious.io (free, no API key)",
    });
  } catch (e) {
    return Response.json({ ok: false, error: e.message }, { status: 500 });
  }
}
