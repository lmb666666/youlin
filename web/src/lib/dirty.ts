import { useEffect } from 'react'

/** 刷新/关闭页面时的未保存提醒；应用内导航由设置页的保存条与离开确认兜底。 */
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
