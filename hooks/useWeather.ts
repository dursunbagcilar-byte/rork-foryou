import { useQuery } from '@tanstack/react-query';

interface WeatherResponse {
  current_weather: {
    temperature: number;
    windspeed: number;
    weathercode: number;
    is_day: number;
    time: string;
  };
}

export interface WeatherInfo {
  temperature: number;
  windspeed: number;
  weatherCode: number;
  isRainy: boolean;
  description: string;
  isDay: boolean;
}

const PRECIPITATION_CODES = new Set([
  51, 53, 55, 56, 57,
  61, 63, 65, 66, 67,
  71, 73, 75, 77,
  80, 81, 82,
  85, 86,
  95, 96, 99,
]);

function getWeatherDescription(code: number): string {
  if (code === 0) return 'Açık';
  if (code === 1) return 'Çoğunlukla açık';
  if (code === 2) return 'Parçalı bulutlu';
  if (code === 3) return 'Kapalı';
  if (code === 45 || code === 48) return 'Sisli';
  if (code >= 51 && code <= 55) return 'Çisenti';
  if (code === 56 || code === 57) return 'Dondurucu çisenti';
  if (code >= 61 && code <= 65) return 'Yağmurlu';
  if (code === 66 || code === 67) return 'Dondurucu yağmur';
  if (code >= 71 && code <= 77) return 'Karlı';
  if (code >= 80 && code <= 82) return 'Sağanak yağışlı';
  if (code === 85 || code === 86) return 'Kar yağışlı';
  if (code >= 95) return 'Fırtınalı';
  return 'Bilinmiyor';
}

async function fetchWeather(latitude: number, longitude: number): Promise<WeatherInfo> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true`;
  console.log('[Weather] Fetching weather for:', latitude, longitude);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Weather API error: ${response.status}`);
  }

  const data: WeatherResponse = await response.json();
  const { weathercode, temperature, windspeed, is_day } = data.current_weather;

  const isRainy = PRECIPITATION_CODES.has(weathercode);
  const description = getWeatherDescription(weathercode);

  console.log('[Weather] Code:', weathercode, '| Rainy:', isRainy, '| Desc:', description, '| Temp:', temperature);

  return {
    temperature,
    windspeed,
    weatherCode: weathercode,
    isRainy,
    description,
    isDay: is_day === 1,
  };
}

export function useWeather(latitude?: number, longitude?: number) {
  const query = useQuery<WeatherInfo>({
    queryKey: ['weather', latitude, longitude],
    queryFn: () => fetchWeather(latitude!, longitude!),
    enabled: latitude !== undefined && longitude !== undefined,
    staleTime: 10 * 60 * 1000,
    refetchInterval: 10 * 60 * 1000,
  });

  return {
    weather: query.data ?? null,
    isLoading: query.isLoading,
    isRainy: query.data?.isRainy ?? false,
    error: query.error,
  };
}
