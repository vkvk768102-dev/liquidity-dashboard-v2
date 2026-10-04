// 미국 재무부 FedInvest 일일 국채 가격 (종목별 실제 종가, 무료, 키 불필요)
// https://www.treasurydirect.gov/GA-FI/FedInvest/selectSecurityPriceDate.htm
// 반환: [{ cusip, type, coupon, maturity("YYYY-MM-DD"), price(종가, 액면 100 기준) }]

const URL = "https://www.treasurydirect.gov/GA-FI/FedInvest/selectSecurityPriceDate";

function toIso(mdy) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(mdy).trim());
  if (!m) return null;
  return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

function parseRows(cells) {
  const out = [];
  for (const c of cells) {
    if (c.length < 8) continue;
    const cusip = c[0].trim();
    if (!/^[0-9A-Z]{9}$/.test(cusip)) continue;
    const type = c[1].trim().toUpperCase();
    const coupon = parseFloat(String(c[2]).replace("%", ""));
    const maturity = toIso(c[3]);
    const eod = parseFloat(c[7]);
    const buy = parseFloat(c[5]);
    const sell = parseFloat(c[6]);
    const price = eod > 0 ? eod : buy > 0 && sell > 0 ? (buy + sell) / 2 : NaN;
    if (!maturity || !Number.isFinite(coupon) || !Number.isFinite(price) || price <= 0) continue;
    // final: 그날 확정 종가(End of Day)가 올라온 값인지. 장중에는 종가 칸이 비어 있어 매수·매도 중간값을 임시로 씀
    out.push({ cusip, type, coupon, maturity, price, final: eod > 0 });
  }
  return out;
}

// 사이트 양식 이름이 시기마다 달라서 여러 방식을 차례로 시도
function variants(y, m, d) {
  return [
    { priceDateDay: String(Number(d)), priceDateMonth: String(Number(m)), priceDateYear: y, fileType: "csv", csv: "CSV FORMAT" },
    { "priceDate.month": String(Number(m)), "priceDate.day": String(Number(d)), "priceDate.year": y, submit: "CSV Format" },
    { priceDateDay: String(Number(d)), priceDateMonth: String(Number(m)), priceDateYear: y, submit: "Show Prices" },
    { "priceDate.month": String(Number(m)), "priceDate.day": String(Number(d)), "priceDate.year": y, submit: "Show Prices" },
  ];
}

function parseText(text) {
  if (!/<table/i.test(text)) {
    const cells = text
      .trim()
      .split(/\r?\n/)
      .map((l) => l.split(",").map((x) => x.replace(/"/g, "")));
    return parseRows(cells);
  }
  const rows = [...text.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((r) =>
    [...r[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) =>
      c[1].replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim()
    )
  );
  return parseRows(rows);
}

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

// 1단계: 사람처럼 먼저 양식 페이지를 열어 쿠키·보안 토큰·입력칸 이름을 읽어옴
// 중요: 이 사이트는 "어느 날짜를 골랐는지"를 방문자(쿠키)별로 서버에 기억해 둔 뒤 결과 페이지로 넘겨줌.
// 그래서 쿠키 하나로 여러 날짜를 동시에 요청하면 날짜가 서로 뒤바뀌어 다른 날 가격이 섞여 들어옴.
// → 날짜마다 방문(쿠키)을 따로 열어서 섞이지 않게 함.

function cookiesFrom(res) {
  const list = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [res.headers.get("set-cookie")];
  return list
    .filter(Boolean)
    .flatMap((c) => c.split(/,(?=\s*[A-Za-z0-9_\-]+=)/))
    .map((c) => c.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
}

function parseForm(html, pageUrl) {
  const forms = [...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)];
  const form = forms.find((f) => /day|month|year|price/i.test(f[2])) ?? forms[0];
  if (!form) return null;
  const actionAttr = /action\s*=\s*"([^"]*)"/i.exec(form[1])?.[1] ?? "";
  const action = actionAttr ? new globalThis.URL(actionAttr.replace(/&amp;/g, "&"), pageUrl).toString() : pageUrl;
  const fields = [];
  for (const m of form[2].matchAll(/<(input|select|button)\b([^>]*)>/gi)) {
    const attrs = m[2];
    const name = /name\s*=\s*"([^"]+)"/i.exec(attrs)?.[1];
    if (!name) continue;
    const type = (/type\s*=\s*"([^"]+)"/i.exec(attrs)?.[1] ?? (m[1].toLowerCase() === "select" ? "select" : "text")).toLowerCase();
    const value = (/value\s*=\s*"([^"]*)"/i.exec(attrs)?.[1] ?? "").replace(/&amp;/g, "&");
    fields.push({ tag: m[1].toLowerCase(), name, type, value });
  }
  return { action, fields };
}

async function openSession() {
  for (const pageUrl of [URL, `${URL}.htm`]) {
    try {
      const res = await fetch(pageUrl, { headers: { "User-Agent": UA, Accept: "text/html" }, cache: "no-store" });
      const html = await res.text();
      const form = parseForm(html, pageUrl);
      if (form && form.fields.length) return { ok: true, pageUrl, status: res.status, cookie: cookiesFrom(res), ...form };
    } catch {
      // 다음 주소 시도
    }
  }
  return { ok: false };
}

// 한꺼번에 너무 많이 요청하지 않도록 동시에 6개까지만
const MAX_PARALLEL = 6;
let running = 0;
const waiting = [];
async function limited(fn) {
  if (running >= MAX_PARALLEL) await new Promise((r) => waiting.push(r));
  running++;
  try {
    return await fn();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

// 받은 페이지에 적힌 날짜("Prices For: Oct 2, 2026")가 요청한 날짜와 다르면 버림 (날짜 뒤바뀜 방지 이중 확인)
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
function pageDate(text) {
  const m = /Prices\s+For:?\s*(?:<[^>]+>\s*)*([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/i.exec(text);
  if (!m) return null;
  const mo = MONTHS[m[1].toLowerCase()];
  return mo ? `${m[3]}-${String(mo).padStart(2, "0")}-${m[2].padStart(2, "0")}` : null;
}
function rowsFor(text, dateIso) {
  const shown = pageDate(text);
  if (shown && shown !== dateIso) return [];
  return parseText(text);
}

// 양식 입력칸 이름에 맞춰 날짜·토큰·CSV 버튼을 채움
function buildBody(session, y, m, d) {
  const body = {};
  const submits = [];
  for (const f of session.fields) {
    const n = f.name.toLowerCase();
    if (f.type === "submit" || f.tag === "button") {
      submits.push(f);
      continue;
    }
    if (/date/.test(n) && !/day|month|year/.test(n)) {
      // 날짜 한 칸짜리 입력 (예: priceDate=2026-10-02). 원래 값의 형식을 따라감
      body[f.name] = /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(f.value) ? `${m}/${d}/${y}` : `${y}-${m}-${d}`;
    } else if (/day/.test(n)) body[f.name] = String(Number(d));
    else if (/month/.test(n)) body[f.name] = String(Number(m));
    else if (/year/.test(n)) body[f.name] = y;
    else if (f.type === "hidden") body[f.name] = f.value;
    else if (f.type === "radio" || f.type === "checkbox") {
      if (/csv/i.test(f.value)) body[f.name] = f.value;
    }
  }
  const btn = submits.find((b) => /csv/i.test(b.value) || /csv/i.test(b.name)) ?? submits[0];
  if (btn) body[btn.name] = btn.value;
  return body;
}

async function post(body, session) {
  const res = await fetch(session?.action ?? URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": UA,
      Accept: "text/html,text/csv,*/*",
      Referer: session?.pageUrl ?? URL,
      ...(session?.cookie ? { Cookie: session.cookie } : {}),
    },
    body: new URLSearchParams(body).toString(),
    cache: "no-store",
  });
  return { ok: res.ok, status: res.status, text: await res.text() };
}

// 결과 캐시 (확정 종가만 저장. 장중 임시 가격을 저장해 두면 장이 끝난 뒤에도 그 값이 계속 쓰여서 숫자가 오락가락함)
const cache = new Map();

/** 그날 가격이 확정 종가인지 (절반 이상 종목에 종가가 올라와 있으면 확정으로 봄) */
export function isFinalDay(rows) {
  return !!rows?.length && rows.filter((r) => r.final).length >= rows.length / 2;
}

const inflight = new Map(); // 같은 날짜를 동시에 두 번 요청하지 않도록

/** dateIso: "YYYY-MM-DD" (그날 종가). 휴일이거나 자료가 없으면 [] */
export async function fetchFedInvestPrices(dateIso) {
  if (cache.has(dateIso)) return cache.get(dateIso);
  if (inflight.has(dateIso)) return inflight.get(dateIso);
  const p = limited(() => loadDay(dateIso)).finally(() => inflight.delete(dateIso));
  inflight.set(dateIso, p);
  return p;
}

async function loadDay(dateIso) {
  const [y, m, d] = dateIso.split("-");
  let rows = [];

  // 이 날짜 전용 방문(쿠키)을 새로 엶
  const session = await openSession();

  // 1순위: 양식 페이지에서 읽은 토큰·쿠키·입력칸 이름으로 요청
  if (session.ok) {
    try {
      const { ok, text } = await post(buildBody(session, y, m, d), session);
      if (ok) rows = rowsFor(text, dateIso);
    } catch {
      // 아래 방식 시도
    }
  }

  // 2순위: 알려진 입력칸 이름들
  if (!rows.length) {
    for (const body of variants(y, m, d)) {
      try {
        const { ok, text } = await post(body, session.ok ? session : null);
        if (!ok) continue;
        rows = rowsFor(text, dateIso);
        if (rows.length) break;
      } catch {
        // 다음 방식
      }
    }
  }

  // 확정 종가이거나, 3일 넘게 지난 날짜(더 바뀔 일 없음)만 저장
  const old = Date.now() - Date.parse(dateIso + "T00:00:00Z") > 3 * 86400000;
  if (rows.length && (isFinalDay(rows) || old)) cache.set(dateIso, rows);
  return rows;
}

/** 진단용: 양식 페이지에서 읽은 내용과 요청 결과 */
export async function fetchFedInvestDebug(dateIso) {
  const [y, m, d] = dateIso.split("-");
  const session = await openSession();
  const out = {
    formPage: session.ok
      ? {
          pageUrl: session.pageUrl,
          status: session.status,
          hasCookie: !!session.cookie,
          action: session.action,
          fields: session.fields.map((f) => `${f.name}(${f.type}${f.value ? "=" + f.value.slice(0, 20) : ""})`),
        }
      : "양식 페이지를 읽지 못함",
    tries: [],
  };
  if (session.ok) {
    const body = buildBody(session, y, m, d);
    try {
      const { status, text } = await post(body, session);
      out.tries.push({ how: "양식 기반", sent: Object.keys(body), status, rows: parseText(text).length, pageDate: pageDate(text), snippet: text.replace(/\s+/g, " ").slice(0, 300) });
    } catch (e) {
      out.tries.push({ how: "양식 기반", error: String(e) });
    }
  }
  return out;
}

/** 최근 영업일부터 거슬러 올라가며 가격이 있는 첫 날짜 */
export async function fetchLatestFedInvest(maxBack = 7) {
  const d = new Date();
  for (let i = 0; i <= maxBack; i++) {
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) {
      const iso = d.toISOString().slice(0, 10);
      const rows = await fetchFedInvestPrices(iso);
      if (rows.length) return { date: iso, rows };
    }
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return null;
}
