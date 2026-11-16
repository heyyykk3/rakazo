import type { MutableModels } from "@earendil-works/pi-ai";

/**
 * Fork addition: route the built-in Anthropic catalog to an Anthropic Messages-compatible
 * endpoint, such as Azure AI Foundry's `https://<resource>.services.ai.azure.com/anthropic`.
 * Unset keeps Pi's catalog default (api.anthropic.com). The Anthropic SDK appends
 * `/v1/messages`, so a trailing `/v1` is dropped.
 */
export function applyAnthropicBaseUrl(
  models: MutableModels,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const raw = env.ANTHROPIC_BASE_URL?.trim();
  if (!raw) return;
  let baseUrl: string;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return;
    url.pathname = url.pathname.replace(/\/v1\/*$/, "");
    baseUrl = url.toString().replace(/\/$/, "");
  } catch {
    return;
  }
  const provider = models.getProvider?.("anthropic");
  if (!provider) return;
  const routed = provider.getModels().map((model) => ({ ...model, baseUrl }));
  models.setProvider({ ...provider, getModels: () => routed });
}
