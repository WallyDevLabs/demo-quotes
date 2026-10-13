import { listDevicesAction } from "@/app/auth-actions";
import { AccountPanel, DevicesCard } from "@/components/auth-forms";
import { Badge, Banner, Card } from "@/components/ui";
import { db } from "@/server/db";
import { getSession, requireOwnerId } from "@/server/owner";

export const metadata = { title: "Account" };

export default async function AccountPage() {
  const userId = await requireOwnerId();
  const [session, user] = await Promise.all([getSession(), db.user.findUniqueOrThrow({ where: { id: userId }, select: { recoveryCodeHashes: true, totpEnabledAt: true, pinHash: true } })]);
  const left = user.recoveryCodeHashes.length;
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Account</h1>
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">Signed in as</div>
            <div className="font-semibold">{session?.email}</div>
          </div>
          <Badge tone="profit">Two-factor on</Badge>
        </div>
        <p className="mt-2 text-sm text-ink-muted">Recovery codes left: <span className="money font-semibold">{left}</span> of 8.</p>
        {left <= 2 && (
          <div className="mt-2">
            <Banner tone="caution">You are running low on recovery codes. Keep at least one safe in case you lose your phone.</Banner>
          </div>
        )}
      </Card>
      <DevicesCard hasPin={!!user.pinHash} devices={await listDevicesAction()} />
      <AccountPanel />
    </div>
  );
}
