-- Altos del Parque: políticas iniciales por perfil.
-- Ejecutar DESPUÉS de 01_schema_adiciones.sql y revisar con cuentas de prueba.
-- Roles válidos según usuarios_rol_check: Residente, Guardia, Administrador.
-- RLS controla filas; no publicar nunca una clave service_role en la PWA.

begin;

create or replace function public.app_rol_actual()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select u.rol from public.usuarios as u where u.id = (select auth.uid()) limit 1;
$$;

create or replace function public.app_es_administrador()
returns boolean language sql stable security definer set search_path = ''
as $$ select coalesce(public.app_rol_actual() = 'Administrador', false); $$;

create or replace function public.app_es_guardia()
returns boolean language sql stable security definer set search_path = ''
as $$ select coalesce(public.app_rol_actual() = 'Guardia', false); $$;

create or replace function public.app_es_residente()
returns boolean language sql stable security definer set search_path = ''
as $$ select coalesce(public.app_rol_actual() = 'Residente', false); $$;

-- Compatibilidad con usuarios.inmueble_id mientras el nuevo directorio use
-- inmueble_usuarios para distinguir propietario y habitante.
create or replace function public.app_accede_inmueble(p_inmueble_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.inmueble_usuarios iu
    where iu.inmueble_id = p_inmueble_id and iu.usuario_id = (select auth.uid())
  ) or exists (
    select 1 from public.usuarios u
    where u.id = (select auth.uid()) and u.inmueble_id = p_inmueble_id
  );
$$;

revoke all on function public.app_rol_actual() from public, anon;
revoke all on function public.app_es_administrador() from public, anon;
revoke all on function public.app_es_guardia() from public, anon;
revoke all on function public.app_es_residente() from public, anon;
revoke all on function public.app_accede_inmueble(uuid) from public, anon;
grant execute on function public.app_rol_actual() to authenticated;
grant execute on function public.app_es_administrador() to authenticated;
grant execute on function public.app_es_guardia() to authenticated;
grant execute on function public.app_es_residente() to authenticated;
grant execute on function public.app_accede_inmueble(uuid) to authenticated;

-- La portería necesita elegir una unidad al registrar una visita, pero no debe
-- leer coeficientes. Esta función expone solo los campos operativos necesarios.
create or replace function public.app_unidades_para_guardia()
returns table (
  id uuid,
  identificador text,
  tipo_unidad text,
  bloque text,
  numero text
)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, i.identificador, i.tipo_unidad, i.bloque, i.numero
  from public.inmuebles i
  where public.app_es_guardia();
$$;
revoke all on function public.app_unidades_para_guardia() from public, anon;
grant execute on function public.app_unidades_para_guardia() to authenticated;

-- RLS permanece habilitado para las tablas actuales y las nuevas.
do $$
declare t text;
begin
  foreach t in array array[
    'alertas_emergencia','asambleas','asistencia_asamblea','bitacora_vehiculos',
    'comunicados','correspondencia','inmuebles','inventario_elementos_y_sitios',
    'pqrs','preguntas_votacion','prestamos','registro_visitas','usuarios',
    'vehiculos','votos','tipos_residente','tipos_vehiculo','tipos_pqr',
    'inmueble_usuarios','horarios_prestamo','notificaciones'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists admin_all on public.%I', t);
    execute format(
      'create policy admin_all on public.%I for all to authenticated using (public.app_es_administrador()) with check (public.app_es_administrador())',
      t
    );
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- Perfiles: cada cuenta ve su fila; solo administración gestiona otras cuentas.
drop policy if exists usuario_ver_perfil_propio on public.usuarios;
create policy usuario_ver_perfil_propio on public.usuarios
  for select to authenticated using (id = (select auth.uid()));

-- Un residente solo ve sus inmuebles y relaciones. Guardia consulta unidades
-- a través de los registros operativos; no recibe acceso directo a coeficientes.
drop policy if exists inmueble_ver_asociado on public.inmuebles;
create policy inmueble_ver_asociado on public.inmuebles
  for select to authenticated using (public.app_accede_inmueble(id));
drop policy if exists relacion_ver_propia on public.inmueble_usuarios;
create policy relacion_ver_propia on public.inmueble_usuarios
  for select to authenticated using (usuario_id = (select auth.uid()));

-- Catálogos visibles para los usuarios autenticados; administración los mantiene.
drop policy if exists tipos_residente_ver on public.tipos_residente;
create policy tipos_residente_ver on public.tipos_residente
  for select to authenticated using (true);
drop policy if exists tipos_vehiculo_ver on public.tipos_vehiculo;
create policy tipos_vehiculo_ver on public.tipos_vehiculo
  for select to authenticated using (true);
drop policy if exists tipos_pqr_ver on public.tipos_pqr;
create policy tipos_pqr_ver on public.tipos_pqr
  for select to authenticated using (true);

-- PQRS: residente crea y consulta las propias.
drop policy if exists pqrs_residente_propias on public.pqrs;
create policy pqrs_residente_propias on public.pqrs
  for select to authenticated using (usuario_id = (select auth.uid()));
drop policy if exists pqrs_residente_crear on public.pqrs;
create policy pqrs_residente_crear on public.pqrs
  for insert to authenticated with check (
    public.app_es_residente() and usuario_id = (select auth.uid())
  );

-- Comunicados: cualquier cuenta autenticada puede leerlos.
drop policy if exists comunicados_leer on public.comunicados;
create policy comunicados_leer on public.comunicados
  for select to authenticated using (true);

-- Visitas: residentes autorizan y consultan las propias; vigilancia registra
-- ingresos/salidas y puede atender visitas autorizadas o de llegada directa.
drop policy if exists visitas_residente_leer on public.registro_visitas;
create policy visitas_residente_leer on public.registro_visitas
  for select to authenticated using (autorizado_por = (select auth.uid()));
drop policy if exists visitas_residente_crear on public.registro_visitas;
create policy visitas_residente_crear on public.registro_visitas
  for insert to authenticated with check (
    public.app_es_residente()
    and autorizado_por = (select auth.uid())
    and public.app_accede_inmueble(inmueble_id)
  );
drop policy if exists visitas_guardia_leer on public.registro_visitas;
create policy visitas_guardia_leer on public.registro_visitas
  for select to authenticated using (public.app_es_guardia());
drop policy if exists visitas_guardia_crear on public.registro_visitas;
create policy visitas_guardia_crear on public.registro_visitas
  for insert to authenticated with check (public.app_es_guardia());
drop policy if exists visitas_guardia_actualizar on public.registro_visitas;
create policy visitas_guardia_actualizar on public.registro_visitas
  for update to authenticated using (public.app_es_guardia())
  with check (public.app_es_guardia());

-- Vehículos registrados: residente administra los suyos; vigilancia los consulta.
drop policy if exists vehiculos_residente_propios on public.vehiculos;
create policy vehiculos_residente_propios on public.vehiculos
  for select to authenticated using (usuario_id = (select auth.uid()));
drop policy if exists vehiculos_residente_crear on public.vehiculos;
create policy vehiculos_residente_crear on public.vehiculos
  for insert to authenticated with check (
    public.app_es_residente() and usuario_id = (select auth.uid())
    and public.app_accede_inmueble(inmueble_id)
  );
drop policy if exists vehiculos_residente_actualizar on public.vehiculos;
create policy vehiculos_residente_actualizar on public.vehiculos
  for update to authenticated using (usuario_id = (select auth.uid()))
  with check (usuario_id = (select auth.uid()) and public.app_accede_inmueble(inmueble_id));
drop policy if exists vehiculos_guardia_leer on public.vehiculos;
create policy vehiculos_guardia_leer on public.vehiculos
  for select to authenticated using (public.app_es_guardia());
drop policy if exists bitacora_guardia_operar on public.bitacora_vehiculos;
create policy bitacora_guardia_operar on public.bitacora_vehiculos
  for all to authenticated using (public.app_es_guardia())
  with check (public.app_es_guardia());

-- Correspondencia: residente ve lo de su inmueble; vigilancia registra y entrega.
drop policy if exists correspondencia_residente_leer on public.correspondencia;
create policy correspondencia_residente_leer on public.correspondencia
  for select to authenticated using (public.app_accede_inmueble(inmueble_id));
drop policy if exists correspondencia_guardia_leer on public.correspondencia;
create policy correspondencia_guardia_leer on public.correspondencia
  for select to authenticated using (public.app_es_guardia());
drop policy if exists correspondencia_guardia_crear on public.correspondencia;
create policy correspondencia_guardia_crear on public.correspondencia
  for insert to authenticated with check (public.app_es_guardia());
drop policy if exists correspondencia_guardia_actualizar on public.correspondencia;
create policy correspondencia_guardia_actualizar on public.correspondencia
  for update to authenticated using (public.app_es_guardia())
  with check (public.app_es_guardia());

-- Inventario y horarios: lectura autenticada; guardia asigna horarios.
drop policy if exists inventario_leer on public.inventario_elementos_y_sitios;
create policy inventario_leer on public.inventario_elementos_y_sitios
  for select to authenticated using (true);
drop policy if exists horarios_leer on public.horarios_prestamo;
create policy horarios_leer on public.horarios_prestamo
  for select to authenticated using (true);
drop policy if exists horarios_guardia_operar on public.horarios_prestamo;
create policy horarios_guardia_operar on public.horarios_prestamo
  for all to authenticated using (public.app_es_guardia())
  with check (public.app_es_guardia());

-- Préstamos: residente solicita en su nombre; guardia revisa y atiende.
drop policy if exists prestamos_residente_leer on public.prestamos;
create policy prestamos_residente_leer on public.prestamos
  for select to authenticated using (usuario_id = (select auth.uid()));
drop policy if exists prestamos_residente_crear on public.prestamos;
create policy prestamos_residente_crear on public.prestamos
  for insert to authenticated with check (
    public.app_es_residente() and usuario_id = (select auth.uid())
    and public.app_accede_inmueble(inmueble_id)
  );
drop policy if exists prestamos_guardia_leer on public.prestamos;
create policy prestamos_guardia_leer on public.prestamos
  for select to authenticated using (public.app_es_guardia());
drop policy if exists prestamos_guardia_actualizar on public.prestamos;
create policy prestamos_guardia_actualizar on public.prestamos
  for update to authenticated using (public.app_es_guardia())
  with check (public.app_es_guardia());

-- Alertas: residente genera/consulta las propias; guardia atiende y activa general.
drop policy if exists alertas_residente_leer on public.alertas_emergencia;
create policy alertas_residente_leer on public.alertas_emergencia
  for select to authenticated using (usuario_id = (select auth.uid()));
drop policy if exists alertas_residente_crear on public.alertas_emergencia;
create policy alertas_residente_crear on public.alertas_emergencia
  for insert to authenticated with check (
    public.app_es_residente() and origen = 'residente'
    and usuario_id = (select auth.uid())
  );
drop policy if exists alertas_guardia_leer on public.alertas_emergencia;
create policy alertas_guardia_leer on public.alertas_emergencia
  for select to authenticated using (public.app_es_guardia());
drop policy if exists alertas_guardia_general on public.alertas_emergencia;
create policy alertas_guardia_general on public.alertas_emergencia
  for insert to authenticated with check (
    public.app_es_guardia() and origen = 'general'
    and usuario_id = (select auth.uid())
  );
drop policy if exists alertas_guardia_atender on public.alertas_emergencia;
create policy alertas_guardia_atender on public.alertas_emergencia
  for update to authenticated using (public.app_es_guardia())
  with check (public.app_es_guardia());

-- Asamblea y votación: residentes consultan y registran su propia participación.
drop policy if exists asambleas_residente_leer on public.asambleas;
create policy asambleas_residente_leer on public.asambleas
  for select to authenticated using (public.app_es_residente());
drop policy if exists preguntas_residente_leer on public.preguntas_votacion;
create policy preguntas_residente_leer on public.preguntas_votacion
  for select to authenticated using (public.app_es_residente());
drop policy if exists asistencia_residente_leer on public.asistencia_asamblea;
create policy asistencia_residente_leer on public.asistencia_asamblea
  for select to authenticated using (usuario_id = (select auth.uid()));
drop policy if exists asistencia_residente_crear on public.asistencia_asamblea;
create policy asistencia_residente_crear on public.asistencia_asamblea
  for insert to authenticated with check (
    public.app_es_residente() and usuario_id = (select auth.uid())
  );
drop policy if exists votos_residente_leer on public.votos;
create policy votos_residente_leer on public.votos
  for select to authenticated using (usuario_id = (select auth.uid()));
drop policy if exists votos_residente_crear on public.votos;
create policy votos_residente_crear on public.votos
  for insert to authenticated with check (
    public.app_es_residente() and usuario_id = (select auth.uid())
  );

-- Notificaciones: residentes leen las propias; vigilancia puede enviar avisos.
drop policy if exists notificaciones_residente_leer on public.notificaciones;
create policy notificaciones_residente_leer on public.notificaciones
  for select to authenticated using (usuario_id = (select auth.uid()));
drop policy if exists notificaciones_residente_marcar_leida on public.notificaciones;
create policy notificaciones_residente_marcar_leida on public.notificaciones
  for update to authenticated using (usuario_id = (select auth.uid()))
  with check (usuario_id = (select auth.uid()));
drop policy if exists notificaciones_guardia_crear on public.notificaciones;
create policy notificaciones_guardia_crear on public.notificaciones
  for insert to authenticated with check (public.app_es_guardia());

commit;
