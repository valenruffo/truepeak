"use client";

import { DemoSimulation } from "@/components/audio-viz/demo-simulation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Headphones, Zap, Shield, ArrowRight, Check, Music, Mail, BarChart3, Link as LinkIcon } from "lucide-react";

const FEATURES = [
  {
    icon: Zap,
    title: "Sonic Signature",
    description: "Configure BPM range, LUFS targets, phase correlation, and musical scales. Auto-reject tracks that don't match your label's sound.",
  },
  {
    icon: Headphones,
    title: "Zero Friction",
    description: "Producers upload WAVs through a unique link — no login, no forms, no barriers. You get clean, analyzed submissions in your inbox.",
  },
  {
    icon: Shield,
    title: "Auto-Rejections",
    description: "Inverted phase, excessive loudness, out of tempo — the system filters the noise so you only hear what matters.",
  },
];

const WORKFLOW_STEPS = [
  {
    step: 1,
    title: "Configure Your Sonic Signature",
    description: "Set BPM range, LUFS target, preferred scales, and auto-reject rules for your label.",
    icon: Music,
  },
  {
    step: 2,
    title: "Share Your Submission Link",
    description: "Each label gets a unique URL (truepeak.ai/s/{slug}) that producers can access without registration.",
    icon: LinkIcon,
  },
  {
    step: 3,
    title: "Producers Upload WAVs",
    description: "Drag & drop upload with automatic file validation. Max 100MB, WAV format only.",
    icon: Upload,
  },
  {
    step: 4,
    title: "AI Analyzes Every Track",
    description: "BPM, LUFS, phase correlation, and musical key extracted automatically. Results in seconds.",
    icon: BarChart3,
  },
  {
    step: 5,
    title: "Review & Respond",
    description: "Approved tracks get MP3 previews. Send templated or AI-generated emails to producers directly from the CRM.",
    icon: Mail,
  },
];

function Upload({ className }: { className?: string }) {
  return (
    <svg className={className} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" x2="12" y1="3" y2="15" />
    </svg>
  );
}

const PRICING = [
  {
    name: "Boutique",
    price: "$29",
    period: "/mo",
    description: "For independent labels and small imprints.",
    features: [
      "1 label",
      "50 submissions/month",
      "Sonic signature config",
      "Auto-rejection rules",
      "Email templates",
      "MP3 preview generation",
    ],
    cta: "Start Free Trial",
    highlighted: false,
  },
  {
    name: "Label Pro",
    price: "$79",
    period: "/mo",
    description: "For established labels with high submission volume.",
    features: [
      "Up to 5 labels",
      "Unlimited submissions",
      "Everything in Boutique",
      "AI email generation",
      "Priority audio analysis",
      "Custom branding",
      "API access",
    ],
    cta: "Start Free Trial",
    highlighted: true,
  },
];

export default function Home() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Navbar */}
      <header className="fixed top-0 z-50 w-full border-b border-border/50 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-6">
          <span className="font-display text-lg font-bold tracking-tight">
            True Peak <span className="text-accent">AI</span>
          </span>
          <nav className="hidden items-center gap-6 md:flex">
            <a href="#features" className="text-sm text-muted hover:text-foreground transition-colors">Features</a>
            <a href="#workflow" className="text-sm text-muted hover:text-foreground transition-colors">Workflow</a>
            <a href="#pricing" className="text-sm text-muted hover:text-foreground transition-colors">Pricing</a>
            <Button size="sm" onClick={() => window.location.href = "/dashboard/inbox"}>Dashboard</Button>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="relative pt-32 pb-20 px-6">
        {/* Background gradient */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -top-40 left-1/2 -translate-x-1/2 h-[500px] w-[800px] rounded-full bg-accent/5 blur-3xl" />
        </div>

        <div className="mx-auto max-w-7xl relative">
          <div className="grid gap-12 lg:grid-cols-2 lg:gap-16 items-center">
            {/* Left: Copy */}
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/5 px-3 py-1 text-xs font-medium text-accent mb-6">
                <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
                Now in Beta
              </div>
              <h1 className="font-display text-4xl font-bold leading-tight tracking-tight sm:text-5xl lg:text-6xl">
                Dejá de escuchar{" "}
                <span className="text-accent">demos malos.</span>
                <br />
                Automatizá tu A&R.
              </h1>
              <p className="mt-6 text-lg text-muted max-w-lg">
                True Peak AI filters incoming demos by your label's sonic signature. Configure thresholds once, get a unique submission link, and only review tracks that pass your standards.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Button size="lg" className="gap-2" onClick={() => window.location.href = "/dashboard/inbox"}>
                    Start Free Trial <ArrowRight className="h-4 w-4" />
                  </Button>
                  <Button size="lg" variant="outline" onClick={() => document.querySelector("#workflow")?.scrollIntoView({ behavior: "smooth" })}>
                    See How It Works
                  </Button>
              </div>
              <div className="mt-8 flex items-center gap-6 text-sm text-muted">
                <div className="flex items-center gap-1.5">
                  <Check className="h-4 w-4 text-accent" />
                  No credit card
                </div>
                <div className="flex items-center gap-1.5">
                  <Check className="h-4 w-4 text-accent" />
                  14-day trial
                </div>
                <div className="flex items-center gap-1.5">
                  <Check className="h-4 w-4 text-accent" />
                  Cancel anytime
                </div>
              </div>
            </div>

            {/* Right: Demo Simulation */}
            <div className="relative">
              <DemoSimulation />
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="py-20 px-6 border-t border-border/50">
        <div className="mx-auto max-w-7xl">
          <div className="text-center mb-12">
            <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
              Built for <span className="text-accent">serious labels</span>
            </h2>
            <p className="mt-3 text-muted max-w-2xl mx-auto">
              Three pillars that transform your demo review process from hours of listening to minutes of decision-making.
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-3">
            {FEATURES.map((feature) => (
              <Card key={feature.title} className="group border-border bg-surface hover:border-accent/30 transition-colors">
                <CardHeader>
                  <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10 text-accent group-hover:bg-accent/20 transition-colors">
                    <feature.icon className="h-5 w-5" />
                  </div>
                  <CardTitle className="text-lg">{feature.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription className="text-sm text-muted/80">
                    {feature.description}
                  </CardDescription>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Workflow */}
      <section id="workflow" className="py-20 px-6 border-t border-border/50">
        <div className="mx-auto max-w-7xl">
          <div className="text-center mb-16">
            <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
              From upload to <span className="text-accent">decision</span> in 5 steps
            </h2>
            <p className="mt-3 text-muted max-w-2xl mx-auto">
              A streamlined workflow that eliminates the noise and surfaces only the tracks worth your time.
            </p>
          </div>

          <div className="grid gap-8 md:grid-cols-5">
            {WORKFLOW_STEPS.map((step, i) => (
              <div key={step.step} className="relative text-center">
                {/* Connector line */}
                {i < WORKFLOW_STEPS.length - 1 && (
                  <div className="hidden md:block absolute top-8 left-[60%] right-[-40%] h-px bg-border" />
                )}
                <div className="relative mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-surface border border-border">
                  <step.icon className="h-6 w-6 text-accent" />
                  <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-accent text-xs font-bold text-background">
                    {step.step}
                  </span>
                </div>
                <h3 className="font-display text-sm font-semibold text-foreground">{step.title}</h3>
                <p className="mt-2 text-xs text-muted">{step.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="py-20 px-6 border-t border-border/50">
        <div className="mx-auto max-w-4xl">
          <div className="text-center mb-12">
            <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
              Simple <span className="text-accent">pricing</span>
            </h2>
            <p className="mt-3 text-muted">
              Start free. Upgrade when you're ready.
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            {PRICING.map((plan) => (
              <Card
                key={plan.name}
                className={cn(
                  "relative border-border bg-surface",
                  plan.highlighted && "border-accent/50 shadow-lg shadow-accent/5"
                )}
              >
                {plan.highlighted && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-accent px-3 py-0.5 text-xs font-semibold text-background">
                    Most Popular
                  </div>
                )}
                <CardHeader>
                  <CardTitle className="text-xl">{plan.name}</CardTitle>
                  <CardDescription>{plan.description}</CardDescription>
                  <div className="mt-4">
                    <span className="font-display text-4xl font-bold text-foreground">{plan.price}</span>
                    <span className="text-muted">{plan.period}</span>
                  </div>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2.5">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex items-center gap-2 text-sm text-muted">
                        <Check className="h-4 w-4 shrink-0 text-accent" />
                        {feature}
                      </li>
                    ))}
                  </ul>
                  <Button className="mt-6 w-full" variant={plan.highlighted ? "default" : "outline"}>
                    {plan.cta}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/50 py-12 px-6">
        <div className="mx-auto max-w-7xl flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="font-display text-sm font-bold text-muted">
            True Peak <span className="text-accent">AI</span>
          </div>
          <div className="flex items-center gap-6 text-sm text-muted">
            <a href="#features" className="hover:text-foreground transition-colors">Features</a>
            <a href="#pricing" className="hover:text-foreground transition-colors">Pricing</a>
            <a href="/s/demo-label" className="hover:text-foreground transition-colors">Demo Link</a>
          </div>
          <p className="text-xs text-muted/60">
            © 2026 True Peak AI. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}

function cn(...classes: (string | undefined | false | null)[]) {
  return classes.filter(Boolean).join(" ");
}
