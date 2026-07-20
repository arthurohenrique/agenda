# Database Access Report

## Status: PASS

`0008_rls.sql` habilita e força RLS nas tabelas. Policies públicas limitam tenant
publicado e catálogo público. Tabelas operacionais usam associação/papel. pgTAP
existe. Teste externo no Supabase real mostrou somente 3 tenants publicados; quatro
tabelas privadas consultadas retornaram `401`.

Plano: `../plans/02_DATABASE_ACCESS_PLAN.md`.
