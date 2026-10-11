// 파일 위치: app/api/sovereign-cds/route.js
// 18번 카드용: 주요 국가 5년 CDS(국가 부도 보험료, bp)와 미국 5년 CDS 추이
// 데이터 출처: worldgovernmentbonds.com (API 키 불필요)
//   - 국가별 표:  https://www.worldgovernmentbonds.com/sovereign-cds/
//   - 미국 추이:  https://www.worldgovernmentbonds.com/cds-historical-data/united-states/5-years/
// (investing.com은 Vercel·GitHub 서버의 요청을 막아서 2026-10-11에 출처를 바꿨습니다.)
// 자동 조회에 실패하면 app/lib/cdsSnapshot.js에 저장해 둔 값을 대신 돌려주고, source를 "snapshot"으로 표시합니다.
import { SNAPSHOT_COUNTRIES, SNAPSHOT_US_HISTORY, SNAPSHOT_TAKEN } from "../../lib/cdsSnapshot";
import { COUNTRIES, parseTable, parseHistory, extractVars } from "../../lib/cdsParse";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

const SITE = "https://www.worldgovernmentbonds.com";
const LIST_PAGE = `${SITE}/sovereign-cds/`;
const US_PAGE = `${SITE}/cds-historical-data/united-states/5-years/`;

// 사이트가 데이터를 받아 올 때 보내는 설정값 (각 페이지의 jsGlobalVars와 같은 내용)
const LIST_VARS = { JS_VARIABLE: "jsGlobalVars", ENDPOINT: `${SITE}/wp-json/cds/v1/main` };
const US_VARS = {
  JS_VARIABLE: "jsGlobalVars",
  FUNCTION: "CDS",
  DOMESTIC: true,
  ENDPOINT: `${SITE}/wp-json/common/v1/historical`,
  DATE_RIF: "2099-12-31",
  OBJ: { UNIT: "", DECIMAL: 2, UNIT_DELTA: "%", DECIMAL_DELTA: 2 },
  COUNTRY1: { SYMBOL: "6", PAESE: "United States", PAESE_UPPERCASE: "UNITED STATES", BANDIERA: "us", URL_PAGE: "united-states" },
  COUNTRY2: null,
  OBJ1: { DURATA_STRING: "5 Years", DURATA: 60 },
  OBJ2: null,
};

const CACHE_MS = 30 * 60 * 1000; // 같은 서버가 살아 있는 동안 30분은 다시 요청하지 않음
const RETRY_MS = 5 * 60 * 1000; // 자동 조회에 실패했을 때는 5분 뒤에 다시 시도
const TIMEOUT_MS = 8000; // 이 시간 안에 못 받으면 저장된 값으로 넘어감
const HISTORY_SPAN_DAYS = 42; // 추이 차트에 쓰는 기간 (최근 6주)

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

async function postVars(vars, pageUrl, signal) {
  const res = await fetch(vars.ENDPOINT, {
    method: "POST",
    cache: "no-store",
    headers: {
      "User-Agent": UA,
      Accept: "*/*",
      "Accept-Language": "en-US,en;q=0.9",
      "Content-Type": "application/json; charset=UTF-8",
      Origin: SITE,
      Referer: pageUrl,
    },
    body: JSON.stringify({ GLOBALVAR: vars }),
    signal,
  });
  if (!res.ok) throw new Error(`worldgovernmentbonds.com 응답 오류 (${res.status})`);
  const json = await res.json();
  if (!json || json.success === false) throw new Error("worldgovernmentbonds.com이 데이터를 주지 않았습니다");
  return json;
}

// 저장해 둔 설정값으로 먼저 요청하고, 안 되면 페이지에서 설정값을 다시 읽어 한 번 더 시도
async function fetchData(pageUrl, defaultVars, signal) {
  try {
    return await postVars(defaultVars, pageUrl, signal);
  } catch (first) {
    if (signal.aborted) throw new Error("worldgovernmentbonds.com 응답이 너무 늦습니다");
    try {
      const page = await fetch(pageUrl, {
        cache: "no-store",
        headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml", "Accept-Language": "en-US,en;q=0.9" },
        signal,
      });
      const vars = page.ok ? extractVars(await page.text()) : null;
      if (!vars?.ENDPOINT || !String(vars.ENDPOINT).startsWith(SITE)) throw first;
      return await postVars(vars, pageUrl, signal);
    } catch {
      throw first;
    }
  }
}

const dayMs = (d) => new Date(d + "T00:00:00Z").getTime();

function buildCountries(rowsByKey) {
  return COUNTRIES.filter((c) => rowsByKey.has(c.key))
    .map((c) => {
      const r = rowsByKey.get(c.key);
      return { key: c.key, name: c.ko, flag: c.flag, value: r.value, var1m: r.var1m ?? null, var6m: r.var6m ?? null, date: r.date ?? null };
    })
    .sort((a, b) => b.value - a.value);
}

function snapshotRows() {
  return new Map(SNAPSHOT_COUNTRIES.map((r) => [r.key, r]));
}

let memo = null; // { at, ttl, body }

async function load() {
  const now = new Date();
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  const [tableRes, historyRes] = await Promise.allSettled([
    fetchData(LIST_PAGE, LIST_VARS, signal),
    fetchData(US_PAGE, US_VARS, signal),
  ]);

  // 1) 국가별 표
  let tableSource = "live";
  let tableError = null;
  let rows = null;
  if (tableRes.status === "fulfilled") {
    rows = parseTable(tableRes.value.table);
    if (rows.size < 5) {
      tableError = `worldgovernmentbonds.com 표를 읽지 못했습니다 (읽은 국가 ${rows.size}개)`;
      rows = null;
    }
  } else {
    tableError = tableRes.reason?.message || "worldgovernmentbonds.com 요청 실패";
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
      historyError = `worldgovernmentbonds.com 미국 CDS 추이를 읽지 못했습니다 (읽은 날짜 ${history.length}개)`;
      history = null;
    }
  } else {
    historyError = historyRes.reason?.message || "worldgovernmentbonds.com 요청 실패";
  }
  if (!history) {
    history = [...SNAPSHOT_US_HISTORY];
    historySource = "snapshot";
  }

  // 표의 미국 값이 추이의 마지막 날짜보다 최근이면 맨 뒤에 붙임
  const us = countries.find((c) => c.key === "US") || null;
  const lastHist = history[history.length - 1];
  if (us?.date && us.date > lastHist.date) history.push({ date: us.date, value: us.value });

  // 마지막 날짜에서 거슬러 최근 6주만 사용
  const lastMs = dayMs(history[history.length - 1].date);
  const points = history.filter((p) => lastMs - dayMs(p.date) <= HISTORY_SPAN_DAYS * 86400000);

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
