import { withAuth } from "@/auth/withAuth";
import { AppError } from "@/domain/errors";
import { json, parseBody, parseQuery } from "@/lib/http";
import { CreateJobSchema, JobListQuerySchema } from "@/lib/schemas";
import { createJob, listJobs } from "@/services/jobService";

export const dynamic = "force-dynamic";

export const GET = withAuth({ permission: "jobs:read", lazyExpiry: true }, async (req) => {
  return json(await listJobs(parseQuery(req, JobListQuerySchema)));
});

export const POST = withAuth({ permission: "jobs:write" }, async (req, { actor }) => {
  const key = req.headers.get("idempotency-key")?.trim() || null;
  if (key && (key.length < 8 || key.length > 128)) {
    throw new AppError("VALIDATION_ERROR", "Idempotency-Key must be 8-128 characters");
  }
  const input = await parseBody(req, CreateJobSchema);
  const { job, created } = await createJob(input, actor, key);
  return json(job, {
    status: created ? 201 : 200,
    headers: created ? {} : { "Idempotent-Replayed": "true" },
  });
});
