'use client';

import { useRef, useEffect, useState, useCallback } from 'react';

interface WhiteboardProps {
  isVisible: boolean;
  isTeacher: boolean;
  onDrawingUpdate?: (drawingData: any) => void;
}

interface DrawPoint {
  x: number;
  y: number;
  type: 'pen' | 'eraser';
  size: number;
  color?: string;
}

export default function Whiteboard({ isVisible, isTeacher, onDrawingUpdate }: WhiteboardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentTool, setCurrentTool] = useState<'pen' | 'eraser'>('pen');
  const [penSize, setPenSize] = useState(3);
  const [eraserSize, setEraserSize] = useState(10);
  const [penColor, setPenColor] = useState('#ffffff');
  const [handDetection, setHandDetection] = useState(false);

  // Initialize canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size to match video
    const resizeCanvas = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.height;
      
      // Set drawing styles
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalCompositeOperation = 'source-over';
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    return () => window.removeEventListener('resize', resizeCanvas);
  }, [isVisible]);

  // Hand gesture detection setup
  useEffect(() => {
    if (!handDetection || !isTeacher) return;

    let hands: any;
    let camera: any;

    const initHandDetection = async () => {
      try {
        // Dynamically import MediaPipe (if available)
        const { Hands } = await import('@mediapipe/hands');
        const { Camera } = await import('@mediapipe/camera_utils');

        hands = new Hands({
          locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
        });

        hands.setOptions({
          maxNumHands: 1,
          modelComplexity: 1,
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5
        });

        hands.onResults(onHandResults);

        if (videoRef.current) {
          camera = new Camera(videoRef.current, {
            onFrame: async () => {
              if (videoRef.current) {
                await hands.send({ image: videoRef.current });
              }
            },
            width: 640,
            height: 480
          });
          camera.start();
        }
      } catch (error) {
        console.log('MediaPipe not available, using mouse only');
      }
    };

    initHandDetection();

    return () => {
      if (camera) camera.stop();
    };
  }, [handDetection, isTeacher]);

  const onHandResults = useCallback((results: any) => {
    if (!results.multiHandLandmarks || !results.multiHandLandmarks[0]) return;

    const landmarks = results.multiHandLandmarks[0];
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Get finger positions
    const indexTip = landmarks[8];  // Index finger tip
    const middleTip = landmarks[12]; // Middle finger tip
    const indexPip = landmarks[6];   // Index finger PIP joint
    const middlePip = landmarks[10]; // Middle finger PIP joint

    // Check if fingers are extended
    const indexExtended = indexTip.y < indexPip.y;
    const middleExtended = middleTip.y < middlePip.y;

    const rect = canvas.getBoundingClientRect();
    const x = indexTip.x * rect.width;
    const y = indexTip.y * rect.height;

    if (indexExtended && !middleExtended) {
      // One finger = pen
      setCurrentTool('pen');
      drawPoint(x, y, 'pen', penSize, penColor);
    } else if (indexExtended && middleExtended) {
      // Two fingers = eraser
      setCurrentTool('eraser');
      drawPoint(x, y, 'eraser', eraserSize);
    }
  }, [penSize]);

  const drawPoint = useCallback((x: number, y: number, tool: 'pen' | 'eraser', size: number, color?: string) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = color || penColor;
    }

    ctx.lineWidth = size;
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y);

    // Send drawing data to other users
    if (onDrawingUpdate && isTeacher) {
      onDrawingUpdate({ x, y, tool, size, color: color || penColor, timestamp: Date.now() });
    }
  }, [onDrawingUpdate, isTeacher, penColor]);

  // Mouse drawing handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!isTeacher) return;
    
    setIsDrawing(true);
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx) {
      ctx.beginPath();
      ctx.moveTo(x, y);
    }
  }, [isTeacher]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDrawing || !isTeacher) return;

    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    const size = currentTool === 'eraser' ? eraserSize : penSize;
    drawPoint(x, y, currentTool, size, penColor);
  }, [isDrawing, isTeacher, currentTool, penSize, eraserSize, penColor, drawPoint]);

  const handleMouseUp = useCallback(() => {
    setIsDrawing(false);
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx) {
      ctx.beginPath();
    }
  }, []);

  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    if (onDrawingUpdate && isTeacher) {
      onDrawingUpdate({ action: 'clear', timestamp: Date.now() });
    }
  }, [onDrawingUpdate, isTeacher]);

  // Remove the local applyDrawingUpdate since it's now handled by parent
  // const applyDrawingUpdate = useCallback((data: any) => {
  //   // ... existing code
  // }, [clearCanvas]);

  // Remove the global function registration from here since it's now in parent
  // useEffect(() => {
  //   (window as any).applyWhiteboardUpdate = applyDrawingUpdate;
  //   console.log('✅ Whiteboard update function registered globally');
    
  //   return () => {
  //     (window as any).applyWhiteboardUpdate = null;
  //     console.log('❌ Whiteboard update function unregistered');
  //   };
  // }, [applyDrawingUpdate]);

  return (
    <div className={`absolute inset-0 z-20 ${!isVisible ? 'pointer-events-none' : ''}`}>
      {/* Hidden video for hand detection */}
      {handDetection && (
        <video
          ref={videoRef}
          className="hidden"
          autoPlay
          muted
          playsInline
        />
      )}

      {/* Drawing canvas */}
      <canvas
        ref={canvasRef}
        className={`absolute inset-0 w-full h-full ${isTeacher && isVisible ? 'cursor-crosshair' : 'pointer-events-none'}`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      />

      {/* Teacher controls */}
      {isTeacher && isVisible && (
        <div className="absolute top-4 right-4 bg-black bg-opacity-75 text-white p-4 rounded-lg max-w-xs">
          <div className="flex items-center space-x-3 mb-3">
            <button
              onClick={() => setCurrentTool('pen')}
              className={`px-4 py-2 rounded-lg text-sm font-medium ${
                currentTool === 'pen' ? 'bg-blue-500 hover:bg-blue-600' : 'bg-gray-600 hover:bg-gray-500'
              }`}
            >
              ✏️ Pen
            </button>
            <button
              onClick={() => setCurrentTool('eraser')}
              className={`px-4 py-2 rounded-lg text-sm font-medium ${
                currentTool === 'eraser' ? 'bg-red-500 hover:bg-red-600' : 'bg-gray-600 hover:bg-gray-500'
              }`}
            >
              🧽 Eraser
            </button>
          </div>

          {currentTool === 'pen' && (
            <>
              <div className="flex items-center space-x-2 mb-3">
                <span className="text-sm">Color:</span>
                <input
                  type="color"
                  value={penColor}
                  onChange={(e) => setPenColor(e.target.value)}
                  className="w-10 h-8 rounded border-none"
                />
                <div className="flex space-x-1">
                  {['#ffffff', '#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff'].map(color => (
                    <button
                      key={color}
                      onClick={() => setPenColor(color)}
                      className="w-6 h-6 rounded border border-gray-400 hover:scale-110 transition-transform"
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </div>
              
              <div className="flex items-center space-x-2 mb-3">
                <span className="text-sm">Size:</span>
                <input
                  type="range"
                  min="1"
                  max="20"
                  value={penSize}
                  onChange={(e) => setPenSize(Number(e.target.value))}
                  className="w-20"
                />
                <span className="text-sm font-medium">{penSize}px</span>
              </div>
            </>
          )}

          {currentTool === 'eraser' && (
            <div className="flex items-center space-x-2 mb-3">
              <span className="text-sm">Size:</span>
              <input
                type="range"
                min="5"
                max="50"
                value={eraserSize}
                onChange={(e) => setEraserSize(Number(e.target.value))}
                className="w-20"
              />
              <span className="text-sm font-medium">{eraserSize}px</span>
            </div>
          )}

          <div className="flex items-center space-x-2 mb-3">
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={handDetection}
                onChange={(e) => setHandDetection(e.target.checked)}
                className="rounded"
              />
              <span className="text-sm">👋 Hand Gestures</span>
            </label>
          </div>

          <button
            onClick={clearCanvas}
            className="w-full px-3 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 transition-colors mb-2"
          >
            🗑️ Clear Whiteboard
          </button>

          {/* Test button for debugging */}
          <button
            onClick={() => {
              console.log('🧪 Testing whiteboard update');
              if (onDrawingUpdate) {
                onDrawingUpdate({ 
                  x: 100, 
                  y: 100, 
                  tool: 'pen', 
                  size: 5, 
                  color: '#ff0000',
                  timestamp: Date.now() 
                });
              }
            }}
            className="w-full px-3 py-2 bg-yellow-600 text-white rounded-lg text-sm font-medium hover:bg-yellow-700 transition-colors"
          >
            🧪 Test Update
          </button>
        </div>
      )}

      {/* Status indicator */}
      {isVisible && (
        <div className="absolute bottom-4 right-4 bg-black bg-opacity-75 text-white px-2 py-1 rounded text-xs">
          {isTeacher ? (
            <>
              🎨 Whiteboard Active
              {handDetection && <span className="ml-2">👋 Gestures: {currentTool}</span>}
            </>
          ) : (
            '👀 Viewing whiteboard'
          )}
        </div>
      )}
    </div>
  );
}
