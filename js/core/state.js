/**
 * Estado central de la aplicación, normalización/migración de datos
 * y operaciones protegidas por autorización administrativa.
 */

import {
  cloneDeep,
  extraerPiso,
  generateId,
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
  ui: {
    activeTab: 'territorios',
    searchCondo: '',
    searchHermano: '',
    selectedPublisherId: '',
    condoOperativoId: null,
    torreOperativaId: null,
    towerClickMode: 'toggle' // 'toggle' | 'detail'
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
  admin: {
    authenticated: false,
    mode: null, // 'github' | 'local-dev' | null
    username: null,
    canPush: false
  },
  localProgress: {} // { [deptoId]: boolean } - seguimiento personal en dispositivo de consulta
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
  return Boolean(state.admin.authenticated && (state.admin.mode === 'github' || state.admin.mode === 'local-dev'));
}

function assertAdmin() {
  if (!isAdminAuthenticated()) {
    throw new Error('Acceso denegado: debes iniciar sesión en el Panel de Administración.');
  }
}

function markDirty() {
  state.sync.dirtyCount += 1;
}

/**
 * Normaliza datos provenientes de JSON v1 o de la versión heredada v0.2.2.
 */
export function normalizeDataset({ condominios = [], hermanos = [], configuracion = null } = {}) {
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

  return {
    condominios: normalizedCondos,
    hermanos: normalizedHermanos,
    configuracion: safeConfig
  };
}

export function setInitialDataset(rawData, syncPatch = {}) {
  const norm = normalizeDataset(rawData);
  state.condominios = norm.condominios;
  state.hermanos = norm.hermanos;
  state.configuracion = norm.configuracion;
  Object.assign(state.sync, syncPatch);
  notify();
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
  }
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

export function getTowerStats(edificio) {
  const deptos = edificio?.deptos || [];
  const total = deptos.length;
  const excluidos = deptos.filter(d => d.excluido).length;
  const activos = deptos.filter(d => !d.excluido);
  const completados = activos.filter(d => d.estado === 'completado').length;
  const asignados = activos.filter(d => Boolean(d.asignadoId || d.asignadoA)).length;
  const porcentaje = activos.length > 0 ? Math.round((completados / activos.length) * 100) : 0;
  return { total, excluidos, activos: activos.length, completados, asignados, porcentaje };
}

export function getCondoStats(condo) {
  const edificios = condo?.edificios || [];
  let totalDeptos = 0;
  let activos = 0;
  let completados = 0;
  let excluidos = 0;

  edificios.forEach(e => {
    const s = getTowerStats(e);
    totalDeptos += s.total;
    activos += s.activos;
    completados += s.completados;
    excluidos += s.excluidos;
  });

  const porcentaje = activos > 0 ? Math.round((completados / activos) * 100) : 0;
  return {
    totalTorres: edificios.length,
    totalDeptos,
    activos,
    completados,
    excluidos,
    porcentaje
  };
}

export function getPublisherSummary(hermanoId) {
  let pendientes = 0;
  let completados = 0;
  let fijos = 0;
  const grupos = [];

  state.condominios.forEach(condo => {
    condo.edificios.forEach(edif => {
      const deptos = edif.deptos.filter(d => !d.excluido && d.asignadoId === hermanoId);
      if (deptos.length > 0) {
        deptos.forEach(d => {
          if (d.estado === 'completado') completados++;
          else pendientes++;
          if (d.fijo) fijos++;
        });
        grupos.push({
          condoId: condo.id,
          condoNombre: condo.nombre,
          condoDireccion: condo.direccion,
          edificioId: edif.id,
          edificioNombre: edif.nombre,
          deptos
        });
      }
    });
  });

  return { pendientes, completados, fijos, total: pendientes + completados, grupos };
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

export function deleteCondominioAdmin(condoId) {
  assertAdmin();
  const condo = getCondoById(condoId);
  if (!condo) return;
  const towerIds = new Set(condo.edificios.map(e => e.id));
  state.condominios = state.condominios.filter(c => c.id !== condoId);
  state.hermanos.forEach(h => {
    if (towerIds.has(h.torreAsignada)) h.torreAsignada = 'todas';
  });
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
  condo.edificios = condo.edificios.filter(e => e.id !== edificioId);
  state.hermanos.forEach(h => {
    if (h.torreAsignada === edificioId) h.torreAsignada = 'todas';
  });
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

  const duplicate = state.hermanos.find(
    h => h.id !== hermanoId && h.nombre.toLowerCase() === nombre.toLowerCase()
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
  state.condominios.forEach(c => {
    c.edificios.forEach(e => {
      e.deptos.forEach(d => {
        if (d.asignadoId === hermanoId) {
          d.asignadoId = null;
          d.asignadoA = null;
          d.fijo = false;
          liberados++;
        }
      });
    });
  });

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

  depto.estado = depto.estado === 'pendiente' ? 'completado' : 'pendiente';
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

  markDirty();
  notify();
}

export function saveExclusionesAdmin(condoId, edificioId, exclusionesMap) {
  assertAdmin();
  const { edificio } = getTowerByIds(condoId, edificioId);
  if (!edificio) throw new Error('Torre no encontrada.');

  edificio.deptos.forEach(d => {
    const entry = exclusionesMap[d.id];
    if (entry && entry.excluido) {
      d.excluido = true;
      d.motivoExcluido = entry.motivo || 'Deshabitado';
      d.asignadoId = null;
      d.asignadoA = null;
      d.fijo = false;
    } else {
      d.excluido = false;
      d.motivoExcluido = null;
    }
  });

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
  edificio.deptos.forEach(d => {
    if (d.asignadoId && (incluirFijos || !d.fijo)) {
      d.asignadoId = null;
      d.asignadoA = null;
      if (incluirFijos) d.fijo = false;
      count++;
    }
  });

  markDirty();
  notify();
  return count;
}

export function resetCicloTorreAdmin(condoId, edificioId, limpiarAsignaciones = false) {
  assertAdmin();
  const { edificio } = getTowerByIds(condoId, edificioId);
  if (!edificio) return;

  edificio.deptos.forEach(d => {
    if (!d.excluido) {
      d.estado = 'pendiente';
      d.fechaEstado = null;
      if (limpiarAsignaciones && !d.fijo) {
        d.asignadoId = null;
        d.asignadoA = null;
      }
    }
  });

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
    configuracion: rawDataset.configuracion ?? state.configuracion
  });

  state.condominios = norm.condominios;
  state.hermanos = norm.hermanos;
  state.configuracion = norm.configuracion;
  state.ui.condoOperativoId = null;
  state.ui.torreOperativaId = null;
  markDirty();
  notify();
}

