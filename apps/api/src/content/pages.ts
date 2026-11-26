import { createHash, randomBytes } from "node:crypto";
import type { AdapterContext, ArtifactStore, SecretStore } from "@rakazo/adapter-kit";
import { forgetPageShareSecrets } from "@rakazo/adapters";
import type {
  Actor,
  PageDetail,
  PageImageSource,
  PageSummary,
  PageVisibility,
  SharedPage,
} from "@rakazo/contracts";
import { pageReviewPath, pageShareTokenFromSlug, pageShareUrl } from "@rakazo/contracts";
import { ClientError, escapeSearchWildcards } from "@rakazo/core";
import type {
  PageShareSecret,
  Prisma,
  PrismaClient,
  StoredPageImage,
  ThreadEvents,
} from "@rakazo/db";
import {
  cancelPageGrantRequests,
  findPageVersionImage,
  IsolationError,
  isRecordNotFound,
  lockPage,
  pageImageSource,
  pageImageStorageKeys,
  pageVersionImages,
  readPageState,
  runAsSystem,
  signalPage,
  signalPageUsers,
} from "@rakazo/db";
import { bestEffort, getLogger } from "@rakazo/logging";
import { checkPageSource } from "@rakazo/page-kit/validate";

const PAGE_SHARE_SECRET_KIND = "page_share";
const DEFAULT_LIST_LIMIT = 30;

type PageDeps = {
  prisma: PrismaClient;
  secrets: SecretStore;
  artifacts: ArtifactStore;
  webOrigin: string;
  events?: ThreadEvents;
};

const summarySelect = {
  id: true,
  title: true,
  botId: true,
  groupId: true,
  visibility: true,
  currentVersion: true,
  pinnedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.PageSelect;

type SummaryRow = Prisma.PageGetPayload<{ select: typeof summarySelect }>;

function pageSummary(row: SummaryRow): PageSummary {
  return {
    id: row.id,
    title: row.title,
    botId: row.botId,
    groupId: row.groupId,
    visibility:
      row.visibility === "link" || row.visibility === "people" ? row.visibility : "private",
    currentVersion: row.currentVersion,
    pinned: row.pinnedAt !== null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function hashPageShareToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** A page deleted between the ownership read and the write, by another tab, reads as gone. */
async function stillThere<T>(write: Promise<T>): Promise<T> {
  try {
    return await write;
  } catch (error) {
    if (isRecordNotFound(error)) {
      throw new IsolationError();
    }
    throw error;
  }
}

async function requirePage(prisma: PrismaClient, actor: Actor, pageId: string) {
  const row = await prisma.page.findFirst({
    where: { id: pageId, spaceId: actor.spaceId, userId: actor.userId },
    select: { ...summarySelect, shareSecretId: true },
  });
  if (!row) throw new IsolationError();
  return row;
}

export class PageListCursorError extends ClientError {
  constructor() {
    super("BAD_REQUEST", "Invalid page list cursor");
  }
}

type ListCursor = { pinnedAt: string | null; updatedAt: string; id: string };

function encodeCursor(row: SummaryRow): string {
  const cursor: ListCursor = {
    pinnedAt: row.pinnedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
    id: row.id,
  };
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function decodeCursor(value: string): ListCursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as ListCursor;
    const valid =
      typeof parsed.id === "string" &&
      !Number.isNaN(Date.parse(parsed.updatedAt)) &&
      (parsed.pinnedAt === null || !Number.isNaN(Date.parse(parsed.pinnedAt)));
    if (valid) return parsed;
  } catch {}
  throw new PageListCursorError();
}

/** Rows after the cursor in (pinned first by pin time, then newest update, then id) order. */
function afterCursor(cursor: ListCursor): Prisma.PageWhereInput {
  const updatedAt = new Date(cursor.updatedAt);
  const sameUpdate: Prisma.PageWhereInput = {
    OR: [{ updatedAt: { lt: updatedAt } }, { updatedAt, id: { lt: cursor.id } }],
  };
  if (cursor.pinnedAt === null) return { pinnedAt: null, ...sameUpdate };
  const pinnedAt = new Date(cursor.pinnedAt);
  return {
    OR: [{ pinnedAt: null }, { pinnedAt: { lt: pinnedAt } }, { pinnedAt, ...sameUpdate }],
  };
}

export async function listPages(
  prisma: PrismaClient,
  actor: Actor,
  input: { botId?: string; groupId?: string; cursor?: string; limit?: number; query?: string },
) {
  const limit = input.limit ?? DEFAULT_LIST_LIMIT;
  const where: Prisma.PageWhereInput = {
    spaceId: actor.spaceId,
    userId: actor.userId,
    ...(input.groupId ? { groupId: input.groupId } : {}),
    ...(input.botId ? { botId: input.botId, ...(input.groupId ? {} : { groupId: null }) } : {}),
    ...(input.cursor ? { AND: [afterCursor(decodeCursor(input.cursor))] } : {}),
    ...(input.query
      ? { title: { contains: escapeSearchWildcards(input.query), mode: "insensitive" } }
      : {}),
  };
  const rows = await prisma.page.findMany({
    where,
    select: summarySelect,
    orderBy: [{ pinnedAt: { sort: "desc", nulls: "last" } }, { updatedAt: "desc" }, { id: "desc" }],
    take: limit + 1,
  });
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map(pageSummary),
    nextCursor: rows.length > limit && last ? encodeCursor(last) : null,
  };
}

async function shareUrlFor(
  deps: PageDeps,
  row: { id: string; title: string; visibility: string; shareSecretId: string | null },
): Promise<string | null> {
  if (row.visibility === "people") return new URL(pageReviewPath(row.id), deps.webOrigin).href;
  if (row.visibility !== "link" || !row.shareSecretId) return null;
  const secret = await deps.prisma.secret.findUnique({
    where: { id: row.shareSecretId },
    select: { id: true, ciphertext: true },
  });
  if (!secret) return null;
  const token = await deps.secrets.load(secret.ciphertext, { recordId: secret.id });
  return pageShareUrl(deps.webOrigin, row.title, token);
}

export async function getPage(
  deps: PageDeps,
  actor: Actor,
  input: { pageId: string; version?: number; link?: boolean },
): Promise<PageDetail> {
  const row = await requirePage(deps.prisma, actor, input.pageId);
  const version = input.version ?? row.currentVersion;
  const latest = version === row.currentVersion;
  const [stored, owner, readerState] = await Promise.all([
    deps.prisma.pageVersion.findUnique({
      where: { pageId_version: { pageId: row.id, version } },
      select: { id: true, code: true, images: true },
    }),
    deps.prisma.user.findUnique({
      where: { id: actor.userId },
      select: { name: true, image: true },
    }),
    latest
      ? runAsSystem("read the owner's saved page values", () =>
          readPageState(deps.prisma, row.id, actor.userId),
        )
      : undefined,
  ]);
  if (!stored) throw new IsolationError();
  return {
    ...pageSummary(row),
    version,
    code: stored.code,
    images: pageVersionImages(stored),
    owner: { name: owner?.name ?? "", image: owner?.image ?? null },
    // Cards skip the secret store; a token it cannot read hides only the link.
    shareUrl: input.link
      ? await shareUrlFor(deps, row).catch((error: unknown) => {
          getLogger().error("page link token load", error);
          return null;
        })
      : null,
    ...(readerState ? { readerState } : {}),
  };
}

export async function renamePage(
  prisma: PrismaClient,
  actor: Actor,
  pageId: string,
  title: string,
  events?: ThreadEvents,
) {
  await requirePage(prisma, actor, pageId);
  const renamed = pageSummary(
    await stillThere(
      prisma.page.update({
        where: { id: pageId },
        data: { title, updatedAt: new Date() },
        select: summarySelect,
      }),
    ),
  );
  if (events) await signalPage(prisma, events, pageId);
  return renamed;
}

export async function pinPage(prisma: PrismaClient, actor: Actor, pageId: string, pinned: boolean) {
  const row = await requirePage(prisma, actor, pageId);
  if ((row.pinnedAt !== null) === pinned) return pageSummary(row);
  return pageSummary(
    await stillThere(
      prisma.page.update({
        where: { id: pageId },
        data: { pinnedAt: pinned ? new Date() : null },
        select: summarySelect,
      }),
    ),
  );
}

export class PageShareConflictError extends ClientError {
  constructor() {
    super("CONFLICT", "The page's sharing changed at the same time; try again");
  }
}

/**
 * Compare-and-swap on the link, so concurrent changes never both win or orphan a sealed token.
 * Turning on a page that already has a link keeps that link (`kept`), so two turn-ons at once
 * both hand out the one URL that works, unless that link is `next.unreadable`: its token can't
 * be loaded, so it is replaced. `replaced` is the secret a swap deleted, for the caller to remove
 * from the secret store once committed.
 */
async function swapPageShare(
  prisma: PrismaClient,
  pageId: string,
  next: {
    tokenHash: string;
    secret: { id: string; data: Prisma.SecretUncheckedCreateInput };
    unreadable: string | null;
  } | null,
  scope: { spaceId: string; userId: string },
  visibility: PageVisibility,
): Promise<{ kept: boolean; replaced: PageShareSecret | null; revoked: (string | null)[] }> {
  for (let attempt = 0; ; attempt++) {
    const outcome = await runAsSystem("change sharing on an owned page", () =>
      prisma.$transaction(async (tx) => {
        const current = await tx.page.findUnique({
          where: { id: pageId, spaceId: scope.spaceId, userId: scope.userId },
          select: { shareSecretId: true, visibility: true },
        });
        if (!current) throw new IsolationError();
        if (next && current.shareSecretId && current.shareSecretId !== next.unreadable) {
          return { kept: true, replaced: null, revoked: [] };
        }
        if (next) await tx.secret.create({ data: next.secret.data });
        const moved = await tx.page.updateMany({
          where: {
            id: pageId,
            shareSecretId: current.shareSecretId,
            visibility: current.visibility,
          },
          data: next
            ? { visibility: "link", shareTokenHash: next.tokenHash, shareSecretId: next.secret.id }
            : { visibility, shareTokenHash: null, shareSecretId: null },
        });
        // Rolling back drops the new secret with the failed swap.
        if (moved.count === 0) throw new PageShareConflictError();
        const revoked =
          current.visibility === "people" && visibility !== "people"
            ? await tx.pageGrant.findMany({ where: { pageId }, select: { id: true, userId: true } })
            : [];
        if (revoked.length) {
          await cancelPageGrantRequests(
            tx,
            revoked.map(({ id }) => id),
          );
          await tx.pageGrant.deleteMany({ where: { pageId } });
        }
        const userIds = revoked.map(({ userId }) => userId);
        if (!current.shareSecretId) return { kept: false, replaced: null, revoked: userIds };
        const replaced = await tx.secret.findUnique({
          where: { id: current.shareSecretId },
          select: { id: true, ciphertext: true },
        });
        await tx.secret.deleteMany({ where: { id: current.shareSecretId } });
        return { kept: false, replaced, revoked: userIds };
      }),
    ).catch((error: unknown) => {
      if (error instanceof PageShareConflictError && attempt === 0) return null;
      throw error;
    });
    if (outcome) return outcome;
  }
}

/**
 * A fresh token when the page has no live link, so a link shared before it was turned off stays
 * dead. Turning on a page that already has a link returns that link, or replaces it when its
 * token can't be read, so the owner always gets a link they can copy.
 */
export async function setPageVisibility(
  deps: PageDeps,
  actor: Actor,
  input: { pageId: string; visibility: PageVisibility },
  signal: AbortSignal,
): Promise<{ visibility: PageVisibility; shareUrl: string | null }> {
  const row = await requirePage(deps.prisma, actor, input.pageId);
  if (input.visibility !== "link") {
    const { replaced, revoked } = await swapPageShare(
      deps.prisma,
      row.id,
      null,
      actor,
      input.visibility,
    );
    if (replaced) await forgetPageShareSecrets(deps.secrets, [replaced]);
    if (deps.events) await signalPageUsers(deps.events, [actor.userId, ...revoked]);
    return {
      visibility: input.visibility,
      shareUrl:
        input.visibility === "people" ? new URL(pageReviewPath(row.id), deps.webOrigin).href : null,
    };
  }
  let unreadable: string | null = null;
  const existing =
    row.visibility === "link"
      ? await shareUrlFor(deps, row).catch((error: unknown) => {
          getLogger().error("page link token load", error);
          unreadable = row.shareSecretId;
          return null;
        })
      : null;
  if (existing) return { visibility: "link", shareUrl: existing };
  const token = randomBytes(32).toString("base64url");
  const stored = await deps.secrets.put(token, {
    operationId: `page-share:${row.id}`,
    traceId: `page-share:${row.id}`,
    spaceId: actor.spaceId,
    userId: actor.userId,
    signal,
  });
  let swapped: Awaited<ReturnType<typeof swapPageShare>>;
  try {
    swapped = await swapPageShare(
      deps.prisma,
      row.id,
      {
        tokenHash: hashPageShareToken(token),
        secret: {
          id: stored.id,
          data: {
            id: stored.id,
            userId: actor.userId,
            spaceId: actor.spaceId,
            kind: PAGE_SHARE_SECRET_KIND,
            ciphertext: stored.ciphertext,
          },
        },
        unreadable,
      },
      actor,
      "link",
    );
  } catch (error) {
    await forgetPageShareSecrets(deps.secrets, [stored]);
    throw error;
  }
  if (swapped.kept) {
    // Another turn-on won while this one sealed its token: both callers get the winner's link.
    await forgetPageShareSecrets(deps.secrets, [stored]);
    const latest = await requirePage(deps.prisma, actor, row.id);
    const winner = latest.visibility === "link" ? await shareUrlFor(deps, latest) : null;
    if (winner) return { visibility: "link", shareUrl: winner };
    throw new PageShareConflictError();
  }
  if (swapped.replaced) await forgetPageShareSecrets(deps.secrets, [swapped.replaced]);
  if (deps.events) await signalPageUsers(deps.events, [actor.userId, ...swapped.revoked]);
  return { visibility: "link", shareUrl: pageShareUrl(deps.webOrigin, row.title, token) };
}

export async function removePage(deps: PageDeps, actor: Actor, pageId: string) {
  const row = await requirePage(deps.prisma, actor, pageId);
  const { removed, reviewers, imageKeys } = await runAsSystem(
    "remove an owned page and notify its reviewers",
    () =>
      deps.prisma.$transaction(async (tx) => {
        if (deps.events) await lockPage(tx, pageId);
        const reviewers = deps.events
          ? (await tx.pageGrant.findMany({ where: { pageId }, select: { userId: true } })).map(
              ({ userId }) => userId,
            )
          : [];
        const imageKeys = await pageImageStorageKeys(tx, { id: row.id });
        // The deleted row's link, not the one read before: a share may have swapped it since.
        const deleted = await stillThere(
          tx.page.delete({
            where: { id: row.id, userId: actor.userId, spaceId: actor.spaceId },
            select: { shareSecretId: true },
          }),
        );
        if (!deleted.shareSecretId) return { removed: null, reviewers, imageKeys };
        const secret = await tx.secret.findUnique({
          where: { id: deleted.shareSecretId },
          select: { id: true, ciphertext: true },
        });
        await tx.secret.deleteMany({ where: { id: deleted.shareSecretId } });
        return { removed: secret, reviewers, imageKeys };
      }),
  );
  await removePageImageFiles(deps.artifacts, actor, imageKeys);
  if (deps.events) await signalPageUsers(deps.events, [actor.userId, ...reviewers]);
  if (removed) await forgetPageShareSecrets(deps.secrets, [removed]);
  return { ok: true as const };
}

/** The current version of a page shared by link, or null for any token that does not open one. */
async function sharedPageVersion(prisma: PrismaClient, token: string) {
  if (pageShareTokenFromSlug(token) !== token) return null;
  const page = await runAsSystem("page share link", () =>
    prisma.page.findUnique({
      where: { shareTokenHash: hashPageShareToken(token) },
      select: {
        visibility: true,
        title: true,
        currentVersion: true,
        updatedAt: true,
        id: true,
        userId: true,
        spaceId: true,
        shareSecretId: true,
      },
    }),
  );
  // A link lives only while its sealed token does, whatever removed the token.
  if (page?.visibility !== "link" || !page.shareSecretId) return null;
  const version = await runAsSystem("page share link", () =>
    prisma.pageVersion.findUnique({
      where: { pageId_version: { pageId: page.id, version: page.currentVersion } },
      select: { id: true, pageId: true, code: true, images: true },
    }),
  );
  return version ? { page, version } : null;
}

export async function readSharedPage(
  prisma: PrismaClient,
  token: string,
): Promise<SharedPage | null> {
  const shared = await sharedPageVersion(prisma, token);
  if (!shared) return null;
  const { page, version } = shared;
  return {
    title: page.title,
    code: version.code,
    images: pageVersionImages(version),
    version: page.currentVersion,
    updatedAt: page.updatedAt.toISOString(),
  };
}

export async function readSharedPageImage(
  deps: { prisma: PrismaClient; artifacts: ArtifactStore },
  token: string,
  imageId: string,
): Promise<PageImageSource | null> {
  const shared = await sharedPageVersion(deps.prisma, token);
  if (!shared) return null;
  const image = await runAsSystem("page share link image", () =>
    findPageVersionImage(deps.prisma, shared.version, imageId),
  );
  return image && readPageImage(deps.artifacts, shared.page, image);
}

function pageImageContext(
  owner: Pick<Actor, "spaceId" | "userId">,
  operationId: string,
): AdapterContext {
  const { spaceId, userId } = owner;
  return {
    operationId,
    traceId: operationId,
    spaceId,
    userId,
    signal: new AbortController().signal,
  };
}

/** A stored page picture as the viewer embeds it, read from the page's own Space. */
export async function readPageImage(
  artifacts: ArtifactStore,
  reader: { userId: string },
  image: StoredPageImage,
): Promise<PageImageSource> {
  const context = pageImageContext(
    { spaceId: image.spaceId, userId: reader.userId },
    "page-image-read",
  );
  return pageImageSource(image, await artifacts.get(image.storageKey, context));
}

/** Converts plain Markdown into a clean, validated PageKit JSX source file. */
function markdownToPageSource(title: string, markdown: string): string {
  type Block =
    | { kind: "heading"; text: string }
    | { kind: "paragraph"; text: string }
    | { kind: "bullets"; items: string[] }
    | { kind: "numbered"; items: string[] };

  const blocks: Block[] = [];
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  let paragraph: string[] = [];
  let bullets: string[] = [];
  let numbered: string[] = [];

  const flush = () => {
    if (paragraph.length) {
      blocks.push({ kind: "paragraph", text: paragraph.join(" ").trim() });
      paragraph = [];
    }
    if (bullets.length) {
      blocks.push({ kind: "bullets", items: bullets });
      bullets = [];
    }
    if (numbered.length) {
      blocks.push({ kind: "numbered", items: numbered });
      numbered = [];
    }
  };

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      flush();
      continue;
    }
    const headingMatch = trimmed.match(/^#{1,6}\s+(.+)$/);
    if (headingMatch) {
      flush();
      blocks.push({ kind: "heading", text: headingMatch[1]!.trim() });
      continue;
    }
    const bulletMatch = trimmed.match(/^[-*•]\s+(.+)$/);
    if (bulletMatch) {
      if (paragraph.length || numbered.length) flush();
      bullets.push(bulletMatch[1]!.trim());
      continue;
    }
    const numMatch = trimmed.match(/^\d+[.)]\s+(.+)$/);
    if (numMatch) {
      if (paragraph.length || bullets.length) flush();
      numbered.push(numMatch[1]!.trim());
      continue;
    }
    if (bullets.length || numbered.length) flush();
    paragraph.push(trimmed);
  }
  flush();

  const sections: Array<{ heading?: string; items: Block[] }> = [];
  let current: { heading?: string; items: Block[] } = { items: [] };
  for (const block of blocks) {
    if (block.kind === "heading") {
      if (current.heading || current.items.length) sections.push(current);
      current = { heading: block.text, items: [] };
    } else {
      current.items.push(block);
    }
  }
  if (current.heading || current.items.length) sections.push(current);
  if (sections.length === 0)
    sections.push({ items: [{ kind: "paragraph", text: markdown.trim() }] });

  const dataLiteral = JSON.stringify({ title, sections });
  return `const DATA = ${dataLiteral};

export default function MessagePage() {
  return (
    <Page title={DATA.title}>
      {DATA.sections.map((section, sIndex) => (
        <Section key={sIndex} heading={section.heading}>
          {section.items.map((item, iIndex) => {
            if (item.kind === "bullets") return <BulletList key={iIndex} items={item.items} />;
            if (item.kind === "numbered") return <NumberedList key={iIndex} items={item.items} />;
            return <Text key={iIndex}>{item.text}</Text>;
          })}
        </Section>
      ))}
    </Page>
  );
}
`;
}

export async function createPageFromMarkdown(
  prisma: PrismaClient,
  actor: Actor,
  input: { botId?: string; groupId?: string; title: string; markdown: string },
  events?: ThreadEvents,
): Promise<PageSummary> {
  let botId: string | null = null;
  let groupId: string | null = null;
  if (input.groupId) {
    const group = await prisma.chatGroup.findFirst({
      where: { id: input.groupId, spaceId: actor.spaceId },
      select: { id: true },
    });
    if (!group) throw new IsolationError();
    groupId = group.id;
  }
  if (input.botId) {
    const bot = await prisma.bot.findFirst({
      where: { id: input.botId, spaceId: actor.spaceId },
      select: { id: true },
    });
    if (!bot) throw new IsolationError();
    botId = bot.id;
  }
  if (!botId && !groupId) {
    const firstBot = await prisma.bot.findFirst({
      where: { spaceId: actor.spaceId, archivedAt: null },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (!firstBot) throw new ClientError("BAD_REQUEST", "No bot found in this Space");
    botId = firstBot.id;
  }
  const source = markdownToPageSource(input.title, input.markdown);
  const checked = checkPageSource(source);
  if (!checked.ok) {
    throw new ClientError("BAD_REQUEST", checked.errors[0] ?? "Could not compile page");
  }
  const created = await prisma.page.create({
    data: {
      spaceId: actor.spaceId,
      userId: actor.userId,
      botId,
      groupId,
      title: input.title,
      versions: {
        create: {
          version: 1,
          title: input.title,
          source,
          code: checked.code,
        },
      },
    },
    select: summarySelect,
  });
  if (events) {
    void bestEffort("signal page created", signalPage(prisma, events, created.id));
  }
  return pageSummary(created);
}

/** Removes deleted pages' pictures once the deletion commits; the rows are gone, so failures only log. */
async function removePageImageFiles(
  artifacts: ArtifactStore,
  actor: Pick<Actor, "spaceId" | "userId">,
  storageKeys: string[],
) {
  const context = pageImageContext(actor, "page-image-delete");
  for (const result of await Promise.allSettled(
    storageKeys.map((storageKey) => artifacts.remove(storageKey, context)),
  ))
    if (result.status === "rejected") getLogger().error("page picture cleanup", result.reason);
}
