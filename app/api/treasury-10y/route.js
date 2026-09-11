// 파일 위치: app/api/treasury-10y/route.js
// 10년물 미국 국채금리(Constant Maturity)를 미국 재무부 공식 무료 CSV 피드에서 가져옵니다.
// API 키 불필요.

export async function GET() {
  try {
    const year = new Date().getFullYear();
    const url = `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${year}/all?type=daily_treasury_yield_curve&field_tdr_date_value=${year}&page&_format=csv`;

    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`재무부 데이터 요청 실패 (${res.status})`);
    }

    const text = await res.text();
    const lines = text.trim().split("\n").filter(Boolean);
    if (lines.length < 2) {
      throw new Error("재무부 데이터가 비어 있습니다");
    }

    const header = lines[0].split(",").map((h) => h.replace(/"/g, "").trim());
    const idxDate = header.findIndex((h) => h === "Date");
    const idx10y = header.findIndex((h) => h === "10 Yr");

    if (idxDate === -1 || idx10y === -1) {
      throw new Error("10년물 컬럼을 찾을 수 없습니다 (재무부 CSV 포맷 변경 가능성)");
    }

    // 연도 첫 조회 시 1월 초라 전년도 12월 데이터가 필요할 수 있으므로,
    // 올해 데이터가 비어있으면 작년 데이터로 폴백합니다.
    let rows = lines.slice(1);
    let latestRow = null;
    for (let i = rows.length - 1; i >= 0; i--) {
      const cols = rows[i].split(",").map((c) => c.replace(/"/g, "").trim());
      if (cols[idx10y] && cols[idx10y] !== "N/A") {
        latestRow = cols;
        break;
      }
    }

    if (!latestRow) {
      // 올해 데이터가 없으면 작년 데이터로 재시도 (1월 초 등)
      const fallbackUrl = `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${year - 1}/all?type=daily_treasury_yield_curve&field_tdr_date_value=${year - 1}&page&_format=csv`;
      const fallbackRes = await fetch(fallbackUrl, { cache: "no-store" });
      const fallbackText = await fallbackRes.text();
      const fallbackLines = fallbackText.trim().split("\n").filter(Boolean);
      const fallbackRows = fallbackLines.slice(1);
      for (let i = fallbackRows.length - 1; i >= 0; i--) {
        const cols = fallbackRows[i].split(",").map((c) => c.replace(/"/g, "").trim());
        if (cols[idx10y] && cols[idx10y] !== "N/A") {
          latestRow = cols;
          break;
        }
      }
    }

    if (!latestRow) {
      throw new Error("최근 10년물 국채금리를 찾을 수 없습니다");
    }

    const latestValue = parseFloat(latestRow[idx10y]);
    const latestDate = latestRow[idxDate];

    return Response.json({
      ok: true,
      latestDate,
      latestValue,
    });
  } catch (e) {
    return Response.json({ ok: false, error: e.message }, { status: 500 });
  }
}
