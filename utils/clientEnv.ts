import Constants from 'expo-constants';

interface ExpoConfigWithExtra {
  extra?: Record<string, unknown>;
}

interface ManifestWithExtra {
  extra?: Record<string, unknown>;
}

interface ConstantsWithExtraSources {
  manifest2?: ManifestWithExtra | null;
  manifest?: ManifestWithExtra | null;
  __unsafeNoLongerMutatedManifest?: ManifestWithExtra | null;
}

function normalizeEnvValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readInlineExpoPublicEnv(key: string): string {
  switch (key) {
    case 'EXPO_PUBLIC_GOOGLE_MAPS_API_KEY':
      return normalizeEnvValue(process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY);
    case 'EXPO_PUBLIC_RORK_API_BASE_URL':
      return normalizeEnvValue(process.env.EXPO_PUBLIC_RORK_API_BASE_URL);
    case 'EXPO_PUBLIC_RORK_AUTH_URL':
      return normalizeEnvValue(process.env.EXPO_PUBLIC_RORK_AUTH_URL);
    case 'EXPO_PUBLIC_RORK_DB_ENDPOINT':
      return normalizeEnvValue(process.env.EXPO_PUBLIC_RORK_DB_ENDPOINT);
    case 'EXPO_PUBLIC_RORK_DB_NAMESPACE':
      return normalizeEnvValue(process.env.EXPO_PUBLIC_RORK_DB_NAMESPACE);
    case 'EXPO_PUBLIC_RORK_DB_TOKEN':
      return normalizeEnvValue(process.env.EXPO_PUBLIC_RORK_DB_TOKEN);
    case 'EXPO_PUBLIC_TOOLKIT_URL':
      return normalizeEnvValue(process.env.EXPO_PUBLIC_TOOLKIT_URL);
    case 'EXPO_PUBLIC_PROJECT_ID':
      return normalizeEnvValue(process.env.EXPO_PUBLIC_PROJECT_ID);
    case 'EXPO_PUBLIC_TEAM_ID':
      return normalizeEnvValue(process.env.EXPO_PUBLIC_TEAM_ID);
    case 'EXPO_PUBLIC_RORK_APP_KEY':
      return normalizeEnvValue(process.env.EXPO_PUBLIC_RORK_APP_KEY);
    default:
      return '';
  }
}

function readProcessEnv(key: string): string {
  try {
    const inlineValue = readInlineExpoPublicEnv(key);
    if (inlineValue) {
      return inlineValue;
    }
  } catch (error) {
    console.log('[Env] inline process.env read error for key:', key, error);
  }

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
    const constantsWithExtras = Constants as unknown as ConstantsWithExtraSources;
    const manifest2Value = normalizeEnvValue(constantsWithExtras.manifest2?.extra?.[key]);
    if (manifest2Value) {
      return manifest2Value;
    }

    const manifestValue = normalizeEnvValue(constantsWithExtras.manifest?.extra?.[key]);
    if (manifestValue) {
      return manifestValue;
    }

    const unsafeManifestValue = normalizeEnvValue(constantsWithExtras.__unsafeNoLongerMutatedManifest?.extra?.[key]);
    if (unsafeManifestValue) {
      return unsafeManifestValue;
    }
  } catch (error) {
    console.log('[Env] Constants manifest read error for key:', key, error);
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
