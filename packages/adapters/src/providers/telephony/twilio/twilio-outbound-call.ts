import type {
  AdapterContext,
  OutboundCallProvider,
  OutboundCallRequest,
  OutboundCallResult,
  OutboundCallStatus,
} from "@rakazo/adapter-kit";

const E164_PHONE = /^\+[1-9]\d{6,14}$/;
const MAX_SPOKEN_MESSAGE_CHARS = 1_500;
const TWILIO_API_ORIGIN = "https://api.twilio.com/2010-04-01";

export interface TwilioOutboundCallConfig {
  accountSid: string;
  authToken: string;
  fromNumber: string;
  apiOrigin?: string;
  fetch?: typeof fetch;
}

export function isE164PhoneNumber(value: string): boolean {
  return E164_PHONE.test(value.trim());
}

function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function buildSpokenTwiml(message: string): string {
  const clean = message.trim().slice(0, MAX_SPOKEN_MESSAGE_CHARS);
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Say>${escapeXml(clean)}</Say></Response>`;
}

/**
 * Places outbound voice phone calls via Twilio's Calls REST API using inline TwiML `<Say>`.
 * Uses native fetch with zero extra runtime dependencies.
 */
export function createTwilioOutboundCallProvider(
  config: TwilioOutboundCallConfig,
): OutboundCallProvider {
  const accountSid = config.accountSid.trim();
  const authToken = config.authToken.trim();
  const defaultFrom = config.fromNumber.trim();
  const apiOrigin = (config.apiOrigin ?? TWILIO_API_ORIGIN).replace(/\/+$/, "");
  const fetchFn = config.fetch ?? fetch;

  if (!accountSid || !authToken) {
    throw new Error("Twilio accountSid and authToken are required");
  }
  if (!isE164PhoneNumber(defaultFrom)) {
    throw new Error("Twilio fromNumber must be a valid E.164 phone number");
  }

  const authHeader = `Basic ${Buffer.from(`${accountSid}:${authToken}`, "utf8").toString("base64")}`;

  return {
    id: "twilio",

    async placeCall(
      request: OutboundCallRequest,
      ctx: AdapterContext,
    ): Promise<OutboundCallResult> {
      const to = request.to.trim();
      if (!isE164PhoneNumber(to)) {
        throw new Error("Destination phone number must be in E.164 format (e.g. +14155550100)");
      }
      const from = (request.from ?? defaultFrom).trim();
      if (!isE164PhoneNumber(from)) {
        throw new Error("Caller ID phone number must be in E.164 format");
      }
      const message = request.message.trim();
      if (!message) {
        throw new Error("A spoken message is required to place a call");
      }

      const body = new URLSearchParams({
        To: to,
        From: from,
        Twiml: buildSpokenTwiml(message),
      });

      const response = await fetchFn(
        `${apiOrigin}/Accounts/${encodeURIComponent(accountSid)}/Calls.json`,
        {
          method: "POST",
          headers: {
            Authorization: authHeader,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: body.toString(),
          signal: ctx.signal,
        },
      );

      const text = await response.text();
      if (!response.ok) {
        let detail = `HTTP ${response.status}`;
        try {
          const parsed = JSON.parse(text) as { message?: unknown };
          if (typeof parsed.message === "string" && parsed.message.trim()) {
            detail = parsed.message.trim();
          }
        } catch {
          // Keep HTTP status fallback when response is not JSON.
        }
        throw new Error(`Outbound call failed: ${detail}`);
      }

      const data = JSON.parse(text) as { sid?: unknown; status?: unknown };
      const callId = typeof data.sid === "string" ? data.sid : "";
      const status = typeof data.status === "string" ? data.status : "queued";
      if (!callId) {
        throw new Error("Outbound call response did not include a call id");
      }
      return { callId, status };
    },

    async getCallStatus(callId: string, ctx: AdapterContext): Promise<OutboundCallStatus> {
      const trimmed = callId.trim();
      if (!trimmed) throw new Error("callId is required");
      const response = await fetchFn(
        `${apiOrigin}/Accounts/${encodeURIComponent(accountSid)}/Calls/${encodeURIComponent(trimmed)}.json`,
        {
          method: "GET",
          headers: { Authorization: authHeader },
          signal: ctx.signal,
        },
      );
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`Outbound call status check failed: HTTP ${response.status}`);
      }
      const data = JSON.parse(text) as {
        sid?: unknown;
        status?: unknown;
        duration?: unknown;
      };
      const parsedDuration =
        typeof data.duration === "string" && /^\d+$/.test(data.duration)
          ? Number.parseInt(data.duration, 10)
          : typeof data.duration === "number" && Number.isFinite(data.duration)
            ? Math.max(0, Math.round(data.duration))
            : undefined;
      return {
        callId: typeof data.sid === "string" ? data.sid : trimmed,
        status: typeof data.status === "string" ? data.status : "unknown",
        ...(parsedDuration !== undefined ? { durationSeconds: parsedDuration } : {}),
      };
    },
  };
}
