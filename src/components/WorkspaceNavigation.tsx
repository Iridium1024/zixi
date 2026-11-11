import { createContext, useContext, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

// The workspace retains ownership of its state while its directory lives in the shared sidebar.
export const NavigationTarget = createContext<HTMLElement | null>(null)

export function useUnifiedNavigation() {
  return useContext(NavigationTarget) !== null
}

export function WorkspaceNavigation({ children }: { children: ReactNode }) {
  const target = useContext(NavigationTarget)
  return target ? createPortal(children, target) : children
}
