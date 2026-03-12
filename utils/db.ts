import { getClientEnv } from '@/utils/clientEnv';

interface DbConfig {
  endpoint: string;
  namespace: string;
  token: string;
}

function normalizeEnvValue(value: string | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function getOptionalDbConfig(): DbConfig | null {
  const endpoint = normalizeEnvValue(getClientEnv('EXPO_PUBLIC_RORK_DB_ENDPOINT'));
  const namespace = normalizeEnvValue(getClientEnv('EXPO_PUBLIC_RORK_DB_NAMESPACE'));
  const token = normalizeEnvValue(getClientEnv('EXPO_PUBLIC_RORK_DB_TOKEN'));

  if (!endpoint || !namespace || !token) {
    return null;
  }

  return {
    endpoint,
    namespace,
    token,
  };
}

export function hasDbConfig(): boolean {
  return getOptionalDbConfig() !== null;
}

export function getDbHeaders(extraHeaders?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(extraHeaders ?? {}),
  };

  const dbConfig = getOptionalDbConfig();
  if (!dbConfig) {
    return headers;
  }

  headers['x-db-endpoint'] = dbConfig.endpoint;
  headers['x-db-namespace'] = dbConfig.namespace;
  headers['x-db-token'] = dbConfig.token;

  return headers;
}

export function getDbBootstrapPayload(): Record<string, string> {
  const dbConfig = getOptionalDbConfig();
  if (!dbConfig) {
    return {};
  }

  return {
    endpoint: dbConfig.endpoint,
    namespace: dbConfig.namespace,
    token: dbConfig.token,
  };
}

export function getDbRequestConfigPayload(): Record<string, string> {
  const dbConfig = getOptionalDbConfig();
  if (!dbConfig) {
    return {};
  }

  return {
    dbEndpoint: dbConfig.endpoint,
    dbNamespace: dbConfig.namespace,
    dbToken: dbConfig.token,
  };
}
