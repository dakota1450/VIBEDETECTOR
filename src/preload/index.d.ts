import type { VibeApi } from '@shared/types'

declare global {
  interface Window {
    api: VibeApi
  }
}

export {}
