import { useState, useEffect, useCallback, useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import createContextHook from '@nkzw/create-context-hook';
import { Colors } from '@/constants/colors';

type ThemeMode = 'light' | 'dark';

const THEME_KEY = 'app_theme_mode';

export const [ThemeProvider, useTheme] = createContextHook(() => {
  const [mode, setMode] = useState<ThemeMode>('dark');
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    AsyncStorage.getItem(THEME_KEY)
      .then((stored) => {
        if (stored === 'light' || stored === 'dark') {
          setMode(stored);
        }
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, []);

  const toggleTheme = useCallback(async () => {
    const next: ThemeMode = mode === 'dark' ? 'light' : 'dark';
    setMode(next);
    await AsyncStorage.setItem(THEME_KEY, next);
    console.log('[Theme] Switched to:', next);
  }, [mode]);

  const setTheme = useCallback(async (newMode: ThemeMode) => {
    setMode(newMode);
    await AsyncStorage.setItem(THEME_KEY, newMode);
    console.log('[Theme] Set to:', newMode);
  }, []);

  const colors = useMemo(() => {
    return mode === 'dark' ? Colors.dark : Colors.light;
  }, [mode]);

  const isDark = mode === 'dark';

  return { mode, isDark, colors, toggleTheme, setTheme, isLoading };
});
