import { supabase } from './supabase-client.example.js';
window.portalSupabase = supabase;

const screen = document.getElementById('authScreen');
const shell = document.getElementById('app-shell');
const loginForm = document.getElementById('loginForm');
const requestPasswordForm = document.getElementById('requestPasswordForm');
const setPasswordForm = document.getElementById('setPasswordForm');
const emailInput = document.getElementById('loginEmail');
const passwordInput = document.getElementById('loginPassword');
const errorBox = document.getElementById('authError');
const submitButton = document.getElementById('loginButton');
const recoveryEmail = document.getElementById('recoveryEmail');
const recoveryError = document.getElementById('recoveryError');
const recoverySuccess = document.getElementById('recoverySuccess');
const recoveryButton = document.getElementById('recoveryButton');
const newPassword = document.getElementById('newPassword');
const confirmPassword = document.getElementById('confirmPassword');
const passwordError = document.getElementById('passwordError');
const setPasswordButton = document.getElementById('setPasswordButton');
const initialLinkType = new URLSearchParams(location.hash.slice(1)).get('type')
  || new URLSearchParams(location.search).get('type');
let passwordSetupMode = ['invite', 'recovery'].includes(initialLinkType);
let openingSession = false;
const pendingPasswordEmailKey = 'portalPasswordSetupEmail';

function isPasswordSetupSession(session) {
  const pendingEmail = localStorage.getItem(pendingPasswordEmailKey)?.toLowerCase();
  return passwordSetupMode || (!!pendingEmail && pendingEmail === session?.user?.email?.toLowerCase());
}

document.getElementById('roleDialog')?.remove();

function showForm(activeForm) {
  screen.hidden = false;
  shell.hidden = true;
  for (const form of [loginForm, requestPasswordForm, setPasswordForm]) {
    form.hidden = form !== activeForm;
  }
}

function showLogin(message = '') {
  showForm(loginForm);
  errorBox.textContent = message;
  errorBox.hidden = !message;
  passwordInput.value = '';
}

function showPasswordForm(message = '') {
  showForm(setPasswordForm);
  passwordError.textContent = message;
  passwordError.hidden = !message;
}

async function openPortal(session) {
  if (!session?.user || openingSession) return;
  openingSession = true;
  submitButton.disabled = true;
  try {
    const { data: profile, error } = await supabase
      .from('usuarios')
      .select('id, nombre_completo, email, telefono, rol, tipo_residente, inmueble_id, activo')
      .eq('id', session.user.id)
      .single();
    if (error) throw error;
    if (profile.activo === false) {
      await supabase.auth.signOut();
      showLogin('Esta cuenta está inactiva. Contacta a administración para recuperar el acceso.');
      return;
    }
    window.activatePortalProfile(profile);
    screen.hidden = true;
    shell.hidden = false;
    errorBox.hidden = true;
  } catch (error) {
    const message = error?.code === 'PGRST116'
      ? 'La cuenta inició sesión, pero no tiene perfil en el directorio del conjunto. Contacta a administración.'
      : `No se pudo cargar tu perfil. Revisa que tenga un rol válido y permisos RLS. ${error?.message || ''}`;
    showLogin(message);
    await supabase.auth.signOut();
  } finally {
    openingSession = false;
    submitButton.disabled = false;
  }
}

loginForm.addEventListener('submit', async event => {
  event.preventDefault();
  errorBox.hidden = true;
  submitButton.disabled = true;
  submitButton.textContent = 'Ingresando…';
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: emailInput.value.trim(),
      password: passwordInput.value,
    });
    if (error) throw error;
    await openPortal(data.session);
  } catch (error) {
    showLogin(error?.message || 'No se pudo iniciar sesión. Verifica tus datos.');
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = 'Ingresar';
  }
});

document.getElementById('requestPasswordButton').addEventListener('click', () => {
  recoveryEmail.value = emailInput.value.trim();
  recoveryError.hidden = true;
  recoverySuccess.hidden = true;
  showForm(requestPasswordForm);
});

document.getElementById('backToLoginButton').addEventListener('click', () => showLogin());
document.getElementById('backFromPasswordButton').addEventListener('click', async () => {
  await supabase.auth.signOut();
  passwordSetupMode = false;
  localStorage.removeItem(pendingPasswordEmailKey);
  history.replaceState(null, document.title, location.pathname);
  showLogin();
});

requestPasswordForm.addEventListener('submit', async event => {
  event.preventDefault();
  recoveryError.hidden = true;
  recoverySuccess.hidden = true;
  recoveryButton.disabled = true;
  recoveryButton.textContent = 'Enviando…';
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(recoveryEmail.value.trim(), {
      redirectTo: new URL('./', window.location.href).href,
    });
    if (error) throw error;
    localStorage.setItem(pendingPasswordEmailKey, recoveryEmail.value.trim().toLowerCase());
    recoverySuccess.textContent = 'Si el correo corresponde a una cuenta, recibirás un enlace para crear la contraseña. Revisa también la carpeta de spam.';
    recoverySuccess.hidden = false;
  } catch (error) {
    recoveryError.textContent = error?.message || 'No se pudo enviar el enlace. Inténtalo de nuevo.';
    recoveryError.hidden = false;
  } finally {
    recoveryButton.disabled = false;
    recoveryButton.textContent = 'Enviar enlace';
  }
});

setPasswordForm.addEventListener('submit', async event => {
  event.preventDefault();
  passwordError.hidden = true;
  if (newPassword.value.length < 8) {
    showPasswordForm('La contraseña debe tener al menos 8 caracteres.');
    return;
  }
  if (newPassword.value !== confirmPassword.value) {
    showPasswordForm('Las contraseñas no coinciden.');
    return;
  }

  setPasswordButton.disabled = true;
  setPasswordButton.textContent = 'Guardando…';
  try {
    const { error } = await supabase.auth.updateUser({ password: newPassword.value });
    if (error) throw error;
    passwordSetupMode = false;
    localStorage.removeItem(pendingPasswordEmailKey);
    history.replaceState(null, document.title, `${location.pathname}${location.search.replace(/([?&])type=(invite|recovery)(&|$)/, (_match, prefix, _type, suffix) => suffix === '&' ? prefix : '').replace(/[?&]$/, '')}`);
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) throw sessionError;
    newPassword.value = '';
    confirmPassword.value = '';
    await openPortal(session);
  } catch (error) {
    showPasswordForm(error?.message || 'No se pudo guardar la contraseña. Solicita un enlace nuevo e inténtalo otra vez.');
  } finally {
    setPasswordButton.disabled = false;
    setPasswordButton.textContent = 'Guardar contraseña';
  }
});

async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) showLogin(error.message);
}
document.getElementById('profileButton').onclick = signOut;
document.getElementById('topAvatar').onclick = signOut;

supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_OUT' && !shell.hidden) showLogin();
  if (event === 'PASSWORD_RECOVERY') {
    passwordSetupMode = true;
    showPasswordForm();
  }
  if (event === 'SIGNED_IN') {
    setTimeout(() => {
      if (isPasswordSetupSession(session)) {
        passwordSetupMode = true;
        showPasswordForm();
      } else {
        openPortal(session);
      }
    }, 0);
  }
});

showLogin();
const { data: { session }, error } = await supabase.auth.getSession();
if (error) showLogin(`No se pudo consultar la sesión: ${error.message}`);
else if (session && isPasswordSetupSession(session)) {
  passwordSetupMode = true;
  showPasswordForm();
}
else if (session) await openPortal(session);
