"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { archiveClientAction, createClientAction, createProjectAction, updateClientAction, updateProjectAction } from "@/app/actions";
import { PROJECT_STATUSES } from "@/domain/schemas";
import type { ClientDTO, ProjectDTO } from "@/server/clients";
import { SaveStatus, useSave } from "./use-save";
import { Banner, Button, Card, Field, Select, TextInput, Textarea } from "./ui";

export function ClientForm({ client }: { client?: ClientDTO }) {
  const router = useRouter();
  const { state, run, retry, pending, error } = useSave();
  const [f, setF] = useState({
    name: client?.name ?? "",
    code: client?.code ?? "",
    contactPerson: client?.contactPerson ?? "",
    email: client?.email ?? "",
    phone: client?.phone ?? "",
    address: client?.address ?? "",
    companyName: client?.companyName ?? "",
    registrationNumber: client?.registrationNumber ?? "",
    vatNumber: client?.vatNumber ?? "",
    notes: client?.notes ?? "",
  });
  const [confirmArchive, setConfirmArchive] = useState(false);
  const archive = useSave();
  const t = (k: keyof typeof f, label: string, hint?: string) => (
    <Field label={label} error={error(k)} hint={hint} htmlFor={`c-${k}`}>
      <TextInput id={`c-${k}`} value={f[k]} invalid={!!error(k)} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
    </Field>
  );
  return (
    <div className="space-y-4">
      {client?.archived && <Banner tone="caution">This client is archived. Unarchive it to start new projects.</Banner>}
      <Card>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (client) run(() => updateClientAction(client.id, f));
            else run(() => createClientAction(f), ({ id }) => router.push(`/clients/${id}`));
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            {t("name", "Name")}
            {t("companyName", "Company (optional)")}
            {t("contactPerson", "Contact person")}
            {t("email", "Email")}
            {t("phone", "Phone")}
            {t("code", "Short code (optional)", "2 to 8 letters or digits. Used by the {CLIENT} numbering token.")}
            {t("registrationNumber", "Registration number (optional)")}
            {t("vatNumber", "VAT number (optional)", "Stored only. Unused until VAT mode exists.")}
            <Field label="Address" htmlFor="c-address" className="sm:col-span-2" error={error("address")}>
              <Textarea id="c-address" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} />
            </Field>
            <Field label="Notes" htmlFor="c-notes" className="sm:col-span-2" error={error("notes")}>
              <Textarea id="c-notes" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
            </Field>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
            <Button type="submit" variant="primary" disabled={pending}>
              {client ? "Save client" : "Create client"}
            </Button>
            <SaveStatus state={state} retry={retry} />
          </div>
        </form>
      </Card>

      {client && (
        <Card>
          <h2 className="text-base font-semibold">{client.archived ? "Unarchive" : "Archive"}</h2>
          <p className="mt-1 text-xs text-ink-muted">
            Clients are archived, never deleted, so their documents stay intact.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            {!confirmArchive && !client.archived && <Button variant="danger" onClick={() => setConfirmArchive(true)}>Archive client</Button>}
            {confirmArchive && (
              <>
                <Button variant="danger" disabled={archive.pending} onClick={() => archive.run(() => archiveClientAction(client.id, true), () => router.push("/clients"))}>
                  Confirm archive
                </Button>
                <Button variant="ghost" onClick={() => setConfirmArchive(false)}>Cancel</Button>
              </>
            )}
            {client.archived && (
              <Button disabled={archive.pending} onClick={() => archive.run(() => archiveClientAction(client.id, false))}>
                Unarchive
              </Button>
            )}
            <SaveStatus state={archive.state} retry={archive.retry} />
          </div>
        </Card>
      )}
    </div>
  );
}

export function ProjectForm({ project, clients, defaultClientId }: { project?: ProjectDTO; clients: { id: string; name: string }[]; defaultClientId?: string }) {
  const router = useRouter();
  const { state, run, retry, pending, error } = useSave();
  const [f, setF] = useState({
    clientId: project?.clientId ?? defaultClientId ?? "",
    name: project?.name ?? "",
    code: project?.code ?? "",
    description: project?.description ?? "",
    status: project?.status ?? "LEAD",
    deadline: project?.deadline ?? "",
  });
  return (
    <Card>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const input = { ...f, status: f.status as (typeof PROJECT_STATUSES)[number] };
          if (project) run(() => updateProjectAction(project.id, input));
          else run(() => createProjectAction(input), ({ id }) => router.push(`/projects/${id}`));
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Client" error={error("clientId")} htmlFor="p-client">
            <Select id="p-client" value={f.clientId} invalid={!!error("clientId")} onChange={(e) => setF({ ...f, clientId: e.target.value })}>
              <option value="">Choose a client…</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Project name" error={error("name")} htmlFor="p-name">
            <TextInput id="p-name" value={f.name} invalid={!!error("name")} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </Field>
          <Field label="Status" htmlFor="p-status">
            <Select id="p-status" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
              {PROJECT_STATUSES.map((s) => (
                <option key={s} value={s}>{s.replace("_", " ").toLowerCase().replace(/^./, (c) => c.toUpperCase())}</option>
              ))}
            </Select>
          </Field>
          <Field label="Deadline (optional)" error={error("deadline")} htmlFor="p-deadline">
            <TextInput id="p-deadline" type="date" value={f.deadline} invalid={!!error("deadline")} onChange={(e) => setF({ ...f, deadline: e.target.value })} />
          </Field>
          <Field label="Short code (optional)" error={error("code")} htmlFor="p-code" hint="2 to 8 letters or digits. Used by the {PRJ} numbering token.">
            <TextInput id="p-code" value={f.code} invalid={!!error("code")} onChange={(e) => setF({ ...f, code: e.target.value })} />
          </Field>
          <Field label="Description" htmlFor="p-desc" className="sm:col-span-2" error={error("description")}>
            <Textarea id="p-desc" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
          </Field>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
          <Button type="submit" variant="primary" disabled={pending}>
            {project ? "Save project" : "Create project"}
          </Button>
          <SaveStatus state={state} retry={retry} />
        </div>
      </form>
    </Card>
  );
}
