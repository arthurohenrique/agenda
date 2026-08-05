# Estado de implementação

Data de referência: 31 de julho de 2026.

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
| WhatsApp | Pipeline mock, inbox/outbox, roteamento, agenda, handoff, simulador e retenção implementados; Meta real pendente |
| Exportação LGPD | Implementada por tenant |
| Anonimização LGPD | Contatos técnicos órfãos do WhatsApp entram na retenção; identidade global em `customers` permanece pendente |
| Observabilidade | Logger e health check; provedor externo pendente |

## Segurança

- Vibe Check executado nas 17 categorias.
- Zero achado crítico ou alto na auditoria da aplicação.
- RLS privada validada externamente com chave publicável no Supabase real.
- API administrativa retorna `401` sem sessão e `403` sem papel/origem.
- CSP, HSTS, anti-frame, nosniff e referrer policy confirmados no build local.
- Um risco médio documentado: rate limit de Auth depende de configuração externa.
- Dependências de produção e desenvolvimento não têm vulnerabilidade conhecida no
  audit atual.

Detalhes: [auditoria](../security/AUDIT_SUMMARY.md).

## Validação executada

- ESLint: aprovado.
- TypeScript strict: aprovado.
- 44 arquivos e 238 testes unitários: aprovados.
- Build Next.js de produção: aprovado.
- Consulta anônima real: tenants publicados visíveis; quatro tabelas privadas `401`.
- Migrations atuais: 24, de `0001` a `0024`.
- Suite pgTAP do WhatsApp: 165 asserções configuradas; execução local bloqueada
  pela ausência de Docker/`psql`.
- Lockfile e versões diretas: fixados em versões publicadas.
- `npm audit --omit=dev --audit-level=high`: zero vulnerabilidades.
- `npm audit --audit-level=high`: zero vulnerabilidades.

## Bloqueios locais

Docker e `psql` não estão instalados neste ambiente. Reset do Supabase, pgTAP,
integração com `RUN_DB_TESTS=1` e E2E com `RUN_E2E_DB=1` não foram executados
localmente. O workflow de CI está configurado para executá-los em runner com Docker.

## Pendências do proprietário

1. Rotacionar segredo exposto e remover/trocar contas demo do projeto real.
2. Revisar e aplicar migrations `0017–0024` no ambiente escolhido.
3. Configurar proxy confiável, Supabase Auth rate limits, CAPTCHA e MFA.
4. Configurar webhook/e-mail, credenciais Meta e schedulers dos workers e retenção.
5. Configurar Sentry, alertas, backups/PITR, domínio e deploy.
6. Completar cadastros e regras específicas do negócio.
