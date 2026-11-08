import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router'
import { Eye, EyeOff, LoaderCircle, Moon, Sun } from 'lucide-react'
import { loginSchema, type LoginInput } from '@youlin/contracts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api } from '@/lib/api'
import { useMe } from '@/lib/queries'
import { useTheme } from '@/lib/theme'

function safeNext(value: string | null): string {
  if (!value || !value.startsWith('/admin') || value.startsWith('/admin/login')) return '/admin/dashboard'
  return value
}

export default function LoginPage() {
  const navigate = useNavigate()
  const client = useQueryClient()
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))
  const { theme, setTheme } = useTheme()
  const me = useMe()
  const [showToken, setShowToken] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { token: '' },
  })

  const mutation = useMutation({
    mutationFn: (values: LoginInput) =>
      api('/api/admin/login', { method: 'POST', body: JSON.stringify(values) }),
    onSuccess: () => {
      client.clear()
      navigate(next, { replace: true })
    },
    onError: (err) => {
      setServerError(err instanceof Error ? err.message : '登录失败，请稍后重试')
    },
  })

  useEffect(() => {
    if (me.isSuccess) navigate(next, { replace: true })
  }, [me.isSuccess, navigate, next])

  const error = serverError ?? form.formState.errors.token?.message

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-background p-5">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{
          background:
            'radial-gradient(520px 300px at 50% -12%, color-mix(in oklab, var(--primary) 10%, transparent), transparent 70%), radial-gradient(rgba(90,80,60,.05) 1px, transparent 1px)',
          backgroundSize: 'auto, 22px 22px',
        }}
      />

      <Button
        variant="ghost"
        size="icon-sm"
        className="absolute top-4 right-4"
        aria-label="切换明暗模式"
        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      >
        {theme === 'dark' ? <Sun /> : <Moon />}
      </Button>

      <div className="relative w-full max-w-[380px] rounded-xl border bg-card p-7 shadow-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <img src="/favicon.svg" alt="" className="mb-4 size-11" />
          <h1 className="text-2xl">友邻 · 管理台</h1>
          <p className="mt-2 text-sm text-muted-foreground">输入管理口令继续</p>
        </div>

        <form
          className="grid gap-4"
          onSubmit={form.handleSubmit((values) => {
            setServerError(null)
            mutation.mutate(values)
          })}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="token" className="text-xs text-muted-foreground">
              管理口令
            </Label>
            <div className="relative">
              <Input
                id="token"
                type={showToken ? 'text' : 'password'}
                {...form.register('token')}
                placeholder="ADMIN_TOKEN"
                autoComplete="current-password"
                autoFocus
                aria-invalid={Boolean(error)}
                aria-describedby={error ? 'login-error' : undefined}
                className="pr-10"
              />
              <button
                type="button"
                aria-label={showToken ? '隐藏口令' : '显示口令'}
                onClick={() => setShowToken((visible) => !visible)}
                className="absolute top-1/2 right-2 grid size-7 -translate-y-1/2 place-items-center rounded-md text-subtle hover:bg-accent hover:text-foreground"
              >
                {showToken ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
            {error && (
              <p id="login-error" role="alert" className="text-xs text-danger">
                {error}
              </p>
            )}
          </div>

          <Button type="submit" disabled={mutation.isPending} className="w-full">
            {mutation.isPending ? (
              <>
                <LoaderCircle className="animate-spin" /> 登录中…
              </>
            ) : (
              '登录'
            )}
          </Button>
        </form>

        <p className="mt-6 text-center text-[11px] leading-relaxed text-subtle">
          口令只保存在浏览器会话 Cookie 中，不会写入页面。
        </p>
      </div>
    </div>
  )
}
