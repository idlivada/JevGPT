"use client";

import type { BackendInfo, UiSettings } from "@/lib/chat-types";
import { DEFAULT_RERANK_CANDIDATES } from "@/lib/defaults";
import ApiKeySection from "./ApiKeySection";

interface SliderSpec {
  key: Exclude<keyof UiSettings, "heatmap" | "useHistory" | "rerank">;
  label: string;
  hint: string;
  min: number;
  max: number;
  step: number;
}

const SLIDERS: SliderSpec[] = [
  { key: "temperature", label: "Temperature", hint: "Lower is safer, higher is wilder", min: 0.1, max: 2, step: 0.05 },
  { key: "topK", label: "Top-k", hint: "Sample only from the k likeliest words (0 = off)", min: 0, max: 200, step: 1 },
  { key: "topP", label: "Top-p", hint: "Sample from the smallest set covering this much probability", min: 0.1, max: 1, step: 0.01 },
  { key: "repetitionPenalty", label: "Repetition penalty", hint: "Discourage words already used in the reply", min: 1, max: 3, step: 0.05 },
  { key: "maxWords", label: "Max words", hint: "Stop the reply after this many words", min: 5, max: 200, step: 1 },
];

interface Props {
  info: BackendInfo | null;
  onInfo: (info: BackendInfo) => void;
  settings: UiSettings;
  onChange: (s: UiSettings) => void;
  onReset: () => void;
  onClose: () => void;
}

export default function SettingsPanel({ info, onInfo, settings, onChange, onReset, onClose }: Props) {
  return (
    <div className="absolute right-3 top-12 z-30 max-h-[calc(100dvh-64px)] w-80 max-w-[calc(100vw-24px)] overflow-y-auto rounded-2xl border border-border bg-popover p-4 shadow-xl">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold">Jev API key</h2>
        <button onClick={onClose} className="text-sm text-muted hover:text-fg" aria-label="Close settings">
          ✕
        </button>
      </div>
      <ApiKeySection info={info} onInfo={onInfo} />
      <div className="mb-3 mt-5 flex items-center justify-between border-t border-border pt-4">
        <h2 className="font-semibold">Sampling</h2>
        <button onClick={onReset} className="text-sm text-muted hover:text-fg">
          Reset
        </button>
      </div>
      <div className="space-y-4">
        <label className="flex items-center justify-between gap-3 text-sm">
          <span>
            Re-rank continuations
            <span className="block text-xs text-muted">
              Jev picks among the top {DEFAULT_RERANK_CANDIDATES} whole continuations each step. Much more coherent,
              about 2× slower.
            </span>
          </span>
          <input
            type="checkbox"
            checked={settings.rerank}
            onChange={(e) => onChange({ ...settings, rerank: e.target.checked })}
            className="size-4 shrink-0 accent-[var(--fg)]"
          />
        </label>
        {SLIDERS.map((s) => (
          <label key={s.key} className="block">
            <span className="flex justify-between text-sm">
              <span>{s.label}</span>
              <span className="tabular-nums text-muted">{settings[s.key]}</span>
            </span>
            <input
              type="range"
              min={s.min}
              max={s.max}
              step={s.step}
              value={settings[s.key]}
              onChange={(e) => onChange({ ...settings, [s.key]: Number(e.target.value) })}
              className="mt-1 w-full accent-[var(--fg)]"
            />
            <span className="text-xs text-muted">{s.hint}</span>
          </label>
        ))}
        <label className="flex items-center justify-between border-t border-border pt-3 text-sm">
          <span>
            Probability heatmap
            <span className="block text-xs text-muted">Tint each word by how likely Jev thought it was</span>
          </span>
          <input
            type="checkbox"
            checked={settings.heatmap}
            onChange={(e) => onChange({ ...settings, heatmap: e.target.checked })}
            className="size-4 accent-[var(--fg)]"
          />
        </label>
      </div>
    </div>
  );
}
