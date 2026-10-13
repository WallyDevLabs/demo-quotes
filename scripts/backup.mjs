// Takes a backup of the database into ./backups and keeps the newest 14.
// Run: npm run backup            (set BACKUP_KEEP to keep a different number)
//
// The dump contains client personal information (POPIA). Treat it like the database itself: copy it to
// storage you control (encrypted), never to a shared folder or an email. Your hosting provider's own
// automated daily backups are the main safety net; this is a second, independent copy you hold.
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dump, fromEnvFile, resolveMode } from "./lib/pg-tools.mjs";

const url = fromEnvFile("DATABASE_URL");
if (!url) {
  console.error("DATABASE_URL is not set (see .env.example).");
  process.exit(1);
}
const keep = Number(process.env.BACKUP_KEEP ?? 14);
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
mkdirSync("backups", { recursive: true });
const file = `backups/codequote-${stamp}.dump`;

const mode = resolveMode();
console.log(`Backing up (${mode} pg_dump) to ${file} ...`);
await dump(mode, url, file);

const bytes = readFileSync(file);
if (bytes.length < 1000 || bytes.subarray(0, 5).toString() !== "PGDMP") {
  rmSync(file);
  console.error("The dump looks empty or damaged, so it was deleted. Nothing was backed up.");
  process.exit(1);
}
const sha = createHash("sha256").update(bytes).digest("hex");
writeFileSync(`${file}.sha256`, `${sha}  ${file.split("/").pop()}\n`);
console.log(`Done: ${(statSync(file).size / 1024).toFixed(0)} KB, sha256 ${sha.slice(0, 16)}...`);

// Keep the newest `keep` dumps.
const dumps = readdirSync("backups").filter((f) => f.endsWith(".dump")).sort().reverse();
for (const old of dumps.slice(keep)) {
  rmSync(`backups/${old}`);
  rmSync(`backups/${old}.sha256`, { force: true });
  console.log(`Removed old backup ${old}`);
}
console.log("Next: run `npm run backup:verify` to prove this backup can be restored.");
