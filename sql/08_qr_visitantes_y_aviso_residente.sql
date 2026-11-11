-- QR de visitantes, aviso interno al residente y datos para el aviso manual
-- opcional por WhatsApp desde el celular de portería.
-- Ejecutar en Supabase SQL Editor después de 01_schema_adiciones.sql,
-- 02_politicas_rls.sql y 04_alertas_persistentes_y_aviso_admin.sql.

begin;

alter table public.registro_visitas
  add column if not exists telefono_residente text;

-- La bandeja de notificaciones queda disponible para residentes.
drop policy if exists notificaciones_residente_leer on public.notificaciones;
create policy notificaciones_residente_leer on public.notificaciones
  for select to authenticated using (usuario_id = (select auth.uid()));
drop policy if exists notificaciones_residente_marcar_leida on public.notificaciones;
create policy notificaciones_residente_marcar_leida on public.notificaciones
  for update to authenticated using (usuario_id = (select auth.uid()))
  with check (usuario_id = (select auth.uid()));

create or replace function public.app_notificar_llegada_visitante()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inmueble text;
begin
  if old.fecha_hora_ingreso is null and new.fecha_hora_ingreso is not null
     and new.autorizado_por is not null then
    select i.identificador into v_inmueble
    from public.inmuebles i
    where i.id = new.inmueble_id;

    insert into public.notificaciones (usuario_id, tipo, titulo, mensaje, creada_por)
    values (
      new.autorizado_por,
      'Llegada de visitante',
      'Tu visitante llegó',
      coalesce(nullif(new.nombre_visitante, ''), 'Tu visitante') ||
        ' llegó a portería para visitar ' || coalesce(v_inmueble, 'tu inmueble') || '.',
      auth.uid()
    );
  end if;
  return new;
end;
$$;

revoke all on function public.app_notificar_llegada_visitante() from public, anon, authenticated;
drop trigger if exists registro_visitas_notificar_residente on public.registro_visitas;
create trigger registro_visitas_notificar_residente
  after update of fecha_hora_ingreso on public.registro_visitas
  for each row execute function public.app_notificar_llegada_visitante();

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'registro_visitas'
  ) then
    alter publication supabase_realtime add table public.registro_visitas;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notificaciones'
  ) then
    alter publication supabase_realtime add table public.notificaciones;
  end if;
end $$;

commit;
