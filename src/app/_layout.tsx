import { Stack } from 'expo-router';
import { ChatProvider } from '../state/chat';
import { SoilSettingsProvider } from '../state/soil-settings';
export default function RootLayout() {
  return <SoilSettingsProvider><ChatProvider>
    <Stack screenOptions={{ headerShown: false, animation: 'none' }}>
      <Stack.Screen name="chat" options={{ animation: 'slide_from_right' }} />
    </Stack>
  </ChatProvider></SoilSettingsProvider>;
}
