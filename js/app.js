/**
 * Punto de entrada principal de la aplicación.
 * Coordina carga inicial de datos JSON, caché offline, PWA/Service Worker,
 * navegación y renderizado reactivo.
 */

import { renderAdminView } from './admin/admin-ui.js';
import {
  isAdminAuthenticated,
  setInitialDataset,
  setLocalProgressMap,
  setSyncState,
  setUiState,
  state,
  subscribe
} from './core/state.js';
import { showToast } from './core/ui-feedback.js';
import { escapeHtml, formatDateTime } from './core/utils.js';
import {
  abrirModalCondominio,
  abrirModalHermano,
  closeGeneralModal,
  saveActiveModal,
  toggleMaximizeModal
} from './modules/modals.js';
import { renderPublishersView } from './modules/publishers.js';
import {
  closeCondoOperativeModal,
  closeTowerOperativeModal,
  renderCondoOperativeModal,
  renderTerritoriesDirectory,
  renderTowerOperativeModal
} from './modules/territories.js';
import { loadRemoteJsonFiles } from './services/database.js';
import { loadCachedSnapshot, loadLocalProgress, saveCachedSnapshot } from './services/storage.js';

let waitingWorker = null;
let deferredInstallPrompt = null;

function renderSystemBanners() {
  const stack = document.getElementById('system-banners');
  if (!stack) return;

  const banners = [];

  if (state.sync.isOffline) {
    const fecha = state.sync.lastSyncedAt ? formatDateTime(state.sync.lastSyncedAt) : 'sin registro previo';
    banners.push(`
      <div class="system-banner system-banner--warning" role="status">
        <span>📡 Modo sin conexión: mostrando la última copia descargada (${escapeHtml(fecha)}). Los datos pueden estar desactualizados.</span>
      </div>
    `);
  } else if (state.sync.isStale) {
    const fecha = state.sync.lastSyncedAt ? formatDateTime(state.sync.lastSyncedAt) : 'desconocida';
    banners.push(`
      <div class="system-banner system-banner--warning" role="status">
        <span>⚠️ No se pudo verificar GitHub. Mostrando copia en caché del ${escapeHtml(fecha)}.</span>
        <button type="button" id="banner-retry-sync" class="btn btn--secondary btn--sm">Reintentar</button>
      </div>
    `);
  }

  if (state.sync.swUpdateWaiting) {
    banners.push(`
      <div class="system-banner system-banner--info" role="status">
        <span>✨ Hay una nueva versión de la aplicación disponible.</span>
        <button type="button" id="banner-apply-sw-update" class="btn btn--primary btn--sm">Actualizar ahora</button>
      </div>
    `);
  }

  if (isAdminAuthenticated() && state.sync.dirtyCount > 0) {
    banners.push(`
      <div class="system-banner system-banner--warning" role="status">
        <span>📝 Tienes ${state.sync.dirtyCount} cambio(s) en borrador sin publicar en GitHub.</span>
        <button type="button" id="banner-go-admin" class="btn btn--secondary btn--sm">Ir a publicar</button>
      </div>
    `);
  }

  stack.innerHTML = banners.join('');

  document.getElementById('banner-retry-sync')?.addEventListener('click', () => loadDataFromSource(true));
  document.getElementById('banner-go-admin')?.addEventListener('click', () => switchTab('admin'));
  document.getElementById('banner-apply-sw-update')?.addEventListener('click', () => {
    if (waitingWorker) {
      waitingWorker.postMessage({ type: 'SKIP_WAITING' });
    }
  });
}

function renderHeaderMeta() {
  const badgeEl = document.getElementById('header-congregation-badge');
  const titleEl = document.getElementById('header-app-title');
  const subEl = document.getElementById('header-app-subtitle');
  const syncLabelEl = document.getElementById('header-sync-status');

  if (badgeEl) {
    const cong = state.configuracion?.congregacion || 'Congregación';
    badgeEl.textContent = `${cong} • Predicación en Condominios`;
  }
  if (titleEl) {
    titleEl.textContent = state.configuracion?.tituloApp || 'GESTOR DE CONDOMINIOS';
  }
  if (subEl) {
    subEl.textContent = state.configuracion?.subtituloApp || 'Organización metódica de cartas y visitas en condominios y torres';
  }
  if (syncLabelEl) {
    if (state.sync.isOffline) {
      syncLabelEl.textContent = 'Sin conexión';
    } else if (state.sync.lastSyncedAt) {
      syncLabelEl.textContent = `Actualizado: ${formatDateTime(state.sync.lastSyncedAt)}`;
    } else {
      syncLabelEl.textContent = 'Listo';
    }
  }
}

function renderTabsVisibility() {
  const tabs = ['territorios', 'hermanos', 'admin'];
  tabs.forEach(tab => {
    const panel = document.getElementById(`tab-${tab}`);
    const btn = document.getElementById(`btn-tab-${tab}`);
    const active = state.ui.activeTab === tab;
    if (panel) panel.classList.toggle('hidden', !active);
    if (btn) {
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    }
  });
}

function renderAll() {
  renderHeaderMeta();
  renderSystemBanners();
  renderTabsVisibility();
  renderTerritoriesDirectory();
  renderPublishersView();
  renderAdminView();

  if (state.ui.condoOperativoId) {
    renderCondoOperativeModal();
  }
  if (state.ui.torreOperativaId && state.ui.condoOperativoId) {
    renderTowerOperativeModal();
  }
}

function switchTab(tabName) {
  setUiState({ activeTab: tabName });
}

async function loadDataFromSource(manualRefresh = false) {
  const refreshBtn = document.getElementById('btn-refresh-data');
  if (refreshBtn) {
    refreshBtn.disabled = true;
    refreshBtn.textContent = 'Actualizando...';
  }

  try {
    const remote = await loadRemoteJsonFiles();
    const syncedAt = remote.remoteUpdatedAt || new Date().toISOString();

    setInitialDataset(
      {
        condominios: remote.condominios,
        hermanos: remote.hermanos,
        configuracion: remote.configuracion
      },
      {
        source: 'remote',
        lastSyncedAt: syncedAt,
        isOffline: !navigator.onLine,
        isStale: false
      }
    );

    saveCachedSnapshot({
      condominios: state.condominios,
      hermanos: state.hermanos,
      configuracion: state.configuracion,
      syncedAt
    });

    if (manualRefresh) {
      showToast('Datos actualizados desde el servidor.', 'success');
    }
  } catch (err) {
    console.warn('Fallo al cargar JSON remotos, intentando caché local:', err);
    const cached = loadCachedSnapshot();
    if (cached) {
      setInitialDataset(
        {
          condominios: cached.condominios || [],
          hermanos: cached.hermanos || [],
          configuracion: cached.configuracion || null
        },
        {
          source: 'cache',
          lastSyncedAt: cached.syncedAt || null,
          isOffline: !navigator.onLine,
          isStale: true
        }
      );
      if (manualRefresh) {
        showToast('No se pudo conectar. Se muestra la copia guardada en este dispositivo.', 'warning');
      }
    } else {
      setSyncState({
        source: 'cache',
        isOffline: !navigator.onLine,
        isStale: true
      });
      if (manualRefresh) {
        showToast('No hay conexión ni copia en caché disponible.', 'error');
      }
    }
  } finally {
    if (refreshBtn) {
      refreshBtn.disabled = false;
      refreshBtn.textContent = '↻ Actualizar';
    }
  }
}

function setupServiceWorkerAndInstall() {
  const installBtn = document.getElementById('btn-install-pwa');

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredInstallPrompt = e;
    if (installBtn) installBtn.classList.remove('hidden');
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    if (installBtn) installBtn.classList.add('hidden');
    showToast('Aplicación instalada correctamente.', 'success');
  });

  installBtn?.addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    installBtn.classList.add('hidden');
  });

  if (!('serviceWorker' in navigator)) return;

  navigator.serviceWorker
    .register('./sw.js')
    .then(registration => {
      if (registration.waiting) {
        waitingWorker = registration.waiting;
        setSyncState({ swUpdateWaiting: true });
      }

      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        if (!newWorker) return;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            waitingWorker = newWorker;
            setSyncState({ swUpdateWaiting: true });
          }
        });
      });
    })
    .catch(err => {
      console.warn('Service Worker no registrado:', err);
    });

  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });
}

function bindEvents() {
  document.getElementById('btn-tab-territorios')?.addEventListener('click', () => switchTab('territorios'));
  document.getElementById('btn-tab-hermanos')?.addEventListener('click', () => switchTab('hermanos'));
  document.getElementById('btn-tab-admin')?.addEventListener('click', () => switchTab('admin'));

  document.getElementById('btn-refresh-data')?.addEventListener('click', () => loadDataFromSource(true));
  document.getElementById('btn-nuevo-condominio')?.addEventListener('click', () => abrirModalCondominio());
  document.getElementById('btn-agregar-hermano')?.addEventListener('click', () => abrirModalHermano());

  document.getElementById('search-condos')?.addEventListener('input', e => {
    setUiState({ searchCondo: e.target.value });
  });
  document.getElementById('search-hermanos')?.addEventListener('input', e => {
    setUiState({ searchHermano: e.target.value });
  });

  // Controles de modales
  document.getElementById('modal-btn-cancelar')?.addEventListener('click', closeGeneralModal);
  document.getElementById('modal-btn-guardar')?.addEventListener('click', saveActiveModal);
  document.getElementById('modal-body')?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox' && e.target.type !== 'radio') {
      const btnSave = document.getElementById('modal-btn-guardar');
      if (btnSave && !btnSave.classList.contains('hidden')) {
        e.preventDefault();
        saveActiveModal();
      }
    }
  });
  document.getElementById('modal')?.addEventListener('click', e => {
    if (e.target.id === 'modal') closeGeneralModal();
  });

  document.getElementById('condo-modal-max')?.addEventListener('click', () => toggleMaximizeModal('condo-modal-box'));
  document.getElementById('condo-modal-close')?.addEventListener('click', closeCondoOperativeModal);
  document.getElementById('modal-condo-operativo')?.addEventListener('click', e => {
    if (e.target.id === 'modal-condo-operativo') closeCondoOperativeModal();
  });

  document.getElementById('torre-modal-max')?.addEventListener('click', () => toggleMaximizeModal('torre-modal-box'));
  document.getElementById('torre-modal-close')?.addEventListener('click', closeTowerOperativeModal);
  document.getElementById('modal-torre-operativo')?.addEventListener('click', e => {
    if (e.target.id === 'modal-torre-operativo') closeTowerOperativeModal();
  });

  // Tecla Escape cierra el modal de capa superior visible
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (!document.getElementById('modal-confirm')?.classList.contains('hidden')) return;
    if (!document.getElementById('modal')?.classList.contains('hidden')) {
      closeGeneralModal();
      return;
    }
    if (!document.getElementById('modal-torre-operativo')?.classList.contains('hidden')) {
      closeTowerOperativeModal();
      return;
    }
    if (!document.getElementById('modal-condo-operativo')?.classList.contains('hidden')) {
      closeCondoOperativeModal();
    }
  });

  // Monitoreo de conectividad
  window.addEventListener('online', () => {
    setSyncState({ isOffline: false });
    if (!isAdminAuthenticated() || state.sync.dirtyCount === 0) {
      loadDataFromSource(false);
    }
  });
  window.addEventListener('offline', () => {
    setSyncState({ isOffline: true });
  });

  // Advertencia si el administrador intenta cerrar la pestaña con cambios sin publicar
  window.addEventListener('beforeunload', e => {
    if (isAdminAuthenticated() && state.sync.dirtyCount > 0) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
}

async function init() {
  setLocalProgressMap(loadLocalProgress());
  subscribe(renderAll);
  bindEvents();
  setupServiceWorkerAndInstall();
  renderAll();
  await loadDataFromSource(false);
}

init();

