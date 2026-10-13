// Shared helpers for backup and restore verification. Uses pg_dump / pg_restore from your PATH when
// they exist, and otherwise runs them inside the local Docker database container.
import { spawn, spawnSync } from "node:child_process";
import { createReadStream, createWriteStream, existsSync, readFileSync } from "node:fs";

export function fromEnvFile(name) {
  if (process.env[name]) return process.env[name];
  if (!existsSync(".env")) return undefined;
  const m = readFileSync(".env", "utf8").match(new RegExp(`^${name}="?([^"\\n]+)"?`, "m"));
  return m?.[1];
}

/** pg_dump and psql reject Prisma's ?schema= parameter, so build a plain libpq URL. */
export function plainUrl(prismaUrl, dbName) {
  const u = new URL(prismaUrl);
  u.search = "";
  if (dbName) u.pathname = `/${dbName}`;
  return u.toString();
}

const has = (cmd) => spawnSync(cmd, ["--version"], { stdio: "ignore", shell: process.platform === "win32" }).status === 0;

function dockerDb() {
  const r = spawnSync("docker", ["compose", "ps", "--status", "running", "--services"], { encoding: "utf8", shell: process.platform === "win32" });
  return r.status === 0 && r.stdout.split(/\s+/).includes("db");
}

export function resolveMode() {
  if (has("pg_dump") && has("pg_restore")) return "local";
  if (dockerDb()) return "docker";
  throw new Error("Neither pg_dump/pg_restore on your PATH nor a running Docker database container (docker compose up -d) was found.");
}

function run(cmd, args, { stdinFile, stdoutFile } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: [stdinFile ? "pipe" : "ignore", stdoutFile ? "pipe" : "inherit", "pipe"], shell: false });
    let err = "";
    child.stderr.on("data", (d) => (err += d));
    if (stdinFile) createReadStream(stdinFile).pipe(child.stdin);
    if (stdoutFile) child.stdout.pipe(createWriteStream(stdoutFile));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited with ${code}: ${err.trim().slice(0, 600)}`))));
  });
}

/** Writes a custom-format dump (compressed, restorable table by table). */
export async function dump(mode, prismaUrl, outFile) {
  if (mode === "local") return run("pg_dump", ["--format=custom", "--no-owner", "--no-privileges", plainUrl(prismaUrl)], { stdoutFile: outFile });
  const u = new URL(prismaUrl);
  return run("docker", ["compose", "exec", "-T", "db", "pg_dump", "--format=custom", "--no-owner", "--no-privileges", "-U", decodeURIComponent(u.username), "-d", u.pathname.slice(1)], { stdoutFile: outFile });
}

/** Restores a dump into an existing (empty) database. */
export async function restore(mode, prismaUrl, dbName, file) {
  if (mode === "local") return run("pg_restore", ["--no-owner", "--no-privileges", "--exit-on-error", "-d", plainUrl(prismaUrl, dbName), file]);
  const u = new URL(prismaUrl);
  return run("docker", ["compose", "exec", "-T", "db", "pg_restore", "--no-owner", "--no-privileges", "--exit-on-error", "-U", decodeURIComponent(u.username), "-d", dbName], { stdinFile: file });
}
