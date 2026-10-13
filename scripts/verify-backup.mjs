// Proves a backup can actually be restored: restores it into a scratch database, then checks that
//  1. every table has the same row fingerprint as the live database,
//  2. every stored PDF still matches its recorded SHA-256,
//  3. the immutability triggers came back and still refuse edits,
//  4. the migration history is intact.
// An untested backup does not count. Run: npm run backup:verify [path-to-dump]
// Run it while the app is idle, so the live database is not changing during the comparison.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { fromEnvFile, plainUrl, resolveMode, restore } from "./lib/pg-tools.mjs";

const url = fromEnvFile("DATABASE_URL");
if (!url) {
  console.error("DATABASE_URL is not set (see .env.example).");
  process.exit(1);
}
const live = new URL(url).pathname.slice(1);
const scratch = `${live}_restore_check`;

let file = process.argv[2];
if (!file) {
  const dumps = readdirSync("backups").filter((f) => f.endsWith(".dump")).sort();
  if (dumps.length === 0) {
    console.error("No backups found. Run `npm run backup` first.");
    process.exit(1);
  }
  file = `backups/${dumps.at(-1)}`;
}

// The checksum recorded at backup time must still match the file on disk.
try {
  const recorded = readFileSync(`${file}.sha256`, "utf8").split(/\s+/)[0];
  const actual = createHash("sha256").update(readFileSync(file)).digest("hex");
  if (recorded !== actual) throw new Error("checksum mismatch");
  console.log("PASS  backup file matches its recorded checksum");
} catch (e) {
  console.error(`FAIL  backup file check: ${e.message}`);
  process.exit(1);
}

const admin = new PrismaClient({ datasources: { db: { url: plainUrl(url, "postgres") + "?schema=public" } } });
const restored = new PrismaClient({ datasources: { db: { url: plainUrl(url, scratch) + "?schema=public" } } });
const source = new PrismaClient({ datasources: { db: { url } } });

const failures = [];
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `: ${detail}` : ""}`);
  if (!ok) failures.push(label);
};

try {
  await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${scratch}"`);
  await admin.$executeRawUnsafe(`CREATE DATABASE "${scratch}"`);
  console.log(`Restoring ${file} into scratch database ${scratch} ...`);
  await restore(resolveMode(), url, scratch, file);

  const tables = (await source.$queryRawUnsafe(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`)).map((r) => r.tablename);
  const fingerprint = async (db, t) => {
    const r = await db.$queryRawUnsafe(`SELECT count(*)::int AS n, md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) AS h FROM "${t}" x`);
    return r[0];
  };
  let rows = 0;
  for (const t of tables) {
    const a = await fingerprint(source, t);
    const b = await fingerprint(restored, t).catch(() => ({ n: -1, h: "missing" }));
    rows += a.n;
    check(a.n === b.n && a.h === b.h, `table ${t}`, `${a.n} rows${a.h === b.h ? " identical" : ` DIFFER (restored ${b.n})`}`);
  }

  const bad = await restored.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "StoredFile" WHERE "data" IS NOT NULL AND encode(sha256("data"), 'hex') <> "sha256"`);
  const files = await restored.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "StoredFile" WHERE "data" IS NOT NULL`);
  check(bad[0].n === 0, "stored PDFs and logos match their SHA-256", `${files[0].n} files checked`);

  const expected = ["quotation_guard", "quotation_line_guard", "quotation_milestone_guard", "stored_document_guard", "invoice_guard", "invoice_ceiling_guard", "invoice_line_guard", "payment_guard"];
  const have = (await restored.$queryRawUnsafe(`SELECT tgname FROM pg_trigger WHERE NOT tgisinternal`)).map((r) => r.tgname);
  const missing = expected.filter((n) => !have.includes(n));
  check(missing.length === 0, "immutability triggers restored", missing.length ? `missing ${missing.join(", ")}` : `${expected.length} present`);

  const pay = await restored.$queryRawUnsafe(`SELECT "id" FROM "Payment" LIMIT 1`);
  if (pay.length) {
    let blocked = false;
    try {
      await restored.$executeRawUnsafe(`UPDATE "Payment" SET "amountCents" = "amountCents" + 1 WHERE "id" = '${pay[0].id}'`);
    } catch {
      blocked = true;
    }
    check(blocked, "a payment still cannot be edited in the restored database");
  } else {
    console.log("SKIP  no payments to try editing (add one and run again for the full check)");
  }

  const mig = await restored.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`);
  const migSrc = await source.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`);
  check(mig[0].n === migSrc[0].n && mig[0].n > 0, "migration history intact", `${mig[0].n} migrations`);

  console.log(`\nChecked ${tables.length} tables and ${rows} rows.`);
} catch (e) {
  failures.push("restore");
  console.error(`FAIL  ${e.message}`);
} finally {
  await restored.$disconnect().catch(() => {});
  await source.$disconnect().catch(() => {});
  await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${scratch}"`).catch(() => {});
  await admin.$disconnect().catch(() => {});
}

if (failures.length) {
  console.error(`\nRESTORE TEST FAILED (${failures.length}): ${failures.join("; ")}`);
  process.exit(1);
}
console.log("\nRESTORE TEST PASSED. This backup can be restored and matches the live database.");
