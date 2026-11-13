/**
 * Estado central de la aplicación, normalización/migración de datos
 * y operaciones protegidas por autorización administrativa.
 */

import {
  cloneDeep,
  extraerPiso,
  generateId,
  normalizePersonName,
  personNamesMatch,
  procesarTextoDeptosYPisos,
  resolveColorId
} from './utils.js';
import { distribuirDepartamentosSeguro } from '../modules/assignments.js';

export const DEFAULT_CONFIG = {
  version: 1,
  updatedAt: null,
  congregacion: 'Congregación',
  tituloApp: 'GESTOR DE CONDOMINIOS',
  subtituloApp: 'Organización metódica de cartas y visitas en condominios y torres',
  distanciaMinimaDefault: 2,
  maxDeptosDefault: 5,
  authEndpoint: '',
  github: {
    owner: '',
    repo: '',
    branch: 'main'
  },
  privacidad: {
    ocultarContactoEnRepoPublico: true
  }
};

const listeners = new Set();

export const state = {
  condominios: [],
  hermanos: [],
  configuracion: cloneDeep(DEFAULT_CONFIG),
  reportes: [],
  localPendingReports: [],
  resolvedReportIds: [],
  ui: {
    activeTab: 'mis-asignaciones',
    searchCondo: '',
    searchHermano: '',
    selectedPublisherId: '',
    condoOperativoId: null,
    torreOperativaId: null,
    towerClickMode: 'toggle', // 'toggle' | 'detail'
    gateMode: 'publisher', // 'publisher' | 'admin'
    gateError: '',
    dataReady: false,
    workerOutdated: false
  },
  sync: {
    source: 'remote', // 'remote' | 'cache' | 'local'
    lastSyncedAt: null,
    isOffline: typeof navigator !== 'undefined' ? !navigator.onLine : false,
    isStale: false,
    dirtyCount: 0,
    remoteHeadSha: null,
    lastCommitSha: null,
    lastCommitAt: null,
    repoPrivate: null,
    swUpdateWaiting: false
  },
  publisher: {
    authenticated: false,
    hermanoId: null,
    nombre: null,
    remembered: false
  },
  admin: {
    authenticated: false,
    mode: null, // 'github' | 'proxy' | 'local-dev' | null
    username: null,
    canPush: false
  },
  localProgress: {} // legado / respaldo dispositivo
};

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notify() {
  listeners.forEach(fn => {
    try {
      fn(state);
    } catch (err) {
      console.error('Error en suscriptor de estado:', err);
    }
  });
}

/**
 * Verificación real en capa de lógica para impedir mutaciones no autorizadas.
 */
export function isAdminAuthenticated() {
  return Boolean(
    state.admin.authenticated &&
      (state.admin.mode === 'github' || state.admin.mode === 'proxy' || state.admin.mode === 'local-dev')
  );
}

export function isPublisherAuthenticated() {
  return Boolean(
    state.publisher.authenticated &&
      state.publisher.hermanoId &&
      getPublisherById(state.publisher.hermanoId)
  );
}

export function isSessionAuthenticated() {
  return isAdminAuthenticated() || isPublisherAuthenticated();
}

export function getCurrentPublisher() {
  if (!state.publisher.authenticated || !state.publisher.hermanoId) return null;
  return getPublisherById(state.publisher.hermanoId);
}

function assertAdmin() {
  if (!isAdminAuthenticated()) {
    throw new Error('Acceso denegado: debes iniciar sesión en el Panel de Administración.');
  }
}

function markDirty() {
  state.sync.dirtyCount += 1;
}

function normalizeReportesList(rawReportes, condominios, hermanos) {
  const validHermanos = new Map((hermanos || []).map(h => [h.id, h]));
  const deptoLookup = new Map();

  (condominios || []).forEach(c => {
    (c.edificios || []).forEach(e => {
      (e.deptos || []).forEach(d => {
        deptoLookup.set(d.id, { condo: c, edificio: e, depto: d });
      });
    });
  });

  const seenDepto = new Set();
  const result = [];

  (Array.isArray(rawReportes) ? rawReportes : []).forEach(r => {
    if (!r || !r.deptoId || !r.hermanoId) return;
    const entry = deptoLookup.get(String(r.deptoId));
    const hermano = validHermanos.get(String(r.hermanoId));
    if (!entry || !hermano) return;

    const { condo, edificio, depto } = entry;
    if (depto.excluido || depto.estado === 'completado') return;
    if (depto.asignadoId !== hermano.id) return;
    if (seenDepto.has(depto.id)) return;
    seenDepto.add(depto.id);

    result.push({
      id: r.id ? String(r.id) : generateId('rep'),
      condoId: condo.id,
      condoNombre: condo.nombre,
      edificioId: edificio.id,
      edificioNombre: edificio.nombre,
      deptoId: depto.id,
      deptoNumero: depto.numero,
      piso: depto.piso,
      hermanoId: hermano.id,
      hermanoNombre: hermano.nombre,
      tipo: 'completado',
      nota: r.nota ? String(r.nota).trim() : '',
      createdAt: r.createdAt || new Date().toISOString(),
      isLocalOnly: Boolean(r.isLocalOnly)
    });
  });

  return result;
}

/**
 * Normaliza datos provenientes de JSON v1 o de la versión heredada v0.2.2.
 */
export function normalizeDataset({ condominios = [], hermanos = [], configuracion = null, reportes = [] } = {}) {
  const safeConfig = {
    ...cloneDeep(DEFAULT_CONFIG),
    ...(configuracion && typeof configuracion === 'object' ? configuracion : {}),
    github: {
      ...DEFAULT_CONFIG.github,
      ...(configuracion && configuracion.github ? configuracion.github : {})
    },
    privacidad: {
      ...DEFAULT_CONFIG.privacidad,
      ...(configuracion && configuracion.privacidad ? configuracion.privacidad : {})
    }
  };

  const normalizedHermanos = (Array.isArray(hermanos) ? hermanos : []).map(h => ({
    id: h.id ? String(h.id) : generateId('h'),
    nombre: String(h.nombre || 'Publicador').trim(),
    contacto: h.contacto ? String(h.contacto).trim() : '',
    torreAsignada: h.torreAsignada ? String(h.torreAsignada) : 'todas',
    colorId: resolveColorId(h)
  }));

  const nameToIdMap = new Map();
  normalizedHermanos.forEach(h => {
    nameToIdMap.set(h.nombre.toLowerCase(), h.id);
  });

  const validBrotherIds = new Set(normalizedHermanos.map(h => h.id));
  const validTowerIds = new Set();

  const normalizedCondos = (Array.isArray(condominios) ? condominios : []).map(c => {
    const edificios = (Array.isArray(c.edificios) ? c.edificios : []).map(e => {
      const eId = e.id ? String(e.id) : generateId('edif');
      validTowerIds.add(eId);
      const deptos = (Array.isArray(e.deptos) ? e.deptos : []).map(d => {
        let asignadoId = d.asignadoId && validBrotherIds.has(String(d.asignadoId))
          ? String(d.asignadoId)
          : null;

        // Migración automática desde v0.2.2 donde asignadoA guardaba el nombre
        if (!asignadoId && d.asignadoA) {
          const matchedId = nameToIdMap.get(String(d.asignadoA).trim().toLowerCase());
          if (matchedId) asignadoId = matchedId;
        }

        const numero = String(d.numero || '').trim();
        const piso = Number.isFinite(Number(d.piso)) ? Number(d.piso) : extraerPiso(numero);

        return {
          id: d.id ? String(d.id) : generateId('dep'),
          numero,
          piso,
          estado: d.estado === 'completado' ? 'completado' : 'pendiente',
          asignadoId,
          asignadoA: !asignadoId && d.asignadoA ? String(d.asignadoA) : null,
          fijo: Boolean(d.fijo),
          excluido: Boolean(d.excluido),
          motivoExcluido: d.excluido ? (d.motivoExcluido || 'Deshabitado') : null,
          nota: d.nota ? String(d.nota) : '',
          fechaEstado: d.fechaEstado || null
        };
      });

      const dist = Number.isFinite(Number(e.distanciaMinima))
        ? Math.max(0, Math.min(20, parseInt(e.distanciaMinima, 10)))
        : safeConfig.distanciaMinimaDefault;

      return {
        id: eId,
        nombre: String(e.nombre || 'Torre').trim(),
        distanciaMinima: dist,
        deptos
      };
    });

    return {
      id: c.id ? String(c.id) : generateId('condo'),
      nombre: String(c.nombre || 'Condominio').trim(),
      direccion: c.direccion ? String(c.direccion).trim() : '',
      administrador: c.administrador ? String(c.administrador).trim() : '',
      notas: c.notas ? String(c.notas).trim() : '',
      edificios
    };
  });

  // Limpiar referencias huérfanas de torreAsignada en hermanos
  normalizedHermanos.forEach(h => {
    if (h.torreAsignada !== 'todas' && !validTowerIds.has(h.torreAsignada)) {
      h.torreAsignada = 'todas';
    }
  });

  const normalizedReportes = normalizeReportesList(reportes, normalizedCondos, normalizedHermanos);

  return {
    condominios: normalizedCondos,
    hermanos: normalizedHermanos,
    configuracion: safeConfig,
    reportes: normalizedReportes
  };
}

export function setInitialDataset(rawData, syncPatch = {}) {
  const norm = normalizeDataset(rawData);
  state.condominios = norm.condominios;
  state.hermanos = norm.hermanos;
  state.configuracion = norm.configuracion;
  state.reportes = norm.reportes;
  state.resolvedReportIds = [];
  if (Array.isArray(state.localPendingReports) && state.localPendingReports.length > 0) {
    state.localPendingReports = normalizeReportesList(state.localPendingReports, state.condominios, state.hermanos);
  }
  Object.assign(state.sync, syncPatch);
  notify();
}

export function setPublisherSession(session, { activeTab = null } = {}) {
  state.publisher = {
    authenticated: Boolean(session?.authenticated && session?.hermanoId),
    hermanoId: session?.hermanoId || null,
    nombre: session?.nombre || null,
    remembered: Boolean(session?.remembered)
  };
  if (state.publisher.authenticated) {
    state.ui.gateError = '';
    if (activeTab) {
      state.ui.activeTab = activeTab;
    } else if (!isAdminAuthenticated()) {
      state.ui.activeTab = 'mis-asignaciones';
    }
  }
  notify();
}

export function validatePublisherSessionAgainstDataset() {
  if (!state.publisher.authenticated) return true;
  const byId = getPublisherById(state.publisher.hermanoId);
  if (byId) {
    state.publisher.nombre = byId.nombre;
    notify();
    return true;
  }
  const byName = state.hermanos.find(h => personNamesMatch(h.nombre, state.publisher.nombre));
  if (byName) {
    state.publisher.hermanoId = byName.id;
    state.publisher.nombre = byName.nombre;
    notify();
    return true;
  }
  state.publisher = {
    authenticated: false,
    hermanoId: null,
    nombre: null,
    remembered: false
  };
  if (!isAdminAuthenticated()) {
    state.ui.gateError = 'Tu sesión guardada ya no coincide con la lista actual de publicadores. Ingresa nuevamente.';
  }
  notify();
  return false;
}

export function setAdminSession(session) {
  state.admin = {
    authenticated: Boolean(session?.authenticated),
    mode: session?.mode || null,
    username: session?.username || null,
    canPush: Boolean(session?.canPush)
  };
  if (!state.admin.authenticated) {
    state.ui.towerClickMode = 'toggle';
    if (state.publisher.authenticated && (state.ui.activeTab === 'hermanos' || state.ui.activeTab === 'admin')) {
      state.ui.activeTab = 'mis-asignaciones';
    }
  } else {
    state.ui.gateError = '';
    if (state.ui.activeTab === 'mis-asignaciones') {
      state.ui.activeTab = 'territorios';
    }
  }
  notify();
}

export function setRemoteReportes(rawReportes) {
  const normalized = normalizeReportesList(rawReportes, state.condominios, state.hermanos);
  const resolvedSet = new Set(state.resolvedReportIds);
  state.reportes = normalized.filter(r => !resolvedSet.has(r.id));

  // Si un reporte local ya aparece en remoto, limpiar la copia local redundante
  const remoteDeptos = new Set(state.reportes.map(r => `${r.deptoId}::${r.hermanoId}`));
  state.localPendingReports = (state.localPendingReports || []).filter(
    r => !remoteDeptos.has(`${r.deptoId}::${r.hermanoId}`) && !resolvedSet.has(r.id)
  );
  notify();
}

export function setLocalPendingReportsState(rawReports) {
  state.localPendingReports = (Array.isArray(rawReports) ? rawReports : []).map(r => ({
    ...r,
    isLocalOnly: true
  }));
}

export function upsertLocalPendingReport(report) {
  const next = (state.localPendingReports || []).filter(
    r => !(r.deptoId === report.deptoId && r.hermanoId === report.hermanoId)
  );
  next.push({ ...report, isLocalOnly: true });
  state.localPendingReports = next;
  notify();
}

export function removePendingReportForPublisher(deptoId, hermanoId) {
  state.reportes = (state.reportes || []).filter(
    r => !(r.deptoId === deptoId && r.hermanoId === hermanoId)
  );
  state.localPendingReports = (state.localPendingReports || []).filter(
    r => !(r.deptoId === deptoId && r.hermanoId === hermanoId)
  );
  notify();
}

export function setUiState(patch) {
  Object.assign(state.ui, patch);
  notify();
}

export function setSyncState(patch) {
  Object.assign(state.sync, patch);
  notify();
}

export function setLocalProgressMap(map) {
  state.localProgress = map && typeof map === 'object' ? { ...map } : {};
}

export function toggleLocalDeptoProgress(deptoId) {
  if (!deptoId) return;
  if (state.localProgress[deptoId]) {
    delete state.localProgress[deptoId];
  } else {
    state.localProgress[deptoId] = true;
  }
  notify();
}

export function clearLocalProgress() {
  state.localProgress = {};
  notify();
}

/* ==========================================================================
   Consultas de Lectura
   ========================================================================== */

export function getPublisherById(id) {
  if (!id) return null;
  return state.hermanos.find(h => h.id === id) || null;
}

export function getCondoById(condoId) {
  return state.condominios.find(c => c.id === condoId) || null;
}

export function getTowerByIds(condoId, edificioId) {
  const condo = getCondoById(condoId);
  if (!condo) return { condo: null, edificio: null };
  const edificio = condo.edificios.find(e => e.id === edificioId) || null;
  return { condo, edificio };
}

export function getVisiblePendingReports() {
  const isAdmin = isAdminAuthenticated();
  const currentPubId = state.publisher?.hermanoId || null;
  const resolvedSet = new Set(state.resolvedReportIds || []);

  const validRemote = normalizeReportesList(state.reportes, state.condominios, state.hermanos);
  const validLocal = normalizeReportesList(state.localPendingReports, state.condominios, state.hermanos)
    .map(r => ({ ...r, isLocalOnly: true }));

  const byDepto = new Map();
  validRemote.forEach(r => {
    if (!resolvedSet.has(r.id)) {
      byDepto.set(r.deptoId, r);
    }
  });
  validLocal.forEach(r => {
    if (!resolvedSet.has(r.id) && !byDepto.has(r.deptoId)) {
      byDepto.set(r.deptoId, r);
    }
  });

  let list = Array.from(byDepto.values());
  if (!isAdmin) {
    if (!currentPubId) return [];
    list = list.filter(r => r.hermanoId === currentPubId);
  }

  return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function getPendingReportForDepto(deptoId) {
  if (!deptoId) return null;
  return getVisiblePendingReports().find(r => r.deptoId === deptoId) || null;
}

export function getTowerStats(edificio, { forHermanoId = null } = {}) {
  const deptos = edificio?.deptos || [];
  if (forHermanoId) {
    const mine = deptos.filter(d => !d.excluido && d.asignadoId === forHermanoId);
    const pendingReports = new Set(getVisiblePendingReports().map(r => r.deptoId));
    const completados = mine.filter(d => d.estado === 'completado').length;
    const enRevision = mine.filter(d => d.estado !== 'completado' && pendingReports.has(d.id)).length;
    const pendientes = mine.length - completados - enRevision;
    const porcentaje = mine.length > 0 ? Math.round((completados / mine.length) * 100) : 0;
    return {
      total: mine.length,
      excluidos: 0,
      activos: mine.length,
      completados,
      enRevision,
      pendientes,
      asignados: mine.length,
      porcentaje
    };
  }

  const total = deptos.length;
  const excluidos = deptos.filter(d => d.excluido).length;
  const activos = deptos.filter(d => !d.excluido);
  const completados = activos.filter(d => d.estado === 'completado').length;
  const asignados = activos.filter(d => Boolean(d.asignadoId || d.asignadoA)).length;
  const pendingReports = new Set(getVisiblePendingReports().map(r => r.deptoId));
  const enRevision = activos.filter(d => d.estado !== 'completado' && pendingReports.has(d.id)).length;
  const porcentaje = activos.length > 0 ? Math.round((completados / activos.length) * 100) : 0;
  return { total, excluidos, activos: activos.length, completados, enRevision, asignados, porcentaje };
}

export function getCondoStats(condo, { forHermanoId = null } = {}) {
  const edificios = condo?.edificios || [];
  let totalDeptos = 0;
  let activos = 0;
  let completados = 0;
  let enRevision = 0;
  let excluidos = 0;
  let totalTorres = 0;

  edificios.forEach(e => {
    const s = getTowerStats(e, { forHermanoId });
    if (forHermanoId && s.activos === 0) return;
    totalTorres++;
    totalDeptos += s.total;
    activos += s.activos;
    completados += s.completados;
    enRevision += s.enRevision || 0;
    excluidos += s.excluidos;
  });

  const porcentaje = activos > 0 ? Math.round((completados / activos) * 100) : 0;
  return {
    totalTorres,
    totalDeptos,
    activos,
    completados,
    enRevision,
    excluidos,
    porcentaje
  };
}

export function getPublisherCondos(hermanoId) {
  if (!hermanoId) return [];
  return state.condominios.filter(condo =>
    condo.edificios.some(edif =>
      edif.deptos.some(d => !d.excluido && d.asignadoId === hermanoId)
    )
  );
}

export function getPublisherSummary(hermanoId) {
  let pendientes = 0;
  let enRevision = 0;
  let completados = 0;
  let fijos = 0;
  const grupos = [];
  const pendingMap = new Map(getVisiblePendingReports().map(r => [r.deptoId, r]));

  state.condominios.forEach(condo => {
    condo.edificios.forEach(edif => {
      const deptos = edif.deptos.filter(d => !d.excluido && d.asignadoId === hermanoId);
      if (deptos.length > 0) {
        deptos.forEach(d => {
          if (d.estado === 'completado') {
            completados++;
          } else if (pendingMap.has(d.id)) {
            enRevision++;
          } else {
            pendientes++;
          }
          if (d.fijo) fijos++;
        });
        grupos.push({
          condoId: condo.id,
          condoNombre: condo.nombre,
          condoDireccion: condo.direccion,
          condoNotas: condo.notas,
          edificioId: edif.id,
          edificioNombre: edif.nombre,
          deptos
        });
      }
    });
  });

  return { pendientes, enRevision, completados, fijos, total: pendientes + enRevision + completados, grupos };
}

/* ==========================================================================
   Mutaciones Administrativas Protegidas
   ========================================================================== */

export function upsertCondominioAdmin(condoId, payload) {
  assertAdmin();
  const nombre = String(payload.nombre || '').trim();
  if (!nombre) throw new Error('El nombre del condominio es obligatorio.');

  if (condoId) {
    const condo = getCondoById(condoId);
    if (!condo) throw new Error('Condominio no encontrado.');
    condo.nombre = nombre;
    condo.direccion = String(payload.direccion || '').trim();
    condo.administrador = String(payload.administrador || '').trim();
    condo.notas = String(payload.notas || '').trim();
  } else {
    state.condominios.push({
      id: generateId('condo'),
      nombre,
      direccion: String(payload.direccion || '').trim(),
      administrador: String(payload.administrador || '').trim(),
      notas: String(payload.notas || '').trim(),
      edificios: []
    });
  }
  markDirty();
  notify();
}

function resolvePendingReportsForDeptoIds(deptoIds) {
  const idSet = new Set(Array.isArray(deptoIds) ? deptoIds : [deptoIds]);
  if (idSet.size === 0) return;

  const resolvedSet = new Set(state.resolvedReportIds || []);
  (state.reportes || []).forEach(r => {
    if (idSet.has(r.deptoId)) resolvedSet.add(r.id);
  });
  state.resolvedReportIds = Array.from(resolvedSet);
  state.reportes = (state.reportes || []).filter(r => !idSet.has(r.deptoId));
  state.localPendingReports = (state.localPendingReports || []).filter(r => !idSet.has(r.deptoId));
}

export function approveReportAdmin(reportId) {
  assertAdmin();
  const report = getVisiblePendingReports().find(r => r.id === reportId);
  if (!report) return false;

  const { edificio } = getTowerByIds(report.condoId, report.edificioId);
  const depto = edificio?.deptos?.find(d => d.id === report.deptoId);
  if (depto && !depto.excluido) {
    depto.estado = 'completado';
    depto.fechaEstado = new Date().toISOString();
    if (report.nota && !depto.nota) {
      depto.nota = report.nota;
    }
  }

  if (!state.resolvedReportIds.includes(report.id)) {
    state.resolvedReportIds.push(report.id);
  }
  state.reportes = (state.reportes || []).filter(r => r.id !== report.id && r.deptoId !== report.deptoId);
  state.localPendingReports = (state.localPendingReports || []).filter(r => r.id !== report.id && r.deptoId !== report.deptoId);

  markDirty();
  notify();
  return true;
}

export function rejectReportAdmin(reportId) {
  assertAdmin();
  const report = getVisiblePendingReports().find(r => r.id === reportId);
  if (!report) return false;

  const wasRemote = (state.reportes || []).some(r => r.id === report.id);
  if (!state.resolvedReportIds.includes(report.id)) {
    state.resolvedReportIds.push(report.id);
  }
  state.reportes = (state.reportes || []).filter(r => r.id !== report.id && r.deptoId !== report.deptoId);
  state.localPendingReports = (state.localPendingReports || []).filter(r => r.id !== report.id && r.deptoId !== report.deptoId);

  if (wasRemote) {
    markDirty();
  }
  notify();
  return true;
}

export function approveAllReportsAdmin() {
  assertAdmin();
  const list = getVisiblePendingReports();
  if (list.length === 0) return 0;

  const now = new Date().toISOString();
  let count = 0;

  list.forEach(report => {
    const { edificio } = getTowerByIds(report.condoId, report.edificioId);
    const depto = edificio?.deptos?.find(d => d.id === report.deptoId);
    if (depto && !depto.excluido) {
      depto.estado = 'completado';
      depto.fechaEstado = now;
      if (report.nota && !depto.nota) {
        depto.nota = report.nota;
      }
      count++;
    }
    if (!state.resolvedReportIds.includes(report.id)) {
      state.resolvedReportIds.push(report.id);
    }
  });

  state.reportes = [];
  state.localPendingReports = [];
  markDirty();
  notify();
  return count;
}

export function deleteCondominioAdmin(condoId) {
  assertAdmin();
  const condo = getCondoById(condoId);
  if (!condo) return;
  const towerIds = new Set(condo.edificios.map(e => e.id));
  const deptoIds = condo.edificios.flatMap(e => e.deptos.map(d => d.id));
  state.condominios = state.condominios.filter(c => c.id !== condoId);
  state.hermanos.forEach(h => {
    if (towerIds.has(h.torreAsignada)) h.torreAsignada = 'todas';
  });
  resolvePendingReportsForDeptoIds(deptoIds);
  if (state.ui.condoOperativoId === condoId) {
    state.ui.condoOperativoId = null;
    state.ui.torreOperativaId = null;
  }
  markDirty();
  notify();
}

export function upsertEdificioAdmin(condoId, edificioId, payload) {
  assertAdmin();
  const condo = getCondoById(condoId);
  if (!condo) throw new Error('Condominio no encontrado.');

  const nombre = String(payload.nombre || '').trim();
  const deptosRaw = String(payload.deptosRaw || '').trim();
  if (!nombre || !deptosRaw) {
    throw new Error('Ingresa el nombre de la torre y la lista de departamentos.');
  }

  const parsedDeptos = procesarTextoDeptosYPisos(deptosRaw);
  if (parsedDeptos.length === 0) {
    throw new Error('No se encontraron departamentos válidos en el texto ingresado.');
  }

  if (edificioId) {
    const edif = condo.edificios.find(e => e.id === edificioId);
    if (!edif) throw new Error('Torre no encontrada.');
    edif.nombre = nombre;

    // Indexar por clave compuesta piso::numero para evitar sobrescrituras entre pisos (ej. 1A/2A o A/B)
    const compositeMap = new Map();
    const numCount = new Map();
    const singleNumMap = new Map();

    edif.deptos.forEach(d => {
      const k = `${d.piso}::${String(d.numero).toLowerCase()}`;
      compositeMap.set(k, d);
      const nk = String(d.numero).toLowerCase();
      numCount.set(nk, (numCount.get(nk) || 0) + 1);
      singleNumMap.set(nk, d);
    });

    edif.deptos = parsedDeptos.map(pd => {
      const compKey = `${pd.piso}::${pd.numero.toLowerCase()}`;
      const numKey = pd.numero.toLowerCase();
      const existing = compositeMap.get(compKey) || (numCount.get(numKey) === 1 ? singleNumMap.get(numKey) : null);

      if (existing) {
        existing.piso = pd.piso;
        return existing;
      }

      return {
        id: generateId('dep'),
        numero: pd.numero,
        piso: pd.piso,
        estado: 'pendiente',
        asignadoId: null,
        asignadoA: null,
        fijo: false,
        excluido: false,
        motivoExcluido: null,
        nota: '',
        fechaEstado: null
      };
    });
  } else {
    condo.edificios.push({
      id: generateId('edif'),
      nombre,
      distanciaMinima: state.configuracion.distanciaMinimaDefault ?? 2,
      deptos: parsedDeptos.map(pd => ({
        id: generateId('dep'),
        numero: pd.numero,
        piso: pd.piso,
        estado: 'pendiente',
        asignadoId: null,
        asignadoA: null,
        fijo: false,
        excluido: false,
        motivoExcluido: null,
        nota: '',
        fechaEstado: null
      }))
    });
  }

  markDirty();
  notify();
}

export function deleteEdificioAdmin(condoId, edificioId) {
  assertAdmin();
  const condo = getCondoById(condoId);
  if (!condo) return;
  const edif = condo.edificios.find(e => e.id === edificioId);
  const deptoIds = edif ? edif.deptos.map(d => d.id) : [];
  condo.edificios = condo.edificios.filter(e => e.id !== edificioId);
  state.hermanos.forEach(h => {
    if (h.torreAsignada === edificioId) h.torreAsignada = 'todas';
  });
  resolvePendingReportsForDeptoIds(deptoIds);
  if (state.ui.torreOperativaId === edificioId) {
    state.ui.torreOperativaId = null;
  }
  markDirty();
  notify();
}

export function updateDistanciaMinimaAdmin(condoId, edificioId, valor) {
  assertAdmin();
  const { edificio } = getTowerByIds(condoId, edificioId);
  if (!edificio) return;
  const parsed = parseInt(valor, 10);
  edificio.distanciaMinima = Number.isFinite(parsed) ? Math.max(0, Math.min(20, parsed)) : 0;
  markDirty();
  notify();
}

export function upsertHermanoAdmin(hermanoId, payload) {
  assertAdmin();
  const nombre = String(payload.nombre || '').trim();
  if (!nombre) throw new Error('El nombre del publicador es obligatorio.');

  const normNombre = normalizePersonName(nombre);
  const duplicate = state.hermanos.find(
    h => h.id !== hermanoId && normalizePersonName(h.nombre) === normNombre
  );
  if (duplicate) {
    throw new Error(`Ya existe un publicador registrado con el nombre "${nombre}".`);
  }

  const contacto = String(payload.contacto || '').trim();
  const torreAsignada = String(payload.torreAsignada || 'todas');
  const colorId = String(payload.colorId || 'indigo');

  if (hermanoId) {
    const h = getPublisherById(hermanoId);
    if (!h) throw new Error('Publicador no encontrado.');
    h.nombre = nombre;
    h.contacto = contacto;
    h.torreAsignada = torreAsignada;
    h.colorId = colorId;
    if (state.publisher.hermanoId === h.id) {
      state.publisher.nombre = h.nombre;
    }
  } else {
    state.hermanos.push({
      id: generateId('h'),
      nombre,
      contacto,
      torreAsignada,
      colorId
    });
  }

  markDirty();
  notify();
}

export function deleteHermanoAdmin(hermanoId) {
  assertAdmin();
  state.hermanos = state.hermanos.filter(h => h.id !== hermanoId);
  if (state.ui.selectedPublisherId === hermanoId) {
    state.ui.selectedPublisherId = '';
  }

  // Limpiar referencias en departamentos asignados
  let liberados = 0;
  const affectedDeptoIds = [];
  state.condominios.forEach(c => {
    c.edificios.forEach(e => {
      e.deptos.forEach(d => {
        if (d.asignadoId === hermanoId) {
          d.asignadoId = null;
          d.asignadoA = null;
          d.fijo = false;
          affectedDeptoIds.push(d.id);
          liberados++;
        }
      });
    });
  });

  resolvePendingReportsForDeptoIds(affectedDeptoIds);
  markDirty();
  notify();
  return liberados;
}

export function toggleEstadoDeptoAdmin(condoId, edificioId, deptoId) {
  assertAdmin();
  const { edificio } = getTowerByIds(condoId, edificioId);
  if (!edificio) return;
  const depto = edificio.deptos.find(d => d.id === deptoId);
  if (!depto || depto.excluido) return;

  const hadPending = Boolean(getPendingReportForDepto(deptoId));
  if (hadPending && depto.estado === 'pendiente') {
    depto.estado = 'completado';
    resolvePendingReportsForDeptoIds([deptoId]);
  } else {
    depto.estado = depto.estado === 'pendiente' ? 'completado' : 'pendiente';
    if (depto.estado === 'completado') {
      resolvePendingReportsForDeptoIds([deptoId]);
    }
  }
  depto.fechaEstado = new Date().toISOString();
  markDirty();
  notify();
}

export function updateDeptoDetalleAdmin(condoId, edificioId, deptoId, payload) {
  assertAdmin();
  const { edificio } = getTowerByIds(condoId, edificioId);
  if (!edificio) throw new Error('Torre no encontrada.');
  const depto = edificio.deptos.find(d => d.id === deptoId);
  if (!depto) throw new Error('Departamento no encontrado.');

  const prevAsignadoId = depto.asignadoId;
  const excluido = Boolean(payload.excluido);
  depto.excluido = excluido;
  depto.motivoExcluido = excluido ? (String(payload.motivoExcluido || 'Deshabitado').trim() || 'Deshabitado') : null;

  if (excluido) {
    depto.asignadoId = null;
    depto.asignadoA = null;
    depto.fijo = false;
  } else {
    const asignadoId = payload.asignadoId ? String(payload.asignadoId) : null;
    depto.asignadoId = asignadoId;
    depto.asignadoA = null;
    depto.fijo = Boolean(asignadoId && payload.fijo);
  }

  depto.estado = payload.estado === 'completado' ? 'completado' : 'pendiente';
  depto.nota = String(payload.nota || '').trim();
  depto.fechaEstado = new Date().toISOString();

  if (depto.excluido || depto.estado === 'completado' || depto.asignadoId !== prevAsignadoId) {
    resolvePendingReportsForDeptoIds([deptoId]);
  }

  markDirty();
  notify();
}

export function saveExclusionesAdmin(condoId, edificioId, exclusionesMap) {
  assertAdmin();
  const { edificio } = getTowerByIds(condoId, edificioId);
  if (!edificio) throw new Error('Torre no encontrada.');

  const excludedIds = [];
  edificio.deptos.forEach(d => {
    const entry = exclusionesMap[d.id];
    if (entry && entry.excluido) {
      d.excluido = true;
      d.motivoExcluido = entry.motivo || 'Deshabitado';
      d.asignadoId = null;
      d.asignadoA = null;
      d.fijo = false;
      excludedIds.push(d.id);
    } else {
      d.excluido = false;
      d.motivoExcluido = null;
    }
  });

  resolvePendingReportsForDeptoIds(excludedIds);
  markDirty();
  notify();
}

export function applyAsignacionesAdmin(condoId, edificioId, { hermanoIds, distanciaMinima, maxDeptos }) {
  assertAdmin();
  const { edificio } = getTowerByIds(condoId, edificioId);
  if (!edificio) throw new Error('Torre no encontrada.');
  if (!Array.isArray(hermanoIds) || hermanoIds.length === 0) {
    throw new Error('Selecciona al menos un publicador.');
  }

  const dist = Math.max(0, Math.min(20, parseInt(distanciaMinima, 10) || 0));
  const maxD = Math.max(1, Math.min(50, parseInt(maxDeptos, 10) || 5));
  edificio.distanciaMinima = dist;

  const resultado = distribuirDepartamentosSeguro(edificio, hermanoIds, dist, maxD);
  markDirty();
  notify();
  return resultado;
}

export function clearAsignacionesTorreAdmin(condoId, edificioId, incluirFijos = false) {
  assertAdmin();
  const { edificio } = getTowerByIds(condoId, edificioId);
  if (!edificio) return 0;

  let count = 0;
  const affectedIds = [];
  edificio.deptos.forEach(d => {
    if (d.asignadoId && (incluirFijos || !d.fijo)) {
      d.asignadoId = null;
      d.asignadoA = null;
      if (incluirFijos) d.fijo = false;
      affectedIds.push(d.id);
      count++;
    }
  });

  resolvePendingReportsForDeptoIds(affectedIds);
  markDirty();
  notify();
  return count;
}

export function resetCicloTorreAdmin(condoId, edificioId, limpiarAsignaciones = false) {
  assertAdmin();
  const { edificio } = getTowerByIds(condoId, edificioId);
  if (!edificio) return;

  const affectedIds = [];
  edificio.deptos.forEach(d => {
    if (!d.excluido) {
      d.estado = 'pendiente';
      d.fechaEstado = null;
      affectedIds.push(d.id);
      if (limpiarAsignaciones && !d.fijo) {
        d.asignadoId = null;
        d.asignadoA = null;
      }
    }
  });

  resolvePendingReportsForDeptoIds(affectedIds);
  markDirty();
  notify();
}

export function updateConfiguracionAdmin(patch) {
  assertAdmin();
  state.configuracion = {
    ...state.configuracion,
    congregacion: String(patch.congregacion ?? state.configuracion.congregacion).trim() || 'Congregación',
    tituloApp: String(patch.tituloApp ?? state.configuracion.tituloApp).trim() || 'GESTOR DE CONDOMINIOS',
    subtituloApp: String(patch.subtituloApp ?? state.configuracion.subtituloApp).trim(),
    distanciaMinimaDefault: Math.max(0, Math.min(20, parseInt(patch.distanciaMinimaDefault ?? state.configuracion.distanciaMinimaDefault, 10) || 2)),
    maxDeptosDefault: Math.max(1, Math.min(50, parseInt(patch.maxDeptosDefault ?? state.configuracion.maxDeptosDefault, 10) || 5)),
    authEndpoint: String(patch.authEndpoint ?? state.configuracion.authEndpoint ?? '').trim().replace(/\/+$/, ''),
    github: {
      owner: String(patch.github?.owner ?? state.configuracion.github?.owner ?? '').trim(),
      repo: String(patch.github?.repo ?? state.configuracion.github?.repo ?? '').trim(),
      branch: String(patch.github?.branch ?? state.configuracion.github?.branch ?? 'main').trim() || 'main'
    },
    privacidad: {
      ocultarContactoEnRepoPublico: Boolean(
        patch.privacidad?.ocultarContactoEnRepoPublico ?? state.configuracion.privacidad?.ocultarContactoEnRepoPublico ?? true
      )
    }
  };
  markDirty();
  notify();
}

export function replaceAllDataAdmin(rawDataset) {
  assertAdmin();
  const norm = normalizeDataset({
    condominios: rawDataset.condominios ?? state.condominios,
    hermanos: rawDataset.hermanos ?? state.hermanos,
    configuracion: rawDataset.configuracion ?? state.configuracion,
    reportes: rawDataset.reportes ?? state.reportes
  });

  state.condominios = norm.condominios;
  state.hermanos = norm.hermanos;
  state.configuracion = norm.configuracion;
  state.reportes = norm.reportes;
  state.resolvedReportIds = [];
  state.ui.condoOperativoId = null;
  state.ui.torreOperativaId = null;
  markDirty();
  notify();
}

