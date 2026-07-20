"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { type AuthActionState, updatePasswordAction } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";

function SubmitPassword() {
  const { pending } = useFormStatus();
  return <Button className="w-full" disabled={pending} type="submit">{pending ? "Salvando…" : "Salvar nova senha"}</Button>;
}

export function UpdatePasswordForm() {
  const initialState: AuthActionState = { status: "idle" };
  const [state, action] = useActionState(updatePasswordAction, initialState);
  return (
    <form action={action} className="grid gap-5">
      <Field autoComplete="new-password" hint="Mínimo de 12 caracteres." label="Nova senha" minLength={12} name="password" required type="password" />
      <Field autoComplete="new-password" label="Confirme a senha" minLength={12} name="passwordConfirmation" required type="password" />
      {state.message ? <p className="text-sm font-semibold text-red-700" role="alert">{state.message}</p> : null}
      <SubmitPassword />
    </form>
  );
}
