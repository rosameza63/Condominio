(() => {
  const catalogTables = {
    tipos_residente: 'Tipos de residente',
    tipos_vehiculo: 'Tipos de vehículo',
    tipos_pqr: 'Tipos de PQR',
  };
  const tabs = [['catalogos', 'Catálogos'], ['inventario', 'Elementos y zonas comunes'], ['horarios', 'Horarios'], ['vehiculos', 'Vehículos']];
  const state = { tab: 'catalogos', busy: false, loaded: false, error: '', data: { tipos_residente: [], tipos_vehiculo: [], tipos_pqr: [] }, inventory: [], schedules: [], scheduleSort: { key: 'hora_inicio', direction: 'asc' }, vehicles: [], users: [], homes: [], editing: null };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const client = () => window.portalSupabase;
  const context = () => window.portalAdminContext?.() || { live: false, role: '' };
  const notify = message => window.portalAdminNotify?.(message);
  const refresh = () => window.portalAdminRender?.();
  const table = (headers, rows, sort = null) => `<div class="table-wrap"><table class="data-table"><thead><tr>${headers.map((item, index) => {
    const key = sort?.columns[index];
    if (!key) return `<th>${item}</th>`;
    const active = sort.key === key;
    const direction = active ? sort.direction : 'none';
    const indicator = active ? (sort.direction === 'asc' ? '▲' : '▼') : '↕';
    return `<th aria-sort="${direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : 'none'}"><button class="table-sort" type="button" data-basic-sort="${key}" aria-label="Ordenar por ${item}${active ? (sort.direction === 'asc' ? ', ascendente' : ', descendente') : ''}">${item}<span aria-hidden="true">${indicator}</span></button></th>`;
  }).join('')}</tr></thead><tbody>${rows || `<tr><td colspan="${headers.length}" class="empty">Aún no hay registros.</td></tr>`}</tbody></table></div>`;
  const badge = value => `<span class="badge ${value === 'Activo' || value === 'Disponible' ? '' : 'closed'}">${esc(value)}</span>`;

  function compareScheduleValues(a, b, key, inventoryNames) {
    const collator = new Intl.Collator('es', { numeric: true, sensitivity: 'base' });
    let left;
    let right;
    if (key === 'elemento') {
      left = inventoryNames.get(a.item_id) || 'Elemento no disponible';
      right = inventoryNames.get(b.item_id) || 'Elemento no disponible';
      return collator.compare(left, right);
    }
    if (key === 'dia_semana') {
      left = a.dia_semana == null ? -1 : Number(a.dia_semana);
      right = b.dia_semana == null ? -1 : Number(b.dia_semana);
      return left - right;
    }
    if (key === 'hora_inicio') {
      left = `${a.hora_inicio || ''}|${a.hora_fin || ''}`;
      right = `${b.hora_inicio || ''}|${b.hora_fin || ''}`;
      return collator.compare(left, right);
    }
    if (key === 'vigencia') {
      left = `${a.vigente_desde || '0000-00-00'}|${a.vigente_hasta || '9999-99-99'}`;
      right = `${b.vigente_desde || '0000-00-00'}|${b.vigente_hasta || '9999-99-99'}`;
      return collator.compare(left, right);
    }
    if (key === 'activo') return Number(Boolean(a.activo)) - Number(Boolean(b.activo));
    return 0;
  }

  function sortedSchedules() {
    const inventoryNames = new Map(state.inventory.map(item => [item.id, item.nombre]));
    const { key, direction } = state.scheduleSort;
    const sign = direction === 'asc' ? 1 : -1;
    return [...state.schedules].sort((a, b) => sign * compareScheduleValues(a, b, key, inventoryNames));
  }

  async function load() {
    if (state.busy || !context().live || context().role !== 'administrador') return;
    state.busy = true; state.error = '';
    const db = client();
    const [residents, vehicleTypes, pqrs, inventory, schedules, vehicles, users, homes] = await Promise.all([
      db.from('tipos_residente').select('codigo,nombre,activo').order('nombre'),
      db.from('tipos_vehiculo').select('codigo,nombre,activo').order('nombre'),
      db.from('tipos_pqr').select('codigo,nombre,activo').order('nombre'),
      db.from('inventario_elementos_y_sitios').select('id,tipo_item,nombre,estado').order('nombre'),
      db.from('horarios_prestamo').select('id,item_id,dia_semana,hora_inicio,hora_fin,vigente_desde,vigente_hasta,activo').order('hora_inicio'),
      db.from('vehiculos').select('id,tipo_vehiculo,tipo_vehiculo_codigo,placa,color,usuario_id,inmueble_id').order('placa'),
      db.from('usuarios').select('id,nombre_completo,rol,activo').order('nombre_completo'),
      db.from('inmuebles').select('id,identificador').order('identificador'),
    ]);
    state.busy = false; state.loaded = true;
    const errors = [residents, vehicleTypes, pqrs, inventory, schedules, vehicles, users, homes].filter(result => result.error);
    if (errors.length) state.error = `No se pudieron cargar todos los datos: ${errors.map(result => result.error.message).join(' · ')}`;
    state.data.tipos_residente = residents.data || [];
    state.data.tipos_vehiculo = vehicleTypes.data || [];
    state.data.tipos_pqr = pqrs.data || [];
    state.inventory = inventory.data || [];
    state.schedules = schedules.data || [];
    state.vehicles = vehicles.data || [];
    state.users = users.data || [];
    state.homes = homes.data || [];
    refresh();
  }

  function catalogPanel(tableName, title) {
    const rows = (state.data[tableName] || []).map(item => `<tr>
      <td class="main-cell">${esc(item.nombre)}<span class="sub-cell">${esc(item.codigo)}</span></td>
      <td>${badge(item.activo ? 'Activo' : 'Inactivo')}</td>
      <td><button class="text-link" data-basic-edit="${tableName}|${esc(item.codigo)}">Editar</button>
      <button class="text-link" data-basic-toggle="${tableName}|${esc(item.codigo)}" data-active="${!item.activo}">${item.activo ? 'Desactivar' : 'Activar'}</button>
      <button class="text-link danger-link" data-basic-delete="${tableName}|${esc(item.codigo)}">Eliminar</button></td></tr>`).join('');
    return `<section class="panel"><div class="panel-title"><h3>${title}</h3><button class="btn-secondary" data-basic-new="${tableName}">＋ Agregar</button></div>${table(['Nombre y código', 'Estado', 'Acciones'], rows)}</section>`;
  }

  window.adminDataPage = function () {
    const navigation = `<div class="filter-row">${tabs.map(([id, label]) => `<button class="filter-chip ${state.tab === id ? 'active' : ''}" data-basic-tab="${id}">${label}</button>`).join('')}</div>`;
    let content = '';
    if (state.tab === 'catalogos') {
      content = Object.entries(catalogTables).map(([name, label]) => catalogPanel(name, label)).join('');
    } else if (state.tab === 'inventario') {
      const rows = state.inventory.map(item => `<tr><td class="main-cell">${esc(item.nombre)}</td><td>${item.tipo_item === 'Elemento' ? 'Elemento prestable' : item.tipo_item === 'Sitio' ? 'Zona común' : esc(item.tipo_item)}</td><td>${badge(item.estado || 'Disponible')}</td><td><button class="text-link" data-basic-edit="inventario|${esc(item.id)}">Editar</button><button class="text-link danger-link" data-basic-delete="inventario|${esc(item.id)}">Eliminar</button></td></tr>`).join('');
      content = `<section class="panel"><div class="panel-title"><h3>Elementos prestables y zonas comunes</h3><button class="btn-secondary" data-basic-new="inventario">＋ Agregar</button></div>${table(['Nombre', 'Tipo', 'Estado', 'Acciones'], rows)}</section>`;
    } else if (state.tab === 'horarios') {
      const days = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
      const rows = sortedSchedules().map(item => `<tr><td class="main-cell">${esc(state.inventory.find(record => record.id === item.item_id)?.nombre || 'Elemento no disponible')}</td><td>${esc(item.dia_semana == null ? 'Todos los días' : days[item.dia_semana] || '—')}</td><td>${esc(String(item.hora_inicio || '').slice(0, 5))}–${esc(String(item.hora_fin || '').slice(0, 5))}</td><td>${esc(item.vigente_desde || '—')} a ${esc(item.vigente_hasta || '—')}</td><td>${badge(item.activo ? 'Activo' : 'Inactivo')}</td><td><button class="text-link" data-basic-edit="horarios|${esc(item.id)}">Editar</button><button class="text-link danger-link" data-basic-delete="horarios|${esc(item.id)}">Eliminar</button></td></tr>`).join('');
      content = `<section class="panel"><div class="panel-title"><h3>Horarios de préstamo y reserva</h3><button class="btn-secondary" data-basic-new="horarios">＋ Agregar horario</button></div>${table(['Elemento o sitio', 'Día', 'Horario', 'Vigencia', 'Estado', 'Acciones'], rows, { ...state.scheduleSort, columns: ['elemento', 'dia_semana', 'hora_inicio', 'vigencia', 'activo', null] })}</section>`;
    } else {
      const rows = state.vehicles.map(item => {
        const user = state.users.find(record => record.id === item.usuario_id);
        const home = state.homes.find(record => record.id === item.inmueble_id);
        const type = state.data.tipos_vehiculo.find(record => record.codigo === item.tipo_vehiculo_codigo);
        return `<tr><td class="main-cell">${esc(item.placa)}<span class="sub-cell">${esc(type?.nombre || item.tipo_vehiculo || 'Tipo no definido')} · ${esc(item.color || 'Sin color')}</span></td><td>${esc(user?.nombre_completo || 'Usuario no disponible')}</td><td>${esc(home?.identificador || '—')}</td><td><button class="text-link" data-basic-edit="vehiculos|${esc(item.id)}">Editar</button><button class="text-link danger-link" data-basic-delete="vehiculos|${esc(item.id)}">Eliminar</button></td></tr>`;
      }).join('');
      content = `<section class="panel"><div class="panel-title"><h3>Vehículos registrados</h3><button class="btn-secondary" data-basic-new="vehiculos">＋ Registrar vehículo</button></div>${table(['Placa y tipo', 'Usuario asociado', 'Inmueble', 'Acciones'], rows)}</section>`;
    }
    const live = context().live && context().role === 'administrador';
    const actions = live ? '<button class="text-link" data-basic-reload>Actualizar datos</button>' : '';
    if (live && !state.busy && !state.loaded) queueMicrotask(load);
    return `${window.portalAdminHead?.('ADMINISTRACIÓN', 'Datos básicos', 'Administra catálogos, elementos prestables, horarios y vehículos.', actions) || ''}${!live ? '<section class="panel"><p class="muted">Inicia sesión como administrador para gestionar datos reales en Supabase.</p></section>' : `${navigation}${state.error ? `<p class="auth-error">${esc(state.error)}</p>` : ''}${state.busy ? '<section class="panel"><p class="muted">Cargando datos…</p></section>' : content}`}`;
  };

  function selectField(id, label, options, selected = '') {
    return `<div class="field"><label for="basic_${id}">${label}</label><select id="basic_${id}" name="${id}" required>${options.map(([value, text]) => `<option value="${esc(value)}" ${String(value) === String(selected) ? 'selected' : ''}>${esc(text)}</option>`).join('')}</select></div>`;
  }
  function inputField(id, label, value = '', type = 'text', required = true) {
    return `<div class="field"><label for="basic_${id}">${label}</label><input id="basic_${id}" name="${id}" type="${type}" value="${esc(value)}" ${required ? 'required' : ''}></div>`;
  }
  function showForm(kind, record = null) {
    state.editing = { kind, id: record?.id || record?.codigo || null, record };
    const dialog = document.getElementById('adminDataDialog');
    const title = record ? 'Editar registro' : 'Nuevo registro';
    let fields = '';
    if (catalogTables[kind]) {
      fields = inputField('nombre', 'Nombre', record?.nombre || '');
      if (record) fields += `<p class="muted">Código: ${esc(record.codigo)}. El código permanece fijo para conservar sus relaciones.</p>`;
    } else if (kind === 'inventario') {
      fields = inputField('nombre', 'Nombre', record?.nombre || '')
        + selectField('tipo_item', 'Tipo', [['Elemento', 'Elemento prestable'], ['Sitio', 'Zona común']], record?.tipo_item || 'Elemento')
        + selectField('estado', 'Estado', [['Disponible', 'Disponible'], ['Mantenimiento', 'Mantenimiento'], ['Inactivo', 'Inactivo']], record?.estado || 'Disponible');
    } else if (kind === 'horarios') {
      const itemOptions = state.inventory.map(item => [item.id, item.nombre]);
      fields = selectField('item_id', 'Elemento o sitio', itemOptions, record?.item_id || itemOptions[0]?.[0])
        + selectField('dia_semana', 'Día', [['all', 'Todos los días'], ['0', 'Domingo'], ['1', 'Lunes'], ['2', 'Martes'], ['3', 'Miércoles'], ['4', 'Jueves'], ['5', 'Viernes'], ['6', 'Sábado']], record?.dia_semana == null ? 'all' : record.dia_semana)
        + inputField('hora_inicio', 'Hora de inicio', String(record?.hora_inicio || '').slice(0, 5), 'time')
        + inputField('hora_fin', 'Hora de finalización', String(record?.hora_fin || '').slice(0, 5), 'time')
        + inputField('vigente_desde', 'Vigente desde (opcional)', record?.vigente_desde || '', 'date', false)
        + inputField('vigente_hasta', 'Vigente hasta (opcional)', record?.vigente_hasta || '', 'date', false)
        + selectField('activo', 'Estado', [['true', 'Activo'], ['false', 'Inactivo']], String(record?.activo ?? true));
    } else if (kind === 'vehiculos') {
      const typeOptions = state.data.tipos_vehiculo.filter(item => item.activo || item.codigo === record?.tipo_vehiculo_codigo).map(item => [item.codigo, item.nombre]);
      const residentOptions = state.users.filter(user => user.rol === 'Residente' && user.activo !== false).map(user => [user.id, user.nombre_completo]);
      const homeOptions = state.homes.map(home => [home.id, home.identificador]);
      fields = selectField('tipo_vehiculo_codigo', 'Tipo de vehículo', typeOptions, record?.tipo_vehiculo_codigo || typeOptions[0]?.[0])
        + inputField('placa', 'Placa', record?.placa || '')
        + inputField('color', 'Color', record?.color || '', 'text', false)
        + selectField('usuario_id', 'Residente responsable', residentOptions, record?.usuario_id || residentOptions[0]?.[0])
        + selectField('inmueble_id', 'Inmueble', homeOptions, record?.inmueble_id || homeOptions[0]?.[0]);
    }
    if (!fields || (kind === 'horarios' && !state.inventory.length) || (kind === 'vehiculos' && (!state.data.tipos_vehiculo.some(item => item.activo) || !state.users.some(user => user.rol === 'Residente' && user.activo !== false) || !state.homes.length))) {
      notify('Primero necesitas registrar los elementos, tipos de vehículo, residentes e inmuebles que vas a asociar.');
      return;
    }
    dialog.innerHTML = `<form id="adminDataForm"><div class="dialog-head"><div><span class="eyebrow">ADMINISTRACIÓN</span><h2>${title}</h2></div><button class="icon-button" type="button" data-basic-close aria-label="Cerrar">×</button></div><p id="basicFormError" class="auth-error" hidden></p><div class="basic-form-fields">${fields}</div><div class="form-actions"><button class="btn-secondary" type="button" data-basic-close>Cancelar</button><button class="btn-primary" type="submit">Guardar</button></div></form>`;
    dialog.showModal();
    dialog.querySelector('[data-basic-close]').focus();
    dialog.querySelectorAll('[data-basic-close]').forEach(button => button.onclick = () => dialog.close());
    dialog.querySelector('#adminDataForm').onsubmit = event => saveForm(event, kind);
  }

  async function saveForm(event, kind) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    const db = client();
    let tableName = kind;
    let payload = values;
    let id = state.editing?.id;
    if (catalogTables[kind]) {
      tableName = kind;
      payload = { nombre: values.nombre.trim() };
      if (!id) {
        const code = values.nombre.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
        if (!code) { notify('Escribe un nombre válido.'); return; }
        payload.codigo = code;
      }
    } else if (kind === 'inventario') {
      tableName = 'inventario_elementos_y_sitios';
      payload = { tipo_item: values.tipo_item, nombre: values.nombre.trim(), estado: values.estado };
    } else if (kind === 'horarios') {
      tableName = 'horarios_prestamo';
      payload = { item_id: values.item_id, dia_semana: values.dia_semana === 'all' ? null : Number(values.dia_semana), hora_inicio: values.hora_inicio, hora_fin: values.hora_fin, vigente_desde: values.vigente_desde || null, vigente_hasta: values.vigente_hasta || null, activo: values.activo === 'true', creado_por: context().profile?.id || null };
    } else if (kind === 'vehiculos') {
      tableName = 'vehiculos';
      const type = state.data.tipos_vehiculo.find(item => item.codigo === values.tipo_vehiculo_codigo);
      payload = { tipo_vehiculo_codigo: values.tipo_vehiculo_codigo, tipo_vehiculo: type?.nombre || '', placa: values.placa.trim().toUpperCase(), color: values.color.trim() || null, usuario_id: values.usuario_id, inmueble_id: values.inmueble_id };
    }
    const query = id ? db.from(tableName).update(payload).eq(catalogTables[kind] ? 'codigo' : 'id', id) : db.from(tableName).insert(payload);
    const submitButton = event.currentTarget.querySelector('[type="submit"]');
    submitButton.disabled = true;
    submitButton.textContent = 'Guardando…';
    const { error } = await query;
    if (error) {
      const errorBox = document.getElementById('basicFormError');
      errorBox.textContent = `No se pudo guardar en Supabase: ${error.message}`;
      errorBox.hidden = false;
      submitButton.disabled = false;
      submitButton.textContent = 'Guardar';
      return;
    }
    document.getElementById('adminDataDialog').close();
    notify('Registro guardado en Supabase.');
    state.loaded = false;
    await load();
  }

  document.addEventListener('click', async event => {
    const sortButton = event.target.closest('[data-basic-sort]');
    if (sortButton) {
      const key = sortButton.dataset.basicSort;
      state.scheduleSort = { key, direction: state.scheduleSort.key === key && state.scheduleSort.direction === 'asc' ? 'desc' : 'asc' };
      refresh();
      return;
    }
    const tab = event.target.closest('[data-basic-tab]');
    if (tab) { state.tab = tab.dataset.basicTab; refresh(); return; }
    if (event.target.closest('[data-basic-reload]')) { state.loaded = false; await load(); return; }
    const create = event.target.closest('[data-basic-new]');
    if (create) { showForm(create.dataset.basicNew); return; }
    const edit = event.target.closest('[data-basic-edit]');
    if (edit) { const [kind, id] = edit.dataset.basicEdit.split('|'); const rows = catalogTables[kind] ? state.data[kind] : kind === 'inventario' ? state.inventory : kind === 'horarios' ? state.schedules : state.vehicles; const record = rows.find(item => String(catalogTables[kind] ? item.codigo : item.id) === id); if (record) showForm(kind, record); return; }
    const toggle = event.target.closest('[data-basic-toggle]');
    if (toggle) { const [kind, code] = toggle.dataset.basicToggle.split('|'); const { error } = await client().from(kind).update({ activo: toggle.dataset.active === 'true' }).eq('codigo', code); if (error) notify(`No se pudo actualizar: ${error.message}`); else { state.loaded = false; await load(); } return; }
    const remove = event.target.closest('[data-basic-delete]');
    if (remove) {
      const [kind, id] = remove.dataset.basicDelete.split('|');
      if (!confirm('¿Eliminar este registro? Si está relacionado con otros datos, Supabase puede impedirlo.')) return;
      const { error } = await client().from(catalogTables[kind] ? kind : kind === 'inventario' ? 'inventario_elementos_y_sitios' : kind === 'horarios' ? 'horarios_prestamo' : 'vehiculos').delete().eq(catalogTables[kind] ? 'codigo' : 'id', id);
      if (error) notify(`No se pudo eliminar: ${error.message}`); else { notify('Registro eliminado.'); state.loaded = false; await load(); }
    }
  });

  window.addEventListener('portal:admin-data-enter', load);
})();
