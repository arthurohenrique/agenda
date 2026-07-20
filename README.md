# Agenda

SaaS multiestabelecimento de agendamentos, construído com Next.js 16, TypeScript, Supabase Auth/Postgres/Storage/Realtime e Tailwind CSS.

Esta base entrega Fundação completa e núcleo operacional do MVP: autenticação SSR, onboarding, isolamento multi-tenant, catálogo, equipe, agenda, reserva pública, reserva administrativa, cancelamento, reagendamento, bloqueio transacional, publicação e relatórios essenciais.

Arquitetura, ERD, rotas, permissões, migrations, algoritmo e riscos: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## O que funciona

- Login, logout, recuperação e definição de nova senha com Supabase Auth.
- Redirecionamento direto para usuário de um tenant e seletor para usuário multi-tenant.
- Onboarding transacional com modelos editáveis de barbearia, salão, manicure, clínica e genérico.
- Página pública `/{slug}` somente para estabelecimento publicado.
- Fluxo público responsivo: serviço, profissional opcional, data, horário, dados mínimos e confirmação sem senha.
- Motor central de disponibilidade no Postgres com unidade, horário semanal, horário de profissional, exceções, folgas, buffers, antecedência, horizonte, capacidade e recursos.
- Reserva atômica com alocações `tstzrange` e exclusion constraint GiST.
- Idempotência, rate limit persistente, honeypot e erro amigável de concorrência.
- Cancelamento e reagendamento por token de alta entropia armazenado somente como hash.
- Agenda administrativa diária/semanal/mensal resumida, alteração de status, criação rápida, bloqueio e Realtime filtrado por tenant.
- Gestão rápida de serviços e profissionais.
- Lista de clientes isolada por estabelecimento.
- Publicação condicionada a checklist e contraste WCAG AA.
- Relatórios essenciais dos últimos 30 dias.
- Open Graph dinâmico, canonical, JSON-LD, sitemap, robots e `noindex` administrativo.
- Estrutura pronta para recursos, lista de espera, formulários, comunicação multicanal e outbox.

## Stack e decisões

- Next.js 16 App Router; Server Components por padrão.
- `proxy.ts` apenas para renovação de sessão; autorização segura fica próxima ao dado.
- `@supabase/ssr` com cookies e `getClaims()` para validar identidade no servidor.
- RLS habilitada e forçada em toda tabela exposta.
- Helpers `security definer` no schema privado `app_private`, com `search_path` vazio.
- Datas persistidas em UTC, timezone IANA preservado no tenant e agendamento.
- Dinheiro em centavos; telefones em E.164.
- Eventos de domínio em `outbox_events`; mensageria não acoplada ao motor.
- Temas por tokens controlados; sem CSS, HTML ou JavaScript arbitrário.
- D1/Sites não usado: Supabase é requisito explícito e fonte única de persistência.

Padrões de SSR/Auth seguem documentação oficial atual do [Supabase SSR para Next.js](https://supabase.com/docs/guides/auth/server-side/nextjs), [RLS do Supabase](https://supabase.com/docs/guides/database/postgres/row-level-security) e [Proxy do Next.js](https://nextjs.org/docs/app/getting-started/proxy).

## Requisitos locais

- Node.js 22.14 ou superior.
- Docker Desktop ativo, exigido pela stack local do Supabase.
- npm 10 ou superior.

## Instalação

```bash
npm install
npx supabase start
npx supabase db reset
npx supabase status -o env
```

Copie `.env.example` para `.env.local` e preencha:

```bash
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable key local>
NEXT_PUBLIC_APP_URL=http://localhost:3000
SUPABASE_SERVICE_ROLE_KEY=<service role local; apenas jobs de servidor>
BOOKING_TOKEN_PEPPER=<32+ caracteres aleatórios>
```

Inicie aplicação:

```bash
npm run dev
```

URLs de demonstração:

- `http://localhost:3000/barbearia-central`
- `http://localhost:3000/salao-da-ana`
- `http://localhost:3000/clinica-vida`

## Contas locais

Senha comum: `AgendaLocal123!`

| Conta | Acesso |
|---|---|
| `dono.barbearia@agenda.local` | Owner da Barbearia Central |
| `dona.salao@agenda.local` | Owner do Salão da Ana |
| `dona.clinica@agenda.local` | Owner da Clínica Vida |
| `multi@agenda.local` | Recepção da barbearia + admin do salão |

Credenciais são fictícias e exclusivas do seed local. Nunca usar em produção.

## Comandos

```bash
npm run dev                 # desenvolvimento
npm run build               # build de produção
npm run lint                # ESLint
npm run typecheck           # TypeScript strict
npm run test                # testes unitários
npm run test:integration    # teste concorrente; RUN_DB_TESTS=1
npm run test:e2e            # Playwright desktop + mobile
npm run test:db             # pgTAP/RLS/disponibilidade
npm run validate            # lint + tipos + unitários + build
npm run db:reset            # recria banco e seed
npm run db:types            # regenera tipos do banco local
```

Testes que dependem do Supabase local:

```bash
RUN_DB_TESTS=1 npm run test:integration
RUN_E2E_DB=1 npm run test:e2e
npm run test:db
```

O teste de integração dispara duas reservas simultâneas no mesmo profissional/intervalo e exige exatamente um sucesso e um conflito `23P01`.

## Migrations

1. Fundação, extensões, enums e helpers.
2. Tenants, associações, unidades, configurações, tema e auditoria.
3. Serviços, equipe, recursos e relações.
4. Horários, exceções, folgas e bloqueios.
5. Cliente global e dados privados por tenant.
6. Agendamentos, histórico, tokens e alocações anti-conflito.
7. Lista de espera, formulários, notificações, outbox e rate limit.
8. Grants mínimos, RLS forçada e políticas por papel.
9. Disponibilidade, reserva, status, cancelamento e rate limit.
10. Buckets e políticas de Storage.
11. Contraste WCAG AA e onboarding transacional.
12. Publicação segura.
13. Agendamento administrativo reutilizando mesmo motor.
14. Realtime somente para agenda e bloqueios.
15. Reagendamento transacional por token.

## Segurança

- Slug localiza; nunca autoriza.
- `tenant_id` existe em toda entidade de negócio e índices compostos relevantes.
- Chave `service_role` nunca entra no bundle.
- Funções públicas validam tenant, unidade, serviços, profissional, timezone e limites.
- Confirmação recalcula disponibilidade dentro da transação.
- Bloqueios e agendamentos usam mesma tabela de alocação, eliminando corrida entre eles.
- Constraints são autoridade final; Realtime nunca decide consistência.
- Logs de auditoria proíbem campos pessoais comuns por constraint.
- Dados clínicos sensíveis ficam separados por visibilidade e permissão fina.
- Rotas autenticadas e respostas de renovação usam cache privado/no-store.
- Uploads limitam bucket, MIME, extensão, tamanho e pasta do tenant.

Antes de produção:

- Ative SMTP, CAPTCHA/Bot Detection, MFA para papéis críticos e políticas de senha no Supabase.
- Configure backup/PITR, observabilidade, alertas e worker da outbox.
- Troque credenciais locais; aplique secrets no provedor de hospedagem.
- Execute `db reset`, pgTAP, concorrência e E2E contra ambiente efêmero.
- Revise retenção, exportação/exclusão e termos com responsável LGPD.
- Configure domínio, URLs de redirect e headers no ambiente final.

## Escopo ainda não fechado

Base de dados inclui lista de espera, formulários e comunicação, mas suas interfaces/workers completos ficam para fase operacional. Agenda semanal/mensal atual usa lista cronológica resumida; grade avançada com drag-and-drop, densidade/zoom e atalhos amplos ainda exige fase dedicada. Integrações WhatsApp/SMS/e-mail não fazem parte desta etapa.

Mapa detalhado de aceite: [docs/IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md).
