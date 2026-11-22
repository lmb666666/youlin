import { useEffect } from 'react'
import { useBlocker } from 'react-router'

/** 刷新/关闭页面时的未保存提醒 */
export function useBeforeUnload(dirty: boolean, message = '有未保存的修改，确认离开？') {
  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = message
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty, message])
}

/**
 * 应用内导航的未保存拦截（数据路由的 useBlocker）。
 * 返回 blocker 由调用方渲染确认框：blocker.state === 'blocked' 时展示，
 * 确认走 blocker.proceed()，取消走 blocker.reset()。
 */
export function useNavBlocker(dirty: boolean) {
  return useBlocker(dirty)
}
