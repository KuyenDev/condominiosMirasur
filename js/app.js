/**
 * Punto de entrada principal de la aplicación.
 * Coordina puerta de acceso (publicador/admin), carga inicial de datos JSON,
 * caché offline, PWA/Service Worker, navegación y renderizado reactivo.
 */

import { bindAdminLoginEvents, buildAdminLoginHtml, renderAdminView } from './admin/admin-ui.js';
import { logoutFullSession, refreshPendingReports } from './admin/admin.js';
import {
  getCurrentPublisher,
  getVisiblePendingReports,
  isAdminAuthenticated,
  isPublisherAuthenticated,
  isSessionAuthenticated,
  setInitialDataset,
  setLocalPendingReportsState,
  setLocalProgressMap,
  setPublisherSession,
  setSyncState,
  setUiState,
  state,
  subscribe,
  validatePublisherSessionAgainstDataset
} from './core/state.js';
import { showToast } from './core/ui-feedback.js';
import { escapeHtml, findMatchingPublisher, formatDateTime } from './core/utils.js';
import {
  abrirModalCondominio,
  abrirModalHermano,
  closeGeneralModal,
  saveActiveModal,
  toggleMaximizeModal
} from './modules/modals.js';
import { renderMyAssignmentsView } from './modules/my-assignments.js';
import { renderPublishersView } from './modules/publishers.js';
import {
  closeCondoOperativeModal,
  closeTowerOperativeModal,
  renderCondoOperativeModal,
  renderTerritoriesDirectory,
  renderTowerOperativeModal
} from './modules/territories.js';
import { loadRemoteJsonFiles } from './services/database.js';
import {
  clearPublisherSessionStorage,
  loadCachedSnapshot,
  loadLocalPendingReports,
  loadLocalProgress,
  loadPublisherSessionStorage,
  saveCachedSnapshot,
  savePublisherSessionStorage
} from './services/storage.js';

let waitingWorker = null;
let deferredInstallPrompt = null;
let lastGateRenderKey = '';

function renderAuthGate() {
  const gateEl = document.getElementById('auth-gate');
  const shellEl = document.getElementById('app-shell');
  if (!gateEl || !shellEl) return;

  if (isSessionAuthenticated()) {
    lastGateRenderKey = '';
    gateEl.classList.add('hidden');
    gateEl.innerHTML = '';
    shellEl.classList.remove('hidden');
    return;
  }

  shellEl.classList.add('hidden');
  gateEl.classList.remove('hidden');

  const gateMode = state.ui.gateMode === 'admin' ? 'admin' : 'publisher';
  const authEndpoint = (state.configuracion?.authEndpoint || '').trim();
  const cong = state.configuracion?.congregacion || 'Congregación';
  const tituloApp = state.configuracion?.tituloApp || 'GESTOR DE CONDOMINIOS';
  const subtituloApp = state.configuracion?.subtituloApp || 'Organización metódica de cartas y visitas en condominios y torres';

  const renderKey = [
    state.ui.dataReady ? '1' : '0',
    gateMode,
    state.ui.gateError || '',
    state.hermanos.length,
    authEndpoint,
    tituloApp,
    cong
  ].join('|');

  if (renderKey === lastGateRenderKey) return;
  lastGateRenderKey = renderKey;

  const prevPubName = document.getElementById('gate-pub-name')?.value || '';
  const prevRememberEl = document.getElementById('gate-remember');
  const prevRemember = prevRememberEl ? prevRememberEl.checked : false;

  let bodyHtml = '';
  if (!state.ui.dataReady) {
    bodyHtml = `
      <div class="auth-gate__loading">
        <p>Cargando lista de publicadores y territorios...</p>
      </div>
    `;
  } else if (gateMode === 'admin') {
    bodyHtml = `
      ${buildAdminLoginHtml({ prefix: 'gate', title: '🔐 Ingreso de Administrador', compact: true })}
      <div class="auth-gate__switch">
        <button type="button" id="gate-to-publisher" class="btn btn--soft btn--sm">← Volver a ingreso de publicadores</button>
      </div>
    `;
  } else {
    const emptyListNotice = state.hermanos.length === 0
      ? `<div class="notice-box notice-box--warning">
          No hay publicadores cargados en la lista todavía. Si eres administrador, ingresa abajo para cargar o crear publicadores.
        </div>`
      : '';

    bodyHtml = `
      <form id="gate-publisher-form" class="auth-gate__form">
        <div>
          <h2 class="section-title" style="font-size:1.1rem;">Ingreso de Publicadores</h2>
          <p class="section-desc">
            Escribe tu <strong>nombre y apellido</strong> tal como figura en los territorios asignados para ver tu progreso.
          </p>
        </div>

        ${emptyListNotice}

        <div class="field">
          <label class="field__label" for="gate-pub-name">Nombre y apellido *</label>
          <input type="text" id="gate-pub-name" class="input" autocomplete="name" placeholder="Ej. Rodrigo Luna" value="${escapeHtml(prevPubName)}" required>
        </div>

        <label class="checkbox-inline" for="gate-remember">
          <input type="checkbox" id="gate-remember" ${prevRemember ? 'checked' : ''}>
          <span>Recordar en este dispositivo</span>
        </label>

        ${state.ui.gateError ? `
          <div id="gate-error" class="notice-box notice-box--danger" role="alert">${escapeHtml(state.ui.gateError)}</div>
        ` : ''}

        <div class="admin-actions-row">
          <button type="submit" id="gate-pub-submit" class="btn btn--primary" ${state.hermanos.length === 0 ? 'disabled' : ''}>Ingresar</button>
          <button type="button" id="gate-refresh-list" class="btn btn--secondary">↻ Actualizar lista</button>
        </div>
      </form>

      <div class="auth-gate__switch">
        <button type="button" id="gate-to-admin" class="btn btn--soft btn--sm">🔐 ¿Eres administrador? Ingresar</button>
      </div>
    `;
  }

  gateEl.innerHTML = `
    <div class="auth-gate__card">
      <div class="auth-gate__brand">
        <span class="app-badge">
          <span class="app-badge__dot" aria-hidden="true"></span>
          <span>${escapeHtml(cong)} • Predicación en Condominios</span>
        </span>
        <h1 class="auth-gate__title">${escapeHtml(tituloApp)}</h1>
        <p class="auth-gate__subtitle">${escapeHtml(subtituloApp)}</p>
      </div>
      ${bodyHtml}
    </div>
  `;

  if (!state.ui.dataReady) return;

  if (gateMode === 'admin') {
    bindAdminLoginEvents({
      prefix: 'gate',
      onSuccess: () => {
        refreshPendingReports({ notifyNew: false });
      }
    });
    document.getElementById('gate-to-publisher')?.addEventListener('click', () => {
      setUiState({ gateMode: 'publisher', gateError: '' });
    });
  } else {
    document.getElementById('gate-publisher-form')?.addEventListener('submit', e => {
      e.preventDefault();
      const inputEl = document.getElementById('gate-pub-name');
      const rememberEl = document.getElementById('gate-remember');
      const typedName = (inputEl?.value || '').trim();
      const remembered = Boolean(rememberEl?.checked);

      if (!typedName) {
        setUiState({ gateError: 'Ingresa tu nombre y apellido para continuar.' });
        return;
      }

      const matched = findMatchingPublisher(state.hermanos, typedName);
      if (!matched) {
        setUiState({
          gateError: 'Tu nombre y apellido no coinciden con ningún publicador de la lista asignable. Verifica cómo fuiste registrado o consulta con el administrador.'
        });
        document.getElementById('gate-pub-name')?.focus();
        return;
      }

      savePublisherSessionStorage({
        hermanoId: matched.id,
        nombre: matched.nombre,
        remembered
      });
      setPublisherSession(
        {
          authenticated: true,
          hermanoId: matched.id,
          nombre: matched.nombre,
          remembered
        },
        { activeTab: 'mis-asignaciones' }
      );
      showToast(`Bienvenido(a), ${matched.nombre}.`, 'success');
      refreshPendingReports({ notifyNew: false });
    });

    document.getElementById('gate-refresh-list')?.addEventListener('click', () => {
      loadDataFromSource(true);
    });

    document.getElementById('gate-to-admin')?.addEventListener('click', () => {
      setUiState({ gateMode: 'admin', gateError: '' });
    });
  }
}

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

  const pendingReviews = isAdminAuthenticated() ? getVisiblePendingReports() : [];
  if (pendingReviews.length > 0) {
    banners.push(`
      <div class="system-banner system-banner--info" role="status">
        <span>🔔 Hay <strong>${pendingReviews.length}</strong> departamento(s) marcados por publicadores esperando tu revisión.</span>
        <button type="button" id="banner-go-reviews" class="btn btn--primary btn--sm">Revisar ahora</button>
      </div>
    `);
  }

  stack.innerHTML = banners.join('');

  document.getElementById('banner-retry-sync')?.addEventListener('click', () => loadDataFromSource(true));
  document.getElementById('banner-go-admin')?.addEventListener('click', () => switchTab('admin'));
  document.getElementById('banner-go-reviews')?.addEventListener('click', () => switchTab('admin'));
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
  const sessionEl = document.getElementById('header-user-session');
  const switchBtn = document.getElementById('btn-switch-session');

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

  const isAdmin = isAdminAuthenticated();
  const pub = getCurrentPublisher();
  const authed = isSessionAuthenticated();

  if (switchBtn) {
    switchBtn.classList.toggle('hidden', !authed);
  }

  if (sessionEl) {
    if (!authed) {
      sessionEl.classList.add('hidden');
      sessionEl.innerHTML = '';
    } else {
      sessionEl.classList.remove('hidden');
      if (isAdmin && pub) {
        sessionEl.innerHTML = `
          <span class="pub-dot" style="background-color:${escapeHtml(pub.color || '#2563eb')};"></span>
          <span><strong>${escapeHtml(pub.nombre)}</strong> • 🔐 Admin (${escapeHtml(state.admin.username || 'Admin')})</span>
        `;
      } else if (isAdmin) {
        sessionEl.innerHTML = `<span>🔐 Admin: <strong>${escapeHtml(state.admin.username || 'Admin')}</strong></span>`;
      } else if (pub) {
        sessionEl.innerHTML = `
          <span class="pub-dot" style="background-color:${escapeHtml(pub.color || '#2563eb')};"></span>
          <span>👤 <strong>${escapeHtml(pub.nombre)}</strong>${state.publisher.remembered ? ' • Recordado' : ''}</span>
        `;
      }
    }
  }
}

function renderTabsVisibility() {
  const isAdmin = isAdminAuthenticated();
  const isPub = isPublisherAuthenticated();

  const visibleByTab = {
    'mis-asignaciones': isPub,
    territorios: true,
    hermanos: isAdmin,
    admin: true
  };

  let effectiveActive = state.ui.activeTab;
  if (!visibleByTab[effectiveActive]) {
    effectiveActive = isPub ? 'mis-asignaciones' : 'territorios';
  }

  const terrBtn = document.getElementById('btn-tab-territorios');
  if (terrBtn) {
    terrBtn.textContent = isAdmin ? '🏢 Territorios' : '🏢 Mis Torres';
  }

  const badgeEl = document.getElementById('admin-notif-badge');
  if (badgeEl) {
    const count = isAdmin ? getVisiblePendingReports().length : 0;
    badgeEl.textContent = String(count);
    badgeEl.classList.toggle('hidden', count === 0);
  }

  ['mis-asignaciones', 'territorios', 'hermanos', 'admin'].forEach(tab => {
    const panel = document.getElementById(`tab-${tab}`);
    const btn = document.getElementById(`btn-tab-${tab}`);
    const allowed = visibleByTab[tab];
    const active = allowed && effectiveActive === tab;

    if (btn) {
      btn.classList.toggle('hidden', !allowed);
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    }
    if (panel) {
      panel.classList.toggle('hidden', !active);
    }
  });
}

function renderAll() {
  renderAuthGate();
  if (!isSessionAuthenticated()) {
    return;
  }

  renderHeaderMeta();
  renderSystemBanners();
  renderTabsVisibility();
  renderMyAssignmentsView();
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
  if (tabName === 'hermanos' && !isAdminAuthenticated()) return;
  if (tabName === 'mis-asignaciones' && !isPublisherAuthenticated()) return;
  setUiState({ activeTab: tabName });
}

function reconcilePublisherSessionAfterLoad() {
  if (isPublisherAuthenticated()) {
    const valid = validatePublisherSessionAgainstDataset();
    if (!valid) {
      clearPublisherSessionStorage();
    }
    return;
  }

  if (isAdminAuthenticated()) return;

  const saved = loadPublisherSessionStorage();
  if (!saved || (!saved.hermanoId && !saved.nombre)) return;

  const matched =
    (saved.hermanoId && state.hermanos.find(h => h.id === saved.hermanoId)) ||
    findMatchingPublisher(state.hermanos, saved.nombre);

  if (matched) {
    savePublisherSessionStorage({
      hermanoId: matched.id,
      nombre: matched.nombre,
      remembered: saved.remembered
    });
    setPublisherSession(
      {
        authenticated: true,
        hermanoId: matched.id,
        nombre: matched.nombre,
        remembered: saved.remembered
      },
      { activeTab: 'mis-asignaciones' }
    );
  } else {
    clearPublisherSessionStorage();
    setUiState({
      gateError: 'Tu sesión guardada ya no coincide con la lista actual de publicadores asignables. Ingresa nuevamente.'
    });
  }
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

    state.ui.dataReady = true;
    setInitialDataset(
      {
        condominios: remote.condominios,
        hermanos: remote.hermanos,
        configuracion: remote.configuracion,
        reportes: remote.reportes || []
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
      reportes: state.reportes,
      syncedAt
    });

    reconcilePublisherSessionAfterLoad();
    if (isSessionAuthenticated()) {
      await refreshPendingReports({ notifyNew: manualRefresh });
    }

    if (manualRefresh) {
      showToast('Datos actualizados desde el servidor.', 'success');
    }
  } catch (err) {
    console.warn('Fallo al cargar JSON remotos, intentando caché local:', err);
    const cached = loadCachedSnapshot();
    state.ui.dataReady = true;
    if (cached) {
      setInitialDataset(
        {
          condominios: cached.condominios || [],
          hermanos: cached.hermanos || [],
          configuracion: cached.configuracion || null,
          reportes: cached.reportes || []
        },
        {
          source: 'cache',
          lastSyncedAt: cached.syncedAt || null,
          isOffline: !navigator.onLine,
          isStale: true
        }
      );
      reconcilePublisherSessionAfterLoad();
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
  document.getElementById('btn-tab-mis-asignaciones')?.addEventListener('click', () => switchTab('mis-asignaciones'));
  document.getElementById('btn-tab-territorios')?.addEventListener('click', () => switchTab('territorios'));
  document.getElementById('btn-tab-hermanos')?.addEventListener('click', () => switchTab('hermanos'));
  document.getElementById('btn-tab-admin')?.addEventListener('click', () => switchTab('admin'));

  document.getElementById('btn-switch-session')?.addEventListener('click', async () => {
    const ok = await logoutFullSession();
    if (ok) {
      setUiState({ gateMode: 'publisher', gateError: '' });
      showToast('Sesión cerrada. Ingresa con otro nombre o cuenta administrativa.', 'info');
    }
  });

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

  // Consultar reportes pendientes al volver a la pestaña (para notificaciones en tiempo real al admin)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && isAdminAuthenticated() && navigator.onLine) {
      refreshPendingReports({ notifyNew: true });
    }
  });
}

async function init() {
  setLocalProgressMap(loadLocalProgress());
  setLocalPendingReportsState(loadLocalPendingReports());
  subscribe(renderAll);
  bindEvents();
  setupServiceWorkerAndInstall();
  renderAll();
  await loadDataFromSource(false);

  // Sondeo suave cada 45s cuando el admin tiene la ventana visible
  window.setInterval(() => {
    if (document.visibilityState === 'visible' && isAdminAuthenticated() && navigator.onLine) {
      refreshPendingReports({ notifyNew: true });
    }
  }, 45000);
}

init();

