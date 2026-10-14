import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { createJSONStorage } from 'zustand/middleware';

/** Persistencia local de los stores (AsyncStorage; en la web, localStorage). */
export const storage = createJSONStorage(() => AsyncStorage);

interface Hydratable {
  persist: {
    hasHydrated(): boolean;
    onFinishHydration(listener: () => void): () => void;
  };
}

/** Si el store ya leyó lo guardado. Antes de eso no se puede decidir a qué pantalla ir. */
export function useHydrated(store: Hydratable): boolean {
  const [hydrated, setHydrated] = useState(store.persist.hasHydrated());
  useEffect(() => {
    if (store.persist.hasHydrated()) setHydrated(true);
    return store.persist.onFinishHydration(() => setHydrated(true));
  }, [store]);
  return hydrated;
}
