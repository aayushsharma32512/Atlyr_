import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DatePickerProps {
  day: string;
  month: string;
  year: string;
  onDayChange: (day: string) => void;
  onMonthChange: (month: string) => void;
  onYearChange: (year: string) => void;
  error?: string;
}

export function DatePicker({ 
  day, 
  month, 
  year, 
  onDayChange, 
  onMonthChange, 
  onYearChange,
  error 
}: DatePickerProps) {
  const months = [
    { value: '01', label: 'January' },
    { value: '02', label: 'February' },
    { value: '03', label: 'March' },
    { value: '04', label: 'April' },
    { value: '05', label: 'May' },
    { value: '06', label: 'June' },
    { value: '07', label: 'July' },
    { value: '08', label: 'August' },
    { value: '09', label: 'September' },
    { value: '10', label: 'October' },
    { value: '11', label: 'November' },
    { value: '12', label: 'December' },
  ];

  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 100 }, (_, i) => currentYear - i);
  const days = Array.from({ length: 31 }, (_, i) => i + 1);

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-3">
        {/* Day */}
        <div className="relative">
          <select
            value={day}
            onChange={(e) => onDayChange(e.target.value)}
            className={cn(
              "w-full h-12 px-3 pr-8 bg-background border border-input rounded-md text-sm appearance-none cursor-pointer",
              "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
              error ? "border-destructive" : "border-input",
              !day && "text-muted-foreground"
            )}
          >
            <option value="">Day</option>
            {days.map((d) => (
              <option key={d} value={String(d).padStart(2, '0')}>{d}</option>
            ))}
          </select>
          <ChevronDown className="absolute right-2 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
        </div>

        {/* Month */}
        <div className="relative">
          <select
            value={month}
            onChange={(e) => onMonthChange(e.target.value)}
            className={cn(
              "w-full h-12 px-3 pr-8 bg-background border border-input rounded-md text-sm appearance-none cursor-pointer",
              "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
              error ? "border-destructive" : "border-input",
              !month && "text-muted-foreground"
            )}
          >
            <option value="">Month</option>
            {months.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
          <ChevronDown className="absolute right-2 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
        </div>

        {/* Year */}
        <div className="relative">
          <select
            value={year}
            onChange={(e) => onYearChange(e.target.value)}
            className={cn(
              "w-full h-12 px-3 pr-8 bg-background border border-input rounded-md text-sm appearance-none cursor-pointer",
              "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
              error ? "border-destructive" : "border-input",
              !year && "text-muted-foreground"
            )}
          >
            <option value="">Year</option>
            {years.map((y) => (
              <option key={y} value={String(y)}>{y}</option>
            ))}
          </select>
          <ChevronDown className="absolute right-2 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
        </div>
      </div>
      
      {error && (
        <p className="text-xs text-destructive mt-2">
          {error}
        </p>
      )}
    </div>
  );
}