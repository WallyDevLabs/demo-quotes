import QRCode from "qrcode";
import { redirect } from "next/navigation";
import { EnrollForm, FinishEnrollment } from "@/components/auth-forms";
import { Banner } from "@/components/ui";
import { beginEnrollment, isEnrolled } from "@/server/auth/service";
import { getSession } from "@/server/owner";

export const metadata = { title: "Turn on two-factor" };

export default async function EnrollPage() {
  const s = await getSession();
  if (!s) redirect("/login");
  if (s.stage === "full") redirect("/");
  if (await isEnrolled(s.userId)) {
    // Confirmed already (for example the page was reloaded before pressing Continue).
    return (
      <>
        <h1 className="mb-3 text-xl font-semibold tracking-tight">Two-factor authentication is on</h1>
        <div className="mb-4">
          <Banner tone="caution">Recovery codes are shown only once. If you did not save them, you can generate new ones from your Account page after you continue.</Banner>
        </div>
        <FinishEnrollment />
      </>
    );
  }
  const { secret, uri } = await beginEnrollment(s.userId);
  const qr = await QRCode.toDataURL(uri, { margin: 1, width: 352, errorCorrectionLevel: "M" });
  return (
    <>
      <h1 className="mb-1 text-xl font-semibold tracking-tight">Turn on two-factor authentication</h1>
      <p className="mb-4 text-sm text-ink-muted">Required: your clients&apos; financial details are protected by a code from your phone as well as your password.</p>
      <EnrollForm qr={qr} secret={secret} />
    </>
  );
}
