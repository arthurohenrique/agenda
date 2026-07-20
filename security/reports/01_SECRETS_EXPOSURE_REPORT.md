# Secrets Exposure Report

## Status: LOW

`.env*` está ignorado e nenhuma chave real está versionada. Variáveis públicas
contêm somente URL e chave publicável. `supabase/seed.sql` e histórico possuem senha
demo conhecida; segura apenas em ambiente local. Segredo compartilhado fora do Git
deve ser rotacionado pelo proprietário.

Risco: conta demo aplicada por engano em projeto real. Plano: `../plans/01_SECRETS_EXPOSURE_PLAN.md`.
