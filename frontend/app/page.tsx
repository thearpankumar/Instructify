export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
      <div className="max-w-4xl mx-auto p-8 text-center">
        <h1 className="text-6xl font-bold text-gray-900 mb-6">
          Instructify
        </h1>
        <p className="text-xl text-gray-600 mb-12">
          AI-Powered EdTech Platform for Interactive Learning
        </p>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="bg-white rounded-xl p-8 shadow-lg hover:shadow-xl transition-shadow">
            <h2 className="text-2xl font-semibold text-gray-800 mb-4">
              I&apos;m a Teacher
            </h2>
            <p className="text-gray-600 mb-6">
              Start live streaming, create interactive lessons, and manage your classroom with AI assistance.
            </p>
            <a 
              href="/teacher" 
              className="inline-block bg-blue-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-blue-700 transition-colors"
            >
              Create Classroom
            </a>
          </div>
          
          <div className="bg-white rounded-xl p-8 shadow-lg hover:shadow-xl transition-shadow">
            <h2 className="text-2xl font-semibold text-gray-800 mb-4">
              I&apos;m a Student
            </h2>
            <p className="text-gray-600 mb-6">
              Join interactive classrooms, chat with AI assistant, and access smart notes.
            </p>
            <a 
              href="/student" 
              className="inline-block bg-green-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-green-700 transition-colors"
            >
              Join Classroom
            </a>
          </div>
        </div>
        
        <div className="mt-12 text-sm text-gray-500">
          <p>Features: Live Video Streaming • AI Chat Assistant • Smart Notes • Spam Filtering</p>
        </div>
      </div>
    </div>
  );
}
