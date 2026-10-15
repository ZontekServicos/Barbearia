import { Link } from 'react-router-dom'
import { CalendarClock, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * Configurações.
 *
 * O editor de "Horários de Funcionamento" saiu daqui.
 *
 * Ele escrevia em `business_hours`, que deixou de decidir a disponibilidade
 * quando a agenda passou a ser aberta manualmente — e um dia só cabia num par
 * abre/fecha com um intervalo, o que não expressa duas faixas nem exceção por
 * data. Mantê-lo seria pior que removê-lo: o administrador salvaria o
 * expediente e a agenda não mudaria, porque ninguém mais lê aquela tabela.
 *
 * O expediente agora vive em Disponibilidade → Abertura da agenda, que é uma
 * fonte só para a grade pública, a grade administrativa e a reserva.
 */
export default function Settings() {
  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Configurações</h2>
        <p className="text-sm text-[var(--muted-foreground)] mt-1">
          Onde ajustar o que a barbearia atende.
        </p>
      </div>

      <section className="border border-[var(--primary)]/25 bg-[var(--surface-bronze)] rounded-2xl p-5">
        <div className="flex items-start gap-3">
          <CalendarClock className="h-5 w-5 text-[var(--primary)] shrink-0 mt-0.5" />
          <div className="min-w-0">
            <h3 className="text-base font-semibold">Horário de atendimento</h3>
            <p className="text-sm text-[var(--muted-foreground)] mt-1">
              Os dias e faixas em que a agenda aceita agendamento ficam em{' '}
              <strong className="text-[var(--foreground)]">Abertura da agenda</strong>. Lá dá para
              ter mais de uma faixa no mesmo dia e abrir ou fechar datas específicas.
            </p>
            <Button className="mt-4 h-11" asChild>
              <Link to="/admin/availability">Abrir disponibilidade</Link>
            </Button>
          </div>
        </div>
      </section>

      {/*
        Dados da barbearia e regras de antecedência ainda não têm persistência.
        Em vez de manter formulários que descartam o que é digitado, o estado
        real está declarado aqui.
      */}
      <section>
        <div className="flex items-start gap-2 border border-[var(--border)] bg-[var(--card)] rounded-2xl p-4">
          <Info className="h-4 w-4 text-[var(--primary)] shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium">Ainda não configurável por aqui</p>
            <p className="text-xs text-[var(--muted-foreground)] mt-1">
              Dados de contato da barbearia e regras de antecedência (mínima, máxima e prazo de
              cancelamento) são aplicados pelo backend, mas ainda não têm tela de edição. Bloqueios
              pontuais de agenda são feitos na própria disponibilidade.
            </p>
          </div>
        </div>
      </section>
    </div>
  )
}
