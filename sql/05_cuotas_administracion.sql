-- Estados mensuales de pago de administración por inmueble.
-- No calcula valores ni usa coeficientes; administración registra Pagada/Pendiente.
-- Requiere las funciones de rol y acceso creadas en 02_politicas_rls.sql.

begin;

create table if not exists public.cuotas_administracion (
  id uuid primary key default gen_random_uuid(),
  inmueble_id uuid not null references public.inmuebles(id) on delete cascade,
  periodo date not null,
  estado text not null default 'Pendiente'
    check (estado = any (array['Pagada'::text, 'Pendiente'::text])),
  constraint cuotas_administracion_periodo_inicio_mes
    check (extract(day from periodo) = 1),
  constraint cuotas_administracion_inmueble_periodo_key
    unique (inmueble_id, periodo)
);

alter table public.cuotas_administracion enable row level security;
grant select, insert, update, delete on public.cuotas_administracion to authenticated;
revoke all on public.cuotas_administracion from anon;

drop policy if exists cuotas_administracion_admin_all on public.cuotas_administracion;
create policy cuotas_administracion_admin_all
  on public.cuotas_administracion for all to authenticated
  using (public.app_es_administrador())
  with check (public.app_es_administrador());

drop policy if exists cuotas_administracion_residente_ver on public.cuotas_administracion;
create policy cuotas_administracion_residente_ver
  on public.cuotas_administracion for select to authenticated
  using (public.app_es_residente() and public.app_accede_inmueble(inmueble_id));

commit;
