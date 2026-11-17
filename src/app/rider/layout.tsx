import { requireUser } from "@/auth/session";
import { AppProvider } from "@/components/session-context";

export const dynamic = "force-dynamic";

export default async function RiderLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <AppProvider user={user}>
      <div className="flex min-h-screen justify-center bg-slate-950/40 px-3 py-6">{children}</div>
    </AppProvider>
  );
}
