(() => {
  const state = { profileKey: '', role: '', loading: false, loaded: false, error: '', stats: {}, notices: [], guard: { expectedVisits: [], activeAlerts: [] }, channel: null };
  const context = () => window.portalAdminContext?.() || { live: false, role: '', profile: null };
  const db = () => window.portalSupabase;
  const refresh = () => window.portalAdminRender?.();
  const dateKey = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const formatNoticeDate = value => value ? new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '';

  async function load(force = false) {
    const current = context();
    if (!current.live || !['administrador', 'residente', 'vigilante'].includes(current.role) || !current.profile?.id) return;
    const key = `${current.role}:${current.profile.id}`;
    if (state.loading || (!force && state.loaded && state.profileKey === key)) return;
    state.loading = true; state.error = '';
    const isAdmin = current.role === 'administrador';
    if (current.role === 'vigilante') {
      const dateParts = Object.fromEntries(new Intl.DateTimeFormat('en', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).map(part => [part.type, part.value]));
      const today = `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
      const dayStart = new Date(`${today}T00:00:00-05:00`).toISOString();
      const dayEnd = new Date(new Date(dayStart).getTime() + 24 * 60 * 60 * 1000).toISOString();
      const [expectedVisits, entriesToday, visitorsInside, alerts, homes] = await Promise.all([
        db().from('registro_visitas').select('id,inmueble_id,nombre_visitante,cedula_visitante,estado,fecha_hora_ingreso,vence_qr_en').eq('estado', 'Pendiente').order('vence_qr_en', { ascending: true }),
        db().from('registro_visitas').select('id', { count: 'exact', head: true }).in('estado', ['Ingresó', 'Salió']).gte('fecha_hora_ingreso', dayStart).lt('fecha_hora_ingreso', dayEnd),
        db().from('registro_visitas').select('id', { count: 'exact', head: true }).eq('estado', 'Ingresó'),
        db().from('alertas_emergencia').select('id,usuario_id,tipo_alerta,estado,fecha_hora,origen,nombre_activador,inmueble_activador,detalle_alerta', { count: 'exact' }).eq('estado', 'Activa').order('fecha_hora', { ascending: false }).limit(5),
        db().rpc('app_unidades_para_guardia'),
      ]);
      const isReference = value => /^\d+$/.test(String(value || '').trim()) || /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(String(value || '').trim());
      const unresolvedAlertIds = (alerts.data || []).filter(row => row.usuario_id && (isReference(row.nombre_activador) || !row.nombre_activador)).map(row => row.id);
      const alertNameById = {};
      if (unresolvedAlertIds.length) {
        const { data: names } = await db().rpc('app_nombres_alertas_guardia', { p_alerta_ids: unresolvedAlertIds });
        for (const item of names || []) if (item.nombre_residente) alertNameById[item.alerta_id] = item.nombre_residente;
      }
      state.loading = false; state.loaded = true; state.profileKey = key; state.role = current.role;
      state.error = [expectedVisits, entriesToday, visitorsInside, alerts, homes].filter(result => result.error).map(result => result.error.message).join(' · ');
      const now = new Date();
      const homeById = Object.fromEntries((homes.data || []).map(home => [home.id, home.identificador]));
      state.guard = {
        expectedVisits: (expectedVisits.data || []).filter(row => !row.vence_qr_en || new Date(row.vence_qr_en) > now).map(row => ({
          name: row.nombre_visitante,
          idNumber: row.cedula_visitante || '',
          unit: homeById[row.inmueble_id] || 'Inmueble asociado',
          date: row.fecha_hora_ingreso ? formatNoticeDate(row.fecha_hora_ingreso) : 'Pendiente de llegada',
          status: 'Esperado',
        })),
        activeAlerts: (alerts.data || []).map(row => ({
          id: row.id,
          reference: window.portalAlertReference?.(row.fecha_hora) || '',
          type: row.tipo_alerta === 'General' ? 'General Portería' : row.tipo_alerta,
          name: alertNameById[row.id] || (isReference(row.nombre_activador) ? 'Residente' : row.nombre_activador) || 'Usuario',
          unit: row.inmueble_activador || 'Condominio Palo Alto',
          date: formatNoticeDate(row.fecha_hora),
          status: row.estado,
          detail: row.detalle_alerta || '',
        })),
      };
      state.stats = {
        expectedVisits: state.guard.expectedVisits.length,
        entriesToday: entriesToday.count ?? 0,
        visitorsInside: visitorsInside.count ?? 0,
        activeAlerts: alerts.count ?? 0,
      };
      if (window.portalCurrentPage?.() === 'inicio') refresh();
      return;
    }
    const requestsQuery = db().from('pqrs').select('estado').eq(isAdmin ? 'estado' : 'usuario_id', isAdmin ? 'Abierto' : current.profile.id);
    const visitsQuery = db().from('registro_visitas').select('estado,vence_qr_en').eq(isAdmin ? 'estado' : 'autorizado_por', isAdmin ? 'Pendiente' : current.profile.id);
    const noticesQuery = db().from('comunicados').select('id,titulo,contenido,fecha_envio').order('fecha_envio', { ascending: false }).limit(3);
    const loansQuery = isAdmin
      ? db().from('prestamos').select('estado_prestamo')
      : db().from('prestamos').select('item_id,fecha_reserva,horario_bloque,estado_prestamo').eq('usuario_id', current.profile.id).eq('estado_prestamo', 'Aprobado/Asignado').gte('fecha_reserva', dateKey(new Date())).order('fecha_reserva').limit(1);
    const loanItemsQuery = isAdmin ? Promise.resolve({ data: [], error: null }) : db().from('inventario_elementos_y_sitios').select('id,nombre');
    const unitsQuery = isAdmin ? db().from('inmuebles').select('id', { count: 'exact', head: true }) : Promise.resolve({ data: [], error: null });
    const [requests, visits, loans, units, notices, loanItems] = await Promise.all([requestsQuery, visitsQuery, loansQuery, unitsQuery, noticesQuery, loanItemsQuery]);
    state.loading = false; state.loaded = true; state.profileKey = key; state.role = current.role;
    const results = [requests, visits, loans, units, notices, loanItems].filter(result => result.error);
    state.error = results.map(result => result.error.message).join(' · ');
    const now = new Date();
    const activeVisits = (visits.data || []).filter(row => row.estado === 'Pendiente' && (!row.vence_qr_en || new Date(row.vence_qr_en) > now)).length;
    const activeRequests = (requests.data || []).filter(row => row.estado === 'Abierto').length;
    if (isAdmin) {
      state.stats = {
        requests: activeRequests,
        visitors: activeVisits,
        loans: (loans.data || []).filter(row => row.estado_prestamo === 'Solicitado').length,
        units: units.count ?? null,
      };
    } else {
      const nextLoan = loans.data?.[0];
      const loanItem = (loanItems.data || []).find(item => item.id === nextLoan?.item_id);
      state.stats = {
        requests: activeRequests,
        visitors: activeVisits,
        nextLoan: nextLoan ? { item: loanItem?.nombre || 'Elemento o zona', date: new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${nextLoan.fecha_reserva}T12:00:00Z`)), schedule: nextLoan.horario_bloque } : null,
      };
    }
    state.notices = (notices.data || []).map(item => ({ title: item.titulo, text: item.contenido, date: formatNoticeDate(item.fecha_envio), icon: '▱' }));
    if (window.portalCurrentPage?.() === 'inicio') refresh();
  }

  function snapshot() {
    if (!context().live) return null;
    if (!state.loaded || state.profileKey !== `${context().role}:${context().profile?.id}`) return { loading: true, stats: {}, error: '' };
    return { loading: state.loading, stats: state.stats, guard: state.guard, error: state.error };
  }

  window.portalDashboardConnect = async () => {
    if (state.channel) db().removeChannel(state.channel);
    state.loaded = false; state.profileKey = ''; state.stats = {}; state.notices = []; state.guard = { expectedVisits: [], activeAlerts: [] };
    await load();
    if (context().live && ['administrador', 'residente', 'vigilante'].includes(context().role)) {
      const tables = context().role === 'vigilante'
        ? ['registro_visitas', 'alertas_emergencia']
        : ['pqrs', 'registro_visitas', 'prestamos', 'comunicados'];
      let channel = db().channel(`resumen-${context().profile.id}`);
      for (const table of tables) channel = channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => load(true));
      state.channel = channel.subscribe();
    }
  };
  window.portalDashboardLoad = load;
  window.portalDashboardSnapshot = snapshot;
  window.portalDashboardNotices = () => state.notices;
})();
