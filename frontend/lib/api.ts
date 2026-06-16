const BASE_URL = process.env.NEXT_PUBLIC_API_URL || "";
import { supabase } from "./supabase";

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

  // Inject JWT token from Supabase if available
  if (typeof window !== "undefined") {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (token && !headers["Authorization"]) {
      headers["Authorization"] = `Bearer ${token}`;
    }
  }

  const response = await fetch(url, {
    ...options,
    headers,
    credentials: "include", // always send cookies
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({
      detail: response.statusText,
    }));
    const err = new Error(error.detail ?? `API error: ${response.status}`);
    (err as any).status = response.status;
    throw err;
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
  id: string;
  template_type: string;
  subject: string;
  body: string;
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

export interface BillingDetails {
  plan: string;
  status: string;
  next_billing_date: string | null;
  amount: number | null;
  currency: string | null;
}

export interface PortalResponse {
  url: string;
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
 * Get billing details for a label.
 */
export async function getBillingDetails(slug: string): Promise<BillingDetails> {
  return request<BillingDetails>(`/vercel-api/billing`);
}

/**
 * Create a Polar Customer Portal session.
 */
export async function createPortalSession(slug: string): Promise<PortalResponse> {
  return request<PortalResponse>(`/vercel-api/portal`, {
    method: "POST",
  });
}

export async function cancelSubscription(slug: string): Promise<{ status: string; message: string }> {
  return request<{ status: string; message: string }>(`/vercel-api/cancel`, {
    method: "POST",
  });
}

export async function updateSubscription(slug: string, newPlan: string): Promise<{ status: string; message: string }> {
  return request<{ status: string; message: string }>(`/vercel-api/update`, {
    method: "POST",
    body: JSON.stringify({ new_plan: newPlan }),
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
 * Get fixed email templates (rejection and approval).
 */
export async function getTemplates(): Promise<EmailTemplate[]> {
  return request<EmailTemplate[]>("/api/email/templates");
}

/**
 * Get secure user details (requires valid Supabase JWT).
 */
export async function getMe(): Promise<any> {
  return request<any>("/api/labels/me/secure");
}

export interface Notification {
  id: string;
  title: string;
  message: string;
  created_at: string;
  read: boolean;
}

export async function getNotifications(): Promise<Notification[]> {
  return request<Notification[]>("/api/labels/me/notifications");
}

export async function markNotificationsAsRead(): Promise<{ status: string }> {
  return request<{ status: string }>("/api/labels/me/notifications/read", {
    method: "POST",
  });
}

// --- Waitlist and App Mode APIs ---

export interface WaitlistEntry {
  id: string;
  email: string;
  created_at: string;
  source: string;
  plan_interest?: string;  // "free", "indie", "pro" - which plan they clicked
}

export interface AppModeResponse {
  mode: "beta" | "prod";
}

export interface WaitlistResponse {
  total: number;
  entries: WaitlistEntry[];
}

/**
 * Join the waitlist (Public)
 */
export async function joinWaitlist(email: string): Promise<{ status: string }> {
  const response = await fetch(`${BASE_URL}/api/waitlist`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, company: "" }), // company is empty for honeypot
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({
      detail: response.statusText,
    }));
    throw new Error(error.detail ?? `Waitlist signup failed: ${response.status}`);
  }

  return response.json() as Promise<{ status: string }>;
}

/**
 * Get current application mode (Public)
 */
export async function getAppMode(): Promise<AppModeResponse> {
  const response = await fetch(`${BASE_URL}/api/config/app-mode`, {
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch app mode: ${response.status}`);
  }
  return response.json() as Promise<AppModeResponse>;
}

/**
 * Update application mode (Admin)
 */
export async function updateAppMode(
  mode: "beta" | "prod",
  adminPassword: string
): Promise<{ status: string; mode: "beta" | "prod" }> {
  const response = await fetch(`${BASE_URL}/api/config/app-mode`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "X-Admin-Password": adminPassword,
    },
    body: JSON.stringify({ mode }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({
      detail: response.statusText,
    }));
    throw new Error(error.detail ?? `Failed to update mode: ${response.status}`);
  }

  return response.json() as Promise<{ status: string; mode: "beta" | "prod" }>;
}

/**
 * Get waitlist entries (Admin, Paginated)
 */
export async function getWaitlist(
  adminPassword: string,
  page: number = 1,
  perPage: number = 20
): Promise<WaitlistResponse> {
  const params = new URLSearchParams({
    page: page.toString(),
    per_page: perPage.toString(),
  });
  const response = await fetch(`${BASE_URL}/api/admin/waitlist?${params.toString()}`, {
    headers: {
      "X-Admin-Password": adminPassword,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({
      detail: response.statusText,
    }));
    throw new Error(error.detail ?? `Failed to fetch waitlist: ${response.status}`);
  }

  return response.json() as Promise<WaitlistResponse>;
}

/**
 * Export waitlist entries as CSV file blob (Admin)
 */
export async function exportWaitlistCsv(adminPassword: string): Promise<Blob> {
  const response = await fetch(`${BASE_URL}/api/admin/waitlist/export`, {
    headers: {
      "X-Admin-Password": adminPassword,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({
      detail: response.statusText,
    }));
    throw new Error(error.detail ?? `Failed to export waitlist: ${response.status}`);
  }

  return response.blob();
}

export interface AdminUser {
  id: string;
  name: string;
  slug: string;
  email: string;
  plan: string;
  status: string;
  created_at: string;
  track_limit: number;
  email_limit: number;
  hq_retention_days: number;
  role: string;
  total_submissions: number;
  last_submission_at: string | null;
}

/**
 * Get all labels / users (Admin)
 */
export async function getAdminUsers(adminPassword: string): Promise<AdminUser[]> {
  const response = await fetch(`${BASE_URL}/api/admin/users`, {
    headers: {
      "X-Admin-Password": adminPassword,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({
      detail: response.statusText,
    }));
    throw new Error(error.detail ?? `Failed to fetch users: ${response.status}`);
  }

  return response.json() as Promise<AdminUser[]>;
}

/**
 * Update user subscription plan and/or status (Admin)
 */
export async function updateUserStatus(
  userId: string,
  statusUpdate: { plan?: string; subscription_status?: string },
  adminPassword: string
): Promise<{
  id: string;
  plan: string;
  subscription_status: string;
  frozen_at: string | null;
  track_limit: number;
  email_limit: number;
  hq_retention_days: number;
  supabase_sync_ok: boolean;
}> {
  const response = await fetch(`${BASE_URL}/api/admin/users/${userId}/status`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "X-Admin-Password": adminPassword,
    },
    body: JSON.stringify(statusUpdate),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({
      detail: response.statusText,
    }));
    throw new Error(error.detail ?? `Failed to update user status: ${response.status}`);
  }

  return response.json() as Promise<any>;
}

export interface AdminActivityResponse {
  total_submissions: number;
  last_submission_at: string | null;
  emails_sent_this_month: number;
  max_emails_month: number;
}

export interface RecentActivityEntry {
  id: string;
  label_id: string;
  producer_name: string;
  track_title: string;
  status: string;
  created_at: string | null;
}

export interface RecentActivityResponse {
  total: number;
  page: number;
  per_page: number;
  entries: RecentActivityEntry[];
}

/**
 * Get activity metrics for a single label (Admin)
 */
export async function getAdminActivity(
  labelId: string,
  adminPassword: string
): Promise<AdminActivityResponse> {
  const response = await fetch(
    `${BASE_URL}/api/admin/activity?label_id=${encodeURIComponent(labelId)}`,
    {
      headers: {
        "X-Admin-Password": adminPassword,
      },
    }
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({
      detail: response.statusText,
    }));
    throw new Error(error.detail ?? `Failed to fetch activity: ${response.status}`);
  }

  return response.json() as Promise<AdminActivityResponse>;
}

/**
 * Get recent submissions across all labels, paginated (Admin)
 */
export async function getRecentActivity(
  page: number = 1,
  perPage: number = 20,
  adminPassword: string
): Promise<RecentActivityResponse> {
  const params = new URLSearchParams({
    page: page.toString(),
    per_page: perPage.toString(),
  });
  const response = await fetch(
    `${BASE_URL}/api/admin/recent-activity?${params.toString()}`,
    {
      headers: {
        "X-Admin-Password": adminPassword,
      },
    }
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({
      detail: response.statusText,
    }));
    throw new Error(error.detail ?? `Failed to fetch recent activity: ${response.status}`);
  }

  return response.json() as Promise<RecentActivityResponse>;
}




