import { PrismaClient } from "@prisma/client";

/** Wipes the end-to-end database so every run starts from a brand-new install. It refuses any other database. */
export default async function globalSetup() {
  const url = process.env.E2E_DATABASE_URL!;
  const name = new URL(url).pathname.replace(/^\//, "");
  if (!/_e2e$/.test(name)) throw new Error(`Refusing to wipe "${name}": only a database ending in _e2e is wiped.`);
  const db = new PrismaClient({ datasources: { db: { url } } });
  try {
    const tables = (await db.$queryRawUnsafe<{ tablename: string }[]>(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`)).map((t) => `"${t.tablename}"`);
    // TRUNCATE does not fire the row level guards, which is exactly what a reset needs.
    if (tables.length) await db.$executeRawUnsafe(`TRUNCATE ${tables.join(", ")} RESTART IDENTITY CASCADE`);
  } finally {
    await db.$disconnect();
  }
}
