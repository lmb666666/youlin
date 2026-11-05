import { useEffect } from 'react'
import { toast } from 'sonner'

/** 查询失败统一提示；401 已由 api() 跳转登录页，不重复弹错 */
export function useQueryErrorToast(error: unknown): void {
  useEffect(() => {
    if (!error) return
    toast.error(error instanceof Error ? error.message : '加载失败')
  }, [error])
}
