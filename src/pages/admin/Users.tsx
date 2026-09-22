import { useCallback, useEffect, useRef, useState } from "react"
import {
  Search,
  Users as UsersIcon,
  Check,
  Ban,
  RotateCcw,
  Phone,
  Calendar,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ApiError } from "@/services/api"
import { listUsers, updateUserStatus } from "@/services/admin"
import type { AuthUser, UserStatus } from "@/services/auth"
import { useAuth } from "@/context/AuthContext"
import { cn } from "@/lib/utils"

const STATUS_LABEL: Record<UserStatus, string> = {
  PENDING: "Pendente",
  ACTIVE: "Ativo",
  BLOCKED: "Bloqueado",
}

const STATUS_BADGE: Record<UserStatus, "warning" | "confirmed" | "blocked"> = {
  PENDING: "warning",
  ACTIVE: "confirmed",
  BLOCKED: "blocked",
}

const FILTERS: Array<{
  label: string
  value: UserStatus | "ALL"
}> = [
  { label: "Todos", value: "ALL" },
  { label: "Pendentes", value: "PENDING" },
  { label: "Ativos", value: "ACTIVE" },
  { label: "Bloqueados", value: "BLOCKED" },
]

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  })
}

export default function AdminUsers() {
  const { user: currentUser } = useAuth()
  const [users, setUsers] = useState<AuthUser[]>([])
  const [filter, setFilter] = useState<UserStatus | "ALL">("PENDING")
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const loadRevision = useRef(0)
  const [actingOn, setActingOn] = useState<string | null>(null)

  const load = useCallback(async () => {
    const startedAt = ++loadRevision.current
    setLoading(true)
    setError(null)
    try {
      const result = await listUsers({
        ...(filter === "ALL" ? {} : { status: filter }),
        ...(search.trim() ? { search: search.trim() } : {}),
        page,
        perPage: 20,
      })
      if (startedAt !== loadRevision.current) return
      if (page > result.totalPages) {
        setPage(result.totalPages)
        return
      }
      setUsers(result.users)
      setTotalPages(result.totalPages)
    } catch (err) {
      if (startedAt !== loadRevision.current) return
      setError(
        err instanceof ApiError
          ? err.message
          : "Não foi possível carregar os usuários.",
      )
    } finally {
      if (startedAt === loadRevision.current) setLoading(false)
    }
  }, [filter, search, page])

  useEffect(() => {
    const timer = setTimeout(() => void load(), search ? 350 : 0)
    return () => {
      clearTimeout(timer)
      loadRevision.current++
    }
  }, [load, search])

  async function handleStatusChange(userId: string, status: UserStatus) {
    setActingOn(userId)
    setError(null)
    try {
      await updateUserStatus(userId, status)
      await load()
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Não foi possível atualizar o usuário.",
      )
    } finally {
      setActingOn(null)
    }
  }

  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <h2 className="text-2xl font-bold tracking-tight">Usuários</h2>
        <p className="text-sm text-[var(--muted-foreground)] mt-1">
          Aprove novos cadastros e gerencie o acesso dos clientes.
        </p>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-2 mb-4">
        {FILTERS.map((item) => (
          <button
            key={item.value}
            onClick={() => {
              setFilter(item.value)
              setPage(1)
            }}
            aria-pressed={filter === item.value}
            className={cn(
              "min-h-11 px-4 rounded-full border text-sm font-medium transition-colors",
              filter === item.value
                ? "border-[var(--primary)] bg-[var(--primary)]/15 text-[var(--primary)]"
                : "border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      {/* Busca */}
      <div className="relative mb-5">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--muted-foreground)]" />
        <input
          type="search"
          aria-label="Buscar usuários por nome ou telefone"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setPage(1)
          }}
          placeholder="Buscar por nome ou telefone..."
          className="w-full pl-10 pr-4 py-3 rounded-xl border border-[var(--primary)]/20 bg-[var(--background)] text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] outline-none focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)]/30 transition-all"
        />
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-400 mb-4">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-[var(--muted-foreground)]" role="status">
          Carregando usuários…
        </p>
      ) : users.length === 0 ? (
        <div className="border border-dashed border-[var(--primary)]/25 bg-[var(--surface-bronze)] rounded-2xl p-8 text-center">
          <UsersIcon className="h-10 w-10 text-[var(--muted-foreground)]/40 mx-auto mb-3" />
          <p className="text-[var(--muted-foreground)] text-sm">
            Nenhum usuário{" "}
            {filter === "ALL"
              ? "cadastrado"
              : `com status “${STATUS_LABEL[filter]}”`}
            .
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {users.map((user) => {
            const isSelf = user.id === currentUser?.id
            const busy = actingOn === user.id
            return (
              <div
                key={user.id}
                className="border border-[var(--primary)]/20 bg-[var(--surface-bronze)] shadow-[0_4px_14px_rgba(0,0,0,0.35)] rounded-2xl p-4"
              >
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-[var(--foreground)] truncate">
                        {user.fullName ?? "Sem nome"}
                      </p>
                      {user.role === "ADMIN" && (
                        <Badge variant="default">Admin</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)] mt-1">
                      <Phone className="h-3 w-3 shrink-0" />
                      <span className="tabular-nums">
                        {user.phoneFormatted}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)] mt-0.5">
                      <Calendar className="h-3 w-3 shrink-0" />
                      <span>Cadastro em {formatDate(user.createdAt)}</span>
                    </div>
                  </div>
                  <Badge variant={STATUS_BADGE[user.status]}>
                    {STATUS_LABEL[user.status]}
                  </Badge>
                </div>

                {isSelf ? (
                  <p className="text-xs text-[var(--muted-foreground)]">
                    Esta é a sua própria conta.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {user.status !== "ACTIVE" && (
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() =>
                          void handleStatusChange(user.id, "ACTIVE")
                        }
                      >
                        <Check className="h-3.5 w-3.5 mr-1.5" />
                        {user.status === "PENDING" ? "Aprovar" : "Reativar"}
                      </Button>
                    )}
                    {user.status !== "BLOCKED" && (
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={busy}
                        onClick={() =>
                          void handleStatusChange(user.id, "BLOCKED")
                        }
                      >
                        <Ban className="h-3.5 w-3.5 mr-1.5" />
                        Bloquear
                      </Button>
                    )}
                    {user.status === "ACTIVE" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          void handleStatusChange(user.id, "PENDING")
                        }
                      >
                        <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                        Voltar para pendente
                      </Button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
      <nav
        aria-label="Paginação de usuários"
        className="flex items-center justify-between gap-3 mt-5"
      >
        <Button
          variant="outline"
          disabled={loading || page <= 1}
          onClick={() => setPage((p) => p - 1)}
        >
          Anterior
        </Button>
        <span className="text-sm" aria-live="polite">
          Página {page} de {totalPages}
        </span>
        <Button
          variant="outline"
          disabled={loading || page >= totalPages}
          onClick={() => setPage((p) => p + 1)}
        >
          Próxima
        </Button>
      </nav>
    </div>
  )
}
