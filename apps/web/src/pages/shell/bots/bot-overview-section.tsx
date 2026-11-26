import { Trans, useLingui } from "@lingui/react/macro";
import type { Bot } from "@rakazo/contracts";
import { runStatusLabel } from "@rakazo/i18n/activity";
import { Button, Spinner } from "@rakazo/ui-web";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, FolderOpen } from "lucide-react";
import { useState } from "react";
import { rosterWorkStatusLabel } from "../../../lib/chat/roster-status";
import { formatRelativeTime } from "../../../lib/locale/relative-time";
import { useSpaceQueries } from "../../../lib/query/query";
import { statusTone } from "../../space/ActivityList";

const BOT_RECENT_RUNS_LIMIT = 5;

/**
 * Calm bot overview inside the bot panel: live working status when active, collapsible recent run
 * history (loaded only once expanded), and a direct link to this bot's files and media.
 */
export function BotOverviewSection({
  bot,
  onOpenArtifacts,
}: {
  bot: Bot;
  onOpenArtifacts?: () => void;
}) {
  const queries = useSpaceQueries();
  const [runsOpen, setRunsOpen] = useState(false);
  const workStatus = rosterWorkStatusLabel(bot.status);
  const canLoadRuns = Boolean(queries.runs?.list);

  if (!workStatus && !canLoadRuns && !onOpenArtifacts) return null;

  return (
    <div data-testid="bot-overview" className="space-y-2">
      {workStatus ? (
        <div
          role="status"
          data-testid="bot-live-status"
          className="flex items-center gap-2 rounded-xl bg-muted/60 px-3 py-2 text-body-sm font-medium text-foreground"
        >
          <span
            aria-hidden="true"
            className={`size-2 shrink-0 rounded-full ${
              bot.status === "waiting_input" || bot.status === "waiting_takeover"
                ? "bg-warning"
                : "bg-status-working"
            }`}
          />
          <span className="truncate">{workStatus}</span>
        </div>
      ) : null}
      {canLoadRuns ? (
        <div>
          <button
            type="button"
            aria-expanded={runsOpen}
            onClick={() => setRunsOpen((open) => !open)}
            className="flex w-full items-center justify-between gap-2 rounded-lg px-1 py-1.5 text-body-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span>
              <Trans>Recent runs</Trans>
            </span>
            <ChevronDown
              aria-hidden="true"
              className={`size-3.5 transition-transform ${runsOpen ? "rotate-180" : ""}`}
            />
          </button>
          {runsOpen ? <BotRecentRunsList botId={bot.id} /> : null}
        </div>
      ) : null}
      {onOpenArtifacts ? (
        <Button
          type="button"
          variant="ghost"
          className="w-full justify-between px-1 text-body-sm font-medium text-muted-foreground hover:text-foreground"
          onClick={onOpenArtifacts}
        >
          <span className="flex items-center gap-2">
            <FolderOpen className="size-4" strokeWidth={1.75} aria-hidden="true" />
            <Trans>Files and media</Trans>
          </span>
          <ChevronRight className="size-3.5 rtl:rotate-180" aria-hidden="true" />
        </Button>
      ) : null}
    </div>
  );
}

function BotRecentRunsList({ botId }: { botId: string }) {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const activeQuery = useQuery(queries.runs.list.queryOptions({ input: { filter: "active" } }));
  const recentQuery = useQuery(queries.runs.list.queryOptions({ input: { filter: "recent" } }));
  const botRuns = [...(activeQuery.data?.runs ?? []), ...(recentQuery.data?.runs ?? [])]
    .filter((run) => run.botId === botId)
    .slice(0, BOT_RECENT_RUNS_LIMIT);
  const loadingRuns = activeQuery.isPending || recentQuery.isPending;

  return (
    <div className="mt-1 space-y-1 rounded-xl bg-muted/40 p-2">
      {loadingRuns ? (
        <div className="flex justify-center py-2">
          <Spinner aria-label={t`Loading runs…`} />
        </div>
      ) : botRuns.length === 0 ? (
        <p className="px-1.5 py-1 text-body-sm text-muted-foreground">
          <Trans>No recent runs</Trans>
        </p>
      ) : (
        botRuns.map((run) => (
          <div
            key={run.runId}
            className="flex items-baseline justify-between gap-2 rounded-lg px-2 py-1.5 text-body-sm"
          >
            <span className="min-w-0 flex-1 truncate text-foreground" dir="auto">
              {run.promptSnippet || runStatusLabel(run.status)}
            </span>
            <span className={`shrink-0 text-label ${statusTone(run.status)}`}>
              {runStatusLabel(run.status)}
            </span>
            <span className="shrink-0 text-label tabular-nums text-muted-foreground">
              {formatRelativeTime(run.updatedAt)}
            </span>
          </div>
        ))
      )}
    </div>
  );
}
