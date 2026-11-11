(() => {
  const state = { rows: [], loading: false, loaded: false, error: '', channel: null };
  const ctx = () => window.portalAdminContext?.() || { live: false, role: '', profile: null };
  const db = () => window.portalSupabase;
  const refresh = () => window.portalAdminRender?.();
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

  async function load() {
    if (!ctx().live || state.loading) return;
    state.loading = true; state.error = '';
    const result = await db().from('comunicados').select('id,titulo,contenido,fecha_envio').order('fecha_envio', { ascending: false });
    state.loading = false; state.loaded = true;
    if (result.error) { state.error = result.error.message; state.rows = []; }
    else state.rows = result.data || [];
    if (window.portalCurrentPage?.() === 'comunicados') refresh();
  }

  function page() {
    const live = ctx().live;
    if (!live) return null;
    if (state.loading) return `${window.portalAdminHead('VIDA EN COMUNIDAD', 'Comunicados', 'Información publicada para Condominio Palo Alto.')}<section class="panel"><p class="muted">Cargando comunicados…</p></section>`;
    const actions = ctx().role === 'administrador' ? '<button class="btn-primary" data-action="notice">＋ Nuevo comunicado</button>' : '';
    const cards = state.rows.map(item => `<article class="panel"><div class="announcement" style="border:0"><span class="ann-icon">▱</span><div><h4>${esc(item.titulo)}</h4><p>${esc(item.contenido)}</p><p style="margin-top:12px">${item.fecha_envio ? esc(new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.fecha_envio))) : ''}</p></div></div></article>`).join('');
    return `${window.portalAdminHead('VIDA EN COMUNIDAD', 'Comunicados', 'Información publicada para Condominio Palo Alto.', actions)}${state.error ? `<p class="auth-error">No se pudieron cargar los comunicados: ${esc(state.error)}</p>` : ''}<div class="lower-grid">${cards || '<section class="panel"><p class="empty">Aún no hay comunicados publicados.</p></section>'}</div>`;
  }

  async function connect() {
    if (!ctx().live) return;
    if (state.channel) db().removeChannel(state.channel);
    state.rows = []; state.loaded = false;
    await load();
    state.channel = db().channel(`comunicados-${ctx().profile.id}`).on('postgres_changes', { event: '*', schema: 'public', table: 'comunicados' }, () => { state.loaded = false; load(); }).subscribe();
  }

  async function create(title, content) {
    if (ctx().role !== 'administrador') { window.portalAdminNotify?.('Solo administración puede publicar comunicados.'); return false; }
    if (!title.trim() || !content.trim()) { window.portalAdminNotify?.('Completa el título y el mensaje.'); return false; }
    const { error } = await db().from('comunicados').insert({ titulo: title.trim(), contenido: content.trim(), fecha_envio: new Date().toISOString() });
    if (error) { window.portalAdminNotify?.(`No se pudo publicar el comunicado: ${error.message}`); return false; }
    state.loaded = false; await load(); window.portalAdminNotify?.('Comunicado publicado para la comunidad.'); return true;
  }

  window.portalNoticesPage = page;
  window.portalNoticesConnect = connect;
  window.portalNoticesLoad = load;
  window.portalNoticeCreate = create;
})();
