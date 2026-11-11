import type { ReactNode } from 'react'

export function DirectoryHeader({ title, children }: { title: string; children: ReactNode }) {
  return <header className="directory-heading"><h2>{title}</h2><div className="directory-header-actions">{children}</div></header>
}
