# Plano de hardening

## Escopo Codex

- Auditoria Vibe Check e correções de segurança.
- Testes, CI, notificações, LGPD, observabilidade e documentação.

## Fora do escopo

- Deploy, domínio, SMTP/WhatsApp real, cadastros de produção e configuração de
  provedores.

## Fases

- [x] Baseline: lint, tipos, 28 testes e build verdes.
- [x] Vibe Check: 17 categorias auditadas.
- [x] Hardening inicial: headers, origem, erros, tokens e autorização HTTP.
- [x] Worker de outbox com lease, retry, idempotência e modo `dry-run`.
- [x] Exportação LGPD por tenant.
- [x] Logger estruturado, health check e CI.
- [ ] Executar pgTAP, integração e E2E com Docker/CI.
- [ ] Aplicar migrations 0017+ em ambiente escolhido pelo proprietário.
- [ ] Configurar provedores e verificações manuais de produção.
