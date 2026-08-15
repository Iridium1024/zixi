import { useEffect, useRef, useState } from 'react'
import { compareText } from './diffEngine'
import type { ComparisonRule, DiffResult } from './types'

interface WorkerResponse {
  requestId: number
  result: DiffResult
}

const EMPTY_RESULT = compareText({ left: '', right: '', preset: 'review' })

export function useDiffWorker(
  left: string,
  right: string,
  rule: ComparisonRule,
  delayMs = 240,
) {
  const [result, setResult] = useState<DiffResult>(EMPTY_RESULT)
  const [isCalculating, setIsCalculating] = useState(false)
  const workerRef = useRef<Worker | null>(null)
  const latestRequestRef = useRef(0)

  useEffect(() => {
    if (typeof Worker === 'undefined') {
      return
    }
    const worker = new Worker(new URL('./diff.worker.ts', import.meta.url), {
      type: 'module',
    })
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      if (event.data.requestId !== latestRequestRef.current) {
        return
      }
      setResult(event.data.result)
      setIsCalculating(false)
    }
    workerRef.current = worker
    return () => {
      worker.terminate()
      workerRef.current = null
    }
  }, [])

  useEffect(() => {
    const requestId = latestRequestRef.current + 1
    latestRequestRef.current = requestId
    setIsCalculating(true)

    const timer = window.setTimeout(() => {
      const worker = workerRef.current
      if (worker) {
        worker.postMessage({ requestId, left, right, preset: rule })
        return
      }
      setResult(compareText({ left, right, preset: rule }))
      setIsCalculating(false)
    }, delayMs)

    return () => window.clearTimeout(timer)
  }, [delayMs, left, right, rule])

  return { result, isCalculating }
}
