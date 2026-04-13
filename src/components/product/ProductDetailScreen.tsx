import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, ShoppingCart, Heart, Share2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useProduct } from '@/hooks/useProduct';
import { useProductImages } from '@/hooks/useProductImages';
import { useSimilarProducts } from '@/hooks/useSimilarProducts';
import { useComplementaryProducts } from '@/hooks/useComplementaryProducts';
import { useOutfitsWithProduct } from '@/hooks/useOutfitsWithProduct';
import { ProductImageCarousel } from '@/components/product/ProductImageCarousel';
import { ColorPicker, SizePicker } from '@/components/product/ProductPickers';
import { ServiceTags } from '@/components/product/ServiceTags';
import { ProductReviews } from '@/components/product/ProductReviews';
import { ProductDetails } from '@/components/product/ProductDetails';
import { SimilarProducts, PairItWith, CuratedLooks } from '@/components/product/RelatedFeeds';
import { ProductTags } from '@/components/product/ProductTags';
import { Product, Outfit } from '@/types';
import { formatINR } from '@/utils/constants';
import { useStudioSession } from '@/hooks/useStudioSession';
import { 
  generateDummyColors, 
  generateDummySizes, 
  generateDummyReviews, 
  generateDummySpecifications, 
  generateDummySizeChart 
} from '@/utils/dummyData';

export function ProductDetailScreen() {
  const { itemId } = useParams();
  const navigate = useNavigate();
  const { saveSession } = useStudioSession();

  // Data hooks
  const { product, loading: productLoading, error: productError } = useProduct(itemId);
  const { allImages, loading: imagesLoading } = useProductImages(itemId || '', product?.image_url || '');
  const { similarProducts, loading: similarLoading } = useSimilarProducts(itemId);
  const { complementaryProducts, loading: complementaryLoading } = useComplementaryProducts(itemId);
  const { outfits, loading: outfitsLoading, hasMore, loadMore } = useOutfitsWithProduct(itemId);

  // Local state for pickers
  const [selectedColor, setSelectedColor] = useState('black');
  const [selectedSize, setSelectedSize] = useState('m');

  // Dummy data
  const colors = generateDummyColors();
  const sizes = generateDummySizes();
  const reviews = generateDummyReviews();
  const specifications = generateDummySpecifications();
  const sizeChart = generateDummySizeChart(product?.type);

  // Handlers
  const handleBack = () => {
    navigate(-1);
  };

  const handleProductClick = (product: Product) => {
    navigate(`/product/${product.id}`);
  };

  const handleOutfitClick = (outfit: Outfit) => {
    // Save the outfit to studio session
    saveSession(outfit, outfit, outfit, outfit.backgroundId);
    // Navigate back to home and then to studio
    navigate('/app', { replace: true });
    // Use setTimeout to ensure navigation completes before triggering studio
    setTimeout(() => {
      // Trigger studio navigation by dispatching a custom event
      window.dispatchEvent(new CustomEvent('navigateToStudio', { detail: { outfit } }));
    }, 100);
  };

  const handleAddToCart = () => {
    // TODO: Implement add to cart functionality
    console.log('Add to cart:', { productId: itemId, color: selectedColor, size: selectedSize });
  };

  const handleBuyNow = () => {
    // TODO: Implement buy now functionality
    console.log('Buy now:', { productId: itemId, color: selectedColor, size: selectedSize });
  };

  // Loading state
  if (productLoading || imagesLoading) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-3 p-4 border-b border-border">
          <Button variant="ghost" size="icon" onClick={handleBack}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="h-4 bg-muted rounded animate-pulse flex-1" />
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-2" />
            <p className="text-muted-foreground">Loading product...</p>
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (productError || !product) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-3 p-4 border-b border-border">
          <Button variant="ghost" size="icon" onClick={handleBack}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <h1 className="text-lg font-semibold">Product</h1>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <p className="text-destructive mb-4">Failed to load product</p>
            <Button onClick={handleBack}>Go Back</Button>
          </div>
        </div>
      </div>
    );
  }

  // Prepare images for carousel
  const carouselImages = allImages.map((image, index) => ({
    id: image.id || `image-${index}`,
    url: image.url,
    alt: `${product.product_name || product.description} - Image ${index + 1}`
  }));

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <Button variant="ghost" size="icon" onClick={handleBack} className="rounded-full bg-foreground/5 hover:bg-foreground/10 backdrop-blur-sm border border-foreground/10">
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <h1 className="text-lg font-semibold truncate flex-1 mx-4">
          {product.product_name || product.description}
        </h1>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full bg-foreground/5 hover:bg-foreground/10 backdrop-blur-sm border border-foreground/10"
            onContextMenu={(event) => event.preventDefault()}
            style={{ WebkitTouchCallout: "none", WebkitUserSelect: "none", userSelect: "none" }}
          >
            <Heart className="w-5 h-5" />
          </Button>
          <Button variant="ghost" size="icon" className="rounded-full bg-foreground/5 hover:bg-foreground/10 backdrop-blur-sm border border-foreground/10">
            <Share2 className="w-5 h-5" />
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Product Image Carousel */}
        <ProductImageCarousel images={carouselImages} />

        {/* Product Info Section */}
        <div className="p-4 space-y-4">
          {/* Brand and Price */}
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <p className="text-sm text-muted-foreground">{product.brand}</p>
              <h2 className="text-xl font-bold text-foreground mt-1">
                {product.product_name || product.description}
              </h2>
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold text-foreground">{formatINR(product.price)}</p>
            </div>
          </div>

          {/* Rating */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((star) => (
                <span key={star} className="text-yellow-400">★</span>
              ))}
            </div>
            <span className="text-sm text-muted-foreground">4.5 (127 reviews)</span>
          </div>

          {/* Product Tags */}
          <ProductTags
            vibes={product.vibes}
            fit={product.fit}
            feel={product.feel}
          />

          {/* Color and Size Pickers */}
          <ColorPicker
            colors={colors}
            selectedColor={selectedColor}
            onColorChange={setSelectedColor}
          />
          
          <SizePicker
            sizes={sizes}
            selectedSize={selectedSize}
            onSizeChange={setSelectedSize}
          />

          {/* Action Buttons */}
          <div className="flex gap-3 pt-4">
            <Button
              variant="outline"
              className="flex-1 h-12 rounded-full"
              onClick={handleAddToCart}
            >
              <ShoppingCart className="w-4 h-4 mr-2" />
              Add to Cart
            </Button>
            <Button
              className="flex-1 h-12 rounded-full"
              onClick={handleBuyNow}
            >
              Buy Now
            </Button>
          </div>

          {/* Service Tags */}
          <ServiceTags />

          {/* Product Details */}
          <ProductDetails
            description={product.description}
            specifications={specifications}
            sizeChart={sizeChart}
          />

          {/* Reviews */}
          <ProductReviews
            reviews={reviews}
            averageRating={4.5}
            totalReviews={127}
          />
        </div>

        {/* Related Feeds */}
        <div className="p-4 space-y-8">
          {/* Similar Products */}
          <SimilarProducts
            products={similarProducts}
            onProductClick={handleProductClick}
          />

          {/* Pair it with */}
          <PairItWith
            products={complementaryProducts}
            onProductClick={handleProductClick}
          />

          {/* Curated Looks */}
          <CuratedLooks
            outfits={outfits}
            onOutfitClick={handleOutfitClick}
          />

          {/* Load More Button for Curated Looks */}
          {hasMore && (
            <div className="text-center pt-4">
              <Button
                variant="outline"
                onClick={loadMore}
                disabled={outfitsLoading}
              >
                {outfitsLoading ? 'Loading...' : 'Load More Looks'}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
