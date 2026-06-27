import { getTool } from "./registry";
import type { ToolCallRequest, ToolCallResult } from "./types";
import { logger } from "../logger";

export async function executeTool(call: ToolCallRequest): Promise<ToolCallResult> {
  const tool = getTool(call.name);

  if (!tool) {
    logger.warn({ tool: call.name }, "Tool not found");
    return {
      id: call.id,
      name: call.name,
      result: null,
      error: `Tool "${call.name}" is not registered.`,
    };
  }

  logger.info({ tool: call.name, args: call.arguments }, "Executing tool");

  try {
    const result = await tool.execute(call.arguments);
    logger.info({ tool: call.name }, "Tool executed successfully");
    return { id: call.id, name: call.name, result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ tool: call.name, err }, "Tool execution failed");
    return { id: call.id, name: call.name, result: null, error: message };
  }
}

export async function executeTools(calls: ToolCallRequest[]): Promise<ToolCallResult[]> {
  return Promise.all(calls.map(executeTool));
}
