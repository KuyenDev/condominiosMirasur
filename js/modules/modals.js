/**
 * Gestión unificada de modales operativos y diálogos de formulario/detalle.
 */

import {
  applyAsignacionesAdmin,
  approveReportAdmin,
  clearAsignacionesTorreAdmin,
  getCondoById,
  getCurrentPublisher,
  getPendingReportForDepto,
  getPublisherById,
  getTowerByIds,
  isAdminAuthenticated,
  rejectReportAdmin,
  saveExclusionesAdmin,
  state,
  updateDeptoDetalleAdmin,
  upsertCondominioAdmin,
  upsertEdificioAdmin,
  upsertHermanoAdmin
} from '../core/state.js';
import { confirmAction, showToast, syncBodyScrollLock } from '../core/ui-feedback.js';
import {
  PALETA_COLORES,
  agruparPorPiso,
  compararDeptosNatural,
  escapeHtml,
  formatDateTime,
  generarTextoPisos
} from '../core/utils.js';
import { copyOrOpenWhatsAppReport, submitPublisherDeptoMark } from './my-assignments.js';

let modalContext = { tipo: '', condoId: null, edificioId: null, hermanoId: null, deptoId: null };
let onModalClosedFocusEl = null;

export function closeGeneralModal() {
  const modal = document.getElementById('modal');
  const btnSave = document.getElementById('modal-btn-guardar');
  if (modal) modal.classList.add('hidden');
  if (btnSave) btnSave.classList.remove('hidden');
  modalContext = { tipo: '', condoId: null, edificioId: null, hermanoId: null, deptoId: null };
  syncBodyScrollLock();
  if (onModalClosedFocusEl && typeof onModalClosedFocusEl.focus === 'function') {
    onModalClosedFocusEl.focus();
    onModalClosedFocusEl = null;
  }
}

function openGeneralModal({ title, bodyHtml, showSave = true, saveLabel = 'Guardar' }) {
  onModalClosedFocusEl = document.activeElement;
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = bodyHtml;

  const btnSave = document.getElementById('modal-btn-guardar');
  btnSave.textContent = saveLabel;
  if (showSave) btnSave.classList.remove('hidden');
  else btnSave.classList.add('hidden');

  const modal = document.getElementById('modal');
  modal.classList.remove('hidden');
  syncBodyScrollLock();

  const firstInput = modal.querySelector('input, select, textarea, button:not([data-close-modal])');
  if (firstInput) firstInput.focus();
}

export function toggleMaximizeModal(boxId) {
  const el = document.getElementById(boxId);
  if (!el) return;
  el.classList.toggle('is-maximized');
}

export function abrirModalCondominio(condoId = null) {
  if (!isAdminAuthenticated()) {
    showToast('Inicia sesión en Administración para editar condominios.', 'warning');
    return;
  }
  modalContext = { tipo: 'condominio', condoId };
  const condo = condoId ? getCondoById(condoId) : null;

  openGeneralModal({
    title: condo ? 'Editar Condominio' : 'Nuevo Condominio',
    bodyHtml: `
      <div class="field">
        <label class="field__label" for="input-nombre">Nombre del Condominio *</label>
        <input type="text" id="input-nombre" class="input" value="${escapeHtml(condo?.nombre || '')}" placeholder="Ej. Condominio Los Alerces" required>
      </div>
      <div class="field">
        <label class="field__label" for="input-direccion">Dirección</label>
        <input type="text" id="input-direccion" class="input" value="${escapeHtml(condo?.direccion || '')}" placeholder="Ej. Av. Principal 1230">
      </div>
      <div class="field">
        <label class="field__label" for="input-administrador">Administración / Conserjería</label>
        <input type="text" id="input-administrador" class="input" value="${escapeHtml(condo?.administrador || '')}" placeholder="Ej. Conserjería / Horario de acceso">
      </div>
      <div class="field">
        <label class="field__label" for="input-notas">Indicaciones generales (opcional)</label>
        <textarea id="input-notas" rows="2" class="textarea" placeholder="Ej. Buzones en hall central, acceso peatonal por lateral">${escapeHtml(condo?.notas || '')}</textarea>
      </div>
    `
  });
}

export function abrirModalEdificio(condominioId, edificioId = null) {
  if (!isAdminAuthenticated()) {
    showToast('Inicia sesión en Administración para editar torres.', 'warning');
    return;
  }
  modalContext = { tipo: 'edificio', condoId: condominioId, edificioId };
  const { edificio: edif } = edificioId ? getTowerByIds(condominioId, edificioId) : { edificio: null };

  let textoDeptos = '';
  if (edif) {
    const deptosPorPiso = agruparPorPiso(edif.deptos);
    const pisos = Object.keys(deptosPorPiso).sort((a, b) => Number(a) - Number(b));
    textoDeptos = pisos
      .map(p => `Piso ${p}: ${[...deptosPorPiso[p]].sort(compararDeptosNatural).map(d => d.numero).join(', ')}`)
      .join('\n');
  }

  openGeneralModal({
    title: edif ? `Editar ${edif.nombre}` : 'Agregar Torre',
    bodyHtml: `
      <div class="field">
        <label class="field__label" for="input-nombre">Nombre de la Torre *</label>
        <input type="text" id="input-nombre" class="input" value="${escapeHtml(edif?.nombre || '')}" placeholder="Ej. Torre A" required>
      </div>

      <details class="notice-box">
        <summary style="cursor:pointer; font-weight:700;">⚡ Generador rápido de pisos (opcional)</summary>
        <div class="admin-form-grid" style="margin-top:0.75rem;">
          <div class="field">
            <label class="field__label" for="gen-piso-ini">Desde piso</label>
            <input type="number" id="gen-piso-ini" class="input" min="1" max="99" value="1">
          </div>
          <div class="field">
            <label class="field__label" for="gen-piso-fin">Hasta piso</label>
            <input type="number" id="gen-piso-fin" class="input" min="1" max="99" value="4">
          </div>
          <div class="field">
            <label class="field__label" for="gen-deptos-piso">Deptos por piso</label>
            <input type="number" id="gen-deptos-piso" class="input" min="1" max="30" value="4">
          </div>
          <div class="field">
            <label class="field__label" for="gen-formato">Formato</label>
            <select id="gen-formato" class="select">
              <option value="centena">Numérico (101, 102...)</option>
              <option value="letras">Con letra (1A, 1B...)</option>
            </select>
          </div>
        </div>
        <button type="button" id="btn-generar-pisos" class="btn btn--secondary btn--sm" style="margin-top:0.75rem;">Rellenar lista automáticamente</button>
      </details>

      <div class="field">
        <label class="field__label" for="input-deptos">Departamentos (formato libre o por pisos) *</label>
        <textarea id="input-deptos" rows="6" class="textarea textarea--mono" placeholder="Piso 1: 101, 102, 103&#10;Piso 2: 201, 202, 203">${escapeHtml(textoDeptos)}</textarea>
        <p class="field__hint">Separa departamentos por coma o indica pisos con "Piso X: 101, 102". Al editar se conserva el avance y las asignaciones existentes.</p>
      </div>
    `
  });

  const btnGen = document.getElementById('btn-generar-pisos');
  if (btnGen) {
    btnGen.addEventListener('click', () => {
      const ini = document.getElementById('gen-piso-ini').value;
      const fin = document.getElementById('gen-piso-fin').value;
      const cant = document.getElementById('gen-deptos-piso').value;
      const fmt = document.getElementById('gen-formato').value;
      document.getElementById('input-deptos').value = generarTextoPisos(ini, fin, cant, fmt);
    });
  }
}

export function abrirModalHermano(hermanoId = null) {
  if (!isAdminAuthenticated()) {
    showToast('Inicia sesión en Administración para gestionar publicadores.', 'warning');
    return;
  }
  modalContext = { tipo: 'hermano', hermanoId };
  const hermano = hermanoId ? getPublisherById(hermanoId) : null;

  let torresOptions = '<option value="todas">Todas las torres</option>';
  state.condominios.forEach(condo => {
    condo.edificios.forEach(edif => {
      const selected = hermano && hermano.torreAsignada === edif.id ? 'selected' : '';
      torresOptions += `<option value="${escapeHtml(edif.id)}" ${selected}>${escapeHtml(condo.nombre)} - ${escapeHtml(edif.nombre)}</option>`;
    });
  });

  const privacyActive = state.configuracion?.privacidad?.ocultarContactoEnRepoPublico !== false;
  const repoEsPublico = state.sync.repoPrivate === false;

  openGeneralModal({
    title: hermano ? 'Editar Publicador' : 'Registrar Publicador',
    bodyHtml: `
      <div class="field">
        <label class="field__label" for="input-nombre">Nombre y Apellido *</label>
        <input type="text" id="input-nombre" class="input" value="${escapeHtml(hermano?.nombre || '')}" placeholder="Ej. Rodrigo Luna" required>
        <p class="field__hint">El publicador ingresará a la aplicación escribiendo exactamente este nombre y apellido.</p>
      </div>
      <div class="field">
        <label class="field__label" for="input-contacto">Contacto (opcional)</label>
        <input type="text" id="input-contacto" class="input" value="${escapeHtml(hermano?.contacto || '')}" placeholder="Ej. +56 9 ...">
        ${privacyActive && repoEsPublico ? '<p class="field__hint" style="color:#92400e;">Protección activa: este teléfono no se subirá al repositorio público de GitHub.</p>' : ''}
      </div>
      <div class="field">
        <label class="field__label" for="select-torre">Asignar a Torre específica</label>
        <select id="select-torre" class="select">${torresOptions}</select>
      </div>
      <div class="field">
        <label class="field__label" for="select-color">Color Distintivo</label>
        <select id="select-color" class="select">
          ${PALETA_COLORES.map(c => {
            const isSelected = hermano && hermano.colorId === c.id ? 'selected' : '';
            return `<option value="${escapeHtml(c.id)}" ${isSelected}>${escapeHtml(c.nombre)}</option>`;
          }).join('')}
        </select>
      </div>
    `
  });
}

export function abrirModalExcluidos(condoId, edificioId) {
  if (!isAdminAuthenticated()) {
    showToast('Inicia sesión en Administración para modificar exclusiones.', 'warning');
    return;
  }
  modalContext = { tipo: 'exclusiones', condoId, edificioId };
  const { edificio } = getTowerByIds(condoId, edificioId);
  if (!edificio) return;

  const deptosOrdenados = [...edificio.deptos].sort(compararDeptosNatural);

  openGeneralModal({
    title: `Exclusiones - ${edificio.nombre}`,
    saveLabel: 'Guardar Exclusiones',
    bodyHtml: `
      <p class="field__hint" style="font-size:0.8rem;">Marca los departamentos que no deben trabajarse ni recibir cartas:</p>
      <div class="checklist-box">
        ${deptosOrdenados.map(d => `
          <div class="checklist-item">
            <label class="checklist-row">
              <input type="checkbox" name="excluir-depto" value="${escapeHtml(d.id)}" ${d.excluido ? 'checked' : ''} data-toggle-motivo="${escapeHtml(d.id)}">
              <span>Depto ${escapeHtml(d.numero)} <span style="color:var(--color-text-muted); font-weight:500;">(Piso ${escapeHtml(d.piso)})</span></span>
            </label>
            <div id="motivo-container-${escapeHtml(d.id)}" class="radio-group ${d.excluido ? '' : 'hidden'}">
              <label style="display:inline-flex; align-items:center; gap:0.25rem; cursor:pointer;">
                <input type="radio" name="motivo-${escapeHtml(d.id)}" value="Deshabitado" ${!d.motivoExcluido || d.motivoExcluido === 'Deshabitado' ? 'checked' : ''}> Deshabitado
              </label>
              <label style="display:inline-flex; align-items:center; gap:0.25rem; cursor:pointer;">
                <input type="radio" name="motivo-${escapeHtml(d.id)}" value="Solicitado por ocupante" ${d.motivoExcluido === 'Solicitado por ocupante' ? 'checked' : ''}> Solicitado por ocupante
              </label>
            </div>
          </div>
        `).join('')}
      </div>
    `
  });

  document.querySelectorAll('[data-toggle-motivo]').forEach(cb => {
    cb.addEventListener('change', () => {
      const target = document.getElementById(`motivo-container-${cb.dataset.toggleMotivo}`);
      if (target) target.classList.toggle('hidden', !cb.checked);
    });
  });
}

export function abrirModalAsignacion(condoId, edificioId) {
  if (!isAdminAuthenticated()) {
    showToast('Inicia sesión en Administración para asignar publicadores.', 'warning');
    return;
  }
  modalContext = { tipo: 'asignacion', condoId, edificioId };
  const { edificio } = getTowerByIds(condoId, edificioId);
  if (!edificio) return;

  const disponibles = state.hermanos.filter(
    h => !h.torreAsignada || h.torreAsignada === 'todas' || h.torreAsignada === edificioId
  );

  if (disponibles.length === 0) {
    openGeneralModal({
      title: `Asignar Publicadores - ${edificio.nombre}`,
      showSave: false,
      bodyHtml: `<p class="empty-state__text">No hay publicadores disponibles para esta torre. Registra publicadores en la pestaña "Publicadores".</p>`
    });
    return;
  }

  const maxDefault = state.configuracion?.maxDeptosDefault ?? 5;
  const distDefault = edificio.distanciaMinima ?? state.configuracion?.distanciaMinimaDefault ?? 2;

  openGeneralModal({
    title: `Asignar Publicadores - ${edificio.nombre}`,
    saveLabel: 'Distribuir Deptos',
    bodyHtml: `
      <div class="admin-form-grid" style="background:var(--color-surface-alt); padding:0.75rem; border-radius:var(--radius-lg); border:1px solid var(--color-border);">
        <div class="field">
          <label class="field__label" for="input-max-deptos">Máx. deptos por hermano</label>
          <input type="number" id="input-max-deptos" class="input" min="1" max="50" value="${escapeHtml(maxDefault)}">
        </div>
        <div class="field">
          <label class="field__label" for="input-distancia-modal">Distancia mín. (pts)</label>
          <input type="number" id="input-distancia-modal" class="input" min="0" max="20" value="${escapeHtml(distDefault)}">
        </div>
      </div>

      <div>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.5rem;">
          <span class="field__label">Publicadores a participar:</span>
          <div style="display:flex; gap:0.35rem;">
            <button type="button" id="btn-sel-todos" class="btn btn--soft btn--sm">Todos</button>
            <button type="button" id="btn-sel-ninguno" class="btn btn--soft btn--sm">Ninguno</button>
          </div>
        </div>
        <div class="checklist-box">
          ${disponibles.map(h => `
            <label class="checklist-item checklist-row" data-color="${escapeHtml(h.colorId)}">
              <input type="checkbox" name="hermanos-asignar" value="${escapeHtml(h.id)}">
              <span class="color-dot" style="margin-top:0;"></span>
              <span>${escapeHtml(h.nombre)}</span>
            </label>
          `).join('')}
        </div>
      </div>

      <div style="display:flex; justify-content:space-between; align-items:center; gap:0.5rem; flex-wrap:wrap; padding-top:0.5rem; border-top:1px solid var(--color-bg);">
        <span class="field__hint">¿Desasignar los que no son fijos 📌?</span>
        <button type="button" id="btn-limpiar-asignaciones" class="btn btn--danger-soft btn--sm">Limpiar Asignaciones</button>
      </div>
    `
  });

  document.getElementById('btn-sel-todos')?.addEventListener('click', () => {
    document.querySelectorAll('input[name="hermanos-asignar"]').forEach(cb => { cb.checked = true; });
  });
  document.getElementById('btn-sel-ninguno')?.addEventListener('click', () => {
    document.querySelectorAll('input[name="hermanos-asignar"]').forEach(cb => { cb.checked = false; });
  });
  document.getElementById('btn-limpiar-asignaciones')?.addEventListener('click', async () => {
    const ok = await confirmAction({
      title: 'Limpiar asignaciones de la torre',
      message: 'Se desasignarán todos los departamentos no fijos de esta torre. Los departamentos fijos 📌 se conservarán.',
      confirmText: 'Limpiar',
      danger: true
    });
    if (!ok) return;
    const liberados = clearAsignacionesTorreAdmin(condoId, edificioId, false);
    showToast(`Se liberaron ${liberados} asignaciones.`, 'success');
    closeGeneralModal();
  });
}

/**
 * Modal de detalle del departamento:
 * - Publicador: consulta sus asignaciones y marca como finalizado (pendiente de revisión por admin).
 * - Administrador: revisa reportes pendientes y edita estado definitivo, asignación, Fijo 📌, exclusión y nota.
 */
export function abrirModalDetalleDepto(condoId, edificioId, deptoId) {
  const { condo, edificio } = getTowerByIds(condoId, edificioId);
  if (!condo || !edificio) return;
  const depto = edificio.deptos.find(d => d.id === deptoId);
  if (!depto) return;

  const isAdmin = isAdminAuthenticated();
  const asignado = depto.asignadoId ? getPublisherById(depto.asignadoId) : null;
  const asignadoLabel = asignado ? asignado.nombre : (depto.asignadoA || 'Sin asignar');
  const pendingReport = getPendingReportForDepto(depto.id);

  if (!isAdmin) {
    const currentPub = getCurrentPublisher();
    if (!currentPub || depto.asignadoId !== currentPub.id || depto.excluido) {
      showToast('Solo puedes gestionar departamentos asignados a tu nombre.', 'warning');
      return;
    }

    modalContext = { tipo: 'depto-consulta', condoId, edificioId, deptoId };
    const isFinalDone = depto.estado === 'completado';
    const isReported = !isFinalDone && Boolean(pendingReport);

    const estadoLabel = isFinalDone
      ? '✅ Finalizado definitivo (confirmado por administración)'
      : (isReported
        ? (pendingReport.isLocalOnly ? '📱 Marcado en este dispositivo (sin enviar al servidor)' : '🕒 Marcado por ti — Pendiente de revisión por admin')
        : '⏳ Pendiente');

    openGeneralModal({
      title: `${edificio.nombre} — Depto ${depto.numero}`,
      showSave: false,
      bodyHtml: `
        <div class="notice-box" style="display:flex; flex-direction:column; gap:0.5rem;">
          <div><strong>Condominio:</strong> ${escapeHtml(condo.nombre)}</div>
          <div><strong>Piso:</strong> ${escapeHtml(depto.piso)}</div>
          <div><strong>Estado:</strong> ${estadoLabel}</div>
          <div><strong>Asignado a:</strong> ${escapeHtml(asignadoLabel)} ${depto.fijo ? '📌 (Fijo)' : ''}</div>
          ${depto.nota ? `<div><strong>Nota de administración:</strong> ${escapeHtml(depto.nota)}</div>` : ''}
        </div>

        ${isFinalDone ? `
          <div class="notice-box" style="background:var(--color-success-soft); border-color:var(--color-success-border); color:var(--color-success-text);">
            Este departamento ya fue confirmado como <strong>finalizado definitivo</strong> por un administrador.
          </div>
        ` : isReported ? `
          <div class="notice-box notice-box--privacy" style="display:flex; flex-direction:column; gap:0.65rem;">
            <div>
              <strong>🕒 En revisión por administración</strong>
              <p style="margin:0.25rem 0 0 0;">
                Enviado el ${escapeHtml(formatDateTime(pendingReport.createdAt))}${pendingReport.nota ? ` • Nota: "${escapeHtml(pendingReport.nota)}"` : ''}.
                Aún no figura como finalizado definitivo hasta que el administrador lo apruebe.
              </p>
            </div>
            <div style="display:flex; flex-wrap:wrap; gap:0.5rem;">
              <button type="button" id="btn-pub-send-wa" class="btn btn--success btn--sm">📲 Avisar por WhatsApp</button>
              <button type="button" id="btn-pub-unmark" class="btn btn--danger-soft btn--sm">↩️ Quitar marca (volver a pendiente)</button>
            </div>
          </div>
        ` : `
          <div class="notice-box notice-box--security" style="display:flex; flex-direction:column; gap:0.75rem;">
            <p style="margin:0;">
              Cuando hayas terminado este departamento, márcalo aquí para avisar al administrador. Quedará <strong>en revisión</strong> hasta su confirmación definitiva.
            </p>
            <div class="field">
              <label class="field__label" for="pub-report-nota">Nota breve para el admin (opcional)</label>
              <input type="text" id="pub-report-nota" class="input" maxlength="200" placeholder="Ej. Carta dejada en buzón / Visitado hoy">
            </div>
            <button type="button" id="btn-pub-mark-done" class="btn btn--primary">
              📩 Marcar como finalizado (enviar a revisión)
            </button>
          </div>
        `}
      `
    });

    document.getElementById('btn-pub-mark-done')?.addEventListener('click', async e => {
      const btn = e.currentTarget;
      const nota = document.getElementById('pub-report-nota')?.value || '';
      btn.disabled = true;
      btn.textContent = 'Enviando aviso...';
      try {
        const res = await submitPublisherDeptoMark({
          condoId,
          edificioId,
          deptoId: depto.id,
          mark: true,
          nota
        });
        closeGeneralModal();
        if (res.synced) {
          showToast(`Depto ${depto.numero} marcado en revisión y notificado a los administradores.`, 'success', 5000);
        } else {
          showToast(
            `Depto ${depto.numero} guardado en revisión en este dispositivo. Usa "Avisar por WhatsApp" para notificar al admin.`,
            'warning',
            6000
          );
        }
      } catch (err) {
        showToast(err.message || 'No se pudo marcar el departamento.', 'error', 5000);
        if (document.body.contains(btn)) {
          btn.disabled = false;
          btn.textContent = '📩 Marcar como finalizado (enviar a revisión)';
        }
      }
    });

    document.getElementById('btn-pub-unmark')?.addEventListener('click', async e => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = 'Quitando marca...';
      try {
        await submitPublisherDeptoMark({
          condoId,
          edificioId,
          deptoId: depto.id,
          mark: false
        });
        closeGeneralModal();
        showToast(`Se quitó la marca de revisión del Depto ${depto.numero}.`, 'info');
      } catch (err) {
        showToast(err.message || 'No se pudo quitar la marca.', 'error', 5000);
        if (document.body.contains(btn)) {
          btn.disabled = false;
          btn.textContent = '↩️ Quitar marca (volver a pendiente)';
        }
      }
    });

    document.getElementById('btn-pub-send-wa')?.addEventListener('click', () => {
      if (pendingReport) {
        copyOrOpenWhatsAppReport([pendingReport], true);
      }
    });
    return;
  }

  modalContext = { tipo: 'depto-admin', condoId, edificioId, deptoId };
  const hermanosOpts = [
    '<option value="">Sin asignar</option>',
    ...state.hermanos.map(h => `<option value="${escapeHtml(h.id)}" ${depto.asignadoId === h.id ? 'selected' : ''}>${escapeHtml(h.nombre)}</option>`)
  ].join('');

  const reviewHtml = pendingReport ? `
    <div class="notice-box notice-box--privacy" style="display:flex; flex-direction:column; gap:0.65rem;">
      <div>
        <strong>🕒 Reportado por publicador (Pendiente de revisión)</strong>
        <p style="margin:0.25rem 0 0 0;">
          <strong>${escapeHtml(pendingReport.hermanoNombre)}</strong> marcó este departamento como finalizado el ${escapeHtml(formatDateTime(pendingReport.createdAt))}.
          ${pendingReport.nota ? `<br>Nota: <em>"${escapeHtml(pendingReport.nota)}"</em>` : ''}
        </p>
      </div>
      <div style="display:flex; flex-wrap:wrap; gap:0.5rem;">
        <button type="button" id="btn-admin-approve-depto" class="btn btn--success btn--sm">✅ Aprobar definitivo</button>
        <button type="button" id="btn-admin-reject-depto" class="btn btn--danger-soft btn--sm">↩️ Rechazar (dejar pendiente)</button>
      </div>
    </div>
  ` : '';

  openGeneralModal({
    title: `Editar Depto ${depto.numero} — ${edificio.nombre}`,
    saveLabel: 'Aplicar cambios',
    bodyHtml: `
      ${reviewHtml}
      <div class="admin-form-grid">
        <div class="field">
          <label class="field__label" for="depto-estado">Estado definitivo</label>
          <select id="depto-estado" class="select">
            <option value="pendiente" ${depto.estado === 'pendiente' ? 'selected' : ''}>⏳ Pendiente</option>
            <option value="completado" ${depto.estado === 'completado' ? 'selected' : ''}>✅ Completado definitivo</option>
          </select>
        </div>
        <div class="field">
          <label class="field__label" for="depto-asignado">Asignado a</label>
          <select id="depto-asignado" class="select">${hermanosOpts}</select>
        </div>
      </div>

      <label class="checklist-row" style="padding:0.5rem 0;">
        <input type="checkbox" id="depto-fijo" ${depto.fijo ? 'checked' : ''}>
        <span>📌 Asignación fija (se conserva al limpiar o redistribuir)</span>
      </label>

      <div class="checklist-item">
        <label class="checklist-row">
          <input type="checkbox" id="depto-excluido" ${depto.excluido ? 'checked' : ''}>
          <span>🚫 Excluir este departamento</span>
        </label>
        <div id="depto-motivo-wrap" class="field ${depto.excluido ? '' : 'hidden'}">
          <label class="field__label" for="depto-motivo">Motivo de exclusión</label>
          <select id="depto-motivo" class="select">
            <option value="Deshabitado" ${depto.motivoExcluido === 'Deshabitado' ? 'selected' : ''}>Deshabitado</option>
            <option value="Solicitado por ocupante" ${depto.motivoExcluido === 'Solicitado por ocupante' ? 'selected' : ''}>Solicitado por ocupante</option>
          </select>
        </div>
      </div>

      <div class="field">
        <label class="field__label" for="depto-nota">Observación breve (opcional)</label>
        <input type="text" id="depto-nota" class="input" value="${escapeHtml(depto.nota || '')}" placeholder="Ej. Buzón en conserjería / Carta enviada Nov">
      </div>
    `
  });

  document.getElementById('btn-admin-approve-depto')?.addEventListener('click', () => {
    if (pendingReport) {
      approveReportAdmin(pendingReport.id);
      closeGeneralModal();
      showToast(`Depto ${depto.numero} aprobado como finalizado definitivo.`, 'success');
    }
  });

  document.getElementById('btn-admin-reject-depto')?.addEventListener('click', () => {
    if (pendingReport) {
      rejectReportAdmin(pendingReport.id);
      closeGeneralModal();
      showToast(`Reporte del Depto ${depto.numero} rechazado (queda pendiente).`, 'info');
    }
  });

  document.getElementById('depto-excluido')?.addEventListener('change', e => {
    document.getElementById('depto-motivo-wrap')?.classList.toggle('hidden', !e.target.checked);
  });
}

export function saveActiveModal() {
  try {
    if (modalContext.tipo === 'condominio') {
      upsertCondominioAdmin(modalContext.condoId, {
        nombre: document.getElementById('input-nombre').value,
        direccion: document.getElementById('input-direccion').value,
        administrador: document.getElementById('input-administrador').value,
        notas: document.getElementById('input-notas').value
      });
      showToast(modalContext.condoId ? 'Condominio actualizado.' : 'Condominio creado.', 'success');
    } else if (modalContext.tipo === 'edificio') {
      upsertEdificioAdmin(modalContext.condoId, modalContext.edificioId, {
        nombre: document.getElementById('input-nombre').value,
        deptosRaw: document.getElementById('input-deptos').value
      });
      showToast(modalContext.edificioId ? 'Torre actualizada.' : 'Torre agregada.', 'success');
    } else if (modalContext.tipo === 'hermano') {
      upsertHermanoAdmin(modalContext.hermanoId, {
        nombre: document.getElementById('input-nombre').value,
        contacto: document.getElementById('input-contacto').value,
        torreAsignada: document.getElementById('select-torre').value,
        colorId: document.getElementById('select-color').value
      });
      showToast(modalContext.hermanoId ? 'Publicador actualizado.' : 'Publicador registrado.', 'success');
    } else if (modalContext.tipo === 'exclusiones') {
      const exclusionesMap = {};
      document.querySelectorAll('input[name="excluir-depto"]').forEach(cb => {
        const id = cb.value;
        if (cb.checked) {
          const radio = document.querySelector(`input[name="motivo-${CSS.escape(id)}"]:checked`);
          exclusionesMap[id] = { excluido: true, motivo: radio ? radio.value : 'Deshabitado' };
        } else {
          exclusionesMap[id] = { excluido: false, motivo: null };
        }
      });
      saveExclusionesAdmin(modalContext.condoId, modalContext.edificioId, exclusionesMap);
      showToast('Exclusiones actualizadas.', 'success');
    } else if (modalContext.tipo === 'asignacion') {
      const distanciaMinima = document.getElementById('input-distancia-modal').value;
      const maxDeptos = document.getElementById('input-max-deptos').value;
      const hermanoIds = Array.from(document.querySelectorAll('input[name="hermanos-asignar"]:checked')).map(cb => cb.value);

      const res = applyAsignacionesAdmin(modalContext.condoId, modalContext.edificioId, {
        hermanoIds,
        distanciaMinima,
        maxDeptos
      });
      const extra = res.omitidos > 0 ? ` (${res.omitidos} quedaron disponibles por límite o distancia mínima)` : '';
      showToast(`Se asignaron ${res.asignados} departamentos.${extra}`, 'success', 5000);
    } else if (modalContext.tipo === 'depto-admin') {
      updateDeptoDetalleAdmin(modalContext.condoId, modalContext.edificioId, modalContext.deptoId, {
        estado: document.getElementById('depto-estado').value,
        asignadoId: document.getElementById('depto-asignado').value,
        fijo: document.getElementById('depto-fijo').checked,
        excluido: document.getElementById('depto-excluido').checked,
        motivoExcluido: document.getElementById('depto-motivo').value,
        nota: document.getElementById('depto-nota').value
      });
      showToast('Departamento actualizado.', 'success');
    }

    closeGeneralModal();
  } catch (err) {
    showToast(err.message || 'Verifica los datos ingresados.', 'error');
  }
}

