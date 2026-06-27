import { getAgents } from "./registry";
import type { AgentContext, AgentResult } from "./types";
import { logger } from "../logger";

export async function routeMessage(context: AgentContext): Promise<AgentResult> {
  const agents = getAgents();

  if (agents.length === 0) {
    logger.warn({ from: context.from }, "No agents registered, message unhandled");
    return { handled: false };
  }

  for (const agent of agents) {
    let canHandle: boolean;

    try {
      canHandle = await Promise.resolve(agent.canHandle(context));
    } catch (err) {
      logger.error({ err, agent: agent.name }, "Agent canHandle() threw an error, skipping");
      continue;
    }

    if (!canHandle) continue;

    logger.info(
      { agent: agent.name, from: context.from, messageId: context.messageId },
      "Agent accepted message",
    );

    try {
      const result = await agent.process(context);
      return result;
    } catch (err) {
      logger.error(
        { err, agent: agent.name, from: context.from },
        "Agent process() threw an error",
      );
      return { handled: false };
    }
  }

  logger.warn({ from: context.from, messageId: context.messageId }, "No agent handled message");
  return { handled: false };
}
