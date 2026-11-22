import { useCallback } from 'react'
import { useSearchParams } from 'react-router'

/** 单个 query 参数：读写 URL，默认 replace 不污染后退栈。 */
export function useQueryParam(key: string, fallback = '') {
  const [params, setParams] = useSearchParams()
  const value = params.get(key) ?? fallback

  const setValue = useCallback(
    (next: string | null, options?: { replace?: boolean }) => {
      setParams(
        (prev) => {
          const copy = new URLSearchParams(prev)
          if (next === null || next === '') copy.delete(key)
          else copy.set(key, next)
          return copy
        },
        { replace: options?.replace ?? true },
      )
    },
    [key, setParams],
  )

  return [value, setValue] as const
}
