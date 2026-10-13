// Creates the end-to-end database (if missing) and applies the committed migrations to it.
// Its name must end in "_e2e": the end-to-end run wipes it clean before every run.
// Run: npm run e2e:db (the e2e script does this for you).
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

function fromEnvFile(name) {
  if (process.env[name]) return process.env[name];
  if (!existsSync(".env")) return undefined;
  const m = readFileSync(".env", "utf8").match(new RegExp(`^${name}="?([^"\\n]+)"?`, "m"));
  return m?.[1];
}

const admin = fromEnvFile("DATABASE_URL");
const e2e = fromEnvFile("E2E_DATABASE_URL");
if (!admin || !e2e) {
  console.error("Set DATABASE_URL and E2E_DATABASE_URL in .env (see .env.example).");
  process.exit(1);
}
const dbName = new URL(e2e).pathname.replace(/^\//, "");
if (!/_e2e$/.test(dbName)) {
  console.error(`E2E_DATABASE_URL must point at a database whose name ends in "_e2e" (got "${dbName}").`);
  process.exit(1);
}

const client = new PrismaClient({ datasources: { db: { url: admin } } });
const exists = await client.$queryRawUnsafe(`SELECT 1 FROM pg_database WHERE datname = '${dbName}'`);
if (exists.length === 0) {
  await client.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
  console.log(`Created database ${dbName}`);
}
await client.$disconnect();

execSync("npx prisma migrate deploy", { stdio: "inherit", env: { ...process.env, DATABASE_URL: e2e } });
console.log(`End-to-end database ${dbName} is up to date.`);
