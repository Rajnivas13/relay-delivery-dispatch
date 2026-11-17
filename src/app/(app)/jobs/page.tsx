import { Suspense } from "react";
import { Skeleton } from "@/components/ui";
import { JobsView } from "./jobs-view";

export default function JobsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <JobsView />
    </Suspense>
  );
}
