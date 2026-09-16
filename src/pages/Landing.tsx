import { Link } from 'react-router-dom'
import {
  ArrowRight, Scissors, Clock, MapPin,
  Phone, Star, ChevronRight, AtSign
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DemoNotice } from '@/components/DemoNotice'
import { Logo } from '@/components/Logo'
import { SERVICES, BUSINESS_HOURS } from '@/data/mock'

const testimonials = [
  { name: 'Marcos T.', rating: 5, text: 'Melhor barbearia da região. Atendimento impecável, sempre saio satisfeito.' },
  { name: 'André R.', rating: 5, text: 'Profissionalismo de alto nível. A ErickCorttes virou minha barbearia fixa.' },
  { name: 'Felipe M.', rating: 5, text: 'Ambiente incrível e barbeiro talentoso. Vale cada centavo.' },
]

function StarRating({ count }: { count: number }) {
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: count }).map((_, i) => (
        <Star key={i} className="h-3.5 w-3.5 fill-[var(--primary)] text-[var(--primary)]" />
      ))}
    </div>
  )
}

export default function Landing() {
  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-20 bg-[var(--background)]/80 backdrop-blur border-b border-[var(--border)]">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Logo className="h-8 w-8 text-[var(--primary)]" />
            <span className="font-bold text-lg tracking-tight">ErickCorttes</span>
          </div>
          <div className="flex items-center gap-3">
            <Link to="/admin" className="text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors hidden sm:block">
              Área Admin
            </Link>
            <Button asChild size="sm">
              <Link to="/client/schedule">Agendar</Link>
            </Button>
          </div>
        </div>
      </header>

      <main>
      {/* Hero */}
      <section className="pt-32 pb-24 px-6 relative overflow-hidden">
        {/* Decorative grid */}
        <div className="absolute inset-0 opacity-5" style={{
          backgroundImage: 'linear-gradient(var(--border) 1px, transparent 1px), linear-gradient(90deg, var(--border) 1px, transparent 1px)',
          backgroundSize: '40px 40px'
        }} />
        {/* Gold glow */}
        <div className="absolute top-24 left-1/2 -translate-x-1/2 w-96 h-96 rounded-full bg-[var(--primary)]/8 blur-3xl pointer-events-none" />

        <div className="max-w-4xl mx-auto text-center relative z-10">
          <DemoNotice />
          <div className="inline-flex items-center gap-2 border border-[var(--primary)]/30 bg-[var(--primary)]/10 rounded-full px-4 py-1.5 text-sm text-[var(--primary)] font-medium mb-8">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--primary)] animate-pulse" />
            Explore o agendamento
          </div>

          <h1 className="text-5xl md:text-7xl font-bold tracking-tighter leading-none mb-6">
            Estilo e precisão.<br />
            <span className="text-[var(--primary)]">Sem complicação.</span>
          </h1>

          <p className="text-[var(--muted-foreground)] text-lg md:text-xl max-w-xl mx-auto mb-10">
            Barbearia premium com atendimento rápido e descomplicado. Explore o fluxo de agendamento pelo celular.
          </p>

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button asChild size="lg" className="text-base h-12 px-8">
              <Link to="/client/schedule">
                Agendar horário <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="text-base h-12 px-8">
              <Link to="/client">
                Ver mais <ChevronRight className="ml-1 h-4 w-4" />
              </Link>
            </Button>
          </div>

          <div className="mt-12 flex items-center justify-center gap-6 text-sm text-[var(--muted-foreground)]">
            <div className="flex items-center gap-1.5">
              <div className="flex -space-x-1">
                {['J', 'L', 'P', 'R'].map((l, i) => (
                  <div key={i} className="w-6 h-6 rounded-full bg-[var(--secondary)] border border-[var(--border)] flex items-center justify-center text-xs font-medium">
                    {l}
                  </div>
                ))}
              </div>
              <span>+200 clientes</span>
            </div>
            <div className="flex items-center gap-1">
              <StarRating count={5} />
              <span>4.9/5.0</span>
            </div>
          </div>
        </div>
      </section>

      {/* Divider */}
      <div className="max-w-5xl mx-auto px-6">
        <div className="h-px bg-gradient-to-r from-transparent via-[var(--primary)]/40 to-transparent" />
      </div>

      {/* Services */}
      <section className="py-20 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <p className="text-[var(--primary)] text-sm font-medium tracking-widest uppercase mb-3">Serviços</p>
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight">O que oferecemos</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {SERVICES.filter(s => s.active).map((service) => (
              <div
                key={service.id}
                className="group border border-[var(--border)] bg-[var(--card)] rounded-2xl p-6 hover:border-[var(--primary)]/50 transition-all hover:shadow-[0_0_20px_rgba(212,175,55,0.08)]"
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="w-10 h-10 rounded-xl bg-[var(--primary)]/15 flex items-center justify-center">
                    <Scissors className="h-5 w-5 text-[var(--primary)]" />
                  </div>
                  <span className="text-2xl font-bold text-[var(--primary)]">
                    R$ {service.price}
                  </span>
                </div>
                <h3 className="font-semibold text-lg mb-1">{service.name}</h3>
                <p className="text-sm text-[var(--muted-foreground)] mb-3">{service.description}</p>
                <div className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
                  <Clock className="h-3.5 w-3.5" />
                  <span>{service.duration} minutos</span>
                </div>
              </div>
            ))}
          </div>

          <div className="text-center mt-10">
            <Button asChild size="lg">
              <Link to="/client/schedule">
                Agendar agora <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Divider */}
      <div className="max-w-5xl mx-auto px-6">
        <div className="h-px bg-gradient-to-r from-transparent via-[var(--border)] to-transparent" />
      </div>

      {/* Hours & Info */}
      <section className="py-20 px-6">
        <div className="max-w-5xl mx-auto grid md:grid-cols-2 gap-12">
          {/* Hours */}
          <div>
            <p className="text-[var(--primary)] text-sm font-medium tracking-widest uppercase mb-3">Horários</p>
            <h2 className="text-2xl font-bold tracking-tight mb-6">Funcionamento</h2>
            <div className="space-y-2">
              {BUSINESS_HOURS.map((h) => (
                <div key={h.day} className="flex items-center justify-between py-2 border-b border-[var(--border)] last:border-0">
                  <span className={`text-sm font-medium ${h.open ? 'text-[var(--foreground)]' : 'text-[var(--muted-foreground)]'}`}>
                    {h.day}
                  </span>
                  {h.open ? (
                    <span className="text-sm text-[var(--foreground)]">{h.start} – {h.end}</span>
                  ) : (
                    <span className="text-xs bg-[var(--secondary)] text-[var(--muted-foreground)] px-2 py-0.5 rounded-full">Fechado</span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Info */}
          <div>
            <p className="text-[var(--primary)] text-sm font-medium tracking-widest uppercase mb-3">Localização</p>
            <h2 className="text-2xl font-bold tracking-tight mb-6">Onde estamos</h2>

            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-lg bg-[var(--secondary)] flex items-center justify-center shrink-0 mt-0.5">
                  <MapPin className="h-4.5 w-4.5 text-[var(--primary)]" />
                </div>
                <div>
                  <p className="font-medium text-sm">Endereço</p>
                  <p className="text-[var(--muted-foreground)] text-sm">Rua das Palmeiras, 142 — Bairro Novo<br />Salvador, BA – 41000-000</p>
                </div>
              </div>

              <a
                href="https://wa.me/5571999990000"
                className="flex items-center gap-3 group"
              >
                <div className="w-9 h-9 rounded-lg bg-[var(--secondary)] flex items-center justify-center shrink-0">
                  <Phone className="h-4.5 w-4.5 text-[var(--primary)]" />
                </div>
                <div>
                  <p className="font-medium text-sm">WhatsApp</p>
                  <p className="text-[var(--muted-foreground)] text-sm group-hover:text-[var(--primary)] transition-colors">(71) 99999-0000</p>
                </div>
              </a>

              <a
                href="https://instagram.com/erickcorttes"
                className="flex items-center gap-3 group"
              >
                <div className="w-9 h-9 rounded-lg bg-[var(--secondary)] flex items-center justify-center shrink-0">
                  <AtSign className="h-4.5 w-4.5 text-[var(--primary)]" />
                </div>
                <div>
                  <p className="font-medium text-sm">Instagram</p>
                  <p className="text-[var(--muted-foreground)] text-sm group-hover:text-[var(--primary)] transition-colors">@erickcorttes</p>
                </div>
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Divider */}
      <div className="max-w-5xl mx-auto px-6">
        <div className="h-px bg-gradient-to-r from-transparent via-[var(--border)] to-transparent" />
      </div>

      {/* Testimonials */}
      <section className="py-20 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <p className="text-[var(--primary)] text-sm font-medium tracking-widest uppercase mb-3">Depoimentos</p>
            <h2 className="text-3xl font-bold tracking-tight">O que dizem nossos clientes</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {testimonials.map((t, i) => (
              <div key={i} className="border border-[var(--border)] bg-[var(--card)] rounded-2xl p-6">
                <StarRating count={t.rating} />
                <p className="mt-3 text-[var(--muted-foreground)] text-sm leading-relaxed">"{t.text}"</p>
                <div className="mt-4 flex items-center gap-2">
                  <div className="w-7 h-7 rounded-full bg-[var(--primary)]/20 flex items-center justify-center text-xs font-bold text-[var(--primary)]">
                    {t.name[0]}
                  </div>
                  <span className="text-sm font-medium">{t.name}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA final */}
      <section className="py-20 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="border border-[var(--primary)]/30 bg-gradient-to-b from-[var(--card)] to-[var(--background)] rounded-3xl p-10 text-center relative overflow-hidden">
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-64 h-64 rounded-full bg-[var(--primary)]/5 blur-3xl" />
            </div>
            <div className="relative z-10">
              <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">
                Pronto para o visual perfeito?
              </h2>
              <p className="text-[var(--muted-foreground)] mb-8 max-w-md mx-auto">
                Agende agora em menos de 1 minuto. Sem cadastro complicado.
              </p>
              <Button asChild size="lg" className="text-base h-12 px-10">
                <Link to="/client/schedule">
                  Agendar horário <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      </main>
      {/* Footer */}
      <footer className="border-t border-[var(--border)] py-8 px-6">
        <div className="max-w-5xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-[var(--muted-foreground)]">
          <div className="flex items-center gap-2">
            <Logo className="h-4 w-4 text-[var(--primary)]" />
            <span className="font-medium text-[var(--foreground)]">ErickCorttes</span>
          </div>
          <p>© 2026 ErickCorttes. Todos os direitos reservados.</p>
          <Link to="/admin" className="min-h-11 inline-flex items-center hover:text-[var(--foreground)] transition-colors">Área administrativa</Link>
        </div>
      </footer>
    </div>
  )
}
