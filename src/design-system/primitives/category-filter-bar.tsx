import { cn } from "@/lib/utils"

import { IconButton } from "./icon-button"

import { Frame, Footprints, Grip, Shirt } from "lucide-react"

export type CategoryId = "top" | "bottom" | "shoes" | "others"

type CategoryConfig = {
  id: CategoryId
  label: string
  icon: React.ComponentType<{ className?: string }>

}

const DEFAULT_CATEGORIES: CategoryConfig[] = [
  { id: "top", label: "Top", icon: Shirt },
  {
	    id: "bottom",
	    label: "Bottom",
	    icon: (props: { className?: string }) => (
	      <svg width="21" height="18" viewBox="0 0 21 18" fill="none" xmlns="http://www.w3.org/2000/svg">
	        <g clipPath="url(#clip0_1_2625)">
	          <path fillRule="evenodd" clipRule="evenodd" d="M1.71599 0.0343769C1.52044 0.095399 1.36568 0.238497 1.27195 0.445235C1.23115 0.535043 1.2271 0.601418 1.22675 1.20438C1.22627 1.77119 1.21949 1.90096 1.17881 2.11817C0.667436 4.84774 0.359233 7.47455 0.13953 10.9774C0.0674454 12.1263 0 14.0089 0 14.8721C0 15.5305 0.0176048 15.6081 0.209354 15.7999C0.40039 15.991 0.384213 15.9875 1.71207 16.1137C1.90929 16.1325 2.52343 16.1894 3.07691 16.2403C3.63051 16.2912 4.18744 16.3431 4.31472 16.3556C4.66753 16.3903 5.18854 16.4392 6.29264 16.5411C6.84612 16.5922 7.45516 16.6496 7.64607 16.6686C8.16803 16.7209 8.4057 16.7154 8.5507 16.6478C8.69035 16.5828 8.81846 16.4611 8.88554 16.3296C8.93384 16.2351 9.02186 15.9135 9.7295 13.2502C9.86725 12.7316 9.98692 12.3152 9.99536 12.3248C10.0037 12.3345 10.0487 12.4933 10.0952 12.6778C10.1416 12.8623 10.2153 13.1486 10.2588 13.314C10.3024 13.4794 10.4904 14.203 10.6767 14.9218C10.863 15.6408 11.0377 16.274 11.065 16.3289C11.1253 16.4506 11.2818 16.5988 11.4127 16.6583C11.5351 16.7139 11.8098 16.7171 12.3094 16.6688C12.5057 16.6499 13.1191 16.5929 13.6726 16.5422C14.2261 16.4915 14.7311 16.4448 14.7947 16.4384C14.8583 16.4319 15.587 16.364 16.4141 16.2875C17.9602 16.1445 18.4108 16.1026 19.0515 16.0419C19.255 16.0225 19.4708 15.991 19.5309 15.9717C19.6784 15.9243 19.855 15.7608 19.9352 15.5975L20 15.4656L19.9956 14.8293C19.9875 13.67 19.9144 12.0582 19.7899 10.295C19.6515 8.33278 19.4458 6.38733 19.1884 4.60377C19.1012 3.99974 18.8745 2.63323 18.8295 2.44076C18.8129 2.36963 18.7969 1.97745 18.7881 1.42278L18.7738 0.520531L18.706 0.398249C18.6155 0.234691 18.4748 0.109435 18.3142 0.0493648L18.1822 0L9.99917 0.00154637C3.19682 0.00285481 1.79926 0.00832659 1.71599 0.0343769ZM5.93317 1.52995C6.09685 1.72456 6.14883 1.98791 6.07187 2.23248C6.02096 2.39437 5.86097 2.57839 5.69955 2.66082L5.58702 2.71839L4.06837 2.72482L2.5496 2.73112L2.53699 2.78263C2.50856 2.8998 2.264 4.42083 2.19965 4.88141C1.95223 6.6514 1.77725 8.34646 1.64331 10.2718C1.56766 11.3588 1.45775 13.7918 1.45763 14.3818L1.45751 14.6167L1.56742 14.6311C1.66151 14.6434 3.15078 14.783 3.94455 14.854C4.08443 14.8665 4.3604 14.8922 4.55762 14.9113C4.99572 14.9533 6.76084 15.1186 7.29517 15.1677C7.5094 15.1873 7.68961 15.1984 7.69579 15.1921C7.70198 15.1859 7.7523 15.0107 7.80761 14.8027C7.86292 14.5947 8.05063 13.8935 8.22453 13.2446C8.63087 11.7297 8.97738 10.4355 9.17257 9.705C9.33185 9.10834 9.38419 8.98035 9.51373 8.87103C9.65742 8.7497 9.8023 8.69915 10.0058 8.69915C10.2371 8.69915 10.3766 8.75851 10.5283 8.92147C10.6585 9.06147 10.6714 9.09668 10.8633 9.84382C10.9484 10.1746 11.0885 10.716 11.1748 11.0469C11.2609 11.3777 11.4272 12.0179 11.5442 12.4697C11.6481 12.8708 11.7523 13.2718 11.8569 13.6726C12.0072 14.2453 12.1696 14.8697 12.2088 15.0261C12.2281 15.1023 12.2517 15.1735 12.2616 15.1843C12.2715 15.195 12.455 15.1872 12.6695 15.1671C12.8841 15.1471 13.5124 15.0887 14.066 15.0376C14.6195 14.9864 15.2336 14.9293 15.4308 14.9107C15.6281 14.8921 15.904 14.8667 16.0439 14.8542C16.9133 14.7766 18.3497 14.6428 18.4326 14.6316L18.531 14.6183V14.3353C18.531 13.8061 18.4453 12.0182 18.3562 10.6883C18.1932 8.25594 17.9264 5.86906 17.5803 3.7478C17.514 3.34146 17.421 2.81843 17.4065 2.77038C17.395 2.73243 17.3055 2.72993 15.9541 2.72993C14.3763 2.72993 14.3769 2.72993 14.1874 2.59266C13.9905 2.44992 13.8612 2.16265 13.8914 1.93439C13.9098 1.79521 13.9692 1.65223 14.0556 1.53887L14.1177 1.45751H5.87215L5.93317 1.52995Z" fill="#292524" />
	        </g>
	        <defs>
	          <clipPath id="clip0_1_2625">
	            <rect width="20" height="16.7037" fill="white" />
	          </clipPath>
	        </defs>
	      </svg>

    )
  },
  { id: "shoes", label: "Shoes", icon: Footprints },
  { id: "others", label: "Others", icon: Grip },
]

export interface CategoryFilterBarProps {
  activeCategory?: CategoryId
  onCategoryChange?: (category: CategoryId) => void
  categories?: CategoryConfig[]
  className?: string
}

export function CategoryFilterBar({
  activeCategory = "top",
  onCategoryChange,
  categories = DEFAULT_CATEGORIES,
  className,
}: CategoryFilterBarProps) {
  return (
    <div className={cn("flex items-center justify-center gap-1", className)}>
      {categories.map((category, index) => {
        const Icon = category.icon
        const isActive = category.id === activeCategory

        return (
          <div
            className="flex items-center gap-1 justify-center w-full relative"
            key={category.id}
          >
            <IconButton
              tone="ghost"
              size="md"
              aria-pressed={isActive}
              aria-label={category.label}
              onClick={() => onCategoryChange?.(category.id)}
              className={cn(
                "h-9 w-9 border-b border-transparent text-muted-foreground",
                "hover:bg-muted/40 hover:text-foreground",
                isActive && "border-sidebar-border text-primary",
              )}
            >
              <Icon className="size-5" aria-hidden="true" />
            </IconButton>
            
            <span className=" absolute bottom-0 left-0 h-[1px] w-full bg-border/60" aria-hidden="true" />
            {/* {index < categories.length - 1 ? (
              <span className="h-6 w-px bg-border/60" aria-hidden="true" />
            ) : null} */}
          </div>
        )
      })}
    </div>
  )
}

