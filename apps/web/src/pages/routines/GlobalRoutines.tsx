import { Trans, useLingui } from "@lingui/react/macro";
import type { Bot, Routine } from "@rakazo/contracts";
import { ROUTINE_MENTION_BATCH_MAX } from "@rakazo/contracts";
import { cronLabels } from "@rakazo/i18n/cron";
import {
  BotAvatar,
  Button,
  buttonVariants,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  OptionSelect,
  Spinner,
  Switch,
} from "@rakazo/ui-web";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Play, Repeat } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { IconTooltip } from "../../components/IconTooltip";
import { WindowChrome } from "../../components/WindowChrome";
import { takeInitialBootstrap } from "../../lib/bootstrap";
import { formatRelativeTime } from "../../lib/locale/relative-time";
import { desktopBridge } from "../../lib/platform/desktop";
import { useSave, useSpaceQueries } from "../../lib/query/query";
import { useSpaceRpc } from "../../lib/query/space-rpc";
import { errorText } from "../../lib/query/user-error";
import { routineTriggerSummary } from "./RoutineList";

const NO_BOTS: Bot[] = [];

type StatusFilter = "all" | "active" | "paused";

/** All routines across the Space's bots, with status, next/last run, pause toggle, and Run now. */
export function GlobalRoutinesPage() {
  const { t, i18n } = useLingui();
  const navigate = useNavigate();
  const queries = useSpaceQueries();
  const rpc = useSpaceRpc();
  const queryClient = useQueryClient();
  const [botFilter, setBotFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const botsQuery = useQuery({
    queryKey: queries.bootstrap.queryKey({ input: {} }),
    queryFn: () => takeInitialBootstrap(),
    select: (bootstrap) => bootstrap.bots,
  });
  const bots = botsQuery.data ?? NO_BOTS;
  const botIds = useMemo(() => bots.filter((bot) => !bot.archivedAt).map((bot) => bot.id), [bots]);
  const botsById = useMemo(() => new Map(bots.map((bot) => [bot.id, bot])), [bots]);

  const routinesQueryKey = ["space-routines-all", ...botIds] as const;
  const routinesQuery = useQuery({
    queryKey: routinesQueryKey,
    enabled: botIds.length > 0,
    queryFn: async () => {
      const results: Routine[] = [];
      for (let i = 0; i < botIds.length; i += ROUTINE_MENTION_BATCH_MAX) {
        const batch = botIds.slice(i, i + ROUTINE_MENTION_BATCH_MAX);
        const groups = await rpc.routines.listForMentions({ botIds: batch });
        for (const group of groups) results.push(...group.routines);
      }
      return results;
    },
  });

  const toggleActive = useSave({
    save: async (input: { routine: Routine; active: boolean }, client) => {
      const updated = await client.routines.update({
        routineId: input.routine.id,
        active: input.active,
      });
      queryClient.setQueryData<Routine[]>(routinesQueryKey, (current) =>
        current?.map((entry) => (entry.id === updated.id ? updated : entry)),
      );
      return updated;
    },
    stale: [routinesQueryKey],
  });

  const runNow = useSave({
    save: async (routine: Routine, client) => client.routines.testRun({ routineId: routine.id }),
    stale: [routinesQueryKey],
    onSaved: (result, routine) => {
      navigate(result.groupId ? `/app/g/${result.groupId}` : `/app/${routine.botId}`);
    },
  });

  const routines = routinesQuery.data ?? [];
  const visible = useMemo(() => {
    const filtered = routines.filter((routine) => {
      if (botFilter !== "all" && routine.botId !== botFilter) return false;
      if (statusFilter === "active" && !routine.active) return false;
      if (statusFilter === "paused" && routine.active) return false;
      return true;
    });
    return filtered.sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1;
      const nextA = a.nextRunAt ? Date.parse(a.nextRunAt) : Number.POSITIVE_INFINITY;
      const nextB = b.nextRunAt ? Date.parse(b.nextRunAt) : Number.POSITIVE_INFINITY;
      return nextA - nextB || a.name.localeCompare(b.name);
    });
  }, [routines, botFilter, statusFilter]);

  const labels = cronLabels();
  const actionError = toggleActive.error ?? runNow.error;

  return (
    <div className="flex h-full min-w-0 flex-col bg-background text-foreground/90">
      <header className="app-drag flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-3">
        {desktopBridge() ? <WindowChrome /> : null}
        <div className="flex min-w-fit flex-1 items-center gap-1">
          <IconTooltip label={t`Back`}>
            <Link
              to="/app"
              aria-label={t`Back`}
              className={buttonVariants({
                variant: "ghost",
                size: "icon",
                className: "app-no-drag text-muted-foreground",
              })}
            >
              <ChevronLeft />
            </Link>
          </IconTooltip>
          <h1 className="font-medium text-foreground">
            <Trans>Routines</Trans>
          </h1>
        </div>
        {routines.length > 0 ? (
          <div className="app-no-drag flex flex-wrap items-center gap-2">
            {bots.length > 1 ? (
              <OptionSelect
                aria-label={t`Filter by bot`}
                className="w-fit"
                value={botFilter}
                onValueChange={setBotFilter}
                options={[
                  { value: "all", label: t`All bots` },
                  ...bots
                    .filter((bot) => !bot.archivedAt)
                    .map((bot) => ({ value: bot.id, label: bot.name })),
                ]}
              />
            ) : null}
            <OptionSelect
              aria-label={t`Filter by status`}
              className="w-fit"
              value={statusFilter}
              onValueChange={(value) => setStatusFilter(value as StatusFilter)}
              options={[
                { value: "all", label: t`All routines` },
                { value: "active", label: t`Active` },
                { value: "paused", label: t`Paused` },
              ]}
            />
          </div>
        ) : null}
      </header>

      {actionError ? (
        <p role="alert" className="px-6 py-2 text-body-sm text-destructive">
          {errorText(actionError, t`Could not update routine.`)}
        </p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {routinesQuery.isPending && botIds.length > 0 ? (
          <div className="grid h-40 place-items-center text-muted-foreground">
            <Spinner aria-label={t`Loading routines…`} />
          </div>
        ) : routinesQuery.isError ? (
          <p role="alert" className="text-body text-destructive">
            {errorText(routinesQuery.error, t`Could not load routines.`)}
          </p>
        ) : visible.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Repeat />
              </EmptyMedia>
              <EmptyTitle>
                {routines.length === 0 ? (
                  <Trans>No routines yet</Trans>
                ) : (
                  <Trans>No matching routines</Trans>
                )}
              </EmptyTitle>
              <EmptyDescription>
                <Trans>
                  Ask any bot to check something on a schedule, or create a routine from its panel.
                </Trans>
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul
            data-testid="global-routines-list"
            className="mx-auto max-w-3xl divide-y divide-border overflow-hidden rounded-xl border border-border"
          >
            {visible.map((routine) => {
              const bot = botsById.get(routine.botId);
              const trigger = routineTriggerSummary(routine, labels, i18n.locale);
              const running = runNow.pending && runNow.input?.id === routine.id;
              return (
                <li
                  key={routine.id}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-accent/40"
                >
                  <button
                    type="button"
                    onClick={() => navigate(`/app/${routine.botId}?routine=${routine.id}`)}
                    className="flex min-w-0 flex-1 items-center gap-3 text-start focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    {bot ? (
                      <BotAvatar
                        avatarSet={bot.avatarSet}
                        color={bot.color}
                        identity={bot.id}
                        size={32}
                        status={bot.status}
                      />
                    ) : null}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="truncate text-body font-medium text-foreground" dir="auto">
                          {routine.name}
                        </span>
                        {bot ? (
                          <span className="shrink-0 text-label text-muted-foreground">
                            {bot.name}
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-0.5 truncate text-body-sm text-muted-foreground">
                        {trigger}
                      </div>
                      <div className="mt-0.5 flex flex-wrap gap-x-3 text-caption text-muted-foreground/80">
                        {routine.lastRunAt ? (
                          <span>
                            <Trans>Last run {formatRelativeTime(routine.lastRunAt)}</Trans>
                          </span>
                        ) : null}
                        {routine.active && routine.nextRunAt ? (
                          <span>
                            <Trans>Next {formatRelativeTime(routine.nextRunAt)}</Trans>
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </button>
                  <div className="flex shrink-0 items-center gap-2">
                    <IconTooltip label={t`Run now`}>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t`Run ${routine.name} now`}
                        disabled={running}
                        onClick={() => runNow.run(routine)}
                      >
                        <Play className="size-3.5" aria-hidden="true" />
                      </Button>
                    </IconTooltip>
                    <Switch
                      checked={routine.active}
                      aria-label={
                        routine.active ? t`Pause ${routine.name}` : t`Resume ${routine.name}`
                      }
                      disabled={
                        toggleActive.pending && toggleActive.input?.routine.id === routine.id
                      }
                      onCheckedChange={(active) => toggleActive.run({ routine, active })}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
