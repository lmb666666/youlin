import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { loginSchema, type LoginInput } from '@youlin/contracts'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api } from '@/lib/api'

export default function LoginPage() {
  const navigate = useNavigate()
  const client = useQueryClient()
  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { token: '' },
  })

  const mutation = useMutation({
    mutationFn: (values: LoginInput) =>
      api('/api/admin/login', { method: 'POST', body: JSON.stringify(values) }),
    onSuccess: () => {
      // 换账号/重新登录后不沿用上一会话的查询缓存
      client.clear()
      navigate('/admin/links', { replace: true })
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : '登录失败'),
  })

  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <img src="/logo.svg" alt="友邻" className="mx-auto mb-2 size-12 rounded-lg" />
          <CardTitle>友邻 · 管理台</CardTitle>
          <CardDescription>输入管理口令登录</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="token">管理口令</Label>
              <Input
                id="token"
                type="password"
                {...form.register('token')}
                placeholder="ADMIN_TOKEN"
                autoFocus
              />
              {form.formState.errors.token && <p className="text-xs text-destructive">{form.formState.errors.token.message}</p>}
            </div>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? '登录中…' : '登录'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
