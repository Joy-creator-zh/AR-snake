import React, { useState } from 'react';
import { SnakeCanvas } from './components/SnakeCanvas';
import { GameState } from './types';
import { Trophy, Hand, Camera } from 'lucide-react';

const TrophyIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-yellow-400"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>
);

const HandIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-blue-400"><path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0"/><path d="M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v2"/><path d="M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/></svg>
);

export default function App() {
  const [score, setScore] = useState(0);
  const [gameState, setGameState] = useState<GameState>(GameState.LOADING_MODEL);

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-4">
      {/* Header / Scoreboard */}
      <div className="w-full max-w-4xl flex items-center justify-between mb-6 bg-slate-800/50 backdrop-blur rounded-2xl p-4 border border-slate-700 shadow-lg">
        <div className="flex items-center space-x-3">
          <div className="p-3 bg-slate-700 rounded-xl">
             <HandIcon />
          </div>
          <div>
            <h2 className="text-sm text-slate-400 font-medium tracking-wide uppercase">Control</h2>
            <p className="font-bold text-white">Index Finger</p>
          </div>
        </div>

        <div className="flex items-center space-x-4">
          <div className="text-right">
             <h2 className="text-sm text-slate-400 font-medium tracking-wide uppercase">Current Score</h2>
             <p className="text-3xl font-mono font-bold text-white leading-none">{score}</p>
          </div>
          <div className="p-3 bg-slate-700 rounded-xl">
            <TrophyIcon />
          </div>
        </div>
      </div>

      {/* Game Area */}
      <SnakeCanvas 
        onScoreUpdate={setScore} 
        gameState={gameState}
        setGameState={setGameState}
      />

      {/* Instructions / Footer */}
      <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4 w-full max-w-4xl text-sm text-slate-400">
        <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700 flex flex-col items-center text-center">
          <div className="w-8 h-8 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center mb-2 font-bold">1</div>
          <p>Allow camera access when prompted.</p>
        </div>
        <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700 flex flex-col items-center text-center">
          <div className="w-8 h-8 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center mb-2 font-bold">2</div>
          <p>Raise your hand. The snake follows your <span className="text-white font-bold">Index Finger</span>.</p>
        </div>
        <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700 flex flex-col items-center text-center">
          <div className="w-8 h-8 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center mb-2 font-bold">3</div>
          <p>Collect colored dots to grow. <span className="text-red-400 font-semibold">Avoid hitting your own body!</span></p>
        </div>
      </div>
    </div>
  );
}