"use client";

import { useState, useEffect } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { updateLabelConfig, getLabelConfig, type LabelConfig } from "@/lib/api";
import { Loader2, Save } from "lucide-react";

const SCALES = ["Minor", "Major", "Dorian", "Phrygian", "Lydian", "Mixolydian"] as const;
type Scale = (typeof SCALES)[number];

const AUTO_REJECT_RULES = [
  { key: "inverted_phase", label: "Inverted Phase", description: "Reject if phase correlation ≤ 0" },
  { key: "excessive_loudness", label: "Excessive Loudness", description: "Reject if LUFS > -8" },
  { key: "out_of_tempo", label: "Out of Tempo", description: "Reject if BPM outside range" },
] as const;

export default function ConfigPage() {
  const { addToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Form state
  const [bpmMin, setBpmMin] = useState(120);
  const [bpmMax, setBpmMax] = useState(130);
  const [lufsTarget, setLuftsTarget] = useState(-14);
  const [lufsTolerance, setLuftsTolerance] = useState(2);
  const [scales, setScales] = useState<Scale[]>(["Minor", "Major"]);
  const [autoReject, setAutoReject] = useState({
    inverted_phase: true,
    excessive_loudness: true,
    out_of_tempo: true,
  });

  useEffect(() => {
    loadConfig();
  }, []);

  async function loadConfig() {
    try {
      // Use a default slug for now — in production this comes from auth context
      const config = await getLabelConfig("demo-label");
      setBpmMin(config.bpm_min);
      setBpmMax(config.bpm_max);
      setLuftsTarget(config.lufs_target);
      setLuftsTolerance(config.lufs_tolerance);
    } catch {
      // Use defaults on first load
    } finally {
      setLoading(false);
    }
  }

  function toggleScale(scale: Scale) {
    setScales((prev) =>
      prev.includes(scale) ? prev.filter((s) => s !== scale) : [...prev, scale]
    );
  }

  function toggleRule(key: keyof typeof autoReject) {
    setAutoReject((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      await updateLabelConfig("demo-label", {
        bpm_min: bpmMin,
        bpm_max: bpmMax,
        lufs_target: lufsTarget,
        lufs_tolerance: lufsTolerance,
      });
      addToast({ title: "Config saved", description: "Your sonic signature has been updated.", variant: "success" });
    } catch (err) {
      addToast({ title: "Save failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <div className="mb-8">
        <h2 className="font-display text-3xl font-bold tracking-tight">Sonic Signature</h2>
        <p className="mt-1 text-muted">Configure your label's audio thresholds and auto-rejection rules.</p>
      </div>

      {/* BPM Range */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-lg">BPM Range</CardTitle>
          <CardDescription>Accept tracks within this tempo range.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <label className="mb-1 block text-xs font-medium text-muted">Min BPM</label>
              <Input
                type="number"
                value={bpmMin}
                onChange={(e) => setBpmMin(Number(e.target.value))}
                className="font-mono"
              />
            </div>
            <span className="mt-6 text-muted">—</span>
            <div className="flex-1">
              <label className="mb-1 block text-xs font-medium text-muted">Max BPM</label>
              <Input
                type="number"
                value={bpmMax}
                onChange={(e) => setBpmMax(Number(e.target.value))}
                className="font-mono"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* LUFS Target */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-lg">LUFS Target</CardTitle>
          <CardDescription>Integrated loudness target with tolerance window.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <label className="mb-1 block text-xs font-medium text-muted">Target (LUFS)</label>
              <Input
                type="number"
                step="0.5"
                value={lufsTarget}
                onChange={(e) => setLuftsTarget(Number(e.target.value))}
                className="font-mono"
              />
            </div>
            <span className="mt-6 text-muted">±</span>
            <div className="flex-1">
              <label className="mb-1 block text-xs font-medium text-muted">Tolerance</label>
              <Input
                type="number"
                step="0.5"
                value={lufsTolerance}
                onChange={(e) => setLuftsTolerance(Number(e.target.value))}
                className="font-mono"
              />
            </div>
            <div className="mt-6 rounded bg-surface2 px-3 py-1.5 font-mono text-xs text-muted">
              Accept: {lufsTarget - lufsTolerance} to {lufsTarget + lufsTolerance} LUFS
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Preferred Scales */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-lg">Preferred Scales</CardTitle>
          <CardDescription>Select musical scales you accept. Multi-select.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {SCALES.map((scale) => {
              const active = scales.includes(scale);
              return (
                <button
                  key={scale}
                  type="button"
                  onClick={() => toggleScale(scale)}
                  className={`rounded-full border px-4 py-1.5 text-sm font-medium transition-all ${
                    active
                      ? "border-accent bg-accent/10 text-accent"
                      : "border-border text-muted hover:border-muted hover:text-foreground"
                  }`}
                >
                  {scale}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Auto-Reject Rules */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-lg">Auto-Reject Rules</CardTitle>
          <CardDescription>Automatically reject submissions matching these criteria.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {AUTO_REJECT_RULES.map((rule) => (
              <label
                key={rule.key}
                className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-surface2/50"
              >
                <input
                  type="checkbox"
                  checked={autoReject[rule.key as keyof typeof autoReject]}
                  onChange={() => toggleRule(rule.key as keyof typeof autoReject)}
                  className="mt-0.5 h-4 w-4 accent-accent"
                />
                <div>
                  <span className="text-sm font-medium text-foreground">{rule.label}</span>
                  <p className="text-xs text-muted">{rule.description}</p>
                </div>
              </label>
            ))}
          </div>
        </CardContent>
      </Card>

      <CardFooter className="px-0">
        <Button onClick={handleSave} disabled={saving} className="gap-2">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save Configuration
        </Button>
      </CardFooter>
    </div>
  );
}
