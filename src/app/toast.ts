import { create } from "zustand";

export interface Toast {
  id: number;
  text: string;
  kind: "info" | "error" | "success";
}

export const useToasts = create<{ toasts: Toast[] }>()(() => ({ toasts: [] }));
let nextId = 1;

export function toast(text: string, kind: Toast["kind"] = "info", ms = 4000): void {
  const id = nextId++;
  useToasts.setState((s) => ({ toasts: [...s.toasts, { id, text, kind }] }));
  setTimeout(() => useToasts.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), ms);
}
