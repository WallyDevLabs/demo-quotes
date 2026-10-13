// Creates the separate test database (if missing) and applies the committed migrations to it.
// Run: npm run test:db. The auth tests create and delete real owners, so they must never run
// against your working database; they refuse to unless the database name ends in "_test".
import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { readFileSync, existsSync } from "node:fs";

function fromEnvFile(name) {
  if (process.env[name]) return process.env[name];
  if (!existsSync(".env")) return undefined;
  const m = readFileSync(".env", "utf8").match(new RegExp(`^${name}="?([^"\\n]+)"?`, "m"));
  return m?.[1];
}

const dev = fromEnvFile("DATABASE_URL");
const test = fromEnvFile("TEST_DATABASE_URL");
if (!dev || !test) {
  console.error("Set DATABASE_URL and TEST_DATABASE_URL in .env (see .env.example).");
  process.exit(1);
}
const dbName = new URL(test).pathname.replace(/^\//, "");
if (!/_test$/.test(dbName)) {
  console.error(`TEST_DATABASE_URL must point at a database whose name ends in "_test" (got "${dbName}").`);
  process.exit(1);
}

const admin = new PrismaClient({ datasources: { db: { url: dev } } });
const exists = await admin.$queryRawUnsafe(`SELECT 1 FROM pg_database WHERE datname = '${dbName}'`);
if (exists.length === 0) {
  await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
  console.log(`Created database ${dbName}`);
}
await admin.$disconnect();

execSync("npx prisma migrate deploy", { stdio: "inherit", env: { ...process.env, DATABASE_URL: test } });
console.log(`Test database ${dbName} is up to date.`);
