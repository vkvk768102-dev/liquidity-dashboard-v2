// 파일 위치: app/lib/cdsParse.js
// 18번 카드(주요 국가 5년 CDS)용: worldgovernmentbonds.com 응답에서 숫자를 읽어 내는 함수들
// (app/api/sovereign-cds/route.js에서 불러 씁니다)

// slug: worldgovernmentbonds.com 주소에 쓰이는 국가 이름
export const COUNTRIES = [
  { key: "EG", ko: "이집트", flag: "🇪🇬", slug: "egypt" },
  { key: "TR", ko: "튀르키예", flag: "🇹🇷", slug: "turkey" },
  { key: "ZA", ko: "남아공", flag: "🇿🇦", slug: "south-africa" },
  { key: "BR", ko: "브라질", flag: "🇧🇷", slug: "brazil" },
  { key: "MX", ko: "멕시코", flag: "🇲🇽", slug: "mexico" },
  { key: "ID", ko: "인도네시아", flag: "🇮🇩", slug: "indonesia" },
  { key: "IN", ko: "인도", flag: "🇮🇳", slug: "india" },
  { key: "FR", ko: "프랑스", flag: "🇫🇷", slug: "france" },
  { key: "IT", ko: "이탈리아", flag: "🇮🇹", slug: "italy" },
  { key: "IL", ko: "이스라엘", flag: "🇮🇱", slug: "israel" },
  { key: "CA", ko: "캐나다", flag: "🇨🇦", slug: "canada" },
  { key: "US", ko: "미국", flag: "🇺🇸", slug: "united-states" },
  { key: "CN", ko: "중국", flag: "🇨🇳", slug: "china" },
  { key: "JP", ko: "일본", flag: "🇯🇵", slug: "japan" },
  { key: "ES", ko: "스페인", flag: "🇪🇸", slug: "spain" },
  { key: "GB", ko: "영국", flag: "🇬🇧", slug: "united-kingdom" },
  { key: "KR", ko: "한국", flag: "🇰🇷", slug: "south-korea" },
  { key: "AU", ko: "호주", flag: "🇦🇺", slug: "australia" },
  { key: "DE", ko: "독일", flag: "🇩🇪", slug: "germany" },
  { key: "CH", ko: "스위스", flag: "🇨🇭", slug: "switzerland" },
];

const BY_SLUG = new Map(COUNTRIES.map((c) => [c.slug, c]));
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function toNum(s) {
  if (s == null) return null;
  const n = parseFloat(String(s).replace(/,/g, "").replace(/[+%\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

// 태그를 지우고 글자만 남김
function textOf(html) {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// 국가별 표 읽기. 한 줄의 칸 순서: 국기, 국가, 신용등급, 5년 CDS, 1개월 변화(%), 6개월 변화(%), 부도확률, 날짜
// 돌려주는 값: Map(국가 코드 → { value, var1m, var6m, date })
export function parseTable(tableHtml) {
  const rows = new Map();
  const body = String(tableHtml || "").split(/<tbody[^>]*>/i)[1]?.split(/<\/tbody>/i)[0] ?? "";
  for (const tr of body.split(/<tr\b/i).slice(1)) {
    const slug = /\/cds-historical-data\/([a-z-]+)\/5-years/.exec(tr)?.[1];
    const country = slug ? BY_SLUG.get(slug) : null;
    if (!country || rows.has(country.key)) continue;

    const cells = tr.split(/<td\b/i).slice(1).map((td) => {
      const close = td.indexOf(">");
      const key = /sorttable_customkey="([^"]*)"/.exec(td.slice(0, close + 1))?.[1] ?? null;
      return { key, text: textOf(td.slice(close + 1)) };
    });
    if (cells.length < 6) continue;

    const value = toNum(cells[3].key) ?? toNum(cells[3].text);
    if (value == null || value <= 0 || value > 20000) continue;
    const date = cells.map((c) => c.key).find((k) => k && DATE_RE.test(k)) ?? null;

    rows.set(country.key, {
      value,
      var1m: toNum(cells[4].key) ?? toNum(cells[4].text),
      var6m: toNum(cells[5].key) ?? toNum(cells[5].text),
      date,
    });
  }
  return rows;
}

// 미국 CDS 일별 값 읽기. 응답의 result.quote = { "1": { CLOSE_VAL, DATA_VAL }, "2": ... }
// 돌려주는 값: [{ date, value }] (오래된 날짜 → 최근 날짜)
export function parseHistory(json) {
  const quote = json?.result?.quote;
  if (!quote || typeof quote !== "object") return [];
  const byDate = new Map();
  for (const q of Object.values(quote)) {
    const date = q?.DATA_VAL;
    const value = toNum(q?.CLOSE_VAL);
    if (DATE_RE.test(date || "") && value != null && value > 0 && value < 20000) byDate.set(date, value);
  }
  return [...byDate.entries()].map(([date, value]) => ({ date, value })).sort((a, b) => (a.date < b.date ? -1 : 1));
}

// 페이지 안의 "jsGlobalVars = { ... }" 설정값 읽기 (사이트 설정이 바뀌었을 때 다시 읽는 용도)
export function extractVars(html) {
  const m = /jsGlobalVars\s*=\s*\{/.exec(html || "");
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
