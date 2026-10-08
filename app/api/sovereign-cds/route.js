// 파일 위치: app/api/sovereign-cds/route.js
// 18번 카드용: 주요 국가 5년 CDS(국가 부도 보험료, bp)와 미국 5년 CDS 추이
// 데이터 출처: investing.com 공개 페이지 (API 키 불필요)
//   - 국가별 표:  https://www.investing.com/rates-bonds/world-cds
//   - 미국 추이:  https://www.investing.com/rates-bonds/united-states-cds-5-years-usd-historical-data
// investing.com은 서버에서 오는 요청을 막는 경우가 있습니다.
// 막히면 app/lib/cdsSnapshot.js에 저장해 둔 값을 대신 돌려주고, source를 "snapshot"으로 표시합니다.
import { SNAPSHOT_COUNTRIES, SNAPSHOT_US_HISTORY, SNAPSHOT_TAKEN } from "../../lib/cdsSnapshot";
import { COUNTRIES, findCountry, parseTable, parseHistory } from "../../lib/cdsParse";

export const dynamic = "force-dynamic";

const TABLE_URL = "https://www.investing.com/rates-bonds/world-cds";
const US_HISTORY_URL = "https://www.investing.com/rates-bonds/united-states-cds-5-years-usd-historical-data";
const CACHE_MS = 30 * 60 * 1000; // 같은 서버가 살아 있는 동안 30분은 다시 요청하지 않음
const RETRY_MS = 5 * 60 * 1000; // 자동 조회가 막혔을 때는 5분 뒤에 다시 시도
const HISTORY_DAYS = 30; // 추이 차트에 쓰는 최근 영업일 수

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

async function fetchHtml(url) {
  const res = await fetch(url, { cache: "no-store", headers: HEADERS, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`investing.com 응답 오류 (${res.status})`);
  return res.text();
}

function buildCountries(rowsByKey) {
  return COUNTRIES.filter((c) => rowsByKey.has(c.key))
    .map((c) => {
      const r = rowsByKey.get(c.key);
      return { key: c.key, name: c.ko, flag: c.flag, value: r.value, change: r.change, changePct: r.changePct, date: r.date };
    })
    .sort((a, b) => b.value - a.value);
}

function snapshotRows() {
  const rows = new Map();
  for (const r of SNAPSHOT_COUNTRIES) {
    const c = findCountry(r.en);
    if (c) rows.set(c.key, r);
  }
  return rows;
}

let memo = null; // { at, ttl, body }

async function load() {
  const now = new Date();
  const [tableRes, historyRes] = await Promise.allSettled([fetchHtml(TABLE_URL), fetchHtml(US_HISTORY_URL)]);

  // 1) 국가별 표
  let tableSource = "live";
  let tableError = null;
  let rows = null;
  if (tableRes.status === "fulfilled") {
    rows = parseTable(tableRes.value, now);
    if (rows.size < 5) {
      tableError = `investing.com 표를 읽지 못했습니다 (읽은 국가 ${rows.size}개)`;
      rows = null;
    }
  } else {
    tableError = tableRes.reason?.message || "investing.com 요청 실패";
  }
  if (!rows) {
    rows = snapshotRows();
    tableSource = "snapshot";
  }
  const countries = buildCountries(rows);
  const dates = countries.map((c) => c.date).filter(Boolean).sort();
  const asOf = dates.length ? dates[dates.length - 1] : null;

  // 2) 미국 추이
  let historySource = "live";
  let historyError = null;
  let history = null;
  if (historyRes.status === "fulfilled") {
    history = parseHistory(historyRes.value);
    if (history.length < 3) {
      historyError = `investing.com 미국 CDS 추이를 읽지 못했습니다 (읽은 날짜 ${history.length}개)`;
      history = null;
    }
  } else {
    historyError = historyRes.reason?.message || "investing.com 요청 실패";
  }
  if (!history) {
    history = [...SNAPSHOT_US_HISTORY];
    historySource = "snapshot";
  }

  // 표의 미국 값이 추이의 마지막 날짜보다 최근이면 맨 뒤에 붙임
  const us = countries.find((c) => c.key === "US") || null;
  const lastHist = history[history.length - 1];
  if (us?.date && us.date > lastHist.date) history.push({ date: us.date, value: us.value });
  const points = history.slice(-HISTORY_DAYS);

  return {
    ok: true,
    source: tableSource, // "live" = 자동 조회 성공, "snapshot" = 저장된 값
    historySource,
    liveError: tableError,
    historyError,
    snapshotTaken: SNAPSHOT_TAKEN,
    asOf,
    countries,
    us: { latest: points[points.length - 1], points },
    fetchedAt: now.toISOString(),
  };
}

export async function GET() {
  try {
    if (memo && Date.now() - memo.at < memo.ttl) return Response.json(memo.body);
    const body = await load();
    const allLive = body.source === "live" && body.historySource === "live";
    memo = { at: Date.now(), ttl: allLive ? CACHE_MS : RETRY_MS, body };
    return Response.json(body);
  } catch (e) {
    return Response.json({ ok: false, error: e.message }, { status: 500 });
  }
}
