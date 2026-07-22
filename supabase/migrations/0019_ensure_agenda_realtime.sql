begin;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'appointments'
  ) then
    alter publication supabase_realtime add table public.appointments;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'calendar_blocks'
  ) then
    alter publication supabase_realtime add table public.calendar_blocks;
  end if;
end;
$$;

alter table public.appointments replica identity full;
alter table public.calendar_blocks replica identity full;

commit;
