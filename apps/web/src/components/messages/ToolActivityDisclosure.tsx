import { Plural, Trans } from "@lingui/react/macro";
import { ChatMarkdown } from "@rakazo/chat-ui/web";
import type { ThreadMessage } from "@rakazo/contracts";
import { formatCompactDuration } from "@rakazo/core";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@rakazo/ui-web/components/ui/collapsible";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { Fragment, useState } from "react";
import { toolStepCount } from "../../lib/chat/tool-activity-view";
import type { ArtifactTarget } from "../../lib/pages/artifact-open";
import { useArtifactImage } from "../../lib/pages/use-artifact-image";

type ToolStep = Extract<ThreadMessage["blocks"][number], { kind: "steps" }>["steps"][number];

const EXPANDABLE_STEP_LABEL_LENGTH = 48;

/** While a run is live, only the most recent steps are listed so a long run does not push the chat down. */
export const LIVE_TOOL_STEP_WINDOW = 6;

/** Lazy-loaded thumbnail for a computer/screen tool step, fetched only while the step is expanded. */
function StepScreenshotPreview({
  target,
  artifactId,
  label,
}: {
  target: ArtifactTarget | undefined;
  artifactId: string;
  label: string;
}) {
  const src = useArtifactImage(target, artifactId, Boolean(target));
  if (!target) return null;
  if (!src) {
    return (
      <div
        className="mt-1.5 h-28 w-48 animate-pulse rounded-md border border-border/60 bg-muted/60"
        data-testid="step-screenshot-loading"
      />
    );
  }
  return (
    <div className="mt-1.5" data-testid="step-screenshot">
      <img
        src={src}
        alt={label}
        loading="lazy"
        className="max-h-44 max-w-xs rounded-md border border-border/70 object-contain shadow-xs"
      />
    </div>
  );
}

export function ToolSteps({
  steps,
  currentIndex,
  limit,
  artifactTarget,
}: {
  steps: readonly ToolStep[];
  currentIndex?: number;
  /** Show only the last `limit` steps, with a count of the earlier ones above them. */
  limit?: number;
  artifactTarget?: ArtifactTarget;
}) {
  const [expandedSteps, setExpandedSteps] = useState<ReadonlySet<number>>(() => new Set());
  const hidden = limit !== undefined && steps.length > limit ? steps.length - limit : 0;
  const shown = hidden > 0 ? steps.slice(hidden) : steps;
  function toggleStep(index: number) {
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }
  return (
    <div className="space-y-0.5" data-testid="tool-rows">
      {hidden > 0 ? (
        <div className="text-label leading-5 text-muted-foreground" data-testid="tool-rows-hidden">
          <Plural value={hidden} one="+# earlier step" other="+# earlier steps" />
        </div>
      ) : null}
      {shown.map((step, offset) => {
        const index = hidden + offset;
        const isCurrent = index === currentIndex;
        const hasOutcomes = Boolean(
          step.outcomes &&
            (step.outcomes.succeeded || step.outcomes.failed || step.outcomes.stopped),
        );
        const hasScreenshot = Boolean(step.screenshotArtifactId);
        const expandable =
          step.label.length > EXPANDABLE_STEP_LABEL_LENGTH ||
          step.count > 1 ||
          hasOutcomes ||
          hasScreenshot;
        const expanded = expandable && expandedSteps.has(index);
        return (
          <Fragment key={index}>
            {step.note ? (
              <div className="py-1 text-body-sm text-foreground/75" data-testid="tool-step-note">
                <ChatMarkdown>{step.note}</ChatMarkdown>
              </div>
            ) : null}
            <div className="min-w-0">
              {expandable ? (
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => toggleStep(index)}
                  className="flex w-full min-w-0 items-start gap-2 rounded-sm text-start leading-5 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span
                    className={`shrink-0 text-label ${
                      isCurrent
                        ? "text-warning motion-safe:animate-[rkPulse_1.2s_ease-in-out_infinite]"
                        : "text-success"
                    }`}
                  >
                    {isCurrent ? "◷" : "✓"}
                  </span>
                  <span
                    className={`min-w-0 flex-1 text-body-sm ${
                      expanded ? "whitespace-pre-wrap break-words" : "truncate"
                    } ${isCurrent ? "text-foreground" : "text-muted-foreground"}`}
                    title={step.label}
                  >
                    {step.label}
                    {step.count > 1 ? ` ×${step.count}` : ""}
                  </span>
                  <ChevronRight
                    aria-hidden="true"
                    size={12}
                    strokeWidth={1.8}
                    className={`mt-1 shrink-0 text-muted-foreground/70 transition-transform ${expanded ? "rotate-90" : ""}`}
                  />
                </button>
              ) : (
                <div className="flex min-w-0 items-center gap-2 leading-5">
                  <span
                    className={`text-label ${
                      isCurrent
                        ? "text-warning motion-safe:animate-[rkPulse_1.2s_ease-in-out_infinite]"
                        : "text-success"
                    }`}
                  >
                    {isCurrent ? "◷" : "✓"}
                  </span>
                  <span
                    className={`min-w-0 flex-1 truncate text-body-sm ${
                      isCurrent ? "text-foreground" : "text-muted-foreground"
                    }`}
                    title={step.label}
                  >
                    {step.label}
                    {step.count > 1 ? ` ×${step.count}` : ""}
                  </span>
                </div>
              )}
              {expanded && hasOutcomes ? (
                <div className="flex flex-wrap gap-2 ps-5 pt-0.5 text-caption text-muted-foreground">
                  {step.outcomes?.succeeded ? (
                    <span>
                      <Trans>{step.outcomes.succeeded} succeeded</Trans>
                    </span>
                  ) : null}
                  {step.outcomes?.failed ? (
                    <span>
                      <Trans>{step.outcomes.failed} failed</Trans>
                    </span>
                  ) : null}
                  {step.outcomes?.stopped ? (
                    <span>
                      <Trans>{step.outcomes.stopped} stopped</Trans>
                    </span>
                  ) : null}
                </div>
              ) : null}
              {expanded && step.screenshotArtifactId ? (
                <div className="ps-5">
                  <StepScreenshotPreview
                    target={artifactTarget}
                    artifactId={step.screenshotArtifactId}
                    label={step.label}
                  />
                </div>
              ) : null}
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}

/**
 * The tool-activity card. It starts open while the run is live and folds when the run
 * ends. The keyed default keeps manual toggles until the run changes phase.
 */
export function ToolActivityDisclosure({
  live,
  stepCount,
  durationMs,
  children,
}: {
  live: boolean;
  stepCount: number;
  durationMs?: number;
  children: ReactNode;
}) {
  const duration = formatCompactDuration(durationMs);
  const toolCount = stepCount;
  return (
    <Collapsible
      key={live ? "working" : "actions"}
      defaultOpen={live}
      data-testid="tool-activity"
      data-live={live || undefined}
      className="group"
    >
      <CollapsibleTrigger
        className={`flex min-h-6 w-fit cursor-pointer list-none items-center gap-1 rounded-md py-0.5 pe-1.5 text-body-sm font-medium outline-none hover:text-foreground/75 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
          live ? "text-foreground/75" : "text-muted-foreground"
        }`}
      >
        <ChevronRight
          aria-hidden
          size={14}
          strokeWidth={1.8}
          className="transition-transform duration-150 group-data-panel-open:rotate-90 motion-reduce:transition-none"
        />
        <span className="flex items-center gap-2">
          <span>{live ? <Trans>Working…</Trans> : <Trans>Done</Trans>}</span>
          <span>
            <Plural value={toolCount} one="# tool" other="# tools" />
          </span>
          {!live && duration ? <span>{duration}</span> : null}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent hiddenUntilFound>
        <div className="ms-[7px] mt-0.5 border-s border-border ps-3">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * A tools-only message: a plain muted line between messages, not a chat bubble.
 */
export function StandaloneToolActivity({
  live,
  steps,
  stepCount,
  durationMs,
  artifactTarget,
}: {
  live: boolean;
  steps: readonly ToolStep[];
  stepCount: number;
  durationMs?: number;
  artifactTarget?: ArtifactTarget;
}) {
  return (
    <div className="flex justify-start" dir="ltr" data-testid="tool-activity-line">
      <div className="max-w-full min-w-0 ps-1">
        <ToolActivityDisclosure live={live} stepCount={stepCount} durationMs={durationMs}>
          <ToolSteps
            steps={steps}
            currentIndex={live ? steps.length - 1 : undefined}
            limit={live ? LIVE_TOOL_STEP_WINDOW : undefined}
            artifactTarget={artifactTarget}
          />
        </ToolActivityDisclosure>
      </div>
    </div>
  );
}

/** A bot message whose only visible blocks are tool cards: one slim line per card, no bubble. */
export function ToolOnlyNarration({
  blocks,
  live,
  artifactTarget,
}: {
  blocks: readonly ThreadMessage["blocks"][number][];
  live: boolean;
  artifactTarget?: ArtifactTarget;
}) {
  return (
    <>
      {blocks.map((block, i) =>
        block.kind === "steps" ? (
          <StandaloneToolActivity
            key={i}
            live={live}
            steps={block.steps}
            stepCount={toolStepCount(block.steps)}
            durationMs={block.durationMs}
            artifactTarget={artifactTarget}
          />
        ) : null,
      )}
    </>
  );
}
