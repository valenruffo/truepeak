"use client"

import * as React from "react"
import * as SliderPrimitive from "@radix-ui/react-slider"

import { cn } from "@/lib/utils"

const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
>(({ className, value, defaultValue, ...props }, ref) => {
  const vals = value || defaultValue || [0]
  return (
    <SliderPrimitive.Root
      ref={ref}
      className={cn(
        "relative flex w-full touch-none select-none items-center",
        className
      )}
      value={value}
      defaultValue={defaultValue}
      {...props}
    >
      <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-secondary">
        <SliderPrimitive.Range className="absolute h-full" style={{ background: "#10b981" }} />
      </SliderPrimitive.Track>
      {vals.map((_, index) => (
        <SliderPrimitive.Thumb 
          key={index} 
          className="block h-4 w-4 rounded-full border shadow transition-colors focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50" 
          style={{ borderColor: "#10b981", background: "var(--text-primary)" }}
        />
      ))}
    </SliderPrimitive.Root>
  )
})
Slider.displayName = SliderPrimitive.Root.displayName

export { Slider }
