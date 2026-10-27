// Builds one .ics calendar per feed in feeds.json from NutriSlice's public menu API.
// Usage: node build.mjs [outDir]   (default outDir: public)
import { readFile, writeFile, mkdir } from "node:fs/promises";

const OUT_DIR = process.argv[2] || "public";
const config = JSON.parse(await readFile(new URL("./feeds.json", import.meta.url), "utf8"));

// Sections left out of the event entirely (matched against the section name).
const SKIP_SECTIONS = [/milk/i, /condiment/i];
// Individual items left out (milk, condiments).
const SKIP_ITEMS = [/milk\b/i, /^(ketchup|mustard|mayo|ranch|bbq sauce)$/i];

const MENU_EMOJI = { lunch: "🍽", breakfast: "🥞", snack: "🍎" };

function apiUrl(district, school, menuType, date) {
  const [y, m, d] = date.split("-");
  return `https://${district}.api.nutrislice.com/menu/api/weeks/school/${school}/menu-type/${menuType}/${y}/${m}/${d}/?format=json`;
}

function todayIn(tz) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date()); // YYYY-MM-DD
}

function addDays(date, n) {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function titleCase(s) {
  // Only touch ALL-CAPS section names like "DAILY SPECIAL"; leave mixed case alone.
  if (s !== s.toUpperCase()) return s;
  return s.toLowerCase().replace(/(^|[\s\-/(])([a-z])/g, (_, p, c) => p + c.toUpperCase());
}

async function fetchWeek(district, school, menuType, date) {
  const res = await fetch(apiUrl(district, school, menuType, date), {
    headers: { "User-Agent": "nutrislice-calendar (personal family calendar feed)" },
  });
  if (!res.ok) throw new Error(`${school} ${date}: HTTP ${res.status}`);
  return res.json();
}

// Turns one day's menu_items into { notes, sections: [{ name, items }] }.
function parseDay(menuItems) {
  const sections = [];
  const notes = [];
  let current = null;
  for (const m of menuItems) {
    if (m.is_section_title) {
      current = { name: titleCase((m.text || "").trim()), items: [] };
      sections.push(current);
      continue;
    }
    const name = (m.food?.name || m.text || "").trim();
    if (!name) continue;
    if (!current) {
      current = { name: "", items: [] };
      sections.push(current);
    }
    current.items.push(name);
  }
  // A section heading with nothing under it is a note for the day ("Holiday Sidekick Day").
  const kept = [];
  for (const s of sections) {
    if (s.items.length === 0) {
      if (s.name) notes.push(s.name);
      continue;
    }
    if (SKIP_SECTIONS.some((re) => re.test(s.name))) continue;
    s.items = s.items.filter((i) => !SKIP_ITEMS.some((re) => re.test(i)));
    if (s.items.length) kept.push(s);
  }
  return { notes, sections: kept };
}

function buildEvent(feedKey, feed, menuType, date, { notes, sections }) {
  const label = [feed.schoolName, titleCase(menuType.toUpperCase())].filter(Boolean).join(" ");
  const emoji = MENU_EMOJI[menuType] || "🍽";
  const prefix = feed.eventPrefix || `${emoji} ${label}`;
  const allItems = sections.flatMap((s) => s.items);

  let summary;
  // Days like "No School" come through as a lone item with no section.
  if (sections.length === 1 && !sections[0].name && allItems.length === 1) {
    summary = `${prefix}: ${allItems[0]}`;
  } else {
    const headline = sections[0].items.join(" / ");
    summary = `${prefix}${notes.length ? ` (${notes.join(", ")})` : ""}: ${headline}`;
  }

  const description = [
    ...notes,
    ...sections.map((s) => (s.name ? `${s.name}: ${s.items.join(", ")}` : s.items.join(", "))),
  ].join("\n");

  return { uid: `${feedKey}-${date}@nutrislice-calendar`, date, summary, description };
}

function escapeText(s) {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

// RFC 5545 line folding: lines over 75 octets continue on the next line after a space.
function fold(line) {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const parts = [];
  let chunk = "";
  let len = 0;
  for (const ch of line) {
    const n = Buffer.byteLength(ch, "utf8");
    if (len + n > (parts.length ? 74 : 75)) {
      parts.push(chunk);
      chunk = "";
      len = 0;
    }
    chunk += ch;
    len += n;
  }
  parts.push(chunk);
  return parts.join("\r\n ");
}

function toIcs(calName, tz, events) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//nutrislice-calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(calName)}`,
    `X-WR-TIMEZONE:${tz}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT6H",
    "X-PUBLISHED-TTL:PT6H",
  ];
  for (const e of events) {
    const d = e.date.replace(/-/g, "");
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.uid}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${d}`,
      `DTEND;VALUE=DATE:${addDays(e.date, 1).replace(/-/g, "")}`,
      `SUMMARY:${escapeText(e.summary)}`,
      `DESCRIPTION:${escapeText(e.description)}`,
      "TRANSP:TRANSPARENT",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

async function buildFeed(feedKey, feed) {
  const district = feed.district || config.district;
  const tz = feed.timezone || config.timezone;
  const menuType = feed.menuType || "lunch";
  const today = todayIn(tz);

  const weekStarts = [];
  for (let w = -(config.weeksBack ?? 1); w <= (config.weeksAhead ?? 5); w++) weekStarts.push(addDays(today, w * 7));

  const days = new Map();
  for (const start of weekStarts) {
    const week = await fetchWeek(district, feed.school, menuType, start);
    for (const day of week.days || []) {
      if (day.menu_items?.length) days.set(day.date, day.menu_items);
    }
  }

  const events = [...days.keys()]
    .sort()
    .map((date) => ({ date, parsed: parseDay(days.get(date)) }))
    .filter(({ parsed }) => parsed.sections.length)
    .map(({ date, parsed }) => buildEvent(feedKey, feed, menuType, date, parsed));

  const calName = feed.calendarName || `${feed.schoolName ? feed.schoolName + " " : "School "}${titleCase(menuType.toUpperCase())}`;
  await writeFile(`${OUT_DIR}/${feedKey}.ics`, toIcs(calName, tz, events));
  console.log(`${feedKey}.ics: ${events.length} days (${calName})`);
  return { feedKey, calName };
}

await mkdir(OUT_DIR, { recursive: true });
const built = [];
let failed = 0;
for (const [key, feed] of Object.entries(config.feeds)) {
  if (!/^[a-z0-9-]+$/i.test(key)) throw new Error(`Feed name "${key}" may only use letters, numbers and dashes`);
  try {
    built.push(await buildFeed(key, feed));
  } catch (err) {
    failed++;
    console.error(`${key}: ${err.message}`);
  }
}

await writeFile(
  `${OUT_DIR}/index.html`,
  `<!doctype html><meta charset="utf-8"><title>School menu calendars</title>
<h1>School menu calendars</h1><ul>
${built.map((b) => `<li><a href="${b.feedKey}.ics">${b.calName}</a> — ${b.feedKey}.ics</li>`).join("\n")}
</ul><p>Updated ${new Date().toISOString()}</p>\n`,
);

// Fail the run (so GitHub keeps the last good calendars) if any feed broke.
if (failed) process.exit(1);
