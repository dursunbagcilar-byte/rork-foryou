import type { ConfigContext, ExpoConfig } from 'expo/config';

const appJson = require('./app.json') as { expo: ExpoConfig };

const EXTRA_ENV_KEYS = [
  'EXPO_PUBLIC_GOOGLE_MAPS_API_KEY',
  'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID',
  'EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID',
  'EXPO_PUBLIC_RORK_API_BASE_URL',
  'EXPO_PUBLIC_RORK_AUTH_URL',
  'EXPO_PUBLIC_RORK_DB_ENDPOINT',
  'EXPO_PUBLIC_RORK_DB_NAMESPACE',
  'EXPO_PUBLIC_RORK_DB_TOKEN',
  'EXPO_PUBLIC_TOOLKIT_URL',
  'EXPO_PUBLIC_PROJECT_ID',
  'EXPO_PUBLIC_TEAM_ID',
] as const;

export default ({ config }: ConfigContext): ExpoConfig => {
  const baseConfig = appJson.expo ?? {};
  const extraEntries = EXTRA_ENV_KEYS.map((key) => [key, process.env[key] ?? '']);

  return {
    ...config,
    ...baseConfig,
    extra: {
      ...baseConfig.extra,
      ...Object.fromEntries(extraEntries),
    },
  };
};
