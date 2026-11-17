(() => {
  const state = { loading: false, loaded: false, error: '', parkings: [], pets: [], vaccines: [], homes: new Map(), owners: new Map() };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const context = () => window.portalAdminContext?.() || { live: false, role: '', profile: null };
  const db = () => window.portalSupabase;

  function card(title, subtitle, icon) {
    return `<article class="resident-asset-card"><span class="resident-asset-icon" aria-hidden="true">${icon}</span><div><h3>${esc(title)}</h3><p>${esc(subtitle)}</p></div></article>`;
  }

  function page() {
    const ctx = context();
    const guard = ctx.role === 'vigilante';
    const actions = '<button class="text-link" data-assets-reload>Actualizar</button>';
    const parkingCards = state.parkings.map(item => card(item.numero, [item.tipo, item.placa ? `Placa ${item.placa}` : '', state.homes.get(item.inmueble_id), guard ? state.owners.get(item.usuario_id) : ''].filter(Boolean).join(' · '), '▣')).join('');
    const petCards = state.pets.map(item => {
      const vaccineRows = state.vaccines.filter(vaccine => vaccine.mascota_id === item.id).map(vaccine => `<li><strong>${esc(vaccine.vacuna)}</strong><span>Aplicada: ${esc(vaccine.fecha_aplicacion)}${vaccine.proxima_dosis ? ` · Próxima dosis: ${esc(vaccine.proxima_dosis)}` : ''}</span>${vaccine.veterinaria ? `<small>${esc(vaccine.veterinaria)}</small>` : ''}</li>`).join('');
      return `<article class="resident-asset-card pet-record-card"><span class="resident-asset-icon" aria-hidden="true">♡</span><div><h3>${esc(item.nombre)}</h3><p>${esc([item.especie, item.raza, item.color, state.homes.get(item.inmueble_id), guard ? state.owners.get(item.usuario_id) : ''].filter(Boolean).join(' · '))}</p><strong class="pet-vaccines-heading">Vacunas</strong>${vaccineRows ? `<ul class="pet-vaccine-list">${vaccineRows}</ul>` : '<small class="muted">No hay vacunas registradas.</small>'}</div></article>`;
    }).join('');
    return `${window.portalAdminHead?.(guard ? 'PORTERÍA' : 'MI HOGAR', 'Parqueaderos y mascotas', guard ? 'Consulta los registros asociados a cada propietario e inmueble.' : 'Consulta los parqueaderos y las mascotas registradas para tu inmueble.', actions) || ''}${state.error ? `<section class="panel"><p class="auth-error">${esc(state.error)}</p></section>` : state.loading ? '<section class="panel"><p class="muted">Cargando registros…</p></section>' : `<section class="panel resident-assets-section"><div class="panel-title"><div><span class="eyebrow">VEHÍCULOS</span><h3>Parqueaderos</h3></div><span class="badge">${state.parkings.length}</span></div><div class="resident-assets-grid">${parkingCards || '<p class="muted">No hay parqueaderos registrados.</p>'}</div></section><section class="panel resident-assets-section"><div class="panel-title"><div><span class="eyebrow">CONVIVENCIA</span><h3>Mascotas</h3></div><span class="badge">${state.pets.length}</span></div><div class="resident-assets-grid">${petCards || '<p class="muted">No hay mascotas registradas.</p>'}</div></section>`}`;
  }

  async function load(force = false) {
    const ctx = context();
    if (!ctx.live || !['residente', 'vigilante'].includes(ctx.role) || state.loading || state.loaded && !force) return;
    state.loading = true;
    state.loaded = false;
    state.error = '';
    if (document.getElementById('crumb')?.textContent === 'Parqueaderos y mascotas') window.portalAdminRender?.();
    try {
      const [parkingResult, petResult, vaccineResult] = await Promise.all([
        db().from('parqueaderos').select('id,usuario_id,inmueble_id,numero,tipo,placa').order('numero'),
        db().from('mascotas').select('id,usuario_id,inmueble_id,nombre,especie,raza,color').order('nombre'),
        db().from('vacunas_mascotas').select('id,mascota_id,vacuna,fecha_aplicacion,proxima_dosis,veterinaria').order('fecha_aplicacion', { ascending: false }),
      ]);
      if (parkingResult.error) throw parkingResult.error;
      if (petResult.error) throw petResult.error;
      if (vaccineResult.error) throw vaccineResult.error;
      state.parkings = parkingResult.data || [];
      state.pets = petResult.data || [];
      state.vaccines = vaccineResult.data || [];
      const homeIds = [...new Set([...state.parkings, ...state.pets].map(item => item.inmueble_id))];
      if (homeIds.length && ctx.role === 'vigilante') {
        const { data, error } = await db().rpc('app_unidades_para_guardia');
        if (error) throw error;
        state.homes = new Map((data || []).filter(home => homeIds.includes(home.id)).map(home => [home.id, home.identificador]));
      } else if (homeIds.length) {
        const { data, error } = await db().from('inmuebles').select('id,identificador').in('id', homeIds);
        if (error) throw error;
        state.homes = new Map((data || []).map(home => [home.id, home.identificador]));
      } else state.homes = new Map();
      if (ctx.role === 'vigilante') {
        const ownerIds = [...new Set([...state.parkings, ...state.pets].map(item => item.usuario_id))];
        if (ownerIds.length) {
          const { data, error } = await db().rpc('app_nombres_propietarios_activos', { p_usuario_ids: ownerIds });
          if (error) throw error;
          state.owners = new Map((data || []).map(owner => [owner.usuario_id, owner.nombre_completo]));
        } else state.owners = new Map();
      }
    } catch (error) {
      console.error('No se pudieron cargar los parqueaderos y mascotas.', { code: error?.code, message: error?.message });
      state.error = `No se pudieron cargar los registros: ${error?.message || 'Error de conexión.'}`;
    } finally {
      state.loading = false;
      state.loaded = true;
      if (document.getElementById('crumb')?.textContent === 'Parqueaderos y mascotas') window.portalAdminRender?.();
    }
  }

  document.addEventListener('click', event => {
    if (!event.target.closest('[data-assets-reload]')) return;
    load(true);
  });
  window.portalResidentAssetsPage = page;
  window.portalResidentAssetsLoad = load;
})();
