import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Phone, RefreshCw } from 'lucide-react-native';
import { Colors } from '@/constants/colors';

interface PhoneNumberEditorCardProps {
  title: string;
  subtitle: string;
  value: string;
  onChangeText: (value: string) => void;
  onSave: () => void;
  isSaving: boolean;
  inputTestID: string;
  buttonTestID: string;
}

export function PhoneNumberEditorCard({
  title,
  subtitle,
  value,
  onChangeText,
  onSave,
  isSaving,
  inputTestID,
  buttonTestID,
}: PhoneNumberEditorCardProps) {
  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.iconWrap}>
          <Phone size={16} color={Colors.light.primary} />
        </View>
        <View style={styles.headerTextWrap}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
        </View>
      </View>

      <View style={styles.inputWrap}>
        <Text style={styles.label}>Yeni telefon numarası</Text>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder="+90 5XX XXX XX XX"
          placeholderTextColor={Colors.light.textMuted}
          keyboardType="phone-pad"
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.input}
          editable={!isSaving}
          testID={inputTestID}
        />
      </View>

      <TouchableOpacity
        style={[styles.button, isSaving ? styles.buttonDisabled : null]}
        onPress={onSave}
        activeOpacity={0.85}
        disabled={isSaving}
        testID={buttonTestID}
      >
        {isSaving ? (
          <ActivityIndicator size="small" color={Colors.light.background} />
        ) : (
          <>
            <RefreshCw size={16} color={Colors.light.background} />
            <Text style={styles.buttonText}>Numarayı Güncelle</Text>
          </>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.light.card,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: Colors.light.cardBorder,
    padding: 16,
    marginBottom: 20,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 14,
  },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: 'rgba(245,166,35,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  headerTextWrap: {
    flex: 1,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.light.text,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 13,
    lineHeight: 19,
    color: Colors.light.textSecondary,
  },
  inputWrap: {
    marginBottom: 14,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.light.textSecondary,
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.light.cardBorder,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 16,
    color: Colors.light.text,
  },
  button: {
    height: 48,
    borderRadius: 14,
    backgroundColor: Colors.light.primary,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.light.background,
  },
});
