import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface SessionDebugProps {
  getSessionStats: () => {
    totalAppTime: number;
    totalStudioTime: number;
    studioPercentage: number;
    currentStudioSession: number;
  };
}

export function SessionDebug({ getSessionStats }: SessionDebugProps) {
  const [stats, setStats] = useState(getSessionStats());

  useEffect(() => {
    const interval = setInterval(() => {
      setStats(getSessionStats());
    }, 1000); // Update every second

    return () => clearInterval(interval);
  }, [getSessionStats]);

  const formatTime = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  return (
    <Card className="fixed bottom-4 right-4 w-80 bg-black/80 text-white border-gray-700">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">📊 Session Tracking</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-xs">
        <div className="flex justify-between">
          <span>Total App Time:</span>
          <span className="font-mono">{formatTime(stats.totalAppTime)}</span>
        </div>
        <div className="flex justify-between">
          <span>Total Studio Time:</span>
          <span className="font-mono">{formatTime(stats.totalStudioTime)}</span>
        </div>
        <div className="flex justify-between">
          <span>Studio %:</span>
          <span className="font-mono">{stats.studioPercentage.toFixed(1)}%</span>
        </div>
        {stats.currentStudioSession > 0 && (
          <div className="flex justify-between text-green-400">
            <span>Current Studio:</span>
            <span className="font-mono">{formatTime(stats.currentStudioSession)}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
} 