-- Corrige asambleas_estado_check cuando 06_asambleas_quorum_votacion.sql
-- ya fue ejecutado y Supabase rechaza el estado "En Curso".
begin;

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
  add constraint asambleas_estado_check
  check (estado in ('Planificada', 'En Curso', 'Finalizada'));

commit;
