/** Acceptance is unknown; the same identity is kept so a resend cannot clone twice. */
export const UNCONFIRMED_NOTICE = '尚未确认服务端是否已接受。可以重试原请求，不会重复 clone。'

/** The identity could not be recorded, so nothing was sent. */
export const STORAGE_WRITE_FAILED_NOTICE = '无法写入浏览器存储，请求未发送。请检查浏览器存储设置。'

/** The outcome is known but the tab cannot forget the identity, so it stays locked. */
export const STORAGE_CLEAR_FAILED_NOTICE =
  '无法清除本地待确认的请求。请恢复浏览器存储后重试原请求。'

/** Stored state is unreadable, so the tab refuses to mint a new identity. */
export const STORAGE_UNREADABLE_NOTICE =
  '无法读取本地待确认的请求，已停止提交。请检查浏览器存储设置后刷新页面。'

const REJECTION_MESSAGES: Record<string, string> = {
  invalid_repository_url: '仓库地址无效：仅支持 https:// 或 ssh://，不能包含凭据、查询参数或空白。',
  invalid_ref: '分支名无效：请填写分支短名（如 main），不能是 HEAD、以 refs/ 开头或包含空白。',
  invalid_clone_request: '请求无效，请重新填写。',
  idempotency_conflict: '请求身份与原输入冲突，未创建新的 clone。',
  membership_required: '你不是当前组织的成员，无法提交 clone。',
  user_disabled: '账号已被停用，无法提交 clone。',
}

/**
 * Explains a refusal by its stable fault code. Unknown codes are shown verbatim so a new
 * backend rule is still diagnosable.
 */
export function rejectionMessage(code: string | undefined): string {
  const known = code === undefined ? undefined : REJECTION_MESSAGES[code]
  return known ?? `提交被拒绝：${code ?? '未知原因'}`
}
