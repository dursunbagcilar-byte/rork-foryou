import React, { useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Animated, Linking, Platform,
} from 'react-native';
import * as Haptics from 'expo-haptics';

const SPOTIFY_URL = 'spotify://';
const SPOTIFY_WEB_URL = 'https://open.spotify.com';

const TrendingMusicPlayer = React.memo(function TrendingMusicPlayer() {
  const pulseAnim = useRef(new Animated.Value(0.85)).current;
  const glowAnim = useRef(new Animated.Value(0)).current;
  const noteAnim1 = useRef(new Animated.Value(0)).current;
  const noteAnim2 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1, duration: 1200, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 0.85, duration: 1200, useNativeDriver: true }),
      ])
    );
    pulse.start();

    const glow = Animated.loop(
      Animated.sequence([
        Animated.timing(glowAnim, { toValue: 1, duration: 1800, useNativeDriver: true }),
        Animated.timing(glowAnim, { toValue: 0, duration: 1800, useNativeDriver: true }),
      ])
    );
    glow.start();

    const note1 = Animated.loop(
      Animated.sequence([
        Animated.timing(noteAnim1, { toValue: 1, duration: 2400, useNativeDriver: true }),
        Animated.timing(noteAnim1, { toValue: 0, duration: 0, useNativeDriver: true }),
      ])
    );
    note1.start();

    const note2Loop = setTimeout(() => {
      const note2 = Animated.loop(
        Animated.sequence([
          Animated.timing(noteAnim2, { toValue: 1, duration: 2400, useNativeDriver: true }),
          Animated.timing(noteAnim2, { toValue: 0, duration: 0, useNativeDriver: true }),
        ])
      );
      note2.start();
    }, 800);

    return () => {
      pulse.stop();
      glow.stop();
      note1.stop();
      clearTimeout(note2Loop);
    };
  }, [glowAnim, noteAnim1, noteAnim2, pulseAnim]);

  const handleOpenSpotify = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    console.log('[Spotify] Opening Spotify...');

    if (Platform.OS === 'web') {
      Linking.openURL(SPOTIFY_WEB_URL).catch(() => {});
      return;
    }

    try {
      const canOpen = await Linking.canOpenURL(SPOTIFY_URL);
      if (canOpen) {
        Linking.openURL(SPOTIFY_URL).catch(() => {});
        return;
      }
    } catch (e) {
      console.log('[Spotify] canOpenURL check failed:', e);
    }

    try {
      Linking.openURL(SPOTIFY_URL).catch(() => {});
    } catch (e) {
      console.log('[Spotify] Error opening app:', e);
    }
  };

  const note1TranslateY = noteAnim1.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -28],
  });
  const note1Opacity = noteAnim1.interpolate({
    inputRange: [0, 0.3, 0.8, 1],
    outputRange: [0, 1, 1, 0],
  });
  const note2TranslateY = noteAnim2.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -24],
  });
  const note2Opacity = noteAnim2.interpolate({
    inputRange: [0, 0.3, 0.8, 1],
    outputRange: [0, 1, 1, 0],
  });

  const glowOpacity = glowAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.15, 0.4],
  });

  return (
    <TouchableOpacity
      style={s.container}
      activeOpacity={0.8}
      onPress={handleOpenSpotify}
      testID="spotify-open-btn"
    >
      <Animated.View style={[s.glowCircle, { opacity: glowOpacity }]} />

      <View style={s.content}>
        <View style={s.leftSection}>
          <View style={s.iconWrap}>
            <Animated.View style={[s.iconCircle, { transform: [{ scale: pulseAnim }] }]}>
              <Text style={s.spotifyIcon}>🎵</Text>
            </Animated.View>

            <Animated.View style={[s.floatingNote, s.note1, { transform: [{ translateY: note1TranslateY }], opacity: note1Opacity }]}>
              <Text style={s.noteEmoji}>♪</Text>
            </Animated.View>
            <Animated.View style={[s.floatingNote, s.note2, { transform: [{ translateY: note2TranslateY }], opacity: note2Opacity }]}>
              <Text style={s.noteEmoji}>♫</Text>
            </Animated.View>
          </View>

          <View style={s.textSection}>
            <Text style={s.mainText}>Bu gece bize en sevdiğin{'\n'}şarkıyı açmak ister misin?</Text>
            <View style={s.spotifyRow}>
              <View style={s.spotifyBadge}>
                <Text style={s.spotifyBadgeIcon}>●</Text>
                <Text style={s.spotifyBadgeText}>Spotify</Text>
              </View>
              <Text style={s.tapHint}>Dokun ve aç</Text>
            </View>
          </View>
        </View>


      </View>

      <View style={s.bottomStrip}>
        <View style={s.stripDot} />
        <View style={[s.stripDot, s.stripDotActive]} />
        <View style={s.stripDot} />
      </View>
    </TouchableOpacity>
  );
});

const s = StyleSheet.create({
  container: {
    backgroundColor: '#111',
    borderRadius: 16,
    marginTop: 14,
    borderWidth: 1.5,
    borderColor: '#1DB954',
    overflow: 'hidden',
    position: 'relative' as const,
    ...(Platform.OS !== 'web' ? {
      shadowColor: '#1DB954',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.2,
      shadowRadius: 12,
      elevation: 5,
    } : {}),
  },
  glowCircle: {
    position: 'absolute' as const,
    top: -20,
    right: -20,
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#1DB954',
  },
  content: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  leftSection: {
    flex: 1,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 14,
  },
  iconWrap: {
    width: 52,
    height: 52,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    position: 'relative' as const,
  },
  iconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#1DB95422',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    borderWidth: 1.5,
    borderColor: '#1DB95444',
  },
  spotifyIcon: {
    fontSize: 22,
  },
  floatingNote: {
    position: 'absolute' as const,
  },
  note1: {
    top: 2,
    right: -2,
  },
  note2: {
    top: 6,
    left: -4,
  },
  noteEmoji: {
    fontSize: 12,
    color: '#1DB954',
  },
  textSection: {
    flex: 1,
  },
  mainText: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: '#FFFFFF',
    lineHeight: 20,
    letterSpacing: -0.2,
  },
  spotifyRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    marginTop: 8,
  },
  spotifyBadge: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    backgroundColor: '#1DB954',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  spotifyBadgeIcon: {
    fontSize: 6,
    color: '#FFF',
  },
  spotifyBadgeText: {
    fontSize: 11,
    fontWeight: '800' as const,
    color: '#FFF',
    letterSpacing: 0.4,
  },
  tapHint: {
    fontSize: 11,
    color: '#666',
    fontWeight: '500' as const,
  },
  arrowWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#1DB95418',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    borderWidth: 1,
    borderColor: '#1DB95433',
  },
  bottomStrip: {
    flexDirection: 'row' as const,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    gap: 4,
    paddingBottom: 8,
  },
  stripDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#333',
  },
  stripDotActive: {
    width: 12,
    backgroundColor: '#1DB954',
    borderRadius: 2,
  },
});

export default TrendingMusicPlayer;
