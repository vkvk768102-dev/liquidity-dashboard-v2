// 파일 위치: app/api/cds-probe/route.js
// 시험용: worldgovernmentbonds.com에서 CDS 데이터를 읽을 수 있는지 확인합니다.
// 18번 카드에는 영향이 없습니다. 시험이 끝나면 이 파일은 지웁니다.

export const dynamic = "force-dynamic";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const SITE = "https://www.worldgovernmentbonds.com";
const PAGES = {
  list: `${SITE}/sovereign-cds/`,
  us: `${SITE}/cds-historical-data/united-states/5-years/`,
};

// 페이지 안의 "jsGlobalVars = { ... }" 설정값을 찾아 읽음
function extractVars(html) {
  const m = /jsGlobalVars\s*=\s*\{/.exec(html);
  if (!m) return null;
  const start = m.index + m[0].length - 1;
  let depth = 0;
  let inStr = false;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (inStr) {
      if (ch === "\\") i++;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) {
      try {
        return JSON.parse(html.slice(start, i + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

// 응답이 어떤 모양인지 짧게 요약
function shapeOf(v, depth = 0) {
  if (v === null) return "null";
  if (Array.isArray(v)) return { _array: v.length, first: v.length && depth < 5 ? shapeOf(v[0], depth + 1) : undefined };
  if (typeof v === "object") {
    const keys = Object.keys(v);
    if (depth >= 5) return `{${keys.length} keys}`;
    const out = {};
    keys.slice(0, 10).forEach((k) => (out[k] = shapeOf(v[k], depth + 1)));
    if (keys.length > 10) out._moreKeys = `${keys.length - 10}개 더 (마지막: ${keys[keys.length - 1]})`;
    return out;
  }
  if (typeof v === "string") return v.length > 70 ? `str(${v.length}): ${v.slice(0, 70)}` : v;
  return v;
}

async function probeOne(pageUrl, full) {
  const out = { pageUrl };
  try {
    const pageRes = await fetch(pageUrl, {
      cache: "no-store",
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml", "Accept-Language": "en-US,en;q=0.9" },
      signal: AbortSignal.timeout(15000),
    });
    out.pageStatus = pageRes.status;
    const html = await pageRes.text();
    out.pageLength = html.length;
    const vars = extractVars(html);
    out.vars = vars;
    if (!vars?.ENDPOINT) {
      out.error = "페이지에서 설정값(jsGlobalVars)을 찾지 못함";
      return out;
    }

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
      signal: AbortSignal.timeout(15000),
    });
    out.postStatus = res.status;
    out.contentType = res.headers.get("content-type");
    const text = await res.text();
    out.bodyLength = text.length;
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    out.isJson = json !== null;
    out.shape = json !== null ? shapeOf(json) : null;
    out.bodyHead = text.slice(0, 1500);
    if (full) out.body = text;
  } catch (e) {
    out.error = `${e.message}${e.cause?.code ? ` (${e.cause.code})` : ""}`;
  }
  return out;
}

export async function GET(request) {
  const full = new URL(request.url).searchParams.get("full") === "1";
  const list = await probeOne(PAGES.list, full);
  const us = await probeOne(PAGES.us, full);
  return Response.json({ at: new Date().toISOString(), list, us });
}
