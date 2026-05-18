"use client";

import { useKanbanFilters } from "@/store/kanban-filters";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { CalendarIcon, FilterX } from "lucide-react";
import { cn } from "@/lib/utils";
import { Slider } from "@/components/ui/slider";
import { useEffect, useState } from "react";

const camelotKeys = [
  "1A", "1B", "2A", "2B", "3A", "3B", "4A", "4B",
  "5A", "5B", "6A", "6B", "7A", "7B", "8A", "8B",
  "9A", "9B", "10A", "10B", "11A", "11B", "12A", "12B"
];

export function KanbanFilterBar({ sonicSignature }: { sonicSignature?: any }) {
  const {
    bpmMin,
    bpmMax,
    tonalidades,
    fechaInicio,
    fechaFin,
    fechaLabel,
    setBpmMin,
    setBpmMax,
    setTonalidades,
    setFechaInicio,
    setFechaFin,
    setFechaLabel,
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
    (fechaInicio !== null || fechaFin !== null ? 1 : 0);

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
    <div 
      className="flex flex-wrap items-center gap-3 mb-6 p-4 rounded-md border"
      style={{ 
        background: "rgba(16, 185, 129, 0.02)", 
        borderColor: "rgba(16, 185, 129, 0.15)",
        color: "var(--text-primary)"
      }}
    >
      <div className="text-sm font-semibold mr-2 flex items-center gap-2" style={{ color: "#10b981" }}>
        Filtros
        {activeFilterCount > 0 && (
          <span className="flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold" style={{ background: "#10b981", color: "#09090b" }}>
            {activeFilterCount}
          </span>
        )}
      </div>

      {/* BPM */}
      <Popover>
        <PopoverTrigger asChild>
          <Button 
            variant="outline" 
            size="sm" 
            className="h-8 transition-colors"
            style={{ 
              borderColor: (bpmMin !== null || bpmMax !== null) ? "#10b981" : "var(--border)",
              background: (bpmMin !== null || bpmMax !== null) ? "rgba(16, 185, 129, 0.1)" : "transparent",
              color: (bpmMin !== null || bpmMax !== null) ? "#10b981" : "var(--text-primary)"
            }}
          >
            BPM
            {(bpmMin !== null || bpmMax !== null) && (
              <span className="ml-2 opacity-80">
                ({bpmMin || sliderMin} - {bpmMax || sliderMax})
              </span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-4" align="start">
          <div className="space-y-4">
            <div className="flex justify-between items-center border-b pb-2" style={{ borderColor: "var(--border)" }}>
              <h4 className="font-medium text-sm">Rango de BPM</h4>
              <span className="text-xs text-muted-foreground font-mono">
                {sliderValues[0]} - {sliderValues[1]}
              </span>
            </div>
            <div className="pt-2 pb-1">
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
            <div className="flex justify-between text-[10px] text-muted-foreground font-mono">
              <span>{sliderMin}</span>
              <span>{sliderMax}</span>
            </div>
          </div>
        </PopoverContent>
      </Popover>

      {/* TONALIDAD CAMELOT */}
      <Popover>
        <PopoverTrigger asChild>
          <Button 
            variant="outline" 
            size="sm" 
            className="h-8 transition-colors"
            style={{ 
              borderColor: tonalidades.length > 0 ? "#10b981" : "var(--border)",
              background: tonalidades.length > 0 ? "rgba(16, 185, 129, 0.1)" : "transparent",
              color: tonalidades.length > 0 ? "#10b981" : "var(--text-primary)"
            }}
          >
            Tonalidad
            {tonalidades.length > 0 && (
              <span className="ml-2 opacity-80">({tonalidades.length})</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-3" align="start">
          <h4 className="font-medium text-sm mb-3 border-b pb-2" style={{ borderColor: "var(--border)" }}>Tonalidad Camelot</h4>
          <div className="grid grid-cols-4 gap-2">
            {camelotKeys.map((key) => {
              const isSelected = tonalidades.includes(key);
              return (
                <div
                  key={key}
                  onClick={() => toggleTonalidad(key)}
                  className="text-xs text-center py-1.5 rounded cursor-pointer border transition-colors font-medium"
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
        </PopoverContent>
      </Popover>

      {/* FECHA */}
      <Popover>
        <PopoverTrigger asChild>
          <Button 
            variant="outline" 
            size="sm" 
            className="h-8 transition-colors"
            style={{ 
              borderColor: fechaLabel ? "#10b981" : "var(--border)",
              background: fechaLabel ? "rgba(16, 185, 129, 0.1)" : "transparent",
              color: fechaLabel ? "#10b981" : "var(--text-primary)"
            }}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            Fecha
            {fechaLabel && (
              <span className="ml-2 opacity-80">({fechaLabel})</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-48 p-2" align="start">
          <div className="flex flex-col gap-1">
            {[
              { label: "Últimos 7 días", value: "7d", days: 7 },
              { label: "Últimos 15 días", value: "15d", days: 15 },
              { label: "Últimos 30 días", value: "30d", days: 30 },
              { label: "Últimos 3 meses", value: "3m", months: 3 },
              { label: "Histórico (Todos)", value: "all", clear: true },
            ].map((option) => {
              const isActive = fechaLabel === option.label;
              return (
                <Button
                  key={option.value}
                  variant="ghost"
                  size="sm"
                  className="justify-start text-xs font-normal transition-colors"
                  style={{
                    background: isActive ? "#10b981" : "transparent",
                    color: isActive ? "#09090b" : "var(--text-primary)",
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
                    setFechaLabel(option.label);
                  }}
                >
                  {option.label}
                </Button>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>

      {/* CLEAR */}
      {activeFilterCount > 0 && (
        <Button
          variant="ghost"
          size="sm"
          onClick={clearFilters}
          className="h-8 px-2 lg:px-3 hover:bg-transparent"
          style={{ color: "var(--text-muted)" }}
        >
          <FilterX className="mr-2 h-4 w-4" />
          <span className="hover:text-white transition-colors">Limpiar</span>
        </Button>
      )}
    </div>
  );
}
