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
  is_modified?: boolean;
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

// Replace {variable} with green badge HTML for preview
const renderVariableBadges = (text: string): string => {
  if (!text) return "";
  // First normalize {{variable}} to {variable}
  const normalized = text.replace(/\{\{(\w+)\}\}/g, '{$1}');
  return normalized.replace(/\{(\w+)\}/g, '<span style="background: rgba(16,185,129,0.1); color: #10b981; border: 1px solid rgba(16,185,129,0.2); padding: 1px 4px; border-radius: 3px; font-size: 0.85em; font-weight: 500;">{$1}</span>');
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
  const bodyTextareaRef = useRef<HTMLTextAreaElement>(null);
  const subjectInputRef = useRef<HTMLInputElement>(null);
  const [formData, setFormData] = useState({
    name: "",
    template_type: "custom",
    subject_template: "",
    body_template: "",
  });

  useEffect(() => {
    // Fetch defaults first, then templates
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
        // Mark templates as modified if they differ from defaults
        const templatesWithStatus = data.map((t: EmailTemplate) => {
          const defaultTemplate = defaultTemplates.find((d) => d.template_type === t.template_type);
          const isModified = defaultTemplate 
            ? (t.subject !== defaultTemplate.subject || t.body !== defaultTemplate.body)
            : false;
          return { ...t, is_modified: isModified };
        });
        setTemplates(templatesWithStatus);
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
        return data;
      }
    } catch (err) {
      console.error("Error fetching default templates:", err);
    }
    return [];
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
  };

  const handleEdit = (template: EmailTemplate) => {
    // Normalize {{variable}} to {variable}
    const normalizeVars = (text: string) => text.replace(/\{\{(\w+)\}\}/g, '{$1}');
    
    setFormData({
      name: template.name,
      template_type: template.template_type,
      subject_template: normalizeVars(template.subject),
      body_template: normalizeVars(template.body),
    });
    setEditingTemplate(template);
    setIsCreating(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm(lang === "es" ? "¿Eliminar esta plantilla?" : "Delete this template?")) return;
    
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
  };

  const handleRestore = async (template: EmailTemplate) => {
    const confirmMsg = lang === "es" 
      ? "¿Restaurar esta plantilla a su versión original? Se perderán los cambios."
      : "Restore this template to its original version? Changes will be lost.";
    if (!confirm(confirmMsg)) return;
    
    try {
      const token = localStorage.getItem("token");
      const original = defaultTemplates.find((d) => d.template_type === template.template_type);
      if (original) {
        const updateRes = await fetch(`/api/email/templates/${template.id}`, {
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
      }
    } catch (err) {
      console.error("Error restoring template:", err);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
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
        body: JSON.stringify(formData),
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

  // Drag & Drop handlers
  const handleDragStart = (e: React.DragEvent, variable: string) => {
    e.dataTransfer.setData("text/plain", variable);
    e.dataTransfer.effectAllowed = "copy";
  };

  const handleDragOver = (e: React.DragEvent, field: "subject" | "body") => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setDragOverField(field);
  };

  const handleDragLeave = () => {
    setDragOverField(null);
  };

  const handleDrop = (e: React.DragEvent, field: "subject" | "body") => {
    e.preventDefault();
    const variable = e.dataTransfer.getData("text/plain");
    if (variable && variables.some(v => v.key === variable)) {
      insertVariable(variable, field);
    }
    setDragOverField(null);
  };

  const insertVariable = (variable: string, field: "subject" | "body") => {
    if (field === "subject" && subjectInputRef.current) {
      const input = subjectInputRef.current;
      const start = input.selectionStart || input.value.length;
      const end = input.selectionEnd || input.value.length;
      const newValue = input.value.substring(0, start) + variable + input.value.substring(end);
      setFormData({ ...formData, subject_template: newValue });
      setTimeout(() => {
        input.focus();
        input.setSelectionRange(start + variable.length, start + variable.length);
      }, 0);
    } else if (field === "body" && bodyTextareaRef.current) {
      const textarea = bodyTextareaRef.current;
      const start = textarea.selectionStart || textarea.value.length;
      const end = textarea.selectionEnd || textarea.value.length;
      const newValue = textarea.value.substring(0, start) + variable + textarea.value.substring(end);
      setFormData({ ...formData, body_template: newValue });
      setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(start + variable.length, start + variable.length);
      }, 0);
    }
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
    <div className="p-6 max-w-4xl mx-auto">
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

      {/* Templates List - Compact */}
      <div className="grid gap-3">
        {templates.map((template) => (
          <div
            key={template.id}
            className="rounded-lg border p-3 hover:border-emerald-500/50 transition-colors"
            style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}
          >
            <div className="flex items-center justify-between mb-2">
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
                {template.is_modified && (
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
                <button
                  onClick={() => handleDelete(template.id)}
                  className="p-1.5 rounded hover:bg-red-500/10 text-muted hover:text-red-500 transition-colors"
                  title={isEn ? "Delete" : "Eliminar"}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Subject - inline */}
            <div className="text-xs text-muted mb-1">
              <span className="font-medium">{isEn ? "Subject:" : "Asunto:"}</span>{" "}
              <span className="text-primary">{template.subject}</span>
            </div>

            {/* Body Preview - truncated with variable badges */}
            <div 
              className="text-xs text-primary p-2 rounded border line-clamp-3"
              style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}
              dangerouslySetInnerHTML={{ __html: renderVariableBadges(template.body) }}
            />
          </div>
        ))}
      </div>

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

              {/* Subject with drag & drop */}
              <div>
                <label className="text-xs font-medium text-muted block mb-1">
                  {isEn ? "Subject" : "Asunto"}
                </label>
                <input
                  ref={subjectInputRef}
                  type="text"
                  value={formData.subject_template}
                  onChange={(e) => setFormData({ ...formData, subject_template: e.target.value })}
                  onDragOver={(e) => handleDragOver(e, "subject")}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, "subject")}
                  className="w-full px-3 py-2 rounded border text-sm"
                  style={{ 
                    background: "var(--bg-card)", 
                    borderColor: dragOverField === "subject" ? "#10b981" : "var(--border)", 
                    color: "var(--text-primary)" 
                  }}
                  placeholder={isEn ? "Analysis result: {track}" : "Resultado de análisis: {track}"}
                />
              </div>

              {/* Body with drag & drop */}
              <div>
                <label className="text-xs font-medium text-muted block mb-1">
                  {isEn ? "Body (plain text)" : "Cuerpo (texto plano)"}
                </label>
                <textarea
                  ref={bodyTextareaRef}
                  value={formData.body_template}
                  onChange={(e) => setFormData({ ...formData, body_template: e.target.value })}
                  onDragOver={(e) => handleDragOver(e, "body")}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, "body")}
                  rows={8}
                  className="w-full px-3 py-2 rounded border text-sm resize-none font-mono"
                  style={{ 
                    background: "var(--bg-card)", 
                    borderColor: dragOverField === "body" ? "#10b981" : "var(--border)", 
                    color: "var(--text-primary)" 
                  }}
                  placeholder={isEn ? "Hi {producer},\n\nThanks for sending {track}..." : "Hola {producer},\n\nGracias por enviar {track}..."}
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
                disabled={!formData.name || !formData.subject_template || !formData.body_template || saving}
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
    </div>
  );
}
