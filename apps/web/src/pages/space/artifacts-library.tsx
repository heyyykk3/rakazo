import { Trans, useLingui } from "@lingui/react/macro";
import { PageIcon } from "@rakazo/chat-ui/web";
import type { Bot, PageSummary } from "@rakazo/contracts";
import { uniquePages } from "@rakazo/core";
import {
  BotAvatar,
  Button,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Spinner,
} from "@rakazo/ui-web";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { formatRelativeTime } from "../../lib/locale/relative-time";
import { decodeArtifactBase64 } from "../../lib/pages/artifact-open";
import { useObjectUrl } from "../../lib/pages/use-object-url";
import { useSpaceQueries } from "../../lib/query/query";
import { errorText } from "../../lib/query/user-error";

function LoadedImageThumbnail({
  bytes,
  mimeType,
  name,
}: {
  bytes: Uint8Array;
  mimeType: string;
  name: string;
}) {
  const url = useObjectUrl(bytes, mimeType);
  if (!url) {
    return <div className="h-32 w-full rounded-lg bg-muted/60" aria-hidden="true" />;
  }
  return (
    <img
      src={url}
      alt={name}
      loading="lazy"
      className="h-32 w-full rounded-lg bg-muted object-cover"
    />
  );
}

/** Lazy thumbnail for image cards in the Library grid view. */
export function ArtifactImageThumbnail({
  artifactId,
  mimeType,
  name,
}: {
  artifactId: string;
  mimeType: string;
  name: string;
}) {
  const queries = useSpaceQueries();
  const data = useQuery(
    queries.artifacts.getById.queryOptions({
      input: { artifactId },
      staleTime: 5 * 60_000,
    }),
  ).data;
  const bytes = useMemo(() => (data ? decodeArtifactBase64(data.contentBase64) : null), [data]);
  if (!bytes) {
    return <div className="h-32 w-full rounded-lg bg-muted/60" aria-hidden="true" />;
  }
  return <LoadedImageThumbnail bytes={bytes} mimeType={mimeType} name={name} />;
}

function pageDestination(page: PageSummary): string {
  if (page.groupId) return `/app/g/${page.groupId}?page=${page.id}`;
  if (page.botId) return `/app/${page.botId}?page=${page.id}`;
  return `/app?page=${page.id}`;
}

/** Space-wide saved Pages list inside the Library view, filtered by bot and search query. */
export function PagesLibraryPane({
  botId,
  searchQuery,
  viewMode,
  botsById,
}: {
  botId: string | null;
  searchQuery: string;
  viewMode: "grid" | "list";
  botsById: Map<string, Bot>;
}) {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const query = searchQuery.trim();
  const pages = useInfiniteQuery(
    queries.pages.list.infiniteOptions({
      input: (cursor: string | null) => ({
        ...(botId ? { botId } : {}),
        limit: 30,
        ...(cursor ? { cursor } : {}),
        ...(query ? { query } : {}),
      }),
      initialPageParam: null as string | null,
      getNextPageParam: (page) => page.nextCursor,
    }),
  );

  if (pages.isPending) {
    return (
      <div className="grid flex-1 place-items-center text-muted-foreground">
        <Spinner aria-label={t`Loading…`} />
      </div>
    );
  }
  if (pages.isError) {
    return (
      <div className="grid flex-1 place-items-center p-6 text-body text-destructive">
        {errorText(pages.error, t`Could not load pages.`)}
      </div>
    );
  }
  const items = uniquePages(pages.data.pages.flatMap((page) => page.items));
  if (items.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FileText />
          </EmptyMedia>
          <EmptyTitle>
            <Trans>No pages yet</Trans>
          </EmptyTitle>
          <EmptyDescription>
            <Trans>Reports, plans, and dashboards your bots build collect here.</Trans>
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div data-testid="library-pages-pane" className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
      {viewMode === "grid" ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
          {items.map((page) => {
            const bot = page.botId ? botsById.get(page.botId) : undefined;
            return (
              <Link
                key={page.id}
                to={pageDestination(page)}
                className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 text-foreground hover:bg-accent/40"
              >
                <div className="flex items-start justify-between gap-2">
                  <PageIcon className="size-6" />
                  <span className="rounded-md bg-muted px-2 py-0.5 text-caption font-medium text-muted-foreground">
                    {`v${page.currentVersion}`}
                  </span>
                </div>
                <div className="truncate text-body-lg font-semibold" dir="auto">
                  {page.title}
                </div>
                <div className="mt-auto flex items-center gap-2 text-label text-muted-foreground">
                  {bot ? (
                    <>
                      <BotAvatar
                        avatarSet={bot.avatarSet}
                        color={bot.color}
                        identity={bot.id}
                        size={18}
                        status={bot.status}
                      />
                      <span className="min-w-0 flex-1 truncate">{bot.name}</span>
                    </>
                  ) : (
                    <span className="flex-1" />
                  )}
                  <span className="shrink-0">{formatRelativeTime(page.updatedAt)}</span>
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border">
          {items.map((page) => {
            const bot = page.botId ? botsById.get(page.botId) : undefined;
            return (
              <Link
                key={page.id}
                to={pageDestination(page)}
                className="flex items-center gap-3 px-4 py-3 hover:bg-accent/40"
              >
                <PageIcon className="size-5 shrink-0" />
                <span className="min-w-0 flex-1 truncate text-body font-medium" dir="auto">
                  {page.title}
                </span>
                {bot ? (
                  <span className="shrink-0 text-label text-muted-foreground">{bot.name}</span>
                ) : null}
                <span className="shrink-0 text-label text-muted-foreground">
                  {formatRelativeTime(page.updatedAt)}
                </span>
              </Link>
            );
          })}
        </div>
      )}
      {pages.hasNextPage ? (
        <div className="mt-4 flex justify-center">
          <Button
            variant="outline"
            size="sm"
            disabled={pages.isFetchingNextPage}
            onClick={() => void pages.fetchNextPage()}
          >
            <Trans>Load more</Trans>
          </Button>
        </div>
      ) : null}
    </div>
  );
}
