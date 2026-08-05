"use client";

import { useId, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

export function WhatsAppCopyValue({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  const inputId = useId();
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!navigator.clipboard) return;
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2_000);
  }

  return (
    <div className="grid gap-2">
      <label className="text-xs font-semibold text-zinc-500" htmlFor={inputId}>
        {label}
      </label>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
        <input
          className="min-h-11 min-w-0 rounded-xl border border-[var(--control-border)] bg-white px-3 font-mono text-xs"
          id={inputId}
          readOnly
          value={value}
        />
        <Button onClick={copy} size="small" type="button" variant="secondary">
          {copied ? <Check aria-hidden="true" size={16} /> : <Copy aria-hidden="true" size={16} />}
          {copied ? "Copiado" : "Copiar"}
        </Button>
      </div>
      <span aria-live="polite" className="sr-only">
        {copied ? `${label} copiado.` : ""}
      </span>
    </div>
  );
}
