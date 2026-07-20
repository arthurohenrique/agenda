import Link from "next/link";
import { CalendarX2 } from "lucide-react";

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center px-5 py-16">
      <div className="max-w-md text-center">
        <span className="mx-auto grid size-16 place-items-center rounded-2xl bg-zinc-200 text-zinc-600">
          <CalendarX2 aria-hidden="true" size={28} />
        </span>
        <p className="mt-7 text-sm font-semibold text-zinc-500">Página indisponível</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">Agenda não encontrada</h1>
        <p className="mt-4 leading-7 text-zinc-600">
          Confira o endereço ou fale com o estabelecimento para receber o link correto.
        </p>
        <Link className="mt-7 inline-flex min-h-11 items-center rounded-xl bg-zinc-950 px-5 text-sm font-bold text-white" href="/">
          Ir para o início
        </Link>
      </div>
    </main>
  );
}
