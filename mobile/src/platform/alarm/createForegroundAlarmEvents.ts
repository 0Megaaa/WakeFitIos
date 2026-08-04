import type { ForegroundAlarmEvents, ForegroundAlarmEvent } from '../../application/ports/ForegroundAlarmEvents';

type Listener = (event: ForegroundAlarmEvent) => void;

export function createForegroundAlarmEvents(): ForegroundAlarmEvents {
  const listeners = new Set<Listener>();

  return {
    subscribe(listener: Listener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    emit(event: ForegroundAlarmEvent): void {
      for (const listener of listeners) {
        listener(event);
      }
    },
  };
}
