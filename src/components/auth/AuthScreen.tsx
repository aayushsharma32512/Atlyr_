import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { useAuth } from "@/contexts/AuthContext";
import { useGuest } from "@/contexts/GuestContext";
import { supabase } from "@/integrations/supabase/client";
import { AlertCircle, Loader2, User } from "lucide-react";

type InviteValidationResponse = {
  valid: boolean;
  error?: string;
  type?: "beta" | "waitlist_invite" | "special";
  metadata?: Record<string, unknown> | null;
};


export function AuthScreen() {
  const [searchParams] = useSearchParams();
  const inviteParam = useMemo(() => searchParams.get("invite")?.trim() || null, [searchParams]);
  const [inviteState, setInviteState] = useState<
    | { status: "idle" }
    | { status: "valid"; code: string; type: "beta" | "waitlist_invite" | "special" }
    | { status: "invalid"; message: string }
  >({ status: "idle" });
  const [waitlistDialogOpen, setWaitlistDialogOpen] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const { signIn, signUp, signInWithGoogle } = useAuth();
  const { signInAsGuest } = useGuest();

  useEffect(() => {
    if (!inviteParam) {
      setInviteState({
        status: "invalid",
        message: "Signups are invite-only right now. Use a valid invite link to create an account.",
      });
      setIsSignUp(false);
      return;
    }

    setInviteState({ status: "idle" });

    supabase
      .rpc("validate_invite_code", { p_code: inviteParam })
      .then(({ data, error }) => {
        if (error) {
          console.error("Error validating invite", error);
          setInviteState({
            status: "invalid",
            message: "We couldn't verify that invite link. Try again or ask for a new link.",
          });
          setIsSignUp(false);
          return;
        }

        const payload = (data as InviteValidationResponse | null) ?? null;

        if (!payload?.valid) {
          const reason = payload?.error;
          const message =
            reason === "INVITE_NOT_FOUND"
              ? "That invite link doesn't exist anymore."
              : reason === "INVITE_INACTIVE"
                ? "That invite has been disabled."
                : reason === "INVITE_EXPIRED"
                  ? "That invite link has expired."
                  : reason === "INVITE_MAXED_OUT"
                    ? "That invite link has already been used the maximum number of times."
                    : "That invite link is no longer valid.";

          setInviteState({ status: "invalid", message });
          setIsSignUp(false);
          return;
        }

        setInviteState({
          status: "valid",
          code: inviteParam,
          type: payload?.type ?? "beta",
        });
        setIsSignUp(true);
      });
  }, [inviteParam]);

  useEffect(() => {
    if (inviteState.status === "invalid") {
      setWaitlistDialogOpen(true);
    }
  }, [inviteState]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      if (isSignUp) {
        if (inviteState.status !== "valid") {
          setError('You need a valid invite link to sign up.');
          return;
        }

        const { error } = await signUp(email, password);
        if (error) {
          if (error.message.includes('already registered')) {
            setError('This email is already registered. Try signing in instead.');
          } else {
            setError(error.message);
          }
        } else {
          await supabase.rpc("record_invite_use", { p_code: inviteState.code });
          setMessage('Check your email for a confirmation link!');
        }
      } else {
        const { error } = await signIn(email, password);
        if (error) {
          if (error.message.includes('Invalid login credentials')) {
            setError('Invalid email or password. Please try again.');
          } else {
            setError(error.message);
          }
        }
      }
    } catch (err) {
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const { error } = await signInWithGoogle();
      if (error) {
        setError(error.message);
      }
    } catch (err) {
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleGuestSignIn = () => {
    signInAsGuest();
    // Redirect to home page after guest sign in
    window.location.href = '/app';
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md card-premium">
        <CardHeader className="text-center space-y-4">
          <div className="w-16 h-16 mx-auto glass-card rounded-full flex items-center justify-center">
            <span className="text-2xl">✨</span>
          </div>
          <CardTitle className="text-display">
            {isSignUp ? 'Create Account' : 'Welcome Back'}
          </CardTitle>
          <p className="text-body text-muted-foreground">
            {isSignUp 
              ? 'Sign up to save your favorites and cart' 
              : 'Sign in to access your personalized experience'
            }
          </p>
        </CardHeader>
        
        <CardContent className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {message && (
            <Alert>
              <AlertDescription>{message}</AlertDescription>
            </Alert>
          )}

          {/* Google Sign-In Button */}
          <Button 
            type="button" 
            variant="outline" 
            className="w-full h-12 transition-colors" 
            onClick={handleGoogleSignIn}
            disabled={loading}
          >
            <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
              <path
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                fill="#4285F4"
              />
              <path
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                fill="#34A853"
              />
              <path
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                fill="#FBBC05"
              />
              <path
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                fill="#EA4335"
              />
            </svg>
            Continue with Google
          </Button>

          {/* Guest Sign-In Button */}
          <Button 
            type="button" 
            variant="outline" 
            className="w-full h-12 border-dashed transition-colors" 
            onClick={handleGuestSignIn}
            disabled={loading}
          >
            <User className="mr-2 h-4 w-4" />
            Continue as Guest
          </Button>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <Separator className="w-full" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">
                Or continue with
              </span>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter your email"
                required
                disabled={loading}
              />
            </div>
            
            <div>
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                required
                disabled={loading}
                minLength={6}
              />
            </div>

            <Button type="submit" className="w-full h-12 transition-colors" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isSignUp ? 'Sign Up' : 'Sign In'}
            </Button>
          </form>

          <div className="text-center">
            <Button
              variant="link"
              onClick={() => {
                setIsSignUp(!isSignUp);
                setError(null);
                setMessage(null);
              }}
              disabled={loading || inviteState.status !== "valid"}
            >
              {isSignUp 
                ? 'Already have an account? Sign in' 
                : inviteState.status === "valid"
                  ? "Don't have an account? Sign up"
                  : 'Signups require an invite'
              }
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog open={waitlistDialogOpen} onOpenChange={setWaitlistDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite required</DialogTitle>
            <DialogDescription>
              {inviteState.status === "invalid"
                ? inviteState.message
                : 'Signups are invite-only right now. Join the waitlist and we’ll notify you when it’s your turn.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button asChild variant="outline">
              <Link to="/">Back to landing</Link>
            </Button>
            <Button asChild>
              <Link to="/?waitlist=1">Join waitlist</Link>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}