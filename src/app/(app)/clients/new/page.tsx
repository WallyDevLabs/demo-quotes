import { ClientForm } from "@/components/client-project-forms";

export const metadata = { title: "New client" };

export default function NewClientPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">New client</h1>
      <ClientForm />
    </div>
  );
}
