# Scripts de Supabase · Altos del Parque

Los scripts están preparados para revisión; no se han ejecutado contra tu proyecto de Supabase.

## Orden sugerido

1. Guarda un respaldo del esquema actual.
2. Ejecuta `01_schema_adiciones.sql` desde **Supabase → SQL Editor**. Amplía el modelo sin borrar tablas ni campos existentes. Si encuentra perfiles sin cuenta Auth equivalente, se detendrá antes de agregar la relación.
3. Ejecuta `03_catalogos_iniciales.sql` para cargar los tipos iniciales de residente y vehículo. El catálogo de PQRS se administra desde **Datos básicos**.
4. Revisa `02_politicas_rls.sql` antes de ejecutarlo. Contiene las primeras políticas para los tres roles y presupone que la propiedad se asignará mediante `inmueble_usuarios`. Se debe probar con cuentas de residente y guardia antes de usarlo con residentes reales.
5. Ejecuta `04_alertas_persistentes_y_aviso_admin.sql` después de los pasos 2 y 4 para guardar alertas, notificar a cada administrador y habilitar los cambios en tiempo real.
6. Ejecuta `05_cuotas_administracion.sql` después de `02_politicas_rls.sql` para permitir al administrador registrar el estado mensual y al residente consultar el suyo.
7. Ejecuta `06_asambleas_quorum_votacion.sql` después de `01_schema_adiciones.sql` y `02_politicas_rls.sql` para conectar las asambleas a Supabase. La aplicación cuenta automáticamente los inmuebles presentes, valida el quórum mínimo (50 % + 1), acepta un voto por inmueble y calcula la opción más votada y el coeficiente representado. Al crear cada pregunta, el administrador configura las respuestas y, si aplica, indica qué respuesta significa “Aprobada”; no cuenta votos manualmente.
8. Si ya habías ejecutado el script 06 y al iniciar la asamblea aparece que `asambleas_estado_check` rechaza el estado, ejecuta `06b_corregir_estados_asambleas.sql` en SQL Editor.
9. Si al votar aparece que `votos_opcion_votada_check` rechaza la respuesta, ejecuta `06c_respuestas_dinamicas_votacion.sql` en SQL Editor. Este ajuste elimina la lista fija antigua y valida cada respuesta contra las opciones guardadas para su pregunta.
10. Ejecuta `07_gestion_pqrs.sql` después de `01_schema_adiciones.sql` y `02_politicas_rls.sql` para habilitar asuntos, inmueble asociado y respuestas administrativas en PQRS.
11. Para autorizar visitantes con QR y registrar su ingreso/salida, ejecuta `08_qr_visitantes_y_aviso_residente.sql` después de `01_schema_adiciones.sql`, `02_politicas_rls.sql` y `04_alertas_persistentes_y_aviso_admin.sql`.
12. `../supabase-client.example.js` contiene el cliente Supabase y es importado por `../auth-ui.js`. El inicio de sesión y la lectura del perfil ya están conectados. No pongas una clave `service_role` o `secret` en la PWA.
13. Las solicitudes de préstamo usan `prestamos`, `inventario_elementos_y_sitios` y `horarios_prestamo`, ya incluidas en los pasos 1 y 4. El estado inicial es `Solicitado`; administración puede asignar un horario habilitado y aprobar (`Aprobado/Asignado`) desde Reservas y préstamos. Portería también puede atender las solicitudes y cambiar su estado a `Finalizado`. No requiere otro script SQL.
14. Ejecuta `09_directorio_contactos.sql` después de `02_politicas_rls.sql`. Crea el directorio oficial: administración agrega, edita, desactiva y elimina contactos; los tres roles autenticados consultan los contactos activos.
15. Ejecuta `10_nombres_alertas_guardia.sql` después de `02_politicas_rls.sql`. Permite a vigilancia resolver el nombre del residente de alertas históricas sin dar acceso directo a los perfiles.
16. Ejecuta `11_novedades_porteria.sql` después de `02_politicas_rls.sql`. Habilita la bitácora compartida: vigilancia reporta y administración consulta y actualiza el seguimiento.

## Decisiones que deben confirmarse

- Las categorías exactas del catálogo de PQR.
- Si el guardia puede registrar visitas sin QR previo y qué datos son obligatorios en ese caso.
- Los valores de `estado` y `accion` usados actualmente por vehículos y paquetes.
- La participación en asambleas se registra por inmueble y está limitada a propietarios vinculados a ese inmueble. El coeficiente se muestra como porcentaje representado; la aprobación se decide por la opción con más votos.
- Los límites de lectura de documentos y datos de contacto para vigilancia. RLS controla filas; no oculta columnas dentro de una fila. La función `app_unidades_para_guardia()` devuelve solo los campos operativos de los inmuebles.
- Otras secciones aún pueden mostrar datos locales de demostración; las asambleas usan Supabase cuando se inicia sesión.

## Tablas y columnas nuevas

- Catálogos: `tipos_residente`, `tipos_vehiculo`, `tipos_pqr`.
- Asociación de perfiles: `inmueble_usuarios`.
- Horarios: `horarios_prestamo`.
- Avisos dentro de la app: `notificaciones`.
- Contactos oficiales del conjunto: `directorio_contactos` (administración los gestiona; residentes, vigilancia y administración los consultan).
- Alertas históricas de residente y portería: `alertas_emergencia`; una notificación persistente se crea automáticamente para cada perfil Administrador.
- Estados mensuales de pago por inmueble: `cuotas_administracion` (Pagada/Pendiente; sin cálculo de valores ni coeficientes).
- Asambleas: opciones configurables, respuesta aprobatoria opcional, asistencia y voto únicos por inmueble, instantáneas del coeficiente y funciones seguras para registrar asistencia, votos y cambios de estado.
- Columnas nuevas de trazabilidad en visitas, vehículos, correspondencia y alertas. El visitante presenta el QR al entrar y salir; el ingreso genera una notificación dentro de Nexo para el residente. WhatsApp queda como aviso manual opcional desde el teléfono del guardia.
- Bitácora de vigilancia: `novedades_porteria`; vigilancia crea y consulta sus reportes, y administración actualiza el estado de seguimiento.
- PQRS: para guardar el asunto, inmueble asociado, respuesta administrativa y fecha de actualización, ejecuta `07_gestion_pqrs.sql` en Supabase SQL Editor.
- Préstamos: el residente solicita un elemento o zona en un horario activo; el inmueble se completa desde sus asociaciones. Administración puede asignar fecha y horario, validar que el intervalo esté disponible y aprobar. Portería puede atender la reserva y marcarla `Finalizado`.

El esquema actual se conserva. `usuarios.inmueble_id`, `vehiculos.tipo_vehiculo` y `pqrs.tipo_pqr` no se eliminan; las columnas nuevas quedan listas para una migración gradual.
