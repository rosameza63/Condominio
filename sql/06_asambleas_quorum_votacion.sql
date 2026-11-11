-- Asambleas: quórum por inmueble, una participación por inmueble y respuestas configurables.
-- Ejecutar después de 01_schema_adiciones.sql y 02_politicas_rls.sql.

begin;

-- Unifica los estados que utiliza la aplicación y sustituye la restricción
-- anterior que rechazaba el valor "En Curso".
alter table public.asambleas drop constraint if exists asambleas_estado_check;
update public.asambleas set estado = 'En Curso' where estado = 'En curso';
do $$ begin
  if exists (
    select 1 from public.asambleas
    where estado not in ('Planificada', 'En Curso', 'Finalizada') or estado is null
  ) then
    raise exception 'Hay estados de asamblea distintos de Planificada, En Curso o Finalizada; revíselos antes de continuar.';
  end if;
end $$;
alter table public.asambleas
  add constraint asambleas_estado_check check (estado in ('Planificada', 'En Curso', 'Finalizada'));

alter table public.preguntas_votacion
  add column if not exists opciones jsonb not null default '["Sí", "No", "Abstenerse"]'::jsonb,
  add column if not exists opcion_aprobatoria text;
update public.preguntas_votacion
set opciones = '["Sí", "No", "Abstenerse"]'::jsonb
where opciones is null or jsonb_typeof(opciones) <> 'array' or jsonb_array_length(opciones) < 2;
alter table public.preguntas_votacion
  alter column opciones set default '["Sí", "No", "Abstenerse"]'::jsonb,
  alter column opciones set not null;

alter table public.asistencia_asamblea
  add column if not exists inmueble_id uuid references public.inmuebles(id) on delete cascade,
  add column if not exists coeficiente numeric;
alter table public.votos
  add column if not exists inmueble_id uuid references public.inmuebles(id) on delete cascade,
  add column if not exists coeficiente numeric;

-- Las opciones de voto son configurables por pregunta. La restricción antigua
-- votos_opcion_votada_check solo admite respuestas fijas y bloquea opciones nuevas.
alter table public.votos drop constraint if exists votos_opcion_votada_check;

create or replace function public.validar_opcion_voto_asamblea()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_opciones jsonb;
begin
  select q.opciones into v_opciones
  from public.preguntas_votacion q
  where q.id = new.pregunta_id;
  if v_opciones is null or not (v_opciones @> jsonb_build_array(new.opcion_votada)) then
    raise exception 'La opción elegida no pertenece a esta pregunta.';
  end if;
  return new;
end;
$$;

drop trigger if exists votos_validar_opcion_asamblea on public.votos;
create trigger votos_validar_opcion_asamblea
  before insert or update of pregunta_id, opcion_votada on public.votos
  for each row execute function public.validar_opcion_voto_asamblea();

create unique index if not exists asistencia_asamblea_un_inmueble
  on public.asistencia_asamblea (asamblea_id, inmueble_id) where inmueble_id is not null;
create unique index if not exists votos_un_inmueble_por_pregunta
  on public.votos (pregunta_id, inmueble_id) where inmueble_id is not null;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'preguntas_votacion_opciones_lista') then
    alter table public.preguntas_votacion add constraint preguntas_votacion_opciones_lista
      check (jsonb_typeof(opciones) = 'array' and jsonb_array_length(opciones) >= 2);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'preguntas_votacion_opcion_aprobatoria_valida') then
    alter table public.preguntas_votacion add constraint preguntas_votacion_opcion_aprobatoria_valida
      check (opcion_aprobatoria is null or opciones @> jsonb_build_array(opcion_aprobatoria));
  end if;
end $$;

create or replace function public.registrar_asistencia_asamblea(p_asamblea_id uuid, p_inmueble_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_coeficiente numeric;
  v_id uuid;
  v_autorizado boolean;
begin
  if not public.app_es_residente() then raise exception 'Solo un residente puede registrar asistencia.'; end if;
  if not exists (select 1 from public.asambleas a where a.id = p_asamblea_id and a.estado = 'En Curso') then
    raise exception 'La asamblea no está en curso.';
  end if;
  select exists (
    select 1 from public.inmueble_usuarios iu
    left join public.tipos_residente tr on tr.codigo = iu.tipo_residente_codigo
    where iu.usuario_id = v_uid and iu.inmueble_id = p_inmueble_id
      and (lower(coalesce(tr.codigo, '')) like '%propiet%' or lower(coalesce(tr.nombre, '')) = 'propietario')
  ) or exists (
    select 1 from public.usuarios u where u.id = v_uid and u.inmueble_id = p_inmueble_id
      and lower(coalesce(u.tipo_residente, '')) = 'propietario'
  ) into v_autorizado;
  if not v_autorizado then raise exception 'La cuenta no está registrada como propietaria de ese inmueble.'; end if;
  select i.coeficiente into v_coeficiente from public.inmuebles i where i.id = p_inmueble_id;
  if v_coeficiente is null then raise exception 'El inmueble no tiene un coeficiente registrado.'; end if;
  insert into public.asistencia_asamblea (id, asamblea_id, usuario_id, hora_registro, presente, inmueble_id, coeficiente)
  values (gen_random_uuid(), p_asamblea_id, v_uid, now(), true, p_inmueble_id, v_coeficiente)
  on conflict (asamblea_id, inmueble_id) where inmueble_id is not null do nothing
  returning id into v_id;
  if v_id is null then
    select aa.id into v_id from public.asistencia_asamblea aa
    where aa.asamblea_id = p_asamblea_id and aa.inmueble_id = p_inmueble_id;
  end if;
  return v_id;
end;
$$;

create or replace function public.registrar_voto_asamblea(p_pregunta_id uuid, p_inmueble_id uuid, p_opcion text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_assembly_id uuid;
  v_status text;
  v_options jsonb;
  v_coeficiente numeric;
  v_id uuid;
begin
  if not public.app_es_residente() then raise exception 'Solo un residente puede votar.'; end if;
  select a.id, a.estado, q.opciones into v_assembly_id, v_status, v_options
  from public.preguntas_votacion q join public.asambleas a on a.id = q.asamblea_id
  where q.id = p_pregunta_id and q.estado_pregunta = 'Activa';
  if v_assembly_id is null or v_status <> 'En Curso' then raise exception 'La pregunta no está activa en una asamblea en curso.'; end if;
  if not exists (
    select 1 from public.asistencia_asamblea aa
    where aa.asamblea_id = v_assembly_id and aa.inmueble_id = p_inmueble_id and aa.presente
      and aa.usuario_id = v_uid
  ) then raise exception 'Registra asistencia del inmueble antes de votar.'; end if;
  if not (v_options @> jsonb_build_array(p_opcion)) then raise exception 'La opción elegida no pertenece a esta pregunta.'; end if;
  select i.coeficiente into v_coeficiente from public.inmuebles i where i.id = p_inmueble_id;
  insert into public.votos (id, pregunta_id, usuario_id, opcion_votada, fecha_hora, inmueble_id, coeficiente)
  values (gen_random_uuid(), p_pregunta_id, v_uid, p_opcion, now(), p_inmueble_id, v_coeficiente)
  on conflict (pregunta_id, inmueble_id) where inmueble_id is not null do nothing
  returning id into v_id;
  if v_id is null then raise exception 'Este inmueble ya registró un voto para la pregunta.'; end if;
  return v_id;
end;
$$;

create or replace function public.cambiar_estado_pregunta_asamblea(p_pregunta_id uuid, p_estado text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_asamblea_id uuid; v_estado_asamblea text; v_total integer; v_minimo integer; v_presentes integer;
begin
  if not public.app_es_administrador() then raise exception 'Solo administración puede cambiar el estado de las preguntas.'; end if;
  if p_estado not in ('Activa','Cerrada') then raise exception 'Estado de pregunta no válido.'; end if;
  select q.asamblea_id, a.estado into v_asamblea_id, v_estado_asamblea
  from public.preguntas_votacion q join public.asambleas a on a.id = q.asamblea_id
  where q.id = p_pregunta_id;
  if v_asamblea_id is null then raise exception 'No se encontró la pregunta.'; end if;
  if p_estado = 'Activa' then
    if v_estado_asamblea <> 'En Curso' then raise exception 'Inicia la asamblea antes de activar preguntas.'; end if;
    select count(*) into v_total from public.inmuebles;
    select count(distinct inmueble_id) into v_presentes from public.asistencia_asamblea
      where asamblea_id = v_asamblea_id and presente and inmueble_id is not null;
    v_minimo := floor(v_total / 2.0)::integer + 1;
    if v_presentes < v_minimo then raise exception 'No hay quórum: se requieren % inmuebles presentes y hay %.', v_minimo, v_presentes; end if;
    update public.preguntas_votacion set estado_pregunta = 'Cerrada'
      where asamblea_id = v_asamblea_id and id <> p_pregunta_id and estado_pregunta = 'Activa';
  end if;
  update public.preguntas_votacion set estado_pregunta = p_estado where id = p_pregunta_id;
end;
$$;

create or replace function public.cambiar_estado_asamblea(p_asamblea_id uuid, p_estado text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_estado_actual text;
begin
  if not public.app_es_administrador() then raise exception 'Solo administración puede cambiar el estado de la asamblea.'; end if;
  if p_estado not in ('En Curso','Finalizada') then raise exception 'Estado de asamblea no válido.'; end if;
  select estado into v_estado_actual from public.asambleas where id = p_asamblea_id;
  if v_estado_actual is null then raise exception 'No se encontró la asamblea.'; end if;
  if not ((v_estado_actual = 'Planificada' and p_estado = 'En Curso') or (v_estado_actual = 'En Curso' and p_estado = 'Finalizada')) then
    raise exception 'El cambio de estado solicitado no está permitido.';
  end if;
  if p_estado = 'Finalizada' then
    update public.preguntas_votacion set estado_pregunta = 'Cerrada'
      where asamblea_id = p_asamblea_id and estado_pregunta = 'Activa';
  end if;
  update public.asambleas set estado = p_estado where id = p_asamblea_id;
end;
$$;

revoke all on function public.registrar_asistencia_asamblea(uuid, uuid) from public, anon;
revoke all on function public.registrar_voto_asamblea(uuid, uuid, text) from public, anon;
revoke all on function public.cambiar_estado_pregunta_asamblea(uuid, text) from public, anon;
revoke all on function public.cambiar_estado_asamblea(uuid, text) from public, anon;
grant execute on function public.registrar_asistencia_asamblea(uuid, uuid) to authenticated;
grant execute on function public.registrar_voto_asamblea(uuid, uuid, text) to authenticated;
grant execute on function public.cambiar_estado_pregunta_asamblea(uuid, text) to authenticated;
grant execute on function public.cambiar_estado_asamblea(uuid, text) to authenticated;

-- Habilita los cambios en tiempo real cuando el proyecto ya tiene la publicación estándar de Supabase.
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['asambleas','preguntas_votacion','asistencia_asamblea','votos'] loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

commit;
