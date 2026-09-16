// Demo fixtures only. Availability and booking rules must be revalidated atomically
// by a future authenticated backend before any real reservation is confirmed.
export interface Service {
  id: string
  name: string
  description: string
  price: number
  duration: number
  active: boolean
}

export const SERVICES: Service[] = [
  { id: 's1', name: 'Corte', description: 'Corte masculino clássico e moderno', price: 35, duration: 40, active: true },
  { id: 's2', name: 'Barba', description: 'Modelagem, aparar e acabamento perfeito', price: 25, duration: 30, active: true },
  { id: 's3', name: 'Corte + Barba', description: 'Combo completo com desconto especial', price: 55, duration: 60, active: true },
  { id: 's4', name: 'Hidratação Capilar', description: 'Tratamento com produtos premium', price: 40, duration: 30, active: true },
  { id: 's5', name: 'Sobrancelha', description: 'Design e acabamento das sobrancelhas', price: 15, duration: 15, active: false },
]

export type AppointmentStatus = 'confirmed' | 'completed' | 'cancelled' | 'missed'

export interface Appointment {
  id: string
  clientId: string
  clientName: string
  clientPhone: string
  serviceId: string
  serviceName: string
  servicePrice: number
  serviceDuration: number
  date: string
  time: string
  status: AppointmentStatus
  notes?: string
}

export const APPOINTMENTS: Appointment[] = [
  { id: 'a1', clientId: 'c1', clientName: 'João Silva', clientPhone: '(71) 99999-1111', serviceId: 's1', serviceName: 'Corte', servicePrice: 35, serviceDuration: 40, date: '2026-09-15', time: '09:00', status: 'confirmed' },
  { id: 'a2', clientId: 'c2', clientName: 'Lucas Santos', clientPhone: '(71) 99999-2222', serviceId: 's3', serviceName: 'Corte + Barba', servicePrice: 55, serviceDuration: 60, date: '2026-09-15', time: '09:40', status: 'confirmed' },
  { id: 'a3', clientId: 'c3', clientName: 'Pedro Lima', clientPhone: '(71) 99999-3333', serviceId: 's2', serviceName: 'Barba', servicePrice: 25, serviceDuration: 30, date: '2026-09-15', time: '10:40', status: 'confirmed' },
  { id: 'a4', clientId: 'c4', clientName: 'Rafael Costa', clientPhone: '(71) 99999-4444', serviceId: 's1', serviceName: 'Corte', servicePrice: 35, serviceDuration: 40, date: '2026-09-15', time: '11:10', status: 'confirmed' },
  { id: 'a5', clientId: 'c5', clientName: 'Bruno Alves', clientPhone: '(71) 99999-5555', serviceId: 's3', serviceName: 'Corte + Barba', servicePrice: 55, serviceDuration: 60, date: '2026-09-15', time: '14:00', status: 'completed' },
  { id: 'a6', clientId: 'c6', clientName: 'Caio Pereira', clientPhone: '(71) 99999-6666', serviceId: 's1', serviceName: 'Corte', servicePrice: 35, serviceDuration: 40, date: '2026-09-15', time: '15:00', status: 'cancelled' },
  { id: 'a7', clientId: 'c7', clientName: 'Diego Rocha', clientPhone: '(71) 99999-7777', serviceId: 's2', serviceName: 'Barba', servicePrice: 25, serviceDuration: 30, date: '2026-09-15', time: '16:00', status: 'missed' },
  { id: 'a8', clientId: 'c1', clientName: 'João Silva', clientPhone: '(71) 99999-1111', serviceId: 's3', serviceName: 'Corte + Barba', servicePrice: 55, serviceDuration: 60, date: '2026-09-01', time: '10:00', status: 'completed' },
  { id: 'a9', clientId: 'c1', clientName: 'João Silva', clientPhone: '(71) 99999-1111', serviceId: 's1', serviceName: 'Corte', servicePrice: 35, serviceDuration: 40, date: '2026-09-18', time: '14:00', status: 'confirmed' },
  { id: 'a10', clientId: 'c1', clientName: 'João Silva', clientPhone: '(71) 99999-1111', serviceId: 's3', serviceName: 'Corte + Barba', servicePrice: 55, serviceDuration: 60, date: '2026-09-25', time: '10:00', status: 'confirmed' },
  { id: 'a11', clientId: 'c2', clientName: 'Lucas Santos', clientPhone: '(71) 99999-2222', serviceId: 's1', serviceName: 'Corte', servicePrice: 35, serviceDuration: 40, date: '2026-09-08', time: '09:00', status: 'completed' },
  { id: 'a12', clientId: 'c7', clientName: 'Diego Rocha', clientPhone: '(71) 99999-7777', serviceId: 's1', serviceName: 'Corte', servicePrice: 35, serviceDuration: 40, date: '2026-09-10', time: '11:00', status: 'missed' },
]

export interface Client {
  id: string
  name: string
  phone: string
  totalAppointments: number
  completedAppointments: number
  cancelledAppointments: number
  missedAppointments: number
  lastVisit: string
  blocked: boolean
  notes?: string
}

export const CLIENTS: Client[] = [
  { id: 'c1', name: 'João Silva', phone: '(71) 99999-1111', totalAppointments: 12, completedAppointments: 10, cancelledAppointments: 1, missedAppointments: 1, lastVisit: '2026-09-15', blocked: false },
  { id: 'c2', name: 'Lucas Santos', phone: '(71) 99999-2222', totalAppointments: 5, completedAppointments: 5, cancelledAppointments: 0, missedAppointments: 0, lastVisit: '2026-09-15', blocked: false },
  { id: 'c3', name: 'Pedro Lima', phone: '(71) 99999-3333', totalAppointments: 3, completedAppointments: 2, cancelledAppointments: 1, missedAppointments: 0, lastVisit: '2026-09-05', blocked: false },
  { id: 'c4', name: 'Rafael Costa', phone: '(71) 99999-4444', totalAppointments: 8, completedAppointments: 6, cancelledAppointments: 2, missedAppointments: 0, lastVisit: '2026-09-12', blocked: false },
  { id: 'c5', name: 'Bruno Alves', phone: '(71) 99999-5555', totalAppointments: 15, completedAppointments: 12, cancelledAppointments: 2, missedAppointments: 1, lastVisit: '2026-09-15', blocked: false },
  { id: 'c6', name: 'Caio Pereira', phone: '(71) 99999-6666', totalAppointments: 2, completedAppointments: 0, cancelledAppointments: 2, missedAppointments: 0, lastVisit: '2026-08-20', blocked: false, notes: 'Cancelou os dois agendamentos sem aviso' },
  { id: 'c7', name: 'Diego Rocha', phone: '(71) 99999-7777', totalAppointments: 4, completedAppointments: 1, cancelledAppointments: 1, missedAppointments: 2, lastVisit: '2026-09-15', blocked: true, notes: 'Faltou 2 vezes consecutivas. Bloqueado temporariamente.' },
]

export const BUSINESS_HOURS = [
  { day: 'Segunda', open: false, start: '09:00', end: '19:00' },
  { day: 'Terça', open: true, start: '09:00', end: '19:00' },
  { day: 'Quarta', open: true, start: '09:00', end: '19:00' },
  { day: 'Quinta', open: true, start: '09:00', end: '19:00' },
  { day: 'Sexta', open: true, start: '09:00', end: '20:00' },
  { day: 'Sábado', open: true, start: '08:00', end: '18:00' },
  { day: 'Domingo', open: false, start: '09:00', end: '13:00' },
]

export const AVAILABLE_TIMES = [
  '09:00', '09:40', '10:20', '11:00', '11:40',
  '14:00', '14:40', '15:20', '16:00', '16:40', '17:20',
]

// Simulate occupied slots for demo
export const OCCUPIED_TIMES_BY_DATE: Record<string, string[]> = {
  '2026-09-15': ['09:00', '09:40', '10:40', '11:10', '14:00', '15:00', '16:00'],
  '2026-09-17': ['09:00', '11:00', '14:00', '16:00'],
  '2026-09-18': ['09:00', '09:40', '14:00'],
  '2026-09-19': ['10:20', '11:00', '15:20'],
}

// Closed days (0=Sun, 1=Mon, 6=Sat=open, etc.)
export const CLOSED_DAYS = [0, 1] // Sunday and Monday
