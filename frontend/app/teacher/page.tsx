'use client';

import { useState } from 'react';
import Link from 'next/link';

export default function TeacherPage() {
  const [teacherName, setTeacherName] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const handleCreateClassroom = async () => {
    if (!teacherName.trim()) {
      alert('Please enter your name');
      return;
    }

    setIsCreating(true);
    try {
      const response = await fetch('http://localhost:8000/api/classroom/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          teacher_name: teacherName
        }),
      });

      if (response.ok) {
        const data = await response.json();
        // Redirect to classroom with the generated class_id
        window.location.href = `/classroom/${data.class_id}?role=teacher&name=${encodeURIComponent(teacherName)}`;
      } else {
        alert('Failed to create classroom');
      }
    } catch (error) {
      console.error('Error creating classroom:', error);
      alert('Error creating classroom. Please make sure the backend server is running.');
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
      <div className="max-w-2xl mx-auto p-8">
        <div className="bg-white rounded-xl p-8 shadow-lg">
          <div className="text-center mb-8">
            <h1 className="text-4xl font-bold text-gray-900 mb-4">
              Create Your Classroom
            </h1>
            <p className="text-lg text-gray-600">
              Start a live session with AI-powered features
            </p>
          </div>

          <div className="space-y-6">
            <div>
              <label htmlFor="teacherName" className="block text-sm font-medium text-gray-700 mb-2">
                Your Name
              </label>
              <input
                type="text"
                id="teacherName"
                value={teacherName}
                onChange={(e) => setTeacherName(e.target.value)}
                placeholder="Enter your name"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-black"
                disabled={isCreating}
              />
            </div>

            <button
              onClick={handleCreateClassroom}
              disabled={isCreating || !teacherName.trim()}
              className="w-full bg-blue-600 text-white py-3 px-6 rounded-lg font-medium hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
            >
              {isCreating ? 'Creating Classroom...' : 'Create Classroom & Start Live'}
            </button>
          </div>

          <div className="mt-8 p-4 bg-blue-50 rounded-lg">
            <h3 className="font-semibold text-blue-900 mb-2">Features Available:</h3>
            <ul className="text-sm text-blue-800 space-y-1">
              <li>• Live video streaming to students</li>
              <li>• Real-time chat with AI spam filtering</li>
              <li>• Automatic notes generation from your lecture</li>
              <li>• Student doubt management with AI classification</li>
              <li>• Engagement analytics and insights</li>
            </ul>
          </div>

          <div className="mt-6 text-center">
            <Link
              href="/"
              className="text-blue-600 hover:text-blue-700 text-sm font-medium"
            >
              ← Back to Home
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}