import { PageLayout } from '@/components/layout/PageLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { 
  User, 
  Package, 
  Heart, 
  CreditCard, 
  MapPin, 
  Bell, 
  Share2, 
  Settings, 
  LogOut,
  ShoppingBag,
  Crown,
  Edit,
  Star,
  TrendingUp,
  Calendar,
  ChevronRight,
  Gift,
  Sparkles,
  MoreVertical
} from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useAuth } from '@/contexts/AuthContext';
import { useGuest } from '@/contexts/GuestContext';
import { useProfile } from '@/hooks/useProfile';
 
import { EditAvatarModal } from './EditAvatarModal';
import { cn } from '@/lib/utils';
import { useEffect, useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

export function ProfileScreen() {
  const { signOut } = useAuth();
  const { guestState, clearGuestData } = useGuest();
  const { profile, updateProfile } = useProfile();
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const { toast } = useToast();
  // Helper: compute age from date_of_birth (YYYY-MM-DD or ISO)
  const computeAge = (dobStr?: string | null): number | null => {
    if (!dobStr) return null;
    const dob = new Date(dobStr);
    if (Number.isNaN(dob.getTime())) return null;
    const today = new Date();
    let age = today.getFullYear() - dob.getFullYear();
    const monthDiff = today.getMonth() - dob.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
      age -= 1;
    }
    return age;
  };
  // Local editable fields for the sheet
  const [editName, setEditName] = useState<string>('');
  const [editCity, setEditCity] = useState<string>('');
  // height inputs
  const [heightUnit, setHeightUnit] = useState<'cm' | 'ftin'>('cm');
  const [heightCmInput, setHeightCmInput] = useState<string>('');
  const [heightFeet, setHeightFeet] = useState<string>('');
  const [heightInches, setHeightInches] = useState<string>('');
  const [savingDetails, setSavingDetails] = useState<boolean>(false);
  

  // Initialize editable fields from profile
  useEffect(() => {
    if (profile) {
      setEditName(profile.name || '');
      setEditCity(profile.city || '');
      if ((profile as any).height_cm) {
        setHeightUnit('cm');
        setHeightCmInput(String((profile as any).height_cm));
      }
      
    }
  }, [profile]);

  const handleMenuAction = async (action: string) => {
    switch (action) {
      case 'logout':
        if (guestState.isGuest) {
          clearGuestData();
        } else {
          await signOut();
        }
        break;
      case 'share':
        if (navigator.share) {
          navigator.share({
            title: 'Fashion Style App',
            text: 'Check out this amazing fashion app!',
            url: window.location.origin
          });
        }
        break;
      default:
        console.log(`Action: ${action}`);
    }
  };

  // Get user's avatar URL using the new helper function
  const { getUserAvatarUrl } = useProfile();
  const userAvatarUrl = getUserAvatarUrl();

  // Mock stats - in real app, these would come from database queries
  const userStats = {
    totalOrders: 8,
    totalFavorites: 24,
    outfitsCreated: 12,
    recentActivity: 'Last active 2 hours ago'
  };

  // Guest Profile Screen
  if (guestState.isGuest) {
    return (
      <PageLayout>
        <div className="space-y-4">
          {/* Enhanced Guest Hero Section */}
          <div className="profile-hero">
            <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-secondary/10" />
            <div className="relative z-10">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center space-x-4">
                  <div className="relative">
                    <Avatar className="w-16 h-16 border-2 border-primary/20 shadow-lg">
                      <AvatarFallback className="bg-primary/10 text-primary text-xl font-bold">
                        G
                      </AvatarFallback>
                    </Avatar>
                    <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-orange-500 rounded-full border-2 border-background flex items-center justify-center">
                      <Crown className="w-3 h-3 text-white" />
                    </div>
                  </div>
                  <div>
                    <h1 className="text-2xl font-bold text-foreground mb-1">Guest Explorer</h1>
                    <p className="text-muted-foreground flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-primary" />
                      Discovering fashion styles
                    </p>
                    <Badge variant="secondary" className="mt-2 bg-primary/10 text-primary border-primary/20">
                      Temporary Session
                    </Badge>
                  </div>
                </div>
              </div>
              
              <Button 
                size="lg"
                className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-medium shadow-lg"
                onClick={() => window.location.href = '/'}
              >
                <Crown className="w-4 h-4 mr-2" />
                Unlock Full Experience
              </Button>
            </div>
          </div>

          {/* Enhanced Guest Features */}
          <Card className="card-premium">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Gift className="w-5 h-5 text-primary" />
                Available Features
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 pt-0">
              <div className="profile-stats-card">
                <div className="flex items-center space-x-3">
                  <div className="w-3 h-3 bg-emerald-500 rounded-full shadow-sm"></div>
                  <span className="text-sm font-medium">Browse unlimited outfits</span>
                </div>
              </div>
              <div className="profile-stats-card">
                <div className="flex items-center space-x-3">
                  <div className="w-3 h-3 bg-emerald-500 rounded-full shadow-sm"></div>
                  <span className="text-sm font-medium">Use studio & remix features</span>
                </div>
              </div>
              <div className="profile-stats-card">
                <div className="flex items-center space-x-3">
                  <div className="w-3 h-3 bg-amber-500 rounded-full shadow-sm"></div>
                  <span className="text-sm font-medium">Temporary favorites & cart</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Enhanced Sign Out */}
          <Button 
            variant="ghost" 
            className="w-full justify-center p-4 text-destructive hover:text-destructive hover:bg-destructive/10 transition-all duration-200"
            onClick={() => handleMenuAction('logout')}
          >
            <LogOut className="w-4 h-4 mr-2" />
            End Guest Session
          </Button>
        </div>
      </PageLayout>
    );
  }

  if (!profile) {
    return (
      <PageLayout>
        <Card className="card-premium">
          <CardContent className="p-8 text-center">
            <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-primary/10 flex items-center justify-center">
              <User className="w-10 h-10 text-primary" />
            </div>
            <h3 className="text-xl font-semibold mb-3">Complete Your Style Profile</h3>
            <p className="text-muted-foreground mb-6 max-w-sm mx-auto">
              Finish setting up your profile to unlock personalized fashion recommendations
            </p>
            <Button size="lg" onClick={() => window.location.reload()}>
              Continue Setup
            </Button>
          </CardContent>
        </Card>
      </PageLayout>
    );
  }

  return (
    <PageLayout>
      <div className="space-y-4">
        {/* Enhanced Hero Profile Section */}
        <div className="profile-hero">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-secondary/5" />
          <div className="relative z-10">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center space-x-4">
                <Dialog>
                  <DialogTrigger asChild>
                    <div className="relative cursor-pointer group">
                      <Avatar className="w-16 h-16 overflow-hidden border-2 border-primary/20 shadow-lg transition-all duration-300 group-hover:scale-105 group-hover:border-primary/40">
                        <AvatarImage src={userAvatarUrl} className="w-full h-full object-cover" />
                        <AvatarFallback className="bg-primary/10 text-primary text-xl font-bold">
                          {profile.name.charAt(0).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-background rounded-full border-2 border-primary/20 flex items-center justify-center shadow-md group-hover:scale-110 transition-transform duration-300">
                        <Edit className="w-3 h-3 text-primary" />
                      </div>
                    </div>
                  </DialogTrigger>
	                  <DialogContent className="sm:max-w-md">
	                    <DialogHeader>
	                      <DialogTitle>Edit Avatar</DialogTitle>
	                      <DialogDescription className="sr-only">
	                        Update your profile avatar.
	                      </DialogDescription>
	                    </DialogHeader>
	                    <EditAvatarModal 
	                      currentProfile={profile}
	                      onAvatarUpdated={() => {
                        window.location.reload();
                      }}
                    />
                  </DialogContent>
                </Dialog>
                <div className="flex-1">
                  <h1 className="text-2xl font-bold text-foreground mb-1">{profile.name}</h1>
                  {(() => {
                    const dobAge = computeAge((profile as any).date_of_birth as string | null);
                    const ageVal = typeof dobAge === 'number' ? dobAge : profile.age ?? null;
                    return (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <MapPin className="w-4 h-4" />
                        <span className="text-sm">{profile.city}</span>
                        {ageVal !== null && (
                          <>
                            <span className="text-xs opacity-60">•</span>
                            <span className="text-sm">Age {ageVal}</span>
                          </>
                        )}
                      </div>
                    );
                  })()}
                </div>
              </div>

            </div>

            <Sheet>
              <SheetTrigger asChild>
                <Button size="default" className="w-full bg-primary hover:bg-primary/90 text-primary-foreground shadow-md">
                  <Edit className="w-4 h-4 mr-2" />
                  Edit Profile Details
                </Button>
              </SheetTrigger>
              <SheetContent side="bottom" className="rounded-t-2xl pb-24 max-h-[85vh] overflow-y-auto">
                <SheetHeader className="pb-6">
                  <SheetTitle className="text-left">Edit Profile Details</SheetTitle>
                </SheetHeader>
                
                <div className="space-y-8">
                  {/* Personal Information Section */}
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 mb-4">
                      <User className="w-5 h-5 text-primary" />
                      <h3 className="profile-section-title">Personal Information</h3>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-foreground">Full Name</label>
                        <Input 
                          value={editName} 
                          onChange={(e) => setEditName(e.target.value)} 
                          placeholder="Enter your name"
                          className="border-border/60 focus:border-primary/60"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-foreground">City</label>
                        <Input 
                          value={editCity} 
                          onChange={(e) => setEditCity(e.target.value)} 
                          placeholder="Enter your city"
                          className="border-border/60 focus:border-primary/60"
                        />
                      </div>
                    </div>
                    
                    {/* Height Section */}
                    <div className="space-y-3">
                      <label className="text-sm font-medium text-foreground">Height</label>
                      <div className="flex items-center gap-2 mb-3">
                        <Button
                          type="button"
                          variant={heightUnit === 'cm' ? 'default' : 'outline'}
                          size="sm"
                          onClick={() => setHeightUnit('cm')}
                          className="px-4"
                        >
                          cm
                        </Button>
                        <Button
                          type="button"
                          variant={heightUnit === 'ftin' ? 'default' : 'outline'}
                          size="sm"
                          onClick={() => setHeightUnit('ftin')}
                          className="px-4"
                        >
                          ft/in
                        </Button>
                      </div>
                      
                      {heightUnit === 'cm' ? (
                        <div className="flex items-center gap-3">
                          <Input
                            inputMode="decimal"
                            value={heightCmInput}
                            onChange={(e) => setHeightCmInput(e.target.value)}
                            placeholder="175"
                            className="max-w-[120px] border-border/60 focus:border-primary/60"
                          />
                          <span className="text-sm text-muted-foreground font-medium">centimeters</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-4">
                          <div className="flex items-center gap-2">
                            <Input
                              inputMode="numeric"
                              value={heightFeet}
                              onChange={(e) => setHeightFeet(e.target.value)}
                              placeholder="5"
                              className="w-16 border-border/60 focus:border-primary/60"
                            />
                            <span className="text-sm text-muted-foreground font-medium">ft</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Input
                              inputMode="numeric"
                              value={heightInches}
                              onChange={(e) => setHeightInches(e.target.value)}
                              placeholder="9"
                              className="w-16 border-border/60 focus:border-primary/60"
                            />
                            <span className="text-sm text-muted-foreground font-medium">in</span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <Separator className="opacity-60" />

                  {/* Avatar Section */}
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 mb-4">
                      <Sparkles className="w-5 h-5 text-primary" />
                      <h3 className="profile-section-title">Avatar Style</h3>
                    </div>
                    <div className="flex items-center gap-4 p-4 rounded-lg border border-border/40 bg-muted/20">
                      <Avatar className="w-14 h-14 border-2 border-primary/20">
                        <AvatarImage src={userAvatarUrl} />
                        <AvatarFallback className="bg-primary/10 text-primary text-lg font-bold">
                          {profile.name.charAt(0).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1">
                        <p className="font-medium text-foreground">Current Avatar</p>
                        <p className="text-sm text-muted-foreground">Customize your style representation</p>
                      </div>
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button variant="outline" size="sm">
                            <Edit className="w-4 h-4 mr-2" />
                            Edit
                          </Button>
                        </DialogTrigger>
	                        <DialogContent className="sm:max-w-md">
	                          <DialogHeader>
	                            <DialogTitle>Edit Avatar</DialogTitle>
	                            <DialogDescription className="sr-only">
	                              Update your profile avatar.
	                            </DialogDescription>
	                          </DialogHeader>
	                          <EditAvatarModal 
	                            currentProfile={profile}
	                            onAvatarUpdated={() => { 
                              toast({ title: 'Avatar updated successfully!' }); 
                            }}
                          />
                        </DialogContent>
                      </Dialog>
                    </div>
                  </div>

                  <Separator className="opacity-60" />

                  

                  {/* Save Button */}
                  <div className="pt-6">
                    <Button
                      size="lg"
                      disabled={savingDetails}
                      onClick={async () => {
                        try {
                          setSavingDetails(true);
                          const updates: any = {};
                          if (editName && editName !== (profile.name || '')) updates.name = editName;
                          if (editCity && editCity !== (profile.city || '')) updates.city = editCity;
                          
                          let heightCm: number | undefined;
                          if (heightUnit === 'cm') {
                            const v = parseFloat(heightCmInput);
                            if (Number.isFinite(v)) heightCm = Math.round(v);
                          } else {
                            const ft = parseFloat(heightFeet);
                            const inch = parseFloat(heightInches || '0');
                            if (Number.isFinite(ft)) {
                              const totalInches = ft * 12 + (Number.isFinite(inch) ? inch : 0);
                              heightCm = Math.round(totalInches * 2.54);
                            }
                          }
                          if (typeof heightCm === 'number') updates.height_cm = heightCm;

                          if (Object.keys(updates).length > 0) {
                            const { error } = await updateProfile(updates);
                            if (error) throw error;
                          }

                          

                          toast({
                            title: "Profile Updated",
                            description: "Your changes have been saved successfully.",
                          });
                        } catch (error) {
                          console.error('Failed to update profile:', error);
                          toast({
                            title: "Update Failed",
                            description: "Failed to save your changes. Please try again.",
                            variant: "destructive"
                          });
                        } finally {
                          setSavingDetails(false);
                        }
                      }}
                      className="w-full bg-primary hover:bg-primary/90 text-primary-foreground shadow-md"
                    >
                      {savingDetails ? (
                        <>
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                          Saving Changes...
                        </>
                      ) : (
                        <>
                          <Settings className="w-4 h-4 mr-2" />
                          Save All Changes
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>

        {/* Stats removed as requested */}

        {/* Enhanced Quick Actions */}
        <Card className="card-premium">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-primary" />
              Quick Actions
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 pt-0">
            {/* Sign Out */}
            <div className="profile-menu-item" onClick={() => handleMenuAction('logout')}>
              <div className="w-8 h-8 rounded-lg bg-red-500/10 flex items-center justify-center">
                <LogOut className="w-4 h-4 text-red-600" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-foreground">Sign Out</p>
                <p className="text-xs text-muted-foreground">Log out of your account</p>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </div>

            <div className="profile-menu-item" onClick={() => console.log('orders')}>
              <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <Package className="w-4 h-4 text-blue-600" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-foreground">Order History</p>
                <p className="text-xs text-muted-foreground">View your past purchases</p>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </div>

            <div className="profile-menu-item" onClick={() => console.log('payment')}>
              <div className="w-8 h-8 rounded-lg bg-green-500/10 flex items-center justify-center">
                <CreditCard className="w-4 h-4 text-green-600" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-foreground">Payment Methods</p>
                <p className="text-xs text-muted-foreground">Manage your payment options</p>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </div>

            <div className="profile-menu-item" onClick={() => console.log('notifications')}>
              <div className="w-8 h-8 rounded-lg bg-purple-500/10 flex items-center justify-center">
                <Bell className="w-4 h-4 text-purple-600" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-foreground">Notifications</p>
                <p className="text-xs text-muted-foreground">Customize your alerts</p>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
      </div>
    </PageLayout>
  );
}
