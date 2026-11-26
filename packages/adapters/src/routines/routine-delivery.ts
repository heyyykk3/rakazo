import { RoutineDeliverToSchema } from "@rakazo/contracts";
import { displayName } from "@rakazo/core";
import { readJsonColumn } from "@rakazo/db";
import { bestEffort, getLogger } from "@rakazo/logging";
import type { ExecutorDeps } from "../runs/executor/executor-deps.js";

/**
 * Delivers a completed routine's summary to an optional configured external destination
 * (such as email) when the routine produced a real user-facing reply.
 */
export async function deliverRoutineOutcome(
  deps: ExecutorDeps,
  input: {
    routineId: string;
    botName: string;
    text: string;
  },
): Promise<void> {
  const trimmed = input.text.trim();
  if (!trimmed) return;
  if (typeof deps.prisma.routine?.findUnique !== "function") return;
  const routine = await deps.prisma.routine.findUnique({
    where: { id: input.routineId },
    select: { id: true, name: true, deliverTo: true },
  });
  if (!routine?.deliverTo) return;
  const deliverTo = readJsonColumn(
    RoutineDeliverToSchema.nullable(),
    routine.deliverTo,
    { table: "Routine", column: "deliverTo", id: routine.id },
    { fallback: null },
  );
  if (!deliverTo || deliverTo.kind === "chat") return;
  if (deliverTo.kind === "email") {
    if (!deps.email) {
      getLogger().warn("routine.deliver_email_unavailable", { routineId: routine.id });
      return;
    }
    const sender = displayName(input.botName, "Bot");
    await bestEffort(
      "deliver routine summary email",
      deps.email.send({
        to: deliverTo.to,
        subject: `${sender}: ${routine.name}`,
        text: trimmed,
      }),
    );
    return;
  }
  getLogger().info("routine.deliver_channel_requested", {
    routineId: routine.id,
    provider: deliverTo.provider,
    channelId: deliverTo.channelId,
  });
}
