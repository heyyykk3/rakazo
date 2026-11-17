import { Trans, useLingui } from "@lingui/react/macro";
import { MAX_MODEL_CONNECTION_LABEL } from "@rakazo/contracts";
import {
  Button,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
  cn,
  Input,
  ListSearchInput,
  Popover,
  PopoverContent,
  PopoverTrigger,
  SectionHeading,
} from "@rakazo/ui-web";
import { ChevronRight, Plus } from "lucide-react";
import type { ReactNode } from "react";
import { useId, useRef, useState } from "react";
import type { ModelCredential } from "../../lib/model-auth";
import { useSave, useSpaceQueries } from "../../lib/query";
import { useListSearch } from "../../lib/use-list-search";
import { errorText } from "../../lib/user-error";
import { groupProviderConnections } from "./provider-groups";
import type { ConnectableProvider } from "./role-model-picker";

/** Every connection the member has, with the way to add another, even for a connected provider. */
export function ProvidersSection({
  credentials,
  providers,
  name: nameOf,
  disabled,
  onAdd,
  onOpen,
  detail,
  groupDetail,
  panel,
}: {
  credentials: ModelCredential[];
  /** Every provider that can be connected, connected ones included. */
  providers: ConnectableProvider[];
  /** A connection's name, such as "OpenAI" or "OpenAI (Work)". */
  name: (credential: ModelCredential) => string;
  disabled?: boolean;
  onAdd: (provider: ConnectableProvider) => void;
  /** Opens a connection's page. */
  onOpen: (credential: ModelCredential) => void;
  /** What a connection's row says after its name, such as how many models it runs. */
  detail?: (credential: ModelCredential) => ReactNode;
  /** The form for a new connection, shown after the list. */
  groupDetail?: (credentials: ModelCredential[]) => ReactNode;
  panel?: ReactNode;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const groups = groupProviderConnections(credentials, nameOf);
  return (
    <section className="mb-8" data-testid="model-providers">
      <SectionHeading className="mb-2.5">
        <Trans>Providers</Trans>
      </SectionHeading>
      <ul className="divide-y divide-border rounded-xl border border-border">
        {groups.map((group) => (
          <li key={group.id} data-testid={`model-provider-${group.id}`}>
            <SettingsListRow
              disabled={disabled}
              onClick={() =>
                group.grouped
                  ? setExpanded(expanded === group.id ? null : group.id)
                  : onOpen(group.credentials[0]!)
              }
              label={group.name}
              labelTestId="provider-row-name"
            >
              {group.credentials.some((entry) => entry.reconnectRequired) ? (
                <span className="shrink-0 text-body-sm text-warning">
                  <Trans>Sign in again</Trans>
                </span>
              ) : group.grouped ? (
                groupDetail?.(group.credentials)
              ) : (
                detail?.(group.credentials[0]!)
              )}
            </SettingsListRow>
            {group.grouped && expanded === group.id ? (
              <ul className="border-t border-border ps-5">
                {group.credentials.map((credential) => (
                  <li key={credential.id}>
                    <SettingsListRow
                      disabled={disabled}
                      onClick={() => onOpen(credential)}
                      label={credential.label.replace(/^(AWS Bedrock|Azure)\s*·\s*/, "")}
                    >
                      {detail?.(credential)}
                    </SettingsListRow>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
        <li>
          <AddProvider providers={providers} disabled={disabled} onPick={onAdd} />
        </li>
      </ul>
      {panel}
    </section>
  );
}

/** A connection's editable name, saved on its own. */
export function ConnectionNameField({ credential }: { credential: ModelCredential }) {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const nameId = useId();
  const [name, setName] = useState(credential.label);
  const rename = useSave({
    save: (label: string, rpc) => rpc.models.rename({ credentialId: credential.id, label }),
    stale: [queries.models.credentials.key()],
  });
  const saving = rename.pending;
  const trimmed = name.trim();
  return (
    <form
      className="mb-6"
      onSubmit={(event) => {
        event.preventDefault();
        if (!trimmed || trimmed === credential.label) return;
        rename.run(trimmed);
      }}
    >
      <label htmlFor={nameId} className="block text-body text-muted-foreground">
        <Trans>Name</Trans>
      </label>
      <div className="mt-2 flex gap-2">
        <Input
          id={nameId}
          maxLength={MAX_MODEL_CONNECTION_LABEL}
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="h-10 text-foreground"
        />
        {trimmed && trimmed !== credential.label ? (
          <Button type="submit" variant="secondary" className="h-10" disabled={saving}>
            {saving ? <Trans>Saving…</Trans> : <Trans>Save</Trans>}
          </Button>
        ) : null}
      </div>
      {rename.error ? (
        <p className="mt-2 text-body text-destructive">
          {errorText(rename.error, t`Could not rename connection`)}
        </p>
      ) : null}
    </form>
  );
}

function AddProvider({
  providers,
  disabled,
  onPick,
}: {
  providers: ConnectableProvider[];
  disabled?: boolean;
  onPick: (provider: ConnectableProvider) => void;
}) {
  const { t } = useLingui();
  const searchRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const {
    query,
    setQuery,
    showSearch,
    visible: matching,
  } = useListSearch(providers, { text: (provider) => provider.name });
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setQuery("");
        setOpen(next);
      }}
    >
      <PopoverTrigger
        disabled={disabled}
        render={
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-b-xl px-3 py-3 text-start text-body text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <Plus className="size-4" aria-hidden />
            <Trans>Add provider</Trans>
          </button>
        }
      />
      <PopoverContent
        align="start"
        sideOffset={6}
        initialFocus={showSearch ? searchRef : undefined}
        className="w-[min(360px,var(--available-width))] gap-0 overflow-hidden p-0 motion-reduce:animate-none"
      >
        <Command
          tabIndex={showSearch ? undefined : 0}
          label={t`Add provider`}
          shouldFilter={false}
          loop
        >
          {showSearch ? (
            <ListSearchInput
              command
              inputRef={searchRef}
              query={query}
              setQuery={setQuery}
              label={t`Add provider`}
              placeholder={t`Search`}
            />
          ) : null}
          <CommandList className="rk-scroll max-h-80">
            <CommandEmpty>
              <Trans>No results</Trans>
            </CommandEmpty>
            <CommandGroup>
              {matching.map((provider) => (
                <CommandItem
                  key={`${provider.id}:${provider.baseUrl ?? ""}`}
                  value={`${provider.id}:${provider.baseUrl ?? ""}`}
                  onSelect={() => {
                    setOpen(false);
                    onPick(provider);
                  }}
                >
                  <span className="min-w-0 truncate">{provider.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** One row of a settings list that opens its own page. */
export function SettingsListRow({
  label,
  labelTestId,
  disabled,
  onClick,
  className,
  children,
}: {
  label: ReactNode;
  labelTestId?: string;
  disabled?: boolean;
  onClick: () => void;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex min-h-[52px] w-full items-center gap-2.5 py-2 ps-3 pe-3 text-start outline-none first:rounded-t-xl hover:bg-accent/50 focus-visible:ring-3 focus-visible:ring-ring/50",
        className,
      )}
    >
      <span
        data-testid={labelTestId}
        className="min-w-0 flex-1 truncate text-body-lg text-foreground"
      >
        {label}
      </span>
      {children}
      <ChevronRight className="size-4 shrink-0 text-muted-foreground rtl:rotate-180" aria-hidden />
    </button>
  );
}
