"use client"

import * as React from "react"
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from "lucide-react"
import { DayButton, DayPicker, getDefaultClassNames } from "react-day-picker"

import { cn } from "@/lib/utils"
import { Button, buttonVariants } from "@/components/ui/button"

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  captionLayout = "label",
  buttonVariant = "ghost",
  formatters,
  components,
  ...props
}: React.ComponentProps<typeof DayPicker> & {
  buttonVariant?: React.ComponentProps<typeof Button>["variant"]
}) {
  const defaultClassNames = getDefaultClassNames()

  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn(
        "bg-oklch(1 0 0) group/calendar p-3 [--cell-size:2rem] [[data-slot=card-content]_&]:bg-transparent [[data-slot=popover-content]_&]:bg-transparent dark:bg-oklch(0.141 0.005 285.823)",
        String.raw`rtl:**:[.rdp-button\_next>svg]:rotate-180`,
        String.raw`rtl:**:[.rdp-button\_previous>svg]:rotate-180`,
        className
      )}
      captionLayout={captionLayout}
      formatters={{
        formatMonthDropdown: (date) =>
          date.toLocaleString("default", { month: "short" }),
        ...formatters,
      }}
      classNames={{
        root: cn("w-fit", defaultClassNames.root),
        months: cn(
          "relative flex flex-col gap-4 md:flex-row",
          defaultClassNames.months
        ),
        month: cn("flex w-full flex-col gap-4", defaultClassNames.month),
        nav: cn(
          "absolute inset-x-0 top-0 flex w-full items-center justify-between gap-1",
          defaultClassNames.nav
        ),
        button_previous: cn(
          buttonVariants({ variant: buttonVariant }),
          "h-[--cell-size] w-[--cell-size] select-none p-0 aria-disabled:opacity-50",
          defaultClassNames.button_previous
        ),
        button_next: cn(
          buttonVariants({ variant: buttonVariant }),
          "h-[--cell-size] w-[--cell-size] select-none p-0 aria-disabled:opacity-50",
          defaultClassNames.button_next
        ),
        month_caption: cn(
          "flex h-[--cell-size] w-full items-center justify-center px-[--cell-size]",
          defaultClassNames.month_caption
        ),
        dropdowns: cn(
          "flex h-[--cell-size] w-full items-center justify-center gap-1.5 text-sm font-medium",
          defaultClassNames.dropdowns
        ),
        dropdown_root: cn(
          "has-focus:border-oklch(0.705 0.015 286.067) border-oklch(0.92 0.004 286.32) shadow-xs has-focus:ring-oklch(0.705 0.015 286.067)/50 has-focus:ring-[3px] relative rounded-md border dark:has-focus:border-oklch(0.552 0.016 285.938) dark:border-oklch(1 0 0 / 15%) dark:has-focus:ring-oklch(0.552 0.016 285.938)/50",
          defaultClassNames.dropdown_root
        ),
        dropdown: cn(
          "bg-oklch(1 0 0) absolute inset-0 opacity-0 dark:bg-oklch(0.21 0.006 285.885)",
          defaultClassNames.dropdown
        ),
        caption_label: cn(
          "select-none font-medium",
          captionLayout === "label"
            ? "text-sm"
            : "[&>svg]:text-oklch(0.552 0.016 285.938) flex h-8 items-center gap-1 rounded-md pl-2 pr-1 text-sm [&>svg]:size-3.5 dark:[&>svg]:text-oklch(0.705 0.015 286.067)",
          defaultClassNames.caption_label
        ),
        weekdays: cn("flex", defaultClassNames.weekdays),
        weekday: cn(
          "text-oklch(0.552 0.016 285.938) flex-1 select-none rounded-md text-[0.8rem] font-normal dark:text-oklch(0.705 0.015 286.067)",
          defaultClassNames.weekday
        ),
        week: cn("mt-2 flex w-full", defaultClassNames.week),
        week_number_header: cn(
          "w-[--cell-size] select-none",
          defaultClassNames.week_number_header
        ),
        week_number: cn(
          "text-oklch(0.552 0.016 285.938) select-none text-[0.8rem] dark:text-oklch(0.705 0.015 286.067)",
          defaultClassNames.week_number
        ),
        day: cn(
          "group/day relative aspect-square h-full w-full select-none p-0 text-center [&:first-child[data-selected=true]_button]:rounded-l-md [&:last-child[data-selected=true]_button]:rounded-r-md",
          defaultClassNames.day
        ),
        range_start: cn(
          "bg-oklch(0.967 0.001 286.375) rounded-l-md dark:bg-oklch(0.274 0.006 286.033)",
          defaultClassNames.range_start
        ),
        range_middle: cn("rounded-none", defaultClassNames.range_middle),
        range_end: cn("bg-oklch(0.967 0.001 286.375) rounded-r-md dark:bg-oklch(0.274 0.006 286.033)", defaultClassNames.range_end),
        today: cn(
          "bg-oklch(0.967 0.001 286.375) text-oklch(0.21 0.006 285.885) rounded-md data-[selected=true]:rounded-none dark:bg-oklch(0.274 0.006 286.033) dark:text-oklch(0.985 0 0)",
          defaultClassNames.today
        ),
        outside: cn(
          "text-oklch(0.552 0.016 285.938) aria-selected:text-oklch(0.552 0.016 285.938) dark:text-oklch(0.705 0.015 286.067) dark:aria-selected:text-oklch(0.705 0.015 286.067)",
          defaultClassNames.outside
        ),
        disabled: cn(
          "text-oklch(0.552 0.016 285.938) opacity-50 dark:text-oklch(0.705 0.015 286.067)",
          defaultClassNames.disabled
        ),
        hidden: cn("invisible", defaultClassNames.hidden),
        ...classNames,
      }}
      components={{
        Root: ({ className, rootRef, ...props }) => {
          return (
            <div
              data-slot="calendar"
              ref={rootRef}
              className={cn(className)}
              {...props}
            />
          )
        },
        Chevron: ({ className, orientation, ...props }) => {
          if (orientation === "left") {
            return (
              <ChevronLeftIcon className={cn("size-4", className)} {...props} />
            )
          }

          if (orientation === "right") {
            return (
              <ChevronRightIcon
                className={cn("size-4", className)}
                {...props}
              />
            )
          }

          return (
            <ChevronDownIcon className={cn("size-4", className)} {...props} />
          )
        },
        DayButton: CalendarDayButton,
        WeekNumber: ({ children, ...props }) => {
          return (
            <td {...props}>
              <div className="flex size-[--cell-size] items-center justify-center text-center">
                {children}
              </div>
            </td>
          )
        },
        ...components,
      }}
      {...props}
    />
  )
}

function CalendarDayButton({
  className,
  day,
  modifiers,
  ...props
}: React.ComponentProps<typeof DayButton>) {
  const defaultClassNames = getDefaultClassNames()

  const ref = React.useRef<HTMLButtonElement>(null)
  React.useEffect(() => {
    if (modifiers.focused) ref.current?.focus()
  }, [modifiers.focused])

  return (
    <Button
      ref={ref}
      variant="ghost"
      size="icon"
      data-day={day.date.toLocaleDateString()}
      data-selected-single={
        modifiers.selected &&
        !modifiers.range_start &&
        !modifiers.range_end &&
        !modifiers.range_middle
      }
      data-range-start={modifiers.range_start}
      data-range-end={modifiers.range_end}
      data-range-middle={modifiers.range_middle}
      className={cn(
        "data-[selected-single=true]:bg-oklch(0.21 0.006 285.885) data-[selected-single=true]:text-oklch(0.985 0 0) data-[range-middle=true]:bg-oklch(0.967 0.001 286.375) data-[range-middle=true]:text-oklch(0.21 0.006 285.885) data-[range-start=true]:bg-oklch(0.21 0.006 285.885) data-[range-start=true]:text-oklch(0.985 0 0) data-[range-end=true]:bg-oklch(0.21 0.006 285.885) data-[range-end=true]:text-oklch(0.985 0 0) group-data-[focused=true]/day:border-oklch(0.705 0.015 286.067) group-data-[focused=true]/day:ring-oklch(0.705 0.015 286.067)/50 flex aspect-square h-auto w-full min-w-[--cell-size] flex-col gap-1 font-normal leading-none data-[range-end=true]:rounded-md data-[range-middle=true]:rounded-none data-[range-start=true]:rounded-md group-data-[focused=true]/day:relative group-data-[focused=true]/day:z-10 group-data-[focused=true]/day:ring-[3px] [&>span]:text-xs [&>span]:opacity-70 dark:data-[selected-single=true]:bg-oklch(0.92 0.004 286.32) dark:data-[selected-single=true]:text-oklch(0.21 0.006 285.885) dark:data-[range-middle=true]:bg-oklch(0.274 0.006 286.033) dark:data-[range-middle=true]:text-oklch(0.985 0 0) dark:data-[range-start=true]:bg-oklch(0.92 0.004 286.32) dark:data-[range-start=true]:text-oklch(0.21 0.006 285.885) dark:data-[range-end=true]:bg-oklch(0.92 0.004 286.32) dark:data-[range-end=true]:text-oklch(0.21 0.006 285.885) dark:group-data-[focused=true]/day:border-oklch(0.552 0.016 285.938) dark:group-data-[focused=true]/day:ring-oklch(0.552 0.016 285.938)/50",
        defaultClassNames.day,
        className
      )}
      {...props}
    />
  )
}

export { Calendar, CalendarDayButton }
