import { readFileSync, writeFileSync } from "node:fs";

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars");
  process.exit(1);
}

async function countRows(table, filter) {
  const url = new URL(`/rest/v1/${table}`, SUPABASE_URL);
  url.searchParams.set("select", "*");
  if (filter) url.searchParams.set(filter.col, filter.val);

  const res = await fetch(url, {
    method: "HEAD",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      Prefer: "count=exact",
    },
  });
  if (!res.ok) {
    throw new Error(`${table} query failed: ${res.status}`);
  }
  const range = res.headers.get("content-range");
  const total = range ? Number(range.split("/")[1]) : 0;
  if (!Number.isFinite(total)) {
    throw new Error(`${table} returned invalid count: ${range}`);
  }
  return total;
}

const userCount = await countRows("profiles");
const matchesCompleted = await countRows("matches", {
  col: "ended_at",
  val: "not.is.null",
});

const fmt = (n) => Number(n).toLocaleString("en-US");
const date = new Date().toISOString().slice(0, 10);

const block = [
  "<!-- USER_COUNT_START -->",
  `**${fmt(userCount)}** users | **${fmt(matchesCompleted)}** matches completed`,
  "",
  `*Last updated: ${date}*`,
  "<!-- USER_COUNT_END -->",
].join("\n");

const readmePath = new URL("../README.md", import.meta.url).pathname;
const readme = readFileSync(readmePath, "utf-8");

const updated = readme.replace(
  /<!-- USER_COUNT_START -->[\s\S]*?<!-- USER_COUNT_END -->/,
  block,
);

if (updated === readme) {
  console.log("README already up to date");
  process.exit(0);
}

writeFileSync(readmePath, updated);
console.log(`README updated: ${fmt(userCount)} users, ${fmt(matchesCompleted)} matches`);
