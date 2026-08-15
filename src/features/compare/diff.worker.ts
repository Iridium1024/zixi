import { compareText } from './diffEngine'
import type { CompareRequest } from './types'

interface WorkerRequest extends CompareRequest {
  requestId: number
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const { requestId, ...request } = event.data
  const result = compareText(request)
  self.postMessage({ requestId, result })
}
