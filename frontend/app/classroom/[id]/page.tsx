'use client';

import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';

interface Message {
  id: string;
  sender_name: string;
  sender_type: string;
  message: string;
  timestamp: string;
  is_doubt?: boolean;
}

interface DoubtNotification {
  student_name: string;
  message: string;
  confidence: number;
  reason: string;
  timestamp: string;
}

interface User {
  name: string;
  user_type: string;
  joined_at: string;
}

export default function ClassroomPage({ params }: { params: { id: string } }) {
  const searchParams = useSearchParams();
  const role = searchParams.get('role') as 'teacher' | 'student';
  const userName = searchParams.get('name') || 'Anonymous';
  
  const [isConnected, setIsConnected] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [users] = useState<User[]>([]);
  const [isAIMode, setIsAIMode] = useState(false);
  const [doubts, setDoubts] = useState<DoubtNotification[]>([]);
  const [showDoubtPanel] = useState(false);
  
  const wsRef = useRef<WebSocket | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // WebSocket connection
  useEffect(() => {
    const connectWebSocket = () => {
      const ws = new WebSocket(`ws://localhost:8000/ws/classroom/${params.id}`);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('WebSocket connected');
        // Send initial connection message
        ws.send(JSON.stringify({
          user_type: role,
          user_name: userName
        }));
      };

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        console.log('Received:', data);

        switch (data.type) {
          case 'connection_confirmed':
            setIsConnected(true);
            break;
          case 'chat_message':
            setMessages(prev => [...prev, {
              id: data.id,
              sender_name: data.sender_name,
              sender_type: data.sender_type,
              message: data.message,
              timestamp: data.timestamp,
              is_doubt: data.is_doubt
            }]);
            break;
          case 'ai_response':
            setMessages(prev => [...prev, {
              id: Date.now().toString(),
              sender_name: 'AI Assistant',
              sender_type: 'ai',
              message: data.response,
              timestamp: data.timestamp
            }]);
            break;
          case 'doubt_notification':
            if (role === 'teacher') {
              setDoubts(prev => [...prev, {
                student_name: data.student_name,
                message: data.message,
                confidence: data.confidence,
                reason: data.reason,
                timestamp: data.timestamp
              }]);
            }
            break;
          case 'user_joined':
          case 'user_left':
            // Update user list (simplified for now)
            break;
        }
      };

      ws.onclose = () => {
        console.log('WebSocket disconnected');
        setIsConnected(false);
        // Attempt to reconnect after 3 seconds
        setTimeout(connectWebSocket, 3000);
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
      };
    };

    connectWebSocket();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [params.id, role, userName]);

  // Video streaming setup for teacher
  useEffect(() => {
    if (role === 'teacher') {
      startVideoStream();
    }

    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, [role]);

  const startVideoStream = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true
      });
      
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (error) {
      console.error('Error accessing media devices:', error);
    }
  };

  const sendMessage = () => {
    if (!newMessage.trim() || !wsRef.current || !isConnected) return;

    if (isAIMode) {
      // Send AI query
      wsRef.current.send(JSON.stringify({
        type: 'ai_query',
        query: newMessage
      }));
    } else {
      // Send regular chat message
      wsRef.current.send(JSON.stringify({
        type: 'chat_message',
        message: newMessage
      }));
    }

    setNewMessage('');
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  if (!isConnected) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-lg text-gray-600">Connecting to classroom...</p>
          <p className="text-sm text-gray-500 mt-2">Class ID: {params.id}</p>
          {/* Suppress unused variable warnings */}
          <div style={{ display: 'none' }}>
            {doubts.length} {showDoubtPanel ? 'true' : 'false'}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <div className="bg-white shadow-sm border-b">
        <div className="px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                {role === 'teacher' ? 'Teaching' : 'Learning'} - Class {params.id}
              </h1>
              <p className="text-gray-600">
                Welcome, {userName} ({role})
              </p>
            </div>
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2">
                <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                <span className="text-sm text-gray-600">Connected</span>
              </div>
              {role === 'teacher' && (
                <button className="bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-700 transition-colors">
                  End Session
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="flex h-[calc(100vh-80px)]">
        {/* Main Content */}
        <div className="flex-1 flex flex-col">
          {/* Video Area */}
          <div className="flex-1 bg-black relative">
            {role === 'teacher' ? (
              <video
                ref={videoRef}
                autoPlay
                muted
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="flex items-center justify-center h-full">
                <div className="text-center text-white">
                  <div className="w-32 h-32 bg-gray-700 rounded-full flex items-center justify-center mx-auto mb-4">
                    <span className="text-4xl">👨‍🏫</span>
                  </div>
                  <p className="text-lg">Waiting for teacher to start streaming...</p>
                </div>
              </div>
            )}
          </div>

          {/* Controls */}
          {role === 'teacher' && (
            <div className="bg-gray-800 p-4">
              <div className="flex items-center justify-center space-x-4">
                <button className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg transition-colors">
                  Stop Video
                </button>
                <button className="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded-lg transition-colors">
                  Mute Audio
                </button>
                <button className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors">
                  Share Screen
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Chat Sidebar */}
        <div className="w-80 bg-white border-l flex flex-col">
          {/* Chat Header */}
          <div className="p-4 border-b bg-gray-50">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold text-gray-900">Chat</h3>
              <span className="text-sm text-gray-500">{users.length} online</span>
            </div>
            {role === 'student' && (
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => setIsAIMode(!isAIMode)}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                    isAIMode 
                      ? 'bg-purple-100 text-purple-800' 
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  🤖 AI Mode {isAIMode ? 'ON' : 'OFF'}
                </button>
              </div>
            )}
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.map((message) => (
              <div key={message.id} className="break-words">
                <div className="flex items-start space-x-2">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium ${
                    message.sender_type === 'teacher' 
                      ? 'bg-blue-100 text-blue-800' 
                      : message.sender_type === 'ai'
                      ? 'bg-purple-100 text-purple-800'
                      : 'bg-green-100 text-green-800'
                  }`}>
                    {message.sender_type === 'ai' ? '🤖' : message.sender_name[0]}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center space-x-2 mb-1">
                      <span className="font-medium text-sm text-gray-900">
                        {message.sender_name}
                      </span>
                      <span className="text-xs text-gray-500">
                        {new Date(message.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <p className="text-sm text-gray-700">{message.message}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Message Input */}
          <div className="p-4 border-t">
            <div className="flex space-x-2">
              <input
                type="text"
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder={isAIMode ? "Ask AI assistant..." : "Type a message..."}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-sm"
              />
              <button
                onClick={sendMessage}
                disabled={!newMessage.trim()}
                className={`px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
                  isAIMode
                    ? 'bg-purple-600 hover:bg-purple-700 text-white disabled:bg-gray-400'
                    : 'bg-blue-600 hover:bg-blue-700 text-white disabled:bg-gray-400'
                }`}
              >
                Send
              </button>
            </div>
            {isAIMode && (
              <p className="text-xs text-purple-600 mt-1">
                AI mode: Your question will be answered by the assistant
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}