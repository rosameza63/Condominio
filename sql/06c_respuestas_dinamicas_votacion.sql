-- Permite votar con las opciones configuradas en cada pregunta.
-- Ejecutar en Supabase SQL Editor si 06_asambleas_quorum_votacion.sql ya se ejecutó.

begin;

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

commit;
