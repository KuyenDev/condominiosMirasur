/**
 * Cloudflare Worker (gratuito) para autenticación con Usuario y Contraseña
 * sin exponer el Token de GitHub ni contraseñas en el frontend público.
 *
 * Variables / Secrets requeridos en Cloudflare Dashboard (Settings -> Variables and Secrets):
 *  - GITHUB_TOKEN (Secret): Fine-grained PAT con Contents: Read and write sobre el repo
 *  - SESSION_SECRET (Secret): Cadena larga y aleatoria para firmar sesiones temporales
 *  - ADMIN_USERS_JSON (Secret): JSON array de usuarios con hash PBKDF2 generado desde el panel Admin
 *      Ejemplo: [{"username":"RLuna","hash":"pbkdf2$100000$...$..."}]
 *  - GITHUB_OWNER (Variable): Ej. "KuyenDev"
 *  - GITHUB_REPO (Variable): Ej. "condominiosMirasur"
 *  - GITHUB_BRANCH (Variable, opcional): Por defecto "main"
 *  - ALLOWED_ORIGIN (Variable): Ej. "https://kuyendev.github.io"
 *  - ALLOW_LOCALHOST (Variable, opcional): "true" si deseas probar desde http://localhost
 */

const GITHUB_API = 'https://api.github.com';
const SESSION_TTL_SECONDS = 8 * 60 * 60; // 8 horas

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function hexToBytes(hex) {
  const clean = String(hex || '').trim();
  if (clean.length % 2 !== 0) return new Uint8Array(0);
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes) {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

function toBase64Url(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(str) {
  const padded = String(str).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function encodeBase64Utf8(str) {
  const bytes = textEncoder.encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function decodeBase64Utf8(b64) {
  const binary = atob(String(b64 || '').replace(/\s/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return textDecoder.decode(bytes);
}

function timingSafeEqual(aBytes, bBytes) {
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) {
    diff |= aBytes[i] ^ bBytes[i];
  }
  return diff === 0;
}

async function verifyPbkdf2Password(password, storedHash) {
  const parts = String(storedHash || '').split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;

  const iterations = Math.min(100000, Math.max(1000, parseInt(parts[1], 10) || 0));
  const saltBytes = hexToBytes(parts[2]);
  const expectedHashBytes = hexToBytes(parts[3]);
  if (saltBytes.length === 0 || expectedHashBytes.length === 0) return false;

  const baseKey = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );

  const derivedBits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations, hash: 'SHA-256' },
    baseKey,
    expectedHashBytes.length * 8
  );

  return timingSafeEqual(new Uint8Array(derivedBits), expectedHashBytes);
}

async function signSessionToken(username, secret) {
  const nowSec = Math.floor(Date.now() / 1000);
  const payload = {
    sub: username,
    iat: nowSec,
    exp: nowSec + SESSION_TTL_SECONDS
  };
  const payloadB64 = toBase64Url(textEncoder.encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, textEncoder.encode(payloadB64)));
  return {
    token: `${payloadB64}.${toBase64Url(sig)}`,
    expiresAt: new Date(payload.exp * 1000).toISOString()
  };
}

async function verifySessionToken(authHeader, secret) {
  if (!secret || !authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  const dotIdx = token.indexOf('.');
  if (dotIdx <= 0) return null;

  const payloadB64 = token.slice(0, dotIdx);
  const sigB64 = token.slice(dotIdx + 1);

  try {
    const key = await crypto.subtle.importKey(
      'raw',
      textEncoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const expectedSig = new Uint8Array(await crypto.subtle.sign('HMAC', key, textEncoder.encode(payloadB64)));
    const providedSig = fromBase64Url(sigB64);

    if (!timingSafeEqual(providedSig, expectedSig)) return null;

    const payload = JSON.parse(textDecoder.decode(fromBase64Url(payloadB64)));
    if (!payload?.sub || !payload?.exp) return null;
    if (Math.floor(Date.now() / 1000) > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function getCorsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowedList = String(env.ALLOWED_ORIGIN || 'https://kuyendev.github.io')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  const allowLocal = String(env.ALLOW_LOCALHOST || '').toLowerCase() === 'true';
  const isLocal = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  const isAllowed = allowedList.includes(origin) || (allowLocal && isLocal);

  return {
    'Access-Control-Allow-Origin': isAllowed ? origin : allowedList[0],
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin'
  };
}

function jsonResponse(data, status, corsHeaders) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...corsHeaders
    }
  });
}

async function ghRequest(path, env, options = {}) {
  const res = await fetch(`${GITHUB_API}${path}`, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      'User-Agent': 'CondominiosMirasur-Worker/1.0',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });

  if (!res.ok) {
    let msg = res.statusText;
    try {
      const body = await res.json();
      if (body?.message) msg = body.message;
    } catch {
      // ignorar
    }
    const err = new Error(`GitHub (${res.status}): ${msg}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

function normalizePersonName(value) {
  return String(value || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function stripHonorific(norm) {
  return norm.replace(/^(?:hno|hna)\.?\s+/i, '').trim();
}

function namesMatch(a, b) {
  const na = normalizePersonName(a);
  const nb = normalizePersonName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const sa = stripHonorific(na);
  const sb = stripHonorific(nb);
  return Boolean(sa && sb && sa === sb);
}

async function readRepoJson(basePath, ref, filePath, env) {
  try {
    const file = await ghRequest(`${basePath}/contents/${filePath}?ref=${encodeURIComponent(ref)}`, env);
    return JSON.parse(decodeBase64Utf8(file.content));
  } catch {
    return null;
  }
}

function extractReportesList(doc) {
  if (Array.isArray(doc)) return doc;
  return Array.isArray(doc?.reportes) ? doc.reportes : [];
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

async function commitRepoFiles({ basePath, branch, currentHeadSha, files, commitMessage, env }) {
  const headCommit = await ghRequest(`${basePath}/git/commits/${currentHeadSha}`, env);
  const baseTreeSha = headCommit.tree.sha;

  const treeEntries = [];
  for (const file of files) {
    const blob = await ghRequest(`${basePath}/git/blobs`, env, {
      method: 'POST',
      body: JSON.stringify({ content: encodeBase64Utf8(file.content), encoding: 'base64' })
    });
    treeEntries.push({ path: file.path, mode: '100644', type: 'blob', sha: blob.sha });
  }

  const newTree = await ghRequest(`${basePath}/git/trees`, env, {
    method: 'POST',
    body: JSON.stringify({ base_tree: baseTreeSha, tree: treeEntries })
  });

  const newCommit = await ghRequest(`${basePath}/git/commits`, env, {
    method: 'POST',
    body: JSON.stringify({
      message: commitMessage,
      tree: newTree.sha,
      parents: [currentHeadSha]
    })
  });

  await ghRequest(`${basePath}/git/refs/heads/${encodeURIComponent(branch)}`, env, {
    method: 'PATCH',
    body: JSON.stringify({ sha: newCommit.sha, force: false })
  });

  return newCommit.sha;
}

export default {
  async fetch(request, env) {
    const cors = getCorsHeaders(request, env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);
    const owner = env.GITHUB_OWNER || 'KuyenDev';
    const repo = env.GITHUB_REPO || 'condominiosMirasur';
    const branch = env.GITHUB_BRANCH || 'main';
    const basePath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

    try {
      if (request.method === 'GET' && url.pathname === '/health') {
        return jsonResponse({ ok: true, service: 'condominios-auth' }, 200, cors);
      }

      if (request.method === 'POST' && url.pathname === '/login') {
        if (!env.SESSION_SECRET || !env.ADMIN_USERS_JSON || !env.GITHUB_TOKEN) {
          return jsonResponse({ error: 'Worker sin configurar (faltan secrets).' }, 500, cors);
        }

        const body = await request.json().catch(() => null);
        const username = String(body?.username || '').trim();
        const password = String(body?.password || '');
        if (!username || !password) {
          return jsonResponse({ error: 'Ingresa usuario y contraseña.' }, 400, cors);
        }

        let parsedUsers;
        try {
          parsedUsers = JSON.parse(env.ADMIN_USERS_JSON);
        } catch {
          return jsonResponse({ error: 'Secret ADMIN_USERS_JSON no contiene un JSON válido.' }, 500, cors);
        }
        const users = Array.isArray(parsedUsers) ? parsedUsers : (parsedUsers ? [parsedUsers] : []);
        const matchedUser = users.find(u => String(u?.username || '').trim().toLowerCase() === username.toLowerCase()) || null;

        const validPassword = matchedUser ? await verifyPbkdf2Password(password, matchedUser.hash) : false;
        if (!matchedUser || !validPassword) {
          return jsonResponse({ error: 'Usuario o contraseña incorrectos.' }, 401, cors);
        }

        const session = await signSessionToken(matchedUser.username, env.SESSION_SECRET);
        const repoInfo = await ghRequest(basePath, env);

        return jsonResponse({
          token: session.token,
          username: matchedUser.username,
          expiresAt: session.expiresAt,
          repoPrivate: Boolean(repoInfo.private)
        }, 200, cors);
      }

      if (request.method === 'GET' && url.pathname === '/reports') {
        if (!env.GITHUB_TOKEN) {
          return jsonResponse({ error: 'Worker sin configurar (falta GITHUB_TOKEN).' }, 500, cors);
        }

        const adminSession = await verifySessionToken(request.headers.get('Authorization'), env.SESSION_SECRET || '');
        const hermanoId = String(url.searchParams.get('hermanoId') || '').trim();

        if (!adminSession && !hermanoId) {
          return jsonResponse({ error: 'Se requiere sesión administrativa o identificador de publicador.' }, 401, cors);
        }

        const reportesDoc = await readRepoJson(basePath, branch, 'data/reportes.json', env);
        const allReportes = extractReportesList(reportesDoc);

        if (adminSession) {
          return jsonResponse({ reportes: allReportes }, 200, cors);
        }

        const filtered = allReportes.filter(r => String(r?.hermanoId || '') === hermanoId);
        return jsonResponse({ reportes: filtered }, 200, cors);
      }

      if (request.method === 'POST' && url.pathname === '/reports') {
        if (!env.GITHUB_TOKEN) {
          return jsonResponse({ error: 'Worker sin configurar (falta GITHUB_TOKEN).' }, 500, cors);
        }

        const body = await request.json().catch(() => null);
        const hermanoId = String(body?.hermanoId || '').trim();
        const hermanoNombre = String(body?.hermanoNombre || '').trim();
        const condoId = String(body?.condoId || '').trim();
        const edificioId = String(body?.edificioId || '').trim();
        const deptoId = String(body?.deptoId || '').trim();
        const action = body?.action === 'unmark' ? 'unmark' : 'mark';
        const nota = String(body?.nota || '').trim().slice(0, 240);

        if (!hermanoId || !hermanoNombre || !condoId || !edificioId || !deptoId) {
          return jsonResponse({ error: 'Faltan datos del publicador o departamento.' }, 400, cors);
        }

        for (let attempt = 0; attempt < 3; attempt++) {
          const refData = await ghRequest(`${basePath}/git/ref/heads/${encodeURIComponent(branch)}`, env);
          const currentHeadSha = refData.object.sha;

          const [hermanosDoc, condosDoc, reportesDoc] = await Promise.all([
            readRepoJson(basePath, currentHeadSha, 'data/hermanos.json', env),
            readRepoJson(basePath, currentHeadSha, 'data/condominios.json', env),
            readRepoJson(basePath, currentHeadSha, 'data/reportes.json', env)
          ]);

          const hermanos = Array.isArray(hermanosDoc) ? hermanosDoc : (hermanosDoc?.hermanos || []);
          const condominios = Array.isArray(condosDoc) ? condosDoc : (condosDoc?.condominios || []);

          const matchedHermano = hermanos.find(h => String(h.id) === hermanoId && namesMatch(h.nombre, hermanoNombre));
          if (!matchedHermano) {
            return jsonResponse({ error: 'No estás autorizado o tu nombre no coincide con la lista actual de publicadores.' }, 403, cors);
          }

          const condo = condominios.find(c => String(c.id) === condoId);
          const edificio = condo?.edificios?.find(e => String(e.id) === edificioId);
          const depto = edificio?.deptos?.find(d => String(d.id) === deptoId);

          if (!condo || !edificio || !depto) {
            return jsonResponse({ error: 'Departamento no encontrado.' }, 404, cors);
          }
          if (depto.excluido) {
            return jsonResponse({ error: 'Este departamento está excluido.' }, 400, cors);
          }
          if (String(depto.asignadoId || '') !== String(matchedHermano.id)) {
            return jsonResponse({ error: 'Solo puedes reportar departamentos asignados a tu nombre.' }, 403, cors);
          }
          if (action === 'mark' && depto.estado === 'completado') {
            return jsonResponse({ error: 'Este departamento ya fue marcado como finalizado definitivo por administración.' }, 409, cors);
          }

          const currentReportes = extractReportesList(reportesDoc);
          const remaining = currentReportes.filter(
            r => !(String(r.deptoId) === deptoId && String(r.hermanoId) === String(matchedHermano.id))
          );

          let createdReport = null;
          const now = new Date().toISOString();
          if (action === 'mark') {
            createdReport = {
              id: `rep_${crypto.randomUUID().slice(0, 12)}`,
              condoId: String(condo.id),
              condoNombre: String(condo.nombre || ''),
              edificioId: String(edificio.id),
              edificioNombre: String(edificio.nombre || ''),
              deptoId: String(depto.id),
              deptoNumero: String(depto.numero || ''),
              piso: Number.isFinite(Number(depto.piso)) ? Number(depto.piso) : 1,
              hermanoId: String(matchedHermano.id),
              hermanoNombre: String(matchedHermano.nombre),
              tipo: 'completado',
              nota,
              createdAt: now
            };
            remaining.push(createdReport);
          }

          const reportesPayload = {
            version: 1,
            updatedAt: now,
            reportes: remaining
          };

          try {
            await commitRepoFiles({
              basePath,
              branch,
              currentHeadSha,
              files: [
                { path: 'data/reportes.json', content: JSON.stringify(reportesPayload, null, 2) + '\n' }
              ],
              commitMessage: `[Publicador: ${matchedHermano.nombre}] ${action === 'mark' ? 'Marcar para revisión' : 'Quitar marca'} Depto ${depto.numero}`,
              env
            });

            return jsonResponse({
              ok: true,
              report: createdReport,
              reportes: remaining.filter(r => String(r.hermanoId) === String(matchedHermano.id)),
              updatedAt: now
            }, 200, cors);
          } catch (commitErr) {
            if ((commitErr.status === 409 || commitErr.status === 422) && attempt < 2) {
              continue;
            }
            throw commitErr;
          }
        }
      }

      // Rutas protegidas por sesión firmada
      const session = await verifySessionToken(request.headers.get('Authorization'), env.SESSION_SECRET || '');
      if (!session) {
        return jsonResponse({ error: 'Sesión inválida o expirada. Inicia sesión nuevamente.' }, 401, cors);
      }

      if (request.method === 'GET' && url.pathname === '/data') {
        const [repoInfo, refInfo] = await Promise.all([
          ghRequest(basePath, env),
          ghRequest(`${basePath}/git/ref/heads/${encodeURIComponent(branch)}`, env)
        ]);

        const headSha = refInfo.object.sha;
        const [condosDoc, hermanosDoc, configDoc, reportesDoc] = await Promise.all([
          readRepoJson(basePath, headSha, 'data/condominios.json', env),
          readRepoJson(basePath, headSha, 'data/hermanos.json', env),
          readRepoJson(basePath, headSha, 'data/configuracion.json', env),
          readRepoJson(basePath, headSha, 'data/reportes.json', env)
        ]);

        return jsonResponse({
          headSha,
          repoPrivate: Boolean(repoInfo.private),
          condominios: Array.isArray(condosDoc) ? condosDoc : (condosDoc?.condominios || []),
          hermanos: Array.isArray(hermanosDoc) ? hermanosDoc : (hermanosDoc?.hermanos || []),
          configuracion: configDoc || null,
          reportes: extractReportesList(reportesDoc)
        }, 200, cors);
      }

      if (request.method === 'POST' && url.pathname === '/commit') {
        const body = await request.json().catch(() => null);
        if (!body?.condominiosPayload || !body?.hermanosPayload || !body?.configuracionPayload) {
          return jsonResponse({ error: 'Faltan payloads JSON para publicar.' }, 400, cors);
        }

        const refData = await ghRequest(`${basePath}/git/ref/heads/${encodeURIComponent(branch)}`, env);
        const currentHeadSha = refData.object.sha;

        if (body.expectedHeadSha && body.expectedHeadSha !== currentHeadSha) {
          let onlyReportsChanged = false;
          try {
            const cmp = await ghRequest(
              `${basePath}/compare/${encodeURIComponent(body.expectedHeadSha)}...${encodeURIComponent(currentHeadSha)}`,
              env
            );
            const changedFiles = Array.isArray(cmp?.files) ? cmp.files : [];
            onlyReportsChanged = changedFiles.length > 0 && changedFiles.every(f => f.filename === 'data/reportes.json');
          } catch {
            onlyReportsChanged = false;
          }

          if (!onlyReportsChanged) {
            return jsonResponse({
              error: 'Se detectaron cambios más recientes en GitHub. Recarga los datos antes de publicar.'
            }, 409, cors);
          }
        }

        const remoteReportesDoc = await readRepoJson(basePath, currentHeadSha, 'data/reportes.json', env);
        const remoteReportes = extractReportesList(remoteReportesDoc);
        const condominiosList = body.condominiosPayload?.condominios || [];
        const resolvedIds = Array.isArray(body.resolvedReportIds) ? body.resolvedReportIds : [];
        const baseReportes = remoteReportes.length > 0
          ? remoteReportes
          : extractReportesList(body.reportesPayload);

        const finalReportes = filterValidReportes(baseReportes, condominiosList, resolvedIds);
        const now = new Date().toISOString();
        const finalReportesPayload = {
          version: 1,
          updatedAt: now,
          reportes: finalReportes
        };

        const files = [
          { path: 'data/condominios.json', content: JSON.stringify(body.condominiosPayload, null, 2) + '\n' },
          { path: 'data/hermanos.json', content: JSON.stringify(body.hermanosPayload, null, 2) + '\n' },
          { path: 'data/configuracion.json', content: JSON.stringify(body.configuracionPayload, null, 2) + '\n' },
          { path: 'data/reportes.json', content: JSON.stringify(finalReportesPayload, null, 2) + '\n' }
        ];

        const baseMsg = String(body.commitMessage || 'Actualizar datos').trim();
        const commitSha = await commitRepoFiles({
          basePath,
          branch,
          currentHeadSha,
          files,
          commitMessage: `[${session.sub}] ${baseMsg}`,
          env
        });

        return jsonResponse({
          commitSha,
          committedAt: now,
          reportes: finalReportes
        }, 200, cors);
      }

      return jsonResponse({ error: 'Ruta no encontrada.' }, 404, cors);
    } catch (err) {
      return jsonResponse({ error: err.message || 'Error interno en Worker.' }, err.status || 500, cors);
    }
  }
};
