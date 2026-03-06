import React, { useState, useCallback, useRef } from 'react';
import createContextHook from '@nkzw/create-context-hook';
import type { NotificationType } from '@/components/InAppNotification';

interface NotificationState {
  visible: boolean;
  title: string;
  message: string;
  type: NotificationType;
  onPress?: () => void;
}

const INITIAL: NotificationState = {
  visible: false,
  title: '',
  message: '',
  type: 'info',
};

export const [NotificationProvider, useNotificationContext] = createContextHook(() => {
  const [notification, setNotification] = useState<NotificationState>(INITIAL);
  const queueRef = useRef<NotificationState[]>([]);

  const showNotification = useCallback((
    title: string,
    message: string,
    type: NotificationType = 'info',
    onPress?: () => void,
  ) => {
    const next: NotificationState = { visible: true, title, message, type, onPress };
    if (notification.visible) {
      queueRef.current.push(next);
    } else {
      setNotification(next);
    }
    console.log('[Notification] Show:', type, title);
  }, [notification.visible]);

  const dismiss = useCallback(() => {
    setNotification(INITIAL);
    setTimeout(() => {
      if (queueRef.current.length > 0) {
        const next = queueRef.current.shift()!;
        setNotification(next);
      }
    }, 300);
  }, []);

  return { notification, showNotification, dismiss };
});
