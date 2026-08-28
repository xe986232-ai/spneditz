import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

// Helper standar shadcn/ui: gabungin className kondisional (clsx) lalu
// resolve konflik utility Tailwind yang tabrakan (tailwind-merge), contoh
// "px-2 px-4" -> "px-4". Dipakai di semua komponen ui/* yang di-port dari
// Mock-up biar konsisten cara override className dari luar.
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
