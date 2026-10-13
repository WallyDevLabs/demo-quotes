import { SettingsForms } from "@/components/settings-forms";
import { requireOwnerId } from "@/server/owner";
import { getSettings } from "@/server/settings";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const settings = await getSettings(await requireOwnerId());
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Nothing here is hard-coded. Changing a setting never alters an existing quotation or invoice, and every change is written to an audit log.
        </p>
      </div>
      <SettingsForms settings={settings} />
    </div>
  );
}
