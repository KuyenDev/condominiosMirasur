/**
 * Algoritmo de distribución equitativa de departamentos con respeto de
 * exclusiones, asignaciones fijas, límite máximo por publicador y distancia mínima.
 */

import { compararDeptosNatural, extraerNumeroDepto } from '../core/utils.js';

function buildMetricMap(deptos) {
  const ordered = [...deptos].sort(compararDeptosNatural);
  const rawNums = ordered.map(d => extraerNumeroDepto(d.numero));
  const uniqueRaw = new Set(rawNums.filter(n => n > 0));
  const hasNumericDuplicates = rawNums.some(n => n === 0) || uniqueRaw.size < Math.max(1, ordered.length * 0.7);

  const metricMap = new Map();
  if (!hasNumericDuplicates) {
    ordered.forEach(d => metricMap.set(d.id, extraerNumeroDepto(d.numero)));
    return metricMap;
  }

  // Respaldo ordenado por piso + posición cuando la numeración es alfanumérica (ej. 1A, 1B)
  const floorCounters = {};
  ordered.forEach(d => {
    const piso = Number(d.piso) || 1;
    floorCounters[piso] = (floorCounters[piso] || 0) + 1;
    metricMap.set(d.id, piso * 100 + floorCounters[piso]);
  });
  return metricMap;
}

/**
 * Asigna departamentos disponibles de forma balanceada entre los publicadores elegidos.
 * @param {object} edificio - Objeto torre con propiedad deptos[]
 * @param {string[]} hermanoIds - IDs de hermanos participantes
 * @param {number} distanciaMin - Distancia mínima entre departamentos de un mismo hermano
 * @param {number} limiteMax - Máximo total de departamentos por hermano en esta torre
 * @returns {{ asignados: number, omitidos: number, porHermano: Record<string, number> }}
 */
export function distribuirDepartamentosSeguro(edificio, hermanoIds, distanciaMin, limiteMax) {
  const deptos = edificio.deptos || [];
  const metricMap = buildMetricMap(deptos);

  const conteoConseguido = {};
  const asignadosPorHermano = {};
  const nuevosPorHermano = {};

  deptos.forEach(d => {
    if (d.asignadoId && !d.excluido) {
      if (!asignadosPorHermano[d.asignadoId]) {
        asignadosPorHermano[d.asignadoId] = [];
        conteoConseguido[d.asignadoId] = 0;
      }
      asignadosPorHermano[d.asignadoId].push(metricMap.get(d.id) ?? 0);
      conteoConseguido[d.asignadoId]++;
    }
  });

  hermanoIds.forEach(hId => {
    if (!conteoConseguido[hId]) {
      conteoConseguido[hId] = 0;
      asignadosPorHermano[hId] = [];
    }
    nuevosPorHermano[hId] = 0;
  });

  const deptosDisponibles = deptos
    .filter(d => !d.excluido && !d.fijo && !d.asignadoId)
    .sort((a, b) => {
      const pisoDiff = (Number(a.piso) || 0) - (Number(b.piso) || 0);
      if (pisoDiff !== 0) return pisoDiff;
      return compararDeptosNatural(a, b);
    });

  let asignados = 0;
  let rotacion = 0;

  for (const depto of deptosDisponibles) {
    const valDepto = metricMap.get(depto.id) ?? 0;

    // Candidatos que cumplen límite y distancia mínima
    const candidatos = [];
    for (let i = 0; i < hermanoIds.length; i++) {
      const idx = (rotacion + i) % hermanoIds.length;
      const hId = hermanoIds[idx];
      if (conteoConseguido[hId] >= limiteMax) continue;

      const cumpleDistancia = asignadosPorHermano[hId].every(
        numExistente => Math.abs(numExistente - valDepto) >= distanciaMin
      );

      if (cumpleDistancia) {
        candidatos.push({ hId, count: conteoConseguido[hId], order: i });
      }
    }

    if (candidatos.length === 0) continue;

    // Elegir al candidato con menor carga actual (equitativo)
    candidatos.sort((a, b) => (a.count - b.count) || (a.order - b.order));
    const elegido = candidatos[0].hId;

    depto.asignadoId = elegido;
    depto.asignadoA = null;
    asignadosPorHermano[elegido].push(valDepto);
    conteoConseguido[elegido]++;
    nuevosPorHermano[elegido]++;
    asignados++;
    rotacion = (hermanoIds.indexOf(elegido) + 1) % hermanoIds.length;
  }

  return {
    asignados,
    omitidos: deptosDisponibles.length - asignados,
    porHermano: nuevosPorHermano
  };
}

