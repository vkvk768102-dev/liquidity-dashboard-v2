// 파일 위치: app/lib/cdsParse.js
// 18번 카드(주요 국가 5년 CDS)용: investing.com 페이지에서 숫자를 읽어 내는 함수들
// (app/api/sovereign-cds/route.js에서 불러 씁니다)

// investing.com 표기 → 화면에 보여 줄 이름. aliases는 표기가 바뀔 때를 대비한 다른 이름들
export const COUNTRIES = [
  { key: "EG", ko: "이집트", flag: "🇪🇬", aliases: ["egypt"] },
  { key: "TR", ko: "튀르키예", flag: "🇹🇷", aliases: ["turkey", "turkiye", "türkiye"] },
  { key: "ZA", ko: "남아공", flag: "🇿🇦", aliases: ["south africa"] },
  { key: "BR", ko: "브라질", flag: "🇧🇷", aliases: ["brazil"] },
  { key: "MX", ko: "멕시코", flag: "🇲🇽", aliases: ["mexico"] },
  { key: "ID", ko: "인도네시아", flag: "🇮🇩", aliases: ["indonesia"] },
  { key: "IN", ko: "인도", flag: "🇮🇳", aliases: ["india"] },
  { key: "FR", ko: "프랑스", flag: "🇫🇷", aliases: ["france"] },
  { key: "SA", ko: "사우디", flag: "🇸🇦", aliases: ["saudi arabia"] },
  { key: "IT", ko: "이탈리아", flag: "🇮🇹", aliases: ["italy"] },
  { key: "IL", ko: "이스라엘", flag: "🇮🇱", aliases: ["israel"] },
  { key: "CA", ko: "캐나다", flag: "🇨🇦", aliases: ["canada"] },
  { key: "US", ko: "미국", flag: "🇺🇸", aliases: ["us", "u.s.", "usa", "united states"] },
  { key: "CN", ko: "중국", flag: "🇨🇳", aliases: ["china"] },
  { key: "JP", ko: "일본", flag: "🇯🇵", aliases: ["japan"] },
  { key: "ES", ko: "스페인", flag: "🇪🇸", aliases: ["spain"] },
  { key: "GB", ko: "영국", flag: "🇬🇧", aliases: ["uk", "u.k.", "united kingdom"] },
  { key: "KR", ko: "한국", flag: "🇰🇷", aliases: ["south korea", "korea"] },
  { key: "AU", ko: "호주", flag: "🇦🇺", aliases: ["australia"] },
  { key: "DE", ko: "독일", flag: "🇩🇪", aliases: ["germany"] },
  { key: "CH", ko: "스위스", flag: "🇨🇭", aliases: ["switzerland"] },
];

export function findCountry(name) {
  const n = String(name || "").trim().toLowerCase();
  if (!n) return null;
  return COUNTRIES.find((c) => c.aliases.includes(n)) || null;
}

const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

function toNum(s) {
  if (s == null) return null;
  const n = parseFloat(String(s).replace(/,/g, "").replace(/[+%]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

// 태그를 지우고 글자만 남김 (script·style 안의 내용은 통째로 버림)
function stripTags(html) {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
}

// 표의 시각 칸: "01/10"(일/월) 또는 오늘 값이면 "14:05:33" 같은 시각
function parseRowDate(token, now) {
  if (!token) return null;
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(token)) return ymd(now);
  const m = /^(\d{1,2})\/(\d{1,2})$/.exec(token);
  if (!m) return null;
  let day = parseInt(m[1], 10);
  let month = parseInt(m[2], 10);
  if (month > 12 && day <= 12) [day, month] = [month, day]; // 월/일 순서로 온 경우
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  let year = now.getUTCFullYear();
  // 연도가 없으므로, 내일보다 뒤의 날짜가 되면 작년 값으로 봄
  if (Date.UTC(year, month - 1, day) > now.getTime() + 2 * 86400000) year -= 1;
  return `${year}-${pad(month)}-${pad(day)}`;
}

// 국가별 표 읽기: CDS 페이지로 가는 링크를 하나씩 찾고, 그 뒤에 나오는 숫자를 읽음
export function parseTable(html, now = new Date()) {
  const anchorRe = /<a\b[^>]*href="[^"]*\/rates-bonds\/([a-z0-9-]*cds[a-z0-9-]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  const anchors = [];
  let m;
  while ((m = anchorRe.exec(html))) {
    anchors.push({ slug: m[1], text: stripTags(m[2]), end: anchorRe.lastIndex, start: m.index });
  }

  const rows = new Map();
  anchors.forEach((a, i) => {
    const fromSlug = a.slug.split("-cds")[0].replace(/-/g, " ");
    const country = findCountry(a.text) || findCountry(fromSlug);
    if (!country || rows.has(country.key)) return;
    if (/\b(1|2|3|4|7|10)-years?\b/.test(a.slug)) return; // 5년물만

    const next = anchors[i + 1]?.start ?? html.length;
    const tokens = stripTags(html.slice(a.end, Math.min(next, a.end + 3000))).split(" ").filter(Boolean);

    // 소수점이 있는 첫 숫자(%가 붙지 않은 것)가 현재 값
    const iLast = tokens.findIndex((t) => /^[\d,]+\.\d+$/.test(t));
    if (iLast < 0) return;
    const value = toNum(tokens[iLast]);
    if (value == null || value <= 0 || value > 20000) return;

    // 바로 뒤가 "변동폭, 변동률%" 모양이면 전일 대비로 읽음. 변동률(%)만 바로 붙어 있어도 전일 대비로 봄
    let change = null;
    let changePct = null;
    const t1 = tokens[iLast + 1];
    const t2 = tokens[iLast + 2];
    const isNum = (t) => !!t && /^[+-]?[\d,]+(\.\d+)?$/.test(t);
    const isPct = (t) => !!t && /^[+-]?[\d,]+(\.\d+)?%$/.test(t);
    if (isNum(t1) && isPct(t2)) {
      change = toNum(t1);
      changePct = toNum(t2);
    } else if (isPct(t1)) {
      changePct = toNum(t1);
    }
    const timeToken = tokens.slice(iLast + 1, iLast + 6).find((t) => /^\d{1,2}[/:]\d{2}(:\d{2})?$/.test(t));

    rows.set(country.key, { en: a.text, value, change, changePct, date: parseRowDate(timeToken, now) });
  });
  return rows;
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

// 미국 CDS 일별 값 읽기: "Sep 25, 2026 33.75 ..." 모양의 줄을 찾음
export function parseHistory(html) {
  const byDate = new Map();
  const add = (date, value) => {
    if (date && value != null && value > 0 && value < 20000 && !byDate.has(date)) byDate.set(date, value);
  };

  const text = stripTags(html);
  let m;
  const re1 = /\b([A-Z][a-z]{2})\w* (\d{1,2}), (\d{4}) ([\d,]+\.\d+)/g;
  while ((m = re1.exec(text))) {
    const month = MONTHS[m[1].toLowerCase()];
    if (month) add(`${m[3]}-${pad(month)}-${pad(parseInt(m[2], 10))}`, toNum(m[4]));
  }
  // 날짜가 "09/25/2026" 모양으로 오는 경우
  const re2 = /\b(\d{2})\/(\d{2})\/(\d{4}) ([\d,]+\.\d+)/g;
  while ((m = re2.exec(text))) add(`${m[3]}-${m[1]}-${m[2]}`, toNum(m[4]));

  // 표가 화면용 데이터(JSON)로만 들어 있는 경우
  if (byDate.size === 0) {
    const re3 = /"rowDateTimestamp":\s*"(\d{4}-\d{2}-\d{2})[^"]*"[^{}]*?"last_close":\s*"([\d.,]+)"/g;
    while ((m = re3.exec(html))) add(m[1], toNum(m[2]));
    const re4 = /"last_close":\s*"([\d.,]+)"[^{}]*?"rowDateTimestamp":\s*"(\d{4}-\d{2}-\d{2})/g;
    while ((m = re4.exec(html))) add(m[2], toNum(m[1]));
  }

  return [...byDate.entries()].map(([date, value]) => ({ date, value })).sort((a, b) => (a.date < b.date ? -1 : 1));
}
