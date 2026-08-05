# Checklist manual de segurança

- [x] Usar chave publicável sem sessão para consultar tabelas privadas; tabelas privadas retornaram `401`.
- [x] Repetir API administrativa sem cookie; retornou `401`.
- [ ] Usar usuário de outro tenant; esperar `403`, `404` ou nenhum dado.
- [x] Confirmar que `.env` e `.env.local` não são versionados.
- [ ] Inspecionar bundle e rede do navegador; nenhuma chave secreta pode aparecer.
- [x] Enviar mutação com `Origin: https://evil.example`; retornou `403` localmente.
- [x] Conferir CSP, HSTS, `X-Frame-Options`, `nosniff` e `Referrer-Policy` no build local.
- [ ] Repetir conferência de headers no domínio final.
- [ ] Confirmar ausência de CORS wildcard.
- [ ] Testar limites de login e recuperação configurados no Supabase.
- [ ] Testar SQL injection e XSS nos formulários públicos.
- [ ] Confirmar respostas inválidas sem stack, SQL ou caminhos locais.
- [x] Executar `npm audit --omit=dev --audit-level=high`; zero vulnerabilidades.
- [x] Executar `npm audit --audit-level=high`; zero vulnerabilidades.
- [ ] Repetir webhook WhatsApp sem assinatura, com assinatura inválida e payload
  acima de 1 MiB; esperar rejeição antes do parse/processamento.
- [ ] Exceder limites GET/POST do webhook; esperar `429` e `Retry-After`.
- [ ] Confirmar que o proxy substitui o header definido em
  `TRUSTED_CLIENT_IP_HEADER` e remove o valor enviado pelo cliente.
- [ ] Repetir o mesmo evento WhatsApp; esperar uma inbox e uma única transição.
- [ ] Confirmar que worker mock nunca reclama item `meta_cloud` e vice-versa.
- [ ] Testar leitura administrativa do WhatsApp com usuário de outro tenant; esperar
  ausência de conversa, contato, número e handoff.
- [ ] Confirmar que opt-in público começa desmarcado, registra texto/evidência e que
  opt-out impede mensagens promocionais posteriores.
- [ ] Simular resposta Meta aceita seguida de falha ao persistir; esperar dead letter
  `delivery_unknown`, sem reenvio cego.
- [ ] Forçar falha persistente do handoff técnico até a oitava tentativa; confirmar
  dead letter, alerta e replay manual somente após corrigir a causa.
- [ ] Confirmar que logs não contêm telefone, nome, payload bruto, token ou segredo.
- [ ] Executar retenção em lotes, conferir todos os contadores, isolamento e
  idempotência; com `legal_hold`, nenhum dado deve mudar.
- [ ] Executar pentest antes de armazenar volume relevante de dados reais.

Itens de Stripe e upload estão fora do produto atual. SSRF foi reavaliado por causa
dos providers externos e permanece restrito a destinos configurados no servidor.
