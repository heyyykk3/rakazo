import type { MessageBlock } from "@rakazo/contracts";
import { fontWeight, typeScale } from "@rakazo/ui-tokens";
import { Image, Linking, Pressable, ScrollView, Text, View } from "react-native";
import { mobileTokens } from "../../lib/appearance/appearance";

type ResultCardsBlock = Extract<MessageBlock, { kind: "result_cards" }>;
type StatusCardBlock = Extract<MessageBlock, { kind: "card" }>;
type WeatherBlock = Extract<MessageBlock, { kind: "weather" }>;
type PlacesBlock = Extract<MessageBlock, { kind: "places" }>;
type InlineHtmlBlock = Extract<MessageBlock, { kind: "inline_html" }>;

export function StatusCard({ block }: { block: StatusCardBlock }) {
  const tokens = mobileTokens();
  return (
    <View
      style={{
        borderRadius: 16,
        backgroundColor: tokens.muted,
        paddingHorizontal: 16,
        paddingVertical: 12,
        gap: 6,
      }}
    >
      {block.lines.map((line) => (
        <View key={line.k} style={{ flexDirection: "row", gap: 8, alignItems: "baseline" }}>
          <Text style={{ color: tokens.foreground, fontWeight: fontWeight.semibold }}>
            {line.k}
          </Text>
          <Text style={{ color: tokens.mutedForeground }}>→</Text>
          <Text style={{ color: tokens.foreground, flexShrink: 1 }}>{line.v}</Text>
        </View>
      ))}
    </View>
  );
}

function safeExternalUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : undefined;
  } catch {
    return undefined;
  }
}

export function ResultCards({ block }: { block: ResultCardsBlock }) {
  const tokens = mobileTokens();
  return (
    <View style={{ width: "100%", gap: 8 }}>
      {block.title ? (
        <Text
          style={{
            fontSize: typeScale.secondary.fontSize,
            lineHeight: typeScale.secondary.lineHeight,
            fontWeight: fontWeight.medium,
            color: tokens.mutedForeground,
          }}
        >
          {block.title}
        </Text>
      ) : null}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 10, paddingVertical: 2 }}
      >
        {block.items.map((item, index) => {
          const href = safeExternalUrl(item.url);
          const imageSrc = safeExternalUrl(item.imageUrl);
          return (
            <Pressable
              key={`${item.title}-${index}`}
              disabled={!href}
              onPress={() => {
                if (href) void Linking.openURL(href);
              }}
              style={{
                width: 224,
                borderRadius: 16,
                borderWidth: 1,
                borderColor: tokens.border,
                backgroundColor: tokens.card,
                overflow: "hidden",
              }}
            >
              {imageSrc ? (
                <Image
                  source={{ uri: imageSrc }}
                  style={{ width: "100%", height: 120, backgroundColor: tokens.muted }}
                  resizeMode="cover"
                />
              ) : null}
              <View style={{ padding: 12, gap: 4 }}>
                <Text
                  numberOfLines={2}
                  style={{
                    fontSize: typeScale.body.fontSize,
                    lineHeight: typeScale.body.lineHeight,
                    fontWeight: fontWeight.semibold,
                    color: tokens.foreground,
                  }}
                >
                  {item.title}
                </Text>
                {item.subtitle ? (
                  <Text
                    numberOfLines={2}
                    style={{
                      fontSize: typeScale.secondary.fontSize,
                      lineHeight: typeScale.secondary.lineHeight,
                      color: tokens.mutedForeground,
                    }}
                  >
                    {item.subtitle}
                  </Text>
                ) : null}
                {item.price || item.rating ? (
                  <View style={{ flexDirection: "row", gap: 8, paddingTop: 2 }}>
                    {item.price ? (
                      <Text
                        style={{
                          fontSize: typeScale.secondary.fontSize,
                          fontWeight: fontWeight.semibold,
                          color: tokens.foreground,
                        }}
                      >
                        {item.price}
                      </Text>
                    ) : null}
                    {item.rating ? (
                      <Text
                        style={{
                          fontSize: typeScale.secondary.fontSize,
                          color: tokens.mutedForeground,
                        }}
                      >
                        {item.rating}
                      </Text>
                    ) : null}
                  </View>
                ) : null}
                {item.meta ? (
                  <Text
                    numberOfLines={1}
                    style={{
                      fontSize: typeScale.caption.fontSize,
                      color: tokens.mutedForeground,
                    }}
                  >
                    {item.meta}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

export function WeatherCard({ block }: { block: WeatherBlock }) {
  const tokens = mobileTokens();
  return (
    <View
      style={{
        borderRadius: 16,
        borderWidth: 1,
        borderColor: tokens.border,
        backgroundColor: tokens.card,
        padding: 14,
        gap: 6,
      }}
    >
      <Text style={{ fontSize: typeScale.secondary.fontSize, color: tokens.mutedForeground }}>
        {block.location}
      </Text>
      <Text
        style={{
          fontSize: typeScale.title.fontSize,
          lineHeight: typeScale.title.lineHeight,
          fontWeight: fontWeight.semibold,
          color: tokens.foreground,
        }}
      >
        {block.temperature}
      </Text>
      <Text style={{ fontSize: typeScale.secondary.fontSize, color: tokens.mutedForeground }}>
        {block.condition}
      </Text>
      {block.high || block.low ? (
        <Text style={{ fontSize: typeScale.caption.fontSize, color: tokens.mutedForeground }}>
          {[block.high ? `H: ${block.high}` : "", block.low ? `L: ${block.low}` : ""]
            .filter(Boolean)
            .join(", ")}
        </Text>
      ) : null}
    </View>
  );
}

export function PlacesCard({ block }: { block: PlacesBlock }) {
  const tokens = mobileTokens();
  return (
    <View
      style={{
        borderRadius: 16,
        borderWidth: 1,
        borderColor: tokens.border,
        backgroundColor: tokens.card,
        overflow: "hidden",
      }}
    >
      {block.title ? (
        <View
          style={{
            paddingHorizontal: 14,
            paddingVertical: 10,
            borderBottomWidth: 1,
            borderBottomColor: tokens.border,
          }}
        >
          <Text
            style={{
              fontSize: typeScale.secondary.fontSize,
              fontWeight: fontWeight.semibold,
              color: tokens.foreground,
            }}
          >
            {block.title}
          </Text>
        </View>
      ) : null}
      {block.items.map((item, index) => {
        const href =
          safeExternalUrl(item.url) ??
          (typeof item.lat === "number" && typeof item.lng === "number"
            ? `https://www.openstreetmap.org/?mlat=${item.lat}&mlon=${item.lng}#map=15/${item.lat}/${item.lng}`
            : undefined);
        return (
          <Pressable
            key={`${item.name}-${index}`}
            disabled={!href}
            onPress={() => {
              if (href) void Linking.openURL(href);
            }}
            style={{
              paddingHorizontal: 14,
              paddingVertical: 10,
              gap: 2,
              borderTopWidth: index > 0 ? 1 : 0,
              borderTopColor: tokens.border,
            }}
          >
            <Text
              style={{
                fontSize: typeScale.body.fontSize,
                fontWeight: fontWeight.semibold,
                color: tokens.foreground,
              }}
            >
              {`${index + 1}. ${item.name}`}
            </Text>
            {item.category || item.rating || item.priceLevel ? (
              <Text style={{ fontSize: typeScale.caption.fontSize, color: tokens.mutedForeground }}>
                {[item.category, item.rating ? `★ ${item.rating}` : "", item.priceLevel]
                  .filter(Boolean)
                  .join(", ")}
              </Text>
            ) : null}
            {item.address ? (
              <Text style={{ fontSize: typeScale.caption.fontSize, color: tokens.mutedForeground }}>
                {item.address}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

export function InlineHtmlSummaryCard({ block }: { block: InlineHtmlBlock }) {
  const tokens = mobileTokens();
  return (
    <View
      style={{
        borderRadius: 16,
        borderWidth: 1,
        borderColor: tokens.border,
        backgroundColor: tokens.card,
        padding: 14,
        gap: 4,
      }}
    >
      <Text
        style={{
          fontSize: typeScale.body.fontSize,
          fontWeight: fontWeight.semibold,
          color: tokens.foreground,
        }}
      >
        {block.title}
      </Text>
      <Text style={{ fontSize: typeScale.caption.fontSize, color: tokens.mutedForeground }}>
        Open on web or desktop to view interactive HTML preview.
      </Text>
    </View>
  );
}
