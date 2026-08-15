import brandMark from '../assets/brand/zixi-mark.svg'

interface BrandMarkProps {
  className?: string
  title?: string
}

/** The in-app mark deliberately shares the same two-page geometry as the native icon. */
export function BrandMark({ className = '', title = '字隙' }: BrandMarkProps) {
  return <img className={`brand-mark ${className}`.trim()} src={brandMark} alt="" aria-label={title} />
}
