import { createHmac, timingSafeEqual } from "node:crypto";

export type WebhookHeaderReader = (name: string) => string | undefined;

export interface WebhookPresetMatch {
  preset: "linear" | "sentry" | "pagerduty";
  verified: boolean;
}

function constantTimeHexEqual(receivedHex: string, expectedHex: string): boolean {
  const a = Buffer.from(receivedHex.trim().toLowerCase(), "utf8");
  const b = Buffer.from(expectedHex.trim().toLowerCase(), "utf8");
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

function hmacSha256Hex(secret: string, body: Uint8Array): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

/**
 * Verifies signed webhook deliveries from supported named presets (Linear, Sentry, PagerDuty).
 * Returns null when the request does not carry a preset signature header.
 */
export function verifyPresetWebhookSignature(
  header: WebhookHeaderReader,
  secret: string,
  body: Uint8Array,
): WebhookPresetMatch | null {
  const linearSig = header("linear-signature")?.trim();
  if (linearSig) {
    return {
      preset: "linear",
      verified: constantTimeHexEqual(linearSig, hmacSha256Hex(secret, body)),
    };
  }
  const sentrySig = header("sentry-hook-signature")?.trim();
  if (sentrySig) {
    return {
      preset: "sentry",
      verified: constantTimeHexEqual(sentrySig, hmacSha256Hex(secret, body)),
    };
  }
  const pagerDutySig = header("x-pagerduty-signature")?.trim();
  if (pagerDutySig) {
    const expected = hmacSha256Hex(secret, body);
    const verified = pagerDutySig
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part.startsWith("v1="))
      .some((part) => constantTimeHexEqual(part.slice(3), expected));
    return { preset: "pagerduty", verified };
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * Produces a concise structured heading for Linear, Sentry, or PagerDuty webhook deliveries
 * ahead of the untrusted payload, or null when the delivery is not a recognized preset.
 */
export function formatPresetWebhookSummary(
  header: WebhookHeaderReader,
  payload: Record<string, unknown>,
): string | null {
  if (header("linear-signature") || header("linear-event")) {
    const type = str(payload.type) ?? header("linear-event") ?? "Event";
    const action = str(payload.action);
    const data = asRecord(payload.data);
    const identifier = str(data?.identifier);
    const title = str(data?.title);
    const url = str(payload.url) ?? str(data?.url);
    const parts = [
      `Linear ${type}${action ? ` (${action})` : ""}`,
      identifier && title ? `${identifier}: ${title}` : (title ?? identifier),
      url,
    ].filter(Boolean);
    return parts.join(" | ");
  }
  if (header("sentry-hook-signature") || header("sentry-hook-resource")) {
    const resource = header("sentry-hook-resource") ?? "event";
    const action = str(payload.action);
    const data = asRecord(payload.data);
    const issue = asRecord(data?.issue) ?? asRecord(data?.event);
    const title = str(issue?.title) ?? str(data?.title);
    const level = str(issue?.level);
    const url = str(issue?.permalink) ?? str(issue?.web_url);
    const parts = [
      `Sentry ${resource}${action ? ` (${action})` : ""}`,
      level ? `[${level}]` : undefined,
      title,
      url,
    ].filter(Boolean);
    return parts.join(" | ");
  }
  if (header("x-pagerduty-signature") || asRecord(payload.event)?.event_type) {
    const event = asRecord(payload.event);
    const eventType = str(event?.event_type) ?? "incident";
    const data = asRecord(event?.data);
    const title = str(data?.title);
    const status = str(data?.status);
    const urgency = str(data?.urgency);
    const url = str(data?.html_url);
    const parts = [
      `PagerDuty ${eventType}`,
      urgency ? `[${urgency}]` : undefined,
      status ? `(${status})` : undefined,
      title,
      url,
    ].filter(Boolean);
    return parts.join(" | ");
  }
  return null;
}

export const SUPPORTED_WEBHOOK_PRESETS = ["linear", "sentry", "pagerduty"] as const;
