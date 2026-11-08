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

/** 数字参数，非法值回退默认值。 */
export function useNumberParam(key: string, fallback: number) {
  const [raw, setRaw] = useQueryParam(key)
  const value = Number.parseInt(raw, 10)
  return [Number.isFinite(value) && value > 0 ? value : fallback, setRaw] as const
}

/** 简易防抖（搜索输入）；不引入额外依赖。 */
export function debounce<T extends (...args: never[]) => void>(fn: T, delay = 200) {
  let timer: ReturnType<typeof setTimeout> | undefined
  return (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => fn(...args), delay)
  }
}
