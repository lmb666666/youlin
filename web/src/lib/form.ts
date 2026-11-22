/** 表单值归一：日期控件的空输入转为「未填」，避免空串撞上严格校验 */
export function emptyToUndefined(value: unknown): unknown {
  return value === '' ? undefined : value
}
