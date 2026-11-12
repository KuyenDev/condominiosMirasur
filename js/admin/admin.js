/**
 * Controlador de lógica del Panel de Administración:
 * - Sesión autenticada (token en RAM solamente).
 * - Publicación atómica en GitHub y detección de conflictos.
 * - Respaldo, restauración y recuperación ante sobrescrituras.
 */

import {
  isAdminAuthenticated,
  normalizeDataset,
  replaceAllDataAdmin,
  setAdminSession,
  setInitialDataset,
  setSyncState,
  state
} from '../core/state.js';
import { confirmAction, showToast } from '../core/ui-feedback.js';
import { cloneDeep, isLocalDevEnvironment } from '../core/utils.js';
import {
  buildDataPayloads,
  buildSampleDataset,
  loadRemoteJsonFiles,
  parseImportedBackup,
  triggerJsonDownload
} from '../services/database.js';
import {
  authenticateWithProxy,
  clearProxySession,
  commitDataViaProxy,
  fetchDataViaProxy,
  hasActiveProxySession
} from '../services/auth-proxy.js';
import {
  authenticateGitHubSession,
  clearGitHubSession,
  commitDataAtomically,
  detectGitHubRepoFromLocation,
  fetchDataFromGitHubApi,
  getActiveRepoConfig,
  hasActiveGitHubSession
} from '../services/github.js';
import { loadCachedSnapshot, readLegacyV022Data, saveCachedSnapshot } from '../services/storage.js';

let preOverwriteSnapshot = null;

export function hasPreOverwriteSnapshot() {
  return Boolean(preOverwriteSnapshot);
}

function captureSnapshot() {
  preOverwriteSnapshot = {
    capturedAt: new Date().toISOString(),
    condominios: cloneDeep(state.condominios),
    hermanos: cloneDeep(state.hermanos),
    configuracion: cloneDeep(state.configuracion)
  };
}

export async function loginAdminWithGitHub({ owner, repo, branch, token }) {
  const authResult = await authenticateGitHubSession({ owner, repo, branch, token });

  setAdminSession({
    authenticated: true,
    mode: 'github',
    username: authResult.username,
    canPush: authResult.canPush
  });

  setSyncState({
    repoPrivate: authResult.repoPrivate,
    remoteHeadSha: authResult.headSha
  });

  // Guardar referencia del repo en memoria sin marcar cambios pendientes
  if (!state.configuracion.github.owner || !state.configuracion.github.repo) {
    state.configuracion.github = { owner, repo, branch };
  }

  // Sincronizar con la fuente autoritativa de GitHub API para evitar caché CDN atrasada
  try {
    const latest = await fetchDataFromGitHubApi();
    const norm = normalizeDataset({
      condominios: latest.condominios,
      hermanos: latest.hermanos,
      configuracion: latest.configuracion || state.configuracion
    });
    // Asegurar que los datos de repo en configuracion queden actualizados
    norm.configuracion.github = {
      owner: norm.configuracion.github.owner || owner,
      repo: norm.configuracion.github.repo || repo,
      branch: norm.configuracion.github.branch || branch
    };

    const now = new Date().toISOString();
    setInitialDataset(norm, {
      source: 'remote',
      lastSyncedAt: now,
      isStale: false,
      dirtyCount: 0,
      remoteHeadSha: latest.headSha
    });
    saveCachedSnapshot({
      condominios: state.condominios,
      hermanos: state.hermanos,
      configuracion: state.configuracion,
      syncedAt: now
    });
  } catch (err) {
    console.warn('No se pudo leer rama desde GitHub API tras login:', err);
  }

  return authResult;
}

export async function loginAdminWithAccount({ endpoint, username, password }) {
  const authResult = await authenticateWithProxy({ endpoint, username, password });

  setAdminSession({
    authenticated: true,
    mode: 'proxy',
    username: authResult.username,
    canPush: true
  });

  setSyncState({
    repoPrivate: authResult.repoPrivate
  });

  if (!state.configuracion.authEndpoint) {
    state.configuracion.authEndpoint = authResult.endpoint;
  }

  try {
    const latest = await fetchDataViaProxy();
    const norm = normalizeDataset({
      condominios: latest.condominios,
      hermanos: latest.hermanos,
      configuracion: latest.configuracion || state.configuracion
    });
    if (!norm.configuracion.authEndpoint) {
      norm.configuracion.authEndpoint = authResult.endpoint;
    }

    const now = new Date().toISOString();
    setInitialDataset(norm, {
      source: 'remote',
      lastSyncedAt: now,
      isStale: false,
      dirtyCount: 0,
      remoteHeadSha: latest.headSha,
      repoPrivate: latest.repoPrivate
    });
    saveCachedSnapshot({
      condominios: state.condominios,
      hermanos: state.hermanos,
      configuracion: state.configuracion,
      syncedAt: now
    });
  } catch (err) {
    console.warn('No se pudo leer rama tras login de cuenta:', err);
  }

  return authResult;
}

export function loginAdminLocalDev() {
  if (!isLocalDevEnvironment()) {
    throw new Error('El modo de pruebas local solo está disponible en localhost.');
  }
  setAdminSession({
    authenticated: true,
    mode: 'local-dev',
    username: 'Administrador Local',
    canPush: false
  });
  setSyncState({ source: 'local' });
}

export async function logoutAdmin() {
  const hadDirty = state.sync.dirtyCount > 0;
  if (hadDirty) {
    const ok = await confirmAction({
      title: 'Tienes cambios sin publicar',
      message: `Hay ${state.sync.dirtyCount} modificación(es) sin guardar en GitHub. Si cierras sesión ahora, los cambios no publicados se perderán (puedes exportar un respaldo JSON antes).`,
      confirmText: 'Salir igualmente',
      danger: true
    });
    if (!ok) return false;
  }

  clearGitHubSession();
  clearProxySession();
  setAdminSession({
    authenticated: false,
    mode: null,
    username: null,
    canPush: false
  });
  setSyncState({ dirtyCount: 0 });

  // Si había cambios en borrador descartados, restaurar la vista pública oficial
  if (hadDirty) {
    try {
      const remote = await loadRemoteJsonFiles();
      setInitialDataset(
        {
          condominios: remote.condominios,
          hermanos: remote.hermanos,
          configuracion: remote.configuracion
        },
        {
          source: 'remote',
          lastSyncedAt: remote.remoteUpdatedAt || state.sync.lastSyncedAt,
          isStale: false,
          dirtyCount: 0
        }
      );
    } catch {
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
            isStale: true,
            dirtyCount: 0
          }
        );
      }
    }
  }
  return true;
}

export async function syncFromGitHubAdmin() {
  const isProxy = state.admin.mode === 'proxy' && hasActiveProxySession();
  const isGitHub = state.admin.mode === 'github' && hasActiveGitHubSession();

  if (!isProxy && !isGitHub) {
    throw new Error('Debes iniciar sesión para sincronizar con el repositorio.');
  }

  if (state.sync.dirtyCount > 0) {
    const ok = await confirmAction({
      title: 'Sobrescribir cambios locales sin publicar',
      message: `Tienes ${state.sync.dirtyCount} cambio(s) sin publicar. Sincronizar desde GitHub reemplazará tus cambios pendientes por la versión guardada en el repositorio.`,
      confirmText: 'Sincronizar y descartar locales',
      danger: true
    });
    if (!ok) return false;
  }

  const latest = isProxy ? await fetchDataViaProxy() : await fetchDataFromGitHubApi();
  const now = new Date().toISOString();
  setInitialDataset(
    {
      condominios: latest.condominios,
      hermanos: latest.hermanos,
      configuracion: latest.configuracion || state.configuracion
    },
    {
      source: 'remote',
      lastSyncedAt: now,
      isStale: false,
      dirtyCount: 0,
      remoteHeadSha: latest.headSha
    }
  );
  saveCachedSnapshot({
    condominios: state.condominios,
    hermanos: state.hermanos,
    configuracion: state.configuracion,
    syncedAt: now
  });
  return true;
}

export async function publishToGitHubAdmin(customMessage = '') {
  const isProxy = state.admin.mode === 'proxy' && hasActiveProxySession();
  const isGitHub = state.admin.mode === 'github' && hasActiveGitHubSession();

  if (!isAdminAuthenticated() || (!isProxy && !isGitHub)) {
    throw new Error('Inicia sesión administrativa para publicar cambios en GitHub.');
  }

  const isPublicRepo = state.sync.repoPrivate === false;
  const hideContacts = state.configuracion?.privacidad?.ocultarContactoEnRepoPublico !== false;
  const sanitizePublicPrivacy = isPublicRepo && hideContacts;

  if (isGitHub) {
    const { owner, repo, branch } = getActiveRepoConfig();
    if (!state.configuracion.github.owner || !state.configuracion.github.repo) {
      state.configuracion.github = { owner, repo, branch };
    }
  }

  const { condominiosPayload, hermanosPayload, configuracionPayload, updatedAt } = buildDataPayloads(state, {
    sanitizePublicPrivacy
  });

  const message = String(customMessage || '').trim() || `Actualizar territorios (${updatedAt.slice(0, 10)})`;

  const commitFn = isProxy ? commitDataViaProxy : commitDataAtomically;
  const res = await commitFn({
    condominiosPayload,
    hermanosPayload,
    configuracionPayload,
    expectedHeadSha: state.sync.remoteHeadSha,
    commitMessage: message
  });

  setSyncState({
    dirtyCount: 0,
    lastSyncedAt: res.committedAt,
    lastCommitSha: res.commitSha,
    lastCommitAt: res.committedAt,
    remoteHeadSha: res.commitSha,
    source: 'remote',
    isStale: false
  });

  saveCachedSnapshot({
    condominios: state.condominios,
    hermanos: state.hermanos,
    configuracion: state.configuracion,
    syncedAt: res.committedAt
  });

  return { ...res, sanitizedContacts: sanitizePublicPrivacy };
}

export function exportFullBackupJson() {
  const { condominiosPayload, hermanosPayload, configuracionPayload } = buildDataPayloads(state, {
    sanitizePublicPrivacy: false
  });
  const dateTag = new Date().toISOString().slice(0, 10);
  triggerJsonDownload(`respaldo-condominios-${dateTag}.json`, {
    exportedAt: new Date().toISOString(),
    version: 1,
    condominios: condominiosPayload.condominios,
    hermanos: hermanosPayload.hermanos,
    configuracion: configuracionPayload
  });
}

export function exportIndividualDataFiles() {
  const isPublicRepo = state.sync.repoPrivate === false;
  const hideContacts = state.configuracion?.privacidad?.ocultarContactoEnRepoPublico !== false;
  const { condominiosPayload, hermanosPayload, configuracionPayload } = buildDataPayloads(state, {
    sanitizePublicPrivacy: isPublicRepo && hideContacts
  });

  triggerJsonDownload('condominios.json', condominiosPayload);
  window.setTimeout(() => triggerJsonDownload('hermanos.json', hermanosPayload), 250);
  window.setTimeout(() => triggerJsonDownload('configuracion.json', configuracionPayload), 500);
}

export async function importBackupFileAdmin(file) {
  if (!isAdminAuthenticated()) {
    throw new Error('Acceso denegado.');
  }
  const text = await file.text();
  const parsed = parseImportedBackup(text);

  const ok = await confirmAction({
    title: 'Confirmar importación de respaldo',
    message: `Se cargarán ${parsed.condominios.length} condominio(s) y ${parsed.hermanos.length} publicador(es), reemplazando los datos actuales en pantalla. Se guardará un punto de recuperación temporal por si necesitas deshacer.`,
    confirmText: 'Importar y reemplazar',
    danger: true
  });
  if (!ok) return false;

  captureSnapshot();
  replaceAllDataAdmin(parsed);
  return parsed;
}

export async function restorePreImportSnapshotAdmin() {
  if (!isAdminAuthenticated() || !preOverwriteSnapshot) return false;
  const ok = await confirmAction({
    title: 'Recuperar estado anterior',
    message: 'Se restaurarán los datos exactamente como estaban antes de la última importación o reemplazo.',
    confirmText: 'Restaurar'
  });
  if (!ok) return false;

  const snap = preOverwriteSnapshot;
  preOverwriteSnapshot = null;
  replaceAllDataAdmin(snap);
  return true;
}

export async function importLegacyV022Admin() {
  if (!isAdminAuthenticated()) throw new Error('Acceso denegado.');
  const legacy = readLegacyV022Data();
  if (legacy.condominios.length === 0 && legacy.hermanos.length === 0) {
    showToast('No se encontraron datos de la versión anterior en este navegador.', 'warning');
    return false;
  }

  const ok = await confirmAction({
    title: 'Migrar datos de Deptos 0.2.2',
    message: `Se encontraron ${legacy.condominios.length} condominio(s) y ${legacy.hermanos.length} hermano(s) guardados en la versión anterior de este navegador. ¿Deseas importarlos ahora?`
  });
  if (!ok) return false;

  captureSnapshot();
  replaceAllDataAdmin({
    condominios: legacy.condominios,
    hermanos: legacy.hermanos,
    configuracion: state.configuracion
  });
  return true;
}

export async function loadSampleDatasetAdmin() {
  if (!isAdminAuthenticated()) throw new Error('Acceso denegado.');
  if (state.condominios.length > 0 || state.hermanos.length > 0) {
    const ok = await confirmAction({
      title: 'Cargar datos de demostración',
      message: 'Esto reemplazará los datos actuales en pantalla por un condominio de ejemplo ficticio.',
      confirmText: 'Cargar ejemplo',
      danger: true
    });
    if (!ok) return false;
    captureSnapshot();
  }

  const demo = buildSampleDataset(state.configuracion);
  replaceAllDataAdmin(demo);
  return true;
}

export function getSuggestedRepoValues() {
  return detectGitHubRepoFromLocation(state.configuracion?.github);
}

