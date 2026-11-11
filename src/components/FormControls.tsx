// Selective shadcn/Base UI composition, styled with the application's existing tokens.
import { Children, Fragment, isValidElement, type ReactNode, type InputHTMLAttributes, type SelectHTMLAttributes } from 'react'
import { Checkbox } from '@base-ui/react/checkbox'
import { Switch } from '@base-ui/react/switch'
import { Select } from '@base-ui/react/select'
import { Slider } from '@base-ui/react/slider'
import { Check, ChevronDown } from 'lucide-react'

type ControlAttributes = Pick<InputHTMLAttributes<HTMLInputElement>, 'id' | 'name' | 'title' | 'aria-label' | 'aria-labelledby' | 'className' | 'disabled' | 'checked' | 'value' | 'min' | 'max' | 'step'>

type ValueChange = { target: { value: string } }
type CheckChange = { target: { checked: boolean } }

export function CheckControl({ checked, onChange, disabled, className = '', switch: toggle, ...props }: Omit<ControlAttributes, 'value' | 'min' | 'max' | 'step'> & { switch?: boolean; onChange?(event: CheckChange): void }) {
  if (toggle) return <Switch.Root {...props} className={`ui-switch ${className}`} checked={Boolean(checked)} disabled={disabled} onCheckedChange={(value) => onChange?.({ target: { checked: value } })}><Switch.Thumb className="ui-switch-thumb" /></Switch.Root>
  return <Checkbox.Root {...props} className={`ui-checkbox ${className}`} checked={Boolean(checked)} disabled={disabled} onCheckedChange={(value) => onChange?.({ target: { checked: value } })}><Checkbox.Indicator><Check size={12} /></Checkbox.Indicator></Checkbox.Root>
}

export function RangeControl({ value, min = 0, max = 100, step = 1, onChange, disabled, className = '', 'aria-label': label, ...props }: ControlAttributes & { onChange?(event: ValueChange): void }) {
  return <Slider.Root {...props} className={`ui-slider ${className}`} value={Number(value)} min={Number(min)} max={Number(max)} step={Number(step)} disabled={disabled} onValueChange={(next) => onChange?.({ target: { value: String(next) } })}>
    <Slider.Control className="ui-slider-control"><Slider.Track className="ui-slider-track"><Slider.Indicator className="ui-slider-indicator" /><Slider.Thumb className="ui-slider-thumb" aria-label={label} /></Slider.Track></Slider.Control>
  </Slider.Root>
}

function options(children: ReactNode): { value: string; label: ReactNode; disabled: boolean }[] {
  return Children.toArray(children).flatMap((child) => {
    if (!isValidElement<{ value?: string | number; children?: ReactNode; disabled?: boolean }>(child)) return []
    if (child.type === Fragment || child.type === 'optgroup') return options(child.props.children)
    if (child.type !== 'option') return []
    return [{ value: String(child.props.value ?? child.props.children ?? ''), label: child.props.children, disabled: Boolean(child.props.disabled) }]
  })
}

export function SelectControl({ children, value, onChange, disabled, className = '', id, name, 'aria-label': label, 'aria-labelledby': labelledBy }: Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange'> & { onChange?(event: ValueChange): void }) {
  const items = options(children)
  return <Select.Root items={items} value={String(value ?? '')} name={name} disabled={disabled} onValueChange={(next) => { if (next !== null) onChange?.({ target: { value: next } }) }}>
    <Select.Trigger id={id} aria-label={label} aria-labelledby={labelledBy} className={`ui-select ${className}`}><Select.Value /><Select.Icon><ChevronDown size={13} /></Select.Icon></Select.Trigger>
    <Select.Portal><Select.Positioner className="ui-overlay-positioner" sideOffset={5} alignItemWithTrigger={false}><Select.Popup className="ui-select-popup"><Select.List><Select.Group>{items.map((item) => <Select.Item key={item.value} value={item.value} disabled={item.disabled} className="ui-select-item"><Select.ItemText>{item.label}</Select.ItemText><Select.ItemIndicator><Check size={13} /></Select.ItemIndicator></Select.Item>)}</Select.Group></Select.List></Select.Popup></Select.Positioner></Select.Portal>
  </Select.Root>
}
