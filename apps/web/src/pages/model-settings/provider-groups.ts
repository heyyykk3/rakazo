import type { ModelCredential } from "../../lib/model-auth";

/** Group hosted connections for display without changing their routing or credentials. */
export function groupProviderConnections(
  credentials: ModelCredential[],
  nameOf: (credential: ModelCredential) => string,
) {
  const groups = new Map<
    string,
    {
      id: string;
      name: string;
      grouped: boolean;
      credentials: ModelCredential[];
    }
  >();
  for (const credential of credentials) {
    let hostname = "";
    try {
      hostname = new URL(credential.baseUrl ?? "").hostname;
    } catch {
      // Built-in providers need no custom endpoint.
    }
    const bedrock =
      credential.provider === "amazon-bedrock" ||
      (/^bedrock-(runtime|mantle)\./.test(hostname) &&
        (hostname.endsWith(".amazonaws.com") || hostname.endsWith(".api.aws")));
    const azure =
      credential.provider === "azure" ||
      hostname.endsWith(".openai.azure.com") ||
      hostname.endsWith(".services.ai.azure.com");
    const family = bedrock ? "AWS Bedrock" : azure ? "Azure" : null;
    const id = family ? `hosted:${family}` : credential.id;
    const group = groups.get(id) ?? {
      id,
      name: family ?? nameOf(credential),
      grouped: family !== null,
      credentials: [],
    };
    group.credentials.push(credential);
    groups.set(id, group);
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
}
