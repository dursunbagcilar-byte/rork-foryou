import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const duplicatePath = resolve(process.cwd(), 'node_modules/@teovilla/react-native-web-maps/node_modules/expo-location');

console.log('[sdk-fix] Checking for duplicate expo-location at:', duplicatePath);

if (!existsSync(duplicatePath)) {
  console.log('[sdk-fix] No duplicate expo-location found.');
  process.exit(0);
}

try {
  rmSync(duplicatePath, { recursive: true, force: true });
  console.log('[sdk-fix] Removed nested expo-location successfully.');
} catch (error) {
  console.error('[sdk-fix] Failed to remove nested expo-location.', error);
  process.exit(1);
}
