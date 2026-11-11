import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const projectUrl = Deno.env.get('SUPABASE_URL')!;
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const allowedOrigins = (Deno.env.get('PORTAL_ALLOWED_ORIGINS') || 'http://localhost:3000')
  .split(',').map((origin) => origin.trim()).filter(Boolean);

function corsHeaders(origin: string | null) {
  const allowed = origin && allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

Deno.serve(async (request) => {
  const origin = request.headers.get('origin');
  const headers = corsHeaders(origin);
  if (request.method === 'OPTIONS') return new Response('ok', { headers });
  if (request.method !== 'POST') return Response.json({ error: 'Método no permitido.' }, { status: 405, headers });
  if (!origin || !allowedOrigins.includes(origin)) return Response.json({ error: 'Origen no autorizado.' }, { status: 403, headers });

  const jwt = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!jwt) return Response.json({ error: 'Inicia sesión como administrador.' }, { status: 401, headers });

  const authClient = createClient(projectUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: { user: caller }, error: authError } = await authClient.auth.getUser(jwt);
  if (authError || !caller) return Response.json({ error: 'La sesión no es válida.' }, { status: 401, headers });

  const adminClient = createClient(projectUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: callerProfile, error: profileError } = await adminClient
    .from('usuarios').select('rol, activo').eq('id', caller.id).maybeSingle();
  if (profileError || callerProfile?.rol !== 'Administrador' || callerProfile.activo === false) {
    return Response.json({ error: 'Solo un administrador activo puede invitar usuarios.' }, { status: 403, headers });
  }

  try {
    const body = await request.json();
    const nombre = String(body.nombre_completo || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    const telefono = String(body.telefono || '').trim() || null;
    const rol = String(body.rol || '');
    const inmuebleIds = Array.isArray(body.inmueble_ids)
      ? [...new Set(body.inmueble_ids.map((id: unknown) => String(id)))]
      : body.inmueble_id ? [String(body.inmueble_id)] : [];
    const tipoCodigos = Array.isArray(body.tipo_residente_codigos)
      ? [...new Set(body.tipo_residente_codigos.map((code: unknown) => String(code)))]
      : [];
    const redirectTo = `${origin}/`;
    if (!nombre || !email || !email.includes('@')) throw new Error('Escribe un nombre y un correo válido.');
    if (!['Residente', 'Guardia', 'Administrador'].includes(rol)) throw new Error('El rol seleccionado no es válido.');
    if (rol === 'Residente' && (!inmuebleIds.length || !tipoCodigos.length)) throw new Error('Selecciona uno o más inmuebles y al menos un tipo de residente.');

    let tiposResidente: { codigo: string; nombre: string }[] = [];
    if (rol === 'Residente') {
      const { data: homes, error: homeError } = await adminClient.from('inmuebles').select('id').in('id', inmuebleIds);
      if (homeError || !homes || homes.length !== inmuebleIds.length) throw new Error('Uno de los inmuebles seleccionados no existe.');
      const { data: types, error: typeError } = await adminClient.from('tipos_residente')
        .select('codigo, nombre').in('codigo', tipoCodigos).eq('activo', true);
      if (typeError || !types || types.length !== tipoCodigos.length) throw new Error('Uno de los tipos de residente no existe o está inactivo.');
      tiposResidente = types;
    }

    const { data: invited, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, { redirectTo });
    if (inviteError || !invited.user) throw new Error(inviteError?.message || 'No se pudo enviar la invitación.');
    const userId = invited.user.id;

    const { error: insertError } = await adminClient.from('usuarios').insert({
      id: userId,
      nombre_completo: nombre,
      email,
      telefono,
      rol,
      tipo_residente: tiposResidente.length ? tiposResidente[0].nombre : null,
      inmueble_id: rol === 'Residente' ? inmuebleIds[0] : null,
      activo: true,
    });
    if (insertError) {
      await adminClient.auth.admin.deleteUser(userId);
      throw new Error(`La cuenta se invitó, pero no se pudo crear su perfil: ${insertError.message}`);
    }

    if (rol === 'Residente') {
      const { error: relationError } = await adminClient.from('inmueble_usuarios').insert(
        inmuebleIds.flatMap((inmueble_id: string) => tiposResidente.map((type) => ({ inmueble_id, usuario_id: userId, tipo_residente_codigo: type.codigo }))),
      );
      if (relationError) {
        await adminClient.from('usuarios').delete().eq('id', userId);
        await adminClient.auth.admin.deleteUser(userId);
        throw new Error(`No se pudo asociar el residente al inmueble: ${relationError.message}`);
      }
    }

    return Response.json({ id: userId, message: 'Invitación enviada y perfil creado.' }, { status: 201, headers });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'No se pudo crear el usuario.' }, { status: 400, headers });
  }
});
