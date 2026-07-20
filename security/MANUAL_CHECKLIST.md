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
- [ ] Executar `npm audit --audit-level=high`.
- [ ] Executar pentest antes de armazenar volume relevante de dados reais.

Itens de Stripe, upload e SSRF estão fora do produto atual. Reabrir quando algum
desses fluxos for introduzido.
