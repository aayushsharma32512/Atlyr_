// One icon per meaning. Import Icons.* here, never lucide-react directly.
// Sizes come from ICON in ../tokens: 20 in bars, 16 in rows, 14 in chips.
import {
  Bell,
  Camera,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Compass,
  Eye,
  Folders,
  Globe,
  Heart,
  Layers,
  LayoutGrid,
  Link,
  ListFilter,
  Maximize2,
  Minimize2,
  Plus,
  Redo2,
  RefreshCw,
  RotateCcw,
  Search,
  Share,
  ArrowUpDown,
  ArrowUpRight,
  Shirt,
  Sparkles,
  SquareUserRound,
  Trash2,
  Undo2,
  UserRound,
  X,
} from "lucide-react";

import { BottomsGlyph, HangerGlyph, ShoeGlyph } from "./glyphs";

export const Icons = {
  // V2 (design doc, Sep 2026): the save/favourite icon is the HEART
  // everywhere — it replaced the pin. Filled + violet = saved.
  save: Heart,

  tryOn: SquareUserRound,
  // Try-on button, states 2 and 3 (V2 "try on button · 3 states"):
  // eye = show the render, person = go back to the avatar.
  viewTryOn: Eye,
  viewAvatar: UserRound,
  findItems: Globe, // replaces "Buy" everywhere
  share: Share,

  undo: Undo2,
  redo: Redo2,
  restore: RotateCcw,
  similar: RefreshCw, // "more like this piece" — image-similarity search
  swap: ArrowUpDown, // layer row: which of the two tops is on top
  alternatives: LayoutGrid,

  slotTop: Shirt,
  slotBottom: BottomsGlyph,
  slotShoes: ShoeGlyph,
  slotLayer: Layers, // [P2], nothing sets it

  // Alternatives sources.
  // A hanger, not Shirt: Shirt is the `top` slot, and the two segments sit one
  // above the other on Alternates — the same glyph twice read as a doubled rail.
  sourceWardrobe: HangerGlyph,
  sourceSaves: Heart,
  sourceExplore: Compass, // Globe is taken by Find items — one icon per meaning

  addInspiration: Link,
  add: Plus,

  // Nav: Collections · Search · Studio · Notifications · Profile
  navCollections: Folders,
  navSearch: Search,
  navStudio: Sparkles,
  navNotifications: Bell,
  navProfile: UserRound,

  addWardrobe: Shirt,

  camera: Camera,
  filter: ListFilter,
  remove: Trash2,
  expand: Maximize2,
  collapse: Minimize2,
  openList: ArrowUpRight, // rail → its full page
  close: X,
  profile: UserRound,
  search: Search,
  check: Check,
  carouselPrev: ChevronLeft,
  carouselNext: ChevronRight,
  disclose: ChevronDown, // accordion rows; rotate 180 when open
} as const;

export type IconName = keyof typeof Icons;
