/**
 * Integración segura con GitHub API.
 *
 * SEGURIDAD:
 * - El token permanece exclusivamente en memoria RAM de este módulo.
 * - Nunca se guarda en localStorage, IndexedDB, cookies ni código fuente.
 * - Los cambios a data/*.json se publican de forma atómica en un solo commit
 *   mediante Git Data API, evitando estados inconsistentes.
 */

const GITHUB_API = 'https://api.github.com';

// Credencial en memoria volátil únicamente (se borra al cerrar pestaña o cerrar sesión)
let memoryToken = null;
let activeRepoConfig = {
  owner: '',
  repo: '',
  branch: 'main'
};

/**
 * Intenta detectar owner/repo automáticamente cuando la app corre en *.github.io.
 */
export function detectGitHubRepoFromLocation(configGithub = {}) {
  const configuredOwner = String(configGithub.owner || '').trim();
  const configuredRepo = String(configGithub.repo || '').trim();
  const configuredBranch = String(configGithub.branch || 'main').trim() || 'main';

  if (configuredOwner && configuredRepo) {
    return { owner: configuredOwner, repo: configuredRepo, branch: configuredBranch };
  }

  const host = window.location.hostname;
  if (host.endsWith('.github.io')) {
    const owner = host.replace('.github.io', '');
    const pathSegments = window.location.pathname.split('/').filter(Boolean);
    const repo = pathSegments.length > 0 ? pathSegments[0] : `${owner}.github.io`;
    return {
      owner: configuredOwner || owner,
      repo: configuredRepo || repo,
      branch: configuredBranch
    };
  }

  return {
    owner: configuredOwner,
    repo: configuredRepo,
    branch: configuredBranch
  };
}

function encodeBase64Utf8(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function decodeBase64Utf8(b64) {
  const clean = String(b64 || '').replace(/\s/g, '');
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

async function ghFetch(path, options = {}, tokenOverride = null) {
  const token = tokenOverride || memoryToken;
  if (!token) {
    throw new Error('No hay una sesión de GitHub activa.');
  }

  const res = await fetch(`${GITHUB_API}${path}`, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });

  if (!res.ok) {
    let detail = '';
    try {
      const errBody = await res.json();
      detail = errBody.message || '';
    } catch {
      // ignorar
    }
    if (res.status === 401) throw new Error('Token inválido o expirado.');
    if (res.status === 403) throw new Error(`Permisos insuficientes en GitHub (${detail || '403'}).`);
    if (res.status === 404) throw new Error('Repositorio o rama no encontrada. Verifica usuario/repositorio.');
    if (res.status === 409 || res.status === 422) {
      throw new Error(`Conflicto de versión en GitHub (${detail || res.status}). Recarga los datos desde GitHub antes de guardar.`);
    }
    throw new Error(`Error de GitHub API (${res.status}): ${detail || res.statusText}`);
  }

  return res.json();
}

/**
 * Autentica un token contra GitHub API verificando permisos reales de escritura (push).
 */
export async function authenticateGitHubSession({ owner, repo, branch = 'main', token }) {
  const cleanOwner = String(owner || '').trim();
  const cleanRepo = String(repo || '').trim();
  const cleanBranch = String(branch || 'main').trim() || 'main';
  const cleanToken = String(token || '').trim();

  if (!cleanOwner || !cleanRepo || !cleanToken) {
    throw new Error('Completa usuario/organización, nombre del repositorio y token.');
  }

  const repoInfo = await ghFetch(`/repos/${encodeURIComponent(cleanOwner)}/${encodeURIComponent(cleanRepo)}`, {}, cleanToken);
  if (!repoInfo.permissions || !repoInfo.permissions.push) {
    throw new Error('El token es válido pero NO tiene permiso de escritura (Contents: Read and write) sobre este repositorio.');
  }

  // Verificar que la rama exista
  const refInfo = await ghFetch(
    `/repos/${encodeURIComponent(cleanOwner)}/${encodeURIComponent(cleanRepo)}/git/ref/heads/${encodeURIComponent(cleanBranch)}`,
    {},
    cleanToken
  );

  let username = cleanOwner;
  try {
    const userInfo = await ghFetch('/user', {}, cleanToken);
    if (userInfo?.login) username = userInfo.login;
  } catch {
    // Algunos fine-grained tokens limitan /user; el permiso push sobre el repo ya fue verificado.
  }

  memoryToken = cleanToken;
  activeRepoConfig = { owner: cleanOwner, repo: cleanRepo, branch: cleanBranch };

  return {
    username,
    canPush: true,
    repoPrivate: Boolean(repoInfo.private),
    headSha: refInfo?.object?.sha || null,
    defaultBranch: repoInfo.default_branch || cleanBranch
  };
}

export function clearGitHubSession() {
  memoryToken = null;
}

export function hasActiveGitHubSession() {
  return Boolean(memoryToken && activeRepoConfig.owner && activeRepoConfig.repo);
}

export function getActiveRepoConfig() {
  return { ...activeRepoConfig };
}

/**
 * Obtiene directamente los archivos JSON desde GitHub API (evita caché CDN de GitHub Pages).
 */
export async function fetchDataFromGitHubApi() {
  const { owner, repo, branch } = activeRepoConfig;
  if (!memoryToken || !owner || !repo) {
    throw new Error('Sesión de GitHub no inicializada.');
  }

  const refInfo = await ghFetch(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/ref/heads/${encodeURIComponent(branch)}`
  );
  const headSha = refInfo.object.sha;

  const readFile = async filePath => {
    try {
      const file = await ghFetch(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${filePath}?ref=${encodeURIComponent(branch)}`
      );
      return JSON.parse(decodeBase64Utf8(file.content));
    } catch {
      return null;
    }
  };

  const [condosDoc, hermanosDoc, configDoc, reportesDoc] = await Promise.all([
    readFile('data/condominios.json'),
    readFile('data/hermanos.json'),
    readFile('data/configuracion.json'),
    readFile('data/reportes.json')
  ]);

  return {
    headSha,
    condominios: Array.isArray(condosDoc) ? condosDoc : (condosDoc?.condominios || []),
    hermanos: Array.isArray(hermanosDoc) ? hermanosDoc : (hermanosDoc?.hermanos || []),
    configuracion: configDoc || null,
    reportes: Array.isArray(reportesDoc) ? reportesDoc : (reportesDoc?.reportes || [])
  };
}

function filterValidReportes(reportes, condominios, resolvedIds = []) {
  const resolvedSet = new Set((resolvedIds || []).map(String));
  const validDeptoMap = new Map();

  (Array.isArray(condominios) ? condominios : []).forEach(c => {
    (Array.isArray(c.edificios) ? c.edificios : []).forEach(e => {
      (Array.isArray(e.deptos) ? e.deptos : []).forEach(d => {
        validDeptoMap.set(String(d.id), d);
      });
    });
  });

  return (Array.isArray(reportes) ? reportes : []).filter(r => {
    if (!r || !r.id || !r.deptoId) return false;
    if (resolvedSet.has(String(r.id))) return false;
    const d = validDeptoMap.get(String(r.deptoId));
    if (!d || d.excluido || d.estado === 'completado') return false;
    if (r.hermanoId && d.asignadoId !== r.hermanoId) return false;
    return true;
  });
}

/**
 * Guarda condominios.json, hermanos.json, configuracion.json y reportes.json de manera ATÓMICA
 * en un único commit de Git utilizando Git Data API.
 */
export async function commitDataAtomically({
  condominiosPayload,
  hermanosPayload,
  configuracionPayload,
  reportesPayload = null,
  resolvedReportIds = [],
  expectedHeadSha = null,
  commitMessage = 'Actualizar datos de condominios desde panel administrativo'
}) {
  const { owner, repo, branch } = activeRepoConfig;
  if (!memoryToken || !owner || !repo) {
    throw new Error('Debes iniciar sesión con tu token de GitHub para publicar cambios.');
  }

  const basePath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

  // 1. Obtener HEAD actual y detectar conflictos de edición simultánea
  const refData = await ghFetch(`${basePath}/git/ref/heads/${encodeURIComponent(branch)}`);
  const currentHeadSha = refData.object.sha;

  if (expectedHeadSha && currentHeadSha !== expectedHeadSha) {
    let onlyReportsChanged = false;
    try {
      const cmp = await ghFetch(
        `${basePath}/compare/${encodeURIComponent(expectedHeadSha)}...${encodeURIComponent(currentHeadSha)}`
      );
      const changedFiles = Array.isArray(cmp?.files) ? cmp.files : [];
      onlyReportsChanged = changedFiles.length > 0 && changedFiles.every(f => f.filename === 'data/reportes.json');
    } catch {
      onlyReportsChanged = false;
    }

    if (!onlyReportsChanged) {
      throw new Error(
        'Se detectaron cambios más recientes en GitHub realizados desde otro dispositivo. Sincroniza desde GitHub antes de guardar para no sobrescribir datos.'
      );
    }
  }

  let remoteReportes = [];
  try {
    const file = await ghFetch(`${basePath}/contents/data/reportes.json?ref=${encodeURIComponent(currentHeadSha)}`);
    const parsed = JSON.parse(decodeBase64Utf8(file.content));
    remoteReportes = Array.isArray(parsed) ? parsed : (parsed?.reportes || []);
  } catch {
    remoteReportes = [];
  }

  const baseReportes = remoteReportes.length > 0
    ? remoteReportes
    : (Array.isArray(reportesPayload?.reportes) ? reportesPayload.reportes : []);
  const finalReportes = filterValidReportes(baseReportes, condominiosPayload?.condominios || [], resolvedReportIds);
  const now = new Date().toISOString();
  const finalReportesPayload = {
    version: 1,
    updatedAt: now,
    reportes: finalReportes
  };

  const headCommit = await ghFetch(`${basePath}/git/commits/${currentHeadSha}`);
  const baseTreeSha = headCommit.tree.sha;

  // 2. Crear blobs UTF-8 para cada archivo JSON
  const files = [
    { path: 'data/condominios.json', content: JSON.stringify(condominiosPayload, null, 2) + '\n' },
    { path: 'data/hermanos.json', content: JSON.stringify(hermanosPayload, null, 2) + '\n' },
    { path: 'data/configuracion.json', content: JSON.stringify(configuracionPayload, null, 2) + '\n' },
    { path: 'data/reportes.json', content: JSON.stringify(finalReportesPayload, null, 2) + '\n' }
  ];

  const treeEntries = [];
  for (const file of files) {
    const blob = await ghFetch(`${basePath}/git/blobs`, {
      method: 'POST',
      body: JSON.stringify({
        content: encodeBase64Utf8(file.content),
        encoding: 'base64'
      })
    });
    treeEntries.push({
      path: file.path,
      mode: '100644',
      type: 'blob',
      sha: blob.sha
    });
  }

  // 3. Crear nuevo tree sobre base_tree
  const newTree = await ghFetch(`${basePath}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({
      base_tree: baseTreeSha,
      tree: treeEntries
    })
  });

  // 4. Crear el commit único
  const newCommit = await ghFetch(`${basePath}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({
      message: commitMessage,
      tree: newTree.sha,
      parents: [currentHeadSha]
    })
  });

  // 5. Avanzar la referencia de la rama (sin force)
  await ghFetch(`${basePath}/git/refs/heads/${encodeURIComponent(branch)}`, {
    method: 'PATCH',
    body: JSON.stringify({
      sha: newCommit.sha,
      force: false
    })
  });

  return {
    commitSha: newCommit.sha,
    committedAt: now,
    reportes: finalReportes
  };
}

