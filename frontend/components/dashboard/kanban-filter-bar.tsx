"use client";

import { useKanbanFilters } from "@/store/kanban-filters";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { CalendarIcon, FilterX } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

const camelotKeys = [
  "1A", "1B", "2A", "2B", "3A", "3B", "4A", "4B",
  "5A", "5B", "6A", "6B", "7A", "7B", "8A", "8B",
  "9A", "9B", "10A", "10B", "11A", "11B", "12A", "12B"
];

const estadosDisponibles = [
  { value: "inbox", label: "Inbox (Pendiente)" },
  { value: "shortlist", label: "Shortlist (Aprobado)" },
  { value: "rejected", label: "Rechazado" },
  { value: "auto_rejected", label: "Auto-Rechazado (Sistema)" }
];

export function KanbanFilterBar() {
  const {
    estados,
    bpmMin,
    bpmMax,
    tonalidades,
    fechaInicio,
    fechaFin,
    setEstados,
    setBpmMin,
    setBpmMax,
    setTonalidades,
    setFechaInicio,
    setFechaFin,
    clearFilters,
  } = useKanbanFilters();

  const toggleEstado = (estado: string) => {
    setEstados(
      estados.includes(estado)
        ? estados.filter((e) => e !== estado)
        : [...estados, estado]
    );
  };

  const toggleTonalidad = (tonalidad: string) => {
    setTonalidades(
      tonalidades.includes(tonalidad)
        ? tonalidades.filter((t) => t !== tonalidad)
        : [...tonalidades, tonalidad]
    );
  };

  const activeFilterCount =
    estados.length +
    tonalidades.length +
    (bpmMin !== null ? 1 : 0) +
    (bpmMax !== null ? 1 : 0) +
    (fechaInicio !== null ? 1 : 0) +
    (fechaFin !== null ? 1 : 0);

  return (
    <div className="flex flex-wrap items-center gap-3 mb-6 p-4 rounded-md border bg-card text-card-foreground">
      <div className="text-sm font-semibold mr-2 flex items-center gap-2">
        Filtros
        {activeFilterCount > 0 && (
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] text-primary-foreground">
            {activeFilterCount}
          </span>
        )}
      </div>

      {/* ESTADO */}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 border-dashed">
            Estado
            {estados.length > 0 && (
              <span className="ml-2 text-muted-foreground">({estados.length})</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-56 p-2" align="start">
          <div className="space-y-2">
            <h4 className="font-medium text-sm mb-2">Filtrar por Estado</h4>
            {estadosDisponibles.map((est) => (
              <label key={est.value} className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={estados.includes(est.value)}
                  onChange={() => toggleEstado(est.value)}
                  className="rounded border-gray-300"
                />
                {est.label}
              </label>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      {/* BPM */}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 border-dashed">
            BPM
            {(bpmMin !== null || bpmMax !== null) && (
              <span className="ml-2 text-muted-foreground">
                ({bpmMin || "Min"} - {bpmMax || "Max"})
              </span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-3" align="start">
          <div className="space-y-4">
            <h4 className="font-medium text-sm">Rango de BPM</h4>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                placeholder="Min"
                className="h-8"
                value={bpmMin || ""}
                onChange={(e) => setBpmMin(e.target.value ? Number(e.target.value) : null)}
              />
              <span className="text-muted-foreground">-</span>
              <Input
                type="number"
                placeholder="Max"
                className="h-8"
                value={bpmMax || ""}
                onChange={(e) => setBpmMax(e.target.value ? Number(e.target.value) : null)}
              />
            </div>
          </div>
        </PopoverContent>
      </Popover>

      {/* TONALIDAD CAMELOT */}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 border-dashed">
            Tonalidad
            {tonalidades.length > 0 && (
              <span className="ml-2 text-muted-foreground">({tonalidades.length})</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-3" align="start">
          <h4 className="font-medium text-sm mb-3">Tonalidad Camelot</h4>
          <div className="grid grid-cols-4 gap-2">
            {camelotKeys.map((key) => (
              <div
                key={key}
                onClick={() => toggleTonalidad(key)}
                className={cn(
                  "text-xs text-center py-1 rounded cursor-pointer border transition-colors",
                  tonalidades.includes(key)
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                )}
              >
                {key}
              </div>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      {/* FECHA */}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 border-dashed">
            <CalendarIcon className="mr-2 h-4 w-4" />
            Fecha
            {(fechaInicio || fechaFin) && (
              <span className="ml-2 text-muted-foreground">Activo</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <div className="p-3 border-b flex flex-col gap-2">
            <div className="flex gap-2 justify-between">
              <Button
                variant="outline"
                size="sm"
                className="text-xs flex-1"
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
                variant="outline"
                size="sm"
                className="text-xs flex-1"
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
            </div>
          </div>
          <Calendar
            mode="range"
            defaultMonth={fechaInicio || undefined}
            selected={{
              from: fechaInicio || undefined,
              to: fechaFin || undefined,
            }}
            onSelect={(range) => {
              setFechaInicio(range?.from || null);
              setFechaFin(range?.to || null);
            }}
            numberOfMonths={1}
            locale={es}
          />
        </PopoverContent>
      </Popover>

      {/* CLEAR */}
      {activeFilterCount > 0 && (
        <Button
          variant="ghost"
          size="sm"
          onClick={clearFilters}
          className="h-8 px-2 lg:px-3 text-muted-foreground hover:text-foreground"
        >
          <FilterX className="mr-2 h-4 w-4" />
          Limpiar
        </Button>
      )}
    </div>
  );
}
