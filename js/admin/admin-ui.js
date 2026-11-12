/**
 * Interfaz del Panel de Administración (Login seguro + Sincronización GitHub + Respaldos + Configuración).
 */

import { isAdminAuthenticated, state, updateConfiguracionAdmin } from '../core/state.js';
import { showToast } from '../core/ui-feedback.js';
import { escapeHtml, formatDateTime, isLocalDevEnvironment } from '../core/utils.js';
import { abrirModalCondominio, abrirModalHermano } from '../modules/modals.js';
import { hasLegacyV022Data } from '../services/storage.js';
import {
  exportFullBackupJson,
  exportIndividualDataFiles,
  getSuggestedRepoValues,
  hasPreOverwriteSnapshot,
  importBackupFileAdmin,
  importLegacyV022Admin,
  loadSampleDatasetAdmin,
  loginAdminLocalDev,
  loginAdminWithGitHub,
  logoutAdmin,
  publishToGitHubAdmin,
  restorePreImportSnapshotAdmin,
  syncFromGitHubAdmin
} from './admin.js';

function getGlobalStats() {
  let totalTorres = 0;
  let totalActivos = 0;
  let totalCompletados = 0;
  state.condominios.forEach(c => {
    totalTorres += c.edificios.length;
    c.edificios.forEach(e => {
      e.deptos.forEach(d => {
        if (!d.excluido) {
          totalActivos++;
          if (d.estado === 'completado') totalCompletados++;
        }
      });
    });
  });
  return {
    condos: state.condominios.length,
    torres: totalTorres,
    activos: totalActivos,
    completados: totalCompletados,
    hermanos: state.hermanos.length
  };
}

export function renderAdminView() {
  const container = document.getElementById('admin-container');
  if (!container) return;

  if (!isAdminAuthenticated()) {
    renderAdminLogin(container);
  } else {
    renderAdminDashboard(container);
  }
}

function renderAdminLogin(container) {
  const repoSuggested = getSuggestedRepoValues();
  const isLocal = isLocalDevEnvironment();

  container.innerHTML = `
    <div class="admin-layout">
      <section class="admin-card admin-card--highlight">
        <div>
          <h2 class="section-title">🔐 Acceso al Panel de Administración</h2>
          <p class="section-desc">
            Para proteger los datos de la congregación, solo el administrador autorizado puede crear, editar, eliminar o publicar territorios en GitHub.
          </p>
        </div>

        <div class="notice-box notice-box--security">
          <strong>Seguridad de credenciales:</strong> Tu token de GitHub se verifica directamente con GitHub y se mantiene <strong>únicamente en la memoria temporal de esta pestaña</strong>. Nunca se guarda en el navegador ni en archivos públicos.
        </div>

        <form id="admin-login-form" style="display:flex; flex-direction:column; gap:0.85rem;">
          <div class="admin-form-grid">
            <div class="field">
              <label class="field__label" for="gh-owner">Usuario u Organización GitHub *</label>
              <input type="text" id="gh-owner" class="input" value="${escapeHtml(repoSuggested.owner)}" placeholder="Ej. congregacion-norte" required>
            </div>
            <div class="field">
              <label class="field__label" for="gh-repo">Nombre del Repositorio *</label>
              <input type="text" id="gh-repo" class="input" value="${escapeHtml(repoSuggested.repo)}" placeholder="Ej. condominios" required>
            </div>
          </div>

          <div class="admin-form-grid">
            <div class="field">
              <label class="field__label" for="gh-branch">Rama (Branch)</label>
              <input type="text" id="gh-branch" class="input" value="${escapeHtml(repoSuggested.branch || 'main')}" placeholder="main" required>
            </div>
            <div class="field">
              <label class="field__label" for="gh-token">Token de Acceso GitHub (Fine-Grained PAT) *</label>
              <input type="password" id="gh-token" class="input" autocomplete="off" placeholder="github_pat_..." required>
            </div>
          </div>

          <div class="admin-actions-row">
            <button type="submit" id="btn-gh-login" class="btn btn--primary">Ingresar y conectar con GitHub</button>
            ${isLocal ? `<button type="button" id="btn-local-dev-login" class="btn btn--secondary">Entrar en Modo Pruebas Local (solo localhost)</button>` : ''}
          </div>
        </form>

        <details class="notice-box">
          <summary style="cursor:pointer; font-weight:700;">¿Cómo obtener el token en 1 minuto?</summary>
          <ol class="help-steps" style="margin-top:0.65rem;">
            <li>Entra a tu cuenta de GitHub ➔ <strong>Settings</strong> ➔ <strong>Developer settings</strong> ➔ <strong>Personal access tokens</strong> ➔ <strong>Fine-grained tokens</strong>.</li>
            <li>Haz clic en <strong>Generate new token</strong>.</li>
            <li>En <em>Repository access</em>, elige <strong>Only select repositories</strong> y selecciona únicamente este repositorio.</li>
            <li>En <em>Permissions ➔ Repository permissions</em>, activa <strong>Contents: Read and write</strong>.</li>
            <li>Copia el token generado y pégalo arriba al iniciar sesión como administrador.</li>
          </ol>
        </details>
      </section>
    </div>
  `;

  document.getElementById('admin-login-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = document.getElementById('btn-gh-login');
    const owner = document.getElementById('gh-owner').value.trim();
    const repo = document.getElementById('gh-repo').value.trim();
    const branch = document.getElementById('gh-branch').value.trim() || 'main';
    const token = document.getElementById('gh-token').value.trim();

    btn.disabled = true;
    btn.textContent = 'Verificando permisos...';

    try {
      const info = await loginAdminWithGitHub({ owner, repo, branch, token });
      showToast(`Sesión iniciada como ${info.username}.`, 'success');
    } catch (err) {
      showToast(err.message || 'No se pudo autenticar con GitHub.', 'error', 5000);
    } finally {
      if (document.body.contains(btn)) {
        btn.disabled = false;
        btn.textContent = 'Ingresar y conectar con GitHub';
      }
    }
  });

  document.getElementById('btn-local-dev-login')?.addEventListener('click', () => {
    try {
      loginAdminLocalDev();
      showToast('Modo pruebas local activado (cambios no se suben a GitHub).', 'info');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

function renderAdminDashboard(container) {
  const stats = getGlobalStats();
  const isGitHubMode = state.admin.mode === 'github';
  const dirty = state.sync.dirtyCount;
  const hasLegacy = hasLegacyV022Data();
  const canRestoreSnapshot = hasPreOverwriteSnapshot();

  const statusPill = dirty > 0
    ? `<span class="admin-status-pill admin-status-pill--pending">● ${dirty} cambio(s) sin publicar</span>`
    : (isGitHubMode
      ? `<span class="admin-status-pill admin-status-pill--online">✓ Sincronizado con GitHub</span>`
      : `<span class="admin-status-pill admin-status-pill--local">🧪 Modo Pruebas Local</span>`);

  const repoPrivacyText = state.sync.repoPrivate === true
    ? 'Repositorio Privado'
    : (state.sync.repoPrivate === false ? 'Repositorio Público (protección de teléfonos activa)' : 'Visibilidad no verificada');

  container.innerHTML = `
    <div class="admin-layout">
      <!-- Barra superior de sesión y sincronización -->
      <section class="admin-card admin-card--highlight">
        <div class="admin-header-bar">
          <div>
            <h2 class="section-title">Panel de Administración</h2>
            <p class="section-desc">
              Conectado como <strong>${escapeHtml(state.admin.username || 'Admin')}</strong>
              ${isGitHubMode ? `• ${escapeHtml(repoPrivacyText)}` : ''}
            </p>
          </div>
          ${statusPill}
        </div>

        <div class="admin-stats-grid">
          <div class="stat-tile">
            <span class="stat-tile__value">${stats.condos}</span>
            <span class="stat-tile__label">Condominios</span>
          </div>
          <div class="stat-tile">
            <span class="stat-tile__value">${stats.torres}</span>
            <span class="stat-tile__label">Torres</span>
          </div>
          <div class="stat-tile">
            <span class="stat-tile__value">${stats.completados}/${stats.activos}</span>
            <span class="stat-tile__label">Deptos trabajados</span>
          </div>
          <div class="stat-tile">
            <span class="stat-tile__value">${stats.hermanos}</span>
            <span class="stat-tile__label">Publicadores</span>
          </div>
        </div>

        ${isGitHubMode ? `
          <div class="admin-actions-row" style="align-items:center;">
            <input type="text" id="admin-commit-msg" class="input" style="flex:1 1 240px;" placeholder="Nota breve de actualización (opcional, ej. Nuevas asignaciones Noviembre)">
            <button type="button" id="btn-publish-github" class="btn ${dirty > 0 ? 'btn--success' : 'btn--primary'}">
              ☁️ Publicar cambios en GitHub${dirty > 0 ? ` (${dirty})` : ''}
            </button>
            <button type="button" id="btn-sync-github" class="btn btn--secondary">↻ Recargar desde GitHub</button>
            <button type="button" id="btn-admin-logout" class="btn btn--danger-soft">Cerrar sesión</button>
          </div>
        ` : `
          <div class="notice-box">
            Estás en <strong>Modo Pruebas Local</strong>. Usa las opciones de exportación JSON abajo para respaldar tus datos o llevarlos a GitHub manualmente.
          </div>
          <div class="admin-actions-row">
            <button type="button" id="btn-admin-logout" class="btn btn--danger-soft">Cerrar sesión local</button>
          </div>
        `}

        <p class="field__hint" style="margin:0;">
          Última sincronización: <strong>${escapeHtml(formatDateTime(state.sync.lastSyncedAt))}</strong>
          ${state.sync.lastCommitSha ? ` • Commit: <code>${escapeHtml(state.sync.lastCommitSha.slice(0, 7))}</code>` : ''}
        </p>
      </section>

      <div class="admin-grid">
        <!-- Acciones rápidas y migración -->
        <section class="admin-card">
          <div>
            <h3 class="section-title" style="font-size:1rem;">Gestión rápida y datos iniciales</h3>
            <p class="section-desc">Crea territorios o publicadores desde aquí o desde sus pestañas respectivas.</p>
          </div>

          <div class="admin-actions-row">
            <button type="button" id="admin-quick-condo" class="btn btn--primary">+ Nuevo Condominio</button>
            <button type="button" id="admin-quick-hermano" class="btn btn--secondary">+ Registrar Publicador</button>
            <button type="button" id="admin-load-demo" class="btn btn--soft">🧪 Cargar datos de ejemplo</button>
          </div>

          ${hasLegacy ? `
            <div class="notice-box notice-box--privacy" style="display:flex; flex-direction:column; gap:0.5rem;">
              <strong>Detectamos datos de la versión anterior (Deptos 0.2.2) en este navegador.</strong>
              <button type="button" id="admin-import-legacy" class="btn btn--secondary btn--sm" style="align-self:flex-start;">Importar datos de la v0.2.2</button>
            </div>
          ` : ''}

          <div class="notice-box notice-box--privacy">
            <strong>Privacidad de la congregación:</strong> Si el repositorio es público, evita guardar teléfonos personales o detalles sensibles de ocupantes. Cuando la opción de privacidad está activa, los teléfonos de contacto se omiten automáticamente al publicar en GitHub.
          </div>
        </section>

        <!-- Respaldos y restauración JSON -->
        <section class="admin-card">
          <div>
            <h3 class="section-title" style="font-size:1rem;">Respaldos y recuperación JSON</h3>
            <p class="section-desc">Exporta copias completas para resguardo o sube los JSON manualmente si lo prefieres.</p>
          </div>

          <div class="admin-actions-row">
            <button type="button" id="btn-export-backup" class="btn btn--secondary">⬇️ Descargar respaldo completo (.json)</button>
            <button type="button" id="btn-export-split" class="btn btn--soft">📄 Exportar JSON para /data</button>
          </div>

          <div style="display:flex; flex-wrap:wrap; align-items:center; gap:0.5rem;">
            <label class="btn btn--secondary file-input-label">
              ⬆️ Importar respaldo (.json)
              <input type="file" id="input-import-backup" accept="application/json,.json" class="sr-only">
            </label>
            ${canRestoreSnapshot ? `<button type="button" id="btn-restore-snapshot" class="btn btn--danger-soft btn--sm">↩️ Deshacer última importación</button>` : ''}
          </div>
        </section>
      </div>

      <!-- Configuración general -->
      <section class="admin-card">
        <div>
          <h3 class="section-title" style="font-size:1rem;">Configuración de la Congregación</h3>
          <p class="section-desc">Personaliza textos, valores por defecto y preferencias de privacidad.</p>
        </div>

        <form id="admin-config-form" style="display:flex; flex-direction:column; gap:0.85rem;">
          <div class="admin-form-grid">
            <div class="field">
              <label class="field__label" for="cfg-congregacion">Nombre de Congregación / Etiqueta</label>
              <input type="text" id="cfg-congregacion" class="input" value="${escapeHtml(state.configuracion.congregacion || '')}">
            </div>
            <div class="field">
              <label class="field__label" for="cfg-titulo">Título principal</label>
              <input type="text" id="cfg-titulo" class="input" value="${escapeHtml(state.configuracion.tituloApp || '')}">
            </div>
          </div>

          <div class="field">
            <label class="field__label" for="cfg-subtitulo">Subtítulo descriptivo</label>
            <input type="text" id="cfg-subtitulo" class="input" value="${escapeHtml(state.configuracion.subtituloApp || '')}">
          </div>

          <div class="admin-form-grid">
            <div class="field">
              <label class="field__label" for="cfg-dist">Distancia mínima por defecto (pts)</label>
              <input type="number" id="cfg-dist" class="input" min="0" max="20" value="${escapeHtml(state.configuracion.distanciaMinimaDefault ?? 2)}">
            </div>
            <div class="field">
              <label class="field__label" for="cfg-max">Máx. deptos por hermano por defecto</label>
              <input type="number" id="cfg-max" class="input" min="1" max="50" value="${escapeHtml(state.configuracion.maxDeptosDefault ?? 5)}">
            </div>
          </div>

          <label class="checklist-row">
            <input type="checkbox" id="cfg-privacy" ${state.configuracion?.privacidad?.ocultarContactoEnRepoPublico !== false ? 'checked' : ''}>
            <span>Omitir teléfonos de contacto al publicar en un repositorio público</span>
          </label>

          <div>
            <button type="submit" class="btn btn--primary">Guardar configuración en sesión</button>
          </div>
        </form>
      </section>
    </div>
  `;

  document.getElementById('btn-publish-github')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-publish-github');
    const msg = document.getElementById('admin-commit-msg')?.value || '';
    btn.disabled = true;
    btn.textContent = 'Publicando en GitHub...';
    try {
      const res = await publishToGitHubAdmin(msg);
      const note = res.sanitizedContacts ? ' (Teléfonos omitidos por privacidad en repo público).' : '';
      showToast(`Cambios publicados en GitHub. Los usuarios verán la actualización en ~1 minuto.${note}`, 'success', 6000);
    } catch (err) {
      showToast(err.message || 'Error al publicar en GitHub.', 'error', 6000);
    } finally {
      if (document.body.contains(btn)) {
        btn.disabled = false;
        btn.textContent = '☁️ Publicar cambios en GitHub';
      }
    }
  });

  document.getElementById('btn-sync-github')?.addEventListener('click', async () => {
    try {
      const synced = await syncFromGitHubAdmin();
      if (synced) showToast('Datos sincronizados desde GitHub.', 'success');
    } catch (err) {
      showToast(err.message || 'Error al sincronizar.', 'error');
    }
  });

  document.getElementById('btn-admin-logout')?.addEventListener('click', async () => {
    const loggedOut = await logoutAdmin();
    if (loggedOut) showToast('Sesión administrativa cerrada.', 'info');
  });

  document.getElementById('admin-quick-condo')?.addEventListener('click', () => abrirModalCondominio());
  document.getElementById('admin-quick-hermano')?.addEventListener('click', () => abrirModalHermano());

  document.getElementById('admin-load-demo')?.addEventListener('click', async () => {
    const loaded = await loadSampleDatasetAdmin();
    if (loaded) showToast('Datos de ejemplo cargados. Recuerda publicar si deseas conservarlos en GitHub.', 'success');
  });

  document.getElementById('admin-import-legacy')?.addEventListener('click', async () => {
    const ok = await importLegacyV022Admin();
    if (ok) showToast('Datos heredados importados correctamente.', 'success');
  });

  document.getElementById('btn-export-backup')?.addEventListener('click', () => {
    exportFullBackupJson();
    showToast('Respaldo JSON descargado.', 'success');
  });

  document.getElementById('btn-export-split')?.addEventListener('click', () => {
    exportIndividualDataFiles();
    showToast('Archivos condominios.json, hermanos.json y configuracion.json descargados.', 'success');
  });

  document.getElementById('input-import-backup')?.addEventListener('change', async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const res = await importBackupFileAdmin(file);
      if (res) {
        showToast(`Importación lista (${res.condominios.length} condominios, ${res.hermanos.length} publicadores).`, 'success');
      }
    } catch (err) {
      showToast(err.message || 'No se pudo importar el archivo.', 'error', 5000);
    } finally {
      e.target.value = '';
    }
  });

  document.getElementById('btn-restore-snapshot')?.addEventListener('click', async () => {
    const restored = await restorePreImportSnapshotAdmin();
    if (restored) showToast('Se restauró el estado anterior a la importación.', 'success');
  });

  document.getElementById('admin-config-form')?.addEventListener('submit', e => {
    e.preventDefault();
    updateConfiguracionAdmin({
      congregacion: document.getElementById('cfg-congregacion').value,
      tituloApp: document.getElementById('cfg-titulo').value,
      subtituloApp: document.getElementById('cfg-subtitulo').value,
      distanciaMinimaDefault: document.getElementById('cfg-dist').value,
      maxDeptosDefault: document.getElementById('cfg-max').value,
      privacidad: {
        ocultarContactoEnRepoPublico: document.getElementById('cfg-privacy').checked
      }
    });
    showToast('Configuración actualizada (recuerda publicar en GitHub para hacerla permanente).', 'success');
  });
}

