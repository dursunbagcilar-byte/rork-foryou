import { useState, useEffect, useCallback, useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import createContextHook from '@nkzw/create-context-hook';
import { getTurkishPhoneValidationError, normalizeTurkishPhone } from '@/utils/phone';

export type RideForOtherPaymentMode = 'customer_app' | 'guest_in_car';

export interface RideRecipient {
  id: string;
  name: string;
  phone: string;
  relation?: string;
  source: 'manual' | 'saved';
  createdAt: string;
  updatedAt: string;
  useCount: number;
}

export interface RideForOthersDraft {
  enabled: boolean;
  recipient: RideRecipient | null;
  paymentMode: RideForOtherPaymentMode;
  shareBySms: boolean;
  shareByWhatsApp: boolean;
  liveTrackingEnabled: boolean;
}

interface SaveRideRecipientInput {
  name: string;
  phone: string;
  relation?: string;
}

const RECIPIENTS_STORAGE_KEY = 'ride_for_others_recipients_v1';
const DRAFT_STORAGE_KEY = 'ride_for_others_draft_v1';

const EMPTY_DRAFT: RideForOthersDraft = {
  enabled: false,
  recipient: null,
  paymentMode: 'customer_app',
  shareBySms: true,
  shareByWhatsApp: true,
  liveTrackingEnabled: true,
};

function sanitizeRecipient(candidate: Partial<RideRecipient> | undefined): RideRecipient | null {
  if (!candidate?.id || !candidate?.name || !candidate?.phone || !candidate?.createdAt || !candidate?.updatedAt) {
    return null;
  }

  const normalizedPhone = normalizeTurkishPhone(candidate.phone);
  if (getTurkishPhoneValidationError(normalizedPhone)) {
    return null;
  }

  return {
    id: candidate.id,
    name: candidate.name.trim(),
    phone: normalizedPhone,
    relation: candidate.relation?.trim() || undefined,
    source: candidate.source === 'saved' ? 'saved' : 'manual',
    createdAt: candidate.createdAt,
    updatedAt: candidate.updatedAt,
    useCount: typeof candidate.useCount === 'number' ? candidate.useCount : 0,
  };
}

function sanitizeDraft(candidate: Partial<RideForOthersDraft>): RideForOthersDraft {
  return {
    enabled: Boolean(candidate?.enabled),
    recipient: sanitizeRecipient(candidate?.recipient ?? undefined),
    paymentMode: candidate?.paymentMode === 'guest_in_car' ? 'guest_in_car' : 'customer_app',
    shareBySms: candidate?.shareBySms ?? true,
    shareByWhatsApp: candidate?.shareByWhatsApp ?? true,
    liveTrackingEnabled: candidate?.liveTrackingEnabled ?? true,
  };
}

export const [RideForOthersProvider, useRideForOthers] = createContextHook(() => {
  const [recipients, setRecipients] = useState<RideRecipient[]>([]);
  const [draft, setDraft] = useState<RideForOthersDraft>(EMPTY_DRAFT);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    let isMounted = true;

    const load = async () => {
      try {
        const [storedRecipients, storedDraft] = await Promise.all([
          AsyncStorage.getItem(RECIPIENTS_STORAGE_KEY),
          AsyncStorage.getItem(DRAFT_STORAGE_KEY),
        ]);

        if (!isMounted) {
          return;
        }

        if (storedRecipients) {
          try {
            const parsed = JSON.parse(storedRecipients) as Partial<RideRecipient>[];
            const sanitized = parsed
              .map((recipient) => sanitizeRecipient(recipient))
              .filter((recipient): recipient is RideRecipient => recipient !== null)
              .sort((left, right) => {
                const leftScore = new Date(left.updatedAt).getTime();
                const rightScore = new Date(right.updatedAt).getTime();
                return rightScore - leftScore;
              });
            setRecipients(sanitized);
            console.log('[RideForOthers] Loaded recipients:', sanitized.length);
          } catch (error) {
            console.log('[RideForOthers] Failed to parse recipients:', error);
          }
        }

        if (storedDraft) {
          try {
            const parsedDraft = JSON.parse(storedDraft) as Partial<RideForOthersDraft>;
            const sanitizedDraft = sanitizeDraft(parsedDraft);
            setDraft(sanitizedDraft);
            console.log('[RideForOthers] Loaded draft. Enabled:', sanitizedDraft.enabled);
          } catch (error) {
            console.log('[RideForOthers] Failed to parse draft:', error);
          }
        }
      } catch (error) {
        console.log('[RideForOthers] Storage load error:', error);
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    void load();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (isLoading) {
      return;
    }

    AsyncStorage.setItem(RECIPIENTS_STORAGE_KEY, JSON.stringify(recipients)).catch((error) => {
      console.log('[RideForOthers] Failed to persist recipients:', error);
    });
  }, [isLoading, recipients]);

  useEffect(() => {
    if (isLoading) {
      return;
    }

    AsyncStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft)).catch((error) => {
      console.log('[RideForOthers] Failed to persist draft:', error);
    });
  }, [draft, isLoading]);

  const saveRecipient = useCallback(async ({ name, phone, relation }: SaveRideRecipientInput): Promise<RideRecipient> => {
    const trimmedName = name.trim();
    const normalizedPhone = normalizeTurkishPhone(phone);
    const phoneError = getTurkishPhoneValidationError(normalizedPhone);

    if (!trimmedName) {
      throw new Error('Yolcu adı gerekli');
    }

    if (phoneError) {
      throw new Error(phoneError);
    }

    const now = new Date().toISOString();
    let savedRecipient: RideRecipient | null = null;

    setRecipients((currentRecipients) => {
      const existingRecipient = currentRecipients.find((recipient) => recipient.phone === normalizedPhone);

      if (existingRecipient) {
        savedRecipient = {
          ...existingRecipient,
          name: trimmedName,
          relation: relation?.trim() || existingRecipient.relation,
          updatedAt: now,
          source: 'saved',
          useCount: existingRecipient.useCount + 1,
        };

        return currentRecipients
          .map((recipient) => (recipient.id === existingRecipient.id ? savedRecipient ?? recipient : recipient))
          .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
      }

      savedRecipient = {
        id: `guest_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        name: trimmedName,
        phone: normalizedPhone,
        relation: relation?.trim() || undefined,
        source: 'saved',
        createdAt: now,
        updatedAt: now,
        useCount: 1,
      };

      return [savedRecipient, ...currentRecipients];
    });

    const recipientToStore = savedRecipient ?? {
      id: `guest_${Date.now().toString(36)}_fallback`,
      name: trimmedName,
      phone: normalizedPhone,
      relation: relation?.trim() || undefined,
      source: 'saved' as const,
      createdAt: now,
      updatedAt: now,
      useCount: 1,
    };

    setDraft((currentDraft) => ({
      ...currentDraft,
      enabled: true,
      recipient: recipientToStore,
    }));

    console.log('[RideForOthers] Recipient saved:', recipientToStore.phone);
    return recipientToStore;
  }, []);

  const selectRecipient = useCallback((recipientId: string) => {
    setRecipients((currentRecipients) => {
      const nextRecipients = currentRecipients.map((recipient) => {
        if (recipient.id !== recipientId) {
          return recipient;
        }

        return {
          ...recipient,
          updatedAt: new Date().toISOString(),
          useCount: recipient.useCount + 1,
        };
      });

      const selectedRecipient = nextRecipients.find((recipient) => recipient.id === recipientId) ?? null;
      if (selectedRecipient) {
        setDraft((currentDraft) => ({
          ...currentDraft,
          enabled: true,
          recipient: selectedRecipient,
        }));
      }

      console.log('[RideForOthers] Recipient selected:', recipientId);
      return [...nextRecipients].sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
    });
  }, []);

  const removeRecipient = useCallback((recipientId: string) => {
    setRecipients((currentRecipients) => currentRecipients.filter((recipient) => recipient.id !== recipientId));
    setDraft((currentDraft) => {
      if (currentDraft.recipient?.id !== recipientId) {
        return currentDraft;
      }

      return {
        ...EMPTY_DRAFT,
        paymentMode: currentDraft.paymentMode,
        shareBySms: currentDraft.shareBySms,
        shareByWhatsApp: currentDraft.shareByWhatsApp,
        liveTrackingEnabled: currentDraft.liveTrackingEnabled,
      };
    });
    console.log('[RideForOthers] Recipient removed:', recipientId);
  }, []);

  const setRideForOtherDraft = useCallback((payload: Partial<RideForOthersDraft>) => {
    setDraft((currentDraft) => {
      const nextDraft = sanitizeDraft({ ...currentDraft, ...payload });
      console.log('[RideForOthers] Draft updated. Enabled:', nextDraft.enabled, 'Recipient:', nextDraft.recipient?.phone ?? 'none');
      return nextDraft;
    });
  }, []);

  const resetRideForOtherDraft = useCallback(() => {
    setDraft(EMPTY_DRAFT);
    console.log('[RideForOthers] Draft reset');
  }, []);

  const selectedRecipientLabel = useMemo(() => {
    if (!draft.recipient) {
      return '';
    }

    return `${draft.recipient.name} • ${draft.recipient.phone}`;
  }, [draft.recipient]);

  return useMemo(() => ({
    recipients,
    draft,
    isLoading,
    selectedRecipientLabel,
    saveRecipient,
    selectRecipient,
    removeRecipient,
    setRideForOtherDraft,
    resetRideForOtherDraft,
  }), [
    recipients,
    draft,
    isLoading,
    selectedRecipientLabel,
    saveRecipient,
    selectRecipient,
    removeRecipient,
    setRideForOtherDraft,
    resetRideForOtherDraft,
  ]);
});

export function useRideForOtherRecipients() {
  const { recipients } = useRideForOthers();

  return useMemo(() => {
    return [...recipients].sort((left, right) => {
      if (right.useCount !== left.useCount) {
        return right.useCount - left.useCount;
      }

      return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
    });
  }, [recipients]);
}
