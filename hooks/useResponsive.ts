import { useWindowDimensions, PixelRatio, Platform } from 'react-native';
import { useMemo } from 'react';

const BASE_WIDTH = 375;
const BASE_HEIGHT = 812;

export function useResponsive() {
  const { width, height } = useWindowDimensions();

  return useMemo(() => {
    const scaleX = width / BASE_WIDTH;
    const scaleY = height / BASE_HEIGHT;
    const scale = Math.min(scaleX, scaleY);

    const wp = (percentage: number): number => {
      return PixelRatio.roundToNearestPixel((width * percentage) / 100);
    };

    const hp = (percentage: number): number => {
      return PixelRatio.roundToNearestPixel((height * percentage) / 100);
    };

    const fs = (size: number): number => {
      const newSize = size * scale;
      if (Platform.OS === 'web') {
        return Math.round(newSize);
      }
      return Math.round(PixelRatio.roundToNearestPixel(newSize));
    };

    const sp = (size: number): number => {
      return PixelRatio.roundToNearestPixel(size * scaleX);
    };

    const isSmallDevice = width < 360;
    const isLargeDevice = width >= 768;
    const isTablet = width >= 600;

    const maxContentWidth = isLargeDevice ? 500 : width;

    return {
      width,
      height,
      scale,
      scaleX,
      scaleY,
      wp,
      hp,
      fs,
      sp,
      isSmallDevice,
      isLargeDevice,
      isTablet,
      maxContentWidth,
    };
  }, [width, height]);
}

export function moderateScale(size: number, factor: number = 0.5): number {
  const { width } = { width: BASE_WIDTH };
  const scale = width / BASE_WIDTH;
  return PixelRatio.roundToNearestPixel(size + (scale - 1) * size * factor);
}
