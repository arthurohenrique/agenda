# Rate Limiting Report

## Status: MEDIUM

Disponibilidade e reserva pública usam rate limit transacional no Postgres. Hash de
IP usa somente header explicitamente confiável e pepper obrigatório em produção.
Login/recuperação dependem dos limites do Supabase Auth e configuração de edge.

Plano: `../plans/10_RATE_LIMITING_PLAN.md`.
