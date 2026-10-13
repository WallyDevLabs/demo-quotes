import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth-forms";
import { pinStatus } from "@/server/auth/pin";
import { ownerExists } from "@/server/auth/service";
import { DEVICE_COOKIE } from "@/server/auth/session";
import { getSession } from "@/server/owner";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (!(await ownerExists())) redirect("/setup");
  const s = await getSession();
  if (s?.stage === "full") redirect("/");
  if (s?.stage === "enroll") redirect("/setup/2fa");
  const { next } = await searchParams;
  // A browser that passed the authenticator code before is asked for its PIN only.
  const device = await pinStatus((await cookies()).get(DEVICE_COOKIE)?.value);
  return (
    <>
      <h1 className="mb-4 text-xl font-semibold tracking-tight">Sign in</h1>
      <LoginForm next={next} pinEmail={device?.email} />
    </>
  );
}
