# SSRF Fix Plan

- [x] Confirmar ausência de fetch baseado em entrada do usuário.
- [x] Fixar o destino da Meta em `https://graph.facebook.com`, codificar segmentos,
  impor timeout e rejeitar redirects.
- [x] Manter o webhook genérico de notificações restrito ao ambiente administrado,
  com timeout e redirects rejeitados.
- [ ] Reabrir auditoria se importação, preview ou webhook configurável por tenant surgir.
