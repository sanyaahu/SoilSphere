import React, { createContext, useContext, useRef, useState } from 'react';
import { askAdvisor } from '../api';
import type { ChatMessage, SensorReading } from '../data';

type ChatContext = {
  messages: ChatMessage[];
  busy: boolean;
  send: (text: string, readings: SensorReading[]) => Promise<void>;
};

const Context = createContext<ChatContext | null>(null);

// Holds the advisor conversation above the routes, so closing and reopening the chat keeps it
// (and a reply that arrives after you navigate away still lands). Cleared when the app closes.
export function ChatProvider({ children }: { children: React.ReactNode }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const current = useRef<ChatMessage[]>([]);
  const sending = useRef(false);

  function update(next: ChatMessage[]) {
    current.current = next;
    setMessages(next);
  }

  async function send(text: string, readings: SensorReading[]) {
    const prompt = text.trim();
    if (!prompt || sending.current) return;
    sending.current = true;
    setBusy(true);
    const history = current.current;
    update([...history, { role: 'user', content: prompt }]);
    try {
      const reply = await askAdvisor(prompt, history, readings);
      update([...current.current, { role: 'assistant', content: reply }]);
    } catch (e) {
      update([...current.current, { role: 'assistant', content: e instanceof Error ? e.message : 'Advisor unavailable' }]);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  return <Context.Provider value={{ messages, busy, send }}>{children}</Context.Provider>;
}

export function useChat(): ChatContext {
  const value = useContext(Context);
  if (!value) throw new Error('ChatProvider is missing.');
  return value;
}
