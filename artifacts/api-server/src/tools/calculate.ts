import type { Tool } from "../lib/tools";

interface CalculateParams {
  expression: string;
}

export const calculateTool: Tool<CalculateParams, number | string> = {
  name: "calculate",
  description:
    "Avalia uma expressão matemática simples e retorna o resultado. Suporta +, -, *, /, ** (potência) e parênteses. Use quando o usuário pedir uma conta ou cálculo numérico.",
  parameters: {
    type: "object",
    properties: {
      expression: {
        type: "string",
        description: 'Expressão matemática a calcular. Ex: "2 + 2", "10 * 3.5", "(100 / 4) ** 2"',
      },
    },
    required: ["expression"],
  },
  async execute({ expression }) {
    const sanitized = expression.replace(/[^0-9+\-*/().\s*]/g, "");
    if (!sanitized.trim()) {
      throw new Error("Expressão inválida ou vazia.");
    }
    const result = Function(`"use strict"; return (${sanitized})`)() as number;
    if (!isFinite(result)) {
      throw new Error("Resultado inválido (divisão por zero ou overflow).");
    }
    return result;
  },
};
