'use client';

import { useEffect, useState } from 'react';

interface LiveCaptionsProps {
  isVisible: boolean;
  currentText: string;
  finalText: string;
}

export default function LiveCaptions({ isVisible, currentText, finalText }: LiveCaptionsProps) {
  const [displayText, setDisplayText] = useState('');

  useEffect(() => {
    const combined = currentText || finalText.split(' ').slice(-10).join(' ');
    setDisplayText(combined);
  }, [currentText, finalText]);

  if (!isVisible || !displayText.trim()) return null;

  return (
    <div className="absolute bottom-4 left-4 right-4 z-10">
      <div className="bg-black bg-opacity-75 text-white px-4 py-2 rounded-lg max-w-2xl mx-auto">
        <p className="text-sm leading-relaxed">
          {displayText}
        </p>
      </div>
    </div>
  );
}
