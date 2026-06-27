import type { Tool } from "../lib/tools";

export const getCurrentDatetimeTool: Tool<Record<string, never>, string> = {
  name: "get_current_datetime",
  description:
    "Retorna a data e hora atual do Brasil (fuso horário America/Sao_Paulo). Use quando o usuário perguntar que horas são, que dia é hoje, a data atual, etc.",
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },
  async execute() {
    return new Date().toLocaleString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      dateStyle: "full",
      timeStyle: "short",
    });
  },
};
