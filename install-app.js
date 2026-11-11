const installButtons = [...document.querySelectorAll('[data-install-app]')];
const installHelp = document.getElementById('installHelpDialog');
const installHelpText = document.getElementById('installHelpText');
const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
let installPrompt = null;

function isInstalled() {
  return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}

function updateInstallButtons() {
  for (const button of installButtons) button.hidden = isInstalled();
}

function showInstallHelp() {
  if (isIos) {
    installHelpText.textContent = 'En Safari, toca el botón Compartir y luego elige “Añadir a pantalla de inicio”.';
  } else if (/android/i.test(navigator.userAgent)) {
    installHelpText.textContent = 'Abre el menú del navegador (⋮) y elige “Instalar app” o “Añadir a pantalla de inicio”.';
  } else {
    installHelpText.textContent = 'Abre el menú de tu navegador y busca “Instalar Nexo” o “Instalar esta página como aplicación”.';
  }
  installHelp.showModal();
}

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  installPrompt = event;
});

window.addEventListener('appinstalled', () => {
  installPrompt = null;
  updateInstallButtons();
});

for (const button of installButtons) {
  button.addEventListener('click', async () => {
    if (!installPrompt) {
      showInstallHelp();
      return;
    }

    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    updateInstallButtons();
  });
}

for (const button of document.querySelectorAll('[data-close-install-help]')) {
  button.addEventListener('click', () => installHelp.close());
}

updateInstallButtons();
