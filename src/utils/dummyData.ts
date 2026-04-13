// Dummy data generators for product components

export interface ColorOption {
  id: string;
  name: string;
  hex: string;
  available: boolean;
}

export interface SizeOption {
  id: string;
  name: string;
  available: boolean;
}

export interface Review {
  id: string;
  author: string;
  rating: number;
  date: string;
  title: string;
  comment: string;
  helpful: number;
  verified: boolean;
}

// Color and Size pickers dummy data
export function generateDummyColors(): ColorOption[] {
  return [
    { id: 'black', name: 'Black', hex: '#000000', available: true },
    { id: 'navy', name: 'Navy Blue', hex: '#1e3a8a', available: true },
    { id: 'white', name: 'White', hex: '#ffffff', available: true },
    { id: 'gray', name: 'Gray', hex: '#6b7280', available: true },
    { id: 'red', name: 'Red', hex: '#dc2626', available: false },
    { id: 'green', name: 'Forest Green', hex: '#059669', available: true },
  ];
}

export function generateDummySizes(): SizeOption[] {
  return [
    { id: 'xs', name: 'XS', available: true },
    { id: 's', name: 'S', available: true },
    { id: 'm', name: 'M', available: true },
    { id: 'l', name: 'L', available: true },
    { id: 'xl', name: 'XL', available: false },
    { id: 'xxl', name: 'XXL', available: true },
  ];
}

// Reviews dummy data
export function generateDummyReviews(): Review[] {
  return [
    {
      id: '1',
      author: 'Priya S.',
      rating: 5,
      date: '2 days ago',
      title: 'Perfect fit and great quality!',
      comment: 'I absolutely love this product. The fit is perfect and the quality is excellent. The material feels premium and it\'s very comfortable to wear. Highly recommend!',
      helpful: 12,
      verified: true
    },
    {
      id: '2',
      author: 'Rahul M.',
      rating: 4,
      date: '1 week ago',
      title: 'Good product, slight sizing issue',
      comment: 'Overall great product with good quality. The only issue is that it runs slightly small, so I\'d recommend going up one size. Otherwise, very satisfied with the purchase.',
      helpful: 8,
      verified: true
    },
    {
      id: '3',
      author: 'Anjali K.',
      rating: 5,
      date: '2 weeks ago',
      title: 'Exceeded my expectations',
      comment: 'This product exceeded my expectations! The color is exactly as shown in the pictures and the fit is perfect. The delivery was also very fast. Will definitely buy again.',
      helpful: 15,
      verified: true
    },
    {
      id: '4',
      author: 'Vikram R.',
      rating: 3,
      date: '3 weeks ago',
      title: 'Decent but could be better',
      comment: 'The product is decent quality but I expected better for the price. The fit is okay but not perfect. It\'s wearable but not outstanding.',
      helpful: 3,
      verified: false
    },
    {
      id: '5',
      author: 'Meera P.',
      rating: 5,
      date: '1 month ago',
      title: 'Absolutely love it!',
      comment: 'This is one of my favorite purchases! The quality is amazing and it fits perfectly. The color is beautiful and it goes with everything. Highly recommend!',
      helpful: 20,
      verified: true
    }
  ];
}

// Product details dummy data
export function generateDummySpecifications(): Record<string, string> {
  return {
    material: 'Cotton Blend (95% Cotton, 5% Elastane)',
    weight: '180 GSM',
    fit: 'Regular Fit',
    care: 'Machine wash cold, tumble dry low',
    origin: 'Made in India',
    closure: 'Pull-on',
    pattern: 'Solid',
    season: 'All Season',
    occasion: 'Casual, Daily Wear'
  };
}

// Product-type specific size charts
export function generateDummySizeChart(productType?: string): Record<string, string[]> {
  switch (productType) {
    case 'top':
      return {
        'Chest (inches)': ['32', '34', '36', '38', '40', '42'],
        'Length (inches)': ['26', '27', '28', '29', '30', '31'],
        'Shoulder (inches)': ['14', '15', '16', '17', '18', '19'],
        'Sleeve (inches)': ['22', '23', '24', '25', '26', '27']
      };
    case 'bottom':
      return {
        'Waist (inches)': ['28', '30', '32', '34', '36', '38'],
        'Hip (inches)': ['36', '38', '40', '42', '44', '46'],
        'Length (inches)': ['30', '31', '32', '33', '34', '35'],
        'Inseam (inches)': ['28', '29', '30', '31', '32', '33']
      };
    case 'shoes':
      return {
        'UK': ['6', '7', '8', '9', '10', '11'],
        'US': ['7', '8', '9', '10', '11', '12'],
        'EU': ['40', '41', '42', '43', '44', '45'],
        'CM': ['25', '26', '27', '28', '29', '30']
      };
    default:
      return {
        'Chest (inches)': ['32', '34', '36', '38', '40', '42'],
        'Length (inches)': ['26', '27', '28', '29', '30', '31'],
        'Shoulder (inches)': ['14', '15', '16', '17', '18', '19'],
        'Sleeve (inches)': ['22', '23', '24', '25', '26', '27']
      };
  }
}
