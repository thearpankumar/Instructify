'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

interface VoiceTranscriptionProps {
  classId: string;
  isTeacher: boolean;
  onCaptionUpdate?: (currentText: string, finalText: string, isActive: boolean) => void;
}

export default function VoiceTranscription({ classId, isTeacher, onCaptionUpdate }: VoiceTranscriptionProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [isSupported, setIsSupported] = useState(false);
  const [captionsEnabled, setCaptionsEnabled] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const [notes, setNotes] = useState<string | null>(null);
  const [isGeneratingNotes, setIsGeneratingNotes] = useState(false);
  const [currentInterim, setCurrentInterim] = useState('');

  const sendTranscriptChunk = useCallback(async (text: string) => {
    try {
      await fetch(`http://localhost:8000/api/transcription/${classId}/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, timestamp: new Date().toISOString() }),
      });
    } catch (error) {
      console.error('Error sending transcript:', error);
    }
  }, [classId]);

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    setIsSupported(!!SpeechRecognition);

    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onresult = (event) => {
        let interimTranscript = '';
        let finalTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalTranscript += transcript;
          } else {
            interimTranscript += transcript;
          }
        }

        if (finalTranscript) {
          setTranscript(prev => prev + finalTranscript + ' ');
          sendTranscriptChunk(finalTranscript);
          if (onCaptionUpdate) onCaptionUpdate(finalTranscript, '', true);
        }

        if (interimTranscript) {
          setCurrentInterim(interimTranscript);
          if (onCaptionUpdate) onCaptionUpdate('', interimTranscript, false);
        }
      };

      recognition.onerror = () => {
        console.error('Speech recognition error');
        setIsRecording(false);
        setCurrentInterim('');
        if (onCaptionUpdate) onCaptionUpdate('', '', false);
      };

      recognition.onend = () => {
        if (isRecording && captionsEnabled) {
          recognition.start();
        }
      };

      recognitionRef.current = recognition;
    }
  }, [onCaptionUpdate, captionsEnabled, isRecording, transcript, sendTranscriptChunk]);

  const startRecording = async () => {
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      if (recognitionRef.current && !isRecording) {
        recognitionRef.current.start();
        setIsRecording(true);
      }
    } catch (error) {
      console.error('Microphone permission denied:', error);
    }
  };

  const stopRecording = () => {
    if (recognitionRef.current && isRecording) {
      recognitionRef.current.stop();
      setIsRecording(false);
    }
  };

  const generateNotes = async () => {
    setIsGeneratingNotes(true);
    try {
      const response = await fetch('http://localhost:8000/api/notes/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ class_id: classId }),
      });
      if (response.ok) {
        const data = await response.json();
        setNotes(data.notes);
      } else {
        alert('Failed to generate notes.');
      }
    } catch {
      alert('Error generating notes');
    } finally {
      setIsGeneratingNotes(false);
    }
  };

  const downloadNotes = async () => {
    try {
      const response = await fetch(`http://localhost:8000/api/notes/${classId}/download`);
      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `class_notes_${classId}.txt`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      }
    } catch (error) {
      console.error('Error downloading notes:', error);
    }
  };

  if (!isSupported) {
    return (
      <div className="p-3 bg-yellow-50 border-b">
        <p className="text-xs text-yellow-800">Voice features require Chrome/Edge</p>
      </div>
    );
  }

  return (
    <div className="p-3 bg-gray-50">
      <h4 className="text-sm font-semibold mb-3 text-gray-900">
        {isTeacher ? '🎤 Voice & Captions' : '📝 Class Notes'}
      </h4>

      {isTeacher && (
        <div className="mb-3">
          <div className="flex gap-1 mb-2">
            <button
              onClick={startRecording}
              disabled={isRecording}
              className={`flex-1 px-2 py-1 rounded text-xs font-medium ${
                isRecording ? 'bg-gray-300 text-gray-500' : 'bg-green-500 text-white hover:bg-green-600'
              }`}
            >
              {isRecording ? '🔴 Recording' : '🎤 Record'}
            </button>
            
            <button
              onClick={stopRecording}
              disabled={!isRecording}
              className={`flex-1 px-2 py-1 rounded text-xs font-medium ${
                !isRecording ? 'bg-gray-300 text-gray-500' : 'bg-red-500 text-white hover:bg-red-600'
              }`}
            >
              ⏹️ Stop
            </button>
          </div>

          <div className="mb-2">
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={captionsEnabled}
                onChange={(e) => setCaptionsEnabled(e.target.checked)}
                className="rounded"
              />
              <span className="text-xs text-gray-700">📺 Live Captions</span>
            </label>
          </div>

          {isRecording && (
            <div className="bg-green-50 rounded p-2 mb-2 text-xs text-green-700">
              🎤 Listening...
              {captionsEnabled && <span className="ml-2">📺 ON</span>}
            </div>
          )}

          {currentInterim && captionsEnabled && (
            <div className="bg-blue-50 rounded p-2 mb-2 text-xs text-blue-700">
              Live: &ldquo;{currentInterim}&rdquo;
            </div>
          )}
        </div>
      )}

      <div className="space-y-2">
        <button
          onClick={generateNotes}
          disabled={isGeneratingNotes}
          className={`w-full px-3 py-2 rounded text-xs font-medium ${
            isGeneratingNotes ? 'bg-gray-300 text-gray-500' : 'bg-blue-500 text-white hover:bg-blue-600'
          }`}
        >
          {isGeneratingNotes ? '⏳ Generating...' : '🤖 Generate Notes'}
        </button>

        {notes && (
          <button
            onClick={downloadNotes}
            className="w-full px-3 py-2 bg-purple-500 text-white rounded text-xs hover:bg-purple-600 font-medium"
          >
            📥 Download Notes
          </button>
        )}
      </div>

      {notes && (
        <div className="mt-3 bg-blue-50 border border-blue-200 rounded p-2">
          <p className="text-xs font-medium mb-1 text-blue-900">📚 Generated Notes:</p>
          <div className="text-xs text-gray-700 max-h-32 overflow-y-auto whitespace-pre-wrap">
            {notes.slice(0, 200)}...
          </div>
        </div>
      )}
    </div>
  );
}