import { redirect } from "next/navigation";
import { SetupForm } from "@/components/auth-forms";
import { Banner } from "@/components/ui";
import { ownerExists } from "@/server/auth/service";

export const metadata = { title: "Create your account" };

export default async function SetupPage() {
  if (await ownerExists()) redirect("/login");
  const prod = process.env.NODE_ENV === "production";
  const disabled = prod && !process.env.SETUP_TOKEN;
  return (
    <>
      <h1 className="mb-1 text-xl font-semibold tracking-tight">Create your account</h1>
      <p className="mb-4 text-sm text-ink-muted">
        This tool is for one owner. You will set a password, then turn on two-factor authentication with an authenticator app. Any data already on this machine stays yours.
      </p>
      {disabled ? (
        <Banner tone="caution">Setup is switched off. Set the SETUP_TOKEN environment variable on the server, then reload this page.</Banner>
      ) : (
        <SetupForm tokenRequired={prod} />
      )}
    </>
  );
}
