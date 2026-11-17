-- Registro múltiple de parqueaderos y mascotas por propietario e inmueble.
begin;

create table if not exists public.parqueaderos (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  inmueble_id uuid not null references public.inmuebles(id) on delete cascade,
  numero text not null,
  tipo text not null default 'Automóvil'
    check (tipo in ('Automóvil', 'Motocicleta', 'Bicicleta', 'Otro')),
  placa text,
  observaciones text,
  creado_en timestamptz not null default now(),
  constraint parqueaderos_numero_unico_por_inmueble unique (inmueble_id, numero)
);
create index if not exists parqueaderos_usuario_idx on public.parqueaderos(usuario_id);
create index if not exists parqueaderos_inmueble_idx on public.parqueaderos(inmueble_id);

create table if not exists public.mascotas (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  inmueble_id uuid not null references public.inmuebles(id) on delete cascade,
  nombre text not null,
  especie text not null check (especie in ('Perro', 'Gato', 'Ave', 'Otro')),
  raza text,
  color text,
  observaciones text,
  creado_en timestamptz not null default now()
);
create index if not exists mascotas_usuario_idx on public.mascotas(usuario_id);
create index if not exists mascotas_inmueble_idx on public.mascotas(inmueble_id);

create table if not exists public.vacunas_mascotas (
  id uuid primary key default gen_random_uuid(),
  mascota_id uuid not null references public.mascotas(id) on delete cascade,
  vacuna text not null,
  fecha_aplicacion date not null,
  proxima_dosis date,
  veterinaria text,
  observaciones text,
  creado_en timestamptz not null default now(),
  constraint vacunas_mascotas_fechas_validas
    check (proxima_dosis is null or proxima_dosis >= fecha_aplicacion)
);
create index if not exists vacunas_mascotas_mascota_fecha_idx
  on public.vacunas_mascotas(mascota_id, fecha_aplicacion desc);

alter table public.parqueaderos enable row level security;
alter table public.mascotas enable row level security;
alter table public.vacunas_mascotas enable row level security;
revoke all on public.parqueaderos, public.mascotas, public.vacunas_mascotas from anon;
grant select, insert, update, delete on public.parqueaderos, public.mascotas, public.vacunas_mascotas to authenticated;

drop policy if exists parqueaderos_administracion on public.parqueaderos;
create policy parqueaderos_administracion on public.parqueaderos
  for all to authenticated using (public.app_es_administrador())
  with check (public.app_es_administrador());
drop policy if exists parqueaderos_residentes_consulta on public.parqueaderos;
create policy parqueaderos_residentes_consulta on public.parqueaderos
  for select to authenticated using (public.app_es_residente() and public.app_accede_inmueble(inmueble_id));
drop policy if exists parqueaderos_guardia_consulta on public.parqueaderos;
create policy parqueaderos_guardia_consulta on public.parqueaderos
  for select to authenticated using (public.app_es_guardia());

drop policy if exists mascotas_administracion on public.mascotas;
create policy mascotas_administracion on public.mascotas
  for all to authenticated using (public.app_es_administrador())
  with check (public.app_es_administrador());
drop policy if exists mascotas_residentes_consulta on public.mascotas;
create policy mascotas_residentes_consulta on public.mascotas
  for select to authenticated using (public.app_es_residente() and public.app_accede_inmueble(inmueble_id));
drop policy if exists mascotas_guardia_consulta on public.mascotas;
create policy mascotas_guardia_consulta on public.mascotas
  for select to authenticated using (public.app_es_guardia());

drop policy if exists vacunas_mascotas_administracion on public.vacunas_mascotas;
create policy vacunas_mascotas_administracion on public.vacunas_mascotas
  for all to authenticated using (public.app_es_administrador())
  with check (public.app_es_administrador());
drop policy if exists vacunas_mascotas_residentes_consulta on public.vacunas_mascotas;
create policy vacunas_mascotas_residentes_consulta on public.vacunas_mascotas
  for select to authenticated using (
    public.app_es_residente() and exists (
      select 1 from public.mascotas m
      where m.id = mascota_id and public.app_accede_inmueble(m.inmueble_id)
    )
  );
drop policy if exists vacunas_mascotas_guardia_consulta on public.vacunas_mascotas;
create policy vacunas_mascotas_guardia_consulta on public.vacunas_mascotas
  for select to authenticated using (public.app_es_guardia());

-- Portería consulta nombres puntuales sin permiso para leer la tabla completa de usuarios.
create or replace function public.app_nombres_propietarios_activos(p_usuario_ids uuid[])
returns table (usuario_id uuid, nombre_completo text)
language sql stable security definer set search_path = ''
as $$
  select u.id, u.nombre_completo
  from public.usuarios u
  where public.app_es_guardia()
    and u.id = any(coalesce(p_usuario_ids, array[]::uuid[]));
$$;
revoke all on function public.app_nombres_propietarios_activos(uuid[]) from public, anon;
grant execute on function public.app_nombres_propietarios_activos(uuid[]) to authenticated;

commit;
