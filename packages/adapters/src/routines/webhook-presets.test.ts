import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { formatPresetWebhookSummary, verifyPresetWebhookSignature } from "./webhook-presets.js";

function headersOf(map: Record<string, string>) {
  const lower = Object.fromEntries(Object.entries(map).map(([k, v]) => [k.toLowerCase(), v]));
  return (name: string) => lower[name.toLowerCase()];
}

describe("named webhook trigger presets", () => {
  const secret = "test-webhook-secret";

  it("verifies Linear HMAC-SHA256 signatures and formats a tidy summary", () => {
    const payload = {
      type: "Issue",
      action: "create",
      url: "https://linear.app/acme/issue/ENG-42",
      data: { identifier: "ENG-42", title: "Fix billing sync" },
    };
    const body = new TextEncoder().encode(JSON.stringify(payload));
    const sig = createHmac("sha256", secret).update(body).digest("hex");
    const header = headersOf({ "Linear-Signature": sig, "Linear-Event": "Issue" });

    expect(verifyPresetWebhookSignature(header, secret, body)).toEqual({
      preset: "linear",
      verified: true,
    });
    expect(verifyPresetWebhookSignature(header, "wrong-secret", body)).toEqual({
      preset: "linear",
      verified: false,
    });
    expect(formatPresetWebhookSummary(header, payload)).toContain(
      "Linear Issue (create) | ENG-42: Fix billing sync",
    );
  });

  it("verifies Sentry HMAC-SHA256 signatures and formats a tidy summary", () => {
    const payload = {
      action: "created",
      data: {
        issue: {
          title: "TypeError: Cannot read properties of undefined",
          level: "error",
          permalink: "https://sentry.io/issues/999/",
        },
      },
    };
    const body = new TextEncoder().encode(JSON.stringify(payload));
    const sig = createHmac("sha256", secret).update(body).digest("hex");
    const header = headersOf({ "Sentry-Hook-Signature": sig, "Sentry-Hook-Resource": "issue" });

    expect(verifyPresetWebhookSignature(header, secret, body)).toEqual({
      preset: "sentry",
      verified: true,
    });
    expect(formatPresetWebhookSummary(header, payload)).toContain("Sentry issue (created)");
  });

  it("verifies PagerDuty v1 signatures and formats a tidy summary", () => {
    const payload = {
      event: {
        event_type: "incident.triggered",
        data: {
          title: "High error rate on API",
          status: "triggered",
          urgency: "high",
          html_url: "https://acme.pagerduty.com/incidents/P123",
        },
      },
    };
    const body = new TextEncoder().encode(JSON.stringify(payload));
    const sig = createHmac("sha256", secret).update(body).digest("hex");
    const header = headersOf({ "X-PagerDuty-Signature": `v1=deadbeef,v1=${sig}` });

    expect(verifyPresetWebhookSignature(header, secret, body)).toEqual({
      preset: "pagerduty",
      verified: true,
    });
    expect(formatPresetWebhookSummary(header, payload)).toContain(
      "PagerDuty incident.triggered | [high] | (triggered) | High error rate on API",
    );
  });
});
