import app from "./app";
import { logger } from "./lib/logger";
import { initProviders } from "./lib/llm";
import { registerAgent } from "./lib/agents";
import { registerTool } from "./lib/tools";
import { BalkaoAgent } from "./agents/balkao";
import { IdentityAgent } from "./agents/identity";
import { getCurrentDatetimeTool } from "./tools/get-current-datetime";
import { calculateTool } from "./tools/calculate";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

initProviders();
logger.info("LLM providers initialized");

registerTool(getCurrentDatetimeTool);
registerTool(calculateTool);
logger.info("Tools registered");

registerAgent(new IdentityAgent());
registerAgent(new BalkaoAgent());
logger.info("Agents registered");

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
