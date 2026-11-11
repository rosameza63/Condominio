-- Altos del Parque: adiciones compatibles al esquema actual.
-- Ejecutar en Supabase > SQL Editor, luego de guardar un respaldo del esquema.
-- Este script no borra ni renombra tablas o columnas existentes.

begin;

-- Garantiza que cada perfil corresponda a una cuenta real de Supabase Auth.
-- Si ya existen perfiles huérfanos, se detiene para no ocultar el problema.
do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'usuarios_auth_user_fkey'
      and conrelid = 'public.usuarios'::regclass
  ) then
    if exists (
      select 1 from public.usuarios u
      where not exists (select 1 from auth.users a where a.id = u.id)
    ) then
      raise exception 'Hay perfiles en public.usuarios sin cuenta correspondiente en auth.users; revíselos antes de agregar la clave foránea.';
    end if;
    alter table public.usuarios
      add constraint usuarios_auth_user_fkey foreign key (id) references auth.users(id);
  end if;
end $$;

-- Catálogos administrables para formularios.
create table if not exists public.tipos_residente (
  codigo text primary key,
  nombre text not null unique,
  activo boolean not null default true,
  creado_en timestamptz not null default now()
);

create table if not exists public.tipos_vehiculo (
  codigo text primary key,
  nombre text not null unique,
  activo boolean not null default true,
  creado_en timestamptz not null default now()
);

create table if not exists public.tipos_pqr (
  codigo text primary key,
  nombre text not null unique,
  activo boolean not null default true,
  creado_en timestamptz not null default now()
);

-- Una unidad puede tener propietario y habitante; ambos roles pueden pertenecer
-- a la misma cuenta creando dos relaciones. Se conserva usuarios.inmueble_id
-- para compatibilidad mientras se migra la interfaz.
create table if not exists public.inmueble_usuarios (
  id uuid primary key default gen_random_uuid(),
  inmueble_id uuid not null references public.inmuebles(id) on delete cascade,
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  tipo_residente_codigo text not null references public.tipos_residente(codigo),
  creado_en timestamptz not null default now(),
  constraint inmueble_usuarios_relacion_unica
    unique (inmueble_id, usuario_id, tipo_residente_codigo)
);

-- Campos estructurados para que la administración pueda separar torre/casa y apto.
alter table public.inmuebles add column if not exists tipo_unidad text;
alter table public.inmuebles add column if not exists bloque text;
alter table public.inmuebles add column if not exists numero text;

-- Las columnas nuevas son opcionales para no invalidar los registros actuales.
alter table public.vehiculos add column if not exists tipo_vehiculo_codigo text
  references public.tipos_vehiculo(codigo);
alter table public.pqrs add column if not exists tipo_pqr_codigo text
  references public.tipos_pqr(codigo);

-- El residente que autoriza una visita y el vencimiento del QR.
alter table public.registro_visitas add column if not exists autorizado_por uuid
  references public.usuarios(id) on delete set null;
alter table public.registro_visitas add column if not exists vence_qr_en timestamptz;
create unique index if not exists registro_visitas_qr_token_unico
  on public.registro_visitas (codigo_qr_token)
  where codigo_qr_token is not null;
create index if not exists registro_visitas_inmueble_fecha_idx
  on public.registro_visitas (inmueble_id, fecha_hora_ingreso desc);

-- Referencias normalizadas para la bitácora de entrada/salida vehicular.
alter table public.bitacora_vehiculos add column if not exists vehiculo_id uuid
  references public.vehiculos(id) on delete set null;
alter table public.bitacora_vehiculos add column if not exists visita_id uuid
  references public.registro_visitas(id) on delete set null;
alter table public.bitacora_vehiculos add column if not exists vigilante_id uuid
  references public.usuarios(id) on delete set null;
create index if not exists bitacora_vehiculos_fecha_idx
  on public.bitacora_vehiculos (fecha_hora desc);

-- Trazabilidad de recepción y entrega de correspondencia.
alter table public.correspondencia add column if not exists recibido_por_id uuid
  references public.usuarios(id) on delete set null;
alter table public.correspondencia add column if not exists entregado_a_usuario_id uuid
  references public.usuarios(id) on delete set null;
alter table public.correspondencia add column if not exists aviso_enviado_en timestamptz;

-- Atención de alertas. En una alerta general, usuario_id puede identificar
-- al vigilante que la activó; origen distingue el tipo de activación.
alter table public.alertas_emergencia add column if not exists origen text
  not null default 'residente';
alter table public.alertas_emergencia add column if not exists atendida_por_id uuid
  references public.usuarios(id) on delete set null;
alter table public.alertas_emergencia add column if not exists atendida_en timestamptz;
do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'alertas_emergencia_origen_check'
      and conrelid = 'public.alertas_emergencia'::regclass
  ) then
    alter table public.alertas_emergencia
      add constraint alertas_emergencia_origen_check
      check (origen in ('residente', 'general'));
  end if;
end $$;

-- Horarios que vigilancia habilita para cada elemento o sitio reservable.
create table if not exists public.horarios_prestamo (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.inventario_elementos_y_sitios(id) on delete cascade,
  dia_semana smallint check (dia_semana between 0 and 6),
  hora_inicio time not null,
  hora_fin time not null,
  vigente_desde date,
  vigente_hasta date,
  activo boolean not null default true,
  creado_por uuid references public.usuarios(id) on delete set null,
  creado_en timestamptz not null default now(),
  constraint horarios_prestamo_intervalo_valido check (hora_fin > hora_inicio),
  constraint horarios_prestamo_vigencia_valida
    check (vigente_hasta is null or vigente_desde is null or vigente_hasta >= vigente_desde)
);
create index if not exists horarios_prestamo_item_idx
  on public.horarios_prestamo (item_id, activo, dia_semana);

-- Bandeja interna para avisos de visitante, correspondencia y comunicados.
create table if not exists public.notificaciones (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  tipo text not null,
  titulo text not null,
  mensaje text not null,
  leida_en timestamptz,
  creada_por uuid references public.usuarios(id) on delete set null,
  creada_en timestamptz not null default now()
);
create index if not exists notificaciones_usuario_fecha_idx
  on public.notificaciones (usuario_id, creada_en desc);

commit;
