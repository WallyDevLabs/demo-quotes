// Local development Postgres without Docker. Run: npm run db:local
// Data lives in .local/pg (git-ignored). Matches DATABASE_URL in .env.example.
import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";

const dir = ".local/pg";
const pg = new EmbeddedPostgres({
  databaseDir: dir,
  user: "codequote",
  password: "codequote",
  port: 54329,
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
  persistent: true,
});

if (!existsSync(`${dir}/PG_VERSION`)) await pg.initialise();
await pg.start();
try {
  await pg.createDatabase("codequote");
} catch {
  /* already exists */
}
console.log("Postgres ready on postgresql://codequote:codequote@localhost:54329/codequote");

const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
setInterval(() => {}, 1 << 30);
