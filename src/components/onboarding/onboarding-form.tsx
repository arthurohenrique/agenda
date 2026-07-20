"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Building2, Check, Clock3, MapPin, Palette, Sparkles, UserRound } from "lucide-react";
import {
  completeOnboardingAction,
  type OnboardingState,
} from "@/app/actions/onboarding";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { normalizeSlug } from "@/lib/slugs";
import { cn } from "@/lib/utils";

const segments = [
  { value: "barbershop", label: "Barbearia", hint: "Corte e barba" },
  { value: "salon", label: "Salão", hint: "Beleza e cabelo" },
  { value: "nails", label: "Manicure", hint: "Mãos e pés" },
  { value: "clinic", label: "Clínica", hint: "Consultas e procedimentos" },
  { value: "generic", label: "Outro", hint: "Modelo genérico" },
] as const;

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button className="w-full sm:w-auto" disabled={pending} type="submit">
      {pending ? "Criando ambiente…" : "Criar e abrir agenda"}
      {pending ? null : <Check aria-hidden="true" size={18} />}
    </Button>
  );
}

export function OnboardingForm() {
  const initialState: OnboardingState = { status: "idle" };
  const [state, action] = useActionState(completeOnboardingAction, initialState);
  const [segment, setSegment] = useState<(typeof segments)[number]["value"]>("barbershop");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);

  const displayedSlug = slugEdited ? slug : normalizeSlug(name);

  return (
    <form action={action} className="grid gap-8" noValidate>
      <section className="surface p-5 sm:p-7" aria-labelledby="business-title">
        <div className="flex items-start gap-4">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-zinc-100 text-zinc-700">
            <Building2 aria-hidden="true" size={21} />
          </span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Etapa 1 de 4</p>
            <h2 className="mt-1 text-xl font-bold" id="business-title">Seu negócio</h2>
          </div>
        </div>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {segments.map((item) => (
            <button
              aria-pressed={segment === item.value}
              className={cn(
                "rounded-2xl border p-4 text-left transition",
                segment === item.value
                  ? "border-zinc-950 bg-zinc-950 text-white"
                  : "border-zinc-200 bg-white hover:border-zinc-400",
              )}
              key={item.value}
              onClick={() => setSegment(item.value)}
              type="button"
            >
              <span className="block text-sm font-bold">{item.label}</span>
              <span className={cn("mt-1 block text-xs", segment === item.value ? "text-zinc-300" : "text-zinc-500")}>{item.hint}</span>
            </button>
          ))}
        </div>
        <input name="segment" type="hidden" value={segment} />
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <Field error={state.fields?.name?.[0]} label="Nome do estabelecimento" name="name" onChange={(event) => setName(event.target.value)} required value={name} />
          <Field
            error={state.fields?.slug?.[0]}
            hint={displayedSlug ? `Sua página: /${displayedSlug}` : "Use letras, números e hífens."}
            label="Endereço público"
            name="slug"
            onChange={(event) => {
              setSlugEdited(true);
              setSlug(normalizeSlug(event.target.value));
            }}
            required
            value={displayedSlug}
          />
        </div>
      </section>

      <section className="surface p-5 sm:p-7" aria-labelledby="location-title">
        <div className="flex items-start gap-4">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-zinc-100 text-zinc-700"><MapPin aria-hidden="true" size={21} /></span>
          <div><p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Etapa 2 de 4</p><h2 className="mt-1 text-xl font-bold" id="location-title">Local e horários</h2></div>
        </div>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <Field error={state.fields?.locationName?.[0]} label="Nome da unidade" name="locationName" required defaultValue="Unidade principal" />
          <Field error={state.fields?.address?.[0]} label="Endereço" name="address" required autoComplete="street-address" />
          <Field error={state.fields?.district?.[0]} label="Bairro" name="district" />
          <Field error={state.fields?.city?.[0]} label="Cidade" name="city" required autoComplete="address-level2" />
          <Field error={state.fields?.region?.[0]} label="Estado (UF)" name="region" required maxLength={2} autoComplete="address-level1" />
          <Field error={state.fields?.postalCode?.[0]} label="CEP" name="postalCode" autoComplete="postal-code" />
          <Field error={state.fields?.opensAt?.[0]} label="Abertura" name="opensAt" required type="time" defaultValue="09:00" />
          <Field error={state.fields?.closesAt?.[0]} label="Fechamento" name="closesAt" required type="time" defaultValue="18:00" />
        </div>
        <p className="mt-4 inline-flex items-center gap-2 text-xs text-zinc-500"><Clock3 aria-hidden="true" size={15} /> Segunda a sábado. Ajuste intervalos e exceções depois.</p>
      </section>

      <section className="surface p-5 sm:p-7" aria-labelledby="team-title">
        <div className="flex items-start gap-4">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-zinc-100 text-zinc-700"><UserRound aria-hidden="true" size={21} /></span>
          <div><p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Etapa 3 de 4</p><h2 className="mt-1 text-xl font-bold" id="team-title">Primeiro profissional</h2></div>
        </div>
        <div className="mt-6 max-w-xl"><Field error={state.fields?.staffName?.[0]} hint="Será associado a todos os serviços iniciais. Você poderá editar depois." label="Nome" name="staffName" required /></div>
        <p className="mt-5 inline-flex items-center gap-2 rounded-xl bg-zinc-50 px-4 py-3 text-sm text-zinc-600"><Sparkles aria-hidden="true" size={17} /> Serviços do segmento serão criados como dados editáveis.</p>
      </section>

      <section className="surface p-5 sm:p-7" aria-labelledby="theme-title">
        <div className="flex items-start gap-4">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-zinc-100 text-zinc-700"><Palette aria-hidden="true" size={21} /></span>
          <div><p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Etapa 4 de 4</p><h2 className="mt-1 text-xl font-bold" id="theme-title">Identidade visual</h2></div>
        </div>
        <div className="mt-6 grid max-w-xl gap-4 sm:grid-cols-2">
          <Field error={state.fields?.primaryColor?.[0]} label="Cor principal" name="primaryColor" required type="color" defaultValue="#171717" className="h-14 p-2" />
          <Field error={state.fields?.accentColor?.[0]} label="Cor de destaque" name="accentColor" required type="color" defaultValue="#2563EB" className="h-14 p-2" />
        </div>
        <p className="mt-4 text-xs leading-5 text-zinc-500">Publicação será bloqueada se contraste não atingir WCAG AA.</p>
      </section>

      {state.message ? <p className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-800" role="alert">{state.message}</p> : null}

      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <p className="max-w-xl text-sm leading-6 text-zinc-500">Ambiente nasce em rascunho. Revise página pública antes de publicar.</p>
        <SubmitButton />
      </div>
    </form>
  );
}
