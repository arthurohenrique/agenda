# Rate Limiting Report

## Status: MEDIUM

Disponibilidade, reserva pública e webhook WhatsApp usam contadores persistentes no
Postgres. O webhook limita verificação a 20 tentativas por dez minutos e recebimento
a 600 por minuto antes de ler o corpo. Hash de IP usa somente header explicitamente
confiável e pepper obrigatório em produção. O risco permanece médio porque
login/recuperação, CAPTCHA e limites de edge dependem da configuração do Supabase.

Plano: `../plans/10_RATE_LIMITING_PLAN.md`.
