import { motion } from 'framer-motion';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DatePicker } from './DatePicker';
import { GenderSelector } from './GenderSelector';

interface PersonalInfoStepProps {
  formData: {
    name: string;
    day: string;
    month: string;
    year: string;
    // Height inputs
    heightUnit: 'cm' | 'ftin';
    heightCmInput: string; // store as text input, convert later
    heightFeet: string;
    heightInches: string;
    gender: string;
    city: string;
    socialHandle: string;
  };
  onUpdateFormData: (updates: Partial<PersonalInfoStepProps['formData']>) => void;
  dobError?: string;
}

export function PersonalInfoStep({ formData, onUpdateFormData, dobError }: PersonalInfoStepProps) {
  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1
      }
    }
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0 }
  };

  return (
    <motion.div 
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="space-y-6"
    >
      {/* Name Field */}
      <motion.div variants={itemVariants} className="space-y-2">
        <Label htmlFor="name" className="text-sm font-medium">
          What's your name?
        </Label>
        <Input
          id="name"
          value={formData.name}
          onChange={(e) => onUpdateFormData({ name: e.target.value })}
          placeholder="Enter your full name"
          className="h-12 text-base"
        />
      </motion.div>

      {/* Date of Birth */}
      <motion.div variants={itemVariants} className="space-y-2">
        <Label className="text-sm font-medium">
          When were you born?
        </Label>
        <DatePicker
          day={formData.day}
          month={formData.month}
          year={formData.year}
          onDayChange={(day) => onUpdateFormData({ day })}
          onMonthChange={(month) => onUpdateFormData({ month })}
          onYearChange={(year) => onUpdateFormData({ year })}
          error={dobError}
        />
      </motion.div>

      {/* Height Selection */}
      <motion.div variants={itemVariants} className="space-y-2">
        <Label className="text-sm font-medium">
          What is your height?
        </Label>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className={`px-3 py-2 rounded-md text-xs border transition-colors ${formData.heightUnit === 'cm' ? 'bg-primary text-primary-foreground border-primary' : 'bg-transparent text-foreground border-border'}`}
            onClick={() => onUpdateFormData({ heightUnit: 'cm' })}
          >
            cm
          </button>
          <button
            type="button"
            className={`px-3 py-2 rounded-md text-xs border transition-colors ${formData.heightUnit === 'ftin' ? 'bg-primary text-primary-foreground border-primary' : 'bg-transparent text-foreground border-border'}`}
            onClick={() => onUpdateFormData({ heightUnit: 'ftin' })}
          >
            ft/in
          </button>
        </div>
        {formData.heightUnit === 'cm' ? (
          <div className="flex items-center gap-2">
            <Input
              inputMode="decimal"
              type="text"
              value={formData.heightCmInput}
              onChange={(e) => onUpdateFormData({ heightCmInput: e.target.value })}
              placeholder="e.g., 175"
              className="h-12 text-base max-w-[200px]"
            />
            <span className="text-sm text-muted-foreground">cm</span>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Input
                inputMode="numeric"
                type="text"
                value={formData.heightFeet}
                onChange={(e) => onUpdateFormData({ heightFeet: e.target.value })}
                placeholder="5"
                className="h-12 text-base w-20"
              />
              <span className="text-sm text-muted-foreground">ft</span>
            </div>
            <div className="flex items-center gap-2">
              <Input
                inputMode="numeric"
                type="text"
                value={formData.heightInches}
                onChange={(e) => onUpdateFormData({ heightInches: e.target.value })}
                placeholder="9"
                className="h-12 text-base w-20"
              />
              <span className="text-sm text-muted-foreground">in</span>
            </div>
          </div>
        )}
        <p className="text-xs text-muted-foreground">You can change this later in your profile.</p>
      </motion.div>

      {/* Body Type Selection */}
      <motion.div variants={itemVariants} className="space-y-2">
        <Label className="text-sm font-medium">
          Gender
        </Label>
        <GenderSelector
          selectedGender={formData.gender}
          onSelect={(gender) => onUpdateFormData({ gender })}
        />
      </motion.div>

      {/* City Field */}
      <motion.div variants={itemVariants} className="space-y-2">
        <Label htmlFor="city" className="text-sm font-medium">
          Which city are you in?
        </Label>
        <Input
          id="city"
          value={formData.city}
          onChange={(e) => onUpdateFormData({ city: e.target.value })}
          placeholder="Enter your city"
          className="h-12 text-base"
        />
      </motion.div>

      {/* Social Handle Field */}
      <motion.div variants={itemVariants} className="space-y-2">
        <Label htmlFor="socialHandle" className="text-sm font-medium">
          Instagram handle <span className="text-muted-foreground">(optional)</span>
        </Label>
        <Input
          id="socialHandle"
          value={formData.socialHandle}
          onChange={(e) => onUpdateFormData({ socialHandle: e.target.value })}
          placeholder="@yourhandle or leave blank"
          className="h-12 text-base"
        />
        <p className="text-xs text-muted-foreground">
          We'll use this to better understand your style preferences
        </p>
      </motion.div>
    </motion.div>
  );
}