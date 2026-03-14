import React, { Component, ErrorInfo, ReactNode } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Colors } from '@/constants/colors';
import { androidTextFix, crossPlatformShadow } from '@/utils/platform';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.log('[ErrorBoundary] Caught error:', error.message);
    console.log('[ErrorBoundary] Component stack:', errorInfo.componentStack);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <View style={styles.container}>
          <View style={styles.card}>
            <Text style={styles.emoji}>⚠️</Text>
            <Text style={styles.title}>Bir Hata Oluştu</Text>
            <Text style={styles.message}>
              Uygulama beklenmedik bir hatayla karşılaştı. Lütfen tekrar deneyin.
            </Text>
            {this.state.error && (
              <Text style={styles.errorDetail} numberOfLines={3}>
                {this.state.error.message}
              </Text>
            )}
            <TouchableOpacity
              style={styles.retryButton}
              onPress={this.handleRetry}
              activeOpacity={0.85}
            >
              <Text style={styles.retryText}>Tekrar Dene</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.background,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  card: {
    backgroundColor: Colors.dark.surface,
    borderRadius: 24,
    padding: 32,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.dark.cardBorder,
    width: '100%',
    ...crossPlatformShadow({
      color: '#000',
      offsetY: 12,
      opacity: 0.18,
      radius: 20,
      elevation: 10,
    }),
  },
  emoji: {
    fontSize: 48,
    marginBottom: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: '700' as const,
    color: Colors.dark.text,
    marginBottom: 8,
    ...androidTextFix({ fontWeight: '700' }),
  },
  message: {
    fontSize: 14,
    color: Colors.dark.textSecondary,
    textAlign: 'center' as const,
    lineHeight: 20,
    marginBottom: 16,
    ...androidTextFix({ lineHeight: 20 }),
  },
  errorDetail: {
    fontSize: 12,
    color: Colors.dark.textMuted,
    backgroundColor: Colors.dark.card,
    padding: 12,
    borderRadius: 10,
    width: '100%',
    marginBottom: 20,
    overflow: 'hidden' as const,
    ...androidTextFix({ lineHeight: 18 }),
  },
  retryButton: {
    backgroundColor: Colors.dark.primary,
    paddingVertical: 14,
    paddingHorizontal: 40,
    borderRadius: 14,
    ...crossPlatformShadow({
      color: Colors.dark.primary,
      offsetY: 8,
      opacity: 0.24,
      radius: 14,
      elevation: 6,
    }),
  },
  retryText: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.dark.background,
    ...androidTextFix({ fontWeight: '700' }),
  },
});
