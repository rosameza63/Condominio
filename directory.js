(() => {
  const state = { rows: [], loading: false, loaded: false, error: '', search: '', category: 'Todos' };
  const client = () => window.portalSupabase;
  const context = () => window.portalAdminContext?.() || { live: false, role: '', profile: null };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const refresh = () => window.portalAdminRender?.();
  const notify = message => window.portalAdminNotify?.(message);
  function applyFilters() {
    const term = state.search.trim().toLocaleLowerCase('es-CO');
    let shown = 0;
    document.querySelectorAll('[data-directory-record]').forEach(row => {
      const matches = row.dataset.directorySearchable.includes(term)
        && (state.category === 'Todos' || row.dataset.directoryCategory === state.category);
      row.hidden = !matches;
      if (matches) shown++;
    });
    const empty = document.querySelector('[data-directory-empty]');
    if (empty) empty.hidden = shown > 0;
  }

  function phoneLink(value) {
    const number = String(value || '').trim();
    return number ? `<a href="tel:${esc(number.replace(/[^+\d]/g, ''))}">${esc(number)}</a>` : '';
  }

  function whatsappLink(value) {
    const number = String(value || '').replace(/\D/g, '');
    return number ? `<a class="directory-whatsapp" href="https://wa.me/${esc(number)}" target="_blank" rel="noopener noreferrer">WhatsApp</a>` : '';
  }

  async function load() {
    if (state.loading || state.loaded || !context().live) return;
    state.loading = true;
    state.error = '';
    const { data, error } = await client().from('directorio_contactos')
      .select('id,nombre,categoria,telefono,whatsapp,email,horario_atencion,descripcion,activo,orden,actualizado_en')
      .order('orden').order('categoria').order('nombre');
    state.loading = false;
    state.loaded = true;
    state.error = error?.message || '';
    state.rows = data || [];
    if (window.portalCurrentPage?.() === 'directorio') refresh();
  }

  function page() {
    const role = context().role;
    const admin = role === 'administrador';
    const actions = admin ? '<button class="btn-primary" data-directory-new>＋ Agregar contacto</button>' : '';
    const title = admin ? 'Directorio del conjunto' : 'Contactos útiles';
    const desc = admin ? 'Administra los teléfonos y datos de contacto oficiales.' : 'Contacta a administración, portería y servicios del conjunto.';
    const visible = state.rows.filter(item => admin || item.activo);
    const categories = [...new Set(visible.map(item => item.categoria || 'General'))].sort((a, b) => a.localeCompare(b, 'es'));
    const filterControls = `<div class="directory-filters"><input class="inline-search" type="search" data-directory-search value="${esc(state.search)}" placeholder="⌕ Buscar contacto, categoría o teléfono…" aria-label="Buscar contactos del directorio"><select class="inline-search" data-directory-category aria-label="Filtrar por categoría"><option value="Todos" ${state.category === 'Todos' ? 'selected' : ''}>Todas las categorías</option>${categories.map(category => `<option value="${esc(category)}" ${state.category === category ? 'selected' : ''}>${esc(category)}</option>`).join('')}</select></div>`;
    const rows = visible.map(item => `<tr data-directory-record data-directory-searchable="${esc(`${item.nombre} ${item.categoria || ''} ${item.descripcion || ''} ${item.telefono || ''} ${item.whatsapp || ''} ${item.email || ''}`.toLocaleLowerCase('es-CO'))}" data-directory-category="${esc(item.categoria || 'General')}">
      <td class="main-cell">${esc(item.nombre)}<span class="sub-cell">${esc(item.categoria || 'General')}${item.descripcion ? ` · ${esc(item.descripcion)}` : ''}</span></td>
      <td>${phoneLink(item.telefono)}${item.whatsapp ? `${item.telefono ? '<span class="sub-cell">' : ''}${whatsappLink(item.whatsapp)}${item.telefono ? '</span>' : ''}` : ''}</td>
      <td>${item.email ? `<a href="mailto:${esc(item.email)}">${esc(item.email)}</a>` : '—'}</td>
      <td>${esc(item.horario_atencion || '—')}</td>
      ${admin ? `<td><span class="badge ${item.activo ? '' : 'closed'}">${item.activo ? 'Activo' : 'Inactivo'}</span></td><td><button class="text-link" data-directory-edit="${esc(item.id)}">Editar</button><button class="text-link" data-directory-toggle="${esc(item.id)}" data-next-active="${!item.activo}">${item.activo ? 'Desactivar' : 'Activar'}</button><button class="text-link danger-link" data-directory-delete="${esc(item.id)}">Eliminar</button></td>` : ''}
    </tr>`).join('');
    const cards = visible.map(item => `<article class="directory-card" data-directory-record data-directory-searchable="${esc(`${item.nombre} ${item.categoria || ''} ${item.descripcion || ''} ${item.telefono || ''} ${item.whatsapp || ''} ${item.email || ''}`.toLocaleLowerCase('es-CO'))}" data-directory-category="${esc(item.categoria || 'General')}">
      <div class="directory-card-title"><span class="eyebrow">${esc(item.categoria || 'CONTACTO')}</span><h3>${esc(item.nombre)}</h3></div>
      <div class="directory-card-details">${item.descripcion ? `<p>${esc(item.descripcion)}</p>` : ''}${item.horario_atencion ? `<p class="directory-hours"><b>Horario:</b> ${esc(item.horario_atencion)}</p>` : ''}</div>
      <div class="directory-contact-actions">${phoneLink(item.telefono)}${whatsappLink(item.whatsapp)}${item.email ? `<a href="mailto:${esc(item.email)}">Correo</a>` : ''}</div>
    </article>`).join('');
    if (state.loading) return `${window.portalAdminHead('CONTACTOS ÚTILES', title, desc, actions)}<section class="panel"><p class="muted">Cargando directorio…</p></section>`;
    return `${window.portalAdminHead('CONTACTOS ÚTILES', title, desc, actions)}${state.error ? `<p class="auth-error">No se pudo cargar el directorio: ${esc(state.error)}</p>` : ''}${admin ? `<section class="panel"><div class="panel-title"><h3>Contactos registrados</h3><button class="btn-secondary" data-directory-reload>Actualizar</button></div>${filterControls}${table(['Contacto','Teléfono / WhatsApp','Correo','Horario','Estado','Acciones'], `${rows}<tr data-directory-empty hidden><td class="empty" colspan="6">No hay contactos que coincidan con los filtros.</td></tr>`)}</section>` : visible.length ? `<section class="panel"><div class="panel-title"><h3>Directorio de contactos</h3></div>${filterControls}<div class="directory-grid">${cards}</div><p class="empty" data-directory-empty hidden>No hay contactos que coincidan con los filtros.</p></section>` : `<section class="panel">${filterControls}<p class="empty">Aún no hay contactos publicados. Consulta a administración.</p></section>`}`;
  }

  function table(headers, rows) {
    return `<div class="table-wrap"><table class="data-table"><thead><tr>${headers.map(value => `<th>${value}</th>`).join('')}</tr></thead><tbody>${rows || `<tr><td class="empty" colspan="${headers.length}">Aún no hay contactos registrados.</td></tr>`}</tbody></table></div>`;
  }

  function openForm(contact = null) {
    const dialog = document.getElementById('directoryDialog');
    const item = contact || {};
    dialog.innerHTML = `<form id="directoryForm">
      <div class="dialog-head"><div><span class="eyebrow">DIRECTORIO DEL CONJUNTO</span><h2>${contact ? 'Editar contacto' : 'Agregar contacto'}</h2></div><button class="icon-button" type="button" data-directory-close aria-label="Cerrar">×</button></div>
      <p id="directoryFormError" class="auth-error" hidden></p>
      <div class="basic-form-fields">
        <div class="field"><label for="directoryName">Nombre del contacto o servicio</label><input id="directoryName" name="nombre" required maxlength="120" value="${esc(item.nombre)}" placeholder="Ej. Portería principal"></div>
        <div class="field"><label for="directoryCategory">Categoría</label><input id="directoryCategory" name="categoria" maxlength="80" value="${esc(item.categoria)}" placeholder="Ej. Administración, Emergencias, Mantenimiento"></div>
        <div class="field"><label for="directoryPhone">Teléfono</label><input id="directoryPhone" name="telefono" type="tel" maxlength="40" value="${esc(item.telefono)}" placeholder="Número de contacto"></div>
        <div class="field"><label for="directoryWhatsapp">WhatsApp (incluye indicativo de país)</label><input id="directoryWhatsapp" name="whatsapp" type="tel" maxlength="40" value="${esc(item.whatsapp)}" placeholder="Ej. 57 300 123 4567"></div>
        <div class="field"><label for="directoryEmail">Correo electrónico</label><input id="directoryEmail" name="email" type="email" maxlength="254" value="${esc(item.email)}" placeholder="contacto@ejemplo.com"></div>
        <div class="field"><label for="directoryHours">Horario de atención</label><input id="directoryHours" name="horario_atencion" maxlength="160" value="${esc(item.horario_atencion)}" placeholder="Ej. Lunes a viernes, 8:00 a. m. a 5:00 p. m."></div>
        <div class="field"><label for="directoryDescription">Descripción (opcional)</label><textarea id="directoryDescription" name="descripcion" maxlength="500" placeholder="Información adicional">${esc(item.descripcion)}</textarea></div>
        <div class="field"><label for="directoryOrder">Orden de aparición</label><input id="directoryOrder" name="orden" type="number" step="1" value="${Number(item.orden) || 0}"></div>
      </div>
      <div class="form-actions"><button class="btn-secondary" type="button" data-directory-close>Cancelar</button><button class="btn-primary" type="submit">Guardar contacto</button></div>
    </form>`;
    dialog.querySelectorAll('[data-directory-close]').forEach(button => { button.onclick = () => dialog.close(); });
    dialog.querySelector('#directoryForm').onsubmit = event => save(event, contact?.id);
    dialog.showModal();
  }

  async function save(event, id) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());
    const payload = {
      nombre: values.nombre.trim(),
      categoria: values.categoria.trim() || 'General',
      telefono: values.telefono.trim() || null,
      whatsapp: values.whatsapp.trim() || null,
      email: values.email.trim() || null,
      horario_atencion: values.horario_atencion.trim() || null,
      descripcion: values.descripcion.trim() || null,
      orden: Number(values.orden) || 0,
      actualizado_en: new Date().toISOString(),
    };
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    button.textContent = 'Guardando…';
    let query = client().from('directorio_contactos');
    query = id ? query.update(payload).eq('id', id) : query.insert({ ...payload, creado_por: context().profile?.id || null });
    const { error } = await query;
    if (error) {
      const errorBox = form.querySelector('#directoryFormError');
      errorBox.textContent = `No se pudo guardar: ${error.message}`;
      errorBox.hidden = false;
      button.disabled = false;
      button.textContent = 'Guardar contacto';
      return;
    }
    document.getElementById('directoryDialog').close();
    state.loaded = false;
    await load();
    notify(id ? 'Contacto actualizado.' : 'Contacto agregado al directorio.');
  }

  async function toggle(id, active) {
    const { error } = await client().from('directorio_contactos').update({ activo: active, actualizado_en: new Date().toISOString() }).eq('id', id);
    if (error) { notify(`No se pudo actualizar el contacto: ${error.message}`); return; }
    state.loaded = false;
    await load();
    notify(active ? 'Contacto activado.' : 'Contacto desactivado.');
  }

  async function remove(id) {
    const contact = state.rows.find(item => item.id === id);
    if (!contact || !window.confirm(`¿Eliminar el contacto “${contact.nombre}”?`)) return;
    const { error } = await client().from('directorio_contactos').delete().eq('id', id);
    if (error) { notify(`No se pudo eliminar el contacto: ${error.message}`); return; }
    state.loaded = false;
    await load();
    notify('Contacto eliminado.');
  }

  window.portalDirectoryPage = page;
  window.portalDirectoryConnect = async () => { state.loaded = false; await load(); };
  window.portalDirectoryLoad = load;
  window.portalDirectoryBind = applyFilters;
  document.addEventListener('click', event => {
    const create = event.target.closest('[data-directory-new]');
    if (create) { openForm(); return; }
    if (event.target.closest('[data-directory-reload]')) { state.loaded = false; load(); return; }
    const edit = event.target.closest('[data-directory-edit]');
    if (edit) { const item = state.rows.find(row => row.id === edit.dataset.directoryEdit); if (item) openForm(item); return; }
    const activate = event.target.closest('[data-directory-toggle]');
    if (activate) { toggle(activate.dataset.directoryToggle, activate.dataset.nextActive === 'true'); return; }
    const deleteButton = event.target.closest('[data-directory-delete]');
    if (deleteButton) remove(deleteButton.dataset.directoryDelete);
  });
  document.addEventListener('input', event => {
    if (event.target.matches('[data-directory-search]')) { state.search = event.target.value; applyFilters(); }
  });
  document.addEventListener('change', event => {
    if (event.target.matches('[data-directory-category]')) { state.category = event.target.value; applyFilters(); }
  });
})();
