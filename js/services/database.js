/**
 * Servicio de lectura, validación, exportación e importación de archivos JSON.
 */

import { DEFAULT_CONFIG, normalizeDataset } from '../core/state.js';
import { cloneDeep, generateId } from '../core/utils.js';

async function fetchJsonSafe(relativePath) {
  const url = `${relativePath}?t=${Date.now()}`;
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} al leer ${relativePath}`);
  }
  return response.json();
}

/**
 * Carga los archivos JSON oficiales desde ./data/ usando rutas relativas.
 */
export async function loadRemoteJsonFiles() {
  const [condosRes, hermanosRes, configRes] = await Promise.all([
    fetchJsonSafe('./data/condominios.json'),
    fetchJsonSafe('./data/hermanos.json'),
    fetchJsonSafe('./data/configuracion.json').catch(() => cloneDeep(DEFAULT_CONFIG))
  ]);

  const condominios = Array.isArray(condosRes) ? condosRes : (condosRes?.condominios || []);
  const hermanos = Array.isArray(hermanosRes) ? hermanosRes : (hermanosRes?.hermanos || []);
  const configuracion = configRes && typeof configRes === 'object' ? configRes : cloneDeep(DEFAULT_CONFIG);

  const remoteUpdatedAt = condosRes?.updatedAt || hermanosRes?.updatedAt || configuracion?.updatedAt || null;

  return {
    condominios,
    hermanos,
    configuracion,
    remoteUpdatedAt
  };
}

/**
 * Construye los 3 documentos JSON listos para guardar en data/.
 * Si sanitizePublicPrivacy es true, omite datos personales sensibles (ej. teléfonos).
 */
export function buildDataPayloads(stateSnapshot, { sanitizePublicPrivacy = false } = {}) {
  const now = new Date().toISOString();

  const hermanosSanitized = (stateSnapshot.hermanos || []).map(h => {
    const item = {
      id: h.id,
      nombre: h.nombre,
      torreAsignada: h.torreAsignada || 'todas',
      colorId: h.colorId || 'indigo'
    };
    if (!sanitizePublicPrivacy && h.contacto) {
      item.contacto = h.contacto;
    }
    return item;
  });

  const condominiosPayload = {
    version: 1,
    updatedAt: now,
    condominios: cloneDeep(stateSnapshot.condominios || [])
  };

  const hermanosPayload = {
    version: 1,
    updatedAt: now,
    hermanos: hermanosSanitized
  };

  const configuracionPayload = {
    ...cloneDeep(stateSnapshot.configuracion || DEFAULT_CONFIG),
    version: 1,
    updatedAt: now
  };

  return {
    condominiosPayload,
    hermanosPayload,
    configuracionPayload,
    updatedAt: now
  };
}

/**
 * Valida e interpreta un JSON de respaldo importado (completo, v1 o heredado v0.2.2).
 */
export function parseImportedBackup(rawText) {
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error('El archivo seleccionado no contiene JSON válido.');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Estructura de archivo no reconocida.');
  }

  // Formato respaldo completo o parcial
  if (Array.isArray(parsed.condominios) || Array.isArray(parsed.hermanos)) {
    const normalized = normalizeDataset({
      condominios: parsed.condominios || [],
      hermanos: parsed.hermanos || [],
      configuracion: parsed.configuracion || null
    });
    return normalized;
  }

  // Formato heredado: arreglo directo de condominios o hermanos
  if (Array.isArray(parsed)) {
    const looksLikeHermanos = parsed.length > 0 && ('colorClase' in parsed[0] || 'colorId' in parsed[0]);
    if (looksLikeHermanos) {
      return normalizeDataset({ hermanos: parsed });
    }
    return normalizeDataset({ condominios: parsed });
  }

  throw new Error('El JSON no contiene propiedades "condominios" ni "hermanos" válidas.');
}

export function triggerJsonDownload(filename, dataObj) {
  const json = JSON.stringify(dataObj, null, 2);
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Genera datos ficticios ilustrativos (sin información personal real) para pruebas rápidas.
 */
export function buildSampleDataset(currentConfig) {
  const h1 = generateId('h');
  const h2 = generateId('h');
  const h3 = generateId('h');
  const e1 = generateId('edif');
  const e2 = generateId('edif');

  return {
    hermanos: [
      { id: h1, nombre: 'Hno. Ejemplo A', contacto: '', torreAsignada: 'todas', colorId: 'indigo' },
      { id: h2, nombre: 'Hna. Ejemplo B', contacto: '', torreAsignada: 'todas', colorId: 'emerald' },
      { id: h3, nombre: 'Hno. Ejemplo C', contacto: '', torreAsignada: e1, colorId: 'amber' }
    ],
    condominios: [
      {
        id: generateId('condo'),
        nombre: 'Condominio Ejemplo Mirador',
        direccion: 'Calle Ficticia 100 (Demo)',
        administrador: 'Conserjería Central',
        notas: 'Datos ilustrativos de demostración.',
        edificios: [
          {
            id: e1,
            nombre: 'Torre A',
            distanciaMinima: 2,
            deptos: [
              { id: generateId('dep'), numero: '101', piso: 1, estado: 'completado', asignadoId: h1, asignadoA: null, fijo: false, excluido: false, motivoExcluido: null, nota: '', fechaEstado: null },
              { id: generateId('dep'), numero: '102', piso: 1, estado: 'pendiente', asignadoId: h2, asignadoA: null, fijo: false, excluido: false, motivoExcluido: null, nota: '', fechaEstado: null },
              { id: generateId('dep'), numero: '103', piso: 1, estado: 'pendiente', asignadoId: h1, asignadoA: null, fijo: true, excluido: false, motivoExcluido: null, nota: 'Asignación fija de ejemplo', fechaEstado: null },
              { id: generateId('dep'), numero: '104', piso: 1, estado: 'pendiente', asignadoId: null, asignadoA: null, fijo: false, excluido: true, motivoExcluido: 'Deshabitado', nota: '', fechaEstado: null },
              { id: generateId('dep'), numero: '201', piso: 2, estado: 'pendiente', asignadoId: h3, asignadoA: null, fijo: false, excluido: false, motivoExcluido: null, nota: '', fechaEstado: null },
              { id: generateId('dep'), numero: '202', piso: 2, estado: 'pendiente', asignadoId: h2, asignadoA: null, fijo: false, excluido: false, motivoExcluido: null, nota: '', fechaEstado: null },
              { id: generateId('dep'), numero: '203', piso: 2, estado: 'pendiente', asignadoId: h3, asignadoA: null, fijo: false, excluido: false, motivoExcluido: null, nota: '', fechaEstado: null },
              { id: generateId('dep'), numero: '204', piso: 2, estado: 'pendiente', asignadoId: null, asignadoA: null, fijo: false, excluido: false, motivoExcluido: null, nota: '', fechaEstado: null }
            ]
          },
          {
            id: e2,
            nombre: 'Torre B',
            distanciaMinima: 2,
            deptos: [
              { id: generateId('dep'), numero: '101', piso: 1, estado: 'pendiente', asignadoId: null, asignadoA: null, fijo: false, excluido: false, motivoExcluido: null, nota: '', fechaEstado: null },
              { id: generateId('dep'), numero: '102', piso: 1, estado: 'pendiente', asignadoId: null, asignadoA: null, fijo: false, excluido: false, motivoExcluido: null, nota: '', fechaEstado: null },
              { id: generateId('dep'), numero: '201', piso: 2, estado: 'pendiente', asignadoId: null, asignadoA: null, fijo: false, excluido: false, motivoExcluido: null, nota: '', fechaEstado: null },
              { id: generateId('dep'), numero: '202', piso: 2, estado: 'pendiente', asignadoId: null, asignadoA: null, fijo: false, excluido: false, motivoExcluido: null, nota: '', fechaEstado: null }
            ]
          }
        ]
      }
    ],
    configuracion: currentConfig
  };
}

