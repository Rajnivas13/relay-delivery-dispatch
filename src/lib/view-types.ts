export interface RiderLite {
  id: string;
  code: string;
  name: string;
  phone?: string | null;
}

export interface AssignmentView {
  id: string;
  jobId: string;
  riderId: string;
  status: string;
  reservedUnits: number;
  offeredAt: string;
  expiresAt: string;
  respondedAt: string | null;
  endedAt: string | null;
  endReason: string | null;
  isOverride: boolean;
  overrideReason: string | null;
  recommendedRiderId: string | null;
  score: number | null;
  assignedByName: string | null;
  assignedByType: string;
  rider: RiderLite;
}

export interface JobBase {
  id: string;
  reference: string;
  pickupZoneId: string;
  dropZoneId: string;
  loadUnits: number;
  priority: string;
  deadlineAt: string | null;
  customerName: string | null;
  notes: string | null;
  status: string;
  manualQueueReason: string | null;
  manualQueuedAt: string | null;
  currentAssignmentId: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface JobListItem extends JobBase {
  latestAssignment: AssignmentView | null;
}

export interface JobDetail extends JobBase {
  assignments: AssignmentView[];
  currentAssignment: AssignmentView | null;
}

export interface JobEventView {
  id: number;
  jobId: string;
  type: string;
  fromStatus: string | null;
  toStatus: string | null;
  actorType: string;
  actorId: string | null;
  actorName: string | null;
  assignmentId: string | null;
  details: Record<string, unknown>;
  createdAt: string;
}

export interface ScoreFactorView {
  key: string;
  label: string;
  points: number;
  max: number;
  detail: string;
}

export interface CandidateView {
  riderId: string;
  code: string;
  name: string;
  rank: number;
  finalRank: number;
  score: number;
  etaToPickupMinutes: number;
  etaTotalMinutes: number;
  freeUnitsAfter: number;
  activeJobs: number;
  maxActiveJobs: number;
  acceptProbability: number;
  breakdown: ScoreFactorView[];
  reasons: string[];
  warnings: string[];
  ai: { riderId: string; acceptProbability: number; etaMinutes: number; reason: string } | null;
}

export interface RecommendationView {
  jobId: string;
  reference: string;
  jobStatus: string;
  assignable: boolean;
  generatedAt: string;
  strategy: "AI_RERANK" | "SCORE";
  aiRequested: boolean;
  aiEnabled: boolean;
  usedFallback: boolean;
  fallbackReason: string | null;
  model: string | null;
  latencyMs: number | null;
  cached: boolean;
  summary: string | null;
  riskNote: string | null;
  recommendedRiderId: string | null;
  scoreTopRiderId: string | null;
  candidates: CandidateView[];
  ineligible: { riderId: string; code: string; name: string; reasons: string[] }[];
}

export interface Paged<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ZoneView {
  id: string;
  name: string;
}

export interface RiderView {
  id: string;
  code: string;
  name: string;
  phone: string | null;
  availability: string;
  currentZoneId: string;
  zoneIds: string[];
  capacityUnits: number;
  reservedUnits: number;
  freeUnits: number;
  activeJobCount: number;
  maxActiveJobs: number;
  offersReceived: number;
  offersAccepted: number;
  version: number;
  user: { id: string; email: string } | null;
  assignments: (AssignmentView & {
    job: Pick<JobBase, "id" | "reference" | "status" | "pickupZoneId" | "dropZoneId" | "loadUnits" | "priority" | "deadlineAt">;
  })[];
}

export interface DashboardSummary {
  now: string;
  timeoutSeconds: number;
  clockOffsetSeconds: number;
  lastSweep: { at: string; source: string | null; expired: number | null } | null;
  kpis: {
    totalReceived: number;
    awaitingAssignment: number;
    awaitingConfirmation: number;
    inProgress: number;
    manualQueue: number;
    delivered: number;
    cancelled: number;
  };
  statusCounts: Record<string, number>;
  zones: { zoneId: string; active: number; waiting: number }[];
  riders: { online: number; total: number; onlineFreeUnits: number };
  attention: {
    expiringSoon: {
      assignmentId: string;
      jobId: string;
      reference: string;
      priority: string;
      riderCode: string;
      riderName: string;
      expiresAt: string;
      secondsLeft: number;
    }[];
    deadlineRisk: { id: string; reference: string; status: string; deadlineAt: string; priority: string; minutesLeft: number }[];
    staleReady: { id: string; reference: string; createdAt: string; priority: string; waitingMinutes: number }[];
    manualQueue: { id: string; reference: string; manualQueueReason: string | null; manualQueuedAt: string | null; priority: string; waitingMinutes: number }[];
  };
}
