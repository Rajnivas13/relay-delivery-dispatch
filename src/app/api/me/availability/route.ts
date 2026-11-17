import { withAuth } from "@/auth/withAuth";
import { AppError } from "@/domain/errors";
import { json, parseBody } from "@/lib/http";
import { AvailabilitySchema } from "@/lib/schemas";
import { setAvailability } from "@/services/riderService";

export const dynamic = "force-dynamic";

export const PATCH = withAuth({ permission: "rider:self" }, async (req, { principal }) => {
  if (!principal.riderId) throw new AppError("CONFLICT", "This account is not linked to a rider profile");
  const { availability } = await parseBody(req, AvailabilitySchema);
  return json(await setAvailability(principal.riderId, availability));
});
