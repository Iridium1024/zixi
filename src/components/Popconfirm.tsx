import { useState, type ReactElement } from 'react'
import { Popover } from '@base-ui/react/popover'

export function Popconfirm({ trigger, title, description, confirmLabel = '确认删除', disabled, onConfirm }: {
  trigger: ReactElement; title: string; description: string; confirmLabel?: string; disabled?: boolean; onConfirm(): Promise<boolean | void>
}) {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  return <Popover.Root open={open} onOpenChange={(value) => { if (!pending) setOpen(value) }}>
    <Popover.Trigger render={trigger} disabled={disabled} />
    <Popover.Portal><Popover.Positioner className="ui-overlay-positioner" sideOffset={6} align="start"><Popover.Popup className="ui-popconfirm" role="alertdialog" aria-label={title}>
      <Popover.Title>{title}</Popover.Title><Popover.Description>{description}</Popover.Description>
      <div><Popover.Close className="secondary-button" disabled={pending}>取消</Popover.Close><button className="secondary-button" disabled={pending || disabled} onClick={async () => { setPending(true); try { if (await onConfirm() !== false) setOpen(false) } finally { setPending(false) } }}>{pending ? '处理中…' : confirmLabel}</button></div>
    </Popover.Popup></Popover.Positioner></Popover.Portal>
  </Popover.Root>
}
