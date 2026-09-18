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
import { CheckCircle, AlertCircle } from "lucide-react";
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
import { useEngagementAnalytics } from "@/integrations/posthog/engagementTracking/EngagementAnalyticsContext";

const EYEBROW = "By invitation, for now";
const HEADLINE_LEAD = "Get in";
const HEADLINE_ACCENT = "early";
const SUBLINE =
  "Atlyr opens in small circles. Leave your details and we will reach out on WhatsApp when your spot is ready.";
const CARD_TITLE = "Your details";
const SUBMIT_LABEL = "Join the waitlist";
const SUCCESS_HEADLINE = "You are on the list.";
const SUCCESS_LINE = "We will message you on WhatsApp when your spot opens.";

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

const fieldInputClass = (hasError: boolean) =>
  cn(
    "h-11 rounded-control border-hairline bg-background px-4 text-sm shadow-none focus-visible:ring-1 focus-visible:ring-violet",
    hasError && "border-destructive focus-visible:ring-destructive",
  );

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

  // The field messages and red borders carry the feedback; focus jumps to the first problem.
  const handleInvalid = () => {
    setFormError(null);
    setFormMessage(null);
    const first = Object.keys(form.formState.errors)[0] as keyof WaitlistFormValues | undefined;
    if (first) form.setFocus(first);
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
      className="relative flex h-full w-full flex-col items-center justify-center bg-background px-4 pb-6 pt-16 sm:px-6"
    >
      <div className="flex w-full max-w-md flex-col items-center gap-5 text-center sm:max-w-lg sm:gap-6">
        <div className="space-y-2 sm:space-y-3">
          <p className="text-xs font-medium uppercase tracking-[0.3em] text-muted-foreground">
            {EYEBROW}
          </p>
          <h2 className="font-display text-4xl font-medium tracking-tight text-foreground sm:text-5xl">
            {HEADLINE_LEAD} <span className="font-display italic text-violet">{HEADLINE_ACCENT}</span>.
          </h2>
          <p className="mx-auto max-w-sm text-sm text-muted-foreground sm:text-base">{SUBLINE}</p>
        </div>

        <Card className="w-full overflow-hidden rounded-2xl border border-hairline bg-card text-left shadow-sm">
          <CardContent className="p-5 sm:p-7">
            <div className="relative min-h-[260px]">
              {!completionState && (
                <div ref={formContainerRef}>
                  <Form {...form}>
                    <form className="space-y-4" onSubmit={handleFormSubmit}>
                      <p className="text-sm font-medium text-foreground">{CARD_TITLE}</p>

                      <div className="space-y-3">
                        <FormField
                          control={form.control}
                          name="name"
                          render={({ field, fieldState }) => (
                            <FormItem className="space-y-1.5">
                              <FormControl>
                                <Input
                                  {...field}
                                  placeholder="Name"
                                  disabled={isSubmitting}
                                  className={fieldInputClass(Boolean(fieldState.error))}
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
                            <FormItem className="space-y-1.5">
                              <FormControl>
                                <Input
                                  type="email"
                                  {...field}
                                  placeholder="Gmail address"
                                  disabled={isSubmitting}
                                  className={fieldInputClass(Boolean(fieldState.error))}
                                  aria-invalid={Boolean(fieldState.error)}
                                />
                              </FormControl>
                              <FormMessage className="text-xs" />
                            </FormItem>
                          )}
                        />
                        <div className="flex gap-2">
                          <FormField
                            control={form.control}
                            name="phoneCountry"
                            render={({ field, fieldState }) => (
                              <FormItem className="w-24">
                                <FormControl>
                                  <Select
                                    value={field.value}
                                    onValueChange={field.onChange}
                                    disabled={isSubmitting}
                                  >
                                    <SelectTrigger
                                      className={fieldInputClass(Boolean(fieldState.error))}
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
                                    placeholder="WhatsApp number"
                                    disabled={isSubmitting}
                                    className={fieldInputClass(Boolean(fieldState.error))}
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
                        className="h-11 w-full rounded-control bg-foreground font-semibold text-background shadow-none hover:bg-foreground/90"
                      >
                        {isSubmitting ? <LoadingSpinner size="sm" /> : SUBMIT_LABEL}
                      </Button>
                    </form>
                  </Form>
                </div>
              )}

              {completionState && (
                <div
                  ref={successRef}
                  className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center"
                >
                  {completionState === "success" ? (
                    <CheckCircle className="h-9 w-9 text-violet" />
                  ) : (
                    <AlertCircle className="h-9 w-9 text-muted-foreground" />
                  )}
                  <div className="space-y-1.5">
                    <p className="font-display text-xl font-medium text-foreground">
                      {completionState === "success" ? SUCCESS_HEADLINE : "You're already on the waitlist"}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {completionState === "success" ? SUCCESS_LINE : alreadyRegisteredCopy}
                    </p>
                  </div>
                </div>
              )}
            </div>

            {formMessage && (
              <Alert className="mt-5 border-hairline bg-background text-foreground">
                <AlertDescription className="text-sm">{formMessage}</AlertDescription>
              </Alert>
            )}
            {formError && (
              <Alert variant="destructive" className="mt-5">
                <AlertDescription className="text-sm">{formError}</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        <p className="text-sm text-muted-foreground">
          Already invited?{" "}
          <button
            type="button"
            onClick={onSignInClick}
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            Log in →
          </button>
        </p>
      </div>
    </section>
  );
}
