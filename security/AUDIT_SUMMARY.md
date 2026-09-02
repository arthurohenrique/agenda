# Security Audit Summary

Data: 31 de julho de 2026

| # | Categoria | Estado |
|---|---|---|
| 1 | Secrets exposure | LOW |
| 2 | Database access | PASS* |
| 3 | Auth middleware | PASS |
| 4 | Access control | PASS |
| 5 | Frontend secrets | PASS |
| 6 | SSRF | PASS |
| 7 | CSRF | PASS |
| 8 | Security headers | PASS |
| 9 | CORS | PASS |
| 10 | Rate limiting | MEDIUM |
| 11 | SQL injection | PASS |
| 12 | XSS | PASS |
| 13 | Payment webhooks | N/A |
| 14 | File uploads | N/A |
| 15 | Error handling | PASS |
| 16 | Password hashing | N/A |
| 17 | Dependencies | PASS |

Não há vulnerabilidade conhecida nas dependências de produção ou desenvolvimento.
Os dois audits retornam zero após a atualização transitiva segura de
`brace-expansion`, sem `--force` ou upgrade major.

O canal WhatsApp valida assinatura HMAC no corpo bruto, limita o payload, isola
provider/tenant nas filas e não registra tokens ou payload bruto em logs. O adapter
Meta usa origem fixa, segmento codificado, timeout e rejeição de redirects. Opt-in
web é explícito e a gravação atômica é restrita a `service_role`. O webhook aplica
rate limit persistente antes da leitura do corpo; a retenção usa TTL versionado,
`legal_hold` e lotes internos.

`PASS*` indica que o baseline de RLS foi validado. As novas policies e RPCs do
WhatsApp têm pgTAP configurado, mas ainda dependem de execução em ambiente com
Docker/Supabase local.

O visualizador de conversas do painel (`0028_whatsapp_conversation_realtime.sql`)
amplia a exposição sem criar leitor novo: quem lê é exatamente
`app_private.can_read_whatsapp_conversation` — owner, admin e recepcionista do
estabelecimento, ou a permissão `whatsapp_handoff` limitada a conversas em
atendimento humano. Nenhum `grant` foi adicionado; as colunas já concedidas em
`0020` seguem valendo, e `provider_payload` e `content_redacted_at` continuam
restritos. Só `whatsapp_messages` entra na publicação de Realtime, por lista de
colunas e com replica identity padrão, para que nenhum `old_record` de UPDATE
transporte o `content` anterior à redação da retenção. O filtro do canal é
`tenant_id=eq.<id>`, reavaliado por assinante contra a RLS, e as consultas do
servidor repetem `.eq("tenant_id", …)` — conversas ainda sem estabelecimento
resolvido não aparecem para tenant algum. Telefone do contato só é exibido
mascarado. Isolamento em número compartilhado coberto por pgTAP em
`supabase/tests/whatsapp.test.sql`.

Relatórios e planos ficam nas pastas homônimas.

Pendências humanas: rotacionar segredo já compartilhado, remover contas demo do
projeto real, configurar rate limit/CAPTCHA do Supabase, validar as novas policies
WhatsApp em um Supabase local/isolado e conferir headers no domínio.
