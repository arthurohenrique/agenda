# Rate Limiting Fix Plan

- [x] Não confiar automaticamente em `X-Forwarded-For`.
- [x] Exigir pepper em produção.
- [ ] Proprietário configura proxy, limites do Supabase Auth e CAPTCHA.
- [ ] Validar `429` externamente.
