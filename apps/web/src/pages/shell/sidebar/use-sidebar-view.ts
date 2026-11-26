import { useLingui } from "@lingui/react/macro";
import type { Bot, BotSection, Group, Me, Space } from "@rakazo/contracts";
import { chatSnoozed } from "@rakazo/core";
import { useMemo, useState } from "react";
import { useDesktopBadge } from "../../../lib/platform/use-desktop-badge";
import {
  readBotsSidebarCollapsed,
  writeBotsSidebarCollapsed,
} from "../../../lib/preferences/bots-sidebar-pref";
import {
  hiddenChatKey,
  readHiddenChats,
  writeHiddenChats,
} from "../../../lib/preferences/hidden-chats-pref";
import { useEventListener } from "../../../lib/use-event-listener";
import type { HiddenChat } from "./hidden-chats";
import type { SnoozedChat } from "./snoozed-chats";
import { countUnreadChats, sidebarGroupsForSpaces } from "./space-sidebar";

const MD_BREAKPOINT = 768;
const NARROW_DESKTOP_BREAKPOINT = 1000;

function isNarrowDesktopViewport() {
  if (typeof window === "undefined") return false;
  return window.innerWidth >= MD_BREAKPOINT && window.innerWidth < NARROW_DESKTOP_BREAKPOINT;
}

/**
 * What the sidebar shows: whether it is collapsed, every space's chats grouped for the roster, the
 * snoozed ones, and the unread count on the Dock badge.
 */
export function useSidebarView({
  userId,
  isMobile,
  bootstrapMe,
  spaces,
  bots,
  groups,
  botSections,
  searchQuery,
  now,
}: {
  userId: string | undefined;
  isMobile: boolean;
  bootstrapMe: Me | null | undefined;
  spaces: Space[];
  bots: Bot[];
  groups: Group[];
  botSections: BotSection[];
  searchQuery: string;
  now: number;
}) {
  const { t } = useLingui();
  // Read while rendering, so returning to chats does not animate the sidebar shut.
  const [collapsedPref, setCollapsedState] = useState(() => readBotsSidebarCollapsed(userId));
  const [hiddenKeys, setHiddenKeys] = useState(() => readHiddenChats(userId));
  const [collapsedFor, setCollapsedFor] = useState(userId);
  if (collapsedFor !== userId) {
    setCollapsedFor(userId);
    setCollapsedState(readBotsSidebarCollapsed(userId));
    setHiddenKeys(readHiddenChats(userId));
  }
  function isHidden(kind: "bot" | "group", id: string) {
    return hiddenKeys.has(hiddenChatKey(kind, id));
  }
  function setChatHidden(kind: "bot" | "group", id: string, hidden: boolean) {
    const key = hiddenChatKey(kind, id);
    setHiddenKeys((prev) => {
      const next = new Set(prev);
      if (hidden) next.add(key);
      else next.delete(key);
      writeHiddenChats(userId, next);
      return next;
    });
  }
  const [narrowDesktop, setNarrowDesktop] = useState(isNarrowDesktopViewport);
  // A person who explicitly expands the sidebar on a narrow window keeps it open until they resize wide again.
  const [narrowOverride, setNarrowOverride] = useState<boolean | null>(null);
  useEventListener(typeof window === "undefined" ? null : window, "resize", () => {
    const nextNarrow = isNarrowDesktopViewport();
    setNarrowDesktop((prev) => {
      if (prev !== nextNarrow && !nextNarrow) setNarrowOverride(null);
      return nextNarrow;
    });
  });
  const collapsed = narrowDesktop ? (narrowOverride ?? true) : collapsedPref;
  function setCollapsed(next: boolean) {
    if (narrowDesktop) setNarrowOverride(next);
    else setCollapsedState(next);
  }
  function setCollapsedPref(next: boolean) {
    if (narrowDesktop) {
      setNarrowOverride(next);
      return;
    }
    setCollapsedState(next);
    writeBotsSidebarCollapsed(userId, next);
  }
  const mini = collapsed && !isMobile;

  const sidebarSpaces = useMemo(
    () =>
      spaces.length > 0
        ? spaces.map((space) =>
            space.id === bootstrapMe?.spaceId ? { ...space, bots, groups, botSections } : space,
          )
        : bootstrapMe
          ? [
              {
                id: bootstrapMe.spaceId,
                name: "Personal",
                isDefault: true,
                hasContent: true,
                canRename: false,
                canDelete: false,
                bots,
                groups,
                botSections,
              },
            ]
          : [],
    [bootstrapMe, botSections, bots, groups, spaces],
  );
  const sidebarGroups = useMemo(
    () =>
      sidebarGroupsForSpaces(
        sidebarSpaces,
        mini ? "" : searchQuery,
        { pinned: t`Pinned`, unassigned: t`Unassigned` },
        now,
        hiddenKeys,
      ),
    [sidebarSpaces, searchQuery, mini, t, now, hiddenKeys],
  );
  // The Dock badge ignores the roster search box: a filter must not hide unread chats.
  const unreadChatCount = useMemo(
    () => countUnreadChats(sidebarGroupsForSpaces(sidebarSpaces, "", undefined, now, hiddenKeys)),
    [sidebarSpaces, now, hiddenKeys],
  );
  useDesktopBadge(userId ? unreadChatCount : 0);
  const snoozed: SnoozedChat[] = sidebarSpaces.flatMap((space) => [
    ...space.bots
      .filter((chat) => chatSnoozed(chat, now))
      .map((chat) => ({ kind: "bot" as const, chat })),
    ...space.groups
      .filter((chat) => chatSnoozed(chat, now))
      .map((chat) => ({ kind: "group" as const, chat })),
  ]);
  const hidden: HiddenChat[] = sidebarSpaces.flatMap((space) => [
    ...space.bots
      .filter((chat) => !chatSnoozed(chat, now) && hiddenKeys.has(hiddenChatKey("bot", chat.id)))
      .map((chat) => ({ kind: "bot" as const, chat })),
    ...space.groups
      .filter((chat) => !chatSnoozed(chat, now) && hiddenKeys.has(hiddenChatKey("group", chat.id)))
      .map((chat) => ({ kind: "group" as const, chat })),
  ]);

  return {
    collapsed,
    setCollapsed,
    setCollapsedPref,
    mini,
    sidebarGroups,
    snoozed,
    hidden,
    isHidden,
    setChatHidden,
  };
}
