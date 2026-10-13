import { Prisma } from "@prisma/client";
import { clientSchema, projectSchema, type ClientInput, type ProjectInput } from "@/domain/schemas";
import { dateFromDb, dateToDb } from "./convert";
import { audit } from "./audit";
import { db } from "./db";
import { ServiceError } from "./errors";

export interface ClientDTO {
  id: string;
  name: string;
  code: string;
  contactPerson: string;
  email: string;
  phone: string;
  address: string;
  companyName: string;
  registrationNumber: string;
  vatNumber: string;
  notes: string;
  archived: boolean;
  projectCount: number;
}

export interface ProjectDTO {
  id: string;
  clientId: string;
  clientName: string;
  name: string;
  code: string;
  description: string;
  status: string;
  deadline: string;
  estimateCount: number;
}

const s = (v: string | null | undefined) => v ?? "";

function codeConflict(e: unknown): never | void {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
    throw new ServiceError("That code is already in use.", [{ path: "code", message: "Already used. Pick a different code." }]);
  }
}

function toClientDTO(c: Prisma.ClientGetPayload<{ include: { _count: { select: { projects: true } } } }>): ClientDTO {
  return {
    id: c.id,
    name: c.name,
    code: s(c.code),
    contactPerson: s(c.contactPerson),
    email: s(c.email),
    phone: s(c.phone),
    address: s(c.address),
    companyName: s(c.companyName),
    registrationNumber: s(c.registrationNumber),
    vatNumber: s(c.vatNumber),
    notes: s(c.notes),
    archived: c.archivedAt !== null,
    projectCount: c._count.projects,
  };
}

const withCount = { _count: { select: { projects: true } } } as const;

export async function listClients(ownerId: string, includeArchived = false): Promise<ClientDTO[]> {
  const rows = await db.client.findMany({
    where: { ownerId, ...(includeArchived ? {} : { archivedAt: null }) },
    include: withCount,
    orderBy: { name: "asc" },
  });
  return rows.map(toClientDTO);
}

export async function getClient(ownerId: string, id: string): Promise<ClientDTO | null> {
  const c = await db.client.findFirst({ where: { id, ownerId }, include: withCount });
  return c ? toClientDTO(c) : null;
}

export async function createClient(ownerId: string, input: ClientInput): Promise<string> {
  const v = clientSchema.parse(input);
  try {
    const c = await db.client.create({ data: { ownerId, ...v } });
    return c.id;
  } catch (e) {
    codeConflict(e);
    throw e;
  }
}

export async function updateClient(ownerId: string, id: string, input: ClientInput): Promise<void> {
  const v = clientSchema.parse(input);
  try {
    const r = await db.client.updateMany({
      where: { id, ownerId },
      data: {
        name: v.name,
        code: v.code ?? null,
        contactPerson: v.contactPerson ?? null,
        email: v.email ?? null,
        phone: v.phone ?? null,
        address: v.address ?? null,
        companyName: v.companyName ?? null,
        registrationNumber: v.registrationNumber ?? null,
        vatNumber: v.vatNumber ?? null,
        notes: v.notes ?? null,
      },
    });
    if (r.count === 0) throw new ServiceError("Client not found.");
  } catch (e) {
    codeConflict(e);
    throw e;
  }
}

/** CLI2: a client is archived, never deleted. */
export async function setClientArchived(ownerId: string, id: string, archived: boolean): Promise<void> {
  await db.$transaction(async (tx) => {
    const r = await tx.client.updateMany({ where: { id, ownerId }, data: { archivedAt: archived ? new Date() : null } });
    if (r.count === 0) throw new ServiceError("Client not found.");
    await audit(tx, ownerId, "client", id, archived ? "archive" : "unarchive");
  });
}

function toProjectDTO(
  p: Prisma.ProjectGetPayload<{ include: { client: { select: { name: true } }; _count: { select: { estimates: true } } } }>,
): ProjectDTO {
  return {
    id: p.id,
    clientId: p.clientId,
    clientName: p.client.name,
    name: p.name,
    code: s(p.code),
    description: s(p.description),
    status: p.status,
    deadline: dateFromDb(p.deadline) ?? "",
    estimateCount: p._count.estimates,
  };
}
const projectInclude = { client: { select: { name: true } }, _count: { select: { estimates: true } } } as const;

export async function listProjects(ownerId: string): Promise<ProjectDTO[]> {
  const rows = await db.project.findMany({ where: { ownerId }, include: projectInclude, orderBy: { createdAt: "desc" } });
  return rows.map(toProjectDTO);
}

export async function getProject(ownerId: string, id: string): Promise<ProjectDTO | null> {
  const p = await db.project.findFirst({ where: { id, ownerId }, include: projectInclude });
  return p ? toProjectDTO(p) : null;
}

async function assertOwnsClient(ownerId: string, clientId: string) {
  const c = await db.client.findFirst({ where: { id: clientId, ownerId, archivedAt: null }, select: { id: true } });
  if (!c) throw new ServiceError("Choose an active client.", [{ path: "clientId", message: "Choose an active client" }]);
}

export async function createProject(ownerId: string, input: ProjectInput): Promise<string> {
  const v = projectSchema.parse(input);
  await assertOwnsClient(ownerId, v.clientId);
  try {
    const p = await db.project.create({
      data: { ownerId, clientId: v.clientId, name: v.name, code: v.code ?? null, description: v.description ?? null, status: v.status, deadline: dateToDb(v.deadline) },
    });
    return p.id;
  } catch (e) {
    codeConflict(e);
    throw e;
  }
}

export async function updateProject(ownerId: string, id: string, input: ProjectInput): Promise<void> {
  const v = projectSchema.parse(input);
  await assertOwnsClient(ownerId, v.clientId);
  try {
    await db.$transaction(async (tx) => {
      const before = await tx.project.findFirst({ where: { id, ownerId }, select: { status: true } });
      if (!before) throw new ServiceError("Project not found.");
      await tx.project.update({
        where: { id },
        data: { clientId: v.clientId, name: v.name, code: v.code ?? null, description: v.description ?? null, status: v.status, deadline: dateToDb(v.deadline) },
      });
      if (before.status !== v.status) await audit(tx, ownerId, "project", id, "status.change", { from: before.status, to: v.status });
    });
  } catch (e) {
    codeConflict(e);
    throw e;
  }
}
