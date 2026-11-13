/**
 * Utilidades compartidas: sanitización XSS, generación de IDs,
 * parseo de pisos/departamentos, paleta de colores y formateo.
 */

export const PALETA_COLORES = [
  { id: 'indigo',  nombre: 'Índigo',    legacyClase: 'bg-indigo-100 border-indigo-300 text-indigo-900' },
  { id: 'emerald', nombre: 'Esmeralda', legacyClase: 'bg-emerald-100 border-emerald-300 text-emerald-900' },
  { id: 'amber',   nombre: 'Ámbar',     legacyClase: 'bg-amber-100 border-amber-300 text-amber-900' },
  { id: 'rose',    nombre: 'Rosa',      legacyClase: 'bg-rose-100 border-rose-300 text-rose-900' },
  { id: 'cyan',    nombre: 'Cian',      legacyClase: 'bg-cyan-100 border-cyan-300 text-cyan-900' },
  { id: 'purple',  nombre: 'Púrpura',   legacyClase: 'bg-purple-100 border-purple-300 text-purple-900' },
  { id: 'blue',    nombre: 'Azul',      legacyClase: 'bg-blue-100 border-blue-300 text-blue-900' },
  { id: 'violet',  nombre: 'Violeta',   legacyClase: 'bg-violet-100 border-violet-300 text-violet-900' },
  { id: 'orange',  nombre: 'Naranja',   legacyClase: 'bg-orange-100 border-orange-300 text-orange-900' },
  { id: 'lime',    nombre: 'Lima',      legacyClase: 'bg-lime-100 border-lime-300 text-lime-900' },
  { id: 'fuchsia', nombre: 'Fucsia',    legacyClase: 'bg-fuchsia-100 border-fuchsia-300 text-fuchsia-900' },
  { id: 'slate',   nombre: 'Pizarra',   legacyClase: 'bg-slate-200 border-slate-400 text-slate-900' }
];

const HTML_ESCAPE_MAP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
};

/**
 * Escapa caracteres peligrosos para prevenir inyección XSS al usar plantillas HTML.
 */
export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, ch => HTML_ESCAPE_MAP[ch]);
}

/**
 * Genera identificadores únicos resistentes a colisiones rápidas.
 */
export function generateId(prefix = 'id') {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID().slice(0, 12)}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Resuelve el ID de color semántico soportando registros antiguos de la v0.2.2.
 */
export function resolveColorId(hermano) {
  if (!hermano) return 'indigo';
  if (hermano.colorId && PALETA_COLORES.some(c => c.id === hermano.colorId)) {
    return hermano.colorId;
  }
  if (hermano.colorClase) {
    const found = PALETA_COLORES.find(c => c.legacyClase === hermano.colorClase);
    if (found) return found.id;
    const match = String(hermano.colorClase).match(/bg-([a-z]+)-/);
    if (match && PALETA_COLORES.some(c => c.id === match[1])) {
      return match[1];
    }
  }
  return 'indigo';
}

export function extraerPiso(numStr) {
  const match = String(numStr).match(/\d+/);
  if (!match) return 1;
  const val = parseInt(match[0], 10);
  return val >= 100 ? Math.floor(val / 100) : 1;
}

export function extraerNumeroDepto(numStr) {
  const match = String(numStr).match(/\d+/);
  return match ? parseInt(match[0], 10) : 0;
}

export function compararDeptosNatural(a, b) {
  return String(a.numero).localeCompare(String(b.numero), 'es', { numeric: true, sensitivity: 'base' });
}

export function agruparPorPiso(deptos) {
  const grupos = {};
  (deptos || []).forEach(d => {
    const piso = Number.isFinite(Number(d.piso)) ? Number(d.piso) : extraerPiso(d.numero);
    if (!grupos[piso]) grupos[piso] = [];
    grupos[piso].push(d);
  });
  return grupos;
}

/**
 * Parsea texto libre o líneas "Piso X: 101, 102, 103", evitando duplicados en un mismo piso.
 */
export function procesarTextoDeptosYPisos(texto) {
  const lineas = String(texto || '')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0);

  const deptosResultantes = [];
  const seenKeys = new Set();

  lineas.forEach(linea => {
    let numeroPiso = null;
    let contenido = linea;

    if (linea.toLowerCase().includes('piso') && linea.includes(':')) {
      const idx = linea.indexOf(':');
      const encabezado = linea.slice(0, idx);
      const matchPiso = encabezado.match(/-?\d+/);
      if (matchPiso) numeroPiso = parseInt(matchPiso[0], 10);
      contenido = linea.slice(idx + 1);
    }

    const deptosEnLinea = contenido
      .split(/[,;]+/)
      .map(d => d.trim())
      .filter(d => d.length > 0);

    deptosEnLinea.forEach(numStr => {
      const pisoFinal = numeroPiso !== null ? numeroPiso : extraerPiso(numStr);
      const key = `${pisoFinal}::${numStr.toLowerCase()}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        deptosResultantes.push({
          numero: numStr,
          piso: pisoFinal
        });
      }
    });
  });

  return deptosResultantes;
}

/**
 * Genera texto formateado por pisos para facilitar el ingreso rápido de torres grandes.
 */
export function generarTextoPisos(pisoInicio, pisoFin, cantidadPorPiso, estilo = 'centena') {
  const inicio = Math.max(1, Math.min(99, parseInt(pisoInicio, 10) || 1));
  const fin = Math.max(inicio, Math.min(99, parseInt(pisoFin, 10) || inicio));
  const cant = Math.max(1, Math.min(30, parseInt(cantidadPorPiso, 10) || 4));
  const letras = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lineas = [];

  for (let p = inicio; p <= fin; p++) {
    const items = [];
    for (let i = 1; i <= cant; i++) {
      if (estilo === 'letras') {
        const letra = i <= letras.length ? letras[i - 1] : `D${i}`;
        items.push(`${p}${letra}`);
      } else {
        const sufijo = i < 10 ? `0${i}` : `${i}`;
        items.push(`${p}${sufijo}`);
      }
    }
    lineas.push(`Piso ${p}: ${items.join(', ')}`);
  }

  return lineas.join('\n');
}

export function formatDateTime(isoString) {
  if (!isoString) return 'Sin registros';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return 'Fecha inválida';
  try {
    return new Intl.DateTimeFormat('es', {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(date);
  } catch {
    return date.toLocaleString();
  }
}

export function isLocalDevEnvironment() {
  const host = window.location.hostname;
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}

export function cloneDeep(obj) {
  return JSON.parse(JSON.stringify(obj));
}

export function normalizePersonName(value) {
  return String(value || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function stripHonorificPrefix(norm) {
  return norm.replace(/^(?:hno|hna)\.?\s+/i, '').trim();
}

export function personNamesMatch(a, b) {
  const na = normalizePersonName(a);
  const nb = normalizePersonName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const sa = stripHonorificPrefix(na);
  const sb = stripHonorificPrefix(nb);
  return Boolean(sa && sb && sa === sb);
}

export function findMatchingPublisher(hermanos, inputName) {
  if (!Array.isArray(hermanos) || !inputName) return null;
  const exact = hermanos.find(h => normalizePersonName(h?.nombre) === normalizePersonName(inputName));
  if (exact) return exact;
  return hermanos.find(h => personNamesMatch(h?.nombre, inputName)) || null;
}

