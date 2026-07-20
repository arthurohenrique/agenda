begin;

insert into storage.buckets (
  id, name, public, file_size_limit, allowed_mime_types
) values (
  'tenant-assets',
  'tenant-assets',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/avif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (
  id, name, public, file_size_limit, allowed_mime_types
) values (
  'private-forms',
  'private-forms',
  false,
  8388608,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy tenant_assets_public_read
on storage.objects for select
to anon, authenticated
using (
  bucket_id = 'tenant-assets'
  and app_private.is_published_tenant(((storage.foldername(name))[1])::uuid)
);

create policy tenant_assets_manager_insert
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'tenant-assets'
  and app_private.has_tenant_role(
    ((storage.foldername(name))[1])::uuid,
    array['owner', 'admin']::public.tenant_role[]
  )
  and lower(storage.extension(name)) = any (array['jpg', 'jpeg', 'png', 'webp', 'avif'])
);

create policy tenant_assets_manager_update
on storage.objects for update
to authenticated
using (
  bucket_id = 'tenant-assets'
  and app_private.has_tenant_role(
    ((storage.foldername(name))[1])::uuid,
    array['owner', 'admin']::public.tenant_role[]
  )
)
with check (
  bucket_id = 'tenant-assets'
  and app_private.has_tenant_role(
    ((storage.foldername(name))[1])::uuid,
    array['owner', 'admin']::public.tenant_role[]
  )
  and lower(storage.extension(name)) = any (array['jpg', 'jpeg', 'png', 'webp', 'avif'])
);

create policy tenant_assets_manager_delete
on storage.objects for delete
to authenticated
using (
  bucket_id = 'tenant-assets'
  and app_private.has_tenant_role(
    ((storage.foldername(name))[1])::uuid,
    array['owner', 'admin']::public.tenant_role[]
  )
);

create policy private_forms_authorized_read
on storage.objects for select
to authenticated
using (
  bucket_id = 'private-forms'
  and app_private.has_permission(((storage.foldername(name))[1])::uuid, 'sensitive_data')
);

create policy private_forms_authorized_insert
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'private-forms'
  and app_private.has_permission(((storage.foldername(name))[1])::uuid, 'sensitive_data')
  and lower(storage.extension(name)) = any (array['pdf', 'jpg', 'jpeg', 'png', 'webp'])
);

create policy private_forms_authorized_delete
on storage.objects for delete
to authenticated
using (
  bucket_id = 'private-forms'
  and app_private.has_tenant_role(
    ((storage.foldername(name))[1])::uuid,
    array['owner']::public.tenant_role[]
  )
);

commit;
