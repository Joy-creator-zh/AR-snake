import React, { useEffect, useRef, useState, useCallback } from 'react';
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import { Point, Food, GameState } from '../types';

interface SnakeCanvasProps {
  onScoreUpdate: (score: number) => void;
  gameState: GameState;
  setGameState: (state: GameState) => void;
}

// Logic Constants
const FOOD_RADIUS = 15;
const SNAKE_RADIUS = 12;
const COLLISION_THRESHOLD = 30; // Pixel distance to eat food
const INITIAL_SNAKE_LENGTH = 20; // Initial nodes
const MIN_NODE_DISTANCE = 10; // Pixels finger must move to add a new body node (Prevents shrinking)
const SEGMENT_GROWTH = 5; // How many nodes to add per food
const SELF_COLLISION_GRACE_NODES = 15; // Ignore the first N nodes near head for collision (allows turning)

const COLORS = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899'];

export const SnakeCanvas: React.FC<SnakeCanvasProps> = ({ onScoreUpdate, gameState, setGameState }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // Game Logic Refs
  const snakeBodyRef = useRef<Point[]>([]); // Stores history of positions
  const fingerTipRef = useRef<Point | null>(null); // Current real-time finger position
  const foodRef = useRef<Food | null>(null);
  const scoreRef = useRef<number>(0);
  const requestRef = useRef<number>();
  const handLandmarkerRef = useRef<HandLandmarker | null>(null);
  const lastVideoTimeRef = useRef<number>(-1);
  const isCameraOnRef = useRef<boolean>(true);

  const [loadingStatus, setLoadingStatus] = useState<string>("Initializing Vision Engine...");
  const [cameraActive, setCameraActive] = useState(true);

  // Generate random food position
  const spawnFood = (width: number, height: number): Food => {
    const padding = 60;
    return {
      x: Math.random() * (width - padding * 2) + padding,
      y: Math.random() * (height - padding * 2) + padding,
      color: COLORS[Math.floor(Math.random() * COLORS.length)]
    };
  };

  const getDistance = (p1: Point, p2: Point) => {
    const dx = p1.x - p2.x;
    const dy = p1.y - p2.y;
    return Math.sqrt(dx * dx + dy * dy);
  };

  // Initialize MediaPipe
  useEffect(() => {
    const initMediaPipe = async () => {
      try {
        setLoadingStatus("Loading MediaPipe Models...");
        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
        );
        
        const landmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
            delegate: "GPU"
          },
          runningMode: "VIDEO",
          numHands: 1,
          minHandDetectionConfidence: 0.5,
          minHandPresenceConfidence: 0.5,
          minTrackingConfidence: 0.5
        });

        handLandmarkerRef.current = landmarker;
        setGameState(GameState.MENU);
      } catch (error) {
        console.error("Error initializing MediaPipe:", error);
        setLoadingStatus("Failed to load vision models. Please reload.");
      }
    };

    initMediaPipe();

    return () => {
      if (handLandmarkerRef.current) {
        handLandmarkerRef.current.close();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getVideoTracks().forEach(track => {
        track.enabled = !track.enabled;
      });
      isCameraOnRef.current = !isCameraOnRef.current;
      setCameraActive(isCameraOnRef.current);
    }
  };

  const restartGame = () => {
    snakeBodyRef.current = [];
    fingerTipRef.current = null;
    scoreRef.current = 0;
    onScoreUpdate(0);
    
    // Spawn initial food if canvas is ready
    if (canvasRef.current) {
       foodRef.current = spawnFood(canvasRef.current.width, canvasRef.current.height);
    }
    
    setGameState(GameState.PLAYING);
  };

  const startCamera = async () => {
    if (!videoRef.current) return;
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { 
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: "user" 
        } 
      });
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      
      if (videoRef.current && canvasRef.current) {
        canvasRef.current.width = videoRef.current.videoWidth;
        canvasRef.current.height = videoRef.current.videoHeight;
      }
      
      restartGame();
    } catch (err) {
      console.error("Error accessing camera:", err);
      alert("Camera access denied or not available.");
    }
  };

  const animate = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const landmarker = handLandmarkerRef.current;

    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Loop
    if (gameState === GameState.PLAYING || gameState === GameState.GAME_OVER) {
       requestRef.current = requestAnimationFrame(animate);
    }

    // Check if camera is paused
    if (!isCameraOnRef.current) {
         ctx.clearRect(0, 0, canvas.width, canvas.height);
         ctx.fillStyle = "#0f172a";
         ctx.fillRect(0,0, canvas.width, canvas.height);
         ctx.fillStyle = "white";
         ctx.font = "20px monospace";
         ctx.textAlign = "center";
         ctx.fillText("Camera Paused", canvas.width/2, canvas.height/2);
         return;
    }

    if (gameState === GameState.GAME_OVER) return; // Stop logic updates on game over, just freeze last frame

    // Clear
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 1. Hand Detection
    if (video && landmarker && video.currentTime !== lastVideoTimeRef.current) {
      lastVideoTimeRef.current = video.currentTime;
      const detections = landmarker.detectForVideo(video, performance.now());
      
      if (detections.landmarks && detections.landmarks.length > 0) {
        const landmarks = detections.landmarks[0];
        // Index finger tip is landmark 8
        if (landmarks.length >= 9) {
          fingerTipRef.current = {
            x: landmarks[8].x * canvas.width,
            y: landmarks[8].y * canvas.height
          };
        }
      }
    }

    const currentHead = fingerTipRef.current;

    // 2. Snake Logic
    if (currentHead) {
      
      // Initialize body if empty
      if (snakeBodyRef.current.length === 0) {
        snakeBodyRef.current.push(currentHead);
      }

      // DISTANCE CHECK FOR GROWING/MOVING
      // We only add a new "history node" if the finger has moved far enough from the last recorded node.
      // This prevents the snake from shrinking into a single point when stationary.
      const lastNode = snakeBodyRef.current[0];
      const dist = getDistance(currentHead, lastNode);

      if (dist > MIN_NODE_DISTANCE) {
        // Add new head
        snakeBodyRef.current.unshift(currentHead);
        
        // Trim tail based on score
        const targetLength = INITIAL_SNAKE_LENGTH + (scoreRef.current * SEGMENT_GROWTH);
        while (snakeBodyRef.current.length > targetLength) {
          snakeBodyRef.current.pop();
        }
      }

      // SELF COLLISION CHECK
      // Check if currentHead hits any body part.
      // We skip the first few nodes (SELF_COLLISION_GRACE_NODES) because they are naturally overlapping or close to the head during turns.
      if (snakeBodyRef.current.length > SELF_COLLISION_GRACE_NODES) {
        for (let i = SELF_COLLISION_GRACE_NODES; i < snakeBodyRef.current.length; i++) {
          const bodyPart = snakeBodyRef.current[i];
          if (getDistance(currentHead, bodyPart) < SNAKE_RADIUS) {
            setGameState(GameState.GAME_OVER);
            if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
            break; 
          }
        }
      }

      // FOOD COLLISION
      if (foodRef.current) {
         if (getDistance(currentHead, foodRef.current) < COLLISION_THRESHOLD) {
           scoreRef.current += 1;
           onScoreUpdate(scoreRef.current);
           foodRef.current = spawnFood(canvas.width, canvas.height);
           if (navigator.vibrate) navigator.vibrate(50);
         }
      }
    }

    // 3. Render
    
    // Draw Food
    if (foodRef.current) {
      ctx.beginPath();
      ctx.arc(foodRef.current.x, foodRef.current.y, FOOD_RADIUS, 0, 2 * Math.PI);
      ctx.fillStyle = foodRef.current.color;
      ctx.fill();
      ctx.strokeStyle = 'white';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.shadowBlur = 15;
      ctx.shadowColor = foodRef.current.color;
    }
    ctx.shadowBlur = 0;

    // Draw Snake
    if (snakeBodyRef.current.length > 0) {
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = SNAKE_RADIUS * 2;
      
      const startPoint = currentHead || snakeBodyRef.current[0];
      const endPoint = snakeBodyRef.current[snakeBodyRef.current.length - 1];
      
      const gradient = ctx.createLinearGradient(startPoint.x, startPoint.y, endPoint.x, endPoint.y);
      gradient.addColorStop(0, '#4ade80');
      gradient.addColorStop(1, '#059669');
      ctx.strokeStyle = gradient;

      ctx.beginPath();
      
      // Draw from real-time finger tip to the first recorded history node
      // This ensures the snake feels responsive (0 lag) even if we haven't pushed a history node yet.
      if (currentHead) {
        ctx.moveTo(currentHead.x, currentHead.y);
        ctx.lineTo(snakeBodyRef.current[0].x, snakeBodyRef.current[0].y);
      } else {
        ctx.moveTo(snakeBodyRef.current[0].x, snakeBodyRef.current[0].y);
      }

      // Connect all history nodes
      for (let i = 1; i < snakeBodyRef.current.length; i++) {
         const p = snakeBodyRef.current[i];
         ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();

      // Draw Head
      if (currentHead) {
        ctx.fillStyle = 'white';
        ctx.beginPath();
        ctx.arc(currentHead.x, currentHead.y, SNAKE_RADIUS, 0, 2*Math.PI);
        ctx.fill();
        
        // Eyes
        ctx.fillStyle = 'black';
        ctx.beginPath();
        ctx.arc(currentHead.x - 4, currentHead.y - 4, 3, 0, Math.PI*2);
        ctx.arc(currentHead.x + 4, currentHead.y - 4, 3, 0, Math.PI*2);
        ctx.fill();
      }
    } else if (gameState === GameState.PLAYING) {
       // Hint text if no hand detected
       ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
       ctx.font = '20px sans-serif';
       ctx.textAlign = 'center';
       ctx.fillText("Show your index finger to start!", canvas.width / 2, canvas.height / 2);
    }

  }, [gameState, onScoreUpdate]);

  useEffect(() => {
    if (gameState === GameState.PLAYING) {
      requestRef.current = requestAnimationFrame(animate);
    } 
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [gameState, animate]);


  return (
    <div className="relative w-full max-w-4xl aspect-video bg-black rounded-xl overflow-hidden shadow-2xl border border-slate-700">
      
      {/* Loading Overlay */}
      {gameState === GameState.LOADING_MODEL && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-900 z-50">
           <div className="text-center">
             <div className="w-12 h-12 border-4 border-green-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
             <p className="text-green-400 font-mono text-lg">{loadingStatus}</p>
           </div>
        </div>
      )}

      {/* Menu Overlay */}
      {gameState === GameState.MENU && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-40 backdrop-blur-sm">
          <div className="text-center p-8">
            <h1 className="text-5xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-green-400 to-blue-500 mb-6">
              AR Finger Snake
            </h1>
            <p className="text-gray-300 mb-8 max-w-md mx-auto">
              Control the snake with your <span className="text-yellow-400 font-bold">Index Finger</span>.
              <br/>Avoid biting your own tail!
            </p>
            <button 
              onClick={startCamera}
              className="px-8 py-3 bg-green-600 hover:bg-green-500 text-white rounded-full font-bold text-xl transition-all hover:scale-105 shadow-[0_0_20px_rgba(34,197,94,0.5)]"
            >
              Start Game
            </button>
          </div>
        </div>
      )}

      {/* Game Over Overlay */}
      {gameState === GameState.GAME_OVER && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-50 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="text-center p-8 bg-slate-800/90 rounded-2xl border border-red-500/50 shadow-2xl">
            <h2 className="text-4xl font-bold text-red-500 mb-2">GAME OVER</h2>
            <div className="text-6xl font-mono font-bold text-white mb-6">{scoreRef.current}</div>
            <p className="text-slate-300 mb-8">You bit your tail!</p>
            <button 
              onClick={restartGame}
              className="px-8 py-3 bg-white text-slate-900 hover:bg-gray-200 rounded-full font-bold text-xl transition-all hover:scale-105"
            >
              Play Again
            </button>
          </div>
        </div>
      )}

      {/* Video Element */}
      <video
        ref={videoRef}
        className={`absolute inset-0 w-full h-full object-cover mirror-x ${!cameraActive ? 'opacity-0' : 'opacity-100'}`}
        muted
        playsInline
      />

      {/* Canvas */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full mirror-x"
      />

      {/* Camera Toggle Button */}
      {(gameState === GameState.PLAYING || gameState === GameState.GAME_OVER) && (
        <button
          onClick={toggleCamera}
          className={`absolute bottom-4 right-4 p-3 rounded-full transition-colors z-50 shadow-lg ${
            cameraActive ? 'bg-slate-700/80 hover:bg-slate-600 text-white' : 'bg-red-500/80 hover:bg-red-600 text-white'
          }`}
          title={cameraActive ? "Turn Camera Off" : "Turn Camera On"}
        >
          {cameraActive ? (
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="1" y1="1" x2="23" y2="23"/><path d="M21 21l-9.1-9.1"/><path d="M21 15v4a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3l2-3h2"/><path d="M21 7h-5l-1.33 2H21V7z"/><circle cx="12" cy="13" r="4"/></svg>
          )}
        </button>
      )}
      
    </div>
  );
};