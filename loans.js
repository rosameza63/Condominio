(() => {
  const state = { items: [], schedules: [], homes: [], rows: [], loading: false, loaded: false, error: '', channel: null, selectedItemId: '', filters: { search: '', status: 'Todos', home: 'Todos', item: 'Todos' } };
  const $ = selector => document.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const ctx = () => window.portalAdminContext?.() || { live: false, role: '', profile: null };
  const db = () => window.portalSupabase;
  const refresh = () => window.portalAdminRender?.();
  const notify = message => window.portalAdminNotify?.(message);
  const dateLabel = value => value ? new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`)) : '—';
  const timeLabel = value => String(value || '').slice(0, 5);

  function applyLoanFilters() {
    const search = $('[data-loan-search]'), status = $('[data-loan-status]'), home = $('[data-loan-home]'), item = $('[data-loan-item-filter]');
    if (!search) return;
    state.filters = { search: search.value, status: status?.value || 'Todos', home: home?.value || 'Todos', item: item?.value || 'Todos' };
    const normalize = value => String(value || '').trim().toLocaleLowerCase('es-CO').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const searchTerm = normalize(state.filters.search);
    let shown = 0;
    document.querySelectorAll('[data-loan-row]').forEach(row => {
      const text = normalize(`${row.textContent} ${row.dataset.loanItem} ${row.dataset.loanApplicant} ${row.dataset.loanHome}`);
      const matches = text.includes(searchTerm)
        && (state.filters.status === 'Todos' || row.dataset.loanStatus === state.filters.status)
        && (state.filters.home === 'Todos' || row.dataset.loanHome === state.filters.home)
        && (state.filters.item === 'Todos' || row.dataset.loanItemId === state.filters.item)
        && (!state.selectedItemId || row.dataset.loanItemId === state.selectedItemId);
      row.hidden = !matches;
      if (matches) shown++;
    });
    const empty = $('[data-loan-no-results]');
    if (empty) empty.hidden = shown > 0;
    const count = $('[data-loan-visible-count]');
    if (count) count.textContent = `Mostrando ${shown} de ${state.rows.length}`;
  }

  async function load() {
    const current = ctx();
    if (!current.live || !['residente', 'administrador'].includes(current.role) || state.loading || state.loaded) return;
    state.loading = true; state.error = '';
    if (current.role === 'administrador') {
      const [items, loans, homes, users, schedules] = await Promise.all([
        db().from('inventario_elementos_y_sitios').select('id,tipo_item,nombre,estado').order('nombre'),
        db().from('prestamos').select('id,item_id,inmueble_id,usuario_id,fecha_reserva,horario_bloque,estado_prestamo', { count: 'exact' }).order('fecha_reserva', { ascending: false }),
        db().from('inmuebles').select('id,identificador').order('identificador'),
        db().from('usuarios').select('id,nombre_completo'),
        db().from('horarios_prestamo').select('id,item_id,dia_semana,hora_inicio,hora_fin,vigente_desde,vigente_hasta,activo').eq('activo', true).order('hora_inicio'),
      ]);
      state.loading = false; state.loaded = true;
      const errors = [items, loans, homes, users, schedules].filter(result => result.error);
      state.error = errors.length ? `No se pudieron cargar las reservas: ${errors.map(result => result.error.message).join(' · ')}` : '';
      state.items = items.data || []; state.homes = homes.data || []; state.schedules = schedules.data || [];
      const homeMap = Object.fromEntries(state.homes.map(home => [home.id, home.identificador]));
      const userMap = Object.fromEntries((users.data || []).map(user => [user.id, user.nombre_completo]));
      state.rows = (loans.data || []).map(row => ({ ...row, inmueble: homeMap[row.inmueble_id] || 'Inmueble', solicitante: userMap[row.usuario_id] || 'Residente' }));
      state.totalRows = loans.count ?? state.rows.length;
      if (window.portalCurrentPage?.() === 'reservas') refresh();
      return;
    }
    const [items, schedules, relations, ownLoans] = await Promise.all([
      db().from('inventario_elementos_y_sitios').select('id,tipo_item,nombre,estado').eq('estado', 'Disponible').order('nombre'),
      db().from('horarios_prestamo').select('id,item_id,dia_semana,hora_inicio,hora_fin,vigente_desde,vigente_hasta,activo').eq('activo', true).order('hora_inicio'),
      db().from('inmueble_usuarios').select('inmueble_id').eq('usuario_id', current.profile.id),
      db().from('prestamos').select('id,item_id,inmueble_id,fecha_reserva,horario_bloque,estado_prestamo').eq('usuario_id', current.profile.id).order('fecha_reserva', { ascending: false }),
    ]);
    const errors = [items, schedules, relations, ownLoans].filter(result => result.error);
    const ids = [...new Set((relations.data || []).map(row => row.inmueble_id).filter(Boolean))];
    if (!ids.length && current.profile.inmueble_id) ids.push(current.profile.inmueble_id);
    const homes = ids.length ? await db().from('inmuebles').select('id,identificador').in('id', ids).order('identificador') : { data: [], error: null };
    state.loading = false; state.loaded = true;
    if (homes.error) errors.push(homes);
    state.error = errors.length ? `No se pudieron cargar los datos: ${errors.map(result => result.error.message).join(' · ')}` : '';
    state.items = items.data || [];
    state.schedules = schedules.data || [];
    state.homes = homes.data || [];
    state.rows = ownLoans.data || [];
    if (ctx().role === 'residente' && window.portalCurrentPage?.() === 'reservas') refresh();
  }

  function page() {
    if (ctx().role === 'administrador') return adminPage();
    if (state.loading) return '<section class="panel"><p class="muted">Cargando elementos, horarios y solicitudes…</p></section>';
    const itemMap = Object.fromEntries(state.items.map(item => [item.id, item]));
    const homeMap = Object.fromEntries(state.homes.map(home => [home.id, home.identificador]));
    const rows = state.rows.map(row => `<tr data-loan-row data-loan-item-id="${esc(row.item_id)}" data-loan-item="${esc(itemMap[row.item_id]?.nombre || 'Elemento o zona')}" data-loan-applicant="" data-loan-home="${esc(homeMap[row.inmueble_id] || 'Inmueble')}" data-loan-status="${esc(row.estado_prestamo)}"><td class="main-cell">${esc(itemMap[row.item_id]?.nombre || 'Elemento o zona')}</td><td>${esc(homeMap[row.inmueble_id] || 'Inmueble')}</td><td>${esc(dateLabel(row.fecha_reserva))}<span class="sub-cell">${esc(row.horario_bloque)}</span></td><td><span class="badge ${row.estado_prestamo === 'Solicitado' ? 'pending' : row.estado_prestamo === 'Finalizado' ? 'closed' : ''}">${esc(row.estado_prestamo)}</span></td></tr>`).join('');
    const itemOptions = state.items.map(item => `<option value="${esc(item.id)}" ${state.filters.item === item.id ? 'selected' : ''}>${esc(item.nombre)}</option>`).join('');
    const homeOptions = state.homes.map(home => `<option value="${esc(home.identificador)}" ${state.filters.home === home.identificador ? 'selected' : ''}>${esc(home.identificador)}</option>`).join('');
    const statusOptions = [...new Set(state.rows.map(row => row.estado_prestamo).filter(Boolean))].sort().map(status => `<option value="${esc(status)}" ${state.filters.status === status ? 'selected' : ''}>${esc(status)}</option>`).join('');
    const filters = `<div class="loan-filters"><input class="inline-search" type="search" data-loan-search placeholder="⌕ Buscar zona, inmueble, fecha, horario o estado…" aria-label="Buscar en mis solicitudes" value="${esc(state.filters.search)}"><select class="inline-search" data-loan-item-filter aria-label="Filtrar por elemento o zona"><option value="Todos" ${state.filters.item === 'Todos' ? 'selected' : ''}>Todos los elementos y zonas</option>${itemOptions}</select><select class="inline-search" data-loan-home aria-label="Filtrar por inmueble"><option value="Todos" ${state.filters.home === 'Todos' ? 'selected' : ''}>Todos mis inmuebles</option>${homeOptions}</select><select class="inline-search" data-loan-status aria-label="Filtrar por estado"><option value="Todos" ${state.filters.status === 'Todos' ? 'selected' : ''}>Todos los estados</option>${statusOptions}</select></div>`;
    return `${window.portalAdminHead('ESPACIOS COMPARTIDOS', 'Zonas comunes y elementos', 'Solicita un horario habilitado para un elemento prestable o una zona común.', '<button class="btn-primary" data-action="reservation">＋ Nueva solicitud</button>')}${state.error ? `<p class="auth-error">${esc(state.error)}</p>` : ''}<section class="panel"><div class="panel-title"><h3>Elementos y zonas disponibles</h3><button class="text-link" data-loans-reload>Actualizar</button></div>${state.items.length ? `<div class="loan-catalog-grid">${state.items.map(item => `<article class="loan-catalog-card"><span class="eyebrow">${item.tipo_item === 'Sitio' ? 'ZONA COMÚN' : 'ELEMENTO PRESTABLE'}</span><h3>${esc(item.nombre)}</h3><p>${state.schedules.some(schedule => schedule.item_id === item.id) ? 'Consulta los horarios habilitados al crear tu solicitud.' : 'Aún no tiene horarios habilitados.'}</p></article>`).join('')}</div>` : '<p class="empty">No hay elementos o zonas disponibles en este momento.</p>'}</section><section class="panel"><div class="panel-title"><h3>Mis solicitudes</h3><span class="loan-result-count" data-loan-visible-count>Mostrando ${state.rows.length} de ${state.rows.length}</span></div>${filters}${state.rows.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Elemento o zona</th><th>Inmueble</th><th>Fecha y horario</th><th>Estado</th></tr></thead><tbody>${rows}<tr data-loan-no-results hidden><td colspan="4" class="empty">No se encontraron solicitudes con esos filtros.</td></tr></tbody></table></div>` : '<p class="empty">Aún no has solicitado préstamos.</p>'}<p class="muted loan-note">Administración revisará la solicitud y confirmará el horario asignado.</p></section>`;
  }

  function adminPage() {
    const counts = Object.fromEntries(state.items.map(item => [item.id, state.rows.filter(row => row.item_id === item.id).length]));
    const selected = state.selectedItemId ? state.items.find(item => item.id === state.selectedItemId) : null;
    const rows = state.rows.map(row => {
      const item = state.items.find(record => record.id === row.item_id);
      const action = row.estado_prestamo === 'Finalizado' ? '—' : `<button type="button" class="text-link" data-loan-assign="${esc(row.id)}">${row.estado_prestamo === 'Solicitado' ? 'Asignar y aprobar' : 'Editar asignación'}</button>`;
      return `<tr data-loan-row data-loan-item-id="${esc(row.item_id)}" data-loan-item="${esc(item?.nombre || 'Elemento o zona')}" data-loan-applicant="${esc(row.solicitante)}" data-loan-home="${esc(row.inmueble)}" data-loan-status="${esc(row.estado_prestamo)}"><td class="main-cell">${esc(item?.nombre || 'Elemento o zona')}<span class="sub-cell">${item?.tipo_item === 'Sitio' ? 'Zona común' : 'Elemento prestable'}</span></td><td>${esc(row.solicitante)}</td><td>${esc(row.inmueble)}</td><td>${esc(dateLabel(row.fecha_reserva))}<span class="sub-cell">${esc(row.horario_bloque)}</span></td><td><span class="badge ${row.estado_prestamo === 'Solicitado' ? 'pending' : row.estado_prestamo === 'Finalizado' ? 'closed' : ''}">${esc(row.estado_prestamo)}</span></td><td>${action}</td></tr>`;
    }).join('');
    const itemOptions = state.items.map(item => `<option value="${esc(item.id)}" ${state.filters.item === item.id ? 'selected' : ''}>${esc(item.nombre)}</option>`).join('');
    const homeOptions = [...new Set(state.rows.map(row => row.inmueble).filter(Boolean))].sort().map(home => `<option value="${esc(home)}" ${state.filters.home === home ? 'selected' : ''}>${esc(home)}</option>`).join('');
    const statusOptions = [...new Set(state.rows.map(row => row.estado_prestamo).filter(Boolean))].sort().map(status => `<option value="${esc(status)}" ${state.filters.status === status ? 'selected' : ''}>${esc(status)}</option>`).join('');
    const filters = `<div class="loan-filters"><input class="inline-search" type="search" data-loan-search placeholder="⌕ Buscar elemento, residente o inmueble…" value="${esc(state.filters.search)}"><select class="inline-search" data-loan-item-filter aria-label="Filtrar por elemento o zona"><option value="Todos" ${state.filters.item === 'Todos' ? 'selected' : ''}>Todos los elementos y zonas</option>${itemOptions}</select><select class="inline-search" data-loan-home aria-label="Filtrar por inmueble"><option value="Todos" ${state.filters.home === 'Todos' ? 'selected' : ''}>Todos los inmuebles</option>${homeOptions}</select><select class="inline-search" data-loan-status aria-label="Filtrar por estado"><option value="Todos" ${state.filters.status === 'Todos' ? 'selected' : ''}>Todos los estados</option>${statusOptions}</select></div>`;
    const cards = state.items.map(item => {
      const isSelected = state.selectedItemId === item.id;
      return `<article class="loan-catalog-card ${isSelected ? 'is-selected' : ''}"><span class="eyebrow">${item.tipo_item === 'Sitio' ? 'ZONA COMÚN' : 'ELEMENTO PRESTABLE'}</span><h3>${esc(item.nombre)}</h3><p>${counts[item.id] || 0} solicitud(es)</p><button type="button" class="btn-secondary loan-view-button" data-view-loans="${esc(item.id)}" aria-pressed="${isSelected}">${isSelected ? 'Viendo reservas ↓' : 'Ver reservas →'}</button></article>`;
    }).join('');
    const reload = '<button type="button" class="btn-secondary loan-reload-button" data-loans-reload>Actualizar</button>';
    const totalLoans = state.totalRows ?? state.rows.length;
    const countNote = totalLoans !== state.rows.length ? `<p class="auth-error">Supabase reporta ${totalLoans} solicitud(es), pero se cargaron ${state.rows.length}. Revisa los permisos RLS de la tabla prestamos.</p>` : '';
    const loadingMessage = state.loading ? '<p class="muted loan-loading" role="status">Actualizando reservas desde Supabase… Puedes seguir usando el menú mientras carga.</p>' : '';
    return `${window.portalAdminHead('ESPACIOS COMPARTIDOS', 'Reservas y préstamos', 'Revisa solicitudes, asigna horarios y aprueba las reservas.', reload)}${state.error ? `<p class="auth-error">${esc(state.error)}</p>` : ''}${loadingMessage}${countNote}<section class="panel"><div class="panel-title"><h3>Zonas y elementos</h3></div>${cards ? `<div class="loan-catalog-grid">${cards}</div>` : state.loading ? '<p class="muted">Cargando zonas y elementos…</p>' : '<p class="empty">No hay elementos ni zonas registrados.</p>'}</section><section class="panel" id="loanRequestsPanel"><div class="panel-title"><h3>${selected ? `Solicitudes de ${esc(selected.nombre)}` : 'Solicitudes de préstamo'} <span class="loan-result-count" data-loan-visible-count>${selected ? `Mostrando ${state.rows.filter(row => row.item_id === selected.id).length} de ${state.rows.length}` : `${totalLoans} solicitud(es)`}</span></h3>${selected ? '<button type="button" class="btn-secondary" data-loans-all>Ver todas</button>' : ''}</div>${filters}${rows ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Elemento o zona</th><th>Solicitante</th><th>Inmueble</th><th>Fecha y horario</th><th>Estado</th><th>Acción</th></tr></thead><tbody>${rows}<tr data-loan-no-results hidden><td colspan="6" class="empty">No se encontraron solicitudes con esos filtros.</td></tr></tbody></table></div>` : state.loading ? '<p class="muted">Cargando solicitudes…</p>' : `<p class="empty">${selected ? `No hay solicitudes para ${esc(selected.nombre)}.` : 'Todavía no hay solicitudes.'}</p>`}</section><p class="muted">La residente podrá consultar la fecha y horario asignados desde su lista de solicitudes.</p>`;
  }

  function localToday() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }

  function matchingSlots(itemId, dateValue) {
    if (!itemId || !dateValue) return [];
    const date = new Date(`${dateValue}T12:00:00`);
    const day = date.getDay();
    return state.schedules.filter(schedule => {
      if (schedule.item_id !== itemId) return false;
      if (schedule.dia_semana != null && Number(schedule.dia_semana) !== day) return false;
      if (schedule.vigente_desde && dateValue < schedule.vigente_desde) return false;
      if (schedule.vigente_hasta && dateValue > schedule.vigente_hasta) return false;
      return true;
    }).map(schedule => `${timeLabel(schedule.hora_inicio)}–${timeLabel(schedule.hora_fin)}`).filter((slot, index, all) => all.indexOf(slot) === index);
  }

  function availableAssignmentSlots(itemId, dateValue, loanId) {
    const date = new Date(`${dateValue}T12:00:00`);
    const day = date.getDay();
    const schedules = state.schedules.filter(schedule => schedule.item_id === itemId
      && (schedule.dia_semana == null || Number(schedule.dia_semana) === day)
      && (!schedule.vigente_desde || dateValue >= schedule.vigente_desde)
      && (!schedule.vigente_hasta || dateValue <= schedule.vigente_hasta));
    return schedules.map(schedule => `${timeLabel(schedule.hora_inicio)}–${timeLabel(schedule.hora_fin)}`)
      .filter((slot, index, all) => all.indexOf(slot) === index)
      .filter(slot => !state.rows.some(row => row.id !== loanId && row.item_id === itemId
        && row.fecha_reserva === dateValue && row.horario_bloque === slot && row.estado_prestamo === 'Aprobado/Asignado'));
  }

  function openAssignment(row) {
    const dialog = document.getElementById('adminDataDialog');
    const item = state.items.find(candidate => candidate.id === row.item_id);
    const minDate = localToday();
    const selectedDate = row.fecha_reserva >= minDate ? row.fecha_reserva : minDate;
    dialog.className = 'loan-assignment-dialog';
    dialog.innerHTML = `<form id="loanAssignmentForm"><div class="dialog-head"><div><span class="eyebrow">GESTIÓN DE RESERVAS</span><h2>${row.estado_prestamo === 'Solicitado' ? 'Asignar y aprobar' : 'Editar asignación'}</h2></div><button class="icon-button" type="button" data-loan-assign-close aria-label="Cerrar">×</button></div><p class="muted"><b>${esc(item?.nombre || 'Elemento o zona')}</b> · ${esc(row.inmueble)}<br>Solicitante: ${esc(row.solicitante)}<br>Horario solicitado: ${esc(dateLabel(row.fecha_reserva))} · ${esc(row.horario_bloque || 'Sin horario')}</p><p id="loanAssignmentError" class="auth-error" hidden></p><div class="basic-form-fields"><div class="field"><label for="loanAssignedDate">Fecha asignada</label><input id="loanAssignedDate" type="date" min="${minDate}" value="${esc(selectedDate)}" required></div><div class="field"><label for="loanAssignedSlot">Horario disponible</label><select id="loanAssignedSlot" required></select></div></div><p class="muted">Solo se muestran los horarios habilitados para esa zona en la fecha seleccionada y que no estén asignados a otra reserva.</p><div class="form-actions"><button class="btn-secondary" type="button" data-loan-assign-close>Cancelar</button><button class="btn-primary" type="submit">${row.estado_prestamo === 'Solicitado' ? 'Aprobar reserva' : 'Guardar asignación'}</button></div></form>`;
    dialog.showModal();
    dialog.querySelectorAll('[data-loan-assign-close]').forEach(button => button.onclick = () => dialog.close());
    const dateInput = dialog.querySelector('#loanAssignedDate');
    const slotSelect = dialog.querySelector('#loanAssignedSlot');
    const updateSlots = () => {
      const slots = availableAssignmentSlots(row.item_id, dateInput.value, row.id);
      slotSelect.innerHTML = slots.length ? `<option value="">Selecciona un horario</option>${slots.map(slot => `<option value="${esc(slot)}">${esc(slot)}</option>`).join('')}` : '<option value="">No hay horarios disponibles para esta fecha</option>';
      if (slots.includes(row.horario_bloque)) slotSelect.value = row.horario_bloque;
    };
    dateInput.addEventListener('change', updateSlots);
    updateSlots();
    dialog.querySelector('#loanAssignmentForm').onsubmit = async event => {
      event.preventDefault();
      const slots = availableAssignmentSlots(row.item_id, dateInput.value, row.id);
      if (!slots.includes(slotSelect.value)) { const error = dialog.querySelector('#loanAssignmentError'); error.textContent = 'Elige una fecha y un horario habilitado que siga disponible.'; error.hidden = false; return; }
      const button = event.currentTarget.querySelector('[type="submit"]'); button.disabled = true; button.textContent = 'Guardando…';
      const { error } = await db().from('prestamos').update({ fecha_reserva: dateInput.value, horario_bloque: slotSelect.value, estado_prestamo: 'Aprobado/Asignado' }).eq('id', row.id);
      if (error) { const box = dialog.querySelector('#loanAssignmentError'); box.textContent = `No se pudo asignar la reserva: ${error.message}`; box.hidden = false; button.disabled = false; button.textContent = 'Guardar asignación'; return; }
      dialog.close(); notify(`Reserva de ${row.inmueble} aprobada y asignada.`); state.loaded = false; await load();
    };
  }

  async function prepareForm() {
    if (!state.loaded) await load();
    const target = $('#formFields');
    const home = state.homes.length === 1 ? state.homes[0] : null;
    const homeField = home
      ? `<div class="field"><label>Inmueble</label><p class="loan-home-value">${esc(home.identificador)} <span>Asociado a tu cuenta</span></p><input id="loanHomeId" type="hidden" value="${esc(home.id)}"></div>`
      : `<div class="field"><label for="loanHomeId">Inmueble</label><select id="loanHomeId" required>${state.homes.map(item => `<option value="${esc(item.id)}">${esc(item.identificador)}</option>`).join('') || '<option value="">No hay inmuebles asociados</option>'}</select><small class="muted">Tu cuenta tiene más de un inmueble; selecciona dónde usarás el préstamo.</small></div>`;
    const itemOptions = state.items.map(item => `<option value="${esc(item.id)}">${esc(item.nombre)} · ${item.tipo_item === 'Sitio' ? 'Zona común' : 'Elemento'}</option>`).join('');
    target.innerHTML = `<p class="auth-error" id="actionFormError" role="alert" ${state.error || !state.homes.length || !state.items.length ? '' : 'hidden'}>${esc(state.error || (!state.homes.length ? 'No hay un inmueble asociado a tu cuenta. Contacta a administración.' : !state.items.length ? 'No hay elementos ni zonas disponibles.' : ''))}</p>${homeField}<div class="field"><label for="loanItemId">Elemento o zona</label><select id="loanItemId" required>${itemOptions || '<option value="">No hay opciones disponibles</option>'}</select></div><div class="field"><label for="loanDate">Fecha solicitada</label><input id="loanDate" type="date" min="${localToday()}" value="${localToday()}" required></div><div class="field"><label for="loanSlot">Horario habilitado</label><select id="loanSlot" required><option value="">Selecciona un elemento o zona</option></select></div><p class="muted">La solicitud se registra como <b>Solicitado</b>. Portería confirmará el horario al asignarlo.</p>`;
    $('#formTitle').textContent = 'Solicitar préstamo';
    $('#formEyebrow').textContent = 'ELEMENTOS PRESTABLES Y ZONAS COMUNES';
    $('#submitAction').disabled = false;
    $('#submitAction').textContent = 'Enviar solicitud';
    const updateSlots = () => {
      const slots = matchingSlots($('#loanItemId')?.value, $('#loanDate')?.value);
      const slotSelect = $('#loanSlot');
      slotSelect.innerHTML = slots.length ? '<option value="">Selecciona un horario</option>' + slots.map(slot => `<option value="${esc(slot)}">${esc(slot)}</option>`).join('') : '<option value="">No hay horarios habilitados para esa fecha</option>';
    };
    $('#loanItemId')?.addEventListener('change', updateSlots);
    $('#loanDate')?.addEventListener('change', updateSlots);
    updateSlots();
  }

  async function create() {
    const box = $('#actionFormError');
    const showError = message => { if (box) { box.textContent = message; box.hidden = false; } else notify(message); };
    const inmuebleId = $('#loanHomeId')?.value;
    const itemId = $('#loanItemId')?.value;
    const date = $('#loanDate')?.value;
    const slot = $('#loanSlot')?.value;
    if (!inmuebleId || !itemId || !date || !slot) { showError('Completa el inmueble, elemento o zona, fecha y horario.'); return; }
    const current = ctx();
    const payload = { item_id: itemId, inmueble_id: inmuebleId, usuario_id: current.profile.id, fecha_reserva: date, horario_bloque: slot, estado_prestamo: 'Solicitado' };
    const button = $('#submitAction'); button.disabled = true; button.textContent = 'Enviando…';
    const { error } = await db().from('prestamos').insert(payload);
    if (error) { showError(`No se pudo enviar la solicitud: ${error.message}`); button.disabled = false; button.textContent = 'Enviar solicitud'; return; }
    $('#formDialog').close();
    state.loaded = false;
    await load();
    notify('Solicitud enviada a portería. Quedó en estado Solicitado.');
  }

  window.portalLoansPage = page;
  window.portalLoansConnect = async () => {
    if (state.channel) { await db().removeChannel(state.channel); state.channel = null; }
    state.loaded = false; state.rows = []; state.selectedItemId = '';
    const current = ctx();
    if (!['residente', 'administrador'].includes(current.role)) return;
    await load();
    let change = db().channel(`prestamos-${current.profile?.id || current.role}`).on('postgres_changes', { event: '*', schema: 'public', table: 'prestamos', ...(current.role === 'residente' && current.profile?.id ? { filter: `usuario_id=eq.${current.profile.id}` } : {}) }, () => { state.loaded = false; load(); });
    state.channel = change.subscribe();
  };
  window.portalLoansLoad = load;
  window.portalLoansBind = () => {
    applyLoanFilters();
    document.querySelectorAll('[data-view-loans]').forEach(button => { button.onclick = event => { event.preventDefault(); state.selectedItemId = button.dataset.viewLoans; state.filters.item = state.selectedItemId; const shown = state.rows.filter(row => row.item_id === state.selectedItemId).length; const item = state.items.find(record => record.id === state.selectedItemId); refresh(); notify(`${shown} solicitud(es) de ${item?.nombre || 'esta zona'}. La lista está debajo.`); requestAnimationFrame(() => document.getElementById('loanRequestsPanel')?.scrollIntoView({ behavior: 'smooth', block: 'start' })); }; });
    document.querySelectorAll('[data-loans-all]').forEach(button => { button.onclick = event => { event.preventDefault(); state.selectedItemId = ''; state.filters.item = 'Todos'; refresh(); }; });
    document.querySelectorAll('[data-loan-assign]').forEach(button => { button.onclick = event => { event.preventDefault(); const row = state.rows.find(item => item.id === button.dataset.loanAssign); if (row) openAssignment(row); }; });
    document.querySelectorAll('[data-loans-reload]').forEach(button => { button.onclick = event => { event.preventDefault(); state.selectedItemId = ''; state.filters = { search: '', status: 'Todos', home: 'Todos', item: 'Todos' }; state.loaded = false; load(); }; });
  };
  window.portalLoansPrepareForm = prepareForm;
  window.portalLoanCreate = create;
  document.addEventListener('input', event => {
    if (event.target.matches('[data-loan-search]')) applyLoanFilters();
  });
  document.addEventListener('change', event => {
    if (event.target.matches('[data-loan-item-filter], [data-loan-home], [data-loan-status]')) applyLoanFilters();
  });
  document.addEventListener('click', event => {
    const demoView = event.target.closest('[data-demo-reservations]');
    if (demoView) {
      const zone = demoView.dataset.demoReservations.toLowerCase();
      const search = zone.includes('bbq') ? 'bbq' : zone.includes('salón') || zone.includes('salon') ? 'salón' : 'cancha';
      const rows = [...document.querySelectorAll('[data-demo-reservation-row]')];
      let visible = 0;
      rows.forEach(row => { row.hidden = !row.dataset.demoReservationRow.toLowerCase().includes(search); if (!row.hidden) visible++; });
      const title = document.querySelector('#demoReservations .panel-title h3');
      if (title) title.textContent = `Reservas de ${demoView.dataset.demoReservations}`;
      if (!visible) notify(`No hay reservas de demostración para ${demoView.dataset.demoReservations}.`);
      document.getElementById('demoReservations')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
  });
})();
