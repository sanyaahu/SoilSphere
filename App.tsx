
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { askAdvisor, fetchReadings } from './src/api';
import { ChatMessage, demoReadings, display, SensorReading } from './src/data';
import { getInsights } from './src/recommendations';
import { useRouter } from 'expo-router';

export type Tab = 'Overview' | 'Trends' | 'Advisor' | 'Device';

const color = {
  bg: '#F6F7F1',
  white: '#FFFFFF',
  ink: '#1F3529',
  muted: '#728078',
  green: '#286B49',
  pale: '#E5F1E8',
  line: '#E5EAE3',
  amber: '#B47724',
};

const tabs: [Tab, string][] = [
  ['Overview', '⌂'],
  ['Trends', '▥'],
  ['Advisor', '✦'],
  ['Device', '◉'],
];

const fmtTime = (stamp: string) =>
  new Date(stamp).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: object;
}) {
  return <View style={[s.card, style]}>{children}</View>;
}

function Heading({
  title,
  note,
}: {
  title: string;
  note?: string;
}) {
  return (
    <View style={s.heading}>
      <Text style={s.headingText}>{title}</Text>
      {note && <Text style={s.note}>{note}</Text>}
    </View>
  );
}

function Metric({
  icon,
  label,
  value,
  unit,
  digits = 0,
}: {
  icon: string;
  label: string;
  value: number | null;
  unit: string;
  digits?: number;
}) {
  return (
    <Card style={s.metric}>
      <Text style={s.metricIcon}>{icon}</Text>
      <Text style={s.muted}>{label}</Text>
      <Text style={s.metricValue}>
        {display(value, digits)} <Text style={s.unit}>{unit}</Text>
      </Text>
    </Card>
  );
}

function Nutrient({
  name,
  symbol,
  value,
  tint,
}: {
  name: string;
  symbol: string;
  value: number | null;
  tint: string;
}) {
  return (
    <View style={s.nutrient}>
      <View style={[s.nutrientIcon, { backgroundColor: tint }]}>
        <Text style={s.nutrientSymbol}>{symbol}</Text>
      </View>
      <Text style={s.muted}>{name}</Text>
      <Text style={s.nutrientValue}>{display(value)}</Text>
      <Text style={s.unit}>mg/kg</Text>
    </View>
  );
}

function Overview({
  reading,
  demo,
  onAdvisor,
}: {
  reading: SensorReading;
  demo: boolean;
  onAdvisor: () => void;
}) {
  return (
    <>
      <View style={s.hero}>
        <Text style={s.kicker}>GOOD MORNING, GARDENER</Text>
        <Text style={s.heroTitle}>Your soil, made simple.</Text>
        <Text style={s.heroText}>
          A clear view of what is happening beneath the surface.
        </Text>
        <Text style={s.heroArt}>✦</Text>
      </View>

      <Card>
        <View style={s.row}>
          <View style={s.roundIcon}>
            <Text style={s.check}>✓</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.cardTitle}>Soil snapshot</Text>
            <Text style={s.muted}>
              {demo
                ? 'Sample readings for your app preview'
                : 'Latest reading from your device'}
            </Text>
          </View>
        </View>
        <View style={s.rule} />
        <View style={s.between}>
          <Text style={s.small}>
            Updated {fmtTime(reading.timestamp)}
          </Text>
          <Text style={s.source}>
            {demo ? 'DEMO DATA' : 'LIVE DATA'}
          </Text>
        </View>
      </Card>

      <Heading title="Nutrients" note="Latest NPK readings" />
      <Card>
        <View style={s.row}>
          <Nutrient
            name="Nitrogen"
            symbol="N"
            value={reading.nitrogenMgKg}
            tint="#E8F2D8"
          />
          <Nutrient
            name="Phosphorus"
            symbol="P"
            value={reading.phosphorusMgKg}
            tint="#E8ECF7"
          />
          <Nutrient
            name="Potassium"
            symbol="K"
            value={reading.potassiumMgKg}
            tint="#F8EBDC"
          />
        </View>
        <Text style={s.disclaimer}>
          NPK values are directional estimates until the probe is validated.
        </Text>
      </Card>

      <Heading title="Your environment" note="Latest measurements" />
      <View style={s.grid}>
        <Metric
          icon="◒"
          label="Soil moisture (raw)"
          value={reading.moistureRaw ?? null}
          unit="ADC"
        />
        <Metric
          icon="☼"
          label="Light exposure"
          value={reading.lightLux}
          unit="lux"
        />
        <Metric
          icon="◌"
          label="Carbon dioxide"
          value={reading.co2Ppm}
          unit="ppm"
        />
        <Metric
          icon="◎"
          label="Oxygen"
          value={reading.oxygenPercent}
          unit="%"
          digits={1}
        />
      </View>

      <TouchableOpacity style={s.banner} onPress={onAdvisor}>
        <View style={{ flex: 1 }}>
          <Text style={s.bannerKicker}>SOILSPHERE ADVISOR</Text>
          <Text style={s.bannerTitle}>Questions about your soil?</Text>
          <Text style={s.bannerBody}>
            Explore your readings with an AI assistant.
          </Text>
        </View>
        <Text style={s.bannerArrow}>→</Text>
      </TouchableOpacity>
    </>
  );
}

function TrendCard({
  label,
  unit,
  values,
  tint,
}: {
  label: string;
  unit: string;
  values: (number | null)[];
  tint: string;
}) {
  const nums = values.filter((v): v is number => v !== null);
  const min = Math.min(...nums);
  const max = Math.max(...nums);

  return (
    <Card style={{ marginBottom: 12 }}>
      <View style={s.between}>
        <Text style={s.cardTitle}>{label}</Text>
        <Text style={s.trendValue}>
          {display(values[values.length - 1])}{' '}
          <Text style={s.unit}>{unit}</Text>
        </Text>
      </View>

      <View style={s.bars}>
        {values.map((v, i) => (
          <View key={i} style={s.barSlot}>
            <View
              style={[
                s.bar,
                {
                  backgroundColor: tint,
                  height:
                    v === null
                      ? 4
                      : 18 +
                        (max === min
                          ? 0.5
                          : (v - min) / (max - min)) *
                          56,
                },
              ]}
            />
          </View>
        ))}
      </View>

      <View style={s.between}>
        <Text style={s.small}>Earlier</Text>
        <Text style={s.small}>Latest</Text>
      </View>
    </Card>
  );
}

function Trends({ readings }: { readings: SensorReading[] }) {
  return (
    <>
      <Heading title="Recent trends" note="Your last measurements" />

      <TrendCard
        label="Nitrogen"
        unit="mg/kg"
        values={readings.map((r) => r.nitrogenMgKg)}
        tint="#79A66D"
      />
      <TrendCard
        label="Phosphorus"
        unit="mg/kg"
        values={readings.map((r) => r.phosphorusMgKg)}
        tint="#9AA9D3"
      />
      <TrendCard
        label="Potassium"
        unit="mg/kg"
        values={readings.map((r) => r.potassiumMgKg)}
        tint="#E3B47E"
      />
      <TrendCard
        label="Moisture (raw ADC)"
        unit="ADC"
        values={readings.map((r) => r.moistureRaw ?? null)}
        tint="#6EA8B2"
      />

      <Card>
        <Text style={s.cardTitle}>Reading history</Text>
        {readings
          .slice()
          .reverse()
          .map((r, i) => (
            <View key={r.timestamp + i} style={s.history}>
              <Text style={s.small}>{fmtTime(r.timestamp)}</Text>
              <Text style={s.historyText}>
                N {display(r.nitrogenMgKg)} · P{' '}
                {display(r.phosphorusMgKg)} · K{' '}
                {display(r.potassiumMgKg)}
              </Text>
            </View>
          ))}
      </Card>
    </>
  );
}

function Advisor({
  reading,
  readings,
}: {
  reading: SensorReading;
  readings: SensorReading[];
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  async function send(text = draft) {
    const prompt = text.trim();
    if (!prompt || busy) return;

    setDraft('');
    const history = messages;

    setMessages([...history, { role: 'user', content: prompt }]);
    setBusy(true);

    try {
      const reply = await askAdvisor(prompt, history, reading);
      setMessages((current) => [
        ...current,
        { role: 'assistant', content: reply },
      ]);
    } catch (e) {
      setMessages((current) => [
        ...current,
        {
          role: 'assistant',
          content:
            e instanceof Error ? e.message : 'Advisor unavailable',
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <View style={s.advisorHero}>
        <Text style={s.advisorStar}>✦</Text>
        <Text style={s.advisorTitle}>Ask SoilSphere</Text>
        <Text style={s.advisorBody}>
          Plain language answers grounded in your latest readings.
          Guidance is not a lab soil test.
        </Text>
      </View>

      <Heading title="Current observations" />
      {getInsights(readings).map((insight) => (
        <Card key={insight.title} style={{ marginBottom: 9 }}>
          <Text style={s.cardTitle}>{insight.title}</Text>
          <Text style={s.help}>{insight.detail}</Text>
        </Card>
      ))}

      <Heading title="Suggested questions" />
      {[
        'What do my latest NPK readings mean?',
        'What should I watch in these soil readings?',
      ].map((q) => (
        <TouchableOpacity
          key={q}
          style={s.suggestion}
          onPress={() => send(q)}
        >
          <Text style={s.suggestionText}>{q}</Text>
          <Text style={s.greenArrow}>↗</Text>
        </TouchableOpacity>
      ))}

      {messages.map((m, i) => (
        <View
          key={i}
          style={[
            s.bubble,
            m.role === 'user' ? s.userBubble : s.assistantBubble,
          ]}
        >
          <Text
            style={[
              s.bubbleText,
              m.role === 'user' && { color: '#fff' },
            ]}
          >
            {m.content}
          </Text>
        </View>
      ))}

      {busy && (
        <ActivityIndicator
          color={color.green}
          style={{ margin: 12 }}
        />
      )}

      <View style={s.inputRow}>
        <TextInput
          style={s.input}
          placeholder="Ask about your soil..."
          placeholderTextColor="#9CA9A0"
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={() => send()}
          returnKeyType="send"
        />
        <TouchableOpacity style={s.send} onPress={() => send()}>
          <Text style={s.sendText}>↑</Text>
        </TouchableOpacity>
      </View>
    </>
  );
}

function Device({
  reading,
  demo,
  refresh,
  error,
}: {
  reading: SensorReading;
  demo: boolean;
  refresh: () => void;
  error: string | null;
}) {
  return (
    <>
      <Heading title="Device" note="Connection and data status" />

      <Card>
        <View style={s.between}>
          <View>
            <Text style={s.cardTitle}>SoilSphere sensor</Text>
            <Text style={s.small}>{reading.deviceId}</Text>
          </View>
          <Text
            style={[
              s.pill,
              { color: demo ? color.amber : color.green },
            ]}
          >
            {demo ? 'Demo mode' : 'Live'}
          </Text>
        </View>

        <View style={s.rule} />

        {[
          ['Last reading', fmtTime(reading.timestamp)],
          ['Battery', display(reading.batteryPercent) + '%'],
          ['Data source', demo ? 'Sample data' : 'Local API'],
        ].map(([k, v]) => (
          <View key={k} style={s.info}>
            <Text style={s.muted}>{k}</Text>
            <Text style={s.infoValue}>{v}</Text>
          </View>
        ))}
      </Card>

      {error && <Text style={s.error}>{error}</Text>}

      <TouchableOpacity style={s.refresh} onPress={refresh}>
        <Text style={s.refreshText}>Refresh readings</Text>
      </TouchableOpacity>

      <Card style={{ marginTop: 20 }}>
        <Text style={s.cardTitle}>Connecting hardware</Text>
        <Text style={s.help}>
          The ESP32 can send readings to POST /readings. The phone
          reads GET /readings. The payload and setup steps are in
          README.md.
        </Text>
      </Card>

      <Card style={{ marginTop: 12 }}>
        <Text style={s.cardTitle}>Watering control</Text>
        <Text style={s.help}>
          Pump control will be added after hardware limits, device
          confirmation, and a manual stop are implemented.
        </Text>
      </Card>
    </>
  );
}

export default function App({
  tab = 'Overview',
}: {
  tab?: Tab;
}) {
  const router = useRouter();

  const go = (target: Tab) =>
    router.replace(
      target === 'Overview'
        ? '/'
        : ('/' + target.toLowerCase()) as
            | '/advisor'
            | '/trends'
            | '/device'
    );

  const [readings, setReadings] =
    useState<SensorReading[]>(demoReadings);
  const [demo, setDemo] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Manual refresh: shows the pull-to-refresh indicator.
  const refresh = useCallback(async () => {
    setRefreshing(true);

    try {
      const data = await fetchReadings();

      if (
        !Array.isArray(data.readings) ||
        !data.readings.length
      ) {
        throw new Error('No readings received');
      }

      setReadings(data.readings);
      setDemo(data.mode === 'demo');
      setError(null);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Could not load readings'
      );
    } finally {
      setRefreshing(false);
    }
  }, []);

  // Automatic refresh: updates sensor data without showing
  // the pull-to-refresh indicator or reloading the screen.
  useEffect(() => {
    let active = true;
    let loading = false;

    const updateSensors = async () => {
      if (loading) return;
      loading = true;

      try {
        const data = await fetchReadings();

        if (
          active &&
          Array.isArray(data.readings) &&
          data.readings.length > 0
        ) {
          setReadings(data.readings);
          setDemo(data.mode === 'demo');
          setError(null);
        }
      } catch (e) {
        if (active) {
          console.log(
            'Background sensor update failed:',
            e
          );
        }
      } finally {
        loading = false;
      }
    };

    // Fetch immediately when the app loads.
    void updateSensors();

    // Then fetch again every 3 seconds.
    const timer = setInterval(() => {
      void updateSensors();
    }, 3000);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  const reading = readings[readings.length - 1];

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar
        barStyle="dark-content"
        backgroundColor={color.bg}
      />

      <View style={s.top}>
        <View style={s.logoRow}>
          <View style={s.logoMark}>
            <Text style={s.logoStar}>✦</Text>
          </View>
          <Text style={s.logo}>
            soilsphere
            <Text style={{ color: color.green }}>.</Text>
          </Text>
        </View>
        <Text style={s.topState}>
          {demo ? '● Preview' : '● Connected'}
        </Text>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={s.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={color.green}
          />
        }
        keyboardShouldPersistTaps="handled"
      >
        <Text style={s.pageLabel}>{tab}</Text>

        {tab === 'Overview' ? (
          <Overview
            reading={reading}
            demo={demo}
            onAdvisor={() => go('Advisor')}
          />
        ) : tab === 'Trends' ? (
          <Trends readings={readings} />
        ) : tab === 'Advisor' ? (
          <Advisor
            reading={reading}
            readings={readings}
          />
        ) : (
          <Device
            reading={reading}
            demo={demo}
            refresh={refresh}
            error={error}
          />
        )}
      </ScrollView>

      <View style={s.tabbar}>
        {tabs.map(([name, icon]) => (
          <TouchableOpacity
            key={name}
            style={s.tab}
            onPress={() => go(name)}
            accessibilityRole="button"
            accessibilityLabel={name}
          >
            <Text
              style={[
                s.tabIcon,
                tab === name && s.active,
              ]}
            >
              {icon}
            </Text>
            <Text
              style={[
                s.tabLabel,
                tab === name && s.active,
              ]}
            >
              {name}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: color.bg,
  },
  top: {
    height: 64,
    paddingHorizontal: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  logoMark: {
    width: 31,
    height: 31,
    borderRadius: 10,
    backgroundColor: color.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoStar: {
    color: '#fff',
    fontSize: 20,
  },
  logo: {
    color: color.ink,
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.8,
  },
  topState: {
    color: color.muted,
    fontSize: 12,
    fontWeight: '600',
  },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 28,
  },
  pageLabel: {
    fontSize: 13,
    color: color.muted,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.3,
    marginTop: 9,
    marginBottom: 15,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 21,
    padding: 18,
    borderWidth: 1,
    borderColor: color.line,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  between: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  muted: {
    color: color.muted,
    fontSize: 12,
  },
  small: {
    color: color.muted,
    fontSize: 11,
  },
  cardTitle: {
    color: color.ink,
    fontSize: 16,
    fontWeight: '800',
  },
  rule: {
    height: 1,
    backgroundColor: color.line,
    marginVertical: 15,
  },
  roundIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: color.pale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  check: {
    fontSize: 23,
    color: color.green,
  },
  source: {
    color: color.green,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.7,
  },
  hero: {
    minHeight: 160,
    borderRadius: 23,
    backgroundColor: '#DDECDD',
    padding: 22,
    marginBottom: 16,
  },
  kicker: {
    color: color.green,
    fontSize: 10,
    letterSpacing: 1.4,
    fontWeight: '800',
    marginBottom: 10,
  },
  heroTitle: {
    color: color.ink,
    fontSize: 25,
    lineHeight: 30,
    fontWeight: '800',
    maxWidth: 230,
  },
  heroText: {
    color: '#566F5E',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 7,
    maxWidth: 245,
  },
  heroArt: {
    position: 'absolute',
    right: 25,
    top: 28,
    color: color.green,
    fontSize: 45,
  },
  heading: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginTop: 23,
    marginBottom: 11,
  },
  headingText: {
    color: color.ink,
    fontSize: 19,
    fontWeight: '800',
  },
  note: {
    color: color.muted,
    fontSize: 11,
  },
  nutrient: {
    flex: 1,
    alignItems: 'center',
  },
  nutrientIcon: {
    width: 39,
    height: 39,
    borderRadius: 13,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  nutrientSymbol: {
    color: color.ink,
    fontSize: 17,
    fontWeight: '800',
  },
  nutrientValue: {
    color: color.ink,
    fontSize: 22,
    fontWeight: '800',
    marginTop: 4,
  },
  unit: {
    color: color.muted,
    fontSize: 11,
    fontWeight: '500',
  },
  disclaimer: {
    textAlign: 'center',
    color: color.muted,
    fontSize: 10,
    marginTop: 15,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 10,
  },
  metric: {
    width: '48.5%',
    minHeight: 132,
  },
  metricIcon: {
    color: color.green,
    fontSize: 21,
    marginBottom: 9,
  },
  metricValue: {
    color: color.ink,
    fontSize: 23,
    fontWeight: '800',
    marginTop: 5,
  },
  banner: {
    backgroundColor: color.ink,
    borderRadius: 22,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 20,
  },
  bannerKicker: {
    color: '#A6D7AE',
    fontSize: 9,
    letterSpacing: 1.3,
    fontWeight: '800',
  },
  bannerTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '800',
    marginTop: 7,
  },
  bannerBody: {
    color: '#C9D8CA',
    fontSize: 12,
    marginTop: 5,
  },
  bannerArrow: {
    color: '#fff',
    fontSize: 24,
  },
  trendValue: {
    color: color.ink,
    fontSize: 19,
    fontWeight: '800',
  },
  bars: {
    height: 85,
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-end',
    marginTop: 15,
  },
  barSlot: {
    flex: 1,
    height: '100%',
    justifyContent: 'flex-end',
  },
  bar: {
    borderRadius: 5,
    width: '100%',
  },
  history: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderColor: color.line,
  },
  historyText: {
    color: color.ink,
    fontSize: 13,
    fontWeight: '600',
    marginTop: 3,
  },
  advisorHero: {
    alignItems: 'center',
    backgroundColor: color.pale,
    borderRadius: 23,
    padding: 25,
  },
  advisorStar: {
    color: color.green,
    fontSize: 30,
  },
  advisorTitle: {
    color: color.ink,
    fontSize: 23,
    fontWeight: '800',
    marginTop: 7,
  },
  advisorBody: {
    color: '#607568',
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
    marginTop: 8,
  },
  suggestion: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 15,
    marginBottom: 9,
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: color.line,
  },
  suggestionText: {
    color: color.ink,
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
  greenArrow: {
    color: color.green,
    fontSize: 18,
  },
  bubble: {
    maxWidth: '90%',
    borderRadius: 17,
    padding: 14,
    marginVertical: 6,
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: color.green,
  },
  assistantBubble: {
    alignSelf: 'flex-start',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: color.line,
  },
  bubbleText: {
    color: color.ink,
    fontSize: 13,
    lineHeight: 19,
  },
  inputRow: {
    flexDirection: 'row',
    gap: 9,
    marginTop: 16,
    alignItems: 'center',
  },
  input: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 15,
    borderWidth: 1,
    borderColor: color.line,
    height: 48,
    paddingHorizontal: 14,
    color: color.ink,
  },
  send: {
    width: 47,
    height: 47,
    borderRadius: 14,
    backgroundColor: color.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendText: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '700',
  },
  pill: {
    borderRadius: 15,
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: color.pale,
    fontWeight: '700',
  },
  info: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  infoValue: {
    color: color.ink,
    fontWeight: '700',
    fontSize: 12,
  },
  error: {
    color: '#B84F38',
    marginTop: 14,
    fontSize: 12,
  },
  refresh: {
    backgroundColor: color.green,
    borderRadius: 15,
    padding: 15,
    alignItems: 'center',
    marginTop: 15,
  },
  refreshText: {
    color: '#fff',
    fontWeight: '800',
  },
  help: {
    color: color.muted,
    lineHeight: 19,
    fontSize: 12,
    marginTop: 8,
  },
  tabbar: {
    height: 70,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: color.line,
    flexDirection: 'row',
    paddingTop: 8,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
  },
  tabIcon: {
    color: '#9BAAA0',
    fontSize: 25,
    height: 31,
  },
  tabLabel: {
    color: '#9BAAA0',
    fontSize: 10,
    fontWeight: '700',
  },
  active: {
    color: color.green,
  },
});
