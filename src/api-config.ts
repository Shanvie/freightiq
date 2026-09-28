declare global {
  interface Window {
    FREIGHTIQ_CONFIG?: {
      apiUrl?: string;
    };
  }
}

export const API_BASE_URL =
  import.meta.env.VITE_API_URL ||
  window.FREIGHTIQ_CONFIG?.apiUrl ||
  "http://localhost:8000";
