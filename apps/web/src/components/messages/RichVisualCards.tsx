import { Trans, useLingui } from "@lingui/react/macro";
import type { MessageBlock, WeatherIcon } from "@rakazo/contracts";
import {
  Cloud,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  ExternalLink,
  MapPin,
  Maximize2,
  Minimize2,
  Sun,
  Wind,
} from "lucide-react";
import { useMemo, useState } from "react";
import { SandboxedHtmlViewer } from "./SandboxedHtmlViewer";

type WeatherBlock = Extract<MessageBlock, { kind: "weather" }>;
type PlacesBlock = Extract<MessageBlock, { kind: "places" }>;
type InlineHtmlBlock = Extract<MessageBlock, { kind: "inline_html" }>;

function safeHttpUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : undefined;
  } catch {
    return undefined;
  }
}

function WeatherGlyph({ icon, className = "size-5" }: { icon?: WeatherIcon; className?: string }) {
  switch (icon) {
    case "sun":
      return <Sun className={className} aria-hidden="true" />;
    case "partly_cloudy":
      return <CloudSun className={className} aria-hidden="true" />;
    case "rain":
      return <CloudRain className={className} aria-hidden="true" />;
    case "snow":
      return <CloudSnow className={className} aria-hidden="true" />;
    case "storm":
      return <CloudLightning className={className} aria-hidden="true" />;
    case "wind":
      return <Wind className={className} aria-hidden="true" />;
    case "fog":
      return <CloudFog className={className} aria-hidden="true" />;
    default:
      return <Cloud className={className} aria-hidden="true" />;
  }
}

/** Structured weather summary card with optional multi-day forecast. */
export function WeatherCard({ block }: { block: WeatherBlock }) {
  return (
    <div
      data-testid="weather-card"
      className="w-full max-w-md overflow-hidden rounded-2xl border border-border bg-card p-4 text-foreground"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-body font-medium text-muted-foreground" dir="auto">
            {block.location}
          </div>
          <div className="mt-0.5 text-heading1 font-semibold tabular-nums">{block.temperature}</div>
          <div className="text-body-sm text-muted-foreground" dir="auto">
            {block.condition}
          </div>
        </div>
        <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-muted text-foreground">
          <WeatherGlyph icon={block.icon} className="size-6" />
        </div>
      </div>
      {block.high || block.low || block.humidity || block.wind ? (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-caption text-muted-foreground">
          {block.high ? <span>{`H: ${block.high}`}</span> : null}
          {block.low ? <span>{`L: ${block.low}`}</span> : null}
          {block.humidity ? (
            <span>
              <Trans>Humidity {block.humidity}</Trans>
            </span>
          ) : null}
          {block.wind ? (
            <span>
              <Trans>Wind {block.wind}</Trans>
            </span>
          ) : null}
        </div>
      ) : null}
      {block.forecast && block.forecast.length > 0 ? (
        <div className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(56px,1fr))] gap-2 border-t border-border/60 pt-3 text-center">
          {block.forecast.map((day, idx) => (
            <div key={`${day.day}-${idx}`} className="flex flex-col items-center gap-1">
              <span className="text-caption text-muted-foreground">{day.day}</span>
              <WeatherGlyph icon={day.icon} className="size-4 text-foreground/80" />
              <span className="text-caption font-medium tabular-nums">{day.high}</span>
              {day.low ? (
                <span className="text-caption tabular-nums text-muted-foreground">{day.low}</span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Interactive coordinate map + selectable place rows (works offline with zero API keys). */
export function PlacesCard({ block }: { block: PlacesBlock }) {
  const { t } = useLingui();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const pins = useMemo(() => {
    const withCoords = block.items
      .map((item, index) => ({ item, index }))
      .filter(
        (
          entry,
        ): entry is {
          item: PlacesBlock["items"][number] & { lat: number; lng: number };
          index: number;
        } => typeof entry.item.lat === "number" && typeof entry.item.lng === "number",
      );
    if (withCoords.length === 0) return [];
    const lats = withCoords.map((p) => p.item.lat);
    const lngs = withCoords.map((p) => p.item.lng);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    const latSpan = Math.max(0.005, maxLat - minLat);
    const lngSpan = Math.max(0.005, maxLng - minLng);
    return withCoords.map(({ item, index }) => ({
      index,
      name: item.name,
      lat: item.lat,
      lng: item.lng,
      x: withCoords.length === 1 ? 160 : 32 + ((item.lng - minLng) / lngSpan) * 256,
      y: withCoords.length === 1 ? 70 : 116 - ((item.lat - minLat) / latSpan) * 92,
    }));
  }, [block.items]);

  const activePlace = block.items[selectedIndex] ?? block.items[0];
  const osmUrl =
    activePlace && typeof activePlace.lat === "number" && typeof activePlace.lng === "number"
      ? `https://www.openstreetmap.org/?mlat=${activePlace.lat}&mlon=${activePlace.lng}#map=15/${activePlace.lat}/${activePlace.lng}`
      : undefined;

  return (
    <div
      data-testid="places-card"
      className="w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-card text-foreground"
    >
      {block.title ? (
        <div className="flex items-center justify-between gap-2 border-b border-border/60 px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-1.5 text-body-sm font-medium">
            <MapPin className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="truncate" dir="auto">
              {block.title}
            </span>
          </div>
          {osmUrl ? (
            <a
              href={osmUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex shrink-0 items-center gap-1 text-caption text-muted-foreground hover:text-foreground"
            >
              <Trans>Open map</Trans>
              <ExternalLink className="size-3" aria-hidden="true" />
            </a>
          ) : null}
        </div>
      ) : null}
      {pins.length > 0 ? (
        <div className="border-b border-border/60 bg-muted/40 px-3 py-2">
          <div className="relative h-36 w-full overflow-hidden rounded-lg bg-background/60">
            <svg viewBox="0 0 320 140" aria-hidden="true" className="pointer-events-none size-full">
              <g stroke="currentColor" strokeOpacity="0.08" strokeWidth="1">
                <line x1="0" y1="35" x2="320" y2="35" />
                <line x1="0" y1="70" x2="320" y2="70" />
                <line x1="0" y1="105" x2="320" y2="105" />
                <line x1="80" y1="0" x2="80" y2="140" />
                <line x1="160" y1="0" x2="160" y2="140" />
                <line x1="240" y1="0" x2="240" y2="140" />
              </g>
            </svg>
            {pins.map((pin) => {
              const active = pin.index === selectedIndex;
              return (
                <button
                  key={pin.index}
                  type="button"
                  aria-label={pin.name}
                  aria-pressed={active}
                  onClick={() => setSelectedIndex(pin.index)}
                  style={{
                    left: `${(pin.x / 320) * 100}%`,
                    top: `${(pin.y / 140) * 100}%`,
                  }}
                  className={`absolute grid -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full font-semibold transition-transform focus-visible:outline-2 focus-visible:outline-ring ${
                    active
                      ? "z-10 size-6 scale-110 bg-primary text-caption text-primary-foreground shadow-sm"
                      : "size-5 bg-muted-foreground/80 text-caption text-background hover:scale-105"
                  }`}
                >
                  {pin.index + 1}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
      <ul className="divide-y divide-border/60">
        {block.items.map((item, index) => {
          const href = safeHttpUrl(item.url);
          const selected = index === selectedIndex;
          return (
            <li
              key={`${item.name}-${index}`}
              className={`flex items-start gap-3 px-4 py-2.5 transition-colors ${
                selected ? "bg-accent/40" : "hover:bg-accent/20"
              }`}
            >
              <button
                type="button"
                onClick={() => setSelectedIndex(index)}
                className="flex min-w-0 flex-1 items-start gap-2.5 text-start focus-visible:outline-2 focus-visible:outline-ring"
              >
                <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-muted text-caption font-medium text-foreground">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body font-medium" dir="auto">
                    {item.name}
                  </span>
                  <span className="mt-0.5 flex flex-wrap gap-x-2 text-caption text-muted-foreground">
                    {item.category ? <span>{item.category}</span> : null}
                    {item.rating ? <span>★ {item.rating}</span> : null}
                    {item.priceLevel ? <span>{item.priceLevel}</span> : null}
                    {item.distance ? <span>{item.distance}</span> : null}
                  </span>
                  {item.address ? (
                    <span className="mt-0.5 block truncate text-caption text-muted-foreground/80">
                      {item.address}
                    </span>
                  ) : null}
                </span>
              </button>
              {href ? (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={t`Open ${item.name}`}
                  className="mt-1 shrink-0 text-muted-foreground hover:text-foreground"
                >
                  <ExternalLink className="size-3.5" aria-hidden="true" />
                </a>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Compact sandboxed inline HTML preview card inside chat. */
export function InlineHtmlCard({ block }: { block: InlineHtmlBlock }) {
  const { t } = useLingui();
  const [expanded, setExpanded] = useState(false);
  const frameHeight = expanded ? 520 : (block.height ?? 260);
  return (
    <div
      data-testid="inline-html-card"
      className="w-full overflow-hidden rounded-2xl border border-border bg-card"
    >
      <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3.5 py-2">
        <span className="truncate text-body-sm font-medium text-foreground" dir="auto">
          {block.title}
        </span>
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          aria-label={expanded ? t`Shrink preview` : t`Expand preview`}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-caption text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          {expanded ? (
            <Minimize2 className="size-3.5" aria-hidden="true" />
          ) : (
            <Maximize2 className="size-3.5" aria-hidden="true" />
          )}
          <span>{expanded ? <Trans>Compact</Trans> : <Trans>Expand</Trans>}</span>
        </button>
      </div>
      <div style={{ height: `${frameHeight}px` }} className="w-full">
        <SandboxedHtmlViewer
          html={block.html}
          title={block.title}
          className="h-full w-full bg-white"
        />
      </div>
    </div>
  );
}
