// src/components/clients/ClientForm.tsx
"use client";

import React, { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Spinner from "@/components/Spinner";
import DestinationPicker, {
  DestinationOption,
} from "@/components/DestinationPicker";
import type { ClientCustomField } from "@/types";
import { DEFAULT_REQUIRED_FIELDS, DOCUMENT_ANY_KEY } from "@/utils/clientConfig";

export interface ClientFormData {
  profile_key?: string | null;
  first_name: string;
  last_name: string;
  phone?: string;
  address?: string;
  postal_code?: string;
  locality?: string;
  company_name?: string;
  tax_id?: string; // CUIT (AR) / RUT (UY)
  commercial_address?: string;
  dni_number?: string; // DNI AR / CI UY
  passport_number?: string;
  birth_date?: string;
  nationality?: string;
  gender?: string;
  category_id?: number | null;
  email?: string;
  custom_fields?: Record<string, string>;
}

interface ClientFormProps {
  formData: ClientFormData;
  handleChange: (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) => void;
  handleCustomFieldChange?: (key: string, value: string) => void;
  handleSubmit: (e: React.FormEvent) => void | Promise<void>;
  editingClientId: number | null;
  isFormVisible: boolean;
  setIsFormVisible: React.Dispatch<React.SetStateAction<boolean>>;
  requiredFields?: string[];
  customFields?: ClientCustomField[];
  hiddenFields?: string[];
  profileOptions?: Array<{ key: string; label: string }>;
  passengerCategories?: Array<{ id_category: number; name: string; enabled?: boolean }>;
}

/* ========== UI primitives (mismo lenguaje visual que ServiceForm) ========== */

const Section: React.FC<{
  title: string;
  desc?: string;
  children: React.ReactNode;
}> = ({ title, desc, children }) => (
  <section className="rounded-2xl border border-white/10 bg-white/10 p-4">
    <div className="mb-3">
      <h3 className="text-base font-semibold tracking-tight text-sky-950 dark:text-white">
        {title}
      </h3>
      {desc && (
        <p className="mt-1 text-xs font-light text-sky-950/70 dark:text-white/70">
          {desc}
        </p>
      )}
    </div>

    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">{children}</div>
  </section>
);

const Field: React.FC<{
  id: string;
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}> = ({ id, label, hint, required, children }) => (
  <div className="space-y-1">
    <label
      htmlFor={id}
      className={`ml-1 block text-sm font-medium text-sky-950 dark:text-white ${
        required
          ? // puntito rojo en vez de asterisco
            "relative pl-4 before:absolute before:left-0 before:top-1/2 before:size-2 before:-translate-y-1/2 before:rounded-full before:bg-red-600"
          : ""
      }`}
    >
      {label}
    </label>

    {children}

    {hint && (
      <p
        id={`${id}-hint`}
        className="ml-1 text-xs text-sky-950/70 dark:text-white/70"
      >
        {hint}
      </p>
    )}
  </div>
);

/* =========================================================
 * Componente principal
 * ========================================================= */
export default function ClientForm({
  formData,
  handleChange,
  handleCustomFieldChange,
  handleSubmit,
  editingClientId,
  isFormVisible,
  setIsFormVisible,
  requiredFields,
  customFields = [],
  hiddenFields = [],
  profileOptions = [],
  passengerCategories = [],
}: ClientFormProps) {
  /* ---------- formateo de fecha (idéntico al tuyo) ---------- */
  const formatIsoToDisplay = (iso: string): string => {
    if (!iso) return "";
    if (iso.includes("/")) return iso;
    const parts = iso.split("-");
    if (parts.length !== 3) return iso;
    return `${parts[2]}/${parts[1]}/${parts[0]}`; // dd/mm/aaaa
  };

  const formatDisplayToIso = (display: string): string => {
    const parts = display.split("/");
    if (parts.length !== 3) return display;
    return `${parts[2]}-${parts[1]}-${parts[0]}`; // aaaa-mm-dd
  };

  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name } = e.target;
    const digits = e.target.value.replace(/\D/g, "");
    let formatted = "";
    if (digits.length > 0) {
      formatted += digits.substring(0, 2);
      if (digits.length >= 3) {
        formatted += "/" + digits.substring(2, 4);
        if (digits.length >= 5) {
          formatted += "/" + digits.substring(4, 8);
        }
      }
    }
    const event = {
      target: { name, value: formatted },
    } as React.ChangeEvent<HTMLInputElement>;
    handleChange(event);
  };

  const handleDatePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const pasteData = e.clipboardData.getData("text");
    const digits = pasteData.replace(/\D/g, "");
    if (digits.length === 8) {
      const day = digits.slice(0, 2);
      const month = digits.slice(2, 4);
      const year = digits.slice(4, 8);
      const formatted = `${day}/${month}/${year}`;
      e.preventDefault();
      const event = {
        target: { name: e.currentTarget.name, value: formatted },
      } as React.ChangeEvent<HTMLInputElement>;
      handleChange(event);
    }
  };

  const handleDateBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    const iso = formatDisplayToIso(value);
    const event = {
      target: { name, value: iso },
    } as React.ChangeEvent<HTMLInputElement>;
    handleChange(event);
  };

  const updateCustomField = (key: string, value: string) => {
    if (handleCustomFieldChange) {
      handleCustomFieldChange(key, value);
    }
  };

  const handleCustomDateChange =
    (key: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
      const digits = e.target.value.replace(/\D/g, "");
      let formatted = "";
      if (digits.length > 0) {
        formatted += digits.substring(0, 2);
        if (digits.length >= 3) {
          formatted += "/" + digits.substring(2, 4);
          if (digits.length >= 5) {
            formatted += "/" + digits.substring(4, 8);
          }
        }
      }
      updateCustomField(key, formatted);
    };

  const handleCustomDatePaste =
    (key: string) => (e: React.ClipboardEvent<HTMLInputElement>) => {
      const pasteData = e.clipboardData.getData("text");
      const digits = pasteData.replace(/\D/g, "");
      if (digits.length === 8) {
        const day = digits.slice(0, 2);
        const month = digits.slice(2, 4);
        const year = digits.slice(4, 8);
        const formatted = `${day}/${month}/${year}`;
        e.preventDefault();
        updateCustomField(key, formatted);
      }
    };

  const handleCustomDateBlur =
    (key: string) => (e: React.FocusEvent<HTMLInputElement>) => {
      const iso = formatDisplayToIso(e.target.value);
      updateCustomField(key, iso);
    };

  /* ---------- Nacionalidad usando DestinationPicker (modo país) ---------- */
  const handleNationalitySelect = (
    val: DestinationOption | DestinationOption[] | null,
  ) => {
    let text = "";
    if (val && !Array.isArray(val)) {
      text = val.displayLabel; // ej "Argentina (AR)"
    }
    const event = {
      target: { name: "nationality", value: text },
    } as React.ChangeEvent<HTMLInputElement>;
    handleChange(event);
  };

  /* ---------- lógica de requeridos ---------- */
  // Campos marcados con el punto rojo
  const baseRequiredFields = requiredFields ?? DEFAULT_REQUIRED_FIELDS;

  const isRequired = (fieldName: string) =>
    baseRequiredFields.includes(fieldName);
  const hiddenFieldSet = useMemo(() => new Set(hiddenFields), [hiddenFields]);
  const isHidden = (fieldName: string) => hiddenFieldSet.has(fieldName);

  const isFilled = (val: unknown) => (val ?? "").toString().trim().length > 0;

  const fieldIsFilled = (fieldName: keyof ClientFormData) =>
    isFilled(formData[fieldName]);

  // chequear si TODOS los marcados con el puntito rojo están completos
  const requiredFilled = baseRequiredFields.every((f) =>
    f === DOCUMENT_ANY_KEY ? true : fieldIsFilled(f as keyof ClientFormData),
  );

  const requiredCustomKeys = useMemo(
    () => customFields.filter((f) => f.required).map((f) => f.key),
    [customFields],
  );

  const customFieldIsFilled = (key: string) =>
    isFilled(formData.custom_fields?.[key]);

  const customRequiredFilled = requiredCustomKeys.every((key) =>
    customFieldIsFilled(key),
  );

  // chequear si tenemos documento para identificar al pasajero / facturar:
  // puede ser DNI / CI, o Pasaporte, o CUIT / RUT
  const hasDoc = useMemo(() => {
    const dniOK = isFilled(formData.dni_number);
    const passOK = isFilled(formData.passport_number);
    const taxOK = isFilled(formData.tax_id); // CUIT (AR) / RUT (UY)
    return dniOK || passOK || taxOK;
  }, [formData.dni_number, formData.passport_number, formData.tax_id]);

  // estado final para habilitar el submit
  const docRequired = baseRequiredFields.includes(DOCUMENT_ANY_KEY);
  const formReady =
    requiredFilled && customRequiredFilled && (docRequired ? hasDoc : true);

  /* ---------- clases dinámicas de input ---------- */
  const inputClass = (fieldName: keyof ClientFormData) => {
    const base =
      "w-full rounded-2xl border border-sky-200 bg-white/50 p-2 px-3 shadow-sm shadow-sky-950/10 outline-none placeholder:font-light dark:bg-sky-100/10 dark:border-sky-200/60 dark:text-white";
    const okBorder = "";
    const alertBorder = " border-rose-500/60 dark:border-rose-500/60";

    if (isRequired(fieldName) && !fieldIsFilled(fieldName)) {
      return base + alertBorder;
    }
    return base + okBorder;
  };

  const customInputClass = (field: ClientCustomField) => {
    const base =
      "w-full rounded-2xl border border-sky-200 bg-white/50 p-2 px-3 shadow-sm shadow-sky-950/10 outline-none placeholder:font-light dark:bg-sky-100/10 dark:border-sky-200/60 dark:text-white";
    const okBorder = "";
    const alertBorder = " border-rose-500/60 dark:border-rose-500/60";
    if (field.required && !customFieldIsFilled(field.key)) {
      return base + alertBorder;
    }
    return base + okBorder;
  };

  const customValue = (key: string) => formData.custom_fields?.[key] || "";

  const renderCustomField = (field: ClientCustomField) => {
    const value = customValue(field.key);
    const hint = field.help || (field.type === "date" ? "dd/mm/aaaa" : "");

    if (field.type === "date") {
      return (
        <Field
          key={field.key}
          id={`custom_${field.key}`}
          label={field.label}
          hint={hint || undefined}
          required={field.required}
        >
          <input
            id={`custom_${field.key}`}
            type="text"
            name={`custom_${field.key}`}
            value={formatIsoToDisplay(value)}
            onChange={handleCustomDateChange(field.key)}
            onPaste={handleCustomDatePaste(field.key)}
            onBlur={handleCustomDateBlur(field.key)}
            inputMode="numeric"
            placeholder={field.placeholder || "dd/mm/aaaa"}
            required={field.required}
            className={customInputClass(field)}
          />
        </Field>
      );
    }

    return (
      <Field
        key={field.key}
        id={`custom_${field.key}`}
        label={field.label}
        hint={field.help}
        required={field.required}
      >
        <input
          id={`custom_${field.key}`}
          type={field.type === "number" ? "number" : "text"}
          name={`custom_${field.key}`}
          value={value}
          onChange={(e) => updateCustomField(field.key, e.target.value)}
          placeholder={field.placeholder}
          required={field.required}
          className={customInputClass(field)}
        />
      </Field>
    );
  };

  /* ---------- submit con spinner / disable ---------- */
  const [submitting, setSubmitting] = useState(false);

  const onLocalSubmit = async (e: React.FormEvent) => {
    setSubmitting(true);
    try {
      await Promise.resolve(handleSubmit(e));
    } finally {
      setSubmitting(false);
    }
  };

  const submitDisabled = submitting || !formReady;

  const { dniExpirationField, passportExpirationField, extraCustomFields } =
    useMemo(() => {
      const byKey = new Map(customFields.map((f) => [f.key, f]));
      return {
        dniExpirationField: byKey.get("dni_expiration") || null,
        passportExpirationField: byKey.get("passport_expiration") || null,
        extraCustomFields: customFields.filter(
          (f) =>
            f.key !== "dni_expiration" && f.key !== "passport_expiration",
        ),
      };
    }, [customFields]);

  /* =========================================================
   * RENDER
   * ========================================================= */
  return (
    <motion.div
      layout
      initial={{ maxHeight: 96, opacity: 1 }}
      animate={{
        maxHeight: isFormVisible ? 700 : 96,
        opacity: 1,
        transition: { duration: 0.35, ease: "easeInOut" },
      }}
      id="client-form"
      className="mb-6 overflow-auto rounded-3xl border border-white/10 bg-white/10 text-sky-950 shadow-md shadow-sky-950/10 dark:text-white"
    >
      {/* HEADER */}
      <div
        className={`sticky top-0 z-10 ${isFormVisible ? "rounded-t-3xl border-b" : ""} border-white/10 px-4 py-3 backdrop-blur-sm`}
      >
        <button
          type="button"
          onClick={() => setIsFormVisible(!isFormVisible)}
          className="flex w-full items-center justify-between text-left"
          aria-expanded={isFormVisible}
          aria-controls="client-form-body"
        >
          <div className="flex items-start gap-3">
            <div className="grid size-9 place-items-center rounded-full bg-sky-100 text-sky-950 shadow-sm shadow-sky-950/20 dark:bg-white/10 dark:text-white">
              {isFormVisible ? (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="size-5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.6}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M5 12h14"
                  />
                </svg>
              ) : (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="size-5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.6}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 4.5v15m7.5-7.5h-15"
                  />
                </svg>
              )}
            </div>

            <div className="flex flex-col">
              <p className="text-lg font-semibold">
                {editingClientId ? "Editar Pax" : "Agregar Pax"}
              </p>
            </div>
          </div>

          <div className="hidden items-center gap-2 md:flex">
            {fieldIsFilled("first_name") || fieldIsFilled("last_name") ? (
              <span className="rounded-full bg-white/30 px-3 py-1 text-xs font-medium dark:bg-white/10">
                {`${formData.first_name ?? ""} ${formData.last_name ?? ""}`.trim() ||
                  "Sin nombre"}
              </span>
            ) : (
              <span className="rounded-full border border-emerald-300/50 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800 shadow-sm shadow-emerald-950/10 dark:border-emerald-800/50 dark:bg-emerald-950/50 dark:text-emerald-200">
                Nuevo pax
              </span>
            )}
          </div>
        </button>
      </div>

      {/* BODY */}
      <AnimatePresence initial={false}>
        {isFormVisible && (
          <motion.div
            key="body"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="relative"
          >
            <motion.form
              id="client-form-body"
              onSubmit={onLocalSubmit}
              className="space-y-5 px-4 pb-6 pt-4 md:px-6"
            >
              {profileOptions.length > 1 && (
                <Section
                  title="Tipo de Pax"
                  desc="Elegí el tipo para aplicar campos obligatorios, ocultos y extras."
                >
                  <Field id="profile_key" label="Tipo de pax" required>
                    <select
                      id="profile_key"
                      name="profile_key"
                      value={formData.profile_key || profileOptions[0]?.key || ""}
                      onChange={handleChange}
                      className="w-full rounded-2xl border border-sky-200 bg-white/50 p-2 px-3 shadow-sm shadow-sky-950/10 outline-none dark:border-sky-200/60 dark:bg-sky-100/10 dark:text-white"
                    >
                      {profileOptions.map((opt) => (
                        <option key={opt.key} value={opt.key}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                </Section>
              )}

              {/* DATOS PERSONALES */}
              <Section
                title="Datos personales"
                desc="Quién es la persona. Estos datos se usan en vouchers y reservas."
              >
                {/* Nombre */}
                {!isHidden("first_name") && (
                  <Field
                    id="first_name"
                    label="Nombre"
                    required={isRequired("first_name")}
                  >
                    <input
                      id="first_name"
                      type="text"
                      name="first_name"
                      value={formData.first_name || ""}
                      onChange={handleChange}
                      placeholder="Ej: Juan"
                      required={isRequired("first_name")}
                      className={inputClass("first_name")}
                    />
                  </Field>
                )}

                {/* Apellido */}
                {!isHidden("last_name") && (
                  <Field
                    id="last_name"
                    label="Apellido"
                    required={isRequired("last_name")}
                  >
                    <input
                      id="last_name"
                      type="text"
                      name="last_name"
                      value={formData.last_name || ""}
                      onChange={handleChange}
                      placeholder="Ej: Pérez"
                      required={isRequired("last_name")}
                      className={inputClass("last_name")}
                    />
                  </Field>
                )}

                {/* Género */}
                {!isHidden("gender") && (
                  <Field
                    id="gender"
                    label="Género"
                    required={isRequired("gender")}
                  >
                    <select
                      id="gender"
                      name="gender"
                      value={formData.gender || ""}
                      onChange={handleChange}
                      required={isRequired("gender")}
                      className={`${inputClass("gender")} cursor-pointer appearance-none`}
                    >
                      <option value="" disabled>
                        Seleccionar
                      </option>
                      <option value="Masculino">Masculino</option>
                      <option value="Femenino">Femenino</option>
                      <option value="No Binario">No Binario</option>
                    </select>
                  </Field>
                )}

              {/* Fecha de Nacimiento */}
              {!isHidden("birth_date") && (
                <Field
                  id="birth_date"
                  label="Fecha de Nacimiento"
                  required={isRequired("birth_date")}
                  hint="dd/mm/aaaa"
                >
                    <input
                      id="birth_date"
                      type="text"
                      name="birth_date"
                      value={formatIsoToDisplay(formData.birth_date || "")}
                      onChange={handleDateChange}
                      onPaste={handleDatePaste}
                      onBlur={handleDateBlur}
                      inputMode="numeric"
                      placeholder="dd/mm/aaaa"
                      required={isRequired("birth_date")}
                      className={inputClass("birth_date")}
                    />
                  </Field>
                )}

                {passengerCategories.length > 0 && (
                  <Field id="category_id" label="Categoría">
                    <select
                      id="category_id"
                      name="category_id"
                      value={formData.category_id ?? ""}
                      onChange={handleChange}
                      className={`${inputClass("category_id")} cursor-pointer appearance-none`}
                    >
                      <option value="">Sin categoría</option>
                      {passengerCategories
                        .filter((c) => c.enabled !== false)
                        .map((cat) => (
                          <option key={cat.id_category} value={cat.id_category}>
                            {cat.name}
                          </option>
                        ))}
                    </select>
                  </Field>
                )}

                {/* Nacionalidad */}
                {!isHidden("nationality") && (
                  <Field
                    id="nationality"
                    label="Nacionalidad"
                    required={isRequired("nationality")}
                  >
                    <DestinationPicker
                      type="country"
                      multiple={false}
                      value={null}
                      onChange={handleNationalitySelect}
                      placeholder="Ej.: Argentina, Uruguay…"
                      includeDisabled={true}
                      className={
                        isRequired("nationality") &&
                        !fieldIsFilled("nationality")
                          ? // remarcar en rojo si falta
                            "rounded-2xl"
                          : ""
                      }
                    />

                    {formData.nationality ? (
                      <p className="ml-1 text-xs text-sky-950/70 dark:text-white/70">
                        Guardará: <b>{formData.nationality}</b>
                      </p>
                    ) : (
                      <p className="ml-1 text-xs text-red-600 dark:text-red-500/90">
                        {isRequired("nationality") &&
                        !fieldIsFilled("nationality")
                          ? "Obligatorio"
                          : "\u00A0"}
                      </p>
                    )}
                  </Field>
                )}
              </Section>

              {/* DOCUMENTACIÓN DE VIAJE / IDENTIFICACIÓN */}
              <Section
                title="Documentación de viaje"
                desc={
                  docRequired
                    ? "Tenés que cargar al menos uno: Documento / CI / DNI, Pasaporte o CUIT / RUT."
                    : undefined
                }
              >
                {!isHidden("dni_number") && (
                  <Field id="dni_number" label="Documento / CI / DNI">
                    <input
                      id="dni_number"
                      type="text"
                      name="dni_number"
                      value={formData.dni_number || ""}
                      onChange={handleChange}
                      placeholder="DNI argentino o CI uruguaya"
                      className={inputClass("dni_number")}
                    />
                  </Field>
                )}

                {dniExpirationField ? renderCustomField(dniExpirationField) : null}

                {!isHidden("passport_number") && (
                  <Field id="passport_number" label="Pasaporte">
                    <input
                      id="passport_number"
                      type="text"
                      name="passport_number"
                      value={formData.passport_number || ""}
                      onChange={handleChange}
                      placeholder="Ej: AA123456"
                      className={inputClass("passport_number")}
                    />
                  </Field>
                )}

                {passportExpirationField
                  ? renderCustomField(passportExpirationField)
                  : null}
              </Section>

              {/* FACTURACIÓN */}
              <Section
                title="Facturación"
                desc="Solo si le facturás. Estos datos también sirven como respaldo de identidad si no hay documento/pasaporte."
              >
                {!isHidden("tax_id") && (
                  <Field id="tax_id" label="CUIT / RUT">
                    <input
                      id="tax_id"
                      type="text"
                      name="tax_id"
                      value={formData.tax_id || ""}
                      onChange={handleChange}
                      placeholder="20-12345678-3 / 2.345.678-9"
                      className={inputClass("tax_id")}
                    />
                  </Field>
                )}

                {!isHidden("company_name") && (
                  <Field
                    id="company_name"
                    label="Razón Social"
                    hint="Solo si factura como empresa o monotributo."
                  >
                    <input
                      id="company_name"
                      type="text"
                      name="company_name"
                      value={formData.company_name || ""}
                      onChange={handleChange}
                      placeholder="Ej: Mupu SRL"
                      className={inputClass("company_name")}
                    />
                  </Field>
                )}

                {!isHidden("commercial_address") && (
                  <Field
                    id="commercial_address"
                    label="Domicilio Comercial (Factura)"
                  >
                    <input
                      id="commercial_address"
                      type="text"
                      name="commercial_address"
                      value={formData.commercial_address || ""}
                      onChange={handleChange}
                      placeholder="Calle, número, piso..."
                      className={inputClass("commercial_address")}
                    />
                  </Field>
                )}

                {!isHidden("address") && (
                  <Field id="address" label="Dirección Particular">
                    <input
                      id="address"
                      type="text"
                      name="address"
                      value={formData.address || ""}
                      onChange={handleChange}
                      placeholder="Calle, número, piso..."
                      className={inputClass("address")}
                    />
                  </Field>
                )}

                {!isHidden("locality") && (
                  <Field id="locality" label="Localidad / Ciudad">
                    <input
                      id="locality"
                      type="text"
                      name="locality"
                      value={formData.locality || ""}
                      onChange={handleChange}
                      placeholder="Ej: San Miguel"
                      className={inputClass("locality")}
                    />
                  </Field>
                )}

                {!isHidden("postal_code") && (
                  <Field id="postal_code" label="Código Postal">
                    <input
                      id="postal_code"
                      type="text"
                      name="postal_code"
                      value={formData.postal_code || ""}
                      onChange={handleChange}
                      placeholder="Ej: 1663"
                      className={inputClass("postal_code")}
                    />
                  </Field>
                )}
              </Section>

              {/* CONTACTO */}
              <Section
                title="Contacto"
                desc="Cómo nos comunicamos con el pax para avisos y entrega de documentación."
              >
                {!isHidden("phone") && (
                  <Field
                    id="phone"
                    label="Teléfono / WhatsApp"
                    required={isRequired("phone")}
                  >
                    <input
                      id="phone"
                      type="text"
                      name="phone"
                      value={formData.phone || ""}
                      onChange={handleChange}
                      placeholder="Ej: +54 9 11 1234-5678"
                      required={isRequired("phone")}
                      className={inputClass("phone")}
                    />
                  </Field>
                )}

                {!isHidden("email") && (
                  <Field id="email" label="Correo electrónico">
                    <input
                      id="email"
                      type="email"
                      name="email"
                      value={formData.email || ""}
                      onChange={handleChange}
                      placeholder="nombre@correo.com"
                      className={inputClass("email")}
                    />
                  </Field>
                )}
              </Section>

              {extraCustomFields.length > 0 && (
                <Section
                  title="Campos personalizados"
                  desc="Campos definidos por tu agencia."
                >
                  {extraCustomFields.map((field) => renderCustomField(field))}
                </Section>
              )}

              {/* ACTION BAR */}
              <div className="sticky bottom-2 z-10 flex justify-end">
                <button
                  type="submit"
                  disabled={submitDisabled}
                  aria-busy={submitting}
                  className={`rounded-full px-6 py-2 shadow-sm shadow-sky-950/20 transition active:scale-[0.98] ${
                    submitDisabled
                      ? "cursor-not-allowed bg-sky-950/20 text-white/60 dark:bg-white/5 dark:text-white/40"
                      : "bg-sky-100 text-sky-950 dark:bg-white/10 dark:text-white"
                  }`}
                  aria-label={
                    editingClientId
                      ? "Guardar cambios del pax"
                      : "Agregar pax"
                  }
                >
                  {submitting ? (
                    <Spinner />
                  ) : editingClientId ? (
                    "Guardar Cambios"
                  ) : (
                    "Agregar Pax"
                  )}
                </button>
              </div>
            </motion.form>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
