import React, { useEffect, useRef, useState, useCallback } from 'react';
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import { Point, Food, GameState } from '../types';

interface SnakeCanvasProps {
  onScoreUpdate: (score: number) => void;
  gameState: GameState;
  setGameState: (state: GameState) => void;
}

// Visual and Logic Constants
const FOOD_RADIUS = 15;
const SNAKE_RADIUS = 12; // Slightly thicker for better visibility
const COLLISION_THRESHOLD = 30; // Pixel distance to eat food
const INITIAL_SNAKE_LENGTH = 10; // Initial number of segments
const MIN_SEGMENT_DISTANCE = 8; // Pixels finger must move to add a new body segment (Prevents shrinking when still)
const SEGMENT_GROWTH = 4; // How many segments to add per food
const SELF_COLLISION_GRACE_ZONES = 12; // Number of segments from head to ignore for self-collision (prevents dying on sharp turns)

const COLORS = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899'];

export const SnakeCanvas: React.FC<SnakeCanvasProps> = ({ onScoreUpdate, gameState, setGameState }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // Game Logic Refs
  const snakeBodyRef = useRef<Point[]>([]);
  const foodRef = useRef<Food | null>(null);
  const scoreRef = useRef<number>(0);
  const requestRef = useRef<number>();
  const handLandmarkerRef = useRef<HandLandmarker | null>(null);
  const lastVideoTimeRef = useRef<number>(-1);
  const isCameraOnRef = useRef<boolean>(true); // Track camera state

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

  // Helper: Calculate distance between two points
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

  // Toggle Camera Function
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

  // Restart Game
  const restartGame = () => {
    snakeBodyRef.current = [];
    scoreRef.current = 0;
    onScoreUpdate(0);
    setGameState(GameState.PLAYING);
  };

  // Start Camera
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
      
      snakeBodyRef.current = [];
      scoreRef.current = 0;
      onScoreUpdate(0);
      
      if (videoRef.current && canvasRef.current) {
        canvasRef.current.width = videoRef.current.videoWidth;
        canvasRef.current.height = videoRef.current.videoHeight;
        foodRef.current = spawnFood(canvasRef.current.width, canvasRef.current.height);
      }

      setGameState(GameState.PLAYING);
    } catch (err) {
      console.error("Error accessing camera:", err);
      alert("Camera access denied or not available.");
    }
  };

  // Main Game Loop
  const animate = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const landmarker = handLandmarkerRef.current;

    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Continue loop if playing or game over (to render static state)
    if (gameState === GameState.PLAYING || gameState === GameState.GAME_OVER) {
       requestRef.current = requestAnimationFrame(animate);
    }

    if (!video || !landmarker || !isCameraOnRef.current) {
      // If camera is off, just clear and return (or maybe draw "Camera Off" text)
      if (!isCameraOnRef.current) {
         ctx.clearRect(0, 0, canvas.width, canvas.height);
         ctx.fillStyle = "#1e293b";
         ctx.fillRect(0,0, canvas.width, canvas.height);
         ctx.fillStyle = "white";
         ctx.font = "30px monospace";
         ctx.textAlign = "center";
         ctx.fillText("Camera Paused", canvas.width/2, canvas.height/2);
         return;
      }
    }

    // Don't update game logic if Game Over, just re-render last state (or could stop loop)
    if (gameState === GameState.GAME_OVER) {
       // We can continue to draw the frozen snake
       // But we should stop detecting hands to save resources
       return; 
    }

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 1. Detect Hands
    let fingerTip: Point | null = null;
    
    // Only detect if video has new data
    if (video && video.currentTime !== lastVideoTimeRef.current) {
      lastVideoTimeRef.current = video.currentTime;
      const detections = landmarker.detectForVideo(video, performance.now());
      
      if (detections.landmarks && detections.landmarks.length > 0) {
        const landmarks = detections.landmarks[0];
        if (landmarks.length >= 9) {
          fingerTip = {
            x: landmarks[8].x * canvas.width,
            y: landmarks[8].y * canvas.height
          };
        }
      }
    }

    // 2. Update Snake Position
    if (fingerTip) {
      // Logic Fix: Only add new point if we moved enough distance.
      // This prevents the snake from "eating itself" or shrinking when stationary.
      const head = snakeBodyRef.current[0];
      
      let shouldAddPoint = false;
      if (!head) {
        shouldAddPoint = true;
      } else {
        const dist = getDistance(fingerTip, head);
        if (dist > MIN_SEGMENT_DISTANCE) {
          shouldAddPoint = true;
        }
      }

      if (shouldAddPoint) {
        snakeBodyRef.current.unshift(fingerTip);
        
        // Control Length
        // Base length + bonus for score
        const targetLength = INITIAL_SNAKE_LENGTH + (scoreRef.current * SEGMENT_GROWTH);
        if (snakeBodyRef.current.length > targetLength) {
          snakeBodyRef.current.pop();
        }
      } else {
        // Optional: If we are not moving, we could update the head position slightly 
        // to exactly match the finger, but replacing the head index can cause jitter.
        // It's often smoother to just draw a line from the finger to the first body node.
      }

      // Check Self Collision (GAME OVER Logic)
      // Skip the first few segments (grace zone) to allow turning
      if (snakeBodyRef.current.length > SELF_COLLISION_GRACE_ZONES) {
        for (let i = SELF_COLLISION_GRACE_ZONES; i < snakeBodyRef.current.length; i++) {
          const bodyPart = snakeBodyRef.current[i];
          if (getDistance(fingerTip, bodyPart) < SNAKE_RADIUS) {
            setGameState(GameState.GAME_OVER);
            // Trigger a vibration if supported
            if (navigator.vibrate) navigator.vibrate(200);
            break; 
          }
        }
      }

    }

    // 3. Collision with Food
    // We check distance from FingerTip (or current head) to Food
    const currentHead = fingerTip || snakeBodyRef.current[0];
    const food = foodRef.current;

    if (currentHead && food) {
      const distance = getDistance(currentHead, food);
      if (distance < COLLISION_THRESHOLD) {
        // Eat Food
        scoreRef.current += 1;
        onScoreUpdate(scoreRef.current);
        foodRef.current = spawnFood(canvas.width, canvas.height);
        if (navigator.vibrate) navigator.vibrate(50);
      }
    }

    // 4. Draw Food
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

    // 5. Draw Snake
    ctx.shadowBlur = 0; // Reset shadow for snake
    
    // Draw logic: Draw a line from current fingertip to body[0], then body[0] to body[1]...
    // This makes it feel responsive even if we haven't added a new "history point" yet.
    if (snakeBodyRef.current.length > 0) {
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = SNAKE_RADIUS * 2;
      
      // Gradient
      const tail = snakeBodyRef.current[snakeBodyRef.current.length - 1];
      const headPos = fingerTip || snakeBodyRef.current[0];
      const gradient = ctx.createLinearGradient(headPos.x, headPos.y, tail.x, tail.y);
      gradient.addColorStop(0, '#4ade80');
      gradient.addColorStop(1, '#059669');
      ctx.strokeStyle = gradient;

      ctx.beginPath();
      // Start at current finger position (instant feedback)
      if (fingerTip) {
        ctx.moveTo(fingerTip.x, fingerTip.y);
        ctx.lineTo(snakeBodyRef.current[0].x, snakeBodyRef.current[0].y);
      } else {
        ctx.moveTo(snakeBodyRef.current[0].x, snakeBodyRef.current[0].y);
      }

      for (let i = 1; i < snakeBodyRef.current.length; i++) {
         const p = snakeBodyRef.current[i];
         // Simple smoothing could be done here with quadratic curves
         ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();

      // Draw Head
      ctx.fillStyle = 'white';
      ctx.beginPath();
      ctx.arc(headPos.x, headPos.y, SNAKE_RADIUS, 0, 2*Math.PI);
      ctx.fill();
      
      // Eyes
      ctx.fillStyle = 'black';
      ctx.beginPath();
      ctx.arc(headPos.x - 4, headPos.y - 4, 3, 0, Math.PI*2);
      ctx.arc(headPos.x + 4, headPos.y - 4, 3, 0, Math.PI*2);
      ctx.fill();
    } else if (gameState === GameState.PLAYING) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.font = '20px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText("Show your index finger to start!", canvas.width / 2, canvas.height / 2);
    }

  }, [gameState, onScoreUpdate]);

  // Handle Game Loop Lifecycle
  useEffect(() => {
    if (gameState === GameState.PLAYING) {
      requestRef.current = requestAnimationFrame(animate);
    } 
    // We don't cancel immediately on Game Over so we can see the frozen frame, 
    // but the loop handles the Game Over check.
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
              <br/>Avoid hitting your own tail!
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

      {/* Video Element (Hidden logic, but keeps size) */}
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full object-cover mirror-x"
        muted
        playsInline
      />

      {/* Drawing Canvas */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full mirror-x"
      />

      {/* Camera Toggle Button (Only visible during gameplay) */}
      {(gameState === GameState.PLAYING || gameState === GameState.GAME_OVER) && (
        <button
          onClick={toggleCamera}
          className={`absolute bottom-4 right-4 p-3 rounded-full transition-colors z-50 ${
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
