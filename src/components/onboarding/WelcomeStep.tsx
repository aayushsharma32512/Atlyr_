import { motion } from 'framer-motion';

export function WelcomeStep() {
  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: "easeOut" }}
      className="text-center space-y-8"
    >
      {/* Brand Logo/Icon */}
      <motion.div 
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.2, duration: 0.5 }}
        className="relative mx-auto"
      >
        <div className="w-24 h-24 mx-auto bg-gradient-to-br from-primary via-primary/80 to-primary/60 rounded-full flex items-center justify-center shadow-premium">
          <span className="text-4xl">👔</span>
        </div>
        <div className="absolute inset-0 w-24 h-24 mx-auto bg-primary/20 rounded-full animate-pulse" />
      </motion.div>

      {/* Welcome Content */}
      <motion.div 
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4, duration: 0.5 }}
        className="space-y-4"
      >
        <h1 className="text-display bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text">
          Welcome to ATLYR
        </h1>
        <p className="text-body text-muted-foreground max-w-sm mx-auto leading-relaxed">
          Get Inspired, Discover, and Curate Looks
        </p>
      </motion.div>

      {/* Feature Highlights */}
      <motion.div 
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6, duration: 0.5 }}
        className="grid grid-cols-3 gap-4 max-w-xs mx-auto"
      >
        {[
          { icon: "✨", label: "Personalized" },
          { icon: "👤", label: "Custom Avatar" },
          { icon: "🎯", label: "Smart Picks" }
        ].map((feature, index) => (
          <div key={index} className="text-center space-y-2">
            <div className="w-12 h-12 mx-auto bg-accent rounded-xl flex items-center justify-center">
              <span className="text-lg">{feature.icon}</span>
            </div>
            <p className="text-xs text-muted-foreground font-medium">{feature.label}</p>
          </div>
        ))}
      </motion.div>
    </motion.div>
  );
}