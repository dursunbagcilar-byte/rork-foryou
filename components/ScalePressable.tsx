import React, { memo, ReactNode, useCallback, useRef } from 'react';
import { Animated, Pressable, StyleProp, ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface ScalePressableProps {
  children: ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
  testID?: string;
  pressedScale?: number;
  pressedOpacity?: number;
  enableHaptics?: boolean;
  hapticStyle?: Haptics.ImpactFeedbackStyle;
}

export const ScalePressable = memo(function ScalePressable({
  children,
  onPress,
  style,
  disabled = false,
  testID,
  pressedScale = 0.98,
  pressedOpacity = 0.94,
  enableHaptics = true,
  hapticStyle = Haptics.ImpactFeedbackStyle.Light,
}: ScalePressableProps) {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const opacityAnim = useRef(new Animated.Value(1)).current;
  const isInteractive = !disabled && typeof onPress === 'function';

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
      Haptics.impactAsync(hapticStyle).catch(() => {
        console.log('[ScalePressable] Haptic feedback unavailable');
      });
    }

    onPress?.();
  }, [enableHaptics, hapticStyle, isInteractive, onPress]);

  return (
    <AnimatedPressable
      disabled={disabled}
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
