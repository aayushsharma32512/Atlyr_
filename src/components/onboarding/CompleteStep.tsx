import { motion } from 'framer-motion';

export function CompleteStep() {
  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      className="text-center space-y-8"
    >
      {/* Success Animation */}
      <motion.div 
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ delay: 0.2, duration: 0.6, type: "spring", bounce: 0.4 }}
        className="relative mx-auto"
      >
        <div className="w-24 h-24 mx-auto bg-gradient-to-br from-green-500 to-green-600 rounded-full flex items-center justify-center shadow-premium">
          <motion.span 
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.5, duration: 0.3 }}
            className="text-4xl text-white"
          >
            ✓
          </motion.span>
        </div>
        
        {/* Celebration particles */}
        {[...Array(6)].map((_, i) => (
          <motion.div
            key={i}
            initial={{ scale: 0, opacity: 0 }}
            animate={{ 
              scale: [0, 1, 0],
              opacity: [0, 1, 0],
              x: [0, (i % 2 ? 1 : -1) * (20 + i * 10)],
              y: [0, -20 - i * 5]
            }}
            transition={{ 
              delay: 0.6 + i * 0.1,
              duration: 1.5,
              ease: "easeOut"
            }}
            className="absolute top-1/2 left-1/2 w-2 h-2 bg-primary rounded-full"
          />
        ))}
      </motion.div>

      {/* Success Content */}
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.7, duration: 0.5 }}
        className="space-y-4"
      >
        <h1 className="text-display">
          You're all set!
        </h1>
        <p className="text-body text-muted-foreground max-w-sm mx-auto leading-relaxed">
          Perfect! Your personalized fashion experience is ready. Let's start exploring outfits curated just for you.
        </p>
      </motion.div>

      {/* Features Preview */}
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.9, duration: 0.5 }}
        className="bg-accent/50 rounded-xl p-6 space-y-4"
      >
        <h3 className="font-semibold text-foreground">What's next?</h3>
        <div className="space-y-3">
          {[
            { icon: "🎨", text: "Browse curated outfits" },
            { icon: "👤", text: "Try on with your avatar" },
            { icon: "💫", text: "Get personalized recommendations" }
          ].map((feature, index) => (
            <motion.div 
              key={index}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 1.1 + index * 0.1, duration: 0.3 }}
              className="flex items-center gap-3"
            >
              <span className="text-lg">{feature.icon}</span>
              <span className="text-sm text-muted-foreground">{feature.text}</span>
            </motion.div>
          ))}
        </div>
      </motion.div>
    </motion.div>
  );
}