import type { AdapterContext } from "@rakazo/adapter-kit";
import { describe, expect, it, vi } from "vitest";
import {
  buildSpokenTwiml,
  createTwilioOutboundCallProvider,
  isE164PhoneNumber,
} from "./twilio-outbound-call.js";

const ctx: AdapterContext = {
  operationId: "op-call-1",
  traceId: "trace-1",
  spaceId: "space-1",
  userId: "user-1",
  botId: "bot-1",
  signal: new AbortController().signal,
};

describe("twilio outbound call provider", () => {
  it("escapes XML special characters in spoken TwiML", () => {
    expect(buildSpokenTwiml(`Hi <Sam> & "friends" — it's 5pm`)).toBe(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Say>Hi &lt;Sam&gt; &amp; &quot;friends&quot; — it&apos;s 5pm</Say></Response>`,
    );
  });

  it("validates E.164 phone numbers", () => {
    expect(isE164PhoneNumber("+14155550100")).toBe(true);
    expect(isE164PhoneNumber("415-555-0100")).toBe(false);
    expect(isE164PhoneNumber("+01234567")).toBe(false);
  });

  it("places a call via the Calls REST API with Basic Auth and TwiML", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ sid: "CA1234567890", status: "queued" }), { status: 201 }),
    ) as unknown as typeof fetch;

    const provider = createTwilioOutboundCallProvider({
      accountSid: "AC_FAKE_ACCOUNT",
      authToken: "fake_auth_token",
      fromNumber: "+14155550199",
      fetch: fetchMock,
    });

    const result = await provider.placeCall(
      { to: "+14155550100", message: "Checking your 7pm reservation & table." },
      ctx,
    );

    expect(result).toEqual({ callId: "CA1234567890", status: "queued" });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = vi.mocked(fetchMock).mock.calls[0]!;
    expect(url).toBe("https://api.twilio.com/2010-04-01/Accounts/AC_FAKE_ACCOUNT/Calls.json");
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string> | undefined)?.Authorization).toBe(
      `Basic ${Buffer.from("AC_FAKE_ACCOUNT:fake_auth_token").toString("base64")}`,
    );
    const params = new URLSearchParams(String(init?.body));
    expect(params.get("To")).toBe("+14155550100");
    expect(params.get("From")).toBe("+14155550199");
    expect(params.get("Twiml")).toContain("&amp; table.");
  });

  it("rejects non-E.164 numbers before making a network call", async () => {
    const fetchMock = vi.fn() as unknown as typeof fetch;
    const provider = createTwilioOutboundCallProvider({
      accountSid: "AC_FAKE_ACCOUNT",
      authToken: "fake_auth_token",
      fromNumber: "+14155550199",
      fetch: fetchMock,
    });

    await expect(provider.placeCall({ to: "555-0100", message: "Hello" }, ctx)).rejects.toThrow(
      /E\.164/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reads call status and duration", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ sid: "CA1234567890", status: "completed", duration: "42" }), {
          status: 200,
        }),
    ) as unknown as typeof fetch;
    const provider = createTwilioOutboundCallProvider({
      accountSid: "AC_FAKE_ACCOUNT",
      authToken: "fake_auth_token",
      fromNumber: "+14155550199",
      fetch: fetchMock,
    });

    const status = await provider.getCallStatus!("CA1234567890", ctx);
    expect(status).toEqual({
      callId: "CA1234567890",
      status: "completed",
      durationSeconds: 42,
    });
  });

  it("surfaces provider error messages on non-2xx responses", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ message: "Destination number is not verified" }), {
          status: 400,
        }),
    ) as unknown as typeof fetch;
    const provider = createTwilioOutboundCallProvider({
      accountSid: "AC_FAKE_ACCOUNT",
      authToken: "fake_auth_token",
      fromNumber: "+14155550199",
      fetch: fetchMock,
    });

    await expect(provider.placeCall({ to: "+14155550100", message: "Hello" }, ctx)).rejects.toThrow(
      "Destination number is not verified",
    );
  });
});
