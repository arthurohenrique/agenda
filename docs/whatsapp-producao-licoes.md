# WhatsApp em produção: defeitos reais e invariantes

Registro da primeira operação real do canal, com número e cliente reais. Cada item
aqui só apareceu em uso — nenhum foi pego por teste, lint ou build. Leia antes de
mexer no caminho de conversa.

## Estado da infraestrutura

| Item | Valor |
|---|---|
| Domínio | `https://agenda.duatolz.com` |
| Webhook | `/api/integrations/whatsapp/webhook` |
| Supabase | região `aws-1-sa-east-1` |
| Funções Vercel | região `gru1`, fixada em `vercel.json` |
| Modo do canal | um número compartilhado entre todos os estabelecimentos |
| Atendimento humano | desligado por `tenant_whatsapp_settings.human_handoff_enabled` |

O canal roteia por código: `BARB01`, `SALAO1`, `VIDA01`. Sem código, o bot pergunta
qual estabelecimento.

## Defeitos encontrados em produção

### 1. Inbox gravada e nunca processada

O webhook persistia o envelope e respondia `200`, mas nada acionava os workers: não
há Vercel Cron no plano Hobby com frequência útil, e as rotas internas exigem bearer.
Mensagens reais ficariam paradas.

Correção: dreno em `after()` do Next, disparado após a resposta à Meta.

### 2. Cauda da rajada travada pela ordem

`claim_whatsapp_webhook_events` recusa um evento enquanto existir predecessor não
processado com chave de ordenação em comum — o que preserva a ordem dentro da
conversa e está correto.

A Meta entrega status em rajada, com décimos de segundo entre eventos. O dreno do
segundo encontrava o primeiro em voo, não reivindicava nada e terminava. Sendo o
último da rajada, ninguém voltava para buscá-lo.

Correção: o dreno repete a passada, com teto de 3 e 750ms entre elas. E `pg_cron`
no Supabase chama as rotas de worker a cada minuto, cobrindo o caso de a função
morrer antes de o `after()` concluir. O cron é a garantia; o `after()` é a latência.

### 3. Última mensagem do fluxo nunca entregue

`validate_whatsapp_outbox_delivery` recusava `conversation_reply` fora de
`('open', 'waiting_customer', 'processing')`. Como a transição move a conversa e
enfileira a resposta na mesma transação, **toda** conclusão chegava ao worker com a
conversa já fora da lista.

Seis caminhos perdiam a mensagem final de forma determinística: confirmação,
reagendamento, cancelamento e três variações de fluxo cancelado. O cliente
confirmava a reserva e não recebia retorno algum.

Correção: migration `0026`. `completed` e `closed` passam a ser aceitos.
`human_handoff` segue bloqueado — é o caso que a guarda existe para proteger.

### 4. App não inscrito na WABA

Configurar a URL de callback e assinar o campo `messages` é config **do app**. Falta
o passo que liga o app à conta WhatsApp Business:

```
POST /v{versão}/{WABA_ID}/subscribed_apps
```

Sem ele a Meta valida a URL, aceita a mensagem e nunca dispara webhook. O endpoint
fica impecável e a inbox vazia. Verifique com `GET` no mesmo caminho: `{"data":[]}`
significa não inscrito.

### 5. Rótulos de botão truncados

O limite do WhatsApp para título de botão é 20 caracteres; linha de lista, 24. O
código cortava com `slice`, sem reticência e no meio da palavra — o cliente via
"Confirmar agendament".

Correção: rótulos estáticos reescritos para caber, e `truncateBody` no lugar do
`slice` para conteúdo dinâmico. Um teste lê o arquivo de transições e falha se
qualquer rótulo estático passar de 20.

### 6. Toque em botão de mensagem antiga

O WhatsApp **não permite editar nem apagar mensagem entregue** pela Cloud API. Não
existe endpoint. Botão enviado fica tocável para sempre.

As chaves das opções são ordinais por estado (`1`, `2`, `3`), então um toque atrasado
casa com a pergunta atual e escolhe outra coisa. Em produção, "Sem preferência"
tocado num balão antigo virou seleção de profissional, sem qualquer sinal de erro.

Correção em camadas:

- `answeredPromptId` no contexto: cada pergunta interativa vale um toque.
- Comparação com a última saída: pega toques em balões bem mais antigos.
- Janela de acomodação de 1s antes de transicionar, só para toque de botão.

## Invariantes que não podem ser quebrados

**Gravar mensagem → travar conversa → transicionar.** Nessa ordem. A gravação
precede a trava para que toques concorrentes fiquem visíveis um ao outro; enquanto
gravava sob trava, o segundo toque ficava bloqueado e invisível. A marca d'água que
recusa evento fora de ordem é atômica na própria gravação, e a transição continua
sob trava com versão otimista.

**A inbox persistida é a fonte de verdade.** Se a função morrer no dreno, o evento
permanece reivindicável, com backoff e dead letter aplicados pelas funções de claim.
Nunca processe antes de persistir.

**A mensagem lançada pelo repositório não pode mudar.** `classifyWhatsAppError` casa
`error.message` exato contra a tabela de códigos transitórios, e é isso que separa
retry de dead letter. Para dar contexto, use `cause` — nunca altere a string.

**O logger tem allowlist de chaves.** Não invente campo. Código do Postgres vai em
`errorCode`, código de falha do repositório em `stage`. A mensagem do Postgres não
vai para o log: pode carregar valores da linha.

## Armadilhas de teste

O pgTAP só roda com Docker. Sem ele, cada erro custa um ciclo de CI. Duas
constraints que só aparecem em execução e já custaram duas idas:

- `whatsapp_outbox_lock_check` recusa lock parcial: `locked_at`, `locked_until` e
  `locked_by` andam juntos.
- `whatsapp_conversations_closed_check` amarra `closed_at` ao status: terminal exige
  data, não terminal exige nulo.

Fixtures devem derivar `tenant_id` da própria conversa — o FK composto
`(conversation_id, tenant_id)` exige que casem, e testes anteriores alteram esse
vínculo.

O lockfile precisa ser gerado com o npm da CI (Node 22.14 → npm 10.9.2). O npm 11
grava `"peer": true` e remove entradas opcionais, e `npm ci` rejeita. Rode
`npx npm@10.9.2 ci` antes de subir mudança de dependência.

## Pendente: aceitar o toque tardio como correção

Decisão do produto, ainda **não implementada**.

Medição em produção: dois toques deliberados ficaram **2,4 segundos** separados. A
janela de 1s fechou antes do segundo chegar, então ele caiu no caminho "já foi
respondida". Aumentar a janela para cobrir isso custaria segundos em todo toque.

Comportamento desejado: quando o cliente toca numa segunda opção da mesma pergunta
depois da janela, tratar como mudança de ideia — desfazer a escolha anterior e
aplicar a nova, em vez de recusar.

Limite de segurança: só é seguro desfazer enquanto não houve efeito colateral
externo. Depois de `createBooking`, a reserva existe e há mensagem enviada; aí o
caminho é cancelar e refazer, não desfazer em silêncio. O desenho precisa dizer
explicitamente até que estado o desfazer vale.

## Segurança em aberto

As contas de demonstração do `seed.sql` estão ativas no projeto de produção, com a
senha do arquivo — que é público no GitHub. Qualquer pessoa entra como dono de
estabelecimento em `agenda.duatolz.com`.

Não dá para removê-las: `tenants.created_by` e `customers.created_by` são
`not null references auth.users(id)` sem cascade. O caminho é trocar a senha por
`update auth.users set encrypted_password = extensions.crypt(...)` e apagar as
sessões abertas.
