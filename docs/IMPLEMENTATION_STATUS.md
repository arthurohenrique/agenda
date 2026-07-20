# Estado de implementação

Data de referência: 20 de julho de 2026.

## MVP

| Área | Estado |
|---|---|
| Auth SSR, recuperação e multi-tenant | Implementado |
| Onboarding e publicação | Implementado |
| Serviços, equipe e clientes | Implementado básico |
| Disponibilidade e concorrência | Implementado no Postgres |
| Reserva pública e administrativa | Implementado |
| Cancelamento e reagendamento | Implementado |
| Agenda, bloqueios e status | Implementado |
| Realtime e relatórios | Implementado básico |
| Notificações | Worker implementado; provedor externo pendente |
| Exportação LGPD | Implementada por tenant |
| Anonimização LGPD | Pendente de separação segura da PII global |
| Observabilidade | Logger e health check; provedor externo pendente |

## Segurança

- Vibe Check executado nas 17 categorias.
- Zero achado crítico ou alto.
- RLS privada validada externamente com chave publicável no Supabase real.
- API administrativa retorna `401` sem sessão e `403` sem papel/origem.
- CSP, HSTS, anti-frame, nosniff e referrer policy confirmados no build local.
- Dois riscos médios documentados: rate limit de Auth depende de configuração externa;
  PostCSS transitivo possui advisory moderado sem correção compatível.

Detalhes: [auditoria](../security/AUDIT_SUMMARY.md).

## Validação executada

- ESLint: aprovado.
- TypeScript strict: aprovado.
- 28 testes unitários: aprovados.
- Build Next.js de produção: aprovado.
- Consulta anônima real: tenants publicados visíveis; quatro tabelas privadas `401`.
- Migrations atuais: 17.
- Lockfile e versões diretas: fixados em versões publicadas.
- `npm audit`: zero alto/crítico; dois moderados conhecidos.

## Bloqueios locais

Docker não está instalado. pgTAP, reset completo, concorrência DB e E2E autenticado
ficam configurados no GitHub Actions, mas ainda precisam executar em runner com
Docker.

## Pendências do proprietário

1. Rotacionar segredo exposto e remover/trocar contas demo do projeto real.
2. Revisar e aplicar migrations `0017+` no ambiente escolhido.
3. Configurar proxy confiável, Supabase Auth rate limits, CAPTCHA e MFA.
4. Configurar webhook/e-mail/WhatsApp e scheduler do worker.
5. Configurar Sentry, alertas, backups/PITR, domínio e deploy.
6. Completar cadastros e regras específicas do negócio.
