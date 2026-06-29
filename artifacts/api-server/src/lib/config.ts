function requireEnv(...keys: string[]): string {
  for (const key of keys) {
    const value = process.env[key];
    if (value) return value;
  }
  throw new Error(`Missing required environment variable: ${keys.join(" or ")}`);
}

function optionalEnv(...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key];
    if (value) return value;
  }
  return undefined;
}

export const config = {
  whatsapp: {
    token: requireEnv("WHATSAPP_TOKEN", "WHATSAPP_ACCESS_TOKEN"),
    phoneNumberId: requireEnv("WHATSAPP_PHONE_NUMBER_ID"),
    verifyToken: requireEnv("WHATSAPP_VERIFY_TOKEN"),
    appSecret: requireEnv("WHATSAPP_APP_SECRET"),
    apiVersion: process.env.WHATSAPP_API_VERSION ?? "v20.0",
  },
  pluggy: {
    clientId: optionalEnv("PLUGGY_CLIENT_ID"),
    clientSecret: optionalEnv("PLUGGY_CLIENT_SECRET"),
    baseUrl: process.env.PLUGGY_BASE_URL ?? "https://api.pluggy.ai",
    // When true, the Pluggy Connect widget shows sandbox/test connectors.
    // Defaults to true only in development (NODE_ENV !== "production").
    // Must be explicitly set to PLUGGY_SANDBOX=true to enable in production.
    sandbox:
      process.env.PLUGGY_SANDBOX === "true" ||
      (process.env.PLUGGY_SANDBOX === undefined && process.env.NODE_ENV !== "production"),
  },
};
