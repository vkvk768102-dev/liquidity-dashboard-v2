// 데이터 출처: OFR(미국 재무부 산하 금융조사국)이 뉴욕 연준 프라이머리 딜러 통계를
// 그대로 제공하는 공개 API (data.financialresearch.gov). API 키 불필요.
//
// [업그레이드] 지표 정의: "레버리지 배수" = 국채담보 레포 자금조달 총액 ÷ 딜러의 국채 순포지션(보유분) 총액
//   - 분모가 실제 딜러가 보유 중인 국채 재고(자기 포지션)라서, "보유자금(포지션) 대비
//     얼마나 빚(레포)을 내서 조달하고 있는지"를 이전 버전(레포÷역레포)보다 더 직접적으로 보여줍니다.
//   - 딜러 자기자본(net capital)은 SEC에 비공개로 제출되는 자료라 공개 API가 없어서 쓸 수 없었고,
//     그 다음으로 적절한 분모인 "실제 보유 포지션"을 사용합니다.
//   - 니모닉(항목 코드) 정확한 이름은 OFR 쪽에서 바뀔 수 있어, 매 요청마다 전체 항목 목록을
//     실시간으로 조회해서 조건에 맞는 항목을 자동으로 찾습니다 (하드코딩된 이름에 의존하지 않음).
const TIMESERIES_URL = "https://data.financialresearch.gov/v1/series/timeseries";
const MNEMONICS_URL = "https://data.financialresearch.gov/v1/metadata/mnemonics?dataset=nypd";

// 혹시 자동 탐색이 실패할 경우를 대비한 고정 후보값 (알려진 명명 규칙 기준)
const REPO_FALLBACK = ["NYPD-PD_RP_T_TOT-A", "NYPD-PD_RP_TOT-A"];
const NETPOS_FALLBACK = ["NYPD-PD_NP_UST_TOT-A", "NYPD-PD_NET_UST_TOT-A"];

async function getMnemonicList() {
  const res = await fetch(MNEMONICS_URL, { cache: "no-store" });
  if (!res.ok) return [];
  const list = await res.json();
  return Array.isArray(list) ? list : [];
}

// keywordSets를 앞에서부터 시도하면서(더 구체적 -> 덜 구체적) 가장 먼저 매칭되는 항목을 반환
function discover(list, keywordSets, exclude = []) {
  for (const keywords of keywordSets) {
    const match = list.find((item) => {
      const name = (item.series_name || "").toLowerCase();
      const hasAll = keywords.every((k) => name.includes(k));
      const hasExcluded = exclude.some((k) => name.includes(k));
      return hasAll && !hasExcluded;
    });
    if (match) return match.mnemonic;
  }
  return null;
}

async function fetchTimeseries(mnemonic) {
  try {
    const res = await fetch(`${TIMESERIES_URL}?mnemonic=${mnemonic}`, { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data) && data.length > 0 ? data : null;
  } catch (e) {
    return null;
  }
}

async function fetchWithFallback(discoveredMnemonic, fallbackList) {
  const candidates = [discoveredMnemonic, ...fallbackList].filter(Boolean);
  for (const m of candidates) {
    const series = await fetchTimeseries(m);
    if (series) return { mnemonic: m, series };
  }
  return null;
}

export async function GET() {
  try {
    const list = await getMnemonicList();

    const repoMnemonic = discover(
      list,
      [
        ["repo", "treasury", "total"],
        ["repurchase", "treasury", "total"],
        ["repo", "total"],
      ],
      ["reverse"]
    );

    const netPosMnemonic = discover(list, [
      ["net position", "treasury", "total"],
      ["net position", "treasury"],
      ["net position"],
    ]);

    const [repo, netPos] = await Promise.all([
      fetchWithFallback(repoMnemonic, REPO_FALLBACK),
      fetchWithFallback(netPosMnemonic, NETPOS_FALLBACK),
    ]);

    if (!repo || !netPos) {
      return Response.json(
        {
          ok: false,
          error: "원본 데이터를 가져오지 못했습니다 (NY Fed Primary Dealer 통계).",
        },
        { status: 502 }
      );
    }

    const repoMap = new Map(repo.series.map(([d, v]) => [d, v]));
    const netPosMap = new Map(netPos.series.map(([d, v]) => [d, v]));
    const commonDates = repo.series.map(([d]) => d).filter((d) => netPosMap.has(d)).sort();

    const lastDates = commonDates.slice(-4);
    if (lastDates.length === 0) {
      return Response.json({ ok: false, error: "공통 날짜 데이터가 없습니다." }, { status: 502 });
    }

    const points = lastDates.map((d) => {
      const r = repoMap.get(d);
      const np = netPosMap.get(d);
      // 딜러가 국채를 순매도(net short) 중이면 포지션이 음수가 될 수 있어 절대값 기준으로 계산하고,
      // 그 사실은 negativeNetPosition 플래그로 별도 표시합니다.
      const ratio = np && np !== 0 ? r / Math.abs(np) : null;
      return { date: d, ratio, negativeNetPosition: np != null && np < 0 };
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
      negativeNetPosition: latest.negativeNetPosition,
      points,
      sourceNote: `NY Fed 프라이머리 딜러 통계 (국채 레포 자금조달 ÷ 국채 순포지션, OFR 경유) - repo:${repo.mnemonic}, netpos:${netPos.mnemonic}`,
    });
  } catch (e) {
    return Response.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
