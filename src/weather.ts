// Current conditions from Open-Meteo (free, no API key): https://open-meteo.com/en/docs
export type Weather = {
  temperatureF: number;
  feelsLikeF: number;
  humidityPercent: number;
  precipitationIn: number;
  windMph: number;
  code: number;
  isDay: boolean;
  time: string;
};

const CACHE_MS = 10 * 60 * 1000;
let cache: { key: string; at: number; weather: Weather } | null = null;

export async function fetchWeather(latitude: number, longitude: number): Promise<Weather> {
  // ~1 km rounding keeps the cache stable as GPS jitters
  const key = `${latitude.toFixed(2)},${longitude.toFixed(2)}`;
  if (cache && cache.key === key && Date.now() - cache.at < CACHE_MS) return cache.weather;

  const params = new URLSearchParams({
    latitude: latitude.toFixed(4),
    longitude: longitude.toFixed(4),
    current: 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m',
    temperature_unit: 'fahrenheit',
    wind_speed_unit: 'mph',
    precipitation_unit: 'inch',
    timezone: 'auto',
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, { signal: controller.signal });
    if (!response.ok) throw new Error(`Weather request failed (${response.status})`);
    const { current: c } = await response.json();
    const weather: Weather = {
      temperatureF: c.temperature_2m,
      feelsLikeF: c.apparent_temperature,
      humidityPercent: c.relative_humidity_2m,
      precipitationIn: c.precipitation,
      windMph: c.wind_speed_10m,
      code: c.weather_code,
      isDay: c.is_day === 1,
      time: c.time,
    };
    cache = { key, at: Date.now(), weather };
    return weather;
  } finally {
    clearTimeout(timer);
  }
}

// WMO weather interpretation codes
export function describeWeather(code: number, isDay: boolean): { label: string; icon: string } {
  if (code === 0) return { label: 'Clear', icon: isDay ? '☀' : '☾' };
  if (code === 1) return { label: 'Mostly clear', icon: isDay ? '☀' : '☾' };
  if (code === 2) return { label: 'Partly cloudy', icon: '⛅' };
  if (code === 3) return { label: 'Overcast', icon: '☁' };
  if (code === 45 || code === 48) return { label: 'Fog', icon: '≋' };
  if (code >= 51 && code <= 57) return { label: 'Drizzle', icon: '☂' };
  if (code >= 61 && code <= 67) return { label: 'Rain', icon: '☂' };
  if (code >= 71 && code <= 77) return { label: 'Snow', icon: '❄' };
  if (code >= 80 && code <= 82) return { label: 'Rain showers', icon: '☂' };
  if (code === 85 || code === 86) return { label: 'Snow showers', icon: '❄' };
  if (code >= 95) return { label: 'Thunderstorm', icon: '⚡' };
  return { label: 'Unknown', icon: '·' };
}

// One short, garden-relevant line based on current conditions.
export function gardenTip(w: Weather): string | null {
  if (w.code >= 95) return 'Storms nearby. Hold off on watering and fertilizing.';
  if (w.precipitationIn > 0 || (w.code >= 51 && w.code <= 67) || (w.code >= 80 && w.code <= 82)) return 'It\'s raining. You can likely skip watering today.';
  if (w.temperatureF <= 34) return 'Near freezing. Cover tender plants tonight.';
  if (w.temperatureF >= 88) return 'Hot out. Water early in the morning and check moisture this evening.';
  if (w.windMph >= 20) return 'Windy. Soil can dry out faster than usual.';
  return null;
}
