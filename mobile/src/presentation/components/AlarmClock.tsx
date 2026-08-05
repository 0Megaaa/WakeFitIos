import React, { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { wakeFitStyles } from '../styles/wakeFitStyles.ts';

export function AlarmClock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  return <Text style={wakeFitStyles.alarmClockText}>{hours}:{minutes}</Text>;
}