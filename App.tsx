
import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import Game from './components/Game';
import { GameStatus, Country, BoundaryShape, VisualTheme } from './types';
import { COUNTRIES } from './constants/countries';
import { GoogleGenAI, Modality } from "@google/genai";

const Confetti: React.FC = () => {
  const pieces = useMemo(() => Array.from({ length: 120 }).map((_, i) => ({
    id: i,
    left: Math.random() * 100,
    delay: Math.random() * 2,
    duration: 2 + Math.random() * 3,
    color: ['#3b82f6', '#ef4444', '#f59e0b', '#10b981', '#ffffff', '#fbbf24'][Math.floor(Math.random() * 6)],
    size: 6 + Math.random() * 12,
    rotation: Math.random() * 360
  })), []);

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none z-40">
      {pieces.map(p => (
        <div
          key={p.id}
          className="absolute top-[-20px]"
          style={{
            left: `${p.left}%`,
            backgroundColor: p.color,
            width: `${p.size}px`,
            height: `${p.size}px`,
            borderRadius: '2px',
            transform: `rotate(${p.rotation}deg)`,
            animation: `fall ${p.duration}s linear ${p.delay}s infinite`
          }}
        />
      ))}
      <style>{`
        @keyframes fall {
          0% { transform: translateY(0) rotate(0deg); opacity: 1; }
          100% { transform: translateY(100vh) rotate(720deg); opacity: 0; }
        }
      `}</style>
    </div>
  );
};

// Audio helper functions
function decodeBase64(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

const App: React.FC = () => {
  const [status, setStatus] = useState<GameStatus>(GameStatus.STARTING);
  const [winner, setWinner] = useState<Country | null>(null);
  const [eliminatedCount, setEliminatedCount] = useState(0);
  const [gameKey, setGameKey] = useState(0);
  const [shape, setShape] = useState<BoundaryShape>(BoundaryShape.CIRCLE);
  const [theme, setTheme] = useState<VisualTheme>(VisualTheme.SPACE);
  const [gapSize, setGapSize] = useState(8); 
  const [bounceIntensity, setBounceIntensity] = useState(1.15); 
  const [isPaused, setIsPaused] = useState(false);
  const [activeCountries, setActiveCountries] = useState<Country[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [targetWinnerId, setTargetWinnerId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const audioContextRef = useRef<AudioContext | null>(null);
  const currentAudioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const lastSpokenRef = useRef<number | string>(-1);

  const initAudio = () => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume();
    }
  };

  const playCountdownVoice = (tick: number) => {
    if (lastSpokenRef.current === tick) return;
    lastSpokenRef.current = tick;

    initAudio();
    const synth = window.speechSynthesis;
    synth.cancel(); 
    
    const text = tick === 0 ? "Battle!" : tick.toString();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    synth.speak(utterance);
  };

  const announceWinner = async (countryName: string) => {
    if (lastSpokenRef.current === `win-${countryName}`) return;
    lastSpokenRef.current = `win-${countryName}`;

    initAudio();
    const synth = window.speechSynthesis;
    synth.cancel(); 

    if (currentAudioSourceRef.current) {
      try { currentAudioSourceRef.current.stop(); } catch (e) {}
    }

    const fallbackAnnounce = () => {
      const utterance = new SpeechSynthesisUtterance(`${countryName} is the winner!`);
      utterance.rate = 0.9;
      utterance.pitch = 0.9;
      synth.speak(utterance);
    };

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{ parts: [{ text: `Announce with excitement: ${countryName} is the champion!` }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Charon' }, 
            },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (base64Audio) {
        const audioCtx = audioContextRef.current!;
        const audioBuffer = await decodeAudioData(decodeBase64(base64Audio), audioCtx, 24000, 1);
        const source = audioCtx.createBufferSource();
        const gainNode = audioCtx.createGain();
        gainNode.gain.value = 1.4; 
        source.buffer = audioBuffer;
        source.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        currentAudioSourceRef.current = source;
        source.start();
      } else {
        fallbackAnnounce();
      }
    } catch (error: any) {
      fallbackAnnounce();
    }
  };

  const handleWinnerDetected = useCallback((winnerCountry: Country) => {
    // Speak as soon as visually revealed
    announceWinner(winnerCountry.name);
  }, []);

  const handleGameEnd = useCallback((lastCountry: Country) => {
    setWinner(lastCountry);
    setStatus(GameStatus.FINISHED);
    setIsPaused(false);
    setShowSettings(false);
  }, []);

  const handleElimination = useCallback((country: Country) => {
    setEliminatedCount(prev => prev + 1);
  }, []);

  const handleRestart = (riggedCountryCode?: string) => {
    const synth = window.speechSynthesis;
    synth.cancel();
    if (currentAudioSourceRef.current) {
      try { currentAudioSourceRef.current.stop(); } catch(e){}
    }

    setGameKey(prev => prev + 1);
    setEliminatedCount(0);
    setWinner(null);
    setStatus(GameStatus.STARTING);
    setIsPaused(false);
    setTargetWinnerId(riggedCountryCode || null);
    lastSpokenRef.current = -1;
  };

  // Initial setup
  useEffect(() => {
    handleRestart();
  }, []);

  const themeConfig = {
    [VisualTheme.SPACE]: { bg: 'bg-neutral-950', accent: 'blue' },
    [VisualTheme.NIGHT]: { bg: 'bg-slate-950', accent: 'indigo' },
    [VisualTheme.DESERT]: { bg: 'bg-orange-950', accent: 'amber' },
    [VisualTheme.ARCTIC]: { bg: 'bg-sky-950', accent: 'cyan' },
  };

  return (
    <div className={`relative w-full h-screen ${themeConfig[theme].bg} flex items-center justify-center select-none overflow-hidden font-sans transition-colors duration-1000`}>
      <style>{`
        @keyframes pulse-scale {
          0%, 100% { transform: scale(1); opacity: 0.8; }
          50% { transform: scale(1.1); opacity: 1; }
        }
        @keyframes slideInUp {
          0% { transform: translateY(100%); opacity: 0; }
          100% { transform: translateY(0); opacity: 1; }
        }
        .animate-pulse-scale { animation: pulse-scale 1s ease-in-out infinite; }
        .animate-slide-up { animation: slideInUp 0.5s ease-out forwards; }
        
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 10px; }
      `}</style>

      {/* Top HUD - Moved even higher */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 flex items-center gap-6 pointer-events-none">
        {activeCountries.slice(0, 5).map((country, idx) => (
          <div key={country.code} className={`flex flex-col items-center gap-2 transition-all duration-700 ${idx === 0 ? 'scale-125 opacity-100' : 'opacity-80 scale-100'}`}>
            <div className={`p-1.5 rounded-xl border-2 shadow-2xl transition-all duration-500 ${idx === 0 ? 'border-yellow-400 bg-yellow-400/20' : 'border-white/20 bg-black/60'}`}>
              <img src={`https://flagcdn.com/w80/${country.code}.png`} className="w-14 h-9 object-cover rounded-md shadow-lg" alt={country.name} />
            </div>
            <div className="px-4 py-0.5 rounded-full text-[14px] font-black italic bg-black/80 text-white border border-white/20 shadow-lg">#{idx + 1}</div>
          </div>
        ))}
      </div>

      <div className="absolute top-8 left-8 z-20 space-y-4">
        <div className="bg-black/80 backdrop-blur-3xl px-6 py-4 border border-blue-500/30 rounded-2xl shadow-2xl">
          <p className="text-[9px] text-blue-400 uppercase font-black tracking-[0.2em] mb-1">Score</p>
          <p className="text-4xl font-black text-white tabular-nums">{(eliminatedCount * 150).toLocaleString()}</p>
        </div>
        <div className="bg-black/80 backdrop-blur-3xl px-6 py-4 border border-red-500/30 rounded-2xl shadow-2xl">
          <p className="text-[9px] text-red-400 uppercase font-black tracking-[0.2em] mb-1">Eliminated</p>
          <p className="text-4xl font-black text-red-500 tabular-nums">{eliminatedCount}</p>
        </div>
      </div>

      {/* Sidebar with Arena Master */}
      <div className="absolute top-8 right-8 z-20 flex flex-col gap-4 items-end h-[calc(100vh-64px)] w-80">
        <div className="bg-black/80 backdrop-blur-3xl border border-white/10 rounded-3xl w-full flex flex-col min-h-0 grow overflow-hidden shadow-2xl">
          <div className="p-4 border-b border-white/5 shrink-0">
            <h2 className="text-xl font-black text-white italic tracking-tighter mb-1">ARENA MASTER</h2>
            
            <div className="mt-4">
              <input 
                type="text" 
                placeholder="Search country..." 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-white text-[12px] font-bold focus:outline-none focus:border-blue-500/50"
              />
            </div>
          </div>
          
          <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-1.5">
            {activeCountries.filter(c => c.name.toLowerCase().includes(searchQuery.toLowerCase())).map((country, idx) => (
              <div key={country.code} 
                   onClick={() => setTargetWinnerId(country.code)}
                   className={`group flex items-center gap-3 p-2 rounded-xl transition-all cursor-pointer border ${targetWinnerId === country.code ? 'bg-blue-600/30 border-blue-500/50' : 'bg-white/5 border-white/5 hover:bg-white/10'}`}>
                <img src={`https://flagcdn.com/w80/${country.code}.png`} className="w-8 h-5 object-cover rounded shadow" alt={country.name} />
                <p className="text-[10px] text-white font-bold truncate uppercase flex-1">{country.name}</p>
                {targetWinnerId === country.code && <div className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-ping" />}
              </div>
            ))}
          </div>

          <div className="p-4 border-t border-white/10 bg-black/40 shrink-0">
            <button onClick={() => handleRestart()} className="w-full py-4 rounded-2xl text-[11px] font-black uppercase tracking-[0.2em] bg-blue-600 text-white hover:bg-blue-700 transition-all shadow-[0_4px_20px_rgba(37,99,235,0.4)]">Restart Arena</button>
          </div>
        </div>
      </div>

      <button onClick={() => setShowSettings(!showSettings)} className="fixed bottom-8 right-8 z-30 p-4 bg-black/80 border border-white/10 rounded-full text-white/60 hover:text-white transition-all shadow-2xl">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
      </button>

      {/* PAUSE BUTTON */}
      <button 
        onClick={() => setIsPaused(!isPaused)} 
        className="fixed bottom-8 left-8 z-30 p-4 bg-black/80 border border-white/10 rounded-full text-white/60 hover:text-white transition-all shadow-2xl hover:scale-110 active:scale-95"
      >
        {isPaused ? (
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
        ) : (
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
        )}
      </button>

      <div className={`fixed inset-y-0 right-0 z-50 w-80 bg-black/95 backdrop-blur-3xl border-l border-white/20 p-8 transform transition-transform duration-500 ${showSettings ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className="flex justify-between items-center mb-10">
          <h3 className="text-white font-black uppercase tracking-[0.2em] text-sm">Arena Options</h3>
          <button onClick={() => setShowSettings(false)} className="text-white/40 hover:text-white">✕</button>
        </div>
        <div className="space-y-8">
          <div className="space-y-4">
            <p className="text-[10px] text-white/40 font-black uppercase tracking-widest">Environment Theme</p>
            <div className="grid grid-cols-2 gap-2">
              {Object.values(VisualTheme).map(t => (
                <button key={t} onClick={() => setTheme(t)} className={`py-2 text-[9px] font-black uppercase rounded-lg border transition-all ${theme === t ? 'bg-blue-600 border-blue-400 text-white' : 'bg-white/5 border-white/10 text-white/40'}`}>{t}</button>
              ))}
            </div>
          </div>
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <p className="text-[10px] text-white/40 font-black uppercase tracking-widest">Exit Gap Size</p>
              <span className="text-blue-400 font-bold text-xs">{gapSize}</span>
            </div>
            <input type="range" min="3" max="25" value={gapSize} onChange={(e) => setGapSize(parseInt(e.target.value))} className="w-full accent-blue-600" />
          </div>
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <p className="text-[10px] text-white/40 font-black uppercase tracking-widest">Bounce (Physics)</p>
              <span className="text-green-400 font-bold text-xs">{bounceIntensity.toFixed(2)}x</span>
            </div>
            <input type="range" min="0.4" max="1.6" step="0.05" value={bounceIntensity} onChange={(e) => setBounceIntensity(parseFloat(e.target.value))} className="w-full accent-green-600" />
          </div>
          <button onClick={() => { handleRestart(); setShowSettings(false); }} className="w-full py-4 bg-blue-600 hover:bg-blue-700 rounded-2xl text-[10px] font-black uppercase tracking-widest text-white transition-all">Apply & Reset</button>
        </div>
      </div>

      <div className={`transform transition-all duration-700 ${isPaused ? 'scale-[0.9] opacity-40 grayscale blur-sm' : 'scale-90 lg:scale-100'}`}>
        <Game key={`${gameKey}-${shape}-${theme}-${bounceIntensity}`} 
              status={status} 
              shape={shape} 
              theme={theme}
              gapSize={gapSize} 
              bounceIntensity={bounceIntensity}
              paused={isPaused} 
              onGameEnd={handleGameEnd} 
              onWinnerDetected={handleWinnerDetected}
              onElimination={handleElimination} 
              onStatusChange={setStatus} 
              onActiveUpdate={setActiveCountries} 
              onCountdownTick={playCountdownVoice}
              targetWinnerId={targetWinnerId} />
      </div>

      {isPaused && (
        <div className="fixed inset-0 z-20 flex items-center justify-center pointer-events-none">
          <h2 className="text-6xl font-black text-white/20 tracking-[0.5em] uppercase animate-pulse">Paused</h2>
        </div>
      )}

      {status === GameStatus.FINISHED && winner && (
        <>
          <Confetti />
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/90 animate-in fade-in duration-1000 px-4">
            <div className="text-center max-w-sm w-full bg-white/5 backdrop-blur-md p-8 rounded-[40px] border border-white/10 shadow-[0_0_80px_rgba(0,0,0,0.5)]">
              <div className="relative mb-6">
                <div className="absolute inset-0 bg-blue-600 blur-[60px] opacity-40 animate-pulse" />
                <div className="relative z-10 w-48 h-32 mx-auto rounded-2xl overflow-hidden border-4 border-white shadow-2xl bg-black flex items-center justify-center">
                  <img 
                    src={`https://flagcdn.com/w320/${winner.code.toLowerCase()}.png`} 
                    className="w-full h-full object-cover" 
                    alt={winner.name} 
                    onError={(e) => { e.currentTarget.src = `https://flagcdn.com/w320/un.png`; }}
                  />
                </div>
              </div>
              <h1 className="text-4xl lg:text-5xl font-black text-white uppercase italic mb-2 tracking-tighter truncate">{winner.name}</h1>
              <p className="text-blue-400 text-xl font-black uppercase tracking-[0.4em] mb-8">CHAMPION!</p>
              <button onClick={() => handleRestart()} className="w-full py-4 bg-blue-600 text-white font-black rounded-2xl text-lg hover:scale-105 active:scale-95 transition-all shadow-[0_0_40px_rgba(37,99,235,0.5)]">BATTLE AGAIN</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default App;
