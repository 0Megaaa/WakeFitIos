export type Tab = 'home' | 'alarm' | 'history' | 'backend';

export type WakeFitTabConfig = {
  key: Tab;
  label: string;
  debugOnly?: boolean;
};

export function buildWakeFitTabs(debugEnabled: boolean): WakeFitTabConfig[] {
  const tabs: WakeFitTabConfig[] = [
    { key: 'home', label: '首页' },
    { key: 'alarm', label: '闹钟' },
    { key: 'history', label: '记录' },
  ];

  if (debugEnabled) {
    tabs.push({ key: 'backend', label: '后端', debugOnly: true });
  }

  return tabs;
}

export function getTabLabel(key: Tab): string {
  const labels: Record<Tab, string> = {
    home: '首页',
    alarm: '闹钟',
    history: '记录',
    backend: '后端',
  };
  return labels[key];
}
