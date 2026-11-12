/**
 * Pestaña de Publicadores / Hermanos y consulta rápida "Mis Asignaciones".
 */

import {
  deleteHermanoAdmin,
  getPublisherById,
  getPublisherSummary,
  isAdminAuthenticated,
  setUiState,
  state
} from '../core/state.js';
import { confirmAction, showToast } from '../core/ui-feedback.js';
import { compararDeptosNatural, escapeHtml } from '../core/utils.js';
import { abrirModalHermano } from './modals.js';
import { openTowerOperativeModal } from './territories.js';

function getAssignedTowerLabel(torreAsignada) {
  if (!torreAsignada || torreAsignada === 'todas') return 'Todas las torres';
  for (const condo of state.condominios) {
    const edif = condo.edificios.find(e => e.id === torreAsignada);
    if (edif) return `${condo.nombre} - ${edif.nombre}`;
  }
  return 'Todas las torres';
}

export function renderPublishersView() {
  const listContainer = document.getElementById('hermanos-container');
  const summaryContainer = document.getElementById('mis-asignaciones-container');
  const btnAdd = document.getElementById('btn-agregar-hermano');
  const isAdmin = isAdminAuthenticated();

  if (btnAdd) {
    btnAdd.classList.toggle('hidden', !isAdmin);
  }

  if (!listContainer) return;

  const query = (state.ui.searchHermano || '').trim().toLowerCase();
  const filtered = state.hermanos.filter(h => {
    if (!query) return true;
    return h.nombre.toLowerCase().includes(query);
  });

  if (state.hermanos.length === 0) {
    listContainer.innerHTML = `<p class="field__hint" style="font-style:italic;">No hay publicadores registrados aún.</p>`;
  } else if (filtered.length === 0) {
    listContainer.innerHTML = `<p class="field__hint">No hay coincidencias para "${escapeHtml(state.ui.searchHermano)}".</p>`;
  } else {
    const showPrivateContact = isAdmin || (state.sync.repoPrivate === true && !state.configuracion?.privacidad?.ocultarContactoEnRepoPublico);

    listContainer.innerHTML = filtered.map(h => {
      const towerLabel = getAssignedTowerLabel(h.torreAsignada);
      const summary = getPublisherSummary(h.id);
      const isSelected = state.ui.selectedPublisherId === h.id;

      return `
        <article class="publisher-card" data-color="${escapeHtml(h.colorId)}">
          <div class="publisher-card__top">
            <div class="publisher-card__identity">
              <span class="color-dot" aria-hidden="true"></span>
              <div style="min-width:0;">
                <h4 class="publisher-card__name">${escapeHtml(h.nombre)}</h4>
                ${showPrivateContact && h.contacto
                  ? `<p class="publisher-card__meta">📞 ${escapeHtml(h.contacto)}</p>`
                  : ''}
                <span class="publisher-card__tower">📍 ${escapeHtml(towerLabel)}</span>
                <p class="publisher-card__meta">
                  ${summary.total === 0
                    ? 'Sin departamentos asignados'
                    : `${summary.pendientes} pendientes • ${summary.completados} completados`}
                </p>
              </div>
            </div>
          </div>

          <div style="display:flex; flex-wrap:wrap; justify-content:space-between; align-items:center; gap:0.4rem;">
            <button type="button" class="btn btn--sm ${isSelected ? 'btn--primary' : 'btn--secondary'}" data-view-assignments="${escapeHtml(h.id)}">
              ${isSelected ? 'Ocultar asignaciones' : 'Ver mis deptos'}
            </button>
            ${isAdmin ? `
              <div style="display:flex; gap:0.35rem;">
                <button type="button" class="btn btn--soft btn--sm" data-edit-hermano="${escapeHtml(h.id)}">Editar</button>
                <button type="button" class="btn btn--danger-soft btn--sm" data-delete-hermano="${escapeHtml(h.id)}">Eliminar</button>
              </div>
            ` : ''}
          </div>
        </article>
      `;
    }).join('');
  }

  // Render panel "Mis Asignaciones" si hay un publicador seleccionado
  if (summaryContainer) {
    const selected = state.ui.selectedPublisherId ? getPublisherById(state.ui.selectedPublisherId) : null;
    if (!selected) {
      summaryContainer.classList.add('hidden');
      summaryContainer.innerHTML = '';
    } else {
      const summary = getPublisherSummary(selected.id);
      summaryContainer.classList.remove('hidden');
      summaryContainer.innerHTML = `
        <div class="my-assignments-box" data-color="${escapeHtml(selected.colorId)}">
          <div style="display:flex; flex-wrap:wrap; justify-content:space-between; align-items:center; gap:0.75rem; border-bottom:1px solid var(--color-bg); padding-bottom:0.75rem;">
            <div style="display:flex; align-items:center; gap:0.5rem;">
              <span class="color-dot" style="margin-top:0;"></span>
              <div>
                <h3 class="section-title" style="font-size:1rem;">Departamentos asignados a ${escapeHtml(selected.nombre)}</h3>
                <p class="section-desc">${summary.pendientes} pendientes • ${summary.completados} completados</p>
              </div>
            </div>
            <div style="display:flex; gap:0.4rem;">
              ${summary.total > 0 ? `<button type="button" id="btn-copy-my-list" class="btn btn--secondary btn--sm">📋 Copiar lista</button>` : ''}
              <button type="button" id="btn-close-my-list" class="btn btn--soft btn--sm">Cerrar</button>
            </div>
          </div>

          ${summary.grupos.length === 0
            ? `<p class="field__hint">Actualmente no tiene departamentos asignados.</p>`
            : summary.grupos.map(g => {
                const sorted = [...g.deptos].sort(compararDeptosNatural);
                return `
                  <div class="assignment-group-card">
                    <div style="display:flex; flex-wrap:wrap; justify-content:space-between; align-items:center; gap:0.5rem;">
                      <div>
                        <strong style="font-size:0.9rem;">${escapeHtml(g.condoNombre)} — ${escapeHtml(g.edificioNombre)}</strong>
                        ${g.condoDireccion ? `<div class="field__hint">${escapeHtml(g.condoDireccion)}</div>` : ''}
                      </div>
                      <button type="button" class="btn btn--soft btn--sm" data-jump-tower="${escapeHtml(g.condoId)}::${escapeHtml(g.edificioId)}">Ir a la torre ➔</button>
                    </div>
                    <div class="assignment-chips">
                      ${sorted.map(d => `
                        <span class="assignment-chip ${d.estado === 'completado' ? 'is-completed' : ''}">
                          ${escapeHtml(d.numero)}${d.fijo ? ' 📌' : ''}${d.estado === 'completado' ? ' ✓' : ''}
                        </span>
                      `).join('')}
                    </div>
                  </div>
                `;
              }).join('')}
        </div>
      `;

      document.getElementById('btn-close-my-list')?.addEventListener('click', () => {
        setUiState({ selectedPublisherId: '' });
      });

      document.getElementById('btn-copy-my-list')?.addEventListener('click', async () => {
        const lines = [`Asignaciones de ${selected.nombre}:`];
        summary.grupos.forEach(g => {
          const pendientes = [...g.deptos]
            .filter(d => d.estado !== 'completado')
            .sort(compararDeptosNatural)
            .map(d => d.numero);
          if (pendientes.length > 0) {
            lines.push(`• ${g.condoNombre} (${g.edificioNombre}): ${pendientes.join(', ')}`);
          }
        });
        if (lines.length === 1) lines.push('Todos sus departamentos asignados figuran completados.');
        const text = lines.join('\n');
        try {
          await navigator.clipboard.writeText(text);
          showToast('Lista copiada al portapapeles.', 'success');
        } catch {
          showToast(text, 'info', 7000);
        }
      });

      summaryContainer.querySelectorAll('[data-jump-tower]').forEach(btn => {
        btn.addEventListener('click', () => {
          const [condoId, edificioId] = btn.dataset.jumpTower.split('::');
          setUiState({ activeTab: 'territorios' });
          openTowerOperativeModal(condoId, edificioId);
        });
      });
    }
  }

  listContainer.querySelectorAll('[data-view-assignments]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.viewAssignments;
      setUiState({ selectedPublisherId: state.ui.selectedPublisherId === id ? '' : id });
    });
  });

  listContainer.querySelectorAll('[data-edit-hermano]').forEach(btn => {
    btn.addEventListener('click', () => abrirModalHermano(btn.dataset.editHermano));
  });

  listContainer.querySelectorAll('[data-delete-hermano]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.deleteHermano;
      const h = getPublisherById(id);
      const summary = getPublisherSummary(id);
      const extraMsg = summary.total > 0
        ? ` Tiene ${summary.total} departamento(s) asignado(s) que quedarán sin asignar.`
        : '';
      const ok = await confirmAction({
        title: 'Eliminar Publicador',
        message: `¿Eliminar el registro de "${h?.nombre || 'este publicador'}"?${extraMsg}`,
        confirmText: 'Eliminar',
        danger: true
      });
      if (ok) {
        deleteHermanoAdmin(id);
        showToast('Publicador eliminado.', 'success');
      }
    });
  });
}

