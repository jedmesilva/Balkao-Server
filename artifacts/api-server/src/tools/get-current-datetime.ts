import type { Tool } from "../lib/tools";

interface DatetimeResult {
  iso: string;
  dateLong: string;
  dateShort: string;
  time: string;
  dayOfWeek: string;
  timezone: string;
}

export const getCurrentDatetimeTool: Tool<Record<string, never>, DatetimeResult> = {
  name: "get_current_datetime",
  description:
    "Retorna a data e hora atual completa do Brasil (fuso horário America/Sao_Paulo). " +
    "Use sempre que o usuário perguntar que horas são, que dia é hoje, a data atual, " +
    "o dia da semana, ou qualquer referência temporal como 'hoje', 'agora', 'que horas são'.",
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },
  async execute() {
    const tz = "America/Sao_Paulo";
    const now = new Date();

    const fmt = (opts: Intl.DateTimeFormatOptions) =>
      now.toLocaleString("pt-BR", { timeZone: tz, ...opts });

    return {
      iso: now.toISOString(),
      dateLong: fmt({ dateStyle: "full" }),
      dateShort: fmt({ dateStyle: "short" }),
      time: fmt({ timeStyle: "short" }),
      dayOfWeek: fmt({ weekday: "long" }),
      timezone: tz,
    };
  },
};
