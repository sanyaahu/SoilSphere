import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as Location from 'expo-location';
import { describeWeather, fetchWeather, gardenTip, Weather } from '../weather';

type State =
  | { status: 'loading' }
  | { status: 'denied'; canAskAgain: boolean }
  | { status: 'error'; message: string }
  | { status: 'ready'; weather: Weather; place: string | null };

let lastPlace: string | null = null;

async function currentCoords() {
  // A recent cached fix is fine for weather and much faster than a fresh GPS lock.
  const last = await Location.getLastKnownPositionAsync({ maxAge: 30 * 60 * 1000 });
  if (last) return last.coords;
  const fresh = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
  return fresh.coords;
}

async function placeName(latitude: number, longitude: number) {
  try {
    const [place] = await Location.reverseGeocodeAsync({ latitude, longitude });
    return place?.city || place?.subregion || place?.region || null;
  } catch {
    return null; // the label is optional
  }
}

export function WeatherCard() {
  const [state, setState] = useState<State>({ status: 'loading' });

  const load = useCallback(async () => {
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') {
        setState({ status: 'denied', canAskAgain: permission.canAskAgain });
        return;
      }
      const { latitude, longitude } = await currentCoords();
      const [weather, place] = await Promise.all([
        fetchWeather(latitude, longitude),
        lastPlace ? Promise.resolve(lastPlace) : placeName(latitude, longitude),
      ]);
      lastPlace = place;
      setState({ status: 'ready', weather, place });
    } catch (e) {
      setState({
        status: 'error',
        message: e instanceof Error && e.name === 'AbortError'
          ? 'Weather took too long to load.'
          : 'Could not load the weather.',
      });
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(load, 0);
    const timer = setInterval(load, 15 * 60 * 1000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [load]);

  if (state.status === 'loading') {
    return <View style={[w.card, w.center]}><ActivityIndicator color="#286B49" /><Text style={w.muted}>Getting local weather…</Text></View>;
  }

  if (state.status === 'denied') {
    return <View style={w.card}>
      <Text style={w.title}>Local weather</Text>
      <Text style={w.muted}>Allow location access to see current conditions at your garden.</Text>
      <TouchableOpacity
        style={w.button}
        accessibilityRole="button"
        onPress={() => (state.canAskAgain ? load() : Linking.openSettings())}
      >
        <Text style={w.buttonText}>{state.canAskAgain ? 'Allow location' : 'Open settings'}</Text>
      </TouchableOpacity>
    </View>;
  }

  if (state.status === 'error') {
    return <View style={w.card}>
      <Text style={w.title}>Local weather</Text>
      <Text style={w.muted}>{state.message}</Text>
      <TouchableOpacity style={w.button} accessibilityRole="button" onPress={load}>
        <Text style={w.buttonText}>Try again</Text>
      </TouchableOpacity>
    </View>;
  }

  const { weather, place } = state;
  const { label, icon } = describeWeather(weather.code, weather.isDay);
  const tip = gardenTip(weather);
  return <View style={w.card} accessible accessibilityLabel={`${label}, ${Math.round(weather.temperatureF)} degrees${place ? ` in ${place}` : ''}`}>
    <View style={w.row}>
      <Text style={w.icon}>{icon}</Text>
      <View style={{ flex: 1 }}>
        <Text style={w.kicker}>{place ? `WEATHER · ${place.toUpperCase()}` : 'LOCAL WEATHER'}</Text>
        <Text style={w.title}>{label}</Text>
      </View>
      <Text style={w.temp}>{Math.round(weather.temperatureF)}°</Text>
    </View>
    <View style={w.stats}>
      <Text style={w.stat}>Feels {Math.round(weather.feelsLikeF)}°</Text>
      <Text style={w.stat}>Humidity {weather.humidityPercent}%</Text>
      <Text style={w.stat}>Wind {Math.round(weather.windMph)} mph</Text>
    </View>
    {tip && <Text style={w.tip}>{tip}</Text>}
  </View>;
}

const w = StyleSheet.create({
  card: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#E5EAE3', borderRadius: 21, padding: 18, marginBottom: 16 },
  center: { alignItems: 'center', gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon: { fontSize: 34, color: '#B47724', width: 42, textAlign: 'center' },
  kicker: { color: '#286B49', fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  title: { color: '#1F3529', fontSize: 17, fontWeight: '800', marginTop: 3 },
  temp: { color: '#1F3529', fontSize: 34, fontWeight: '800' },
  stats: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#E5EAE3' },
  stat: { color: '#728078', fontSize: 12, fontWeight: '600' },
  tip: { color: '#286B49', fontSize: 12, lineHeight: 17, marginTop: 10, fontWeight: '600' },
  muted: { color: '#728078', fontSize: 12, lineHeight: 18, marginTop: 6 },
  button: { backgroundColor: '#286B49', borderRadius: 14, padding: 12, alignItems: 'center', marginTop: 12 },
  buttonText: { color: '#fff', fontSize: 13, fontWeight: '800' },
});
