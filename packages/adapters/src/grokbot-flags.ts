/**
 * Fork feature switches. `RAKAZO_GROKBOT` is "all", "off", or a comma list of features.
 * Unset keeps upstream behaviour everywhere, so the fork rebases with its flags off.
 */
export type GrokbotFeature =
  | "prompt"
  | "quiet"
  | "stop"
  | "compaction"
  | "gates"
  | "fence"
  | "memory"
  | "codemode";

export function grokbotEnabled(
  feature: GrokbotFeature,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = env.RAKAZO_GROKBOT?.trim().toLowerCase();
  if (!raw || raw === "off") return false;
  const features = raw.split(/[\s,]+/);
  return features.includes("all") || features.includes(feature);
}
