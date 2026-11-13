/**
 * Vista principal del publicador ("Mis Asignaciones") y envío de marcas tentativas
 * pendientes de revisión administrativa.
 */

import {
  getCurrentPublisher,
  getPendingReportForDepto,
  getPublisherSummary,
  getTowerByIds,
  getVisiblePendingReports,
  isAdminAuthenticated,
  isPublisherAuthenticated,
  removePendingReportForPublisher,
  setUiState,
  state,
  upsertLocalPendingReport
} from '../core/state.js';
import { showToast } from '../core/ui-feedback.js';
import { compararDeptosNatural, escapeHtml, formatDateTime, generateId } from '../core/utils.js';
import { submitPublisherReportViaProxy } from '../services/auth-proxy.js';
import { saveCachedSnapshot, saveLocalPendingReports } from '../services/storage.js';
import { abrirModalDetalleDepto } from './modals.js';
import { openTowerOperativeModal } from './territories.js';

export async function submitPublisherDeptoMark({ condoId, edificioId, deptoId, mark = true, nota = '' }) {
  const pub = getCurrentPublisher();
  if (!pub) {
    throw new Error('Debes ingresar con tu nombre y apellido para marcar departamentos.');
  }

  const { condo, edificio } = getTowerByIds(condoId, edificioId);
  const depto = edificio?.deptos?.find(d => d.id === deptoId);
  if (!condo || !edificio || !depto) {
    throw new Error('Departamento no encontrado.');
  }
  if (depto.excluido) {
    throw new Error('Este departamento está excluido.');
  }
  if (depto.asignadoId !== pub.id) {
    throw new Error('Solo puedes marcar departamentos asignados a tu nombre.');
  }
  if (mark && depto.estado === 'completado') {
    throw new Error('Este departamento ya fue finalizado de forma definitiva por administración.');
  }

  const cleanNota = String(nota || '').trim().slice(0, 240);
  const endpoint = (state.configuracion?.authEndpoint || '').trim();

  if (endpoint && navigator.onLine) {
    try {
      const res = await submitPublisherReportViaProxy({
        endpoint,
        hermanoId: pub.id,
        hermanoNombre: pub.nombre,
        condoId: condo.id,
        edificioId: edificio.id,
        deptoId: depto.id,
        action: mark ? 'mark' : 'unmark',
        nota: cleanNota
      });

      const filtered = (state.reportes || []).filter(
        r => !(r.deptoId === depto.id && r.hermanoId === pub.id)
      );
      if (mark && res.report) {
        filtered.push(res.report);
      }
      state.reportes = filtered;
      state.ui.workerOutdated = false;
      removePendingReportForPublisher(depto.id, pub.id);
      if (mark && res.report) {
        state.reportes = [...filtered];
      }
      saveLocalPendingReports(state.localPendingReports);
      saveCachedSnapshot({
        condominios: state.condominios,
        hermanos: state.hermanos,
        configuracion: state.configuracion,
        reportes: state.reportes,
        syncedAt: res.updatedAt || state.sync.lastSyncedAt
      });

      return { synced: true, action: mark ? 'marked' : 'unmarked', report: res.report || null };
    } catch (err) {
      if (err.status === 403 || err.status === 409 || err.status === 400 || err.status === 404) {
        if (err.code === 'WORKER_OUTDATED') {
          state.ui.workerOutdated = true;
        } else {
          throw err;
        }
      }
      // Error de red o worker desactualizado: guardar en respaldo local del dispositivo
      console.warn('No se pudo enviar al Worker, guardando marca local:', err);
    }
  }

  if (mark) {
    const localReport = {
      id: generateId('rep_local'),
      condoId: condo.id,
      condoNombre: condo.nombre,
      edificioId: edificio.id,
      edificioNombre: edificio.nombre,
      deptoId: depto.id,
      deptoNumero: depto.numero,
      piso: depto.piso,
      hermanoId: pub.id,
      hermanoNombre: pub.nombre,
      tipo: 'completado',
      nota: cleanNota,
      createdAt: new Date().toISOString(),
      isLocalOnly: true
    };
    upsertLocalPendingReport(localReport);
  } else {
    removePendingReportForPublisher(depto.id, pub.id);
  }
  saveLocalPendingReports(state.localPendingReports);

  return {
    synced: false,
    reason: !endpoint ? 'no-endpoint' : (state.ui.workerOutdated ? 'worker-outdated' : 'offline'),
    action: mark ? 'marked' : 'unmarked'
  };
}

export function buildWhatsAppReportText(publisherName, reportsList) {
  if (!reportsList || reportsList.length === 0) return '';
  const groups = new Map();
  reportsList.forEach(r => {
    const key = `${r.condoNombre} — ${r.edificioNombre}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  });

  const lines = [
    `Hola! Soy ${publisherName}. Ya finalicé estos departamentos (pendientes de revisión):`
  ];
  groups.forEach((items, title) => {
    const nums = items
      .map(i => ({ numero: i.deptoNumero }))
      .sort(compararDeptosNatural)
      .map(i => i.numero)
      .join(', ');
    lines.push(`• ${title}: ${nums}`);
  });
  return lines.join('\n');
}

export async function copyOrOpenWhatsAppReport(reportsList, openWhatsApp = false) {
  const pub = getCurrentPublisher();
  if (!pub || !reportsList || reportsList.length === 0) return;
  const text = buildWhatsAppReportText(pub.nombre, reportsList);

  try {
    await navigator.clipboard.writeText(text);
    showToast('Aviso copiado al portapapeles.', 'success');
  } catch {
    showToast(text, 'info', 7000);
  }

  if (openWhatsApp) {
    const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank', 'noopener');
  }
}

export function renderMyAssignmentsView() {
  const container = document.getElementById('mis-asignaciones-view');
  if (!container) return;

  const isPub = isPublisherAuthenticated();
  const isAdmin = isAdminAuthenticated();

  if (!isPub) {
    if (isAdmin) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state__icon">🔐</div>
          <p class="empty-state__text">Ingresaste directamente como administrador (${escapeHtml(state.admin.username || 'Admin')}).</p>
          <p class="field__hint">Usa la pestaña <strong>Publicadores</strong> para consultar las asignaciones de cada hermano o <strong>Cambiar de sesión</strong> para entrar con tu nombre.</p>
        </div>
      `;
    } else {
      container.innerHTML = '';
    }
    return;
  }

  const pub = getCurrentPublisher();
  if (!pub) return;

  const summary = getPublisherSummary(pub.id);
  const myPendingReports = getVisiblePendingReports().filter(r => r.hermanoId === pub.id);
  const reportByDepto = new Map(myPendingReports.map(r => [r.deptoId, r]));
  const hasLocalOnly = myPendingReports.some(r => r.isLocalOnly);
  const hasEndpoint = Boolean((state.configuracion?.authEndpoint || '').trim());

  container.innerHTML = `
    <div class="my-assignments-box" data-color="${escapeHtml(pub.colorId)}">
      <div class="my-assignments-header">
        <div style="display:flex; align-items:center; gap:0.65rem;">
          <span class="color-dot" style="margin-top:0; width:1.25rem; height:1.25rem;"></span>
          <div>
            <h2 class="section-title">Mis Asignaciones — ${escapeHtml(pub.nombre)}</h2>
            <p class="section-desc">
              Toca cualquiera de tus departamentos para ver sus detalles o marcarlo como finalizado (quedará en revisión hasta que el administrador lo apruebe).
            </p>
          </div>
        </div>

        <div class="my-assignments-actions">
          ${summary.pendientes > 0 ? `<button type="button" id="btn-my-copy-pending" class="btn btn--secondary btn--sm">📋 Copiar pendientes</button>` : ''}
          ${myPendingReports.length > 0 ? `
            <button type="button" id="btn-my-copy-wa" class="btn btn--soft btn--sm">📋 Copiar aviso</button>
            <button type="button" id="btn-my-send-wa" class="btn btn--success btn--sm">📲 Avisar por WhatsApp (${myPendingReports.length})</button>
          ` : ''}
        </div>
      </div>

      <div class="my-stats-strip">
        <div class="my-stat-pill my-stat-pill--pending">
          <span class="my-stat-pill__num">${summary.pendientes}</span>
          <span class="my-stat-pill__label">⏳ Pendientes</span>
        </div>
        <div class="my-stat-pill my-stat-pill--review">
          <span class="my-stat-pill__num">${summary.enRevision}</span>
          <span class="my-stat-pill__label">🕒 En revisión (tuyo)</span>
        </div>
        <div class="my-stat-pill my-stat-pill--done">
          <span class="my-stat-pill__num">${summary.completados}</span>
          <span class="my-stat-pill__label">✅ Finalizado definitivo</span>
        </div>
      </div>

      <div class="legend-strip">
        <span class="legend-item">📌 Asignación fija</span>
        <span class="legend-item"><span class="legend-swatch legend-swatch--review"></span> 🕒 Marcado por ti (pendiente de revisión)</span>
        <span class="legend-item"><span class="legend-swatch legend-swatch--done"></span> ✅ Finalizado definitivo (confirmado por admin)</span>
      </div>

      ${hasLocalOnly ? `
        <div class="notice-box notice-box--privacy">
          <strong>Aviso de sincronización:</strong> Tienes marcas guardadas solo en este dispositivo${!hasEndpoint ? ' (el servidor automático de reportes aún no está configurado)' : ' (sin conexión o servidor desactualizado)'}. Usa <strong>📲 Avisar por WhatsApp</strong> para notificar al administrador.
        </div>
      ` : ''}

      ${summary.grupos.length === 0 ? `
        <div class="empty-state" style="margin-top:0.5rem;">
          <div class="empty-state__icon">📭</div>
          <p class="empty-state__text">Aún no tienes departamentos asignados a tu nombre.</p>
          <p class="field__hint">Cuando el administrador te asigne departamentos en algún condominio aparecerán aquí automáticamente.</p>
        </div>
      ` : `
        <div class="my-groups-list">
          ${summary.grupos.map(g => {
            const sorted = [...g.deptos].sort(compararDeptosNatural);
            const gDone = sorted.filter(d => d.estado === 'completado').length;
            const gReview = sorted.filter(d => d.estado !== 'completado' && reportByDepto.has(d.id)).length;
            const gPending = sorted.length - gDone - gReview;

            return `
              <article class="assignment-group-card">
                <div class="assignment-group-card__head">
                  <div>
                    <h3 class="assignment-group-card__title">${escapeHtml(g.condoNombre)} — ${escapeHtml(g.edificioNombre)}</h3>
                    ${g.condoDireccion ? `<p class="field__hint">${escapeHtml(g.condoDireccion)}</p>` : ''}
                    ${g.condoNotas ? `<p class="field__hint" style="color:var(--color-primary-dark); margin-top:0.2rem;">📝 ${escapeHtml(g.condoNotas)}</p>` : ''}
                    <p class="field__hint" style="margin-top:0.25rem;">
                      ${gPending} pendientes • ${gReview} en revisión • ${gDone} finalizados
                    </p>
                  </div>
                  <button type="button" class="btn btn--secondary btn--sm" data-my-jump-tower="${escapeHtml(g.condoId)}::${escapeHtml(g.edificioId)}">
                    🗺️ Ver mapa de la torre ➔
                  </button>
                </div>

                <div class="my-apt-grid">
                  ${sorted.map(d => {
                    const isDone = d.estado === 'completado';
                    const report = !isDone ? (reportByDepto.get(d.id) || getPendingReportForDepto(d.id)) : null;
                    const isReported = Boolean(report);
                    const classes = [
                      'my-apt-tile',
                      isDone ? 'is-completed' : (isReported ? 'is-user-reported' : 'is-pending')
                    ].join(' ');

                    const statusText = isDone
                      ? '✅ Finalizado'
                      : (isReported
                        ? (report.isLocalOnly ? '📱 Guardado local' : '🕒 En revisión')
                        : '⏳ Pendiente');

                    return `
                      <button type="button"
                        class="${classes}"
                        data-my-open-depto="${escapeHtml(g.condoId)}::${escapeHtml(g.edificioId)}::${escapeHtml(d.id)}"
                        title="${isReported && report?.createdAt ? `Reportado el ${escapeHtml(formatDateTime(report.createdAt))}` : 'Tocar para ver o marcar'}">
                        <span class="my-apt-tile__num">${escapeHtml(d.numero)}${d.fijo ? ' 📌' : ''}</span>
                        <span class="my-apt-tile__status">${statusText}</span>
                      </button>
                    `;
                  }).join('')}
                </div>
              </article>
            `;
          }).join('')}
        </div>
      `}
    </div>
  `;

  document.getElementById('btn-my-copy-pending')?.addEventListener('click', async () => {
    const lines = [`Asignaciones pendientes de ${pub.nombre}:`];
    summary.grupos.forEach(g => {
      const pend = [...g.deptos]
        .filter(d => d.estado !== 'completado' && !reportByDepto.has(d.id))
        .sort(compararDeptosNatural)
        .map(d => d.numero);
      if (pend.length > 0) {
        lines.push(`• ${g.condoNombre} (${g.edificioNombre}): ${pend.join(', ')}`);
      }
    });
    if (lines.length === 1) lines.push('No quedan departamentos pendientes.');
    const text = lines.join('\n');
    try {
      await navigator.clipboard.writeText(text);
      showToast('Lista de pendientes copiada.', 'success');
    } catch {
      showToast(text, 'info', 7000);
    }
  });

  document.getElementById('btn-my-copy-wa')?.addEventListener('click', () => {
    copyOrOpenWhatsAppReport(myPendingReports, false);
  });

  document.getElementById('btn-my-send-wa')?.addEventListener('click', () => {
    copyOrOpenWhatsAppReport(myPendingReports, true);
  });

  container.querySelectorAll('[data-my-jump-tower]').forEach(btn => {
    btn.addEventListener('click', () => {
      const [condoId, edificioId] = btn.dataset.myJumpTower.split('::');
      setUiState({ activeTab: 'territorios' });
      openTowerOperativeModal(condoId, edificioId);
    });
  });

  container.querySelectorAll('[data-my-open-depto]').forEach(btn => {
    btn.addEventListener('click', () => {
      const [condoId, edificioId, deptoId] = btn.dataset.myOpenDepto.split('::');
      abrirModalDetalleDepto(condoId, edificioId, deptoId);
    });
  });
}

