import type { Agent } from "./types";
import { logger } from "../logger";

const agents: Agent[] = [];

export function registerAgent(agent: Agent): void {
  const existing = agents.findIndex((a) => a.name === agent.name);
  if (existing >= 0) {
    agents.splice(existing, 1);
  }
  agents.push(agent);
  agents.sort((a, b) => b.priority - a.priority);
  logger.info({ agent: agent.name, priority: agent.priority }, "Agent registered");
}

export function unregisterAgent(name: string): void {
  const index = agents.findIndex((a) => a.name === name);
  if (index >= 0) {
    agents.splice(index, 1);
    logger.info({ agent: name }, "Agent unregistered");
  }
}

export function getAgents(): readonly Agent[] {
  return agents;
}

export function getAgent(name: string): Agent | undefined {
  return agents.find((a) => a.name === name);
}
