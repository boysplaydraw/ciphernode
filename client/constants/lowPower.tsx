/**
 * lowPower.tsx — Düşük Güç Modu Context
 *
 * Animasyonları ve haptics'i devre dışı bırakır.
 * App.tsx'de sağlanır, isteyen ekran/bileşen useReducedMotion() ile okur.
 */
import React, { createContext, useContext, useState, useCallback } from "react";

interface LowPowerContextType {
  lowPowerMode: boolean;
  setLowPowerMode: (enabled: boolean) => void;
}

const LowPowerContext = createContext<LowPowerContextType>({
  lowPowerMode: false,
  setLowPowerMode: () => {},
});

export function LowPowerProvider({ children }: { children: React.ReactNode }) {
  const [lowPowerMode, setLowPowerModeState] = useState(false);

  const setLowPowerMode = useCallback((enabled: boolean) => {
    setLowPowerModeState(enabled);
  }, []);

  return (
    <LowPowerContext.Provider value={{ lowPowerMode, setLowPowerMode }}>
      {children}
    </LowPowerContext.Provider>
  );
}

/** Düşük güç modunu oku */
export function useLowPower(): LowPowerContextType {
  return useContext(LowPowerContext);
}
