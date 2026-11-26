import { Trans, useLingui } from "@lingui/react/macro";
import type { Space } from "@rakazo/contracts";
import { BotAvatar, Button, GroupAvatar } from "@rakazo/ui-web";
import { SidebarShelf } from "./sidebar-shelf";

export type HiddenChat =
  | { kind: "bot"; chat: Space["bots"][number] }
  | { kind: "group"; chat: Space["groups"][number] };

/** Hidden chats tucked away from the main roster, folded at the bottom of the sidebar. */
export function HiddenChats({
  hidden,
  showSpaceSearch,
  onUnhide,
  openSpaceChat,
}: {
  hidden: HiddenChat[];
  showSpaceSearch: boolean;
  onUnhide: (kind: "bot" | "group", id: string) => void;
  openSpaceChat: (spaceId: string, path: string) => void;
}) {
  const { t } = useLingui();
  if (hidden.length === 0 || showSpaceSearch) return null;
  return (
    <SidebarShelf title={<Trans>Hidden</Trans>} count={hidden.length}>
      {hidden.map(({ kind, chat }) => (
        <div
          key={`${kind}:${chat.id}`}
          className="group/shelf flex items-center gap-2 rounded-lg px-2.5 py-1 hover:bg-sidebar-accent"
        >
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-2 rounded-lg py-1 text-start"
            onClick={() =>
              openSpaceChat(chat.spaceId, kind === "bot" ? `/app/${chat.id}` : `/app/g/${chat.id}`)
            }
          >
            {kind === "bot" ? (
              <BotAvatar
                avatarSet={chat.avatarSet}
                color={chat.color}
                identity={chat.id}
                size={28}
                status={chat.status}
              />
            ) : (
              <GroupAvatar members={chat.members} size={28} />
            )}
            <span className="min-w-0 flex-1 truncate text-body text-foreground/75" dir="auto">
              {chat.name}
            </span>
          </button>
          <Button
            variant="ghost"
            size="xs"
            className="sr-only focus-visible:not-sr-only group-hover/shelf:not-sr-only"
            aria-label={t`Unhide ${chat.name}`}
            onClick={() => onUnhide(kind, chat.id)}
          >
            <Trans>Unhide</Trans>
          </Button>
        </div>
      ))}
    </SidebarShelf>
  );
}
