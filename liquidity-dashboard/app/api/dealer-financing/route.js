// 데이터 출처: OFR(미국 재무부 산하 금융조사국)이 뉴욕 연준 프라이머리 딜러 통계를
// 그대로 제공하는 공개 API (data.financialresearch.gov). API 키 불필요.
//
// 지표 정의: "레버리지 배수" = 국채담보 레포 자금조달 총액 ÷ 국채담보 역레포(자금공여) 총액
//   - 딜러가 얼마나 많이 빌려서(레포) 포지션을 조달하는지를, 그들이 운용중인 역레포 자금 규모와
//     비교해 보여주는 프록시(근사) 지표입니다.
//   - [확인 결과] 딜러의 실제 자기자본(net capital)과 순보유포지션(net position)은 이 무료
//     공개 API(OFR nypd 데이터셋)에 항목 자체가 없어서 사용할 수 없었습니다. 이 API가 제공하는
//     항목은 레포/역레포/증권대차/결제실패 뿐이라, 그중 가장 적절한 레포÷역레포 비율을 사용합니다.
//   - 정확한 항목명(니모닉)은 실제 API 목록(data.financialresearch.gov/v1/metadata/mnemonics?dataset=nypd)에서
//     아래 값으로 직접 확인했습니다:
//     NYPD-PD_RP_T_TOT-A  = "Primary Dealer Repurchase Agreements Backed by U.S. Treasury Securities: Total"
//     NYPD-PD_RRP_T_TOT-A = "Primary Dealer Reverse Repurchase Agreements Backed by U.S. Treasury Securities: Total"
const TIMESERIES_URL = "https://data.financialresearch.gov/v1/series/timeseries";

const REPO_MNEMONIC = "NYPD-PD_RP_T_TOT-A";
const RREPO_MNEMONIC = "NYPD-PD_RRP_T_TOT-A";

async function fetchTimeseries(mnemonic) {
  try {
    // API가 시작 날짜를 지정하지 않으면 아주 오래된 데이터부터 최대 개수만큼만 돌려주는 문제가 있어서,
    // 최근 60일부터 요청해서 항상 최신 데이터를 받도록 합니다.
    const start = new Date();
    start.setDate(start.getDate() - 60);
    const startDate = start.toISOString().slice(0, 10);
    const res = await fetch(`${TIMESERIES_URL}?mnemonic=${mnemonic}&start_date=${startDate}`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data) && data.length > 0 ? data : null;
  } catch (e) {
    return null;
  }
}

export async function GET() {
  try {
    const [repoSeries, rrepoSeries] = await Promise.all([
      fetchTimeseries(REPO_MNEMONIC),
      fetchTimeseries(RREPO_MNEMONIC),
    ]);

    if (!repoSeries || !rrepoSeries) {
      return Response.json(
        { ok: false, error: "원본 데이터를 가져오지 못했습니다 (NY Fed Primary Dealer 통계)." },
        { status: 502 }
      );
    }

    const repoMap = new Map(repoSeries.map(([d, v]) => [d, v]));
    const rrepoMap = new Map(rrepoSeries.map(([d, v]) => [d, v]));
    const commonDates = repoSeries.map(([d]) => d).filter((d) => rrepoMap.has(d)).sort();

    const lastDates = commonDates.slice(-4);
    if (lastDates.length === 0) {
      return Response.json({ ok: false, error: "공통 날짜 데이터가 없습니다." }, { status: 502 });
    }

    const points = lastDates.map((d) => {
      const r = repoMap.get(d);
      const rr = rrepoMap.get(d);
      const ratio = rr && rr !== 0 ? r / rr : null;
      return { date: d, ratio };
    });

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
      sourceNote: "NY Fed 프라이머리 딜러 통계 (국채 레포 자금조달 ÷ 국채 역레포, OFR 경유)",
    });
  } catch (e) {
    return Response.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
