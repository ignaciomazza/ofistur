// src/components/users/UserForm.tsx

"use client";
import { useState } from "react";
import { motion } from "framer-motion";

interface UserFormProps {
  formData: {
    email: string;
    password?: string;
    first_name: string;
    last_name: string;
    position: string;
    role: string;
    id_agency: number;
  };
  handleChange: (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) => void;
  handleSubmit: (e: React.FormEvent) => void;
  editingUserId: number | null;
  isFormVisible: boolean;
  setIsFormVisible: React.Dispatch<React.SetStateAction<boolean>>;
  /** Mostrar/ocultar selector de rol (por defecto true para no romper el consumo actual) */
  showRole?: boolean;
}

export default function UserForm({
  formData,
  handleChange,
  handleSubmit,
  editingUserId,
  isFormVisible,
  setIsFormVisible,
  showRole = true,
}: UserFormProps) {
  const isCreatingUser = !editingUserId;

  const [showPwd, setShowPwd] = useState(false);

  // Patrón de contraseña fuerte: 8+ con minúscula, mayúscula, número y símbolo
  const strongPasswordPattern =
    "^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[^A-Za-z0-9]).{8,}$";

  return (
    <motion.div
      layout
      initial={{ maxHeight: 100, opacity: 1 }}
      animate={{
        maxHeight: isFormVisible ? 560 : 100,
        opacity: 1,
        transition: { duration: 0.4, ease: "easeInOut" },
      }}
      className="mb-6 space-y-3 overflow-hidden rounded-3xl border border-white/10 bg-white/10 p-6 text-sky-950 shadow-md shadow-sky-950/10 backdrop-blur dark:text-white"
    >
      <div
        className="flex cursor-pointer items-center justify-between"
        onClick={() => setIsFormVisible(!isFormVisible)}
      >
        <p className="text-lg font-medium dark:text-white">
          {editingUserId ? "Editar Usuario" : "Agregar Usuario"}
        </p>
        <button
          type="button"
          className="rounded-full bg-sky-100 p-2 text-sky-950 shadow-sm shadow-sky-950/20 transition-transform hover:scale-95 active:scale-90 dark:bg-white/10 dark:text-white dark:backdrop-blur"
          aria-label={isFormVisible ? "Contraer" : "Expandir"}
        >
          {isFormVisible ? (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              className="size-6"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14" />
            </svg>
          ) : (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              className="size-6"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 4.5v15m7.5-7.5h-15"
              />
            </svg>
          )}
        </button>
      </div>

      {isFormVisible && (
        <motion.form
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onSubmit={handleSubmit}
          className="max-h-[500px] items-center justify-center space-y-3 overflow-y-auto md:grid md:grid-cols-2 md:gap-6 md:space-y-0 md:pr-12"
          noValidate
        >
          {/* Email */}
          <div>
            <label className="ml-2 block dark:text-white">
              Email <span className="text-red-600">*</span>
            </label>
            <input
              type="email"
              name="email"
              inputMode="email"
              autoComplete="email"
              placeholder="Email"
              value={formData.email}
              onChange={handleChange}
              required
              aria-required="true"
              className="w-full appearance-none rounded-2xl border border-sky-950/10 bg-white/50 p-2 px-3 outline-none backdrop-blur placeholder:font-light placeholder:tracking-wide dark:border-white/10 dark:bg-white/10 dark:text-white"
            />
          </div>

          {/* Password: solo en alta. En edición se maneja desde el bloque "Contraseña". */}
          {isCreatingUser ? (
            <div>
              <label className="ml-2 block dark:text-white">
                Contraseña <span className="text-red-600">*</span>
              </label>
              <div className="relative">
                <input
                  type={showPwd ? "text" : "password"}
                  name="password"
                  placeholder="••••••••"
                  value={String(formData.password || "")}
                  onChange={handleChange}
                  required
                  aria-required="true"
                  pattern={strongPasswordPattern}
                  title="Mínimo 8 caracteres, con mayúscula, minúscula, número y símbolo."
                  autoComplete="new-password"
                  className="w-full appearance-none rounded-2xl border border-sky-950/10 bg-white/50 p-2 px-3 pr-10 outline-none backdrop-blur placeholder:font-light placeholder:tracking-wide dark:border-white/10 dark:bg-white/10 dark:text-white"
                />
                <button
                  type="button"
                  onClick={() => setShowPwd((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-sky-950/75 transition-opacity hover:opacity-100"
                  aria-label={
                    showPwd ? "Ocultar contraseña" : "Mostrar contraseña"
                  }
                >
                  {showPwd ? <EyeOpenIcon /> : <EyeClosedIcon />}
                </button>
              </div>
              <p className="mt-1 text-xs opacity-70">
                Debe tener mínimo 8 caracteres e incluir mayúscula, minúscula,
                número y símbolo.
              </p>
            </div>
          ) : (
            <div className="rounded-2xl border border-white/10 bg-white/40 p-3 text-xs opacity-80 dark:bg-white/5">
              La contraseña se cambia desde el bloque <b>Contraseña</b> de cada
              tarjeta de usuario.
            </div>
          )}

          {/* Nombre */}
          <div>
            <label className="ml-2 block dark:text-white">
              Nombre <span className="text-red-600">*</span>
            </label>
            <input
              type="text"
              name="first_name"
              placeholder="Nombre"
              value={formData.first_name}
              onChange={handleChange}
              required
              aria-required="true"
              className="w-full appearance-none rounded-2xl border border-sky-950/10 bg-white/50 p-2 px-3 outline-none backdrop-blur placeholder:font-light placeholder:tracking-wide dark:border-white/10 dark:bg-white/10 dark:text-white"
            />
          </div>

          {/* Apellido */}
          <div>
            <label className="ml-2 block dark:text-white">
              Apellido <span className="text-red-600">*</span>
            </label>
            <input
              type="text"
              name="last_name"
              placeholder="Apellido"
              value={formData.last_name}
              onChange={handleChange}
              required
              aria-required="true"
              className="w-full appearance-none rounded-2xl border border-sky-950/10 bg-white/50 p-2 px-3 outline-none backdrop-blur placeholder:font-light placeholder:tracking-wide dark:border-white/10 dark:bg-white/10 dark:text-white"
            />
          </div>

          {/* Posición */}
          <div>
            <label className="ml-2 block dark:text-white">
              Posición <span className="text-red-600">*</span>
            </label>
            <input
              type="text"
              name="position"
              placeholder="Posición"
              value={formData.position}
              onChange={handleChange}
              required
              aria-required="true"
              className="w-full appearance-none rounded-2xl border border-sky-950/10 bg-white/50 p-2 px-3 outline-none backdrop-blur placeholder:font-light placeholder:tracking-wide dark:border-white/10 dark:bg-white/10 dark:text-white"
            />
          </div>

          {/* Rol (ocultable) */}
          {showRole && (
            <div>
              <label className="ml-2 block dark:text-white">
                Rol <span className="text-red-600">*</span>
              </label>
              <select
                name="role"
                value={formData.role}
                onChange={handleChange}
                required
                aria-required="true"
                className="w-full cursor-pointer appearance-none rounded-2xl border border-sky-950/10 p-2 px-3 outline-none backdrop-blur placeholder:font-light placeholder:tracking-wide dark:border-white/10 dark:bg-white/10 dark:text-white"
              >
                <option value="gerente">Gerente</option>
                <option value="lider">Lider de Equipo</option>
                <option value="vendedor">Vendedor</option>
                <option value="administrativo">Administrativo</option>
                <option value="marketing">Marketing</option>
              </select>
            </div>
          )}

          <div className="md:col-span-2">
            <button
              type="submit"
              className="block rounded-full bg-sky-100 px-6 py-2 text-sky-950 shadow-sm shadow-sky-950/20 transition-transform hover:scale-95 active:scale-90 dark:bg-white/10 dark:text-white dark:backdrop-blur"
            >
              {editingUserId ? "Guardar Cambios" : "Agregar Usuario"}
            </button>
          </div>
        </motion.form>
      )}
    </motion.div>
  );
}

/* ============ iconitos ============ */
function EyeOpenIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="size-5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
      />
    </svg>
  );
}
function EyeClosedIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="size-5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88"
      />
    </svg>
  );
}
