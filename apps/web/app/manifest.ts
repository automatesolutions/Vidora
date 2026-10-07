import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Vidora",
    short_name: "Vidora",
    description: "Review and approve your AI-made videos before they post.",
    start_url: "/app",
    display: "standalone",
    background_color: "#fffefb",
    theme_color: "#fffefb",
    icons: [
      { src: "/brand/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/brand/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
