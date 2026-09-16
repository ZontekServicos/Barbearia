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
    const isNewUser = phone.includes('8888')
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
    <div className="min-h-screen bg-[var(--background)] flex flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        {/* Back */}
        <button
          onClick={() => step === 'phone' ? navigate('/') : setStep('phone')}
          className="flex items-center gap-1.5 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors mb-8"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar
        </button>

        {/* Logo */}
        <div className="mb-8 text-center">
          <div className="w-12 h-12 rounded-2xl bg-[var(--primary)]/15 border border-[var(--primary)]/30 flex items-center justify-center mx-auto mb-4">
            {step === 'phone' && <Phone className="h-6 w-6 text-[var(--primary)]" />}
            {step === 'otp' && <MessageSquare className="h-6 w-6 text-[var(--primary)]" />}
            {step === 'register' && <User className="h-6 w-6 text-[var(--primary)]" />}
          </div>

          {step === 'phone' && (
            <>
              <h1 className="text-2xl font-bold tracking-tight">Qual é o seu número?</h1>
              <p className="text-sm text-[var(--muted-foreground)] mt-2">Usamos seu WhatsApp para confirmar o agendamento.</p>
            </>
          )}
          {step === 'otp' && (
            <>
              <h1 className="text-2xl font-bold tracking-tight">Digite o código</h1>
              <p className="text-sm text-[var(--muted-foreground)] mt-2">
                Enviamos um código para<br />
                <span className="text-[var(--foreground)] font-medium">{phone}</span>
              </p>
            </>
          )}
          {step === 'register' && (
            <>
              <h1 className="text-2xl font-bold tracking-tight">Primeiro acesso</h1>
              <p className="text-sm text-[var(--muted-foreground)] mt-2">Precisamos de mais algumas informações.</p>
            </>
          )}
        </div>

        {/* Step indicators */}
        <div className="flex gap-1.5 justify-center mb-8">
          {(['phone', 'otp', 'register'] as Step[]).map(s => (
            <div
              key={s}
              className={`h-1 rounded-full transition-all ${
                s === step ? 'w-8 bg-[var(--primary)]' :
                ['phone', 'otp', 'register'].indexOf(s) < ['phone', 'otp', 'register'].indexOf(step)
                  ? 'w-4 bg-[var(--primary)]/40'
                  : 'w-4 bg-[var(--border)]'
              }`}
            />
          ))}
        </div>

        {/* Phone step */}
        {step === 'phone' && (
          <form onSubmit={handlePhoneSubmit} className="space-y-4">
            <Input
              label="Telefone / WhatsApp"
              type="tel"
              placeholder="(71) 99999-9999"
              value={phone}
              onChange={handlePhoneChange}
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
          </form>
        )}

        {/* OTP step */}
        {step === 'otp' && (
          <form onSubmit={handleOtpSubmit} className="space-y-6">
            <div>
              <p className="text-sm text-center text-[var(--muted-foreground)] mb-4">Código de 6 dígitos</p>
              <div className="flex gap-2 justify-center">
                {otp.map((digit, i) => (
                  <input
                    key={i}
                    ref={el => { otpRefs.current[i] = el }}
                    type="text"
                    inputMode="numeric"
                    aria-label={`Dígito ${i + 1} do código`}
                    maxLength={1}
                    value={digit}
                    onChange={e => handleOtpChange(i, e.target.value)}
                    onKeyDown={e => handleOtpKeyDown(i, e)}
                    className="w-11 h-14 text-center text-xl font-bold bg-[var(--secondary)] border border-[var(--border)] rounded-xl text-[var(--foreground)] outline-none focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)]/30 transition-all"
                  />
                ))}
              </div>
            </div>

            <Button
              type="submit"
              className="w-full h-12 text-base"
              disabled={loading || otp.join('').length < 6}
            >
              {loading ? 'Verificando...' : 'Confirmar'}
            </Button>

            <p className="text-center text-sm text-[var(--muted-foreground)]">
              Não recebeu?{' '}
              <button
                type="button"
                className="text-[var(--primary)] hover:underline"
                onClick={() => setOtp(['', '', '', '', '', ''])}
              >
                Reenviar código
              </button>
            </p>
          </form>
        )}

        {/* Register step */}
        {step === 'register' && (
          <form onSubmit={handleRegisterSubmit} className="space-y-4">
            <Input
              label="Seu nome"
              type="text"
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
              {loading ? 'Criando conta...' : 'Criar conta e agendar'}
            </Button>
          </form>
        )}
      </div>
    </div>
  )
}
