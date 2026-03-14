import { useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';

interface UseAppActiveResult {
  appState: AppStateStatus;
  isAppActive: boolean;
}

export function useAppActive(): UseAppActiveResult {
  const [appState, setAppState] = useState<AppStateStatus>(AppState.currentState);
  const previousAppStateRef = useRef<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      console.log('[AppState] State changed:', previousAppStateRef.current, '->', nextState);
      previousAppStateRef.current = nextState;
      setAppState(nextState);
    });

    return () => {
      subscription.remove();
    };
  }, []);

  return {
    appState,
    isAppActive: appState === 'active',
  };
}
