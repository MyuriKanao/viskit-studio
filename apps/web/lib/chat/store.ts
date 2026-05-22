'use client';

import { create } from 'zustand';

import type { GenerationPlan, SourceImageRef } from '@/lib/generation/types';
import type { ChatMessage, ConfirmationMode, InferredSpec } from './types';

const CHAT_DRAFT_STORAGE_KEY = 'viskit:new-kit:chat-draft:v1';

function makeKitClientId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `kit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface ChatState {
  messages: ChatMessage[];
  hero_image: { url: string; mime: string } | null;
  source_image: SourceImageRef | null;
  user_prompt: string | null;
  inferred_spec: InferredSpec | null;
  output_plan: GenerationPlan | null;
  confirmation_mode: ConfirmationMode | null;
  kit_client_id: string;
  active_job_id: string | null;

  appendMessage: (msg: Omit<ChatMessage, 'id' | 'timestamp'>) => string;
  updateMessage: (id: string, patch: Partial<Omit<ChatMessage, 'id' | 'timestamp'>>) => void;
  setHeroImage: (image: { url: string; mime: string } | null) => void;
  setSourceImage: (image: SourceImageRef | null) => void;
  setUserPrompt: (prompt: string | null) => void;
  setInferredSpec: (spec: InferredSpec | null) => void;
  setOutputPlan: (plan: GenerationPlan | null) => void;
  setConfirmationMode: (mode: ConfirmationMode | null) => void;
  setActiveJobId: (jobId: string | null) => void;
  reset: () => void;
}

type ChatDataState = Omit<
  ChatState,
  | 'appendMessage'
  | 'updateMessage'
  | 'setHeroImage'
  | 'setSourceImage'
  | 'setUserPrompt'
  | 'setInferredSpec'
  | 'setOutputPlan'
  | 'setConfirmationMode'
  | 'setActiveJobId'
  | 'reset'
>;

function readPersistedState(): Partial<ChatDataState> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.sessionStorage.getItem(CHAT_DRAFT_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<ChatDataState>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function baseState(): ChatDataState {
  return {
    messages: [],
    hero_image: null,
    source_image: null,
    user_prompt: null,
    inferred_spec: null,
    output_plan: null,
    confirmation_mode: null,
    kit_client_id: makeKitClientId(),
    active_job_id: null,
  };
}

const initialState = (hydrate = true): ChatDataState => {
  const base = baseState();
  if (!hydrate) return base;
  const persisted = readPersistedState();
  return {
    ...base,
    ...persisted,
    messages: Array.isArray(persisted.messages) ? persisted.messages : base.messages,
    kit_client_id: persisted.kit_client_id || base.kit_client_id,
  };
};

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

  setSourceImage: (image) => set({ source_image: image }),

  setUserPrompt: (prompt) => set({ user_prompt: prompt }),

  setInferredSpec: (spec) => set({ inferred_spec: spec }),

  setOutputPlan: (plan) => set({ output_plan: plan }),

  setConfirmationMode: (mode) => set({ confirmation_mode: mode }),

  setActiveJobId: (jobId) => set({ active_job_id: jobId }),

  reset: () => {
    if (typeof window !== 'undefined') {
      window.sessionStorage.removeItem(CHAT_DRAFT_STORAGE_KEY);
    }
    set({ ...initialState(false) });
  },
}));

if (typeof window !== 'undefined') {
  (window as unknown as { __chatStore?: typeof useChatStore }).__chatStore = useChatStore;
  useChatStore.subscribe((state) => {
    const snapshot: ChatDataState = {
      messages: state.messages,
      hero_image: state.hero_image,
      source_image: state.source_image,
      user_prompt: state.user_prompt,
      inferred_spec: state.inferred_spec,
      output_plan: state.output_plan,
      confirmation_mode: state.confirmation_mode,
      kit_client_id: state.kit_client_id,
      active_job_id: state.active_job_id,
    };
    window.sessionStorage.setItem(CHAT_DRAFT_STORAGE_KEY, JSON.stringify(snapshot));
  });
}
