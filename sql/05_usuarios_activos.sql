-- Agrega una baja reversible para usuarios y bloquea el acceso de perfiles inactivos.
-- Ejecutar en Supabase SQL Editor antes de desplegar la gestión de usuarios.
begin;

alter table public.usuarios
  add column if not exists activo boolean not null default true;

create or replace function public.app_rol_actual()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select u.rol
  from public.usuarios as u
  where u.id = (select auth.uid()) and u.activo = true
  limit 1;
$$;

revoke all on function public.app_rol_actual() from public, anon;
grant execute on function public.app_rol_actual() to authenticated;

commit;
