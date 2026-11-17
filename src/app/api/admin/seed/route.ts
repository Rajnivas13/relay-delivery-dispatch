import { withAuth } from "@/auth/withAuth";
import { AppError } from "@/domain/errors";
import { json } from "@/lib/http";
import { seedDatabase } from "@/lib/seed";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const POST = withAuth({ permission: "settings:write" }, async () => {
  if (process.env.ALLOW_SEED !== "true") {
    throw new AppError("FEATURE_DISABLED", "Seeding is disabled. Set ALLOW_SEED=true to enable it.");
  }
  const { zones, riders, users, jobs } = await seedDatabase({ reset: true });
  return json({ zones, riders, users, jobs });
});
