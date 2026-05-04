"use client";

import { useState, useCallback } from "react";
import { uploadWav } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Upload, CheckCircle, XCircle, Loader2, Music } from "lucide-react";
import { cn } from "@/lib/utils";

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

type UploadState = "idle" | "uploading" | "success" | "error";

export default function SubmissionPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const [slug, setSlug] = useState<string>("");
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [progress, setProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  // Form fields
  const [producerName, setProducerName] = useState("");
  const [producerEmail, setProducerEmail] = useState("");
  const [trackTitle, setTrackTitle] = useState("");
  const [message, setMessage] = useState("");

  // Resolve params
  useState(() => {
    params.then((p) => setSlug(p.slug));
  });

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const files = e.dataTransfer.files;
    if (files && files[0]) {
      handleFileSelect(files[0]);
    }
  }, []);

  const handleFileSelect = (file: File) => {
    if (!file.name.toLowerCase().endsWith(".wav")) {
      setErrorMessage("Only WAV files are accepted.");
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setErrorMessage(`File too large. Maximum size is 100MB. Your file is ${(file.size / 1024 / 1024).toFixed(1)}MB.`);
      return;
    }
    setErrorMessage("");
    setSelectedFile(file);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFileSelect(e.target.files[0]);
    }
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedFile || !producerName || !producerEmail || !trackTitle) {
      setErrorMessage("Please fill in all required fields and select a file.");
      return;
    }

    setUploadState("uploading");
    setProgress(0);

    // Simulate progress
    const progressInterval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 90) {
          clearInterval(progressInterval);
          return 90;
        }
        return prev + Math.random() * 15;
      });
    }, 300);

    try {
      await uploadWav(selectedFile, producerName, producerEmail, trackTitle, message || undefined);
      clearInterval(progressInterval);
      setProgress(100);
      setUploadState("success");
    } catch (err) {
      clearInterval(progressInterval);
      setUploadState("error");
      setErrorMessage(err instanceof Error ? err.message : "Upload failed. Please try again.");
    }
  }

  if (uploadState === "success") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6">
        <div className="w-full max-w-md text-center">
          <CheckCircle className="mx-auto h-16 w-16 text-accent" />
          <h1 className="mt-6 font-display text-2xl font-bold text-foreground">Demo Received!</h1>
          <p className="mt-2 text-muted">
            Your track <span className="font-medium text-foreground">"{trackTitle}"</span> has been submitted successfully.
          </p>
          <p className="mt-4 text-sm text-muted">
            The label team will review your submission and get back to you at{" "}
            <span className="text-foreground">{producerEmail}</span>.
          </p>
          <Button
            variant="outline"
            className="mt-8"
            onClick={() => {
              setUploadState("idle");
              setSelectedFile(null);
              setProducerName("");
              setProducerEmail("");
              setTrackTitle("");
              setMessage("");
              setProgress(0);
            }}
          >
            Submit Another Track
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 py-12">
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-accent/10">
            <Music className="h-6 w-6 text-accent" />
          </div>
          <h1 className="font-display text-3xl font-bold tracking-tight text-foreground">
            Submit Your Demo
          </h1>
          <p className="mt-2 text-muted">
            Upload your WAV file for review. No registration required.
          </p>
        </div>

        {/* Technical Requirements */}
        <div className="mb-6 grid grid-cols-3 gap-3 text-xs font-mono">
          <div className="rounded-lg border border-border bg-surface p-3 text-center">
            <span className="text-muted">BPM Range</span>
            <p className="mt-0.5 text-foreground">120 — 130</p>
          </div>
          <div className="rounded-lg border border-border bg-surface p-3 text-center">
            <span className="text-muted">LUFS Target</span>
            <p className="mt-0.5 text-foreground">-14 ± 2</p>
          </div>
          <div className="rounded-lg border border-border bg-surface p-3 text-center">
            <span className="text-muted">Max Size</span>
            <p className="mt-0.5 text-foreground">100 MB</p>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* File Upload */}
          <div
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            className={cn(
              "relative rounded-lg border-2 border-dashed p-8 text-center transition-colors",
              dragActive
                ? "border-accent bg-accent/5"
                : selectedFile
                  ? "border-accent/50 bg-accent/5"
                  : "border-border hover:border-muted"
            )}
          >
            <input
              type="file"
              accept=".wav"
              onChange={handleFileInput}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              disabled={uploadState === "uploading"}
            />
            {selectedFile ? (
              <div>
                <CheckCircle className="mx-auto h-8 w-8 text-accent" />
                <p className="mt-2 text-sm font-medium text-foreground">{selectedFile.name}</p>
                <p className="text-xs text-muted">{(selectedFile.size / 1024 / 1024).toFixed(1)} MB</p>
              </div>
            ) : (
              <div>
                <Upload className="mx-auto h-8 w-8 text-muted" />
                <p className="mt-2 text-sm font-medium text-foreground">
                  Drag & drop your WAV file here
                </p>
                <p className="text-xs text-muted">or click to browse · Max 100MB</p>
              </div>
            )}
          </div>

          {/* Upload Progress */}
          {uploadState === "uploading" && (
            <div className="rounded-lg border border-border bg-surface p-3">
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="text-muted">Uploading...</span>
                <span className="font-mono text-foreground">{Math.round(progress)}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-surface2">
                <div
                  className="h-full rounded-full bg-accent transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          {/* Error */}
          {errorMessage && uploadState !== "uploading" && (
            <div className="flex items-center gap-2 rounded-lg border border-red/30 bg-red/5 p-3 text-sm text-red">
              <XCircle className="h-4 w-4 shrink-0" />
              {errorMessage}
            </div>
          )}

          {/* Fields */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">Your Name *</label>
              <Input
                value={producerName}
                onChange={(e) => setProducerName(e.target.value)}
                placeholder="Producer name"
                disabled={uploadState === "uploading"}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">Email *</label>
              <Input
                type="email"
                value={producerEmail}
                onChange={(e) => setProducerEmail(e.target.value)}
                placeholder="producer@email.com"
                disabled={uploadState === "uploading"}
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted">Track Title *</label>
            <Input
              value={trackTitle}
              onChange={(e) => setTrackTitle(e.target.value)}
              placeholder="Your track name"
              disabled={uploadState === "uploading"}
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted">Message (optional)</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Tell us about your track..."
              rows={3}
              className="flex w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent disabled:opacity-50"
              disabled={uploadState === "uploading"}
            />
          </div>

          <Button
            type="submit"
            disabled={uploadState === "uploading" || !selectedFile}
            className="w-full gap-2"
          >
            {uploadState === "uploading" ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Uploading...
              </>
            ) : (
              <>
                <Upload className="h-4 w-4" />
                Submit Demo
              </>
            )}
          </Button>
        </form>
      </div>
    </div>
  );
}
