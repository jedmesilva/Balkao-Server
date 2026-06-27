import type { LLMProvider } from "./types";
import { OpenAIProvider } from "./providers/openai";

const providers = new Map<string, LLMProvider>();

export function registerProvider(provider: LLMProvider): void {
  providers.set(provider.name, provider);
}

export function getProvider(name: string): LLMProvider {
  const provider = providers.get(name);
  if (!provider) {
    throw new Error(
      `LLM provider "${name}" is not registered. Available: ${[...providers.keys()].join(", ")}`,
    );
  }
  return provider;
}

export function getDefaultProvider(): LLMProvider {
  const name = process.env.LLM_PROVIDER ?? "openai";
  return getProvider(name);
}

export function initProviders(): void {
  registerProvider(new OpenAIProvider());
}
