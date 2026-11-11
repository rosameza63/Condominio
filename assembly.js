(() => {
  let meetings = [], homes = [], residentHomes = [], error = '', loading = false, channel = null, loaded = false, historyView = false, allView = true;
  const expandedResults = new Set();
  const filters = { search: '', year: 'Todos', status: 'Todos' };
  const ctx = () => window.portalAdminContext?.() || { live: false, role: '' };
  const db = () => window.portalSupabase;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const refresh = () => window.portalAdminRender?.();
  const formatPercent = value => `${new Intl.NumberFormat('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value) || 0)}%`;

  async function load() {
    if (!ctx().live || loading) return;
    loading = true; error = '';
    const client = db();
    const [assembliesResult, questionsResult, attendanceResult, votesResult] = await Promise.all([
      client.from('asambleas').select('id,titulo_asamblea,fecha,hora,estado').order('fecha', { ascending: false }),
      client.from('preguntas_votacion').select('id,asamblea_id,pregunta,estado_pregunta,opciones,opcion_aprobatoria').order('id'),
      client.from('asistencia_asamblea').select('id,asamblea_id,usuario_id,presente,inmueble_id,coeficiente'),
      client.from('votos').select('id,pregunta_id,usuario_id,opcion_votada,inmueble_id,coeficiente'),
    ]);
    let homesResult = { data: [], error: null };
    let relationsResult = { data: [], error: null };
    if (ctx().role === 'administrador') homesResult = await client.from('inmuebles').select('id,identificador,coeficiente').order('identificador');
    else if (ctx().profile?.id) {
      [relationsResult, homesResult] = await Promise.all([
        client.from('inmueble_usuarios').select('inmueble_id,tipo_residente_codigo').eq('usuario_id', ctx().profile.id),
        client.from('inmuebles').select('id,identificador,coeficiente'),
      ]);
    }
    loading = false; loaded = true;
    const results = [assembliesResult, questionsResult, attendanceResult, votesResult, homesResult, relationsResult];
    const failed = results.find(result => result.error);
    if (failed) error = failed.error.message;
    homes = homesResult.data || [];
    const relationRows = relationsResult.data || [];
    const ownerIds = relationRows.filter(row => row.tipo_residente_codigo?.toLowerCase().includes('propiet')).map(row => row.inmueble_id);
    if (ctx().profile?.tipo_residente?.toLowerCase() === 'propietario' && ctx().profile.inmueble_id) ownerIds.push(ctx().profile.inmueble_id);
    if (!ownerIds.length && ctx().profile?.inmueble_id && !relationRows.length) ownerIds.push(ctx().profile.inmueble_id);
    const ownerSet = new Set(ownerIds);
    residentHomes = homes.filter(home => ownerSet.has(home.id));
    const attendanceRows = attendanceResult.data || [];
    const voteRows = votesResult.data || [];
    const propertyCount = ctx().role === 'administrador' ? homes.length : 0;
    const questionByAssembly = new Map();
    for (const row of questionsResult.data || []) {
      const item = { id: row.id, text: row.pregunta, status: row.estado_pregunta, options: Array.isArray(row.opciones) ? row.opciones : ['Sí', 'No', 'Abstenerse'], approvingOption: row.opcion_aprobatoria || '', votes: {}, voteCoefficients: {} };
      for (const vote of voteRows.filter(candidate => candidate.pregunta_id === row.id)) {
        const key = vote.inmueble_id || vote.usuario_id;
        item.votes[key] = vote.opcion_votada;
        item.voteCoefficients[key] = Number(vote.coeficiente || 0);
      }
      if (!questionByAssembly.has(row.asamblea_id)) questionByAssembly.set(row.asamblea_id, []);
      questionByAssembly.get(row.asamblea_id).push(item);
    }
    meetings = (assembliesResult.data || []).map(row => {
      const presentRows = attendanceRows.filter(item => item.asamblea_id === row.id && item.presente);
      const uniquePresent = new Map(presentRows.map(item => [item.inmueble_id || item.usuario_id, item]));
      const presentCoefficient = [...uniquePresent.values()].reduce((sum, item) => sum + Number(item.coeficiente || homes.find(home => home.id === item.inmueble_id)?.coeficiente || 0), 0);
      const attendance = {};
      for (const item of presentRows) attendance[item.inmueble_id || item.usuario_id] = item.usuario_id;
      const attendedHomes = [...uniquePresent.values()].map(item => {
        const home = homes.find(candidate => candidate.id === item.inmueble_id);
        return { label: home?.identificador || 'Inmueble registrado', coefficient: Number(item.coeficiente || home?.coeficiente || 0) };
      }).sort((a, b) => a.label.localeCompare(b.label, 'es'));
      return {
        id: row.id, title: row.titulo_asamblea, date: row.fecha, time: String(row.hora || '').slice(0, 5), status: row.estado,
        attendance, attendanceCount: uniquePresent.size, totalHomes: propertyCount, quorumMinimum: Math.floor(propertyCount / 2) + 1,
        presentCoefficient, attendedHomes, questions: questionByAssembly.get(row.id) || [],
      };
    });
    if (window.portalCurrentPage?.() === 'asambleas' || ctx().role === 'residente') refresh();
  }

  async function connect() {
    if (!ctx().live) return;
    if (channel) db().removeChannel(channel);
    await load();
    channel = db().channel(`asambleas-${ctx().profile?.id || 'sesion'}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'asambleas' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'preguntas_votacion' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'asistencia_asamblea' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'votos' }, () => load())
      .subscribe();
  }

  function majority(question) {
    const counts = question.options.map(option => ({ option, votes: Object.values(question.votes).filter(value => value === option).length,
      coefficient: Object.entries(question.votes).filter(([, value]) => value === option).reduce((sum, [key]) => sum + (question.voteCoefficients[key] || 0), 0) }));
    const highest = Math.max(0, ...counts.map(item => item.votes));
    const winners = counts.filter(item => item.votes === highest && highest > 0);
    return { counts, winner: winners.length === 1 ? winners[0] : null };
  }

  function overlay() {
    if (ctx().role !== 'residente') return '';
    const meeting = meetings.find(item => item.status === 'En Curso');
    if (!meeting) return '';
    const attended = residentHomes.filter(home => meeting.attendance[home.id]);
    const pendingHomes = residentHomes.filter(home => !meeting.attendance[home.id]);
    if (pendingHomes.length) {
      const controls = residentHomes.length ? pendingHomes.map(home => `<button class="btn-primary" data-assembly-attend="${esc(meeting.id)}" data-property="${esc(home.id)}">Registrar asistencia · ${esc(home.identificador)}</button>`).join('') : '<p>No hay un inmueble asociado como propietario. Contacta a administración para revisar tu perfil.</p>';
      return `<aside class="assembly-attendance-float" role="dialog" aria-label="Confirmar asistencia a la asamblea"><span class="eyebrow">ASAMBLEA EN CURSO</span><b>${esc(meeting.title)}</b><p>Registra asistencia para cada inmueble que representas. Tendrás un voto por cada inmueble.</p>${attended.length ? `<small>Asistencia registrada: ${attended.map(home => esc(home.identificador)).join(', ')}</small>` : ''}${controls}</aside>`;
    }
    const question = meeting.questions.find(item => item.status === 'Activa');
    if (!question) return '';
    const unit = attended.find(home => !Object.hasOwn(question.votes, home.id));
    if (!unit) return '';
    return `<div class="assembly-voting-overlay" role="dialog" aria-modal="true"><span class="eyebrow">Tu voto para ${esc(unit.identificador)}</span><h1>${esc(question.text)}</h1><div class="assembly-vote-choices">${question.options.map((option, index) => `<button class="assembly-vote-choice choice-${index % 3 + 1}" data-assembly-vote="${esc(question.id)}" data-property="${esc(unit.id)}" data-option="${esc(option)}">${esc(option)}</button>`).join('')}</div></div>`;
  }

  function page() {
    const admin = ctx().role === 'administrador';
    if (!ctx().live) return '<section class="panel">Inicia sesión para consultar las asambleas guardadas en Supabase.</section>';
    const baseMeetings = admin ? meetings.filter(meeting => allView || (historyView ? meeting.status === 'Finalizada' : meeting.status !== 'Finalizada')) : meetings;
    const years = [...new Set(baseMeetings.map(meeting => String(meeting.date || '').slice(0, 4)).filter(year => /^\d{4}$/.test(year)))].sort().reverse();
    const searchTerm = filters.search.trim().toLocaleLowerCase('es-CO');
    const visibleMeetings = baseMeetings.filter(meeting => {
      const searchable = `${meeting.title} ${meeting.date || ''} ${meeting.time || ''}`.toLocaleLowerCase('es-CO');
      return searchable.includes(searchTerm)
        && (filters.year === 'Todos' || String(meeting.date || '').startsWith(filters.year))
        && (filters.status === 'Todos' || meeting.status === filters.status);
    });
    const cardEntries = visibleMeetings.map(meeting => {
      const hasQuorum = meeting.totalHomes > 0 && meeting.attendanceCount >= meeting.quorumMinimum;
      const isResidentResult = !admin && meeting.status === 'Finalizada';
      const questions = meeting.questions.map(question => {
        const result = majority(question);
        const totalVotes = result.counts.reduce((sum, item) => sum + item.votes, 0);
        const outcome = totalVotes === 0 ? 'Sin votos' : !result.winner ? 'Empate: sin mayoría' : question.approvingOption ? (result.winner.option === question.approvingOption ? 'Aprobada' : 'No aprobada') : `Opción ganadora: ${result.winner.option}`;
        const breakdown = result.counts.map(item => `${item.option}: ${item.votes} voto(s) · ${formatPercent(item.coefficient)} coef.`).join(' · ');
        const mine = residentHomes.some(home => Object.hasOwn(question.votes, home.id));
        return `<div class="assembly-question"><b>${esc(question.text)}</b>${admin ? `<p class="muted">${esc(breakdown)}</p><p><b>Resultado:</b> ${esc(outcome)}</p><button class="text-link" data-assembly-question-state="${esc(question.id)}" data-next-state="${question.status === 'Activa' ? 'Cerrada' : 'Activa'}" ${meeting.status !== 'En Curso' && question.status !== 'Activa' || question.status !== 'Activa' && !hasQuorum ? 'disabled' : ''}>${question.status === 'Activa' ? 'Cerrar pregunta' : 'Activar pregunta'}</button>` : question.status === 'Activa' ? mine ? '<small class="vote-confirmation">Voto registrado</small>' : '<small class="muted">La votación está abierta para inmuebles con asistencia.</small>' : '<small class="muted">Pregunta cerrada.</small>'}</div>`;
      }).join('');
      const questionContent = isResidentResult
        ? meeting.questions.length ? '' : '<p class="muted">Aún no hay preguntas para esta asamblea.</p>'
        : questions || '<p class="muted">Aún no hay preguntas para esta asamblea.</p>';
      const showResults = isResidentResult && expandedResults.has(meeting.id);
      const resultDetails = showResults ? `<div class="assembly-results" aria-label="Resultados de ${esc(meeting.title)}">${meeting.questions.length ? meeting.questions.map(question => {
        const result = majority(question);
        const totalVotes = result.counts.reduce((sum, item) => sum + item.votes, 0);
        const outcome = totalVotes === 0 ? 'Sin votos' : !result.winner ? 'Empate: sin mayoría' : question.approvingOption ? (result.winner.option === question.approvingOption ? 'Aprobada' : 'No aprobada') : `Opción ganadora: ${result.winner.option}`;
        const breakdown = result.counts.map(item => `${item.option}: ${item.votes} voto(s) · ${formatPercent(item.coefficient)} coef.`).join(' · ');
        return `<div class="assembly-question"><b>${esc(question.text)}</b><p class="muted">${esc(breakdown || 'Sin resultados registrados.')}</p><p><b>Resultado:</b> ${esc(outcome)}</p></div>`;
      }).join('') : '<p class="muted">No se registraron preguntas para esta asamblea.</p>'}</div>` : '';
      const resultButton = isResidentResult ? `<button class="btn-secondary" type="button" data-assembly-results="${esc(meeting.id)}" aria-expanded="${showResults}">${showResults ? 'Ocultar resultados' : 'Ver resultados'}</button>` : '';
      return { meeting, html: `<article class="panel assembly-card"><div class="panel-title"><div><span class="eyebrow">${esc(meeting.status)}</span><h3>${esc(meeting.title)}</h3><p>${esc(meeting.date)} · ${esc(meeting.time)}</p></div>${admin ? '<button class="btn-secondary" data-action="question" data-assembly="' + esc(meeting.id) + '" ' + (meeting.status === 'Finalizada' ? 'disabled' : '') + '>＋ Pregunta</button>' : ''}</div>${admin ? `<div class="stats-grid">${window.portalStat?.('Inmuebles presentes', meeting.attendanceCount, `Quórum requerido: ${meeting.quorumMinimum} de ${meeting.totalHomes}`, '⌂') || ''}${window.portalStat?.('Coeficiente representado', formatPercent(meeting.presentCoefficient), hasQuorum ? 'Quórum alcanzado' : 'Quórum pendiente', '％') || ''}</div><div class="assembly-actions">${meeting.status === 'Planificada' ? `<button class="btn-primary" data-assembly-live-state="${esc(meeting.id)}" data-next-state="En Curso">Iniciar asamblea</button>` : meeting.status === 'En Curso' ? `<button class="btn-secondary" data-assembly-live-state="${esc(meeting.id)}" data-next-state="Finalizada">Finalizar asamblea</button>` : `<span class="muted">Proceso finalizado</span><button class="btn-secondary" data-print-assembly="${esc(meeting.id)}">Imprimir acta</button>`}</div>` : ''}${questionContent}${resultButton}${resultDetails}</article>` };
    });
    const adminCards = cardEntries.map(entry => entry.html).join('');
    const completedMeetings = cardEntries.filter(entry => entry.meeting.status === 'Finalizada');
    const upcomingMeetings = cardEntries.filter(entry => entry.meeting.status !== 'Finalizada');
    const residentCards = [
      completedMeetings.length ? `<section><div class="assembly-history-heading"><h2>Asambleas realizadas</h2><p>Consulta las reuniones finalizadas y sus resultados.</p></div><div class="assembly-list">${completedMeetings.map(entry => entry.html).join('')}</div></section>` : '',
      upcomingMeetings.length ? `<section><div class="assembly-history-heading"><h2>En curso y planificadas</h2></div><div class="assembly-list">${upcomingMeetings.map(entry => entry.html).join('')}</div></section>` : '',
    ].filter(Boolean).join('');
    const cards = admin ? adminCards : residentCards;
    const actions = admin && !historyView ? '<button class="btn-primary" data-action="assembly">＋ Crear asamblea</button>' : '';
    const tabs = admin ? `<div class="assembly-tabs" role="tablist" aria-label="Vistas de asambleas"><button class="assembly-tab ${allView ? 'active' : ''}" role="tab" aria-selected="${allView}" data-assembly-view="todas">Todas <span>${meetings.length}</span></button><button class="assembly-tab ${!allView && !historyView ? 'active' : ''}" role="tab" aria-selected="${!allView && !historyView}" data-assembly-view="actuales">Actuales y planificadas <span>${meetings.filter(meeting => meeting.status !== 'Finalizada').length}</span></button><button class="assembly-tab ${historyView && !allView ? 'active' : ''}" role="tab" aria-selected="${historyView && !allView}" data-assembly-view="historial">Historial <span>${meetings.filter(meeting => meeting.status === 'Finalizada').length}</span></button></div>` : '';
    const statusValues = [...new Set(baseMeetings.map(meeting => meeting.status).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
    const filterControls = baseMeetings.length ? `<div class="assembly-filters"><input class="inline-search" type="search" data-assembly-search value="${esc(filters.search)}" placeholder="⌕ Buscar asamblea o fecha…" aria-label="Buscar asambleas"><select class="inline-search" data-assembly-year aria-label="Filtrar por año"><option value="Todos">Todos los años</option>${years.map(year => `<option value="${year}" ${filters.year === year ? 'selected' : ''}>${year}</option>`).join('')}</select><select class="inline-search" data-assembly-status aria-label="Filtrar por estado"><option value="Todos">Todos los estados</option>${statusValues.map(status => `<option value="${esc(status)}" ${filters.status === status ? 'selected' : ''}>${esc(status)}</option>`).join('')}</select><span class="assembly-result-count">${visibleMeetings.length} de ${baseMeetings.length} asamblea(s)</span></div>` : '';
    const sectionTitle = admin && historyView ? '<div class="assembly-history-heading"><h2>Historial de asambleas</h2><p>Consulta asistencia, quórum y resultados de las asambleas finalizadas.</p></div>' : '';
    const empty = admin ? historyView && !allView ? '<section class="panel assembly-empty"><b>Aún no hay asambleas finalizadas</b><p>Cuando finalices una asamblea, sus resultados aparecerán aquí.</p></section>' : '<section class="panel assembly-empty"><b>Aún no hay asambleas registradas</b><p>Las asambleas creadas aparecerán en este listado.</p></section>' : '<section class="panel assembly-empty"><b>Aún no hay asambleas registradas</b><p>Las asambleas realizadas, en curso y planificadas aparecerán aquí.</p></section>';
    const filteredEmpty = baseMeetings.length && !visibleMeetings.length ? '<section class="panel assembly-empty"><b>No hay asambleas que coincidan</b><p>Cambia la búsqueda o los filtros para ver otros registros.</p></section>' : empty;
    return `${window.portalAdminHead?.('PARTICIPACIÓN COMUNITARIA', 'Asambleas', admin ? 'Gestiona asistencia, quórum y votaciones.' : 'Consulta las asambleas realizadas y sus resultados, y participa en la asamblea en curso.', actions) || ''}${error ? `<p class="auth-error">No se pudieron cargar las asambleas: ${esc(error)}</p>` : ''}${loading ? '<section class="panel">Cargando asambleas…</section>' : `${tabs}${sectionTitle}${filterControls}<div class="assembly-list">${cards || filteredEmpty}</div>`}`;
  }

  async function save(action, values, assemblyId) {
    if (action === 'assembly') {
      const { error: saveError } = await db().from('asambleas').insert({ titulo_asamblea: values.title, fecha: values.date, hora: values.time, estado: 'Planificada' });
      if (saveError) { window.portalAdminNotify?.(`No se pudo crear la asamblea: ${saveError.message}`); return false; }
    } else {
      const options = values.options.split('|').map(value => value.trim()).filter(Boolean);
      if (options.length < 2 || new Set(options.map(value => value.toLowerCase())).size !== options.length) { window.portalAdminNotify?.('Escribe al menos dos opciones distintas separadas por |.'); return false; }
      if (values.approvingOption && !options.includes(values.approvingOption)) { window.portalAdminNotify?.('La opción de aprobación debe coincidir con una de las opciones escritas.'); return false; }
      const { error: saveError } = await db().from('preguntas_votacion').insert({ asamblea_id: assemblyId, pregunta: values.question, opciones: options, opcion_aprobatoria: values.approvingOption || null, estado_pregunta: 'Cerrada' });
      if (saveError) { window.portalAdminNotify?.(`No se pudo guardar la pregunta: ${saveError.message}`); return false; }
    }
    document.getElementById('formDialog').close(); window.portalAdminNotify?.('Información guardada en Supabase.'); await load(); return true;
  }

  async function handle(event) {
    const attend = event.target.closest('[data-assembly-attend]');
    if (attend) {
      const { data, error: saveError } = await db().rpc('registrar_asistencia_asamblea', { p_asamblea_id: attend.dataset.assemblyAttend, p_inmueble_id: attend.dataset.property });
      if (saveError) window.portalAdminNotify?.(`No se pudo registrar la asistencia: ${saveError.message}`);
      else { window.portalAdminNotify?.('Asistencia registrada.'); await load(); }
      return true;
    }
    const vote = event.target.closest('[data-assembly-vote]');
    if (vote) {
      const originalLabel = vote.textContent;
      vote.disabled = true;
      vote.textContent = 'Registrando…';
      const { error: saveError } = await db().rpc('registrar_voto_asamblea', { p_pregunta_id: vote.dataset.assemblyVote, p_inmueble_id: vote.dataset.property, p_opcion: vote.dataset.option });
      if (saveError) { vote.disabled = false; vote.textContent = originalLabel; window.portalAdminNotify?.(`No se pudo registrar el voto: ${saveError.message}`); }
      else { window.portalAdminNotify?.('Voto registrado.'); await load(); }
      return true;
    }
    const stateButton = event.target.closest('[data-assembly-live-state]');
    if (stateButton && ctx().role === 'administrador') {
      if (stateButton.dataset.nextState === 'Finalizada') { historyView = true; allView = false; }
      const { error: saveError } = await db().rpc('cambiar_estado_asamblea', { p_asamblea_id: stateButton.dataset.assemblyLiveState, p_estado: stateButton.dataset.nextState });
      if (saveError) { if (stateButton.dataset.nextState === 'Finalizada') { historyView = false; allView = true; } window.portalAdminNotify?.(`No se pudo cambiar el estado: ${saveError.message}`); }
      else { window.portalAdminNotify?.('Estado de asamblea actualizado.'); await load(); }
      return true;
    }
    const questionButton = event.target.closest('[data-assembly-question-state]');
    if (questionButton && ctx().role === 'administrador') {
      const { error: saveError } = await db().rpc('cambiar_estado_pregunta_asamblea', { p_pregunta_id: questionButton.dataset.assemblyQuestionState, p_estado: questionButton.dataset.nextState });
      if (saveError) window.portalAdminNotify?.(`No se pudo cambiar la pregunta: ${saveError.message}`);
      else { window.portalAdminNotify?.(questionButton.dataset.nextState === 'Activa' ? 'Pregunta activada.' : 'Pregunta cerrada.'); await load(); }
      return true;
    }
    return false;
  }

  window.portalAssemblyPage = page;
  window.portalAssemblyOverlay = overlay;
  window.portalAssemblyConnect = connect;
  window.portalAssemblySave = save;
  window.portalAssemblyHandle = handle;
  window.portalAssemblyState = () => meetings;
  document.addEventListener('click', event => {
    const resultsButton = event.target.closest('[data-assembly-results]');
    if (resultsButton && ctx().role === 'residente') {
      const id = resultsButton.dataset.assemblyResults;
      if (expandedResults.has(id)) expandedResults.delete(id);
      else expandedResults.add(id);
      refresh();
      return;
    }
    const tab = event.target.closest('[data-assembly-view]');
    if (tab && ctx().role === 'administrador') {
      allView = tab.dataset.assemblyView === 'todas';
      historyView = tab.dataset.assemblyView === 'historial';
      filters.search = ''; filters.year = 'Todos'; filters.status = 'Todos';
      refresh();
      return;
    }
    const printButton = event.target.closest('[data-print-assembly]');
    if (printButton && ctx().role === 'administrador') printAssembly(printButton.dataset.printAssembly);
  });
  document.addEventListener('input', event => {
    if (!event.target.matches('[data-assembly-search]')) return;
    filters.search = event.target.value;
    refresh();
    const input = document.querySelector('[data-assembly-search]');
    input?.focus(); input?.setSelectionRange(filters.search.length, filters.search.length);
  });
  document.addEventListener('change', event => {
    if (event.target.matches('[data-assembly-year]')) filters.year = event.target.value;
    else if (event.target.matches('[data-assembly-status]')) filters.status = event.target.value;
    else return;
    refresh();
    document.querySelector(event.target.matches?.('[data-assembly-year]') ? '[data-assembly-year]' : '[data-assembly-status]')?.focus();
  });

  function printAssembly(assemblyId) {
    const meeting = meetings.find(item => item.id === assemblyId && item.status === 'Finalizada');
    if (!meeting) return;
    const printWindow = window.open('', '_blank');
    if (!printWindow) { window.portalAdminNotify?.('Permite las ventanas emergentes para imprimir el acta.'); return; }
    const quorumReached = meeting.totalHomes > 0 && meeting.attendanceCount >= meeting.quorumMinimum;
    const questionSections = meeting.questions.map((question, index) => {
      const result = majority(question);
      const totalVotes = result.counts.reduce((sum, item) => sum + item.votes, 0);
      const outcome = totalVotes === 0 ? 'Sin votos' : !result.winner ? 'Empate: sin mayoría' : question.approvingOption ? (result.winner.option === question.approvingOption ? 'Aprobada' : 'No aprobada') : `Opción ganadora: ${result.winner.option}`;
      const rows = result.counts.map(item => `<tr><td>${esc(item.option)}</td><td>${item.votes}</td><td>${formatPercent(item.coefficient)}</td></tr>`).join('');
      return `<section class="question"><h2>${index + 1}. ${esc(question.text)}</h2><table><thead><tr><th>Opción</th><th>Votos</th><th>Coeficiente representado</th></tr></thead><tbody>${rows}<tr class="total"><td>Total</td><td>${totalVotes}</td><td>${formatPercent(result.counts.reduce((sum, item) => sum + item.coefficient, 0))}</td></tr></tbody></table><p><b>Resultado:</b> ${esc(outcome)}</p></section>`;
    }).join('') || '<p>No se registraron preguntas.</p>';
    const homeList = meeting.attendedHomes.length ? `<ul>${meeting.attendedHomes.map(home => `<li>${esc(home.label)} — coeficiente ${formatPercent(home.coefficient)}</li>`).join('')}</ul>` : '<p>No hay detalle de inmuebles disponible.</p>';
    const dateLabel = meeting.date ? new Date(`${meeting.date}T00:00:00`).toLocaleDateString('es-CO', { year: 'numeric', month: 'long', day: 'numeric' }) : 'Sin fecha';
    printWindow.document.open();
    printWindow.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Acta - ${esc(meeting.title)}</title><style>body{font:14px Arial,sans-serif;color:#24382f;max-width:850px;margin:36px auto;padding:0 24px;line-height:1.5}h1{font-size:26px;margin:0 0 5px}h2{font-size:17px;margin:24px 0 8px}.subtitle,.muted{color:#66756d}.summary{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:20px 0}.summary div{border:1px solid #dce5df;border-radius:7px;padding:12px}.summary b{display:block;font-size:12px;color:#607168}.question{border-top:1px solid #dce5df;padding-top:5px;margin-top:24px}table{width:100%;border-collapse:collapse;margin-top:10px}th,td{text-align:left;border-bottom:1px solid #e4eae5;padding:9px}th{background:#f2f6f3;font-size:12px}.total{font-weight:bold}.signatures{display:grid;grid-template-columns:1fr 1fr;gap:50px;margin-top:70px}.signatures div{border-top:1px solid #53645a;padding-top:8px}.actions{margin:0 0 24px}.actions button{border:0;border-radius:6px;background:#24594b;color:#fff;padding:10px 15px;cursor:pointer}@media print{body{margin:0 auto;padding:0}.actions{display:none}.question{break-inside:avoid}.signatures{break-inside:avoid}}</style></head><body><div class="actions"><button onclick="window.print()">Imprimir o guardar como PDF</button></div><header><p class="muted">CONDOMINIO PALO ALTO · RESUMEN DE ASAMBLEA</p><h1>${esc(meeting.title)}</h1><p>${esc(dateLabel)} · ${esc(meeting.time || 'Sin hora')}</p></header><section class="summary"><div><b>Inmuebles presentes</b>${meeting.attendanceCount} de ${meeting.totalHomes}</div><div><b>Quórum requerido</b>${meeting.quorumMinimum} inmuebles · ${quorumReached ? 'Quórum alcanzado' : 'Quórum no alcanzado'}</div><div><b>Coeficiente representado</b>${formatPercent(meeting.presentCoefficient)}</div><div><b>Preguntas registradas</b>${meeting.questions.length}</div></section><section><h2>Asistencia por inmueble</h2>${homeList}</section><section><h2>Preguntas y resultados</h2>${questionSections}</section><div class="signatures"><div>Presidente de la asamblea</div><div>Secretario(a)</div></div><p class="muted">Resumen generado desde los registros guardados en Nexo.</p></body></html>`);
    printWindow.document.close();
    printWindow.focus();
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && ctx().live && window.portalCurrentPage?.() === 'asambleas') load(); });
})();
