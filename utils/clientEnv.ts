import Constants from 'expo-constants';

interface ExpoConfigWithExtra {
  extra?: Record<string, unknown>;
}

interface ManifestWithExtra {
  extra?: Record<string, unknown>;
}

function normalizeEnvValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readProcessEnv(key: string): string {
  try {
    const envValue = (process.env as Record<string, string | undefined> | undefined)?.[key];
    return normalizeEnvValue(envValue);
  } catch (error) {
    console.log('[Env] process.env read error for key:', key, error);
    return '';
  }
}

function readExpoConfigExtra(key: string): string {
  try {
    const expoConfig = Constants.expoConfig as ExpoConfigWithExtra | null;
    const directValue = normalizeEnvValue(expoConfig?.extra?.[key]);
    if (directValue) {
      return directValue;
    }
  } catch (error) {
    console.log('[Env] Constants.expoConfig read error for key:', key, error);
  }

  try {
    const constantsWithManifest = Constants as unknown as {
      manifest2?: ManifestWithExtra | null;
    };
    const manifestValue = normalizeEnvValue(constantsWithManifest.manifest2?.extra?.[key]);
    if (manifestValue) {
      return manifestValue;
    }
  } catch (error) {
    console.log('[Env] Constants.manifest2 read error for key:', key, error);
  }

  return '';
}

export function getClientEnv(key: string): string {
  const processValue = readProcessEnv(key);
  if (processValue) {
    return processValue;
  }

  const configValue = readExpoConfigExtra(key);
  if (configValue) {
    return configValue;
  }

  return '';
}
