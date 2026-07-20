# Estado de implementação

Data de referência: 19 de julho de 2026.

## Critérios do MVP

| Critério | Estado | Evidência |
|---|---|---|
| Login na raiz | Implementado | Supabase SSR, formulário acessível, Playwright |
| Associar usuário a estabelecimento | Implementado | `tenant_members`, RLS e seed multi-tenant |
| Criar estabelecimento | Implementado | onboarding transacional |
| Configurar slug e identidade | Implementado | validação reservada + tema controlado |
| Configurar horários | Implementado básico | onboarding + modelo semanal no banco |
| Cadastrar serviços | Implementado | painel e RLS |
| Cadastrar profissionais | Implementado | painel, serviços e unidade |
| Associar profissional/serviço | Implementado | onboarding e formulário de equipe |
| Publicar página | Implementado | RPC com checklist e contraste |
| Abrir `/{slug}` anônimo | Implementado | somente `published` |
| Escolher serviço/profissional/data/horário | Implementado | wizard responsivo |
| Criar cliente | Implementado | RPC sem enumeração pública |
| Confirmar agendamento | Implementado | transação e outbox |
| Ver imediatamente no painel | Implementado | RSC + Realtime filtrado |
| Criar pelo atendente | Implementado | painel rápido, mesmo motor |
| Reagendar | Implementado | token + transação + idempotência |
| Cancelar | Implementado | token, janela e histórico |
| Alterar status | Implementado | máquina de estados na RPC |
| Bloquear horário | Implementado | mesma exclusion constraint do agendamento |
| Impedir conflito simultâneo | Implementado | GiST + teste concorrente criado |
| Isolamento entre tenants | Implementado | RLS forçada + pgTAP criado |
| Fluxo celular | Implementado | layout responsivo + projeto Playwright mobile |
| Navegação principal por teclado | Implementado | foco, semântica + Playwright |
| Testes críticos | Parcialmente validados | unitários/build/E2E smoke passam; banco exige Docker |

## Validação executada

- ESLint: aprovado.
- TypeScript strict: aprovado.
- 22 testes unitários: aprovados.
- Build Next.js de produção: aprovado após os incrementos finais.
- Playwright: 4 testes de login/recuperação aprovados em desktop e mobile; 8 testes dependentes do Supabase local ignorados de forma explícita.
- Parser PostgreSQL 17: 15 migrations, seed e 2 suítes SQL aceitos.
- Supabase local: bloqueado porque Docker daemon não está disponível neste ambiente.
- Auditoria de produção: 2 alertas moderados no PostCSS empacotado pelo Next.js 16.2.10; o autofix propõe downgrade incompatível e não foi aplicado. Acompanhar correção upstream.

## Próximas fases

1. Executar migrations, seed, pgTAP, concorrência e E2E autenticado com Docker/Supabase.
2. Completar grade semanal/mensal avançada, atalhos e edição inline.
3. Interfaces de recursos, exceções, folgas, lista de espera e formulários.
4. Worker de outbox, provedores de e-mail/SMS e observabilidade.
5. Exportação/exclusão LGPD, retenção automatizada e revisão de segurança externa.
6. Deploy homologação, teste de carga, backup/PITR e lançamento.
