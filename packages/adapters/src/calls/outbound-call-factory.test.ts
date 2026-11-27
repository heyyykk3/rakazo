import { describe, expect, it } from "vitest";
import { selectBuiltinToolsForRun } from "../runs/tools/run-tool-selection.js";
import { createOutboundCallProvider } from "./outbound-call-factory.js";

describe("outbound call provider factory and tool selection", () => {
  it("stays disabled when OUTBOUND_CALL_PROVIDER is unset", () => {
    expect(createOutboundCallProvider({})).toBeUndefined();
    expect(createOutboundCallProvider({ OUTBOUND_CALL_PROVIDER: "none" })).toBeUndefined();
  });

  it("throws when twilio is selected without required credentials", () => {
    expect(() => createOutboundCallProvider({ OUTBOUND_CALL_PROVIDER: "twilio" })).toThrow(
      /TWILIO_ACCOUNT_SID/,
    );
  });

  it("creates the twilio provider when configured", () => {
    const provider = createOutboundCallProvider({
      OUTBOUND_CALL_PROVIDER: "twilio",
      TWILIO_ACCOUNT_SID: "AC_FAKE",
      TWILIO_AUTH_TOKEN: "fake_token",
      TWILIO_FROM_NUMBER: "+14155550199",
    });
    expect(provider?.id).toBe("twilio");
  });

  it("offers place_call only when outboundCallsEnabled is true in interactive runs", () => {
    const base = {
      graphicalToolsAllowed: false,
      groupId: null,
      trigger: "user",
      semanticMemoryEnabled: false,
      messagingChannelRun: false,
    };
    expect(
      selectBuiltinToolsForRun({ ...base, outboundCallsEnabled: false }).some(
        (t) => t.name === "place_call",
      ),
    ).toBe(false);
    expect(
      selectBuiltinToolsForRun({ ...base, outboundCallsEnabled: true }).some(
        (t) => t.name === "place_call",
      ),
    ).toBe(true);
    expect(
      selectBuiltinToolsForRun({
        ...base,
        trigger: "tickets",
        outboundCallsEnabled: true,
      }).some((t) => t.name === "place_call"),
    ).toBe(false);
  });
});
