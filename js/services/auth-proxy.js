/**
 * Cliente ligero para el servicio intermediario de cuentas (Cloudflare Worker).
 *
 * SEGURIDAD:
 * - El ticket temporal de sesión vive únicamente en memoria RAM de este módulo.
 * - La aplicación jamás almacena contraseñas ni tokens de GitHub en el navegador.
 */

let memoryTicket = null;
let activeEndpoint = '';

function normalizeEndpoint(url) {
  return String(url || '').trim().replace(/\/+$/, '');
}

async function proxyFetch(path, options = {}) {
  if (!activeEndpoint) {
    throw new Error('No hay URL de servidor de cuentas configurada.');
  }

  const headers = {
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(memoryTicket ? { Authorization: `Bearer ${memoryTicket}` } : {}),
    ...(options.headers || {})
  };

  const res = await fetch(`${activeEndpoint}${path}`, {
    ...options,
    headers
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Error del servidor (${res.status}).`);
  }
  return data;
}

export async function authenticateWithProxy({ endpoint, username, password }) {
  const cleanEndpoint = normalizeEndpoint(endpoint);
  if (!cleanEndpoint) {
    throw new Error('Ingresa la URL del servicio Cloudflare Worker.');
  }

  activeEndpoint = cleanEndpoint;
  memoryTicket = null;

  const res = await proxyFetch('/login', {
    method: 'POST',
    body: JSON.stringify({ username, password })
  });

  memoryTicket = res.token;
  return {
    endpoint: cleanEndpoint,
    username: res.username,
    expiresAt: res.expiresAt,
    repoPrivate: Boolean(res.repoPrivate)
  };
}

export function clearProxySession() {
  memoryTicket = null;
}

export function hasActiveProxySession() {
  return Boolean(memoryTicket && activeEndpoint);
}

export async function fetchDataViaProxy() {
  return proxyFetch('/data', { method: 'GET' });
}

export async function commitDataViaProxy({
  condominiosPayload,
  hermanosPayload,
  configuracionPayload,
  expectedHeadSha = null,
  commitMessage = 'Actualizar datos'
}) {
  return proxyFetch('/commit', {
    method: 'POST',
    body: JSON.stringify({
      condominiosPayload,
      hermanosPayload,
      configuracionPayload,
      expectedHeadSha,
      commitMessage
    })
  });
}

/**
 * Genera localmente en el navegador (Web Crypto PBKDF2-SHA256) una entrada segura
 * lista para pegar en el secret ADMIN_USERS_JSON de Cloudflare Workers.
 */
export async function generateAccountHashEntry(username, password) {
  const cleanUser = String(username || '').trim();
  const cleanPass = String(password || '');
  if (!cleanUser || cleanPass.length < 6) {
    throw new Error('Ingresa un usuario y una contraseña de al menos 6 caracteres.');
  }

  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);

  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey('raw', enc.encode(cleanPass), 'PBKDF2', false, ['deriveBits']);
  const derived = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
      baseKey,
      256
    )
  );

  const toHex = arr => Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
  return {
    username: cleanUser,
    hash: `pbkdf2$100000$${toHex(salt)}$${toHex(derived)}`
  };
}
