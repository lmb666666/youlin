import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query'
import { toast } from 'sonner'

interface ApiMutationOptions<TData, TVariables> {
  mutationFn: (variables: TVariables) => Promise<TData>
  /** 成功后需要失效的查询键 */
  invalidate?: QueryKey[]
  successMessage?: string | ((data: TData, variables: TVariables) => string)
  onSuccess?: (data: TData, variables: TVariables) => void | Promise<void>
  onError?: (error: unknown, variables: TVariables) => void
}

/** 统一 mutation 的失效、成功提示与错误提示；需要乐观更新时仍用 useMutation。 */
export function useApiMutation<TData, TVariables = void>({
  mutationFn,
  invalidate,
  successMessage,
  onSuccess,
  onError,
}: ApiMutationOptions<TData, TVariables>) {
  const client = useQueryClient()

  return useMutation({
    mutationFn,
    onSuccess: async (data, variables) => {
      if (invalidate?.length) {
        await Promise.all(invalidate.map((key) => client.invalidateQueries({ queryKey: key })))
      }
      if (successMessage) {
        toast.success(typeof successMessage === 'function' ? successMessage(data, variables) : successMessage)
      }
      await onSuccess?.(data, variables)
    },
    onError: (error, variables) => {
      if (onError) onError(error, variables)
      else toast.error(error instanceof Error ? error.message : '操作失败')
    },
  })
}
