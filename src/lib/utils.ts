import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Helper to format currency
export const formatUSD = (val: number) => {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);
};

export const formatBs = (val: number) => {
  return new Intl.NumberFormat('es-VE', { style: 'currency', currency: 'VES' }).format(val).replace('VES', 'Bs.');
};
