/**
 * Renderizado e interacciones de Territorios:
 * - Directorio de Condominios
 * - Panel operativo de Condominio (Torres)
 * - Panel operativo de Torre (Mapa por pisos + asignaciones)
 */

import {
  deleteCondominioAdmin,
  deleteEdificioAdmin,
  getCondoById,
  getCondoStats,
  getCurrentPublisher,
  getPublisherById,
  getPublisherCondos,
  getTowerByIds,
  getTowerStats,
  getVisiblePendingReports,
  isAdminAuthenticated,
  resetCicloTorreAdmin,
  setUiState,
  state,
  toggleEstadoDeptoAdmin,
  updateDistanciaMinimaAdmin
} from '../core/state.js';
import { confirmAction, showToast, syncBodyScrollLock } from '../core/ui-feedback.js';
import { agruparPorPiso, compararDeptosNatural, escapeHtml } from '../core/utils.js';
import {
  abrirModalAsignacion,
  abrirModalCondominio,
  abrirModalDetalleDepto,
  abrirModalEdificio,
  abrirModalExcluidos
} from './modals.js';
import { copyOrOpenWhatsAppReport } from './my-assignments.js';

export function openCondoOperativeModal(condoId) {
  setUiState({ condoOperativoId: condoId });
  document.getElementById('modal-condo-operativo')?.classList.remove('hidden');
  syncBodyScrollLock();
}

export function closeCondoOperativeModal() {
  setUiState({ condoOperativoId: null, torreOperativaId: null });
  document.getElementById('modal-condo-operativo')?.classList.add('hidden');
  document.getElementById('modal-torre-operativo')?.classList.add('hidden');
  syncBodyScrollLock();
}

export function openTowerOperativeModal(condoId, edificioId) {
  setUiState({ condoOperativoId: condoId, torreOperativaId: edificioId });
  document.getElementById('modal-torre-operativo')?.classList.remove('hidden');
  syncBodyScrollLock();
}

export function closeTowerOperativeModal() {
  setUiState({ torreOperativaId: null });
  document.getElementById('modal-torre-operativo')?.classList.add('hidden');
  syncBodyScrollLock();
}

export function renderTerritoriesDirectory() {
  const container = document.getElementById('app-container');
  const btnNewCondo = document.getElementById('btn-nuevo-condominio');
  const titleEl = document.getElementById('territorios-section-title');
  const descEl = document.getElementById('territorios-section-desc');
  const isAdmin = isAdminAuthenticated();
  const currentPub = !isAdmin ? getCurrentPublisher() : null;

  if (btnNewCondo) {
    btnNewCondo.classList.toggle('hidden', !isAdmin);
  }
  if (titleEl) {
    titleEl.textContent = isAdmin ? 'Directorio de Condominios' : 'Mis Torres y Condominios';
  }
  if (descEl) {
    descEl.textContent = isAdmin
      ? 'Selecciona un condominio para ver sus torres, pisos y departamentos asignados.'
      : 'Aquí ves únicamente los condominios y torres donde tienes departamentos asignados.';
  }

  if (!container) return;

  const baseCondos = isAdmin
    ? state.condominios
    : (currentPub ? getPublisherCondos(currentPub.id) : []);

  const query = (state.ui.searchCondo || '').trim().toLowerCase();
  const filtered = baseCondos.filter(c => {
    if (!query) return true;
    return (
      c.nombre.toLowerCase().includes(query) ||
      (c.direccion || '').toLowerCase().includes(query) ||
      (isAdmin && (c.administrador || '').toLowerCase().includes(query))
    );
  });

  if (baseCondos.length === 0) {
    container.className = '';
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state__icon">🏢</div>
        <p class="empty-state__text">${isAdmin ? 'No hay condominios registrados aún.' : 'Aún no tienes torres ni condominios asignados.'}</p>
        ${isAdmin
          ? `<button type="button" id="btn-empty-new-condo" class="btn btn--primary">Crear el primer condominio</button>`
          : `<p class="field__hint">Cuando el administrador te asigne departamentos en una torre aparecerá aquí para verla en mapa.</p>`}
      </div>
    `;
    document.getElementById('btn-empty-new-condo')?.addEventListener('click', () => abrirModalCondominio());
    return;
  }

  if (filtered.length === 0) {
    container.className = '';
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state__icon">🔍</div>
        <p class="empty-state__text">No se encontraron condominios que coincidan con "${escapeHtml(state.ui.searchCondo)}".</p>
      </div>
    `;
    return;
  }

  const pendingReports = getVisiblePendingReports();
  const pendingByCondo = new Map();
  pendingReports.forEach(r => {
    pendingByCondo.set(r.condoId, (pendingByCondo.get(r.condoId) || 0) + 1);
  });

  container.className = 'cards-grid';
  container.innerHTML = filtered.map(condo => {
    const stats = getCondoStats(condo, { forHermanoId: currentPub?.id || null });
    const doneClass = stats.porcentaje === 100 && stats.activos > 0 ? 'progress-fill--done' : '';
    const reviewCount = pendingByCondo.get(condo.id) || 0;

    return `
      <article class="entity-card" tabindex="0" role="button" data-open-condo="${escapeHtml(condo.id)}" aria-label="Abrir ${escapeHtml(condo.nombre)}">
        <div style="display:flex; flex-direction:column; gap:0.85rem;">
          <div class="entity-card__head">
            <div style="min-width:0;">
              <h3 class="entity-card__title">${escapeHtml(condo.nombre)}</h3>
              <p class="entity-card__subtitle">${escapeHtml(condo.direccion || 'Sin dirección registrada')}</p>
            </div>
            <div style="display:flex; flex-direction:column; align-items:flex-end; gap:0.3rem;">
              <span class="badge badge--indigo">${stats.totalTorres} ${stats.totalTorres === 1 ? 'Torre' : 'Torres'}</span>
              ${reviewCount > 0 ? `<span class="badge badge--warning">🕒 ${reviewCount} en revisión</span>` : ''}
            </div>
          </div>

          <div class="progress-block">
            <div class="progress-block__meta">
              <span>${isAdmin ? 'Avance General' : 'Tus deptos finalizados'}</span>
              <span>${stats.completados}/${stats.activos} (${stats.porcentaje}%)</span>
            </div>
            <div class="progress-track" aria-hidden="true">
              <div class="progress-fill ${doneClass}" style="width:${stats.porcentaje}%"></div>
            </div>
          </div>
        </div>

        <div class="entity-card__foot">
          <span class="entity-card__cta">Abrir Condominio ➔</span>
          ${isAdmin ? `
            <div class="entity-card__actions" data-stop-propagation>
              <button type="button" class="btn btn--soft btn--icon" data-edit-condo="${escapeHtml(condo.id)}" title="Editar condominio" aria-label="Editar ${escapeHtml(condo.nombre)}">⚙️</button>
              <button type="button" class="btn btn--danger-soft btn--icon" data-delete-condo="${escapeHtml(condo.id)}" title="Eliminar condominio" aria-label="Eliminar ${escapeHtml(condo.nombre)}">🗑️</button>
            </div>
          ` : `<span class="badge badge--muted">${stats.activos} tuyo(s)</span>`}
        </div>
      </article>
    `;
  }).join('');

  container.querySelectorAll('[data-open-condo]').forEach(card => {
    const condoId = card.dataset.openCondo;
    card.addEventListener('click', e => {
      if (e.target.closest('[data-stop-propagation]')) return;
      openCondoOperativeModal(condoId);
    });
    card.addEventListener('keydown', e => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target === card) {
        e.preventDefault();
        openCondoOperativeModal(condoId);
      }
    });
  });

  container.querySelectorAll('[data-edit-condo]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      abrirModalCondominio(btn.dataset.editCondo);
    });
  });

  container.querySelectorAll('[data-delete-condo]').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const condo = getCondoById(btn.dataset.deleteCondo);
      const ok = await confirmAction({
        title: 'Eliminar Condominio',
        message: `¿Eliminar "${condo?.nombre || 'este condominio'}" y todas sus torres? Esta acción no se puede deshacer.`,
        confirmText: 'Eliminar',
        danger: true
      });
      if (ok) {
        deleteCondominioAdmin(btn.dataset.deleteCondo);
        showToast('Condominio eliminado.', 'success');
      }
    });
  });
}

export function renderCondoOperativeModal() {
  const condoId = state.ui.condoOperativoId;
  if (!condoId) return;
  const condo = getCondoById(condoId);
  if (!condo) {
    closeCondoOperativeModal();
    return;
  }

  const isAdmin = isAdminAuthenticated();
  const currentPub = !isAdmin ? getCurrentPublisher() : null;

  document.getElementById('operativo-condo-nombre').textContent = condo.nombre;
  const infoParts = [condo.direccion || 'Sin dirección'];
  if (condo.administrador) infoParts.push(`Admin: ${condo.administrador}`);
  document.getElementById('operativo-condo-info').textContent = infoParts.join(' • ');

  const btnEdit = document.getElementById('operativo-btn-editar');
  const btnAddTower = document.getElementById('operativo-btn-add-torre');
  btnEdit.classList.toggle('hidden', !isAdmin);
  btnAddTower.classList.toggle('hidden', !isAdmin);
  btnEdit.onclick = () => abrirModalCondominio(condo.id);
  btnAddTower.onclick = () => abrirModalEdificio(condo.id);

  const container = document.getElementById('operativo-condo-body');
  if (!container) return;

  const notesBanner = condo.notas
    ? `<div class="notice-box"><strong>Indicaciones:</strong> ${escapeHtml(condo.notas)}</div>`
    : '';

  const visibleEdificios = isAdmin
    ? condo.edificios
    : condo.edificios.filter(edif =>
        currentPub && edif.deptos.some(d => !d.excluido && d.asignadoId === currentPub.id)
      );

  if (visibleEdificios.length === 0) {
    container.innerHTML = `
      ${notesBanner}
      <div class="empty-state">
        <div class="empty-state__icon">🏙️</div>
        <p class="empty-state__text">${isAdmin ? 'Este condominio aún no tiene torres creadas.' : 'No tienes departamentos asignados en este condominio.'}</p>
        ${isAdmin ? `<button type="button" id="btn-empty-new-tower" class="btn btn--primary">+ Agregar primera Torre</button>` : ''}
      </div>
    `;
    document.getElementById('btn-empty-new-tower')?.addEventListener('click', () => abrirModalEdificio(condo.id));
    return;
  }

  const pendingReports = getVisiblePendingReports();
  const pendingByTower = new Map();
  pendingReports.forEach(r => {
    if (r.condoId === condo.id) {
      pendingByTower.set(r.edificioId, (pendingByTower.get(r.edificioId) || 0) + 1);
    }
  });

  container.innerHTML = `
    ${notesBanner}
    <div class="cards-grid">
      ${visibleEdificios.map(edif => {
        const stats = getTowerStats(edif, { forHermanoId: currentPub?.id || null });
        const doneClass = stats.porcentaje === 100 && stats.activos > 0 ? 'progress-fill--done' : '';
        const reviewCount = pendingByTower.get(edif.id) || 0;
        const subtitle = isAdmin
          ? `${stats.total} deptos totales • ${stats.asignados} asignados`
          : `${stats.activos} depto(s) asignado(s) a ti`;

        return `
          <article class="entity-card" tabindex="0" role="button" data-open-tower="${escapeHtml(edif.id)}" aria-label="Abrir ${escapeHtml(edif.nombre)}">
            <div style="display:flex; flex-direction:column; gap:0.85rem;">
              <div class="entity-card__head">
                <div>
                  <h3 class="entity-card__title">${escapeHtml(edif.nombre)}</h3>
                  <p class="entity-card__subtitle">${subtitle}</p>
                </div>
                <div style="display:flex; align-items:center; gap:0.3rem;">
                  ${reviewCount > 0 ? `<span class="badge badge--warning">🕒 ${reviewCount}</span>` : ''}
                  ${isAdmin
                    ? `<button type="button" class="btn btn--soft btn--icon" data-edit-tower="${escapeHtml(edif.id)}" title="Editar numeración" aria-label="Editar ${escapeHtml(edif.nombre)}">✏️</button>`
                    : ''}
                </div>
              </div>

              <div class="progress-block">
                <div class="progress-block__meta">
                  <span>${isAdmin ? 'Avance Torre' : 'Tus deptos finalizados'}</span>
                  <span>${stats.completados}/${stats.activos} (${stats.porcentaje}%)</span>
                </div>
                <div class="progress-track" aria-hidden="true">
                  <div class="progress-fill ${doneClass}" style="width:${stats.porcentaje}%"></div>
                </div>
              </div>
            </div>

            <div class="entity-card__foot">
              <span class="entity-card__cta">${isAdmin ? 'Trabajar esta Torre ➔' : 'Ver mapa de esta Torre ➔'}</span>
              ${isAdmin
                ? `<button type="button" class="btn btn--danger-soft btn--icon" data-delete-tower="${escapeHtml(edif.id)}" title="Eliminar torre" aria-label="Eliminar ${escapeHtml(edif.nombre)}">🗑️</button>`
                : ''}
            </div>
          </article>
        `;
      }).join('')}
    </div>
  `;

  container.querySelectorAll('[data-open-tower]').forEach(card => {
    const towerId = card.dataset.openTower;
    card.addEventListener('click', e => {
      if (e.target.closest('button')) return;
      openTowerOperativeModal(condo.id, towerId);
    });
    card.addEventListener('keydown', e => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target === card) {
        e.preventDefault();
        openTowerOperativeModal(condo.id, towerId);
      }
    });
  });

  container.querySelectorAll('[data-edit-tower]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      abrirModalEdificio(condo.id, btn.dataset.editTower);
    });
  });

  container.querySelectorAll('[data-delete-tower]').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const edif = condo.edificios.find(t => t.id === btn.dataset.deleteTower);
      const ok = await confirmAction({
        title: 'Eliminar Torre',
        message: `¿Eliminar "${edif?.nombre || 'esta torre'}" y todos sus departamentos?`,
        confirmText: 'Eliminar',
        danger: true
      });
      if (ok) {
        deleteEdificioAdmin(condo.id, btn.dataset.deleteTower);
        showToast('Torre eliminada.', 'success');
      }
    });
  });
}

export function renderTowerOperativeModal() {
  const condoId = state.ui.condoOperativoId;
  const edificioId = state.ui.torreOperativaId;
  if (!condoId || !edificioId) return;

  const { condo, edificio } = getTowerByIds(condoId, edificioId);
  if (!condo || !edificio) {
    closeTowerOperativeModal();
    return;
  }

  const isAdmin = isAdminAuthenticated();
  const currentPub = !isAdmin ? getCurrentPublisher() : null;
  const stats = getTowerStats(edificio, { forHermanoId: currentPub?.id || null });
  const distanciaMinima = edificio.distanciaMinima ?? state.configuracion?.distanciaMinimaDefault ?? 2;

  document.getElementById('operativo-torre-condo-tag').textContent = condo.nombre;
  document.getElementById('operativo-torre-nombre').textContent = edificio.nombre;
  document.getElementById('operativo-torre-stats').textContent = isAdmin
    ? `${stats.total} departamentos • ${stats.completados}/${stats.activos} trabajados (${stats.porcentaje}%)`
    : `Tus asignaciones: ${stats.completados}/${stats.activos} finalizados (${stats.porcentaje}%)`;

  const btnExcluir = document.getElementById('torre-btn-excluir');
  const btnAsignar = document.getElementById('torre-btn-asignar');
  const btnReiniciar = document.getElementById('torre-btn-reiniciar');

  btnExcluir.classList.toggle('hidden', !isAdmin);
  btnAsignar.classList.toggle('hidden', !isAdmin);
  btnReiniciar.classList.toggle('hidden', !isAdmin);

  btnExcluir.onclick = () => abrirModalExcluidos(condo.id, edificio.id);
  btnAsignar.onclick = () => abrirModalAsignacion(condo.id, edificio.id);
  btnReiniciar.onclick = async () => {
    const ok = await confirmAction({
      title: 'Reiniciar ciclo de la torre',
      message: `Se marcarán como pendientes los ${stats.activos} departamentos activos de ${edificio.nombre}, conservando exclusiones y asignaciones.`,
      confirmText: 'Reiniciar ciclo'
    });
    if (ok) {
      resetCicloTorreAdmin(condo.id, edificio.id, false);
      showToast('Ciclo de torre reiniciado.', 'success');
    }
  };

  const pendingReports = getVisiblePendingReports().filter(
    r => r.condoId === condo.id && r.edificioId === edificio.id
  );
  const reportByDepto = new Map(pendingReports.map(r => [r.deptoId, r]));

  // Agrupar asignaciones visibles en barra lateral
  const asignacionesMap = new Map();
  edificio.deptos.forEach(d => {
    if (d.excluido) return;
    if (!isAdmin && (!currentPub || d.asignadoId !== currentPub.id)) return;
    const pub = d.asignadoId ? getPublisherById(d.asignadoId) : null;
    const key = pub ? pub.id : (d.asignadoA ? `legacy:${d.asignadoA}` : null);
    if (!key) return;
    if (!asignacionesMap.has(key)) {
      asignacionesMap.set(key, {
        nombre: pub ? pub.nombre : d.asignadoA,
        colorId: pub ? pub.colorId : 'slate',
        deptos: []
      });
    }
    asignacionesMap.get(key).deptos.push(d);
  });

  const deptosPorPiso = agruparPorPiso(edificio.deptos);
  const pisosOrdenados = Object.keys(deptosPorPiso).sort((a, b) => Number(b) - Number(a));
  const clickMode = state.ui.towerClickMode;

  const container = document.getElementById('operativo-torre-body');
  if (!container) return;

  container.innerHTML = `
    <div class="tower-control-bar">
      ${isAdmin ? `
        <div class="tower-control-bar__row">
          <label for="torre-distancia-input" class="field__label" style="margin:0;">Distancia mín. (pts):</label>
          <input type="number" id="torre-distancia-input" class="input" style="width:4.5rem; text-align:center; padding:0.35rem;" min="0" max="20" value="${escapeHtml(distanciaMinima)}">
        </div>
        <div class="tower-control-bar__row">
          <span class="field__label" style="margin:0;">Al tocar depto:</span>
          <div style="display:flex; gap:0.25rem;">
            <button type="button" id="mode-toggle-btn" class="btn btn--sm ${clickMode === 'toggle' ? 'btn--primary' : 'btn--soft'}">✓ Completar rápido</button>
            <button type="button" id="mode-detail-btn" class="btn btn--sm ${clickMode === 'detail' ? 'btn--primary' : 'btn--soft'}">✏️ Editar / Fijar 📌</button>
          </div>
        </div>
      ` : `
        <div class="tower-control-bar__row" style="flex:1;">
          <span class="badge badge--indigo">Vista de Mapa</span>
          <span class="field__hint">Toca cualquiera de tus departamentos para marcarlo como finalizado (quedará en revisión por administración).</span>
        </div>
        ${pendingReports.length > 0 ? `
          <div class="tower-control-bar__row">
            <button type="button" id="btn-tower-send-wa" class="btn btn--success btn--sm">📲 Avisar por WhatsApp (${pendingReports.length})</button>
          </div>
        ` : ''}
      `}
      <div class="tower-control-bar__row" style="min-width:11rem;">
        <div class="progress-track" style="flex:1;" aria-hidden="true">
          <div class="progress-fill ${stats.porcentaje === 100 && stats.activos > 0 ? 'progress-fill--done' : ''}" style="width:${stats.porcentaje}%"></div>
        </div>
        <span style="font-size:0.78rem; font-weight:800; color:var(--color-primary-hover);">${stats.porcentaje}%</span>
      </div>
    </div>

    ${isAdmin && pendingReports.length > 0 ? `
      <div class="notice-box notice-box--privacy" style="display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:0.5rem;">
        <span><strong>🕒 ${pendingReports.length} reporte(s) por revisar en esta torre:</strong> los botones con borde punteado ámbar fueron marcados por el publicador y esperan tu confirmación definitiva.</span>
        <button type="button" id="btn-tower-go-review" class="btn btn--secondary btn--sm">Ir a bandeja de revisión</button>
      </div>
    ` : ''}

    <div class="legend-strip">
      <span class="legend-item">📌 Asignación fija</span>
      <span class="legend-item"><span class="legend-swatch legend-swatch--review"></span> 🕒 Marcado por usuario (en revisión)</span>
      <span class="legend-item"><span class="legend-swatch legend-swatch--done"></span> ✓ Finalizado definitivo (Admin)</span>
      <span class="legend-item">🚫 Excluido</span>
    </div>

    <div class="tower-grid">
      <div class="floor-list">
        <span class="field__label" style="text-transform:uppercase; letter-spacing:0.06em;">Departamentos Organizados por Piso</span>
        ${pisosOrdenados.map(piso => {
          const deptosDelPiso = [...deptosPorPiso[piso]].sort(compararDeptosNatural);
          return `
            <section class="floor-card" aria-label="Piso ${escapeHtml(piso)}">
              <div class="floor-card__head">
                <span class="floor-card__title">PISO ${escapeHtml(piso)}</span>
                <span class="floor-card__count">${deptosDelPiso.length} deptos</span>
              </div>
              <div class="apartments-wrap">
                ${deptosDelPiso.map(d => {
                  if (d.excluido) {
                    if (!isAdmin) {
                      return `
                        <span class="apt-btn is-excluded is-readonly" aria-disabled="true" title="Departamento excluido">
                          <span class="apt-btn__num">${escapeHtml(d.numero)} 🚫</span>
                        </span>
                      `;
                    }
                    return `
                      <button type="button" class="apt-btn is-excluded" data-apt-id="${escapeHtml(d.id)}" title="Excluido: ${escapeHtml(d.motivoExcluido || 'Excluido')}">
                        <span class="apt-btn__num">${escapeHtml(d.numero)} 🚫</span>
                      </button>
                    `;
                  }

                  const isMine = currentPub && d.asignadoId === currentPub.id;
                  if (!isAdmin && !isMine) {
                    return `
                      <span class="apt-btn is-other-neutral" aria-disabled="true" title="No asignado a ti">
                        <span class="apt-btn__num">${escapeHtml(d.numero)}</span>
                      </span>
                    `;
                  }

                  const pub = d.asignadoId ? getPublisherById(d.asignadoId) : null;
                  const pubName = pub ? pub.nombre : (d.asignadoA || '');
                  const hasPub = Boolean(pub);
                  const isDone = d.estado === 'completado';
                  const pendingRep = !isDone ? reportByDepto.get(d.id) : null;
                  const isReported = Boolean(pendingRep);

                  const classes = [
                    'apt-btn',
                    hasPub ? 'has-publisher' : '',
                    isDone ? 'is-completed' : '',
                    isReported ? 'is-user-reported' : ''
                  ].filter(Boolean).join(' ');

                  const statusSuffix = isDone ? ' ✓' : (isReported ? ' 🕒' : '');
                  const titleInfo = pubName
                    ? `Asignado a: ${pubName}${d.fijo ? ' (Fijo)' : ''}${isReported ? ' — Pendiente de revisión' : (isDone ? ' — Finalizado definitivo' : '')}`
                    : 'Sin asignar';

                  return `
                    <button type="button"
                      class="${classes}"
                      ${hasPub ? `data-color="${escapeHtml(pub.colorId)}"` : ''}
                      data-apt-id="${escapeHtml(d.id)}"
                      title="${escapeHtml(titleInfo)}">
                      <span class="apt-btn__num">${escapeHtml(d.numero)}${d.fijo ? ' 📌' : ''}${statusSuffix}</span>
                      ${pubName ? `<span class="apt-btn__sub">${escapeHtml(pubName)}</span>` : ''}
                    </button>
                  `;
                }).join('')}
              </div>
            </section>
          `;
        }).join('')}
      </div>

      <aside class="panel-surface" aria-label="${isAdmin ? 'Asignaciones en esta torre' : 'Tus asignaciones en esta torre'}">
        <span class="field__label" style="text-transform:uppercase; letter-spacing:0.06em;">
          ${isAdmin ? 'Asignaciones en esta Torre' : 'Tus asignaciones en esta Torre'}
        </span>
        ${asignacionesMap.size === 0
          ? `<p class="field__hint" style="font-style:italic;">${isAdmin ? 'Sin publicadores asignados a esta torre.' : 'No tienes departamentos asignados en esta torre.'}</p>`
          : Array.from(asignacionesMap.values()).map(entry => {
              const sortedApt = [...entry.deptos].sort(compararDeptosNatural);
              return `
                <div style="border-bottom:1px solid var(--color-bg); padding-bottom:0.75rem; display:flex; flex-direction:column; gap:0.45rem;" data-color="${escapeHtml(entry.colorId)}">
                  <div style="display:flex; align-items:center; gap:0.45rem;">
                    <span class="color-dot" style="margin-top:0;"></span>
                    <strong style="font-size:0.875rem;">${escapeHtml(entry.nombre)}</strong>
                    <span class="badge badge--muted">${sortedApt.length}</span>
                  </div>
                  <div class="assignment-chips">
                    ${sortedApt.map(d => {
                      const isDone = d.estado === 'completado';
                      const isReported = !isDone && reportByDepto.has(d.id);
                      const chipClass = isDone
                        ? 'is-completed'
                        : (isReported ? 'is-user-reported' : '');
                      const chipMark = isDone ? ' ✓' : (isReported ? ' 🕒' : '');
                      return `
                        <button type="button"
                          class="assignment-chip assignment-chip--btn ${chipClass}"
                          data-apt-id="${escapeHtml(d.id)}"
                          title="Tocar para ver detalles">
                          ${escapeHtml(d.numero)}${d.fijo ? ' 📌' : ''}${chipMark}
                        </button>
                      `;
                    }).join('')}
                  </div>
                </div>
              `;
            }).join('')}
      </aside>
    </div>
  `;

  document.getElementById('torre-distancia-input')?.addEventListener('change', e => {
    updateDistanciaMinimaAdmin(condo.id, edificio.id, e.target.value);
    showToast('Distancia mínima actualizada.', 'info');
  });

  document.getElementById('mode-toggle-btn')?.addEventListener('click', () => {
    setUiState({ towerClickMode: 'toggle' });
  });
  document.getElementById('mode-detail-btn')?.addEventListener('click', () => {
    setUiState({ towerClickMode: 'detail' });
  });

  document.getElementById('btn-tower-send-wa')?.addEventListener('click', () => {
    copyOrOpenWhatsAppReport(pendingReports, true);
  });

  document.getElementById('btn-tower-go-review')?.addEventListener('click', () => {
    closeCondoOperativeModal();
    setUiState({ activeTab: 'admin' });
  });

  container.querySelectorAll('[data-apt-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const deptoId = btn.dataset.aptId;
      const depto = edificio.deptos.find(item => item.id === deptoId);
      if (!depto) return;

      if (isAdmin && state.ui.towerClickMode === 'toggle' && !depto.excluido && btn.classList.contains('apt-btn')) {
        const hadPending = reportByDepto.has(deptoId);
        toggleEstadoDeptoAdmin(condo.id, edificio.id, deptoId);
        if (hadPending) {
          showToast(`Depto ${depto.numero} aprobado como finalizado definitivo.`, 'success');
        }
      } else {
        abrirModalDetalleDepto(condo.id, edificio.id, deptoId);
      }
    });
  });
}

