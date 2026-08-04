export interface AlarmAlertService {
  start(): Promise<void>;
  stop(): Promise<void>;
}
