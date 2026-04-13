import { Instagram, Twitter, Facebook, Linkedin } from "lucide-react";
import Magnet from "../reactbits-components/Magnet";
import TextPressure from "../reactbits-components/TextPressure";

export function LandingFooter() {
  return (
    <footer className="bg-primary text-background">
      <div className="mx-auto max-w-7xl px-6 py-20 sm:px-8 lg:py-24">

        <div className="grid grid-cols-1 gap-16 lg:grid-cols-2 lg:gap-24">
          {/* Left Side - Brand and Tagline */}
          <div className="space-y-2">
            {/* Brand */}
            <div className="inline-block rounded-full border-none px-0 py-1 font-thin text-xl">
              <span className="tracking-wider">ATLYR</span>
            </div>

            {/* Tagline */}
            <div className="space-y-2">
              {/* Large Decorative Text */}
              <p className="text-2xl text-background/90 leading-relaxed max-w-md" style={{ fontFamily: "'Pacifico', cursive" }}>
                Outfits that express your
                <span className="block text-white italic">unique style</span>
                <span className="block text-white/90">and personality</span>
              </p>
            </div>

          </div>

          {/* Right Side - Navigation Links */}
          <div className="grid grid-cols-1 gap-12 sm:grid-cols-3 sm:gap-8">

            {/* Support Section */}
            {/* <div className="space-y-6">
              <h3 className="text-sm font-medium tracking-wider text-white/60 uppercase">
                Support
              </h3>
              <nav className="flex flex-col space-y-4">
                <a 
                  href="#contact" 
                  className="text-white/80 hover:text-white transition-colors duration-200 text-sm"
                >
                  Contact
                </a>
                <a 
                  href="#faq" 
                  className="text-white/80 hover:text-white transition-colors duration-200 text-sm"
                >
                  FAQs
                </a>
                <a 
                  href="#help" 
                  className="text-white/80 hover:text-white transition-colors duration-200 text-sm"
                >
                  Help Center
                </a>
                <a 
                  href="#privacy" 
                  className="text-white/80 hover:text-white transition-colors duration-200 text-sm"
                >
                  Privacy
                </a>
              </nav>
            </div> */}

            {/* Social Links Section */}
            <div className="space-y-3">

              <div className="flex items-center gap-5">
                <Magnet
                  padding={60}
                  magnetStrength={5}
                  activeTransition="transform 0.2s ease-out"
                  inactiveTransition="transform 0.4s ease-in-out"
                >
                  <a
                    href="#"
                    className="group relative flex items-center justify-center w-12 h-12 rounded-full border border-white/20 hover:border-white/50 transition-all duration-300 hover:bg-white/10"
                    aria-label="Instagram"
                  >
                    <Instagram className="h-5 w-5 text-white/70 group-hover:text-white transition-all duration-300 group-hover:scale-125 group-hover:rotate-[-8deg]" />
                    <span className="absolute inset-0 rounded-full bg-white/0 group-hover:bg-white/10 blur-md transition-all duration-300"></span>
                  </a>
                </Magnet>
                <Magnet
                  padding={60}
                  magnetStrength={4}
                  activeTransition="transform 0.1s ease-out"
                  inactiveTransition="transform 0.4s ease-in-out"
                >
                  <a
                    href="#"
                    className="group relative flex items-center justify-center w-12 h-12 rounded-full border border-white/20 hover:border-white/50 transition-all duration-300 hover:bg-white/10"
                    aria-label="Twitter"
                  >
                    <Twitter className="h-5 w-5 text-white/70 group-hover:text-white transition-all duration-300 group-hover:scale-125 group-hover:rotate-[-8deg]" />
                    <span className="absolute inset-0 rounded-full bg-white/0 group-hover:bg-white/10 blur-md transition-all duration-300"></span>
                  </a>
                </Magnet>
                <Magnet
                  padding={60}
                  magnetStrength={5}
                  activeTransition="transform 0.2s ease-out"
                  inactiveTransition="transform 0.4s ease-in-out"
                >
                  <a
                    href="#"
                    className="group relative flex items-center justify-center w-12 h-12 rounded-full border border-white/20 hover:border-white/50 transition-all duration-300 hover:bg-white/10"
                    aria-label="Facebook"
                  >
                    <Facebook className="h-5 w-5 text-white/70 group-hover:text-white transition-all duration-300 group-hover:scale-125 group-hover:rotate-[-8deg]" />
                    <span className="absolute inset-0 rounded-full bg-white/0 group-hover:bg-white/10 blur-md transition-all duration-300"></span>
                  </a>
                </Magnet>
                <Magnet
                  padding={60}
                  magnetStrength={5}
                  activeTransition="transform 0.2s ease-out"
                  inactiveTransition="transform 0.4s ease-in-out"
                >
                  <a
                    href="#"
                    className="group relative flex items-center justify-center w-12 h-12 rounded-full border border-white/20 hover:border-white/50 transition-all duration-300 hover:bg-white/10"
                    aria-label="LinkedIn"
                  >
                    <Linkedin className="h-5 w-5 text-white/70 group-hover:text-white transition-all duration-300 group-hover:scale-125 group-hover:rotate-[-8deg]" />
                    <span className="absolute inset-0 rounded-full bg-white/0 group-hover:bg-white/10 blur-md transition-all duration-300"></span>
                  </a>
                </Magnet>
              </div>
            </div>
          </div>
        </div>

        {/* Main Footer Content */}
        <div
          className="md:h-[440px] sm:h-[300px] h-[160px] mt-20 select-none"
          style={{ position: 'relative', userSelect: 'none' }}
        >
          <TextPressure
            text="ATLYR"
            flex={true}
            alpha={false}
            stroke={false}
            width={true}
            weight={true}
            italic={true}
            textColor="#ffffff"
            strokeColor="#ff0000"
            minFontSize={36}
          />
        </div>

        {/* Bottom Copyright Section */}
        <div className="mt-16 pt-8 border-t border-white/10">
          <div className="flex justify-center">
            <span className="text-xs text-white/50 tracking-wider text-center">
              DESIGN BY ATLYR • COPYRIGHT © {new Date().getFullYear()}. ALL RIGHTS RESERVED
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}

