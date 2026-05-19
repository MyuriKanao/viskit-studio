'use client';

import { create } from 'zustand';

import type { ChatMessage, ConfirmationMode, InferredSpec } from './types';

function makeKitClientId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `kit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface ChatState {
  messages: ChatMessage[];
  hero_image: { url: string; mime: string } | null;
  user_prompt: string | null;
  inferred_spec: InferredSpec | null;
  confirmation_mode: ConfirmationMode | null;
  kit_client_id: string;

  appendMessage: (msg: Omit<ChatMessage, 'id' | 'timestamp'>) => string;
  updateMessage: (id: string, patch: Partial<Omit<ChatMessage, 'id' | 'timestamp'>>) => void;
  setHeroImage: (image: { url: string; mime: string } | null) => void;
  setUserPrompt: (prompt: string | null) => void;
  setInferredSpec: (spec: InferredSpec | null) => void;
  setConfirmationMode: (mode: ConfirmationMode | null) => void;
  reset: () => void;
}

const initialState = (): Omit<
  ChatState,
  | 'appendMessage'
  | 'updateMessage'
  | 'setHeroImage'
  | 'setUserPrompt'
  | 'setInferredSpec'
  | 'setConfirmationMode'
  | 'reset'
> => ({
  messages: [],
  hero_image: null,
  user_prompt: null,
  inferred_spec: null,
  confirmation_mode: null,
  kit_client_id: makeKitClientId(),
});

export const useChatStore = create<ChatState>((set) => ({
  ...initialState(),

  appendMessage: (msg) => {
    const id = makeKitClientId();
    set((s) => ({
      messages: [
        ...s.messages,
        {
          ...msg,
          id,
          timestamp: Date.now(),
        },
      ],
    }));
    return id;
  },

  updateMessage: (id, patch) =>
    set((s) => ({
      messages: s.messages.map((message) =>
        message.id === id ? { ...message, ...patch } : message
      ),
    })),

  setHeroImage: (image) => set({ hero_image: image }),

  setUserPrompt: (prompt) => set({ user_prompt: prompt }),

  setInferredSpec: (spec) => set({ inferred_spec: spec }),

  setConfirmationMode: (mode) => set({ confirmation_mode: mode }),

  reset: () => set({ ...initialState() }),
}));

if (typeof window !== 'undefined') {
  (window as unknown as { __chatStore?: typeof useChatStore }).__chatStore = useChatStore;
}
