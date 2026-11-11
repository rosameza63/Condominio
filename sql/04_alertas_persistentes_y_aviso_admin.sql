-- Registra un aviso interno para cada administrador por cada alerta nueva.
-- Ejecutar en Supabase SQL Editor después de 01_schema_adiciones.sql
-- y 02_politicas_rls.sql.

begin;

-- Guarda una instantánea del emisor y las instrucciones para conservar el
-- contexto histórico aunque después cambie el perfil o la unidad.
alter table public.alertas_emergencia
  add column if not exists nombre_activador text,
  add column if not exists inmueble_activador text,
  add column if not exists telefono_activador text,
  add column if not exists detalle_alerta text;

-- Residentes pueden consultar alertas generales además de las propias.
drop policy if exists alertas_residente_generales_leer on public.alertas_emergencia;
create policy alertas_residente_generales_leer on public.alertas_emergencia
  for select to authenticated
  using (public.app_es_residente() and origen = 'general');

-- Administración puede consultar las notificaciones dirigidas a su cuenta.
drop policy if exists notificaciones_admin_leer on public.notificaciones;
create policy notificaciones_admin_leer on public.notificaciones
  for select to authenticated
  using (public.app_es_administrador() and usuario_id = (select auth.uid()));

create or replace function public.app_notificar_admin_nueva_alerta()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tipo text;
  v_titulo text;
  v_mensaje text;
begin
  v_tipo := case when new.origen = 'general' then 'Alerta general desde portería'
                 else 'Botón de pánico de residente' end;
  v_titulo := case when new.origen = 'general' then 'Alerta general activada'
                   else 'Un residente pidió ayuda' end;
  v_mensaje := case when new.origen = 'general' then
    coalesce(nullif(new.nombre_activador, ''), 'Vigilancia') ||
    ' activó la alerta general. Instrucciones: ' ||
    coalesce(nullif(new.detalle_alerta, ''), 'Siga las indicaciones de portería.')
  else
    coalesce(nullif(new.nombre_activador, ''), 'Residente') ||
    ' activó el botón de pánico desde ' || coalesce(nullif(new.inmueble_activador, ''), 'inmueble sin identificar') ||
    case when nullif(new.telefono_activador, '') is null then '' else ' · Teléfono: ' || new.telefono_activador end
  end;

  insert into public.notificaciones (usuario_id, tipo, titulo, mensaje, creada_por)
  select u.id, v_tipo, v_titulo, v_mensaje, new.usuario_id
  from public.usuarios u
  where u.rol = 'Administrador';
  return new;
end;
$$;

revoke all on function public.app_notificar_admin_nueva_alerta() from public, anon, authenticated;
drop trigger if exists alertas_notificar_administradores on public.alertas_emergencia;
create trigger alertas_notificar_administradores
  after insert on public.alertas_emergencia
  for each row execute function public.app_notificar_admin_nueva_alerta();

-- Habilita eventos en tiempo real para las alertas y la bandeja de avisos.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'alertas_emergencia'
  ) then
    alter publication supabase_realtime add table public.alertas_emergencia;
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
