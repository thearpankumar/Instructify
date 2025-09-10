'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import VoiceTranscription from '../../components/VoiceTranscription';
import LiveCaptions from '../../components/LiveCaptions';

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

interface MediaState {
  hasAudio: boolean;
  hasVideo: boolean;
  audioEnabled: boolean;
  videoEnabled: boolean;
  isScreenSharing: boolean;
  canShareScreen: boolean;
}

export default function ClassroomContent({ classId }: { classId: string }) {
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
  const [mediaState, setMediaState] = useState<MediaState>({
    hasAudio: false,
    hasVideo: false,
    audioEnabled: true,
    videoEnabled: true,
    isScreenSharing: false,
    canShareScreen: false
  });
  
  // Live captions state
  const [captionState, setCaptionState] = useState({
    currentText: '',
    finalText: '',
    isActive: false
  });
  
  const wsRef = useRef<WebSocket | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // Teacher: Multiple peer connections (one per student)
  const peerConnectionsRef = useRef<Map<number, RTCPeerConnection>>(new Map());
  const pendingIceCandidatesRef = useRef<Map<number, RTCIceCandidateInit[]>>(new Map());
  // Student: Single peer connection (to teacher) 
  const studentPeerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const studentPendingIceCandidatesRef = useRef<RTCIceCandidateInit[]>([]);

  // Check media device capabilities
  const checkMediaCapabilities = useCallback(async () => {
    try {
      // Check browser compatibility
      const isChrome = /Chrome/.test(navigator.userAgent) && /Google Inc/.test(navigator.vendor);
      const isFirefox = navigator.userAgent.toLowerCase().indexOf('firefox') > -1;
      
      console.log('Browser detection:', { isChrome, isFirefox, userAgent: navigator.userAgent });
      
      const devices = await navigator.mediaDevices.enumerateDevices();
      const hasAudio = devices.some(device => device.kind === 'audioinput');
      const hasVideo = devices.some(device => device.kind === 'videoinput');
      const canShareScreen = 'getDisplayMedia' in navigator.mediaDevices;
      
      setMediaState(prev => ({
        ...prev,
        hasAudio,
        hasVideo,
        canShareScreen
      }));
    } catch (error) {
      console.error('Error checking media capabilities:', error);
      setMediaState(prev => ({ ...prev, canShareScreen: 'getDisplayMedia' in navigator.mediaDevices }));
    }
  }, []);

  // WebSocket connection
  useEffect(() => {
    const connectWebSocket = () => {
      const ws = new WebSocket(`ws://localhost:8000/ws/classroom/${classId}`);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('WebSocket connected');
        ws.send(JSON.stringify({
          user_type: role,
          user_name: userName
        }));
      };

      ws.onmessage = async (event) => {
        const data = JSON.parse(event.data);
        console.log(`🔔 [${role.toUpperCase()}] Received:`, data);

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
            break;
          case 'webrtc_signal':
            await handleWebRTCSignaling(data);
            break;
          case 'message_blocked':
            // Show warning to user that their message was blocked
            alert(`⚠️ Message Blocked: ${data.reason}`);
            break;
        }
      };

      ws.onclose = () => {
        console.log('WebSocket disconnected');
        setIsConnected(false);
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
      // Cleanup peer connections
      if (studentPeerConnectionRef.current) {
        studentPeerConnectionRef.current.close();
      }
      peerConnectionsRef.current.forEach(pc => pc.close());
      peerConnectionsRef.current.clear();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId, role, userName]);

  // Initialize media capabilities
  useEffect(() => {
    checkMediaCapabilities();
  }, [checkMediaCapabilities]);

  // WebRTC Setup for Students (single connection to teacher)
  const setupStudentPeerConnection = useCallback(() => {
    const configuration: RTCConfiguration = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
      ],
      iceCandidatePoolSize: 10,
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require'
    };

    const peerConnection = new RTCPeerConnection(configuration);
    studentPeerConnectionRef.current = peerConnection;

    // Optimize for Chrome
    peerConnection.addEventListener('connectionstatechange', () => {
      if (peerConnection.connectionState === 'failed') {
        peerConnection.restartIce();
      }
    });

    // Handle incoming stream from teacher
    peerConnection.ontrack = (event) => {
      console.log('🎥 ✅ STUDENT RECEIVED REMOTE STREAM!', event.streams[0]);
      console.log('Stream tracks:', event.streams[0].getTracks());
      console.log('Stream active:', event.streams[0].active);
      console.log('Video tracks:', event.streams[0].getVideoTracks().length);
      console.log('Audio tracks:', event.streams[0].getAudioTracks().length);
      
      if (remoteVideoRef.current && event.streams[0]) {
        remoteVideoRef.current.srcObject = event.streams[0];
        console.log('✅ Set remote video source to video element');
        
        // Force video to play
        remoteVideoRef.current.play().catch(e => console.log('Video autoplay blocked:', e));
        
        // Hide fallback div when stream is available
        const fallbackDiv = document.getElementById('video-fallback');
        if (fallbackDiv) {
          fallbackDiv.style.display = 'none';
          console.log('🙈 Hidden fallback div - VIDEO SHOULD BE VISIBLE NOW!');
        }
      }
    };

    // Handle ICE candidates
    peerConnection.onicecandidate = (event) => {
      if (event.candidate && wsRef.current) {
        console.log('🧊 Student sending ICE candidate:', event.candidate);
        wsRef.current.send(JSON.stringify({
          type: 'webrtc_signal',
          signal_type: 'ice_candidate',
          signal: event.candidate
        }));
      }
    };

    // Connection state monitoring
    peerConnection.onconnectionstatechange = () => {
      console.log('🔗 Student connection state:', peerConnection.connectionState);
    };

    peerConnection.oniceconnectionstatechange = () => {
      console.log('🧊 Student ICE connection state:', peerConnection.iceConnectionState);
    };

    return peerConnection;
  }, []);

  // WebRTC Setup for Teachers (multiple connections, one per student)
  const setupTeacherPeerConnection = useCallback((studentId: number) => {
    const configuration: RTCConfiguration = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
      ],
      iceCandidatePoolSize: 10,
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require'
    };

    const peerConnection = new RTCPeerConnection(configuration);
    
    // Optimize for Chrome
    peerConnection.addEventListener('connectionstatechange', () => {
      if (peerConnection.connectionState === 'failed') {
        peerConnection.restartIce();
      }
    });
    
    // Add current stream to this peer connection with optimized settings
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => {
        const sender = peerConnection.addTrack(track, streamRef.current!);
        // Optimize encoding for better performance
        if (track.kind === 'video') {
          const params = sender.getParameters();
          if (params.encodings && params.encodings.length > 0) {
            params.encodings[0].maxBitrate = 1000000; // 1Mbps
            params.encodings[0].maxFramerate = 30;
            sender.setParameters(params);
          }
        }
      });
    }

    // Handle ICE candidates
    peerConnection.onicecandidate = (event) => {
      if (event.candidate && wsRef.current) {
        console.log(`🧊 Teacher sending ICE candidate to student ${studentId}:`, event.candidate);
        wsRef.current.send(JSON.stringify({
          type: 'webrtc_signal',
          signal_type: 'ice_candidate',
          signal: event.candidate,
          recipient_id: studentId
        }));
      }
    };

    // Connection state monitoring
    peerConnection.onconnectionstatechange = () => {
      console.log(`🔗 Teacher connection to student ${studentId}:`, peerConnection.connectionState);
    };

    peerConnection.oniceconnectionstatechange = () => {
      console.log(`🧊 Teacher ICE connection to student ${studentId}:`, peerConnection.iceConnectionState);
    };

    // Store the peer connection
    peerConnectionsRef.current.set(studentId, peerConnection);
    pendingIceCandidatesRef.current.set(studentId, []);

    return peerConnection;
  }, []);

  // Handle WebRTC signaling
  const handleWebRTCSignaling = useCallback(async (data: { signal_type: string; signal: RTCSessionDescriptionInit | RTCIceCandidateInit; sender_id?: number; }) => {
    try {
      console.log('📡 Received WebRTC signal:', data.signal_type, 'Role:', role, 'Sender ID:', data.sender_id);
      
      switch (data.signal_type) {
        case 'student_ready':
          // Student is ready to receive stream, teacher creates offer
          if (role === 'teacher' && data.sender_id && streamRef.current) {
            console.log(`👨‍🏫 Teacher creating offer for student ${data.sender_id}`);
            console.log('📊 Current stream tracks:', streamRef.current.getTracks().map(t => `${t.kind}: ${t.readyState}`));
            
            // Create new peer connection for this student
            const peerConnection = setupTeacherPeerConnection(data.sender_id);
            
            try {
              const offer = await peerConnection.createOffer({
                offerToReceiveAudio: false,
                offerToReceiveVideo: false
              });
              await peerConnection.setLocalDescription(offer);
              
              console.log(`📤 Sending offer to student ${data.sender_id}`, offer.type);
              wsRef.current?.send(JSON.stringify({
                type: 'webrtc_signal',
                signal_type: 'offer',
                signal: offer,
                recipient_id: data.sender_id
              }));
            } catch (error) {
              console.error(`❌ Error creating offer for student ${data.sender_id}:`, error);
            }
          }
          break;

        case 'offer':
          if (role === 'student') {
            console.log('📥 Student processing offer...');
            
            // Set up student peer connection if not exists
            let peerConnection = studentPeerConnectionRef.current;
            if (!peerConnection) {
              console.log('🔧 Setting up student peer connection...');
              peerConnection = setupStudentPeerConnection();
            }
            
            await peerConnection.setRemoteDescription(data.signal as RTCSessionDescriptionInit);
            
            // Process any pending ICE candidates now that remote description is set
            console.log(`🧊 Processing ${studentPendingIceCandidatesRef.current.length} pending ICE candidates`);
            for (const candidate of studentPendingIceCandidatesRef.current) {
              try {
                await peerConnection.addIceCandidate(candidate);
                console.log('✅ Added pending ICE candidate');
              } catch (error) {
                console.error('❌ Error adding pending ICE candidate:', error);
              }
            }
            studentPendingIceCandidatesRef.current = []; // Clear pending candidates
            
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            
            console.log('📤 Student sending answer...');
            wsRef.current?.send(JSON.stringify({
              type: 'webrtc_signal',
              signal_type: 'answer',
              signal: answer,
              recipient_id: data.sender_id
            }));
          }
          break;

        case 'answer':
          if (role === 'teacher' && data.sender_id) {
            console.log(`📥 Teacher processing answer from student ${data.sender_id}...`);
            
            // Get the peer connection for this student
            const peerConnection = peerConnectionsRef.current.get(data.sender_id);
            if (peerConnection) {
              await peerConnection.setRemoteDescription(data.signal as RTCSessionDescriptionInit);
              
              // Process any pending ICE candidates for this student
              const pendingCandidates = pendingIceCandidatesRef.current.get(data.sender_id) || [];
              console.log(`🧊 Processing ${pendingCandidates.length} pending ICE candidates for student ${data.sender_id}`);
              for (const candidate of pendingCandidates) {
                try {
                  await peerConnection.addIceCandidate(candidate);
                  console.log('✅ Added pending ICE candidate');
                } catch (error) {
                  console.error('❌ Error adding pending ICE candidate:', error);
                }
              }
              pendingIceCandidatesRef.current.set(data.sender_id, []); // Clear pending candidates
            }
          }
          break;

        case 'ice_candidate':
          const candidate = data.signal as RTCIceCandidateInit;
          
          if (role === 'student') {
            const peerConnection = studentPeerConnectionRef.current;
            if (peerConnection) {
              // Only add ICE candidates if remote description is set
              if (peerConnection.remoteDescription) {
                console.log('🧊 Student adding ICE candidate immediately...');
                await peerConnection.addIceCandidate(candidate);
              } else {
                console.log('⏳ Student queuing ICE candidate (waiting for remote description)...');
                studentPendingIceCandidatesRef.current.push(candidate);
              }
            }
          } else if (role === 'teacher' && data.sender_id) {
            const peerConnection = peerConnectionsRef.current.get(data.sender_id);
            if (peerConnection) {
              // Only add ICE candidates if remote description is set
              if (peerConnection.remoteDescription) {
                console.log(`🧊 Teacher adding ICE candidate for student ${data.sender_id} immediately...`);
                await peerConnection.addIceCandidate(candidate);
              } else {
                console.log(`⏳ Teacher queuing ICE candidate for student ${data.sender_id} (waiting for remote description)...`);
                const pending = pendingIceCandidatesRef.current.get(data.sender_id) || [];
                pending.push(candidate);
                pendingIceCandidatesRef.current.set(data.sender_id, pending);
              }
            }
          }
          break;
      }
    } catch (error) {
      console.error('❌ WebRTC signaling error:', error);
    }
  }, [role, setupStudentPeerConnection, setupTeacherPeerConnection]);

  // Start media stream for teacher
  const startMediaStream = useCallback(async (useScreen: boolean = false) => {
    try {
      console.log('🎥 Starting media stream...', { useScreen, browser: navigator.userAgent });
      
      let stream: MediaStream;
      
      if (useScreen && mediaState.canShareScreen) {
        console.log('📺 Starting screen share...');
        // Screen sharing
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: mediaState.hasAudio
        });
        setMediaState(prev => ({ ...prev, isScreenSharing: true }));
      } else {
        console.log('📹 Starting camera stream...');
        // Regular camera/microphone with optimized constraints
        const constraints: MediaStreamConstraints = {};
        if (mediaState.hasVideo && mediaState.videoEnabled) {
          constraints.video = {
            width: { ideal: 1280, max: 1920 },
            height: { ideal: 720, max: 1080 },
            frameRate: { ideal: 30, max: 30 }
          };
        }
        if (mediaState.hasAudio && mediaState.audioEnabled) {
          constraints.audio = {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          };
        }
        
        console.log('📋 Media constraints:', constraints);
        
        if (!constraints.video && !constraints.audio) {
          throw new Error('No media devices available');
        }
        
        stream = await navigator.mediaDevices.getUserMedia(constraints);
        console.log('✅ Got media stream:', stream.getTracks().map(t => `${t.kind}: ${t.label}`));
        setMediaState(prev => ({ ...prev, isScreenSharing: false }));
      }
      
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        console.log('✅ Set video source for teacher');
      }

      // Handle stream end (for screen sharing)
      stream.getVideoTracks().forEach(track => {
        track.onended = () => {
          console.log('📺 Screen sharing ended');
          setMediaState(prev => ({ ...prev, isScreenSharing: false }));
        };
      });

      // For teachers, wait for students to connect, then create individual peer connections
      if (role === 'teacher') {
        console.log('👨‍🏫 Teacher stream ready - waiting for students to join...');
        // Students will send connection requests, and we'll create individual offers for each
      }

    } catch (error) {
      console.error('❌ Error accessing media:', error);
      console.error('Error details:', {
        name: error.name,
        message: error.message,
        constraint: error.constraint
      });
      
      // Fallback to screen sharing if camera fails
      if (!useScreen && mediaState.canShareScreen) {
        console.log('🔄 Trying screen share as fallback...');
        try {
          await startMediaStream(true);
        } catch (screenError) {
          console.error('❌ Screen sharing also failed:', screenError);
        }
      }
    }
  }, [mediaState.hasVideo, mediaState.hasAudio, mediaState.videoEnabled, mediaState.audioEnabled, mediaState.canShareScreen, role]);

  // Start streaming when teacher role is active
  useEffect(() => {
    if (role === 'teacher' && isConnected) {
      startMediaStream();
    }

    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, [role, isConnected, startMediaStream]);

  // Student: Request connection when ready
  useEffect(() => {
    if (role === 'student' && isConnected && wsRef.current) {
      console.log('👩‍🎓 Student ready - requesting connection from teacher...');
      wsRef.current.send(JSON.stringify({
        type: 'webrtc_signal',
        signal_type: 'student_ready'
      }));
    }
  }, [role, isConnected]);

  // Media control functions
  const toggleAudio = useCallback(() => {
    if (streamRef.current) {
      const audioTracks = streamRef.current.getAudioTracks();
      const newAudioState = !mediaState.audioEnabled;
      
      audioTracks.forEach(track => {
        track.enabled = newAudioState;
      });
      
      setMediaState(prev => ({ ...prev, audioEnabled: newAudioState }));
    }
  }, [mediaState.audioEnabled]);

  const toggleVideo = useCallback(() => {
    if (streamRef.current) {
      const videoTracks = streamRef.current.getVideoTracks();
      const newVideoState = !mediaState.videoEnabled;
      
      videoTracks.forEach(track => {
        track.enabled = newVideoState;
      });
      
      setMediaState(prev => ({ ...prev, videoEnabled: newVideoState }));
    }
  }, [mediaState.videoEnabled]);

  const startScreenShare = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }
    startMediaStream(true);
  }, [startMediaStream]);

  const stopStreaming = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
      setMediaState(prev => ({ ...prev, isScreenSharing: false }));
    }
  }, []);

  const sendMessage = () => {
    if (!newMessage.trim() || !wsRef.current || !isConnected) return;

    if (isAIMode) {
      wsRef.current.send(JSON.stringify({
        type: 'ai_query',
        query: newMessage
      }));
    } else {
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

  // Handle live caption updates
  const handleCaptionUpdate = useCallback((currentText: string, finalText: string, isActive: boolean) => {
    setCaptionState({ currentText, finalText, isActive });
  }, []);

  if (!isConnected) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-lg text-gray-600">Connecting to classroom...</p>
          <p className="text-sm text-gray-500 mt-2">Class ID: {classId}</p>
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
                {role === 'teacher' ? 'Teaching' : 'Learning'} - Class {classId}
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
                <button 
                  onClick={stopStreaming}
                  className="bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-700 transition-colors"
                >
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
              <>
                {/* Remote video stream for students */}
                <video
                  ref={remoteVideoRef}
                  autoPlay
                  playsInline
                  className="w-full h-full object-cover"
                  onLoadedMetadata={() => {
                    console.log('🎥 Remote video metadata loaded');
                    console.log('Video dimensions:', remoteVideoRef.current?.videoWidth, 'x', remoteVideoRef.current?.videoHeight);
                  }}
                  onPlaying={() => console.log('▶️ Remote video started playing')}
                  onError={(e) => console.error('❌ Remote video error:', e)}
                />
                {/* Fallback when no stream */}
                <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50" 
                     id="video-fallback">
                  <div className="text-center text-white">
                    <div className="w-32 h-32 bg-gray-700 rounded-full flex items-center justify-center mx-auto mb-4">
                      <span className="text-4xl">
                        {mediaState.isScreenSharing ? '🖥️' : '👨‍🏫'}
                      </span>
                    </div>
                    <p className="text-lg">
                      {mediaState.isScreenSharing 
                        ? 'Teacher is sharing screen...' 
                        : 'Waiting for teacher to start streaming...'}
                    </p>
                  </div>
                </div>
              </>
            )}
            
            {/* Live Captions Overlay */}
            <LiveCaptions 
              isVisible={captionState.isActive}
              currentText={captionState.currentText}
              finalText={captionState.finalText}
            />
          </div>

          {/* Professional Media Controls for Teacher */}
          {role === 'teacher' && (
            <div className="bg-gradient-to-r from-slate-900 to-gray-900 border-t border-gray-700">
              {/* Main Control Bar */}
              <div className="px-6 py-4">
                <div className="flex items-center justify-between">
                  {/* Left Section - Primary Controls */}
                  <div className="flex items-center space-x-3">
                    {/* Audio Control */}
                    <div className="relative group">
                      <button
                        onClick={toggleAudio}
                        disabled={!mediaState.hasAudio}
                        className={`w-12 h-12 rounded-full transition-all duration-200 flex items-center justify-center text-white relative ${
                          !mediaState.hasAudio 
                            ? 'bg-gray-600 cursor-not-allowed opacity-50'
                            : mediaState.audioEnabled
                            ? 'bg-gray-700 hover:bg-gray-600 shadow-lg'
                            : 'bg-red-500 hover:bg-red-600 shadow-lg shadow-red-500/25'
                        }`}
                        title={!mediaState.hasAudio ? 'No microphone detected' : mediaState.audioEnabled ? 'Mute microphone' : 'Unmute microphone'}
                      >
                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                          {mediaState.audioEnabled ? (
                            <path fillRule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" clipRule="evenodd" />
                          ) : (
                            <path fillRule="evenodd" d="M9.383 3.076A1 1 0 0110 4v4a1 1 0 01-1.707.707L6.586 7H4a1 1 0 010-2h2.586l1.707-1.707a1 1 0 011.09-.217zM12 5a1 1 0 011 1v.382a1 1 0 01-2 0V6a1 1 0 011-1zM12 8.618a1 1 0 011 1V11a3 3 0 11-6 0v-.382a1 1 0 112 0V11a1 1 0 102 0V9.618a1 1 0 011-1z" clipRule="evenodd" />
                          )}
                        </svg>
                        {!mediaState.audioEnabled && (
                          <div className="absolute -top-1 -right-1 w-6 h-6 bg-red-500 rounded-full flex items-center justify-center">
                            <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                            </svg>
                          </div>
                        )}
                      </button>
                      {/* Tooltip */}
                      <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-gray-800 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                        {!mediaState.hasAudio ? 'No microphone' : mediaState.audioEnabled ? 'Mute' : 'Unmute'}
                      </div>
                    </div>

                    {/* Video Control */}
                    <div className="relative group">
                      <button
                        onClick={toggleVideo}
                        disabled={!mediaState.hasVideo || mediaState.isScreenSharing}
                        className={`w-12 h-12 rounded-full transition-all duration-200 flex items-center justify-center text-white relative ${
                          !mediaState.hasVideo || mediaState.isScreenSharing
                            ? 'bg-gray-600 cursor-not-allowed opacity-50'
                            : mediaState.videoEnabled
                            ? 'bg-gray-700 hover:bg-gray-600 shadow-lg'
                            : 'bg-red-500 hover:bg-red-600 shadow-lg shadow-red-500/25'
                        }`}
                        title={!mediaState.hasVideo ? 'No camera detected' : mediaState.isScreenSharing ? 'Not available during screen share' : mediaState.videoEnabled ? 'Stop video' : 'Start video'}
                      >
                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                          {mediaState.videoEnabled ? (
                            <path d="M2 6a2 2 0 012-2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6zM14.553 7.106A1 1 0 0014 8v4a1 1 0 00.553.894l2 1A1 1 0 0018 13V7a1 1 0 00-1.447-.894l-2 1z" />
                          ) : (
                            <path fillRule="evenodd" d="M3.707 2.293a1 1 0 00-1.414 1.414l14 14a1 1 0 001.414-1.414l-1.473-1.473A10.014 10.014 0 0019.542 10C18.268 5.943 14.478 3 10 3a9.958 9.958 0 00-4.512 1.074l-1.78-1.781zm4.261 4.26l1.514 1.515a2.003 2.003 0 012.45 2.45l1.514 1.514a4 4 0 00-5.478-5.478z" clipRule="evenodd" />
                          )}
                        </svg>
                        {!mediaState.videoEnabled && !mediaState.isScreenSharing && (
                          <div className="absolute -top-1 -right-1 w-6 h-6 bg-red-500 rounded-full flex items-center justify-center">
                            <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                            </svg>
                          </div>
                        )}
                      </button>
                      {/* Tooltip */}
                      <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-gray-800 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                        {!mediaState.hasVideo ? 'No camera' : mediaState.isScreenSharing ? 'Camera disabled' : mediaState.videoEnabled ? 'Stop video' : 'Start video'}
                      </div>
                    </div>
                  </div>

                  {/* Center Section - Screen Share */}
                  <div className="flex items-center space-x-3">
                    <div className="relative group">
                      <button
                        onClick={startScreenShare}
                        disabled={!mediaState.canShareScreen}
                        className={`px-6 py-3 rounded-lg transition-all duration-200 flex items-center space-x-2 font-medium ${
                          !mediaState.canShareScreen
                            ? 'bg-gray-600 text-gray-400 cursor-not-allowed opacity-50'
                            : mediaState.isScreenSharing
                            ? 'bg-blue-500 hover:bg-blue-600 text-white shadow-lg shadow-blue-500/25'
                            : 'bg-gray-700 hover:bg-gray-600 text-white shadow-lg'
                        }`}
                        title={!mediaState.canShareScreen ? 'Screen sharing not supported' : mediaState.isScreenSharing ? 'Stop screen sharing' : 'Share screen'}
                      >
                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M3 4a1 1 0 011-1h12a1 1 0 011 1v8a1 1 0 01-1 1h-5v2h3a1 1 0 110 2H6a1 1 0 110-2h3v-2H4a1 1 0 01-1-1V4zm2 1v6h10V5H5z" clipRule="evenodd" />
                        </svg>
                        <span>{mediaState.isScreenSharing ? 'Stop Sharing' : 'Share Screen'}</span>
                        {mediaState.isScreenSharing && (
                          <div className="w-2 h-2 bg-red-400 rounded-full animate-pulse"></div>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Right Section - End Session */}
                  <div className="flex items-center space-x-3">
                    <div className="relative group">
                      <button
                        onClick={stopStreaming}
                        className="w-12 h-12 rounded-full bg-red-500 hover:bg-red-600 transition-all duration-200 flex items-center justify-center text-white shadow-lg shadow-red-500/25"
                        title="End session"
                      >
                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                      </button>
                      {/* Tooltip */}
                      <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-gray-800 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                        End session
                      </div>
                    </div>
                  </div>
                </div>

                {/* Status Bar */}
                <div className="flex items-center justify-center mt-3 pt-3 border-t border-gray-700">
                  <div className="flex items-center space-x-6 text-xs text-gray-400">
                    <div className="flex items-center space-x-1">
                      <div className={`w-2 h-2 rounded-full ${mediaState.hasAudio ? 'bg-green-400' : 'bg-red-400'}`}></div>
                      <span>Audio {mediaState.hasAudio ? 'Available' : 'Unavailable'}</span>
                    </div>
                    <div className="flex items-center space-x-1">
                      <div className={`w-2 h-2 rounded-full ${mediaState.hasVideo ? 'bg-green-400' : 'bg-red-400'}`}></div>
                      <span>Camera {mediaState.hasVideo ? 'Available' : 'Unavailable'}</span>
                    </div>
                    <div className="flex items-center space-x-1">
                      <div className={`w-2 h-2 rounded-full ${mediaState.canShareScreen ? 'bg-green-400' : 'bg-red-400'}`}></div>
                      <span>Screen Share {mediaState.canShareScreen ? 'Available' : 'Unavailable'}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Chat Sidebar */}
        <div className="w-96 bg-white border-l flex flex-col">
          {/* Voice Transcription Section */}
          <div className="border-b">
            <VoiceTranscription 
              classId={classId} 
              isTeacher={role === 'teacher'} 
              onCaptionUpdate={handleCaptionUpdate}
            />
          </div>

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
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-sm text-black"
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