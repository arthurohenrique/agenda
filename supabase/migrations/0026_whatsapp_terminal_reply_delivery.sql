begin;

-- A validação pré-envio recusava `conversation_reply` fora de
-- ('open', 'waiting_customer', 'processing'). A guarda existe para um caso só,
-- descrito no pgTAP da 0021: a conversa entra em atendimento humano depois que o
-- worker já reivindicou uma resposta automática, e essa resposta não pode sair.
--
-- Terminais de sucesso não são esse caso. `commit_whatsapp_conversation_transition`
-- move a conversa e enfileira a resposta na mesma transação, então toda transição
-- terminal chegava ao worker com a conversa já fora da lista e tinha a mensagem
-- cancelada com `conversation_delivery_invalidated`. Seis caminhos perdiam a
-- última mensagem de forma determinística:
--
--   completed  BOOKING_COMPLETED  "Agendamento confirmado em ..."
--   completed  BOOKING_COMPLETED  "Agendamento reagendado para ..."
--   completed  BOOKING_COMPLETED  "Agendamento cancelado."
--   closed     CANCELLED          "Fluxo cancelado. Envie “Menu” ..."  (3 caminhos)
--
-- O cliente confirmava a reserva e não recebia retorno algum. O agendamento era
-- criado, mas a última mensagem que ele via era o resumo com os botões.
--
-- `completed` e `closed` passam a ser aceitos: a resposta pendente nesse instante
-- foi produzida pela própria transição que encerrou a conversa. `human_handoff`
-- segue bloqueado, assim como `expired` e `failed`, em que a sessão morreu antes
-- de a resposta sair. A segunda condição, sobre `conversation_handoff_requested`,
-- é preservada — é ela que cancela o backlog na entrada do handoff.

create or replace function public.validate_whatsapp_outbox_delivery(
  p_outbox_id uuid,
  p_worker_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.whatsapp_outbox%rowtype;
  v_appointment public.appointments%rowtype;
  v_appointment_id uuid;
  v_conversation_id uuid;
  v_purpose text;
  v_event_type text;
  v_valid boolean;
  v_conversation_status public.whatsapp_conversation_status;
begin
  -- A conversa é o fence entre a validação imediatamente anterior ao envio e a
  -- entrada em handoff. A ordem do lock deve ser conversa -> outbox, igual à
  -- transição conversacional, para não abrir janela nem criar deadlock.
  select item.conversation_id into v_conversation_id
  from public.whatsapp_outbox item
  where item.id = p_outbox_id
    and item.status = 'processing'
    and item.locked_by = trim(p_worker_id)
    and item.locked_until > statement_timestamp();

  if v_conversation_id is null then
    return false;
  end if;

  select conversation.status into v_conversation_status
  from public.whatsapp_conversations conversation
  where conversation.id = v_conversation_id
  for update;

  select * into v_item
  from public.whatsapp_outbox item
  where item.id = p_outbox_id
    and item.status = 'processing'
    and item.locked_by = trim(p_worker_id)
    and item.locked_until > statement_timestamp()
  for update;

  if v_item.id is null then
    return false;
  end if;

  v_purpose := v_item.payload ->> 'purpose';
  if v_purpose in ('conversation_reply', 'handoff_acknowledgement') then
    v_valid := case v_purpose
      when 'handoff_acknowledgement' then v_conversation_status = 'human_handoff'
      -- `completed` e `closed` incluídos: a resposta que encerra o fluxo é
      -- enfileirada junto com o encerramento e é legítima.
      else v_conversation_status in (
        'open', 'waiting_customer', 'processing', 'completed', 'closed'
      )
        and v_item.last_error is distinct from 'conversation_handoff_requested'
    end;

    if v_valid then
      return true;
    end if;

    update public.whatsapp_outbox
    set status = 'cancelled',
        processed_at = statement_timestamp(),
        locked_at = null,
        locked_until = null,
        locked_by = null,
        last_error = 'conversation_delivery_invalidated'
    where id = v_item.id;

    update public.whatsapp_messages
    set status = 'ignored',
        processed_at = coalesce(processed_at, statement_timestamp()),
        error_code = 'conversation_delivery_invalidated',
        error_message = null
    where id = v_item.message_id;

    return false;
  end if;

  if v_purpose not in (
    'appointment_created', 'appointment_confirmed', 'appointment_reminder',
    'appointment_rescheduled', 'appointment_cancelled',
    'appointment_confirmation_request'
  ) then
    return true;
  end if;

  begin
    v_appointment_id := (v_item.payload ->> 'appointmentId')::uuid;
  exception when invalid_text_representation then
    v_appointment_id := null;
  end;
  v_event_type := v_item.payload ->> 'eventType';

  if v_appointment_id is not null then
    select * into v_appointment
    from public.appointments appointment
    where appointment.id = v_appointment_id
      and appointment.tenant_id is not distinct from v_item.tenant_id
    for key share;
  end if;

  v_valid := v_appointment.id is not null and case v_purpose
    when 'appointment_cancelled' then
      v_event_type = 'appointment.cancelled'
      and v_appointment.status in ('cancelled_by_customer', 'cancelled_by_business')
    when 'appointment_rescheduled' then
      v_event_type = 'appointment.rescheduled'
      and v_appointment.occupies_slot
      and v_appointment.starts_at > statement_timestamp()
    when 'appointment_reminder' then
      v_event_type = 'appointment.reminder_due'
      and v_appointment.occupies_slot
      and v_appointment.starts_at > statement_timestamp()
    when 'appointment_confirmed' then
      v_event_type = 'appointment.confirmed'
      and v_appointment.occupies_slot
      and v_appointment.starts_at > statement_timestamp()
    when 'appointment_created' then
      v_event_type = 'appointment.created'
      and v_appointment.occupies_slot
      and v_appointment.starts_at > statement_timestamp()
    when 'appointment_confirmation_request' then
      v_appointment.occupies_slot
      and v_appointment.starts_at > statement_timestamp()
    else false
  end;

  if v_valid then
    return true;
  end if;

  update public.whatsapp_outbox
  set status = 'cancelled',
      processed_at = statement_timestamp(),
      locked_at = null,
      locked_until = null,
      locked_by = null,
      last_error = 'appointment_delivery_invalidated'
  where id = v_item.id;

  update public.whatsapp_messages
  set status = 'ignored',
      error_code = 'appointment_delivery_invalidated'
  where id = v_item.message_id;

  return false;
end;
$$;

commit;
