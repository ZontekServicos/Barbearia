import { Link } from 'react-router-dom'
import {
  ArrowRight, Scissors, Clock, MapPin,
  Phone, ChevronRight, AtSign,
  ShieldCheck, CalendarDays, CalendarCheck
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Logo } from '@/components/Logo'
import { SERVICES, BUSINESS_HOURS } from '@/data/mock'

export default function Landing() {
  return (
    <div className="relative isolate min-h-screen text-[var(--foreground)]">
      <div aria-hidden="true" className="fixed inset-0 -z-10 pointer-events-none">
        <img src="/brand/interior.jpg" alt="" fetchPriority="high" width="1536" height="1024" className="h-full w-full object-cover object-[68%_center] md:object-center" />
        <div className="absolute inset-0 bg-black/70" />
      </div>
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-20 bg-[var(--background)]/85 backdrop-blur-md">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <img src="/brand/app-icon.png" alt="" width="256" height="256" className="w-12 h-12 sm:w-14 sm:h-14 object-contain shrink-0" />
            <div className="flex flex-col leading-none">
              <span className="font-display font-bold text-lg sm:text-xl tracking-tight">ErickCorttes</span>
              <span className="hidden sm:block text-[10px] tracking-[0.25em] text-[var(--muted-foreground)] uppercase mt-1">Barbearia</span>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <Link
              to="/admin"
              className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--muted-foreground)] hover:text-[var(--primary)] hover:border-[var(--primary)]/40 transition-colors"
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              Área Admin
            </Link>
            <Button asChild size="sm">
              <Link to="/login">Agendar</Link>
            </Button>
          </div>
        </div>
        <div className="h-px bg-gradient-to-r from-transparent via-[var(--primary)]/45 to-transparent" />
      </header>

      <main className="[&>section:not(:first-child)]:bg-[var(--background)]/40">
      {/* Hero */}
      <section className="relative overflow-hidden pt-28 sm:pt-36 pb-14 sm:pb-24 px-6">

        {/* No z-index here: a stacking context would isolate the logo's blend mode from the photo behind it. */}
        <div className="max-w-4xl mx-auto text-center relative">

          {/* Main brand logo — the JPEG's black canvas is knocked out by screen blending,
              with the circular crop as a fallback if blend modes are unavailable. */}
          <img
            src="/brand/logo-principal.jpg"
            alt="ErickCorttes Barbearia"
            width="1024"
            height="1536"
            fetchPriority="high"
            className="w-44 h-44 sm:w-56 sm:h-56 rounded-full object-cover object-[center_45%] mx-auto mb-6 mix-blend-screen"
          />

          <h1 className="font-sans font-normal text-[var(--foreground)] text-base md:text-lg max-w-md mx-auto mb-7">
            Agende seu horário pelo celular de forma rápida e sem complicação.
          </h1>
          <Button asChild size="lg" className="w-full sm:w-auto text-base h-12 px-8">
            <Link to="/login">Agendar horário <ArrowRight className="ml-2 h-4 w-4" /></Link>
          </Button>
        </div>
      </section>

      {/* Divider */}
      <div className="max-w-5xl mx-auto px-6">
        <div className="h-px bg-gradient-to-r from-transparent via-[var(--primary)]/40 to-transparent" />
      </div>

      {/* Services */}
      <section id="servicos" className="py-20 px-6 scroll-mt-24">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="font-sans text-[var(--primary)] text-sm font-medium tracking-widest uppercase">Serviços</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {SERVICES.filter(s => s.active).map((service) => (
              <div
                key={service.id}
                className="group relative border border-[var(--border)] bg-[var(--card)] shadow-[0_4px_14px_rgba(0,0,0,0.35)] rounded-2xl p-6 transition-all hover:-translate-y-1 hover:border-[var(--primary)]/50 hover:shadow-[0_12px_32px_rgba(201,169,98,0.12)]"
              >
                <div className="absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-[var(--primary)]/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />

                <div className="flex items-start justify-between mb-5">
                  <div className="w-12 h-12 rounded-full border border-[var(--primary)]/30 bg-[var(--primary)]/10 flex items-center justify-center">
                    <Scissors className="h-5.5 w-5.5 text-[var(--primary)]" />
                  </div>
                  <span className="font-display text-2xl font-bold text-[var(--primary)]">
                    R$ {service.price}
                  </span>
                </div>
                <h3 className="font-semibold text-lg mb-1.5">{service.name}</h3>
                <p className="text-sm text-[var(--muted-foreground)] mb-4 min-h-10">{service.description}</p>

                <div className="flex items-center justify-between pt-4 border-t border-[var(--border)]">
                  <div className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
                    <Clock className="h-3.5 w-3.5" />
                    <span>{service.duration} minutos</span>
                  </div>
                  <Link
                    to="/login"
                    className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-[var(--primary)] hover:text-[var(--primary-light)] transition-colors"
                  >
                    Agendar
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </div>
            ))}
          </div>

          <div className="text-center mt-10">
            <Button asChild size="lg">
              <Link to="/login">
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

      {/* How it works */}
      <section id="como-funciona" className="py-12 sm:py-16 px-6">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="font-sans text-[var(--primary)] text-sm font-medium tracking-widest uppercase">Como funciona</h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {[
              { icon: Scissors, step: '1', title: 'Escolha o serviço', text: 'Selecione o corte, barba ou combo que você precisa.' },
              { icon: CalendarDays, step: '2', title: 'Selecione o horário', text: 'Escolha um dia e horário na agenda de exemplo.' },
              { icon: CalendarCheck, step: '3', title: 'Confirme', text: 'Revise os detalhes e conclua a simulação.' },
            ].map(({ icon: Icon, step, title, text }) => (
              <div key={step} className="relative pl-16 sm:pl-0 sm:text-center">
                <div className="w-14 h-14 rounded-full border border-[var(--primary)]/30 bg-[var(--primary)]/10 flex items-center justify-center absolute left-0 top-0 sm:relative sm:mx-auto sm:mb-4">
                  <Icon className="h-6 w-6 text-[var(--primary)]" />
                  <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-[var(--primary)] text-[var(--primary-foreground)] text-[11px] font-bold flex items-center justify-center">
                    {step}
                  </span>
                </div>
                <h3 className="font-semibold text-base mb-1.5">{title}</h3>
                <p className="text-sm text-[var(--muted-foreground)]">{text}</p>
              </div>
            ))}
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
            <h2 className="font-sans text-[var(--primary)] text-sm font-medium tracking-widest uppercase mb-6">Horários</h2>
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
            <h2 className="font-sans text-[var(--primary)] text-sm font-medium tracking-widest uppercase mb-6">Localização</h2>

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

      {/* CTA final */}
      <section className="py-20 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="border border-[var(--primary)]/30 bg-gradient-to-b from-[var(--card)] to-[var(--background)] rounded-3xl p-10 text-center relative overflow-hidden">
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-64 h-64 rounded-full bg-[var(--primary)]/5 blur-3xl" />
            </div>
            <div className="relative z-10">
              <Button asChild size="lg" className="text-base h-12 px-10">
                <Link to="/login">
                  Agendar horário <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      </main>
      {/* Footer */}
      <footer className="border-t border-[var(--border)] bg-[var(--background)]/80 py-8 px-6">
        <div className="max-w-5xl mx-auto flex flex-col items-center gap-4 text-sm text-[var(--muted-foreground)]">
          <div className="flex items-center gap-2">
            <Logo className="h-4 w-4 text-[var(--primary)]" />
            <span className="font-display font-semibold text-[var(--foreground)]">ErickCorttes</span>
          </div>
          <p className="text-xs tracking-widest uppercase text-[var(--primary)]/80">Mais que um corte, um estilo de vida</p>
          <div className="w-full flex flex-col md:flex-row items-center justify-between gap-3">
            <p>© 2026 ErickCorttes. Todos os direitos reservados.</p>
            <Link to="/admin" className="min-h-11 inline-flex items-center hover:text-[var(--foreground)] transition-colors">Área administrativa</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
