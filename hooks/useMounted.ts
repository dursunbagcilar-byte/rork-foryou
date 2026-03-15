import { useEffect, useState } from 'react';

export function useMounted() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return mounted;
}

export function useIsWeb() {
  const [isWeb, setIsWeb] = useState(false);

  useEffect(() => {
    const { Platform } = require('react-native');
    setIsWeb(Platform.OS === 'web');
  }, []);

  return isWeb;
}
