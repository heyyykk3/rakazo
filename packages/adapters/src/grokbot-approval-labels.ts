import { grokbotEnabled } from "./grokbot-flags.js";

/**
 * Fork: what an approval card asks, in the person's words rather than a tool name. Undefined
 * keeps upstream's wording.
 */
export function grokbotApprovalQuestion(
  toolName: string,
  args: Record<string, unknown>,
  site: string | undefined,
): string | undefined {
  if (!grokbotEnabled("gates")) return undefined;
  const text = (value: unknown) =>
    typeof value === "string" && value.trim() ? value.trim().slice(0, 80) : undefined;
  const quoted = (value: unknown) => (text(value) ? ` “${text(value)}”` : "");
  const recipients = (value: unknown) =>
    Array.isArray(value) ? value.map(String).join(", ") : text(value);
  switch (toolName) {
    case "schedule_create":
    case "create_child_routine":
      return `Create the routine${quoted(args.name)}?`;
    case "schedule_update":
      return `Change the routine${quoted(args.name)}?`;
    case "schedule_cancel":
      return "Cancel a routine?";
    case "send_email": {
      const to = recipients(args.to);
      return to ? `Send an email to ${to}?` : "Send an email?";
    }
    case "delete_email":
      return "Delete an email?";
    case "web_fetch":
      return site ? `Open ${site}?` : "Open a web page?";
    case "paid_request":
      return site ? `Pay for a request to ${site}?` : "Pay for a request?";
    case "request_purchase":
      return "Make a purchase?";
    case "remember":
    case "save_memory":
    case "save_shared_memory":
      return "Save this to memory?";
    case "shell":
      return "Run a command on the bot's computer?";
    case "browser_act":
    case "computer_act":
      return site ? `Act on ${site}?` : "Act on the screen?";
    case "message_bot":
      return `Message ${text(args.confirm_name) ?? "another bot"}?`;
    case "message_agent":
      return "Message a connected agent?";
    case "spawn_bot":
      return `Create the bot${quoted(args.name)}?`;
    case "update_bot":
      return "Change a bot's settings?";
    case "archive_bot":
      return `Archive${quoted(args.confirm_name ?? args.confirmName) || " a bot"}?`;
    case "connect_app":
      return "Connect an app?";
    case "add_mcp_server":
      return "Add a tool server?";
  }
  // Connected apps name actions like GMAIL_SEND_EMAIL: say "Gmail: send email".
  const parts = toolName.split(/[_-]+/).filter(Boolean);
  if (parts.length > 1 && toolName === toolName.toUpperCase()) {
    const app = parts[0]!.charAt(0) + parts[0]!.slice(1).toLowerCase();
    return `${app}: ${parts.slice(1).join(" ").toLowerCase()}?`;
  }
  const words = toolName.replace(/[_-]+/g, " ").trim();
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}?`;
}
