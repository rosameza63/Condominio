-- Campos para gestionar PQRS desde el portal y asociarlas al inmueble correspondiente.
-- Ejecutar una vez en Supabase > SQL Editor después de 01_schema_adiciones.sql y 02_politicas_rls.sql.

begin;

alter table public.pqrs
  add column if not exists asunto text,
  add column if not exists inmueble_id uuid references public.inmuebles(id) on delete set null,
  add column if not exists respuesta_administracion text,
  add column if not exists actualizado_en timestamptz not null default now();

update public.pqrs
set asunto = coalesce(nullif(left(btrim(descripcion), 120), ''), nullif(tipo_pqr, ''), 'Solicitud')
where asunto is null;

create index if not exists pqrs_fecha_creacion_idx on public.pqrs (fecha_creacion desc);
create index if not exists pqrs_inmueble_id_idx on public.pqrs (inmueble_id);

-- El residente solo puede crear PQRS propias y asociarlas a una unidad a la que tiene acceso.
drop policy if exists pqrs_residente_crear on public.pqrs;
create policy pqrs_residente_crear on public.pqrs
  for insert to authenticated with check (
    public.app_es_residente()
    and usuario_id = (select auth.uid())
    and (inmueble_id is null or public.app_accede_inmueble(inmueble_id))
  );

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'pqrs'
     ) then
    alter publication supabase_realtime add table public.pqrs;
  end if;
end $$;

commit;
