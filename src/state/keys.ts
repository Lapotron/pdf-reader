import { create } from "zustand";

/**
 * API keys for cloud engines. Kept apart from settings; stored in localStorage only when
 * the user opts in ("remember"), otherwise in sessionStorage (cleared when the tab closes).
 * Never logged or sent anywhere except the provider's API.
 */
export interface KeysState {
  openai: string;
  elevenlabs: string;
  azure: string;
  remember: boolean;
  setKey(k: "openai" | "elevenlabs" | "azure", v: string): void;
  setRemember(v: boolean): void;
  clearAll(): void;
}

const LS = "mega.keys.v1"; // legacy key, kept so saved API keys survive the rename

function load(): Pick<KeysState, "openai" | "elevenlabs" | "azure" | "remember"> {
  const empty = { openai: "", elevenlabs: "", azure: "", remember: false };
  try {
    const raw = localStorage.getItem(LS) ?? sessionStorage.getItem(LS);
    if (!raw) return empty;
    return { ...empty, ...JSON.parse(raw) };
  } catch {
    return empty;
  }
}

function save(s: Pick<KeysState, "openai" | "elevenlabs" | "azure" | "remember">): void {
  try {
    const data = JSON.stringify({ openai: s.openai, elevenlabs: s.elevenlabs, azure: s.azure, remember: s.remember });
    if (s.remember) {
      localStorage.setItem(LS, data);
      sessionStorage.removeItem(LS);
    } else {
      sessionStorage.setItem(LS, data);
      localStorage.removeItem(LS);
    }
  } catch {
    /* storage unavailable */
  }
}

export const useKeys = create<KeysState>()((set, get) => ({
  ...load(),
  setKey: (k, v) => {
    set({ [k]: v.trim() } as Partial<KeysState>);
    save(get());
  },
  setRemember: (v) => {
    set({ remember: v });
    save(get());
  },
  clearAll: () => {
    set({ openai: "", elevenlabs: "", azure: "" });
    try {
      localStorage.removeItem(LS);
      sessionStorage.removeItem(LS);
    } catch {
      /* ignore */
    }
  },
}));
