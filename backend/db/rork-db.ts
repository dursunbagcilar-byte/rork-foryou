let STATIC_ENDPOINT = '';
let STATIC_NAMESPACE = '';
let STATIC_TOKEN = '';
let _envChecked = false;
let _envRetryCount = 0;
const MAX_ENV_RETRIES = 50;
let _lastEnvRetryTime = 0;

let _cachedConfig: { endpoint: string; namespace: string; token: string } | null = null;

interface PendingOperation {
  type: 'upsert' | 'delete';
  table: string;
  id: string;
  data?: Record<string, any>;
  timestamp: number;
}

const _pendingOps: PendingOperation[] = [];
let _flushingPending = false;

function findSingleEnvValue(key: string): string {
  try {
    const d = (globalThis as any).Deno;
    if (d?.env?.get) {
      const val = d.env.get(key);
      if (val) return val;
    }
  } catch {}
  try {
    if (typeof process !== 'undefined' && process.env) {
      const val = (process.env as Record<string, string | undefined>)[key];
      if (val) return val;
    }
  } catch {}
  return '';
}

function tryReadEnvVars(): void {
  const ENV_KEYS_ENDPOINT = ['EXPO_PUBLIC_RORK_DB_ENDPOINT', 'RORK_DB_ENDPOINT', 'DB_ENDPOINT', 'SURREAL_ENDPOINT'];
  const ENV_KEYS_NAMESPACE = ['EXPO_PUBLIC_RORK_DB_NAMESPACE', 'RORK_DB_NAMESPACE', 'DB_NAMESPACE', 'SURREAL_NAMESPACE'];
  const ENV_KEYS_TOKEN = ['EXPO_PUBLIC_RORK_DB_TOKEN', 'RORK_DB_TOKEN', 'DB_TOKEN', 'SURREAL_TOKEN'];

  function findEnvValue(keys: string[]): string {
    for (const key of keys) {
      const val = findSingleEnvValue(key);
      if (val) return val;
    }
    return '';
  }

  if (!STATIC_ENDPOINT) STATIC_ENDPOINT = findEnvValue(ENV_KEYS_ENDPOINT);
  if (!STATIC_NAMESPACE) STATIC_NAMESPACE = findEnvValue(ENV_KEYS_NAMESPACE);
  if (!STATIC_TOKEN) STATIC_TOKEN = findEnvValue(ENV_KEYS_TOKEN);
}

tryReadEnvVars();

try {
  const d = (globalThis as any).Deno;
  if (d?.env?.toObject) {
    const allKeys = Object.keys(d.env.toObject());
    const relevant = allKeys.filter((k: string) => k.includes('RORK') || k.includes('DB') || k.includes('SURREAL'));
    console.log('[RORK-DB] v12 Deno env keys:', allKeys.length, 'relevant:', relevant.join(',') || 'NONE');
  }
} catch (e) {
  console.log('[RORK-DB] v12 Deno env enumeration error:', e);
}

console.log('[RORK-DB] v13 init - endpoint:', STATIC_ENDPOINT ? 'YES' : 'NO', 'ns:', STATIC_NAMESPACE ? 'YES' : 'NO', 'token:', STATIC_TOKEN ? 'YES' : 'NO');

function readEnvDirect(key: string): string {
  try {
    const d = (globalThis as any).Deno;
    if (d?.env?.get) {
      const val = d.env.get(key);
      if (val) return val;
    }
  } catch {}
  try {
    if (typeof process !== 'undefined' && process.env) {
      const envObj = process.env as Record<string, string | undefined>;
      const val = envObj[key];
      if (val) return val;
    }
  } catch {}
  return '';
}

function getConfig() {
  let endpoint = STATIC_ENDPOINT
    || readEnvDirect('EXPO_PUBLIC_RORK_DB_ENDPOINT')
    || readEnvDirect('RORK_DB_ENDPOINT');
  let namespace = STATIC_NAMESPACE
    || readEnvDirect('EXPO_PUBLIC_RORK_DB_NAMESPACE')
    || readEnvDirect('RORK_DB_NAMESPACE');
  let token = STATIC_TOKEN
    || readEnvDirect('EXPO_PUBLIC_RORK_DB_TOKEN')
    || readEnvDirect('RORK_DB_TOKEN');

  if ((!endpoint || !namespace || !token) && _cachedConfig) {
    if (!endpoint && _cachedConfig.endpoint) endpoint = _cachedConfig.endpoint;
    if (!namespace && _cachedConfig.namespace) namespace = _cachedConfig.namespace;
    if (!token && _cachedConfig.token) token = _cachedConfig.token;
  }

  return { endpoint, namespace, token };
}

function retryEnvVars(): void {
  if (!STATIC_ENDPOINT || !STATIC_NAMESPACE || !STATIC_TOKEN) {
    const now = Date.now();
    if (_envRetryCount < MAX_ENV_RETRIES || (now - _lastEnvRetryTime > 5000)) {
      _envRetryCount++;
      _lastEnvRetryTime = now;
      tryReadEnvVars();
      if (STATIC_ENDPOINT && STATIC_NAMESPACE && STATIC_TOKEN) {
        console.log('[RORK-DB] Env vars found on retry #' + _envRetryCount);
      }
    }
  }
  _envChecked = true;
}

function isValidUrl(str: string): boolean {
  try {
    const url = new URL(str);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isConfigured(): boolean {
  retryEnvVars();
  const config = getConfig();
  const ok = !!(config.endpoint && config.namespace && config.token && isValidUrl(config.endpoint));
  if (!ok && _envRetryCount <= 3) {
    console.log('[RORK-DB] isConfigured=false - endpoint:', config.endpoint ? 'present' : 'MISSING', 'ns:', config.namespace ? 'present' : 'MISSING', 'token:', config.token ? 'present' : 'MISSING', 'validUrl:', config.endpoint ? isValidUrl(config.endpoint) : false);
  }
  return ok;
}

async function executeSql(sql: string): Promise<any[]> {
  const config = getConfig();
  if (!config.endpoint) {
    console.log('[RORK-DB] No endpoint, skipping');
    throw new Error('[RORK-DB] No endpoint configured');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(`${config.endpoint}/sql`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.token}`,
        'surreal-ns': config.namespace,
        'surreal-db': 'main',
        'Accept': 'application/json',
        'Content-Type': 'text/plain',
      },
      body: sql,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      const text = await res.text();
      console.log('[RORK-DB] Query failed:', res.status, text);
      throw new Error(`[RORK-DB] Query failed: ${res.status}`);
    }

    const results = await res.json();
    console.log('[RORK-DB] Query OK, results:', Array.isArray(results) ? results.length : 'non-array');

    if (Array.isArray(results)) {
      for (const r of results) {
        if (r.status === 'ERR') {
          console.log('[RORK-DB] SQL error:', r.result);
          throw new Error(`[RORK-DB] SQL error: ${r.result}`);
        }
      }
      return results;
    }
    return [];
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err?.name === 'AbortError') {
      console.log('[RORK-DB] Query timed out (8s)');
      throw new Error('[RORK-DB] Query timed out');
    }
    throw err;
  }
}

function escapeValue(val: string): string {
  return val.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function toSurrealId(table: string, id: string): string {
  return `${table}:\`${escapeValue(id)}\``;
}

export async function dbLoadAll<T>(table: string): Promise<T[]> {
  if (!isConfigured()) return [];
  console.log(`[RORK-DB] Loading all from table: ${table}`);
  try {
    const results = await executeSql(`SELECT * FROM ${table};`);
    if (results.length > 0 && results[0].result) {
      const items = results[0].result as T[];
      console.log(`[RORK-DB] Loaded ${items.length} records from ${table}`);
      return items;
    }
    return [];
  } catch (err) {
    console.log(`[RORK-DB] Error loading from ${table}:`, err);
    return [];
  }
}

export async function dbUpsert(table: string, id: string, data: Record<string, any>): Promise<void> {
  if (!isConfigured()) {
    const existing = _pendingOps.findIndex(op => op.type === 'upsert' && op.table === table && op.id === id);
    if (existing >= 0) {
      _pendingOps[existing] = { type: 'upsert', table, id, data, timestamp: Date.now() };
    } else {
      _pendingOps.push({ type: 'upsert', table, id, data, timestamp: Date.now() });
    }
    console.log(`[RORK-DB] Queued upsert ${table}:${id} (pending: ${_pendingOps.length})`);
    throw new Error(`[RORK-DB] DB not configured, queued ${table}:${id}`);
  }
  const jsonData = JSON.stringify(data);
  const sql = `UPSERT ${toSurrealId(table, id)} CONTENT ${jsonData};`;
  console.log(`[RORK-DB] Upsert ${table}:${id}`);
  await executeSql(sql);
}

export async function dbDelete(table: string, id: string): Promise<void> {
  if (!isConfigured()) {
    const upsertIdx = _pendingOps.findIndex(op => op.type === 'upsert' && op.table === table && op.id === id);
    if (upsertIdx >= 0) _pendingOps.splice(upsertIdx, 1);
    _pendingOps.push({ type: 'delete', table, id, timestamp: Date.now() });
    console.log(`[RORK-DB] Queued delete ${table}:${id} (pending: ${_pendingOps.length})`);
    throw new Error(`[RORK-DB] DB not configured, queued delete ${table}:${id}`);
  }
  const sql = `DELETE ${toSurrealId(table, id)};`;
  console.log(`[RORK-DB] Delete ${table}:${id}`);
  await executeSql(sql);
}

export async function dbGet<T>(table: string, id: string): Promise<T | null> {
  if (!isConfigured()) return null;
  try {
    const results = await executeSql(`SELECT * FROM ${toSurrealId(table, id)};`);
    if (results.length > 0 && results[0].result && results[0].result.length > 0) {
      return results[0].result[0] as T;
    }
    return null;
  } catch (err) {
    console.log(`[RORK-DB] Error getting ${table}:${id}:`, err);
    return null;
  }
}

export async function dbFindByEmail<T>(table: string, email: string): Promise<T | null> {
  if (!isConfigured()) return null;
  try {
    const safeEmail = escapeValue(email.toLowerCase().trim());
    const results = await executeSql(`SELECT * FROM ${table} WHERE email = '${safeEmail}';`);
    if (results.length > 0 && results[0].result && results[0].result.length > 0) {
      console.log(`[RORK-DB] dbFindByEmail found record in ${table} for email: ${email}`);
      return results[0].result[0] as T;
    }
    console.log(`[RORK-DB] dbFindByEmail: no record in ${table} for email: ${email}`);
    return null;
  } catch (err) {
    console.log(`[RORK-DB] dbFindByEmail error for ${table}/${email}:`, err);
    return null;
  }
}

export async function flushPendingOps(): Promise<number> {
  if (_flushingPending || _pendingOps.length === 0 || !isConfigured()) return 0;
  _flushingPending = true;
  const ops = [..._pendingOps];
  _pendingOps.length = 0;
  let flushed = 0;
  console.log(`[RORK-DB] Flushing ${ops.length} pending operations...`);
  for (const op of ops) {
    try {
      if (op.type === 'upsert' && op.data) {
        const jsonData = JSON.stringify(op.data);
        const sql = `UPSERT ${toSurrealId(op.table, op.id)} CONTENT ${jsonData};`;
        await executeSql(sql);
        flushed++;
      } else if (op.type === 'delete') {
        const sql = `DELETE ${toSurrealId(op.table, op.id)};`;
        await executeSql(sql);
        flushed++;
      }
    } catch (err) {
      console.log(`[RORK-DB] Failed to flush op ${op.type} ${op.table}:${op.id}:`, err);
      _pendingOps.push(op);
    }
  }
  _flushingPending = false;
  console.log(`[RORK-DB] Flushed ${flushed}/${ops.length} pending operations`);
  return flushed;
}

export function getPendingOpsCount(): number {
  return _pendingOps.length;
}

export function setDbConfig(endpoint: string, namespace: string, token: string): boolean {
  if (!endpoint || !namespace || !token) return false;
  if (!isValidUrl(endpoint)) {
    console.log('[RORK-DB] setDbConfig rejected - invalid URL:', endpoint);
    return false;
  }
  STATIC_ENDPOINT = endpoint;
  STATIC_NAMESPACE = namespace;
  STATIC_TOKEN = token;
  _cachedConfig = { endpoint, namespace, token };
  _envChecked = true;
  console.log('[RORK-DB] Config set externally - endpoint:', endpoint.substring(0, 30) + '...', 'ns:', namespace ? 'YES' : 'NO', 'token:', token ? 'YES' : 'NO');
  if (_pendingOps.length > 0) {
    console.log(`[RORK-DB] DB configured with ${_pendingOps.length} pending ops, will flush...`);
    flushPendingOps().catch(err => console.log('[RORK-DB] Flush after config error:', err));
  }
  return true;
}

export function reapplyDbConfig(): boolean {
  if (_cachedConfig) {
    STATIC_ENDPOINT = _cachedConfig.endpoint;
    STATIC_NAMESPACE = _cachedConfig.namespace;
    STATIC_TOKEN = _cachedConfig.token;
    _envChecked = true;
    return true;
  }
  return false;
}

export function getCachedDbConfig(): { endpoint: string; namespace: string; token: string } | null {
  return _cachedConfig;
}

export async function dbSearchPasswordByEmail(email: string): Promise<{ hash: string; email: string } | null> {
  if (!isConfigured()) return null;
  try {
    const safeEmail = escapeValue(email.toLowerCase().trim());
    const results = await executeSql(
      `SELECT * FROM passwords WHERE _originalEmail = '${safeEmail}' OR email = '${safeEmail}';`
    );
    if (results.length > 0 && results[0].result && results[0].result.length > 0) {
      const record = results[0].result[0];
      if (record.hash) {
        console.log(`[RORK-DB] dbSearchPasswordByEmail found password for: ${email}`);
        return { hash: record.hash, email: record._originalEmail || record.email || email };
      }
    }
    console.log(`[RORK-DB] dbSearchPasswordByEmail: no password found for: ${email}`);
    return null;
  } catch (err) {
    console.log(`[RORK-DB] dbSearchPasswordByEmail error for ${email}:`, err);
    return null;
  }
}

export async function dbDirectUpsert(table: string, id: string, data: Record<string, any>): Promise<boolean> {
  if (!isConfigured()) {
    console.log(`[RORK-DB] dbDirectUpsert: DB not configured for ${table}:${id}`);
    return false;
  }
  try {
    const jsonData = JSON.stringify(data);
    const sql = `UPSERT ${toSurrealId(table, id)} CONTENT ${jsonData};`;
    await executeSql(sql);
    console.log(`[RORK-DB] dbDirectUpsert OK for ${table}:${id}`);
    return true;
  } catch (err) {
    console.log(`[RORK-DB] dbDirectUpsert FAILED for ${table}:${id}:`, err);
    return false;
  }
}

export { isConfigured as isDbConfigured, getConfig as getDbRawConfig };
