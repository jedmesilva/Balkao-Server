function requireEnv(...keys: string[]): string {
  for (const key of keys) {
    const value = process.env[key];
    if (value) return value;
  }
  throw new Error(`Missing required environment variable: ${keys.join(" or ")}`);
}

export const config = {
  whatsapp: {
    token: requireEnv("WHATSAPP_TOKEN", "WHATSAPP_ACCESS_TOKEN"),
    phoneNumberId: requireEnv("WHATSAPP_PHONE_NUMBER_ID"),
    verifyToken: requireEnv("WHATSAPP_VERIFY_TOKEN"),
    appSecret: requireEnv("WHATSAPP_APP_SECRET"),
    apiVersion: process.env.WHATSAPP_API_VERSION ?? "v20.0",
  },
};
