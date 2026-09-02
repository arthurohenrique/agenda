begin;

-- Visualizador de conversas ao vivo: o painel do estabelecimento acompanha o
-- cliente escrevendo e o bot respondendo sem recarregar a página.
--
-- Só `whatsapp_messages` entra na publicação, e somente com as colunas que o
-- visualizador renderiza. `whatsapp_conversations` fica de fora porque o
-- `context` jsonb carrega os slots da máquina de estados (serviço escolhido,
-- data, nome do cliente) e seria transmitido a cada transição.
-- `whatsapp_contacts` fica de fora porque não tem `tenant_id`: nenhum filtro
-- `eq` seria possível e todo assinante receberia todo contato.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'whatsapp_messages'
  ) then
    alter publication supabase_realtime
      add table public.whatsapp_messages (
        id, conversation_id, tenant_id, direction, message_type,
        status, content, error_code, sent_at, created_at
      );
  end if;
end;
$$;

-- Sem `replica identity full`, ao contrário de `appointments` (0019). O INSERT
-- já viaja com a tupla nova completa, e é sobre ela que o filtro
-- `tenant_id=eq.<id>` é avaliado. `full` só serviria para o `old_record` de
-- UPDATE/DELETE — e é justamente ele que não pode sair daqui: o UPDATE de
-- redação da retenção (0024) mandaria o `content` anterior à redação para todo
-- gestor inscrito, ou seja, o texto que a política acabou de apagar.

commit;
