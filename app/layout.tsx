import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ??
    requestHeaders.get("host") ??
    "localhost:3000";
  const protocol =
    requestHeaders.get("x-forwarded-proto") ??
    (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;

  return {
    metadataBase: new URL(origin),
    title: "Nimiq Pools — Predict together, settle in NIM",
    description:
      "Fixed-stake social prediction pools with declared API or creator-evidence resolution, transparent rules, and NIM settlement.",
    icons: {
      icon: "/nimiq-pools-logo-light.png",
      shortcut: "/nimiq-pools-logo-light.png",
      apple: "/nimiq-pools-logo-light.png",
    },
    openGraph: {
      title: "Nimiq Pools",
      description:
        "One locked prediction. One declared source. Transparent NIM settlement.",
      url: origin,
      siteName: "Nimiq Pools",
      images: [
        {
          url: `${origin}/og.png`,
          width: 1536,
          height: 1024,
          alt: "Nimiq Pools — predict together and settle without the mess.",
        },
      ],
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: "Nimiq Pools",
      description:
        "One locked prediction. One declared source. Transparent NIM settlement.",
      images: [`${origin}/og.png`],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link
          rel="stylesheet"
          type="text/css"
          href="https://cdn.jsdelivr.net/npm/@phosphor-icons/web@2.1.2/src/regular/style.css"
        />
        <link
          rel="icon"
          type="image/png"
          href="/nimiq-pools-logo-light.png"
          media="(prefers-color-scheme: light)"
        />
        <link
          rel="icon"
          type="image/png"
          href="/nimiq-pools-logo-dark.png"
          media="(prefers-color-scheme: dark)"
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `(() => {
              try {
                const saved = localStorage.getItem('nimiq-pools-theme');
                const theme = saved === 'light' || saved === 'dark'
                  ? saved
                  : (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
                document.documentElement.dataset.theme = theme;
                document.documentElement.style.colorScheme = theme;
              } catch (_) {}
            })();`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
