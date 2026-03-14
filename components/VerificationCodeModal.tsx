import React from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { KeyRound, RefreshCw, ShieldCheck, Smartphone, X } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { keyboardAvoidingBehavior, keyboardVerticalOffset } from '@/utils/platform';

interface VerificationCodeModalProps {
  visible: boolean;
  title: string;
  subtitle: string;
  code: string;
  onCodeChange: (value: string) => void;
  onClose: () => void;
  onConfirm: () => void;
  onResend: () => void;
  isConfirming: boolean;
  isResending: boolean;
  maskedPhone?: string | null;
  deliveryNote?: string | null;
  providerName?: string | null;
  confirmLabel?: string;
  resendLabel?: string;
  testIDPrefix?: string;
}

export function VerificationCodeModal({
  visible,
  title,
  subtitle,
  code,
  onCodeChange,
  onClose,
  onConfirm,
  onResend,
  isConfirming,
  isResending,
  maskedPhone,
  deliveryNote,
  providerName,
  confirmLabel = 'Kodu Onayla',
  resendLabel = 'Kodu Tekrar Gönder',
  testIDPrefix = 'verification-modal',
}: VerificationCodeModalProps) {
  const isBusy = isConfirming || isResending;
  const isCodeReady = code.trim().length === 6;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <KeyboardAvoidingView
          behavior={keyboardAvoidingBehavior()}
          keyboardVerticalOffset={keyboardVerticalOffset()}
          style={styles.sheetWrap}
        >
          <View style={styles.sheet} testID={`${testIDPrefix}-container`}>
            <View style={styles.handle} />
            <View style={styles.headerRow}>
              <View style={styles.iconWrap}>
                <ShieldCheck size={18} color={Colors.dark.primary} />
              </View>
              <TouchableOpacity onPress={onClose} activeOpacity={0.7} testID={`${testIDPrefix}-close-button`}>
                <X size={20} color={Colors.dark.textSecondary} />
              </TouchableOpacity>
            </View>

            <Text style={styles.title}>{title}</Text>
            <Text style={styles.subtitle}>{subtitle}</Text>

            <View style={styles.deliveryCard}>
              <View style={styles.deliveryIconWrap}>
                <Smartphone size={18} color={Colors.dark.success} />
              </View>
              <View style={styles.deliveryCopy}>
                <Text style={styles.deliveryTitle}>SMS gönderildi</Text>
                {providerName ? <Text style={styles.deliveryProvider}>{providerName} ile gönderildi</Text> : null}
                <Text style={styles.deliveryText}>
                  {maskedPhone ? `${maskedPhone} numarasına 6 haneli kod yollandı.` : 'Telefon numaranıza 6 haneli kod yollandı.'}
                </Text>
                {deliveryNote ? <Text style={styles.deliveryNote}>{deliveryNote}</Text> : null}
              </View>
            </View>

            <View style={styles.codeFieldWrap}>
              <View style={styles.codeFieldLabelWrap}>
                <KeyRound size={16} color={Colors.dark.textMuted} />
                <Text style={styles.codeFieldLabel}>Doğrulama Kodu</Text>
              </View>
              <TextInput
                style={styles.codeInput}
                placeholder="000000"
                placeholderTextColor={Colors.dark.textMuted}
                value={code}
                onChangeText={(value) => onCodeChange(value.replace(/\D/g, '').slice(0, 6))}
                keyboardType="number-pad"
                maxLength={6}
                textContentType="oneTimeCode"
                autoComplete="sms-otp"
                returnKeyType="done"
                testID={`${testIDPrefix}-code-input`}
              />
            </View>

            <TouchableOpacity
              style={[styles.confirmButton, (!isCodeReady || isBusy) && styles.confirmButtonDisabled]}
              onPress={onConfirm}
              disabled={!isCodeReady || isBusy}
              activeOpacity={0.85}
              testID={`${testIDPrefix}-confirm-button`}
            >
              {isConfirming ? (
                <ActivityIndicator color={Colors.dark.background} size="small" />
              ) : (
                <Text style={styles.confirmButtonText}>{confirmLabel}</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.resendButton, isBusy && styles.resendButtonDisabled]}
              onPress={onResend}
              disabled={isBusy}
              activeOpacity={0.75}
              testID={`${testIDPrefix}-resend-button`}
            >
              {isResending ? (
                <ActivityIndicator color={Colors.dark.primary} size="small" />
              ) : (
                <>
                  <RefreshCw size={16} color={Colors.dark.primary} />
                  <Text style={styles.resendButtonText}>{resendLabel}</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(4,6,12,0.72)',
    justifyContent: 'flex-end',
  },
  sheetWrap: {
    width: '100%',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.dark.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 22,
    paddingTop: 14,
    paddingBottom: 28,
    borderTopWidth: 1,
    borderColor: 'rgba(245,166,35,0.14)',
    gap: 16,
  },
  handle: {
    alignSelf: 'center',
    width: 42,
    height: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.14)',
    marginBottom: 2,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  iconWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(245,166,35,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: Colors.dark.text,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 21,
    color: Colors.dark.textSecondary,
  },
  deliveryCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: 'rgba(46,204,113,0.08)',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(46,204,113,0.16)',
  },
  deliveryIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(46,204,113,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  deliveryCopy: {
    flex: 1,
    gap: 4,
  },
  deliveryTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.dark.text,
  },
  deliveryProvider: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.dark.success,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  deliveryText: {
    fontSize: 13,
    lineHeight: 19,
    color: Colors.dark.textSecondary,
  },
  deliveryNote: {
    fontSize: 12,
    lineHeight: 18,
    color: Colors.dark.success,
  },
  codeFieldWrap: {
    gap: 8,
  },
  codeFieldLabelWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  codeFieldLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.dark.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  codeInput: {
    backgroundColor: Colors.dark.inputBg,
    borderWidth: 1,
    borderColor: Colors.dark.inputBorder,
    borderRadius: 18,
    paddingHorizontal: 18,
    paddingVertical: 18,
    color: Colors.dark.text,
    fontSize: 28,
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: 10,
  },
  confirmButton: {
    minHeight: 56,
    borderRadius: 18,
    backgroundColor: Colors.dark.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmButtonDisabled: {
    opacity: 0.6,
  },
  confirmButtonText: {
    fontSize: 16,
    fontWeight: '800',
    color: Colors.dark.background,
  },
  resendButton: {
    minHeight: 48,
    borderRadius: 16,
    backgroundColor: 'rgba(245,166,35,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  resendButtonDisabled: {
    opacity: 0.65,
  },
  resendButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.dark.primary,
  },
});
