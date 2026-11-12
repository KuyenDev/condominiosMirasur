/**
 * Sistema accesible de notificaciones (Toasts) y diálogo de confirmación
 * para reemplazar alert() y confirm() nativos del navegador.
 */

let lastFocusedElement = null;

export function showToast(message, type = 'info', duration = 3800) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.setAttribute('role', 'status');

  const text = document.createElement('span');
  text.textContent = message;

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'btn btn--sm btn--tower-ghost';
  closeBtn.setAttribute('aria-label', 'Cerrar notificación');
  closeBtn.textContent = '✕';
  closeBtn.style.minHeight = '28px';
  closeBtn.style.padding = '0.15rem 0.5rem';

  const removeToast = () => {
    if (toast.parentNode) toast.remove();
  };

  closeBtn.addEventListener('click', removeToast);
  toast.appendChild(text);
  toast.appendChild(closeBtn);
  container.appendChild(toast);

  if (duration > 0) {
    window.setTimeout(removeToast, duration);
  }
}

/**
 * Muestra un modal de confirmación accesible y devuelve una Promesa<boolean>.
 */
export function confirmAction({
  title = 'Confirmar acción',
  message = '¿Estás seguro?',
  confirmText = 'Confirmar',
  cancelText = 'Cancelar',
  danger = false
} = {}) {
  return new Promise(resolve => {
    const backdrop = document.getElementById('modal-confirm');
    const titleEl = document.getElementById('confirm-title');
    const messageEl = document.getElementById('confirm-message');
    const btnAccept = document.getElementById('confirm-btn-accept');
    const btnCancel = document.getElementById('confirm-btn-cancel');

    if (!backdrop || !titleEl || !messageEl || !btnAccept || !btnCancel) {
      resolve(window.confirm(message));
      return;
    }

    lastFocusedElement = document.activeElement;
    titleEl.textContent = title;
    messageEl.textContent = message;
    btnAccept.textContent = confirmText;
    btnCancel.textContent = cancelText;
    btnAccept.className = danger ? 'btn btn--danger' : 'btn btn--primary';

    const cleanup = result => {
      backdrop.classList.add('hidden');
      document.removeEventListener('keydown', onKeyDown);
      btnAccept.removeEventListener('click', onAccept);
      btnCancel.removeEventListener('click', onCancel);
      backdrop.removeEventListener('click', onBackdropClick);
      syncBodyScrollLock();
      if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
        lastFocusedElement.focus();
      }
      resolve(result);
    };

    const onAccept = () => cleanup(true);
    const onCancel = () => cleanup(false);
    const onBackdropClick = e => {
      if (e.target === backdrop) cleanup(false);
    };
    const onKeyDown = e => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        cleanup(false);
      }
    };

    btnAccept.addEventListener('click', onAccept);
    btnCancel.addEventListener('click', onCancel);
    backdrop.addEventListener('click', onBackdropClick);
    document.addEventListener('keydown', onKeyDown);

    backdrop.classList.remove('hidden');
    syncBodyScrollLock();
    btnCancel.focus();
  });
}

export function syncBodyScrollLock() {
  const openModal = document.querySelector('.modal-backdrop:not(.hidden)');
  if (openModal) {
    document.body.classList.add('modal-open');
  } else {
    document.body.classList.remove('modal-open');
  }
}

