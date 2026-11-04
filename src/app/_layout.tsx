import { Stack } from 'expo-router';
import { SoilSettingsProvider } from '../state/soil-settings';
export default function RootLayout() { return <SoilSettingsProvider><Stack screenOptions={{ headerShown: false, animation: 'none' }} /></SoilSettingsProvider>; }
