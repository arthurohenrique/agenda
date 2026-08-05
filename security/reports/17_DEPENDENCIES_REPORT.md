# Dependencies Report

## Status: PASS

Lockfile está versionado e versões diretas foram fixadas. Next.js está em `16.2.11`;
overrides exatos mantêm PostCSS `8.5.20` e Sharp `0.35.0` nas versões corrigidas.

Em 31 de julho de 2026, com npm `11.12.1`:

- `npm audit --omit=dev --audit-level=high`: zero vulnerabilidades.
- `npm audit --audit-level=high`: zero vulnerabilidades.

O lockfile atualiza `brace-expansion` transitivo para `1.1.18` e `5.0.9`. A correção
foi aplicada com `npm audit fix`, sem `--force`, pacote direto novo ou upgrade major.
Lint, typecheck, testes e build foram repetidos depois da atualização.

Plano: `../plans/17_DEPENDENCIES_PLAN.md`.
