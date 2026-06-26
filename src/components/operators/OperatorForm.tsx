// src/components/operators/OperatorForm.tsx

"use client";
import { motion, AnimatePresence } from "framer-motion";

export type OperatorFormData = {
  name: string;
  email: string;
  phone: string;
  website: string;
  address: string;
  postal_code: string;
  city: string;
  state: string;
  country: string;
  vat_status: string;
  legal_name: string;
  tax_id: string;
};

interface OperatorFormProps {
  formData: OperatorFormData;
  handleChange: (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) => void;
  handleSubmit: (e: React.FormEvent) => void;
  editingOperatorId: number | null;
  isFormVisible: boolean;
  setIsFormVisible: React.Dispatch<React.SetStateAction<boolean>>;
}

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
  required?: boolean;
  children: React.ReactNode;
}> = ({ id, label, required, children }) => (
  <div className="space-y-1">
    <label
      htmlFor={id}
      className={`ml-1 block text-sm font-medium text-sky-950 dark:text-white ${
        required
          ? "relative pl-4 before:absolute before:left-0 before:top-1/2 before:size-2 before:-translate-y-1/2 before:rounded-full before:bg-red-600"
          : ""
      }`}
    >
      {label}
    </label>
    {children}
  </div>
);

type FieldConfig = {
  name: keyof OperatorFormData;
  label: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
};

export default function OperatorForm({
  formData,
  handleChange,
  handleSubmit,
  editingOperatorId,
  isFormVisible,
  setIsFormVisible,
}: OperatorFormProps) {
  const inputClass =
    "w-full rounded-2xl border border-sky-200 bg-white/50 p-2 px-3 outline-none shadow-sm shadow-sky-950/10 backdrop-blur placeholder:font-light placeholder:tracking-wide dark:bg-sky-100/10 dark:border-sky-200/60 dark:text-white";

  const identityFields: FieldConfig[] = [
    {
      name: "name",
      label: "Nombre comercial",
      required: true,
      placeholder: "Ej: TravelPro",
    },
    {
      name: "legal_name",
      label: "Razón social",
      placeholder: "Ej: TravelPro S.A.",
    },
    {
      name: "tax_id",
      label: "CUIT",
      placeholder: "Ej: 30-12345678-9",
    },
    {
      name: "vat_status",
      label: "Condición IVA",
      placeholder: "Ej: Responsable inscripto",
    },
  ];

  const contactFields: FieldConfig[] = [
    {
      name: "email",
      label: "Email",
      type: "email",
      placeholder: "contacto@operador.com",
    },
    { name: "phone", label: "Teléfono", type: "tel", placeholder: "11 1234 5678" },
    { name: "website", label: "Sitio web", type: "url", placeholder: "https://..." },
  ];

  const locationFields: FieldConfig[] = [
    { name: "address", label: "Dirección", placeholder: "Calle y número" },
    { name: "postal_code", label: "Código Postal", placeholder: "CP" },
    { name: "city", label: "Localidad", placeholder: "Ciudad" },
    { name: "state", label: "Provincia", placeholder: "Provincia" },
    { name: "country", label: "País", placeholder: "País" },
  ];

  const namePreview =
    formData.name?.trim() || (editingOperatorId ? "Operador en edición" : "Nuevo operador");

  return (
    <motion.div
      layout
      className="mb-6 overflow-hidden rounded-3xl border border-white/10 bg-white/10 text-sky-950 shadow-md shadow-sky-950/10 backdrop-blur dark:text-white"
    >
      <button
        type="button"
        onClick={() => setIsFormVisible(!isFormVisible)}
        className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
      >
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-full bg-white/30 text-sky-950 shadow-inner dark:bg-white/10 dark:text-white">
            {isFormVisible ? (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="size-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.6}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14" />
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
          <div>
            <p className="text-lg font-semibold">
              {editingOperatorId ? "Editar Operador" : "Agregar Operador"}
            </p>
            <p className="text-xs text-sky-950/70 dark:text-white/70">
              Datos fiscales, contacto y ubicación.
            </p>
          </div>
        </div>
        <span className="hidden rounded-full border border-emerald-300/40 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-800 shadow-sm shadow-emerald-900/10 dark:border-emerald-400/30 dark:text-emerald-200 md:inline-flex">
          {namePreview}
        </span>
      </button>

      <AnimatePresence initial={false}>
        {isFormVisible && (
          <motion.form
            key="operator-form"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onSubmit={handleSubmit}
            className="space-y-5 px-4 pb-6 pt-2 md:px-6"
          >
            <Section
              title="Identidad fiscal"
              desc="Información comercial y legal del operador."
            >
              {identityFields.map(({ name, label, required, placeholder }) => (
                <Field key={name} id={name} label={label} required={required}>
                  <input
                    id={name}
                    type="text"
                    name={name}
                    value={String(formData[name as keyof OperatorFormData] || "")}
                    placeholder={placeholder || label}
                    onChange={handleChange}
                    required={required}
                    className={inputClass}
                  />
                </Field>
              ))}
            </Section>

            <Section title="Contacto" desc="Canales de comunicación habituales.">
              {contactFields.map(({ name, label, type = "text", required, placeholder }) => (
                <Field key={name} id={name} label={label} required={required}>
                  <input
                    id={name}
                    type={type}
                    name={name}
                    value={String(formData[name as keyof OperatorFormData] || "")}
                    placeholder={placeholder || label}
                    onChange={handleChange}
                    required={required}
                    className={inputClass}
                  />
                </Field>
              ))}
            </Section>

            <Section title="Ubicación" desc="Dirección y datos geográficos.">
              {locationFields.map(({ name, label, placeholder }) => (
                <Field key={name} id={name} label={label}>
                  <input
                    id={name}
                    type="text"
                    name={name}
                    value={String(formData[name as keyof OperatorFormData] || "")}
                    placeholder={placeholder || label}
                    onChange={handleChange}
                    className={inputClass}
                  />
                </Field>
              ))}
            </Section>

            <div className="flex justify-end">
              <button
                type="submit"
                className="rounded-full bg-sky-100 px-6 py-2 text-sky-950 shadow-sm shadow-sky-950/20 transition-transform hover:scale-95 active:scale-90 dark:bg-white/10 dark:text-white dark:backdrop-blur"
              >
                {editingOperatorId ? "Guardar Cambios" : "Agregar Operador"}
              </button>
            </div>
          </motion.form>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
