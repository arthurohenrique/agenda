# Ativação do WhatsApp Business Platform

Use este checklist quando a equipe receber autorização para conectar a Meta. Hoje o
projeto opera somente com provedor mock. Não cole credenciais, códigos temporários ou
telefones reais neste documento, em issues ou em logs.

Permissões, versões e etapas da Meta mudam. Antes de iniciar, confira a documentação
oficial vigente da WhatsApp Business Platform e registre a data da revisão.

## Responsáveis e ambientes

| Item | Valor |
|---|---|
| Responsável técnico | A preencher |
| Responsável comercial | A preencher |
| Data da revisão da documentação Meta | A preencher |
| Ambiente inicial | Homologação |
| Cofre de segredos | A definir |
| Plano de rollback | A preencher |

## 1. Conta e ativos

- [ ] Criar ou validar conta Meta administrativa apropriada.
- [ ] Criar portfólio empresarial.
- [ ] Concluir verificação comercial exigida para o caso de uso.
- [ ] Criar aplicativo Meta sob a organização correta.
- [ ] Adicionar produto WhatsApp ao aplicativo.
- [ ] Criar ou associar WABA.
- [ ] Adicionar o número reservado para a plataforma.
- [ ] Validar propriedade do número pelo método vigente.
- [ ] Configurar e aprovar nome de exibição.
- [ ] Ativar verificação em duas etapas do número.

Registre identificadores não secretos no inventário operacional: App ID, WABA ID e
`phone_number_id`. Não registre access token nem app secret.

## 2. Credenciais e configuração

- [ ] Escolher gerenciador de segredos, KMS, Vault ou solução equivalente.
- [ ] Criar credencial de menor privilégio para homologação.
- [ ] Guardar segredo no cofre e persistir apenas sua referência no banco.
- [ ] Configurar versão vigente da Graph API no ambiente.
- [ ] Configurar app secret sem prefixo `NEXT_PUBLIC_`.
- [ ] Configurar access token sem prefixo `NEXT_PUBLIC_`.
- [ ] Configurar WABA ID e `phone_number_id` padrão.
- [ ] Documentar proprietário, expiração, rotação e revogação.
- [ ] Confirmar que logs e diagnóstico mostram somente presença ou ausência.

Faça rotação antes do lançamento e simule revogação em homologação. Remova a
credencial antiga depois de confirmar tráfego com a nova.

## 3. Webhook

- [ ] Publicar endpoint HTTPS estável.
- [ ] Configurar callback do webhook no aplicativo Meta.
- [ ] Criar verify token aleatório no cofre.
- [ ] Validar handshake GET e challenge.
- [ ] Assinar os campos necessários conforme documentação vigente.
- [ ] Validar assinatura do corpo bruto no POST.
- [ ] Confirmar rejeição de assinatura inválida.
- [ ] Confirmar limite de payload e resposta rápida.
- [ ] Configurar `TRUSTED_CLIENT_IP_HEADER` em proxy que substitui o valor do cliente.
- [ ] Confirmar `429` e `Retry-After` sem bloquear retries legítimos.
- [ ] Confirmar deduplicação de evento repetido.
- [ ] Confirmar processamento assíncrono de mensagens e status.

O endpoint não deve executar todo o diálogo antes de responder. Eventos desconhecidos
devem entrar na inbox com acesso restrito e terminar como ignorados, sem quebrar lote.

### Processamento e recuperação

`POST /api/integrations/whatsapp/webhook` grava o envelope na inbox e responde `200`
imediatamente. O diálogo roda depois da resposta, em `after()` do Next, drenando inbox e
outbox em lotes pequenos. A inbox persistida no Supabase é a fonte de verdade: se a
função morrer durante o dreno, o evento continua reivindicável e as funções de claim
aplicam backoff exponencial, `next_attempt_at` e dead letter após 8 tentativas.

Como cada entrega da Meta dispara um dreno não escopado, o próprio tráfego recupera o
backlog vencido — não há dependência de Vercel Cron frequente. Para backlog sem tráfego
novo (dead letter, incidente, janela ociosa), acione manualmente ou por agendador
externo, com o bearer do worker:

- `POST /api/internal/whatsapp/process-inbox`
- `POST /api/internal/whatsapp/process-outbox`

- [ ] Confirmar dreno pós-resposta em `after()` sem bloquear o `200`.
- [ ] Confirmar recuperação de backlog na entrega seguinte.
- [ ] Definir responsável por acionar os workers internos em incidente.

## 4. Mensagens e templates

- [ ] Receber mensagem pelo número de teste.
- [ ] Enviar resposta dentro da janela de atendimento.
- [ ] Processar status aceito, enviado, entregue, lido e falho.
- [ ] Criar templates transacionais necessários.
- [ ] Submeter templates à Meta.
- [ ] Registrar status aprovado somente após sincronização.
- [ ] Validar bloqueio fora da janela sem template aprovado.
- [ ] Validar variáveis, idiomas e fallback de cada template.
- [ ] Confirmar que aceitação da API não marca entrega.

## 5. Consentimento, privacidade e atendimento

- [ ] Publicar texto de opt-in com estabelecimento e finalidade.
- [ ] Registrar data, origem, versão e evidência do consentimento.
- [ ] Validar opt-out por comandos claros.
- [ ] Separar consentimento por tenant e categoria.
- [ ] Revisar política de privacidade e retenção.
- [ ] Aprovar TTLs, versão da policy e responsáveis por acionar `legal_hold`.
- [ ] Agendar `POST /api/internal/whatsapp/retention` com bearer do worker.
- [ ] Confirmar execução repetida até todos os contadores retornarem zero.
- [ ] Redigir conteúdo sensível em logs e métricas.
- [ ] Configurar fluxo de atendimento humano.
- [ ] Confirmar que outro tenant não visualiza conversa atribuída.
- [ ] Definir canal seguro para clínica e situações sensíveis.
- [ ] Publicar aviso de que WhatsApp não atende emergências.

## 6. Homologação e produção

- [ ] Executar migrations, pgTAP e teste horizontal entre dois tenants.
- [ ] Executar lint, typecheck, unitários e build.
- [ ] Executar integração com Supabase local.
- [ ] Executar Playwright com provedor mock.
- [ ] Simular duplicidade, atraso, fora de ordem e falha transitória.
- [ ] Simular dead letter e recuperação manual.
- [ ] Simular sessão abandonada, retenção em lote e `legal_hold`.
- [ ] Testar concorrência entre site e WhatsApp.
- [ ] Concluir agendamento controlado com número real de teste.
- [ ] Validar cancelamento, reagendamento e handoff.
- [ ] Configurar dashboards e alertas.
- [ ] Ativar homologação para grupo restrito.
- [ ] Revisar qualidade do número e limites de mensagens.
- [ ] Aprovar go-live com produto, segurança e operação.
- [ ] Ativar produção por feature flag.
- [ ] Monitorar webhooks, backlog, falhas e entregas durante lançamento.

## Critério de liberação

Marque integração real como ativa somente após receber e enviar mensagem real, processar
status, validar isolamento, concluir reserva controlada e comprovar rotação de segredo.
Mantenha provedor mock disponível para regressão depois do lançamento.

## Rollback

1. Desative canal real pela feature flag.
2. Preserve inbox e outbox para auditoria; não apague eventos durante incidente.
3. Suspenda worker de saída se houver risco de envio indevido.
4. Revogue credencial comprometida no cofre e na Meta.
5. Direcione atendimento para canal alternativo configurado.
6. Registre causa, janela afetada, eventos reprocessáveis e decisão de retomada.
