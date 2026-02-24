// src/app/users/page.tsx
"use client";

import { useState, useEffect, useMemo } from "react";
import ProtectedRoute from "@/components/ProtectedRoute";
import UserForm from "@/components/users/UserForm";
import UserList from "@/components/users/UserList";
import { User } from "@/types";
import { motion, AnimatePresence } from "framer-motion";
import { toast, ToastContainer } from "react-toastify";
import Spinner from "@/components/Spinner";
import "react-toastify/dist/ReactToastify.css";
import { useAuth } from "@/context/AuthContext";
import { authFetch } from "@/utils/authFetch";

/* ============ tipos locales ============ */

type UserFormData = {
  email: string;
  password?: string;
  first_name: string;
  last_name: string;
  position: string;
  role: string;
  id_agency: number;
};

type ProfileResponse = {
  id_user: number;
  id_agency: number;
  role: string;
  first_name: string;
  last_name: string;
  email: string;
  position: string | null;
  permissions?: {
    canSeeAllUsers?: boolean;
    canEditSelf?: boolean;
    canResetOthers?: boolean;
  };
};

/* ============ helpers ============ */

function normalizeRole(r?: string) {
  return (r ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/^leader$/, "lider");
}

function isStrongPassword(pw: string) {
  if (pw.length < 8) return false;
  const hasLower = /[a-z]/.test(pw);
  const hasUpper = /[A-Z]/.test(pw);
  const hasNumber = /[0-9]/.test(pw);
  const hasSymbol = /[^A-Za-z0-9]/.test(pw); // símbolo obligatorio
  return hasLower && hasUpper && hasNumber && hasSymbol;
}

async function getResponseMessage(response: Response, fallback: string) {
  try {
    const body = (await response.clone().json()) as
      | { error?: string; message?: string }
      | undefined;
    if (typeof body?.error === "string" && body.error.trim()) {
      return body.error.trim();
    }
    if (typeof body?.message === "string" && body.message.trim()) {
      return body.message.trim();
    }
  } catch {
    // ignore
  }

  try {
    const text = (await response.text()).trim();
    if (text) return text;
  } catch {
    // ignore
  }

  return fallback;
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}

/* ============ componente ============ */

export default function UsersPage() {
  const { token } = useAuth();

  const [users, setUsers] = useState<User[]>([]);
  const [formData, setFormData] = useState<UserFormData>({
    email: "",
    password: "",
    first_name: "",
    last_name: "",
    position: "",
    role: "vendedor",
    id_agency: 1,
  });
  const [isFormVisible, setIsFormVisible] = useState<boolean>(false);
  const [editingUserId, setEditingUserId] = useState<number | null>(null);
  const [loadingUsers, setLoadingUsers] = useState<boolean>(true);

  // perfil para decidir vista por rol
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [loadingProfile, setLoadingProfile] = useState<boolean>(true);

  // modal cambio de contraseña (self-service)
  const [pwdModalOpen, setPwdModalOpen] = useState(false);
  const [pwdSubmitting, setPwdSubmitting] = useState(false);
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [repeatPassword, setRepeatPassword] = useState("");
  const [showOld, setShowOld] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showRepeat, setShowRepeat] = useState(false);

  const role = useMemo(() => normalizeRole(profile?.role), [profile]);
  const isManager = role === "gerente" || role === "desarrollador";

  // cargar perfil
  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    (async () => {
      try {
        setLoadingProfile(true);
        const r = await authFetch(
          "/api/user/profile",
          { signal: controller.signal, cache: "no-store" },
          token,
        );
        if (!r.ok) {
          const msg = await getResponseMessage(
            r,
            "No se pudo obtener el perfil.",
          );
          throw new Error(msg);
        }
        const p: ProfileResponse = await r.json();
        setProfile(p);
      } catch (e) {
        if ((e as DOMException)?.name !== "AbortError") {
          console.error("Error perfil:", e);
        }
      } finally {
        if (!controller.signal.aborted) setLoadingProfile(false);
      }
    })();
    return () => controller.abort();
  }, [token]);

  // cargar usuarios (API ya filtra según rol)
  useEffect(() => {
    if (!token) return;

    const controller = new AbortController();
    const load = async () => {
      try {
        setLoadingUsers(true);
        const res = await authFetch(
          "/api/users",
          { signal: controller.signal },
          token,
        );
        if (!res.ok) {
          const msg = await getResponseMessage(
            res,
            "No se pudieron cargar los usuarios.",
          );
          throw new Error(msg);
        }
        const data: User[] = await res.json();
        setUsers(data);
      } catch (error: unknown) {
        if ((error as DOMException)?.name === "AbortError") return;
        console.error("Error fetching users:", error);
        toast.error(getErrorMessage(error, "No se pudieron cargar los usuarios."));
      } finally {
        if (!controller.signal.aborted) setLoadingUsers(false);
      }
    };
    load();

    return () => controller.abort();
  }, [token]);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) => {
    const { name, value } = e.target;
    setFormData((prevData) => ({ ...prevData, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (
      !formData.email ||
      !formData.first_name ||
      !formData.last_name ||
      !formData.position ||
      !formData.role
    ) {
      toast.error("Todos los campos obligatorios deben ser completados.");
      return;
    }

    if (!editingUserId && !formData.password?.trim()) {
      toast.error("Ingresá una contraseña para crear el usuario.");
      return;
    }

    if (!editingUserId && !isStrongPassword(formData.password || "")) {
      toast.error(
        "La contraseña debe tener al menos 8 caracteres e incluir mayúscula, minúscula, número y símbolo.",
      );
      return;
    }

    const url = editingUserId ? `/api/users/${editingUserId}` : "/api/users";
    const method = editingUserId ? "PUT" : "POST";

    try {
      const dataToSend: Partial<UserFormData> = { ...formData };

      // En edición la contraseña siempre viaja por PATCH (bloque "Contraseña")
      if (editingUserId) {
        delete dataToSend.password;
      }

      const response = await authFetch(
        url,
        {
          method,
          body: JSON.stringify(dataToSend),
        },
        token,
      );

      if (!response.ok) {
        const msg = await getResponseMessage(
          response,
          "No se pudo guardar el usuario.",
        );
        throw new Error(msg);
      }

      const user: User = await response.json();
      setUsers((prevUsers) =>
        editingUserId
          ? prevUsers.map((u) => (u.id_user === editingUserId ? user : u))
          : [...prevUsers, user],
      );
      toast.success(
        editingUserId ? "Usuario actualizado." : "Usuario creado.",
      );
      resetForm();
    } catch (error: unknown) {
      console.error("Error en el submit:", error);
      toast.error(getErrorMessage(error, "No se pudo guardar el usuario."));
    }
  };

  const resetForm = () => {
    setFormData({
      email: "",
      password: "",
      first_name: "",
      last_name: "",
      position: "",
      role: "vendedor",
      id_agency: 1,
    });
    setEditingUserId(null);
    setIsFormVisible(false);
  };

  const startEditingUser = (user: User) => {
    setFormData({
      email: user.email,
      password: "",
      first_name: user.first_name,
      last_name: user.last_name,
      position: user.position,
      role: user.role,
      id_agency: user.id_agency,
    });
    setEditingUserId(user.id_user);
    setIsFormVisible(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const deleteUser = async (id_user: number) => {
    try {
      const response = await authFetch(
        `/api/users/${id_user}`,
        { method: "DELETE" },
        token,
      );
      if (!response.ok) {
        const msg = await getResponseMessage(
          response,
          "No se pudo eliminar el usuario.",
        );
        throw new Error(msg);
      }
      setUsers((prevUsers) =>
        prevUsers.filter((user) => user.id_user !== id_user),
      );
      toast.success("Usuario eliminado.");
    } catch (error: unknown) {
      console.error("Error al eliminar el usuario:", error);
      toast.error(getErrorMessage(error, "No se pudo eliminar el usuario."));
    }
  };

  /* ========= handlers modal password (self-service) ========= */

  const openPasswordModal = () => {
    setOldPassword("");
    setNewPassword("");
    setRepeatPassword("");
    setShowOld(false);
    setShowNew(false);
    setShowRepeat(false);
    setPwdModalOpen(true);
  };

  const submitPasswordChange = async () => {
    try {
      if (!profile?.id_user) {
        toast.error("Perfil no disponible");
        return;
      }
      if (!oldPassword.trim()) {
        toast.error("La contraseña actual es obligatoria.");
        return;
      }
      if (!newPassword.trim() || !repeatPassword.trim()) {
        toast.error("Debés ingresar y repetir la nueva contraseña.");
        return;
      }
      if (newPassword !== repeatPassword) {
        toast.error("Las contraseñas no coinciden.");
        return;
      }
      if (!isStrongPassword(newPassword)) {
        toast.error(
          "La nueva contraseña debe tener al menos 8 caracteres e incluir mayúscula, minúscula, número y símbolo.",
        );
        return;
      }

      setPwdSubmitting(true);
      const r = await authFetch(
        `/api/users/${profile.id_user}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            action: "changePassword",
            // backend exige oldPassword para vendedor/líder
            oldPassword,
            newPassword,
            confirmPassword: repeatPassword,
          }),
        },
        token,
      );

      if (!r.ok) {
        const msg = await getResponseMessage(
          r,
          "No se pudo cambiar la contraseña.",
        );
        throw new Error(msg);
      }

      toast.success("Contraseña actualizada correctamente.");
      setPwdModalOpen(false);
    } catch (e) {
      toast.error(getErrorMessage(e, "No se pudo cambiar la contraseña."));
    } finally {
      setPwdSubmitting(false);
    }
  };

  /* ========= UI ========= */

  if (loadingProfile) {
    return (
      <ProtectedRoute>
        <section className="flex min-h-[60vh] items-center justify-center">
          <Spinner />
        </section>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <section className="text-sky-950 dark:text-white">
        {/* Vista para GERENTE / DESARROLLADOR: formulario + lista */}
        {isManager ? (
          <>
            <motion.div layout>
              <UserForm
                formData={formData}
                handleChange={handleChange}
                handleSubmit={handleSubmit}
                editingUserId={editingUserId}
                isFormVisible={isFormVisible}
                setIsFormVisible={setIsFormVisible}
              />
            </motion.div>

            <h2 className="my-4 text-2xl font-semibold dark:font-medium">
              Usuarios
            </h2>
            {loadingUsers ? (
              <Spinner />
            ) : (
              <UserList
                users={users}
                startEditingUser={startEditingUser}
                deleteUser={deleteUser}
                isManager={isManager}
              />
            )}
          </>
        ) : (
          // Vista para VENDEDOR / LÍDER: solo su card y botón de cambiar contraseña
          <motion.div layout className="space-y-4">
            <h2 className="my-2 text-2xl font-semibold dark:font-medium">
              Mi usuario
            </h2>

            <div className="h-fit space-y-3 overflow-hidden rounded-3xl border border-white/10 bg-white/10 p-6 text-sky-950 shadow-md shadow-sky-950/10 backdrop-blur dark:text-white">
              <p className="font-light">{profile?.email}</p>
              <div className="ml-5 list-disc">
                <li className="font-normal">
                  Nombre
                  <span className="ml-2 font-light">
                    {profile?.first_name} {profile?.last_name}
                  </span>
                </li>
                <li className="font-normal">
                  Posición
                  <span className="ml-2 font-light">
                    {profile?.position || "-"}
                  </span>
                </li>
                <li className="font-normal">
                  Rol
                  <span className="ml-2 font-light">{profile?.role}</span>
                </li>
              </div>

              <div className="mt-4 flex justify-end">
                <button
                  className="rounded-full bg-sky-100 px-6 py-2 text-sky-950 shadow-sm shadow-sky-950/20 transition-transform hover:scale-95 active:scale-90 dark:bg-white/10 dark:text-white dark:backdrop-blur"
                  onClick={openPasswordModal}
                >
                  Contraseña
                </button>
              </div>
            </div>
          </motion.div>
        )}

        {/* Modal cambio de contraseña (solo self-service) */}
        <AnimatePresence>
          {pwdModalOpen && (
            <motion.div
              className="fixed inset-0 z-50 flex items-center justify-center bg-sky-950/20 p-4"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <motion.div
                className="w-full max-w-lg rounded-3xl border border-white/10 bg-white/10 p-6 text-sky-950 shadow-lg backdrop-blur dark:text-white"
                initial={{ y: 30, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 30, opacity: 0 }}
                transition={{ type: "spring", stiffness: 250, damping: 25 }}
              >
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="text-xl font-semibold">Cambiar contraseña</h3>
                  <button
                    onClick={() => setPwdModalOpen(false)}
                    className="rounded-full bg-sky-100 p-2 text-sky-950 shadow-sm shadow-sky-950/20 transition-transform hover:scale-95 active:scale-90 dark:bg-white/10 dark:text-white dark:backdrop-blur"
                    aria-label="Cerrar"
                  >
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
                        d="M6 18 18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                </div>

                <div className="space-y-3">
                  {/* Actual */}
                  <div>
                    <label className="ml-2 block">Contraseña actual *</label>
                    <div className="relative">
                      <input
                        type={showOld ? "text" : "password"}
                        value={oldPassword}
                        onChange={(e) => setOldPassword(e.target.value)}
                        placeholder="••••••••"
                        required
                        className="w-full rounded-2xl border border-sky-950/10 bg-white/50 p-2 px-3 outline-none backdrop-blur placeholder:font-light placeholder:tracking-wide dark:border-white/10 dark:bg-white/10 dark:text-white"
                      />
                      <button
                        type="button"
                        onClick={() => setShowOld((v) => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-sky-950/75"
                        aria-label={
                          showOld ? "Ocultar contraseña" : "Mostrar contraseña"
                        }
                      >
                        {showOld ? <EyeOpenIcon /> : <EyeClosedIcon />}
                      </button>
                    </div>
                  </div>

                  {/* Nueva */}
                  <div>
                    <label className="ml-2 block">Nueva contraseña *</label>
                    <div className="relative">
                      <input
                        type={showNew ? "text" : "password"}
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="••••••••"
                        required
                        className="w-full rounded-2xl border border-sky-950/10 bg-white/50 p-2 px-3 outline-none backdrop-blur placeholder:font-light placeholder:tracking-wide dark:border-white/10 dark:bg-white/10 dark:text-white"
                      />
                      <button
                        type="button"
                        onClick={() => setShowNew((v) => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-sky-950/75"
                        aria-label={
                          showNew ? "Ocultar contraseña" : "Mostrar contraseña"
                        }
                      >
                        {showNew ? <EyeOpenIcon /> : <EyeClosedIcon />}
                      </button>
                    </div>
                    <p className="mt-1 text-xs opacity-70">
                      Debe tener mínimo 8 caracteres e incluir mayúscula,
                      minúscula, número y símbolo.
                    </p>
                  </div>

                  {/* Repetir */}
                  <div>
                    <label className="ml-2 block">Repetir contraseña *</label>
                    <div className="relative">
                      <input
                        type={showRepeat ? "text" : "password"}
                        value={repeatPassword}
                        onChange={(e) => setRepeatPassword(e.target.value)}
                        placeholder="••••••••"
                        required
                        className="w-full rounded-2xl border border-sky-950/10 bg-white/50 p-2 px-3 outline-none backdrop-blur placeholder:font-light placeholder:tracking-wide dark:border-white/10 dark:bg-white/10 dark:text-white"
                      />
                      <button
                        type="button"
                        onClick={() => setShowRepeat((v) => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-sky-950/75"
                        aria-label={
                          showRepeat
                            ? "Ocultar contraseña"
                            : "Mostrar contraseña"
                        }
                      >
                        {showRepeat ? <EyeOpenIcon /> : <EyeClosedIcon />}
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 flex justify-end gap-2">
                    <button
                      className="rounded-full bg-sky-100 px-6 py-2 text-sky-950 shadow-sm shadow-sky-950/20 transition-transform hover:scale-95 active:scale-90 disabled:opacity-60 dark:bg-white/10 dark:text-white dark:backdrop-blur"
                      onClick={() => setPwdModalOpen(false)}
                      disabled={pwdSubmitting}
                      type="button"
                    >
                      Cancelar
                    </button>
                    <button
                      className="rounded-full bg-sky-100 px-6 py-2 text-sky-950 shadow-sm shadow-sky-950/20 transition-transform hover:scale-95 active:scale-90 disabled:opacity-60 dark:bg-white/10 dark:text-white dark:backdrop-blur"
                      onClick={submitPasswordChange}
                      disabled={pwdSubmitting}
                      type="button"
                    >
                      {pwdSubmitting ? <Spinner /> : "Guardar"}
                    </button>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        <ToastContainer
          position="top-right"
          autoClose={3500}
          newestOnTop
          closeOnClick
          pauseOnHover
        />
      </section>
    </ProtectedRoute>
  );
}

/* ============ Iconitos inline ============ */

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
