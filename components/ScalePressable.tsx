import React, { memo, ReactNode, useCallback, useMemo, useRef } from 'react';
import {
  Animated,
  Platform,
  Pressable,
  type AccessibilityRole,
  type Insets,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import * as Haptics from 'expo-haptics';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const DEFAULT_HIT_SLOP: Insets = { top: 8, right: 8, bottom: 8, left: 8 };

interface ScalePressableProps {
  children: ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
  testID?: string;
  pressedScale?: number;
  pressedOpacity?: number;
  enableHaptics?: boolean;
  hapticStyle?: Haptics.ImpactFeedbackStyle;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  accessibilityRole?: AccessibilityRole;
  hitSlop?: Insets;
  androidRippleColor?: string;
}

export const ScalePressable = memo(function ScalePressable({
  children,
  onPress,
  onLongPress,
  style,
  disabled = false,
  testID,
  pressedScale = 0.98,
  pressedOpacity = 0.94,
  enableHaptics = true,
  hapticStyle = Haptics.ImpactFeedbackStyle.Light,
  accessibilityLabel,
  accessibilityHint,
  accessibilityRole = 'button',
  hitSlop = DEFAULT_HIT_SLOP,
  androidRippleColor = 'rgba(255,255,255,0.08)',
}: ScalePressableProps) {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const opacityAnim = useRef(new Animated.Value(1)).current;
  const isInteractive = !disabled && (typeof onPress === 'function' || typeof onLongPress === 'function');

  const androidRipple = useMemo(() => {
    if (Platform.OS !== 'android' || !isInteractive) {
      return undefined;
    }

    return {
      color: androidRippleColor,
      borderless: false,
    };
  }, [androidRippleColor, isInteractive]);

  const animateTo = useCallback((scaleValue: number, opacityValue: number) => {
    Animated.parallel([
      Animated.spring(scaleAnim, {
        toValue: scaleValue,
        speed: 28,
        bounciness: 0,
        useNativeDriver: true,
      }),
      Animated.timing(opacityAnim, {
        toValue: opacityValue,
        duration: 120,
        useNativeDriver: true,
      }),
    ]).start();
  }, [opacityAnim, scaleAnim]);

  const handlePressIn = useCallback(() => {
    if (!isInteractive) {
      return;
    }
    animateTo(pressedScale, pressedOpacity);
  }, [animateTo, isInteractive, pressedOpacity, pressedScale]);

  const handlePressOut = useCallback(() => {
    if (!isInteractive) {
      return;
    }
    animateTo(1, 1);
  }, [animateTo, isInteractive]);

  const handlePress = useCallback(() => {
    if (!isInteractive) {
      return;
    }

    if (enableHaptics) {
      void Haptics.impactAsync(hapticStyle).catch(() => {
        console.log('[ScalePressable] Haptic feedback unavailable');
      });
    }

    onPress?.();
  }, [enableHaptics, hapticStyle, isInteractive, onPress]);

  const handleLongPress = useCallback(() => {
    if (!isInteractive) {
      return;
    }

    if (enableHaptics) {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {
        console.log('[ScalePressable] Long press haptic unavailable');
      });
    }

    onLongPress?.();
  }, [enableHaptics, isInteractive, onLongPress]);

  return (
    <AnimatedPressable
      accessible={true}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      android_ripple={androidRipple}
      disabled={disabled}
      hitSlop={hitSlop}
      onLongPress={isInteractive ? handleLongPress : undefined}
      onPress={isInteractive ? handlePress : undefined}
      onPressIn={isInteractive ? handlePressIn : undefined}
      onPressOut={isInteractive ? handlePressOut : undefined}
      style={[
        style,
        {
          transform: [{ scale: scaleAnim }],
          opacity: opacityAnim,
        },
      ]}
      testID={testID}
    >
      {children}
    </AnimatedPressable>
  );
});
