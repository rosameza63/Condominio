(() => {
  const state = { rows: [], homes: [], loaded: false, loading: false, channel: null, stream: null, scanTimer: null, error: '' };
  const $ = selector => document.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const context = () => window.portalAdminContext?.() || { live: false, role: '', profile: null };
  const db = () => window.portalSupabase;
  const notify = message => window.portalAdminNotify?.(message);
  const refresh = () => window.portalAdminRender?.();
  const formatDate = value => value ? new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—';
  const statusLabel = row => row.estado === 'Pendiente' ? 'Esperado' : row.estado;
  const filterControls = () => `<div class="access-filters"><input class="inline-search" type="search" data-visitor-search placeholder="⌕ Buscar nombre o cédula…"><select class="inline-search" data-visitor-status aria-label="Filtrar por estado"><option value="Todos">Todos los estados</option><option value="Pendiente">Esperado</option><option value="Ingresó">Ingresó</option><option value="Salió">Salió</option></select><select class="inline-search" data-visitor-home aria-label="Filtrar por inmueble"><option value="Todos">Todos los inmuebles</option>${state.homes.map(home => `<option value="${esc(home.identificador)}">${esc(home.identificador)}</option>`).join('')}</select>${context().role === 'vigilante' ? '<input class="inline-search" type="date" data-visitor-date aria-label="Filtrar por fecha de ingreso">' : ''}</div>`;
  function applyFilters() {
    const search = $('[data-visitor-search]'), status = $('[data-visitor-status]'), home = $('[data-visitor-home]'), date = $('[data-visitor-date]');
    if (!search || !status || !home) return;
    let shown = 0;
    document.querySelectorAll('[data-visitor-row]').forEach(row => {
      const text = `${row.dataset.visitorName} ${row.dataset.visitorId}`.toLocaleLowerCase('es-CO');
      const visible = text.includes(search.value.trim().toLocaleLowerCase('es-CO'))
        && (status.value === 'Todos' || row.dataset.visitorStatus === status.value)
        && (home.value === 'Todos' || row.dataset.visitorHome === home.value)
        && (!date?.value || row.dataset.visitorEntryDate === date.value);
      row.hidden = !visible;
      if (visible) shown++;
    });
    const empty = $('[data-visitor-no-results]');
    if (empty) empty.hidden = shown > 0;
  }
  const dateKey = value => {
    if (!value) return '';
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value)).map(part => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  };
  const withFilterData = row => `data-visitor-row data-visitor-name="${esc(row.nombre_visitante)}" data-visitor-id="${esc(row.cedula_visitante || '')}" data-visitor-home="${esc(row.inmueble)}" data-visitor-status="${esc(row.estado)}" data-visitor-entry-date="${esc(dateKey(row.fecha_hora_ingreso))}"`;

  function stopCamera() {
    if (state.scanTimer) clearTimeout(state.scanTimer);
    state.scanTimer = null;
    state.stream?.getTracks().forEach(track => track.stop());
    state.stream = null;
    const video = $('#visitorQrVideo');
    if (video) video.srcObject = null;
  }

  async function load() {
    if (!context().live || state.loading) return;
    state.loading = true;
    state.error = '';
    const result = await db().from('registro_visitas')
      .select('id,inmueble_id,nombre_visitante,cedula_visitante,codigo_qr_token,estado,fecha_hora_ingreso,fecha_hora_salida,autorizado_por,vence_qr_en,telefono_residente')
      .order('fecha_hora_ingreso', { ascending: false });
    if (result.error) {
      state.error = result.error.message;
      state.rows = [];
      state.loading = false;
      state.loaded = true;
      refresh();
      return;
    }
    state.rows = result.data || [];
    const homeIds = [...new Set(state.rows.map(row => row.inmueble_id).filter(Boolean))];
    if (context().role === 'residente') {
      const links = await db().from('inmueble_usuarios').select('inmueble_id').eq('usuario_id', context().profile.id);
      for (const link of links.data || []) if (!homeIds.includes(link.inmueble_id)) homeIds.push(link.inmueble_id);
      if (context().profile.inmueble_id && !homeIds.includes(context().profile.inmueble_id)) homeIds.push(context().profile.inmueble_id);
    }
    const homesResult = context().role === 'vigilante'
      ? await db().rpc('app_unidades_para_guardia')
      : homeIds.length
        ? await db().from('inmuebles').select('id,identificador').in('id', homeIds)
        : { data: [], error: null };
    state.homes = homesResult.data || [];
    const homeById = Object.fromEntries(state.homes.map(home => [home.id, home.identificador]));
    state.rows = state.rows.map(row => ({ ...row, inmueble: homeById[row.inmueble_id] || 'Inmueble asociado' }));
    state.loading = false;
    state.loaded = true;
    refresh();
  }

  async function connect() {
    if (!context().live) return;
    stopCamera();
    if (state.channel) db().removeChannel(state.channel);
    state.loaded = false;
    state.rows = [];
    state.homes = [];
    await load();
    state.channel = db().channel(`visitas-${context().profile.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'registro_visitas' }, () => { state.loaded = false; load(); })
      .subscribe();
  }

  function visitorPage() {
    const role = context().role;
    if (state.loading) return '<section class="panel">Cargando visitantes…</section>';
    if (state.error) return `<section class="panel"><p class="auth-error">No se pudieron cargar los visitantes: ${esc(state.error)}</p><button class="text-link" data-visitors-reload>Intentar de nuevo</button></section>`;
    if (role === 'residente') {
      const rows = state.rows.map(row => `<tr ${withFilterData(row)}><td class="main-cell">${esc(row.nombre_visitante)}<span class="sub-cell">Cédula: ${esc(row.cedula_visitante || '—')}</span></td><td>${esc(row.inmueble)}</td><td>${esc(row.fecha_hora_ingreso ? formatDate(row.fecha_hora_ingreso) : 'Pendiente de llegada')}</td><td><span class="badge ${row.estado === 'Pendiente' ? 'pending' : row.estado === 'Salió' ? 'closed' : ''}">${esc(statusLabel(row))}</span></td><td>${row.codigo_qr_token && row.estado === 'Pendiente' ? `<button class="text-link" data-show-visitor-qr="${esc(row.id)}">Ver / compartir QR</button>` : '—'}</td></tr>`).join('');
      const content = rows ? rows + '<tr data-visitor-no-results hidden><td colspan="5" class="empty">No se encontraron visitantes con esos filtros.</td></tr>' : rows;
      const listing = table(['Visitante','Inmueble','Llegada','Estado','QR'], content);
      return `${window.portalAdminHead('CONTROL DE ACCESO', 'Mis visitantes', 'Autoriza una visita y comparte el QR para el ingreso y la salida.', '<button class="btn-primary" data-action="visitor">＋ Autorizar visitante</button>')}<section class="panel"><div class="panel-title"><h3>Autorizaciones</h3><button class="text-link" data-visitors-reload>Actualizar</button></div>${filterControls()}${listing}</section>`;
    }
    if (role === 'vigilante') {
      const rows = state.rows.map(row => `<tr ${withFilterData(row)}><td class="main-cell">${esc(row.nombre_visitante)}<span class="sub-cell">Cédula: ${esc(row.cedula_visitante || '—')}</span></td><td>${esc(row.inmueble)}</td><td>${esc(row.fecha_hora_ingreso ? formatDate(row.fecha_hora_ingreso) : '—')}</td><td><span class="badge ${row.estado === 'Pendiente' ? 'pending' : row.estado === 'Salió' ? 'closed' : ''}">${esc(statusLabel(row))}</span></td><td>${row.estado === 'Ingresó' && row.telefono_residente ? `<button class="text-link" data-visitor-whatsapp="${esc(row.id)}">Avisar por WhatsApp</button>` : '—'}</td></tr>`).join('');
      const content = rows ? rows + '<tr data-visitor-no-results hidden><td colspan="5" class="empty">No se encontraron visitantes con esos filtros.</td></tr>' : rows;
      const listing = table(['Visitante','Inmueble','Ingreso','Estado','Aviso'], content);
      return `${window.portalAdminHead('CONTROL DE ACCESO', 'Visitantes', 'Escanea el QR al ingresar y al salir. El ingreso avisa al residente dentro de Nexo.', '<button class="btn-primary" data-start-visitor-scan>▦ Escanear QR</button>')}<section class="panel visitor-scan-panel"><div class="panel-title"><h3>Registrar ingreso o salida</h3></div><div class="visitor-scan-tools"><input id="visitorTokenInput" class="inline-search" placeholder="Código del QR" autocomplete="off"><button class="btn-secondary" data-visitor-token-submit>Consultar código</button><button class="text-link" data-start-visitor-scan>Usar cámara</button></div><div class="visitor-scan-camera" id="visitorScanCamera" hidden><video id="visitorQrVideo" playsinline muted></video><p class="muted" id="visitorScanMessage">Enfoca el QR del visitante.</p><button class="text-link" data-stop-visitor-scan>Cancelar cámara</button></div></section><section class="panel"><div class="panel-title"><h3>Visitas autorizadas</h3><button class="text-link" data-visitors-reload>Actualizar</button></div>${filterControls()}${listing}</section>`;
    }
    const rows = state.rows.map(row => `<tr ${withFilterData(row)}><td class="main-cell">${esc(row.nombre_visitante)}</td><td>${esc(row.inmueble)}</td><td>${esc(formatDate(row.fecha_hora_ingreso))}</td><td>${esc(statusLabel(row))}</td></tr>`).join('');
    const content = rows ? rows + '<tr data-visitor-no-results hidden><td colspan="4" class="empty">No se encontraron visitantes con esos filtros.</td></tr>' : rows;
    const listing = table(['Visitante','Inmueble','Ingreso','Estado'], content);
    return `${window.portalAdminHead('CONTROL DE ACCESO', 'Visitantes', 'Consulta las autorizaciones e ingresos registrados.') }<section class="panel">${filterControls()}${listing}</section>`;
  }

  function table(headers, rows) {
    return `<div class="table-wrap"><table class="data-table"><thead><tr>${headers.map(value => `<th>${value}</th>`).join('')}</tr></thead><tbody>${rows || `<tr><td colspan="${headers.length}" class="empty">Aún no hay registros.</td></tr>`}</tbody></table></div>`;
  }

  async function prepareForm() {
    while (state.loading) await new Promise(resolve => setTimeout(resolve, 40));
    if (!state.loaded) await load();
    const homes = state.homes.length ? state.homes : [];
    const target = $('#formFields');
    target.innerHTML = `<p class="auth-error" id="actionFormError" role="alert" ${state.error || !homes.length ? '' : 'hidden'}>${esc(state.error || (!homes.length ? 'No hay un inmueble asociado a tu perfil. Contacta a administración.' : ''))}</p><div class="field"><label for="field_name">Nombre del visitante</label><input id="field_name" required maxlength="120" placeholder="Nombre completo"></div><div class="field"><label for="field_cedula">Cédula del visitante</label><input id="field_cedula" required maxlength="40" placeholder="Número de identificación"></div><div class="field"><label for="field_inmueble_id">Inmueble de destino</label><select id="field_inmueble_id" required>${homes.map(home => `<option value="${esc(home.id)}">${esc(home.identificador)}</option>`).join('') || '<option value="">No hay inmuebles asociados</option>'}</select></div><div class="field"><label for="field_expiry">QR válido hasta</label><input id="field_expiry" type="datetime-local" required></div>`;
    const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000);
    expiry.setMinutes(expiry.getMinutes() - expiry.getTimezoneOffset());
    $('#field_expiry').value = expiry.toISOString().slice(0, 16);
    $('#formTitle').textContent = 'Autorizar visitante';
    $('#formEyebrow').textContent = 'COMPARTE EL QR CON TU VISITANTE';
    $('#submitAction').textContent = 'Generar QR';
  }

  function randomToken() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
  }

  async function create() {
    const errorBox = $('#actionFormError');
    const showError = message => { if (errorBox) { errorBox.textContent = message; errorBox.hidden = false; } else notify(message); };
    const name = $('#field_name')?.value.trim();
    const idNumber = $('#field_cedula')?.value.trim();
    const homeId = $('#field_inmueble_id')?.value;
    const expires = $('#field_expiry')?.value;
    if (!name || !idNumber || !homeId || !expires) { showError('Completa el nombre, la cédula, el inmueble y la vigencia del QR.'); return; }
    if (new Date(expires) <= new Date()) { showError('La vigencia del QR debe ser una fecha futura.'); return; }
    const token = randomToken();
    const residentPhone = context().profile.telefono || null;
    const payload = { inmueble_id: homeId, nombre_visitante: name, cedula_visitante: idNumber, codigo_qr_token: token, estado: 'Pendiente', autorizado_por: context().profile.id, vence_qr_en: new Date(expires).toISOString(), telefono_residente: residentPhone };
    const result = await db().from('registro_visitas').insert(payload).select('id,inmueble_id,nombre_visitante,cedula_visitante,codigo_qr_token,estado,fecha_hora_ingreso,fecha_hora_salida,autorizado_por,vence_qr_en,telefono_residente').single();
    if (result.error) { showError(`No se pudo crear la autorización: ${result.error.message}`); return; }
    const home = state.homes.find(item => item.id === homeId);
    state.rows.unshift({ ...result.data, inmueble: home?.identificador || 'Inmueble asociado' });
    state.loaded = true;
    $('#formDialog').close();
    refresh();
    showQr(result.data.id);
  }

  function showQr(id) {
    const row = state.rows.find(item => item.id === id);
    if (!row) return;
    let dialog = $('#visitorQrDialog');
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.id = 'visitorQrDialog';
      document.body.append(dialog);
    }
    dialog.innerHTML = `<div class="dialog-head"><div><span class="eyebrow">PRESENTAR EN PORTERÍA</span><h2>QR de ${esc(row.nombre_visitante)}</h2></div><button class="icon-button" data-close-visitor-qr aria-label="Cerrar">×</button></div><p class="muted">${esc(row.inmueble)} · Válido hasta ${esc(formatDate(row.vence_qr_en))}. El mismo QR sirve para registrar la entrada y la salida.</p><div class="visitor-qr-code" id="visitorQrCanvas"></div><div class="form-actions"><button class="btn-secondary" data-download-visitor-qr>Descargar QR</button><button class="btn-primary" data-share-visitor-qr>Compartir QR</button></div>`;
    dialog.dataset.visitId = row.id;
    dialog.showModal();
    const container = $('#visitorQrCanvas');
    if (typeof window.QRCode !== 'function') {
      container.insertAdjacentHTML('afterend', '<p class="auth-error">No se pudo cargar el generador de QR. Revisa la conexión y vuelve a abrir el código.</p>');
      return;
    }
    new window.QRCode(container, { text: row.codigo_qr_token, width: 280, height: 280, colorDark: '#173b32', colorLight: '#ffffff', correctLevel: window.QRCode.CorrectLevel.M });
  }

  async function shareQr() {
    const container = $('#visitorQrCanvas');
    const row = state.rows.find(item => item.id === $('#visitorQrDialog')?.dataset.visitId);
    if (!container || !row) return;
    const canvas = container.querySelector('canvas');
    const image = container.querySelector('img');
    const blob = canvas ? await new Promise(resolve => canvas.toBlob(resolve, 'image/png')) : image ? await fetch(image.src).then(response => response.blob()) : null;
    if (!blob) { notify('No se pudo preparar la imagen QR.'); return; }
    const file = new File([blob], `QR-${row.nombre_visitante.replace(/[^a-z0-9_-]/gi, '-')}.png`, { type: 'image/png' });
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ title: `QR de visita para ${row.inmueble}`, text: `Presenta este QR en portería para registrar entrada y salida. Válido hasta ${formatDate(row.vence_qr_en)}.`, files: [file] }); }
      catch (error) { if (error.name !== 'AbortError') notify('No se pudo compartir el QR. Puedes descargarlo y enviarlo por WhatsApp.'); }
    } else downloadQr();
  }

  function downloadQr() {
    const container = $('#visitorQrCanvas');
    if (!container) return;
    const canvas = container.querySelector('canvas');
    const image = container.querySelector('img');
    const link = document.createElement('a');
    link.download = 'QR-visitante.png';
    link.href = canvas ? canvas.toDataURL('image/png') : image?.src || '';
    if (!link.href) { notify('Todavía no se generó el QR.'); return; }
    link.click();
  }

  function tokenValue(value) {
    const text = String(value || '').trim();
    try {
      const url = new URL(text);
      return url.searchParams.get('visita') || url.hash.replace(/^#/, '') || text;
    } catch { return text; }
  }

  async function processToken(rawValue) {
    const token = tokenValue(rawValue);
    if (!token) { notify('Escanea el QR o escribe el código.'); return; }
    const input = $('#visitorTokenInput');
    const result = await db().from('registro_visitas').select('id,inmueble_id,nombre_visitante,codigo_qr_token,estado,fecha_hora_ingreso,fecha_hora_salida,autorizado_por,vence_qr_en,telefono_residente').eq('codigo_qr_token', token).maybeSingle();
    if (result.error) { notify(`No se pudo consultar el QR: ${result.error.message}`); return; }
    if (!result.data) { notify('El código QR no corresponde a una autorización registrada.'); if (input) input.value = ''; return; }
    const visit = { ...result.data, inmueble: state.rows.find(row => row.id === result.data.id)?.inmueble || 'tu inmueble' };
    if (visit.vence_qr_en && new Date(visit.vence_qr_en) <= new Date()) { notify('Este QR ya venció. Pide al residente que genere uno nuevo.'); return; }
    let nextState, update;
    if (visit.estado === 'Pendiente') { nextState = 'Ingresó'; update = { estado: nextState, fecha_hora_ingreso: new Date().toISOString() }; }
    else if (visit.estado === 'Ingresó') { nextState = 'Salió'; update = { estado: nextState, fecha_hora_salida: new Date().toISOString() }; }
    else { notify('Este QR ya registra la salida del visitante.'); return; }
    const saved = await db().from('registro_visitas').update(update).eq('id', visit.id).eq('estado', visit.estado).select('id,estado,fecha_hora_ingreso,fecha_hora_salida').maybeSingle();
    if (saved.error) { notify(`No se pudo registrar el movimiento: ${saved.error.message}`); return; }
    if (!saved.data) { notify('El estado de esta visita cambió. Actualiza la lista y vuelve a consultar.'); return; }
    if (input) input.value = '';
    state.rows = state.rows.map(row => row.id === visit.id ? { ...row, ...saved.data } : row);
    renderCurrentPage();
    notify(nextState === 'Ingresó' ? `Entrada registrada: ${visit.nombre_visitante}. Se avisó al residente.` : `Salida registrada: ${visit.nombre_visitante}.`);
  }

  function renderCurrentPage() {
    const current = context();
    if (current.live && current.role === 'vigilante') refresh();
  }

  async function startCamera() {
    const camera = $('#visitorScanCamera');
    const video = $('#visitorQrVideo');
    camera.hidden = false;
    if (!('BarcodeDetector' in window) || !navigator.mediaDevices?.getUserMedia) {
      $('#visitorScanMessage').textContent = 'Este navegador no ofrece lectura QR por cámara. Escribe el token del QR en el campo anterior.';
      $('#visitorTokenInput')?.focus();
      return;
    }
    try {
      const detector = new BarcodeDetector({ formats: ['qr_code'] });
      state.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      video.srcObject = state.stream;
      await video.play();
      const scan = async () => {
        if (!state.stream) return;
        try {
          const codes = await detector.detect(video);
          if (codes.length) { stopCamera(); await processToken(codes[0].rawValue); return; }
        } catch { /* La cámara puede no tener un cuadro listo al iniciar. */ }
        state.scanTimer = setTimeout(scan, 300);
      };
      scan();
    } catch (error) {
      $('#visitorScanMessage').textContent = `No se pudo abrir la cámara (${error.message}). Escribe el token del QR manualmente.`;
    }
  }

  function bind() {
    $('[data-visitor-search]')?.addEventListener('input', applyFilters);
    $('[data-visitor-status]')?.addEventListener('change', applyFilters);
    $('[data-visitor-home]')?.addEventListener('change', applyFilters);
    $('[data-visitor-date]')?.addEventListener('change', applyFilters);
    document.querySelectorAll('[data-visitors-reload]').forEach(button => button.onclick = () => { state.loaded = false; load(); });
    document.querySelectorAll('[data-show-visitor-qr]').forEach(button => button.onclick = () => showQr(button.dataset.showVisitorQr));
    document.querySelectorAll('[data-start-visitor-scan]').forEach(button => button.onclick = startCamera);
    document.querySelectorAll('[data-stop-visitor-scan]').forEach(button => button.onclick = stopCamera);
    document.querySelectorAll('[data-visitor-token-submit]').forEach(button => button.onclick = () => processToken($('#visitorTokenInput')?.value));
    $('#visitorTokenInput')?.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); processToken(event.currentTarget.value); } });
    document.querySelectorAll('[data-visitor-whatsapp]').forEach(button => button.onclick = () => {
      const visit = state.rows.find(row => row.id === button.dataset.visitorWhatsapp);
      let phone = String(visit?.telefono_residente || '').replace(/\D/g, '');
      if (!phone) { notify('El residente no tiene un número de celular registrado.'); return; }
      if (phone.length === 10) phone = `57${phone}`;
      const message = `Hola, te informamos que ${visit.nombre_visitante} llegó a portería para visitar ${visit.inmueble}.`;
      window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, '_blank', 'noopener');
    });
  }

  document.addEventListener('click', event => {
    if (event.target.closest('[data-close-visitor-qr]')) $('#visitorQrDialog')?.close();
    if (event.target.closest('[data-download-visitor-qr]')) downloadQr();
    if (event.target.closest('[data-share-visitor-qr]')) shareQr();
  });

  window.portalVisitorsPage = visitorPage;
  window.portalVisitorsBind = bind;
  window.portalVisitorsConnect = connect;
  window.portalVisitorsPrepareForm = prepareForm;
  window.portalVisitorCreate = create;
})();
