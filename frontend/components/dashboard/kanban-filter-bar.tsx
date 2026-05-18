"use client";

import { useKanbanFilters } from "@/store/kanban-filters";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { CalendarIcon, FilterX } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

const camelotKeys = [
  "1A", "1B", "2A", "2B", "3A", "3B", "4A", "4B",
  "5A", "5B", "6A", "6B", "7A", "7B", "8A", "8B",
  "9A", "9B", "10A", "10B", "11A", "11B", "12A", "12B"
];

export function KanbanFilterBar() {
  const {
    bpmMin,
    bpmMax,
    tonalidades,
    fechaInicio,
    fechaFin,
    setBpmMin,
    setBpmMax,
    setTonalidades,
    setFechaInicio,
    setFechaFin,
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
    (bpmMin !== null ? 1 : 0) +
    (bpmMax !== null ? 1 : 0) +
    (fechaInicio !== null ? 1 : 0) +
    (fechaFin !== null ? 1 : 0);

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
                ({bpmMin || "Min"} - {bpmMax || "Max"})
              </span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-3" align="start">
          <div className="space-y-4">
            <h4 className="font-medium text-sm border-b pb-2" style={{ borderColor: "var(--border)" }}>Rango de BPM</h4>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                placeholder="Min"
                className="h-8"
                value={bpmMin || ""}
                onChange={(e) => setBpmMin(e.target.value ? Number(e.target.value) : null)}
                style={{ background: "var(--bg-secondary)", borderColor: "var(--border)", color: "var(--text-primary)" }}
              />
              <span style={{ color: "var(--text-muted)" }}>-</span>
              <Input
                type="number"
                placeholder="Max"
                className="h-8"
                value={bpmMax || ""}
                onChange={(e) => setBpmMax(e.target.value ? Number(e.target.value) : null)}
                style={{ background: "var(--bg-secondary)", borderColor: "var(--border)", color: "var(--text-primary)" }}
              />
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
              borderColor: (fechaInicio || fechaFin) ? "#10b981" : "var(--border)",
              background: (fechaInicio || fechaFin) ? "rgba(16, 185, 129, 0.1)" : "transparent",
              color: (fechaInicio || fechaFin) ? "#10b981" : "var(--text-primary)"
            }}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            Fecha
            {(fechaInicio || fechaFin) && (
              <span className="ml-2 opacity-80">Activo</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-48 p-2" align="start">
          <div className="flex flex-col gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="justify-start text-xs font-normal hover:bg-white/5 transition-colors"
              onClick={() => {
                const today = new Date();
                const past = new Date(today);
                past.setDate(today.getDate() - 7);
                setFechaInicio(past);
                setFechaFin(today);
              }}
            >
              Últimos 7 días
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="justify-start text-xs font-normal hover:bg-white/5 transition-colors"
              onClick={() => {
                const today = new Date();
                const past = new Date(today);
                past.setDate(today.getDate() - 15);
                setFechaInicio(past);
                setFechaFin(today);
              }}
            >
              Últimos 15 días
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="justify-start text-xs font-normal hover:bg-white/5 transition-colors"
              onClick={() => {
                const today = new Date();
                const past = new Date(today);
                past.setDate(today.getDate() - 30);
                setFechaInicio(past);
                setFechaFin(today);
              }}
            >
              Últimos 30 días
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="justify-start text-xs font-normal hover:bg-white/5 transition-colors"
              onClick={() => {
                const today = new Date();
                const past = new Date(today);
                past.setMonth(today.getMonth() - 3);
                setFechaInicio(past);
                setFechaFin(today);
              }}
            >
              Últimos 3 meses
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="justify-start text-xs font-normal hover:bg-white/5 transition-colors"
              style={{ color: "var(--text-muted)" }}
              onClick={() => {
                setFechaInicio(null);
                setFechaFin(null);
              }}
            >
              Histórico (Todos)
            </Button>
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
