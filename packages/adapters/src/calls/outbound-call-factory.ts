import type { OutboundCallProvider } from "@rakazo/adapter-kit";
import { createTwilioOutboundCallProvider } from "../providers/telephony/twilio/twilio-outbound-call.js";

/**
 * Creates the configured outbound phone call provider from process environment variables.
 * Off by default when `OUTBOUND_CALL_PROVIDER` is unset.
 */
export function createOutboundCallProvider(
  env: NodeJS.ProcessEnv = process.env,
): OutboundCallProvider | undefined {
  const provider = env.OUTBOUND_CALL_PROVIDER?.trim().toLowerCase();
  if (!provider || provider === "none") return undefined;
  if (provider === "twilio") {
    const accountSid = env.TWILIO_ACCOUNT_SID?.trim();
    const authToken = env.TWILIO_AUTH_TOKEN?.trim();
    const fromNumber = env.TWILIO_FROM_NUMBER?.trim();
    if (!accountSid || !authToken || !fromNumber) {
      throw new Error(
        "OUTBOUND_CALL_PROVIDER=twilio requires TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER",
      );
    }
    return createTwilioOutboundCallProvider({ accountSid, authToken, fromNumber });
  }
  throw new Error(`Unknown OUTBOUND_CALL_PROVIDER: ${provider}`);
}
