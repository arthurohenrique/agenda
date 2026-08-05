"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";

export function WhatsAppFormSubmit({
  idleLabel,
  pendingLabel,
  variant = "primary",
}: {
  idleLabel: string;
  pendingLabel: string;
  variant?: "primary" | "secondary" | "danger" | "ghost";
}) {
  const { pending } = useFormStatus();
  return (
    <Button disabled={pending} type="submit" variant={variant}>
      {pending ? pendingLabel : idleLabel}
    </Button>
  );
}
