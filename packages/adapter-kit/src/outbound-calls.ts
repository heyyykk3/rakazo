import type { AdapterContext } from "./types.js";

/** Request to place an automated outbound voice phone call to a phone number. */
export interface OutboundCallRequest {
  /** Destination phone number in E.164 format (for example "+14155550100"). */
  to: string;
  /** Short message spoken when the call is answered. */
  message: string;
  /** Optional bot name included in provider metadata when supported. */
  botName?: string;
  /** Optional verified caller ID number override. */
  from?: string;
}

export interface OutboundCallResult {
  callId: string;
  status: string;
}

export interface OutboundCallStatus {
  callId: string;
  status: string;
  durationSeconds?: number;
}

/** Provider-neutral interface for placing outbound PSTN phone calls. */
export interface OutboundCallProvider {
  readonly id: string;
  placeCall(request: OutboundCallRequest, ctx: AdapterContext): Promise<OutboundCallResult>;
  getCallStatus?(callId: string, ctx: AdapterContext): Promise<OutboundCallStatus>;
}
