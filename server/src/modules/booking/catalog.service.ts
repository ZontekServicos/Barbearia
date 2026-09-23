import { prisma } from "../../config/prisma.js"
import { AppError, ErrorCodes } from "../../utils/errors.js"
import { toPublicService, type PublicService } from "./booking.mapper.js"

export interface ServiceInput {
  name: string
  description: string
  priceCents: number
  durationMinutes: number
  active: boolean
}

/** Catálogo visível ao cliente: somente serviços ativos. */
export async function listActiveServices(): Promise<PublicService[]> {
  const services = await prisma.service.findMany({
    where: { active: true },
    orderBy: [{ priceCents: "asc" }, { name: "asc" }],
  })
  return services.map(toPublicService)
}

/** Catálogo administrativo: inclui inativos quando pedido. */
export async function listServicesForAdmin(includeInactive: boolean): Promise<PublicService[]> {
  const services = await prisma.service.findMany({
    where: includeInactive ? {} : { active: true },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  })
  return services.map(toPublicService)
}

export async function createService(input: ServiceInput): Promise<PublicService> {
  const service = await prisma.service.create({ data: input })
  return toPublicService(service)
}

export async function updateService(
  id: string,
  input: Partial<ServiceInput>,
): Promise<PublicService> {
  const existing = await prisma.service.findUnique({ where: { id } })
  if (!existing) {
    throw AppError.notFound(ErrorCodes.NOT_FOUND, "Serviço não encontrado.")
  }

  const service = await prisma.service.update({ where: { id }, data: input })
  return toPublicService(service)
}

/**
 * Serviços não são apagados: são desativados.
 *
 * Agendamentos antigos referenciam o serviço (FK RESTRICT) e o histórico do
 * cliente precisa continuar íntegro. Desativar some do catálogo sem reescrever
 * o passado.
 */
export async function setServiceActive(id: string, active: boolean): Promise<PublicService> {
  return updateService(id, { active })
}

/** Busca o serviço para reserva. Inativo não pode ser agendado. */
export async function getBookableService(id: string) {
  const service = await prisma.service.findUnique({ where: { id } })

  if (!service || !service.active) {
    throw AppError.notFound(ErrorCodes.NOT_FOUND, "Serviço indisponível.")
  }

  return service
}
