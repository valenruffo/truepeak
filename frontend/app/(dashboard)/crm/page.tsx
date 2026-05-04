"use client";

import { useState, useEffect, useCallback } from "react";
import { appStore } from "@/lib/store";
import { getSubmissions, generateEmailDraft, sendEmail, type Submission } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { Loader2, Send, Sparkles, User } from "lucide-react";
import { cn } from "@/lib/utils";

interface EmailTemplate {
  id: string;
  label: string;
  type: string;
  subject: string;
  body: string;
}

const TEMPLATES: EmailTemplate[] = [
  {
    id: "rejection-phase",
    label: "Rejection — Phase",
    type: "rejection-phase",
    subject: "About your submission: {track}",
    body: "Hi {producer},\n\nThank you for sending us \"{track}\". Unfortunately, the track didn't meet our phase correlation requirements. We're looking for tracks with strong stereo imaging and phase coherence.\n\nKeep producing and don't hesitate to send us your next track.\n\nBest,\nThe Team",
  },
  {
    id: "rejection-tempo",
    label: "Rejection — Tempo",
    type: "rejection-tempo",
    subject: "About your submission: {track}",
    body: "Hi {producer},\n\nThanks for sharing \"{track}\" with us. The track is at {bpm} BPM, which falls outside our current sonic signature range. We're specifically looking for tracks within our target tempo window.\n\nWe appreciate your submission and hope to hear from you again.\n\nBest,\nThe Team",
  },
  {
    id: "approval",
    label: "Approval",
    type: "approval",
    subject: "Your track \"{track}\" has been approved!",
    body: "Hi {producer},\n\nGreat news! Your track \"{track}\" has been approved by our team. The technical analysis shows it meets all our sonic signature requirements.\n\nWe'll be in touch with next steps regarding the release.\n\nCongratulations!\nThe Team",
  },
  {
    id: "followup",
    label: "Follow-up",
    type: "followup",
    subject: "Following up on your submission",
    body: "Hi {producer},\n\nJust wanted to follow up on your recent submission \"{track}\". We're still reviewing it and will get back to you soon.\n\nThanks for your patience.\n\nBest,\nThe Team",
  },
];

// Mock contacts derived from submissions
const MOCK_SUBMISSIONS: Submission[] = [
  {
    id: 1, label_id: 1, producer_name: "Alex Rivera", producer_email: "alex@email.com",
    track_title: "Midnight Protocol", message: null, status: "pending",
    bpm: 128.4, lufs: -13.2, true_peak: -1.2, phase_correlation: 0.85,
    duration: 245, mp3_path: null, created_at: "2026-05-04T10:30:00Z",
  },
  {
    id: 2, label_id: 1, producer_name: "Sarah Chen", producer_email: "sarah@email.com",
    track_title: "Neon Dreams", message: null, status: "accepted",
    bpm: 125.0, lufs: -14.1, true_peak: -0.8, phase_correlation: 0.92,
    duration: 312, mp3_path: "/data/mp3s/uuid-2.mp3", created_at: "2026-05-03T15:20:00Z",
  },
  {
    id: 3, label_id: 1, producer_name: "DJ Kroma", producer_email: "kroma@email.com",
    track_title: "Bass Drop Vol.3", message: null, status: "rejected",
    bpm: 140.2, lufs: -6.5, true_peak: 0.3, phase_correlation: -0.15,
    duration: 198, mp3_path: null, created_at: "2026-05-02T08:45:00Z",
  },
  {
    id: 4, label_id: 1, producer_name: "Luna Wave", producer_email: "luna@email.com",
    track_title: "Ethereal Pulse", message: null, status: "pending",
    bpm: 122.8, lufs: -15.0, true_peak: -2.1, phase_correlation: 0.78,
    duration: 278, mp3_path: null, created_at: "2026-05-04T12:00:00Z",
  },
];

function getContactStatus(sub: Submission): string {
  switch (sub.status) {
    case "accepted": return "Approved";
    case "rejected": return "Rejected";
    default: return "Pending";
  }
}

function getStatusColor(status: string): string {
  switch (status) {
    case "Approved": return "text-accent";
    case "Rejected": return "text-red";
    default: return "text-cyan";
  }
}

export default function CRMPage() {
  const { addToast } = useToast();
  const submissions = appStore((s) => s.submissions);
  const setSubmissions = appStore((s) => s.setSubmissions);

  const [contacts, setContacts] = useState<Submission[]>([]);
  const [selectedContact, setSelectedContact] = useState<Submission | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<EmailTemplate | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [sendStatus, setSendStatus] = useState<"idle" | "sent" | "error">("idle");

  const loadContacts = useCallback(async () => {
    try {
      const data = await getSubmissions("1");
      setContacts(data);
      setSubmissions(data);
    } catch {
      setContacts(MOCK_SUBMISSIONS);
    }
  }, [setSubmissions]);

  useEffect(() => {
    loadContacts();
  }, [loadContacts]);

  function selectTemplate(template: EmailTemplate) {
    setSelectedTemplate(template);
    if (selectedContact) {
      const vars = {
        producer: selectedContact.producer_name,
        track: selectedContact.track_title,
        bpm: selectedContact.bpm?.toFixed(1) ?? "—",
      };
      let filledSubject = template.subject;
      let filledBody = template.body;
      for (const [key, value] of Object.entries(vars)) {
        filledSubject = filledSubject.replace(new RegExp(`\\{${key}\\}`, "g"), value);
        filledBody = filledBody.replace(new RegExp(`\\{${key}\\}`, "g"), value);
      }
      setSubject(filledSubject);
      setBody(filledBody);
    } else {
      setSubject(template.subject);
      setBody(template.body);
    }
    setSendStatus("idle");
  }

  async function handleGenerateAI() {
    if (!selectedContact) {
      addToast({ title: "No contact selected", description: "Select a producer first.", variant: "destructive" });
      return;
    }
    setGenerating(true);
    try {
      const draft = await generateEmailDraft(
        selectedContact.id,
        selectedTemplate?.type ?? "rejection-phase"
      );
      setSubject(draft.subject);
      setBody(draft.body);
      addToast({ title: "AI draft generated", description: "Review and edit before sending.", variant: "success" });
    } catch {
      // Fallback: use template with variables
      if (selectedTemplate && selectedContact) {
        selectTemplate(selectedTemplate);
      }
      addToast({ title: "AI generation unavailable", description: "Using template fallback.", variant: "default" });
    } finally {
      setGenerating(false);
    }
  }

  async function handleSend() {
    if (!selectedContact || !subject || !body) return;
    setSending(true);
    try {
      await sendEmail(selectedContact.producer_email, subject, body);
      setSendStatus("sent");
      addToast({ title: "Email sent", description: `Sent to ${selectedContact.producer_email}`, variant: "success" });
    } catch {
      setSendStatus("error");
      addToast({ title: "Send failed", description: "Could not send email. Check API configuration.", variant: "destructive" });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex h-[calc(100vh-3.5rem)]">
      {/* Left Sidebar — Contacts */}
      <div className="w-72 border-r border-border bg-surface flex flex-col">
        <div className="p-4 border-b border-border">
          <h3 className="font-display text-sm font-semibold text-foreground">Contacts</h3>
          <p className="text-xs text-muted">{contacts.length} producers</p>
        </div>
        <div className="flex-1 overflow-y-auto">
          {contacts.map((contact) => (
            <button
              key={contact.id}
              onClick={() => {
                setSelectedContact(contact);
                setSendStatus("idle");
              }}
              className={cn(
                "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface2/50 border-b border-border/50",
                selectedContact?.id === contact.id && "bg-surface2"
              )}
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface2 text-xs font-medium text-muted">
                <User className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{contact.producer_name}</p>
                <p className="truncate text-xs text-muted">{contact.track_title}</p>
              </div>
              <span className={cn("text-xs font-medium", getStatusColor(getContactStatus(contact)))}>
                {getContactStatus(contact)}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Right Panel — Email Composer */}
      <div className="flex-1 flex flex-col">
        {!selectedContact ? (
          <div className="flex flex-1 items-center justify-center text-center">
            <div>
              <User className="mx-auto h-12 w-12 text-muted/30" />
              <p className="mt-3 font-display text-lg font-semibold text-foreground">Select a contact</p>
              <p className="text-sm text-muted">Choose a producer from the sidebar to compose an email.</p>
            </div>
          </div>
        ) : (
          <>
            {/* Contact header */}
            <div className="border-b border-border bg-surface px-6 py-4">
              <h3 className="font-display text-lg font-semibold text-foreground">
                {selectedContact.producer_name}
              </h3>
              <p className="text-sm text-muted">{selectedContact.producer_email}</p>
              <p className="mt-1 text-xs font-mono text-muted">
                Track: {selectedContact.track_title} · BPM: {selectedContact.bpm?.toFixed(1)} · LUFS: {selectedContact.lufs?.toFixed(1)}
              </p>
            </div>

            {/* Template selector */}
            <div className="border-b border-border px-6 py-3">
              <div className="flex flex-wrap gap-2">
                {TEMPLATES.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => selectTemplate(t)}
                    className={cn(
                      "rounded-md border px-3 py-1.5 text-xs font-medium transition-all",
                      selectedTemplate?.id === t.id
                        ? "border-accent bg-accent/10 text-accent"
                        : "border-border text-muted hover:border-muted hover:text-foreground"
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Composer */}
            <div className="flex-1 flex flex-col p-6 gap-4">
              <Input
                placeholder="Subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="font-medium"
              />
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Email body..."
                className="flex-1 min-h-[200px] resize-none rounded-md border border-border bg-transparent p-3 text-sm text-foreground placeholder:text-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent font-body"
              />

              {/* Actions */}
              <div className="flex items-center justify-between">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleGenerateAI}
                  disabled={generating || !selectedContact}
                  className="gap-1.5"
                >
                  {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  Generate with AI
                </Button>

                <div className="flex items-center gap-3">
                  {sendStatus === "sent" && (
                    <span className="text-xs text-accent font-medium">✓ Sent</span>
                  )}
                  {sendStatus === "error" && (
                    <span className="text-xs text-red font-medium">✗ Failed</span>
                  )}
                  <Button onClick={handleSend} disabled={sending || !subject || !body} className="gap-1.5">
                    {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                    Send Email
                  </Button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
