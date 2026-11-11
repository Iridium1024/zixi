import { AlertTriangle, CheckCircle2, LoaderCircle } from 'lucide-react'

export function isFailureStatus(message: string) {
  return /失败|错误|无法|不可用|冲突|未安全保存/.test(message)
}

export function ViewStatus({ message }: { message?: string }) {
  if (!message) return null
  const failed = isFailureStatus(message)
  const Icon = failed ? AlertTriangle : /正在|载入中|保存中/.test(message) ? LoaderCircle : CheckCircle2
  return <span className={`view-status ${failed ? 'failed' : ''}`} role="status" title={message}><Icon size={14} className={Icon === LoaderCircle ? 'reader-spinner' : undefined} /><span>{message}</span></span>
}
