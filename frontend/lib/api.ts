const BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// --- Helpers ---

interface ApiOptions extends RequestInit {
  headers?: Record<string, string>;
}

async function request<T>(
  path: string,
  options: ApiOptions = {}
): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...options.headers,
  };

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({
      detail: response.statusText,
    }));
    throw new Error(error.detail ?? `API error: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

// --- Types ---

export interface UploadResponse {
  submission_id: number;
  status: string;
  analysis: {
    bpm: number;
    lufs: number;
    true_peak: number;
    phase_correlation: number;
    duration: number;
    musical_key: string;
  };
}

export interface Submission {
  id: number;
  label_id: number;
  producer_name: string;
  producer_email: string;
  track_title: string;
  message: string | null;
  status: "pending" | "accepted" | "rejected";
  bpm: number | null;
  lufs: number | null;
  true_peak: number | null;
  phase_correlation: number | null;
  musical_key: string | null;
  duration: number | null;
  mp3_path: string | null;
  created_at: string;
}

export interface LabelConfig {
  id: number;
  slug: string;
  name: string;
  owner_email: string;
  bpm_min: number;
  bpm_max: number;
  lufs_target: number;
  lufs_tolerance: number;
  phase_correlation_min: number;
}

export interface EmailTemplate {
  id: number;
  label_id: number;
  template_type: string;
  subject: string;
  body: string;
  use_llm: boolean;
}

export interface GenerateEmailResponse {
  subject: string;
  body: string;
  is_draft: boolean;
}

export interface SendEmailResponse {
  success: boolean;
  message_id: string;
}

export interface LoginResponse {
  access_token: string;
  token_type: string;
  label_id: number;
}

// --- API Functions ---

/**
 * Upload a WAV file for analysis.
 * Uses FormData for multipart upload.
 */
export async function uploadWav(
  file: File,
  producerName: string,
  producerEmail: string,
  trackTitle: string,
  message?: string
): Promise<UploadResponse> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("producer_name", producerName);
  formData.append("producer_email", producerEmail);
  formData.append("track_title", trackTitle);
  if (message) formData.append("message", message);

  const response = await fetch(`${BASE_URL}/api/upload`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({
      detail: response.statusText,
    }));
    throw new Error(error.detail ?? `Upload failed: ${response.status}`);
  }

  return response.json() as Promise<UploadResponse>;
}

/**
 * Get all submissions for a label, optionally filtered by status.
 */
export async function getSubmissions(
  labelId: string,
  status?: "pending" | "accepted" | "rejected"
): Promise<Submission[]> {
  const params = new URLSearchParams({ label_id: labelId });
  if (status) params.set("status", status);

  return request<Submission[]>(`/api/submissions?${params.toString()}`);
}

/**
 * Update the status of a submission (accept/reject).
 */
export async function updateSubmissionStatus(
  id: number,
  status: "accepted" | "rejected"
): Promise<Submission> {
  return request<Submission>(`/api/submissions/${id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}

/**
 * Get the sonic signature config for a label.
 */
export async function getLabelConfig(slug: string): Promise<LabelConfig> {
  return request<LabelConfig>(`/api/labels/${slug}/config`);
}

/**
 * Update the sonic signature config for a label.
 */
export async function updateLabelConfig(
  slug: string,
  config: Partial<LabelConfig>
): Promise<LabelConfig> {
  return request<LabelConfig>(`/api/labels/${slug}/config`, {
    method: "PUT",
    body: JSON.stringify(config),
  });
}

/**
 * Send an email via Resend.
 */
export async function sendEmail(
  to: string,
  subject: string,
  body: string
): Promise<SendEmailResponse> {
  return request<SendEmailResponse>("/api/email/send", {
    method: "POST",
    body: JSON.stringify({ to, subject, body }),
  });
}

/**
 * Generate an email draft using LLM personalization.
 */
export async function generateEmailDraft(
  submissionId: number,
  templateType: string,
  customNotes?: string
): Promise<GenerateEmailResponse> {
  return request<GenerateEmailResponse>("/api/email/generate", {
    method: "POST",
    body: JSON.stringify({
      submission_id: submissionId,
      template_type: templateType,
      ...(customNotes && { custom_notes: customNotes }),
    }),
  });
}

/**
 * Get all email templates for a label.
 */
export async function getTemplates(labelId: number): Promise<EmailTemplate[]> {
  return request<EmailTemplate[]>(`/api/email/templates?label_id=${labelId}`);
}

/**
 * Create a new email template.
 */
export async function createTemplate(
  labelId: number,
  template: Omit<EmailTemplate, "id" | "label_id">
): Promise<EmailTemplate> {
  return request<EmailTemplate>(`/api/email/templates?label_id=${labelId}`, {
    method: "POST",
    body: JSON.stringify({ label_id: labelId, ...template }),
  });
}

/**
 * Login a label owner and receive a JWT token.
 */
export async function loginLabel(
  email: string,
  password: string
): Promise<LoginResponse> {
  return request<LoginResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}
