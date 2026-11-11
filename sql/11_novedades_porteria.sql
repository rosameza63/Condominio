-- Bitácora compartida entre vigilancia y administración.
create table if not exists public.novedades_porteria (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  ubicacion text not null,
  descripcion text not null default '',
  estado text not null default 'Pendiente'
    check (estado = any (array['Pendiente'::text, 'En seguimiento'::text, 'Atendida'::text])),
  creado_por_id uuid not null references public.usuarios(id) on delete restrict,
  creado_en timestamptz not null default now(),
  atendida_por_id uuid references public.usuarios(id) on delete set null,
  atendida_en timestamptz
);

create index if not exists novedades_porteria_fecha_idx
  on public.novedades_porteria (creado_en desc);

alter table public.novedades_porteria enable row level security;
grant select, insert, update on public.novedades_porteria to authenticated;
revoke all on public.novedades_porteria from anon;

drop policy if exists novedades_guardia_leer on public.novedades_porteria;
create policy novedades_guardia_leer on public.novedades_porteria
  for select to authenticated using (public.app_es_guardia());
drop policy if exists novedades_guardia_crear on public.novedades_porteria;
create policy novedades_guardia_crear on public.novedades_porteria
  for insert to authenticated with check (
    public.app_es_guardia() and creado_por_id = (select auth.uid())
  );
drop policy if exists novedades_admin_leer on public.novedades_porteria;
create policy novedades_admin_leer on public.novedades_porteria
  for select to authenticated using (public.app_es_administrador());
drop policy if exists novedades_admin_actualizar on public.novedades_porteria;
create policy novedades_admin_actualizar on public.novedades_porteria
  for update to authenticated using (public.app_es_administrador())
  with check (public.app_es_administrador());

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'novedades_porteria'
    ) then
    alter publication supabase_realtime add table public.novedades_porteria;
  end if;
end $$;
