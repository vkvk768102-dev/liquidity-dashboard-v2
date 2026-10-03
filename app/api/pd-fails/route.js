// 15번 카드용: 프라이머리 딜러 국채 결제 실패(Fails) 추이
// 데이터 출처: 뉴욕 연준 공식 Markets Data API (markets.newyorkfed.org). API 키 불필요.
// - Fails to Deliver(인도 실패): 딜러가 넘겨줘야 할 국채를 결제일에 못 넘긴 금액
// - Fails to Receive(수령 실패): 딜러가 받아야 할 국채를 결제일에 못 받은 금액
// - 단위: 백만 달러, 주간 누적(수요일로 끝나는 한 주)
export const dynamic = "force-dynamic";

const BASE = "https://markets.newyorkfed.org/api/pd/get/asof";
const DELIVER_KEYS = ["PDFTD-USTET", "PDFTD-UST"]; // 국채(TIPS 제외) 인도 실패
const RECEIVE_KEYS = ["PDFTR-USTET", "PDFTR-UST"]; // 국채(TIPS 제외) 수령 실패
const WEEKS = 8;

// 요일 판단과 날짜 문자열을 모두 UTC 기준으로 통일 (한국 오전 9시 이전 문제 방지)
function lastWednesdays(count) {
  const dates = [];
  const d = new Date();
  while (dates.length < count) {
    if (d.getUTCDay() === 3) dates.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return dates;
}

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

function valueOf(r) {
  const raw = r?.value ?? r?.Value ?? r?.["Value (millions)"];
  const num = typeof raw === "string" ? parseFloat(raw.replace(/[^0-9.-]/g, "")) : raw;
  return Number.isFinite(num) ? num : null;
}

// 후보 이름 중 처음 찾은 값. 없으면 접두어(PDFTD-UST…)로 TIPS 아닌 항목을 찾음
function pick(list, candidates, prefix) {
  for (const k of candidates) {
    const row = list.find((r) => keyOf(r) === k);
    const v = valueOf(row);
    if (v != null) return { key: k, value: v };
  }
  const row = list.find((r) => {
    const k = String(keyOf(r) || "");
    return k.startsWith(prefix) && !/TIP/i.test(k) && valueOf(r) != null;
  });
  return row ? { key: keyOf(row), value: valueOf(row) } : null;
}

async function fetchAsOf(date) {
  try {
    const res = await fetch(`${BASE}/${date}.json`, { cache: "no-store" });
    if (!res.ok) return null;
    const list = listOf(await res.json());
    if (!list) return null;
    const deliver = pick(list, DELIVER_KEYS, "PDFTD-UST");
    const receive = pick(list, RECEIVE_KEYS, "PDFTR-UST");
    const failKeys = list.map(keyOf).filter((k) => /^PDFT[DR]-/.test(String(k)));
    if (!deliver && !receive) return { date, missing: true, failKeys };
    return { date, deliver: deliver?.value ?? null, receive: receive?.value ?? null, keys: [deliver?.key, receive?.key] };
  } catch {
    return null;
  }
}

export async function GET() {
  try {
    const results = (await Promise.all(lastWednesdays(WEEKS + 2).map(fetchAsOf))).filter(Boolean);
    const valid = results.filter((r) => !r.missing).sort((a, b) => (a.date > b.date ? 1 : -1));

    if (!valid.length) {
      const sample = results.find((r) => r.missing);
      const hint = sample?.failKeys?.length ? ` (찾은 항목: ${sample.failKeys.slice(0, 8).join(", ")})` : "";
      return Response.json(
        { ok: false, error: `원본 데이터를 가져오지 못했습니다 (NY Fed 결제 실패 통계)${hint}` },
        { status: 502 }
      );
    }

    const points = valid.slice(-WEEKS).map((r) => ({ date: r.date, deliver: r.deliver, receive: r.receive }));
    const latest = points[points.length - 1];
    const prev = points.length > 1 ? points[points.length - 2] : null;
    const past = points.slice(0, -1).map((p) => p.deliver).filter((v) => v != null);
    const avgDeliver = past.length ? past.reduce((a, b) => a + b, 0) / past.length : null;

    return Response.json({
      ok: true,
      latestDate: latest.date,
      latestDeliver: latest.deliver,
      latestReceive: latest.receive,
      changeDeliver: prev && latest.deliver != null && prev.deliver != null ? latest.deliver - prev.deliver : null,
      changeReceive: prev && latest.receive != null && prev.receive != null ? latest.receive - prev.receive : null,
      avgDeliver, // 이전 주들 평균 (백만 달러)
      ratioToAvg: avgDeliver && latest.deliver != null ? latest.deliver / avgDeliver : null,
      points,
      keys: valid[valid.length - 1].keys,
      sourceNote: "NY Fed 공식 Markets Data API - 프라이머리 딜러 국채(TIPS 제외) 결제 실패",
    });
  } catch (e) {
    return Response.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
