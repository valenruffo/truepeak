"use client";

import { useKanbanFilters } from "@/store/kanban-filters";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { CalendarIcon, FilterX, Filter } from "lucide-react";
import { cn } from "@/lib/utils";
import { Slider } from "@/components/ui/slider";
import { useEffect, useState } from "react";
import { useLanguage } from "@/lib/i18n";

const camelotKeys = [
  "1A", "1B", "2A", "2B", "3A", "3B", "4A", "4B",
  "5A", "5B", "6A", "6B", "7A", "7B", "8A", "8B",
  "9A", "9B", "10A", "10B", "11A", "11B", "12A", "12B"
];

export function KanbanFilterBar({ sonicSignature }: { sonicSignature?: any }) {
  const { t } = useLanguage();
  const {
    bpmMin,
    bpmMax,
    tonalidades,
    fechaInicio,
    fechaFin,
    fechaLabel,
    hqDownloaded,
    setBpmMin,
    setBpmMax,
    setTonalidades,
    setFechaInicio,
    setFechaFin,
    setFechaLabel,
    setHqDownloaded,
    clearFilters,
  } = useKanbanFilters();

  const toggleTonalidad = (tonalidad: string) => {
    setTonalidades(
      tonalidades.includes(tonalidad)
        ? tonalidades.filter((t) => t !== tonalidad)
        : [...tonalidades, tonalidad]
    );
  };

  const activeFilterCount =
    tonalidades.length +
    (bpmMin !== null || bpmMax !== null ? 1 : 0) +
    (fechaInicio !== null || fechaFin !== null ? 1 : 0) +
    (hqDownloaded !== null ? 1 : 0);

  // Default slider bounds based on sonic signature or standard defaults
  const sliderMin = sonicSignature?.bpm_min ?? 70;
  const sliderMax = sonicSignature?.bpm_max ?? 180;
  
  // Local state for smooth slider dragging
  const [sliderValues, setSliderValues] = useState([
    bpmMin ?? sliderMin, 
    bpmMax ?? sliderMax
  ]);

  // Sync internal slider state with global state if it's cleared or bounded
  useEffect(() => {
    setSliderValues([bpmMin ?? sliderMin, bpmMax ?? sliderMax]);
  }, [bpmMin, bpmMax, sliderMin, sliderMax]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button 
          variant="outline" 
          size="sm" 
          className="h-8 transition-colors flex items-center gap-1.5"
          style={{ 
            borderColor: activeFilterCount > 0 ? "#10b981" : "var(--border)",
            background: activeFilterCount > 0 ? "rgba(16, 185, 129, 0.1)" : "transparent",
            color: activeFilterCount > 0 ? "#10b981" : "var(--text-primary)"
          }}
        >
          <Filter className="h-3.5 w-3.5 mr-0.5" />
          {t("inbox.filter_bar.title")}
          {activeFilterCount > 0 && (
            <span className="flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold ml-1.5" style={{ background: "#10b981", color: "#09090b" }}>
              {activeFilterCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-4 space-y-4 shadow-xl border" align="end" style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}>
        {/* BPM Range Slider */}
        <div>
          <div className="flex justify-between items-center mb-1.5">
            <span className="text-xs font-semibold text-primary">{t("inbox.filter_bar.bpm_range")}</span>
            <span className="text-[10px] text-muted font-mono">{sliderValues[0]} - {sliderValues[1]}</span>
          </div>
          <div className="px-1 py-1">
            <Slider
              min={sliderMin}
              max={sliderMax}
              step={1}
              value={sliderValues}
              onValueChange={setSliderValues}
              onValueCommit={(vals) => {
                setBpmMin(vals[0]);
                setBpmMax(vals[1]);
              }}
            />
          </div>
          <div className="flex justify-between text-[9px] text-muted font-mono mt-1">
            <span>{sliderMin} BPM</span>
            <span>{sliderMax} BPM</span>
          </div>
        </div>

        {/* Camelot Key Grid */}
        <div className="border-t pt-3" style={{ borderColor: "var(--border-light)" }}>
          <span className="text-xs font-semibold text-primary block mb-2">{t("inbox.filter_bar.camelot_key")}</span>
          <div className="grid grid-cols-6 gap-1">
            {camelotKeys.map((key) => {
              const isSelected = tonalidades.includes(key);
              return (
                <div
                  key={key}
                  onClick={() => toggleTonalidad(key)}
                  className="text-[9px] text-center py-1 rounded cursor-pointer border transition-colors font-mono font-medium"
                  style={{
                    background: isSelected ? "#10b981" : "var(--bg-secondary)",
                    borderColor: isSelected ? "#10b981" : "var(--border)",
                    color: isSelected ? "#09090b" : "var(--text-primary)",
                  }}
                >
                  {key}
                </div>
              );
            })}
          </div>
        </div>

        {/* Date Filter */}
        <div className="border-t pt-3" style={{ borderColor: "var(--border-light)" }}>
          <span className="text-xs font-semibold text-primary block mb-1.5">{t("inbox.filter_bar.submission_date")}</span>
          <div className="flex flex-wrap gap-1">
            {[
              { label: "7d", days: 7, i18n: "inbox.filter_bar.date_7d" },
              { label: "15d", days: 15, i18n: "inbox.filter_bar.date_15d" },
              { label: "30d", days: 30, i18n: "inbox.filter_bar.date_30d" },
              { label: "3m", months: 3, i18n: "inbox.filter_bar.date_3m" },
              { label: "Histórico", clear: true, i18n: "inbox.filter_bar.date_historic" },
            ].map((option) => {
              const displayLabel = option.clear ? t("inbox.filter_bar.all") : option.label;
              const isFullLabelActive = option.clear
                ? !fechaLabel
                : (fechaLabel && (
                    fechaLabel.includes(option.label) ||
                    (option.label === "7d" && fechaLabel.includes("7")) ||
                    (option.label === "15d" && fechaLabel.includes("15")) ||
                    (option.label === "30d" && fechaLabel.includes("30")) ||
                    (option.label === "3m" && fechaLabel.includes("3"))
                  ));

              return (
                <button
                  key={option.label}
                  className="text-[10px] px-2.5 py-1 rounded border transition-colors font-medium"
                  style={{
                    background: isFullLabelActive ? "#10b981" : "var(--bg-secondary)",
                    borderColor: isFullLabelActive ? "#10b981" : "var(--border)",
                    color: isFullLabelActive ? "#09090b" : "var(--text-muted)",
                  }}
                  onClick={() => {
                    if (option.clear) {
                      setFechaInicio(null);
                      setFechaFin(null);
                      setFechaLabel(null);
                      return;
                    }
                    const today = new Date();
                    const past = new Date(today);
                    if (option.days) past.setDate(today.getDate() - option.days);
                    if (option.months) past.setMonth(today.getMonth() - option.months);
                    setFechaInicio(past);
                    setFechaFin(today);
                    setFechaLabel(t(option.i18n as any));
                  }}
                >
                  {displayLabel}
                </button>
              );
            })}
          </div>
        </div>

        {/* HQ Download Filter */}
        <div className="border-t pt-3" style={{ borderColor: "var(--border-light)" }}>
          <span className="text-xs font-semibold text-primary block mb-1.5">{t("inbox.filter_bar.hq_downloaded")}</span>
          <div className="flex gap-1">
            {[
              { label: t("inbox.filter_bar.all"), value: null },
              { label: t("inbox.filter_bar.downloaded"), value: true },
              { label: t("inbox.filter_bar.pending"), value: false },
            ].map((opt) => {
              const isActive = hqDownloaded === opt.value;
              return (
                <button
                  key={String(opt.value)}
                  onClick={() => setHqDownloaded(opt.value)}
                  className="flex-1 text-[10px] px-2 py-1 rounded border transition-colors font-medium"
                  style={{
                    background: isActive ? (opt.value === true ? "#10b981" : opt.value === false ? "rgba(6,182,212,0.15)" : "var(--bg-secondary)") : "var(--bg-secondary)",
                    borderColor: isActive ? (opt.value === true ? "#10b981" : opt.value === false ? "#06b6d4" : "var(--border)") : "var(--border)",
                    color: isActive ? (opt.value === true ? "#09090b" : opt.value === false ? "#06b6d4" : "var(--text-muted)") : "var(--text-muted)",
                  }}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Clear Filters Button */}
        {activeFilterCount > 0 && (
          <div className="border-t pt-3 flex justify-end animate-fade-in" style={{ borderColor: "var(--border-light)" }}>
            <Button
              variant="ghost"
              size="sm"
              onClick={clearFilters}
              className="h-7 text-xs px-2 hover:bg-transparent"
              style={{ color: "var(--text-muted)" }}
            >
              <FilterX className="mr-1.5 h-3.5 w-3.5" />
              <span className="hover:text-white transition-colors">{t("inbox.filter_bar.clear")}</span>
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
