# SSRF Report

## Status: PASS

Nenhuma rota busca URL fornecida pelo usuário. O adapter Meta chama apenas
`https://graph.facebook.com`, codifica o identificador usado no caminho, impõe
timeout e rejeita redirects. O webhook de notificações usa URL definida por operador
no ambiente, não entrada externa, também com timeout e redirects rejeitados.

Risco residual: um operador com acesso às variáveis de ambiente já pode escolher o
destino do webhook de notificações. Essa configuração deve continuar fora da UI e
sob controle do ambiente de deploy.

Plano: `../plans/06_SSRF_PLAN.md`.
