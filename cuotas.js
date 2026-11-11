(() => {
  const state = { rows: [], homes: [], loading: false, loaded: false, error: '', filters: { home: '', status: 'Todos', period: 'Todos' }, resident: { key: '', value: 'Cargando…', detail: 'Consultando administración' } };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const db = () => window.portalSupabase;
  const ctx = () => window.portalAdminContext?.() || { live: false, role: '' };
  const refresh = () => window.portalAdminRender?.();
  const monthNow = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`; };
  const periodLabel = period => new Intl.DateTimeFormat('es-CO', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${period}T12:00:00Z`));
  const badge = status => `<span class="badge ${status === 'Pagada' ? '' : 'closed'}">${esc(status)}</span>`;
  const table = (headers, rows) => `<div class="table-wrap"><table class="data-table"><thead><tr>${headers.map(item => `<th>${item}</th>`).join('')}</tr></thead><tbody>${rows || `<tr><td colspan="${headers.length}" class="empty">No hay pagos registrados para este periodo.</td></tr>`}</tbody></table></div>`;
  function applyFeeFilters() {
    const search = document.querySelector('[data-fee-search]');
    const status = document.querySelector('[data-fee-status]');
    const period = document.querySelector('[data-fee-period]');
    if (!search || !status || !period) return;
    state.filters = { home: search.value, status: status.value, period: period.value };
    let shown = 0;
    document.querySelectorAll('[data-fee-row]').forEach(row => {
      const matches = row.dataset.feeHome.toLocaleLowerCase('es-CO').includes(state.filters.home.trim().toLocaleLowerCase('es-CO'))
        && (state.filters.status === 'Todos' || row.dataset.feeStatus === state.filters.status)
        && (state.filters.period === 'Todos' || row.dataset.feePeriod === state.filters.period);
      row.hidden = !matches;
      if (matches) shown++;
    });
    const empty = document.querySelector('[data-fee-no-results]');
    if (empty) empty.hidden = shown > 0;
  }

  async function loadAdmin() {
    if (state.loading || !ctx().live || ctx().role !== 'administrador') return;
    state.loading = true; state.error = '';
    const [payments, homes] = await Promise.all([
      db().from('cuotas_administracion').select('id,inmueble_id,periodo,estado').order('periodo', { ascending: false }),
      db().from('inmuebles').select('id,identificador').order('identificador'),
    ]);
    state.loading = false; state.loaded = true;
    if (payments.error || homes.error) state.error = `No se pudieron cargar los datos: ${payments.error?.message || homes.error?.message}`;
    state.rows = payments.data || []; state.homes = homes.data || [];
    if (document.getElementById('crumb')?.textContent === 'Cuotas') refresh();
  }

  function openForm(record = null) {
    const dialog = document.getElementById('adminDataDialog');
    if (!state.homes.length) { window.portalAdminNotify?.('Primero registra al menos un inmueble.'); return; }
    const homeOptions = state.homes.map(home => `<option value="${esc(home.id)}" ${record?.inmueble_id === home.id ? 'selected' : ''}>${esc(home.identificador)}</option>`).join('');
    const month = String(record?.periodo || `${monthNow()}-01`).slice(0, 7);
    dialog.innerHTML = `<form id="feeForm"><div class="dialog-head"><div><span class="eyebrow">ADMINISTRACIÓN</span><h2>${record ? 'Editar estado de cuota' : 'Registrar cuota'}</h2></div><button class="icon-button" type="button" data-fee-close aria-label="Cerrar">×</button></div><p id="feeFormError" class="auth-error" hidden></p><div class="basic-form-fields"><div class="field"><label for="feeHome">Inmueble</label><select id="feeHome" name="inmueble_id" required>${homeOptions}</select></div><div class="field"><label for="feeMonth">Periodo</label><input id="feeMonth" name="periodo" type="month" value="${esc(month)}" required></div><div class="field"><label for="feeStatus">Estado del pago</label><select id="feeStatus" name="estado" required><option value="Pendiente" ${record?.estado !== 'Pagada' ? 'selected' : ''}>Pendiente</option><option value="Pagada" ${record?.estado === 'Pagada' ? 'selected' : ''}>Pagada</option></select></div></div><div class="form-actions"><button class="btn-secondary" type="button" data-fee-close>Cancelar</button><button class="btn-primary" type="submit">Guardar</button></div></form>`;
    dialog.showModal();
    dialog.querySelectorAll('[data-fee-close]').forEach(button => button.onclick = () => dialog.close());
    dialog.querySelector('#feeForm').onsubmit = async event => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(event.currentTarget).entries());
      const payload = { inmueble_id: values.inmueble_id, periodo: `${values.periodo}-01`, estado: values.estado };
      const button = event.currentTarget.querySelector('[type="submit"]'); button.disabled = true; button.textContent = 'Guardando…';
      const query = record ? db().from('cuotas_administracion').update(payload).eq('id', record.id) : db().from('cuotas_administracion').upsert(payload, { onConflict: 'inmueble_id,periodo' });
      const { error } = await query;
      if (error) { const box = dialog.querySelector('#feeFormError'); box.textContent = `No se pudo guardar en Supabase: ${error.message}`; box.hidden = false; button.disabled = false; button.textContent = 'Guardar'; return; }
      dialog.close(); window.portalAdminNotify?.('Estado de cuota guardado.'); state.loaded = false; await loadAdmin();
    };
  }

  function parseCsv(text) {
    const source = String(text || '').replace(/^\uFEFF/, '');
    const firstLine = source.split(/\r?\n/, 1)[0] || '';
    const delimiter = firstLine.includes(';') ? ';' : ',';
    const matrix = [];
    let row = [], field = '', quoted = false;
    for (let index = 0; index < source.length; index++) {
      const char = source[index];
      if (char === '"' && quoted && source[index + 1] === '"') { field += '"'; index++; }
      else if (char === '"') quoted = !quoted;
      else if (char === delimiter && !quoted) { row.push(field.trim()); field = ''; }
      else if ((char === '\n' || char === '\r') && !quoted) {
        if (char === '\r' && source[index + 1] === '\n') index++;
        row.push(field.trim());
        if (row.some(value => value !== '')) matrix.push(row);
        row = []; field = '';
      } else field += char;
    }
    row.push(field.trim());
    if (row.some(value => value !== '')) matrix.push(row);
    if (!matrix.length) throw new Error('El archivo está vacío.');
    const headers = matrix.shift().map(value => value.trim().toLocaleLowerCase('es-CO'));
    const positions = { inmueble: headers.indexOf('inmueble'), periodo: headers.indexOf('periodo'), estado: headers.indexOf('estado') };
    if (Object.values(positions).some(index => index < 0)) throw new Error('La primera fila debe tener las columnas Inmueble;Periodo;Estado.');
    return matrix.map((values, index) => ({
      line: index + 2,
      inmueble: values[positions.inmueble] || '',
      periodo: values[positions.periodo] || '',
      estado: values[positions.estado] || '',
    })).filter(item => item.inmueble || item.periodo || item.estado);
  }

  const normalizeHome = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[·•]/g, ' ').replace(/\s+/g, ' ').trim().toLocaleLowerCase('es-CO');

  function openImport() {
    const dialog = document.getElementById('adminDataDialog');
    dialog.className = 'fee-import-dialog';
    dialog.innerHTML = `<div class="dialog-head"><div><span class="eyebrow">CARGA MASIVA</span><h2>Importar cuotas desde CSV</h2></div><button class="icon-button" type="button" data-fee-import-close aria-label="Cerrar">×</button></div><p class="muted">El archivo debe tener las columnas <b>Inmueble</b>, <b>Periodo</b> y <b>Estado</b>, separadas por punto y coma o coma. Los inmuebles deben coincidir con los identificadores de la app; el periodo debe ser AAAA-MM y el estado Pagada o Pendiente.</p><div class="field"><label for="feeCsvFile">Archivo CSV</label><input id="feeCsvFile" type="file" accept=".csv,text/csv"></div><div id="feeImportPreview" class="fee-import-preview" aria-live="polite"></div><p class="muted">La importación actualiza o crea solo las filas incluidas en el archivo. Los inmuebles que no aparezcan allí conservarán su estado actual.</p><div class="form-actions"><button class="btn-secondary" type="button" data-fee-import-close>Cancelar</button><button class="btn-primary" type="button" data-fee-import-save disabled>Guardar cuotas</button></div>`;
    dialog.showModal();
    dialog.querySelectorAll('[data-fee-import-close]').forEach(button => button.onclick = () => dialog.close());
    const preview = dialog.querySelector('#feeImportPreview');
    const save = dialog.querySelector('[data-fee-import-save]');
    let payload = [];
    dialog.querySelector('#feeCsvFile').onchange = async event => {
      payload = []; save.disabled = true; preview.innerHTML = '<p class="muted">Leyendo archivo…</p>';
      const file = event.currentTarget.files?.[0];
      if (!file) { preview.innerHTML = ''; return; }
      try {
        const items = parseCsv(await file.text());
        const homes = new Map(state.homes.map(home => [normalizeHome(home.identificador), home]));
        const errors = [], seen = new Set(), missing = [];
        payload = [];
        for (const item of items) {
          const home = homes.get(normalizeHome(item.inmueble));
          if (!home) { errors.push(`Fila ${item.line}: no se encontró el inmueble “${esc(item.inmueble)}”.`); continue; }
          const monthMatch = /^(\d{4})-(\d{2})$/.exec(item.periodo);
          if (!monthMatch || Number(monthMatch[2]) < 1 || Number(monthMatch[2]) > 12) { errors.push(`Fila ${item.line}: periodo inválido “${esc(item.periodo)}”; usa AAAA-MM.`); continue; }
          if (!['Pagada', 'Pendiente'].includes(item.estado)) { errors.push(`Fila ${item.line}: estado inválido “${esc(item.estado)}”; usa Pagada o Pendiente.`); continue; }
          const key = `${home.id}:${item.periodo}`;
          if (seen.has(key)) { errors.push(`Fila ${item.line}: el inmueble ${esc(item.inmueble)} aparece más de una vez para ${esc(item.periodo)}.`); continue; }
          seen.add(key);
          payload.push({ inmueble_id: home.id, periodo: `${item.periodo}-01`, estado: item.estado });
        }
        const represented = new Set(payload.map(item => item.inmueble_id));
        for (const home of state.homes) if (!represented.has(home.id)) missing.push(home.identificador);
        const paid = payload.filter(item => item.estado === 'Pagada').length;
        const pending = payload.length - paid;
        preview.innerHTML = `<div class="fee-import-counts"><b>${payload.length} cuotas válidas</b><span>${paid} pagadas</span><span>${pending} pendientes</span></div>${missing.length ? `<p class="auth-error">El CSV no incluye ${missing.length} inmueble(s) del catálogo: ${missing.slice(0, 8).map(esc).join(', ')}${missing.length > 8 ? '…' : ''}. Esos inmuebles no se modificarán.</p>` : ''}${errors.length ? `<div class="auth-error">${errors.slice(0, 8).map(error => `<div>${error}</div>`).join('')}${errors.length > 8 ? `<div>Y ${errors.length - 8} error(es) más.</div>` : ''}</div>` : '<p class="muted">No se encontraron errores en las filas del archivo.</p>'}`;
        save.disabled = !payload.length || errors.length > 0;
        save.textContent = `Guardar ${payload.length} cuota${payload.length === 1 ? '' : 's'}`;
      } catch (error) {
        payload = []; preview.innerHTML = `<p class="auth-error">${esc(error.message || 'No se pudo leer el archivo.')}</p>`;
      }
    };
    save.onclick = async () => {
      if (!payload.length || save.disabled) return;
      save.disabled = true; save.textContent = 'Guardando…';
      const { error } = await db().from('cuotas_administracion').upsert(payload, { onConflict: 'inmueble_id,periodo' });
      if (error) { preview.insertAdjacentHTML('afterbegin', `<p class="auth-error">No se pudieron guardar las cuotas: ${esc(error.message)}</p>`); save.disabled = false; save.textContent = `Guardar ${payload.length} cuotas`; return; }
      const savedCount = payload.length;
      dialog.close(); window.portalAdminNotify?.(`Se importaron ${savedCount} cuotas.`); state.loaded = false; await loadAdmin();
    };
  }

  window.portalCuotasPage = function () {
    const live = ctx().live && ctx().role === 'administrador';
    if (live && !state.loaded && !state.loading) queueMicrotask(loadAdmin);
    const actions = live ? '<button class="btn-secondary" data-fee-import>⇧ Importar CSV</button><button class="btn-primary" data-fee-new>＋ Registrar pago</button>' : '';
    const periods = [...new Set(state.rows.map(record => String(record.periodo).slice(0, 7)))].sort().reverse();
    const rows = state.rows.map(record => {
      const home = state.homes.find(item => item.id === record.inmueble_id);
      return `<tr data-fee-row data-fee-home="${esc(home?.identificador || 'Inmueble')}" data-fee-period="${esc(String(record.periodo).slice(0, 7))}" data-fee-status="${esc(record.estado)}"><td class="main-cell">${esc(home?.identificador || 'Inmueble')}</td><td>${esc(periodLabel(record.periodo))}</td><td>${badge(record.estado)}</td><td><button class="text-link" data-fee-edit="${esc(record.id)}">Editar</button><button class="text-link danger-link" data-fee-delete="${esc(record.id)}">Eliminar</button></td></tr>`;
    }).join('');
    const filters = `<div class="fee-filters"><input type="search" class="inline-search" data-fee-search placeholder="⌕ Buscar inmueble…" value="${esc(state.filters.home)}"><select class="inline-search" data-fee-status aria-label="Filtrar por estado"><option ${state.filters.status === 'Todos' ? 'selected' : ''}>Todos</option><option value="Pagada" ${state.filters.status === 'Pagada' ? 'selected' : ''}>Pagada</option><option value="Pendiente" ${state.filters.status === 'Pendiente' ? 'selected' : ''}>Pendiente</option></select><select class="inline-search" data-fee-period aria-label="Filtrar por periodo"><option value="Todos" ${state.filters.period === 'Todos' ? 'selected' : ''}>Todos los periodos</option>${periods.map(period => `<option value="${esc(period)}" ${state.filters.period === period ? 'selected' : ''}>${esc(periodLabel(`${period}-01`))}</option>`).join('')}</select></div>`;
    const noResults = '<tr data-fee-no-results hidden><td colspan="4" class="empty">No se encontraron cuotas con esos filtros.</td></tr>';
    return `${window.portalAdminHead?.('ADMINISTRACIÓN', 'Cuotas', 'Registra por inmueble y periodo si el pago está pagado o pendiente.', actions) || ''}${!live ? '<section class="panel"><p class="muted">Inicia sesión como administrador para consultar y registrar estados de pago.</p></section>' : `${state.error ? `<p class="auth-error">${esc(state.error)}</p>` : ''}${state.loading ? '<section class="panel"><p class="muted">Cargando pagos…</p></section>' : `<section class="panel"><div class="panel-title"><h3>Estados de pago</h3><button class="text-link" data-fee-reload>Actualizar</button></div>${filters}${table(['Inmueble', 'Periodo', 'Estado', 'Acciones'], `${rows}${rows ? noResults : ''}`)}</section>`}`}`;
  };

  window.portalCuotaResidentStat = () => {
    if (!ctx().live || ctx().role !== 'residente') return window.portalStat?.('Cuota residencial', 'Sin registro', 'Datos de demostración', '✓') || null;
    const resident = state.resident;
    return window.portalStat?.('Cuota residencial', resident.value, `${esc(resident.detail)} · <button type="button" class="text-link" data-fee-resident-refresh>Actualizar</button>`, '✓') || null;
  };
  window.portalCuotasLoadResident = async (profile, force = false, announce = force) => {
    if (!ctx().live || ctx().role !== 'residente' || !profile?.id) return;
    const key = `${profile.id}:${profile.inmueble_id || ''}:${monthNow()}`;
    if ((!force && state.resident.key === key) || state.resident.loading === key) return;
    state.resident.loading = key; state.resident = { ...state.resident, loading: key, value: 'Cargando…', detail: 'Consultando administración' };
    if (announce) window.portalAdminNotify?.('Actualizando estado de cuota…');
    const { data: relations, error: relationError } = await db().from('inmueble_usuarios').select('inmueble_id').eq('usuario_id', profile.id);
    const homeIds = [...new Set((relations || []).map(item => item.inmueble_id).filter(Boolean))];
    if (!homeIds.length && profile.inmueble_id) homeIds.push(profile.inmueble_id);
    const period = `${monthNow()}-01`;
    const result = homeIds.length ? await db().from('cuotas_administracion').select('estado').in('inmueble_id', homeIds).eq('periodo', period) : { data: [], error: relationError || null };
    const detail = periodLabel(period);
    if (result.error) state.resident = { key, value: 'No disponible', detail: `No se pudo consultar · ${detail}` };
    else if (!homeIds.length) state.resident = { key, value: 'Sin inmueble', detail: 'Contacta a administración para asociar tu cuenta' };
    else if (!result.data?.length) state.resident = { key, value: 'Sin registro', detail };
    else if (result.data.some(item => item.estado === 'Pendiente')) state.resident = { key, value: 'Pendiente', detail };
    else state.resident = { key, value: 'Pagada', detail };
    if (window.portalAdminContext?.().role === 'residente' && window.portalCurrentPage?.() === 'inicio') refresh();
    if (announce && !result.error) window.portalAdminNotify?.(`Estado de cuota actualizado: ${state.resident.value}.`);
    else if (announce && result.error) window.portalAdminNotify?.(`No se pudo actualizar la cuota: ${result.error.message}`);
  };

  document.addEventListener('click', async event => {
    if (event.target.closest('[data-fee-resident-refresh]')) { await window.portalCuotasLoadResident?.(ctx().profile, true); return; }
    if (event.target.closest('[data-fee-new]')) { openForm(); return; }
    if (event.target.closest('[data-fee-import]')) { if (!state.homes.length) { window.portalAdminNotify?.('Primero registra al menos un inmueble.'); return; } openImport(); return; }
    if (event.target.closest('[data-fee-reload]')) { state.loaded = false; await loadAdmin(); return; }
    const edit = event.target.closest('[data-fee-edit]');
    if (edit) { const record = state.rows.find(item => item.id === edit.dataset.feeEdit); if (record) openForm(record); return; }
    const remove = event.target.closest('[data-fee-delete]');
    if (remove) {
      if (!window.confirm('¿Eliminar este registro de pago?')) return;
      const { error } = await db().from('cuotas_administracion').delete().eq('id', remove.dataset.feeDelete);
      if (error) window.portalAdminNotify?.(`No se pudo eliminar: ${error.message}`);
      else { window.portalAdminNotify?.('Registro eliminado.'); state.loaded = false; await loadAdmin(); }
    }
  });
  document.addEventListener('input', event => { if (event.target.closest('[data-fee-search]')) applyFeeFilters(); });
  document.addEventListener('change', event => { if (event.target.closest('[data-fee-status], [data-fee-period]')) applyFeeFilters(); });
  document.addEventListener('visibilitychange', () => {
    const current = ctx();
    if (!document.hidden && current.role === 'residente' && current.profile) window.portalCuotasLoadResident?.(current.profile, true, false);
  });
  window.addEventListener('portal:cuotas-enter', loadAdmin);
})();
