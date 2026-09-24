import { sleep } from "workflow";
import { advanceAutomaticJob } from "@/services/arca/automaticJob";
import prisma from "@/lib/prisma";

async function advance(jobId: number) {
  "use step";
  const job = await advanceAutomaticJob(jobId);
  return { status: job?.status ?? "error", retryCount: job?.retryCount ?? 0 };
}

async function expire(jobId: number) {
  "use step";
  await prisma.arcaConnectionJob.updateMany({
    where: { id: jobId, status: { in: ["pending", "running", "waiting"] } },
    data: {
      status: "requires_action",
      passwordEncrypted: null,
      lastError: "La conexión tardó demasiado. Podés retomarla desde este paso.",
    },
  });
}

export async function connectArcaWorkflow(jobId: number) {
  "use workflow";
  // Each iteration is an observable, retryable step. The browser only reads progress.
  for (let i = 0; i < 150; i++) {
    const state = await advance(jobId);
    if (["completed", "error", "requires_action"].includes(state.status)) return;
    await sleep(state.retryCount ? "15s" : "5s");
  }
  await expire(jobId);
}
