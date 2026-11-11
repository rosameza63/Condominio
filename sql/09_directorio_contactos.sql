-- Directorio del conjunto: contactos públicos para residentes y vigilancia.
-- Ejecutar después de 02_politicas_rls.sql para usar app_es_administrador().

begin;

create table if not exists public.directorio_contactos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  categoria text not null default 'General',
  telefono text,
  whatsapp text,
  email text,
  horario_atencion text,
  descripcion text,
  activo boolean not null default true,
  orden integer not null default 0,
  creado_por uuid references public.usuarios(id) on delete set null,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  constraint directorio_contactos_nombre_no_vacio check (length(btrim(nombre)) > 0),
  constraint directorio_contactos_categoria_no_vacia check (length(btrim(categoria)) > 0)
);

create index if not exists directorio_contactos_publicacion_idx
  on public.directorio_contactos (activo, orden, categoria, nombre);

alter table public.directorio_contactos enable row level security;
grant select, insert, update, delete on public.directorio_contactos to authenticated;
revoke all on public.directorio_contactos from anon;

drop policy if exists directorio_contactos_publicos_leer on public.directorio_contactos;
create policy directorio_contactos_publicos_leer
  on public.directorio_contactos for select to authenticated
  using (activo or public.app_es_administrador());

drop policy if exists directorio_contactos_admin_gestionar on public.directorio_contactos;
create policy directorio_contactos_admin_gestionar
  on public.directorio_contactos for all to authenticated
  using (public.app_es_administrador())
  with check (public.app_es_administrador());

commit;
