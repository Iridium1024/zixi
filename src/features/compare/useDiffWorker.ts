import { useEffect, useRef, useState } from 'react'
import { compareText } from './diffEngine'
import type { ComparisonRule, DiffResult } from './types'

interface PendingRequest { requestId: number; left: string; right: string; ruleKey: string }
interface Snapshot extends PendingRequest { result: DiffResult }
const EMPTY_RESULT = compareText({ left: '', right: '', preset: 'review' })

export function useDiffWorker(left: string, right: string, rule: ComparisonRule, delayMs = 240) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const workerRef = useRef<Worker | null>(null)
  const pending = useRef<PendingRequest | null>(null)
  const requestCounter = useRef(0)
  const ruleKey = JSON.stringify(rule)
  useEffect(() => {
    if (typeof Worker === 'undefined') return
    const worker = new Worker(new URL('./diff.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<{ requestId: number; result: DiffResult }>) => {
      const current = pending.current
      if (current?.requestId === event.data.requestId) setSnapshot({ ...current, result: event.data.result })
    }
    workerRef.current = worker
    return () => { worker.terminate(); workerRef.current = null }
  }, [])
  useEffect(() => {
    const current = { requestId: ++requestCounter.current, left, right, ruleKey }
    pending.current = current
    const timer = window.setTimeout(() => {
      if (workerRef.current) workerRef.current.postMessage({ requestId: current.requestId, left, right, preset: rule })
      else setSnapshot({ ...current, result: compareText({ left, right, preset: rule }) })
    }, delayMs)
    return () => window.clearTimeout(timer)
  }, [delayMs, left, right, rule, ruleKey])
  // Checked during render so even a click before the next effect cannot export stale ranges.
  const hasCurrentResult = snapshot?.left === left && snapshot.right === right && snapshot.ruleKey === ruleKey
  return { result: hasCurrentResult ? snapshot.result : EMPTY_RESULT, isCalculating: !hasCurrentResult, hasCurrentResult }
}
