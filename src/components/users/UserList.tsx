// src/components/users/UserList.tsx

"use client";
import { User } from "@/types";
import UserCard from "./UserCard";

interface UserListProps {
  users: User[];
  startEditingUser: (user: User) => void;
  deleteUser: (user: User) => void;
  /** Solo gerentes/desarrolladores -> true */
  isManager?: boolean;
}

export default function UserList({
  users,
  startEditingUser,
  deleteUser,
  isManager = false,
}: UserListProps) {
  if (!users || users.length === 0) {
    return (
      <div
        className="rounded-3xl border border-white/10 bg-white/10 p-6 text-sky-950 backdrop-blur dark:text-white"
        role="status"
        aria-live="polite"
      >
        <p className="text-sm opacity-80">No hay usuarios para mostrar.</p>
      </div>
    );
  }

  return (
    <div
      className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3"
      role="list"
      aria-label="Listado de usuarios"
    >
      {users.map((user) => (
        <UserCard
          key={user.id_user}
          user={user}
          startEditingUser={startEditingUser}
          deleteUser={isManager ? deleteUser : () => {}}
          isManager={isManager}
          // Nota: UserCard decidirá si mostrar/eliminar según que reciba deleteUser y/o un flag propio.
          // Si preferís explícito, podemos agregar un prop canDelete al UserCard.
        />
      ))}
    </div>
  );
}
