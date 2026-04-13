import React, { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { generateDummySpecifications, generateDummySizeChart } from '@/utils/dummyData';

interface ProductDetailsProps {
  description: string;
  specifications: Record<string, string>;
  sizeChart: Record<string, string[]>;
  className?: string;
}

export function ProductDetails({ description, specifications, sizeChart, className }: ProductDetailsProps) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['description']));

  const toggleSection = (section: string) => {
    const newExpanded = new Set(expandedSections);
    if (newExpanded.has(section)) {
      newExpanded.delete(section);
    } else {
      newExpanded.add(section);
    }
    setExpandedSections(newExpanded);
  };

  const sections = [
    {
      id: 'description',
      title: 'Description',
      content: (
        <div className="space-y-3 text-sm text-muted-foreground leading-relaxed">
          <p>{description}</p>
          <div className="space-y-2">
            <h5 className="font-medium text-foreground">Key Features:</h5>
            <ul className="list-disc list-inside space-y-1 ml-4">
              <li>Premium quality material</li>
              <li>Comfortable fit and design</li>
              <li>Easy to maintain and care</li>
              <li>Versatile styling options</li>
            </ul>
          </div>
        </div>
      )
    },
    {
      id: 'size-chart',
      title: 'Size Chart',
      content: (
        <div className="space-y-3">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 font-medium">Size</th>
                  {Object.keys(sizeChart).map((header) => (
                    <th key={header} className="text-center py-2 font-medium">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {['XS', 'S', 'M', 'L', 'XL', 'XXL'].map((size) => (
                  <tr key={size} className="border-b border-border/50">
                    <td className="py-2 font-medium">{size}</td>
                    {Object.keys(sizeChart).map((header) => (
                      <td key={header} className="text-center py-2">
                        {sizeChart[header]?.[['XS', 'S', 'M', 'L', 'XL', 'XXL'].indexOf(size)] || '-'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">
            * Measurements are in inches. Please refer to our size guide for the best fit.
          </p>
        </div>
      )
    },
    {
      id: 'specifications',
      title: 'Specifications',
      content: (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3">
            {Object.entries(specifications).map(([key, value]) => (
              <div key={key} className="flex justify-between py-2 border-b border-border/50 last:border-b-0">
                <span className="text-sm font-medium text-foreground capitalize">
                  {key.replace(/([A-Z])/g, ' $1').trim()}
                </span>
                <span className="text-sm text-muted-foreground">{value}</span>
              </div>
            ))}
          </div>
        </div>
      )
    }
  ];

  return (
    <div className={cn("space-y-2", className)}>
      {sections.map((section) => {
        const isExpanded = expandedSections.has(section.id);
        return (
          <div key={section.id} className="border border-border rounded-lg">
            <button
              onClick={() => toggleSection(section.id)}
              className="w-full flex items-center justify-between p-4 text-left hover:bg-muted/50 transition-colors"
            >
              <h4 className="font-medium text-foreground">{section.title}</h4>
              {isExpanded ? (
                <ChevronUp className="w-4 h-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              )}
            </button>
            
            {isExpanded && (
              <div className="px-4 pb-4">
                {section.content}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
