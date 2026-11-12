/**
 * Almacenamiento local no sensible:
 * - Caché de respaldo para consulta sin conexión (con marca de tiempo).
 * - Progreso personal en campo del publicador en este dispositivo.
 * - Lectura de datos heredados de la versión original (v0.2.2) para migración.
 *
 * NOTA DE SEGURIDAD: Nunca se almacenan tokens, contraseñas ni credenciales aquí.
 */

const CACHE_KEY = 'jw_condominios_cache_v1';
const LOCAL_PROGRESS_KEY = 'jw_condominios_local_progress_v1';
const LEGACY_CONDOS_KEY = 'predicacion_condominios';
const LEGACY_HERMANOS_KEY = 'predicacion_hermanos';

export function saveCachedSnapshot({ condominios, hermanos, configuracion, syncedAt }) {
  try {
    const payload = {
      version: 1,
      syncedAt: syncedAt || new Date().toISOString(),
      condominios,
      hermanos,
      configuracion
    };
    localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
  } catch (err) {
    console.warn('No se pudo guardar caché local:', err);
  }
}

export function loadCachedSnapshot() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function loadLocalProgress() {
  try {
    const raw = localStorage.getItem(LOCAL_PROGRESS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function saveLocalProgress(progressMap) {
  try {
    localStorage.setItem(LOCAL_PROGRESS_KEY, JSON.stringify(progressMap || {}));
  } catch (err) {
    console.warn('No se pudo guardar avance local:', err);
  }
}

export function hasLegacyV022Data() {
  try {
    const c = localStorage.getItem(LEGACY_CONDOS_KEY);
    const h = localStorage.getItem(LEGACY_HERMANOS_KEY);
    const condos = c ? JSON.parse(c) : [];
    const hermanos = h ? JSON.parse(h) : [];
    return (Array.isArray(condos) && condos.length > 0) || (Array.isArray(hermanos) && hermanos.length > 0);
  } catch {
    return false;
  }
}

export function readLegacyV022Data() {
  try {
    const condominios = JSON.parse(localStorage.getItem(LEGACY_CONDOS_KEY) || '[]');
    const hermanos = JSON.parse(localStorage.getItem(LEGACY_HERMANOS_KEY) || '[]');
    return {
      condominios: Array.isArray(condominios) ? condominios : [],
      hermanos: Array.isArray(hermanos) ? hermanos : []
    };
  } catch {
    return { condominios: [], hermanos: [] };
  }
}

