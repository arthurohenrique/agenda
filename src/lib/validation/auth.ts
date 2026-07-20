import { z } from "zod";

export const loginSchema = z.object({
  email: z.email("Informe um e-mail válido."),
  password: z.string().min(8, "A senha deve ter pelo menos 8 caracteres."),
});

export const recoverySchema = z.object({
  email: z.email("Informe um e-mail válido."),
});
