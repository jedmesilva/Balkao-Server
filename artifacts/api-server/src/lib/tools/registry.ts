import type { Tool } from "./types";
import { logger } from "../logger";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tools = new Map<string, Tool<any, any>>();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerTool(tool: Tool<any, any>): void {
  tools.set(tool.name, tool);
  logger.info({ tool: tool.name }, "Tool registered");
}

export function unregisterTool(name: string): void {
  if (tools.delete(name)) {
    logger.info({ tool: name }, "Tool unregistered");
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getTool(name: string): Tool<any, any> | undefined {
  return tools.get(name);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getTools(): Tool<any, any>[] {
  return [...tools.values()];
}

export function hasTools(): boolean {
  return tools.size > 0;
}
