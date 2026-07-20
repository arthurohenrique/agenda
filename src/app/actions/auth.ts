"use server";

import { redirect } from "next/navigation";
import { getPublicEnv, isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { loginSchema, recoverySchema } from "@/lib/validation/auth";

export interface AuthActionState {
  status: "idle" | "error" | "success";
  message?: string;
  fields?: Record<string, string[]>;
}

export async function loginAction(
  _previous: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  if (!isSupabaseConfigured()) {
    return { status: "error", message: "Conecte o projeto ao Supabase para entrar." };
  }

  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Revise os campos indicados.",
      fields: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    return { status: "error", message: "E-mail ou senha incorretos." };
  }

  redirect("/");
}

export async function recoveryAction(
  _previous: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  if (!isSupabaseConfigured()) {
    return { status: "error", message: "Conecte o projeto ao Supabase." };
  }

  const parsed = recoverySchema.safeParse({ email: formData.get("recovery-email") });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Informe um e-mail válido.",
      fields: parsed.error.flatten().fieldErrors,
    };
  }

  const env = getPublicEnv();
  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${env.NEXT_PUBLIC_APP_URL}/auth/callback?next=/definir-senha`,
  });

  return {
    status: "success",
    message: "Se houver uma conta, enviaremos instruções para o e-mail informado.",
  };
}

export async function logoutAction() {
  if (isSupabaseConfigured()) {
    const supabase = await createClient();
    await supabase.auth.signOut();
  }
  redirect("/");
}

export async function updatePasswordAction(
  _previous: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  if (!isSupabaseConfigured()) {
    return { status: "error", message: "Serviço de autenticação indisponível." };
  }
  const password = formData.get("password");
  const confirmation = formData.get("passwordConfirmation");
  if (typeof password !== "string" || password.length < 12) {
    return { status: "error", message: "Use pelo menos 12 caracteres." };
  }
  if (password !== confirmation) {
    return { status: "error", message: "As senhas não coincidem." };
  }

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims.sub) {
    return { status: "error", message: "Link expirado. Solicite uma nova recuperação." };
  }
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { status: "error", message: "Não foi possível alterar a senha." };
  redirect("/");
}
