"use client";

import { init, type NimiqProvider } from "@nimiq/mini-app-sdk";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeftIcon, ArrowRightIcon, CheckIcon, CircleIcon, ClockCounterClockwiseIcon, CloudSunIcon, CopyIcon, CurrencyCircleDollarIcon, GiftIcon, HouseIcon, LinkIcon, MoonIcon, PlusCircleIcon, RankingIcon, ShareNetworkIcon, ShieldCheckIcon, SoccerBallIcon, SunIcon, UsersThreeIcon } from "./PhosphorIcons";
import type {
  EvidenceSubmission,
  Pool,
  ResolverType,
  SignedPredictionPayload,
  FootballFixtureOption,
  ReferralDashboard,
  RewardEvent,
} from "./types";

type View = "discover" | "create" | "activity" | "referrals";
type Notice = { tone: "success" | "warning" | "neutral"; text: string };
type Theme = "light" | "dark";
type PoolFilter = "all" | "crypto" | "sports" | "weather" | "others";

type CryptoTokenOption = {
  id: string;
  name: string;
  symbol: string;
  resolver: Extract<ResolverType, "BINANCE" | "COINGECKO">;
  asset: string;
  coinGeckoId?: string;
  suggestedTarget: string;
};

const DEMO_ADDRESS = "NQ82 DEMO POOL 2026 CREATOR 04XL 8D0Q";
const LUNA_PER_NIM = 100_000;
const resolverLabels: Record<ResolverType, string> = {
  BINANCE: "Binance",
  COINGECKO: "CoinGecko",
  FOOTBALL_DATA: "football-data.org",
  API_SPORTS: "API-Sports",
  OPEN_METEO: "Open-Meteo",
  MANUAL: "Manual",
};

const poolFilters: Array<{ id: PoolFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "crypto", label: "Crypto" },
  { id: "sports", label: "Sports" },
  { id: "weather", label: "Weather" },
  { id: "others", label: "Others" },
];

const cryptoTokenOptions: CryptoTokenOption[] = [
  {
    id: "nim",
    name: "Nimiq",
    symbol: "NIM",
    resolver: "COINGECKO",
    asset: "NIM/USDT",
    coinGeckoId: "nimiq",
    suggestedTarget: "0.0025",
  },
  {
    id: "btc",
    name: "Bitcoin",
    symbol: "BTC",
    resolver: "BINANCE",
    asset: "BTC/USDT",
    suggestedTarget: "120000",
  },
  {
    id: "eth",
    name: "Ethereum",
    symbol: "ETH",
    resolver: "BINANCE",
    asset: "ETH/USDT",
    suggestedTarget: "4200",
  },
  {
    id: "sol",
    name: "Solana",
    symbol: "SOL",
    resolver: "BINANCE",
    asset: "SOL/USDT",
    suggestedTarget: "250",
  },
  {
    id: "bnb",
    name: "BNB",
    symbol: "BNB",
    resolver: "BINANCE",
    asset: "BNB/USDT",
    suggestedTarget: "900",
  },
  {
    id: "xrp",
    name: "XRP",
    symbol: "XRP",
    resolver: "BINANCE",
    asset: "XRP/USDT",
    suggestedTarget: "4",
  },
  {
    id: "ada",
    name: "Cardano",
    symbol: "ADA",
    resolver: "BINANCE",
    asset: "ADA/USDT",
    suggestedTarget: "1.5",
  },
  {
    id: "doge",
    name: "Dogecoin",
    symbol: "DOGE",
    resolver: "BINANCE",
    asset: "DOGE/USDT",
    suggestedTarget: "0.5",
  },
  {
    id: "other",
    name: "Other token",
    symbol: "TOKEN",
    resolver: "COINGECKO",
    asset: "TOKEN/USDT",
    suggestedTarget: "1",
  },
];

const categoryOptions: Array<{
  id: "crypto" | "sports" | "weather" | "other";
  title: string;
  description: string;
  icon: React.ReactNode;
}> = [
    {
      id: "crypto",
      title: "Crypto",
      description: "Choose a token; the app routes it to Binance or CoinGecko automatically.",
      icon: <CurrencyCircleDollarIcon size={22} />,
    },
    {
      id: "sports",
      title: "Sports",
      description: "Pick a sport and future fixture; the best API is selected automatically.",
      icon: <SoccerBallIcon size={22} />,
    },
    {
      id: "weather",
      title: "Weather",
      description: "Observed conditions resolve for a fixed place and time.",
      icon: <CloudSunIcon size={22} />,
    },
    {
      id: "other",
      title: "Others",
      description: "Custom community markets resolve from creator-reviewed evidence.",
      icon: <UsersThreeIcon size={22} />,
    },
  ];

function formatNim(luna: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(luna / LUNA_PER_NIM);
}

function normalizeRecipientAddress(address: string, compact = false) {
  const normalized = String(address || "").replace(/\s+/g, "").toUpperCase();
  if (!normalized) return "";
  if (compact) return normalized;
  return normalized.replace(/(.{4})/g, "$1 ").trim();
}

function normalizeAddress(address: string) {
  return String(address || "").replace(/\s+/g, "").toUpperCase();
}

async function deriveAddressFromPublicKey(publicKey: string) {
  const { PublicKey } = await import("@nimiq/core");
  return PublicKey.fromHex(publicKey).toAddress().toUserFriendlyAddress();
}

async function normalizeTransactionHash(tx: string) {
  const trimmed = String(tx || "").trim();
  const compact = trimmed.replace(/^0x/i, "").replace(/\s+/g, "");
  if (!compact) {
    throw new Error("Nimiq Pay did not return a stake transaction.");
  }
  const hashLike = compact.match(/[0-9a-f]{64}/i)?.[0];
  if (hashLike && compact.length === 64) return hashLike;
  if (hashLike && /transactionHash|hash/i.test(trimmed)) return hashLike;
  if (/^[0-9a-f]{64}$/i.test(compact)) return compact;
  if (/^demo_/i.test(compact)) return compact;
  if (/^[0-9a-f]{64}$/i.test(trimmed)) return trimmed;
  const { Transaction } = await import("@nimiq/core");
  try {
    return Transaction.fromAny(compact).hash();
  } catch (error) {
    console.warn("Stake transaction normalization failed", { returnedTransaction: tx, error });
    throw new Error("Nimiq Pay returned a stake transaction in an unsupported format.");
  }
}

async function recoverStakeTransactionHash(address: string, recipient: string, amountLuna: number) {
  const result = await api<{ transaction: { hash: string } | null }>("/api/wallet/recover-stake", {
    method: "POST",
    body: JSON.stringify({ address, recipient, amountLuna }),
  });
  return result.transaction?.hash ?? null;
}

async function signWithProvider(provider: NimiqProvider, payload: string) {
  const attempts: Array<string | { message: string }> = [payload, { message: payload }];
  let lastError: Error | null = null;
  for (const attempt of attempts) {
    try {
      const result = await provider.sign(attempt as any);
      if ("error" in result) throw new Error(result.error.message || "Signature was declined.");
      return result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Signature was declined.");
    }
  }
  throw lastError ?? new Error("Signature was declined.");
}

function shortAddress(address: string) {
  if (address.length < 20) return address;
  return `${address.slice(0, 8)}…${address.slice(-5)}`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function timeLeft(value: string) {
  const delta = new Date(value).getTime() - Date.now();
  if (delta <= 0) return "Closed";
  const hours = Math.floor(delta / 3_600_000);
  const minutes = Math.floor((delta % 3_600_000) / 60_000);
  if (hours >= 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
  return `${hours}h ${minutes}m`;
}

function statusLabel(status: Pool["status"]) {
  return status.replaceAll("_", " ").toLowerCase();
}

function poolCategoryLabel(pool: Pool) {
  const category = String(pool.category || "").toLowerCase();
  const resolverType = String(pool.resolverType || "").toUpperCase();
  if (category.includes("crypto") || resolverType === "BINANCE" || resolverType === "COINGECKO") return "Crypto";
  if (category.includes("sport") || resolverType === "FOOTBALL_DATA" || resolverType === "API_SPORTS") return "Sports";
  if (category.includes("weather") || resolverType === "OPEN_METEO") return "Weather";
  return "Others";
}

function poolCategoryKey(pool: Pool): Exclude<PoolFilter, "all"> {
  const label = poolCategoryLabel(pool).toLowerCase();
  if (label === "crypto" || label === "sports" || label === "weather") return label;
  return "others";
}


function BrandLogo({ className = "" }: { className?: string }) {
  return (
    <span className={`brand-logo ${className}`.trim()} aria-hidden="true">
      <img
        className="brand-logo-image brand-logo-light"
        src="/nimiq-pools-logo-light.png"
        width={1024}
        height={1024}
        alt=""
      />
      <img
        className="brand-logo-image brand-logo-dark"
        src="/nimiq-pools-logo-dark.png"
        width={1024}
        height={1024}
        alt=""
      />
    </span>
  );
}

async function api<T>(path: string, initOptions?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...initOptions,
    headers: {
      "content-type": "application/json",
      ...initOptions?.headers,
    },
  });
  const body = (await response.json()) as T & { error?: unknown };
  if (!response.ok) {
    const error = body.error;
    const message =
      typeof error === "string"
        ? error
        : error && typeof error === "object" && "message" in error && typeof error.message === "string"
          ? error.message
          : "Something went wrong.";
    throw new Error(message);
  }
  return body;
}

export default function NimiqPoolsApp() {
  const [view, setView] = useState<View>("discover");
  const [pools, setPools] = useState<Pool[]>([]);
  const [selectedPool, setSelectedPool] = useState<Pool | null>(null);
  const [loading, setLoading] = useState(true);
  const [runtimeNetwork, setRuntimeNetwork] = useState<string | null>(null);
  const [wallet, setWallet] = useState<string | null>(null);
  const [walletMode, setWalletMode] = useState<"nimiq" | "demo" | null>(null);
  const [provider, setProvider] = useState<NimiqProvider | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [joinedPoolIds, setJoinedPoolIds] = useState<string[]>([]);
  const [theme, setTheme] = useState<Theme>("light");
  const [walletMenuOpen, setWalletMenuOpen] = useState(false);
  const walletButtonRef = useRef<HTMLButtonElement | null>(null);
  const walletMenuRef = useRef<HTMLDivElement | null>(null);
  const scrollToTop = () => window.scrollTo({ top: 0, behavior: "auto" });
  const screenKey = selectedPool ? `pool:${selectedPool.id}` : view;

  const getPoolByShareId = useCallback((items: Pool[], shareId: string): Pool | null => {
    return items.find((pool) => pool.shareId === shareId || pool.id === shareId) ?? null;
  }, []);

  const syncPoolUrl = useCallback((pool: Pool | null) => {
    const url = new URL(window.location.href);
    if (pool) {
      url.searchParams.set("pool", pool.shareId);
    } else {
      url.searchParams.delete("pool");
    }
    window.history.replaceState({}, "", url);
  }, []);

  const loadPools = useCallback(async () => {
    try {
      const data = await api<{ pools: Pool[] }>("/api/pools?discover=1");
      setPools(data.pools);
      const shareId = new URLSearchParams(window.location.search).get("pool");
      const sharedPool = shareId ? getPoolByShareId(data.pools, shareId) : null;
      setSelectedPool((current) => {
        if (sharedPool) return sharedPool;
        if (current) return getPoolByShareId(data.pools, current.id) ?? current;
        return null;
      });
    } catch (error) {
      setNotice({
        tone: "warning",
        text:
          error instanceof Error
            ? error.message
            : "Pools could not be loaded.",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPools();
  }, [loadPools]);

  useEffect(() => {
    void api<{ network: string }>("/api/config")
      .then((data) => setRuntimeNetwork(String(data.network || "").toLowerCase()))
      .catch(() => setRuntimeNetwork(null));
  }, []);

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("ref");
    if (code) {
      window.localStorage.setItem("nimiq-pools-referral-code", code);
      const url = new URL(window.location.href);
      url.searchParams.delete("ref");
      window.history.replaceState({}, "", url);
    }
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4800);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!walletMenuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (walletButtonRef.current?.contains(target)) return;
      if (walletMenuRef.current?.contains(target)) return;
      setWalletMenuOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setWalletMenuOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [walletMenuOpen]);

  useEffect(() => {
    if (!wallet) {
      setWalletMenuOpen(false);
    }
  }, [wallet]);

  useEffect(() => {
    const stored = window.localStorage.getItem("nimiq-pools-theme");
    const media = window.matchMedia("(prefers-color-scheme: dark)");

    const applyTheme = (nextTheme: Theme) => {
      document.documentElement.dataset.theme = nextTheme;
      document.documentElement.style.colorScheme = nextTheme;
      setTheme(nextTheme);
    };

    if (stored === "light" || stored === "dark") {
      applyTheme(stored);
    } else {
      applyTheme(media.matches ? "dark" : "light");
    }

    const followSystem = (event: MediaQueryListEvent) => {
      if (!window.localStorage.getItem("nimiq-pools-theme")) {
        applyTheme(event.matches ? "dark" : "light");
      }
    };

    media.addEventListener("change", followSystem);
    return () => media.removeEventListener("change", followSystem);
  }, []);

  const toggleTheme = () => {
    const nextTheme: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = nextTheme;
    document.documentElement.style.colorScheme = nextTheme;
    window.localStorage.setItem("nimiq-pools-theme", nextTheme);
    setTheme(nextTheme);
  };

  const copyWalletAddress = async () => {
    if (!wallet) return;

    try {
      await navigator.clipboard.writeText(wallet);
      setNotice({ tone: "success", text: "Address copied." });
    } catch {
      setNotice({ tone: "warning", text: "Could not copy the address." });
    }
  };

  const disconnectWallet = async () => {
    try {
      if (walletMode === "nimiq" && provider) {
        provider.disconnect();
      }
    } finally {
      window.localStorage.removeItem("nimiq-pools-referral-code");
      setProvider(null);
      setWallet(null);
      setWalletMode(null);
      setJoinedPoolIds([]);
      setWalletMenuOpen(false);
      setNotice({ tone: "success", text: "Wallet disconnected." });
    }
  };

  const handleWalletButtonClick = () => {
    if (!wallet) {
      void connectWallet();
      return;
    }

    setWalletMenuOpen((current) => !current);
  };

  const connectWallet = async () => {
    setNotice({ tone: "neutral", text: "Waiting for Nimiq Pay…" });
    try {
      const nimiq = await init({ timeout: 1_800 });
      const accounts = await nimiq.listAccounts();
      if ("error" in accounts || accounts.length === 0) {
        throw new Error(
          "Nimiq Pay did not share an account. You can try again.",
        );
      }
      setProvider(nimiq);
      setWallet(accounts[0]);
      setWalletMode("nimiq");
      setNotice({ tone: "success", text: "Nimiq Pay connected." });
      void api<ReferralDashboard>(`/api/referrals?address=${encodeURIComponent(accounts[0])}`).catch(() => {});
    } catch {
      const demoEnabled =
        process.env.NEXT_PUBLIC_ENABLE_DEMO_WALLET === "true";
      if (demoEnabled && runtimeNetwork !== "mainnet") {
        setWallet(DEMO_ADDRESS);
        setWalletMode("demo");
        setNotice({
          tone: "warning",
          text: "Local demo wallet connected. No live NIM will move.",
        });
        return;
      }

      setProvider(null);
      setWallet(null);
      setWalletMode(null);
      setNotice({
        tone: "warning",
        text: "Open Nimiq Pools inside Nimiq Pay to connect your wallet.",
      });
    }
  };

  const openPool = (pool: Pool) => {
    setSelectedPool(pool);
    syncPoolUrl(pool);
    scrollToTop();
  };

  const closePool = () => {
    setSelectedPool(null);
    syncPoolUrl(null);
  };

  return (
    <div className="app-shell">
      <header className="topbar">
          <button
            className="brand"
            type="button"
            onClick={() => {
            closePool();
            setView("discover");
          }}
          aria-label="Nimiq Pools home"
        >
          <BrandLogo />
          <span>Nimiq Pools</span>
        </button>

        <nav className="desktop-nav" aria-label="Primary navigation">
          <NavButton
            active={view === "discover" && !selectedPool}
            onClick={() => {
              setView("discover");
              closePool();
            }}
          >
            Discover
          </NavButton>
          <NavButton
            active={view === "create"}
            onClick={() => {
              setView("create");
              closePool();
            }}
          >
            Create pool
          </NavButton>
          <NavButton
            active={view === "activity"}
            onClick={() => {
              setView("activity");
              closePool();
            }}
          >
            Activity
          </NavButton>
          <NavButton
            active={view === "referrals"}
            onClick={() => {
              setView("referrals");
              closePool();
            }}
          >
            Referrals
          </NavButton>
        </nav>

        <div className="header-actions">
          <button
            className="theme-toggle"
            type="button"
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          >
            <span className="theme-toggle-icon" aria-hidden="true">
              {theme === "dark" ? <MoonIcon size={15} /> : <SunIcon size={15} />}
            </span>
          </button>
          <div className="wallet-menu-anchor">
            <button
              ref={walletButtonRef}
              className="wallet-button"
              type="button"
              onClick={handleWalletButtonClick}
              aria-haspopup={wallet ? "menu" : undefined}
              aria-expanded={wallet ? walletMenuOpen : undefined}
              aria-controls={wallet ? "wallet-account-menu" : undefined}
            >
              <span className={`wallet-button-icon ${wallet ? "connected" : ""}`} aria-hidden="true">
                <LinkIcon size={14} />
              </span>
              <span className="wallet-button-copy">
                <strong>{wallet ? shortAddress(wallet) : "Connect wallet"}</strong>
                <small>{wallet ? "Connected" : "Nimiq Pay"}</small>
              </span>
            </button>
          </div>
        </div>
      </header>

      {wallet && walletMenuOpen && (
        <>
          <button
            className="wallet-menu-backdrop"
            type="button"
            aria-label="Close wallet menu"
            onClick={() => setWalletMenuOpen(false)}
          />
          <div
            ref={walletMenuRef}
            className="wallet-menu"
            id="wallet-account-menu"
            role="menu"
            aria-label="Wallet actions"
          >
            <div className="wallet-menu-address">
              <span>Connected address</span>
              <code>{wallet}</code>
            </div>
            <button
              className="wallet-menu-item"
              type="button"
              role="menuitem"
              onClick={() => {
                void copyWalletAddress();
              }}
            >
              <CopyIcon size={14} />
              Copy address
            </button>
            <button
              className="wallet-menu-item danger"
              type="button"
              role="menuitem"
              onClick={() => {
                void disconnectWallet();
              }}
            >
              Disconnect
            </button>
          </div>
        </>
      )}

      <main className="app-main">
        <div key={screenKey} className={`screen screen-${selectedPool ? "detail" : view}`}>
          {selectedPool ? (
            <PoolDetail
              pool={selectedPool}
              wallet={wallet}
              walletMode={walletMode}
              provider={provider}
              onBack={closePool}
              onConnect={connectWallet}
              onJoined={() => {
                setJoinedPoolIds((ids) => [...new Set([...ids, selectedPool.id])]);
                void loadPools();
              }}
              setNotice={setNotice}
            />
          ) : view === "discover" ? (
            <Discover
              pools={pools}
              loading={loading}
              wallet={wallet}
              onConnect={connectWallet}
              onOpenPool={openPool}
              onCreate={() => setView("create")}
            />
          ) : view === "create" ? (
            <CreatePool
              wallet={wallet}
              onConnect={connectWallet}
              onCreated={(pool) => {
                setPools((current) => [pool, ...current]);
                setSelectedPool(pool);
                setView("discover");
                setNotice({
                  tone: "success",
                  text: "Pool published. Its settlement rule is now frozen.",
                });
              }}
            />
          ) : view === "activity" ? (
            <Activity
              pools={pools}
              wallet={wallet}
              joinedPoolIds={joinedPoolIds}
              onConnect={connectWallet}
              onOpenPool={openPool}
            />
          ) : (
            <Referrals wallet={wallet} provider={provider} walletMode={walletMode} onConnect={connectWallet} setNotice={setNotice} />
          )}
        </div>
      </main>

      <footer className="site-footer">
        <div className="section-width footer-shell">
          <div className="footer-brand-block">
            <button
              className="footer-brand"
              type="button"
              onClick={() => {
                closePool();
                setView("discover");
                scrollToTop();
              }}
            >
              <BrandLogo className="footer-logo" />
              <span>
                <strong>Nimiq Pools</strong>
                <small>Transparent prediction pools, settled from declared sources.</small>
              </span>
            </button>
          </div>

          <div className="footer-trust">
            <a
              className="footer-social-link"
              href="https://x.com/nimiqpools"
              target="_blank"
              rel="noreferrer"
              aria-label="Follow Nimiq on X"
              title="Follow Nimiq on X"
            >
              <i className="ph ph-x-logo" aria-hidden="true" />
            </a>
            <div className="footer-source-row" aria-label="Supported resolution categories">
              <span>Crypto</span><span>Sports</span><span>Weather</span><span>Community</span>
            </div>
          </div>
        </div>
        <div className="section-width footer-bottom">
          <span>Built on Nimiq</span>
          <span>One fixed stake. No house edge.</span>
        </div>
      </footer>

      <nav className="mobile-nav" aria-label="Mobile navigation">
        <MobileNavButton
          active={view === "discover" && !selectedPool}
          icon={<HouseIcon size={21} weight="bold" />}
          label="Discover"
          onClick={() => {
            setView("discover");
            closePool();
            scrollToTop();
          }}
        />
        <MobileNavButton
          active={view === "create"}
          icon={<PlusCircleIcon size={21} weight="bold" />}
          label="Create"
          onClick={() => {
            setView("create");
            closePool();
            scrollToTop();
          }}
        />
        <MobileNavButton
          active={view === "activity"}
          icon={<ClockCounterClockwiseIcon size={21} weight="bold" />}
          label="Activity"
          onClick={() => {
            setView("activity");
            closePool();
            scrollToTop();
          }}
        />
        <MobileNavButton
          active={view === "referrals"}
          icon={<GiftIcon size={21} weight="bold" />}
          label="Referrals"
          onClick={() => {
            setView("referrals");
            closePool();
            scrollToTop();
          }}
        />
      </nav>

      {notice && <div className={`toast ${notice.tone}`}>{notice.text}</div>}
    </div>
  );
}

function NavButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      className={active ? "active" : ""}
      type="button"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function MobileNavButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={active ? "active" : ""}
      type="button"
      onClick={onClick}
    >
      <span aria-hidden="true">{icon}</span>
      {label}
    </button>
  );
}

function Discover({
  pools,
  loading,
  wallet,
  onConnect,
  onOpenPool,
  onCreate,
}: {
  pools: Pool[];
  loading: boolean;
  wallet: string | null;
  onConnect: () => void;
  onOpenPool: (pool: Pool) => void;
  onCreate: () => void;
}) {
  const [filter, setFilter] = useState<PoolFilter>("all");
  const filtered = pools.filter((pool) => {
    if (pool.status !== "OPEN") return false;
    if (new Date(pool.predictionClosesAt).getTime() <= Date.now()) return false;
    if (filter === "crypto") return poolCategoryKey(pool) === "crypto";
    if (filter === "sports") return poolCategoryKey(pool) === "sports";
    if (filter === "weather") return poolCategoryKey(pool) === "weather";
    if (filter === "others") return poolCategoryKey(pool) === "others";
    return true;
  });

  return (
    <>
      <section className="hero section-width">
        <div className="hero-copy">
          <h1>
            Predict together.
            <br />
            <span>Settle without the mess.</span>
          </h1>
          <p>
            One call, one fixed stake. Small, transparent prediction pools for
            friends and communities. Every pool declares its source, deadline,
            and refund path before anyone joins.
          </p>
          <div className="hero-actions">
            <button className="primary-button" type="button" onClick={onCreate}>
              Create a pool <ArrowRightIcon size={16} />
            </button>
            {!wallet && (
              <button
                className="secondary-button"
                type="button"
                onClick={onConnect}
              >
                Connect Nimiq Pay
              </button>
            )}
          </div>
        </div>
        <div className="hero-card" aria-label="How Nimiq Pools works">
          <div className="hero-card-top">
            <span>Pool mechanics</span>
            <span className="no-edge">0% house edge</span>
          </div>
          <ol className="loop-list">
            <li className="mechanic-step mechanic-lock">
              <span className="loop-number">1</span>
              <div>
                <strong>Choose one outcome</strong>
                <small>Your signed prediction locks before the event.</small>
              </div>
              <span className="mechanic-visual lock-visual" aria-hidden="true">
                <span><CheckIcon size={15} /></span>
              </span>
            </li>
            <li className="mechanic-step mechanic-stake">
              <span className="loop-number">2</span>
              <div>
                <strong>Stake the fixed amount</strong>
                <small>Every participant contributes the same NIM.</small>
              </div>
              <span className="mechanic-visual stake-visual" aria-hidden="true">
                <span className="stake-track">
                  <span className="stake-fill" />
                </span>
              </span>
            </li>
            <li className="mechanic-step mechanic-resolve">
              <span className="loop-number">3</span>
              <div>
                <strong>Resolve from declared proof</strong>
                <small>API data or creator-reviewed evidence—not a vote.</small>
              </div>
              <span className="mechanic-visual resolve-visual" aria-hidden="true"><CheckIcon size={19} /></span>
            </li>
          </ol>
          <div className="trust-strip">
            <span className="trust-icon"><ShieldCheckIcon size={18} /></span>
            No odds, trading, or result voting
          </div>
        </div>
      </section>

      <section className="pool-section section-width">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Live & upcoming</span>
            <h2>Pick a side</h2>
          </div>
          <div className="filter-tabs" role="group" aria-label="Filter pools">
            {poolFilters.map((item) => (
              <button
                key={item.id}
                className={filter === item.id ? "active" : ""}
                type="button"
                onClick={() => setFilter(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="pool-grid">
          {loading
            ? [1, 2, 3, 4].map((item) => (
              <div className="pool-card loading-card" key={item}>
                <div />
                <div />
                <div />
              </div>
            ))
            : filtered.map((pool) => (
              <PoolCard key={pool.id} pool={pool} onOpen={onOpenPool} />
            ))}
        </div>
      </section>

      <section className="proof-band">
        <div className="section-width proof-grid">
          <div>
            <span className="eyebrow light">Built for clarity</span>
            <h2>Trust the rule, not the room.</h2>
          </div>
          <div className="proof-point">
            <span>01</span>
            <strong>Source first</strong>
            <p>The exact resolver and observed timestamp stay attached.</p>
          </div>
          <div className="proof-point">
            <span>02</span>
            <strong>Prediction locked</strong>
            <p>One signed choice per wallet, frozen before settlement.</p>
          </div>
          <div className="proof-point">
            <span>03</span>
            <strong>Refund declared</strong>
            <p>No winner, cancelled event, or timeout follows a visible rule.</p>
          </div>
        </div>
      </section>
    </>
  );
}

function PoolCard({
  pool,
  onOpen,
}: {
  pool: Pool;
  onOpen: (pool: Pool) => void;
}) {
  const closed = !["OPEN"].includes(pool.status);
  return (
    <article className="pool-card">
      <div className="pool-card-head">
        <CategoryBadge pool={pool} />
        <span className={`status-chip status-${pool.status.toLowerCase()}`}>
          {statusLabel(pool.status)}
        </span>
      </div>
      <h3>{pool.question}</h3>
      <OutcomeMarketBars pool={pool} compact />
      <div className="pool-metrics">
        <div>
          <small>Fixed stake</small>
          <strong>{formatNim(pool.stakeAmountLuna)} NIM</strong>
        </div>
        <div>
          <small>Pool</small>
          <strong>{formatNim(pool.potLuna)} NIM</strong>
        </div>
        <div>
          <small>{closed ? "State" : "Locks in"}</small>
          <strong>{closed ? statusLabel(pool.status) : timeLeft(pool.predictionClosesAt)}</strong>
        </div>
      </div>
      <button className="card-button" type="button" onClick={() => onOpen(pool)}>
        {closed ? "View proof" : "View pool"} <ArrowRightIcon size={15} />
      </button>
    </article>
  );
}

function CategoryBadge({ pool }: { pool: Pool }) {
  const label = poolCategoryLabel(pool);
  const icon = label === "Sports"
    ? <SoccerBallIcon size={13} weight="bold" />
    : label === "Weather"
      ? <CloudSunIcon size={13} weight="bold" />
      : label === "Crypto"
        ? <CurrencyCircleDollarIcon size={13} weight="bold" />
        : <UsersThreeIcon size={13} weight="bold" />;

  return (
    <span className={`source-badge source-${label.toLowerCase()}`}>
      <span className="source-badge-icon">{icon}</span>
      {label}
    </span>
  );
}

function SourceBadge({ type }: { type: ResolverType }) {
  const icon = type === "FOOTBALL_DATA" || type === "API_SPORTS"
    ? <SoccerBallIcon size={13} weight="bold" />
    : type === "OPEN_METEO"
      ? <CloudSunIcon size={13} weight="bold" />
      : type === "MANUAL"
        ? <UsersThreeIcon size={13} weight="bold" />
        : <CurrencyCircleDollarIcon size={13} weight="bold" />;

  return (
    <span className={`source-badge source-${type.toLowerCase()}`}>
      <span className="source-badge-icon">{icon}</span>
      {resolverLabels[type]}
    </span>
  );
}

function OutcomeMarketBars({
  pool,
  compact = false,
}: {
  pool: Pool;
  compact?: boolean;
}) {
  const [left, right] = pool.outcomeBreakdown;
  const leftWidth = left?.percentage ?? 0;
  const rightWidth = right?.percentage ?? 0;

  return (
    <div className={`outcome-market ${compact ? "compact" : ""}`} aria-label="Outcome percentages">
      <div className="outcome-market-end left">
        <strong>{left?.outcome ?? "No data"}</strong>
        <span>{leftWidth}%</span>
      </div>
      <div className="outcome-market-track" aria-hidden="true">
        <div className="outcome-market-fill" style={{ width: `${Math.max(leftWidth, 4)}%` }} />
      </div>
      <div className="outcome-market-end right">
        <strong>{right?.outcome ?? "No data"}</strong>
        <span>{rightWidth}%</span>
      </div>
    </div>
  );
}

function PoolDetail({
  pool,
  wallet,
  walletMode,
  provider,
  onBack,
  onConnect,
  onJoined,
  setNotice,
}: {
  pool: Pool;
  wallet: string | null;
  walletMode: "nimiq" | "demo" | null;
  provider: NimiqProvider | null;
  onBack: () => void;
  onConnect: () => void;
  onJoined: () => void;
  setNotice: (notice: Notice | null) => void;
}) {
  const [outcome, setOutcome] = useState("");
  const [step, setStep] = useState<"choose" | "review" | "complete">("choose");
  const [busy, setBusy] = useState(false);
  const [stakePhase, setStakePhase] = useState<"idle" | "sending" | "submitted" | "confirmed" | "error">("idle");
  const [txHash, setTxHash] = useState("");
  const [evidence, setEvidence] = useState<EvidenceSubmission[]>([]);
  const [evidenceNote, setEvidenceNote] = useState("");
  const [evidenceUrl, setEvidenceUrl] = useState("");

  useEffect(() => {
    if (pool.resolverType !== "MANUAL") return;
    void api<{ evidence: EvidenceSubmission[] }>(
      `/api/pools/${pool.id}/evidence`,
    )
      .then((data) => setEvidence(data.evidence))
      .catch(() => undefined);
  }, [pool.id, pool.resolverType]);

  const join = async () => {
    if (!wallet) {
      onConnect();
      return;
    }
    if (!outcome) {
      setNotice({ tone: "warning", text: "Choose one outcome first." });
      return;
    }
    setBusy(true);
    setStakePhase("sending");
    try {
      const payload: SignedPredictionPayload = {
        domain: "nimiq-pools",
        version: 1,
        poolId: pool.id,
        participantAddress: wallet,
        selectedOutcome: outcome,
        stakeAmountLuna: pool.stakeAmountLuna,
        predictionClosesAt: pool.predictionClosesAt,
        nonce: crypto.randomUUID(),
      };
      let signature = `demo_sig_${crypto.randomUUID().replaceAll("-", "")}`;
      let publicKey = "demo_public_key";
      let hash = `demo_${crypto.randomUUID().replaceAll("-", "").slice(0, 28)}`;
      let joiningWallet = wallet;

      if (walletMode === "nimiq" && provider) {
        const activeAccounts = await provider.listAccounts();
        if ("error" in activeAccounts || activeAccounts.length === 0) {
          throw new Error("Nimiq Pay did not share an active account. Reconnect your wallet before staking.");
        }
        if (normalizeAddress(activeAccounts[0]) !== normalizeAddress(wallet)) {
          throw new Error(`Nimiq Pay active account changed to ${activeAccounts[0]}. Disconnect and reconnect before staking so the displayed wallet matches the paying wallet.`);
        }

        let signedPayloadText = JSON.stringify(payload);
        let signed = await signWithProvider(provider, signedPayloadText);
        signature = signed.signature;
        publicKey = signed.publicKey;
        const signerAddress = await deriveAddressFromPublicKey(publicKey);
        if (normalizeAddress(signerAddress) !== normalizeAddress(wallet)) {
          joiningWallet = signerAddress;
          payload.participantAddress = signerAddress;
          signedPayloadText = JSON.stringify(payload);
          signed = await signWithProvider(provider, signedPayloadText);
          signature = signed.signature;
          publicKey = signed.publicKey;
        } else {
          joiningWallet = signerAddress;
        }

        const config = await api<{ escrowAddress: string | null }>(
          "/api/config",
        );
        const escrowAddress = config.escrowAddress || pool.escrowAddress || "";
        if (!escrowAddress) {
          throw new Error(
            "Live escrow is not configured for this deployment. No NIM was sent.",
          );
        }
        const recipientCandidates = [...new Set([
          normalizeRecipientAddress(escrowAddress, false),
          normalizeRecipientAddress(escrowAddress, true),
        ])].filter(Boolean);

        let transaction: Awaited<ReturnType<NimiqProvider["sendBasicTransaction"]>> | null = null;
        let lastSendError: Error | null = null;
        for (const recipient of recipientCandidates) {
          try {
            transaction = typeof provider.sendBasicTransactionWithData === "function"
              ? await provider.sendBasicTransactionWithData({
                  recipient,
                  value: pool.stakeAmountLuna,
                  data: `POOL:${pool.id}`,
                })
              : await provider.sendBasicTransaction({
                  recipient,
                  value: pool.stakeAmountLuna,
                });
            if (typeof transaction !== "string") {
              throw new Error(transaction.error.message);
            }
            lastSendError = null;
            break;
          } catch (error) {
            lastSendError = error instanceof Error ? error : new Error("Could not prepare the stake transaction.");
          }
        }
        if (!transaction || typeof transaction !== "string") {
          const recoveredHash = await recoverStakeTransactionHash(joiningWallet, escrowAddress, pool.stakeAmountLuna).catch(() => null);
          if (!recoveredHash) throw lastSendError ?? new Error("Could not prepare the stake transaction.");
          hash = recoveredHash;
          setStakePhase("submitted");
        } else {
          try {
            hash = await normalizeTransactionHash(transaction);
            setStakePhase("submitted");
          } catch (error) {
            const recoveredHash = await recoverStakeTransactionHash(joiningWallet, escrowAddress, pool.stakeAmountLuna).catch(() => null);
            if (!recoveredHash) throw error;
            hash = recoveredHash;
            setStakePhase("submitted");
          }
        }
      }

      await api(`/api/pools/${pool.id}/join`, {
        method: "POST",
        body: JSON.stringify({
          address: joiningWallet,
          predictedOutcome: outcome,
          predictionPayload: JSON.stringify(payload),
          predictionPublicKey: publicKey,
          predictionSignature: signature,
          stakeTxHash: hash,
          stakeAmountLuna: pool.stakeAmountLuna,
          referralCode: window.localStorage.getItem("nimiq-pools-referral-code"),
          demo: walletMode === "demo",
        }),
      });
      setTxHash(hash);
      setStakePhase("confirmed");
      setStep("complete");
      onJoined();
      setNotice({
        tone: "success",
        text:
          walletMode === "demo"
            ? "Demo prediction recorded. No live NIM was moved."
            : "Prediction signed and stake confirmed.",
      });
    } catch (error) {
      setStakePhase("error");
      setNotice({
        tone: "warning",
        text: error instanceof Error ? error.message : "Join request failed.",
      });
    } finally {
      setBusy(false);
    }
  };

  const submitEvidence = async () => {
    if (!wallet) {
      onConnect();
      return;
    }
    if (!evidenceNote.trim()) {
      setNotice({ tone: "warning", text: "Add an evidence note first." });
      return;
    }
    setBusy(true);
    try {
      const data = await api<{ evidence: EvidenceSubmission }>(
        `/api/pools/${pool.id}/evidence`,
        {
          method: "POST",
          body: JSON.stringify({
            submittedBy: wallet,
            proposedOutcome: pool.outcomes[0],
            evidenceUrl,
            description: evidenceNote,
          }),
        },
      );
      setEvidence((current) => [data.evidence, ...current]);
      setEvidenceNote("");
      setEvidenceUrl("");
      setNotice({
        tone: "success",
        text: "Evidence added. Your locked prediction has not changed.",
      });
    } catch (error) {
      setNotice({
        tone: "warning",
        text: error instanceof Error ? error.message : "Evidence was not saved.",
      });
    } finally {
      setBusy(false);
    }
  };

  const buildShareUrl = () => {
    const url = new URL(window.location.href);
    url.searchParams.set("pool", pool.shareId);
    url.searchParams.delete("ref");
    return url.toString();
  };

  const sharePoolLink = async () => {
    const url = buildShareUrl();
    try {
      if (navigator.share) {
        await navigator.share({
          title: "Nimiq Pools",
          text: pool.question,
          url,
        });
        return;
      }
      await navigator.clipboard.writeText(url);
      setNotice({ tone: "success", text: "Pool link copied." });
    } catch {
      setNotice({ tone: "warning", text: "Could not share the pool link." });
    }
  };

  const isOpen = pool.status === "OPEN";
  return (
    <div className="detail-page section-width">
      <button className="back-button" type="button" onClick={onBack}>
        <ArrowLeftIcon size={17} /> Back to pools
      </button>
      <div className="detail-layout">
        <section className="detail-main">
          <div className="detail-title-row">
            <div className="detail-title-meta">
              <SourceBadge type={pool.resolverType} />
              <span className={`status-chip status-${pool.status.toLowerCase()}`}>
                {statusLabel(pool.status)}
              </span>
            </div>
            <div className="detail-share-actions">
              <button
                className="pool-share-button"
                type="button"
                onClick={() => {
                  void sharePoolLink();
                }}
                aria-label="Share pool link"
                title="Share pool link"
              >
                <ShareNetworkIcon size={14} />
                Share
              </button>
            </div>
          </div>
          <h1>{pool.question}</h1>
          <OutcomeMarketBars pool={pool} />
          <div className="detail-stats">
            <div>
              <span>Fixed stake</span>
              <strong>{formatNim(pool.stakeAmountLuna)} NIM</strong>
            </div>
            <div>
              <span>Pool</span>
              <strong>{formatNim(pool.potLuna)} NIM</strong>
            </div>
            <div>
              <span>Participants</span>
              <strong>{pool.participantCount}</strong>
            </div>
            <div>
              <span>{isOpen ? "Predictions lock" : "Pool status"}</span>
              <strong>{isOpen ? timeLeft(pool.predictionClosesAt) : statusLabel(pool.status)}</strong>
            </div>
          </div>

          <section className="rule-card">
            <div className="rule-card-title">
              <span className="shield-mark"><ShieldCheckIcon size={20} /></span>
              <div>
                <span className="eyebrow">Settlement rule</span>
                <h2>What decides the result</h2>
              </div>
            </div>
            <p>{pool.settlementRule}</p>
            <div className="rule-grid">
              <div>
                <small>Declared source</small>
                <strong>{resolverLabels[pool.resolverType]}</strong>
              </div>
              <div>
                <small>Prediction close</small>
                <strong>{formatDate(pool.predictionClosesAt)}</strong>
              </div>
              <div>
                <small>Observation / event</small>
                <strong>{formatDate(pool.eventResolvesAt)}</strong>
              </div>
              <div>
                <small>Fallback deadline</small>
                <strong>{formatDate(pool.resolutionDeadline)}</strong>
              </div>
            </div>
            <div className="refund-callout">
              <strong>Refund path</strong>
              <span>{pool.refundRule}</span>
            </div>
          </section>

          {pool.resolutionProof && (
            <section className="proof-card">
              <div className="proof-card-head">
                <div>
                  <span className="eyebrow">Result proof</span>
                  <h2>{pool.resolvedOutcome}</h2>
                </div>
                <span className="verified-pill"><CheckIcon size={14} /> Verified</span>
              </div>
              <div className="proof-readout">
                <div>
                  <small>Observed value</small>
                  <strong>{pool.resolutionProof.observedValue}</strong>
                </div>
                <div>
                  <small>Provider timestamp</small>
                  <strong>
                    {pool.resolutionProof.providerTimestamp
                      ? formatDate(pool.resolutionProof.providerTimestamp)
                      : "Not supplied"}
                  </strong>
                </div>
                <div>
                  <small>Provider reference</small>
                  <strong>
                    {pool.resolutionProof.providerReference || "Creator proof"}
                  </strong>
                </div>
              </div>
              <p>{pool.resolutionProof.explanation}</p>
            </section>
          )}

          {pool.resolverType === "MANUAL" && !isOpen && (
            <section className="evidence-panel">
              <div className="section-heading compact">
                <div>
                  <span className="eyebrow">Evidence window</span>
                  <h2>Add facts, not a second vote</h2>
                </div>
              </div>
              <p className="panel-intro">
                {pool.evidenceRequirements} Evidence helps the creator verify
                the event. It cannot change your locked prediction.
              </p>
              <div className="evidence-form">
                <input
                  type="url"
                  value={evidenceUrl}
                  onChange={(event) => setEvidenceUrl(event.target.value)}
                  placeholder="Source link (optional)"
                  aria-label="Evidence source link"
                />
                <textarea
                  value={evidenceNote}
                  onChange={(event) => setEvidenceNote(event.target.value)}
                  placeholder="Describe what this evidence shows"
                  aria-label="Evidence description"
                />
                <button
                  className="primary-button"
                  type="button"
                  disabled={busy}
                  onClick={submitEvidence}
                >
                  Submit evidence
                </button>
              </div>
              <div className="evidence-list">
                {evidence.length === 0 ? (
                  <p>No evidence has been submitted yet.</p>
                ) : (
                  evidence.map((item) => (
                    <article key={item.id}>
                      <div>
                        <strong>{shortAddress(item.submittedBy)}</strong>
                        <span>{formatDate(item.submittedAt)}</span>
                      </div>
                      <p>{item.description}</p>
                      {item.evidenceUrl && (
                        <a
                          href={item.evidenceUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open source ↗
                        </a>
                      )}
                    </article>
                  ))
                )}
              </div>
            </section>
          )}
        </section>

        <aside className="join-card">
          {step === "complete" ? (
            <div className="join-complete">
              <span className="complete-mark"><CheckIcon size={20} /></span>
              <span className="eyebrow">Prediction locked</span>
              <h2>You chose {outcome}</h2>
              <p>
                {walletMode === "demo"
                  ? "This is a demo record. No live NIM moved."
                  : "Your signed prediction and tagged transfer are recorded."}
              </p>
              <div className="transaction-box">
                <small>Transaction reference</small>
                <code>{txHash}</code>
              </div>
              <button
                className="secondary-button wide"
                type="button"
                onClick={onBack}
              >
                Back to pools
              </button>
            </div>
          ) : isOpen ? (
            <>
              <span className="eyebrow">Make your prediction</span>
              <h2>{step === "choose" ? "Choose one outcome" : "Review and sign"}</h2>
              {step === "choose" ? (
                <>
                  <div className="outcome-options">
                    {pool.outcomes.map((item) => (
                      <label
                        className={outcome === item ? "selected" : ""}
                        key={item}
                      >
                        <input
                          type="radio"
                          name="outcome"
                          checked={outcome === item}
                          onChange={() => setOutcome(item)}
                        />
                        <span>{item}</span>
                        <b>{outcome === item ? <CheckIcon size={16} /> : <CircleIcon size={16} />}</b>
                      </label>
                    ))}
                  </div>
                  <button
                    className="primary-button wide"
                    type="button"
                    disabled={!outcome}
                    onClick={() => setStep("review")}
                  >
                    Review prediction
                  </button>
                </>
              ) : (
                <>
                  <div className="review-stack">
                    <div>
                      <small>Your outcome</small>
                      <strong>{outcome}</strong>
                    </div>
                    <div>
                      <small>Fixed stake</small>
                      <strong>{formatNim(pool.stakeAmountLuna)} NIM</strong>
                    </div>
                    <div>
                      <small>Locks</small>
                      <strong>{formatDate(pool.predictionClosesAt)}</strong>
                    </div>
                  </div>
                  <div className="custody-note">
                    Stakes are held by the protected backend escrow signer for
                    this MVP. Payouts and refunds are logged by transaction hash.
                  </div>
                  <div className={`stake-ripple stake-ripple-${stakePhase}`} aria-hidden="true">
                    <span className="stake-ripple-core" />
                    <span className="stake-ripple-ring stake-ripple-ring-1" />
                    <span className="stake-ripple-ring stake-ripple-ring-2" />
                    <span className="stake-ripple-ring stake-ripple-ring-3" />
                    <span className="stake-ripple-check"><CheckIcon size={18} /></span>
                  </div>
                  <button
                    className="primary-button wide"
                    type="button"
                    disabled={busy}
                    onClick={join}
                  >
                    {busy
                      ? "Waiting for approval…"
                      : wallet
                        ? "Sign & stake"
                        : "Connect to continue"}
                  </button>
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => setStep("choose")}
                  >
                    Change outcome
                  </button>
                </>
              )}
              <div className="join-footnote">
                One prediction per wallet. Your outcome cannot be edited after
                the stake is confirmed.
              </div>
            </>
          ) : (
            <div className="closed-state">
              <span className="closed-mark"><ClockCounterClockwiseIcon size={23} /></span>
              <span className="eyebrow">Entry closed</span>
              <h2>This pool is {statusLabel(pool.status)}</h2>
              <p>
                New predictions are rejected after the displayed deadline. The
                declared resolver and refund path remain unchanged.
              </p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function CreatePool({
  wallet,
  onConnect,
  onCreated,
}: {
  wallet: string | null;
  onConnect: () => void;
  onCreated: (pool: Pool) => void;
}) {
  const [resolver, setResolver] = useState<ResolverType>("COINGECKO");
  const selectedCategory = resolver === "BINANCE" || resolver === "COINGECKO" ? "crypto" : resolver === "FOOTBALL_DATA" || resolver === "API_SPORTS" ? "sports" : resolver === "OPEN_METEO" ? "weather" : "other";
  const [stake, setStake] = useState(5);
  const [fixtureOptions, setFixtureOptions] = useState<FootballFixtureOption[]>([]);
  const [fixturesLoading, setFixturesLoading] = useState(false);
  const [form, setForm] = useState({
    question: "",
    cryptoToken: "nim",
    customTokenSymbol: "",
    customCoinGeckoId: "",
    asset: "NIM/USDT",
    target: "0.0025",
    sportsProvider: "FOOTBALL_DATA",
    sport: "football",
    fixture: "",
    fixtureId: "",
    competition: "",
    location: "Winnipeg, Canada",
    latitude: "49.8951",
    longitude: "-97.1384",
    metric: "temperature_2m",
    outcomes: "Yes,No",
    evidence: "A public announcement or verifiable primary source.",
    poolEndsAt: "",
  });
  const [busy, setBusy] = useState(false);

  const update = (field: keyof typeof form, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const selectedCryptoToken = useMemo(
    () =>
      cryptoTokenOptions.find((token) => token.id === form.cryptoToken) ??
      cryptoTokenOptions[0],
    [form.cryptoToken],
  );

  const selectedTokenSymbol =
    selectedCryptoToken.id === "other"
      ? form.customTokenSymbol.trim().toUpperCase() || "TOKEN"
      : selectedCryptoToken.symbol;

  const selectedCoinGeckoId =
    selectedCryptoToken.id === "other"
      ? form.customCoinGeckoId.trim() || "token-id"
      : selectedCryptoToken.coinGeckoId || "";

  const selectCryptoToken = (tokenId: string) => {
    const token =
      cryptoTokenOptions.find((option) => option.id === tokenId) ??
      cryptoTokenOptions[0];
    setResolver(token.resolver);
    setForm((current) => ({
      ...current,
      cryptoToken: token.id,
      asset: token.asset,
      target: token.suggestedTarget,
    }));
  };

  const selectCategory = (category: "crypto" | "sports" | "weather" | "other") => {
    if (category === "crypto") {
      const token = cryptoTokenOptions.find((option) => option.id === form.cryptoToken) ?? cryptoTokenOptions[0];
      setResolver(token.resolver);
      return;
    }
    if (category === "sports") setResolver(form.sportsProvider === "API_SPORTS" ? "API_SPORTS" : "FOOTBALL_DATA");
    if (category === "weather") setResolver("OPEN_METEO");
    if (category === "other") setResolver("MANUAL");
  };

  useEffect(() => {
    if (selectedCategory !== "sports") return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFixturesLoading(true);
    const sportOrder = [form.sport, "football", "basketball", "baseball"]
      .filter((sport, index, items) => items.indexOf(sport) === index);

    (async () => {
      for (const sport of sportOrder) {
        const data = await api<{ fixtures: FootballFixtureOption[] }>(
          `/api/sports/fixtures?sport=${encodeURIComponent(sport)}`,
        );
        if (cancelled) return;
        if (!data.fixtures.length) continue;

        setFixtureOptions(data.fixtures);
        if (sport !== form.sport) {
          setForm((current) => ({ ...current, sport }));
        }
        const currentFixtureStillExists = data.fixtures.some(
          (fixture) => String(fixture.id) === form.fixtureId,
        );
        if (!currentFixtureStillExists && data.fixtures[0]) {
          const fixture = data.fixtures[0];
          const fixtureProvider = fixture.provider === "API_SPORTS" ? "API_SPORTS" : "FOOTBALL_DATA";
          setResolver(fixtureProvider);
          setForm((current) => ({
            ...current,
            sportsProvider: fixtureProvider,
            sport,
            fixtureId: String(fixture.id),
            fixture: `${fixture.homeTeam} vs. ${fixture.awayTeam}`,
            competition: fixture.competitionName,
            poolEndsAt: fixture.utcDate ? fixture.utcDate.slice(0, 16) : current.poolEndsAt,
          }));
        }
        return;
      }

      if (!cancelled) {
        setFixtureOptions([]);
      }
    })().finally(() => {
      if (!cancelled) setFixturesLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [form.fixtureId, form.sport, selectedCategory]);

  const selectFixture = (fixtureId: string) => {
    const fixture = fixtureOptions.find((option) => String(option.id) === fixtureId);
    const fixtureProvider = fixture?.provider === "API_SPORTS" ? "API_SPORTS" : "FOOTBALL_DATA";
    setResolver(fixtureProvider);
    setForm((current) => ({
      ...current,
      sportsProvider: fixtureProvider,
      fixtureId,
      fixture: fixture ? `${fixture.homeTeam} vs. ${fixture.awayTeam}` : current.fixture,
      competition: fixture?.competitionName ?? current.competition,
      poolEndsAt: fixture?.utcDate ? fixture.utcDate.slice(0, 16) : current.poolEndsAt,
    }));
  };

  const generatedQuestion = useMemo(() => {
    if (form.question.trim()) return form.question.trim();
    if (resolver === "BINANCE") {
      return `Will ${form.asset} close above $${Number(form.target || 0).toLocaleString()} at the selected UTC time?`;
    }
    if (resolver === "COINGECKO") {
      return `Will ${selectedTokenSymbol} trade above $${form.target || "0.002"} at the selected UTC time?`;
    }
    if (resolver === "FOOTBALL_DATA" || resolver === "API_SPORTS") {
      return `Who will win ${form.fixture} in regular time?`;
    }
    if (resolver === "OPEN_METEO") {
      return `Will ${form.location} be warmer than ${form.target || "20"}°C at the selected local hour?`;
    }
    return "Write an objective, verifiable question";
  }, [form, resolver, selectedTokenSymbol]);

  const outcomes =
    resolver === "FOOTBALL_DATA" || resolver === "API_SPORTS"
      ? ["Home", "Draw", "Away"]
      : form.outcomes
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);

  const settlementSentence = useMemo(() => {
    if (resolver === "BINANCE") {
      return `Resolution: Binance Spot ${form.asset}. The pool uses the closing value of the configured one-minute candle and compares it with ${form.target}.`;
    }
    if (resolver === "COINGECKO") {
      return `Resolution: CoinGecko coin ID ${selectedCoinGeckoId} in USD. The requested time and actual provider observation timestamp will be shown.`;
    }
    if (resolver === "FOOTBALL_DATA" || resolver === "API_SPORTS") {
      return `Resolution: ${resolverLabels[resolver]} ${form.sport} fixture result after finished status. Regular time only; fixture discovery uses the alternate sports API as fallback when available.`;
    }
    if (resolver === "OPEN_METEO") {
      return `Resolution: Open-Meteo observed ${form.metric} for ${form.latitude}, ${form.longitude}. Forecast values are not used.`;
    }
    return `Resolution: Creator-reviewed evidence. Participants may submit evidence but do not vote again. The creator chooses one predefined outcome and signs the result.`;
  }, [form, resolver, selectedCoinGeckoId]);

  const publish = async () => {
    if (!wallet) {
      onConnect();
      return;
    }
    if (outcomes.length < 2 || !form.poolEndsAt) return;
    setBusy(true);
    try {
      const payload = {
        question: generatedQuestion,
        category: resolver.toLowerCase(),
        resolverType: resolver,
        resolverConfig: {
          symbol:
            selectedCryptoToken.id === "other"
              ? `${selectedTokenSymbol}/USDT`
              : form.asset,
          target: form.target,
          sport: form.sport,
          sportsProvider: form.sportsProvider,
          fixtureId: form.fixtureId,
          fixture: form.fixture,
          competition: form.competition,
          location: form.location,
          latitude: form.latitude,
          longitude: form.longitude,
          metric: form.metric,
        },
        outcomes,
        stakeAmountLuna: stake * LUNA_PER_NIM,
        creatorAddress: wallet,
        predictionClosesAt: new Date(new Date(form.poolEndsAt).getTime() - 60 * 60_000).toISOString(),
        eventResolvesAt: new Date(form.poolEndsAt).toISOString(),
        resolutionDeadline: new Date(new Date(form.poolEndsAt).getTime() + 24 * 60 * 60_000).toISOString(),
        settlementRule: settlementSentence,
        refundRule:
          resolver === "MANUAL"
            ? "All confirmed stakes become refundable if the creator misses the displayed deadline or the event is cancelled."
            : "All confirmed stakes are refunded if the source remains unavailable beyond the fallback deadline, the event is cancelled, or nobody predicts correctly.",
        evidenceRequirements: form.evidence,
      };
      const data = await api<{ pool: Pool }>("/api/pools", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      onCreated(data.pool);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="create-page section-width">
      <div className="create-intro">
        <span className="eyebrow">Create a pool</span>
        <h1>Start with a category.</h1>
        <p>
          Choose a category first. The app selects the correct resolution source in the background and shows it clearly before anyone joins.
        </p>
      </div>

      <div className="create-layout">
        <section className="builder-panel">
          <div className="form-section">
            <div className="form-step">
              <span>1</span>
              <div>
                <strong>Choose a category</strong>
                <small>Crypto automatically routes to Binance or CoinGecko based on the token.</small>
              </div>
            </div>
            <div className="resolver-grid">
              {categoryOptions.map((item) => (
                <button
                  key={item.id}
                  className={selectedCategory === item.id ? "selected" : ""}
                  type="button"
                  onClick={() => selectCategory(item.id)}
                >
                  <span className="resolver-mark">{item.icon}</span>
                  <span>
                    <strong>{item.title}</strong>
                    <em>{item.description}</em>
                  </span>
                  <b>{selectedCategory === item.id ? <CheckIcon size={17} /> : null}</b>
                </button>
              ))}
            </div>
          </div>

          <div className="form-section">
            <div className="form-step">
              <span>2</span>
              <div>
                <strong>Define the market</strong>
                <small>Only category-specific fields are shown.</small>
              </div>
            </div>
            <div className="field-grid">
              {(resolver === "BINANCE" || resolver === "COINGECKO") && (
                <>
                  <Field label="Token" wide>
                    <select
                      value={form.cryptoToken}
                      onChange={(event) => selectCryptoToken(event.target.value)}
                    >
                      {cryptoTokenOptions.map((token) => (
                        <option key={token.id} value={token.id}>
                          {token.asset} - {token.name}
                        </option>
                      ))}
                    </select>
                    <span className="source-routing">
                      <SourceBadge type={resolver} />
                      <span>
                        {resolver === "BINANCE"
                          ? `${selectedTokenSymbol}/USDT resolves from Binance Spot.`
                          : `${selectedTokenSymbol}/USDT is routed to CoinGecko automatically.`}
                      </span>
                    </span>
                  </Field>
                  {selectedCryptoToken.id === "other" && (
                    <>
                      <Field label="Token symbol">
                        <input
                          value={form.customTokenSymbol}
                          onChange={(event) =>
                            update("customTokenSymbol", event.target.value)
                          }
                          placeholder="e.g. KAS"
                        />
                      </Field>
                      <Field label="CoinGecko coin ID">
                        <input
                          value={form.customCoinGeckoId}
                          onChange={(event) =>
                            update("customCoinGeckoId", event.target.value)
                          }
                          placeholder="e.g. kaspa"
                        />
                      </Field>
                    </>
                  )}
                  <Field
                    label={
                      resolver === "BINANCE"
                        ? "Threshold (USDT)"
                        : "Price threshold (USDT)"
                    }
                  >
                    <input
                      inputMode="decimal"
                      value={form.target}
                      onChange={(event) => update("target", event.target.value)}
                    />
                  </Field>
                </>
              )}
              {(resolver === "FOOTBALL_DATA" || resolver === "API_SPORTS") && (
                <>
                  <Field label="Sport" wide>
                    <select
                      value={form.sport}
                      onChange={(event) => {
                        const nextSport = event.target.value;
                        const nextProvider = nextSport === "football" ? "FOOTBALL_DATA" : "API_SPORTS";
                        setResolver(nextProvider);
                        setForm((current) => ({
                          ...current,
                          sport: nextSport,
                          sportsProvider: nextProvider,
                          fixtureId: "",
                          fixture: "",
                          competition: "",
                        }));
                      }}
                    >
                      <option value="football">Football</option>
                      <option value="basketball">Basketball</option>
                      <option value="baseball">Baseball</option>
                    </select>
                  </Field>
                  <Field label="Future fixture" wide>
                    <select
                      value={form.fixtureId}
                      onChange={(event) => selectFixture(event.target.value)}
                      disabled={fixturesLoading}
                    >
                      {fixtureOptions.length === 0 && (
                        <option value="" disabled>
                          No live future fixtures available
                        </option>
                      )}
                      {fixtureOptions.map((fixture) => (
                        <option key={`${fixture.provider}-${fixture.id}`} value={String(fixture.id)}>
                          {new Date(fixture.utcDate).toLocaleString([], {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })} - {fixture.homeTeam} vs. {fixture.awayTeam}
                        </option>
                      ))}
                    </select>
                    <small className="field-help">
                      {fixturesLoading
                        ? "Loading future fixtures..."
                        : fixtureOptions.length > 0
                          ? `${form.competition || "Upcoming fixtures"} from ${resolverLabels[resolver]}.`
                          : "No live future fixtures were returned by the sports provider."}
                    </small>
                  </Field>
                </>
              )}
              {resolver === "OPEN_METEO" && (
                <>
                  <Field label="Location label" wide>
                    <input
                      value={form.location}
                      onChange={(event) => update("location", event.target.value)}
                    />
                  </Field>
                  <Field label="Latitude">
                    <input
                      value={form.latitude}
                      onChange={(event) => update("latitude", event.target.value)}
                    />
                  </Field>
                  <Field label="Longitude">
                    <input
                      value={form.longitude}
                      onChange={(event) => update("longitude", event.target.value)}
                    />
                  </Field>
                </>
              )}
              {resolver === "MANUAL" && (
                <>
                  <Field label="Objective question" wide>
                    <textarea
                      value={form.question}
                      onChange={(event) => update("question", event.target.value)}
                      placeholder="Will the product ship publicly by Friday at 17:00 UTC?"
                    />
                  </Field>
                  <Field label="Predefined outcomes" wide>
                    <input
                      value={form.outcomes}
                      onChange={(event) => update("outcomes", event.target.value)}
                      placeholder="Yes, No"
                    />
                    <small className="field-help">Separate outcomes with commas.</small>
                  </Field>
                  <Field label="Accepted evidence" wide>
                    <textarea
                      value={form.evidence}
                      onChange={(event) => update("evidence", event.target.value)}
                    />
                  </Field>
                </>
              )}
            </div>
          </div>

          <div className="form-section">
            <div className="form-step">
              <span>3</span>
              <div>
                <strong>Stake and deadlines</strong>
                <small>Keep social pools small and the timing unambiguous.</small>
              </div>
            </div>
            <Field label="Fixed stake">
              <div className="stake-presets">
                {[1, 5, 10].map((amount) => (
                  <button
                    key={amount}
                    className={stake === amount ? "selected" : ""}
                    type="button"
                    onClick={() => setStake(amount)}
                  >
                    {amount} NIM
                  </button>
                ))}
              </div>
            </Field>
            <div className="field-grid dates">
              <Field label="When the pool ends" wide>
                <input
                  type="datetime-local"
                  value={form.poolEndsAt}
                  onChange={(event) => update("poolEndsAt", event.target.value)}
                />
                <small className="field-help">The app derives the lock window and fallback deadline automatically.</small>
              </Field>
            </div>
          </div>
        </section>

        <aside className="preview-panel">
          <div className="preview-label">
            <span>Live preview</span>
            <span className="status-chip status-open">open</span>
          </div>
          <SourceBadge type={resolver} />
          <h2>{generatedQuestion}</h2>
          <div className="preview-outcomes">
            {outcomes.length > 0 ? (
              outcomes.map((outcome) => <span key={outcome}>{outcome}</span>)
            ) : (
              <span>Add two or more outcomes</span>
            )}
          </div>
          <div className="preview-metrics">
            <div>
              <small>Fixed stake</small>
              <strong>{stake} NIM</strong>
            </div>
            <div>
              <small>House edge</small>
              <strong>0%</strong>
            </div>
          </div>
          <div className="preview-rule">
            <span className="shield-mark small"><ShieldCheckIcon size={16} /></span>
            <p>{settlementSentence}</p>
          </div>
          <div className="preview-refund">
            <strong>Refund rule</strong>
            <p>
              No correct prediction, cancellation, or an unresolved source
              beyond the displayed deadline returns every confirmed stake.
            </p>
          </div>
          <button
            className="primary-button wide"
            type="button"
            disabled={
              busy ||
              outcomes.length < 2 ||
              ((resolver === "FOOTBALL_DATA" || resolver === "API_SPORTS") && !form.fixtureId) ||
              !form.poolEndsAt
            }
            onClick={publish}
          >
            {busy ? "Publishing…" : wallet ? "Publish pool" : "Connect to publish"}
          </button>
          <p className="immutability-note">
            Publishing records this exact rule. It freezes after the first
            confirmed stake.
          </p>
        </aside>
      </div>
    </div>
  );
}

function Field({
  label,
  wide,
  children,
}: {
  label: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className={`field ${wide ? "wide" : ""}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}

function Activity({
  pools,
  wallet,
  joinedPoolIds,
  onConnect,
  onOpenPool,
}: {
  pools: Pool[];
  wallet: string | null;
  joinedPoolIds: string[];
  onConnect: () => void;
  onOpenPool: (pool: Pool) => void;
}) {
  const relevant = pools.filter(
    (pool) =>
      pool.creatorAddress === wallet || joinedPoolIds.includes(pool.id),
  );

  return (
    <div className="activity-page section-width">
      <div className="create-intro">
        <span className="eyebrow">Your activity</span>
        <h1>Every pool, proof, and transfer.</h1>
        <p>
          Created and joined pools stay grouped with their declared source,
          result proof, and settlement state.
        </p>
      </div>
      {!wallet ? (
        <div className="empty-state">
          <span className="empty-mark">◉</span>
          <h2>Connect your wallet to see activity</h2>
          <p>Your address is used only to match pools you created or joined.</p>
          <button className="primary-button" type="button" onClick={onConnect}>
            Connect Nimiq Pay
          </button>
        </div>
      ) : relevant.length === 0 ? (
        <div className="empty-state">
          <span className="empty-mark">↗</span>
          <h2>Your first pool is waiting</h2>
          <p>Join a live pool or publish one to see its history here.</p>
        </div>
      ) : (
        <div className="activity-list">
          {relevant.map((pool) => (
            <button
              type="button"
              key={pool.id}
              onClick={() => onOpenPool(pool)}
            >
              <SourceBadge type={pool.resolverType} />
              <span className="activity-question">{pool.question}</span>
              <span className={`status-chip status-${pool.status.toLowerCase()}`}>
                {statusLabel(pool.status)}
              </span>
              <span className="activity-arrow"><ArrowRightIcon size={17} /></span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}


function Referrals({
  wallet,
  provider,
  walletMode,
  onConnect,
  setNotice,
}: {
  wallet: string | null;
  provider: NimiqProvider | null;
  walletMode: "nimiq" | "demo" | null;
  onConnect: () => void;
  setNotice: (notice: Notice) => void;
}) {
  const [dashboard, setDashboard] = useState<ReferralDashboard | null>(null);
  const [loading, setLoading] = useState(false);
  const [claiming, setClaiming] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!wallet) return;
    setLoading(true);
    try {
      const data = await api<ReferralDashboard>(`/api/referrals?address=${encodeURIComponent(wallet)}`);
      setDashboard(data);
    } catch (error) {
      setNotice({ tone: "warning", text: error instanceof Error ? error.message : "Referral details could not be loaded." });
    } finally {
      setLoading(false);
    }
  }, [wallet, setNotice]);

  useEffect(() => { void load(); }, [load]);

  const copyLink = async () => {
    if (!dashboard) return;
    await navigator.clipboard.writeText(dashboard.referralCode.shareUrl);
    setNotice({ tone: "success", text: "Referral link copied." });
  };

  const shareLink = async () => {
    if (!dashboard) return;
    if (navigator.share) {
      await navigator.share({ title: "Nimiq Pools", text: "Join me on Nimiq Pools.", url: dashboard.referralCode.shareUrl });
    } else {
      await copyLink();
    }
  };

  const claim = async (reward: RewardEvent) => {
    if (!wallet) return;
    setClaiming(reward.id);
    try {
      const payload = JSON.stringify({ domain: "nimiq-pools-reward", version: 1, rewardEventId: reward.id, address: wallet, amount: reward.amount, nonce: crypto.randomUUID() });
      const payloadUtf8Hex = Array.from(new TextEncoder().encode(payload), (byte) => byte.toString(16).padStart(2, "0")).join("");
      let signature = "demo-signed-claim";
      let publicKey = "demo-public-key";
      if (walletMode === "nimiq" && provider) {
        console.info("[claim-signature-debug][frontend]", {
          rewardEventId: reward.id,
          address: wallet,
          payload,
          payloadUtf8Hex,
        });
        const result = await signWithProvider(provider, payload);
        signature = result.signature;
        publicKey = result.publicKey;
      }
      await api<{ ok: boolean; claimTxHash: string }>("/api/referrals/claim", {
        method: "POST",
        body: JSON.stringify({
          address: wallet,
          rewardEventId: reward.id,
          payload,
          signature,
          publicKey,
          signingDebug: {
            frontendPayload: payload,
            frontendPayloadUtf8Hex: payloadUtf8Hex,
          },
        }),
      });
      setNotice({ tone: "success", text: `${reward.amount} NIM reward claimed.` });
      await load();
    } catch (error) {
      setNotice({ tone: "warning", text: error instanceof Error ? error.message : "Reward claim failed." });
    } finally {
      setClaiming(null);
    }
  };

  if (!wallet) {
    return (
      <div className="referrals-page section-width">
        <div className="create-intro"><span className="eyebrow">Referrals</span><h1>Invite people. Earn from verified activity.</h1><p>Your code is created once for your wallet. The 100 NIM signup bonus unlocks as soon as you connect.</p></div>
        <div className="empty-state"><span className="empty-mark"><GiftIcon size={30} /></span><h2>Connect to create your referral link</h2><p>Your signup bonus unlocks on connect. Referral rewards still wait for a verified first stake from a new wallet.</p><button className="primary-button" type="button" onClick={onConnect}>Connect Nimiq Pay</button></div>
      </div>
    );
  }

  if (loading || !dashboard) return <div className="referrals-page section-width"><div className="referral-skeleton" /></div>;
  const signup = dashboard.signupReward;
  const signupState = !signup ? "locked" : signup.status === "claimed" ? "claimed" : "pending";
  const showPinned = !dashboard.leaderboard.some((entry) => entry.address === wallet);

  return (
    <div className="referrals-page section-width">
      <div className="create-intro"><span className="eyebrow">Referrals</span><h1>Verified activity, shared rewards.</h1><p>Refer friends. Earn NIM rewards when they sign up and connect.</p></div>

      <div className="referral-grid">
        <section className="referral-card referral-link-card">
          <div className="referral-card-title"><span><LinkIcon size={18} /></span><div><small>Your referral link</small><h2>Share one permanent code</h2></div></div>
          <div className="referral-link-row"><code>{dashboard.referralCode.shareUrl}</code><button type="button" onClick={copyLink} aria-label="Copy referral link"><CopyIcon size={18} /></button><button type="button" onClick={shareLink} aria-label="Share referral link"><ShareNetworkIcon size={18} /></button></div>
          <p className="referral-fine-print">Attribution is verified only when a new wallet makes its first eligible stake into a pool created by someone else.</p>
        </section>



        <section className="referral-card referral-stats-card">
          <div><small>Verified referrals</small><strong className="number-font">{dashboard.verifiedReferralCount}</strong></div>
          <div><small>Referral rewards</small><strong className="number-font">{dashboard.referralEarned} NIM</strong></div>
        </section>

        <section className="referral-card signup-card">
          <div className="referral-card-title"><span><GiftIcon size={18} /></span><div><small>Your signup bonus</small><h2>100 NIM</h2></div></div>
          <div className={`reward-status reward-${signupState}`}><span>{signupState === "claimed" ? "Claimed" : "Unlocked"}</span><p>{signupState === "locked" ? "Connect your wallet to unlock the 100 NIM signup bonus." : signupState === "claimed" ? "Your signup reward has been received." : "Your signup reward is unlocked and ready to claim."}</p></div>
          {signup && signup.status !== "claimed" && <button className="primary-button compact" type="button" disabled={claiming === signup.id} onClick={() => void claim(signup)}>{claiming === signup.id ? "Claiming..." : "Claim 100 NIM"}</button>}
        </section>
      </div>

      {dashboard.claimableRewards.filter((item) => item.type === "referral").length > 0 && (
        <section className="claim-list referral-card"><div className="referral-card-title"><span><GiftIcon size={18} /></span><div><small>Unlocked referral rewards</small><h2>Ready to claim</h2></div></div>{dashboard.claimableRewards.filter((item) => item.type === "referral").map((reward) => <div className="claim-row" key={reward.id}><span><strong>{reward.amount} NIM</strong><small>Verified referral</small></span><button className="secondary-button compact" type="button" disabled={claiming === reward.id} onClick={() => void claim(reward)}>{claiming === reward.id ? "Claiming..." : "Claim"}</button></div>)}</section>
      )}

      <section className="leaderboard-card referral-card">
        <div className="leaderboard-header"><div className="referral-card-title"><span><RankingIcon size={18} /></span><div><small>Leaderboard</small><h2>Top verified referrers</h2></div></div><span>Top 20</span></div>
        <div className="leaderboard-list">
          {dashboard.leaderboard.map((entry) => <div className={`leaderboard-row ${entry.address === wallet ? "is-you" : ""}`} key={entry.address}><span className="rank number-font">{entry.rank}</span><span className="leader-address">{shortAddress(entry.address)}{entry.address === wallet && <em>you</em>}</span><strong className="number-font">{entry.verifiedCount}</strong></div>)}
        </div>
        {showPinned && <div className="leaderboard-row pinned-you"><span className="rank number-font">{dashboard.ownRank.rank}</span><span className="leader-address">{shortAddress(wallet)}<em>you</em></span><strong className="number-font">{dashboard.ownRank.verifiedCount}</strong></div>}
      </section>

      <div className="referral-note"><ShieldCheckIcon size={17} /><p><strong>Known v1 limitation.</strong> A wallet can qualify by making a small real stake into another user's pool. Device fingerprinting, rate limits, tiers, and other anti-sybil systems are intentionally out of scope for this pass.</p></div>
    </div>
  );
}
