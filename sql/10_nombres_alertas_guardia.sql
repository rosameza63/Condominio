-- Permite que vigilancia vea el nombre asociado a una alerta sin conceder
-- acceso de lectura a los perfiles completos de residentes.
create or replace function public.app_nombres_alertas_guardia(p_alerta_ids uuid[])
returns table (alerta_id uuid, nombre_residente text)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, u.nombre_completo
  from public.alertas_emergencia as a
  join public.usuarios as u on u.id = a.usuario_id
  where public.app_es_guardia()
    and a.id = any(coalesce(p_alerta_ids, array[]::uuid[]));
$$;

revoke all on function public.app_nombres_alertas_guardia(uuid[]) from public, anon;
grant execute on function public.app_nombres_alertas_guardia(uuid[]) to authenticated;
