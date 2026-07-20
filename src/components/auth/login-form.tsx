"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { ArrowRight, KeyRound, Mail } from "lucide-react";
import {
  type AuthActionState,
  loginAction,
  recoveryAction,
} from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button className="w-full" disabled={pending} type="submit">
      {pending ? "Aguarde…" : label}
      {pending ? null : <ArrowRight aria-hidden="true" size={18} />}
    </Button>
  );
}

export function LoginForm() {
  const [showRecovery, setShowRecovery] = useState(false);
  const initialState: AuthActionState = { status: "idle" };
  const [loginState, loginFormAction] = useActionState(loginAction, initialState);
  const [recoveryState, recoveryFormAction] = useActionState(
    recoveryAction,
    initialState,
  );

  if (showRecovery) {
    return (
      <form action={recoveryFormAction} className="grid gap-5" noValidate>
        <div className="grid gap-2">
          <span className="grid size-11 place-items-center rounded-xl bg-zinc-100 text-zinc-700">
            <KeyRound aria-hidden="true" size={21} />
          </span>
          <h2 className="mt-3 text-2xl font-bold tracking-tight">Recuperar acesso</h2>
          <p className="text-sm leading-6 text-zinc-500">
            Enviaremos um link seguro. A resposta não revela se a conta existe.
          </p>
        </div>
        <Field
          autoComplete="email"
          error={recoveryState.fields?.email?.[0]}
          label="E-mail"
          name="recovery-email"
          placeholder="voce@empresa.com"
          required
          type="email"
        />
        {recoveryState.message ? (
          <p
            className={
              recoveryState.status === "success" ? "text-sm text-green-700" : "text-sm text-red-700"
            }
            role="status"
          >
            {recoveryState.message}
          </p>
        ) : null}
        <SubmitButton label="Enviar instruções" />
        <Button onClick={() => setShowRecovery(false)} type="button" variant="ghost">
          Voltar para o login
        </Button>
      </form>
    );
  }

  return (
    <form action={loginFormAction} className="grid gap-5" noValidate>
      <Field
        autoComplete="email"
        error={loginState.fields?.email?.[0]}
        label="E-mail"
        name="email"
        placeholder="voce@empresa.com"
        required
        type="email"
      />
      <Field
        autoComplete="current-password"
        error={loginState.fields?.password?.[0]}
        label="Senha"
        name="password"
        placeholder="Sua senha"
        required
        type="password"
      />
      {loginState.message ? (
        <p className="text-sm font-medium text-red-700" role="alert">
          {loginState.message}
        </p>
      ) : null}
      <SubmitButton label="Entrar" />
      <button
        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl text-sm font-semibold text-zinc-600 hover:bg-zinc-50 hover:text-zinc-950"
        onClick={() => setShowRecovery(true)}
        type="button"
      >
        <Mail aria-hidden="true" size={17} />
        Esqueci minha senha
      </button>
    </form>
  );
}
