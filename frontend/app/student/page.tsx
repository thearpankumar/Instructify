'use client';

import { useState } from 'react';
import Link from 'next/link';

export default function StudentPage() {
  const [studentName, setStudentName] = useState('');
  const [classId, setClassId] = useState('');
  const [isJoining, setIsJoining] = useState(false);

  const handleJoinClassroom = async () => {
    if (!studentName.trim()) {
      alert('Please enter your name');
      return;
    }
    
    if (!classId.trim()) {
      alert('Please enter the class ID');
      return;
    }

    setIsJoining(true);
    try {
      // Check if classroom exists
      const response = await fetch(`http://localhost:8000/api/classroom/${classId}`);
      
      if (response.ok) {
        // Redirect to classroom
        window.location.href = `/classroom/${classId}?role=student&name=${encodeURIComponent(studentName)}`;
      } else if (response.status === 404) {
        alert('Classroom not found. Please check the class ID.');
      } else {
        alert('Failed to join classroom');
      }
    } catch (error) {
      console.error('Error joining classroom:', error);
      alert('Error joining classroom. Please make sure the backend server is running.');
    } finally {
      setIsJoining(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-emerald-100 flex items-center justify-center">
      <div className="max-w-2xl mx-auto p-8">
        <div className="bg-white rounded-xl p-8 shadow-lg">
          <div className="text-center mb-8">
            <h1 className="text-4xl font-bold text-gray-900 mb-4">
              Join Classroom
            </h1>
            <p className="text-lg text-gray-600">
              Enter your details to join the interactive session
            </p>
          </div>

          <div className="space-y-6">
            <div>
              <label htmlFor="studentName" className="block text-sm font-medium text-gray-700 mb-2">
                Your Name
              </label>
              <input
                type="text"
                id="studentName"
                value={studentName}
                onChange={(e) => setStudentName(e.target.value)}
                placeholder="Enter your name"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none"
                disabled={isJoining}
              />
            </div>

            <div>
              <label htmlFor="classId" className="block text-sm font-medium text-gray-700 mb-2">
                Class ID
              </label>
              <input
                type="text"
                id="classId"
                value={classId}
                onChange={(e) => setClassId(e.target.value.toUpperCase())}
                placeholder="Enter 8-character class ID (e.g., ABC123XY)"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none font-mono tracking-wider"
                maxLength={8}
                disabled={isJoining}
              />
              <p className="text-sm text-gray-500 mt-1">
                Get the class ID from your teacher
              </p>
            </div>

            <button
              onClick={handleJoinClassroom}
              disabled={isJoining || !studentName.trim() || !classId.trim()}
              className="w-full bg-green-600 text-white py-3 px-6 rounded-lg font-medium hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
            >
              {isJoining ? 'Joining Classroom...' : 'Join Classroom'}
            </button>
          </div>

          <div className="mt-8 p-4 bg-green-50 rounded-lg">
            <h3 className="font-semibold text-green-900 mb-2">What you&apos;ll get:</h3>
            <ul className="text-sm text-green-800 space-y-1">
              <li>• Watch live video stream from your teacher</li>
              <li>• Chat with classmates and ask questions</li>
              <li>• Get instant help from AI assistant</li>
              <li>• Access auto-generated class notes after session</li>
              <li>• Participate in real-time polls and quizzes</li>
            </ul>
          </div>

          <div className="mt-6 text-center">
            <Link
              href="/"
              className="text-green-600 hover:text-green-700 text-sm font-medium"
            >
              ← Back to Home
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}