import { PinForm } from "@/components/auth-forms";
import { requireOwnerId } from "@/server/owner";

export const metadata = { title: "Choose a PIN" };

export default async function PinPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  await requireOwnerId();
  const { next } = await searchParams;
  return (
    <>
      <h1 className="mb-1 text-xl font-semibold tracking-tight">Choose a 4 digit PIN</h1>
      <p className="mb-4 text-sm text-ink-muted">
        This browser will be trusted: from now on you sign in here with the PIN and are not asked for an authenticator code. A new device still needs your password and a code.
      </p>
      <PinForm firstTime next={next} />
    </>
  );
}
