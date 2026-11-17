import { redirect } from "next/navigation";
import { requireUser } from "@/auth/session";
import { RiderApp } from "../rider-app";

export default async function ActAsRiderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  if (user.role === "RIDER") {
    if (user.riderId !== id) redirect("/rider");
    return <RiderApp riderId={id} mode="self" />;
  }
  return <RiderApp riderId={id} mode="staff" />;
}
