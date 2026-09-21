import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Phone, MessageSquare, User } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type Step = 'phone' | 'otp' | 'register'

export default function Login() {
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>('phone')
  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState(['', '', '', '', '', ''])
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const otpRefs = useRef<(HTMLInputElement | null)[]>([])

  useEffect(() => {
    if (step === 'otp') {
      otpRefs.current[0]?.focus()
    }
  }, [step])

  function formatPhone(value: string) {
    const digits = value.replace(/\D/g, '').slice(0, 11)
    if (!digits) return ''
    if (digits.length <= 2) return `(${digits}`
    if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`
  }

  function handlePhoneChange(e: React.ChangeEvent<HTMLInputElement>) {
    setPhone(formatPhone(e.target.value))
  }

  function handleOtpChange(index: number, value: string) {
    const digit = value.replace(/\D/g, '').slice(-1)
    const newOtp = [...otp]
    newOtp[index] = digit
    setOtp(newOtp)
    if (digit && index < 5) {
      otpRefs.current[index + 1]?.focus()
    }
  }

  function handleOtpKeyDown(index: number, e: React.KeyboardEvent) {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      otpRefs.current[index - 1]?.focus()
    }
  }

  async function handlePhoneSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    await new Promise(r => setTimeout(r, 800))
    setLoading(false)
    setStep('otp')
  }

  async function handleOtpSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    await new Promise(r => setTimeout(r, 800))
    setLoading(false)
    // Simulate new user on first access
    const isNewUser = phone.replace(/\D/g, '').includes('8888')
    if (isNewUser) {
      setStep('register')
    } else {
      navigate('/client/schedule')
    }
  }

  async function handleRegisterSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    await new Promise(r => setTimeout(r, 600))
    setLoading(false)
    navigate('/client/schedule')
  }

  return (
    <main className="relative isolate min-h-dvh flex flex-col items-center justify-center px-5 py-10">
      {/* Same barbershop atmosphere as the client layout, so auth feels like the same app. */}
      <div aria-hidden="true" className="fixed inset-0 -z-10 pointer-events-none">
        <img src="/brand/interior.jpg" alt="" width="1536" height="1024" className="h-full w-full object-cover object-[68%_center] md:object-center" />
        <div className="absolute inset-0 bg-black/80" />
      </div>

      <div className="w-full max-w-sm">
        {/* Compact branding */}
        <div className="flex items-center justify-center gap-2.5 mb-5">
          <img src="/brand/app-icon.png" alt="" width="256" height="256" className="h-10 w-10 object-contain shrink-0" />
          <span className="font-display font-bold text-lg tracking-tight">ErickCorttes</span>
        </div>

        {/* Card panel */}
        <div className="border border-[var(--primary)]/20 bg-[var(--surface-bronze)] shadow-[0_12px_36px_rgba(0,0,0,0.45)] rounded-2xl p-5 sm:p-6">

          {/* Step header */}
          <div className="text-center mb-6">
            <div className="w-11 h-11 rounded-full border border-[var(--primary)]/30 bg-[var(--primary)]/10 flex items-center justify-center mx-auto mb-3">
              {step === 'phone' && <Phone className="h-5 w-5 text-[var(--primary)]" />}
              {step === 'otp' && <MessageSquare className="h-5 w-5 text-[var(--primary)]" />}
              {step === 'register' && <User className="h-5 w-5 text-[var(--primary)]" />}
            </div>

            {step === 'phone' && (
              <>
                <h1 className="font-display text-2xl font-bold tracking-tight">Qual é o seu número?</h1>
                <p className="text-sm text-[var(--muted-foreground)] mt-1.5">Informe seu WhatsApp para continuar.</p>
              </>
            )}
            {step === 'otp' && (
              <>
                <h1 className="font-display text-2xl font-bold tracking-tight">Digite o código</h1>
                <p className="text-sm text-[var(--muted-foreground)] mt-1.5">Simulação para</p>
                <p className="text-[var(--foreground)] font-semibold tabular-nums">{phone}</p>
              </>
            )}
            {step === 'register' && (
              <>
                <h1 className="font-display text-2xl font-bold tracking-tight">Primeiro acesso</h1>
                <p className="text-sm text-[var(--muted-foreground)] mt-1.5">Precisamos de mais algumas informações.</p>
              </>
            )}
          </div>

          {/* Step indicators */}
          <div className="flex gap-1.5 justify-center mb-6">
            {(['phone', 'otp', 'register'] as Step[]).map(s => {
              const index = (['phone', 'otp', 'register'] as Step[]).indexOf(s)
              const currentIndex = (['phone', 'otp', 'register'] as Step[]).indexOf(step)
              return (
                <div
                  key={s}
                  className={`h-1 rounded-full transition-all ${
                    s === step ? 'w-6 bg-[var(--primary)]' :
                    index < currentIndex ? 'w-1.5 bg-[var(--primary)]/50' : 'w-1.5 bg-[var(--primary)]/15'
                  }`}
                />
              )
            })}
          </div>

          {/* Phone step */}
          {step === 'phone' && (
            <form onSubmit={handlePhoneSubmit} className="space-y-4">
              <Input
                label="Telefone / WhatsApp"
                type="tel"
                icon={<Phone className="h-4 w-4" />}
                placeholder="(71) 99999-9999"
                value={phone}
                onChange={handlePhoneChange}
                autoComplete="tel"
                inputMode="tel"
                required
              />
              <Button
                type="submit"
                className="w-full h-12 text-base"
                disabled={loading || phone.replace(/\D/g, '').length < 10}
              >
                {loading ? 'Enviando...' : 'Continuar'}
              </Button>
              <p className="text-xs text-center text-[var(--muted-foreground)]">
                Demonstração — nenhuma mensagem real será enviada. Para simular o cadastro, use um telefone com 8888.
              </p>
            </form>
          )}

          {/* OTP step */}
          {step === 'otp' && (
            <form onSubmit={handleOtpSubmit} className="space-y-5">
              <div className="grid grid-cols-6 gap-1.5 sm:gap-2">
                {otp.map((digit, i) => (
                  <input
                    key={i}
                    ref={el => { otpRefs.current[i] = el }}
                    type="text"
                    inputMode="numeric"
                    aria-label={`Dígito ${i + 1} do código`}
                    autoComplete={i === 0 ? "one-time-code" : "off"}
                    onPaste={event => {
                      event.preventDefault()
                      const digits = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6).split('')
                      if (!digits.length) return
                      setOtp(Array.from({ length: 6 }, (_, index) => digits[index] ?? ''))
                      otpRefs.current[Math.min(digits.length, 5)]?.focus()
                    }}
                    maxLength={1}
                    value={digit}
                    onChange={e => handleOtpChange(i, e.target.value)}
                    onKeyDown={e => handleOtpKeyDown(i, e)}
                    className={`w-full min-w-0 h-13 text-center text-lg font-bold tabular-nums bg-[var(--background)] border rounded-xl text-[var(--foreground)] transition-all focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/30 ${
                      digit ? 'border-[var(--primary)]' : 'border-[var(--input-border)]'
                    }`}
                  />
                ))}
              </div>

              <Button
                type="submit"
                className="w-full h-12 text-base"
                disabled={loading || otp.join('').length < 6}
              >
                {loading ? 'Verificando...' : 'Confirmar'}
              </Button>

              <div className="text-center space-y-1">
                <p className="text-xs text-[var(--muted-foreground)]">
                  Demonstração — use qualquer código de 6 dígitos.
                </p>
                <button
                  type="button"
                  className="text-xs text-[var(--primary)] hover:text-[var(--primary-light)] transition-colors min-h-11"
                  onClick={() => { setOtp(['', '', '', '', '', '']); otpRefs.current[0]?.focus() }}
                >
                  Limpar código
                </button>
              </div>
            </form>
          )}

          {/* Register step */}
          {step === 'register' && (
            <form onSubmit={handleRegisterSubmit} className="space-y-4">
              <Input
                label="Seu nome"
                type="text"
                icon={<User className="h-4 w-4" />}
                placeholder="João Silva"
                value={name}
                onChange={e => setName(e.target.value)}
                required
              />
              <Input
                label="WhatsApp"
                type="tel"
                value={phone}
                disabled
              />
              <Input
                label="Data de nascimento (opcional)"
                type="date"
              />
              <Button
                type="submit"
                className="w-full h-12 text-base mt-2"
                disabled={loading || !name.trim()}
              >
                {loading ? 'Criando conta...' : 'Simular cadastro e agendar'}
              </Button>
            </form>
          )}
        </div>

        {/* Secondary escape action */}
        <div className="flex justify-center mt-4">
          <button
            disabled={loading}
            onClick={() => step === 'phone' ? navigate('/') : setStep('phone')}
            className="inline-flex items-center gap-1.5 min-h-11 px-3 text-sm text-[var(--muted-foreground)] hover:text-[var(--primary)] transition-colors disabled:opacity-50"
          >
            <ArrowLeft className="h-4 w-4" />
            Voltar
          </button>
        </div>
      </div>
    </main>
  )
}
