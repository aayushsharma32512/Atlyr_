import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { gsap } from "gsap";
import {
  getCountries,
  getCountryCallingCode,
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js";
import { Linkedin, Facebook, Instagram, Twitter, CheckCircle, AlertCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { cn } from "@/lib/utils";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useToast } from "@/hooks/use-toast";
import { setPendingInviteCode } from "@/features/auth/inviteStorage";
import { useValidateInviteMutation } from "@/features/auth/hooks/useInviteAccess";
import { useWaitlistSubmissionMutation } from "@/features/auth/hooks/useWaitlist";
import { Separator } from "@/components/ui/separator";
import Magnet from "../reactbits-components/Magnet";
import { useEngagementAnalytics } from "@/integrations/posthog/engagementTracking/EngagementAnalyticsContext";

const waitlistSchema = z
  .object({
    name: z
      .string()
      .min(2, "Name must be at least 2 characters")
      .max(80, "Name looks a bit long"),
    email: z.string().email("Enter a valid email"),
    phoneCountry: z.string().min(2, "Select a country code"),
    phoneNumber: z.string().min(1, "Enter a phone number"),
  })
  .superRefine((values, ctx) => {
    if (!values.phoneCountry || !values.phoneNumber) return;
    const phone = parsePhoneNumberFromString(
      values.phoneNumber,
      values.phoneCountry as CountryCode,
    );
    if (!phone || !phone.isValid()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Enter a valid phone number",
        path: ["phoneNumber"],
      });
    }
  });

type WaitlistFormValues = z.infer<typeof waitlistSchema>;

type WaitlistSectionProps = {
  utmParams: Record<string, string>;
  onSignInClick: () => void;
};

const getFlagEmoji = (countryCode: string) => {
  if (countryCode.length !== 2) return "🏳️";
  return countryCode
    .toUpperCase()
    .replace(/[A-Z]/g, (char) => String.fromCodePoint(char.charCodeAt(0) + 127397));
};

export function WaitlistSection({ utmParams, onSignInClick }: WaitlistSectionProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const analytics = useEngagementAnalytics();

  const [formMessage, setFormMessage] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showInviteInput, setShowInviteInput] = useState(false);
  const [inviteCode, setInviteCode] = useState("");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteChecking, setInviteChecking] = useState(false);
  const [completionState, setCompletionState] = useState<"success" | "already" | null>(null);
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const formContainerRef = useRef<HTMLDivElement>(null);
  const successRef = useRef<HTMLDivElement>(null);
  const resetTimerRef = useRef<number | null>(null);
  const hasShownCompletion = useRef(false);
  const { toast } = useToast();
  const successCopy = "Waitlist confirmed. Beta invites start rolling out in ~1–2 weeks - watch your WhatsApp for updates.";
  const alreadyRegisteredCopy = "You're already on the waitlist. We'll reach out with updates soon.";
  const countryOptions = useMemo(() => {
    const formatter = new Intl.DisplayNames(["en"], { type: "region" });
    return getCountries()
      .map((code) => ({
        code,
        name: formatter.of(code) ?? code,
        callingCode: getCountryCallingCode(code),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, []);

  const form = useForm<WaitlistFormValues>({
    resolver: zodResolver(waitlistSchema),
    defaultValues: { name: "", email: "", phoneCountry: "IN", phoneNumber: "" },
    mode: "onSubmit",
    reValidateMode: "onChange",
    shouldFocusError: true,
  });
  const selectedCountryCode = form.watch("phoneCountry");
  const selectedCountry = useMemo(
    () => countryOptions.find((country) => country.code === selectedCountryCode),
    [countryOptions, selectedCountryCode],
  );

  const waitlistSubmission = useWaitlistSubmissionMutation();
  const inviteValidation = useValidateInviteMutation();

  const showCompletionScreen = (state: "success" | "already") => {
    if (resetTimerRef.current) {
      window.clearTimeout(resetTimerRef.current);
    }

    if (formContainerRef.current) {
      gsap.to(formContainerRef.current, {
        opacity: 0,
        y: 12,
        duration: 0.35,
        ease: "power2.inOut",
        onComplete: () => {
          setCompletionState(state);
          gsap.set(formContainerRef.current, { opacity: 1, y: 0 });
        },
      });
    } else {
      setCompletionState(state);
    }

    resetTimerRef.current = window.setTimeout(() => {
      setCompletionState(null);
      setFormMessage(null);
    }, 4500);
  };

  const handleInvalid = () => {
    setFormError(null);
    setFormMessage(null);
    const errorMessages = Object.values(form.formState.errors)
      .map((error) => error?.message)
      .filter(Boolean);

    toast({
      title: "Please fix the highlighted fields",
      description: errorMessages.length > 0 ? errorMessages.join(" • ") : "Check the required fields.",
      variant: "destructive",
    });
  };

  const handleFormSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    setFormMessage(null);

    try {
      const isValid = await form.trigger();
      if (!isValid) {
        handleInvalid();
        return;
      }
    } catch (error) {
      // Validation errors are expected user behavior, not app errors
      // User feedback is already handled by handleInvalid()
      handleInvalid();
      return;
    }

    await handleSubmit(form.getValues());
  };

  const handleSubmit = async (values: WaitlistFormValues) => {
    setIsSubmitting(true);
    setFormError(null);
    setFormMessage(null);

    const phone = parsePhoneNumberFromString(
      values.phoneNumber,
      values.phoneCountry as CountryCode,
    );
    const phoneNumber = phone?.number ?? values.phoneNumber;

    const source = searchParams.get("utm_source") ?? searchParams.get("ref") ?? "direct";
    const metadata = {
      ...utmParams,
      referrer: document.referrer || null,
      path: location.pathname,
    };

    try {
      const payload = await waitlistSubmission.mutateAsync({
        name: values.name,
        email: values.email,
        phone_number: phoneNumber,
        source,
        metadata,
      });

      const waitlistSource = searchParams.has("ref") ? "share_link" : "landing_form";

      if (!payload?.success) {
        const code = payload?.error;
        const result =
          code === "ALREADY_REGISTERED"
            ? "already_registered"
            : code === "EMAIL_REQUIRED" || code === "NAME_REQUIRED" || code === "PHONE_REQUIRED"
              ? "validation_error"
              : "server_error";

        analytics.capture("waitlist_submitted", { result, waitlist_source: waitlistSource });

        if (code === "ALREADY_REGISTERED") {
          showCompletionScreen("already");
        } else if (code === "EMAIL_REQUIRED") {
          setFormError("Enter an email so we can reach you.");
        } else if (code === "NAME_REQUIRED") {
          setFormError("Add a name so we can personalize your invite.");
        } else if (code === "PHONE_REQUIRED") {
          setFormError("Enter a phone number so we can reach you.");
        } else {
          setFormError("We couldn't add you right now. Please try again in a moment.");
        }
        return;
      }

      analytics.capture("waitlist_submitted", { result: "success", waitlist_source: waitlistSource });

      setFormMessage("We'll reachout to you when the next cohort opens.");
      form.reset();
      toast({
        title: "You're on the list!",
        description: successCopy,
      });

      showCompletionScreen("success");
    } catch (err) {
      console.error("Unexpected waitlist error", err);
      const waitlistSource = searchParams.has("ref") ? "share_link" : "landing_form";
      analytics.capture("waitlist_submitted", { result: "server_error", waitlist_source: waitlistSource });
      setFormError("We hit a snag saving your info. Refresh and try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleInviteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = inviteCode.trim();
    if (!trimmed) {
      setInviteError("Enter your invite code");
      return;
    }
    setInviteChecking(true);
    setInviteError(null);

    try {
      const result = await inviteValidation.mutateAsync(trimmed);

      if (!result.valid) {
        const reason = result.error;
        const message =
          reason === "INVITE_MAXED_OUT"
            ? "That invite has already been used. If you already have an account, log in."
            : reason === "INVITE_EXPIRED"
              ? "That invite code has expired. Request a new invite."
              : reason === "INVITE_INACTIVE"
                ? "That invite has been disabled."
                : "That code isn't active yet. Double-check and try again.";

        setInviteError(message);
        return;
      }

      setPendingInviteCode(trimmed);
      navigate(`/auth/signup?invite=${encodeURIComponent(trimmed)}&next=%2Fapp`);
    } catch (inviteErr) {
      console.error("Unexpected invite validation error", inviteErr);
      setInviteError("We couldn't validate the code. Please try again in a moment.");
    } finally {
      setInviteChecking(false);
    }
  };

  useEffect(() => {
    if (!leftRef.current || !rightRef.current || !formRef.current) return;

    const formFields = formRef.current.querySelectorAll('[class*="space-y"]');

    const tl = gsap.timeline({ defaults: { ease: "power3.out" } });

    // Animate left panel
    tl.from(leftRef.current, {
      opacity: 0,
      x: -30,
      duration: 0.6,
    })
      // Animate right panel
      .from(rightRef.current, {
        opacity: 0,
        x: 30,
        duration: 0.6,
      }, "-=0.4")
      // Animate form elements
      .from(formFields, {
        opacity: 0,
        y: 8,
        duration: 0.3,
        stagger: 0.1,
      }, "-=0.3");
  }, []);

  useEffect(() => {
    if (completionState && successRef.current) {
      hasShownCompletion.current = true;
      gsap.fromTo(
        successRef.current,
        { opacity: 0, y: 12, scale: 0.98 },
        { opacity: 1, y: 0, scale: 1, duration: 0.45, ease: "power3.out" },
      );
    }

    if (!completionState && hasShownCompletion.current && formContainerRef.current) {
      gsap.fromTo(
        formContainerRef.current,
        { opacity: 0, y: 8 },
        { opacity: 1, y: 0, duration: 0.35, ease: "power3.out" },
      );
    }
  }, [completionState]);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current) {
        window.clearTimeout(resetTimerRef.current);
      }
    };
  }, []);

  return (
    <section
      id="waitlist-form"
      className="relative flex min-h-screen w-full flex-col items-center bg-background"
    >
      <div className="mx-auto w-full max-w-5xl px-5 pb-6 pt-16 sm:px-4 sm:pb-14 lg:px-4 lg:pb-20">
        <div ref={rightRef} className="mx-auto flex w-full max-w-lg items-center">
          <Card className="w-full overflow-hidden rounded-none border-0 shadow-none sm:border-l-1 sm:border-border">
            <CardContent className="p-2 sm:p-3 lg:p-4">
              <div className="space-y-2">
                <h3 className="text-2xl font-semibold uppercase text-foreground">Join the waitlist</h3>
                <p className="text-sm text-muted-foreground">Be the first to know when we launch</p>
              </div>

              <div className="relative mt-6 min-h-[420px]">
                {!completionState && (
                  <div ref={formContainerRef} className="space-y-5">
                    <div className="rounded-xl border border-border/60 bg-background/60 p-4 shadow-sm sm:p-5">
                      <Form {...form}>
                        <form
                          ref={formRef}
                          className="space-y-4 sm:space-y-5"
                          onSubmit={handleFormSubmit}
                        >
                          <div className="space-y-1">
                            <p className="text-sm font-medium text-foreground">Your details</p>
                            <p className="text-xs text-muted-foreground">
                              We will reach out once the beta is ready.
                            </p>
                          </div>

                          <div className="space-y-3">
                            <FormField
                              control={form.control}
                              name="name"
                              render={({ field, fieldState }) => (
                                <FormItem className="space-y-2">
                                  <FormControl>
                                    <Input
                                      {...field}
                                      placeholder="Your Name"
                                      disabled={isSubmitting}
                                      className={cn(
                                        "h-10 rounded-lg text-sm border-border bg-background/80 shadow-sm focus-visible:ring-1 focus-visible:ring-ring",
                                        fieldState.error && "border-destructive focus-visible:ring-destructive",
                                      )}
                                      aria-invalid={Boolean(fieldState.error)}
                                    />
                                  </FormControl>
                                  <FormMessage className="text-xs" />
                                </FormItem>
                              )}
                            />
                            <FormField
                              control={form.control}
                              name="email"
                              render={({ field, fieldState }) => (
                                <FormItem className="space-y-2">
                                  <FormControl>
                                    <Input
                                      type="email"
                                      {...field}
                                      placeholder="Email"
                                      disabled={isSubmitting}
                                      className={cn(
                                        "h-10 rounded-lg text-sm border-border bg-background/80 shadow-sm focus-visible:ring-1 focus-visible:ring-ring",
                                        fieldState.error && "border-destructive focus-visible:ring-destructive",
                                      )}
                                      aria-invalid={Boolean(fieldState.error)}
                                    />
                                  </FormControl>
                                  <FormMessage className="text-xs" />
                                </FormItem>
                              )}
                            />
                          </div>

                          <div className="space-y-3">
                            <div className="flex gap-2">
                              <FormField
                                control={form.control}
                                name="phoneCountry"
                                render={({ field, fieldState }) => (
                                  <FormItem className="w-22">
                                    <FormControl>
                                      <Select
                                        value={field.value}
                                        onValueChange={field.onChange}
                                        disabled={isSubmitting}
                                      >
                                        <SelectTrigger
                                          className={cn(
                                            "h-10 rounded-lg text-sm border-border bg-background/80 shadow-sm focus-visible:ring-1 focus-visible:ring-ring",
                                            fieldState.error && "border-destructive focus-visible:ring-destructive",
                                          )}
                                          aria-invalid={Boolean(fieldState.error)}
                                          aria-label="Country calling code"
                                        >
                                          <span className="flex items-center gap-2">
                                            <span aria-hidden="true">
                                              {getFlagEmoji(selectedCountry?.code ?? "IN")}
                                            </span>
                                            <span className="text-sm font-medium">
                                              +{selectedCountry?.callingCode ?? getCountryCallingCode("IN")}
                                            </span>
                                          </span>
                                        </SelectTrigger>
                                        <SelectContent>
                                          {countryOptions.map((country) => (
                                            <SelectItem key={country.code} value={country.code}>
                                              <span className="flex items-center gap-2">
                                                <span aria-hidden="true">{getFlagEmoji(country.code)}</span>
                                                <span className="flex-1">{country.name}</span>
                                                <span className="text-muted-foreground">
                                                  +{country.callingCode}
                                                </span>
                                              </span>
                                            </SelectItem>
                                          ))}
                                        </SelectContent>
                                      </Select>
                                    </FormControl>
                                    <FormMessage className="text-xs" />
                                  </FormItem>
                                )}
                              />
                              <FormField
                                control={form.control}
                                name="phoneNumber"
                                render={({ field, fieldState }) => (
                                  <FormItem className="flex-1">
                                    <FormControl>
                                      <Input
                                        type="tel"
                                        {...field}
                                        placeholder="WhatsApp number preferred"
                                        disabled={isSubmitting}
                                        className={cn(
                                          "h-10 rounded-lg text-sm border-border bg-background/80 shadow-sm focus-visible:ring-1 focus-visible:ring-ring",
                                          fieldState.error && "border-destructive focus-visible:ring-destructive",
                                        )}
                                        inputMode="tel"
                                        autoComplete="tel"
                                        aria-invalid={Boolean(fieldState.error)}
                                      />
                                    </FormControl>
                                    <FormMessage className="text-xs" />
                                  </FormItem>
                                )}
                              />
                            </div>
                          </div>

                          <Button
                            type="submit"
                            disabled={isSubmitting}
                            className="mt-2 h-10 w-full rounded-lg font-semibold shadow-sm hover:bg-primary/90"
                          >
                            {isSubmitting ? <LoadingSpinner size="sm" /> : "Join waitlist"}
                          </Button>
                        </form>
                      </Form>
                    </div>

                    <Separator />

                    <div className="rounded-xl border border-border/60 bg-background/50 px-4 py-4 text-center shadow-sm sm:px-5">
                      <div className="space-y-3">
                        {!showInviteInput ? (
                          <Button
                            type="button"
                            onClick={() => {
                              setShowInviteInput(true);
                              setInviteError(null);
                            }}
                            variant="outline"
                            className="h-10 w-full rounded-lg border-none border-foreground/20 underline underline-offset-2 bg-background/80 text-sm font-medium shadow-sm hover:text-foreground/80 hover:underline hover:bg-transparent"
                          >
                            Have an invite code?
                          </Button>
                        ) : (
                          <div className="relative space-y-4 text-left">
                            <div className="flex items-start justify-between gap-4">
                              <div className="space-y-1 pr-6">
                                <p className="text-sm font-semibold text-foreground">Redeem your invite</p>
                                <p className="text-xs text-muted-foreground">
                                  Enter the code you received to create your account.
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => setShowInviteInput(false)}
                                className="rounded-full p-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                                aria-label="Close invite form"
                              >
                                ✕
                              </button>
                            </div>
                            <form onSubmit={handleInviteSubmit} className="space-y-2">
                              <div className="space-y-1">
                                <Input
                                  id="invite-code"
                                  value={inviteCode}
                                  onChange={(e) => {
                                    setInviteCode(e.target.value);
                                    setInviteError(null);
                                  }}
                                  placeholder="Invite code"
                                  autoFocus
                                  disabled={inviteChecking}
                                  className="h-10 rounded-lg border-border bg-background/80 text-center text-sm shadow-sm"
                                />
                              </div>
                              <Button
                                type="submit"
                                variant="ghost"
                                disabled={inviteChecking}
                                className="mt-1 h-10 w-full rounded-lg border border-border font-medium hover:bg-muted bg-muted"
                              >
                                {inviteChecking ? "Checking..." : "Redeem"}
                              </Button>
                            </form>
                            {inviteError && <p className="text-xs text-destructive">{inviteError}</p>}
                          </div>
                        )}

                        <div className="text-sm text-muted-foreground">
                          <span>Already have an account? </span>
                          <button
                            type="button"
                            onClick={onSignInClick}
                            className="font-medium text-foreground underline underline-offset-2 transition-colors hover:text-foreground/80"
                          >
                            Sign in
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {completionState && (
                  <div
                    ref={successRef}
                    className="absolute inset-0 flex flex-col items-center justify-start gap-4 rounded-lg bg-background px-4 text-center"
                  >
                    <div className="flex h-32 w-32 items-center justify-center">
                      {completionState === "success" ? (
                        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/10 text-primary shadow-lg">
                          <CheckCircle className="h-12 w-12" />
                        </div>
                      ) : (
                        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-muted text-foreground shadow-lg">
                          <AlertCircle className="h-12 w-12" />
                        </div>
                      )}
                    </div>
                    <div className="max-w-md space-y-2">
                      <p className="text-lg font-semibold text-foreground">
                        {completionState === "success"
                          ? "Successfully joined the waitlist!"
                          : "You're already on the waitlist"}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {completionState === "success" ? successCopy : alreadyRegisteredCopy}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {formMessage && (
                <Alert className="mt-6 border-primary/20 bg-primary/5 text-foreground">
                  <AlertDescription className="text-sm">{formMessage}</AlertDescription>
                </Alert>
              )}
              {formError && (
                <Alert variant="destructive" className="mt-6">
                  <AlertDescription className="text-sm">{formError}</AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
      <footer className="bg-primary text-background w-full">
        <div className="mx-auto max-w-7xl px-6 py-16 sm:px-8 lg:py-20">
          <div className="flex flex-col lg:flex-row items-start justify-between w-full gap-1">

            {/* Brand + Tagline */}
            <div className="flex flex-col items-start w-full lg:w-auto">
              <div className="inline-block font-normal text-2xl tracking-widest">
                ATLYR
              </div>
              <div className="lg:block mt-2">
                <p
                  className="text-sm text-background/90 text-left leading-normal max-w-xs"
                  style={{ fontFamily: "'Pacifico', cursive" }}
                >
                  discover your
                  <span className="block text-white ">personal style</span>
                </p>
              </div>
            </div>

            {/* Social Links Section (left on mobile, right on desktop) */}
            <div className="flex flex-col items-start lg:items-end w-full lg:w-auto mt-2 lg:mt-0">
              <div className="flex items-center gap-4">
                <Magnet
                  padding={45}
                  magnetStrength={5}
                  activeTransition="transform 0.2s ease-out"
                  inactiveTransition="transform 0.4s ease-in-out"
                >
                  <a
                    href="#"
                    className="group relative flex items-center justify-center w-9 h-9 rounded-full border border-white/20 hover:border-white/50 transition-all duration-300 hover:bg-white/10"
                    aria-label="Instagram"
                  >
                    <Instagram className="h-4 w-4 text-white/70 group-hover:text-white transition-all duration-300 group-hover:scale-125 group-hover:rotate-[-8deg]" />
                    <span className="absolute inset-0 rounded-full bg-white/0 group-hover:bg-white/10 blur-md transition-all duration-300"></span>
                  </a>
                </Magnet>
                <Magnet
                  padding={45}
                  magnetStrength={4}
                  activeTransition="transform 0.1s ease-out"
                  inactiveTransition="transform 0.4s ease-in-out"
                >
                  <a
                    href="#"
                    className="group relative flex items-center justify-center w-9 h-9 rounded-full border border-white/20 hover:border-white/50 transition-all duration-300 hover:bg-white/10"
                    aria-label="Twitter"
                  >
                    <Twitter className="h-4 w-4 text-white/70 group-hover:text-white transition-all duration-300 group-hover:scale-125 group-hover:rotate-[-8deg]" />
                    <span className="absolute inset-0 rounded-full bg-white/0 group-hover:bg-white/10 blur-md transition-all duration-300"></span>
                  </a>
                </Magnet>
                <Magnet
                  padding={45}
                  magnetStrength={5}
                  activeTransition="transform 0.2s ease-out"
                  inactiveTransition="transform 0.4s ease-in-out"
                >
                  <a
                    href="#"
                    className="group relative flex items-center justify-center w-9 h-9 rounded-full border border-white/20 hover:border-white/50 transition-all duration-300 hover:bg-white/10"
                    aria-label="Facebook"
                  >
                    <Facebook className="h-4 w-4 text-white/70 group-hover:text-white transition-all duration-300 group-hover:scale-125 group-hover:rotate-[-8deg]" />
                    <span className="absolute inset-0 rounded-full bg-white/0 group-hover:bg-white/10 blur-md transition-all duration-300"></span>
                  </a>
                </Magnet>
                <Magnet
                  padding={45}
                  magnetStrength={5}
                  activeTransition="transform 0.2s ease-out"
                  inactiveTransition="transform 0.4s ease-in-out"
                >
                  <a
                    href="#"
                    className="group relative flex items-center justify-center w-9 h-9 rounded-full border border-white/20 hover:border-white/50 transition-all duration-300 hover:bg-white/10"
                    aria-label="LinkedIn"
                  >
                    <Linkedin className="h-4 w-4 text-white/70 group-hover:text-white transition-all duration-300 group-hover:scale-125 group-hover:rotate-[-8deg]" />
                    <span className="absolute inset-0 rounded-full bg-white/0 group-hover:bg-white/10 blur-md transition-all duration-300"></span>
                  </a>
                </Magnet>
              </div>
            </div>
          </div>

          {/* Bottom Copyright Section */}
          <div className="mt-6 pt-8 border-t border-white/10 mb-6">
            <div className="flex justify-start">
              <span className="text-xs text-white/50 tracking-wider text-left">
                DESIGN BY ATLYR • COPYRIGHT © {new Date().getFullYear()}. ALL RIGHTS RESERVED
              </span>
            </div>
          </div>
        </div>
      </footer>
    </section>
  );
}
