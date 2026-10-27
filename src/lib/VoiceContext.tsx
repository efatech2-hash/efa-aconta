import React, { createContext, useContext, useState, useEffect } from 'react';
import { isVoiceEnabled, setVoiceEnabled, speakFrench } from './speech';

interface VoiceContextType {
  isVoiceOn: boolean;
  setIsVoiceOn: (v: boolean) => void;
  speak: (text: string, onEnd?: () => void) => void;
  toggleVoice: () => void;
}

export const VoiceContext = createContext<VoiceContextType>({
  isVoiceOn: true,
  setIsVoiceOn: () => {},
  speak: () => {},
  toggleVoice: () => {},
});

export const VoiceProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isVoiceOn, setIsVoiceOnState] = useState<boolean>(() => {
    return isVoiceEnabled();
  });

  useEffect(() => {
    const handleVoiceChange = () => {
      setIsVoiceOnState(isVoiceEnabled());
    };
    window.addEventListener('efa_voice_toggle', handleVoiceChange);
    window.addEventListener('storage', handleVoiceChange);
    return () => {
      window.removeEventListener('efa_voice_toggle', handleVoiceChange);
      window.removeEventListener('storage', handleVoiceChange);
    };
  }, []);

  const setIsVoiceOn = (enabled: boolean) => {
    setIsVoiceOnState(enabled);
    setVoiceEnabled(enabled);
  };

  const toggleVoice = () => {
    const next = !isVoiceOn;
    setIsVoiceOn(next);
  };

  const speak = (text: string, onEnd?: () => void) => {
    speakFrench(text, onEnd);
  };

  return (
    <VoiceContext.Provider value={{ isVoiceOn, setIsVoiceOn, speak, toggleVoice }}>
      {children}
    </VoiceContext.Provider>
  );
};

export const useVoice = () => useContext(VoiceContext);
