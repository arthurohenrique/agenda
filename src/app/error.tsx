"use client";

import { useEffect } from "react";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Unhandled application error", { digest: error.digest });
  }, [error]);

  return (
    <main className="grid min-h-screen place-items-center bg-zinc-50 p-6">
      <section className="max-w-md rounded-3xl border border-zinc-200 bg-white p-8 text-center shadow-sm">
        <h1 className="text-2xl font-bold text-zinc-950">Algo não saiu como esperado</h1>
        <p className="mt-3 text-sm leading-6 text-zinc-600">
          Nenhum dado foi alterado de propósito. Tente novamente.
        </p>
        <button
          className="mt-6 min-h-11 rounded-xl bg-zinc-950 px-5 text-sm font-semibold text-white"
          onClick={reset}
          type="button"
        >
          Tentar novamente
        </button>
      </section>
    </main>
  );
}
