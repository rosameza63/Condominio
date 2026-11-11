(() => {
  const state = { rows: [], loading: false, loaded: false, error: '', channel: null, search: '', status: 'Todos', savingId: '' };
  const $ = selector => document.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const context = () => window.portalAdminContext?.() || { live: false, role: '', profile: null };
  const db = () => window.portalSupabase;
  const refresh = () => window.portalAdminRender?.();
  const notify = message => window.portalAdminNotify?.(message);
  const dateLabel = value => value ? new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Bogota' }).format(new Date(value)) : '—';
  const statuses = ['Pendiente', 'En seguimiento', 'Atendida'];

  async function load(force = false) {
    const current = context();
    if (!current.live || !['administrador', 'vigilante'].includes(current.role) || state.loading || state.loaded && !force) return;
    state.loading = true;
    state.error = '';
    const result = await db().from('novedades_porteria')
      .select('id,titulo,ubicacion,descripcion,estado,creado_por_id,creado_en,atendida_por_id,atendida_en')
      .order('creado_en', { ascending: false }).limit(100);
    state.loading = false;
    state.loaded = true;
    if (result.error) {
      state.rows = [];
      state.error = result.error.message;
    } else state.rows = result.data || [];
    if (window.portalCurrentPage?.() === 'novedades' || window.portalCurrentPage?.() === 'inicio') refresh();
  }

  async function connect() {
    if (!context().live || !['administrador', 'vigilante'].includes(context().role)) return;
    if (state.channel) db().removeChannel(state.channel);
    state.loaded = false;
    state.rows = [];
    await load();
    state.channel = db().channel(`novedades-${context().profile?.id || context().role}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'novedades_porteria' }, () => load(true))
      .subscribe();
  }

  function page() {
    const current = context();
    const admin = current.role === 'administrador';
    if (!current.live) return '<section class="panel">Inicia sesión para consultar la bitácora de novedades.</section>';
    if (state.loading && !state.loaded) return `${window.portalAdminHead('BITÁCORA DE TURNO', 'Novedades', 'Consulta los reportes de vigilancia.') || ''}<section class="panel">Cargando novedades…</section>`;
    const filtered = state.rows.filter(row => {
      const text = `${row.titulo} ${row.ubicacion} ${row.descripcion} ${row.estado}`.toLocaleLowerCase('es-CO').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const search = state.search.trim().toLocaleLowerCase('es-CO').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      return text.includes(search) && (state.status === 'Todos' || row.estado === state.status);
    });
    const actions = !admin ? '<button class="btn-primary" data-action="incident">＋ Reportar novedad</button>' : '';
    const rows = filtered.map(row => `<tr><td class="main-cell">${esc(row.titulo)}<span class="sub-cell">${esc(row.descripcion || 'Sin detalle adicional')}</span></td><td>${esc(row.ubicacion)}</td><td>${esc(dateLabel(row.creado_en))}</td><td>${admin ? `<select class="inline-search" data-incident-status="${esc(row.id)}" aria-label="Estado de ${esc(row.titulo)}">${statuses.map(status => `<option value="${esc(status)}" ${row.estado === status ? 'selected' : ''}>${esc(status)}</option>`).join('')}</select><button class="text-link" data-incident-save="${esc(row.id)}" ${state.savingId === row.id ? 'disabled' : ''}>${state.savingId === row.id ? 'Guardando…' : 'Guardar'}</button>` : `<span class="badge ${row.estado === 'Pendiente' ? 'pending' : row.estado === 'Atendida' ? 'closed' : ''}">${esc(row.estado)}</span>`}</td></tr>`).join('');
    const table = `<div class="table-wrap"><table class="data-table"><thead><tr><th>Novedad</th><th>Ubicación</th><th>Fecha</th><th>${admin ? 'Seguimiento' : 'Estado'}</th></tr></thead><tbody>${rows || `<tr><td colspan="4" class="empty">${state.search || state.status !== 'Todos' ? 'No se encontraron novedades con esos filtros.' : 'Aún no hay novedades registradas.'}</td></tr>`}</tbody></table></div>`;
    const filters = `<div class="access-filters"><input class="inline-search" type="search" data-incident-search value="${esc(state.search)}" placeholder="⌕ Buscar novedad o ubicación…" aria-label="Buscar novedades"><select class="inline-search" data-incident-filter-status aria-label="Filtrar novedades por estado"><option value="Todos" ${state.status === 'Todos' ? 'selected' : ''}>Todos los estados</option>${statuses.map(status => `<option value="${esc(status)}" ${state.status === status ? 'selected' : ''}>${esc(status)}</option>`).join('')}</select><span class="assembly-result-count">${filtered.length} de ${state.rows.length} novedad(es)</span></div>`;
    return `${window.portalAdminHead('BITÁCORA DE TURNO', 'Novedades', admin ? 'Revisa los reportes de vigilancia y actualiza su seguimiento.' : 'Registra situaciones y consulta su seguimiento.', actions) || ''}${state.error ? `<p class="auth-error">No se pudieron cargar las novedades: ${esc(state.error)}. Verifica que esté instalado el script SQL de la bitácora.</p>` : ''}<section class="panel"><div class="panel-title"><h3>${admin ? 'Novedades reportadas' : 'Bitácora de novedades'}</h3><button class="text-link" data-incidents-reload>Actualizar</button></div>${filters}${table}</section>`;
  }

  async function save(values) {
    const current = context();
    if (!current.live || current.role !== 'vigilante') { notify('Inicia sesión como guardia para reportar una novedad.'); return false; }
    const result = await db().from('novedades_porteria').insert({
      titulo: values.title,
      ubicacion: values.unit,
      descripcion: values.description || '',
      creado_por_id: current.profile.id,
    });
    if (result.error) { notify(`No se pudo guardar la novedad: ${result.error.message}`); return false; }
    document.getElementById('formDialog')?.close();
    state.loaded = false;
    await load(true);
    notify('Novedad registrada y visible para administración.');
    return true;
  }

  async function updateStatus(id, status) {
    const current = context();
    if (!current.live || current.role !== 'administrador' || !statuses.includes(status)) return;
    state.savingId = id;
    refresh();
    const result = await db().from('novedades_porteria').update({
      estado: status,
      atendida_por_id: status === 'Atendida' ? current.profile.id : null,
      atendida_en: status === 'Atendida' ? new Date().toISOString() : null,
    }).eq('id', id);
    state.savingId = '';
    if (result.error) { notify(`No se pudo actualizar el estado: ${result.error.message}`); return; }
    state.loaded = false;
    await load(true);
    notify('Seguimiento de la novedad actualizado.');
  }

  window.portalIncidentsPage = page;
  window.portalIncidentsConnect = connect;
  window.portalIncidentsLoad = load;
  window.portalIncidentsSave = save;
  document.addEventListener('click', event => {
    const reload = event.target.closest('[data-incidents-reload]');
    if (reload) { state.loaded = false; load(true); return; }
    const saveButton = event.target.closest('[data-incident-save]');
    if (saveButton) {
      const select = document.querySelector(`[data-incident-status="${CSS.escape(saveButton.dataset.incidentSave)}"]`);
      if (select) updateStatus(saveButton.dataset.incidentSave, select.value);
    }
  });
  document.addEventListener('input', event => {
    if (!event.target.matches('[data-incident-search]')) return;
    state.search = event.target.value;
    refresh();
    const input = document.querySelector('[data-incident-search]');
    input?.focus(); input?.setSelectionRange(state.search.length, state.search.length);
  });
  document.addEventListener('change', event => {
    if (!event.target.matches('[data-incident-filter-status]')) return;
    state.status = event.target.value;
    refresh();
  });
})();
