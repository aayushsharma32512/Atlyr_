import { Button } from './button';
import { Card, CardContent } from './card';

interface EmptyStateProps {
  title: string;
  description: string;
  icon?: React.ReactNode;
  action?: {
    label: string;
    onClick: () => void;
  };
  className?: string;
}

export function EmptyState({ 
  title, 
  description, 
  icon, 
  action, 
  className 
}: EmptyStateProps) {
  return (
    <div className={`flex items-center justify-center p-8 ${className}`}>
      <Card className="w-full max-w-md">
        <CardContent className="p-6 text-center">
          {icon && (
            <div className="mb-4 text-4xl">
              {icon}
            </div>
          )}
          <h3 className="text-lg font-semibold mb-2">{title}</h3>
          <p className="text-muted-foreground mb-4">{description}</p>
          {action && (
            <Button onClick={action.onClick} className="w-full">
              {action.label}
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
} 