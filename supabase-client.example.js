// Cliente usado por auth-ui.js para iniciar sesión y leer el perfil autenticado.
// Requiere @supabase/supabase-js v2 instalado o servido como módulo en el navegador.
// Solo usar la URL y la publishable/anon key; nunca incluir service_role/secret keys.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = 'https://trsfdydsazavqzrjehsn.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable__f63hA0LxKJYx3vvuaMySQ_MrvfrIhz';

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export async function iniciarSesion(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;

  const { data: profile, error: profileError } = await supabase
    .from('usuarios')
    .select('id, nombre_completo, email, rol, tipo_residente, inmueble_id')
    .eq('id', data.user.id)
    .single();
  if (profileError) throw profileError;

  return { user: data.user, profile };
}

export async function cerrarSesion() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}
