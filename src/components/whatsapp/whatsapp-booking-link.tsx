"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, History, Link2, QrCode } from "lucide-react";
import QRCode from "qrcode";
import {
  generateTenantWhatsAppBookingLinkAction,
  generateTenantWhatsAppCampaignLinkAction,
} from "@/app/actions/whatsapp";
import { Button } from "@/components/ui/button";

export interface WhatsAppRoutingLinkView {
  code: string;
  type: string;
  campaign: string | null;
  source: string | null;
  usesCount: number;
  status: string;
  expiresAt: string | null;
  createdAt: string;
  url: string;
  message: string;
}

// Expiração no fuso do estabelecimento: em UTC, um código que expira às 23h
// local apareceria com a data do dia seguinte.
function shortDate(value: string | null, timezone: string) {
  if (!value) return "Sem expiração";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Data indisponível"
    : new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "short",
        timeZone: timezone,
      }).format(date);
}

export function WhatsAppBookingLink({
  bookingLink,
  bookingMessage,
  routingCode,
  routingUsesCount = 0,
  recentLinks = [],
  canGenerate = false,
  slug,
  timezone,
}: {
  bookingLink: string | null;
  bookingMessage: string | null;
  routingCode: string | null;
  routingUsesCount?: number;
  recentLinks?: WhatsAppRoutingLinkView[];
  canGenerate?: boolean;
  slug?: string;
  timezone: string;
}) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [copyError, setCopyError] = useState(false);
  const [qrError, setQrError] = useState(false);
  const qrCanvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!bookingLink || !qrCanvas.current) return;
    setQrError(false);
    void QRCode.toCanvas(qrCanvas.current, bookingLink, {
      color: { dark: "#18181b", light: "#ffffff" },
      errorCorrectionLevel: "M",
      margin: 2,
      width: 208,
    }).catch(() => setQrError(true));
  }, [bookingLink]);

  async function copyLink(value: string, key: string) {
    if (!navigator.clipboard) {
      setCopyError(true);
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      setCopyError(false);
    } catch {
      setCopyError(true);
    }
  }

  return (
    <section className="premium-card p-6" aria-labelledby="whatsapp-link-title">
      <div className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-xl bg-zinc-100"><QrCode aria-hidden="true" size={19} /></span>
        <div>
          <p className="text-sm text-zinc-500">Entrada identificada</p>
          <h2 className="font-bold" id="whatsapp-link-title">Link exclusivo</h2>
        </div>
      </div>

      {bookingLink ? (
        <div className="mt-5 grid gap-4">
          <div>
            <p className="text-sm font-semibold">Código permanente</p>
            <code className="mt-2 inline-flex rounded-lg bg-zinc-100 px-3 py-2 text-sm font-bold tracking-wide">{routingCode}</code>
            <p className="mt-2 text-xs text-zinc-500">{routingUsesCount} uso{routingUsesCount === 1 ? "" : "s"} registrado{routingUsesCount === 1 ? "" : "s"}</p>
          </div>
          <label className="grid gap-2 text-sm font-semibold" htmlFor="whatsapp-booking-link">
            URL
            <input className="form-control font-mono text-sm" id="whatsapp-booking-link" readOnly value={bookingLink} />
          </label>
          <div>
            <p className="text-sm font-semibold">Prévia da mensagem</p>
            <p className="mt-2 rounded-xl bg-zinc-50 p-4 text-sm leading-6">{bookingMessage}</p>
          </div>
          <Button className="w-full sm:w-fit" onClick={() => void copyLink(bookingLink, "permanent")} size="small">
            {copiedKey === "permanent" ? <Check aria-hidden="true" size={17} /> : <Copy aria-hidden="true" size={17} />}
            {copiedKey === "permanent" ? "Link copiado" : "Copiar link do WhatsApp"}
          </Button>
          <p aria-live="polite" className={copyError ? "text-sm text-red-700" : "sr-only"} role="status">
            {copiedKey ? "Link copiado para a área de transferência." : copyError ? "Não foi possível copiar. Selecione a URL acima." : ""}
          </p>
          <div className="grid justify-items-center rounded-xl border border-zinc-200 bg-white p-5 text-center">
            <canvas
              aria-label={`QR Code para iniciar agendamento no WhatsApp com o código ${routingCode ?? "do estabelecimento"}`}
              className={qrError ? "hidden" : "size-52 max-w-full"}
              ref={qrCanvas}
              role="img"
            />
            <p className="mt-3 font-semibold">QR Code do agendamento</p>
            <p className="mt-1 text-sm leading-6 text-zinc-500">
              {qrError ? "Não foi possível gerar o QR agora. Use o link acima." : "Aponte a câmera para abrir a conversa com o código já preenchido."}
            </p>
          </div>
        </div>
      ) : (
        <div className="mt-5 rounded-xl bg-zinc-50 p-5">
          <h3 className="font-semibold">Link ainda indisponível</h3>
          <p className="mt-2 text-sm leading-6 text-zinc-500">Vincule número e código de roteamento para liberar URL e QR Code.</p>
          {canGenerate && slug ? (
            <form action={generateTenantWhatsAppBookingLinkAction} className="mt-4">
              <input name="slug" type="hidden" value={slug} />
              <Button size="small" type="submit">Gerar link permanente</Button>
            </form>
          ) : null}
        </div>
      )}

      {canGenerate && slug ? (
        <form action={generateTenantWhatsAppCampaignLinkAction} className="mt-6 rounded-2xl border border-zinc-200 p-4">
          <input name="slug" type="hidden" value={slug} />
          <div className="flex items-start gap-3">
            <Link2 aria-hidden="true" className="mt-0.5 shrink-0 text-zinc-500" size={18} />
            <div><h3 className="font-semibold">Link temporário de campanha</h3><p className="mt-1 text-xs leading-5 text-zinc-500">Gera novo código público; ele identifica contexto, mas não autoriza acesso.</p></div>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="grid gap-2 text-sm font-semibold">Origem<input className="form-control font-normal" maxLength={80} name="source" placeholder="instagram" /></label>
            <label className="grid gap-2 text-sm font-semibold">Campanha<input className="form-control font-normal" maxLength={80} name="campaign" placeholder="inverno-2026" /></label>
            <label className="grid gap-2 text-sm font-semibold sm:col-span-2">Validade<select className="form-control font-normal" defaultValue="30" name="expiresInDays"><option value="7">7 dias</option><option value="30">30 dias</option><option value="90">90 dias</option></select></label>
          </div>
          <Button className="mt-4" size="small" type="submit" variant="secondary">Gerar novo link temporário</Button>
        </form>
      ) : null}

      {recentLinks.length ? (
        <section className="mt-6 border-t border-zinc-200 pt-5" aria-labelledby="whatsapp-link-history">
          <div className="flex items-center gap-2"><History aria-hidden="true" className="text-zinc-500" size={17} /><h3 className="font-semibold" id="whatsapp-link-history">Histórico recente</h3></div>
          <ol className="mt-3 grid gap-3">
            {recentLinks.map((link) => (
              <li className="rounded-xl bg-zinc-50 p-3" key={`${link.code}:${link.createdAt}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div><code className="text-xs font-bold tracking-wide">{link.code}</code><p className="mt-1 text-xs text-zinc-500">{link.type === "permanent_tenant_code" ? "Permanente" : link.campaign || "Temporário"} · {link.usesCount} uso{link.usesCount === 1 ? "" : "s"} · {shortDate(link.expiresAt, timezone)} · {link.status}</p>{link.source ? <p className="mt-1 text-xs text-zinc-500">Origem: {link.source}</p> : null}</div>
                  <button className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 text-xs font-semibold" onClick={() => void copyLink(link.url, link.code)} type="button">{copiedKey === link.code ? <Check aria-hidden="true" size={15} /> : <Copy aria-hidden="true" size={15} />}{copiedKey === link.code ? "Copiado" : "Copiar"}</button>
                </div>
                <p className="mt-2 line-clamp-2 text-xs leading-5 text-zinc-600">{link.message}</p>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </section>
  );
}
