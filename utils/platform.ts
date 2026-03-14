import { Platform, ViewStyle, TextStyle } from 'react-native';

interface AndroidTextFixOptions {
  lineHeight?: number;
  fontWeight?: TextStyle['fontWeight'];
}

interface ShadowOptions {
  color?: string;
  offsetX?: number;
  offsetY?: number;
  opacity?: number;
  radius?: number;
  elevation?: number;
}

export function crossPlatformShadow({
  color = '#000',
  offsetX = 0,
  offsetY = 4,
  opacity = 0.15,
  radius = 8,
  elevation = 4,
}: ShadowOptions = {}): ViewStyle {
  return {
    shadowColor: color,
    shadowOffset: { width: offsetX, height: offsetY },
    shadowOpacity: opacity,
    shadowRadius: radius,
    elevation,
  };
}

export function androidTextFix(options: AndroidTextFixOptions = {}): TextStyle {
  if (Platform.OS === 'android') {
    const fixedStyle: TextStyle = {
      includeFontPadding: false,
      textAlignVertical: 'center',
    };

    if (typeof options.lineHeight === 'number') {
      fixedStyle.lineHeight = options.lineHeight;
    }

    if (options.fontWeight) {
      fixedStyle.fontWeight = options.fontWeight;
    }

    return fixedStyle;
  }
  return {};
}

export const isAndroid = Platform.OS === 'android';
export const isIOS = Platform.OS === 'ios';
export const isWeb = Platform.OS === 'web';

export function keyboardAvoidingBehavior(): 'padding' | 'height' | undefined {
  if (Platform.OS === 'ios') return 'padding';
  if (Platform.OS === 'android') return 'height';
  return undefined;
}

export function keyboardVerticalOffset(): number {
  if (Platform.OS === 'ios') return 0;
  if (Platform.OS === 'android') return 24;
  return 0;
}
