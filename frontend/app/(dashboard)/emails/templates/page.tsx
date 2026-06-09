"use client";

import { useState, useEffect, useRef } from "react";
import { Mail, Plus, Edit2, Trash2, X, RotateCcw, Loader2 } from "lucide-react";
import { useLanguage } from "@/lib/i18n";

interface EmailTemplate {
  id: string;
  label_id: string;
  name: string;
  template_type: string;
  subject: string;
  body: string;
  is_default?: boolean;
}

interface DefaultTemplate {
  id: string;
  name: string;
  template_type: string;
  subject: string;
  body: string;
}

const variables = [
  { key: "{producer}", label: "Producer" },
  { key: "{track}", label: "Track" },
  { key: "{bpm}", label: "BPM" },
  { key: "{label}", label: "Label" },
  { key: "{lufs}", label: "LUFS" },
  { key: "{phase_correlation}", label: "Phase" },
  { key: "{musical_key}", label: "Key" },
  { key: "{true_peak}", label: "True Peak" },
  { key: "{crest_factor}", label: "Crest" },
  { key: "{duration}", label: "Duration" },
  { key: "{status}", label: "Status" },
  { key: "{rejection_reason}", label: "Reason" },
];

// Strip HTML tags from template body
const stripHtml = (html: string): string => {
  if (!html) return "";
  // Normalize {{variable}} to {variable}
  let text = html.replace(/\{\{(\w+)\}\}/g, '{$1}');
  // Remove HTML tags but keep content
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/p>\s*<p>/gi, "\n\n");
  text = text.replace(/<\/div>\s*<div>/gi, "\n\n");
  text = text.replace(/<\/li>\s*<li>/gi, "\n");
  text = text.replace(/<[^>]*>/g, "");
  // Decode HTML entities
  text = text.replace(/&amp;/g, "&")
             .replace(/&lt;/g, "<")
             .replace(/&gt;/g, ">")
             .replace(/&quot;/g, '"')
             .replace(/&#039;/g, "'")
             .replace(/&nbsp;/g, " ");
  return text.trim();
};

// Render variables as green badges for preview
const renderVariableBadges = (text: string): string => {
  if (!text) return "";
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  // Replace newlines with <br> for proper display, add space around badges
  return escaped.replace(/\{(\w+)\}/g, ' {$1} ').replace(/(\s)\{(\w+)\}(\s)/g, ' <span style="background: rgba(16,185,129,0.15); color: #10b981; border: 1px solid rgba(16,185,129,0.3); padding: 1px 6px; border-radius: 3px; font-size: 0.85em; font-weight: 500; font-family: monospace; white-space: nowrap;">{$2}</span> ');
};

export default function TemplatesPage() {
  const { t, lang } = useLanguage();
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [defaultTemplates, setDefaultTemplates] = useState<DefaultTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingTemplate, setEditingTemplate] = useState<EmailTemplate | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dragOverField, setDragOverField] = useState<"subject" | "body" | null>(null);
  const [dragPosition, setDragPosition] = useState<{ field: "subject" | "body"; y: number } | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);
  const bodyEditorRef = useRef<HTMLDivElement>(null);
  const subjectEditorRef = useRef<HTMLDivElement>(null);
  const [formData, setFormData] = useState({
    name: "",
    template_type: "custom",
    subject_template: "",
    body_template: "",
  });

  useEffect(() => {
    fetchDefaultTemplates().then(() => {
      fetchTemplates();
    });
  }, []);

  const fetchTemplates = async () => {
    try {
      const token = localStorage.getItem("token");
      const res = await fetch("/api/email/templates", {
        credentials: "include",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        const data = await res.json();
        setTemplates(data);
      }
    } catch (err) {
      console.error("Error fetching templates:", err);
    } finally {
      setLoading(false);
    }
  };

  const fetchDefaultTemplates = async () => {
    try {
      const token = localStorage.getItem("token");
      const res = await fetch("/api/email/templates?defaults=true", {
        credentials: "include",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        const data = await res.json();
        setDefaultTemplates(data);
      }
    } catch (err) {
      console.error("Error fetching default templates:", err);
    }
  };

  const isTemplateModified = (template: EmailTemplate): boolean => {
    const defaultTemplate = defaultTemplates.find((d) => d.template_type === template.template_type);
    if (!defaultTemplate) return false;
    // Normalize both for comparison
    const normalize = (text: string) => text.replace(/\{\{(\w+)\}\}/g, '{$1}').trim();
    return normalize(template.subject) !== normalize(defaultTemplate.subject) || 
           normalize(template.body) !== normalize(defaultTemplate.body);
  };

  const handleCreate = () => {
    setFormData({
      name: "",
      template_type: "custom",
      subject_template: "",
      body_template: "",
    });
    setIsCreating(true);
    setEditingTemplate(null);
    // Clear editors after state update
    setTimeout(() => {
      if (subjectEditorRef.current) subjectEditorRef.current.innerHTML = "";
      if (bodyEditorRef.current) bodyEditorRef.current.innerHTML = "";
    }, 0);
  };

  const handleEdit = (template: EmailTemplate) => {
    setFormData({
      name: template.name,
      template_type: template.template_type,
      subject_template: template.subject,
      body_template: template.body,
    });
    setEditingTemplate(template);
    setIsCreating(false);
    // Populate editors with stripped HTML content
    setTimeout(() => {
      if (subjectEditorRef.current) {
        subjectEditorRef.current.innerHTML = renderVariableBadges(stripHtml(template.subject));
      }
      if (bodyEditorRef.current) {
        bodyEditorRef.current.innerHTML = renderVariableBadges(stripHtml(template.body));
      }
    }, 0);
  };

  const handleDelete = async (id: string) => {
    // Don't allow deleting default templates
    const template = templates.find((t) => t.id === id);
    if (template && (template.template_type === "rejection" || template.template_type === "approval")) {
      return;
    }

    setConfirmDialog({
      open: true,
      title: isEn ? "Delete Template" : "Eliminar Plantilla",
      message: isEn ? "Are you sure you want to delete this template? This action cannot be undone." : "¿Estás seguro de que quieres eliminar esta plantilla? Esta acción no se puede deshacer.",
      onConfirm: async () => {
        try {
          const token = localStorage.getItem("token");
          const res = await fetch(`/api/email/templates/${id}`, {
            method: "DELETE",
            credentials: "include",
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          });
          if (res.ok) {
            setTemplates(templates.filter((t) => t.id !== id));
          }
        } catch (err) {
          console.error("Error deleting template:", err);
        }
        setConfirmDialog(null);
      },
    });
  };

  const handleRestore = async (template: EmailTemplate | DefaultTemplate) => {
    setConfirmDialog({
      open: true,
      title: isEn ? "Restore Template" : "Restaurar Plantilla",
      message: isEn
        ? "Restore this template to its original version? Your changes will be lost."
        : "¿Restaurar esta plantilla a su versión original? Se perderán los cambios.",
      onConfirm: async () => {
        try {
          const token = localStorage.getItem("token");
          const original = defaultTemplates.find((d) => d.template_type === template.template_type);
          if (!original) {
            setConfirmDialog(null);
            return;
          }

          // Check if template exists in DB
          const existing = templates.find((t) => t.template_type === template.template_type);

          if (existing) {
            // Update existing template
            const updateRes = await fetch(`/api/email/templates/${existing.id}`, {
              method: "PUT",
              credentials: "include",
              headers: {
                "Content-Type": "application/json",
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
              },
              body: JSON.stringify({
                name: original.name,
                template_type: original.template_type,
                subject_template: original.subject,
                body_template: original.body,
              }),
            });
            if (updateRes.ok) {
              fetchTemplates();
            }
          } else {
            // Create new template (template was deleted entirely)
            const createRes = await fetch(`/api/email/templates`, {
              method: "POST",
              credentials: "include",
              headers: {
                "Content-Type": "application/json",
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
              },
              body: JSON.stringify({
                name: original.name,
                template_type: original.template_type,
                subject_template: original.subject,
                body_template: original.body,
              }),
            });
            if (createRes.ok) {
              fetchTemplates();
            }
          }
        } catch (err) {
          console.error("Error restoring template:", err);
        }
        setConfirmDialog(null);
      },
    });
  };

  const getEditorText = (editorRef: React.RefObject<HTMLDivElement | null>): string => {
    if (!editorRef.current) return "";
    // Extract text content, converting variable badges back to {variable} format
    const html = editorRef.current.innerHTML;
    // Replace badge spans with {variable}
    const text = html.replace(/<span[^>]*data-variable="(\{[^}]+\})"[^>]*>[^<]*<\/span>/g, '$1')
                     .replace(/<span[^>]*>\{(\w+)\}<\/span>/g, '{$1}')
                     .replace(/<br\s*\/?>/gi, "\n")
                     .replace(/<div>/gi, "\n")
                     .replace(/<\/div>/gi, "")
                     .replace(/<[^>]*>/g, "")
                     .replace(/&nbsp;/g, " ")
                     .replace(/&amp;/g, "&")
                     .replace(/&lt;/g, "<")
                     .replace(/&gt;/g, ">");
    return text.trim();
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Get text content from contentEditable editors
      const subjectText = getEditorText(subjectEditorRef);
      const bodyText = getEditorText(bodyEditorRef);
      
      const token = localStorage.getItem("token");
      const url = editingTemplate
        ? `/api/email/templates/${editingTemplate.id}`
        : "/api/email/templates";
      const method = editingTemplate ? "PUT" : "POST";
      
      const res = await fetch(url, {
        method,
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          name: formData.name,
          template_type: formData.template_type,
          subject_template: subjectText,
          body_template: bodyText,
        }),
      });
      
      if (res.ok) {
        const saved = await res.json();
        if (editingTemplate) {
          setTemplates(templates.map((t) => (t.id === saved.id ? saved : t)));
        } else {
          setTemplates([...templates, saved]);
        }
        setIsCreating(false);
        setEditingTemplate(null);
      }
    } catch (err) {
      console.error("Error saving template:", err);
    } finally {
      setSaving(false);
    }
  };

  // Drag & Drop handlers with visual preview
  const handleDragStart = (e: React.DragEvent, variable: string) => {
    e.dataTransfer.setData("text/plain", variable);
    e.dataTransfer.effectAllowed = "copy";
  };

  const handleDragOver = (e: React.DragEvent, field: "subject" | "body", editorRef: React.RefObject<HTMLDivElement | null>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    
    if (editorRef.current) {
      const rect = editorRef.current.getBoundingClientRect();
      const y = e.clientY - rect.top;
      setDragOverField(field);
      setDragPosition({ field, y });
    }
  };

  const handleDragLeave = () => {
    setDragOverField(null);
    setDragPosition(null);
  };

  const handleDrop = (e: React.DragEvent, field: "subject" | "body", editorRef: React.RefObject<HTMLDivElement | null>) => {
    e.preventDefault();
    const variable = e.dataTransfer.getData("text/plain");
    
    if (variable && variables.some(v => v.key === variable) && editorRef.current) {
      // Create badge element
      const span = document.createElement("span");
      span.setAttribute("data-variable", variable);
      span.setAttribute("contenteditable", "false");
      span.style.cssText = "background: rgba(16,185,129,0.15); color: #10b981; border: 1px solid rgba(16,185,129,0.3); padding: 1px 5px; border-radius: 3px; font-size: 0.85em; font-weight: 500; font-family: monospace; display: inline-block; margin: 0 2px;";
      span.textContent = variable;
      
      // Find insertion point based on mouse position
      const range = document.caretRangeFromPoint?.(e.clientX, e.clientY);
      
      if (range) {
        range.insertNode(span);
        // Add space after
        const space = document.createTextNode(" ");
        span.after(space);
        range.setStartAfter(space);
        range.setEndAfter(space);
      } else {
        // Fallback: append to end
        editorRef.current.appendChild(span);
        const space = document.createTextNode(" ");
        span.after(space);
      }
      
      editorRef.current.focus();
    }
    
    setDragOverField(null);
    setDragPosition(null);
  };

  const insertVariable = (variable: string, field: "subject" | "body") => {
    const editorRef = field === "subject" ? subjectEditorRef : bodyEditorRef;
    if (!editorRef.current) return;
    
    editorRef.current.focus();
    
    const span = document.createElement("span");
    span.setAttribute("data-variable", variable);
    span.setAttribute("contenteditable", "false");
    span.style.cssText = "background: rgba(16,185,129,0.15); color: #10b981; border: 1px solid rgba(16,185,129,0.3); padding: 1px 5px; border-radius: 3px; font-size: 0.85em; font-weight: 500; font-family: monospace; display: inline-block; margin: 0 2px;";
    span.textContent = variable;
    
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      if (editorRef.current.contains(range.commonAncestorContainer)) {
        range.insertNode(span);
        const space = document.createTextNode(" ");
        span.after(space);
        range.setStartAfter(space);
        range.setEndAfter(space);
        sel.removeAllRanges();
        sel.addRange(range);
        return;
      }
    }
    
    // Fallback: append to end
    editorRef.current.appendChild(span);
    const space = document.createTextNode(" ");
    span.after(space);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />
      </div>
    );
  }

  const isEn = lang === "en";

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-primary">
            {isEn ? "Email Templates" : "Plantillas de Email"}
          </h1>
          <p className="text-sm text-muted mt-1">
            {isEn 
              ? "Create and manage custom email templates"
              : "Crea y gestiona plantillas personalizadas"}
          </p>
        </div>
        <button
          onClick={handleCreate}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-500 text-black font-medium hover:bg-emerald-600 transition-colors"
        >
          <Plus className="w-4 h-4" />
          {isEn ? "New Template" : "Nueva Plantilla"}
        </button>
      </div>

      {/* Templates Grid - 2 columns */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {templates.map((template) => {
          const isModified = isTemplateModified(template);
          const isDefault = template.template_type === "rejection" || template.template_type === "approval";

          return (
            <div
              key={template.id}
              className="rounded-lg border p-4 hover:border-emerald-500/50 transition-colors"
              style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-sm text-primary">{template.name}</h3>
                  <span
                    className="text-[9px] font-mono px-1.5 py-0.5 rounded"
                    style={{
                      background:
                        template.template_type === "rejection"
                          ? "rgba(239,68,68,0.1)"
                          : template.template_type === "approval"
                          ? "rgba(16,185,129,0.1)"
                          : "rgba(161,161,170,0.1)",
                      color:
                        template.template_type === "rejection"
                          ? "#ef4444"
                          : template.template_type === "approval"
                          ? "#10b981"
                          : "#a1a1aa",
                    }}
                  >
                    {template.template_type}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  {/* Show restore button ONLY if template has been modified */}
                  {isModified && (
                    <button
                      onClick={() => handleRestore(template)}
                      className="p-1.5 rounded hover:bg-white/5 text-muted hover:text-primary transition-colors"
                      title={isEn ? "Restore original" : "Restaurar original"}
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button
                    onClick={() => handleEdit(template)}
                    className="p-1.5 rounded hover:bg-white/5 text-muted hover:text-primary transition-colors"
                    title={isEn ? "Edit" : "Editar"}
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  {/* Only show delete for non-default templates */}
                  {!isDefault && (
                    <button
                      onClick={() => handleDelete(template.id)}
                      className="p-1.5 rounded hover:bg-red-500/10 text-muted hover:text-red-500 transition-colors"
                      title={isEn ? "Delete" : "Eliminar"}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Subject */}
              <div className="mb-2">
                <div className="text-[10px] font-medium text-muted uppercase tracking-wider mb-1">
                  {isEn ? "Subject" : "Asunto"}
                </div>
                <div className="text-xs text-primary">{template.subject}</div>
              </div>

              {/* Body Preview with variable badges */}
              <div>
                <div className="text-[10px] font-medium text-muted uppercase tracking-wider mb-1">
                  {isEn ? "Preview" : "Vista previa"}
                </div>
                <div
                  className="text-xs text-primary p-3 rounded border line-clamp-4"
                  style={{
                    background: "var(--bg-secondary)",
                    borderColor: "var(--border)",
                    lineHeight: "1.7",
                    wordSpacing: "0.05em"
                  }}
                  dangerouslySetInnerHTML={{ __html: renderVariableBadges(stripHtml(template.body)) }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Missing Default Templates - templates that were deleted */}
      {defaultTemplates.length > 0 && defaultTemplates.some(
        (d) => !templates.some((t) => t.template_type === d.template_type)
      ) && (
        <div className="mt-6">
          <h2 className="text-sm font-medium text-muted mb-2">
            {isEn ? "Missing Default Templates" : "Plantillas Default Faltantes"}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {defaultTemplates
              .filter((d) => !templates.some((t) => t.template_type === d.template_type))
              .map((missingTemplate) => (
                <div
                  key={`missing-${missingTemplate.template_type}`}
                  className="rounded-lg border-2 border-dashed p-4 opacity-60"
                  style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-sm text-muted">{missingTemplate.name}</h3>
                      <span
                        className="text-[9px] font-mono px-1.5 py-0.5 rounded"
                        style={{
                          background:
                            missingTemplate.template_type === "rejection"
                              ? "rgba(239,68,68,0.1)"
                              : "rgba(16,185,129,0.1)",
                          color:
                            missingTemplate.template_type === "rejection"
                              ? "#ef4444"
                              : "#10b981",
                        }}
                      >
                        {missingTemplate.template_type} (deleted)
                      </span>
                    </div>
                    <button
                      onClick={() => handleRestore(missingTemplate)}
                      className="p-1.5 rounded hover:bg-white/5 text-muted hover:text-emerald-500 transition-colors"
                      title={isEn ? "Restore this template" : "Restaurar esta plantilla"}
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <p className="text-xs text-muted">
                    {isEn 
                      ? "This default template was deleted. Click the restore icon to recreate it."
                      : "Esta plantilla default fue eliminada. Hacé clic en el ícono para restaurarla."}
                  </p>
                </div>
              ))}
          </div>
        </div>
      )}

      {templates.length === 0 && (
        <div className="text-center py-12 text-muted">
          <Mail className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p className="text-sm">
            {isEn ? "No templates created yet" : "No hay plantillas creadas"}
          </p>
          <p className="text-xs mt-1">
            {isEn ? "Create your first template to get started" : "Crea tu primera plantilla para comenzar"}
          </p>
        </div>
      )}

      {/* Create/Edit Modal */}
      {(isCreating || editingTemplate) && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.8)" }}
          onClick={() => {
            setIsCreating(false);
            setEditingTemplate(null);
          }}
        >
          <div
            className="rounded-lg border max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col"
            style={{ borderColor: "var(--border)", background: "var(--bg-secondary)" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div
              className="flex items-center justify-between px-6 py-4 border-b"
              style={{ borderColor: "var(--border)" }}
            >
              <h2 className="font-semibold text-lg text-primary">
                {editingTemplate 
                  ? (isEn ? "Edit Template" : "Editar Plantilla")
                  : (isEn ? "New Template" : "Nueva Plantilla")}
              </h2>
              <button
                onClick={() => {
                  setIsCreating(false);
                  setEditingTemplate(null);
                }}
                className="p-2 rounded hover:bg-white/5 text-muted hover:text-primary transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="flex-1 overflow-auto p-6 space-y-4">
              {/* Name */}
              <div>
                <label className="text-xs font-medium text-muted block mb-1">
                  {isEn ? "Name" : "Nombre"}
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 rounded border text-sm"
                  style={{ background: "var(--bg-card)", borderColor: "var(--border)", color: "var(--text-primary)" }}
                  placeholder={isEn ? "e.g., Technical Rejection" : "Ej: Rechazo técnico"}
                />
              </div>

              {/* Type */}
              <div>
                <label className="text-xs font-medium text-muted block mb-1">
                  {isEn ? "Type" : "Tipo"}
                </label>
                <select
                  value={formData.template_type}
                  onChange={(e) => setFormData({ ...formData, template_type: e.target.value })}
                  className="w-full px-3 py-2 rounded border text-sm"
                  style={{ background: "var(--bg-card)", borderColor: "var(--border)", color: "var(--text-primary)" }}
                >
                  <option value="custom">Custom</option>
                  <option value="rejection">{isEn ? "Rejection" : "Rechazo"}</option>
                  <option value="approval">{isEn ? "Approval" : "Aprobación"}</option>
                </select>
              </div>

              {/* Subject with contentEditable and drag & drop */}
              <div>
                <label className="text-xs font-medium text-muted block mb-1">
                  {isEn ? "Subject" : "Asunto"}
                </label>
                <div
                  ref={subjectEditorRef}
                  contentEditable
                  suppressContentEditableWarning
                  onDragOver={(e) => handleDragOver(e, "subject", subjectEditorRef)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, "subject", subjectEditorRef)}
                  className="w-full px-3 py-2 rounded border text-sm min-h-[36px] outline-none"
                  style={{ 
                    background: "var(--bg-card)", 
                    borderColor: dragOverField === "subject" ? "#10b981" : "var(--border)", 
                    color: "var(--text-primary)" 
                  }}
                />
              </div>

              {/* Body with contentEditable and drag & drop */}
              <div>
                <label className="text-xs font-medium text-muted block mb-1">
                  {isEn ? "Body" : "Cuerpo"}
                </label>
                <div
                  ref={bodyEditorRef}
                  contentEditable
                  suppressContentEditableWarning
                  onDragOver={(e) => handleDragOver(e, "body", bodyEditorRef)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, "body", bodyEditorRef)}
                  className="w-full px-3 py-2 rounded border text-sm min-h-[150px] outline-none"
                  style={{ 
                    background: "var(--bg-card)", 
                    borderColor: dragOverField === "body" ? "#10b981" : "var(--border)", 
                    color: "var(--text-primary)" 
                  }}
                />
              </div>

              {/* Variable Chips with drag & drop */}
              <div>
                <label className="text-xs font-medium text-muted block mb-2">
                  {isEn ? "Available variables (drag or click to insert)" : "Variables disponibles (arrastrá o hacé clic para insertar)"}
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {variables.map((v) => (
                    <span
                      key={v.key}
                      draggable
                      onDragStart={(e) => handleDragStart(e, v.key)}
                      onClick={() => insertVariable(v.key, dragOverField || "body")}
                      className="text-[10px] px-2 py-1 rounded border cursor-grab active:cursor-grabbing hover:border-emerald-500 hover:bg-emerald-500/5 transition-colors select-none"
                      style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
                      title={`Insert ${v.label}`}
                    >
                      +{v.label}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div
              className="flex items-center justify-end gap-2 px-6 py-4 border-t"
              style={{ borderColor: "var(--border)" }}
            >
              <button
                onClick={() => {
                  setIsCreating(false);
                  setEditingTemplate(null);
                }}
                className="px-4 py-2 rounded text-sm font-medium hover:bg-white/5 transition-colors"
                style={{ color: "var(--text-secondary)" }}
              >
                {isEn ? "Cancel" : "Cancelar"}
              </button>
              <button
                onClick={handleSave}
                disabled={!formData.name || saving}
                className="px-4 py-2 rounded text-sm font-medium bg-emerald-500 text-black hover:bg-emerald-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {editingTemplate 
                  ? (isEn ? "Save Changes" : "Guardar Cambios")
                  : (isEn ? "Create Template" : "Crear Plantilla")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Dialog */}
      {confirmDialog?.open && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.7)" }}
          onClick={() => setConfirmDialog(null)}
        >
          <div
            className="rounded-lg border max-w-md w-full overflow-hidden shadow-2xl"
            style={{ borderColor: "var(--border)", background: "var(--bg-secondary)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="flex items-center justify-between px-5 py-4 border-b"
              style={{ borderColor: "var(--border)" }}
            >
              <h3 className="font-semibold text-base text-primary">
                {confirmDialog.title}
              </h3>
              <button
                onClick={() => setConfirmDialog(null)}
                className="p-1.5 rounded hover:bg-white/5 text-muted hover:text-primary transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-5 py-4">
              <p className="text-sm text-secondary leading-relaxed">
                {confirmDialog.message}
              </p>
            </div>
            <div
              className="flex items-center justify-end gap-2 px-5 py-3 border-t"
              style={{ borderColor: "var(--border)" }}
            >
              <button
                onClick={() => setConfirmDialog(null)}
                className="px-4 py-2 rounded text-sm font-medium hover:bg-white/5 transition-colors"
                style={{ color: "var(--text-secondary)" }}
              >
                {isEn ? "Cancel" : "Cancelar"}
              </button>
              <button
                onClick={confirmDialog.onConfirm}
                className="px-4 py-2 rounded text-sm font-medium bg-emerald-500 text-black hover:bg-emerald-600 transition-colors"
              >
                {isEn ? "Confirm" : "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
