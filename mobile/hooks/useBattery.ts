import * as Battery from 'expo-battery';
import { useEffect, useState } from 'react';

export interface BatteryInfo {
  /** De 0 a 1, o `null` si el dispositivo no informa batería (web, emulador). */
  level: number | null;
  charging: boolean;
}

/** Nivel de batería para el Waybar. */
export function useBattery(): BatteryInfo {
  const [info, setInfo] = useState<BatteryInfo>({ level: null, charging: false });

  useEffect(() => {
    let alive = true;
    const subscriptions: { remove(): void }[] = [];

    void (async () => {
      if (!(await Battery.isAvailableAsync())) return;
      const [level, state] = await Promise.all([Battery.getBatteryLevelAsync(), Battery.getBatteryStateAsync()]);
      if (!alive) return;
      setInfo({ level: level >= 0 ? level : null, charging: state === Battery.BatteryState.CHARGING });
      subscriptions.push(
        Battery.addBatteryLevelListener(({ batteryLevel }) =>
          setInfo((prev) => ({ ...prev, level: batteryLevel >= 0 ? batteryLevel : null })),
        ),
        Battery.addBatteryStateListener(({ batteryState }) =>
          setInfo((prev) => ({ ...prev, charging: batteryState === Battery.BatteryState.CHARGING })),
        ),
      );
    })().catch(() => {
      // Sin batería que leer: el Waybar muestra "AC".
    });

    return () => {
      alive = false;
      for (const s of subscriptions) s.remove();
    };
  }, []);

  return info;
}
